// PicPeak admin proxy for the private Bridge workflow API. The browser only
// talks to PicPeak; the Bridge password remains server-side.
const express = require('express');
const path = require('path');
const { requireEventOwnership } = require('../middleware/ownership');
const { adminAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { NO_EMAIL_MODE } = require('../utils/communicationProfile');
const { db, logActivity } = require('../database/db');
const { bridgeRequest, getProjectDetail } = require('../services/photographyWorkflowBridge');
const { getExternalMediaRoot, resolveExternalPath } = require('../services/externalMediaService');

const router = express.Router();
router.use(adminAuth, requirePermission('events.view'));

function parseId(value) {
  return /^\d+$/.test(String(value)) && Number(value) > 0;
}

function cameraSubdirectory(event) {
  if (!event || event.source_mode !== 'reference' || !event.external_path) return null;
  try {
    const cameraRoot = path.resolve(getExternalMediaRoot(), 'Camera');
    const eventRoot = path.resolve(resolveExternalPath(event, ''));
    const relative = path.relative(cameraRoot, eventRoot);
    if (!relative || relative === '.' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    if (relative.split(path.sep).some((part) => part.toLocaleLowerCase() === 'pixcakedelivery')) return null;
    return relative.split(path.sep).join('/');
  } catch {
    return null;
  }
}

router.get('/:eventId', (req, res, next) => parseId(req.params.eventId) ? next() : res.sendStatus(400), requireEventOwnership, async (req, res) => {
  if (!NO_EMAIL_MODE) return res.sendStatus(404);
  const result = await getProjectDetail(req.params.eventId);
  if (!result.configured) return res.status(503).json({ error: '尚未连接精修同步服务' });
  if (result.status === 404) {
    const event = await db('events').where({ id: Number(req.params.eventId) }).first();
    const suggestedRawSubdir = cameraSubdirectory(event);
    const mountStatus = suggestedRawSubdir
      ? await bridgeRequest(`/api/projects/${Number(req.params.eventId)}/mount-status?raw_subdir=${encodeURIComponent(suggestedRawSubdir)}`)
      : null;
    const autoBindAvailable = Boolean(mountStatus?.status === 200 && mountStatus.data?.writable_mount_ready);
    return res.json({
      configured: false,
      auto_bind_available: autoBindAvailable,
      auto_bind_mount_missing: Boolean(suggestedRawSubdir && !autoBindAvailable),
      suggested_raw_subdir: suggestedRawSubdir,
      project_name: event?.event_name || event?.slug || '',
    });
  }
  if (result.status !== 200) return res.status(503).json({ error: '精修同步服务暂时不可用' });
  res.json({ ...result.data, configured: true });
});

router.get('/:eventId/requests', (req, res, next) => parseId(req.params.eventId) ? next() : res.sendStatus(400), requireEventOwnership, async (req, res) => {
  if (!NO_EMAIL_MODE) return res.sendStatus(404);
  try {
    const rows = await db('photo_retouch_requests as r')
      .join('photos as p', 'p.id', 'r.photo_id')
      .where('r.event_id', Number(req.params.eventId))
      .select('r.id', 'r.photo_id', 'p.filename', 'p.original_filename', 'p.source_filename', 'r.request_type', 'r.base_version', 'r.target_version', 'r.delivery_folder', 'r.customer_message', 'r.status', 'r.photographer_reply', 'r.created_at', 'r.updated_at')
      .orderBy('r.created_at', 'desc');
    res.json({ requests: rows });
  } catch {
    res.status(500).json({ error: '无法读取客户精修需求' });
  }
});

router.post('/:eventId/bind', requirePermission('events.edit'), (req, res, next) => parseId(req.params.eventId) ? next() : res.sendStatus(400), requireEventOwnership, async (req, res) => {
  if (!NO_EMAIL_MODE) return res.sendStatus(404);
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const rawSubdir = typeof req.body?.raw_subdir === 'string' ? req.body.raw_subdir.trim() : '';
  if (!name || name.length > 120 || !rawSubdir || rawSubdir.length > 500) return res.status(400).json({ error: '请填写项目名称和 Camera 内 RAW 子目录' });
  const result = await bridgeRequest('/projects', {
    method: 'POST', form: true,
    body: { name, event_id: Number(req.params.eventId), raw_subdir: rawSubdir },
  });
  if (!result.configured) return res.status(503).json({ error: '尚未连接精修同步服务' });
  if (result.status !== 303) return res.status(503).json({ error: 'Bridge 暂时无法绑定项目' });
  const location = new URL(result.location || '/', 'http://bridge.local');
  const setupError = location.searchParams.get('setup_error');
  if (setupError) return res.status(400).json({ error: setupError });
  const detail = await getProjectDetail(req.params.eventId);
  if (detail.status !== 200) return res.status(503).json({ error: '项目已绑定，但暂时无法读取同步状态' });
  res.status(201).json({ ...detail.data, configured: true });
});

router.post('/:eventId/auto-bind', requirePermission('events.edit'), (req, res, next) => parseId(req.params.eventId) ? next() : res.sendStatus(400), requireEventOwnership, async (req, res) => {
  if (!NO_EMAIL_MODE) return res.sendStatus(404);
  const eventId = Number(req.params.eventId);
  const event = await db('events').where({ id: eventId }).first();
  const rawSubdir = cameraSubdirectory(event);
  if (!rawSubdir) return res.status(400).json({ error: '此项目未引用 Camera 下的 NAS 文件夹，无法自动挂载精修目录' });
  const name = String(event.event_name || event.slug || '').trim();
  if (!name) return res.status(400).json({ error: '项目名称为空，无法自动绑定' });

  const result = await bridgeRequest('/projects', {
    method: 'POST', form: true,
    body: { name, event_id: eventId, raw_subdir: rawSubdir, auto_mount: 'true' },
  });
  if (!result.configured) return res.status(503).json({ error: '尚未连接精修同步服务' });
  if (result.status !== 303) return res.status(503).json({ error: 'Bridge 暂时无法创建项目目录' });
  const location = new URL(result.location || '/', 'http://bridge.local');
  const setupError = location.searchParams.get('setup_error');
  if (setupError) return res.status(400).json({ error: setupError });
  const detail = await getProjectDetail(eventId);
  if (detail.status !== 200) return res.status(503).json({ error: '项目已创建，但暂时无法读取同步状态' });
  res.status(201).json({ ...detail.data, configured: true });
});

router.post('/:eventId/stage', requirePermission('events.edit'), (req, res, next) => parseId(req.params.eventId) ? next() : res.sendStatus(400), requireEventOwnership, async (req, res) => {
  if (!NO_EMAIL_MODE) return res.sendStatus(404);
  const result = await bridgeRequest(`/api/projects/${Number(req.params.eventId)}/stage`, { method: 'POST', body: { stage: req.body?.stage } });
  if (result.status !== 200) return res.status(result.status === 400 ? 400 : 503).json({ error: '无法更新项目阶段' });
  res.json(result.data);
});

router.post('/:eventId/sync', requirePermission('events.edit'), (req, res, next) => parseId(req.params.eventId) ? next() : res.sendStatus(400), requireEventOwnership, async (req, res) => {
  if (!NO_EMAIL_MODE) return res.sendStatus(404);
  const result = await bridgeRequest(`/api/projects/${Number(req.params.eventId)}/sync`, { method: 'POST', body: {} });
  if (result.status !== 200) return res.status(503).json({ error: '无法立即同步项目' });
  res.json(result.data);
});

router.post('/:eventId/rescan', requirePermission('events.edit'), (req, res, next) => parseId(req.params.eventId) ? next() : res.sendStatus(400), requireEventOwnership, async (req, res) => {
  if (!NO_EMAIL_MODE) return res.sendStatus(404);
  const result = await bridgeRequest(`/api/projects/${Number(req.params.eventId)}/rescan`, { method: 'POST', body: {} });
  if (result.status !== 200) return res.status(503).json({ error: '无法重新扫描项目目录' });
  res.json(result.data);
});

router.post('/:eventId/retry', requirePermission('events.edit'), (req, res, next) => parseId(req.params.eventId) ? next() : res.sendStatus(400), requireEventOwnership, async (req, res) => {
  if (!NO_EMAIL_MODE) return res.sendStatus(404);
  const result = await bridgeRequest(`/api/projects/${Number(req.params.eventId)}/retry`, {
    method: 'POST', body: { confirm_unknown: req.body?.confirm_unknown === true },
  });
  if (result.status === 409) return res.status(409).json(result.data?.detail || result.data || { code: 'UNKNOWN_CONFIRMATION_REQUIRED' });
  if (result.status !== 200) return res.status(503).json({ error: '无法重试失败任务' });
  res.json(result.data);
});

router.patch('/:eventId/requests/:requestId', requirePermission('events.edit'), (req, res, next) => {
  if (parseId(req.params.eventId) && parseId(req.params.requestId)) return next();
  return res.sendStatus(400);
}, requireEventOwnership, async (req, res) => {
  if (!NO_EMAIL_MODE) return res.sendStatus(404);
  const allowed = ['open', 'in_progress', 'waiting_customer', 'completed', 'closed', 'cancelled'];
  const status = req.body?.status;
  const reply = typeof req.body?.photographer_reply === 'string' ? req.body.photographer_reply.trim().slice(0, 1000) : '';
  if (!allowed.includes(status)) return res.status(400).json({ error: '无效的需求状态' });
  const id = Number(req.params.requestId);
  const eventId = Number(req.params.eventId);
  const request = await db('photo_retouch_requests').where({ id, event_id: eventId }).first();
  if (!request) return res.sendStatus(404);
  await db('photo_retouch_requests').where({ id, event_id: eventId }).update({
    status,
    photographer_reply: reply || null,
    updated_at: new Date(),
  });
  await logActivity('photo_retouch_request_updated', { request_id: id, status }, eventId, { type: 'admin', id: req.admin.id, name: req.admin.username || 'admin' });
  const updated = await db('photo_retouch_requests').where({ id }).first();
  res.json({ request: updated });
});

module.exports = router;
