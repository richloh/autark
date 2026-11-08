import { useState } from 'react';
import { Database, KeyRound, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { api, ApiClientError } from '@/api/client';
import { useApiMutation } from '@/api/hooks';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, confirm } from '@/components/ui/Modal';
import { Field, Input, Select, Hint } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { EmptyState } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { timeAgo, num } from '@/lib/format';
import { PasswordModal } from './PasswordModal';
import { useDbEngines } from './engine';
import type { DbInstance } from '@/types';

const ROLE_TONE = { owner: 'violet', readwrite: 'brand', readonly: 'neutral' } as const;
const ROLE_HELP = { owner: 'Full DDL & DML, can grant', readwrite: 'SELECT/INSERT/UPDATE/DELETE', readonly: 'SELECT only' };

export function DbUsersTab({ d }: { d: DbInstance }) {
  const { byId } = useDbEngines();
  const spec = byId(d.engine);
  const admin = spec?.adminUser ?? d.users[0]?.username;
  const redis = d.engine === 'redis';
  const busy = d.status !== 'available';
  const [creds, setCreds] = useState<{ username: string; password: string } | null>(null);
  const [userModal, setUserModal] = useState(false);
  const [dbModal, setDbModal] = useState(false);
  const [uForm, setUForm] = useState({ username: '', role: 'readwrite' });
  const [dForm, setDForm] = useState({ name: '', owner: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createUser = useApiMutation(() => api.action<{ username: string; password: string }>('dbInstances', d.id, 'createUser', uForm), {
    silent: true,
    onSuccess: (res) => { setUserModal(false); setUForm({ username: '', role: 'readwrite' }); setCreds(res); toast.success(`User ${res.username} created`) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); if (!Object.keys(fieldErrors(e)).length) toast.error('Could not create user', e.message) },
  });
  const createDb = useApiMutation(() => api.action('dbInstances', d.id, 'createDatabase', { name: dForm.name, owner: dForm.owner || admin }), {
    silent: true,
    onSuccess: () => { setDbModal(false); toast.success(`Database ${dForm.name} created`); setDForm({ name: '', owner: '' }) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); if (!Object.keys(fieldErrors(e)).length) toast.error('Could not create database', e.message) },
  });
  const reset = useApiMutation((username: string) => api.action<{ username: string; password: string }>('dbInstances', d.id, 'resetPassword', { username }), { onSuccess: (res) => setCreds(res) });
  const delUser = useApiMutation((username: string) => api.action('dbInstances', d.id, 'deleteUser', { username }), { success: (_r, u) => `User ${u} deleted` });
  const dropDb = useApiMutation((name: string) => api.action('dbInstances', d.id, 'dropDatabase', { name }), { success: (_r, n) => `Database ${n} dropped` });

  const onReset = async (username: string) => {
    if (await confirm({ title: `Reset password for ${username}?`, message: 'The current password stops working immediately. Applications using it will fail to reconnect until updated.', confirmLabel: 'Reset password' })) reset.mutate(username);
  };
  const onDeleteUser = async (username: string) => {
    if (await confirm({ title: `Delete user ${username}?`, message: 'Existing sessions are terminated. This cannot be undone.', confirmLabel: 'Delete user', danger: true })) delUser.mutate(username);
  };
  const onDrop = async (name: string, sizeMB: number) => {
    if (await confirm({ title: `Drop database ${name}?`, message: `All ${num(sizeMB / 1024, 1)} GB of data in ${name} will be permanently deleted. Backups taken before now still contain it.`, confirmLabel: 'Drop database', danger: true, typeToConfirm: name })) dropDb.mutate(name);
  };

  return (
    <div className="space-y-5">
      {busy && <Hint tone="warning">User and database changes are available when the instance is <b>available</b> (currently {d.status.replace(/-/g, ' ')}).</Hint>}
      <Card>
        <CardHeader icon={Database} title={redis ? 'Logical databases' : 'Databases'} description={redis ? 'Redis provides 16 numbered logical databases (db0–db15); select one with SELECT n.' : `${d.databases.length} database${d.databases.length === 1 ? '' : 's'}`}
          actions={!redis && <Button size="sm" icon={Plus} disabled={busy} onClick={() => { setErrors({}); setDbModal(true) }}>Create database</Button>} />
        {redis ? (
          <div className="grid grid-cols-4 gap-2 p-4 @min-[36rem]:grid-cols-8">
            {Array.from({ length: 16 }, (_, i) => {
              const used = d.databases.find((x) => x.name === `db${i}`);
              return (
                <div key={i} className={`rounded-lg border p-2 text-center ${used ? 'border-brand-500/30 bg-brand-500/5' : 'border-line bg-surface-2/40'}`}>
                  <div className="font-mono text-xs text-fg">db{i}</div>
                  <div className="text-[10px] text-muted">{used ? `${num(used.sizeMB / 1024, 1)} GB` : 'empty'}</div>
                </div>
              );
            })}
          </div>
        ) : d.databases.length === 0 ? (
          <EmptyState icon={Database} title="No databases yet" description="Create a database and assign an owner." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-4 py-2 font-medium">Name</th><th className="px-4 py-2 font-medium">Owner</th><th className="hidden px-4 py-2 font-medium @min-[36rem]:table-cell">Encoding</th><th className="px-4 py-2 text-right font-medium">Size</th><th className="w-12" /></tr></thead>
              <tbody className="divide-y divide-line">
                {d.databases.map((x) => (
                  <tr key={x.name} className="hover:bg-surface-2/50">
                    <td className="px-4 py-2.5 font-mono text-fg">{x.name}</td>
                    <td className="px-4 py-2.5 text-fg-2">{x.owner}</td>
                    <td className="hidden px-4 py-2.5 text-muted @min-[36rem]:table-cell">{x.encoding ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular text-fg">{x.sizeMB >= 1024 ? `${num(x.sizeMB / 1024, 1)} GB` : `${num(x.sizeMB)} MB`}</td>
                    <td className="px-2 py-1.5 text-right"><IconButton icon={Trash2} label={`Drop ${x.name}`} size="sm" disabled={busy} onClick={() => onDrop(x.name, x.sizeMB)} className="hover:text-rose-500" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader icon={Users} title={redis ? 'ACL users' : 'Users'} description={redis ? 'Redis 6+ ACL users. Roles map to ACL categories (+@all / +@read +@write / +@read).' : 'Database roles with login. Passwords are generated and shown once.'}
          actions={<Button size="sm" icon={UserPlus} disabled={busy} onClick={() => { setErrors({}); setUserModal(true) }}>Add user</Button>} />
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-4 py-2 font-medium">Username</th><th className="px-4 py-2 font-medium">Role</th><th className="hidden px-4 py-2 font-medium @min-[40rem]:table-cell">Created</th><th className="hidden px-4 py-2 font-medium @min-[40rem]:table-cell">Password changed</th><th className="w-24" /></tr></thead>
            <tbody className="divide-y divide-line">
              {d.users.map((u) => (
                <tr key={u.username} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2.5"><span className="font-mono text-fg">{u.username}</span>{u.username === admin && <Badge className="ml-2" tone="warning">admin</Badge>}</td>
                  <td className="px-4 py-2.5"><Badge tone={ROLE_TONE[u.role]} title={ROLE_HELP[u.role]}>{u.role}</Badge></td>
                  <td className="hidden px-4 py-2.5 text-muted @min-[40rem]:table-cell">{timeAgo(u.createdAt)}</td>
                  <td className="hidden px-4 py-2.5 text-muted @min-[40rem]:table-cell">{u.passwordChangedAt ? timeAgo(u.passwordChangedAt) : 'never'}</td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    <IconButton icon={KeyRound} label="Reset password" size="sm" disabled={busy} onClick={() => onReset(u.username)} />
                    <IconButton icon={Trash2} label="Delete user" size="sm" disabled={busy || u.username === admin} onClick={() => onDeleteUser(u.username)} className="hover:text-rose-500" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={userModal} onClose={() => setUserModal(false)} title="Add user" description="A strong password is generated and shown once."
        footer={<><Button variant="ghost" onClick={() => setUserModal(false)}>Cancel</Button><Button variant="primary" icon={UserPlus} loading={createUser.isPending} disabled={!uForm.username} onClick={() => createUser.mutate()}>Create user</Button></>}>
        <div className="space-y-4">
          <Field label="Username" required error={errors.username} hint="Lowercase letters, digits and underscores">
            <Input value={uForm.username} onChange={(e) => setUForm({ ...uForm, username: e.target.value.toLowerCase() })} placeholder="app_reader" invalid={!!errors.username} mono />
          </Field>
          <Field label="Role" error={errors.role}>
            <Select value={uForm.role} onChange={(e) => setUForm({ ...uForm, role: e.target.value })} options={(['owner', 'readwrite', 'readonly'] as const).map((r) => ({ value: r, label: `${r} — ${ROLE_HELP[r]}` }))} />
          </Field>
        </div>
      </Modal>

      <Modal open={dbModal} onClose={() => setDbModal(false)} title="Create database"
        footer={<><Button variant="ghost" onClick={() => setDbModal(false)}>Cancel</Button><Button variant="primary" icon={Plus} loading={createDb.isPending} disabled={!dForm.name} onClick={() => createDb.mutate()}>Create</Button></>}>
        <div className="space-y-4">
          <Field label="Name" required error={errors.name}><Input value={dForm.name} onChange={(e) => setDForm({ ...dForm, name: e.target.value.toLowerCase() })} placeholder="orders" invalid={!!errors.name} mono /></Field>
          <Field label="Owner" error={errors.owner}><Select value={dForm.owner || admin || ''} onChange={(e) => setDForm({ ...dForm, owner: e.target.value })} options={d.users.map((u) => ({ value: u.username, label: u.username }))} /></Field>
        </div>
      </Modal>

      <PasswordModal creds={creds} onClose={() => setCreds(null)} />
    </div>
  );
}
