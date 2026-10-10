'use strict';

// Per-photo views/downloads were reporting-only counters. Gallery photo totals,
// selection state and delivery state remain available through the workflow.
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('photos'))) return;
  const retired = ['view_count', 'download_count'];
  const columns = [];
  for (const name of retired) {
    if (await knex.schema.hasColumn('photos', name)) columns.push(name);
  }
  if (columns.length) {
    await knex.schema.alterTable('photos', (table) => {
      for (const name of columns) table.dropColumn(name);
    });
  }
};

// These are derived reporting counters and are intentionally not recreated.
exports.down = async function down() {};
