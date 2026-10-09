import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotoComments } from '../PhotoComments';
import { feedbackService } from '../../../services/feedback.service';
import { toast } from 'react-toastify';

vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key === 'feedback.commentSubmittedForModeration' ? '评论已提交，审核通过后将显示' : key }),
}));
vi.mock('../../../services/feedback.service', () => ({ feedbackService: { submitFeedback: vi.fn() } }));
vi.mock('react-toastify', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('comment moderation toast', () => {
  it('shows the localized moderation notice instead of an API English message', async () => {
    vi.mocked(feedbackService.submitFeedback).mockResolvedValue({
      success: true,
      moderation_required: true,
      message: 'Your comment has been submitted for moderation',
    } as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}>
      <PhotoComments photoId="21" gallerySlug="gallery" comments={[]} isEnabled requireNameEmail={false} showToGuests />
    </QueryClientProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'feedback.addComment' }));
    fireEvent.change(screen.getByPlaceholderText('feedback.writeComment'), { target: { value: '请精修这张照片' } });
    fireEvent.click(screen.getByRole('button', { name: 'feedback.submit' }));

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('评论已提交，审核通过后将显示'));
    expect(toast.info).not.toHaveBeenCalledWith('Your comment has been submitted for moderation');
  });
});
