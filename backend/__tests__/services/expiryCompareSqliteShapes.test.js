/**
 * Expiration checks must compare dates consistently across SQLite storage
 * shapes and archive only projects that have actually expired.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'picpeak-expiry-shapes-'));
process.env.STORAGE_PATH = tmp;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-for-validation';

const mockArchiveEvent = jest.fn(async () => {});
jest.mock('../../src/services/archiveService', () => ({
  archiveEvent: (...args) => mockArchiveEvent(...args),
}));

const { bootTestDb } = require('../integration/helpers/sqliteTestDb');

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const naive = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const FIXTURES = [
  ['iso-expired', new Date(now - DAY).toISOString()],
  ['iso-warning', new Date(now + 3 * DAY).toISOString()],
  ['iso-future', new Date(now + 30 * DAY).toISOString()],
  ['ms-expired', now - DAY],
  ['ms-warning', now + 3 * DAY],
  ['ms-future', now + 30 * DAY],
  ['naive-expired', naive(now - DAY)],
  ['naive-warning', naive(now + 3 * DAY)],
  ['naive-future', naive(now + 30 * DAY)],
  ['never', null],
];
const EXPIRED = ['iso-expired', 'ms-expired', 'naive-expired'];

describe('expires_at comparisons on SQLite', () => {
  let db;
  let cleanup;

  beforeAll(async () => {
    ({ db, cleanup } = await bootTestDb());
    for (const [slug, expires_at] of FIXTURES) {
      await db('events').insert({
        slug,
        event_type: 'project',
        event_name: slug,
        event_date: '2026-09-01',


        password_hash: 'unused',
        require_password: false,
        share_link: `/gallery/${slug}/share`,
        share_token: `${slug}-share`,
        expires_at,
        is_active: 1,
        is_archived: 0,
        is_draft: 0,
        created_at: new Date(now - 60 * DAY).toISOString(),
      });
    }
  }, 120000);

  afterAll(async () => {
    if (cleanup) await cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('the fixtures hold text, integer, and null values', async () => {
    const types = Object.fromEntries((await db('events').select('slug', db.raw('typeof(expires_at) as t')))
      .map((row) => [row.slug, row.t]));
    expect(types['iso-expired']).toBe('text');
    expect(types['ms-expired']).toBe('integer');
    expect(types['naive-expired']).toBe('text');
    expect(types.never).toBe('null');
  });

  test('the checker archives and deactivates only expired projects', async () => {
    const { checkExpirations } = require('../../src/services/expirationChecker');
    await checkExpirations();

    expect(mockArchiveEvent.mock.calls.map(([event]) => event.slug).sort()).toEqual([...EXPIRED].sort());
    const inactive = (await db('events').where('is_active', 0).select('slug'))
      .map((row) => row.slug).sort();
    expect(inactive).toEqual([...EXPIRED].sort());
  });
});
