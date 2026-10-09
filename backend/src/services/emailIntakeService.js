/**
 * Customer-mail intake (migration 128). Polls configured customer IMAP
 * mailboxes every minute and stores sanitized messages for the admin inbox.
 *
 * Gated by the `incomingMail` feature flag. Idempotent: each message is logged
 * in received_emails keyed by message-id (skip if seen). Handles forwarded
 * messages because mailparser flattens nested attachments.
 */
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { db } = require('../database/db');
const logger = require('../utils/logger');
const sanitizeHtml = require('sanitize-html');
const { isUniqueViolation } = require('../utils/dbErrors');

// Bound inbound message and attachment counts before displaying messages.
const numFromEnv = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const MAX_MESSAGE_BYTES = numFromEnv('EMAIL_INTAKE_MAX_MESSAGE_BYTES', 25 * 1024 * 1024);
// received_emails.message_id is varchar(512) WITH a UNIQUE constraint. A sender
// can legally emit a Message-ID longer than that; the insert then throws, the
// catch path stores a synthetic err-<uid>-<now> key that can never match the
// dedup pass, and every poll re-downloads and re-parses the same message
// forever. Collapse anything overlong to a stable hash so the key always fits
// and always reproduces (GHSA-2qf9).
const MESSAGE_ID_MAX = 512;
const boundedMessageId = (raw, fallback) => {
  const value = String(raw || fallback || '').trim() || String(fallback || '');
  if (value.length <= MESSAGE_ID_MAX) return value;
  return `sha256:${require('crypto').createHash('sha256').update(value).digest('hex')}`;
};
const MAX_ATTACHMENTS = numFromEnv('EMAIL_INTAKE_MAX_ATTACHMENTS', 25);

let polling = false;

// Fail fast instead of hanging on a wrong host/port (e.g. IMAP pointed at an
// SMTP port). Without these, ImapFlow waits indefinitely and the HTTP request
// dies at the proxy as a 502 with no useful message.
const IMAP_TIMEOUTS = { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000 };
// Look back this far so the Received log captures mail already read in another
// client (the unseen-only fetch missed those). Dedup by message-id keeps each
// poll cheap — only un-logged messages are downloaded + processed.
const LOOKBACK_DAYS = 90;

function makeImapClient(cfg) {
  return new ImapFlow({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: cfg.auth, logger: false, ...IMAP_TIMEOUTS });
}

/** Connect with a hard ceiling, so a stuck TLS handshake can't hang forever. */
async function connectWithTimeout(client, ms = 12000) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('IMAP connection timed out')), ms); });
  try {
    await Promise.race([client.connect(), timeout]);
  } catch (err) {
    // Best-effort teardown if connect lost the race but is still pending.
    try { await client.logout(); } catch (_) { /* noop */ }
    try { client.close(); } catch (_) { /* noop */ }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function isEnabled() {
  const flag = await db('feature_flags').where({ key: 'incomingMail' }).first();
  return !!(flag && (flag.value === true || flag.value === 1 || flag.value === '1'));
}

/**
 * List the mailbox folders on the IMAP server so the UI can offer a
 * dropdown instead of a free-text path. Uses the saved config; an
 * `override` ({ host, port, secure, user, pass }) lets the admin detect
 * folders BEFORE saving. A masked/blank override password falls back to
 * the stored one only for the saved server. Returns [{ path, name, specialUse }] (specialUse like
 * '\\Inbox' lets the caller auto-select the inbox).
 */
async function listFolders(override) {
  if (!override?.host || !override?.user || !override?.pass) return [];
  const cfg = {
    host: override.host,
    port: override.port || 993,
    secure: override.secure !== false && override.secure !== 0,
    auth: { user: override.user, pass: override.pass },
  };
  const client = makeImapClient(cfg);
  await connectWithTimeout(client);
  try {
    const list = await client.list();
    return (list || []).map((m) => ({ path: m.path, name: m.name, specialUse: m.specialUse || null }));
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Test the IMAP connection: log in, open the configured folder, and report
 * the message + unread counts. Non-destructive (marks nothing seen, ingests
 * nothing) — proves host/port/user/pass AND that the chosen folder opens.
 * Accepts an `override` ({ host, port, secure, user, pass, folder }) so the
 * admin can test before saving; a masked/blank password falls back to the
 * stored one only for the saved server.
 */
async function testConnection(override) {
  if (!override?.host || !override?.user || !override?.pass) return { ok: false, error: 'unconfigured' };
  const cfg = {
    host: override.host,
    port: override.port || 993,
    secure: override.secure !== false && override.secure !== 0,
    auth: { user: override.user, pass: override.pass },
  };
  const folder = override.folder || 'INBOX';
  const client = makeImapClient(cfg);
  await connectWithTimeout(client);
  try {
    const status = await client.status(folder, { messages: true, unseen: true });
    return { ok: true, folder, messages: status.messages || 0, unseen: status.unseen || 0 };
  } finally {
    await client.logout().catch(() => {});
  }
}

// Sanitize an inbound HTML body before storing it. Inbound mail is untrusted,
// so this strips scripts/handlers/unknown schemes (the viewer ALSO renders it
// in a script-less sandboxed iframe — defense in depth). Remote images are kept
// (many legit emails embed them) but that is the only tracking-vector allowed.
function sanitizeBody(html) {
  if (!html) return null;
  try {
    return sanitizeHtml(html, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        img: ['src', 'alt', 'width', 'height'],
        '*': ['style'],
      },
      allowedSchemes: ['http', 'https', 'mailto', 'cid'],
    });
  } catch (_) {
    return null;
  }
}

/**
 * Poll one customer mailbox and save its sanitized message body. Attachments
 * are counted for display; this service does not import documents or files.
 */
async function pollAccountOnce(cfg, { accountKey = 'customers' } = {}) {
  const client = makeImapClient(cfg);
  let processed = 0;
  try {
    await connectWithTimeout(client);
    const lock = await client.getMailboxLock(cfg.folder);
    /* eslint-disable no-await-in-loop */
    try {
      // 1) Candidate UIDs within the lookback window — regardless of \Seen, so
      //    mail already read elsewhere is still logged. Fall back to unseen-only
      //    if the server rejects a SINCE search.
      const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000);
      let uids = [];
      try { uids = (await client.search({ since }, { uid: true })) || []; } catch (_) { uids = []; }
      if (!uids.length) { try { uids = (await client.search({ seen: false }, { uid: true })) || []; } catch (_) { uids = []; } }

      // 2) Cheap envelope-only pass → uid + message-id (no source download).
      const candidates = [];
      if (uids.length) {
        // eslint-disable-next-line no-restricted-syntax
        // `size` rides along in the same cheap envelope pass, so an oversized
        // message can be rejected BEFORE its source is downloaded (GHSA-2qf9).
        for await (const m of client.fetch(uids, { uid: true, envelope: true, size: true }, { uid: true })) {
          candidates.push({
            uid: m.uid,
            size: Number(m.size) || 0,
            messageId: boundedMessageId(
              m.envelope && m.envelope.messageId,
              `uid-${cfg.folder}-${m.uid}`,
            ),
          });
        }
      }

      // 3) Drop ones we've already logged (so each poll only does new work).
      const logged = new Set();
      for (let i = 0; i < candidates.length; i += 500) {
        const chunk = candidates.slice(i, i + 500).map((c) => c.messageId);
        const rows = await db('received_emails').whereIn('message_id', chunk).select('message_id');
        rows.forEach((r) => logged.add(r.message_id));
      }
      const fresh = candidates.filter((c) => !logged.has(c.messageId));

      // 4) Download + process each fresh message.
      for (const cand of fresh) {
        let messageId = cand.messageId;
        let claimKey = null;
        let claimed = false;
        try {
          // Refuse oversized messages before download (GHSA-2qf9). Recorded
          // under the REAL message id — not a synthetic err-<uid>-<now> key —
          // so the step-3 dedup skips it on the next poll. Without that, the
          // same huge message was re-downloaded every poll interval forever,
          // and an OOM-kill/restart simply resumed the loop.
          if (MAX_MESSAGE_BYTES > 0 && cand.size > MAX_MESSAGE_BYTES) {
            logger.warn?.(`emailIntake: skipping uid ${cand.uid} — ${cand.size} bytes exceeds the ${MAX_MESSAGE_BYTES}-byte limit`);
            await db('received_emails').insert({
              message_id: cand.messageId,
              account_key: accountKey,
              status: 'error',
              error: `Message too large (${cand.size} bytes); limit is ${MAX_MESSAGE_BYTES}`,
              attachment_count: 0,
              received_at: new Date(),
              created_at: new Date(),
            });
            await client.messageFlagsAdd(cand.uid, ['\\Seen'], { uid: true });
            continue;
          }

          const one = await client.fetchOne(String(cand.uid), { source: true }, { uid: true });
          if (!one || !one.source) continue;
          const parsed = await simpleParser(one.source);
          messageId = boundedMessageId(parsed.messageId, cand.messageId);
          // Claim key: a no-Message-ID mail still needs a non-null, per-message
          // key so two pollers converge — fall back to the mailbox uid.
          claimKey = messageId || `nomsgid-${cand.uid}`;

          // Fast-path: already processed. Recover a row left 'processing' by a
          // worker that crashed mid-ingest (>10 min) so the attachment isn't
          // orphaned — otherwise skip + mark seen.
          const existing = await db('received_emails').where({ message_id: claimKey }).first();
          if (existing) {
            const staleProcessing = existing.status === 'processing'
              && existing.created_at
              && (Date.now() - new Date(existing.created_at).getTime() > 10 * 60 * 1000);
            if (!staleProcessing) { await client.messageFlagsAdd(cand.uid, ['\\Seen'], { uid: true }); continue; }
            await db('received_emails').where({ id: existing.id }).del();
          }

          // CLAIM the message atomically BEFORE any ingest. The message_id UNIQUE
          // index (migration 128) makes this the real guard: if a second poller
          // (multi-replica / rolling deploy) already claimed it, the insert hits
          // the unique constraint and we skip cleanly — no double-ingest.
          try {
            await db('received_emails').insert({
              message_id: claimKey,
              account_key: accountKey,
              status: 'processing',
              attachment_count: 0,
              received_at: new Date(),
              created_at: new Date(),
            });
            claimed = true;
          } catch (ce) {
            if (isUniqueViolation(ce)) { await client.messageFlagsAdd(cand.uid, ['\\Seen'], { uid: true }); continue; }
            throw ce;
          }

          const count = Math.min((parsed.attachments || []).length, MAX_ATTACHMENTS);

          // A malformed Date: header yields an Invalid Date, which throws on a
          // Postgres timestamp insert — coerce to now.
          const receivedAt = (parsed.date instanceof Date && !Number.isNaN(parsed.date.getTime())) ? parsed.date : new Date();
          // Finalise the claimed row — every processed message ends up in the
          // Received log with its (sanitized) body, even attachment-less ones.
          await db('received_emails').where({ message_id: claimKey }).update({
            from_address: ((parsed.from && parsed.from.text) || '').slice(0, 512) || null,
            to_address: ((parsed.to && parsed.to.text) || '').slice(0, 512) || null,
            subject: parsed.subject || null,
            received_at: receivedAt,
            attachment_count: count,
            status: 'received',
            body_html: sanitizeBody(parsed.html || null),
            body_text: parsed.text || null,
            error: null,
          });
          await client.messageFlagsAdd(cand.uid, ['\\Seen'], { uid: true });
          processed += 1;
        } catch (e) {
          // Loud: this is exactly where a silent failure would hide a missing
          // Received row.
          logger.error?.(`emailIntake: message uid ${cand.uid} (${messageId}) failed: ${e.message}`);
          try {
            if (claimed && claimKey) {
              // We already claimed the row — mark it errored rather than orphan it.
              await db('received_emails').where({ message_id: claimKey })
                .update({ status: 'error', error: String(e.message).slice(0, 2000) });
            } else {
              await db('received_emails').insert({ message_id: `err-${cand.uid}-${Date.now()}`, account_key: accountKey, status: 'error', error: e.message, attachment_count: 0, received_at: new Date(), created_at: new Date() });
            }
          } catch (ie) {
            logger.error?.(`emailIntake: could not even write the error row (received_emails insert failing): ${ie.message}`);
          }
        }
      }
    } finally {
      lock.release();
    }
    /* eslint-enable no-await-in-loop */
    await client.logout();
  } catch (e) {
    logger.error?.(`emailIntake: poll failed (${accountKey}): ${e.message}`);
    try { await client.close(); } catch (_e) { /* ignore */ }
  }
  return processed;
}

/**
 * Poll configured customer mailboxes only; legacy primary mailbox settings are
 * ignored.
 * Safe to call repeatedly; self-skips when busy/off.
 */
async function pollOnce() {
  if (polling) return { skipped: 'busy' };
  if (!(await isEnabled())) return { skipped: 'disabled' };
  polling = true;
  let processed = 0;
  let anyConfigured = false;
  try {
    let extras = [];
    try {
      if (await db.schema.hasTable('mail_accounts')) {
        extras = await db('mail_accounts').where({ enabled: true });
      }
    } catch (_) { extras = []; }
    for (const a of extras) {
      if (a.account_key !== 'customers') continue;
      if (!a.imap_host || !a.imap_user) continue;
      anyConfigured = true;
      const cfg = {
        host: a.imap_host,
        port: a.imap_port || 993,
        secure: a.imap_secure !== false && a.imap_secure !== 0,
        auth: { user: a.imap_user, pass: a.imap_pass || '' },
        folder: a.imap_folder || 'INBOX',
      };
      // eslint-disable-next-line no-await-in-loop
      processed += await pollAccountOnce(cfg, { accountKey: 'customers' });
    }
  } finally {
    polling = false;
  }
  if (!anyConfigured) return { skipped: 'unconfigured' };
  return { processed };
}

/** Start the 1-minute poll loop (mirrors the outgoing queue cadence). */
const mailPoller = require('./scheduledTask').scheduledTask(pollOnce, { interval: 60000, initialDelay: 15000 });
function startIncomingMailPoller() { if (!require('../utils/communicationProfile').NO_EMAIL_MODE) mailPoller.start(); }
const stopIncomingMailPoller = () => mailPoller.stop();

module.exports = { stopIncomingMailPoller, pollOnce, startIncomingMailPoller, listFolders, testConnection, _internal: { isEnabled } };
