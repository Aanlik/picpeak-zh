const request = require('supertest');
const express = require('express');
const { bootTestDb, seedMinimal } = require('./helpers/sqliteTestDb');

describe('participant merge preserves invite links', () => {
  let db; let cleanup; let app; let eventId;

  const addParticipant = async (name) => {
    const [row] = await db('gallery_guests').insert({
      event_id: eventId,
      name,
      identifier: `participant-${Math.random()}`,
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      is_deleted: false,
    }).returning('id');
    return typeof row === 'object' ? row.id : row;
  };

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock('../../src/middleware/auth', () => ({
      adminAuth: (req, _res, next) => { req.admin = { id: 1, username: 'tester' }; next(); },
    }));
    jest.doMock('../../src/middleware/permissions', () => ({
      requirePermission: () => (_req, _res, next) => next(),
    }));
    jest.doMock('../../src/middleware/ownership', () => ({
      requireEventOwnership: (_req, _res, next) => next(),
    }));
    jest.doMock('../../src/utils/logger', () => ({
      debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    }));

    ({ db, cleanup } = await bootTestDb());
    await seedMinimal(db);
    const [event] = await db('events').insert({
      slug: 'participant-merge', event_type: 'project', event_name: 'Participant Merge',
      event_date: '2026-08-01', password_hash: 'x', share_link: '/gallery/participant-merge/share',
      expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      is_active: 1, is_archived: 0, is_draft: 0, created_at: new Date().toISOString(),
    }).returning('id');
    eventId = typeof event === 'object' ? event.id : event;

    app = express();
    app.use(express.json());
    app.use('/api/admin', require('../../src/routes/adminGuests'));
  }, 180000);

  afterAll(async () => { if (cleanup) await cleanup(); });

  beforeEach(async () => {
    await db('guest_invites').where({ event_id: eventId }).del();
    await db('gallery_guests').where({ event_id: eventId }).del();
  });

  it('moves an unused participant invite to the surviving participant', async () => {
    const merged = await addParticipant('林小姐');
    const survivor = await addParticipant('林小姐');
    const [row] = await db('guest_invites').insert({
      event_id: eventId, guest_id: merged, token: 'unused-invite-token',
      created_by_admin_id: 1, created_at: new Date().toISOString(),
    }).returning('id');

    const response = await request(app)
      .post(`/api/admin/events/${eventId}/guests/${survivor}/merge`)
      .send({ mergeIds: [merged] });

    expect(response.status).toBe(200);
    const inviteId = typeof row === 'object' ? row.id : row;
    expect((await db('guest_invites').where({ id: inviteId }).first()).guest_id).toBe(survivor);
    expect(Boolean((await db('gallery_guests').where({ id: survivor }).first()).is_deleted)).toBe(false);
  });

  it('keeps a redeemed invite attached to the participant who used it', async () => {
    const merged = await addParticipant('林小姐');
    const survivor = await addParticipant('林小姐');
    const [row] = await db('guest_invites').insert({
      event_id: eventId, guest_id: merged, token: 'redeemed-invite-token',
      created_by_admin_id: 1, redeemed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }).returning('id');

    const response = await request(app)
      .post(`/api/admin/events/${eventId}/guests/${survivor}/merge`)
      .send({ mergeIds: [merged] });

    expect(response.status).toBe(200);
    const inviteId = typeof row === 'object' ? row.id : row;
    expect((await db('guest_invites').where({ id: inviteId }).first()).guest_id).toBe(merged);
  });
});
