/**
 * Seed the remaining customer and gallery reminder templates at startup.
 * Removed document types are intentionally not seeded; only current customer and gallery messages are restored.
 */

const { ensureEventReminderTemplatesSeeded } = require('./eventReminderTemplates');

async function seedEmailTemplatesAndRecoverQueue(db, logger) {
  const log = logger || { info: () => {}, warn: () => {} };
  let seeded = [];

  try {
    const inserted = await ensureEventReminderTemplatesSeeded(db, log);
    if (Array.isArray(inserted)) seeded = inserted;
  } catch (err) {
    log.warn(`Event reminder template seed failed: ${err.message}`);
  }

  let recovered = 0;
  if (seeded.length && await db.schema.hasTable('email_queue')) {
    try {
      recovered = await db('email_queue')
        .where('status', 'pending')
        .where('retry_count', '>=', 3)
        .whereIn('email_type', seeded)
        .update({ retry_count: 0, error_message: null });
      if (recovered > 0) {
        log.info(`Recovered ${recovered} queued gallery reminder(s) after seeding templates`);
      }
    } catch (err) {
      log.warn(`Email queue recovery skipped: ${err.message}`);
    }
  }

  return { seeded, recovered };
}

module.exports = { seedEmailTemplatesAndRecoverQueue };
