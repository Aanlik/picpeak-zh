import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotographyWorkflowCard } from '../PhotographyWorkflowCard';
import { api } from '../../../config/api';
vi.mock('../../../config/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('photography workflow summary', () => {
  it('shows actual later selections, revision and cancellation counts', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/requests')
      ? { data: { requests: [] } } as any
      : { data: { configured: true, stage: 'EDITING', connected: true, summary: { '追加选片': 5, '返修': 1, '取消待确认': 2 }, photos: [] } } as any);
    render(<PhotographyWorkflowCard eventId={7} />);
    await waitFor(() => expect(screen.getByText('Added selections')).toBeTruthy());
    expect(screen.getByText('5')).toBeTruthy(); expect(screen.getByText('Revisions')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/admin/photography-workflow/7');
    expect(screen.getByRole('combobox', { name: 'Project stage' })).toBeTruthy();
  });
  it('explains an unlinked project without inventing zero progress', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/requests')
      ? { data: { requests: [] } } as any
      : { data: { configured: false } } as any);
    render(<PhotographyWorkflowCard eventId={8} />);
    await waitFor(() => expect(screen.getByText('This PicPeak project is not connected to a RAW folder yet, so client retouch labels cannot prepare files for the editor.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Connect project' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open photographer workspace' })).toBeNull();
    expect(screen.queryByText('Revisions')).toBeNull();
  });
});
