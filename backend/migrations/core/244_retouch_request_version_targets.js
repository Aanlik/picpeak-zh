/** Keep the version folder chosen for each accepted edit request. */
exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('photo_retouch_requests'))) return;
  if (!(await knex.schema.hasColumn('photo_retouch_requests', 'target_version'))) {
    await knex.schema.alterTable('photo_retouch_requests', (table) => {
      table.integer('target_version').nullable();
    });
  }
  if (!(await knex.schema.hasColumn('photo_retouch_requests', 'delivery_folder'))) {
    await knex.schema.alterTable('photo_retouch_requests', (table) => {
      table.text('delivery_folder').nullable();
    });
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('photo_retouch_requests'))) return;
  await knex.schema.alterTable('photo_retouch_requests', (table) => {
    table.dropColumn('target_version');
    table.dropColumn('delivery_folder');
  });
};
