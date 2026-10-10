const { scheduledTask } = require('./scheduledTask');
const { db } = require('../database/db');
const { archiveEvent } = require('./archiveService');
const logger = require('../utils/logger');
const { formatBoolean, whereTimestamp } = require('../utils/dbCompat');

async function checkExpirations() {
  try {
    const now = new Date();
    const expiredEvents = await db('events')
      .where('is_active', formatBoolean(true))
      .where('is_archived', formatBoolean(false))
      .whereNotNull('expires_at')
      .modify(whereTimestamp, 'expires_at', '<=', now);

    for (const event of expiredEvents) await handleExpiredEvent(event);
  } catch (error) {
    logger.error('Error checking expirations:', error);
  }
}

async function handleExpiredEvent(event) {
  try {
    await db('events').where('id', event.id).update({ is_active: formatBoolean(false) });
    await archiveEvent(event);
    logger.info(`Handled expiration for event ${event.slug}`);
  } catch (error) {
    logger.error(`Error handling expiration for event ${event.slug}:`, error);
  }
}

const task = scheduledTask(checkExpirations, { schedule: '0 * * * *' });
function startExpirationChecker() { task.start(); }
const stopExpirationChecker = () => task.stop();

module.exports = { startExpirationChecker, stopExpirationChecker, checkExpirations };
