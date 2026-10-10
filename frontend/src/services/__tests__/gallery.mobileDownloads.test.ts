import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MOBILE_DOWNLOAD_EVENT } from '../../utils/mobileDownloads';
vi.mock('../../config/api', () => ({ api: { get: vi.fn(), getUri: vi.fn(({ url }) => `/api${url}`) } }));
import { api } from '../../config/api';
import { galleryService } from '../gallery.service';

describe('mobile download safety', () => {
  beforeEach(() => { vi.clearAllMocks(); window.history.replaceState({}, '', '/'); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  it.each(['iPhone Safari', 'Android Chrome', 'iPhone MicroMessenger', 'Android MicroMessenger'])('%s queues separate taps instead of silently blocked multi-downloads', async (userAgent) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    const receive = vi.fn(); window.addEventListener(MOBILE_DOWNLOAD_EVENT, receive);
    const direct = vi.spyOn(galleryService, 'triggerDirectDownload').mockImplementation(() => {});
    await galleryService.downloadSelectedPhotos('shoot', [1, 2, 1], 'web');
    expect(direct).not.toHaveBeenCalled();
    expect(receive.mock.calls[0][0].detail).toEqual([
      { photoId: 1, href: '/api/gallery/shoot/download/1?resolution=web' },
      { photoId: 2, href: '/api/gallery/shoot/download/2?resolution=web' },
    ]);
    window.removeEventListener(MOBILE_DOWNLOAD_EVENT, receive);
  });
  it.each([401, 403, 429, 500])('does not mask HTTP %s as a preview download', async (status) => {
    const error = { response: { status } };
    vi.mocked(api.get).mockRejectedValueOnce(error);
    await expect(galleryService.fetchPhotoBlob('shoot', 1)).rejects.toBe(error);
    expect(api.get).toHaveBeenCalledTimes(1);
  });
  it('only falls back for a missing original and preserves the server filename', async () => {
    vi.mocked(api.get).mockRejectedValueOnce({ response: { status: 404 } }).mockResolvedValueOnce({
      data: new Blob(['photo'], { type: 'image/jpeg' }), headers: { 'content-disposition': 'attachment; filename="DSC00125.JPG"' },
    });
    const result = await galleryService.fetchPhotoBlob('shoot', 1);
    expect(result.serverFilename).toBe('DSC00125.JPG');
    expect(api.get).toHaveBeenLastCalledWith('/gallery/shoot/photo/1', { responseType: 'blob' });
  });
  it('keeps the blob URL alive long enough for Safari to consume it', () => {
    vi.useFakeTimers();
    window.URL.createObjectURL = vi.fn(() => 'blob:test');
    window.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blob = new Blob(['photo'], { type: 'image/jpeg' });
    galleryService.triggerBrowserDownload(blob, 'DSC00125.JPG');
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60000);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});
