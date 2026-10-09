import type { AxiosResponse } from 'axios';
import { api } from '../config/api';
import type {
  GalleryInfo, GalleryData, GalleryStats, ResolvedGalleryIdentifier,
  DownloadJobStatus, DownloadJobState, GalleryPeopleResponse,
} from '../types';
import { normalizeRequirePassword } from '../utils/accessControl';
import { parseContentDispositionFilename } from '../utils/contentDisposition';

// Gallery pages beyond the first are fetched this many at a time (#1357).
const PAGE_FETCH_CONCURRENCY = 4;

// Admin preview (#868): the preview tab carries `?admin_preview=1`. Browser-native
// download navigations (a real `<a href>` / `api.getUri`) bypass the axios request
// interceptor that forwards the flag on API calls, so append it to those URLs
// directly. The httpOnly admin_token cookie authenticates server-side.
function withAdminPreview(url: string): string {
  if (typeof window === 'undefined') return url;
  if (new URLSearchParams(window.location.search).get('admin_preview') !== '1') return url;
  return `${url}${url.includes('?') ? '&' : '?'}admin_preview=1`;
}

// iOS is the only platform whose system share sheet exposes a
// first-party "Save Image" / "Save to Photos" action for files
// shared via navigator.share(). On Android the share sheet only
// lists installed apps that registered an image/* intent — there is no
// built-in save-to-gallery action,
// so the share path produces a useless app-picker for users who
// just wanted to save the photo (#554). UA-sniff is the only signal
// available because feature detection (canShare) is true on both.
//
// The MacIntel + maxTouchPoints clause covers iPadOS 13+ which
// identifies as Mac in navigator.userAgent but supports the same
// share-to-Photos flow as iOS Safari.
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
}

// Counts-only snapshot returned by GET /gallery/:slug/uploads/status.
export interface UploadProcessingStatus {
  total: number;
  pending: number;
  processing: number;
  complete: number;
  failed: number;
}

export interface RetouchRequestSummary {
  id: number;
  photo_id: number;
  request_type: 'revision' | 'additional';
  base_version: number | null;
  customer_message: string;
  status: 'open' | 'moderation' | 'in_progress' | 'waiting_customer' | 'completed' | 'closed';
  photographer_reply: string | null;
  created_at: string;
  updated_at: string;
}

export interface RetouchWorkflowPhoto {
  photo_id: number;
  selected: boolean;
  delivered: boolean;
  current_version: number;
  added_during_editing: boolean;
  ready_for_editing: boolean;
  state: 'proof' | 'selected' | 'editing' | 'delivered';
}

export interface RetouchWorkflow {
  enabled: boolean;
  bridge_available: boolean;
  photos: RetouchWorkflowPhoto[];
  requests: RetouchRequestSummary[];
}

export const galleryService = {
  // Verify share token
  async verifyToken(slug: string, token: string): Promise<{ valid: boolean }> {
    const response = await api.get<{ valid: boolean }>(`/gallery/${slug}/verify-token/${token}`);
    return response.data;
  },

  // Get basic gallery info (no auth required)
  async getGalleryInfo(slug: string, token?: string): Promise<GalleryInfo> {
    const params = token ? { token } : {};
    const response = await api.get<GalleryInfo>(`/gallery/${slug}/info`, { params });
    const data = response.data;
    return {
      ...data,
      requires_password: normalizeRequirePassword((data as any)?.requires_password, true),
    };
  },

  async getRetouchWorkflow(slug: string): Promise<RetouchWorkflow> {
    const response = await api.get<RetouchWorkflow>(`/gallery/${slug}/retouch-workflow`);
    return response.data;
  },

  async submitRetouchRequest(slug: string, photoId: number, payload: {
    request_type: 'revision' | 'additional';
    base_version?: number;
    message: string;
    guest_name?: string;
    guest_email?: string;
  }): Promise<{ request: RetouchRequestSummary; moderation_required: boolean }> {
    const response = await api.post(`/gallery/${slug}/photos/${photoId}/retouch-requests`, payload);
    return response.data;
  },

  // Get gallery photos (requires auth)
  async getGalleryPhotos(
    slug: string,
    filter?: 'liked' | 'favorited' | 'commented' | 'rated' | 'all',
    guestId?: string,
    signal?: AbortSignal
  ): Promise<GalleryData> {
    const params: Record<string, string | number> = { limit: 250, page: 1 };
    if (filter && filter !== 'all') {
      params.filter = filter;
      if (guestId) {
        params.guest_id = guestId;
      }
    }
    const response = await api.get<GalleryData>(`/gallery/${slug}/photos`, { params: { ...params }, signal });
    const data = response.data;
    // Existing filter/folder/lightbox consumers require the complete set.
    // Fetch bounded pages so the API only hydrates feedback and faces for 250
    // photos at once. A cancelled gallery query also cancels later pages.
    const photos = new Map(data.photos.map(photo => [photo.id, photo]));
    let pagination = data.pagination;
    if (pagination?.has_more) {
      const fetchPage = async (page: number) =>
        (await api.get<GalleryData>(`/gallery/${slug}/photos`, { params: { ...params, page }, signal })).data;
      // Page 1 reports the total, so the remaining pages are known up front
      // and fetched a few at a time instead of one round-trip after another.
      const pageSize = pagination.limit || Number(params.limit);
      const lastKnownPage = pagination.total ? Math.ceil(pagination.total / pageSize) : pagination.page + 1;
      const firstPage = pagination.page;
      const pending = Array.from({ length: Math.max(0, lastKnownPage - firstPage) }, (_, i) => firstPage + 1 + i);
      const fetched = new Map<number, GalleryData>();
      await Promise.all(Array.from({ length: Math.min(PAGE_FETCH_CONCURRENCY, pending.length) }, async () => {
        for (let page = pending.shift(); page !== undefined; page = pending.shift()) {
          fetched.set(page, await fetchPage(page));
        }
      }));
      // Insert in page order: the Map keeps the server's sort.
      for (const page of [...fetched.keys()].sort((a, b) => a - b)) {
        const result = fetched.get(page) as GalleryData;
        result.photos.forEach(photo => photos.set(photo.id, photo));
        pagination = result.pagination;
      }
      // Photos added while paging push the total past what page 1 reported.
      while (pagination?.has_more) {
        const next = await fetchPage(pagination.page + 1);
        next.photos.forEach(photo => photos.set(photo.id, photo));
        pagination = next.pagination;
      }
    }
    const normalizedEvent = data?.event
      ? {
          ...data.event,
          require_password: normalizeRequirePassword((data.event as any)?.require_password, true),
        }
      : data.event;
    return {
      ...data,
      photos: [...photos.values()],
      event: normalizedEvent,
    };
  },

  // Processing status for the guest's own uploads (B7). A guest upload is
  // queued — the route answers 202 and getGalleryPhotos only returns rows that
  // finished processing — so this is what tells the gallery whether a photo
  // that has not appeared yet is still in the worker's queue or failed
  // outright. Scoped server-side to the gallery this token unlocked.
  async getUploadStatus(slug: string, uploadIds: string[]): Promise<UploadProcessingStatus> {
    const response = await api.get<UploadProcessingStatus>(`/gallery/${slug}/uploads/status`, {
      params: { ids: uploadIds.join(',') },
    });
    return response.data;
  },

  // Save single photo. iOS routes through the Web Share API so the
  // share sheet's "Save Image" action lands the file in Photos.
  // Everywhere else (Android, desktop) navigates a hidden anchor
  // straight at the download URL — the browser's native download UI
  // shows up immediately and its progress lives in the notification
  // shade. Buffering the blob through fetch first (the original
  // path) added ~5s of dead air on cellular before any visible
  // feedback, prompting users to re-click and produce duplicate
  // downloads (#554 follow-up). Direct navigation eliminates the
  // latency outright rather than masking it with a spinner.
  async savePhotoToDevice(slug: string, photoId: number, filename: string): Promise<void> {
    if (!isIOS()) {
      this.triggerDirectDownload(
        withAdminPreview(api.getUri({ url: `/gallery/${slug}/download/${photoId}` })),
        filename,
      );
      return;
    }

    const fetched = await this.fetchPhotoBlob(slug, photoId);
    const resolvedFilename = fetched.serverFilename || filename;

    // canShare() returns false on browsers without Web Share file
    // support. Probe with a representative File so the negotiation
    // is accurate — `canShare({ files: [] })` returns true on some
    // browsers that don't actually accept files at share() time.
    const file = new File([fetched.blob], resolvedFilename, {
      type: fetched.blob.type || 'image/jpeg',
    });
    const canShareFile =
      typeof navigator !== 'undefined' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] });

    if (canShareFile) {
      try {
        await navigator.share({ files: [file], title: resolvedFilename });
        return;
      } catch (err) {
        // AbortError = user dismissed the share sheet. Don't fall back —
        // they made a choice. Any other failure (NotAllowedError,
        // DataError, etc.) is unexpected; surface a download instead so
        // the user still gets the file.
        if ((err as DOMException)?.name === 'AbortError') return;
      }
    }

    this.triggerBrowserDownload(fetched.blob, resolvedFilename);
  },

  // Fetch the photo as a Blob + the server-suggested filename, falling
  // back to the view endpoint when the original isn't available. Shared
  // between the regular download flow and the Web Share path (#531).
  // The server's Content-Disposition is the source of truth for the
  // filename (#493 — "use original camera filename" toggle reaches disk
  // through this header).
  async fetchPhotoBlob(
    slug: string,
    photoId: number,
  ): Promise<{ blob: Blob; serverFilename: string | null }> {
    const readResponse = (response: AxiosResponse<Blob>) => {
      const headerName =
        response.headers['content-disposition'] || response.headers['Content-Disposition'];
      return {
        blob: response.data,
        serverFilename: parseContentDispositionFilename(headerName),
      };
    };

    try {
      const response = await api.get<Blob>(`/gallery/${slug}/download/${photoId}`, {
        responseType: 'blob',
      });
      return readResponse(response);
    } catch {
      // Fallback: view endpoint when /download isn't available (e.g.
      // the original is missing and only a derivative remains). The
      // view endpoint doesn't emit a download-oriented Content-Disposition,
      // so serverFilename will be null and the caller's name wins.
      const response = await api.get<Blob>(`/gallery/${slug}/photo/${photoId}`, {
        responseType: 'blob',
      });
      return readResponse(response);
    }
  },

  // Trigger a regular browser download via a transient <a download>
  // anchor. Extracted from downloadPhoto so the share-fallback path
  // can reuse it without re-fetching the blob.
  triggerBrowserDownload(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(new Blob([blob]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },

  // Trigger a browser-native download by navigating a hidden anchor at
  // the URL directly. The browser fetches the response itself (showing
  // its own progress UI), so unlike triggerBrowserDownload the JS layer
  // never materialises the bytes. `filename` is a hint; the server's
  // Content-Disposition wins per spec, which is what carries the #493
  // original-camera-filename setting through to disk.
  triggerDirectDownload(href: string, filename: string): void {
    const link = document.createElement('a');
    link.href = href;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
  },

  // Download single photo — kept as the canonical name for the existing
  // grid + lightbox-action callers that haven't been migrated to the
  // share-aware savePhotoToDevice path yet.
  async downloadPhoto(slug: string, photoId: number, filename: string): Promise<void> {
    const fetched = await this.fetchPhotoBlob(slug, photoId);
    this.triggerBrowserDownload(fetched.blob, fetched.serverFilename || filename);
  },

  // Per-photo view beacon (#895). Fired by the lightbox when a photo
  // becomes the visible slide — request-level counting on the image
  // endpoints can't tell the current slide from its preloaded
  // neighbours. Fire-and-forget: view counting must never surface an
  // error to the guest.
  trackPhotoView(slug: string, photoId: number): void {
    api.post(`/gallery/${slug}/photo/${photoId}/view`).catch(() => {});
  },

  // Download all photos as ZIP
  // When a pre-generated zip is available, use native browser download (Content-Length → progress bar).
  // Otherwise fall back to blob download.
  async downloadAllPhotos(slug: string, zipReady?: boolean): Promise<void> {
    if (zipReady) {
      // Native browser download — the server sends Content-Length so
      // the browser shows a real progress bar and mobile doesn't crash.
      const link = document.createElement('a');
      link.href = withAdminPreview(`/api/gallery/${slug}/download-all`);
      link.setAttribute('download', `${slug}.zip`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }

    // Fallback: blob download (no Content-Length, buffered in memory)
    const response = await api.get(`/gallery/${slug}/download-all`, {
      responseType: 'blob',
    });

    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${slug}.zip`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },

  // Trigger one native browser download per selected photo. These are
  // same-origin navigations so the gallery's HttpOnly access cookie and the
  // server's Content-Disposition filename, access checks, and rendition
  // handling remain in force. Creating anchors directly from the click
  // handler also gives Chrome/Edge the best chance to recognize them as
  // user-initiated multiple downloads.
  async downloadSelectedPhotos(slug: string, photoIds: number[], resolution?: string): Promise<void> {
    for (const photoId of new Set(photoIds)) {
      const query = resolution ? `?resolution=${encodeURIComponent(resolution)}` : '';
      const href = withAdminPreview(`/api/gallery/${slug}/download/${photoId}${query}`);
      this.triggerDirectDownload(href, `photo-${photoId}`);
    }
  },

  // ── Custom-resolution downloads (#858) ──────────────────────────────────
  // A non-standard resolution has nothing cached behind it and can take
  // minutes to build, so the server does it as a job we poll rather than
  // holding a request open past the proxy timeout.

  // Kick off a build. `photoIds` omitted = the whole gallery.
  async startDownloadJob(
    slug: string,
    resolution: string,
    photoIds?: number[]
  ): Promise<{ token: string; status: DownloadJobStatus }> {
    const body: Record<string, unknown> = { resolution };
    if (photoIds && photoIds.length) body.photo_ids = photoIds;
    const response = await api.post(`/gallery/${slug}/download-jobs`, body);
    return response.data;
  },

  async getDownloadJob(slug: string, token: string): Promise<DownloadJobState> {
    const response = await api.get(`/gallery/${slug}/download-jobs/${token}`);
    return response.data;
  },

  // Native browser download so the archive streams with Content-Length
  // (real progress bar, no in-memory blob for a multi-GB gallery).
  downloadJobFile(slug: string, token: string, filename: string): void {
    const link = document.createElement('a');
    link.href = withAdminPreview(`/api/gallery/${slug}/download-jobs/${token}/file`);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
  },

  // Toggle photo visibility (client-only)
  async togglePhotoVisibility(slug: string, photoId: number, visibility: 'visible' | 'hidden'): Promise<void> {
    await api.patch(`/gallery/${slug}/photos/${photoId}/visibility`, { visibility });
  },

  // Bulk toggle photo visibility (client-only)
  async bulkToggleVisibility(slug: string, photoIds: number[], visibility: 'visible' | 'hidden'): Promise<void> {
    await api.patch(`/gallery/${slug}/photos/visibility/bulk`, { photoIds, visibility });
  },

  // Get gallery statistics
  async getGalleryStats(slug: string): Promise<GalleryStats> {
    const response = await api.get<GalleryStats>(`/gallery/${slug}/stats`);
    return response.data;
  },

  async resolveIdentifier(identifier: string): Promise<ResolvedGalleryIdentifier> {
    const response = await api.get<ResolvedGalleryIdentifier>(`/gallery/resolve/${identifier}`);
    return response.data;
  },

  /**
   * People detected in this gallery (#1074).
   *
   * Returns an empty list rather than an error when the feature is off, so a
   * guest can't tell "no people here" from "feature disabled". Counts and
   * cover faces are scoped server-side to the photos this viewer may see.
   */
  async getPeople(slug: string): Promise<GalleryPeopleResponse> {
    const response = await api.get<GalleryPeopleResponse>(`/gallery/${slug}/people`);
    return response.data;
  },
};
