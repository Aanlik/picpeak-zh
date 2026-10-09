const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const { verifyGalleryAccess, denySlideshowToken } = require('../middleware/gallery');
const { resolveGuest } = require('../middleware/guestAuth');
const { blockHiddenGallery, guestBlockedByReveal } = require('../utils/revealMode');
const { feedbackRateLimit, generateGuestIdentifier } = require('../middleware/feedbackRateLimit');
const { noStoreCache } = require('../middleware/noStoreCache');
const { sanitizeComment } = require('../utils/feedbackValidation');
const feedbackService = require('../services/feedbackService');
const feedbackModeration = require('../services/feedbackModeration');
const { getPublicPhotoStates } = require('../services/photographyWorkflowBridge');
const { isPhotoHiddenFromViewer } = require('../utils/photoVisibility');

function customerStatus(photo) {
  if (photo.delivered) return 'delivered';
  if (photo.selected && photo.ready_for_editing) return 'editing';
  if (photo.selected) return 'selected';
  return 'proof';
}

router.get('/:slug/retouch-workflow', verifyGalleryAccess, resolveGuest, blockHiddenGallery, noStoreCache, async (req, res) => {
  try {
    const [workflow, guestIdentifier] = await Promise.all([
      getPublicPhotoStates(req.event.id),
      generateGuestIdentifier(req),
    ]);
    const visiblePhotos = await db('photos').where({ event_id: req.event.id }).select('id', 'visibility');
    const visibleIds = new Set(visiblePhotos
      .filter((photo) => !isPhotoHiddenFromViewer(photo, req.accessLevel))
      .map((photo) => Number(photo.id)));
    const rawPhotos = workflow.status === 200 && Array.isArray(workflow.data.photos) ? workflow.data.photos : [];
    const photos = rawPhotos
      .filter((photo) => visibleIds.has(Number(photo.photo_id)))
      .map((photo) => ({
        photo_id: Number(photo.photo_id),
        selected: Boolean(photo.selected),
        delivered: Boolean(photo.delivered),
        current_version: Number(photo.current_version) || 0,
        added_during_editing: Boolean(photo.added_during_editing),
        ready_for_editing: Boolean(photo.ready_for_editing),
        state: customerStatus(photo),
      }));
    const requests = await db('photo_retouch_requests')
      .where({ event_id: req.event.id, guest_identifier: guestIdentifier })
      .select('id', 'photo_id', 'request_type', 'base_version', 'customer_message', 'status', 'photographer_reply', 'created_at', 'updated_at')
      .orderBy('created_at', 'desc').limit(100);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      enabled: workflow.status === 200,
      bridge_available: workflow.status === 200,
      photos,
      requests: requests.filter((request) => visibleIds.has(Number(request.photo_id))),
    });
  } catch (error) {
    require('../utils/logger').error('Gallery retouch workflow read failed', { error: error.message });
    res.status(500).json({ error: 'Unable to load retouch status' });
  }
});

router.post('/:slug/photos/:photoId/retouch-requests',
  verifyGalleryAccess,
  denySlideshowToken,
  blockHiddenGallery,
  resolveGuest,
  feedbackRateLimit('comment'),
  async (req, res) => {
    try {
      const event = req.event;
      const settings = await feedbackService.getEventFeedbackSettings(event.id);
      const photoId = Number(req.params.photoId);
      if (!Number.isSafeInteger(photoId) || photoId < 1) return res.status(400).json({ error: 'Invalid photo ID' });
      const photo = await db('photos').where({ id: photoId, event_id: event.id }).first();
      if (!photo || isPhotoHiddenFromViewer(photo, req.accessLevel)) return res.sendStatus(404);

      const requestType = req.body?.request_type;
      if (!['revision', 'additional'].includes(requestType)) {
        return res.status(400).json({ error: 'Invalid request type' });
      }
      const message = sanitizeComment(typeof req.body?.message === 'string' ? req.body.message : '');
      if (!message || message.length > 1000) return res.status(400).json({ error: 'Message must be between 1 and 1000 characters' });
      if (settings.identity_mode === 'guest' && (!req.guest || req.guest.eventId !== event.id)) {
        return res.status(401).json({ error: 'Guest identity required', code: 'GUEST_IDENTITY_REQUIRED' });
      }
      const workflow = await getPublicPhotoStates(event.id);
      if (workflow.status !== 200) return res.status(503).json({ error: 'Retouch workflow is not connected' });

      let baseVersion = null;
      let status = 'open';
      if (requestType === 'revision') {
        const current = workflow.data.photos.find((item) => Number(item.photo_id) === photoId);
        if (!current?.delivered) return res.status(409).json({ error: 'A delivered retouched version is required before requesting a revision', code: 'NO_DELIVERED_VERSION' });
        baseVersion = Number(current.current_version) || 1;
        const requestedVersion = Number(req.body?.base_version);
        if (!Number.isSafeInteger(requestedVersion) || requestedVersion !== baseVersion) {
          return res.status(409).json({ error: 'The delivered version changed. Refresh the gallery and try again.', code: 'VERSION_CHANGED', current_version: baseVersion });
        }
      }

      const moderation = await feedbackModeration.moderateText(message);
      if (moderation.blocked) return res.status(400).json({ error: 'This request contains text that is not allowed', code: 'REQUEST_BLOCKED' });
      if (!moderation.approved || settings.moderate_comments) status = 'moderation';
      const guestIdentifier = await generateGuestIdentifier(req);
      const [request] = await db('photo_retouch_requests').insert({
        event_id: event.id,
        photo_id: photoId,
        guest_id: req.guest?.id || null,
        guest_identifier: guestIdentifier,
        request_type: requestType,
        base_version: baseVersion,
        customer_message: message,
        status,
      }).returning(['id', 'photo_id', 'request_type', 'base_version', 'customer_message', 'status', 'photographer_reply', 'created_at', 'updated_at']);
      res.status(201).json({ request, moderation_required: status === 'moderation' });
    } catch (error) {
      require('../utils/logger').error('Gallery retouch request failed', { error: error.message });
      res.status(500).json({ error: 'Unable to submit retouch request' });
    }
  }
);

module.exports = router;
