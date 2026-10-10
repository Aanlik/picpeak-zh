/**
 * Feature flags admin endpoints (#feature-flags-settings-reorg).
 *
 * GET  /api/admin/feature-flags  → { [key]: boolean }
 * PUT  /api/admin/feature-flags  → body { [key]: boolean }, replaces in tx
 *
 * Galleries is always enabled because it is the core product surface.
 *
 * Audit log: every successful PUT writes one activity_logs row with the
 * before/after diff so changes are traceable.
 */

const express = require('express');
const router = express.Router();
const { db, logActivity } = require('../database/db');
const { adminAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { invalidateFeatureFlagCache } = require('../middleware/requireFeatureFlag');
const logger = require('../utils/logger');

// Canonical flag list. Keep in sync with the `FeatureKey` union in
// frontend/src/services/featureFlags.service.ts.
const KNOWN_FLAGS = [
  'galleries',
  'userManagement',
  // Live Slideshow ("Diashow") — the per-event fullscreen kiosk link and
  // global watermark defaults tab. Strictly opt-in;
  // gates all slideshow admin UI (per-event card, type preset, settings tab).
  'slideshow',
  // PicTransfer (migration 170) — cross-event file transfers
  // (recipient download link + optional client-upload channel). Strictly
  // opt-in; gates the sidebar entry, the /admin/transfers area AND every
  // transfer route (admin + public token routes).
  'transfers',
  // Face recognition — "People in this gallery" (migration 177, #1074).
  // Requires the optional picpeak-ml sidecar container. THIS FLAG IS THE
  // GATE for the whole feature: FACE_ML_URL has a working default (the
  // compose service name), so the variable's presence proves nothing and
  // cannot be used to detect intent. While this is off the backend never
  // contacts the sidecar, the face queue idles, no face UI renders anywhere
  // and no face_status is ever written.
  //
  // Face embeddings are biometric data (GDPR Art. 9). Turning this on is only
  // the first of two deliberate actions — detection still has to be enabled
  // per event. Strictly opt-in.
  'faces',
];

// Spec defaults for any flag missing from the DB (e.g. a row added by a
// new release that hasn't run its migration yet on this instance).
const DEFAULT_FLAGS = {
  galleries: true,
  userManagement: true,
  slideshow: false,
  transfers: false,
  // #1074 — off by default is the whole "zero behaviour change" guarantee.
  faces: false,
};

async function readAllFlags() {
  const rows = await db('feature_flags').select('key', 'value');
  const result = { ...DEFAULT_FLAGS };
  for (const row of rows) {
    if (KNOWN_FLAGS.includes(row.key)) {
      result[row.key] = Boolean(row.value);
    }
  }
  return result;
}

function applyDependencyRules(flags) {
  const out = { ...flags };
  // Galleries is the foundation — never off.
  out.galleries = true;
  // Face recognition is unavailable on the all-in-one single-container image
  // (#1042 / PR #1068) for performance reasons — see
  // faceSettings.isSingleContainerImage. Forced false in BOTH directions:
  // GET reports it off so the UI can show it as unavailable rather than a
  // switch that silently does nothing, and PUT cannot turn it on. The backend
  // gate refuses independently, so this is presentation plus defence in
  // depth, not the enforcement itself.
  const { isSingleContainerImage } = require('../services/faceSettings');
  if (isSingleContainerImage()) out.faces = false;
  return out;
}

router.get('/', adminAuth, requirePermission(['settings.view', 'settings.features']), async (req, res) => {
  try {
    const flags = await readAllFlags();
    // Always run the rules so hard invariants (galleries always on and face
    // recognition unavailable in the single-container image) hold even if a
    // stored flag is stale or missing.
    res.json(applyDependencyRules(flags));
  } catch (error) {
    logger.error('Failed to read feature flags', { error: error.message });
    res.status(500).json({ error: 'Failed to read feature flags' });
  }
});

router.put('/', adminAuth, requirePermission('settings.features'), async (req, res) => {
  try {
    const body = req.body || {};
    if (typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Body must be an object of { key: boolean } pairs' });
    }

    // Validate keys + types up front.
    const cleaned = {};
    for (const [key, value] of Object.entries(body)) {
      if (!KNOWN_FLAGS.includes(key)) {
        return res.status(400).json({ error: `Unknown feature flag: ${key}` });
      }
      if (typeof value !== 'boolean') {
        return res.status(400).json({ error: `Flag ${key} must be boolean, got ${typeof value}` });
      }
      cleaned[key] = value;
    }

    const before = await readAllFlags();
    const merged = applyDependencyRules({ ...before, ...cleaned });

    // Compute diff for audit log.
    const changed = {};
    for (const key of KNOWN_FLAGS) {
      if (merged[key] !== before[key]) {
        changed[key] = { from: before[key], to: merged[key] };
      }
    }

    if (Object.keys(changed).length === 0) {
      // No-op write — return current state, skip audit log.
      return res.json(merged);
    }

    const adminId = req.admin?.id || null;
    const adminUsername = req.admin?.username || 'unknown';

    await db.transaction(async (trx) => {
      for (const key of KNOWN_FLAGS) {
        const value = merged[key];
        const existing = await trx('feature_flags').where({ key }).first();
        if (existing) {
          await trx('feature_flags')
            .where({ key })
            .update({ value, updated_at: trx.fn.now(), updated_by: adminId });
        } else {
          await trx('feature_flags').insert({ key, value, updated_by: adminId });
        }
      }
    });

    // Drop the requireFeatureFlag middleware's short-TTL cache so a toggle takes
    // effect immediately instead of after ≤10s.
    invalidateFeatureFlagCache();

    await logActivity(
      'feature_flags_updated',
      { changed, actor: adminUsername },
      null,
      { type: 'admin' }
    );

    res.json(merged);
  } catch (error) {
    logger.error('Failed to update feature flags', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to update feature flags' });
  }
});

module.exports = router;
