/**
 * Boot-time seed for built-in workflows.
 *
 * Seeds photography lifecycle reminders as editable built-in flows.
 *
 * Every built-in is disabled by default. The existing reminder service keeps
 * working until an administrator deliberately enables a workflow.
 *
 * Idempotent: keyed on builtin_key. Once seeded, admin edits are preserved (we
 * never overwrite an enabled built-in, and re-seed a disabled one only when its
 * SEED_VERSION moves on). Self-heal pattern per [[feedback_self_heal_pattern]].
 */
const { getAppSetting } = require('../utils/appSettings');

// Pre-event reminder — fired by the scheduler at event_date − daysBefore (see
// emitDueEventReminders). The notify_pre_event action DELEGATES to
// eventReminderService.sendReminderForEvent, so the email is byte-identical to
// the legacy pass (shared template, per-project override, sent_at idempotency).
// This is the live replacement for that pass (mutual-exclusion guard there).
function buildPreEventEmailGraph() {
  const nodes = [
    { node_key: 't', type: 'trigger', config: {}, pos_x: 240, pos_y: 0 },
    { node_key: 'notify', type: 'action', config: { action: 'notify_pre_event' }, pos_x: 240, pos_y: 110 },
    { node_key: 'done', type: 'action', config: { action: 'noop' }, pos_x: 240, pos_y: 220 },
  ];
  const edges = [
    { from_node: 't', to_node: 'notify' },
    { from_node: 'notify', to_node: 'done' },
  ];
  return { nodes, edges };
}

// Gallery expiring — fired by the expiration checker `daysBefore` expiry. The
// notify_gallery_expiring action delegates to the checker's queueExpirationWarning
// so the warning email is identical. Live replacement for the legacy warning
// email (mutual-exclusion guard in the checker).
function buildGalleryExpiringGraph() {
  const nodes = [
    { node_key: 't', type: 'trigger', config: {}, pos_x: 240, pos_y: 0 },
    { node_key: 'notify', type: 'action', config: { action: 'notify_gallery_expiring' }, pos_x: 240, pos_y: 110 },
    { node_key: 'done', type: 'action', config: { action: 'noop' }, pos_x: 240, pos_y: 220 },
  ];
  const edges = [
    { from_node: 't', to_node: 'notify' },
    { from_node: 'notify', to_node: 'done' },
  ];
  return { nodes, edges };
}

// Gallery expired — fired when a gallery passes its expiry. The
// notify_gallery_expired action delegates to the checker's sendGalleryExpiredEmails.
// Live replacement for the legacy expired email (mutual-exclusion guard in the checker).
function buildGalleryExpiredGraph() {
  const nodes = [
    { node_key: 't', type: 'trigger', config: {}, pos_x: 240, pos_y: 0 },
    { node_key: 'notify', type: 'action', config: { action: 'notify_gallery_expired' }, pos_x: 240, pos_y: 110 },
    { node_key: 'done', type: 'action', config: { action: 'noop' }, pos_x: 240, pos_y: 220 },
  ];
  const edges = [
    { from_node: 't', to_node: 'notify' },
    { from_node: 'notify', to_node: 'done' },
  ];
  return { nodes, edges };
}

// Built-in registry. `version` is the seed version; admin-owned edits remain
// untouched.
const BUILTINS = [
  {
    key: 'gallery_expiring',
    version: 2,
    enabled: false,
    name: 'Gallery expiring (built-in)',
    trigger_type: 'gallery.expiring',
    trigger_config: {},
    description: 'Email the customer when a gallery is approaching its expiry date.',
    build: async () => buildGalleryExpiringGraph(),
  },
  {
    key: 'gallery_expired',
    version: 2,
    enabled: false,
    name: 'Gallery expired (built-in)',
    trigger_type: 'gallery.expired',
    trigger_config: {},
    description: 'Notify the customer when a gallery expires.',
    build: async () => buildGalleryExpiredGraph(),
  },
  {
    key: 'pre_event_email',
    version: 4,
    enabled: false,
    name: 'Pre-event reminder (built-in)',
    trigger_type: 'event.date_approaching',
    trigger_config: async () => {
      const d = Number(await getAppSetting('project_reminders_days_before'));
      return { daysBefore: Number.isFinite(d) && d >= 0 ? d : 2 };
    },
    description: 'Send the customer a reminder before the project date.',
    build: async () => buildPreEventEmailGraph(),
  },
];

// Seed-once-per-process guard. Re-seeding is idempotent (seedOneBuiltin
// updates in place, keyed on builtin_key, and skips admin-owned or
// already-current rows), so the cost of a repeat call is a table scan per
// builtin plus a graph rebuild — wasted work, not duplicate rows. Set inside
// the try, so a seed that never got off the ground (workflows table not
// migrated yet, DB down) leaves the flag clear and a later call can retry.
let booted = false;

function parseSeedConfig(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
}

async function writeGraph(trx, workflowId, version, nodes, edges) {
  for (const n of nodes) {
    await trx('workflow_nodes').insert({
      workflow_id: workflowId, version, node_key: n.node_key, type: n.type,
      config: JSON.stringify(n.config || {}), pos_x: n.pos_x || 0, pos_y: n.pos_y || 0,
    });
  }
  for (const e of edges) {
    await trx('workflow_edges').insert({
      workflow_id: workflowId, version, from_node: e.from_node, from_handle: e.from_handle || null,
      to_node: e.to_node, label: e.label || null, loop_back: !!e.loop_back,
    });
  }
}

async function seedOneBuiltin(db, logger, def) {
  const { nodes, edges } = await def.build();
  const baseCfg = typeof def.trigger_config === 'function'
    ? (await def.trigger_config()) || {}
    : (def.trigger_config || {});
  const triggerConfig = { ...baseCfg, seedVersion: def.version };
  const defEnabled = def.enabled === true;

  const existing = await db('workflows').where({ builtin_key: def.key }).first();

  if (existing) {
    // Never touch a built-in the admin has taken ownership of (enabled/disabled
    // or edited it) — admin_toggled_at is the sentinel (migration 148). For a
    // never-touched copy, re-seed on a SEED_VERSION bump and (re-)apply the seed
    // default `enabled`, so a shipped default flip (e.g. enabled→disabled for
    // first beta) propagates to installs the admin hasn't customised.
    const storedVersion = Number(parseSeedConfig(existing.trigger_config).seedVersion) || 0;
    const adminOwned = !!existing.admin_toggled_at;
    if (adminOwned || storedVersion >= def.version) return;

    const newVersion = (existing.version || 1) + 1;
    await db.transaction(async (trx) => {
      await trx('workflows').where({ id: existing.id }).update({
        name: def.name,
        description: def.description,
        trigger_type: def.trigger_type,
        trigger_config: JSON.stringify(triggerConfig),
        enabled: defEnabled,
        version: newVersion,
        updated_at: trx.fn.now(),
      });
      await writeGraph(trx, existing.id, newVersion, nodes, edges);
    });
    logger?.info?.(`Re-seeded built-in workflow: ${def.key} (v${def.version}, enabled=${defEnabled})`);
    return;
  }

  await db.transaction(async (trx) => {
    const ins = await trx('workflows').insert({
      name: def.name,
      description: def.description,
      enabled: defEnabled,
      version: 1,
      trigger_type: def.trigger_type,
      trigger_config: JSON.stringify(triggerConfig),
      is_builtin: true,
      builtin_key: def.key,
    }).returning('id');
    // Postgres returns [] without `.returning`, so ins[0] would be undefined and
    // the child node inserts would roll back on NOT NULL. Normalise the {id}
    // (pg) vs bare-id (sqlite) shapes.
    const workflowId = ins[0]?.id ?? ins[0];
    await writeGraph(trx, workflowId, 1, nodes, edges);
  });
  logger?.info?.(`Seeded built-in workflow: ${def.key} (enabled=${defEnabled})`);
}

async function seedBuiltinWorkflowsAtBoot(db, logger) {
  if (booted) return;
  try {
    if (!(await db.schema.hasTable('workflows'))) return;
    for (const def of BUILTINS) {
      try {
        await seedOneBuiltin(db, logger, def);
      } catch (err) {
        logger?.warn?.(`Built-in workflow seed failed for ${def.key}:`, err.message);
      }
    }
    booted = true;
  } catch (err) {
    logger?.warn?.('Built-in workflow seed failed at boot:', err.message);
  }
}

// Test-only: reset the module-level boot flag so jest can re-exercise the
// seeder against a fresh test DB inside a single worker. Matches
// _backupPathsBoot / _restoreSettingsBoot.
function _resetBootForTests() {
  booted = false;
}

module.exports = { seedBuiltinWorkflowsAtBoot, BUILTINS, _resetBootForTests };
