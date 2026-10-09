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
  return bridgeRequest(`/api/projects/${Number(eventId)}/detail`);
}

async function getPublicPhotoStates(eventId) {
  const result = await getProjectDetail(eventId);
  if (result.status !== 200 || !result.data || !Array.isArray(result.data.photos)) return result;
  // Share only workflow labels and versions with a customer. RAW paths,
  // filenames, bridge errors, and photographer-only state stay private.
  result.data.photos = result.data.photos.map((photo) => ({
    photo_id: Number(photo.photo_id),
    selected: Boolean(photo.selected),
    delivered: Boolean(photo.delivered),
    current_version: Number(photo.current_version) || 0,
    added_during_editing: Boolean(photo.added_during_editing),
    ready_for_editing: Boolean(photo.ready_for_editing),
  }));
  delete result.data.summary;
  delete result.data.name;
  delete result.data.connected;
  return result;
}

module.exports = { bridgeConfig, bridgeRequest, getProjectDetail, getPublicPhotoStates };
