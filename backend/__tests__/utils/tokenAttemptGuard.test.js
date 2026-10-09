const { _internal: guards } = require('../../src/utils/tokenAttemptGuard');
beforeEach(() => guards.badAttempts.clear());
afterEach(() => jest.restoreAllMocks());

test('guess penalties are isolated by endpoint family', () => {
  for (let i = 0; i < 20; i++) guards.recordBadAttempt('192.0.2.1', 'transfer_uploads');
  expect(guards.isIpLocked('192.0.2.1', 'transfer_uploads')).toBe(true);
  expect(guards.isIpLocked('192.0.2.1', 'customer_invites')).toBe(false);
  expect(guards.isIpLocked('192.0.2.2', 'transfer_uploads')).toBe(false);
});
test('counter memory is bounded even for source-address churn', () => {
  for (let i = 0; i < guards.MAX_BAD_ATTEMPT_IPS + 25; i++) guards.recordBadAttempt(`source-${i}`, 'transfer_uploads');
  expect(guards.badAttempts.size).toBe(guards.MAX_BAD_ATTEMPT_IPS);
});
test('expired addresses are removed without requiring another request from each address', () => {
  const now = Date.now();
  const time = jest.spyOn(Date, 'now').mockReturnValue(now);
  guards.recordBadAttempt('192.0.2.1', 'transfer_uploads');
  time.mockReturnValue(now + 16 * 60 * 1000);
  guards.recordBadAttempt('192.0.2.2', 'transfer_uploads');
  expect(guards.badAttempts.size).toBe(1);
  expect(guards.isIpLocked('192.0.2.1', 'transfer_uploads')).toBe(false);
});
