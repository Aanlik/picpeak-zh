const { randomUUID } = require('crypto');
const { db } = require('../database/db');
const BRIDGE_TIMEOUT_MS = 5000;

function bridgeConfig() {
  const base = process.env.PIXCAKE_BRIDGE_URL;
  const password = process.env.PIXCAKE_BRIDGE_PASSWORD;
  if (!base || !password) return null;
  return { base: base.replace(/\/+$/, ''), authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}` };
}

async function bridgeRequest(path, { method = 'GET', body, form = false } = {}) {
  const config = bridgeConfig();
  if (!config) return { configured: false, status: 503, data: null };
  let response;
  try {
    response = await fetch(new URL(path, `${config.base}/`), {
      method,
      headers: {
        Authorization: config.authorization,
        ...(body ? { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' } : {}),
      },
      ...(body ? { body: form ? new URLSearchParams(body) : JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
      redirect: 'manual',
    });
  } catch {
    return { configured: true, status: 503, data: null };
  }
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  return { configured: true, status: response.status, data, location: response.headers?.get?.('location') || '' };
}

async function getProjectDetail(eventId) {
  const result = await bridgeRequest(`/api/projects/${Number(eventId)}/detail`);
  if (result.status === 200 && Array.isArray(result.data?.photos)) {
    const pending = new Set((await db('workflow_withdrawal_intents').where({ event_id: Number(eventId) }).select('photo_id')).map(row => Number(row.photo_id)));
    result.data.photos = result.data.photos.map(photo => ({ ...photo, withdraw_pending: Boolean(photo.withdraw_pending || pending.has(Number(photo.photo_id))) }));
  }
  return result;
}

async function prepareVersionFolder(eventId, photoId, expectedCurrentVersion) {
  return bridgeRequest(`/api/projects/${Number(eventId)}/photos/${Number(photoId)}/version-folder`, {
    method: 'POST',
    body: { expected_current_version: Number(expectedCurrentVersion) || 0 },
  });
}

const executing = new Map();
function serialized(key, task) {
  const previous = executing.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  executing.set(key, current);
  current.finally(() => { if (executing.get(key) === current) executing.delete(key); }).catch(() => {});
  return current;
}

async function flushStage(eventId) {
  return serialized(`stage:${eventId}`, async () => {
    const intent = await db('workflow_stage_intents').where({ event_id: Number(eventId) }).first();
    if (!intent) return { status: 200 };
    const result = await bridgeRequest(`/api/projects/${Number(eventId)}/${intent.stage === 'RESTORE' ? 'restore' : 'stage'}`, {
      method: 'POST', body: intent.stage === 'RESTORE' ? {} : { stage: intent.stage },
    });
    if ([200, 404].includes(result.status)) {
      await db('workflow_stage_intents').where({ operation_id: intent.operation_id }).delete();
    } else {
      await db('workflow_stage_intents').where({ operation_id: intent.operation_id }).update({ error: `HTTP ${result.status}` });
    }
    return result;
  });
}

async function queueStage(eventId, stage) {
  await db('workflow_stage_intents').insert({ event_id: Number(eventId), operation_id: randomUUID(), stage, error: null })
    .onConflict('event_id').merge();
  return flushStage(eventId);
}

async function flushWithdrawal(intent) {
  return serialized(`withdraw:${intent.operation_id}`, async () => {
    const result = await bridgeRequest(`/api/projects/${intent.event_id}/photos/${intent.photo_id}/withdraw`, {
      method: 'POST', body: { delete_delivered: Boolean(intent.delete_delivered), operation_id: intent.operation_id },
    });
    if (result.status === 200 || (result.status === 202 && result.data?.processing === false)) {
      await db('workflow_withdrawal_intents').where({ operation_id: intent.operation_id }).delete();
    } else {
      await db('workflow_withdrawal_intents').where({ operation_id: intent.operation_id }).update({ error: `HTTP ${result.status}` });
    }
    return result;
  });
}

async function persistWithdrawalIntent(eventId, photoId, deleteDelivered, executor = db) {
  const fresh = { operation_id: randomUUID(), event_id: Number(eventId), photo_id: Number(photoId), delete_delivered: Boolean(deleteDelivered) };
  await executor('workflow_withdrawal_intents').insert(fresh).onConflict('photo_id').ignore();
  return executor('workflow_withdrawal_intents').where({ photo_id: Number(photoId), event_id: Number(eventId) }).first();
}

async function withdrawPhotoSelection(eventId, photoId, deleteDelivered) {
  const intent = await persistWithdrawalIntent(eventId, photoId, deleteDelivered);
  if (!intent || Boolean(intent.delete_delivered) !== Boolean(deleteDelivered)) return { status: 409, data: { detail: '撤回任务已提交，不能更改删除选项' } };
  const result = await flushWithdrawal(intent);
  // A durable local receipt survives disconnection from Bridge.
  if (result.status === 503 || result.status === 429 || result.status >= 500) return { configured: true, status: 202, data: { processing: true } };
  if (result.status >= 400) await db('workflow_withdrawal_intents').where({ operation_id: intent.operation_id }).delete();
  return result;
}

async function triggerWorkflowSync(eventId) {
  return bridgeRequest(`/api/projects/${Number(eventId)}/sync`, { method: 'POST', body: {} });
}

async function setWorkflowStage(eventId, stage) {
  return queueStage(eventId, stage);
}

async function restoreWorkflowStage(eventId) {
  return queueStage(eventId, 'RESTORE');
}

async function flushWorkflowIntents() {
  if (!bridgeConfig()) return;
  for (const intent of await db('workflow_stage_intents').select('*')) await flushStage(intent.event_id);
  for (const intent of await db('workflow_withdrawal_intents').select('*')) await flushWithdrawal(intent);
}

function startWorkflowReconciler() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await flushWorkflowIntents(); }
    catch (error) { require('../utils/logger').warn('Workflow intent reconciliation failed', { error: error.message }); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), 30000);
  timer.unref();
  return () => clearInterval(timer);
}

async function getPublicPhotoStates(eventId) {
  const result = await getProjectDetail(eventId);
  if (result.status !== 200 || !result.data || !Array.isArray(result.data.photos)) return result;
  // Share only workflow labels and versions with a customer. RAW paths,
  // filenames, bridge errors, and photographer-only state stay private.
  result.data.photos = result.data.photos.map((photo) => ({
    photo_id: Number(photo.photo_id),
    selected: Boolean(photo.selected),
    selection_cancelled: Boolean(photo.selection_cancelled),
    delivered: Boolean(photo.delivered),
    current_version: Number(photo.current_version) || 0,
    added_during_editing: Boolean(photo.added_during_editing),
    ready_for_editing: Boolean(photo.ready_for_editing),
    withdraw_pending: Boolean(photo.withdraw_pending),
  }));
  delete result.data.summary;
  delete result.data.name;
  delete result.data.connected;
  return result;
}

module.exports = {
  bridgeConfig, bridgeRequest, getProjectDetail, getPublicPhotoStates,
  prepareVersionFolder, withdrawPhotoSelection, persistWithdrawalIntent, triggerWorkflowSync,
  setWorkflowStage, restoreWorkflowStage, flushWorkflowIntents, startWorkflowReconciler,
};
