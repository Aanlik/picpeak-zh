import { api } from '../config/api';

export type FeatureKey =
  | 'galleries'
  | 'reminderEmails'
  | 'messaging'
  | 'analytics'
  | 'userManagement'
  // Customer-side portal surface (#354). Gates /customer/* routes
  // (login, dashboard, profile, accept-invite, reset-password) and
  // the Accounts sub-page under Clients in the admin UI.
  | 'customerPortal'
  // Live Slideshow ("Diashow") — per-event fullscreen kiosk link + presets +
  // global watermark settings tab. Strictly opt-in; gates all slideshow UI.
  | 'slideshow'
  // PicTransfer (migration 170) — cross-event file transfers:
  // a token-protected recipient download link plus an optional client-upload
  // channel. Strictly opt-in; gates the sidebar entry, the /admin/transfers
  // area and every transfer route (admin + public).
  | 'transfers'
  // Workflow / automation engine — admin-configurable visual flows (triggers,
  // conditions, branches, loops, approval gates) built on a canvas. Strictly
  // opt-in; gates the Workflows admin area and the engine runtime.
  | 'workflows'
  // Face recognition — "People in this gallery" (migration 177, #1074).
  // Requires the optional picpeak-ml sidecar container. THIS FLAG IS THE
  // GATE for the whole feature: the backend's FACE_ML_URL has a working
  // default, so the sidecar's presence can't be detected from config alone.
  // While this is off, no face UI renders anywhere — no admin panel, no
  // people strip, no lightbox chips — and the backend never contacts the
  // sidecar. Face embeddings are biometric data (GDPR Art. 9); turning this
  // on is only the first of two deliberate actions, since detection is still
  // enabled per event.
  | 'faces'
  ;

export type FeatureFlags = Record<FeatureKey, boolean>;

export const featureFlagsService = {
  async get(): Promise<FeatureFlags> {
    const response = await api.get<FeatureFlags>('/admin/feature-flags');
    return response.data;
  },

  async update(flags: Partial<FeatureFlags>): Promise<FeatureFlags> {
    const response = await api.put<FeatureFlags>('/admin/feature-flags', flags);
    return response.data;
  },
};
