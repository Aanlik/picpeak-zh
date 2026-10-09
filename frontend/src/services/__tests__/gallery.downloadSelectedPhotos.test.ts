import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/api', () => ({
  api: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

let galleryService: typeof import('../gallery.service').galleryService;
let apiMock: { post: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

describe('galleryService.downloadSelectedPhotos', () => {
  beforeEach(async () => {
    vi.resetModules();
    const services = await import('../gallery.service');
    galleryService = services.galleryService;
    apiMock = (await import('../../config/api')).api as any;
    apiMock.post.mockReset();
    apiMock.get.mockReset();
    vi.spyOn(galleryService, 'triggerDirectDownload').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('starts one native browser download per selected photo without making a ZIP request', async () => {
    await galleryService.downloadSelectedPhotos('wedding-2026', [11, 22, 11, 33]);

    expect(galleryService.triggerDirectDownload).toHaveBeenCalledTimes(3);
    expect(galleryService.triggerDirectDownload).toHaveBeenNthCalledWith(
      1,
      '/api/gallery/wedding-2026/download/11',
      'photo-11',
    );
    expect(galleryService.triggerDirectDownload).toHaveBeenNthCalledWith(
      2,
      '/api/gallery/wedding-2026/download/22',
      'photo-22',
    );
    expect(galleryService.triggerDirectDownload).toHaveBeenNthCalledWith(
      3,
      '/api/gallery/wedding-2026/download/33',
      'photo-33',
    );
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('passes the chosen resolution and admin-preview flag to each single-photo endpoint', async () => {
    window.history.replaceState({}, '', '/gallery/wedding-2026?admin_preview=1');

    await galleryService.downloadSelectedPhotos('wedding-2026', [11, 22], 'web');

    expect(galleryService.triggerDirectDownload).toHaveBeenNthCalledWith(
      1,
      '/api/gallery/wedding-2026/download/11?resolution=web&admin_preview=1',
      'photo-11',
    );
    expect(galleryService.triggerDirectDownload).toHaveBeenNthCalledWith(
      2,
      '/api/gallery/wedding-2026/download/22?resolution=web&admin_preview=1',
      'photo-22',
    );
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('does nothing for an empty selection', async () => {
    await galleryService.downloadSelectedPhotos('wedding-2026', []);

    expect(galleryService.triggerDirectDownload).not.toHaveBeenCalled();
    expect(apiMock.post).not.toHaveBeenCalled();
  });
});
