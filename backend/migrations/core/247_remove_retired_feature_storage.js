'use strict';

/**
 * Purge persistent storage for removed upstream modules. Earlier migrations
 * remain as upgrade history; this migration leaves the live schema with no
 * comment moderation, legacy workflow engine, MFA, webhooks, or usage-report
 * state. Photography Bridge data and workflow counters are stored elsewhere.
 */
exports.up = async function up(knex) {
  for (const table of [
    'workflow_approvals',
    'workflow_run_steps',
    'workflow_runs',
    'workflow_edges',
    'workflow_nodes',
    'workflows',
    'webhook_deliveries',
    'webhooks',
    'whatsapp_queue',
    'whatsapp_configs',
    'feedback_word_filters',
    'product_usage_markers',
    'product_usage_state',
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await knex.schema.dropTableIfExists(table);
  }

  const feedbackColumns = [];
  if (await knex.schema.hasTable('event_feedback_settings')) {
    for (const column of ['moderate_comments', 'require_moderation']) {
      // eslint-disable-next-line no-await-in-loop
      if (await knex.schema.hasColumn('event_feedback_settings', column)) feedbackColumns.push(column);
    }
    if (feedbackColumns.length) {
      await knex.schema.alterTable('event_feedback_settings', (table) => {
        for (const column of feedbackColumns) table.dropColumn(column);
      });
    }
  }

  const mfaColumns = [];
  if (await knex.schema.hasTable('admin_users')) {
    for (const column of [
      'two_factor_enabled',
      'two_factor_secret',
      'two_factor_recovery_codes',
      'two_factor_enrolled_at',
      'two_factor_last_used_step',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      if (await knex.schema.hasColumn('admin_users', column)) mfaColumns.push(column);
    }
    if (mfaColumns.length) {
      await knex.schema.alterTable('admin_users', (table) => {
        for (const column of mfaColumns) table.dropColumn(column);
      });
    }
  }

  if (await knex.schema.hasTable('feature_flags')) {
    await knex('feature_flags').whereIn('key', [
      'incomingMail', 'emailTemplates', 'reminderEmails', 'analytics',
      'customerPortal', 'messaging', 'workflows',
    ]).del();
  }

  if (await knex.schema.hasTable('app_settings')) {
    await knex('app_settings')
      .where((query) => query
        .whereIn('setting_key', ['enable_analytics', 'enable_recaptcha'])
        .orWhere('setting_key', 'like', 'analytics_%')
        .orWhere('setting_key', 'like', 'recaptcha_%')
        .orWhere('setting_key', 'like', 'security_recaptcha_%')
        .orWhere('setting_key', 'like', 'webhook_%')
        .orWhere('setting_key', 'like', 'product_usage_%')
        .orWhere('setting_key', 'like', 'whatsapp_%')
        .orWhere('setting_key', 'like', 'update_notification_%'))
      .del();
  }

  if (await knex.schema.hasTable('permissions')) {
    const retired = await knex('permissions')
      .whereIn('name', [
        'analytics.view',
        'email.view', 'email.edit', 'email.send',
        'webhooks.manage',
        'workflows.manage',
      ])
      .select('id');
    if (retired.length && await knex.schema.hasTable('role_permissions')) {
      await knex('role_permissions').whereIn('permission_id', retired.map((row) => row.id)).del();
    }
    if (retired.length) {
      await knex('permissions').whereIn('id', retired.map((row) => row.id)).del();
    }
  }
};

exports.down = async function down() {
  // Retired module state and MFA enrollment data are intentionally not restored.
};
