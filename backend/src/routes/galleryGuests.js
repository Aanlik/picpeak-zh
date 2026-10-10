const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { db } = require('../database/db');
const logger = require('../utils/logger');
const { verifyGalleryAccess } = require('../middleware/gallery');
const { resolveGuest, requireGuest, signGuestToken } = require('../middleware/guestAuth');
const feedbackService = require('../services/feedbackService');

const MAX_NAME_LEN = 100;

// In-memory rate limit for guest registration (20 per hour per IP). Simple
// sliding window; on process restart the counters reset which is acceptable.
const registrationAttempts = new Map();
const REGISTRATION_WINDOW_MS = 60 * 60 * 1000;
const REGISTRATION_MAX = 20;

function checkRegistrationRate(ip) {
  const now = Date.now();
  const entry = registrationAttempts.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > REGISTRATION_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  registrationAttempts.set(ip, entry);
  return entry.count <= REGISTRATION_MAX;
}

function sanitizeName(value) {
  if (typeof value !== 'string') return '';
  // Strip HTML/control chars, collapse whitespace.
  const cleaned = value
    .replace(/[<>&"']/g, '')
    // eslint-disable-next-line no-control-regex -- intentional: strips control chars from guest input
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, MAX_NAME_LEN);
}


/**
 * POST /gallery/:slug/guest
 * Body: { name }
 *
 * Registers a new per-person guest identity for this gallery. Returns a JWT
 * that the frontend must send as the x-guest-token header on subsequent
 * feedback requests.
 */
router.post('/:slug/guest', verifyGalleryAccess, async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    if (!checkRegistrationRate(ip)) {
      return res.status(429).json({ error: 'Too many registration attempts' });
    }

    const event = req.event;
    const settings = await feedbackService.getEventFeedbackSettings(event.id);

    // Guest registration is only meaningful when feedback is enabled.
    if (!settings.feedback_enabled) {
      return res.status(403).json({ error: 'Feedback is not enabled for this gallery' });
    }

    const name = sanitizeName(req.body?.name);
    if (!name || name.length < 1) {
      return res.status(400).json({ error: 'Name is required', field: 'name' });
    }

    const identifier = crypto.randomUUID();
    const userAgent = (req.headers['user-agent'] || '').substring(0, 500);

    const [row] = await db('gallery_guests')
      .insert({
        event_id: event.id,
        name,
        identifier,
        ip_address_last: ip.substring(0, 45),
        user_agent_last: userAgent,
      })
      .returning(['id', 'name', 'identifier', 'created_at']);

    const token = signGuestToken({
      guestId: row.id,
      eventId: event.id,
      identifier: row.identifier,
      name: row.name,
    });

    logger.info('Guest registered', {
      eventId: event.id,
      guestId: row.id,
      name: row.name,
    });

    return res.json({
      guest: {
        id: row.id,
        name: row.name,
        identifier: row.identifier,
      },
      token,
    });
  } catch (error) {
    logger.error('Guest registration failed', { error: error.message });
    return res.status(500).json({ error: 'Failed to register guest' });
  }
});

/**
 * GET /gallery/:slug/guest/me
 * Returns the current guest profile from a valid guest token. 401 otherwise.
 */
router.get('/:slug/guest/me', verifyGalleryAccess, resolveGuest, requireGuest, async (req, res) => {
  try {
    if (req.guest.eventId !== req.event.id) {
      return res.status(403).json({ error: 'Guest token does not match gallery' });
    }

    // Update last_seen_at on each profile fetch (cheap and useful for admin).
    await db('gallery_guests')
      .where({ id: req.guest.id })
      .update({
        last_seen_at: db.fn.now(),
        ip_address_last: (req.ip || '').substring(0, 45),
        user_agent_last: (req.headers['user-agent'] || '').substring(0, 500),
      });

    return res.json({
      guest: {
        id: req.guest.id,
        name: req.guest.name,
        identifier: req.guest.identifier,
      },
    });
  } catch (error) {
    logger.error('Guest profile fetch failed', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch guest profile' });
  }
});

/**
 * DELETE /gallery/:slug/guest/me
 *
 * "Forget me" — soft-deletes the guest row and anonymizes their feedback so
 * aggregate counts remain stable but personal data is removed.
 */
router.delete('/:slug/guest/me', verifyGalleryAccess, resolveGuest, requireGuest, async (req, res) => {
  try {
    if (req.guest.eventId !== req.event.id) {
      return res.status(403).json({ error: 'Guest token does not match gallery' });
    }

    await feedbackService.anonymizeGuestFeedback(req.guest.id);

    await db('gallery_guests')
      .where({ id: req.guest.id })
      .update({
        is_deleted: true,
        name: 'Removed',
        last_seen_at: db.fn.now(),
      });

    logger.info('Guest self-forgot', {
      eventId: req.event.id,
      guestId: req.guest.id,
    });

    return res.json({ success: true });
  } catch (error) {
    logger.error('Guest forget-me failed', { error: error.message });
    return res.status(500).json({ error: 'Failed to forget guest' });
  }
});

// ---------------------------------------------------------------------------
// Phase 3.3 — Invite token redemption
// ---------------------------------------------------------------------------

/**
 * POST /gallery/:slug/guest/redeem
 * Body: { inviteToken }
 *
 * Redeems a pre-minted invite token (created by admin). Single use.
 */
router.post('/:slug/guest/redeem', verifyGalleryAccess, async (req, res) => {
  try {
    const inviteToken = String(req.body?.inviteToken || '').trim();
    if (!inviteToken) {
      return res.status(400).json({ error: 'Invite token required' });
    }

    const event = req.event;

    const result = await db.transaction(async (trx) => {
      const invite = await trx('guest_invites')
        .where({ token: inviteToken, event_id: event.id })
        .first();
      if (!invite) return { error: 'not_found' };
      // Spent and revoked invites name their guest, so the client can tell
      // "this guest came back through their own link" (keep the identity the
      // device holds) from "someone else's link on a device that holds
      // another guest's identity" (drop it) — see GuestIdentityContext.
      if (invite.revoked_at) return { error: 'revoked', guestId: invite.guest_id };
      if (invite.redeemed_at) return { error: 'already_redeemed', guestId: invite.guest_id };

      const guest = await trx('gallery_guests')
        .where({ id: invite.guest_id, is_deleted: false })
        .first();
      if (!guest) return { error: 'guest_missing' };

      // Single use is decided by this UPDATE, not by the reads above. Two
      // redemptions of the same link, or a redemption racing the admin's
      // revoke, can both read a pending invite under READ COMMITTED; only
      // the one whose UPDATE still finds both columns NULL mints a session.
      const claimed = await trx('guest_invites')
        .where({ id: invite.id, event_id: event.id })
        .whereNull('redeemed_at')
        .whereNull('revoked_at')
        .update({ redeemed_at: trx.fn.now() });
      if (claimed !== 1) {
        const current = await trx('guest_invites').where({ id: invite.id }).first('revoked_at');
        if (current?.revoked_at) return { error: 'revoked', guestId: invite.guest_id };
        return { error: 'already_redeemed', guestId: invite.guest_id };
      }

      await trx('gallery_guests')
        .where({ id: guest.id })
        .update({
          last_seen_at: trx.fn.now(),
          ip_address_last: (req.ip || '').substring(0, 45),
          user_agent_last: (req.headers['user-agent'] || '').substring(0, 500),
        });

      return { guest };
    });

    if (result.error) {
      const statusMap = {
        not_found: 404,
        revoked: 410,
        already_redeemed: 409,
        guest_missing: 404,
      };
      const body = { error: result.error };
      if (result.guestId != null) body.guest_id = Number(result.guestId);
      return res.status(statusMap[result.error] || 400).json(body);
    }

    const token = signGuestToken({
      guestId: result.guest.id,
      eventId: event.id,
      identifier: result.guest.identifier,
      name: result.guest.name,
    });

    logger.info('Invite redeemed', { eventId: event.id, guestId: result.guest.id });

    return res.json({
      guest: {
        id: result.guest.id,
        name: result.guest.name,
        identifier: result.guest.identifier,
      },
      token,
    });
  } catch (error) {
    logger.error('Invite redemption failed', { error: error.message });
    return res.status(500).json({ error: 'Failed to redeem invite' });
  }
});

module.exports = router;
