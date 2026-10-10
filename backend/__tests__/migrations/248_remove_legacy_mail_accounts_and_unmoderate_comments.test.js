const knexFactory = require('knex');
const migration = require('../../migrations/core/248_remove_legacy_mail_accounts_and_unmoderate_comments');

describe('legacy mailbox and comment moderation cleanup', () => {
  let db;

  beforeEach(async () => {
    db = knexFactory({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await db.schema.createTable('mail_accounts', (table) => {
      table.increments('id').primary();
      table.string('imap_user');
      table.string('imap_pass');
    });
    await db('mail_accounts').insert({ imap_user: 'legacy-user', imap_pass: 'legacy-secret' });
    await db.schema.createTable('events', (table) => {
      table.increments('id').primary();
      table.string('customer_email');
      table.string('host_email');
      table.string('admin_email');
      table.text('welcome_message');
      table.string('customer_name');
    });
    await db.schema.createTable('photo_feedback', (table) => {
      table.increments('id').primary();
      table.integer('photo_id');
      table.string('guest_email');
      table.boolean('is_approved').defaultTo(true);
      table.boolean('is_hidden').defaultTo(false);
    });
    await db('photo_feedback').insert([
      { id: 1, guest_email: 'old@example.com', is_approved: false, is_hidden: false },
      { id: 2, guest_email: 'hidden@example.com', is_approved: false, is_hidden: true },
      { id: 3, guest_email: 'approved@example.com', is_approved: true, is_hidden: false },
    ]);
  });

  afterEach(async () => db.destroy());

  it('drops mailbox credentials and keeps pending comments hidden after removing moderation state', async () => {
    await migration.up(db);

    expect(await db.schema.hasTable('mail_accounts')).toBe(false);
    for (const column of ['customer_email', 'host_email', 'admin_email', 'welcome_message']) {
      // eslint-disable-next-line no-await-in-loop
      expect(await db.schema.hasColumn('events', column)).toBe(false);
    }
    expect(await db.schema.hasColumn('events', 'customer_name')).toBe(true);
    expect(await db.schema.hasColumn('photo_feedback', 'is_approved')).toBe(false);
    expect(await db.schema.hasColumn('photo_feedback', 'guest_email')).toBe(false);
    expect(await db('photo_feedback').select('id', 'is_hidden').orderBy('id')).toEqual([
      { id: 1, is_hidden: 1 },
      { id: 2, is_hidden: 1 },
      { id: 3, is_hidden: 0 },
    ]);
  });
});
