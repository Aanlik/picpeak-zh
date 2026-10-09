/** Boot-time recovery for the shared project reminder email template. */

const { bootTestDb } = require('./helpers/sqliteTestDb');

describe('email template self-heal at boot', () => {
  let db;
  let cleanup;

  beforeAll(async () => {
    ({ db, cleanup } = await bootTestDb());
  }, 120000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it('seeds the project reminder template and recovers matching stuck queue rows', async () => {
    const oldTemplate = await db('email_templates').where({ template_key: 'event_reminder_default' }).first();
    if (oldTemplate) {
      if (await db.schema.hasTable('email_template_translations')) {
        await db('email_template_translations').where({ template_id: oldTemplate.id }).del();
      }
      await db('email_templates').where({ id: oldTemplate.id }).del();
    }

    const queueRowIds = await db('email_queue').insert({
      recipient_email: 'customer@example.com',
      email_type: 'event_reminder_default',
      email_data: JSON.stringify({ event_name: 'Portrait session' }),
      status: 'pending',
      retry_count: 3,
      error_message: "Email template 'event_reminder_default' not found",
      created_at: new Date(),
    }).returning('id');
    const queueRowId = typeof queueRowIds[0] === 'object' ? queueRowIds[0].id : queueRowIds[0];

    const unrelatedIds = await db('email_queue').insert({
      recipient_email: 'someone@example.com',
      email_type: 'some_other_template',
      email_data: JSON.stringify({}),
      status: 'pending',
      retry_count: 3,
      error_message: 'SMTP timeout',
      created_at: new Date(),
    }).returning('id');
    const unrelatedId = typeof unrelatedIds[0] === 'object' ? unrelatedIds[0].id : unrelatedIds[0];

    jest.resetModules();
    const { seedEmailTemplatesAndRecoverQueue } = require('../../src/services/_emailTemplateBoot');
    const result = await seedEmailTemplatesAndRecoverQueue(db, null);

    expect(result.seeded).toContain('event_reminder_default');
    expect(await db('email_templates').where({ template_key: 'event_reminder_default' }).first()).toBeTruthy();
    expect(result.recovered).toBeGreaterThanOrEqual(1);
    const recoveredRow = await db('email_queue').where({ id: queueRowId }).first();
    expect(recoveredRow.retry_count).toBe(0);
    expect(recoveredRow.error_message).toBeNull();
    expect(recoveredRow.status).toBe('pending');

    const unrelatedRow = await db('email_queue').where({ id: unrelatedId }).first();
    expect(unrelatedRow.retry_count).toBe(3);
    expect(unrelatedRow.error_message).toBe('SMTP timeout');
  });
});
