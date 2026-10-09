/** Move the shared project reminder settings out of the retired CRM namespace. */
const RENAMES = [
  ['crm_event_reminders_enabled', 'project_reminders_enabled'],
  ['crm_event_reminders_days_before', 'project_reminders_days_before'],
];

exports.up = async function up(knex) {
  if (await knex.schema.hasTable('app_settings')) {
    for (const [oldKey, newKey] of RENAMES) {
      const oldRow = await knex('app_settings').where({ setting_key: oldKey }).first();
      if (!oldRow) continue;
      const current = await knex('app_settings').where({ setting_key: newKey }).first();
      if (!current) {
        const values = { ...oldRow };
        delete values.id;
        await knex('app_settings').insert({ ...values, setting_key: newKey });
      }
      await knex('app_settings').where({ setting_key: oldKey }).delete();
    }
  }

  if (await knex.schema.hasTable('email_templates')
      && await knex.schema.hasColumn('email_templates', 'feature_flag')) {
    await knex('email_templates')
      .where({ feature_flag: 'crm_event_reminders_enabled' })
      .update({ feature_flag: 'project_reminders_enabled' });
  }
};

exports.down = async function down() {
  // The new names are stable. Rolling back code must not restore a retired
  // namespace or overwrite a newer reminder value.
};
