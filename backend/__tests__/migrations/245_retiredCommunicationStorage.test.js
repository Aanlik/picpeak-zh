const knexFactory = require('knex');
const migration = require('../../migrations/core/245_remove_retired_communication_storage');

describe('retired communication storage cleanup', () => {
  let db;

  beforeEach(async () => {
    db = knexFactory({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
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
      await db.schema.createTable(table, (t) => t.increments('id').primary());
    }
    await db.schema.createTable('feature_flags', (t) => {
      t.string('key').primary();
      t.boolean('value');
    });
    await db('feature_flags').insert([
      { key: 'incomingMail', value: true },
      { key: 'photoWorkflow', value: true },
    ]);
    await db.schema.createTable('app_settings', (t) => {
      t.string('setting_key').primary();
      t.text('setting_value');
    });
    await db('app_settings').insert([
      { setting_key: 'email_smtp_host', setting_value: 'smtp.invalid' },
      { setting_key: 'database_backup_email_on_failure', setting_value: 'true' },
      { setting_key: 'notification_popup_enabled', setting_value: 'true' },
    ]);
  });

  afterEach(async () => db.destroy());

  it('removes retired mail storage and settings while preserving unrelated notifications', async () => {
    await migration.up(db);

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
      expect(await db.schema.hasTable(table)).toBe(false);
    }
    expect(await db('feature_flags').select('key')).toEqual([{ key: 'photoWorkflow' }]);
    expect((await db('app_settings').select('setting_key')).map((row) => row.setting_key))
      .toEqual(['notification_popup_enabled']);
  });
});
