'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const profilePath = require.resolve('../../src/utils/communicationProfile');
function load(value) { process.env.NO_EMAIL_MODE = value; delete require.cache[profilePath]; return require(profilePath); }
test('nested profile projection retains photos and original values', () => {
  const p = load('true'); const input = { flags: { messaging: true, galleries: true }, settings: { require_name_email: true, identity_mode: 'guest' }, photos: [{ id: 1 }] };
  const result = p.project(input); assert.deepEqual(result.flags, { messaging: false, galleries: true }); assert.deepEqual(result.settings, { require_name_email: false, identity_mode: 'guest' }); assert.equal(input.flags.messaging, true); assert.deepEqual(result.photos, input.photos);
});
test('email endpoint blocked', () => {
  const p = load('true'); let status; let called = false; p.middleware({ path: '/admin/email/send' }, { status(v) { status = v; return this; }, json() {} }, () => { called = true; }); assert.equal(status, 409); assert.equal(called, false);
});
test('quiet publish preserves password protection', () => {
  const p = load('true'); const req = { path: '/admin/events/1/publish', body: { notifyCustomer: true, sendEmail: true, require_password: true } }; let called = false; p.middleware(req, { json() {} }, () => { called = true; }); assert.deepEqual(req.body, { notifyCustomer: false, sendEmail: false, require_password: true }); assert.equal(called, true);
});
test('upstream mode unchanged', () => {
  const p = load('false'); const req = { path: '/admin/email/send', body: { sendEmail: true } }; let called = false; p.middleware(req, {}, () => { called = true; }); assert.equal(called, true); assert.equal(req.body.sendEmail, true);
});

test("presentation hides legacy email fields without deleting stored records", () => {
  const p = load("true"); const stored = { email: "old@example.com", customer_email: "client@example.com", actorName: "studio@example.com", comment_text: "请保留这条评论" };
  assert.deepEqual(p.project(stored), { email: "", customer_email: "", actorName: "studio", comment_text: "请保留这条评论" }); assert.equal(stored.email, "old@example.com");
});
