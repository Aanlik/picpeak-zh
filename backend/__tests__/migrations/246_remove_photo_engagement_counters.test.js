const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'picpeak-photo-counts-')), 'db.sqlite',
);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'photo-counts-test-secret';
process.env.STORAGE_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'picpeak-photo-counts-storage-'));

const { bootTestDb } = require('../integration/helpers/sqliteTestDb');

describe('retired photo engagement counters', () => {
  let db;
  let cleanup;

  beforeAll(async () => {
    ({ db, cleanup } = await bootTestDb());
  }, 120000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it('removes photo view/download metrics while preserving transfer download limits', async () => {
    expect(await db.schema.hasColumn('photos', 'view_count')).toBe(false);
    expect(await db.schema.hasColumn('photos', 'download_count')).toBe(false);
    expect(await db.schema.hasColumn('transfers', 'download_count')).toBe(true);
    expect(await db.schema.hasColumn('transfers', 'max_downloads')).toBe(true);
  });
});
