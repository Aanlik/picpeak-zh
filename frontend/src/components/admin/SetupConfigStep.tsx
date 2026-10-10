import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Button, Input } from '../common';
import { settingsService } from '../../services/settings.service';
import { isAbsoluteHttpUrl } from '../../utils/url';

interface Props { onDone: () => void; }

export const SetupConfigStep: React.FC<Props> = ({ onDone }) => {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [siteUrl, setSiteUrl] = useState(window.location.origin.replace(/\/+$/, ''));
  const [error, setError] = useState('');

  const save = async (required: boolean) => {
    const value = siteUrl.trim().replace(/\/+$/, '');
    if (value && !isAbsoluteHttpUrl(value)) {
      setError(t('setup.config.siteUrlInvalid', 'Enter the full address including http:// or https://'));
      return;
    }
    setError('');
    setSaving(true);
    try {
      if (value) await settingsService.updateSettings({ general_site_url: value });
      onDone();
    } catch {
      if (required) setError(t('setup.config.siteUrlRejected', 'The server rejected this address.'));
      else {
        toast.warn(t('setup.config.siteUrlRejected', 'The server rejected this address.'));
        onDone();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="rounded-lg bg-neutral-50 border border-neutral-200 px-3 py-2 text-xs text-neutral-600">
        {t('setup.config.intro', 'Set the address customers will use to open project links. You can change it later in Settings.')}
      </p>
      <div className="space-y-3">
        <label className="block text-sm font-semibold text-neutral-800" htmlFor="setup-site-url">{t('setup.config.siteUrl', 'Customer access address')}</label>
        <p className="text-xs text-neutral-500">{t('setup.config.siteUrlHint', 'Prefilled with the address you opened. Change it if customers will use a domain or reverse proxy.')}</p>
        <Input id="setup-site-url" type="url" placeholder="https://gallery.example.com" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} error={error || undefined} />
      </div>
      <div className="space-y-3">
        <Button type="button" variant="primary" size="lg" className="w-full" isLoading={saving} onClick={() => save(true)}>{t('setup.finish', 'Finish setup')}</Button>
        <Button type="button" variant="outline" size="lg" className="w-full" disabled={saving} onClick={() => save(false)}>{t('setup.skipForNow', 'Skip for now')}</Button>
      </div>
    </div>
  );
};

SetupConfigStep.displayName = 'SetupConfigStep';
