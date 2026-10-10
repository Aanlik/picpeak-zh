const knexFactory = require('knex');
const migration = require('../../migrations/core/247_remove_retired_feature_storage');

describe('retired feature storage cleanup', () => {
  let db;

  beforeEach(async () => {
    db = knexFactory({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    for (const name of [
      'workflow_approvals', 'workflow_run_steps', 'workflow_runs', 'workflow_edges', 'workflow_nodes', 'workflows',
      'webhook_deliveries', 'webhooks', 'whatsapp_queue', 'whatsapp_configs',
      'feedback_word_filters', 'product_usage_markers', 'product_usage_state',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await db.schema.createTable(name, (table) => table.increments('id').primary());
    }
    await db.schema.createTable('event_feedback_settings', (table) => {
      table.increments('id').primary();
      table.boolean('allow_comments');
      table.boolean('moderate_comments');
      table.boolean('require_moderation');
    });
    await db.schema.createTable('admin_users', (table) => {
      table.increments('id').primary();
      table.string('username');
      table.boolean('two_factor_enabled');
      table.string('two_factor_secret');
      table.text('two_factor_recovery_codes');
      table.timestamp('two_factor_enrolled_at');
      table.integer('two_factor_last_used_step');
    });
    await db.schema.createTable('feature_flags', (table) => {
      table.string('key').primary();
      table.boolean('value');
    });
    await db('feature_flags').insert([
      { key: 'analytics', value: true },
      { key: 'workflows', value: true },
      { key: 'photoWorkflow', value: true },
    ]);
    await db.schema.createTable('app_settings', (table) => {
      table.string('setting_key').primary();
      table.text('setting_value');
    });
    await db('app_settings').insert([
      { setting_key: 'enable_recaptcha', setting_value: 'true' },
      { setting_key: 'analytics_tracker_id', setting_value: 'secret' },
      { setting_key: 'whatsapp_access_token', setting_value: 'secret' },
      { setting_key: 'notification_popup_enabled', setting_value: 'true' },
    ]);
    await db.schema.createTable('permissions', (table) => {
      table.increments('id').primary();
      table.string('name');
    });
    await db.schema.createTable('role_permissions', (table) => {
      table.increments('id').primary();
      table.integer('permission_id');
    });
    await db('permissions').insert([
      { id: 1, name: 'analytics.view' },
      { id: 2, name: 'workflows.manage' },
      { id: 3, name: 'photos.view' },
      { id: 4, name: 'webhooks.manage' },
    ]);
    await db('role_permissions').insert([
      { permission_id: 1 }, { permission_id: 2 }, { permission_id: 3 }, { permission_id: 4 },
    ]);
  });

  afterEach(async () => db.destroy());

  it('drops retired module storage and keeps selection, popup, and photography workflow state', async () => {
    await migration.up(db);

    for (const name of [
      'workflow_approvals', 'workflow_run_steps', 'workflow_runs', 'workflow_edges', 'workflow_nodes', 'workflows',
      'webhook_deliveries', 'webhooks', 'whatsapp_queue', 'whatsapp_configs',
      'feedback_word_filters', 'product_usage_markers', 'product_usage_state',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      expect(await db.schema.hasTable(name)).toBe(false);
    }
    for (const name of ['moderate_comments', 'require_moderation']) {
      // eslint-disable-next-line no-await-in-loop
      expect(await db.schema.hasColumn('event_feedback_settings', name)).toBe(false);
    }
    for (const name of ['two_factor_enabled', 'two_factor_secret', 'two_factor_recovery_codes', 'two_factor_enrolled_at', 'two_factor_last_used_step']) {
      // eslint-disable-next-line no-await-in-loop
      expect(await db.schema.hasColumn('admin_users', name)).toBe(false);
    }
    expect(await db.schema.hasColumn('event_feedback_settings', 'allow_comments')).toBe(true);
    expect(await db('feature_flags').select('key')).toEqual([{ key: 'photoWorkflow' }]);
    expect((await db('app_settings').select('setting_key')).map((row) => row.setting_key))
      .toEqual(['notification_popup_enabled']);
    expect((await db('permissions').select('name')).map((row) => row.name)).toEqual(['photos.view']);
    expect((await db('role_permissions').select('permission_id')).map((row) => row.permission_id)).toEqual([3]);
  });
});
