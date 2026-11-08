import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { User as UserIcon, UserPlus, MoreHorizontal, Ban, CheckCircle2, Mail, ShieldCheck, ShieldAlert, ShieldOff, Trash2, KeyRound, Fingerprint, Crown, Users } from 'lucide-react';
import { useList, useLookup, useApiMutation } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { StatusPill, Badge } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Stat } from '@/components/ui/Stat';
import { Ring } from '@/components/ui/misc';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { Avatar } from '@/components/iam/Avatar';
import { RoleChips, ProjectScope } from '@/components/iam/RoleChips';
import { InviteUserModal } from '@/components/iam/InviteUserModal';
import { Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import { timeAgo, dateTime } from '@/lib/format';
import type { User, Role, Project } from '@/types';

type Filter = 'all' | 'active' | 'invited' | 'disabled' | 'nomfa' | 'admins';

export default function UserList() {
  const [sp, setSp] = useSearchParams();
  const pro = usePro();
  const { items: users, isLoading } = useList<User>('users');
  const { map: roles } = useLookup<Role>('roles');
  const { map: projects } = useLookup<Project>('projects');
  const [filter, setFilter] = useState<Filter>('all');
  const inviteOpen = sp.get('invite') === '1';
  const setInvite = (v: boolean) => { const n = new URLSearchParams(sp); if (v) n.set('invite', '1'); else n.delete('invite'); setSp(n, { replace: true }) };

  const counts = useMemo(() => ({
    all: users.length,
    active: users.filter((u) => u.status === 'active').length,
    invited: users.filter((u) => u.status === 'invited').length,
    disabled: users.filter((u) => u.status === 'disabled').length,
    nomfa: users.filter((u) => u.status === 'active' && !u.mfa && !u.sso).length,
    admins: users.filter((u) => u.roleIds.includes('role-admin')).length,
  }), [users]);
  const active = users.filter((u) => u.status === 'active');
  const mfaCovered = active.filter((u) => u.mfa || u.sso).length;
  const ssoCount = active.filter((u) => u.sso).length;
  const f: Filter = pro || ['all', 'active', 'invited'].includes(filter) ? filter : 'all';
  const rows = users.filter((u) => f === 'all' ? true : f === 'nomfa' ? u.status === 'active' && !u.mfa && !u.sso : f === 'admins' ? u.roleIds.includes('role-admin') : u.status === f);

  const act = useApiMutation(({ id, a, body }: { id: string; a: string; body?: unknown }) => api.action('users', id, a, body), { silent: true });
  const run = async (list: User[], a: string, label: string, eligible: (u: User) => boolean, body?: unknown) => {
    const targets = list.filter(eligible);
    if (!targets.length) { toast.info(`None of the selected users can be ${label}`); return }
    const res = await Promise.allSettled(targets.map((u) => act.mutateAsync({ id: u.id, a, body })));
    const failed = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) toast.error(`${failed.length} of ${targets.length} failed`, failed[0].reason?.message);
    if (failed.length < targets.length) toast.success(`${targets.length - failed.length} user${targets.length - failed.length > 1 ? 's' : ''} ${label}`);
  };

  const disable = async (list: User[]) => {
    const targets = list.filter((u) => u.status !== 'disabled');
    if (!targets.length) { toast.info('Selected users are already disabled'); return }
    const ok = await confirm({
      title: targets.length === 1 ? `Disable ${targets[0].name}?` : `Disable ${targets.length} users?`,
      message: 'They are signed out everywhere immediately and can no longer sign in or use personal API tokens. You can re-enable them later.',
      confirmLabel: 'Disable', danger: true,
    });
    if (ok) await run(targets, 'disable', 'disabled', () => true);
  };

  const remove = async (list: User[]) => {
    const ok = await confirm({
      title: list.length === 1 ? `Delete ${list[0].name}?` : `Delete ${list.length} users?`,
      message: 'The account, its sessions and personal API tokens are removed permanently. Audit history is kept.',
      confirmLabel: 'Delete', danger: true, typeToConfirm: list.length === 1 ? list[0].email : undefined,
    });
    if (!ok) return;
    const res = await Promise.allSettled(list.map((u) => api.remove('users', u.id)));
    const failed = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) toast.error(`${failed.length} deletion(s) failed`, failed[0].reason?.message);
    else toast.success(list.length === 1 ? `${list[0].name} deleted` : `${list.length} users deleted`);
  };

  const columns: Column<User>[] = [
    {
      id: 'name', header: 'User', sort: (u) => u.name,
      cell: (u) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={u.name} seed={u.email} status={u.status} muted={u.status === 'disabled'} />
          <div className="min-w-0">
            <Link to={`/iam/users/${u.id}`} className="flex items-center gap-1.5 truncate font-medium text-fg hover:text-brand-500">
              {u.name}{u.id === 'user-001' && <Badge tone="brand" className="h-[18px] px-1.5 text-[10px]">you</Badge>}
            </Link>
            <div className="truncate text-[11.5px] text-muted">{u.email}</div>
          </div>
        </div>
      ),
    },
    { id: 'roles', header: 'Roles', sort: (u) => u.roleIds.map((r) => roles.get(r)?.name).join(), cell: (u) => <RoleChips roleIds={u.roleIds} roles={roles} max={2} /> },
    { id: 'projects', header: 'Projects', hideBelow: 'lg', cell: (u) => <ProjectScope projectIds={u.projectIds} projects={projects} /> },
    {
      id: 'mfa', header: 'MFA', sort: (u) => (u.mfa ? 2 : u.sso ? 1 : 0), hideBelow: 'md',
      cell: (u) => u.mfa
        ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400" title={`Enrolled: ${u.mfaMethod === 'webauthn' ? 'security key' : 'authenticator app'}`}>{u.mfaMethod === 'webauthn' ? <Fingerprint className="size-4" /> : <ShieldCheck className="size-4" />}<span className="text-xs">{u.mfaMethod === 'webauthn' ? 'Key' : 'TOTP'}</span></span>
        : u.sso ? <span className="inline-flex items-center gap-1 text-muted" title="Enforced by identity provider"><ShieldCheck className="size-4" /><span className="text-xs">via IdP</span></span>
        : <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400" title={u.mfaRequired ? 'Required — will be enforced at next sign-in' : 'Not enrolled'}><ShieldAlert className="size-4" /><span className="text-xs">{u.mfaRequired ? 'Pending' : 'Off'}</span></span>,
    },
    { id: 'sso', header: 'SSO', hideBelow: 'xl', sort: (u) => Number(u.sso), cell: (u) => u.sso ? <Badge tone="info">OIDC</Badge> : <span className="text-xs text-muted">Password</span> },
    { id: 'login', header: 'Last login', hideBelow: 'md', sort: (u) => u.lastLogin ?? '', cell: (u) => <span className="whitespace-nowrap text-fg-2" title={dateTime(u.lastLogin)}>{u.lastLogin ? timeAgo(u.lastLogin) : <span className="text-faint">never</span>}</span> },
    { id: 'status', header: 'Status', sort: (u) => u.status, cell: (u) => <StatusPill status={u.status} /> },
  ];

  // Simple mode: name/email, the single most important role, status, last login.
  const ROLE_RANK = ['role-admin', 'role-ops', 'role-billing', 'role-developer', 'role-ml', 'role-viewer'];
  const mainRole = (u: User) => [...u.roleIds].sort((a, b) => (ROLE_RANK.indexOf(a) + 1 || 99) - (ROLE_RANK.indexOf(b) + 1 || 99))[0];
  const simpleColumns: Column<User>[] = [
    columns[0],
    {
      id: 'role', header: 'Role', sort: (u) => roles.get(mainRole(u) ?? '')?.name ?? '',
      cell: (u) => { const r = mainRole(u); return r ? <span className="text-fg-2">{roles.get(r)?.name ?? r}{u.roleIds.length > 1 && <span className="ml-1 text-[11px] text-muted">+{u.roleIds.length - 1}</span>}</span> : <span className="text-faint">No role</span> },
    },
    { id: 'status', header: 'Status', sort: (u) => u.status, cell: (u) => <StatusPill status={u.status} /> },
    { id: 'login', header: 'Last login', hideBelow: 'md', sort: (u) => u.lastLogin ?? '', cell: (u) => <span className="whitespace-nowrap text-fg-2" title={dateTime(u.lastLogin)}>{u.lastLogin ? timeAgo(u.lastLogin) : <span className="text-faint">never</span>}</span> },
  ];

  const rowMenu = (u: User) => (
    <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />} items={[
      { label: 'View details', icon: UserIcon, to: `/iam/users/${u.id}` },
      { label: 'Edit access', icon: KeyRound, to: `/iam/users/${u.id}?tab=access` },
      ...(u.status === 'invited' ? [{ label: 'Resend invitation', icon: Mail, onClick: () => act.mutateAsync({ id: u.id, a: 'resendInvite' }).then(() => toast.success(`Invitation re-sent to ${u.email}`)).catch((e) => toast.error('Failed', e.message)) }] : []),
      { divider: true, label: '' },
      u.status === 'disabled'
        ? { label: 'Enable', icon: CheckCircle2, onClick: () => run([u], 'enable', 'enabled', () => true) }
        : { label: 'Disable', icon: Ban, disabled: u.id === 'user-001', hint: u.id === 'user-001' ? 'you' : undefined, onClick: () => disable([u]) },
      ...(!pro ? [] : [{ label: 'Reset MFA', icon: ShieldOff, disabled: !u.mfa || u.sso, onClick: async () => { if (await confirm({ title: `Reset MFA for ${u.name}?`, message: 'Their enrolled device is removed; they must enroll again at next sign-in.', confirmLabel: 'Reset MFA', danger: true })) run([u], 'resetMfa', 'reset', () => true) } }]),
      { divider: true, label: '' },
      { label: 'Delete', icon: Trash2, danger: true, disabled: u.id === 'user-001', onClick: () => remove([u]) },
    ]} />
  );

  const mfaPct = active.length ? mfaCovered / active.length : 0;

  return (
    <Page wide>
      <PageHeader
        title={pro ? 'Users' : 'Team'}
        description={pro ? 'People with access to this Autark installation. Roles define what they can do; project access defines where.' : 'The people who can use this console.'}
        icon={pro ? UserIcon : Users}
        iconColor="#64748b"
        actions={<>
          {pro && <Button icon={Users} to="/iam/roles">Roles</Button>}
          <Button variant="primary" icon={UserPlus} onClick={() => setInvite(true)}>{pro ? 'Invite people' : 'Invite'}</Button>
        </>}
      />

      <Pro>
      <div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Members" value={counts.active} icon={Users} sub={<>{counts.invited} invited · {counts.disabled} disabled</>} />
        <div className="flex items-center gap-4 rounded-xl border border-line bg-surface p-4 shadow-card">
          <Ring value={mfaPct * 100} size={56} color={mfaPct >= 0.95 ? '#10b981' : mfaPct >= 0.75 ? '#f59e0b' : '#f43f5e'} />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-muted">MFA coverage</div>
            <div className="mt-0.5 text-xs text-muted">{mfaCovered}/{active.length} active users</div>
            {counts.nomfa > 0 && <button onClick={() => setFilter('nomfa')} className="mt-1 text-xs font-medium text-amber-600 hover:underline dark:text-amber-400">{counts.nomfa} without MFA →</button>}
          </div>
        </div>
        <Stat label="Single sign-on" value={`${ssoCount}/${active.length}`} icon={KeyRound} sub="active users via OIDC" />
        <Stat label="Administrators" value={counts.admins} icon={Crown} sub={counts.admins > 3 ? <span className="text-amber-600 dark:text-amber-400">consider fewer admins</span> : 'privileged accounts'} to="/iam/roles/role-admin" />
      </div>
      </Pro>

      <DataTable
        rows={rows}
        loading={isLoading}
        columns={pro ? columns : simpleColumns}
        initialSearch={sp.get('q') ?? ''}
        searchText={(u) => `${u.name} ${u.email} ${u.title ?? ''} ${u.status} ${u.roleIds.map((r) => roles.get(r)?.name).join(' ')} ${u.tags.map((t) => `${t.key}:${t.value}`).join(' ')}`}
        searchPlaceholder={pro ? 'Search name, email, role…' : 'Search people…'}
        rowLink={(u) => `/iam/users/${u.id}`}
        rowActions={rowMenu}
        defaultSort={{ id: 'name', dir: 'asc' }}
        rowClassName={(u) => (u.status === 'disabled' ? 'opacity-70' : undefined)}
        toolbar={!pro ? (counts.invited ? <FilterChips value={f} onChange={setFilter} options={[
          { value: 'all', label: 'All', count: counts.all }, { value: 'active', label: 'Active', count: counts.active }, { value: 'invited', label: 'Invited', count: counts.invited },
        ]} /> : undefined) : <FilterChips value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All', count: counts.all }, { value: 'active', label: 'Active', count: counts.active },
          ...(counts.invited ? [{ value: 'invited' as const, label: 'Invited', count: counts.invited }] : []),
          ...(counts.disabled ? [{ value: 'disabled' as const, label: 'Disabled', count: counts.disabled }] : []),
          ...(counts.nomfa ? [{ value: 'nomfa' as const, label: 'No MFA', count: counts.nomfa }] : []),
          { value: 'admins', label: 'Admins', count: counts.admins },
        ]} />}
        bulkActions={!pro ? undefined : [
          { label: 'Disable', icon: Ban, onClick: disable },
          { label: 'Enable', icon: CheckCircle2, onClick: (l) => run(l, 'enable', 'enabled', (u) => u.status === 'disabled') },
          { label: 'Require MFA', icon: ShieldCheck, onClick: (l) => run(l, 'requireMfa', 'now required to use MFA', (u) => !u.sso && !u.mfaRequired, { required: true }) },
          { label: 'Resend invites', icon: Mail, onClick: (l) => run(l, 'resendInvite', 're-invited', (u) => u.status === 'invited') },
          { label: 'Delete', icon: Trash2, danger: true, onClick: remove },
        ]}
        empty={{ icon: UserIcon, title: 'No users', description: 'Invite your team to start collaborating.', action: <Button variant="primary" icon={UserPlus} onClick={() => setInvite(true)}>Invite people</Button> }}
      />

      <InviteUserModal open={inviteOpen} onClose={() => setInvite(false)} />
    </Page>
  );
}
