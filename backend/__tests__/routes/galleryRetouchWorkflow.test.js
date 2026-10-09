const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { bootTestDb, seedMinimal } = require('../integration/helpers/sqliteTestDb');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'gallery-retouch-workflow-secret';
process.env.PIXCAKE_BRIDGE_URL = 'http://127.0.0.1:8080';
process.env.PIXCAKE_BRIDGE_PASSWORD = 'test-bridge-password';
const originalFetch = global.fetch;

describe('gallery retouch workflow and client requests', () => {
  let db; let cleanup; let app; let agent; let eventId; let visiblePhoto; let hiddenPhoto;
  const slug = 'retouch-workflow';
  const token = () => jwt.sign({ eventId, eventSlug: slug, type: 'gallery' }, process.env.JWT_SECRET, { expiresIn: '1h', issuer: 'picpeak-auth' });
  const bridgePhoto = (photoId, delivered = true, selection_cancelled = false) => ({
    photo_id: photoId, selected: true, delivered, current_version: delivered ? 2 : 0,
    selection_cancelled, added_during_editing: false, ready_for_editing: true,
  });

  beforeAll(async () => {
    ({ db, cleanup } = await bootTestDb());
    await seedMinimal(db);
    const inserted = await db('events').insert({
      slug, event_type: 'project', event_name: 'Retouch workflow', event_date: '2026-08-01',
      host_email: 'host@example.com', admin_email: 'admin@example.com', password_hash: 'x',
      share_link: `/gallery/${slug}/share`, share_token: 'retouch-share',
      expires_at: new Date(Date.now() + 86400000).toISOString(), is_active: 1, is_archived: 0,
      is_draft: 0, created_at: new Date().toISOString(),
    }).returning('id');
    eventId = typeof inserted[0] === 'object' ? inserted[0].id : inserted[0];
    const insertPhoto = async (filename, extra = {}) => {
      const row = await db('photos').insert({ event_id: eventId, filename, path: `events/${slug}/${filename}`, type: 'individual', uploaded_at: new Date().toISOString(), ...extra }).returning('id');
      return typeof row[0] === 'object' ? row[0].id : row[0];
    };
    visiblePhoto = await insertPhoto('visible.jpg');
    hiddenPhoto = await insertPhoto('hidden.jpg', { visibility: 'hidden' });
    await db('event_feedback_settings').insert({
      event_id: eventId, feedback_enabled: true, allow_comments: true,
      identity_mode: 'shared', moderate_comments: false, show_feedback_to_guests: true,
    });
    global.fetch = jest.fn(async (url) => ({
      status: 200,
      json: async () => String(url).includes('/version-folder')
        ? { version: 3, folder: '/nas/Camera/Project/04_FINAL/V3' }
        : { event_id: eventId, photos: [bridgePhoto(visiblePhoto), bridgePhoto(hiddenPhoto)] },
    }));
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/gallery', require('../../src/routes/gallery'));
    app.use('/api/gallery', require('../../src/routes/galleryFeedback'));
    app.use('/api/gallery', require('../../src/routes/galleryRetouchWorkflow'));
    agent = request.agent(app);
  }, 180000);

  afterAll(async () => { global.fetch = originalFetch; if (cleanup) await cleanup(); });
  const get = (path) => agent.get(path).set('Authorization', `Bearer ${token()}`);
  const post = (path) => agent.post(path).set('Authorization', `Bearer ${token()}`);
  const remove = (path) => agent.delete(path).set('Authorization', `Bearer ${token()}`);

  it('returns only visible customer statuses and labels delivered versions', async () => {
    const result = await get(`/api/gallery/${slug}/retouch-workflow`);
    expect(result.status).toBe(200);
    expect(result.body.photos).toEqual([expect.objectContaining({ photo_id: visiblePhoto, state: 'delivered', current_version: 2 })]);
  });

  it('returns a kept delivered image to the proof queue without marking it as a revision request', async () => {
    global.fetch = jest.fn(async () => ({
      status: 200,
      json: async () => ({ event_id: eventId, photos: [bridgePhoto(visiblePhoto, true, true)] }),
    }));
    const result = await get(`/api/gallery/${slug}/retouch-workflow`);
    expect(result.status).toBe(200);
    expect(result.body.photos[0]).toMatchObject({ state: 'proof', selection_cancelled: false, delivered: true });
    global.fetch = jest.fn(async (url) => ({
      status: 200,
      json: async () => String(url).includes('/version-folder')
        ? { version: 3, folder: '/nas/Camera/Project/04_FINAL/V3' }
        : { event_id: eventId, photos: [bridgePhoto(visiblePhoto), bridgePhoto(hiddenPhoto)] },
    }));
  });

  it('lets a customer withdraw an active request and clears its processing mark', async () => {
    const submitted = await post(`/api/gallery/${slug}/photos/${visiblePhoto}/retouch-requests`)
      .send({ request_type: 'revision', base_version: 2, message: '请稍微降低高光' });
    expect(submitted.status).toBe(201);
    expect(submitted.body.request).not.toHaveProperty('delivery_folder');
    expect(submitted.body.request).not.toHaveProperty('target_version');
    expect(await db('photo_feedback').where({ photo_id: visiblePhoto, feedback_type: 'color_label', color_label: 'green' })).toHaveLength(1);

    const cancelled = await remove(`/api/gallery/${slug}/retouch-requests/${submitted.body.request.id}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.request.status).toBe('cancelled');
    expect(await db('photo_feedback').where({ photo_id: visiblePhoto, feedback_type: 'color_label', color_label: 'green' })).toHaveLength(0);
    expect((await remove(`/api/gallery/${slug}/retouch-requests/${submitted.body.request.id}`)).status).toBe(409);
  });

  it('stores a revision against the current delivered version and returns it to that customer', async () => {
    const submitted = await post(`/api/gallery/${slug}/photos/${visiblePhoto}/retouch-requests`)
      .send({ request_type: 'revision', base_version: 2, message: '请把肤色调暖一些' });
    expect(submitted.status).toBe(201);
    expect(submitted.body.request).toMatchObject({ request_type: 'revision', base_version: 2, status: 'open' });
    expect(global.fetch.mock.calls.some(([url, options]) => String(url).includes('/photos/1/version-folder') && options.method === 'POST')).toBe(true);
    expect(await db('photo_retouch_requests').where({ id: submitted.body.request.id }).first()).toMatchObject({ target_version: 3, delivery_folder: '/nas/Camera/Project/04_FINAL/V3' });
    const listed = await get(`/api/gallery/${slug}/retouch-workflow`);
    expect(listed.body.requests).toHaveLength(2);
    expect(listed.body.requests.find((request) => request.customer_message === '请把肤色调暖一些')).toMatchObject({ status: 'open' });
    expect(listed.body.requests.find((request) => request.customer_message === '请稍微降低高光')).toMatchObject({ status: 'cancelled' });
  });

  it('accepts workflow requests without enabling general comments or collecting email', async () => {
    await db('event_feedback_settings').where({ event_id: eventId }).update({ feedback_enabled: false, allow_comments: false });
    const submitted = await post(`/api/gallery/${slug}/photos/${visiblePhoto}/retouch-requests`)
      .send({ request_type: 'additional', message: '请再导出一个偏暖色版本' });
    expect(submitted.status).toBe(201);
    expect(submitted.body.request).toMatchObject({ request_type: 'additional', status: 'open' });
    await db('event_feedback_settings').where({ event_id: eventId }).update({ feedback_enabled: true, allow_comments: true });
  });

  it('rejects stale revisions, revisions before delivery, and hidden photos', async () => {
    expect((await post(`/api/gallery/${slug}/photos/${visiblePhoto}/retouch-requests`).send({ request_type: 'revision', base_version: 1, message: '改一下' })).status).toBe(409);
    global.fetch = jest.fn(async () => ({ status: 200, json: async () => ({ photos: [bridgePhoto(visiblePhoto, false)] }) }));
    expect((await post(`/api/gallery/${slug}/photos/${visiblePhoto}/retouch-requests`).send({ request_type: 'revision', base_version: 0, message: '改一下' })).status).toBe(409);
    expect((await post(`/api/gallery/${slug}/photos/${hiddenPhoto}/retouch-requests`).send({ request_type: 'additional', message: '另外做一版' })).status).toBe(404);
  });

  it('hides prior customer request history when its photo becomes hidden', async () => {
    await db('photos').where({ id: visiblePhoto }).update({ visibility: 'hidden' });
    const result = await get(`/api/gallery/${slug}/retouch-workflow`);
    expect(result.body.photos).toEqual([]);
    expect(result.body.requests).toEqual([]);
  });
});
