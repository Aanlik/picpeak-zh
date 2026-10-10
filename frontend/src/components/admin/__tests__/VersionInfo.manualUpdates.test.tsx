import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key }),
}));

vi.mock('../../../config/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ data: { backend: '3.134.1', frontend: '3.134.1', node: 'v22', environment: 'production', channel: 'stable' } }) },
}));

import { api } from '../../../config/api';
import { VersionInfo } from '../VersionInfo';

describe('VersionInfo manual update policy', () => {
  it('shows installed versions without querying upstream update availability', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><VersionInfo /></QueryClientProvider>);

    await waitFor(() => expect(screen.getByText((_, element) => element?.textContent === 'Frontend v3.134.1')).toBeInTheDocument());

    expect(api.get).toHaveBeenCalledWith('/admin/system/version');
    expect(api.get).not.toHaveBeenCalledWith('/admin/system/updates');
    expect(screen.queryByText(/available/i)).not.toBeInTheDocument();
  });
});
