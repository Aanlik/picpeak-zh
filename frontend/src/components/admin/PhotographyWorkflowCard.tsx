import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../config/api';
import { Card } from '../common';
type Status = { configured?: boolean; stage?: string; connected?: boolean; summary?: Record<string, number>; bridge_url?: string | null };
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
      } catch (error: any) {
        if (active) {
          setStatus(null);
          setMessage(typeof error?.response?.data?.error === 'string'
            ? error.response.data.error
            : t('photographyWorkflow.loadError'));
        }
      }
    };
    void refresh();
    const timer = setInterval(refresh, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [eventId, t]);
  return <Card><div className="p-6 space-y-3">
    <h3 className="text-lg font-semibold">{t('photographyWorkflow.title')}</h3>
    {status && status.configured !== false ? <>
      <p>{t(`photographyWorkflow.stage.${status.stage}`, { defaultValue: status.stage })} · {status.connected ? t('photographyWorkflow.connected') : t('photographyWorkflow.disconnected')}</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{Object.entries(status.summary || {}).map(([label, count]) => <div key={label} className="rounded-lg bg-neutral-100 dark:bg-neutral-800 p-3"><span>{t(`photographyWorkflow.metric.${label}`, { defaultValue: label })}</span><strong className="block text-xl">{count}</strong></div>)}</div>
      <p className="text-sm text-neutral-500">{t('photographyWorkflow.help')}</p>
    </> : status ? <div className="space-y-3">
      <p className="text-sm text-neutral-700 dark:text-neutral-300">{t('photographyWorkflow.notBound', '此 PicPeak 项目还没有绑定 RAW 目录，因此客户标记暂时不能生成精修素材。')}</p>
      <ol className="list-decimal pl-5 space-y-1 text-sm text-neutral-600 dark:text-neutral-400">
        <li>{t('photographyWorkflow.stepSelection', '客户在选片页面把照片标记为“选为精修”。')}</li>
        <li>{t('photographyWorkflow.stepImport', 'Bridge 匹配 RAW 并放入 03_SELECTED_RAW；摄影师在像素蛋糕中打开这个 NAS 文件夹。')}</li>
        <li>{t('photographyWorkflow.stepExport', '精修后将保留原文件主名的 JPG 导出到 04_FINAL；Bridge 会自动替换原 Proof。')}</li>
      </ol>
      {status.bridge_url && <a href={status.bridge_url} target="_blank" rel="noreferrer" className="inline-flex rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800">{t('photographyWorkflow.openBridge', '打开摄影师工作台')}</a>}
    </div> : <p className="text-sm text-neutral-500">{message}</p>}
    {status && status.configured !== false && status.bridge_url && <a href={status.bridge_url} target="_blank" rel="noreferrer" className="inline-flex rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800">{t('photographyWorkflow.openBridge', '打开摄影师工作台')}</a>}
  </div></Card>;
}
