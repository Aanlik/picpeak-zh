import React from 'react';
import { ToggleRight, Save, AlertCircle, Images, Users, MonitorPlay, Send } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '../../../components/common';
import { api } from '../../../config/api';
import { FeatureCard } from '../components/FeatureCard';
import { SidebarPreview } from '../components/SidebarPreview';
import { useFeatureFlags } from '../../../contexts/FeatureFlagsContext';
import type { FeatureStatus } from '../components/StatusBadge';

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, children }) => (
  <section className="mt-6 first:mt-0">
    <h3 className="px-1 mb-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{title}</h3>
    <ul className="space-y-3">{children}</ul>
  </section>
);

export const FeaturesTab: React.FC = () => {
  const { data: systemVersion } = useQuery({
    queryKey: ['admin-system-version'],
    queryFn: async () => (await api.get('/admin/system/version')).data,
    staleTime: 5 * 60_000,
  });
  const isSingleContainer = systemVersion?.single_container === true;
  const { t } = useTranslation();
  const { staged, setFlag, save, reset, isDirty, isSaving } = useFeatureFlags();
  const statusLabel = (status: FeatureStatus): string => t(`settings.features.status.${status}`, status);
  const sidebarHiddenLabel = t('settings.features.sidebarHidden', 'No sidebar item — runs in the background');

  return (
    <div className="space-y-6">
      <Card padding="md">
        <div className="mb-6 pb-4 border-b border-neutral-200 dark:border-neutral-700">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-soft text-on-accent-soft flex items-center justify-center"><ToggleRight className="w-5 h-5" /></div>
            <div>
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t('settings.features.title', 'Features')}</h2>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-0.5 max-w-2xl">{t('settings.features.intro', 'Turn optional gallery features on or off for your team.')}</p>
            </div>
          </div>
        </div>

        <Section title={t('settings.features.sections.core', 'Core')}>
          <FeatureCard icon={Images} title={t('settings.features.galleries.title', 'Galleries')} description={t('settings.features.galleries.description', 'The core PicPeak surface. Always available.')} status="stable" statusLabel={statusLabel('stable')} sidebarLabel={t('navigation.events')} enabled={staged.galleries} onToggle={() => {}} disabled lockedReason={t('settings.features.galleries.locked', "Galleries are the foundation of PicPeak and can't be turned off.")} />
          <FeatureCard icon={MonitorPlay} title={t('settings.features.slideshow.title', 'Live Slideshow')} description={t('settings.features.slideshow.description', 'A fullscreen slideshow link for an event.')} status="new" statusLabel={statusLabel('new')} sidebarHidden sidebarHiddenLabel={sidebarHiddenLabel} enabled={staged.slideshow} onToggle={(next) => setFlag('slideshow', next)} />
          <FeatureCard icon={Send} title={t('settings.features.transfers.title', 'PicTransfer')} description={t('settings.features.transfers.description', 'Send original files through a protected download link, with optional client uploads.')} status="new" statusLabel={statusLabel('new')} sidebarLabel={t('settings.features.transfers.sidebar', 'PicTransfer')} enabled={staged.transfers} onToggle={(next) => setFlag('transfers', next)} />
          <FeatureCard icon={Users} title={t('settings.features.faces.title', 'People in galleries')} description={t('settings.features.faces.description', 'Group gallery photos by the people in them. Face processing stays off until enabled for a gallery.')} status="new" statusLabel={statusLabel('new')} sidebarHidden sidebarHiddenLabel={sidebarHiddenLabel} enabled={staged.faces} onToggle={(next) => setFlag('faces', next)} disabled={isSingleContainer} lockedReason={isSingleContainer ? t('settings.features.faces.lockedSingleContainer') : undefined} />
        </Section>

        <Section title={t('settings.features.sections.access', 'Access')}>
          <FeatureCard icon={Users} title={t('settings.features.userManagement.title', 'User Management')} description={t('settings.features.userManagement.description', 'Multi-admin support with role-based permissions.')} status="stable" statusLabel={statusLabel('stable')} sidebarLabel={t('navigation.users', 'Users')} enabled={staged.userManagement} onToggle={(next) => setFlag('userManagement', next)} />
        </Section>
      </Card>

      <SidebarPreview staged={staged} />
      <div className="flex items-center justify-end gap-2 pt-2">
        {isDirty && <span className="mr-auto text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />{t('settings.features.unsavedChanges', 'You have unsaved changes')}</span>}
        <Button variant="outline" disabled={!isDirty || isSaving} onClick={reset}>{t('common.discard', 'Discard')}</Button>
        <Button variant="primary" disabled={!isDirty || isSaving} isLoading={isSaving} onClick={() => { void save(); }} leftIcon={<Save className="w-4 h-4" />}>{t('common.saveChanges', 'Save changes')}</Button>
      </div>
    </div>
  );
};
