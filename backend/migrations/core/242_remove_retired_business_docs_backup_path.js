/** Stop treating the retired business-document directory as app backup content. */
exports.up = async function(knex) {
  if (!(await knex.schema.hasTable('backup_paths'))) return;
  await knex('backup_paths').where({ path: 'business-docs' }).del();
};

// A rollback must not re-enable a directory belonging to a retired module.
exports.down = async function() {};
