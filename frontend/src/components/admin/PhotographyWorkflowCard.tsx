import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Save } from 'lucide-react';
import { api } from '../../config/api';
import { Card, Button } from '../common';

type PhotoState = {
  photo_id: number;
  source_filename: string;
  selected: boolean;
  added_during_editing: boolean;
  cancelled: boolean;
  raw_matched: boolean;
  ready_for_editing: boolean;
  current_version: number;
  delivered: boolean;
  error: boolean;
  error_message?: string | null;
  delivery_state?: string | null;
};
type RequestItem = {
  id: number;
  photo_id: number;
  filename: string;
  request_type: 'revision' | 'additional';
  base_version: number | null;
  customer_message: string;
  status: string;
  photographer_reply: string | null;
  created_at: string;
};
type Workflow = {
  configured?: boolean;
  event_id?: number;
  name?: string;
  stage?: string;
  connected?: boolean;
  summary?: Record<string, number>;
  photos?: PhotoState[];
  delivery_path?: string | null;
  errors?: { message: string; created_at: string | null }[];
};

const stageValues = ['SELECTING', 'EDITING', 'DELIVERED', 'ARCHIVED'] as const;
const requestStatuses = ['open', 'in_progress', 'waiting_customer', 'completed', 'closed'] as const;
const metricNames: Record<string, string> = {
  '客户已选': 'selected', '追加选片': 'additionalSelections', 'RAW已匹配': 'matched',
  '待精修': 'readyForEditing', '已精修': 'delivered', '已同步': 'synced',
  '返修': 'revisions', '取消待确认': 'cancelled', '异常': 'errors',
};

export function PhotographyWorkflowCard({ eventId }: { eventId: number }) {
  const { t } = useTranslation();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [projectName, setProjectName] = useState('');
  const [rawSubdir, setRawSubdir] = useState('');
  const [replies, setReplies] = useState<Record<number, string>>({});

  const refresh = useCallback(async () => {
    try {
      const [statusResult, requestResult] = await Promise.all([
        api.get<Workflow>(`/admin/photography-workflow/${eventId}`),
        api.get<{ requests: RequestItem[] }>(`/admin/photography-workflow/${eventId}/requests`),
      ]);
      setWorkflow(statusResult.data);
      setRequests(requestResult.data.requests || []);
      setReplies(Object.fromEntries((requestResult.data.requests || []).map((item) => [item.id, item.photographer_reply || ''])));
      setError('');
    } catch (cause: any) {
      setError(typeof cause?.response?.data?.error === 'string' ? cause.response.data.error : t('photographyWorkflow.loadError'));
    } finally {
      setLoading(false);
    }
  }, [eventId, t]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => clearInterval(timer);
  }, [refresh]);

  const perform = async (action: () => Promise<unknown>, successKey?: string) => {
    setBusy(true);
    try {
      await action();
      await refresh();
      if (successKey) setError('');
    } catch (cause: any) {
      setError(typeof cause?.response?.data?.error === 'string' ? cause.response.data.error : t('photographyWorkflow.actionError'));
    } finally {
      setBusy(false);
    }
  };

  const bind = (event: FormEvent) => {
    event.preventDefault();
    void perform(async () => {
      await api.post(`/admin/photography-workflow/${eventId}/bind`, { name: projectName, raw_subdir: rawSubdir });
      setProjectName('');
      setRawSubdir('');
    });
  };

  const isBound = Boolean(workflow?.configured);
  const photos = workflow?.photos || [];
  return <Card><div className="p-6 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-lg font-semibold">{t('photographyWorkflow.title')}</h3>
        {isBound && <p className="mt-1 text-sm text-neutral-500">{workflow?.name} · {workflow?.connected ? t('photographyWorkflow.connected') : t('photographyWorkflow.disconnected')}</p>}
      </div>
      {isBound && <div className="flex flex-wrap items-center gap-2">
        <select aria-label={t('photographyWorkflow.projectStage')} value={workflow?.stage || 'SELECTING'} disabled={busy} onChange={(event) => void perform(() => api.post(`/admin/photography-workflow/${eventId}/stage`, { stage: event.target.value }))} className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900">
          {stageValues.map((stage) => <option key={stage} value={stage}>{t(`photographyWorkflow.stage.${stage}`)}</option>)}
        </select>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void perform(() => api.post(`/admin/photography-workflow/${eventId}/sync`, {}))}>
          <RefreshCw className="mr-2 h-4 w-4" />{t('photographyWorkflow.syncNow')}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void perform(() => api.post(`/admin/photography-workflow/${eventId}/rescan`, {}))}>
          {t('photographyWorkflow.rescan')}
        </Button>
        {(workflow?.summary?.['异常'] || 0) > 0 && <Button variant="outline" size="sm" disabled={busy} onClick={() => {
          void perform(async () => {
            try {
              await api.post(`/admin/photography-workflow/${eventId}/retry`, { confirm_unknown: false });
            } catch (cause: any) {
              if (cause?.response?.status !== 409 || cause?.response?.data?.code !== 'UNKNOWN_CONFIRMATION_REQUIRED') throw cause;
              if (!window.confirm(t('photographyWorkflow.confirmUnknownRetry', { count: cause.response.data.count || 1 }))) return;
              await api.post(`/admin/photography-workflow/${eventId}/retry`, { confirm_unknown: true });
            }
          });
        }}>{t('photographyWorkflow.retryFailed')}</Button>}
      </div>}
    </div>

    {loading ? <p className="text-sm text-neutral-500">{t('photographyWorkflow.loading')}</p> : null}
    {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
    {workflow?.configured === false && !loading && <div className="space-y-3">
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('photographyWorkflow.notBound')}</p>
      <form onSubmit={bind} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <input required maxLength={120} value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder={t('photographyWorkflow.projectName')} aria-label={t('photographyWorkflow.projectName')} className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
        <input required maxLength={500} value={rawSubdir} onChange={(event) => setRawSubdir(event.target.value)} placeholder={t('photographyWorkflow.rawSubdir')} aria-label={t('photographyWorkflow.rawSubdir')} className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
        <Button type="submit" disabled={busy || !projectName.trim() || !rawSubdir.trim()}>{t('photographyWorkflow.bindProject')}</Button>
      </form>
      <p className="text-xs text-neutral-500">{t('photographyWorkflow.bindHelp')}</p>
    </div>}

    {isBound && <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Object.entries(workflow?.summary || {}).map(([key, count]) => <div key={key} className="rounded-lg bg-neutral-100 p-3 dark:bg-neutral-800"><span className="text-xs text-neutral-500">{t(`photographyWorkflow.metric.${metricNames[key] || key}`, { defaultValue: key })}</span><strong className="block text-xl">{count}</strong></div>)}
      </div>
      <div className="rounded-lg bg-neutral-50 p-3 text-sm dark:bg-neutral-900">
        <p className="font-medium">{t('photographyWorkflow.photographerStepsTitle')}</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-neutral-600 dark:text-neutral-300">
          <li>{t('photographyWorkflow.stepImport')}</li>
          <li>{t('photographyWorkflow.stepExport')}</li>
        </ol>
        {workflow?.delivery_path && <p className="mt-2 break-all"><span className="font-medium">{t('photographyWorkflow.deliveryFolder')}：</span>{workflow.delivery_path}</p>}
      </div>
      <section className="space-y-2">
        <h4 className="font-medium">{t('photographyWorkflow.photoList')}</h4>
        <div className="max-h-64 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-neutral-50 dark:bg-neutral-900"><tr><th className="p-2">{t('photographyWorkflow.filename')}</th><th className="p-2">{t('photographyWorkflow.photoStatus')}</th><th className="p-2">{t('photographyWorkflow.version')}</th></tr></thead>
            <tbody>{photos.map((photo) => <tr key={photo.photo_id} className="border-t border-neutral-200 dark:border-neutral-700">
              <td className="max-w-[15rem] truncate p-2" title={photo.error_message || photo.source_filename}>{photo.source_filename}{photo.error_message && <span className="block truncate text-xs text-red-600" title={photo.error_message}>{photo.error_message}</span>}</td>
              <td className="p-2"><span>{photo.error ? t('photographyWorkflow.status.error') : photo.delivered ? t('photographyWorkflow.status.delivered') : photo.ready_for_editing ? t('photographyWorkflow.status.editing') : photo.selected ? t('photographyWorkflow.status.selected') : t('photographyWorkflow.status.proof')}</span>{photo.added_during_editing && <span className="ml-2 inline-block rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">{t('photographyWorkflow.status.additionalSelection')}</span>}{workflow?.stage === 'EDITING' && photo.cancelled && <span className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{t('photographyWorkflow.status.cancelled')}</span>}</td>
              <td className="p-2">{photo.current_version ? `V${photo.current_version}` : '—'}</td>
            </tr>)}
              {!photos.length && <tr><td colSpan={3} className="p-4 text-center text-neutral-500">{t('photographyWorkflow.noPhotos')}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section className="space-y-3">
        <h4 className="font-medium">{t('photographyWorkflow.requestsTitle')} <span className="text-sm text-neutral-500">({requests.length})</span></h4>
        {requests.length ? requests.map((request) => <div key={request.id} className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">{request.filename} · {t(`photographyWorkflow.requestType.${request.request_type}`)}{request.base_version ? ` V${request.base_version}` : ''}</div>
            <select aria-label={t('photographyWorkflow.requestStatus')} value={request.status} onChange={(event) => void perform(() => api.patch(`/admin/photography-workflow/${eventId}/requests/${request.id}`, { status: event.target.value, photographer_reply: replies[request.id] || '' }))} className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900">
              {requestStatuses.map((status) => <option key={status} value={status}>{t(`photographyWorkflow.requestState.${status}`)}</option>)}
              {request.status === 'moderation' && <option value="moderation">{t('photographyWorkflow.requestState.moderation')}</option>}
            </select>
          </div>
          <p className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">{request.customer_message}</p>
          <div className="flex gap-2">
            <input value={replies[request.id] || ''} onChange={(event) => setReplies((old) => ({ ...old, [request.id]: event.target.value }))} maxLength={1000} placeholder={t('photographyWorkflow.replyPlaceholder')} className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
            <Button variant="outline" size="sm" disabled={busy} aria-label={t('photographyWorkflow.saveReply')} onClick={() => void perform(() => api.patch(`/admin/photography-workflow/${eventId}/requests/${request.id}`, { status: request.status === 'moderation' ? 'open' : request.status, photographer_reply: replies[request.id] || '' }))}><Save className="h-4 w-4" /></Button>
          </div>
        </div>) : <p className="text-sm text-neutral-500">{t('photographyWorkflow.noRequests')}</p>}
      </section>
    </>}
  </div></Card>;
}
