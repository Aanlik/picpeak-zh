import { api } from '../config/api';

export interface ExternalEntry {
  name: string;
  type: 'dir' | 'file';
  size?: number;
  mtime?: string;
}

export interface ExternalMediaListResponse {
  path: string;
  entries: ExternalEntry[];
  canNavigateUp: boolean;
}

export interface ExternalMediaImportOptions {
  recursive?: boolean;
  map?: { individual?: string; collages?: string };
}

export interface ExternalMediaImportResult {
  imported: number;
  skipped: number;
  thumbnailsQueued: number;
}

export const externalMediaService = {
  async list(pathRel: string = ''): Promise<ExternalMediaListResponse> {
    const params = new URLSearchParams();
    if (pathRel) params.set('path', pathRel);
    const res = await api.get<ExternalMediaListResponse>(`/admin/external-media/list?${params.toString()}`);
    return res.data;
  },

  async linkEvent(eventId: number, externalPath: string, watch: boolean): Promise<ExternalMediaImportResult> {
    const imported = await this.importEvent(eventId, externalPath, { recursive: true });
    try {
      await api.put(`/admin/events/${eventId}`, { external_watch: watch });
    } catch {
      throw new Error('照片已导入，但自动导入设置未保存。请在项目资料中检查自动导入开关。');
    }
    return imported;
  },

  async importEvent(
    eventId: number,
    externalPath: string,
    options?: ExternalMediaImportOptions
  ): Promise<ExternalMediaImportResult> {
    const res = await api.post<ExternalMediaImportResult>(
      `/admin/external-media/events/${eventId}/import-external`,
      {
        external_path: externalPath,
        recursive: options?.recursive ?? true,
        map: options?.map
      }
    );
    return res.data;
  }
};
