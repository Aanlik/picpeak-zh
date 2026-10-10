'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'picpeak-current-user-')), 'db.sqlite',
);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'current-user-test-secret';
process.env.STORAGE_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'picpeak-current-user-storage-'));

const request = require('supertest');
const {
  bootTestDb,
  seedMinimal,
  assignAdminRole,
  mintAdminToken,
  buildRouteApp,
} = require('../integration/helpers/sqliteTestDb');
const { clearPermissionCache } = require('../../src/middleware/permissions');

describe('current admin permissions endpoint', () => {
  let cleanup;
  let app;
  let token;

  beforeAll(async () => {
    const { db, cleanup: closeDb } = await bootTestDb();
    cleanup = closeDb;
    const { adminId } = await seedMinimal(db);
    await assignAdminRole(db, adminId, 'super_admin');
    clearPermissionCache();
    token = mintAdminToken(adminId);
    app = buildRouteApp('/api/admin/users', require('../../src/routes/adminCurrentUser'));
  }, 120000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it('returns the signed-in admin role and permissions for the UI guards', async () => {
    const response = await request(app)
      .get('/api/admin/users/me/permissions')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.role.name).toBe('super_admin');
    expect(response.body.permissions).toContain('events.view');
  });
});
