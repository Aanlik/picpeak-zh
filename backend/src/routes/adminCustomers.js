/**
 * Admin → Customers Routes
 *
 * Endpoint mounted at /api/admin/customers (see app.js wiring).
 * Mirrors adminUsers.js for the invitation lifecycle but operates on
 * customer_accounts. Customer-side login routes live in customerAuth.js.
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const { adminAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { filterOwnedEventIds } = require('../middleware/ownership');
const { db } = require('../database/db');

const { handleAsync, validateRequest, successResponse } = require('../utils/routeHelpers');
const customerAccountsService = require('../services/customerAccountsService');
const { IDENTITY_PRESERVING_NORMALIZE_EMAIL } = require('../utils/emailNormalization');

const router = express.Router();

/**
 * Snake_case (DB) → camelCase (API). Kept narrow on purpose: only fields
 * the frontend actually needs land in the response so the surface area
 * doesn't accidentally grow when new columns get added later.
 */
function transformCustomer(c) {
  return {
    id: c.id,
    email: c.email,
    salutation: c.salutation,
    firstName: c.first_name,
    lastName: c.last_name,
    displayName: c.display_name,
    phone: c.phone,
    companyName: c.company_name,
    addressLine1: c.address_line1,
    addressLine2: c.address_line2,
    postalCode: c.postal_code,
    city: c.city,
    state: c.state,
    countryCode: c.country_code,
    countryName: c.country_name,
    preferredLanguage: c.preferred_language,
    notes: c.notes,
    isActive: c.is_active,
    isPassive: c.password_hash == null,
    lastLogin: c.last_login,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    eventCount: c.event_count != null ? Number(c.event_count) : undefined,
    events: Array.isArray(c.events) ? c.events.map((e) => ({
      id: e.id, slug: e.slug, eventName: e.event_name, eventDate: e.event_date,
      expiresAt: e.expires_at, isArchived: e.is_archived, assignedAt: e.assigned_at,
    })) : undefined,
  };
}

function transformInvitation(inv) {
  return {
    id: inv.id,
    email: inv.email,
    expiresAt: inv.expires_at,
    createdAt: inv.created_at,
    invitedBy: inv.invited_by,
  };
}

// ---- list / search ------------------------------------------------------

router.get('/', [
  adminAuth,
  requirePermission('customers.view'),
  query('search').optional().isString(),
], handleAsync(async (req, res) => {
  validateRequest(req);
  const customers = await customerAccountsService.listCustomers({
    search: req.query.search,
  });
  res.json({ customers: customers.map(transformCustomer) });
}));

/**
 * GET /search?email=…
 *
 * Autocomplete used by the event-form CustomerAccountPicker. Returns
 * up to 10 matches against email/name/company prefixes. Permission is
 * customers.view because exposing emails to anyone with users.view but
 * not customers.view would leak the customer roster.
 */
router.get('/search', [
  adminAuth,
  requirePermission('customers.view'),
  query('email').optional().isString(),
  query('q').optional().isString(),
], handleAsync(async (req, res) => {
  validateRequest(req);
  const term = req.query.email || req.query.q || '';
  const results = await customerAccountsService.searchCustomers(term);
  res.json({ customers: results.map(transformCustomer) });
}));

// ---- invitations --------------------------------------------------------

router.get('/invitations', [
  adminAuth,
  requirePermission('customers.view'),
], handleAsync(async (req, res) => {
  const invitations = await customerAccountsService.getPendingInvitations();
  res.json({ invitations: invitations.map(transformInvitation) });
}));

router.post('/invite', [
  adminAuth,
  requirePermission('customers.create'),
  body('email').isEmail().normalizeEmail(IDENTITY_PRESERVING_NORMALIZE_EMAIL).withMessage('Valid email is required'),
  // Optional prefill — admin can stash any subset of customer profile fields
  // on the invitation. The customer sees them pre-populated on the accept
  // form and can edit before submitting. Validators are deliberately lax:
  // any field can be omitted, and only length is enforced (sanitisation
  // happens server-side in the service).
  body('prefill').optional().isObject(),
  body('prefill.salutation').optional({ nullable: true }).isString().isLength({ max: 32 }),
  body('prefill.first_name').optional({ nullable: true }).isString().isLength({ max: 80 }),
  body('prefill.last_name').optional({ nullable: true }).isString().isLength({ max: 80 }),
  body('prefill.display_name').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('prefill.phone').optional({ nullable: true }).isString().isLength({ max: 40 }),
  body('prefill.company_name').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('prefill.address_line1').optional({ nullable: true }).isString().isLength({ max: 255 }),
  body('prefill.address_line2').optional({ nullable: true }).isString().isLength({ max: 255 }),
  body('prefill.postal_code').optional({ nullable: true }).isString().isLength({ max: 20 }),
  body('prefill.city').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('prefill.state').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('prefill.country_code').optional({ values: 'falsy' }).isLength({ min: 2, max: 2 }).isAlpha().withMessage('country_code must be a 2-letter ISO code').customSanitizer((v) => (v || '').toUpperCase()),
  // Portal language selected for this customer.
  body('prefill.preferred_language').optional({ nullable: true }).isString().isLength({ min: 2, max: 8 }),
], handleAsync(async (req, res) => {
  validateRequest(req);
  const invitation = await customerAccountsService.createInvitation({
    email: req.body.email,
    invitedById: req.admin.id,
    prefill: req.body.prefill,
  });
  // Echo the token in the response ONLY in non-production. This lets
  // local dev + Playwright e2e specs skip the email round-trip
  // (queueing → SMTP → mailbox → parse) and accept the invitation
  // straight away. In production the token stays email-channel-only:
  // anyone with API access plus the response body would otherwise be
  // able to take over a freshly-invited customer account before the
  // legitimate user clicks the link.
  const payload = {
    invitation: {
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
    },
  };
  // C.7 — hardened token echo. The previous shape gated on
  // `NODE_ENV !== 'production'`, which is true in dev AND when the
  // variable is unset entirely (some hosting setups never set
  // NODE_ENV in their entrypoint). That meant the raw invitation
  // token could leak in production-shaped deployments where the env
  // happened to be unset. Now requires an EXPLICIT opt-in
  // (`PICPEAK_ECHO_INVITE_TOKEN=1`) so a misconfigured production
  // host fails closed instead of open.
  if (process.env.PICPEAK_ECHO_INVITE_TOKEN === '1') {
    payload.invitation.token = invitation.token;
  }
  successResponse(res, payload, 201);
}));

router.delete('/invitations/:id', [
  adminAuth,
  requirePermission('customers.create'),
  param('id').isInt({ min: 1 }),
], handleAsync(async (req, res) => {
  validateRequest(req);
  await customerAccountsService.cancelInvitation(
    parseInt(req.params.id, 10),
    req.admin.id
  );
  successResponse(res, { message: 'Invitation cancelled' });
}));

// ---- create passive customer (no invitation, admin-only) ----------------
//
// Counterpart to POST /invite: instead of creating an invitation row +
// email, this endpoint inserts the customer directly with
// password_hash=null (passive). The admin uses this when they have all
// the customer's info on hand and just need an identity to attach a
// gallery to — no portal access required.
//
// Same per-field validators as /invite's prefill block, plus `email`
// required at the top level. Permission: customers.create.
router.post('/', [
  adminAuth,
  requirePermission('customers.create'),
  body('email').isEmail().normalizeEmail(IDENTITY_PRESERVING_NORMALIZE_EMAIL).withMessage('Valid email is required'),
  body('prefill').optional().isObject(),
  body('prefill.salutation').optional({ nullable: true }).isString().isLength({ max: 32 }),
  body('prefill.first_name').optional({ nullable: true }).isString().isLength({ max: 80 }),
  body('prefill.last_name').optional({ nullable: true }).isString().isLength({ max: 80 }),
  body('prefill.display_name').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('prefill.phone').optional({ nullable: true }).isString().isLength({ max: 40 }),
  body('prefill.company_name').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('prefill.address_line1').optional({ nullable: true }).isString().isLength({ max: 255 }),
  body('prefill.address_line2').optional({ nullable: true }).isString().isLength({ max: 255 }),
  body('prefill.postal_code').optional({ nullable: true }).isString().isLength({ max: 20 }),
  body('prefill.city').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('prefill.state').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('prefill.country_code').optional({ values: 'falsy' }).isLength({ min: 2, max: 2 }).isAlpha().withMessage('country_code must be a 2-letter ISO code').customSanitizer((v) => (v || '').toUpperCase()),
  body('prefill.country_name').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('prefill.preferred_language').optional({ nullable: true }).isString().isLength({ min: 2, max: 8 }),
  // At least one human-readable identifier so the record isn't a
  // nameless row that's impossible to recognise in lists later.
  body('prefill').custom((prefill) => {
    const p = prefill || {};
    const hasName = ['company_name', 'display_name', 'first_name', 'last_name']
      .some((k) => typeof p[k] === 'string' && p[k].trim());
    if (!hasName) {
      throw new Error('At least a company name or a contact name is required');
    }
    return true;
  }),
], handleAsync(async (req, res) => {
  validateRequest(req);
  const { id } = await customerAccountsService.createDirect({
    email: req.body.email,
    prefill: req.body.prefill,
    createdByAdminId: req.admin.id,
  });
  const customer = await customerAccountsService.getCustomerById(id);
  successResponse(res, { customer: transformCustomer(customer) }, 201);
}));

// ---- promote a passive customer to active (send portal invitation) ------
//
// Fires the standard customer-invitation email flow at a customer who
// currently has no password_hash. The customer clicks the link, lands
// on the accept page (pre-populated with their existing profile),
// chooses a password, and is now active. The customer's id stays the
// same — their gallery assignments remain attached.
//
// 409 with code CUSTOMER_ALREADY_ACTIVE when the customer already has
// a password set, so the button on the detail page can render an
// appropriate error toast.
router.post('/:id/send-invite', [
  adminAuth,
  requirePermission('customers.create'),
  param('id').isInt({ min: 1 }),
], handleAsync(async (req, res) => {
  validateRequest(req);
  const customerId = parseInt(req.params.id, 10);
  const customer = await customerAccountsService.getCustomerById(customerId);
  if (customer.password_hash) {
    return res.status(409).json({
      error: 'Customer already has portal access — no invitation needed.',
      code: 'CUSTOMER_ALREADY_ACTIVE',
    });
  }
  // Derive the invitation prefill from the customer's existing
  // profile so the accept page is pre-populated with what the admin
  // already entered for them (saves the customer typing it again).
  // Only the whitelisted fields go through.
  const prefill = {
    salutation:     customer.salutation,
    first_name:     customer.first_name,
    last_name:      customer.last_name,
    display_name:   customer.display_name,
    phone:          customer.phone,
    company_name:   customer.company_name,
    address_line1:  customer.address_line1,
    address_line2:  customer.address_line2,
    postal_code:    customer.postal_code,
    city:           customer.city,
    state:          customer.state,
    country_code:   customer.country_code,
    country_name:   customer.country_name,
    preferred_language: customer.preferred_language,
  };
  const invitation = await customerAccountsService.createInvitation({
    email: customer.email,
    invitedById: req.admin.id,
    prefill,
  });
  const payload = {
    invitation: {
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
    },
  };
  // C.7 — see the matching gate on POST /invite. Explicit opt-in
  // (`PICPEAK_ECHO_INVITE_TOKEN=1`) fails closed when NODE_ENV is
  // unset in a production-shaped deployment.
  if (process.env.PICPEAK_ECHO_INVITE_TOKEN === '1') {
    payload.invitation.token = invitation.token;
  }
  successResponse(res, payload, 201);
}));

// ---- customer record ----------------------------------------------------

router.get('/:id', [
  adminAuth,
  requirePermission('customers.view'),
  param('id').isInt({ min: 1 }),
], handleAsync(async (req, res) => {
  validateRequest(req);
  const customer = await customerAccountsService.getCustomerById(
    parseInt(req.params.id, 10)
  );
  res.json({ customer: transformCustomer(customer) });
}));

router.put('/:id', [
  adminAuth,
  // Migration 134 — record-edit scope split out of customers.create.
  // Roles that previously held customers.create were granted
  // customers.edit on upgrade so behavior is preserved.
  requirePermission('customers.edit'),
  param('id').isInt({ min: 1 }),
  body('email').optional().isEmail().normalizeEmail(IDENTITY_PRESERVING_NORMALIZE_EMAIL),
  // `{ nullable: true }` so a passive customer who has no salutation /
  // phone / company in their record can still save the page — the
  // form sends `null` for those empty fields, and plain `.optional()`
  // (which only skips `undefined`) would reject null at the
  // subsequent `.isString()` step. Mirrors the existing pattern on
  // address fields below.
  body('salutation').optional({ nullable: true }).isString().isLength({ max: 32 }),
  body('first_name').optional({ nullable: true }).isString().isLength({ max: 80 }),
  body('last_name').optional({ nullable: true }).isString().isLength({ max: 80 }),
  body('display_name').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('phone').optional({ nullable: true }).isString().isLength({ max: 40 }),
  body('company_name').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('address_line1').optional({ nullable: true }).isString().isLength({ max: 255 }),
  body('address_line2').optional({ nullable: true }).isString().isLength({ max: 255 }),
  body('postal_code').optional({ nullable: true }).isString().isLength({ max: 20 }),
  body('city').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('state').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('country_code').optional({ values: 'falsy' }).isLength({ min: 2, max: 2 }).isAlpha().withMessage('country_code must be a 2-letter ISO code').customSanitizer((v) => (v || '').toUpperCase()),
  body('country_name').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('preferred_language').optional({ nullable: true }).isString().isLength({ max: 8 }),
  body('notes').optional({ nullable: true }).isString(),
  body('is_active').optional().isBoolean(),
], handleAsync(async (req, res) => {
  validateRequest(req);
  const customer = await customerAccountsService.updateCustomer(
    parseInt(req.params.id, 10),
    req.body,
    req.admin.id
  );
  res.json({ customer: transformCustomer(customer) });
}));

router.post('/:id/deactivate', [
  adminAuth,
  requirePermission('customers.delete'),
  param('id').isInt({ min: 1 }),
], handleAsync(async (req, res) => {
  validateRequest(req);
  await customerAccountsService.deactivateCustomer(
    parseInt(req.params.id, 10),
    req.admin.id
  );
  successResponse(res, { message: 'Customer deactivated' });
}));

/**
 * POST /:id/reactivate (#354 follow-up).
 *
 * Restore a previously-deactivated customer. Same permission as
 * deactivate (`customers.delete`) since they're inverse operations and
 * the admin who can disable should be the one who can re-enable.
 */
router.post('/:id/reactivate', [
  adminAuth,
  requirePermission('customers.delete'),
  param('id').isInt({ min: 1 }),
], handleAsync(async (req, res) => {
  validateRequest(req);
  await customerAccountsService.reactivateCustomer(
    parseInt(req.params.id, 10),
    req.admin.id
  );
  successResponse(res, { message: 'Customer reactivated' });
}));

/**
 * POST /:id/erase (#354 follow-up).
 *
 * Anonymize-in-place erasure (GDPR Art. 17 style): nulls every PII
 * column, wipes credentials, drops pending invitations and reset tokens,
 * keeps the row + audit references intact so historical "who had access"
 * queries don't break. See customerAccountsService.eraseCustomer for
 * the full rationale.
 *
 * Hard delete is NOT shipped — `customer_invitations.accepted_customer_id`
 * has no ON DELETE CASCADE, so a real DELETE would FK-block on any
 * customer who ever accepted an invitation.
 */
router.post('/:id/erase', [
  adminAuth,
  requirePermission('customers.delete'),
  param('id').isInt({ min: 1 }),
], handleAsync(async (req, res) => {
  validateRequest(req);
  await customerAccountsService.eraseCustomer(
    parseInt(req.params.id, 10),
    req.admin.id
  );
  successResponse(res, { message: 'Customer erased' });
}));

/**
 * POST /:id/password-reset (#354 follow-up).
 *
 * Generate a 7-day password-reset token and email it to the customer.
 * Reused permission `customers.create` because issuing a reset is the
 * same authority level as issuing an invitation — both put a credential
 * into the customer's mailbox.
 */
router.post('/:id/password-reset', [
  adminAuth,
  requirePermission('customers.create'),
  param('id').isInt({ min: 1 }),
], handleAsync(async (req, res) => {
  validateRequest(req);
  const result = await customerAccountsService.createPasswordReset({
    customerId: parseInt(req.params.id, 10),
    requestedByAdminId: req.admin.id,
  });
  successResponse(res, { email: result.email, expiresAt: result.expiresAt });
}));

/**
 * PUT /api/admin/customers/:id/events — replace the customer's full
 * event assignment list. Backs the "Manage galleries" dialog on the
 * customer detail page. Body is `{ event_ids: number[] }`. Empty
 * array clears every assignment.
 *
 * Access revocation is implicit: gallery middleware checks for a
 * live event_customer_assignments row whenever it decodes a
 * customer-minted gallery JWT, so removing an assignment here
 * immediately blocks the customer's next gallery request without
 * needing to enumerate + revoke any active tokens. Permission tier
 * is customers.create (same as invite + deactivate) — managing
 * which galleries a customer can see is a write-class operation
 * on the customer record.
 */
router.put('/:id/events', [
  adminAuth,
  // Migration 134 — event-assignment scope split out of customers.create.
  // Lets an admin grant a coordinator the ability to re-target a customer
  // between customer galleries without changing the customer account.
  // edits on every customer they can see.
  requirePermission('customers.events'),
  param('id').isInt({ min: 1 }),
  body('event_ids').isArray(),
  body('event_ids.*').isInt({ min: 1 }),
], handleAsync(async (req, res) => {
  validateRequest(req);
  const customerId = parseInt(req.params.id, 10);
  const submitted = req.body.event_ids.map(Number);

  // The customer's CURRENT assignments. The "Manage galleries" dialog submits
  // the full initial list back — including any events owned by OTHER admins —
  // so we need this to tell "retain an existing foreign assignment" apart from
  // "newly grant a foreign event".
  const existingEventIds = (await db('event_customer_assignments')
    .where('customer_account_id', customerId)
    .pluck('event_id')).map(Number);
  const existingSet = new Set(existingEventIds);

  // Events the caller may act on (GHSA-xr6x). A denied id is only acceptable
  // when the customer ALREADY has that assignment (a foreign event the caller
  // is merely keeping); a denied id that isn't already assigned is a fresh
  // attempt to mint access to a foreign/nonexistent event → reject.
  const { allowed } = await filterOwnedEventIds(req.admin, submitted);
  const allowedSet = new Set(allowed.map(Number));
  const illegalNew = submitted.filter((id) => !allowedSet.has(id) && !existingSet.has(id));
  if (illegalNew.length) {
    return res.status(403).json({ error: 'One or more events are not yours to assign' });
  }

  // setAssignmentsForCustomer replaces the FULL assignment list, deleting any
  // existing row not in the submitted set. A restricted admin must not be able
  // to revoke another admin's customer↔event links that way, so always retain
  // the customer's existing assignments to events the caller does NOT own —
  // regardless of whether the client echoed them back. super_admin owns
  // everything, so nothing is force-preserved for them.
  let finalEventIds = allowed.map(Number);
  if (req.admin.roleName !== 'super_admin' && existingEventIds.length) {
    const { allowed: ownedExisting } = await filterOwnedEventIds(req.admin, existingEventIds);
    const ownedExistingSet = new Set(ownedExisting.map(Number));
    const foreignExisting = existingEventIds.filter((id) => !ownedExistingSet.has(id));
    finalEventIds = [...new Set([...finalEventIds, ...foreignExisting])];
  }
  const result = await customerAccountsService.setAssignmentsForCustomer(
    customerId,
    finalEventIds,
    req.admin.id,
  );
  successResponse(res, result);
}));

module.exports = router;
