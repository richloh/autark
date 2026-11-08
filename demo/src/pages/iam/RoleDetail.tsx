import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Users, Lock, Copy, Pencil, Trash2, Save, X, Bot, UserPlus, UserMinus, Activity, Grid3x3 } from 'lucide-react';
import { useItem, useList, useLookup, useApiMutation } from '@/api/hooks';
import { api, type ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Tabs, useTabParam } from '@/components/ui/Tabs';
import { Field, Input, Textarea, Select, Hint } from '@/components/ui/form';
import { EmptyState, Skeleton, Mono } from '@/components/ui/misc';
import { confirm } from '@/components/ui/Modal';
import { fieldErrors } from '@/components/ui/FormLayout';
import { IacTabs, toCurl } from '@/components/ui/CodeBlock';
import { toast } from '@/components/ui/toast';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { PermissionMatrix } from '@/components/iam/PermissionMatrix';
import { RoleMatrixEditor, RoleSummary } from '@/components/iam/RoleDesigner';
import { Avatar, BotAvatar } from '@/components/iam/Avatar';
import { ProjectScope } from '@/components/iam/RoleChips';
import { normalize, countPermissions, MAX_PERMISSIONS, expand, type Perms } from '@/components/iam/permissions';
import { timeAgo, date } from '@/lib/format';
import type { Role, User, SystemAccount, Project } from '@/types';

export default function RoleDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { data: role, isLoading, error } = useItem<Role>('roles', id);
  const { items: users } = useList<User>('users');
  const { items: svcs } = useList<SystemAccount>('systemAccounts');
  const { map: roles } = useLookup<Role>('roles');
  const [tab, setTab] = useTabParam('permissions');
  const editing = sp.get('edit') === '1' && !!role && !role.system;
  const setEditing = (v: boolean) => { const n = new URLSearchParams(sp); if (v) n.set('edit', '1'); else n.delete('edit'); setSp(n, { replace: true }) };

  const clone = useApiMutation(() => api.action<Role>('roles', id!, 'clone', {}), {
    success: (r) => `Created ${r.name}`,
    onSuccess: (r) => navigate(`/iam/roles/${r.id}?edit=1`),
  });

  if (isLoading) return <Page><Skeleton className="mb-4 h-12 w-72" /><Skeleton className="h-96" /></Page>;
  if (error || !role) return <Page><EmptyState icon={Users} title="Role not found" action={<Button to="/iam/roles">Back to roles</Button>} /></Page>;

  const holders = users.filter((u) => u.roleIds.includes(role.id));
  const svcHolders = svcs.filter((s) => s.roleIds.includes(role.id));
  const remove = async () => {
    if (holders.length || svcHolders.length) {
      toast.error('Role is in use', `Unassign it from ${holders.length} user(s) and ${svcHolders.length} system account(s) first.`);
      setTab('assignments');
      return;
    }
    if (!(await confirm({ title: `Delete role ${role.name}?`, message: 'This cannot be undone.', confirmLabel: 'Delete role', danger: true, typeToConfirm: role.name }))) return;
    try { await api.remove('roles', role.id); toast.success(`Role ${role.name} deleted`); navigate('/iam/roles') } catch (e) { toast.error('Delete failed', (e as Error).message) }
  };

  return (
    <Page wide>
      <PageHeader
        crumbs={[{ label: 'Roles', to: '/iam/roles' }, { label: role.name }]}
        title={role.name}
        icon={role.system ? Lock : Users}
        iconColor="#8b5cf6"
        status={role.system ? <Badge>System role</Badge> : <Badge tone="violet">Custom role</Badge>}
        description={role.description}
        meta={<>
          <span>{countPermissions(role.permissions)}/{MAX_PERMISSIONS} permissions</span>
          <span>{holders.length} user{holders.length === 1 ? '' : 's'} · {svcHolders.length} system account{svcHolders.length === 1 ? '' : 's'}</span>
          {role.clonedFrom && <span>Cloned from <Link className="text-brand-500 hover:underline" to={`/iam/roles/${role.clonedFrom}`}>{roles.get(role.clonedFrom)?.name ?? role.clonedFrom}</Link></span>}
          <span>Created {date(role.createdAt)}</span>
          {role.updatedAt && <span>Updated {timeAgo(role.updatedAt)}</span>}
          <Mono copy className="text-xs">{role.id}</Mono>
        </>}
        actions={<>
          <Button icon={Copy} loading={clone.isPending} onClick={() => clone.mutate()}>{role.system ? 'Clone to customize' : 'Duplicate'}</Button>
          {!role.system && !editing && <Button variant="primary" icon={Pencil} onClick={() => { setTab('permissions'); setEditing(true) }}>Edit</Button>}
          {!role.system && <IconButton icon={Trash2} label="Delete role" variant="secondary" className="hover:text-rose-500" onClick={remove} />}
        </>}
      />

      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[
        { id: 'permissions', label: 'Permissions', icon: <Grid3x3 className="size-3.5" /> },
        { id: 'assignments', label: 'Assignments', count: holders.length + svcHolders.length },
        { id: 'activity', label: 'Activity', icon: <Activity className="size-3.5" /> },
      ]} />

      {tab === 'permissions' && (editing ? <EditRole role={role} onDone={() => setEditing(false)} /> : (
        <div className="grid [&>*]:min-w-0 gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            {role.system && <Hint>System roles are managed by Autark and cannot be changed. <button className="font-medium text-brand-600 hover:underline dark:text-brand-300" onClick={() => clone.mutate()}>Clone it</button> to create a customizable copy.</Hint>}
            <Card><CardHeader icon={Grid3x3} title="Permission matrix" description={role.system ? 'Read-only' : 'Click Edit to change'} /><CardBody><PermissionMatrix perms={role.permissions} /></CardBody></Card>
            <Card><CardBody><IacTabs snippets={{ terraform: roleHcl(role), curl: toCurl('GET', `/roles/${role.id}`) }} /></CardBody></Card>
          </div>
          <div className="space-y-4"><RoleSummary perms={role.permissions} /></div>
        </div>
      ))}

      {tab === 'assignments' && <Assignments role={role} users={users} holders={holders} svcHolders={svcHolders} />}
      {tab === 'activity' && <Card><ActivityFeed targetId={role.id} /></Card>}
    </Page>
  );
}

function roleHcl(role: Role) {
  const lines = [`resource "autark_role" "${role.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}" {`, `  name = ${JSON.stringify(role.name)}`];
  for (const [s, a] of Object.entries(expand(role.permissions))) lines.push(`  permission {`, `    service = "${s}"`, `    actions = [${a!.map((x) => `"${x}"`).join(', ')}]`, `  }`);
  lines.push('}');
  return role.system ? `# System role — reference it by id instead of managing it:\ndata "autark_role" "${role.id.replace('role-', '')}" {\n  id = "${role.id}"\n}` : lines.join('\n');
}

function EditRole({ role, onDone }: { role: Role; onDone: () => void }) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [perms, setPerms] = useState<Perms>(structuredClone(role.permissions));
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setPerms(structuredClone(role.permissions)) }, [role.id]); // eslint-disable-line
  const changed = JSON.stringify(normalize(perms)) !== JSON.stringify(normalize(role.permissions)) || name !== role.name || description !== role.description;
  const affected = (role.userCount ?? 0) + (role.systemAccountCount ?? 0);
  const save = useApiMutation(() => api.update('roles', role.id, { name, description, permissions: normalize(perms) }), {
    silent: true,
    onSuccess: () => { toast.success('Role updated', affected ? `Applies immediately to ${affected} identit${affected === 1 ? 'y' : 'ies'}.` : undefined); onDone() },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); toast.error('Could not save role', e.message) },
  });
  return (
    <div className="grid [&>*]:min-w-0 gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <Card>
          <CardHeader title="Details" />
          <CardBody className="grid [&>*]:min-w-0 gap-4 @min-[36rem]:grid-cols-2">
            <Field label="Name" required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} /></Field>
            <Field label="Description" optional><Textarea rows={1} value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-9" /></Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Permissions" description="Changed cells are outlined in amber." />
          <CardBody><RoleMatrixEditor perms={perms} onChange={setPerms} baseline={role.permissions} error={errors.permissions} /></CardBody>
        </Card>
      </div>
      <div className="space-y-4 @min-[44rem]:sticky @min-[44rem]:top-20 @min-[44rem]:self-start">
        {affected > 0 && <Hint tone="warning">Saving changes access for <b>{affected}</b> assigned identit{affected === 1 ? 'y' : 'ies'} immediately.</Hint>}
        <div className="flex gap-2">
          <Button variant="ghost" icon={X} onClick={onDone}>Cancel</Button>
          <Button variant="primary" icon={Save} className="flex-1" disabled={!changed} loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>
        </div>
        <RoleSummary perms={perms} title="After saving" />
      </div>
    </div>
  );
}

function Assignments({ role, users, holders, svcHolders }: { role: Role; users: User[]; holders: User[]; svcHolders: SystemAccount[] }) {
  const { map: projects } = useLookup<Project>('projects');
  const [pick, setPick] = useState('');
  const candidates = users.filter((u) => !u.roleIds.includes(role.id));
  const assign = useApiMutation((u: User) => api.update('users', u.id, { roleIds: [...u.roleIds, role.id] }), { success: (_r, u) => `${role.name} assigned to ${u.name}`, onSuccess: () => setPick('') });
  const unassign = async (u: User) => {
    if (u.roleIds.length === 1) { toast.error('Cannot remove the only role', `${u.name} needs at least one role. Assign another role first.`); return }
    if (!(await confirm({ title: `Remove ${role.name} from ${u.name}?`, confirmLabel: 'Remove', danger: true }))) return;
    try { await api.update('users', u.id, { roleIds: u.roleIds.filter((r) => r !== role.id) }); toast.success(`Removed from ${u.name}`) } catch (e) { toast.error('Failed', (e as Error).message) }
  };
  return (
    <div className="grid [&>*]:min-w-0 gap-5 @min-[44rem]:grid-cols-2">
      <Card>
        <CardHeader icon={Users} title={`Users (${holders.length})`} />
        <div className="flex gap-2 border-b border-line p-3">
          <Select className="flex-1" value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Assign to a user…" options={candidates.map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` }))} />
          <Button icon={UserPlus} disabled={!pick} loading={assign.isPending} onClick={() => { const u = users.find((x) => x.id === pick); if (u) assign.mutate(u) }}>Assign</Button>
        </div>
        {holders.length === 0 ? <EmptyState icon={Users} title="No users have this role" /> : (
          <ul className="divide-y divide-line">
            {holders.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar name={u.name} seed={u.email} size={30} status={u.status} muted={u.status === 'disabled'} />
                <Link to={`/iam/users/${u.id}`} className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-fg hover:text-brand-500">{u.name}</div><div className="truncate text-[11.5px] text-muted">{u.email}</div></Link>
                <ProjectScope projectIds={u.projectIds} projects={projects} className="hidden @min-[36rem]:flex" />
                {u.status !== 'active' && <StatusPill status={u.status} />}
                <IconButton size="sm" icon={UserMinus} label="Unassign" className="hover:text-rose-500" onClick={() => unassign(u)} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader icon={Bot} title={`System accounts (${svcHolders.length})`} description="Edit role assignments on the system account page." />
        {svcHolders.length === 0 ? <EmptyState icon={Bot} title="No system accounts have this role" /> : (
          <ul className="divide-y divide-line">
            {svcHolders.map((s) => (
              <li key={s.id}>
                <Link to={`/iam/system-accounts/${s.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                  <BotAvatar size={30} disabled={s.status === 'disabled'} />
                  <div className="min-w-0 flex-1"><div className="truncate font-mono text-[13px] text-fg">{s.name}</div><div className="truncate text-[11.5px] text-muted">{s.description}</div></div>
                  <ProjectScope projectIds={s.projectIds} projects={projects} className="hidden @min-[36rem]:flex" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
