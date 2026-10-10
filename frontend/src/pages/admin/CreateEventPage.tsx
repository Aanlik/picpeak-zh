import { NasFolderSelection } from '../../components/admin/NasFolderSelection';
import { externalMediaService } from '../../services/externalMedia.service';
import { PHOTO_WORKFLOW_MODE } from '../../config/photography';
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  Lock,
  Clock,
  ArrowLeft,
  Palette,
  Eye,
  EyeOff,
  Image,
  Key
} from 'lucide-react';
import { addDays } from 'date-fns';
import { toast } from 'react-toastify';

import { Button, Input, Card, PasswordGenerator, LocalizedDateInput, TimeField } from '../../components/common';
import { ThemeCustomizerEnhanced, GalleryPreview, FeedbackSettings } from '../../components/admin';
import { useMutation, useQuery } from '@tanstack/react-query';
import { eventsService } from '../../services/events.service';
import { useLocalizedDate } from '../../hooks/useLocalizedDate';
import { categoriesService } from '../../services/categories.service';
import { settingsService } from '../../services/settings.service';
import { usePublicSettings } from '../../hooks/usePublicSettings';
import { cssTemplatesService } from '../../services/cssTemplates.service';
import { useTranslation } from 'react-i18next';
import { ThemeConfig, GALLERY_THEME_PRESETS } from '../../types/theme.types';
import { Code } from 'lucide-react';

interface FormData {
  event_name: string;
  event_date: string;
  // Migration 137 — calendar time fields. Defaults to full-day so the
  // existing UX is unchanged for admins who never touch the toggle.
  // When `is_full_day` is true, the time fields are ignored by the
  // backend regardless of their value.
  event_time_start: string;
  event_time_end: string;
  is_full_day: boolean;
  customer_name: string;
  customer_phone: string;
  require_password: boolean;
  password: string;
  confirm_password: string;
  theme_preset: string;
  theme_config: ThemeConfig;
  expires_in_days: number;
  allow_user_uploads: boolean;
  upload_category_id: number | null;
  css_template_id: number | null;
  photo_cap: number;
  feedback_settings: {
    feedback_enabled: boolean;
    allow_ratings: boolean;
    allow_likes: boolean;
    allow_comments: boolean;
    allow_favorites: boolean;
    allow_reactions: boolean;
    allow_color_labels: boolean;
    // Optional, mirroring the shared FeedbackSettings contract — the
    // <FeedbackSettings> editor's onChange emits that shape.
    keybind_mode?: 'colors' | 'lightroom';
    show_feedback_to_guests: boolean;
    identity_mode?: 'simple' | 'guest' | 'shared';
  };
  // Client access (#172)
  client_access_enabled: boolean;
  client_password: string;
  // Default photo sort
  default_photo_sort: string;
}

export const CreateEventPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { format } = useLocalizedDate();
  const isMountedRef = useRef(true);
  // Re-entrancy guard for the create submit. The Button's
  // `disabled={createMutation.isPending}` covers the ordinary double-click, but
  // not a submission that never touches the button (implicit form submission,
  // a programmatic requestSubmit) — those raced two POSTs onto the same slug,
  // one of which 500'd on `events_slug_unique` (QA 7.03).
  const isSubmittingRef = useRef(false);
  const [showThemeCustomizer, setShowThemeCustomizer] = useState(false);
  // const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [formData, setFormData] = useState<FormData>({
    event_name: '',
    event_date: new Date().toISOString().split('T')[0], // Initialize with ISO date format
    event_time_start: '',
    event_time_end: '',
    is_full_day: true,
    customer_name: '',
    customer_phone: '',
    require_password: true,
    password: '',
    confirm_password: '',
    theme_preset: 'default',
    theme_config: GALLERY_THEME_PRESETS.default.config,
    expires_in_days: 30,
    allow_user_uploads: false,
    upload_category_id: null,
    css_template_id: null,
    photo_cap: 0,
    feedback_settings: {
      feedback_enabled: false,
      allow_ratings: true,
      allow_likes: true,
      allow_comments: true,
      allow_favorites: true,
      allow_reactions: true,
      allow_color_labels: false,
      keybind_mode: 'colors',
      show_feedback_to_guests: true,
      identity_mode: 'simple',
    },
    client_access_enabled: false,
    client_password: '',
    default_photo_sort: 'upload_date_desc',
  });

  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [showPassword, setShowPassword] = useState(false);

  // Fetch categories for user upload selection
  const { data: categories } = useQuery({
    queryKey: ['categories', 'global'],
    queryFn: () => categoriesService.getGlobalCategories()
  });

  // Fetch enabled CSS templates
  const { data: cssTemplates } = useQuery({
    queryKey: ['css-templates', 'enabled'],
    queryFn: () => cssTemplatesService.getEnabledTemplates()
  });

  // Fetch default settings
  const { data: settings } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => settingsService.getAllSettings()
  });

  const { data: publicSettings } = usePublicSettings();

  // Get field requirements (default to true if not set)
  const requireCustomerName = publicSettings?.event_require_customer_name !== false;
  const phoneFieldEnabled = publicSettings?.event_phone_field_enabled === true;
  const requireEventDate = publicSettings?.event_require_event_date !== false;
  const requireExpiration = publicSettings?.event_require_expiration !== false;

  // Update default expiration days when settings are loaded
  useEffect(() => {
    if (settings?.general_default_expiration_days) {
      setFormData(prev => ({
        ...prev,
        expires_in_days: settings.general_default_expiration_days
      }));
    }
  }, [settings]);

  // Honour the global "Require password by default" admin setting (#317).
  // Apply once when public settings first load, before the user has interacted.
  const requirePasswordDefaultApplied = useRef(false);
  useEffect(() => {
    if (requirePasswordDefaultApplied.current) return;
    if (publicSettings?.event_default_require_password === undefined) return;
    requirePasswordDefaultApplied.current = true;
    setFormData(prev => ({
      ...prev,
      require_password: publicSettings.event_default_require_password !== false
    }));
  }, [publicSettings]);

  // Honour the global guest-feedback defaults (#520 for the master toggle,
  // #1044 for the per-type ones). Same one-shot apply pattern as
  // require_password above. This form POSTs every sub-toggle explicitly, so
  // seeding them here is what makes the Settings > Events defaults actually
  // reach a gallery created through the UI — the server-side inheritance in
  // feedbackDefaults.js only covers callers that omit them (the v1 API).
  const feedbackEnabledDefaultApplied = useRef(false);
  useEffect(() => {
    if (feedbackEnabledDefaultApplied.current) return;
    if (publicSettings?.event_default_feedback_enabled === undefined) return;
    feedbackEnabledDefaultApplied.current = true;
    setFormData(prev => ({
      ...prev,
      feedback_settings: {
        ...prev.feedback_settings,
        feedback_enabled: publicSettings.event_default_feedback_enabled === true,
        allow_ratings: publicSettings.event_default_allow_ratings !== false,
        allow_likes: publicSettings.event_default_allow_likes !== false,
        allow_favorites: publicSettings.event_default_allow_favorites !== false,
        allow_comments: publicSettings.event_default_allow_comments !== false,
        allow_reactions: publicSettings.event_default_allow_reactions !== false,
        allow_color_labels: publicSettings.event_default_allow_color_labels === true,
        keybind_mode: publicSettings.event_default_keybind_mode === 'lightroom' ? 'lightroom' : 'colors'
      }
    }));
  }, [publicSettings]);

  // Apply the global Branding default theme on first load so admins who set a
  // site-wide default in Branding actually see it on new events (#323).
  // This is the "always inherit colours from Branding" guarantee — every new
  // gallery starts with the site palette unless the admin then picks a preset
  // or hits Sync from Branding inside the customizer to re-pull it later.
  //
  // Track the last theme_config we applied as a stringified hash rather than
  // a boolean ref. React Query can hand us cached (stale) settings on first
  // observer render and then push fresh data once the network call resolves;
  // a boolean ref locks in the stale theme and ignores the fresh one (#323-B
  // / smoke spec 07). With a hash, we re-apply when the source actually
  // changes — including the stale → fresh transition — but skip when nothing
  // new has arrived.
  const lastAppliedThemeHashRef = useRef<string | null>(null);
  useEffect(() => {
    const brandingTheme = settings?.theme_config as ThemeConfig | undefined;
    if (!brandingTheme || Object.keys(brandingTheme).length === 0) return;
    const hash = JSON.stringify(brandingTheme);
    if (lastAppliedThemeHashRef.current === hash) return;
    lastAppliedThemeHashRef.current = hash;

    // Identify which preset (if any) the Branding theme matches. Compare
    // only on the preset's own fields so saved themes carrying extras
    // (e.g. logoUrl preserved through preset changes) still match.
    let matchedPreset = 'custom';
    for (const [key, preset] of Object.entries(GALLERY_THEME_PRESETS)) {
      const keys = Object.keys(preset.config);
      const matches = keys.every((k) =>
        JSON.stringify((preset.config as any)[k]) === JSON.stringify((brandingTheme as any)[k])
      );
      if (matches) {
        matchedPreset = key;
        break;
      }
    }

    setFormData(prev => ({
      ...prev,
      theme_preset: matchedPreset,
      theme_config: brandingTheme
    }));
  }, [settings]);

  const [nasFolder, setNasFolder] = useState('');
  const [nasWatch, setNasWatch] = useState(true);

  const createMutation = useMutation({
    mutationFn: eventsService.createEvent,
    onSuccess: async (data) => {
      if (PHOTO_WORKFLOW_MODE && nasFolder) {
        try { await externalMediaService.linkEvent(data.id, nasFolder, nasWatch); }
        catch { toast.error(t('nasFolder.linkFailedAfterCreate')); }
      }
      if (isMountedRef.current) {
        toast.success(t('toast.eventCreated'));
        navigate(`/admin/events/${data.id}`);
      }
    },
    onError: (error: any) => {
      const errorMessage = t('errors.eventCreationFailed');

      // If validation errors exist, show them
      if (error.response?.data?.errors) {
        const validationErrors = error.response.data.errors;
        validationErrors.forEach((err: any) => {
          toast.error(`${err.param}: ${err.msg}`);
        });
      } else {
        toast.error(errorMessage);
      }
    },
    onSettled: () => {
      isSubmittingRef.current = false;
    },
  });

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {};

    if (!formData.event_name) {
      newErrors.event_name = t('validation.eventNameRequired');
    }

    if (requireEventDate && !formData.event_date) {
      newErrors.event_date = t('validation.eventDateRequired');
    }

    // Conditional validation based on settings
    if (requireCustomerName && !formData.customer_name) {
      newErrors.customer_name = t('validation.hostNameRequired');
    }

    if (formData.require_password) {
      if (!formData.password) {
        newErrors.password = t('validation.passwordRequired');
      } else if (formData.password.length < 6) {
        newErrors.password = t('validation.passwordMinLength');
      } else if (/^\d{1,6}$/.test(formData.password)) {
        // Prevent simple numeric passwords like "123456"
        newErrors.password = t('validation.passwordTooSimple', 'Password cannot be just numbers. Consider using a date format like "04.07.2025"');
      }

      if (formData.password !== formData.confirm_password) {
        newErrors.confirm_password = t('validation.passwordsDoNotMatch');
      }
    }

    if (requireExpiration && (formData.expires_in_days < 1 || formData.expires_in_days > 365)) {
      newErrors.expires_in_days = t('validation.expirationRange');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmittingRef.current) {
      return;
    }

    if (!validateForm()) {
      return;
    }

    const feedbackSettings = formData.feedback_settings;

    const payload = {
      event_name: formData.event_name,
      event_date: formData.event_date || undefined,
      // Migration 137 — calendar time fields. Backend normalises the
      // triple: when is_full_day is true the times are nulled out
      // regardless of value, so it's safe to always send them.
      event_time_start: formData.is_full_day ? undefined : formData.event_time_start,
      event_time_end: formData.is_full_day ? undefined : formData.event_time_end,
      is_full_day: formData.is_full_day,
      customer_name: formData.customer_name,
      ...(phoneFieldEnabled && formData.customer_phone ? { customer_phone: formData.customer_phone.trim() } : {}),
      require_password: formData.require_password,
      password: formData.require_password ? formData.password : undefined,
      color_theme: JSON.stringify(formData.theme_config),
      header_style: formData.theme_config.headerStyle || 'standard',
      hero_divider_style: formData.theme_config.heroDividerStyle || 'wave',
      expiration_days: requireExpiration ? formData.expires_in_days : undefined,
      allow_user_uploads: formData.allow_user_uploads,
      upload_category_id: formData.upload_category_id,
      css_template_id: formData.css_template_id,
      photo_cap: formData.photo_cap > 0 ? formData.photo_cap : null,
      feedback_enabled: feedbackSettings.feedback_enabled,
      allow_ratings: feedbackSettings.allow_ratings,
      allow_likes: feedbackSettings.allow_likes,
      allow_comments: feedbackSettings.allow_comments,
      allow_favorites: feedbackSettings.allow_favorites,
      allow_reactions: feedbackSettings.allow_reactions,
      allow_color_labels: feedbackSettings.allow_color_labels,
      keybind_mode: feedbackSettings.keybind_mode,
      show_feedback_to_guests: feedbackSettings.show_feedback_to_guests,
      // The chooser has always been on this form; the value was never sent, so
      // the gallery came out in the default mode whatever was picked (#1197).
      identity_mode: feedbackSettings.identity_mode,
      // Client access (#172)
      client_access_enabled: formData.client_access_enabled,
      client_password: formData.client_access_enabled ? formData.client_password : undefined,
      // Default photo sort
      default_photo_sort: formData.default_photo_sort,
    };

    isSubmittingRef.current = true;
    createMutation.mutate(payload);
  };

  const handleInputChange = (field: keyof FormData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setFormData({ ...formData, [field]: e.target.value });
    setErrors({ ...errors, [field]: undefined });
  };

  const handleThemeChange = (newTheme: ThemeConfig) => {
    setFormData(prev => ({
      ...prev,
      theme_config: newTheme
    }));
  };

  const handlePresetChange = (presetName: string) => {
    const preset = GALLERY_THEME_PRESETS[presetName];
    if (preset) {
      setFormData(prev => ({
        ...prev,
        theme_preset: presetName,
        theme_config: preset.config
      }));
    }
  };

  const handlePasswordGenerated = (password: string) => {
    setFormData(prev => ({
      ...prev,
      password: password,
      confirm_password: password
    }));

    // Clear password errors since we generated a valid one
    if (errors.password || errors.confirm_password) {
      setErrors(prev => ({
        ...prev,
        password: undefined,
        confirm_password: undefined
      }));
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeft className="w-4 h-4" />}
            onClick={() => navigate('/admin/events')}
          >
            {t('common.back')}
          </Button>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{t('events.create')}</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Event Details */}
        <Card>
          <div className="p-6 space-y-6">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              {t('events.projectInfo', { defaultValue: t('events.eventDetails') })}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label={t('events.eventName')}
                placeholder={t('events.eventNamePlaceholder')}
                value={formData.event_name}
                onChange={handleInputChange('event_name')}
                error={errors.event_name}
                leftIcon={<Calendar className="w-5 h-5" />}
              />

              <LocalizedDateInput
                label={requireEventDate ? t('events.eventDate') : `${t('events.eventDate')} (${t('common.optional')})`}
                value={formData.event_date}
                onChange={(iso) => setFormData(prev => ({ ...prev, event_date: iso }))}
                error={errors.event_date}
              />
            </div>

            {!PHOTO_WORKFLOW_MODE && (<>
            {/* Migration 137 — calendar time fields. Full-day events stay
                full-day; admins who unchecks "Full day" get two HH:MM
                inputs that flow into the events row's event_time_start /
                event_time_end columns and drive how the admin calendar
                renders the event (block vs all-day banner). 15-minute
                snap matches the calendar's drag-create grid. */}
            <div className="mt-3 space-y-2">
              <label className="inline-flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-200">
                <input
                  type="checkbox"
                  checked={formData.is_full_day}
                  onChange={(e) => setFormData({ ...formData, is_full_day: e.target.checked })}
                  className="rounded border-neutral-300 dark:border-neutral-600"
                />
                {t('events.fullDay', 'Full day')}
              </label>
              {!formData.is_full_day && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <TimeField
                    label={t('events.eventTimeStart', 'Start time') as string}
                    value={formData.event_time_start}
                    onChange={(v) => setFormData(prev => ({ ...prev, event_time_start: v }))}
                  />
                  <TimeField
                    label={t('events.eventTimeEnd', 'End time') as string}
                    value={formData.event_time_end}
                    onChange={(v) => setFormData(prev => ({ ...prev, event_time_end: v }))}
                  />
                </div>
              )}
            </div>

            </>)}
          </div>
        </Card>

        {PHOTO_WORKFLOW_MODE && <Card><div className="p-6 space-y-3">
          <h2 className="text-lg font-semibold">{t('nasFolder.titleOptional')}</h2>
          <NasFolderSelection value={nasFolder} onChange={setNasFolder} watch={nasWatch} onWatchChange={setNasWatch} />
        </div></Card>}

        {/* Theme Selection */}
        <Card>
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                <Palette className="w-5 h-5" />
                {t('events.themeAndStyle')}
              </h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowThemeCustomizer(!showThemeCustomizer)}
                leftIcon={showThemeCustomizer ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              >
                {showThemeCustomizer ? t('common.hide') : t('common.customize')}
              </Button>
            </div>

            {/* Quick Theme Preview */}
            {!showThemeCustomizer && (
              <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-neutral-900 dark:text-neutral-100" style={{ fontFamily: formData.theme_config.fontFamily }}>
                    {t(`events.themePresets.${formData.theme_preset}`, { defaultValue: GALLERY_THEME_PRESETS[formData.theme_preset]?.name || t('events.themePresets.custom') })}
                  </h3>
                  <div className="flex gap-2">
                    <div
                      className="w-6 h-6 rounded-full border-2 border-white shadow-sm"
                      style={{ backgroundColor: formData.theme_config.primaryColor }}
                    />
                    <div
                      className="w-6 h-6 rounded-full border-2 border-white shadow-sm"
                      style={{ backgroundColor: formData.theme_config.accentColor }}
                    />
                  </div>
                </div>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  {t('events.galleryLayoutLabel')} <span className="font-medium capitalize">{t(`events.galleryLayouts.${formData.theme_config.galleryLayout || 'grid'}`, { defaultValue: formData.theme_config.galleryLayout || 'grid' })}</span>
                </p>
              </div>
            )}

            {/* Theme Customizer */}
            {showThemeCustomizer && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Theme Customizer */}
                  <ThemeCustomizerEnhanced
                    value={formData.theme_config}
                    onChange={handleThemeChange}
                    presetName={formData.theme_preset}
                    onPresetChange={handlePresetChange}
                    forceColorMode={publicSettings?.branding_force_color_mode ?? null}
                    showGalleryLayouts={true}
                    hideActions={true}
                    onSyncFromBranding={() => {
                      // Pull the 8 colour tokens (+ legacy primary alias) from
                      // the global Branding theme into the current event theme.
                      // Layout / header / typography are kept untouched so an
                      // admin who has already arranged structure can refresh
                      // just the palette.
                      const branding = settings?.theme_config as ThemeConfig | undefined;
                      if (!branding) {
                        toast.error(t('toast.brandingThemeMissing', 'No branding theme has been saved yet.'));
                        return;
                      }
                      setFormData(prev => ({
                        ...prev,
                        theme_preset: 'custom',
                        theme_config: {
                          ...prev.theme_config,
                          primaryColor: branding.primaryColor,
                          accentColor: branding.accentColor,
                          accentDarkColor: branding.accentDarkColor,
                          backgroundColor: branding.backgroundColor,
                          surfaceColor: branding.surfaceColor,
                          elevatedColor: branding.elevatedColor,
                          surfaceBorderColor: branding.surfaceBorderColor,
                          textColor: branding.textColor,
                          mutedTextColor: branding.mutedTextColor,
                          colorMode: branding.colorMode ?? prev.theme_config.colorMode,
                        },
                      }));
                      toast.success(t('toast.brandingPaletteSynced', 'Palette synced from Branding.'));
                    }}
                  />

                  {/* Gallery Preview */}
                  <div className="lg:sticky lg:top-4 lg:h-fit">
                    <GalleryPreview
                      theme={formData.theme_config}
                      className="shadow-lg"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Custom CSS Template Selection */}
            {cssTemplates && cssTemplates.length > 0 && (
              <div className="pt-6 border-t border-neutral-200 dark:border-neutral-700">
                <h3 className="text-md font-semibold text-neutral-900 dark:text-neutral-100 mb-3 flex items-center gap-2">
                  <Code className="w-4 h-4" />
                  {t('events.customCssTemplate', 'Custom CSS Template')}
                </h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
                  {t('events.customCssTemplateDesc', 'Apply a custom CSS template to style the gallery with unique visual effects.')}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {/* No template option */}
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, css_template_id: null })}
                    className={`p-4 rounded-lg border-2 transition-all text-left ${
                      formData.css_template_id === null
                        ? 'tile-selected'
                        : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600'
                    }`}
                  >
                    <div className="font-medium text-sm text-neutral-900 dark:text-neutral-100">{t('events.noTemplate', 'No Template')}</div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                      {t('events.useThemeOnly', 'Use theme preset only')}
                    </div>
                  </button>

                  {/* Available templates */}
                  {cssTemplates.map(template => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, css_template_id: template.id })}
                      className={`p-4 rounded-lg border-2 transition-all text-left ${
                        formData.css_template_id === template.id
                          ? 'tile-selected'
                          : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600'
                      }`}
                    >
                      <div className="font-medium text-sm text-neutral-900 dark:text-neutral-100">{template.name}</div>
                      <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                        {t('events.customTemplate', 'Custom Template')} {template.slot_number}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Access & Security */}
        <Card>
          <div className="p-6 space-y-6">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
              <Lock className="w-5 h-5" />
              {t('events.accessAndSecurity')}
            </h2>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label={requireCustomerName ? t('events.hostName') : `${t('events.hostName')} (${t('common.optional')})`}
                  placeholder={t('events.hostNamePlaceholder')}
                  value={formData.customer_name}
                  onChange={handleInputChange('customer_name')}
                  error={errors.customer_name}
                  leftIcon={<Calendar className="w-5 h-5" />}
                />

              </div>

              {phoneFieldEnabled && (
                <Input
                  type="tel"
                  label={`${t('events.customerPhone', 'Customer Phone')} (${t('common.optional')})`}
                  placeholder={t('events.customerPhonePlaceholder', '+1 555 555 1234')}
                  value={formData.customer_phone}
                  onChange={handleInputChange('customer_phone')}
                />
              )}

            </div>

            <div className="space-y-3">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 w-4 h-4 text-accent border-neutral-300 dark:border-neutral-600 rounded focus:ring-primary-500"
                  checked={formData.require_password}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setFormData(prev => ({
                      ...prev,
                      require_password: checked,
                      password: checked ? prev.password : '',
                      confirm_password: checked ? prev.confirm_password : '',
                    }));
                    if (!checked) {
                      setErrors(prev => ({ ...prev, password: undefined, confirm_password: undefined }));
                    }
                  }}
                />
                <div>
                  <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    {t('events.requirePasswordToggle')}
                  </span>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                    {t('events.requirePasswordToggleHelp', 'Disable this if you want to share the gallery without a password. Anyone with the link will be able to view the photos.')}
                  </p>
                </div>
              </label>

              {!formData.require_password && (
                <div className="rounded-md border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/30 p-3 text-xs text-orange-800 dark:text-orange-300">
                  {t('events.publicGalleryWarning', 'Public galleries are accessible to anyone with the link. Consider enabling download watermarks and monitoring activity.')}
                </div>
              )}
            </div>

            {formData.require_password && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    label={t('events.galleryPassword')}
                    placeholder={t('events.passwordPlaceholder')}
                    value={formData.password}
                    onChange={handleInputChange('password')}
                    error={errors.password}
                    helperText={t('events.passwordHelperText', 'You can use dates like "04.07.2025" or any text with 6+ characters')}
                    leftIcon={<Lock className="w-5 h-5" />}
                    rightIcon={
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="p-1"
                      >
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    }
                  />

                  {/* Password Generator */}
                  <div className="mt-2">
                    <PasswordGenerator
                      eventName={formData.event_name}
                      eventDate={formData.event_date}
                      onPasswordGenerated={handlePasswordGenerated}
                      passwordComplexity="moderate"
                      className="w-full"
                    />
                  </div>
                </div>

                <Input
                  type={showPassword ? 'text' : 'password'}
                  label={t('events.confirmPassword')}
                  placeholder={t('events.confirmPasswordPlaceholder')}
                  value={formData.confirm_password}
                  onChange={handleInputChange('confirm_password')}
                  error={errors.confirm_password}
                  leftIcon={<Lock className="w-5 h-5" />}
                />
              </div>
            )}

            {requireExpiration ? (
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                  {t('events.galleryExpiration')}
                </label>
                <div className="flex items-center gap-2">
                  <div className="w-32">
                    <Input
                      type="number"
                      value={formData.expires_in_days}
                      onChange={handleInputChange('expires_in_days')}
                      error={errors.expires_in_days}
                      min={1}
                      max={365}
                      leftIcon={<Clock className="w-5 h-5" />}
                    />
                  </div>
                  <span className="text-sm text-neutral-600 dark:text-neutral-400">{t('events.daysAfterEvent')}</span>
                </div>
                {formData.event_date && (
                  <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
                    {/* Coerce to Number — handleInputChange stores the
                        <input type="number"> value as a string, and date-fns
                        addDays does `_date.setDate(_date.getDate() + amount)`
                        which string-concatenates (25 + "120" = "25120") and
                        ends up ~68 years in the future. */}
                    {t('events.expiresOn')}: {format(addDays(new Date(formData.event_date), Number(formData.expires_in_days)))}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 p-3">
                <div className="flex items-center gap-2 text-blue-800 dark:text-blue-300">
                  <Clock className="w-4 h-4" />
                  <span className="text-sm font-medium">{t('events.noExpiration', 'No Expiration')}</span>
                </div>
                <p className="mt-1 text-xs text-blue-700 dark:text-blue-400">
                  {t('events.noExpirationHelp', 'This gallery will remain active until manually archived.')}
                </p>
              </div>
            )}

            {/* Photo Cap */}
            <div className="pt-4 border-t border-neutral-200 dark:border-neutral-700">
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                {t('events.photoCap', 'Photo Limit')}
              </label>
              <div className="flex items-center gap-2">
                <div className="w-32">
                  {/* `max` is required, not cosmetic: without it Blink
                      reports the spin button's range as unbounded and the
                      a11y tree exposes aria-valuemax="0" (QA warning), and
                      an out-of-range value only fails at INSERT time. The
                      ceiling is the events.photo_cap column's own — a
                      signed 32-bit integer (migration 074). */}
                  <Input
                    type="number"
                    value={formData.photo_cap}
                    onChange={(e) => setFormData({ ...formData, photo_cap: parseInt(e.target.value) || 0 })}
                    min={0}
                    max={2147483647}
                    leftIcon={<Image className="w-5 h-5" />}
                  />
                </div>
                <span className="text-sm text-neutral-600 dark:text-neutral-400">
                  {t('events.photoCapHelp', 'Maximum number of photos allowed. 0 = unlimited')}
                </span>
              </div>
            </div>

            {/* Default Photo Sort */}
            <div className="pt-4 border-t border-neutral-200 dark:border-neutral-700">
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                {t('photoSort.defaultSort', 'Default Photo Sort')}
              </label>
              <select
                value={formData.default_photo_sort}
                onChange={(e) => setFormData({ ...formData, default_photo_sort: e.target.value })}
                className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-accent-dark"
              >
                <option value="upload_date_desc">{t('photoSort.uploadDateNewest', 'Upload Date (Newest First)')}</option>
                <option value="upload_date_asc">{t('photoSort.uploadDateOldest', 'Upload Date (Oldest First)')}</option>
                <option value="capture_date_desc">{t('photoSort.captureDateNewest', 'Date Taken (Newest First)')}</option>
                <option value="capture_date_asc">{t('photoSort.captureDateOldest', 'Date Taken (Oldest First)')}</option>
                <option value="filename_asc">{t('photoSort.filenameAZ', 'Filename (A-Z)')}</option>
                <option value="filename_desc">{t('photoSort.filenameZA', 'Filename (Z-A)')}</option>
              </select>
            </div>

            {/* Client Access (#172) */}
            <div className="pt-4 border-t border-neutral-200 dark:border-neutral-700">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 w-4 h-4 text-accent border-neutral-300 dark:border-neutral-600 rounded focus:ring-primary-500"
                  checked={formData.client_access_enabled}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    client_access_enabled: e.target.checked,
                    client_password: e.target.checked ? prev.client_password : '',
                  }))}
                />
                <div>
                  <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    {t('clientAccess.enableToggle')}
                  </span>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                    {t('clientAccess.enableDescription')}
                  </p>
                </div>
              </label>

              {formData.client_access_enabled && (
                <div className="mt-3">
                  <Input
                    type="text"
                    label={t('clientAccess.pinLabel')}
                    placeholder={t('clientAccess.pinPlaceholder')}
                    value={formData.client_password}
                    onChange={handleInputChange('client_password')}
                    leftIcon={<Key className="w-5 h-5" />}
                    helperText={t('clientAccess.pinHelperText')}
                  />
                </div>
              )}
            </div>

            {/* User Upload Settings */}
            <div className="pt-4 border-t border-neutral-200 dark:border-neutral-700">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={formData.allow_user_uploads}
                  onChange={(e) => setFormData({ ...formData, allow_user_uploads: e.target.checked })}
                  className="rounded border-neutral-300 dark:border-neutral-600 text-accent focus:ring-primary-500"
                />
                <div>
                  <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    {t('events.allowUserUploads')}
                  </span>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                    {t('events.allowUserUploadsDescription')}
                  </p>
                </div>
              </label>

              {formData.allow_user_uploads && categories && categories.length > 0 && (
                <div className="mt-4 ml-7">
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                    {t('events.uploadCategory')}
                  </label>
                  <select
                    value={formData.upload_category_id || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      upload_category_id: e.target.value ? Number(e.target.value) : null
                    })}
                    className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
                  >
                    <option value="">{t('events.selectCategory')}</option>
                    {categories.map(category => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {t('events.uploadCategoryHelp')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Feedback Settings */}
        <FeedbackSettings
          settings={formData.feedback_settings}
          onChange={(settings) => setFormData(prev => ({ ...prev, feedback_settings: settings }))}
        />

        {/* Form Actions */}
        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate('/admin/events')}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            isLoading={createMutation.isPending}
            disabled={createMutation.isPending}
          >
            {t('events.createEvent')}
          </Button>
        </div>
      </form>
    </div>
  );
};
