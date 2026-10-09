/**
 * Remove role-catalog entries for retired sales, finance, WhatsApp, and
 * shoot-type administration features. This only removes permission records
 * and their grants; customer, project, photo, and historical migration data
 * remain untouched.
 */
const RETIRED_PERMISSIONS = [
  'quotes.view', 'quotes.manage',
  'bills.view', 'bills.manage',
  'contracts.view', 'contracts.manage',
  'accounting.view', 'accounting.manage',
  'vat_codes.view',
  'whatsapp.view', 'whatsapp.manage',
  'event_types.view', 'event_types.manage',
];

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('permissions'))) return;
  const rows = await knex('permissions').whereIn('name', RETIRED_PERMISSIONS).select('id');
  if (!rows.length) return;
  const ids = rows.map(({ id }) => id);
  if (await knex.schema.hasTable('role_permissions')) {
    await knex('role_permissions').whereIn('permission_id', ids).del();
  }
  await knex('permissions').whereIn('id', ids).del();
};

exports.down = async function down() {
  // Retired features are not restored by rolling back this data cleanup.
};
