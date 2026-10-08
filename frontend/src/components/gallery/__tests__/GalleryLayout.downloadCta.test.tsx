/**
 * The batch-selection CTA must survive every header style.
 *
 * Download All remains a separate action. The always-visible header action
 * enters batch-selection mode and must never call the download handler.
 *
 * 'none' means "no title header", not "no gallery actions".
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HeaderStyleType } from '../../../types/theme.types';

import { GalleryLayout } from '../GalleryLayout';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: any) => (typeof second === 'string' ? second : key),
      i18n: { language: 'en' },
    }),
  };
});

vi.mock('../../../contexts/ThemeContext', async () => {
  const actual = await vi.importActual<typeof import('../../../contexts/ThemeContext')>(
    '../../../contexts/ThemeContext'
  );
  return { ...actual, useTheme: () => ({ theme: {} }) };
});

vi.mock('../../../services/cms.service', () => ({
  cmsService: { getPublicPage: vi.fn().mockRejectedValue(new Error('no cms')) },
}));

const renderLayout = (headerStyle: HeaderStyleType) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onDownloadAll = vi.fn();
  const onToggleSelectionMode = vi.fn();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <GalleryLayout
          event={{ event_name: 'ZZTEST Wedding' }}
          headerStyle={headerStyle}
          showDownloadAll={false}
          onDownloadAll={onDownloadAll}
          showHeaderSelection
          onToggleSelectionMode={onToggleSelectionMode}
          showLogout
          onLogout={vi.fn()}
        >
          <div>photos</div>
        </GalleryLayout>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('GalleryLayout header batch-selection CTA', () => {
  it.each<HeaderStyleType>(['standard', 'minimal', 'hero', 'none', 'banner'])(
    'renders the batch-selection CTA with headerStyle "%s"',
    (headerStyle) => {
      const { unmount } = renderLayout(headerStyle);
      expect(screen.getAllByRole('button', { name: 'gallery.batchSelect' }).length).toBeGreaterThan(0);
      unmount();
    }
  );

  it('toggles batch selection without downloading the gallery', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onDownloadAll = vi.fn();
    const onToggleSelectionMode = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <GalleryLayout
            event={{ event_name: 'ZZTEST Wedding' }}
            headerStyle="standard"
            showDownloadAll={false}
            onDownloadAll={onDownloadAll}
            showHeaderSelection
            onToggleSelectionMode={onToggleSelectionMode}
            showLogout
            onLogout={vi.fn()}
          >
            <div>photos</div>
          </GalleryLayout>
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'gallery.batchSelect' }));
    expect(onToggleSelectionMode).toHaveBeenCalledOnce();
    expect(onDownloadAll).not.toHaveBeenCalled();
  });

  it('omits the CTA when the gallery does not allow downloads', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <GalleryLayout
            event={{ event_name: 'ZZTEST Wedding' }}
            headerStyle="none"
            showDownloadAll={false}
            showHeaderSelection={false}
            onToggleSelectionMode={vi.fn()}
            showLogout
            onLogout={vi.fn()}
          >
            <div>photos</div>
          </GalleryLayout>
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(screen.queryByRole('button', { name: 'gallery.batchSelect' })).not.toBeInTheDocument();
  });
});
