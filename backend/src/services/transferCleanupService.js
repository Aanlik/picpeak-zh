/**
 * transferCleanupService — retention lifecycle for PicTransfer (#997).
 *
 * Runs hourly (offset from the gallery expiration checker so the two don't
 * collide) and drives three transitions:
 *
 *   1. Expire    — an active transfer past `expires_at` is disabled
 *                  (is_active=false, disabled_at=now). This is the "disable the
 *                  link after the set time period" behaviour. A transfer
 *                  disabled early by its download cap is already in this state.
 *   2. Delete    — `grace_days` after disable, the client-uploaded files are
 *                  removed and the transfer record is dropped. (The gallery
 *                  originals a transfer pointed at are owned by their events and
 *                  are never touched — only the transfer's own ad-hoc uploads
 *                  are deleted, which is what the retention cap is about.)
 */

const { scheduledTask } = require('./scheduledTask');
const { db } = require('../database/db');
const logger = require('../utils/logger');
const { formatBoolean } = require('../utils/dbCompat');
const transferService = require('./transferService');

const DAY_MS = 24 * 60 * 60 * 1000;

const task = scheduledTask(runTransferCleanup, { schedule: '15 * * * *' });
function startTransferCleanup() { task.start(); }
const stopTransferCleanup = () => task.stop();

async function runTransferCleanup() {
  try {
    await expireTransfers();
    await deleteRetiredTransfers();
  } catch (err) {
    logger.error('Transfer cleanup error', { error: err.message });
  }
}

/** Disable links whose time window has passed. */
async function expireTransfers() {
  const now = new Date();
  const due = await db('transfers')
    .where('is_active', formatBoolean(true))
    .whereNull('deleted_at')
    .whereNotNull('expires_at')
    .where('expires_at', '<=', now);

  for (const t of due) {
    await db('transfers').where({ id: t.id }).update({
      is_active: formatBoolean(false),
      disabled_at: t.disabled_at || now,
      updated_at: now,
    });
    logger.info(`Transfer ${t.id} expired`);
  }
}

/** Hard-delete transfers whose retention window has fully elapsed. */
async function deleteRetiredTransfers() {
  const candidates = await db('transfers')
    .where('is_active', formatBoolean(false))
    .whereNull('deleted_at')
    .whereNotNull('disabled_at');

  const now = Date.now();
  for (const t of candidates) {
    const grace = Number(t.grace_days) || 0;
    const deleteAt = new Date(t.disabled_at).getTime() + grace * DAY_MS;
    if (deleteAt > now) continue;
    try {
      await transferService.deleteTransfer(t.id);
      logger.info(`Transfer ${t.id} deleted after ${grace}-day retention`);
    } catch (err) {
      logger.error('Failed to delete retired transfer', { transferId: t.id, error: err.message });
    }
  }
}

module.exports = {
  stopTransferCleanup,
  startTransferCleanup,
  // exported for tests / manual invocation
  runTransferCleanup,
  expireTransfers,
  deleteRetiredTransfers,
};
