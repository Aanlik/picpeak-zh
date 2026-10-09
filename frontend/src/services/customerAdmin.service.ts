/** Admin API for customer accounts and gallery access. */
import { api } from '../config/api';

export interface CustomerAccountSummary {
  id: number;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  salutation: string | null;
  companyName: string | null;
  isActive: boolean;
  isPassive?: boolean;
  lastLogin: string | null;
  createdAt: string;
  eventCount?: number;
}

export interface CustomerAccountDetail extends CustomerAccountSummary {
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  state: string | null;
  countryCode: string | null;
  countryName: string | null;
  preferredLanguage: string;
  notes: string | null;
  events: Array<{
    id: number;
    slug: string;
    eventName: string;
    eventDate: string | null;
    expiresAt: string | null;
    isArchived: boolean;
    assignedAt: string;
  }>;
}

export interface CustomerInvitePrefill {
  salutation?: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  phone?: string;
  company_name?: string;
  address_line1?: string;
  address_line2?: string;
  postal_code?: string;
  city?: string;
  state?: string;
  country_code?: string;
  country_name?: string;
  preferred_language?: string;
}

export interface CustomerInvitationSummary {
  id: number;
  email: string;
  expiresAt: string;
  createdAt: string;
  invitedBy: string | null;
}

type ApiEnvelope<T> = T | { data: T };

function unwrap<T>(value: ApiEnvelope<T>): T {
  return (value as { data?: T }).data ?? value as T;
}

export const customerAdminService = {
  async list(search?: string): Promise<CustomerAccountSummary[]> {
    const response = await api.get<{ customers: CustomerAccountSummary[] }>(
      '/admin/customers',
      { params: search ? { search } : undefined },
    );
    return response.data.customers;
  },

  async search(term: string): Promise<CustomerAccountSummary[]> {
    if (!term.trim()) return [];
    const response = await api.get<{ customers: CustomerAccountSummary[] }>(
      '/admin/customers/search',
      { params: { email: term } },
    );
    return response.data.customers;
  },

  async get(id: number): Promise<CustomerAccountDetail> {
    const response = await api.get<{ customer: CustomerAccountDetail }>(`/admin/customers/${id}`);
    return response.data.customer;
  },

  async update(
    id: number,
    payload: Partial<Omit<CustomerAccountDetail, 'id' | 'events' | 'eventCount'>>,
  ): Promise<CustomerAccountDetail> {
    const fieldMap: Record<string, string> = {
      email: 'email',
      salutation: 'salutation',
      firstName: 'first_name',
      lastName: 'last_name',
      displayName: 'display_name',
      phone: 'phone',
      companyName: 'company_name',
      addressLine1: 'address_line1',
      addressLine2: 'address_line2',
      postalCode: 'postal_code',
      city: 'city',
      state: 'state',
      countryCode: 'country_code',
      countryName: 'country_name',
      preferredLanguage: 'preferred_language',
      notes: 'notes',
      isActive: 'is_active',
    };
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (fieldMap[key]) body[fieldMap[key]] = value;
    }
    const response = await api.put<{ customer: CustomerAccountDetail }>(`/admin/customers/${id}`, body);
    return response.data.customer;
  },

  async deactivate(id: number): Promise<void> {
    await api.post(`/admin/customers/${id}/deactivate`);
  },

  async reactivate(id: number): Promise<void> {
    await api.post(`/admin/customers/${id}/reactivate`);
  },

  async erase(id: number): Promise<void> {
    await api.post(`/admin/customers/${id}/erase`);
  },

  async setEvents(id: number, eventIds: number[]): Promise<{ added: number; removed: number }> {
    const response = await api.put<ApiEnvelope<{ added: number; removed: number }>>(
      `/admin/customers/${id}/events`,
      { event_ids: eventIds },
    );
    return unwrap(response.data);
  },

  async invite(email: string, prefill?: CustomerInvitePrefill): Promise<CustomerInvitationSummary> {
    const response = await api.post<ApiEnvelope<{ invitation: CustomerInvitationSummary }>>(
      '/admin/customers/invite',
      { email, prefill },
    );
    return unwrap(response.data).invitation;
  },

  async listInvitations(): Promise<CustomerInvitationSummary[]> {
    const response = await api.get<{ invitations: CustomerInvitationSummary[] }>('/admin/customers/invitations');
    return response.data.invitations;
  },

  async cancelInvitation(id: number): Promise<void> {
    await api.delete(`/admin/customers/invitations/${id}`);
  },

  async createDirect(email: string, prefill?: CustomerInvitePrefill): Promise<CustomerAccountDetail> {
    const response = await api.post<ApiEnvelope<{ customer: CustomerAccountDetail }>>(
      '/admin/customers',
      { email, prefill },
    );
    return unwrap(response.data).customer;
  },

  async sendInvite(id: number): Promise<CustomerInvitationSummary> {
    const response = await api.post<ApiEnvelope<{ invitation: CustomerInvitationSummary }>>(
      `/admin/customers/${id}/send-invite`,
    );
    return unwrap(response.data).invitation;
  },

  async sendPasswordReset(id: number): Promise<{ email: string; expiresAt: string }> {
    const response = await api.post<ApiEnvelope<{ email: string; expiresAt: string }>>(
      `/admin/customers/${id}/password-reset`,
    );
    return unwrap(response.data);
  },
};
