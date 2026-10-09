import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotographyWorkflowCard } from '../PhotographyWorkflowCard';
import { api } from '../../../config/api';
vi.mock('../../../config/api', () => ({ api: { get: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('photography workflow summary', () => {
  it('shows actual later selections, revision and cancellation counts', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { stage: 'EDITING', connected: true, summary: { '追加选片': 5, '返修': 1, '取消待确认': 2 } } });
    render(<PhotographyWorkflowCard eventId={7} />);
    await waitFor(() => expect(screen.getByText('追加选片')).toBeTruthy());
    expect(screen.getByText('5')).toBeTruthy(); expect(screen.getByText('返修')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/admin/photography-workflow/7');
  });
  it('explains an unlinked project without inventing zero progress', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { configured: false, bridge_url: 'http://192.168.1.12:8080' } });
    render(<PhotographyWorkflowCard eventId={8} />);
    await waitFor(() => expect(screen.getByText('This PicPeak project is not connected to a RAW folder yet, so client retouch labels cannot prepare files for the editor.')).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Open photographer workspace' }).getAttribute('href')).toBe('http://192.168.1.12:8080');
    expect(screen.queryByText('返修')).toBeNull();
  });
});
