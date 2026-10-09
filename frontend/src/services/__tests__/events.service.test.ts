import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/api', () => ({ api: { get: vi.fn() } }));

import { api } from '../../config/api';
import { eventsService } from '../events.service';

describe('eventsService.getEvents response normalization', () => {
  beforeEach(() => vi.mocked(api.get).mockReset());

  it('preserves the current API event id and name fields', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { events: [{ id: 12, event_name: 'Studio session', photo_count: 7 }], pagination: {} },
    } as any);

    const result = await eventsService.getEvents();

    expect(result.events[0]).toMatchObject({ id: 12, event_name: 'Studio session', photo_count: 7 });
  });

  it('accepts legacy camelCase ids and labels from a mismatched API response', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { events: [{ eventId: '15', eventName: 'Imported session', photoCount: '4' }], pagination: {} },
    } as any);

    const result = await eventsService.getEvents();

    expect(result.events[0]).toMatchObject({ id: 15, event_name: 'Imported session', photo_count: 4 });
  });

  it('rejects incomplete records so open and delete actions cannot target an undefined id', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { events: [{ event_name: 'Missing id' }], pagination: {} },
    } as any);

    await expect(eventsService.getEvents()).rejects.toThrow(/incomplete project record/i);
  });
});
