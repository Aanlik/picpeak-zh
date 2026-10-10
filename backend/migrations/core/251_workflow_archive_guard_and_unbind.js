'use strict';
exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('events', 'is_archiving'))) {
    await knex.schema.alterTable('events', t => t.boolean('is_archiving').notNullable().defaultTo(false));
  }
  if (!(await knex.schema.hasTable('workflow_unbind_intents'))) {
    // No FK: this intent must survive deletion of its project.
    await knex.schema.createTable('workflow_unbind_intents', t => {
      t.integer('event_id').primary();
      t.text('error');
    });
  }
  const pg = String(knex.client.config.client).includes('pg');
  if (pg) {
    await knex.raw(`CREATE OR REPLACE FUNCTION block_archiving_photo_write() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM events WHERE id = COALESCE(NEW.event_id, OLD.event_id) AND is_archiving = TRUE) THEN
          RAISE EXCEPTION 'Project archive in progress';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
      END; $$ LANGUAGE plpgsql`);
    await knex.raw('DROP TRIGGER IF EXISTS photo_archive_guard ON photos');
    await knex.raw('CREATE TRIGGER photo_archive_guard BEFORE INSERT OR UPDATE OR DELETE ON photos FOR EACH ROW EXECUTE FUNCTION block_archiving_photo_write()');
  } else {
    for (const [op, row] of [['INSERT', 'NEW'], ['UPDATE', 'NEW'], ['DELETE', 'OLD']]) {
      await knex.raw(`CREATE TRIGGER IF NOT EXISTS photo_archive_guard_${op.toLowerCase()} BEFORE ${op} ON photos
        WHEN EXISTS (SELECT 1 FROM events WHERE id = ${row}.event_id AND is_archiving = 1)
        BEGIN SELECT RAISE(ABORT, 'Project archive in progress'); END`);
    }
  }
};
exports.down = async () => {};
