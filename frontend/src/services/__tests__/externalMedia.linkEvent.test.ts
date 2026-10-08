import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../config/api';
import { externalMediaService } from '../externalMedia.service';
vi.mock('../../config/api', () => ({ api: { post: vi.fn(), put: vi.fn() } }));
describe('NAS association partial failures', () => {
  beforeEach(() => vi.clearAllMocks());
  it('does not change watch settings when import fails', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('permission denied'));
    await expect(externalMediaService.linkEvent(1, 'Camera/shoot', true)).rejects.toThrow('permission denied');
    expect(api.put).not.toHaveBeenCalled();
  });
  it('reports an already completed import separately from a failed watcher update', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { imported: 2, skipped: 0 } });
    vi.mocked(api.put).mockRejectedValueOnce(new Error('permission denied'));
    await expect(externalMediaService.linkEvent(1, 'Camera/shoot', true)).rejects.toThrow('照片已导入');
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('allows importing without automatically watching', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { imported: 0, skipped: 2 } });
    vi.mocked(api.put).mockResolvedValueOnce({ data: {} });
    expect((await externalMediaService.linkEvent(1, 'Camera/shoot', false)).skipped).toBe(2);
    expect(api.put).toHaveBeenCalledWith('/admin/events/1', { external_watch: false });
  });
});
