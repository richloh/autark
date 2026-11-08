import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  User as UserIcon, Ban, CheckCircle2, Mail, MoreHorizontal, Trash2, ShieldCheck, ShieldOff, ShieldAlert, Fingerprint, LogOut, Monitor, Terminal, Smartphone,
  Pencil, Save, KeyRound, LogIn, Globe2, Grid3x3, Activity, Lock,
} from 'lucide-react';
import { useItem, useList, useLookup, useGet, useApiMutation } from '@/api/hooks';
import { api, type ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardHeader, CardBody, KeyValue } from '@/components/ui/Card';
import { StatusPill, Badge, Tags } from '@/components/ui/Badge';
import { Tabs, useTabParam } from '@/components/ui/Tabs';
import { Menu } from '@/components/ui/Menu';
import { Modal, confirm } from '@/components/ui/Modal';
import { Field, Input, Switch, Hint, TagEditor, Select } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { Advanced, Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import { EmptyState, Skeleton, Mono } from '@/components/ui/misc';
import { fieldErrors } from '@/components/ui/FormLayout';
import { toast } from '@/components/ui/toast';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { Avatar } from '@/components/iam/Avatar';
import { RoleChips, ProjectScope } from '@/components/iam/RoleChips';
import { RolePicker, ProjectScopePicker } from '@/components/iam/AccessEditor';
import { PermissionMatrix } from '@/components/iam/PermissionMatrix';
import { TokensTable } from '@/components/iam/Tokens';
import { ActorFeed } from '@/components/iam/ActorFeed';
import { describe, unionPerms, countPermissions, MAX_PERMISSIONS, blastRadius } from '@/components/iam/permissions';
import { timeAgo, dateTime, date } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { User, Role, Project, EffectivePermissions, UserSession } from '@/types';

const ME = 'user-001';
const SIMPLE_ROLES = [
  { value: 'role-admin', label: 'Admin — full access, incl. team & billing' },
  { value: 'role-ops', label: 'Operations — run all infrastructure' },
  { value: 'role-developer', label: 'Developer — build in their projects' },
  { value: 'role-viewer', label: 'Viewer — read-only' },
];

export default function UserDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: u, isLoading, error } = useItem<User>('users', id);
  const { map: roles, items: roleList } = useLookup<Role>('roles');
  const { map: projects } = useLookup<Project>('projects');
  const pro = usePro();
  const [tabParam, setTab] = useTabParam('overview');
  const tab = pro || ['overview', 'access', 'security'].includes(tabParam) ? tabParam : 'overview';
  const [editing, setEditing] = useState(false);

  const act = useApiMutation(({ a, body }: { a: string; body?: unknown }) => api.action('users', id!, a, body), {
    success: (_r, v) => ({ disable: 'User disabled', enable: 'User enabled', resendInvite: 'Invitation re-sent', resetMfa: 'MFA reset', requireMfa: 'MFA policy updated', revokeSession: 'Session revoked', revokeAllSessions: 'Other sessions signed out', simulateLogin: 'Simulated sign-in' } as Record<string, string>)[v.a] ?? 'Done',
  });

  if (isLoading) return <Page><Skeleton className="mb-4 h-12 w-72" /><Skeleton className="h-64" /></Page>;
  if (error || !u) return <Page><EmptyState icon={UserIcon} title="User not found" description={`No user with id ${id}.`} action={<Button to="/iam/users">Back to users</Button>} /></Page>;

  const isMe = u.id === ME;
  const disable = async () => {
    if (await confirm({ title: `Disable ${u.name}?`, message: 'They are signed out everywhere immediately and cannot sign in or use personal tokens until re-enabled.', confirmLabel: 'Disable', danger: true })) act.mutate({ a: 'disable' });
  };
  const remove = async () => {
    if (!(await confirm({ title: `Delete ${u.name}?`, message: 'The account, sessions and personal API tokens are removed permanently. Audit history is kept.', confirmLabel: 'Delete user', danger: true, typeToConfirm: u.email }))) return;
    try { await api.remove('users', u.id); toast.success(`${u.name} deleted`); navigate('/iam/users') } catch (e) { toast.error('Delete failed', (e as Error).message) }
  };

  const tokens = u.apiTokens ?? [];
  const sessions = u.sessions ?? [];

  return (
    <Page wide>
      <PageHeader
        crumbs={[{ label: pro ? 'Users' : 'Team', to: '/iam/users' }, { label: u.name }]}
        title={u.name}
        status={<><StatusPill status={u.status} />{isMe && <Badge tone="brand">you</Badge>}</>}
        description={u.title || undefined}
        meta={<>
          <span className="inline-flex items-center gap-1"><Mail className="size-3.5" />{u.email}</span>
          <span>Member since {date(u.createdAt)}</span>
          <span>Last login {u.lastLogin ? timeAgo(u.lastLogin) : 'never'}</span>
          {pro && <Mono copy className="text-xs">{u.id}</Mono>}
        </>}
        actions={<>
          {u.status === 'invited' && <Button icon={Mail} onClick={() => act.mutate({ a: 'resendInvite' })}>Resend invite</Button>}
          {u.status === 'disabled'
            ? <Button icon={CheckCircle2} onClick={() => act.mutate({ a: 'enable' })}>Enable</Button>
            : <Button icon={Ban} disabled={isMe} title={isMe ? 'You cannot disable yourself' : undefined} onClick={disable}>Disable</Button>}
          <Button variant="primary" icon={Pencil} onClick={() => setEditing(true)}>Edit profile</Button>
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="More" variant="secondary" />} items={[
            { label: 'Edit access', icon: KeyRound, onClick: () => setTab('access') },
            ...(!pro ? [] : [
              { label: 'Reset MFA', icon: ShieldOff, disabled: !u.mfa || u.sso, onClick: async () => { if (await confirm({ title: `Reset MFA for ${u.name}?`, message: 'The enrolled device is removed; they must enroll again at next sign-in.', confirmLabel: 'Reset', danger: true })) act.mutate({ a: 'resetMfa' }) } },
              { label: 'Simulate sign-in (demo)', icon: LogIn, disabled: u.status === 'disabled', onClick: () => act.mutate({ a: 'simulateLogin' }) },
            ]),
            { divider: true, label: '' },
            { label: 'Delete user', icon: Trash2, danger: true, disabled: isMe, onClick: remove },
          ]} />
        </>}
        icon={UserIcon}
        iconColor="#64748b"
      />

      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={!pro ? [
        { id: 'overview', label: 'Profile' },
        { id: 'access', label: 'Role & projects' },
        { id: 'security', label: 'Sessions', count: sessions.length },
      ] : [
        { id: 'overview', label: 'Overview' },
        { id: 'access', label: 'Roles & projects', count: u.roleIds.length },
        { id: 'permissions', label: 'Effective permissions' },
        { id: 'security', label: 'Security', count: sessions.length + tokens.filter((t) => t.status === 'active').length },
        { id: 'activity', label: 'Activity' },
      ]} />

      {tab === 'overview' && <Overview u={u} roles={roles} projects={projects} setTab={setTab} />}
      {tab === 'access' && <AccessTab u={u} roles={roles} />}
      {tab === 'permissions' && <PermissionsTab u={u} roleList={roleList} projects={projects} />}
      {tab === 'security' && (
        <div className="space-y-5">
          <MfaCard u={u} onAction={(a, body) => act.mutate({ a, body })} />
          <SessionsCard u={u} sessions={sessions} onRevoke={(s) => act.mutate({ a: 'revokeSession', body: { sessionId: s.id } })} onRevokeAll={async () => {
            if (await confirm({ title: 'Sign out all other sessions?', message: `${sessions.filter((s) => !s.current).length} session(s) will be terminated immediately.`, confirmLabel: 'Sign out all', danger: true })) act.mutate({ a: 'revokeAllSessions' });
          }} />
          <Pro>
          <Card>
            <CardHeader icon={KeyRound} title="Personal API tokens" description={`Act as ${u.name} from the CLI, scripts or Terraform. Tokens inherit this user's roles and project access.`} />
            <TokensTable tokens={tokens} collection="users" ownerId={u.id} ownerName={u.email} kind="user" canRotate={false}
              disabledReason={u.status !== 'active' ? `User is ${u.status}` : undefined} />
          </Card>
          </Pro>
        </div>
      )}
      {tab === 'activity' && (
        <div className="grid [&>*]:min-w-0 gap-5 @min-[60rem]:grid-cols-2">
          <Card><CardHeader icon={Activity} title={`Actions by ${u.name.split(' ')[0]}`} description={`Audit events where the actor is ${u.email}`} /><ActorFeed actor={u.email} /></Card>
          <Card><CardHeader icon={UserIcon} title="Changes to this account" description="Invitations, role changes, MFA and token events" /><ActivityFeed targetId={u.id} /></Card>
        </div>
      )}

      <EditProfileModal u={u} open={editing} onClose={() => setEditing(false)} />
    </Page>
  );
}

/* ------------------------------------------------------------------ overview */

function Overview({ u, roles, projects, setTab }: { u: User; roles: Map<string, Role>; projects: Map<string, Project>; setTab: (t: string) => void }) {
  const pro = usePro();
  const userRoles = u.roleIds.map((r) => roles.get(r)).filter(Boolean) as Role[];
  const perms = unionPerms(userRoles);
  const risks = blastRadius(perms).filter((r) => r.level === 'high');
  return (
    <div className="grid [&>*]:min-w-0 gap-5 @min-[56rem]:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        <Card>
          <CardHeader icon={UserIcon} title="Profile" />
          <CardBody>
            <div className="mb-5 flex items-center gap-4">
              <Avatar name={u.name} seed={u.email} size={56} status={u.status} />
              <div className="min-w-0">
                <div className="text-base font-semibold text-fg">{u.name}</div>
                <div className="text-sm text-muted">{u.title || 'No title'} · {u.email}</div>
              </div>
            </div>
            <KeyValue cols={pro ? 3 : 2} items={!pro ? [
              ['Status', <StatusPill status={u.status} />],
              ['Last login', u.lastLogin ? <span title={dateTime(u.lastLogin)}>{timeAgo(u.lastLogin)}</span> : 'never'],
              ['Sign-in', `${u.sso ? 'Single sign-on' : 'Password'}${u.mfa || u.sso ? ' + MFA' : ''}`],
              ['Member since', date(u.createdAt)],
              ...(u.status === 'invited' ? [['Invitation expires', u.inviteExpiresAt ? timeAgo(u.inviteExpiresAt) : '—'] as [string, string]] : []),
            ] : [
              ['Status', <StatusPill status={u.status} />],
              ['Authentication', u.sso ? 'Single sign-on (OIDC)' : 'Password'],
              ['MFA', u.mfa ? <span className="text-emerald-600 dark:text-emerald-400">{u.mfaMethod === 'webauthn' ? 'Security key' : 'Authenticator app'}</span> : u.sso ? 'Enforced by IdP' : <span className="text-amber-600 dark:text-amber-400">{u.mfaRequired ? 'Required, not enrolled' : 'Not enrolled'}</span>],
              ['Last login', u.lastLogin ? <span title={dateTime(u.lastLogin)}>{timeAgo(u.lastLogin)}</span> : 'never'],
              ['Created', dateTime(u.createdAt)],
              ['Invited by', u.invitedBy ?? '—'],
              ...(u.status === 'invited' ? [['Invitation expires', u.inviteExpiresAt ? timeAgo(u.inviteExpiresAt) : '—'] as [string, string]] : []),
              ...(u.status === 'disabled' ? [['Disabled', u.disabledAt ? timeAgo(u.disabledAt) : '—'] as [string, string]] : []),
              ['Tags', <Tags tags={u.tags} />],
            ]} />
          </CardBody>
        </Card>
        <Pro>
        <Card>
          <CardHeader icon={Activity} title="Recent actions" actions={<Button size="xs" variant="ghost" onClick={() => setTab('activity')}>View all</Button>} />
          <ActorFeed actor={u.email} limit={6} />
        </Card>
        </Pro>
      </div>
      <div className="space-y-5">
        <Card>
          <CardHeader icon={KeyRound} title="Access" actions={<Button size="xs" variant="ghost" icon={Pencil} onClick={() => setTab('access')}>Edit</Button>} />
          <CardBody className="space-y-4">
            <div><div className="mb-1.5 text-xs font-medium text-muted">Roles</div><RoleChips roleIds={u.roleIds} roles={roles} max={10} /></div>
            <div><div className="mb-1.5 text-xs font-medium text-muted">Projects</div><ProjectScope projectIds={u.projectIds} projects={projects} /></div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted"><span>What {u.name.split(' ')[0]} can do</span>{pro && <span className="tabular">{countPermissions(perms)}/{MAX_PERMISSIONS}</span>}</div>
              <ul className="space-y-1 text-[13px] text-fg-2">{describe(perms).map((l) => <li key={l} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-faint" />{l}</li>)}</ul>
            </div>
            {risks.length > 0 && <Hint tone="warning"><b>{risks.length} high-impact permission{risks.length > 1 ? 's' : ''}</b>, e.g. {risks[0].text.charAt(0).toLowerCase() + risks[0].text.slice(1)}</Hint>}
            {pro && <Button size="sm" icon={Grid3x3} onClick={() => setTab('permissions')} className="w-full">Open permissions matrix</Button>}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ access editor */

function AccessTab({ u, roles }: { u: User; roles: Map<string, Role> }) {
  const pro = usePro();
  const [roleIds, setRoleIds] = useState(u.roleIds);
  const [projectIds, setProjectIds] = useState<string[] | '*'>(u.projectIds);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setRoleIds(u.roleIds); setProjectIds(u.projectIds) }, [u.roleIds.join(), JSON.stringify(u.projectIds)]); // eslint-disable-line
  const dirty = roleIds.join() !== u.roleIds.join() || JSON.stringify(projectIds) !== JSON.stringify(u.projectIds);
  const added = roleIds.filter((r) => !u.roleIds.includes(r));
  const removed = u.roleIds.filter((r) => !roleIds.includes(r));
  const before = unionPerms(u.roleIds.map((r) => roles.get(r)).filter(Boolean) as Role[]);
  const after = unionPerms(roleIds.map((r) => roles.get(r)).filter(Boolean) as Role[]);
  const delta = countPermissions(after) - countPermissions(before);
  const simpleRole = roleIds.length === 1 && SIMPLE_ROLES.some((r) => r.value === roleIds[0]) ? roleIds[0] : null;

  const save = useApiMutation(() => api.update('users', u.id, { roleIds, projectIds }), {
    silent: true,
    onSuccess: () => toast.success('Access updated', `${u.name}'s permissions changed immediately.`),
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); toast.error('Could not update access', e.message) },
  });

  return (
    <div className="grid [&>*]:min-w-0 gap-5 @min-[56rem]:grid-cols-[minmax(0,1fr)_340px]">
      {!pro ? (
        <div className="space-y-5">
          <Card>
            <CardHeader title="Role" />
            <CardBody className="space-y-4">
              <Select value={simpleRole ?? 'custom'} onChange={(e) => { if (e.target.value !== 'custom') { setRoleIds([e.target.value]); setErrors({}) } }}
                options={[...SIMPLE_ROLES, ...(simpleRole ? [] : [{ value: 'custom', label: roleIds.length ? `Custom: ${roleIds.map((r) => roles.get(r)?.name ?? r).join(' + ')}` : 'No role' }])]} />
              {errors.roleIds && <p className="text-xs text-rose-600 dark:text-rose-400">{errors.roleIds}</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={Globe2} title="Projects" />
            <CardBody className="space-y-4">
              <Segmented value={projectIds === '*' ? 'all' : 'some'} onChange={(v) => { setProjectIds(v === 'all' ? '*' : []); setErrors({}) }} options={[{ value: 'all', label: 'All projects' }, { value: 'some', label: 'Choose projects' }]} />
              {projectIds !== '*' && <ProjectScopePicker value={projectIds} onChange={(v) => { setProjectIds(v); setErrors({}) }} error={errors.projectIds} hideAllSwitch />}
            </CardBody>
          </Card>
          <Advanced title="Combine roles" description="Assign several or custom roles">
            <RolePicker value={roleIds} onChange={(v) => { setRoleIds(v); setErrors({}) }} />
          </Advanced>
        </div>
      ) : (
      <div className="space-y-5">
        <Card><CardHeader title="Roles" description="Effective permissions are the union of all roles." /><CardBody><RolePicker value={roleIds} onChange={(v) => { setRoleIds(v); setErrors({}) }} error={errors.roleIds} /></CardBody></Card>
        <Card><CardHeader icon={Globe2} title="Project memberships" description="Roles apply only inside these projects (IAM and billing permissions are account-wide)." /><CardBody><ProjectScopePicker value={projectIds} onChange={(v) => { setProjectIds(v); setErrors({}) }} error={errors.projectIds} /></CardBody></Card>
      </div>
      )}
      <div className="space-y-4 @min-[44rem]:sticky @min-[44rem]:top-20 @min-[44rem]:self-start">
        <Card>
          <CardHeader title="Review changes" />
          <CardBody className="space-y-3 text-[13px]">
            {!dirty ? <p className="text-muted">No changes yet. Select roles and projects on the left.</p> : (
              <>
                {added.map((r) => <div key={r} className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400"><span className="font-mono">+</span>{roles.get(r)?.name}</div>)}
                {removed.map((r) => <div key={r} className="flex items-center gap-2 text-rose-700 dark:text-rose-400"><span className="font-mono">−</span>{roles.get(r)?.name}</div>)}
                {JSON.stringify(projectIds) !== JSON.stringify(u.projectIds) && <div className="text-fg-2">Project access: {projectIds === '*' ? 'all projects' : `${projectIds.length} project(s)`}</div>}
                <div className={cn('rounded-lg px-2.5 py-2 text-xs', delta > 0 ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300' : delta < 0 ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'bg-surface-2 text-muted')}>
                  {delta > 0 ? `Grants ${delta} additional permission${delta > 1 ? 's' : ''}` : delta < 0 ? `Removes ${-delta} permission${delta < -1 ? 's' : ''}` : 'Same permission set'}{pro && ` (${countPermissions(after)}/${MAX_PERMISSIONS})`}
                </div>
              </>
            )}
            {u.id === ME && removed.includes('role-admin') && <Hint tone="danger">You are removing your own Administrator role. You may lose access to this page.</Hint>}
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" disabled={!dirty} onClick={() => { setRoleIds(u.roleIds); setProjectIds(u.projectIds); setErrors({}) }}>Reset</Button>
              <Button variant="primary" icon={Save} className="flex-1" disabled={!dirty || !roleIds.length} loading={save.isPending} onClick={() => save.mutate()}>Save access</Button>
            </div>
          </CardBody>
        </Card>
        <Card><CardHeader title="Resulting access" /><CardBody><ul className="space-y-1 text-[13px] text-fg-2">{describe(after).map((l) => <li key={l} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-faint" />{l}</li>)}</ul></CardBody></Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ effective permissions */

function PermissionsTab({ u, roleList, projects }: { u: User; roleList: Role[]; projects: Map<string, Project> }) {
  const rolesKey = useMemo(() => roleList.map((r) => `${r.id}:${countPermissions(r.permissions)}:${r.updatedAt ?? ''}`).join('|'), [roleList]);
  const { data, isLoading } = useGet<EffectivePermissions>(['users', 'effective', u.id, rolesKey], `/iam/effective?userId=${u.id}`);
  if (isLoading || !data) return <Skeleton className="h-96" />;
  return (
    <div className="grid [&>*]:min-w-0 gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader icon={Grid3x3} title="Effective permissions" description="Union of all assigned roles. Each colour is a role; striped cells are granted by several roles." />
        <CardBody>
          {data.roles.length ? <PermissionMatrix grants={data.grants} roles={data.roles} /> : <EmptyState title="No roles assigned" description="This user cannot do anything yet." />}
        </CardBody>
      </Card>
      <div className="space-y-5">
        <Card>
          <CardHeader title="Where it applies" />
          <CardBody className="space-y-3 text-[13px]">
            <ProjectScope projectIds={data.projectIds} projects={projects} />
            <p className="text-xs text-muted">Resource permissions are limited to these projects. IAM and Billing permissions apply account-wide.</p>
            {u.status !== 'active' && <Hint tone="warning">This user is <b>{u.status}</b> — none of these permissions can be exercised right now.</Hint>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Roles" />
          <ul className="divide-y divide-line">
            {data.roles.map((r) => {
              const role = roleList.find((x) => x.id === r.id);
              return (
                <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                  <Link to={`/iam/roles/${r.id}`} className="flex items-center gap-1.5 font-medium text-fg hover:text-brand-500">{r.system && <Lock className="size-3 text-faint" />}{r.name}</Link>
                  <span className="text-xs text-muted tabular">{countPermissions(role?.permissions)} perms</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ security */

function MfaCard({ u, onAction }: { u: User; onAction: (a: string, body?: unknown) => void }) {
  return (
    <Card>
      <CardHeader icon={ShieldCheck} title="Multi-factor authentication" />
      <CardBody className="grid [&>*]:min-w-0 gap-4 @min-[40rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex items-start gap-3">
          <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', u.mfa || u.sso ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500')}>
            {u.mfa ? (u.mfaMethod === 'webauthn' ? <Fingerprint className="size-5" /> : <ShieldCheck className="size-5" />) : u.sso ? <ShieldCheck className="size-5" /> : <ShieldAlert className="size-5" />}
          </div>
          <div className="min-w-0 text-[13px]">
            <div className="font-medium text-fg">{u.mfa ? (u.mfaMethod === 'webauthn' ? 'Security key (WebAuthn) enrolled' : 'Authenticator app (TOTP) enrolled') : u.sso ? 'Managed by identity provider' : 'No second factor enrolled'}</div>
            <div className="mt-0.5 text-muted">{u.sso ? 'MFA is enforced by your OIDC provider for SSO users.' : u.mfa ? 'Reset if the user lost their device.' : u.mfaRequired ? 'Enrollment will be enforced at next sign-in.' : 'This account can sign in with a password alone.'}</div>
            {u.mfa && !u.sso && <Button size="xs" variant="outline-danger" icon={ShieldOff} className="mt-2" onClick={async () => { if (await confirm({ title: 'Reset MFA?', message: 'The enrolled device is removed; enrollment is required again at next sign-in.', confirmLabel: 'Reset', danger: true })) onAction('resetMfa') }}>Reset MFA</Button>}
          </div>
        </div>
        <div className="rounded-xl border border-line p-3">
          <Switch checked={!!u.mfaRequired} disabled={u.sso} onChange={(v) => onAction('requireMfa', { required: v })} label="Require MFA for this user" description={u.sso ? 'Not applicable to SSO users.' : 'Blocks sign-in until a second factor is enrolled.'} />
        </div>
      </CardBody>
    </Card>
  );
}

const SESSION_ICON = { browser: Monitor, cli: Terminal, mobile: Smartphone };

function SessionsCard({ u, sessions, onRevoke, onRevokeAll }: { u: User; sessions: UserSession[]; onRevoke: (s: UserSession) => void; onRevokeAll: () => void }) {
  const others = sessions.filter((s) => !s.current);
  return (
    <Card>
      <CardHeader icon={Monitor} title="Active sessions" description={u.status === 'disabled' ? 'Disabled users have no sessions.' : 'Signed-in browsers and CLI logins.'}
        actions={others.length > 0 && <Button size="sm" variant="outline-danger" icon={LogOut} onClick={onRevokeAll}>Sign out all{u.id === ME ? ' others' : ''}</Button>} />
      {sessions.length === 0 ? <EmptyState icon={Monitor} title="No active sessions" description={u.status === 'invited' ? 'The user has not accepted the invitation yet.' : 'The user is not signed in anywhere.'} /> : (
        <ul className="divide-y divide-line">
          {sessions.map((s) => {
            const Icon = SESSION_ICON[s.kind] ?? Monitor;
            return (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <Icon className="size-5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px] font-medium text-fg">{s.device}{s.current && <Badge tone="success">this session</Badge>}</div>
                  <div className="text-xs text-muted"><span className="font-mono">{s.ip}</span> · {s.location} · signed in {timeAgo(s.createdAt)}</div>
                </div>
                <span className="hidden text-xs text-muted @min-[36rem]:block" title={dateTime(s.lastActive)}>active {timeAgo(s.lastActive)}</span>
                {!s.current && <IconButton size="sm" icon={LogOut} label="Revoke session" className="hover:text-rose-500" onClick={() => onRevoke(s)} />}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ profile modal */

function EditProfileModal({ u, open, onClose }: { u: User; open: boolean; onClose: () => void }) {
  const [name, setName] = useState(u.name);
  const [title, setTitle] = useState(u.title ?? '');
  const [sso, setSso] = useState(u.sso);
  const [tags, setTags] = useState(u.tags);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setName(u.name); setTitle(u.title ?? ''); setSso(u.sso); setTags(u.tags); setErrors({}) } }, [open]); // eslint-disable-line
  const save = useApiMutation(() => api.update('users', u.id, { name, title, sso, tags }), {
    silent: true,
    onSuccess: () => { toast.success('Profile updated'); onClose() },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); if (!Object.keys(fieldErrors(e)).length) toast.error('Update failed', e.message) },
  });
  return (
    <Modal open={open} onClose={onClose} title="Edit profile" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Full name" required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} /></Field>
        <Field label="Job title" optional><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Platform Engineer" /></Field>
        <Field label="Email" hint="Email is the sign-in identifier and cannot be changed."><Input value={u.email} disabled /></Field>
        <Pro>
          <div className="rounded-xl border border-line p-3"><Switch checked={sso} onChange={setSso} label="Single sign-on" description="Authenticate via your OIDC identity provider instead of a password." /></div>
          <Field label="Tags" error={errors.tags}><TagEditor value={tags} onChange={setTags} suggestions={['team', 'cost-center', 'location']} /></Field>
        </Pro>
      </div>
    </Modal>
  );
}
