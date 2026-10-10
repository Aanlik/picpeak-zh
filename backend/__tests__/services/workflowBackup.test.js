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
  mockBridge.bridgeRequest.mockResolvedValueOnce({ status: 200, data: { token: 'checkpoint', state: { version: 1 } } });
  const saved = await backup.checkpoint();
  mockBridge.bridgeRequest.mockResolvedValue({ status: 200 });
  await backup.restore(saved.state, saved);
  expect(mockBridge.bridgeRequest).toHaveBeenCalledWith('/api/state/restore', { method: 'POST', body: saved });
  await backup.release(saved);
});
