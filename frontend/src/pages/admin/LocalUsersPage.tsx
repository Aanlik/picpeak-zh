import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../config/api';
import { Button, Card, Input } from '../../components/common';
import { RoleManagementTab } from '../../components/admin/RoleManagementTab';

export const LocalUsersPage = () => {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState('');
  const [activePanel, setActivePanel] = useState<'users' | 'roles'>('users');
  const { data, isError } = useQuery({ queryKey: ['local-users'], queryFn: async () => (await api.get<{ users: { id: number; username: string; role: string; is_active: boolean }[]; roles: { id: number; display_name: string }[] }>('/admin/local-users')).data });
  const create = useMutation({
    mutationFn: async () => api.post('/admin/local-users', { username, password, role_id: Number(role) }),
    onSuccess: () => { setUsername(''); setPassword(''); setError(''); cache.invalidateQueries({ queryKey: ['local-users'] }); },
    onError: () => { setError(t('localUsers.createError')); },
  });
  return <div className="space-y-6"><h1 className="text-2xl font-bold">{t('localUsers.title')}</h1>
    <div className="flex gap-2 border-b" role="tablist" aria-label={t('localUsers.title')}>
      <button type="button" role="tab" aria-selected={activePanel === 'users'} className="px-3 py-2 border-b-2 aria-selected:border-blue-600" onClick={() => setActivePanel('users')}>{t('localUsers.accountsTab')}</button>
      <button type="button" role="tab" aria-selected={activePanel === 'roles'} className="px-3 py-2 border-b-2 aria-selected:border-blue-600" onClick={() => setActivePanel('roles')}>{t('localUsers.rolesTab')}</button>
    </div>
    {activePanel === 'roles' ? <RoleManagementTab /> : <>
    <Card><h2 className="text-lg font-semibold mb-4">{t('localUsers.existingTitle')}</h2>{isError && <p role="alert">{t('localUsers.loadError')}</p>}
      <table className="w-full text-left"><thead><tr><th>{t('localUsers.username')}</th><th>{t('localUsers.role')}</th><th>{t('localUsers.status')}</th></tr></thead><tbody>{data?.users.map(u => <tr key={u.id}><td>{u.username}</td><td>{u.role}</td><td>{u.is_active ? t('localUsers.enabled') : t('localUsers.disabled')}</td></tr>)}</tbody></table>
    </Card>
    <Card><h2 className="text-lg font-semibold mb-4">{t('localUsers.createTitle')}</h2><p className="mb-4 text-sm text-neutral-500">{t('localUsers.createHelp')}</p>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
        <Input label={t('localUsers.username')} value={username} autoComplete="off" onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={50} />
        <Input label={t('localUsers.initialPassword')} type="password" value={password} autoComplete="new-password" onChange={e => setPassword(e.target.value)} required minLength={12} maxLength={128} />
        <label className="block">{t('localUsers.role')}<select className="input ml-3" required value={role} onChange={e => setRole(e.target.value)}><option value="">{t('localUsers.chooseRole')}</option>{data?.roles.map(r => <option key={r.id} value={r.id}>{r.display_name}</option>)}</select></label>
        {error && <p role="alert" className="text-red-600">{error}</p>}<Button type="submit" disabled={create.isPending}>{create.isPending ? t('localUsers.creating') : t('localUsers.createButton')}</Button>
      </form>
    </Card>
    </>}
  </div>;
};
