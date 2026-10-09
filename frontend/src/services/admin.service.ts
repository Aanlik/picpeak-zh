import { api } from '../config/api';
import i18n from '../i18n/config';

/**
 * Per-flag display labels for activity-log rendering. Values are
 * i18n keys; if a key is missing in the active locale we fall back
 * to a humanised version of the flag name. Kept in sync with
 * `FeatureKey` in services/featureFlags.service.ts.
 */
const FEATURE_FLAG_LABEL_KEY: Record<string, string> = {
  galleries: 'settings.features.galleries.title',
  reminderEmails: 'settings.features.reminderEmails.title',
  messaging: 'settings.features.messaging.title',
  analytics: 'settings.features.analytics.title',
  userManagement: 'settings.features.userManagement.title',
  customerPortal: 'settings.features.customerPortal.title',
};

/**
 * Renders the `feature_flags_updated` activity row using the
 * `metadata.changed = { [flagKey]: { from, to } }` payload the
 * backend writes. One change → "Analytics enabled". Multiple →
 * "3 features updated: Analytics enabled, Messaging disabled, …".
 *
 * Used by both the Dashboard recent-activity widget (via
 * formatActivityMessage below) and the header notification
 * dropdown (via notifications.service.ts).
 */
export function formatFeatureFlagsChanged(
  changed: Record<string, { from: boolean; to: boolean }> | undefined,
): string {
  const t = i18n.t;
  const entries = Object.entries(changed || {});
  if (entries.length === 0) {
    return t('admin.activities.feature_flags_noop', 'Feature flags reviewed (no changes)');
  }
  const pieces = entries.map(([key, change]) => {
    const labelKey = FEATURE_FLAG_LABEL_KEY[key];
    // Humanise unknown keys (camelCase → "Camel Case") so a forward-
    // compat flag added in a newer release still renders something
    // readable on a frontend that doesn't know about it yet.
    const fallback = key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
    const label = labelKey ? (t(labelKey, fallback) as string) : fallback;
    return change.to
      ? (t('admin.activities.feature_enabled', '{{label}} enabled', { label }) as string)
      : (t('admin.activities.feature_disabled', '{{label}} disabled', { label }) as string);
  });
  if (pieces.length === 1) return pieces[0];
  return t('admin.activities.feature_flags_summary', '{{count}} features updated: {{summary}}', {
    count: pieces.length,
    summary: pieces.join(', '),
  }) as string;
}

export interface DashboardStats {
  activeEvents: number;
  expiringEvents: number;
  totalPhotos: number;
  // Real bytes under the storage root — thumbnails, previews, hero
  // renditions, download caches and any managed originals (#1164). Null when
  // the measurement failed, which the UI must show as unavailable rather than
  // substituting `catalogedBytes`: they are different quantities and on a
  // reference-mode install they are wildly different.
  storageUsed: number | null;
  // 'catalog' when the backend is S3 — the objects are in the bucket, so no
  // disk walk was made. 'unavailable' when a local walk was attempted and
  // failed. Distinct because the first is a fact about the install and the
  // second is a fault, and the UI must not claim S3 for a broken measurement.
  storageMeasurement?: 'disk' | 'catalog' | 'unavailable';
  storageBreakdown: {
    originals: number;
    archives: number;
    thumbnails: number;
    previews: number;
    heroes: number;
    watermarks: number;
    uploads: number;
    downloadCache: number;
    externalMedia: number;
    temp: number;
    other: number;
  } | null;
  // The total is a floor: part of the storage root could not be read.
  storagePartial?: boolean;
  // Summed photos.size_bytes — the catalogued size of the originals, which is
  // what this endpoint used to label "storage used". In reference mode those
  // files are on external storage and none of those bytes are local.
  catalogedBytes: number;
  totalViews: number;
  totalDownloads: number;
  viewsTrend: number;
  downloadsTrend: number;
  archivedEvents: number;
  totalEvents: number;
}

export interface SystemHealth {
  overall: 'healthy' | 'warning' | 'error';
  services: {
    database: 'healthy' | 'warning' | 'error';
    email: 'healthy' | 'warning' | 'error';
    storage: 'healthy' | 'warning' | 'error';
    memory: 'healthy' | 'warning' | 'error';
  };
  details: {
    emailQueue: {
      pending: number;
      processable: number;
      stuck: number;
      sent: number;
      failed: number;
    };
    memory: {
      total: number;
      free: number;
      used: number;
      percentage: number;
    };
  };
}

export type ActivityType =
  | "event_created"
  | "photos_uploaded"
  | "event_archived"
  | "archive_restored"
  | "archive_deleted"
  | "archive_downloaded"
  | "email_config_updated"
  | "email_template_updated"
  | "branding_updated"
  | "theme_updated"
  | "bulk_download"
  | "gallery_password_entry"
  | "expiration_warning_viewed"
  | "feedback_settings_updated"
  | "feedback_moderated"
  | "feedback_deleted"
  | "photo_like"
  | "photo_favorite"
  | "photo_rating"
  | "photo_comment"
  | "photo_reaction"
  | "guest_feedback_like"
  | "guest_feedback_favorite"
  | "guest_feedback_rating"
  | "guest_feedback_comment"
  | "guest_feedback_reaction"
  | "word_filter_added"
  | "external_import_completed"
  | "bulk_archive_completed"
  | "event_activated"
  | "event_deactivated"
  | "photo_deleted"
  | "photos_bulk_deleted"
  | "settings_updated"
  | "event_updated"
  | "event_renamed"
  | "event_deleted"
  | "password_changed"
  | "email_resent"
  | "category_created"
  | "category_updated"
  | "category_deleted"
  | "general_settings_updated"
  | "favicon_uploaded"
  | "analytics_settings_updated"
  | "cms_page_updated"
  | "security_settings_updated"
  | "password_reset"
  | "admin_logout"
  | "system_activity"
  | "unknown"
  // Feature flag toggles emit one row per save with the full
  // { changed: { key: { from, to } } } diff in metadata.
  | "feature_flags_updated"
  // Customer portal (#354).
  | "customer_login"
  | "customer_invitation_created"
  | "customer_invitation_accepted"
  | "customer_invitation_cancelled"
  | "customer_password_reset_requested"
  | "customer_password_reset_applied"
  | "customer_password_change"
  | "customer_self_profile_update"
  | "customer_event_access"
  | "customer_updated"
  | "customer_deactivated"
  | "customer_reactivated"
  | "customer_erased"
  // Admin user management (#350).
  | "admin_invitation_created"
  | "admin_invitation_accepted"
  | "admin_invitation_cancelled"
  | "admin_user_updated"
  | "admin_user_deactivated"
  | "admin_password_reset"
  | "admin_profile_updated"
  // Webhooks (#327) + API tokens (#322).
  | "webhook_created"
  | "webhook_updated"
  | "webhook_deleted"
  | "api_token_created"
  | "api_token_revoked"
  // Other recent surfaces missing from the message map.
  | "event_published"
  | "event_logo_uploaded"
  | "event_logo_removed"
  | "bulk_delete_completed"
  | "photo_replaced"
  | "photo_uploaded"
  | "category_hero_updated"
  | "public_site_reset_to_default"
  | "cms_page_logo_uploaded"

export interface Activity {
  id: number;
  type: ActivityType;
  actorType: string;
  actorName: string;
  eventName?: string;
  metadata: Record<string, any>;
  createdAt: string;
}

// ---- Backup-coverage (Stage C of backup-hardening plan) -----------------

export type BackupPathCoverage =
  | 'will-scan'
  | 'skipped-by-toggle'
  | 'skipped-by-feature-flag'
  | 'skipped-by-setting'
  | 'missing-on-disk';

export interface BackupCoveragePath {
  path: string;
  includeInDefault: boolean;
  featureFlag: string | null;
  featureFlagValue: boolean | null;
  displayOrder: number;
  description: string | null;
  existsOnDisk: boolean;
  coverage: BackupPathCoverage;
}

export interface BackupCoverageDatabase {
  mode: 'inline' | 'scheduled-only';
  inlineDumpExplicitlyDisabled: boolean;
  lastDumpAt: string | null;
  lastDumpType: string | null;
  lastDumpSizeBytes: number;
  lastDumpFilePath: string | null;
  lastDumpAgeMs: number | null;
  lastDumpStale: boolean | null;
  ok: boolean;
}

export interface BackupCoverageReport {
  generatedAt: string;
  database: BackupCoverageDatabase;
  paths: BackupCoveragePath[];
  drift: {
    unconfiguredOnDisk: string[];
    expectedNonBackupDirs: string[];
  };
  summary: {
    configuredCount: number;
    willScanCount: number;
    skippedByToggleCount: number;
    skippedByFeatureFlagCount: number;
    skippedBySettingCount: number;
    missingOnDiskCount: number;
    driftCount: number;
    tableMissingFallbackInUse: boolean;
    databaseOk: boolean;
    overallOk: boolean;
  };
}

export interface AdminProfile {
  id: number;
  username: string;
  email: string;
  mustChangePassword?: boolean;
  last_login?: string | null;
  last_login_ip?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AnalyticsData {
  chartData: Array<{
    date: string;
    views: number;
    downloads: number;
    uniqueVisitors: number;
  }>;
  topGalleries: Array<{
    event_name: string;
    slug: string;
    views: number;
    downloads?: number;
    uniqueVisitors?: number;
  }>;
  devices: {
    desktop: number;
    mobile: number;
    tablet: number;
  };
  // Period totals computed via dedicated COUNT queries on the backend
  // (#661 Bug A). Postgres returns these as strings, so callers should
  // coerce via Number() before display. Optional on the type because
  // older backends (pre-#661) didn't always emit it.
  totals?: {
    views: number | string;
    downloads: number | string;
    uniqueVisitors: number | string;
  };
  // Source of the device breakdown — `umami` when API-key auth succeeded,
  // `access_logs` for the local user-agent heuristic fallback (#661 Bug C).
  devicesSource?: 'umami' | 'access_logs';
}

export interface WhatsNewVersion {
  version: string;
  name: string;
  htmlUrl: string;
  publishedAt: string;
  bullets: string[];
}

export interface WhatsNewResponse {
  enabled: boolean;
  hasNews: boolean;
  fromVersion?: string;
  toVersion?: string;
  versions?: WhatsNewVersion[];
}

export const adminService = {
  // Dashboard statistics
  async getDashboardStats(): Promise<DashboardStats> {
    const response = await api.get<DashboardStats>('/admin/dashboard/stats');
    return response.data;
  },

  // Recent activity
  async getRecentActivity(limit: number = 10): Promise<Activity[]> {
    const response = await api.get<Activity[]>('/admin/dashboard/activity', {
      params: { limit }
    });
    return response.data;
  },

  // Analytics data
  async getAnalytics(days: number = 7): Promise<AnalyticsData> {
    const response = await api.get<AnalyticsData>('/admin/dashboard/analytics', {
      params: { days }
    });
    return response.data;
  },

  // System health check
  async getSystemHealth(): Promise<SystemHealth> {
    const response = await api.get<SystemHealth>('/admin/dashboard/health');
    return response.data;
  },

  // After-update "What's New" highlights (per-instance acknowledgement).
  async getWhatsNew(): Promise<WhatsNewResponse> {
    const response = await api.get<WhatsNewResponse>('/admin/system/updates/whatsnew');
    return response.data;
  },

  async markWhatsNewSeen(): Promise<void> {
    await api.post('/admin/system/updates/whatsnew/seen');
  },

  // Backup-coverage diagnostic (Stage C). Answers "what will the
  // next backup actually include / skip / silently miss?" — read-only,
  // no parameters. See backupCoverageService.js for the full report shape.
  async getBackupCoverage(): Promise<BackupCoverageReport> {
    const response = await api.get<{ report: BackupCoverageReport }>(
      '/admin/system-health/backup-coverage',
    );
    return response.data.report;
  },

  // Format activity message
  formatActivityMessage(activity: Activity): string {
    // Feature-flag toggles carry a `changed` diff in metadata. Render
    // it inline so the activity row says what actually flipped, not
    // just "feature_flags_updated".
    if (activity.type === 'feature_flags_updated') {
      return formatFeatureFlagsChanged(activity.metadata?.changed);
    }
    const md = activity.metadata || {};
    const messages: Record<string, string> = {
      'event_created': `New event created: ${activity.eventName || 'Unknown'}`,
      'photos_uploaded': `${md.count || 0} photos uploaded to ${activity.eventName || 'Unknown'}`,
      'event_archived': `Event archived: ${activity.eventName || 'Unknown'}`,
      'event_published': `Event published: ${activity.eventName || md.event_name || 'Unknown'}`,
      'event_logo_uploaded': `Event logo uploaded for ${activity.eventName || 'Unknown'}`,
      'event_logo_removed': `Event logo removed for ${activity.eventName || 'Unknown'}`,
      'archive_restored': `Archive restored: ${activity.eventName || 'Unknown'}`,
      'archive_deleted': `Archive deleted: ${md.event_name || 'Unknown'}`,
      'archive_downloaded': `Archive downloaded: ${activity.eventName || 'Unknown'}`,
      'email_config_updated': 'Email configuration updated',
      'email_template_updated': `Email template updated: ${md.template_key || ''}`,
      'branding_updated': 'Branding settings updated',
      'theme_updated': 'Theme settings updated',
      'bulk_download': `${md.photo_count || 0} photos downloaded from ${activity.eventName || 'Unknown'}`,
      'bulk_delete_completed': `${md.deleted || md.count || 0} events deleted`,
      'gallery_password_entry': `Password entered for ${activity.eventName || 'Unknown'}`,
      'expiration_warning_viewed': `Expiration warning viewed for ${activity.eventName || 'Unknown'}`,
      'photo_replaced': `Photo replaced in ${activity.eventName || 'Unknown'}`,
      'photo_uploaded': `Photo uploaded to ${activity.eventName || 'Unknown'}`,
      'category_hero_updated': `Category hero photo updated`,
      'public_site_reset_to_default': 'Public site reset to default',
      'cms_page_logo_uploaded': `CMS page logo uploaded: ${md.slug || ''}`,
      // Customer portal (#354).
      'customer_login': `Customer logged in: ${md.email || activity.actorName || ''}`,
      'customer_invitation_created': `Customer invitation sent to ${md.email || ''}`,
      'customer_invitation_accepted': `Customer accepted invitation: ${md.email || ''}`,
      'customer_invitation_cancelled': `Customer invitation cancelled: ${md.email || ''}`,
      'customer_password_reset_requested': `Password reset requested for customer ${md.email || ''}`,
      'customer_password_reset_applied': `Customer password reset by admin: ${md.email || ''}`,
      'customer_password_change': `Customer changed their password`,
      'customer_self_profile_update': `Customer updated their profile`,
      'customer_event_access': `Customer opened ${activity.eventName || md.event_slug || 'a gallery'}`,
      'customer_updated': `Customer account updated: ${md.email || ''}`,
      'customer_deactivated': `Customer account deactivated: ${md.email || ''}`,
      'customer_reactivated': `Customer account reactivated: ${md.email || ''}`,
      'customer_erased': `Customer account erased (GDPR): ${md.email || ''}`,
      // Admin user management (#350).
      'admin_invitation_created': `Admin invitation sent to ${md.email || ''}`,
      'admin_invitation_accepted': `Admin accepted invitation: ${md.email || md.username || ''}`,
      'admin_invitation_cancelled': `Admin invitation cancelled: ${md.email || ''}`,
      'admin_user_updated': `Admin user updated: ${md.username || md.email || ''}`,
      'admin_user_deactivated': `Admin user deactivated: ${md.username || md.email || ''}`,
      'admin_password_reset': `Admin password reset by another admin: ${md.username || md.email || ''}`,
      'admin_profile_updated': `Admin ${activity.actorName || ''} updated their profile`,
      // Webhooks (#327) + API tokens (#322).
      'webhook_created': `Webhook created: ${md.name || ''}`,
      'webhook_updated': `Webhook updated: ${md.name || ''}`,
      'webhook_deleted': `Webhook deleted: ${md.name || ''}`,
      'api_token_created': `API token created: ${md.name || ''}`,
      'api_token_revoked': `API token revoked: ${md.name || ''}`,
      // Customers + Admin user mgmt.
      'customer_created_passive': `Passive customer created: ${md.email || ''}`,
      'admin_user_activated': `Admin user activated: ${md.username || ''}`,
      'admin_user_deleted': `Admin user deleted: ${md.username || ''}`,
      // Misc / legacy.
      'bulk_archive_completed': `Bulk archive completed: ${md.count || 0} events archived`,
      'email_queue_flushed': 'Email queue flushed',
      'email_resent': `Creation email resent for ${activity.eventName || ''}`,
      'email_template_created': `Email template created: ${md.template_key || ''}`,
      'event_duplicated': `Event duplicated from ${md.source_event_name || ''}`,
      'feedback_deleted': 'Feedback deleted',
      'feedback_moderated': 'Feedback moderated',
      'feedback_settings_updated': `Feedback settings updated for ${activity.eventName || ''}`,
      'word_filter_added': `Word filter added: ${md.word || ''}`,
    };

    return messages[activity.type] || activity.type;
  },

  // Format bytes to human readable
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  },

  // Change password
  async changePassword(data: { currentPassword: string; newPassword: string }): Promise<void> {
    await api.post('/admin/auth/change-password', data);
  },

  async getAdminProfile(): Promise<AdminProfile> {
    const response = await api.get<AdminProfile>('/admin/auth/profile');
    return response.data;
  },

  async updateAdminProfile(data: { username: string; email?: string }): Promise<AdminProfile> {
    const response = await api.put<{ user: AdminProfile }>('/admin/auth/profile', data);
    return response.data.user;
  }
};
