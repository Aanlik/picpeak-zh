const request = require('supertest');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { bootTestDb, seedMinimal, assignAdminRole, buildRouteApp } = require('../integration/helpers/sqliteTestDb');

let db, cleanup, adminId, eventId, apps, revocation;
const slug = 'logout-revocation';
const cases = [
  ['auth', '/logout', 'admin', 'admin_token'],
  ['auth', '/gallery/logout', 'gallery', `gallery_token_${slug}`],
  ['adminAuth', '/logout', 'admin', 'admin_token'],
];
const sign = type => jwt.sign({
  type, ...(type === 'admin' ? { id: adminId } : { eventId, eventSlug: slug }),
  jti: randomUUID(),
}, process.env.JWT_SECRET, { issuer: 'picpeak-auth' });

beforeAll(async () => {
  ({ db, cleanup } = await bootTestDb());
  ({ adminId } = await seedMinimal(db));
  await assignAdminRole(db, adminId);
  const event = await require('../../src/services/eventCreationService').createEvent({
    event_type: 'project', event_name: 'Logout revocation', event_date: '2026-10-01',
    slug, password: 'Logout-Strong-Password-924!', expiration_days: 30,

  }, { actor: { id: adminId }, source: 'v1' });
  eventId = event.id;
  await db('events').where({ id: eventId }).update({ slug });
  revocation = require('../../src/utils/tokenRevocation');
  apps = Object.fromEntries(['auth', 'adminAuth'].map(name => [
    name, buildRouteApp('/', require(`../../src/routes/${name}`)),
  ]));
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  await require('../../src/services/serviceShutdown').stopServices();
  if (cleanup) await cleanup();
});

it.each(cases)('%s%s revokes a no-expiry %s cookie session', async (route, path, type, cookie) => {
  const token = sign(type);
  const sessionApp = apps.auth;
  const sessionPath = type === 'gallery' ? `/session?slug=${slug}` : '/session';
  const session = () => request(sessionApp).get(sessionPath).set('Cookie', `${cookie}=${token}`);
  const before = await session();
  expect(before.status).toBe(200);
  expect(before.body.valid).toBe(true);

  const res = await request(apps[route]).post(path).set('Cookie', `${cookie}=${token}`).send({ slug });
  expect(res.status).toBe(200);
  expect(res.headers['set-cookie'].some(value => value.startsWith(`${cookie}=;`))).toBe(true);
  await revocation.cleanupExpiredRevocations();
  expect(await revocation.isTokenRevoked(jwt.decode(token))).toBe(true);
  const after = await session();
  expect(after.body.valid).toBe(false);
});

it.each(cases)('%s%s reports failed persistence for %s logout and clears its cookie', async (route, path, type, cookie) => {
  const token = sign(type);
  const realQuery = db.client.query;
  jest.spyOn(db.client, 'query').mockImplementation(function (connection, query) {
    if (/^insert into [`"]revoked_tokens[`"]/.test(query.sql)) {
      return Promise.reject(new Error('simulated revocation write failure'));
    }
    return realQuery.call(this, connection, query);
  });
  const res = await request(apps[route]).post(path).set('Cookie', `${cookie}=${token}`).send({ slug });
  expect(res.status).toBe(500);
  expect(res.body.error).toBeTruthy();
  expect(res.body.message).not.toBe('Logged out successfully');
  expect(res.headers['set-cookie'].some(value => value.startsWith(`${cookie}=;`))).toBe(true);
  expect(await revocation.isTokenRevoked(jwt.decode(token))).toBe(false);
});
