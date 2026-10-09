/** The customer picker is only shown when the customer portal is enabled. */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({ t: (k: string, fb?: unknown) => (typeof fb === 'string' ? fb : k) }),
  };
});

let portalEnabled = false;
vi.mock('../../../contexts/FeatureFlagsContext', () => ({
  useFeatureEnabled: () => portalEnabled,
}));

let canCreate = true;
vi.mock('../../../hooks/usePermission', () => ({
  usePermission: () => canCreate,
}));

// The inline create form is exercised by its own suites; stub it here so this
// file keeps testing only the gate + the create affordance.
vi.mock('../InlineCustomerCreate', () => ({
  InlineCustomerCreate: ({ mode }: { mode?: string }) => (
    <div data-testid="inline-create">{mode}</div>
  ),
}));

vi.mock('../../../services/customerAdmin.service', () => ({
  customerAdminService: { search: vi.fn().mockResolvedValue([]) },
}));

import { CustomerAccountPicker } from '../CustomerAccountPicker';

const SEARCH_PLACEHOLDER = 'Search by email, name, or company';
const PORTAL_LABEL = 'Customer accounts';
const CREATE_LINK = '+ Create new customer';

describe('CustomerAccountPicker portal gate (QA S10)', () => {
  beforeEach(() => { canCreate = true; });

  it('still hides itself entirely on the event form when customerPortal is off', () => {
    portalEnabled = false;
    const { container } = render(<CustomerAccountPicker value={[]} onChange={() => {}} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the portal label + help text on the event form when customerPortal is on', () => {
    portalEnabled = true;
    render(<CustomerAccountPicker value={[]} onChange={() => {}} />);

    expect(screen.getByText(PORTAL_LABEL)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toBeInTheDocument();
  });

  it('offers both save modes when the portal is on', () => {
    portalEnabled = true;
    render(<CustomerAccountPicker value={[]} onChange={() => {}} />);

    fireEvent.click(screen.getByText(CREATE_LINK));
    expect(screen.getByTestId('inline-create')).toHaveTextContent('both');
  });

  it('hides the create affordance without customers.create', () => {
    portalEnabled = true;
    canCreate = false;
    render(<CustomerAccountPicker value={[]} onChange={() => {}} />);

    expect(screen.queryByText(CREATE_LINK)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toBeInTheDocument();
  });
});
