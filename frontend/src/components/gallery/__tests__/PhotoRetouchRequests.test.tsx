import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Photo } from '../../../types';
import { galleryService } from '../../../services/gallery.service';
import { PhotoRetouchRequests } from '../PhotoRetouchRequests';

vi.mock('../../../services/gallery.service', () => ({
  galleryService: {
    getRetouchWorkflow: vi.fn(),
    submitRetouchRequest: vi.fn(),
  },
}));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => vi.clearAllMocks());

const photo = {
  id: 17, filename: 'DSC00125.JPG', url: '/photo.jpg', size: 1200, uploaded_at: '2026-10-01',
  type: 'individual', retouch_state: 'delivered', retouch_version: 2, retouch_workflow_enabled: true,
} as Photo;

describe('PhotoRetouchRequests', () => {
  it('submits a revision tied to the delivered version and renders request history', async () => {
    vi.mocked(galleryService.getRetouchWorkflow).mockResolvedValue({ enabled: true, bridge_available: true, photos: [], requests: [] });
    vi.mocked(galleryService.submitRetouchRequest).mockResolvedValue({
      moderation_required: false,
      request: { id: 1, photo_id: 17, request_type: 'revision', base_version: 2, customer_message: '请调亮一些', status: 'open', photographer_reply: null, created_at: '', updated_at: '' },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><PhotoRetouchRequests slug="portrait" photo={photo} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Make a request' }));
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: '请调亮一些' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(galleryService.submitRetouchRequest).toHaveBeenCalledWith('portrait', 17, {
      request_type: 'revision', base_version: 2, message: '请调亮一些',
    }));
  });
});
