const { bootTestDb } = require('../integration/helpers/sqliteTestDb');
const originalFetch = global.fetch;
let db, cleanup, workflow, eventId, photoId;
beforeAll(async () => {
  ({ db, cleanup } = await bootTestDb());
  const [event] = await db('events').insert({ slug: 'intent-recovery', event_type: 'project', event_name: 'Recovery', event_date: '2026-10-10', password_hash: 'x', expires_at: new Date(Date.now()+86400000), share_token: 'fixture', share_link: '/gallery/fixture' }).returning('id');
  eventId = event.id ?? event;
  const [photo] = await db('photos').insert({ event_id: eventId, filename: 'a.jpg', path: 'a.jpg', type: 'individual' }).returning('id');
  photoId = photo.id ?? photo;
  process.env.PIXCAKE_BRIDGE_URL = 'http://bridge'; process.env.PIXCAKE_BRIDGE_PASSWORD = 'fixture-password';
  workflow = require('../../src/services/photographyWorkflowBridge');
}, 180000);
afterAll(async () => { global.fetch = originalFetch; await cleanup(); });
afterEach(async () => { await db('workflow_stage_intents').delete(); await db('workflow_withdrawal_intents').delete(); });
test('an offline restore is durable and replayed after reconnection', async () => {
  global.fetch = jest.fn(async () => { throw new Error('offline'); });
  expect((await workflow.restoreWorkflowStage(eventId)).status).toBe(503);
  expect((await db('workflow_stage_intents').first()).stage).toBe('RESTORE');
  global.fetch = jest.fn(async () => ({ status: 200, json: async () => ({ stage: 'EDITING' }) }));
  await workflow.flushWorkflowIntents();
  expect(await db('workflow_stage_intents').first()).toBeUndefined();
  expect(String(global.fetch.mock.calls[0][0])).toContain('/restore');
});
test('a newer desired phase supersedes a failed older phase', async () => {
  global.fetch = jest.fn(async () => ({ status: 503, json: async () => ({}) }));
  await workflow.setWorkflowStage(eventId, 'ARCHIVED');
  await workflow.setWorkflowStage(eventId, 'EDITING');
  expect((await db('workflow_stage_intents').first()).stage).toBe('EDITING');
});
test('lost withdrawal receipts reuse the same operation id', async () => {
  global.fetch = jest.fn(async () => { throw new Error('response lost'); });
  const result = await workflow.withdrawPhotoSelection(eventId, photoId, true);
  expect(result.status).toBe(202);
  const first = await db('workflow_withdrawal_intents').first();
  global.fetch = jest.fn(async () => ({ status: 202, json: async () => ({ processing: true }) }));
  await workflow.flushWorkflowIntents();
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).operation_id).toBe(first.operation_id);
  expect(await db('workflow_withdrawal_intents').first()).toBeDefined();
  global.fetch = jest.fn(async () => ({ status: 202, json: async () => ({ processing: false }) }));
  await workflow.flushWorkflowIntents();
  expect(await db('workflow_withdrawal_intents').first()).toBeUndefined();
});
