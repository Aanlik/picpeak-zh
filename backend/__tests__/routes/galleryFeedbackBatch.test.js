const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { bootTestDb, seedMinimal } = require('../integration/helpers/sqliteTestDb');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'gallery-feedback-batch-secret';

describe('batch gallery feedback', () => {
  let db; let cleanup; let app; let eventId; let photoIds;
  const slug = 'batch-feedback';
  const token = () => jwt.sign({ eventId, eventSlug: slug, type: 'gallery' }, process.env.JWT_SECRET, { expiresIn: '1h', issuer: 'picpeak-auth' });

  beforeAll(async () => {
    ({ db, cleanup } = await bootTestDb());
    await seedMinimal(db);
    const insertedEvent = await db('events').insert({
      slug,
      event_type: 'project',
      event_name: 'Batch Feedback',
      event_date: '2026-08-01',
      host_email: 'host@example.com',
      admin_email: 'admin@example.com',
      password_hash: 'x',
      share_link: `/gallery/${slug}/share`,
      share_token: 'batch-feedback-share',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      is_active: 1,
      is_archived: 0,
      is_draft: 0,
      created_at: new Date().toISOString(),
    }).returning('id');
    eventId = typeof insertedEvent[0] === 'object' ? insertedEvent[0].id : insertedEvent[0];
    photoIds = [];
    for (const filename of ['one.jpg', 'two.jpg', 'hidden.jpg']) {
      const inserted = await db('photos').insert({
        event_id: eventId,
        filename,
        path: `events/${slug}/${filename}`,
        type: 'individual',
        uploaded_at: new Date().toISOString(),
        ...(filename === 'hidden.jpg' ? { visibility: 'hidden' } : {}),
      }).returning('id');
      photoIds.push(typeof inserted[0] === 'object' ? inserted[0].id : inserted[0]);
    }
    await db('event_feedback_settings').insert({
      event_id: eventId,
      feedback_enabled: true,
      allow_color_labels: true,
      allow_comments: true,
      identity_mode: 'shared',
      moderate_comments: false,
      show_feedback_to_guests: true,
    });
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/gallery', require('../../src/routes/gallery'));
    app.use('/api/gallery', require('../../src/routes/galleryFeedback'));
  }, 180000);

  afterAll(async () => { if (cleanup) await cleanup(); });

  const post = (body) => request.agent(app)
    .post(`/api/gallery/${slug}/photos/batch-feedback`)
    .set('Authorization', `Bearer ${token()}`)
    .send(body);

  it('marks selected photos green idempotently, including the shared-label mode', async () => {
    const body = { photo_ids: photoIds.slice(0, 2), feedback_type: 'color_label', color_label: 'green' };
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    for (const photoId of body.photo_ids) {
      const labels = await db('photo_feedback').where({ photo_id: photoId, event_id: eventId, feedback_type: 'color_label', color_label: 'green', is_hidden: false });
      expect(labels).toHaveLength(1);
    }
  });

  it('adds one comment to each visible photo and refuses a batch containing a hidden photo', async () => {
    const body = { photo_ids: photoIds.slice(0, 2), feedback_type: 'comment', comment_text: '请统一精修色调' };
    const result = await post(body);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, applied_count: 2, moderation_required: false });
    expect(await db('photo_feedback').where({ event_id: eventId, feedback_type: 'comment', comment_text: body.comment_text })).toHaveLength(2);
    const consumed = await db('feedback_rate_limits').where({ event_id: eventId, action_type: 'comment' }).sum('action_count as total').first();
    // Guest and IP budgets each reserve the per-photo cost of this batch.
    expect(Number(consumed.total)).toBe(4);

    const hidden = await post({ ...body, photo_ids: [photoIds[0], photoIds[2]] });
    expect(hidden.status).toBe(404);
    expect(await db('photo_feedback').where({ photo_id: photoIds[2], feedback_type: 'comment' })).toHaveLength(0);
  });

  it('rejects duplicate IDs, oversized batches and unsupported labels', async () => {
    expect((await post({ photo_ids: [photoIds[0], photoIds[0]], feedback_type: 'color_label', color_label: 'green' })).status).toBe(400);
    expect((await post({ photo_ids: photoIds.slice(0, 2), feedback_type: 'color_label', color_label: 'red' })).status).toBe(400);
    expect((await post({ photo_ids: [photoIds[0]], feedback_type: 'comment', comment_text: '<script>x</script>' })).status).toBe(400);
  });
});
