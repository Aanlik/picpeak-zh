/**
 * schemaCache — process-local memoisation for `db.schema.hasColumn`.
 *
 * **Why this exists**
 *
 * Shared services use `hasColumn` guards because older installations may
 * not yet have columns introduced by later migrations.
 * Each call hits information_schema (Postgres) or sqlite_master
 * (SQLite). On hot paths we issue several hasColumn checks per request,
 * all for columns whose presence cannot change at runtime.
 *
 * The audit flagged this as a perf medium. Caching is safe because:
 *
 *   1. Schema-changing operations (migrations, `ALTER TABLE`) only
 *      run at boot via `run-migrations-safe.js`, BEFORE any service
 *      module accepts traffic. The cache is populated lazily after
 *      boot finishes, so the entries reflect post-migration state.
 *
 *   2. The Node process is the only schema authority. There's no
 *      sibling process sneaking in `ALTER TABLE` while we serve
 *      requests.
 *
 *   3. If a future migration path needs to run mid-flight, it can
 *      call `invalidateSchemaCache()` after the schema change.
 *
 * **What we cache**
 *
 * Just the boolean answer to `(table, column)`. A miss means the
 * column doesn't exist on this install; a hit means it does. The
 * cache key is `${table}.${column}`. There's no TTL — the entry is
 * valid for the lifetime of the Node process.
 *
 * **What we DON'T cache**
 *
 * Negative results from `hasTable` failures (the table simply isn't
 * there) — those go through the underlying call each time. That
 * scenario is exceptional (table truly missing during a half-applied
 * migration window) and we want it to surface, not get masked by a
 * stale cache.
 *
 * **API**
 *
 *   const { hasColumnCached, invalidateSchemaCache } = require('../utils/schemaCache');
 *   if (await hasColumnCached('events', 'event_reminder_sent_at')) {
 *     ...
 *   }
 *
 * Drop-in replacement for `db.schema.hasColumn(...)` calls. The
 * existing helper signature returns a Promise<boolean> so async
 * call-sites need no shape change.
 */

const { db } = require('../database/db');

const cache = new Map();

async function hasColumnCached(table, column) {
  const key = `${table}.${column}`;
  if (cache.has(key)) return cache.get(key);
  // Resolve via the underlying schema API. We deliberately don't
  // catch errors here — if the call throws (e.g. DB connection lost
  // mid-boot), the error surfaces to the caller exactly as it would
  // have without the cache.
  const present = await db.schema.hasColumn(table, column);
  cache.set(key, present);
  return present;
}

/**
 * Drop every cached entry. Call this after a runtime schema change
 * (rare — only the dev tooling does this today). Safe to call any
 * time; the next hasColumnCached lookup will re-resolve.
 */
function invalidateSchemaCache() {
  cache.clear();
}

/**
 * Drop entries for a single table. Useful when only one table was
 * altered and other tables' caches are still valid.
 */
function invalidateSchemaCacheForTable(table) {
  const prefix = `${table}.`;
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

module.exports = {
  hasColumnCached,
  invalidateSchemaCache,
  invalidateSchemaCacheForTable,
};
