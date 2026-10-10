'use strict';

/**
 * Remove credentials left by the retired secondary-mailbox feature and keep
 * comments that were awaiting moderation private after the moderation field is
 * removed. Explicitly hidden feedback remains hidden.
 */
exports.up = async function up(knex) {
  await knex.schema.dropTableIfExists('mail_accounts');

  if (await knex.schema.hasTable('events')) {
    const retiredEventColumns = [];
    for (const column of ['customer_email', 'host_email', 'admin_email', 'welcome_message']) {
      // eslint-disable-next-line no-await-in-loop
      if (await knex.schema.hasColumn('events', column)) retiredEventColumns.push(column);
    }
    if (retiredEventColumns.length) {
      await knex.schema.alterTable('events', (table) => {
        for (const column of retiredEventColumns) table.dropColumn(column);
      });
    }
  }

  if (await knex.schema.hasTable('photo_feedback')) {
    if (await knex.schema.hasColumn('photo_feedback', 'guest_email')) {
      await knex.schema.alterTable('photo_feedback', (table) => table.dropColumn('guest_email'));
    }

    const hasApproved = await knex.schema.hasColumn('photo_feedback', 'is_approved');
    if (hasApproved) {
      // Pending comments have not been reviewed for public display. Preserve
      // that safety decision through the existing hidden flag before dropping
      // the moderation state; approved feedback and explicit hidden rows stay
      // unchanged.
      if (await knex.schema.hasColumn('photo_feedback', 'is_hidden')) {
        await knex('photo_feedback').where('is_approved', false).update({ is_hidden: true });
      }
      await knex.schema.alterTable('photo_feedback', (table) => table.dropColumn('is_approved'));
    }
  }
};

exports.down = async function down() {
  // Retired credentials and historical moderation decisions are not restored.
};
