import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../config/api';
import { Button, Card, Input } from '../../components/common';

export const LocalUsersPage = () => {
  const cache = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState('');
  const { data, isError } = useQuery({ queryKey: ['local-users'], queryFn: async () => (await api.get<{ users: { id: number; username: string; role: string; is_active: boolean }[]; roles: { id: number; display_name: string }[] }>('/admin/local-users')).data });
  const create = useMutation({
    mutationFn: async () => api.post('/admin/local-users', { username, password, role_id: Number(role) }),
    onSuccess: () => { setUsername(''); setPassword(''); setError(''); cache.invalidateQueries({ queryKey: ['local-users'] }); },
    onError: (err: unknown) => { setError((err as { response?: { data?: { error?: string } } }).response?.data?.error || '创建失败，请检查输入或权限'); },
  });
  return <div className="space-y-6"><h1 className="text-2xl font-bold">管理员账号</h1>
    <Card><h2 className="text-lg font-semibold mb-4">现有管理员</h2>{isError && <p role="alert">无法读取账号，请确认超级管理员权限</p>}
      <table className="w-full text-left"><thead><tr><th>用户名</th><th>角色</th><th>状态</th></tr></thead><tbody>{data?.users.map(u => <tr key={u.id}><td>{u.username}</td><td>{u.role}</td><td>{u.is_active ? '启用' : '停用'}</td></tr>)}</tbody></table>
    </Card>
    <Card><h2 className="text-lg font-semibold mb-4">创建本地账号</h2><p className="mb-4 text-sm text-neutral-500">由超级管理员创建。请私下交付初始密码，新管理员首次登录需修改密码。</p>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
        <Input label="用户名" value={username} autoComplete="off" onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={50} />
        <Input label="初始密码" type="password" value={password} autoComplete="new-password" onChange={e => setPassword(e.target.value)} required minLength={12} maxLength={128} />
        <label className="block">角色<select className="input ml-3" required value={role} onChange={e => setRole(e.target.value)}><option value="">请选择角色</option>{data?.roles.map(r => <option key={r.id} value={r.id}>{r.display_name}</option>)}</select></label>
        {error && <p role="alert" className="text-red-600">{error}</p>}<Button type="submit" disabled={create.isPending}>创建账号</Button>
      </form>
    </Card></div>;
};
