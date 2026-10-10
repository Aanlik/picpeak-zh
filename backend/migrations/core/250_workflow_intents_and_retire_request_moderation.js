'use strict';
exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('workflow_stage_intents'))) {
    await knex.schema.createTable('workflow_stage_intents', (t) => {
      t.integer('event_id').primary().references('id').inTable('events').onDelete('CASCADE');
      t.string('operation_id', 36).notNullable();
      t.string('stage', 16).notNullable();
      t.text('error');
    });
  }
  if (!(await knex.schema.hasTable('workflow_withdrawal_intents'))) {
    await knex.schema.createTable('workflow_withdrawal_intents', (t) => {
      t.string('operation_id', 36).primary();
      t.integer('event_id').notNullable().references('id').inTable('events').onDelete('CASCADE');
      t.integer('photo_id').notNullable().unique().references('id').inTable('photos').onDelete('CASCADE');
      t.boolean('delete_delivered').notNullable();
      t.text('error');
    });
  }
  if (await knex.schema.hasTable('photo_retouch_requests')) {
    await knex('photo_retouch_requests').where('status', 'moderation').update({ status: 'open' });
  }
};
exports.down = async () => {};
