import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Users, Plus, Lock, Copy, Trash2, MoreHorizontal, Search, Bot, ShieldAlert, Telescope, Eye } from 'lucide-react';
import { useList, useGet, useLookup, useApiMutation } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Tabs, useTabParam, Segmented } from '@/components/ui/Tabs';
import { Menu } from '@/components/ui/Menu';
import { Stat } from '@/components/ui/Stat';
import { Field, Select } from '@/components/ui/form';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { PermissionGlyph } from '@/components/iam/PermissionMatrix';
import { Avatar, BotAvatar } from '@/components/iam/Avatar';
import { RoleChips, ProjectScope } from '@/components/iam/RoleChips';
import { countPermissions, MAX_PERMISSIONS, riskScore, SERVICES, SERVICE_META, ACTIONS, ACTION_META, type Action } from '@/components/iam/permissions';
import { cn } from '@/lib/cn';
import type { Role, Project, Service } from '@/types';

type Filter = 'all' | 'system' | 'custom' | 'unused';

export default function RoleList() {
  const navigate = useNavigate();
  const [tab, setTab] = useTabParam('roles');
  const { items: roles, isLoading } = useList<Role>('roles');
  const [filter, setFilter] = useState<Filter>('all');

  const clone = useApiMutation((r: Role) => api.action<Role>('roles', r.id, 'clone', {}), {
    success: (res) => `Created ${res.name}`,
    onSuccess: (res) => navigate(`/iam/roles/${res.id}?edit=1`),
  });
  const remove = async (list: Role[]) => {
    const custom = list.filter((r) => !r.system);
    if (!custom.length) { toast.info('System roles cannot be deleted'); return }
    if (!(await confirm({ title: custom.length === 1 ? `Delete role ${custom[0].name}?` : `Delete ${custom.length} roles?`, message: 'Roles that are still assigned cannot be deleted — unassign them first.', confirmLabel: 'Delete', danger: true }))) return;
    const res = await Promise.allSettled(custom.map((r) => api.remove('roles', r.id)));
    const failed = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) toast.error(failed.length === 1 ? 'Role is in use' : `${failed.length} roles are in use`, failed[0].reason?.message);
    if (failed.length < custom.length) toast.success(`${custom.length - failed.length} role(s) deleted`);
  };

  const counts = {
    all: roles.length, system: roles.filter((r) => r.system).length, custom: roles.filter((r) => !r.system).length,
    unused: roles.filter((r) => !r.userCount && !r.systemAccountCount).length,
  };
  const rows = roles.filter((r) => filter === 'all' || (filter === 'system' ? r.system : filter === 'custom' ? !r.system : !r.userCount && !r.systemAccountCount));
  const privileged = roles.filter((r) => riskScore(r.permissions) >= 70);

  const columns: Column<Role>[] = [
    {
      id: 'name', header: 'Role', sort: (r) => r.name,
      cell: (r) => (
        <div className="min-w-0">
          <Link to={`/iam/roles/${r.id}`} className="flex items-center gap-1.5 font-medium text-fg hover:text-brand-500">{r.system && <Lock className="size-3 text-faint" />}{r.name}</Link>
          <div className="line-clamp-1 max-w-md text-[11.5px] text-muted">{r.description || '—'}</div>
        </div>
      ),
    },
    { id: 'type', header: 'Type', sort: (r) => Number(r.system), cell: (r) => r.system ? <Badge>System</Badge> : <Badge tone="violet">Custom</Badge> },
    {
      id: 'perms', header: 'Permissions', sort: (r) => countPermissions(r.permissions),
      cell: (r) => {
        const n = countPermissions(r.permissions);
        return (
          <div className="flex items-center gap-3">
            <PermissionGlyph perms={r.permissions} size={5} />
            <div className="w-16"><div className="text-xs tabular text-fg-2">{n}/{MAX_PERMISSIONS}</div><div className="mt-0.5 h-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(n / MAX_PERMISSIONS) * 100}%` }} /></div></div>
          </div>
        );
      },
    },
    {
      id: 'risk', header: 'Blast radius', hideBelow: 'lg', sort: (r) => riskScore(r.permissions),
      cell: (r) => { const s = riskScore(r.permissions); return <span className={cn('inline-flex items-center gap-1 text-xs font-medium', s >= 70 ? 'text-rose-600 dark:text-rose-400' : s >= 35 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>{s >= 70 && <ShieldAlert className="size-3.5" />}{s >= 70 ? 'High' : s >= 35 ? 'Medium' : 'Low'}</span> },
    },
    { id: 'users', header: 'Users', align: 'right', sort: (r) => r.userCount ?? 0, cell: (r) => <span className={cn('tabular', r.userCount ? 'text-fg' : 'text-faint')}>{r.userCount ?? 0}</span> },
    { id: 'svc', header: 'System accts', align: 'right', hideBelow: 'md', sort: (r) => r.systemAccountCount ?? 0, cell: (r) => <span className={cn('tabular', r.systemAccountCount ? 'text-fg' : 'text-faint')}>{r.systemAccountCount ?? 0}</span> },
  ];

  return (
    <Page wide>
      <PageHeader title="Roles" icon={Users} iconColor="#8b5cf6"
        description="Roles bundle permissions (service × action). Assign them to users and system accounts; effective access is the union of all roles."
        actions={<Button variant="primary" icon={Plus} to="/iam/roles/new">Create role</Button>} />

      <div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Roles" value={counts.all} icon={Users} sub={`${counts.system} system · ${counts.custom} custom`} />
        <Stat label="Assignments" value={roles.reduce((a, r) => a + (r.userCount ?? 0) + (r.systemAccountCount ?? 0), 0)} icon={Users} sub="users + system accounts" />
        <Stat label="High blast radius" value={privileged.length} icon={ShieldAlert} sub={privileged.map((r) => r.name).slice(0, 2).join(', ') || 'none'} />
        <Stat label="Unused roles" value={counts.unused} icon={Eye} sub={counts.unused ? 'candidates for cleanup' : 'all roles in use'} />
      </div>

      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[{ id: 'roles', label: 'Roles', count: roles.length }, { id: 'explorer', label: 'Access explorer', icon: <Telescope className="size-3.5" /> }]} />

      {tab === 'roles' ? (
        <DataTable rows={rows} loading={isLoading} columns={columns}
          searchText={(r) => `${r.name} ${r.description} ${r.system ? 'system' : 'custom'}`}
          rowLink={(r) => `/iam/roles/${r.id}`}
          defaultSort={{ id: 'type', dir: 'desc' }}
          toolbar={<FilterChips value={filter} onChange={setFilter} options={[
            { value: 'all', label: 'All', count: counts.all }, { value: 'system', label: 'System', count: counts.system }, { value: 'custom', label: 'Custom', count: counts.custom },
            ...(counts.unused ? [{ value: 'unused' as const, label: 'Unused', count: counts.unused }] : []),
          ]} />}
          rowActions={(r) => (
            <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />} items={[
              { label: 'View', icon: Eye, to: `/iam/roles/${r.id}` },
              { label: r.system ? 'Clone to customize' : 'Duplicate', icon: Copy, onClick: () => clone.mutate(r) },
              { divider: true, label: '' },
              { label: 'Delete', icon: Trash2, danger: true, disabled: r.system, hint: r.system ? 'system' : undefined, onClick: () => remove([r]) },
            ]} />
          )}
          bulkActions={[{ label: 'Delete', icon: Trash2, danger: true, onClick: remove }]}
          empty={{ icon: Users, title: 'No roles', action: <Button variant="primary" icon={Plus} to="/iam/roles/new">Create role</Button> }}
        />
      ) : <AccessExplorer />}
    </Page>
  );
}

interface WhoCan {
  roles: { id: string; name: string; system: boolean }[];
  users: { id: string; name: string; email: string; status: string; via: string[]; projectIds: string[] | '*' }[];
  systemAccounts: { id: string; name: string; status: string; via: string[]; projectIds: string[] | '*' }[];
}

/** "Who can delete hardware?" — pick a service, action and project; see every identity that has it and why. */
function AccessExplorer() {
  const [service, setService] = useState<Service>('hardware');
  const [action, setAction] = useState<Action>('delete');
  const [projectId, setProjectId] = useState('');
  const { map: roles } = useLookup<Role>('roles');
  const { map: projects, items: projectList } = useLookup<Project>('projects');
  const rolesKey = useMemo(() => [...roles.values()].map((r) => `${r.id}${countPermissions(r.permissions)}`).join(), [roles]);
  const { data, isLoading } = useGet<WhoCan>(['users', 'whoCan', rolesKey], `/iam/who-can?service=${service}&action=${action}${projectId ? `&projectId=${projectId}` : ''}`);
  const total = (data?.users.length ?? 0) + (data?.systemAccounts.length ?? 0);
  return (
    <div className="space-y-5">
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <span className="pb-2 text-lg font-medium text-fg">Who can</span>
            <div className="w-full @min-[36rem]:w-auto"><Segmented value={action} onChange={setAction} options={ACTIONS.map((a) => ({ value: a, label: ACTION_META[a].label }))} /></div>
            <Field className="w-full @min-[36rem]:w-52"><Select value={service} onChange={(e) => setService(e.target.value as Service)} options={SERVICES.map((s) => ({ value: s, label: SERVICE_META[s].label }))} /></Field>
            <span className="pb-2 text-muted">in</span>
            <Field className="w-full @min-[36rem]:w-56"><Select value={projectId} onChange={(e) => setProjectId(e.target.value)} options={[{ value: '', label: 'any project' }, ...projectList.map((p) => ({ value: p.id, label: p.name }))]} /></Field>
            <span className="pb-2 text-lg font-medium text-fg">?</span>
          </div>
        </CardBody>
      </Card>
      {isLoading || !data ? <Skeleton className="h-48" /> : (
        <>
          <div className={cn('rounded-xl border p-4 text-sm', total === 0 ? 'border-line bg-surface-2 text-muted' : action === 'delete' || service === 'iam' || service === 'hardware' ? 'border-amber-500/30 bg-amber-500/5 text-fg-2' : 'border-line bg-surface text-fg-2')}>
            <b className="text-fg">{total} identit{total === 1 ? 'y' : 'ies'}</b> can {ACTION_META[action].verb} {SERVICE_META[service].noun}{projectId ? ` in ${projects.get(projectId)?.name}` : ''}, through {data.roles.length} role{data.roles.length === 1 ? '' : 's'}:{' '}
            {data.roles.map((r, i) => <span key={r.id}>{i > 0 && ', '}<Link to={`/iam/roles/${r.id}`} className="font-medium text-brand-600 hover:underline dark:text-brand-300">{r.name}</Link></span>)}
            {!data.roles.length && 'none'}.
          </div>
          <div className="grid [&>*]:min-w-0 gap-5 @min-[44rem]:grid-cols-2">
            <Card>
              <CardHeader icon={Users} title={`Users (${data.users.length})`} />
              {data.users.length === 0 ? <EmptyState icon={Search} title="No users" /> : (
                <ul className="divide-y divide-line">
                  {data.users.map((u) => (
                    <li key={u.id}>
                      <Link to={`/iam/users/${u.id}?tab=permissions`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                        <Avatar name={u.name} seed={u.email} size={30} status={u.status as any} muted={u.status === 'disabled'} />
                        <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-fg">{u.name}</div><div className="truncate text-[11.5px] text-muted">{u.email}</div></div>
                        <div className="hidden flex-col items-end gap-1 @min-[36rem]:flex"><RoleChips roleIds={u.via} roles={roles} link={false} /><ProjectScope projectIds={u.projectIds} projects={projects} className="text-[11px]" /></div>
                        {u.status !== 'active' && <StatusPill status={u.status} />}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader icon={Bot} title={`System accounts (${data.systemAccounts.length})`} />
              {data.systemAccounts.length === 0 ? <EmptyState icon={Search} title="No system accounts" /> : (
                <ul className="divide-y divide-line">
                  {data.systemAccounts.map((s) => (
                    <li key={s.id}>
                      <Link to={`/iam/system-accounts/${s.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                        <BotAvatar size={30} disabled={s.status === 'disabled'} />
                        <div className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg">{s.name}</div>
                        <RoleChips roleIds={s.via} roles={roles} link={false} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
