const bcrypt = require('bcrypt');
const { initializeDatabase } = require('../../src/database/db');
const { generateReadablePassword } = require('../../src/utils/passwordGenerator');
const fs = require('fs').promises;
const path = require('path');

exports.up = async function(knex) {
  console.log('Initializing database schema...');

  try {
    // Initialize tables
    await initializeDatabase();

    // The historical migration chain contains old communication migrations
    // which still expect these tables while upgrading from the upstream
    // schema. Keep their starting schema available only during migrations;
    // the retired-module cleanup migration removes it before the app starts.
    if (!(await knex.schema.hasTable('email_queue'))) {
      await knex.schema.createTable('email_queue', (table) => {
        table.increments('id').primary();
        table.integer('event_id').references('id').inTable('events');
        table.string('recipient_email').notNullable();
        table.string('email_type').notNullable();
        table.json('email_data');
        table.string('status').defaultTo('pending');
        table.datetime('created_at').defaultTo(knex.fn.now());
        table.datetime('scheduled_at').defaultTo(knex.fn.now());
        table.datetime('sent_at');
        table.text('error_message');
        table.integer('retry_count').defaultTo(0);
      });
    }
    if (!(await knex.schema.hasTable('email_configs'))) {
      await knex.schema.createTable('email_configs', (table) => {
        table.increments('id').primary();
        table.string('smtp_host').notNullable();
        table.integer('smtp_port').notNullable();
        table.boolean('smtp_secure').defaultTo(false);
        table.string('smtp_user');
        table.string('smtp_pass');
        table.string('from_email').notNullable();
        table.string('from_name');
        table.datetime('updated_at').defaultTo(knex.fn.now());
      });
    }
    if (!(await knex.schema.hasTable('email_templates'))) {
      await knex.schema.createTable('email_templates', (table) => {
        table.increments('id').primary();
        table.string('template_key').unique().notNullable();
        table.string('subject').notNullable();
        table.text('body_html').notNullable();
        table.text('body_text');
        table.json('variables');
        table.datetime('updated_at').defaultTo(knex.fn.now());
      });
    }

    // Create default admin user if none exists.
    //
    // Legacy path — only when ADMIN_PASSWORD is explicitly provided (keeps
    // existing docker-compose installs working unchanged). When it is NOT set,
    // we deliberately leave admin_users empty so the first-run setup wizard
    // (setupService / /setup) creates the admin in-browser — no ADMIN_PASSWORD
    // in .env. Existing deployments already ran this migration, so this only
    // affects fresh installs.
    const adminExists = await knex('admin_users').first();
    if (!adminExists && process.env.ADMIN_PASSWORD) {
      // Use ADMIN_PASSWORD from environment if set, otherwise generate a random one
      const generatedPassword = process.env.ADMIN_PASSWORD || generateReadablePassword();
      const passwordHash = await bcrypt.hash(generatedPassword, 12); // Increased rounds for better security

      // Get admin credentials from environment or use defaults
      const adminUsername = process.env.ADMIN_USERNAME || 'admin';
      // The email column is retained by legacy schemas but is not an account
      // identifier or a delivery address in this build.
      const adminEmail = `${adminUsername}@local.invalid`;

      await knex('admin_users').insert({
        username: adminUsername,
        email: adminEmail,
        password_hash: passwordHash,
        must_change_password: true,
        created_at: new Date()
      });

      // Try to save credentials to file, but don't fail if we can't
      const dataDir = path.join(__dirname, '..', '..', 'data');
      const setupInfoPath = path.join(dataDir, 'ADMIN_CREDENTIALS.txt');

      // Detect a pending install-from-backup trigger. If one exists,
      // these credentials are about to be obsoleted by the restore —
      // the backup's admin row replaces this fresh-install one a few
      // seconds from now. We still write the file (in case the
      // restore fails and the fresh admin is the only way in) but
      // annotate the top so admins reading the file after restore
      // don't waste time trying credentials that no longer exist.
      // Flagged on PR #596 review.
      const fsSync = require('fs');
      const backupRoot = process.env.BACKUP_ROOT || '/backup';
      const triggerWillFire = fsSync.existsSync(path.join(backupRoot, 'RESTORE_ON_INSTALL'))
        || fsSync.existsSync(path.join(backupRoot, 'RESTORE_ON_INSTALL.txt'));
      const restoreNotice = triggerWillFire ? `

⚠️  RESTORE_ON_INSTALL TRIGGER DETECTED ⚠️
These credentials are temporary. An install-from-backup run is queued
to fire on the next server start, which will REPLACE this admin row
with the one from the backup. After the restore completes, log in
with your ORIGINAL pre-disaster credentials — not the ones below.
If the restore fails for some reason, the credentials below remain
valid as a fallback recovery path.
` : '';

      const setupInfo = `
========================================
PicPeak Administrator Credentials
========================================${restoreNotice}

Your admin account has been created with these credentials:

Username: ${adminUsername}
Password: ${generatedPassword}

IMPORTANT SECURITY NOTES:
1. Please change this password after first login
2. This file will be created only once
3. Store these credentials securely
4. Delete this file after noting the password

Login URL: ${process.env.ADMIN_URL || 'http://localhost:3001'}/admin

Log in with the username shown above

Generated on: ${new Date().toISOString()}
========================================
`;

      try {
        // Try to create directory and write file
        await fs.mkdir(dataDir, { recursive: true });
        // Owner-only: the file holds the admin password. writeFile's mode only
        // applies when it creates the file, so tighten an existing one too.
        await fs.writeFile(setupInfoPath, setupInfo, { encoding: 'utf8', mode: 0o600 });
        await fs.chmod(setupInfoPath, 0o600);
        console.log(`📁 Credentials also saved to: data/ADMIN_CREDENTIALS.txt`);
      } catch (error) {
        // If we can't write the file, that's okay - the password is the
        // ADMIN_PASSWORD the operator set, which is never logged.
        console.log('⚠️  Could not save credentials to file (permission denied)');
        console.log('   Log in with the ADMIN_PASSWORD from your environment');
      }

      console.log('\n========================================');
      console.log('✅ Admin user created successfully!');
      console.log('========================================');
      console.log(`Username: ${adminUsername}`);
      // Never log the password: container logs are often collected and kept.
      console.log('Password: the ADMIN_PASSWORD from your environment');
      console.log('\n⚠️  IMPORTANT:');
      console.log('1. Save these credentials securely');
      console.log('2. Please change the password after first login');
      console.log('========================================\n');
    }

    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Initial setup failed:', error);
    throw error;
  }
};

exports.down = async function(knex) {
  // This migration cannot be rolled back as it creates the initial schema
  console.log('Initial setup cannot be rolled back');
};
