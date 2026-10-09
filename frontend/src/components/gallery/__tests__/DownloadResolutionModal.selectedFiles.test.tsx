import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { galleryServiceMock, toastMock } = vi.hoisted(() => ({
  galleryServiceMock: {
    downloadSelectedPhotos: vi.fn().mockResolvedValue(undefined),
    downloadAllPhotos: vi.fn(),
    startDownloadJob: vi.fn(),
    getDownloadJob: vi.fn(),
    downloadJobFile: vi.fn(),
  },
  toastMock: { info: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../services/gallery.service', () => ({ galleryService: galleryServiceMock }));
vi.mock('react-toastify', () => ({ toast: toastMock }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => typeof fallback === 'string' ? fallback : key,
  }),
}));
vi.mock('../../common', () => ({
  Button: ({ children, leftIcon: _leftIcon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { leftIcon?: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  Card: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

import { DownloadResolutionModal } from '../DownloadResolutionModal';

afterEach(() => vi.clearAllMocks());

describe('DownloadResolutionModal selected files', () => {
  it('downloads each selected photo at the chosen resolution without starting a ZIP job', async () => {
    const onClose = vi.fn();
    render(
      <DownloadResolutionModal
        slug="wedding-2026"
        choices={[{ id: 'web', label: 'Web size' }] as any}
        photoIds={[11, 22]}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    expect(galleryServiceMock.downloadSelectedPhotos).toHaveBeenCalledWith('wedding-2026', [11, 22], 'web');
    expect(galleryServiceMock.startDownloadJob).not.toHaveBeenCalled();
    expect(galleryServiceMock.downloadJobFile).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(toastMock.info).toHaveBeenCalledWith('gallery.downloadStarted');
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
