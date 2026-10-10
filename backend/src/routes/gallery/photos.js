const express = require('express');
const { db, logActivity } = require('../../database/db');
const router = express.Router();
const { verifyGalleryAccess } = require('../../middleware/gallery');
const { resolveGuest } = require('../../middleware/guestAuth');
const { noStoreCache } = require('../../middleware/noStoreCache');
const { generateGuestIdentifier } = require('../../middleware/feedbackRateLimit');
const { errorResponse } = require('../../utils/routeHelpers');
const { guestBlockedByReveal } = require('../../utils/revealMode');
const downloadZipService = require('../../services/downloadZipService');
const GALLERY_OPENED_DEBOUNCE_MS = 6 * 60 * 60 * 1000;
const galleryOpenedNotifiedAt = new Map();
function galleryActor(req) {
  const isCustomer = !!(req && req.accessLevel === 'client');
  return { type: isCustomer ? 'customer' : 'guest' };
}
function notifyGalleryOpened(event, req) {
  const now = Date.now();
  const last = galleryOpenedNotifiedAt.get(event.id) || 0;
  if (now - last < GALLERY_OPENED_DEBOUNCE_MS) return;
  galleryOpenedNotifiedAt.set(event.id, now);
  // Fire-and-forget — logActivity swallows its own errors.
  logActivity('gallery_opened', {}, event.id, galleryActor(req));
}

router.get('/:slug/photos', verifyGalleryAccess, resolveGuest, noStoreCache, async (req, res) => {
  try {
    const guestIdentifier = await generateGuestIdentifier(req);
    const payload = await require('../../services/galleryQueryService').getGalleryPhotos({
      event: req.event, slug: req.params.slug, query: req.query,
      identity: { guestId: req.guest?.id, guestIdentifier },
      accessLevel: req.accessLevel, adminPreview: req.isAdminPreview,
      hiddenForGuest: guestBlockedByReveal(req),
    });
    // Notify the photographer about a real gallery visit. This is an
    // operational notification, not visitor analytics.
    if (req.accessLevel !== 'slideshow' && !req.isAdminPreview && !(Number(req.query.page) > 1)) {
      notifyGalleryOpened(req.event, req);
    }

    res.json(payload);
  } catch (error) { errorResponse(res, error, 500, 'Failed to fetch photos'); }
});

/**
 * People in this gallery (#1074).
 *
 * Returns [] rather than 403 whenever the feature is unavailable — a guest
 * must not be able to tell "this gallery has no people" from "this gallery
 * has the feature switched off". Same reasoning as reveal mode returning an
 * empty photo set rather than an error.
 *
 * Counts and cover faces are computed against the caller's own visibility
 * scope inside facePeopleService; nothing here reads face_count_total.
 */
// no-store for the same reason as /photos: the people list and its scan
// progress are scoped to what THIS viewer may see.
router.get('/:slug/people', verifyGalleryAccess, resolveGuest, noStoreCache, async (req, res) => {
  try {
    const isClient = req.accessLevel === 'client';
    const { isEnabledForEvent, areFacesVisibleToGuests, getThresholds } =
      require('../../services/faceSettings');

    if (!(await isEnabledForEvent(req.event))) {
      return res.json({ people: [] });
    }
    if (!isClient && !areFacesVisibleToGuests(req.event)) {
      return res.json({ people: [] });
    }
    // While a gallery is hidden behind reveal mode (#838), a plain guest sees
    // no photos — so they see no people either.
    if (guestBlockedByReveal(req)) {
      return res.json({ people: [] });
    }

    const { listPeople, getScanStatus } = require('../../services/facePeopleService');
    const thresholds = await getThresholds();

    const people = await listPeople(req.event.id, {
      isClient,
      forAdmin: false,
      minClusterSize: thresholds.face_min_cluster_size,
    });

    // Drives the "Finding people… 240/1200" progress line during a backfill.
    // Scoped to what this viewer may see — an unscoped total would leak the
    // number of hidden photos through the progress bar.
    const status = await getScanStatus(req.event.id, { isClient });

    res.json({
      people,
      scan: {
        in_progress: status.in_progress,
        scanned: status.scanned,
        total: status.total,
      },
    });
  } catch (error) {
    errorResponse(res, error, 500, 'Failed to fetch people');
  }
});

// Toggle photo visibility (client-only)
router.patch('/:slug/photos/:photoId/visibility', verifyGalleryAccess, async (req, res) => {
  try {
    if (req.accessLevel !== 'client') {
      return res.status(403).json({ error: 'Client access required' });
    }

    const { photoId } = req.params;
    const { visibility } = req.body;

    if (!['visible', 'hidden'].includes(visibility)) {
      return res.status(400).json({ error: 'Invalid visibility value' });
    }

    const photo = await db('photos')
      .where({ id: photoId, event_id: req.event.id })
      .first();

    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    await db('photos')
      .where({ id: photoId, event_id: req.event.id })
      .update({ visibility });

    // A client hiding/showing a photo changes the guest download bundle —
    // drop the cached ZIP so it rebuilds fresh (codex review).
    downloadZipService.invalidate(req.event.id);

    res.json({ message: 'Photo visibility updated', visibility });
  } catch (error) {
    errorResponse(res, error, 500, 'Failed to update photo visibility');
  }
});

// Bulk toggle photo visibility (client-only)
router.patch('/:slug/photos/visibility/bulk', verifyGalleryAccess, async (req, res) => {
  try {
    if (req.accessLevel !== 'client') {
      return res.status(403).json({ error: 'Client access required' });
    }

    const { photoIds, visibility } = req.body;

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({ error: 'Invalid photo IDs' });
    }

    if (!['visible', 'hidden'].includes(visibility)) {
      return res.status(400).json({ error: 'Invalid visibility value' });
    }

    const count = await db('photos')
      .whereIn('id', photoIds)
      .where('event_id', req.event.id)
      .update({ visibility });

    // Client bulk hide/show alters the guest download bundle — invalidate
    // the cached ZIP (codex review).
    downloadZipService.invalidate(req.event.id);

    res.json({ message: `${count} photos updated`, visibility });
  } catch (error) {
    errorResponse(res, error, 500, 'Failed to update photo visibility');
  }
});

// Download single photo

module.exports = router;
