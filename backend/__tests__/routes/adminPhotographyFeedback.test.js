'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'picpeak-photo-feedback-')), 'db.sqlite',
);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'photo-feedback-test-secret';
process.env.STORAGE_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'picpeak-photo-feedback-storage-'));

const request = require('supertest');
const {
  bootTestDb,
  seedMinimal,
  assignAdminRole,
  mintAdminToken,
  buildRouteApp,
} = require('../integration/helpers/sqliteTestDb');
const { clearPermissionCache } = require('../../src/middleware/permissions');

describe('admin photo workflow feedback endpoints', () => {
  let db;
  let cleanup;
  let app;
  let token;
  let eventId;
  let photoId;

  const auth = (req) => req.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    ({ db, cleanup } = await bootTestDb());
    const { adminId } = await seedMinimal(db);
    await assignAdminRole(db, adminId, 'super_admin');
    token = mintAdminToken(adminId);
    clearPermissionCache();

    const eventInsert = await db('events').insert({
      slug: 'feedback-project',
      event_name: 'Feedback Project',
      event_type: 'project',
      event_date: '2026-10-10',
      password_hash: 'x',
      share_link: '/gallery/feedback-project/share',
      share_token: 'feedback-project-token',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      is_active: true,
      is_archived: false,
      is_draft: false,
      created_by: adminId,
      created_at: new Date().toISOString(),
    }).returning('id');
    eventId = eventInsert[0]?.id ?? eventInsert[0];

    const photoInsert = await db('photos').insert({
      event_id: eventId,
      filename: 'DSC00125.jpg',
      path: '/events/DSC00125.jpg',
      type: 'image',
    }).returning('id');
    photoId = photoInsert[0]?.id ?? photoInsert[0];

    app = buildRouteApp('/api/admin/feedback', require('../../src/routes/adminPhotographyFeedback'));
  }, 120000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it('keeps reading and saving per-project feedback settings', async () => {
    const initial = await auth(request(app).get(`/api/admin/feedback/events/${eventId}/feedback-settings`));
    expect(initial.status).toBe(200);
    expect(initial.body).toMatchObject({ event_id: String(eventId), feedback_enabled: false });

    const saved = await auth(request(app).put(`/api/admin/feedback/events/${eventId}/feedback-settings`))
      .send({ feedback_enabled: true, allow_comments: true, allow_color_labels: true });
    expect(saved.status).toBe(200);
    expect(Boolean(Number(saved.body.feedback_enabled))).toBe(true);
    expect(Boolean(Number(saved.body.allow_comments))).toBe(true);
    expect(Boolean(Number(saved.body.allow_color_labels))).toBe(true);
  });

  it('lets the photographer read comments without moderation columns', async () => {
    await db('photo_feedback').insert({
      photo_id: photoId,
      event_id: eventId,
      feedback_type: 'comment',
      comment_text: 'Please retouch this one',
      guest_name: '小林',
      is_hidden: false,
    });

    const result = await auth(request(app).get(`/api/admin/feedback/events/${eventId}/feedback`)
      .query({ photoId, status: 'all' }));
    expect(result.status).toBe(200);
    expect(result.body.feedback).toEqual(expect.arrayContaining([
      expect.objectContaining({ filename: 'DSC00125.jpg', comment_text: 'Please retouch this one' }),
    ]));
  });

  it('does not restore the retired moderation or reporting endpoints', async () => {
    await auth(request(app).put('/api/admin/feedback/feedback/1/approve')).expect(404);
    await auth(request(app).get(`/api/admin/feedback/events/${eventId}/feedback-analytics`)).expect(404);
  });
});
