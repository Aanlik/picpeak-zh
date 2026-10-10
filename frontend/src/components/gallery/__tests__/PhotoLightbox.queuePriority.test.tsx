/**
 * The lightbox mounts three slides (previous, current, next) and each one
 * fetches through the shared image queue. The tier it asks for decides which
 * loads first once the queue is backed up:
 *  - the slide on screen is `high`
 *  - the two neighbours are `prefetch`, so they never take a freed slot ahead
 *    of the image the guest is looking at
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Photo } from '../../../types';
import { feedbackService } from '../../../services/feedback.service';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (k: string, d?: unknown) => (typeof d === 'string' ? d : k) }),
}));
vi.mock('../../../hooks/useDevToolsProtection', () => ({ useDevToolsProtection: () => undefined }));
const { downloadPhoto } = vi.hoisted(() => ({ downloadPhoto: vi.fn() }));
vi.mock('../../../hooks/useGallery', () => ({ useSavePhotoToDevice: () => ({ mutate: downloadPhoto, isPending: false }) }));
vi.mock('../../../hooks/useFeedbackLimitModal', () => ({ useFeedbackLimitModal: () => ({ modal: null, handleError: () => false }) }));
vi.mock('../../../contexts/GuestIdentityContext', () => ({ useGuestIdentityOptional: () => null }));
vi.mock('../../../services/feedback.service', () => ({
  feedbackService: {
    getGalleryFeedbackSettings: vi.fn().mockResolvedValue({ feedback_enabled: false }),
    getPhotoFeedback: vi.fn().mockResolvedValue(null),
    submitFeedback: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('../../../services/gallery.service', () => ({ galleryService: { trackPhotoView: vi.fn() } }));
vi.mock('../../common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../common')>();
  return {
    ...actual,
    AuthenticatedImage: ({ alt, queuePriority }: { alt: string; queuePriority?: string }) => (
      <img alt={alt} data-priority={queuePriority ?? 'normal'} />
    ),
  };
});

import { PhotoLightbox } from '../PhotoLightbox';

vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });

const photos = [1, 2, 3].map((id) => ({ id, filename: `photo-${id}`, url: `/p/${id}`, thumbnail_url: `/t/${id}` } as Photo));
const priorityOf = (filename: string) => screen.getByAltText(filename).getAttribute('data-priority');

describe('PhotoLightbox image queue priority', () => {
  it('fetches the slide on screen as high and its neighbours as prefetch', () => {
    render(<PhotoLightbox photos={photos} initialIndex={1} onClose={vi.fn()} slug="g" />);

    expect(priorityOf('photo-2')).toBe('high');
    expect(priorityOf('photo-1')).toBe('prefetch');
    expect(priorityOf('photo-3')).toBe('prefetch');
  });

  it('follows the opening index, not the slot order', () => {
    render(<PhotoLightbox photos={photos} initialIndex={0} onClose={vi.fn()} slug="g" />);

    expect(priorityOf('photo-1')).toBe('high');
    expect(priorityOf('photo-2')).toBe('prefetch');
    expect(priorityOf('photo-3')).toBe('prefetch');
  });

  it('does not download the open photo when D is pressed', () => {
    downloadPhoto.mockClear();
    render(<PhotoLightbox photos={photos} initialIndex={1} onClose={vi.fn()} slug="g" allowDownloads />);

    fireEvent.keyDown(document, { key: 'd' });

    expect(downloadPhoto).not.toHaveBeenCalled();
  });

  it('asks for a display name when a legacy gallery requires name and email', async () => {
    vi.mocked(feedbackService.getGalleryFeedbackSettings).mockResolvedValue({
      feedback_enabled: true,
      allow_likes: true,
      require_name_email: true,
    });

    render(<PhotoLightbox photos={photos} initialIndex={0} onClose={vi.fn()} slug="g" feedbackEnabled />);

    fireEvent.click(await screen.findByRole('button', { name: 'feedback.like' }));

    expect(feedbackService.submitFeedback).not.toHaveBeenCalled();
    expect(await screen.findByPlaceholderText('Enter your name')).toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });
});
