import { useEffect, useState } from 'react';
import { api } from '../../config/api';
import { Card } from '../common';
type Status = { stage: string; connected: boolean; summary: Record<string, number> };
const stages: Record<string, string> = { SELECTING: '客户选片', EDITING: '精修中', DELIVERED: '已交付', ARCHIVED: '已归档' };
export function PhotographyWorkflowCard({ eventId }: { eventId: number }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState('正在读取精修进度…');
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const { data } = await api.get<Status>(`/admin/photography-workflow/${eventId}`);
        if (active) { setStatus(data); setMessage(''); }
      } catch (error: any) {
        if (active) { setStatus(null); setMessage(error.response?.data?.error || '暂时无法读取精修进度'); }
      }
    };
    void refresh();
    const timer = setInterval(refresh, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [eventId]);
  return <Card><div className="p-6 space-y-3">
    <h3 className="text-lg font-semibold">选片与精修进度</h3>
    {status ? <>
      <p>{stages[status.stage] || status.stage} · {status.connected ? '同步服务已连接' : '同步服务连接中断'}</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{Object.entries(status.summary).map(([label, count]) => <div key={label} className="rounded-lg bg-neutral-100 dark:bg-neutral-800 p-3"><span>{label}</span><strong className="block text-xl">{count}</strong></div>)}</div>
      <p className="text-sm text-neutral-500">追加选片指进入精修或交付阶段后新增的选择；返修指同一张照片再次输出精修版本。精修阶段取消选片会保留正在处理的 RAW，等待摄影师确认。</p>
    </> : <p className="text-sm text-neutral-500">{message}</p>}
  </div></Card>;
}
