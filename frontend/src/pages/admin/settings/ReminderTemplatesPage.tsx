import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Save } from 'lucide-react';
import { Button, Card, Input, Loading } from '../../../components/common';
import { SUPPORTED_LANGUAGES } from '../../../components/common/LanguageSelector';
import { EmailTemplateEditor } from '../../../components/admin/EmailTemplateEditor';
import { emailService, type EmailTemplateTranslation } from '../../../services/email.service';
import { settingsService } from '../../../services/settings.service';
import { useFeatureFlags } from '../../../contexts/FeatureFlagsContext';
import { useMutationWithToast } from '../../../hooks';

const TEMPLATE_KEY = 'event_reminder_default';
const VARIABLES = ['customer_name', 'event_name', 'event_date', 'days_before', 'business_name'];
const EMPTY_TRANSLATION: EmailTemplateTranslation = { subject: '', body_html: '', body_text: '' };

/** Single project reminder template. Event-type-specific templates are retired. */
export const ReminderTemplatesPage: React.FC = () => {
  const { t } = useTranslation();
  const { flags } = useFeatureFlags();
  const workflowsLive = !!flags.workflows;
  const { data: settings } = useQuery({
    queryKey: ['reminder-settings'],
    queryFn: () => settingsService.getSettings(['project_reminders_enabled', 'project_reminders_days_before']),
    enabled: !workflowsLive,
  });
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['email-templates'],
    queryFn: () => emailService.getTemplates(),
  });
  const hasTemplate = templates.some((item) => item.template_key === TEMPLATE_KEY);
  const { data: template } = useQuery({
    queryKey: ['email-template', TEMPLATE_KEY],
    queryFn: () => emailService.getTemplate(TEMPLATE_KEY),
    enabled: hasTemplate,
  });
  const [enabled, setEnabled] = useState(false);
  const [daysBefore, setDaysBefore] = useState(2);
  const [editingLang, setEditingLang] = useState('zh-CN');
  const [translations, setTranslations] = useState<Record<string, EmailTemplateTranslation>>({});

  useEffect(() => {
    if (!settings) return;
    const e = settings.project_reminders_enabled;
    setEnabled(e === true || e === 'true' || e === 1 || e === '1');
    const d = Number(settings.project_reminders_days_before);
    setDaysBefore(Number.isFinite(d) ? d : 2);
  }, [settings]);

  useEffect(() => {
    const next: Record<string, EmailTemplateTranslation> = {};
    for (const lang of SUPPORTED_LANGUAGES) {
      const current = template?.translations?.[lang.code];
      next[lang.code] = current
        ? { subject: current.subject || '', body_html: current.body_html || '', body_text: current.body_text || '' }
        : { ...EMPTY_TRANSLATION };
    }
    setTranslations(next);
  }, [template]);

  const saveSettings = useMutationWithToast({
    mutationFn: () => settingsService.updateSettings({ project_reminders_enabled: enabled, project_reminders_days_before: daysBefore }),
    successMessage: t('reminderTemplates.settingsSaved', 'Reminder settings saved.'),
    invalidateKeys: [['reminder-settings']],
    errorMessage: () => t('reminderTemplates.settingsSaveError', 'Could not save reminder settings.'),
  });
  const saveTemplate = useMutationWithToast({
    mutationFn: async () => {
      const body = Object.fromEntries(Object.entries(translations).filter(([, value]) =>
        value.subject.trim() || value.body_html.trim() || (value.body_text || '').trim(),
      ));
      if (hasTemplate) await emailService.updateTemplate(TEMPLATE_KEY, { translations: body });
      else await emailService.createTemplate({
        template_key: TEMPLATE_KEY,
        translations: body,
        category: 'customers',
        subcategory: 'event_reminder',
        feature_flag: 'project_reminders_enabled',
        variables: VARIABLES,
      });
    },
    successMessage: t('reminderTemplates.saved', 'Template saved.'),
    invalidateKeys: [['email-templates'], ['email-template', TEMPLATE_KEY]],
    errorMessage: t('reminderTemplates.saveError', 'Could not save template.'),
  });
  const current = translations[editingLang] || EMPTY_TRANSLATION;
  const setCurrent = (field: keyof EmailTemplateTranslation, value: string) => setTranslations((prev) => ({
    ...prev,
    [editingLang]: { ...(prev[editingLang] || EMPTY_TRANSLATION), [field]: value },
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/admin/settings" className="p-2 -ml-2 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{t('reminderTemplates.title', 'Project reminder email')}</h1>
      </div>
      {!workflowsLive && <Card>
        <h2 className="font-semibold mb-3">{t('reminderTemplates.globalSection', 'Reminder schedule')}</h2>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{t('reminderTemplates.enableLabel', 'Send a reminder before the project date')}</label>
          <label className="flex items-center gap-2 text-sm">{t('reminderTemplates.daysBeforeLabel', 'Days before')}<Input type="number" min={0} max={365} value={daysBefore} onChange={(e) => setDaysBefore(Number(e.target.value))} className="w-24" /></label>
          <Button variant="outline" size="sm" onClick={() => saveSettings.mutate()} isLoading={saveSettings.isPending} leftIcon={<Save className="w-4 h-4" />}>{t('reminderTemplates.saveSettings', 'Save schedule')}</Button>
        </div>
      </Card>}
      {workflowsLive && <Card><p className="text-sm text-neutral-600 dark:text-neutral-300">{t('reminderTemplates.scheduleMoved.body', 'The reminder schedule is managed in Workflows. This page edits the shared project reminder template.')}</p></Card>}
      <Card padding="md">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold">{t('reminderTemplates.defaultLabel', 'Default project reminder')}</h2>
          <Button variant="primary" size="sm" onClick={() => saveTemplate.mutate()} isLoading={saveTemplate.isPending} leftIcon={<Save className="w-4 h-4" />}>{t('reminderTemplates.saveTemplate', 'Save template')}</Button>
        </div>
        {isLoading ? <Loading /> : <>
          <div className="flex flex-wrap gap-1 mb-4 p-1 bg-neutral-100 dark:bg-neutral-700 rounded-lg">
            {SUPPORTED_LANGUAGES.map((lang) => <button key={lang.code} onClick={() => setEditingLang(lang.code)} className={`px-3 py-1.5 text-sm rounded-md ${editingLang === lang.code ? 'bg-white dark:bg-neutral-800 shadow-sm' : ''}`}><lang.Flag /> {lang.name}</button>)}
          </div>
          <div className="space-y-4">
            <label className="block text-sm">{t('reminderTemplates.subjectLabel', 'Subject')}<Input value={current.subject} onChange={(e) => setCurrent('subject', e.target.value)} /></label>
            <div><label className="block text-sm mb-1">{t('reminderTemplates.bodyLabel', 'Body')}</label><EmailTemplateEditor content={current.body_html} onChange={(value) => setCurrent('body_html', value)} variables={VARIABLES} /></div>
            <p className="text-xs text-neutral-500">{t('reminderTemplates.variablesHint', 'Available variables: {{customer_name}}, {{event_name}}, {{event_date}}, {{days_before}}, {{business_name}}.')}</p>
          </div>
        </>}
      </Card>
    </div>
  );
};

export default ReminderTemplatesPage;
