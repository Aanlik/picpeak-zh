import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../../i18n/config';
import { notificationsService, type Notification } from '../../../services/notifications.service';

const notification = (metadata: Record<string, unknown>): Notification => ({
  id: 1,
  type: 'bulk_archive_completed',
  actorType: 'admin',
  actorName: 'admin',
  eventName: undefined,
  metadata,
  createdAt: '2026-09-01T12:00:00Z',
  isRead: false,
});

describe('popup notification interpolation', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows the successful archive count without a raw placeholder', () => {
    const message = notificationsService.formatNotificationMessage(
      notification({ totalEvents: 5, successfulCount: 4, failedCount: 1 }),
    );
    expect(message).toContain('4');
    expect(message).not.toContain('{{');
  });

  it('uses a safe zero when no count is present', () => {
    const message = notificationsService.formatNotificationMessage(notification({}));
    expect(message).not.toContain('{{');
  });
});
