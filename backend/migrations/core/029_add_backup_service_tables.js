const { db } = require('../../src/database/db');

async function up() {
  console.log('Adding backup service tables and settings...');

  // Create backup_runs table to track backup history
  const hasBackupRunsTable = await db.schema.hasTable('backup_runs');
  if (!hasBackupRunsTable) {
    await db.schema.createTable('backup_runs', (table) => {
      table.increments('id').primary();
      table.datetime('started_at').notNullable();
      table.datetime('completed_at');
      table.string('status').defaultTo('running'); // running, completed, failed
      table.string('backup_type'); // full, incremental
      table.integer('files_backed_up').defaultTo(0);
      table.bigInteger('total_size_bytes').defaultTo(0);
      table.integer('duration_seconds');
      table.text('error_message');
      table.json('statistics'); // Detailed stats about the backup
      table.json('file_checksums'); // Store checksums for change detection
    });
  }

  // Create backup_file_states table to track individual file states
  const hasBackupFileStatesTable = await db.schema.hasTable('backup_file_states');
  if (!hasBackupFileStatesTable) {
    await db.schema.createTable('backup_file_states', (table) => {
      table.increments('id').primary();
      table.string('file_path').notNullable();
      table.string('checksum').notNullable();
      table.bigInteger('size_bytes');
      table.datetime('last_modified');
      table.datetime('last_backed_up');
      table.boolean('is_archived').defaultTo(false);
      table.index(['file_path'], 'idx_backup_file_path');
      table.index(['checksum'], 'idx_backup_checksum');
    });
  }

  // Add backup-related settings to app_settings
  const backupSettings = [
    {
      setting_key: 'backup_enabled',
      setting_value: JSON.stringify(false),
      setting_type: 'backup'
    },
    {
      setting_key: 'backup_schedule',
      setting_value: JSON.stringify('0 2 * * *'), // Default: 2 AM daily
      setting_type: 'backup'
    },
    {
      setting_key: 'backup_destination_type',
      setting_value: JSON.stringify('local'), // local, rsync, s3
      setting_type: 'backup'
    },
    {
      setting_key: 'backup_destination_path',
      setting_value: JSON.stringify('/backup/picpeak'),
      setting_type: 'backup'
    },
    {
      setting_key: 'backup_rsync_host',
      setting_value: JSON.stringify(''),
      setting_type: 'backup'
    },
    {
      setting_key: 'backup_rsync_user',
      setting_value: JSON.stringify(''),
      setting_type: 'backup'
    },
    {
      setting_key: 'backup_rsync_path',
      setting_value: JSON.stringify(''),
      setting_type: 'backup'
    },
    {
      setting_key: 'backup_rsync_ssh_key',
      setting_value: JSON.stringify(''),
      setting_type: 'backup'
    },
    {
      setting_key: 'backup_s3_endpoint',
      setting_value: JSON.stringify(''),
      setting_type: 'backup'
    },
    {
      setting_key: 'backup_s3_bucket',
      setting_value: JSON.stringify(''),
      setting_type: 'backup'
    },
    {
      setting_key: 'backup_s3_access_key',
      setting_value: JSON.stringify(''),
      setting_type: 'backup'
    },
    {
      setting_key: 'backup_s3_secret_key',
      setting_value: JSON.stringify(''),
      setting_type: 'backup'
    },
    {
      setting_key: 'backup_s3_region',
      setting_value: JSON.stringify('us-east-1'),
      setting_type: 'backup'
    },
    {
      setting_key: 'backup_retention_days',
      setting_value: JSON.stringify(30),
      setting_type: 'backup'
    },
    {
      setting_key: 'backup_include_archived',
      setting_value: JSON.stringify(true),
      setting_type: 'backup'
    },
    {
      setting_key: 'backup_compression',
      setting_value: JSON.stringify(true),
      setting_type: 'backup'
    },
    {
      setting_key: 'backup_max_file_size_mb',
      setting_value: JSON.stringify(5000), // Skip files larger than 5GB
      setting_type: 'backup'
    },
    {
      setting_key: 'backup_exclude_patterns',
      setting_value: JSON.stringify(['*.tmp', '.DS_Store', 'Thumbs.db']),
      setting_type: 'backup'
    }
  ];

  // Insert backup settings if they don't exist
  for (const setting of backupSettings) {
    const exists = await db('app_settings')
      .where('setting_key', setting.setting_key)
      .first();

    if (!exists) {
      await db('app_settings').insert(setting);
    }
  }

  console.log('Backup service tables and settings added successfully');
}

async function down() {
  // Remove backup tables
  await db.schema.dropTableIfExists('backup_file_states');
  await db.schema.dropTableIfExists('backup_runs');

  // Remove backup settings
  await db('app_settings')
    .where('setting_type', 'backup')
    .delete();


}

module.exports = { up, down };
