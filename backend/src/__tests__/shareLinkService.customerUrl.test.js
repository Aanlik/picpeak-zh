const mockGetFrontendBaseUrl = jest.fn();

jest.mock('../database/db', () => ({ db: jest.fn() }));
jest.mock('../utils/frontendUrl', () => ({
  getFrontendBaseUrl: mockGetFrontendBaseUrl,
  isLoopbackBase: (value) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])(?=[:/?#]|$)/i.test(value || ''),
}));

const { resolveShareLinkUrl } = require('../services/shareLinkService');

describe('resolveShareLinkUrl', () => {
  beforeEach(() => mockGetFrontendBaseUrl.mockReset());

  it('uses the configured customer address for a stored relative gallery path', async () => {
    mockGetFrontendBaseUrl.mockResolvedValue('https://customers.example.com');

    await expect(resolveShareLinkUrl('/gallery/session/token'))
      .resolves.toBe('https://customers.example.com/gallery/session/token');
  });

  it('uses the configured customer address instead of the admin browser origin', async () => {
    mockGetFrontendBaseUrl.mockResolvedValue('https://customers.example.com');

    await expect(resolveShareLinkUrl('/gallery/session/token', {
      requestOrigin: 'http://192.168.1.12:3000',
    })).resolves.toBe('https://customers.example.com/gallery/session/token');
  });

  it('reanchors an existing absolute link after the customer address changes', async () => {
    mockGetFrontendBaseUrl.mockResolvedValue('https://new-customers.example.com');

    await expect(resolveShareLinkUrl('https://old.example.com/gallery/session/token?view=1#top'))
      .resolves.toBe('https://new-customers.example.com/gallery/session/token?view=1#top');
  });

  it('uses the browser origin as a fallback when no customer address is configured', async () => {
    mockGetFrontendBaseUrl.mockResolvedValue('');

    await expect(resolveShareLinkUrl('/gallery/session/token', {
      requestOrigin: 'http://192.168.1.12:3000',
    })).resolves.toBe('http://192.168.1.12:3000/gallery/session/token');
  });

  it('keeps an existing reachable absolute URL when no customer address is configured', async () => {
    mockGetFrontendBaseUrl.mockResolvedValue('');

    await expect(resolveShareLinkUrl('https://legacy.example.com/gallery/session/token', {
      requestOrigin: 'http://192.168.1.12:3000',
    })).resolves.toBe('https://legacy.example.com/gallery/session/token');
  });

  it('reanchors a loopback legacy URL to the browser origin when no setting exists', async () => {
    mockGetFrontendBaseUrl.mockResolvedValue('');

    await expect(resolveShareLinkUrl('http://localhost:3000/gallery/session/token', {
      requestOrigin: 'http://192.168.1.12:3000',
    })).resolves.toBe('http://192.168.1.12:3000/gallery/session/token');
  });
});
