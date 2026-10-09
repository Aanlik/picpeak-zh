/** Per-IP failed-attempt lockout used by short-lived public upload codes. */

// In-memory bad-attempt counter. Per-process; cleared on restart.
// Keyed by IP. Each entry: { count, firstAt }. We could persist this
// in app_settings or a dedicated table, but in-memory is simpler and
// good enough for the threat (distributed brute force is the only
// case where IP locking helps anyway, and that needs more than one
// IP to be effective).
const BAD_ATTEMPT_LIMIT = 20;
const BAD_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const badAttempts = new Map();
const MAX_BAD_ATTEMPT_IPS = 10000;
let lastPrunedAt = 0;
const bucketKey = (ip, scope) => `${scope}:${ip}`;

function pruneExpired(now) {
  if (now - lastPrunedAt < 60000) return;
  for (const [key, entry] of badAttempts) {
    if (now - entry.firstAt >= BAD_ATTEMPT_WINDOW_MS) badAttempts.delete(key);
  }
  lastPrunedAt = now;
}

function recordBadAttempt(ip, scope = 'public') {
  if (!ip) return;
  const now = Date.now();
  pruneExpired(now);
  const key = bucketKey(ip, scope);
  const entry = badAttempts.get(key);
  if (!entry || (now - entry.firstAt) > BAD_ATTEMPT_WINDOW_MS) {
    if (!badAttempts.has(key) && badAttempts.size >= MAX_BAD_ATTEMPT_IPS) {
      badAttempts.delete(badAttempts.keys().next().value);
    }
    badAttempts.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}

function isIpLocked(ip, scope = 'public') {
  if (!ip) return false;
  const key = bucketKey(ip, scope);
  const entry = badAttempts.get(key);
  if (!entry) return false;
  if ((Date.now() - entry.firstAt) > BAD_ATTEMPT_WINDOW_MS) {
    badAttempts.delete(key);
    return false;
  }
  return entry.count >= BAD_ATTEMPT_LIMIT;
}

module.exports = {
  recordBadAttempt,
  isIpLocked,
  _internal: { recordBadAttempt, isIpLocked, badAttempts, MAX_BAD_ATTEMPT_IPS },
};
