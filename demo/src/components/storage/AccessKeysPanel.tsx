import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Plus, MoreHorizontal, RefreshCw, Ban, Trash2, Pencil, Download, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { useList, useApiMutation } from '@/api/hooks';
import { api, type ApiClientError } from '@/api/client';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Modal, confirm } from '@/components/ui/Modal';
import { Field, Input, Select, MultiSelect, OptionCards, Checkbox, Hint } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Mono, CopyButton } from '@/components/ui/misc';
import { ProjectField } from '@/components/resource/pickers';
import { fieldErrors } from '@/components/ui/FormLayout';
import { toast } from '@/components/ui/toast';
import { timeAgo, dateTime } from '@/lib/format';
import { downloadFile } from './common';
import { usePro } from '@/store/ui';
import type { AccessKey, AccessKeyWithSecret, Bucket, Project } from '@/types';

const PERM: Record<AccessKey['permission'], { label: string; tone: 'info' | 'warning' | 'violet'; description: string }> = {
  read: { label: 'Read only', tone: 'info', description: 'GetObject, ListBucket, HeadObject' },
  write: { label: 'Write only', tone: 'warning', description: 'PutObject, multipart upload — cannot read or list (good for backup agents)' },
  readwrite: { label: 'Read & write', tone: 'violet', description: 'Full object access incl. delete' },
};

export function AccessKeysPanel({ bucket, compact }: { bucket?: Bucket; compact?: boolean }) {
  const pro = usePro();
  const { items: keys, isLoading } = useList<AccessKey>('accessKeys');
  const { items: buckets } = useList<Bucket>('buckets');
  const { items: projects } = useList<Project>('projects');
  const [filter, setFilter] = useState<'active' | 'revoked' | 'all'>('active');
  const [editing, setEditing] = useState<AccessKey | 'new' | null>(null);
  const [secret, setSecret] = useState<AccessKeyWithSecret | null>(null);
  const bucketName = useMemo(() => new Map(buckets.map((b) => [b.id, b.name])), [buckets]);

  const scoped = bucket ? keys.filter((k) => k.projectId === bucket.projectId && (k.bucketIds === '*' || k.bucketIds.includes(bucket.id))) : keys;
  const rows = scoped.filter((k) => filter === 'all' || k.status === filter);
  const counts = { active: scoped.filter((k) => k.status === 'active').length, revoked: scoped.filter((k) => k.status === 'revoked').length, all: scoped.length };

  const rotate = async (k: AccessKey) => {
    if (!await confirm({ title: `Rotate ${k.name}?`, message: 'A new access key ID and secret are generated. The current credentials stop working immediately — update every client using them.', confirmLabel: 'Rotate' })) return;
    try { setSecret(await api.action<AccessKeyWithSecret>('accessKeys', k.id, 'rotate')) } catch (e) { toast.error('Rotation failed', (e as Error).message) }
  };
  const revoke = async (k: AccessKey) => {
    if (!await confirm({ title: `Revoke ${k.name}?`, message: `Requests signed with ${k.accessKeyId} will be rejected with 403 immediately. Revocation cannot be undone.`, confirmLabel: 'Revoke', danger: true })) return;
    api.action('accessKeys', k.id, 'revoke').then(() => toast.success(`Revoked ${k.name}`)).catch((e) => toast.error('Revoke failed', e.message));
  };
  const remove = async (list: AccessKey[]) => {
    const active = list.filter((k) => k.status === 'active');
    if (!await confirm({ title: `Delete ${list.length === 1 ? list[0].name : `${list.length} keys`}?`, message: active.length ? `${active.length} key(s) are still active — clients using them will start failing.` : 'The key record and its usage history are removed.', confirmLabel: 'Delete', danger: true, typeToConfirm: active.length === 1 && list.length === 1 ? list[0].name : undefined })) return;
    const res = await Promise.allSettled(list.map((k) => api.remove('accessKeys', k.id)));
    const failed = res.filter((r) => r.status === 'rejected');
    if (failed.length) toast.error(`${failed.length} deletion(s) failed`); else toast.success(`Deleted ${list.length} key${list.length > 1 ? 's' : ''}`);
  };

  const allColumns: Column<AccessKey>[] = [
    {
      id: 'name', header: 'Name', sort: (k) => k.name,
      cell: (k) => {
        const p = projects.find((x) => x.id === k.projectId);
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted"><KeyRound className="size-3.5" /></div>
            <div className="min-w-0">
              <div className="truncate font-medium text-fg">{k.name}</div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted">{p && <span className="size-1.5 rounded-full" style={{ background: p.color }} />}{p?.name ?? k.projectId}</div>
            </div>
          </div>
        );
      },
    },
    { id: 'akid', header: 'Access key ID', cell: (k) => <Mono copy>{k.accessKeyId}</Mono> },
    { id: 'secret', header: 'Secret', hideBelow: 'xl', cell: (k) => <span className="font-mono text-xs text-faint">{k.secretMasked}</span> },
    {
      id: 'scope', header: 'Buckets', hideBelow: 'md',
      cell: (k) => k.bucketIds === '*' ? <Badge tone="warning">All buckets in project</Badge> : (
        <div className="flex flex-wrap gap-1">
          {k.bucketIds.slice(0, 2).map((id) => <Link key={id} to={`/managed-services/object-storage/${id}`} onClick={(e) => e.stopPropagation()} className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-2 hover:text-brand-500">{bucketName.get(id) ?? id}</Link>)}
          {k.bucketIds.length > 2 && <span className="text-[11px] text-muted">+{k.bucketIds.length - 2}</span>}
          {k.bucketIds.length === 0 && <span className="text-xs text-faint">none</span>}
        </div>
      ),
    },
    { id: 'perm', header: 'Permission', sort: (k) => k.permission, cell: (k) => <Badge tone={PERM[k.permission].tone}>{PERM[k.permission].label}</Badge> },
    { id: 'used', header: 'Last used', hideBelow: 'lg', sort: (k) => k.lastUsed ?? '', cell: (k) => <span className="text-fg-2" title={dateTime(k.lastUsed)}>{timeAgo(k.lastUsed)}</span> },
    { id: 'status', header: 'Status', sort: (k) => k.status, cell: (k) => <StatusPill status={k.status} /> },
  ];
  const columns = allColumns.filter((c) => pro || (c.id !== 'secret' && c.id !== 'used'));

  return (
    <div className="space-y-3">
      {!compact && pro && (
        <Hint>Access keys sign S3 API requests (AWS Signature V4) — use them with the aws CLI, rclone, s3cmd, restic or any S3 SDK. Scope each key to the fewest buckets and the narrowest permission it needs.</Hint>
      )}
      <DataTable
        rows={rows}
        loading={isLoading}
        columns={columns}
        searchText={(k) => `${k.name} ${k.accessKeyId} ${k.permission} ${k.bucketIds === '*' ? 'all' : k.bucketIds.map((b) => bucketName.get(b)).join(' ')}`}
        searchPlaceholder="Search keys…"
        defaultSort={{ id: 'name', dir: 'asc' }}
        toolbar={<>
          <FilterChips value={filter} onChange={setFilter} options={[{ value: 'active', label: 'Active', count: counts.active }, { value: 'revoked', label: 'Revoked', count: counts.revoked }, { value: 'all', label: 'All', count: counts.all }]} />
          <Button size="sm" variant="primary" icon={Plus} onClick={() => setEditing('new')}>Create key</Button>
        </>}
        bulkActions={[{ label: 'Delete', icon: Trash2, danger: true, onClick: remove }]}
        rowActions={(k) => (
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />} items={[
            { label: 'Edit scope', icon: Pencil, disabled: k.status !== 'active', onClick: () => setEditing(k) },
            { label: 'Rotate secret', icon: RefreshCw, disabled: k.status !== 'active', onClick: () => rotate(k) },
            { label: 'Revoke', icon: Ban, disabled: k.status !== 'active', onClick: () => revoke(k) },
            { divider: true, label: '' },
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove([k]) },
          ]} />
        )}
        empty={{ icon: KeyRound, title: bucket ? 'No keys can access this bucket' : 'No access keys', description: 'Create a key to use the S3 API from applications and tools.', action: <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Create key</Button> }}
      />
      {editing && <KeyModal keyRow={editing === 'new' ? null : editing} bucket={bucket} onClose={() => setEditing(null)} onCreated={(k) => { setEditing(null); setSecret(k) }} />}
      {secret && <SecretModal k={secret} location={bucket?.locationId ?? buckets.find((b) => secret.bucketIds === '*' ? b.projectId === secret.projectId : secret.bucketIds.includes(b.id))?.locationId ?? 'dc1'} onClose={() => setSecret(null)} />}
    </div>
  );
}

function KeyModal({ keyRow, bucket, onClose, onCreated }: { keyRow: AccessKey | null; bucket?: Bucket; onClose: () => void; onCreated: (k: AccessKeyWithSecret) => void }) {
  const { items: buckets } = useList<Bucket>('buckets');
  const [name, setName] = useState(keyRow?.name ?? (bucket ? `${bucket.name}-client` : ''));
  const [projectId, setProjectId] = useState(keyRow?.projectId ?? bucket?.projectId ?? '');
  const [scope, setScope] = useState<'selected' | 'all'>(keyRow?.bucketIds === '*' ? 'all' : 'selected');
  const [bucketIds, setBucketIds] = useState<string[]>(keyRow && keyRow.bucketIds !== '*' ? keyRow.bucketIds : bucket ? [bucket.id] : []);
  const [permission, setPermission] = useState<AccessKey['permission']>(keyRow?.permission ?? 'read');
  const [expiry, setExpiry] = useState('never');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const projectBuckets = buckets.filter((b) => b.projectId === projectId);
  useEffect(() => { if (!keyRow && !bucket) setBucketIds([]) }, [projectId]); // eslint-disable-line

  const body = {
    name, projectId, bucketIds: scope === 'all' ? '*' : bucketIds, permission,
    ...(keyRow ? {} : { expiresAt: expiry === 'never' ? null : new Date(Date.now() + Number(expiry) * 86_400_000).toISOString() }),
  };
  const save = useApiMutation(async () => keyRow ? api.update<AccessKey>('accessKeys', keyRow.id, { name, bucketIds: body.bucketIds, permission }) : api.create<AccessKeyWithSecret>('accessKeys', body), {
    silent: true,
    onSuccess: (res) => { if (keyRow) { toast.success('Key updated'); onClose() } else onCreated(res as AccessKeyWithSecret) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); toast.error(keyRow ? 'Update failed' : 'Could not create key', e.message) },
  });

  return (
    <Modal open onClose={onClose} size="lg" title={keyRow ? `Edit ${keyRow.name}` : 'Create access key'} description={keyRow ? 'Changes apply to new requests within seconds.' : 'The secret is shown once after creation.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={keyRow ? undefined : KeyRound} loading={save.isPending} disabled={!name.trim() || (scope === 'selected' && !bucketIds.length)} onClick={() => save.mutate()}>{keyRow ? 'Save' : 'Create key'}</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 @min-[36rem]:grid-cols-2">
          <Field label="Name" required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="backup-agent" /></Field>
          {keyRow || bucket ? <Field label="Project"><Input value={projectId} disabled /></Field> : <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />}
        </div>
        <Field label="Bucket access" error={errors.bucketIds} action={<Segmented size="sm" value={scope} onChange={setScope} options={[{ value: 'selected', label: 'Selected buckets' }, { value: 'all', label: 'All buckets' }]} />}>
          {scope === 'selected'
            ? <MultiSelect options={projectBuckets.map((b) => ({ value: b.id, label: b.name, description: `${b.locationId} · ${b.storageClass.toLowerCase()}` }))} value={bucketIds} onChange={setBucketIds} placeholder="Choose buckets" emptyText="No buckets in this project" />
            : <Hint tone="warning">The key can access every current <b>and future</b> bucket in this project.</Hint>}
        </Field>
        <Field label="Permission">
          <OptionCards cols={3} value={permission} onChange={setPermission} options={(Object.keys(PERM) as AccessKey['permission'][]).map((p) => ({ value: p, title: PERM[p].label, description: PERM[p].description }))} />
        </Field>
        {!keyRow && (
          <Field label="Expiry" hint="Expired keys stop working automatically.">
            <Select value={expiry} onChange={(e) => setExpiry(e.target.value)} options={[{ value: 'never', label: 'Never expires' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: '1 year' }]} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function SecretModal({ k, location: loc, onClose }: { k: AccessKeyWithSecret; location: string; onClose: () => void }) {
  const [saved, setSaved] = useState(false);
  const credentials = `[autark-${k.name}]\naws_access_key_id = ${k.accessKeyId}\naws_secret_access_key = ${k.secretAccessKey}\n`;
  return (
    <Modal open onClose={() => { if (saved) onClose(); else toast.warning('Confirm you saved the secret first') }} size="lg"
      icon={<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500"><ShieldCheck className="size-[18px]" /></div>}
      title={`Access key ${k.name} is ready`} description="Copy the secret access key now. For your security it is never shown again — if you lose it, rotate the key."
      footer={<><Button icon={Download} onClick={() => downloadFile(`autark-${k.name}.credentials`, credentials)}>Download credentials</Button><Button variant="primary" disabled={!saved} onClick={onClose}>Done</Button></>}>
      <div className="space-y-3">
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <div className="text-xs font-medium text-muted">Access key ID</div>
          <div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 break-all font-mono text-sm text-fg">{k.accessKeyId}</code><CopyButton value={k.accessKeyId} /></div>
          <div className="mt-3 text-xs font-medium text-muted">Secret access key</div>
          <div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 break-all font-mono text-sm text-fg">{k.secretAccessKey}</code><CopyButton value={k.secretAccessKey} /></div>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-800 dark:text-amber-300"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />Store it in a secret manager (Vault, sops, a CI secret) — never commit it to git.</div>
        <CodeBlock language="bash" title="~/.aws/credentials" code={`${credentials}\n# then:\naws --profile autark-${k.name} --endpoint-url https://s3.${loc}.autark.cloud s3 ls`} />
        <Checkbox checked={saved} onChange={setSaved} label="I have copied the secret access key to a safe place" />
      </div>
    </Modal>
  );
}
