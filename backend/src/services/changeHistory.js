/**
 * Append-only change history for customer records. The legacy table name
 * is retained for existing installations; migration 219 originally created it.
 *
 * Every insert, update and delete of an audited table goes through
 * auditedInsert / auditedUpdate / auditedDelete. Each reads the affected rows,
 * makes the change and writes one history row per changed record with the
 * old and new values, all in one transaction: when the caller passes a
 * transaction a savepoint is used, otherwise one is opened for that write. A failed
 * history insert therefore rolls the change back, unlike logActivity, which
 * is best-effort.
 *
 * Nothing in the application may update or delete history rows, with one
 * exception: erasing a customer blanks personal values in that customer's own
 * history and their name as an actor (redactCustomerHistory). The coverage test
 * pins that customer records are written only through this service.
 */
const { db } = require('../database/db');
const DELETE_REFERENCES = require('./legacyDeleteReferences');

const AUDITED_TABLES = {
  customer_accounts: {
    entity: 'customer',
    document: (row) => ['customer', row.id],
    columns: [
      'salutation', 'first_name', 'last_name', 'display_name', 'company_name', 'email',
      'phone', 'address_line1', 'address_line2', 'postal_code', 'city', 'state',
      'country_code', 'country_name', 'preferred_language', 'notes',
    ],
  },
};

// A change to bookkeeping timestamps alone is not a record change.
const IGNORED_COLUMNS = new Set(['updated_at']);
// Never copy anything shaped like a credential into the history.
const SECRET_COLUMN = /token|secret|password/i;

// SQLite caps bound parameters; keep IN lists well below it.
const CHUNK = 400;

// PostgreSQL returns bigint columns (the *_minor amounts) as strings, SQLite
// as numbers. Record numbers on both, so a history reads the same everywhere.
const bigintColumnsByTable = new Map();
async function bigintColumns(trx, table) {
  if (trx.client.config.client !== 'pg') return new Set();
  if (!bigintColumnsByTable.has(table)) {
    const info = await trx(table).columnInfo();
    bigintColumnsByTable.set(table, new Set(
      Object.entries(info).filter(([, column]) => column.type === 'bigint').map(([name]) => name),
    ));
  }
  return bigintColumnsByTable.get(table);
}

function numericBigints(row, columns) {
  if (!row || columns.size === 0) return row;
  const copy = { ...row };
  for (const column of columns) {
    if (typeof copy[column] === 'string' && Number.isSafeInteger(Number(copy[column]))) {
      copy[column] = Number(copy[column]);
    }
  }
  return copy;
}

function tableConfig(table) {
  const config = AUDITED_TABLES[table];
  if (!config) throw new Error(`changeHistory: ${table} is not an audited table`);
  return config;
}

function recorded(column, config) {
  if (config?.columns && !config.columns.includes(column)) return false;
  return !IGNORED_COLUMNS.has(column) && !SECRET_COLUMN.test(column);
}

function normalizeValue(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Buffer.isBuffer(value)) return '[binary]';
  return value;
}

function sameValue(a, b) {
  return JSON.stringify(normalizeValue(a)) === JSON.stringify(normalizeValue(b));
}

/**
 * { column: { from, to } } for the recorded columns that differ. A created
 * record lists its non-null values, a deleted one what it held.
 */
function diffRows(before, after, config = null) {
  const changes = {};
  const columns = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const column of columns) {
    if (!recorded(column, config)) continue;
    const from = before ? normalizeValue(before[column]) : null;
    const to = after ? normalizeValue(after[column]) : null;
    if (sameValue(from, to)) continue;
    changes[column] = { from, to };
  }
  return changes;
}

/**
 * Actors arrive in every shape the services already use: an admin id, an
 * { type, id, name } object, or strings like 'admin:5', 'customer:public' and
 * 'scheduler'.
 */
function normalizeActor(actor) {
  if (actor === null || actor === undefined) return { type: 'system', id: null, name: null };
  if (typeof actor === 'number' || (typeof actor === 'string' && /^\d+$/.test(actor))) {
    return { type: 'admin', id: Number(actor), name: null };
  }
  if (typeof actor === 'string') {
    const [prefix, rest] = actor.split(':');
    if (['admin', 'customer', 'public'].includes(prefix)) {
      const id = rest && /^\d+$/.test(rest) ? Number(rest) : null;
      return { type: prefix, id, name: id === null && rest ? rest : null };
    }
    return { type: 'system', id: null, name: actor };
  }
  const type = ['admin', 'customer', 'public', 'system'].includes(actor.type) ? actor.type : 'system';
  const id = Number.isSafeInteger(Number(actor.id)) && actor.id !== null && actor.id !== undefined
    ? Number(actor.id) : null;
  return { type, id, name: actor.name ? String(actor.name).slice(0, 255) : null };
}

function inTransaction(conn, work) {
  const executor = conn || db;
  // Knex creates a savepoint when executor is already a transaction. Without
  // it a caller catching a failed history INSERT could commit the preceding
  // business write on SQLite (and could not recover its transaction on PG).
  return executor.transaction(work);
}

function applyWhere(query, where) {
  if (typeof where === 'function') where(query);
  else query.where(where);
  return query;
}

async function selectByIds(trx, table, ids) {
  const rows = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    rows.push(...await trx(table).whereIn('id', ids.slice(i, i + CHUNK)));
  }
  return rows;
}

async function writeHistory(trx, table, action, before, after, context) {
  const config = tableConfig(table);
  const row = after || before;
  const columns = await bigintColumns(trx, table);
  const changes = diffRows(numericBigints(before, columns), numericBigints(after, columns), config);
  if (action === 'updated' && Object.keys(changes).length === 0) return;
  const [documentType, documentId] = config.document(row);
  const actor = normalizeActor(context.actor);
  await trx('accounting_change_history').insert({
    document_type: documentType,
    document_id: Number(documentId),
    entity_type: config.entity,
    entity_id: Number(row.id),
    action,
    changes: JSON.stringify(changes),
    actor_type: actor.type,
    actor_id: actor.id,
    actor_name: actor.name,
    source: context.source ? String(context.source).slice(0, 100) : null,
    created_at: new Date().toISOString(),
  });
}

/**
 * Insert one row or an array of rows. Resolves to [{ id }] in insert order,
 * the shape `.returning('id')` callers already unwrap with `row.id ?? row`.
 */
async function auditedInsert(conn, table, rows, context = {}) {
  tableConfig(table);
  const list = Array.isArray(rows) ? rows : [rows];
  return inTransaction(conn, async (trx) => {
    const ids = [];
    for (const values of list) {
      const [inserted] = await trx(table).insert(values).returning('id');
      const id = Number(inserted?.id ?? inserted);
      ids.push({ id });
      const after = await trx(table).where({ id }).first();
      await writeHistory(trx, table, 'created', null, after, context);
    }
    return ids;
  });
}

/**
 * Update the rows matching `where` (an object or a query callback). Resolves
 * to the number of rows updated, like knex's update, so compare-and-set
 * callers keep working.
 */
async function auditedUpdate(conn, table, where, values, context = {}) {
  tableConfig(table);
  return inTransaction(conn, async (trx) => {
    const lock = applyWhere(trx(table).select('*'), where).orderBy('id');
    // Compatible with the KEY SHARE lock held by foreign-key checks on child
    // inserts. The UPDATE itself still acquires a stronger lock if it changes
    // a referenced key.
    if (trx.client.config.client === 'pg') lock.forNoKeyUpdate();
    const before = await lock;
    if (before.length === 0) return 0;
    const ids = before.map((row) => row.id);
    let count = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      count += await applyWhere(trx(table).whereIn('id', ids.slice(i, i + CHUNK)), where).update(values);
    }
    const after = new Map((await selectByIds(trx, table, ids)).map((row) => [row.id, row]));
    for (const row of before) {
      if (after.has(row.id)) await writeHistory(trx, table, 'updated', row, after.get(row.id), context);
    }
    return count;
  });
}

/** Delete the rows matching `where`. Resolves to the number deleted. */
async function auditedDelete(conn, table, where, context = {}) {
  tableConfig(table);
  return deleteWithHistory(conn, table, where, context);
}

// Also used for parent records (events, admins and categories). Retired module
// rows are adjusted only when needed to honor their legacy foreign keys.
async function deleteWithHistory(conn, table, where, context = {}) {
  if (!AUDITED_TABLES[table] && !DELETE_REFERENCES[table]) tableConfig(table);
  return inTransaction(conn, async (trx) => {
    const lock = applyWhere(trx(table).select('*'), where).orderBy('id');
    if (trx.client.config.client === 'pg') lock.forUpdate();
    const before = await lock;
    if (before.length === 0) return 0;
    let count = 0;
    const ids = before.map((row) => row.id);
    const deletingIds = new Set(ids);
    for (const ref of DELETE_REFERENCES[table] || []) {
      if (!(await trx.schema.hasTable(ref.table)) || !(await trx.schema.hasColumn(ref.table, ref.column))) continue;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const referencedIds = await trx(ref.table).whereIn(ref.column, ids.slice(i, i + CHUNK)).pluck('id');
        // Rows already being deleted have their original values recorded
        // below. Filter in memory to keep every bound IN list bounded.
        const affectedIds = referencedIds.filter((id) => ref.table !== table || !deletingIds.has(id));
        for (let j = 0; j < affectedIds.length; j += CHUNK) {
          const match = (q) => q.whereIn('id', affectedIds.slice(j, j + CHUNK))
            .whereIn(ref.column, ids.slice(i, i + CHUNK));
          if (AUDITED_TABLES[ref.table]) {
            if (ref.action === 'delete') await auditedDelete(trx, ref.table, match, context);
            else await auditedUpdate(trx, ref.table, match, { [ref.column]: null }, context);
          } else {
            // Retired tables can still exist on upgraded installations.
            // Apply only their old FK action so core event/customer deletion
            // remains possible.
            const query = trx(ref.table).whereIn('id', affectedIds.slice(j, j + CHUNK))
              .whereIn(ref.column, ids.slice(i, i + CHUNK));
            if (ref.action === 'delete') await query.delete();
            else await query.update({ [ref.column]: null });
          }
        }
      }
    }
    for (let i = 0; i < ids.length; i += CHUNK) {
      count += await applyWhere(trx(table).whereIn('id', ids.slice(i, i + CHUNK)), where).delete();
    }
    if (AUDITED_TABLES[table]) {
      for (const row of before) await writeHistory(trx, table, 'deleted', row, null, context);
    }
    return count;
  });
}

/** The history of one document, oldest first. */
async function listHistory(documentType, documentId, conn = db) {
  const rows = await conn('accounting_change_history')
    .where({ document_type: documentType, document_id: documentId })
    .orderBy('id', 'asc');
  return rows.map((row) => ({
    id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    action: row.action,
    changes: typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes,
    actor: { type: row.actor_type, id: row.actor_id, name: row.actor_name },
    source: row.source,
    created_at: row.created_at,
  }));
}

const ERASED = '[erased]';
// Personal customer fields. The billing_email and vat_id entries remain
// solely so old history created by removed modules is scrubbed on erasure.
const PERSONAL_CUSTOMER_COLUMNS = new Set([
  'salutation', 'first_name', 'last_name', 'display_name', 'company_name', 'email',
  'billing_email', 'vat_id', 'address_line1', 'address_line2', 'postal_code', 'city',
  'state', 'country_code', 'country_name',
]);

/**
 * Blank the recorded personal values in an erased customer's own history
 * (names, addresses, emails) and their display name as the actor of any entry.
 * Legacy billing fields are scrubbed too. Which fields changed, when and the
 * actor's type/id stay. Run it in the erasure's
 * transaction after the erasure's own update, whose entry holds the values
 * being erased.
 */
async function redactCustomerHistory(trx, customerId) {
  // The customer's own record and every entry they made as the actor.
  const rows = await trx('accounting_change_history')
    .where((q) => q.where({ document_type: 'customer', entity_type: 'customer', document_id: customerId })
      .orWhere({ actor_type: 'customer', actor_id: customerId }));
  for (const row of rows) {
    const ownRecord = row.document_type === 'customer' && row.entity_type === 'customer'
      && Number(row.document_id) === Number(customerId);
    const changes = typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes;
    const redacted = {};
    for (const [column, { from, to }] of Object.entries(changes || {})) {
      redacted[column] = ownRecord && PERSONAL_CUSTOMER_COLUMNS.has(column)
        ? { from: from === null ? null : ERASED, to: to === null ? null : ERASED }
        : { from, to };
    }
    const actorName = row.actor_type === 'customer' && Number(row.actor_id) === Number(customerId)
      && row.actor_name !== null ? ERASED : row.actor_name;
    await trx('accounting_change_history').where({ id: row.id }).update({
      changes: JSON.stringify(redacted), actor_name: actorName,
    });
  }
  return rows.length;
}

module.exports = {
  AUDITED_TABLES,
  redactCustomerHistory,
  auditedInsert,
  auditedUpdate,
  auditedDelete,
  deleteWithHistory,
  listHistory,
  diffRows,
  normalizeActor,
};
