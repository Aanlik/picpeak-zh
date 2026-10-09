/**
 * Workflow action + condition handlers that touch real picpeak data.
 *
 * Registered at load time (index.js requires this module). Kept separate from
 * registry.js (which holds only primitives) so the I/O-coupled handlers don't
 * bloat the pure core.
 *
 * Email routing rule (locked requirement): INTERNAL/admin mail sends
 * immediately; EXTERNAL/customer mail respects the business-hours floor. The
 * action sets queueEmail's `respectBusinessHours` from the recipient class.
 *
 * Photography lifecycle actions are registered here; commerce/document actions
 * are intentionally outside this workflow engine.
 */
const registry = require('./registry');

// --- Conditions ---

// --- Actions ---

// Queue an email. recipientClass 'admin' (internal) sends immediately;
// anything else (customer/external) respects the business-hours floor.
registry.registerAction('send_email', async (ctx) => {
  const cfg = ctx.node.config || {};
  if (ctx.vars?.__dryRun) return { dryRun: true, would: 'send_email', recipientClass: cfg.recipientClass || cfg.recipient || 'customer', emailType: cfg.emailType || cfg.template };
  const recipientClass = cfg.recipientClass || cfg.recipient || 'customer';
  const isInternal = recipientClass === 'admin' || recipientClass === 'internal';
  const to = cfg.to
    || ctx.vars[isInternal ? 'adminEmail' : 'customerEmail']
    || ctx.vars.recipientEmail;
  if (!to) return { skipped: true, reason: 'no recipient resolved' };

  const emailProcessor = require('../emailProcessor');
  const eventId = ctx.vars.eventId || null;
  const emailType = cfg.emailType || cfg.template || 'workflow_notification';
  const emailData = { ...(cfg.emailData || {}), ...(ctx.vars.emailData || {}) };

  // INTERNAL/admin = immediate; EXTERNAL/customer = business-hours floor.
  const respectBusinessHours = !isInternal;
  // A workflow test run (engine.testRun, __test) is a test message for usage.
  await emailProcessor.queueEmail(eventId, to, emailType, emailData, { respectBusinessHours, usageEligible: !ctx.vars?.__test });
  return { sent_to: to, recipientClass, respectBusinessHours };
});

registry.registerAction('notify_gallery_expiring', async (ctx) => {
  const id = ctx.run.entity_id;
  if (!id) return { skipped: true, reason: 'no event entity' };
  if (ctx.vars?.__dryRun) return { dryRun: true, would: 'notify_gallery_expiring', eventId: id };
  const event = await ctx.db('events').where({ id }).first();
  if (!event) return { skipped: true, reason: 'event not found' };
  await require('../expirationChecker').queueExpirationWarning(event);
  return { warning_queued: id };
});

// Send the gallery_expired email(s) for the run's event entity.
registry.registerAction('notify_gallery_expired', async (ctx) => {
  const id = ctx.run.entity_id;
  if (!id) return { skipped: true, reason: 'no event entity' };
  if (ctx.vars?.__dryRun) return { dryRun: true, would: 'notify_gallery_expired', eventId: id };
  const event = await ctx.db('events').where({ id }).first();
  if (!event) return { skipped: true, reason: 'event not found' };
  await require('../expirationChecker').sendGalleryExpiredEmails(event);
  return { expired_email_queued: id };
});

// Send the pre-event customer reminder for the run's event entity. Delegates to
// eventReminderService so per-event overrides + sent_at idempotency are honoured.
registry.registerAction('notify_pre_event', async (ctx) => {
  const id = ctx.run.entity_id;
  if (!id) return { skipped: true, reason: 'no event entity' };
  if (ctx.vars?.__dryRun) return { dryRun: true, would: 'notify_pre_event', eventId: id };
  const res = await require('../eventReminderService').sendReminderForEvent(id);
  return res;
});

// Call a webhook (the `webhook` node type + the "Call a webhook" action both
// resolve here). The flow author picks a CONFIGURED webhook subscription
// (config.webhookId, managed in Settings → Webhooks); this enqueues a real
// delivery for it, so it rides the same worker pipeline as every other webhook:
// per-delivery SSRF re-validation (validateExternalUrl / GHSA-wmjx-pc37-272r),
// HMAC signing with the subscription's secret, retries/backoff, and the audit
// log — all inherited, nothing reimplemented. Best-effort: an unset / missing /
// inactive webhook records an observable skipped step.
registry.registerAction('webhook', async (ctx) => {
  const webhookId = ctx.node.config?.webhookId ? Number(ctx.node.config.webhookId) : null;
  if (!webhookId) return { skipped: true, reason: 'no webhook selected (pick one in Settings → Webhooks)' };
  if (ctx.vars?.__dryRun) return { dryRun: true, would: 'webhook', webhookId };

  const eventType = `workflow.${ctx.run.trigger_event || 'webhook'}`;
  const res = await require('../webhookService').enqueueForWebhook(webhookId, eventType, {
    workflow: { id: ctx.run.workflow_id, version: ctx.run.version },
    run: {
      id: ctx.run.id,
      trigger_event: ctx.run.trigger_event,
      entity_type: ctx.run.entity_type,
      entity_id: ctx.run.entity_id,
    },
    vars: ctx.vars || {},
  });
  return res.enqueued
    ? { webhook_enqueued: res.webhookId, deliveryId: res.deliveryId }
    : { skipped: true, reason: res.reason };
});

module.exports = {};
