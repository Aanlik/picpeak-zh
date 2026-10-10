jest.mock('crypto', () => ({ randomUUID: () => '12345678-1234-4234-8234-123456789abc' }));
const mockBridge = { bridgeConfig: jest.fn(), bridgeRequest: jest.fn() };
jest.mock('../../src/services/photographyWorkflowBridge', () => mockBridge);
const backup = require('../../src/services/workflowBackup');
beforeEach(() => { jest.clearAllMocks(); });
it('keeps standalone backups compatible when Bridge is not configured', async () => {
  mockBridge.bridgeConfig.mockReturnValue(null);
  expect(await backup.checkpoint()).toBeNull();
});
it('fails loudly rather than claiming a complete backup when Bridge is unavailable', async () => {
  mockBridge.bridgeConfig.mockReturnValue({});
  mockBridge.bridgeRequest.mockResolvedValue({ status: 503 });
  await expect(backup.checkpoint()).rejects.toThrow('备份已停止');
});
it('passes the checkpoint token through restore and releases the pause', async () => {
  mockBridge.bridgeConfig.mockReturnValue({});
  mockBridge.bridgeRequest.mockResolvedValueOnce({ status: 200, data: { token: '12345678-1234-4234-8234-123456789abc', state: { version: 1 } } });
  mockBridge.bridgeRequest.mockResolvedValueOnce({ status: 200, data: { success: true } });
  const saved = await backup.checkpoint();
  mockBridge.bridgeRequest.mockResolvedValue({ status: 200 });
  await backup.restore(saved.state, saved);
  expect(mockBridge.bridgeRequest).toHaveBeenCalledWith('/api/state/restore', { method: 'POST', body: saved });
  await backup.release(saved);
});

it('persists an incomplete restore pause before stopping lease renewal', async () => {
  mockBridge.bridgeRequest.mockResolvedValue({ status: 200 });
  const saved = { token: 'checkpoint', timer: setInterval(() => {}, 60000) };
  await backup.hold(saved, '恢复未完成');
  expect(mockBridge.bridgeRequest).toHaveBeenCalledWith('/api/state/block', { method: 'POST', body: { token: 'checkpoint', reason: '恢复未完成' } });
  clearInterval(saved.timer);
});
it('uses a caller-owned ID and confirms restoration before touching data', async () => {
  mockBridge.bridgeConfig.mockReturnValue({});
  mockBridge.bridgeRequest.mockReset()
    .mockResolvedValueOnce({ status: 200, data: { token: '12345678-1234-4234-8234-123456789abc', state: { version: 1 } } })
    .mockResolvedValueOnce({ status: 200, data: { success: true } })
    .mockResolvedValue({ status: 200 });
  const saved = await backup.checkpoint('restore');
  expect(mockBridge.bridgeRequest).toHaveBeenNthCalledWith(1, '/api/state/checkpoint', { method: 'POST', body: { token: saved.token, purpose: 'restore' } });
  expect(mockBridge.bridgeRequest).toHaveBeenNthCalledWith(2, '/api/state/activate', { method: 'POST', body: { token: saved.token } });
  await backup.release(saved);
});
it.each(['prepare', 'activate'])('cancels its own ID after %s response is lost', async (phase) => {
  mockBridge.bridgeConfig.mockReturnValue({});
  mockBridge.bridgeRequest.mockReset();
  if (phase === 'activate') mockBridge.bridgeRequest.mockResolvedValueOnce({ status: 200, data: { token: '12345678-1234-4234-8234-123456789abc', state: { version: 1 } } });
  mockBridge.bridgeRequest.mockResolvedValueOnce({ status: 503 }).mockResolvedValueOnce({ status: 200 });
  await expect(backup.checkpoint('restore')).rejects.toThrow(/已停止/);
  expect(mockBridge.bridgeRequest).toHaveBeenLastCalledWith('/api/state/cancel', { method: 'POST', body: { token: '12345678-1234-4234-8234-123456789abc' } });
});
