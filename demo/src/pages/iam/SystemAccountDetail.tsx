import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Bot, KeyRound, Ban, CheckCircle2, Trash2, Pencil, Save, Network, Tag as TagIcon, Grid3x3, Activity, ShieldAlert, Clock } from 'lucide-react';
import { useItem, useLookup, useGet, useApiMutation, useNow } from '@/api/hooks';
import { api, type ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardBody, KeyValue } from '@/components/ui/Card';
import { StatusPill, Tags, TagChip } from '@/components/ui/Badge';
import { Tabs, useTabParam } from '@/components/ui/Tabs';
import { Modal, confirm } from '@/components/ui/Modal';
import { Field, Input, Textarea, TagEditor, Hint } from '@/components/ui/form';
import { EmptyState, Skeleton, Mono } from '@/components/ui/misc';
import { IacTabs } from '@/components/ui/CodeBlock';
import { fieldErrors } from '@/components/ui/FormLayout';
import { toast } from '@/components/ui/toast';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { RoleChips, ProjectScope } from '@/components/iam/RoleChips';
import { RolePicker, ProjectScopePicker } from '@/components/iam/AccessEditor';
import { PermissionMatrix } from '@/components/iam/PermissionMatrix';
import { TokensTable } from '@/components/iam/Tokens';
import { CidrListEditor } from '@/components/iam/CidrListEditor';
import { ActorFeed } from '@/components/iam/ActorFeed';
import { describe, unionPerms, countPermissions } from '@/components/iam/permissions';
import { timeAgo, dateTime, date } from '@/lib/format';
import type { SystemAccount, Role, Project, EffectivePermissions } from '@/types';

export default function SystemAccountDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const now = useNow(60_000);
  const { data: s, isLoading, error } = useItem<SystemAccount>('systemAccounts', id);
  const { map: roles, items: roleList } = useLookup<Role>('roles');
  const { map: projects } = useLookup<Project>('projects');
  const [tab, setTab] = useTabParam('overview');
  const [editing, setEditing] = useState(false);
  const act = useApiMutation((a: string) => api.action('systemAccounts', id!, a), { success: (_r, a) => (a === 'disable' ? 'System account disabled — its tokens are rejected' : 'System account enabled') });

  if (isLoading) return <Page><Skeleton className="mb-4 h-12 w-72" /><Skeleton className="h-64" /></Page>;
  if (error || !s) return <Page><EmptyState icon={Bot} title="System account not found" action={<Button to="/iam/system-accounts">Back</Button>} /></Page>;

  const active = s.tokens.filter((t) => t.status === 'active');
  const disabled = s.status === 'disabled';
  const remove = async () => {
    if (!(await confirm({ title: `Delete ${s.name}?`, message: `${active.length} active token(s) stop working immediately.`, confirmLabel: 'Delete', danger: true, typeToConfirm: s.name }))) return;
    try { await api.remove('systemAccounts', s.id); toast.success(`${s.name} deleted`); navigate('/iam/system-accounts') } catch (e) { toast.error('Delete failed', (e as Error).message) }
  };
  const expSoon = active.filter((t) => t.expiresAt && Date.parse(t.expiresAt) - now < 14 * 86_400_000);
  const perms = unionPerms(s.roleIds.map((r) => roles.get(r)).filter(Boolean) as Role[]);

  return (
    <Page wide>
      <PageHeader
        crumbs={[{ label: 'System Accounts', to: '/iam/system-accounts' }, { label: s.name }]}
        title={s.name} icon={Bot} iconColor="#8b5cf6"
        status={<StatusPill status={s.status ?? 'active'} />}
        description={s.description}
        meta={<>
          <span>Audit actor <code className="font-mono text-fg-2">svc:{s.name}</code></span>
          <span>{active.length} active token{active.length === 1 ? '' : 's'}</span>
          <span>Last used {s.lastUsed ? timeAgo(s.lastUsed) : 'never'}</span>
          <Mono copy className="text-xs">{s.id}</Mono>
        </>}
        actions={<>
          {disabled ? <Button icon={CheckCircle2} onClick={() => act.mutate('enable')}>Enable</Button>
            : <Button icon={Ban} onClick={async () => { if (await confirm({ title: `Disable ${s.name}?`, message: 'All its tokens are rejected until you enable it again. Nothing is deleted.', confirmLabel: 'Disable', danger: true })) act.mutate('disable') }}>Disable</Button>}
          <Button icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>
          <Button variant="primary" icon={KeyRound} onClick={() => setTab('tokens')}>Tokens</Button>
          <Button variant="outline-danger" icon={Trash2} onClick={remove}>Delete</Button>
        </>}
      />
      {disabled && <Hint tone="warning" className="mb-5">This system account is disabled. Requests with its tokens fail with <code className="font-mono">403 identity_disabled</code>.</Hint>}
      {expSoon.length > 0 && !disabled && <Hint tone="warning" className="mb-5"><Clock className="mr-1 inline size-3.5" />{expSoon.map((t) => t.name).join(', ')} expire{expSoon.length === 1 ? 's' : ''} within 14 days. <button className="font-medium underline" onClick={() => setTab('tokens')}>Rotate now</button></Hint>}

      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Overview' },
        { id: 'tokens', label: 'Tokens', count: active.length },
        { id: 'access', label: 'Roles & scopes' },
        { id: 'network', label: 'Network & conditions' },
        { id: 'activity', label: 'Activity' },
      ]} />

      {tab === 'overview' && (
        <div className="grid [&>*]:min-w-0 gap-5 @min-[56rem]:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-5">
            <Card>
              <CardHeader icon={Bot} title="Details" />
              <CardBody>
                <KeyValue cols={3} items={[
                  ['Status', <StatusPill status={s.status ?? 'active'} />],
                  ['Created', date(s.createdAt)],
                  ['Last used', s.lastUsed ? <span title={dateTime(s.lastUsed)}>{timeAgo(s.lastUsed)}</span> : 'never'],
                  ['Roles', <RoleChips roleIds={s.roleIds} roles={roles} />],
                  ['Projects', <ProjectScope projectIds={s.projectIds} projects={projects} />],
                  ['Tags', <Tags tags={s.tags} />],
                  ['IP allowlist', s.ipAllowlist.length ? <span className="font-mono text-[12.5px]">{s.ipAllowlist.join(', ')}</span> : <span className="text-amber-600 dark:text-amber-400">any address</span>],
                  ['Tag conditions', s.tagConditions.length ? <div className="flex flex-wrap gap-1">{s.tagConditions.map((t) => <TagChip key={t.key} tag={t} />)}</div> : 'none'],
                  ['Active tokens', active.length],
                ]} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Use from automation" description="Store the token as a CI secret named AUTARK_TOKEN." />
              <CardBody>
                <IacTabs title="" snippets={{
                  terraform: `provider "autark" {\n  endpoint = "https://autark.regiocom-energie.de"\n  token    = var.autark_token # ${s.name}\n}\n\n# Resources must carry these tags for ${s.name} to manage them:\n${s.tagConditions.map((t) => `#   ${t.key} = "${t.value}"`).join('\n') || '#   (no tag conditions)'}`,
                  curl: `curl https://autark.regiocom-energie.de/api/v1/vms \\\n  -H "Authorization: Bearer $AUTARK_TOKEN"`,
                  yaml: `# .gitlab-ci.yml\ndeploy:\n  image: ghcr.io/autark-io/cli:1.8\n  variables:\n    AUTARK_ENDPOINT: https://autark.regiocom-energie.de\n  script:\n    - autark auth whoami   # svc:${s.name}\n    - autark k8s kubeconfig orchestrator-prod > kubeconfig\n    - kubectl --kubeconfig kubeconfig apply -f k8s/`,
                }} />
              </CardBody>
            </Card>
          </div>
          <Card>
            <CardHeader icon={ShieldAlert} title="What it can do" description={`${countPermissions(perms)} permissions`} />
            <CardBody className="space-y-3">
              <ul className="space-y-1.5 text-[13px] text-fg-2">{describe(perms).map((l) => <li key={l} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-violet-500" />{l}</li>)}</ul>
              {(s.ipAllowlist.length > 0 || s.tagConditions.length > 0) && (
                <div className="rounded-lg bg-surface-2 p-2.5 text-xs text-muted">
                  Restricted to {s.ipAllowlist.length ? `${s.ipAllowlist.length} network range${s.ipAllowlist.length > 1 ? 's' : ''}` : 'any network'}
                  {s.tagConditions.length > 0 && <> and resources tagged {s.tagConditions.map((t) => `${t.key}=${t.value}`).join(', ')}</>}.
                </div>
              )}
              <Button size="sm" icon={Grid3x3} className="w-full" onClick={() => setTab('access')}>Permissions matrix</Button>
            </CardBody>
          </Card>
        </div>
      )}

      {tab === 'tokens' && (
        <Card>
          <CardHeader icon={KeyRound} title="API tokens" description="Rotate regularly: rotation issues a new secret and keeps the old one valid for 24 hours." />
          <TokensTable tokens={s.tokens} collection="systemAccounts" ownerId={s.id} ownerName={s.name} kind="systemAccount" disabledReason={disabled ? 'Enable the account first' : undefined} />
        </Card>
      )}
      {tab === 'access' && <AccessTab s={s} roleList={roleList} />}
      {tab === 'network' && <NetworkTab s={s} />}
      {tab === 'activity' && (
        <div className="grid [&>*]:min-w-0 gap-5 @min-[60rem]:grid-cols-2">
          <Card><CardHeader icon={Activity} title="API calls by this account" description={`Audit events with actor svc:${s.name}`} /><ActorFeed actor={`svc:${s.name}`} /></Card>
          <Card><CardHeader icon={Bot} title="Changes to this account" /><ActivityFeed targetId={s.id} /></Card>
        </div>
      )}

      <EditModal s={s} open={editing} onClose={() => setEditing(false)} />
    </Page>
  );
}

function AccessTab({ s, roleList }: { s: SystemAccount; roleList: Role[] }) {
  const [roleIds, setRoleIds] = useState(s.roleIds);
  const [projectIds, setProjectIds] = useState<string[] | '*'>(s.projectIds);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setRoleIds(s.roleIds); setProjectIds(s.projectIds) }, [s.roleIds.join(), JSON.stringify(s.projectIds)]); // eslint-disable-line
  const rolesKey = useMemo(() => roleList.map((r) => `${r.id}${countPermissions(r.permissions)}`).join(), [roleList]);
  const { data } = useGet<EffectivePermissions>(['systemAccounts', 'effective', s.id, rolesKey], `/iam/effective?systemAccountId=${s.id}`);
  const dirty = roleIds.join() !== s.roleIds.join() || JSON.stringify(projectIds) !== JSON.stringify(s.projectIds);
  const save = useApiMutation(() => api.update('systemAccounts', s.id, { roleIds, projectIds }), {
    silent: true, onSuccess: () => toast.success('Scopes updated'),
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); toast.error('Could not update', e.message) },
  });
  return (
    <div className="grid [&>*]:min-w-0 gap-5 @min-[60rem]:grid-cols-2">
      <div className="space-y-5">
        <Card><CardHeader title="Roles" /><CardBody><RolePicker value={roleIds} onChange={setRoleIds} error={errors.roleIds} compact /></CardBody></Card>
        <Card><CardHeader title="Projects" /><CardBody><ProjectScopePicker value={projectIds} onChange={setProjectIds} error={errors.projectIds} /></CardBody></Card>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={!dirty} onClick={() => { setRoleIds(s.roleIds); setProjectIds(s.projectIds) }}>Reset</Button>
          <Button variant="primary" icon={Save} disabled={!dirty || !roleIds.length} loading={save.isPending} onClick={() => save.mutate()}>Save scopes</Button>
        </div>
      </div>
      <Card>
        <CardHeader icon={Grid3x3} title="Effective permissions" description={dirty ? 'Showing saved permissions — save to apply your changes.' : 'Union of assigned roles.'} />
        <CardBody>{data ? <PermissionMatrix grants={data.grants} roles={data.roles} /> : <Skeleton className="h-72" />}</CardBody>
      </Card>
    </div>
  );
}

function NetworkTab({ s }: { s: SystemAccount }) {
  const [ips, setIps] = useState(s.ipAllowlist);
  const [conds, setConds] = useState(s.tagConditions);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setIps(s.ipAllowlist); setConds(s.tagConditions) }, [s.ipAllowlist.join(), JSON.stringify(s.tagConditions)]); // eslint-disable-line
  const dirty = ips.join() !== s.ipAllowlist.join() || JSON.stringify(conds) !== JSON.stringify(s.tagConditions);
  const save = useApiMutation(() => api.update('systemAccounts', s.id, { ipAllowlist: ips, tagConditions: conds }), {
    silent: true, onSuccess: () => { toast.success('Restrictions updated'); setErrors({}) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); toast.error('Could not update', e.message) },
  });
  return (
    <div className="space-y-5">
      <div className="grid [&>*]:min-w-0 gap-5 @min-[44rem]:grid-cols-2">
        <Card>
          <CardHeader icon={Network} title="IP allowlist" description="Requests from other source addresses are rejected with 403." />
          <CardBody>
            <CidrListEditor value={ips} onChange={setIps} error={errors.ipAllowlist} />
            {!ips.length && <Hint tone="warning" className="mt-3">Without an allowlist a leaked token can be used from anywhere on the internet.</Hint>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={TagIcon} title="Tag conditions" description="Attribute-based restriction: the account can only act on resources that carry all of these tags." />
          <CardBody className="space-y-3">
            <TagEditor value={conds} onChange={setConds} suggestions={['managed-by', 'env', 'app', 'team']} />
            {errors.tagConditions && <p className="text-xs text-rose-600 dark:text-rose-400">{errors.tagConditions}</p>}
            <p className="text-xs text-muted">{conds.length ? <>Example: a VM tagged <code className="font-mono">{conds.map((t) => `${t.key}=${t.value}`).join(', ')}</code> can be managed; untagged resources are read-only at most.</> : 'No conditions — role permissions apply to every resource in scope.'}</p>
          </CardBody>
        </Card>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={!dirty} onClick={() => { setIps(s.ipAllowlist); setConds(s.tagConditions); setErrors({}) }}>Reset</Button>
        <Button variant="primary" icon={Save} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save restrictions</Button>
      </div>
    </div>
  );
}

function EditModal({ s, open, onClose }: { s: SystemAccount; open: boolean; onClose: () => void }) {
  const [name, setName] = useState(s.name);
  const [description, setDescription] = useState(s.description);
  const [tags, setTags] = useState(s.tags);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setName(s.name); setDescription(s.description); setTags(s.tags); setErrors({}) } }, [open]); // eslint-disable-line
  const save = useApiMutation(() => api.update('systemAccounts', s.id, { name, description, tags }), {
    silent: true, onSuccess: () => { toast.success('Saved'); onClose() },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); if (!Object.keys(fieldErrors(e)).length) toast.error('Save failed', e.message) },
  });
  return (
    <Modal open={open} onClose={onClose} title={`Edit ${s.name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required error={errors.name} hint={name !== s.name ? <span className="text-amber-600 dark:text-amber-400">Renaming changes the audit actor (svc:{name}); existing tokens keep working.</span> : undefined}>
          <Input mono value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} />
        </Field>
        <Field label="Description" optional><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Tags" error={errors.tags}><TagEditor value={tags} onChange={setTags} /></Field>
      </div>
    </Modal>
  );
}

