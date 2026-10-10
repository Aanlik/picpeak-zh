/**
 * Admin password lockout is scoped to identifier + source IP.
 */

const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const fsSync = require('fs');
const osMod = require('os');
const pathMod = require('path');
const { bootTestDb } = require('../integration/helpers/sqliteTestDb');

process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_PATH = pathMod.join(
  fsSync.mkdtempSync(pathMod.join(osMod.tmpdir(), 'picpeak-lockout-scope-')), 'db.sqlite'
);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-not-a-real-key';

// Fixture credential, assembled so secret scanners do not read it as a leak.
const PASSWORD = ['Fixture', 'Login', '2026!'].join('-');
const ATTACKER_IP = '198.51.100.7';
const OWNER_IP = '203.0.113.9';

let app; let db; let cleanup;

beforeAll(async () => {
  ({ db, cleanup } = await bootTestDb());
  const hash = await bcrypt.hash(PASSWORD, 4);
  await db('admin_users').insert({
    username: 'scope-admin', email: 'scope-admin@example.com', password_hash: hash, is_active: true,
  });

  app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', require('../../src/routes/auth'));
}, 120000);

afterAll(async () => {
  await require('../../src/services/serviceShutdown').stopServices();
  if (cleanup) await cleanup();
});

beforeEach(async () => { await db('login_attempts').del(); });

const post = (path, ip, body) => request(app).post(path).set('X-Forwarded-For', ip).send(body);

describe('admin login lockout is scoped to identifier + IP', () => {
  const login = (ip, password) => post('/api/auth/admin/login', ip, { username: 'scope-admin', password });

  it('five failures from one address still lock that address', async () => {
    for (let i = 0; i < 5; i++) expect((await login(ATTACKER_IP, 'wrong')).status).toBe(401);
    expect((await login(ATTACKER_IP, PASSWORD)).status).toBe(423);
  });

  it('does not deny the owner on another address after five anonymous failures', async () => {
    for (let i = 0; i < 5; i++) await login(ATTACKER_IP, 'wrong');
    const res = await login(OWNER_IP, PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: 'scope-admin' });
  });
});
