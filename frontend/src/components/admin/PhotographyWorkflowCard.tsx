import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../config/api';
import { Card } from '../common';
type Status = { stage: string; connected: boolean; summary: Record<string, number> };
export function PhotographyWorkflowCard({ eventId }: { eventId: number }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const { data } = await api.get<Status>(`/admin/photography-workflow/${eventId}`);
        if (active) { setStatus(data); setMessage(''); }
      } catch {
        if (active) { setStatus(null); setMessage(t('photographyWorkflow.loadError')); }
      }
    };
    void refresh();
    const timer = setInterval(refresh, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [eventId, t]);
  return <Card><div className="p-6 space-y-3">
    <h3 className="text-lg font-semibold">{t('photographyWorkflow.title')}</h3>
    {status ? <>
      <p>{t(`photographyWorkflow.stage.${status.stage}`, { defaultValue: status.stage })} · {status.connected ? t('photographyWorkflow.connected') : t('photographyWorkflow.disconnected')}</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{Object.entries(status.summary).map(([label, count]) => <div key={label} className="rounded-lg bg-neutral-100 dark:bg-neutral-800 p-3"><span>{t(`photographyWorkflow.metric.${label}`, { defaultValue: label })}</span><strong className="block text-xl">{count}</strong></div>)}</div>
      <p className="text-sm text-neutral-500">{t('photographyWorkflow.help')}</p>
    </> : <p className="text-sm text-neutral-500">{message}</p>}
  </div></Card>;
}
