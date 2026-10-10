/**
 * Remove retired email delivery, inbox, and campaign storage.
 *
 * Migrations before this one are retained as upgrade history for existing
 * PicPeak installations. Migration 001 creates the old schema only as a
 * temporary bridge so that history can execute on a clean install; none of
 * these tables are part of the running application after this cleanup.
 */
exports.up = async function up(knex) {
  for (const table of [
    'email_template_translations',
    'email_campaign_recipients',
    'email_campaigns',
    'received_emails',
    'email_queue',
    'email_configs',
    'email_templates',
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await knex.schema.dropTableIfExists(table);
  }

  if (await knex.schema.hasTable('feature_flags')) {
    await knex('feature_flags').whereIn('key', ['incomingMail', 'emailTemplates']).del();
  }

  if (await knex.schema.hasTable('app_settings')) {
    await knex('app_settings')
      .where((query) => query
        .where('setting_key', 'like', 'email_%')
        .orWhere('setting_key', 'like', 'mail_%')
        .orWhere('setting_key', 'like', 'backup_email_%')
        .orWhere('setting_key', 'like', 'database_backup_email_%')
        .orWhere('setting_key', 'like', 'update_notification_%'))
      .del();
  }
};

exports.down = async function down() {
  // Retired communication data is intentionally not recreated on rollback.
};
