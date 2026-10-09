/** Structured customer requests for retouch revisions and additional edits. */
exports.up = async function (knex) {
  if (await knex.schema.hasTable('photo_retouch_requests')) return;
  await knex.schema.createTable('photo_retouch_requests', (table) => {
    table.increments('id').primary();
    table.integer('event_id').notNullable().references('id').inTable('events').onDelete('CASCADE');
    table.integer('photo_id').notNullable().references('id').inTable('photos').onDelete('CASCADE');
    table.integer('guest_id').nullable().references('id').inTable('gallery_guests').onDelete('SET NULL');
    table.string('guest_identifier', 64).notNullable();
    table.string('request_type', 16).notNullable(); // revision | additional
    table.integer('base_version').nullable();
    table.text('customer_message').notNullable();
    table.string('status', 24).notNullable().defaultTo('open');
    table.text('photographer_reply').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.index(['event_id', 'status'], 'photo_retouch_requests_event_status_idx');
    table.index(['photo_id', 'created_at'], 'photo_retouch_requests_photo_created_idx');
    table.index(['event_id', 'guest_identifier'], 'photo_retouch_requests_guest_idx');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('photo_retouch_requests');
};
