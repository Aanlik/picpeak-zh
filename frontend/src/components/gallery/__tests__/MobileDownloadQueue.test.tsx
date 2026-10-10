import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MobileDownloadQueue } from '../MobileDownloadQueue';
import { MOBILE_DOWNLOAD_EVENT } from '../../../utils/mobileDownloads';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
it('shows separate native download links and never reports unverified save success', () => {
  const { unmount } = render(<MobileDownloadQueue />);
  act(() => window.dispatchEvent(new CustomEvent(MOBILE_DOWNLOAD_EVENT, { detail: [
    { photoId: 1, href: '/api/gallery/shoot/download/1' },
    { photoId: 2, href: '/api/gallery/shoot/download/2' },
  ] })));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  const links = screen.getAllByRole('link');
  expect(links).toHaveLength(2);
  expect(links[0]).toHaveAttribute('download');
  expect(links[1]).toHaveAttribute('href', '/api/gallery/shoot/download/2');
  fireEvent.click(screen.getByRole('button'));
  expect(screen.queryByRole('dialog')).toBeNull();
  unmount();
});
