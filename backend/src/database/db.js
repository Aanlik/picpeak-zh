const fs = require('fs');
const path = require('path');
const knex = require('knex');
const knexConfig = require('../../knexfile');
const logger = require('../utils/logger');
const { extractShareToken } = require('../utils/shareLinkUtils');

// Ensure SQLite directory exists when using file-based DB (native installs)
try {
  const isPostgres = knexConfig && knexConfig.client === 'pg';
  if (!isPostgres && knexConfig && knexConfig.connection) {
    const filename = typeof knexConfig.connection === 'object'
      ? knexConfig.connection.filename
      : (typeof knexConfig.connection === 'string' ? knexConfig.connection : null);
    if (filename && typeof filename === 'string') {
      const dir = path.dirname(filename);
      if (dir && dir !== '.') {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
} catch (e) {
  // Non-fatal: log and continue; SQLite will fail later if still missing
  try { logger.warn('SQLite directory ensure failed', { error: e.message }); } catch (_) { /* non-fatal */ }
}

// Create database connection with built-in retry logic.
//
// The underlying knex instance is held in `_db` and reachable through a
// Proxy `db` that forwards every call to the current instance. This
// indirection exists so `reinitPool()` below can swap the live pool
// without breaking the thousands of existing `const { db } = require(...)`
// imports — they capture the Proxy once, and every subsequent
// `db('table')` / `db.schema.hasTable(...)` lookup goes through the
// Proxy to whatever `_db` currently points at.
//
// Used by the restore service after DROP/CREATE DATABASE: the old pool
// is destroyed during the drop (to release PG connections so the DROP
// can succeed), then `reinitPool()` opens a fresh pool against the
// recreated DB. Without this, every query in the process after a
// restore failed with "Unable to acquire a connection" until the
// container was manually restarted — exactly the footgun Ralf hit
// repeatedly on 2026-05-30.
let _db = knex(knexConfig);

const db = new Proxy(function knexCall() {}, {
  // db('tableName') — knex's query builder entry point
  apply(_target, _thisArg, args) {
    return _db(...args);
  },
  // db.schema, db.raw, db.migrate, etc.
  get(_target, prop) {
    const v = _db[prop];
    return typeof v === 'function' ? v.bind(_db) : v;
  },
  // Defensive: future code that does `if ('schema' in db)` works.
  has(_target, prop) { return prop in _db; },
});

/**
 * Tear down the current knex pool and open a fresh one.
 *
 * Idempotent — calling it twice in a row just destroys + recreates
 * twice, no error. Throws if the new pool can't establish a
 * connection (which surfaces a clear error rather than letting the
 * caller proceed with a half-broken pool).
 *
 * Used by restoreService after the DROP/CREATE DATABASE pair.
 */
async function reinitPool() {
  const prev = _db;
  try {
    await prev.destroy();
  } catch (err) {
    logger.warn(`Old pool destroy failed (continuing with reinit): ${err.message}`);
  }
  _db = knex(knexConfig);
  // Probe the new pool with a no-op query so we fail loudly here if
  // the new pool can't connect — better than silently handing the
  // caller a broken pool and surfacing the error on the next admin
  // request.
  try {
    if (knexConfig.client === 'pg') {
      await _db.raw('SELECT 1');
    } else {
      await _db.raw('SELECT 1');
    }
  } catch (probeErr) {
    logger.error('New pool failed health-check after reinit', { error: probeErr.message });
    throw probeErr;
  }
  logger.info('knex pool re-initialized successfully');
}

// Connection retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

// Wrapper function to handle connection retries
async function withRetry(queryFn, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      return await queryFn();
    } catch (error) {
      const isConnectionError = error.message && (
        error.message.includes('Connection terminated unexpectedly') ||
        error.message.includes('Connection ended unexpectedly') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ETIMEDOUT')
      );

      if (isConnectionError && i < retries - 1) {
        logger.info(`Database connection error, retrying in ${RETRY_DELAY}ms... (attempt ${i + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
        continue;
      }
      throw error;
    }
  }
}

async function initializeDatabase() {
  // Events table
  const hasEventsTable = await db.schema.hasTable('events');
  if (!hasEventsTable) {
    await db.schema.createTable('events', (table) => {
      table.increments('id').primary();
      table.string('slug').unique().notNullable();
      table.string('event_type').notNullable();
      table.string('event_name').notNullable();
      table.date('event_date').notNullable();
      table.string('customer_name');
      table.string('customer_email');
      table.string('host_email').notNullable();
      table.string('host_name');
      table.string('admin_email').notNullable();
      table.string('password_hash').notNullable();
      table.text('welcome_message');
      table.text('color_theme');
      table.string('share_link').unique().notNullable();
      table.string('share_token').unique();
      table.datetime('created_at').defaultTo(db.fn.now());
      table.datetime('expires_at').notNullable();
      table.boolean('is_active').defaultTo(true);
      table.boolean('is_archived').defaultTo(false);
      table.string('archive_path');
      table.datetime('archived_at');
      table.boolean('allow_user_uploads').defaultTo(false);
      table.integer('upload_category_id');
      table.boolean('allow_downloads').defaultTo(true);
      table.boolean('disable_right_click').defaultTo(false);
      table.boolean('watermark_downloads').defaultTo(false);
      table.text('watermark_text');
      // events.hero_photo_id → photos.id is a forward reference (the
      // photos table is created later in this same function). Postgres
      // rejects FK declarations that reference a non-existent table at
      // CREATE TABLE time, so the constraint is added below as an
      // ALTER TABLE *after* the photos table exists. SQLite previously
      // tolerated the inline declaration because its FK enforcement is
      // lazy — the inline form silently became a column with no FK
      // metadata. Both backends now go through the same code path.
      // (#484, MrGabri's reproduction.)
      table.integer('hero_photo_id');
      table.boolean('require_password').defaultTo(true);
    });
  }

  const hasShareTokenColumn = await db.schema.hasColumn('events', 'share_token');
  if (!hasShareTokenColumn) {
    await db.schema.table('events', (table) => {
      table.string('share_token').unique();
    });
  }

  const hasHostNameColumn = await db.schema.hasColumn('events', 'host_name');
  if (!hasHostNameColumn) {
    await db.schema.table('events', (table) => {
      table.string('host_name');
    });
  }

  try {
    const eventsWithoutToken = await db('events')
      .whereNull('share_token')
      .select('id', 'share_link');

    for (const event of eventsWithoutToken) {
      const token = extractShareToken(event.share_link);
      if (token) {
        await db('events')
          .where({ id: event.id })
          .update({ share_token: token });
      }
    }
  } catch (error) {
    logger.warn('Share token backfill skipped', { error: error.message });
  }

  // Photo metadata table
  const hasPhotosTable = await db.schema.hasTable('photos');
  if (!hasPhotosTable) {
    await db.schema.createTable('photos', (table) => {
      table.increments('id').primary();
      table.integer('event_id').references('id').inTable('events').onDelete('CASCADE');
      table.string('filename').notNullable();
      table.string('path').notNullable();
      table.string('thumbnail_path');
      table.string('type').notNullable(); // 'collage' or 'individual'
      table.integer('size_bytes');
      table.string('uploaded_by').defaultTo('admin');
      table.datetime('uploaded_at').defaultTo(db.fn.now());
      table.integer('view_count').defaultTo(0);
      table.integer('download_count').defaultTo(0);
    });

    // Deferred FK: events.hero_photo_id → photos.id. See the comment
    // on the events createTable above for why this can't be inline.
    // Wrapped in try/catch so a re-run path or an SQLite install that
    // already accepted the inline (no-op) declaration doesn't fail
    // boot when the constraint already exists in some shape.
    try {
      await db.schema.alterTable('events', (table) => {
        table.foreign('hero_photo_id')
          .references('id').inTable('photos')
          .onDelete('SET NULL');
      });
    } catch (err) {
      const msg = err?.message || '';
      if (!/already exists|duplicate|exists/i.test(msg)) {
        throw err;
      }
      // Constraint already in place — fine, carry on.
    }
  }

  // Access logs table
  const hasAccessLogsTable = await db.schema.hasTable('access_logs');
  if (!hasAccessLogsTable) {
    await db.schema.createTable('access_logs', (table) => {
      table.increments('id').primary();
      table.integer('event_id').references('id').inTable('events');
      table.string('ip_address');
      table.text('user_agent'); // in-app browser UAs exceed 255 (#1501)
      table.string('action'); // 'view', 'download', 'login_success', 'login_fail'
      table.string('photo_id');
      table.datetime('timestamp').defaultTo(db.fn.now());
    });
  }

  // Admin users table
  const hasAdminUsersTable = await db.schema.hasTable('admin_users');
  if (!hasAdminUsersTable) {
    await db.schema.createTable('admin_users', (table) => {
      table.increments('id').primary();
      table.string('username').unique().notNullable();
      table.string('email').unique().notNullable();
      table.string('password_hash').notNullable();
      table.boolean('is_active').defaultTo(true);
      table.boolean('must_change_password').defaultTo(false);
      table.datetime('password_changed_at');
      table.datetime('created_at').defaultTo(db.fn.now());
      table.datetime('updated_at').defaultTo(db.fn.now());
      table.datetime('last_login');
      table.string('last_login_ip');
      table.string('language', 2).defaultTo('en');
    });
  } else {
    // Check if updated_at column exists
    const hasUpdatedAt = await db.schema.hasColumn('admin_users', 'updated_at');
    if (!hasUpdatedAt) {
      await db.schema.table('admin_users', (table) => {
        table.datetime('updated_at');
      });
      // Set default value for existing rows
      await db('admin_users').update({ updated_at: new Date() });
    }

    // Check if must_change_password column exists
    const hasMustChangePassword = await db.schema.hasColumn('admin_users', 'must_change_password');
    if (!hasMustChangePassword) {
      await db.schema.table('admin_users', (table) => {
        table.boolean('must_change_password').defaultTo(false);
      });
    }

    // Check if password_changed_at column exists
    const hasPasswordChangedAt = await db.schema.hasColumn('admin_users', 'password_changed_at');
    if (!hasPasswordChangedAt) {
      await db.schema.table('admin_users', (table) => {
        table.datetime('password_changed_at');
      });
    }

    // Check if last_login_ip column exists
    const hasLastLoginIp = await db.schema.hasColumn('admin_users', 'last_login_ip');
    if (!hasLastLoginIp) {
      await db.schema.table('admin_users', (table) => {
        table.string('last_login_ip');
      });
    }

    const hasLanguage = await db.schema.hasColumn('admin_users', 'language');
    if (!hasLanguage) {
      await db.schema.table('admin_users', (table) => {
        table.string('language', 2).defaultTo('en');
      });
    }
  }

  // Token revocation tables
  const hasRevokedTokensTable = await db.schema.hasTable('revoked_tokens');
  if (!hasRevokedTokensTable) {
    await db.schema.createTable('revoked_tokens', (table) => {
      table.increments('id').primary();
      table.string('token_id').notNullable().unique(); // JWT ID or generated ID
      table.integer('user_id').nullable(); // User who owned the token
      table.string('token_type', 20); // admin, gallery, etc.
      table.timestamp('revoked_at').defaultTo(db.fn.now());
      table.timestamp('expires_at').nullable(); // NULL retains tokens without a known expiry
      table.string('reason', 100); // password_change, logout, compromised, etc.
      table.text('metadata'); // Additional JSON data

      // Indexes for performance
      table.index('token_id');
      table.index('user_id');
      table.index('expires_at'); // For cleanup
    });
  }

  const hasUserTokenRevocationsTable = await db.schema.hasTable('user_token_revocations');
  if (!hasUserTokenRevocationsTable) {
    await db.schema.createTable('user_token_revocations', (table) => {
      table.integer('user_id').primary();
      table.timestamp('revoked_at').notNullable();
      table.string('reason', 100);

      // Index for quick lookups
      table.index('revoked_at');
    });
  }

  // App settings table
  const hasAppSettingsTable = await db.schema.hasTable('app_settings');
  if (!hasAppSettingsTable) {
    await db.schema.createTable('app_settings', (table) => {
      table.increments('id').primary();
      table.string('setting_key').unique().notNullable();
      table.json('setting_value');
      table.string('setting_type'); // 'branding', 'theme', 'general'
      table.datetime('updated_at').defaultTo(db.fn.now());
    });
  }

  const defaultLanguageSetting = await db('app_settings')
    .where('setting_key', 'default_language')
    .first();
  if (!defaultLanguageSetting) {
    await db('app_settings').insert({
      setting_key: 'default_language',
      setting_value: JSON.stringify('en'),
      setting_type: 'general',
      updated_at: new Date(),
    });
  }

  // Activity logs table
  const hasActivityLogsTable = await db.schema.hasTable('activity_logs');
  if (!hasActivityLogsTable) {
    await db.schema.createTable('activity_logs', (table) => {
      table.increments('id').primary();
      table.string('activity_type').notNullable(); // 'event_created', 'photos_uploaded', etc.
      table.string('actor_type'); // 'admin', 'system', 'guest'
      table.integer('actor_id');
      table.string('actor_name');
      table.json('metadata'); // Additional data about the activity
      table.integer('event_id').references('id').inTable('events');
      table.datetime('created_at').defaultTo(db.fn.now());
      table.datetime('read_at').nullable();
    });
  } else {
    // Check if read_at column exists
    const hasReadAt = await db.schema.hasColumn('activity_logs', 'read_at');
    if (!hasReadAt) {
      await db.schema.table('activity_logs', (table) => {
        table.datetime('read_at').nullable();
      });
    }
  }

  await ensureGlobalCategories();
}

// Ensure photo categories exist for new deployments
async function ensureGlobalCategories() {
  const hasPhotoCategoriesTable = await db.schema.hasTable('photo_categories');
  if (!hasPhotoCategoriesTable) {
    await db.schema.createTable('photo_categories', (table) => {
      table.increments('id').primary();
      table.string('name', 100).notNullable();
      table.string('slug', 100).notNullable();
      table.boolean('is_global').defaultTo(true);
      table.integer('event_id').references('id').inTable('events').onDelete('CASCADE');
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.unique(['slug', 'event_id']);
    });
  }

  const hasCategoryIdColumn = await db.schema.hasColumn('photos', 'category_id');
  if (!hasCategoryIdColumn) {
    await db.schema.alterTable('photos', (table) => {
      table.integer('category_id').references('id').inTable('photo_categories');
    });
  }

  const hasCmsPagesTable = await db.schema.hasTable('cms_pages');
  if (!hasCmsPagesTable) {
    await db.schema.createTable('cms_pages', (table) => {
      table.increments('id').primary();
      table.string('slug', 100).unique().notNullable();
      table.text('title_en');
      table.text('title_zh');
      table.text('content_en');
      table.text('content_zh');
      table.string('logo_url').nullable();
      table.boolean('use_external_url').notNullable().defaultTo(false);
      table.string('external_url').nullable();
      table.timestamp('updated_at').defaultTo(db.fn.now());
    });
  } else {
    if (!(await db.schema.hasColumn('cms_pages', 'logo_url'))) {
      // Online migration for existing deployments — see issue #324, per-page
      // logo override for admin-customisable error pages.
      await db.schema.alterTable('cms_pages', (table) => {
        table.string('logo_url').nullable();
      });
    }
    if (!(await db.schema.hasColumn('cms_pages', 'use_external_url'))) {
      // Per-page toggle to redirect visitors to an external imprint /
      // privacy-policy URL instead of rendering the internal CMS content.
      await db.schema.alterTable('cms_pages', (table) => {
        table.boolean('use_external_url').notNullable().defaultTo(false);
      });
    }
    if (!(await db.schema.hasColumn('cms_pages', 'external_url'))) {
      await db.schema.alterTable('cms_pages', (table) => {
        table.string('external_url').nullable();
      });
    }
  }

  const categoryCountRow = await db('photo_categories').count({ count: 'id' }).first();
  const categoryCount = categoryCountRow ? Number(categoryCountRow.count) : 0;
  if (categoryCount === 0) {
    const defaultCategories = [
      { name: 'Ceremony', slug: 'ceremony', is_global: true },
      { name: 'Reception', slug: 'reception', is_global: true },
      { name: 'Portraits', slug: 'portraits', is_global: true },
      { name: 'Group Photos', slug: 'group-photos', is_global: true },
      { name: 'Details', slug: 'details', is_global: true },
      { name: 'Party', slug: 'party', is_global: true },
    ];

    await db('photo_categories').insert(defaultCategories);
  }

  const cmsPages = await db('cms_pages').select('slug');
  const existingSlugs = cmsPages.map((page) => page.slug);
  const defaultPages = [
    {
      slug: 'impressum',
      title_en: 'Legal Notice',
      title_zh: '法律声明',
      content_en: '<h2>Legal Notice</h2><p>Please edit this content in the admin panel.</p>',
      content_zh: '<h2>法律声明</h2><p>请在管理后台编辑此内容。</p>',
      updated_at: new Date(),
    },
    {
      slug: 'datenschutz',
      title_en: 'Privacy Policy',
      title_zh: '隐私政策',
      content_en: '<h2>Privacy Policy</h2><p>Please edit this content in the admin panel.</p>',
      content_zh: '<h2>隐私政策</h2><p>请在管理后台编辑此内容。</p>',
      updated_at: new Date(),
    },
    // Customisable error pages — issue #324. Generic copy by default;
    // admins can edit text + logo per page in the CMS Pages tab.
    {
      slug: 'not-found',
      title_en: 'Page Not Found',
      title_zh: '页面不存在',
      content_en: '<h2>Page Not Found</h2><p>The page you are looking for does not exist or has been moved.</p>',
      content_zh: '<h2>页面不存在</h2><p>你访问的页面不存在或已移动。</p>',
      updated_at: new Date(),
    },
    {
      slug: 'gallery-not-found',
      title_en: 'Gallery Not Found',
      title_zh: '选片项目不存在',
      content_en: '<h2>Gallery Not Found</h2><p>This gallery could not be found. The link may be incorrect, or the gallery may have expired or been archived. Please contact the organiser if you believe this is a mistake.</p>',
      content_zh: '<h2>选片项目不存在</h2><p>未找到此选片项目。链接可能有误，或项目已过期、归档。请联系摄影师确认。</p>',
      updated_at: new Date(),
    },
  ];

  for (const page of defaultPages) {
    if (!existingSlugs.includes(page.slug)) {
      await db('cms_pages').insert(page);
    }
  }
}

// Helper function to log activities
async function logActivity(activityType, metadata = {}, eventId = null, actor = null, executor = null) {
  try {
    // Callers issuing the log from inside a knex transaction must pass that
    // trx as `executor`, otherwise the global-`db` insert tries to grab a
    // second connection from the single-connection SQLite pool while the
    // trx still holds it → deadlock. Defaults to the global db for the
    // common after-commit / outside-trx callers.
    const conn = executor || db;
    // actor_id is integer-typed; some legacy callers pass a hex-string
    // identifier (e.g. a 16-char guest fingerprint) which makes Postgres
    // throw "invalid input syntax for type integer" and drop the entire
    // log entry. Coerce anything non-integer to null and surface the
    // string in actor_name so we don't lose the audit trail. Customer/
    // admin actors are unaffected — their ids are already numeric.
    const rawId = actor?.id;
    const actorIdInt = Number.isInteger(rawId) ? rawId
      : (typeof rawId === 'string' && /^\d+$/.test(rawId) ? Number(rawId) : null);
    const actorName = actor?.name
      || (actorIdInt === null && rawId !== undefined && rawId !== null ? String(rawId) : null);

    const insert = (executor) => executor('activity_logs').insert({
      activity_type: activityType,
      actor_type: actor?.type || 'system',
      actor_id: actorIdInt,
      actor_name: actorName,
      metadata: JSON.stringify(metadata),
      event_id: eventId
    });
    // Inside a caller's transaction, insert under a savepoint. A failed
    // statement aborts a whole PostgreSQL transaction, so the catch below
    // would otherwise hide an error that still rolls back the caller's work
    // at commit, while SQLite commits it without the audit row. Rolling back
    // to the savepoint makes both engines keep the caller's work.
    await (conn.isTransaction ? conn.transaction(insert) : insert(conn));
  } catch (error) {
    logger.error('Failed to log activity:', { error: error.message });
  }
}

module.exports = { db, initializeDatabase, logActivity, withRetry, reinitPool };
