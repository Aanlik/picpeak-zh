import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Photo } from '../../../types';
import { feedbackService } from '../../../services/feedback.service';
import { toast } from 'react-toastify';
import { WorkflowPhotoAction } from '../WorkflowPhotoAction';
import { PhotoCard } from '../PhotoCard';

vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../../services/feedback.service', () => ({ feedbackService: { submitFeedback: vi.fn() } }));
vi.mock('../../../contexts/GuestIdentityContext', () => ({ useGuestIdentityOptional: () => null }));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../common', () => ({ AuthenticatedImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock('react-intersection-observer', () => ({ useInView: () => ({ ref: () => {}, inView: true }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const photo = (overrides: Partial<Photo> = {}) => ({
  id: 42,
  filename: 'IMG_0042.jpg',
  url: '/photo/42',
  type: 'individual',
  size: 1,
  uploaded_at: '2026-01-01T00:00:00Z',
  retouch_workflow_enabled: true,
  retouch_state: 'proof',
  my_color_label: null,
  ...overrides,
} as Photo);

function renderAction(item: Photo, onRequestClick = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onRequestClick,
    ...render(<QueryClientProvider client={queryClient}>
      <WorkflowPhotoAction photo={item} slug="gallery" onRequestClick={onRequestClick} />
    </QueryClientProvider>),
  };
}

describe('customer retouch workflow photo actions', () => {
  it('shows a clear action and toggles the green retouch label', async () => {
    vi.mocked(feedbackService.submitFeedback).mockResolvedValue({ removed: false });
    renderAction(photo());

    fireEvent.click(screen.getByRole('button', { name: 'photographyWorkflow.selectForRetouch' }));

    await waitFor(() => expect(feedbackService.submitFeedback).toHaveBeenCalledWith('gallery', '42', {
      feedback_type: 'color_label', color_label: 'green',
    }));
    expect(await screen.findByRole('button', { name: 'photographyWorkflow.cancelSelection' })).toHaveAttribute('aria-pressed', 'true');
    expect(toast.success).toHaveBeenCalledWith('photographyWorkflow.selectionAdded');
  });

  it('opens the retouch request panel for a delivered photo', () => {
    const onRequestClick = vi.fn();
    renderAction(photo({ retouch_state: 'delivered', retouch_version: 2 }), onRequestClick);

    fireEvent.click(screen.getByRole('button', { name: 'retouchRequest.open' }));

    expect(onRequestClick).toHaveBeenCalledTimes(1);
    expect(feedbackService.submitFeedback).not.toHaveBeenCalled();
  });

  it('renders the workflow action directly on a customer photo card', async () => {
    const item = photo();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}>
      <PhotoCard
        photo={item}
        isSelected={false}
        isSelectionMode={false}
        onClick={vi.fn()}
        onDownload={vi.fn()}
        onToggleSelect={vi.fn()}
        className="photo-card relative"
        overlayBaseClassName="absolute inset-0"
        imageProps={{ src: item.url, alt: item.filename }}
        slug="gallery"
      />
    </QueryClientProvider>);

    expect(await screen.findByRole('button', { name: 'photographyWorkflow.selectForRetouch' })).toBeInTheDocument();
  });
});
