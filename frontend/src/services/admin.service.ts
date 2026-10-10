import { api } from '../config/api';

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

export interface BackupCoverageReport {
  generatedAt: string;
  database: {
    mode: 'inline' | 'scheduled-only';
    inlineDumpExplicitlyDisabled: boolean;
    lastDumpAt: string | null;
    lastDumpType: string | null;
    lastDumpSizeBytes: number;
    lastDumpFilePath: string | null;
    lastDumpAgeMs: number | null;
    lastDumpStale: boolean | null;
    ok: boolean;
  };
  paths: BackupCoveragePath[];
  drift: { unconfiguredOnDisk: string[]; expectedNonBackupDirs: string[] };
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
  mustChangePassword?: boolean;
  last_login?: string | null;
  last_login_ip?: string | null;
  created_at?: string;
  updated_at?: string;
}

export const adminService = {
  async getBackupCoverage(): Promise<BackupCoverageReport> {
    const response = await api.get<{ report: BackupCoverageReport }>('/admin/system-health/backup-coverage');
    return response.data.report;
  },

  async changePassword(data: { currentPassword: string; newPassword: string }): Promise<void> {
    await api.post('/admin/auth/change-password', data);
  },

  async getAdminProfile(): Promise<AdminProfile> {
    const response = await api.get<AdminProfile>('/admin/auth/profile');
    return response.data;
  },

  async updateAdminProfile(data: { username: string }): Promise<AdminProfile> {
    const response = await api.put<{ user: AdminProfile }>('/admin/auth/profile', data);
    return response.data.user;
  },
};
