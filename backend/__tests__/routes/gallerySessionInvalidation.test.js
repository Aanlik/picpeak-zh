/**
 * Real routes + migrated SQLite: gallery sessions end when what they were
 * opened with ends.
 *
 * - Changing the gallery password (or the client password) only rewrote the
 *   stored hash, so a guest who got in with the old one kept access for the
 *   rest of the 24-hour token.
 * - A gallery token minted from the customer portal carried its own jti and
 *   never looked at the portal session, so logging out of the portal did not
 *   end it.
 * - The admin preview skipped the idle timeout, which sessionTimeoutMiddleware
 *   only enforces under /api/admin.
 */
const { bootTestDb, seedMinimal, assignAdminRole, mintAdminToken } = require('../integration/helpers/sqliteTestDb');
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

process.env.JWT_SECRET = 'gallery-session-invalidation-secret-at-least-32-chars';

let db, cleanup, app, adminId;
const eventId = 71001, slug = 'session-invalidation';
const photos = `/api/gallery/${slug}/photos`;

const galleryToken = (claims = {}) => jwt.sign({
  type: 'gallery', eventId, eventSlug: slug, jti: crypto.randomUUID(),
  iat: Math.floor(Date.now() / 1000) - 60, ...claims,
}, process.env.JWT_SECRET, { issuer: 'picpeak-auth', expiresIn: '1h' });
const listWith = (bearer) => request(app).get(photos).set('Authorization', `Bearer ${bearer}`);

beforeAll(async () => {
  ({ db, cleanup } = await bootTestDb());
  ({ adminId } = await seedMinimal(db));
  await assignAdminRole(db, adminId);
  await db('events').insert({
    id: eventId, slug, event_type: 'project', event_name: 'Session invalidation',
    event_date: '2026-01-01',
    password_hash: 'unused', share_link: `/gallery/${slug}`, created_by: adminId,
    share_token: crypto.randomBytes(16).toString('hex'),
  });
  // Pin the idle timeout the preview cases rely on (the default is 60 minutes).
  const timeoutSetting = { setting_key: 'security_session_timeout_minutes', setting_value: '60' };
  if (await db('app_settings').where({ setting_key: timeoutSetting.setting_key }).first()) {
    await db('app_settings').where({ setting_key: timeoutSetting.setting_key }).update({ setting_value: '60' });
  } else {
    await db('app_settings').insert({ ...timeoutSetting, setting_type: 'security' });
  }
  app = express(); app.use(express.json()); app.use(cookieParser());
  app.use('/api/admin/events', require('../../src/routes/adminEvents'));
  app.use('/api/gallery', require('../../src/routes/gallery'));
}, 120000);

beforeEach(async () => {
  await db('events').where({ id: eventId }).update({
    is_active: 1, is_archived: 0, is_draft: 0, require_password: 1, client_access_enabled: 1,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    gallery_password_changed_at: null, client_password_changed_at: null,
  });
});

afterAll(async () => { if (cleanup) await cleanup(); });

describe('rotating a gallery credential', () => {
  it('ends guest sessions opened with the old gallery password and keeps the others', async () => {
    const guest = galleryToken();
    const client = galleryToken({ accessLevel: 'client' });
    const slideshow = galleryToken({ accessLevel: 'slideshow' });
    expect((await listWith(guest)).status).toBe(200);

    const reset = await request(app).post(`/api/admin/events/${eventId}/reset-password`)
      .set('Authorization', `Bearer ${mintAdminToken(adminId)}`).send({});
    expect(reset.status).toBe(200);

    const refused = await listWith(guest);
    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe('GALLERY_PASSWORD_CHANGED');
    // A session opened after the change, and sessions not opened with the
    // gallery password, keep working.
    expect((await listWith(galleryToken({ iat: Math.floor(Date.now() / 1000) + 1 }))).status).toBe(200);
    expect((await listWith(client)).status).toBe(200);
    expect((await listWith(slideshow)).status).toBe(200);
  });

  it('keeps sessions when an event edit resubmits the current gallery and client passwords', async () => {
    const auth = `Bearer ${mintAdminToken(adminId)}`;
    const body = { password: 'Gallery-Edit-Same-2026!', client_password: 'Client-Edit-Same-2026!' };
    expect((await request(app).put(`/api/admin/events/${eventId}`).set('Authorization', auth).send(body)).status).toBe(200);
    await db('events').where({ id: eventId }).update({ gallery_password_changed_at: null, client_password_changed_at: null });
    const guest = galleryToken();
    const client = galleryToken({ accessLevel: 'client' });

    expect((await request(app).put(`/api/admin/events/${eventId}`).set('Authorization', auth).send(body)).status).toBe(200);

    expect((await listWith(guest)).status).toBe(200);
    expect((await listWith(client)).status).toBe(200);
  });

  it('does not let an event update clear the cutoff and revive the ended sessions', async () => {
    const guest = galleryToken();
    const client = galleryToken({ accessLevel: 'client' });
    const auth = `Bearer ${mintAdminToken(adminId)}`;
    expect((await request(app).post(`/api/admin/events/${eventId}/reset-password`).set('Authorization', auth)
      .send({})).status).toBe(200);
    expect((await request(app).put(`/api/admin/events/${eventId}`).set('Authorization', auth)
      .send({ client_password: 'Client-Rotation-2027!' })).status).toBe(200);

    await request(app).put(`/api/admin/events/${eventId}`).set('Authorization', auth)
      .send({ gallery_password_changed_at: null, client_password_changed_at: null });

    expect((await listWith(guest)).status).toBe(401);
    expect((await listWith(client)).status).toBe(401);
  });

  it('ends client sessions when the client password changes, not guest sessions', async () => {
    const guest = galleryToken();
    const client = galleryToken({ accessLevel: 'client' });
    expect((await listWith(client)).status).toBe(200);

    const update = await request(app).put(`/api/admin/events/${eventId}`)
      .set('Authorization', `Bearer ${mintAdminToken(adminId)}`)
      .send({ client_password: 'Client-Rotation-2026!' });
    expect(update.status).toBe(200);

    const refused = await listWith(client);
    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe('GALLERY_PASSWORD_CHANGED');
    expect((await listWith(guest)).status).toBe(200);
  });
});

describe('admin preview', () => {
  const preview = (bearer) => request(app).get(`${photos}?admin_preview=1`).set('Authorization', `Bearer ${bearer}`);
  const adminToken = (claims) => jwt.sign({ type: 'admin', id: adminId, username: 'admin', ...claims },
    process.env.JWT_SECRET, { issuer: 'picpeak-auth', expiresIn: '30d' });

  it('refuses an admin session that has idled out, as the admin API does', async () => {
    const idle = await preview(adminToken({ iat: Math.floor(Date.now() / 1000) - 3 * 3600 }));
    expect(idle.status).toBe(401);
    expect(idle.body.code).toBe('SESSION_TIMEOUT');

    expect((await preview(mintAdminToken(adminId))).status).toBe(200);
    // "Remember me" opts out of the idle timeout here too.
    expect((await preview(adminToken({ iat: Math.floor(Date.now() / 1000) - 3 * 3600, rememberMe: true }))).status).toBe(200);
  });

  it('refuses an idled-out admin who may not open the gallery as forbidden, not as a timeout', async () => {
    // A timeout answer before authorization would tell another owner's draft
    // apart from a gallery that does not exist.
    const [row] = await db('admin_users').insert({
      username: 'foreign-idle', email: 'foreign-idle@example.test', password_hash: 'unused', is_active: 1,
    }).returning('id');
    const foreignId = row.id ?? row;
    await assignAdminRole(db, foreignId, 'viewer');
    const idleForeign = jwt.sign({ type: 'admin', id: foreignId, iat: Math.floor(Date.now() / 1000) - 3 * 3600 },
      process.env.JWT_SECRET, { issuer: 'picpeak-auth', expiresIn: '30d' });

    const refused = await preview(idleForeign);

    expect(refused.body.code).not.toBe('SESSION_TIMEOUT');
    expect(refused.body.code).toBe('FORBIDDEN');
  });

  it('counts preview requests as activity, so the timeout is idle time, not a fixed lifetime', async () => {
    const start = Date.now();
    let clock = start;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      const bearer = adminToken({ iat: Math.floor(start / 1000) });
      expect((await preview(bearer)).status).toBe(200);
      clock = start + 50 * 60 * 1000;
      expect((await preview(bearer)).status).toBe(200);
      // 70 minutes after login, but only 20 after the last preview request.
      clock = start + 70 * 60 * 1000;
      expect((await preview(bearer)).status).toBe(200);
    } finally {
      now.mockRestore();
    }
  });
});
