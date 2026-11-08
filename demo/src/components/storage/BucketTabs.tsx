import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Globe, Lock, Save, Undo2, ShieldCheck, History, Trash2, Eraser, AlertTriangle, ShieldAlert, Info } from 'lucide-react';
import { useApiMutation } from '@/api/hooks';
import { api, type ApiClientError } from '@/api/client';
import { Card, CardHeader, CardBody, KeyValue } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Input, Switch, NumberInput, TagEditor, Textarea, Hint, ListEditor, Checkbox, OptionCards } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Mono, Meter } from '@/components/ui/misc';
import { Stat } from '@/components/ui/Stat';
import { MetricsPanel } from '@/components/charts/MetricsPanel';
import { Donut } from '@/components/charts/Donut';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { fieldErrors } from '@/components/ui/FormLayout';
import { bucketCost } from '@/lib/pricing';
import { bytes, money, compact, num, dateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { AccessKeysPanel } from './AccessKeysPanel';
import { LifecycleRulesEditor, LifecycleTimeline } from './LifecycleEditor';
import { CLASS_META, GB, ClassBadge } from './common';
import { toggleBucketAccess, deleteBucketFlow } from './actions';
import type { Bucket, CorsRule, LifecycleRule, StorageClass, AccessKey } from '@/types';
import { useList } from '@/api/hooks';
import { usePro } from '@/store/ui';

function usePatch(b: Bucket, success = 'Saved') {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useApiMutation((patch: Record<string, unknown>) => api.update<Bucket>('buckets', b.id, patch), {
    success, onSuccess: () => setErrors({}), onError: (e: ApiClientError) => setErrors(fieldErrors(e)),
  });
  return { ...m, errors };
}

/* ------------------------------------------------------------------ overview */

export function BucketOverview({ bucket: b }: { bucket: Bucket }) {
  const cost = bucketCost({ storageClass: b.storageClass, storageGB: b.bytesUsed / GB, requestsMillions: b.requestsLast30d / 1e6, egressGB: b.egressGBLast30d });
  const breakdown = b.classBreakdown ?? { STANDARD: 0, INFREQUENT: 0, ARCHIVE: 0, [b.storageClass]: b.bytesUsed };
  const classes = (Object.keys(CLASS_META) as StorageClass[]).filter((c) => breakdown[c] > 0 || c === b.storageClass);
  const tierCost = classes.reduce((a, c) => a + (breakdown[c] / GB) * CLASS_META[c].price, 0);
  const flatCost = (b.bytesUsed / GB) * CLASS_META[b.storageClass].price;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Stored" value={bytes(b.bytesUsed)} sub={b.quotaGB ? <Meter value={b.bytesUsed} max={b.quotaGB * GB} size="xs" className="w-20" /> : 'no quota'} />
        <Stat label="Objects" value={compact(b.objectCount)} sub={b.versioning ? 'versioning on' : 'versioning off'} />
        <Stat label="Requests (30d)" value={compact(b.requestsLast30d)} sub={`${compact(b.requestsLast30d / 30)} / day`} />
        <Stat label="Egress (30d)" value={`${num(b.egressGBLast30d)} GB`} sub={<span>{money(b.monthlyCost)}/mo total</span>} accent="#eab308" />
      </div>

      <MetricsPanel collection="buckets" id={b.id} defaultRange="30d" live={false} charts={[
        { title: 'Storage used', metrics: ['storage'], labels: ['Stored'], colors: ['#eab308'], unit: 'GB', format: (v) => bytes(v * GB) },
        { title: 'Object count', metrics: ['objects'], labels: ['Objects'], colors: ['#5b67f8'], format: (v) => compact(v) },
        { title: 'Requests', metrics: ['getRequests', 'putRequests'], labels: ['GET', 'PUT'], unit: 'req/s' },
        { title: 'Egress', metrics: ['egress'], labels: ['Egress'], colors: ['#06b6d4'], unit: 'MB/s' },
      ]} />

      <div className="grid gap-5 @min-[44rem]:grid-cols-2">
        <Card>
          <CardHeader title="Storage class composition" description="Where the bytes live after lifecycle transitions" />
          <CardBody>
            <div className="flex flex-col items-center gap-5 @min-[36rem]:flex-row">
            <Donut size={150} thickness={20} legend={false} format={(v) => bytes(v)} center={<><div className="text-sm font-semibold text-fg">{bytes(b.bytesUsed)}</div><div className="text-[10px] text-muted">total</div></>}
              data={classes.map((c) => ({ id: c, label: CLASS_META[c].label, value: Math.max(0, breakdown[c]), color: CLASS_META[c].color }))} />
            <div className="w-full min-w-0 flex-1 space-y-2">
              {classes.map((c) => (
                <div key={c} className="flex items-center justify-between gap-2 text-xs">
                  <ClassBadge value={c} />
                  <span className="text-right tabular text-muted">{bytes(breakdown[c])} × €{CLASS_META[c].price} = <b className="text-fg">{money((breakdown[c] / GB) * CLASS_META[c].price)}</b></span>
                </div>
              ))}
            </div>
            </div>
            {tierCost < flatCost - 0.5 && <p className="mt-3 rounded-lg bg-emerald-500/5 p-2 text-xs text-emerald-700 dark:text-emerald-400">Lifecycle tiering saves ~{money(flatCost - tierCost)}/mo vs. keeping everything in {CLASS_META[b.storageClass].label}.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Endpoint" description="Path-style and virtual-hosted-style URLs both work" />
          <CardBody className="space-y-4">
            <KeyValue cols={1} items={[
              ['S3 endpoint', <Mono copy>{`https://s3.${b.locationId}.autark.cloud`}</Mono>],
              ['Bucket URL', <Mono copy>{b.endpoint}</Mono>],
              ['Virtual-hosted URL', <Mono copy>{`https://${b.name}.s3.${b.locationId}.autark.cloud`}</Mono>],
              ['S3 URI', <Mono copy>{`s3://${b.name}`}</Mono>],
              ['Region', <span className="font-mono text-[12.5px]">{b.locationId}</span>],
            ]} />
            <div className="border-t border-line pt-3">
              <div className="mb-1.5 text-xs font-medium text-muted">Monthly cost (last 30 days)</div>
              <ul className="space-y-1">
                {cost.lines.map((l) => <li key={l.label} className="flex justify-between text-[13px]"><span className="text-fg-2">{l.label}</span><span className="tabular text-fg">{money(l.amount, { decimals: true })}</span></li>)}
              </ul>
            </div>
          </CardBody>
        </Card>
      </div>
      <ClientSnippets bucket={b} />
    </div>
  );
}

function ClientSnippets({ bucket: b }: { bucket: Bucket }) {
  const [tab, setTab] = useState<'aws' | 'rclone' | 's3cmd' | 'boto3' | 'restic'>('aws');
  const ep = `https://s3.${b.locationId}.autark.cloud`;
  const snippets: Record<typeof tab, { code: string; lang: string; title: string }> = {
    aws: { lang: 'bash', title: 'aws CLI v2', code: `# configure once (keys: Permissions tab)\naws configure --profile autark\n\naws --profile autark --endpoint-url ${ep} s3 ls s3://${b.name}/\naws --profile autark --endpoint-url ${ep} s3 cp ./file.txt s3://${b.name}/path/file.txt\naws --profile autark --endpoint-url ${ep} s3 sync ./public s3://${b.name}/ --delete\naws --profile autark --endpoint-url ${ep} s3 presign s3://${b.name}/path/file.txt --expires-in 3600` },
    rclone: { lang: 'yaml', title: '~/.config/rclone/rclone.conf', code: `[autark]\ntype = s3\nprovider = Ceph\naccess_key_id = AUTK…\nsecret_access_key = …\nendpoint = ${ep}\nregion = ${b.locationId}\n\n# usage\n# rclone ls autark:${b.name}\n# rclone sync ./data autark:${b.name}/data --progress` },
    s3cmd: { lang: 'bash', title: '~/.s3cfg + usage', code: `# ~/.s3cfg\n#   host_base = s3.${b.locationId}.autark.cloud\n#   host_bucket = %(bucket)s.s3.${b.locationId}.autark.cloud\n#   access_key = AUTK…\n#   secret_key = …\n\ns3cmd ls s3://${b.name}\ns3cmd put file.txt s3://${b.name}/\ns3cmd setacl s3://${b.name} --acl-private` },
    boto3: { lang: 'python', title: 'Python (boto3)', code: `import boto3\n\ns3 = boto3.client(\n    "s3",\n    endpoint_url="${ep}",\n    region_name="${b.locationId}",\n    aws_access_key_id="AUTK…",\n    aws_secret_access_key="…",\n)\ns3.upload_file("report.pdf", "${b.name}", "reports/report.pdf")\nfor o in s3.list_objects_v2(Bucket="${b.name}", Prefix="reports/").get("Contents", []):\n    print(o["Key"], o["Size"])` },
    restic: { lang: 'bash', title: 'restic backups', code: `export AWS_ACCESS_KEY_ID=AUTK…\nexport AWS_SECRET_ACCESS_KEY=…\nexport RESTIC_REPOSITORY=s3:${ep}/${b.name}/restic\n\nrestic init\nrestic backup /srv/data\nrestic forget --keep-daily 7 --keep-weekly 4 --prune` },
  };
  const s = snippets[tab];
  return (
    <Card>
      <CardHeader title="Connect a client" description="Any S3-compatible tool works. Use an access key scoped to this bucket." actions={
        <Segmented size="sm" value={tab} onChange={setTab} className="max-w-full overflow-x-auto" options={[{ value: 'aws', label: 'aws-cli' }, { value: 'rclone', label: 'rclone' }, { value: 's3cmd', label: 's3cmd' }, { value: 'boto3', label: 'boto3' }, { value: 'restic', label: 'restic' }]} />
      } className="flex-col @min-[36rem]:flex-row" />
      <CardBody><CodeBlock code={s.code} language={s.lang} title={s.title} /></CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ lifecycle */

export function BucketLifecycle({ bucket: b }: { bucket: Bucket }) {
  const [rules, setRules] = useState<LifecycleRule[]>(b.lifecycleRules);
  const saved = JSON.stringify(b.lifecycleRules);
  useEffect(() => { setRules(b.lifecycleRules) }, [saved]); // eslint-disable-line
  const dirty = JSON.stringify(rules) !== saved;
  const patch = usePatch(b, 'Lifecycle rules saved');
  const expiring = rules.filter((r) => r.enabled && r.action === 'expire');
  return (
    <div className="grid items-start gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_420px]">
      <Card>
        <CardHeader title="Lifecycle rules" description="Evaluated daily at 00:00 UTC by the storage cluster. Rules match by key prefix." actions={dirty && <Badge tone="warning">unsaved</Badge>} />
        <CardBody className="space-y-4">
          <LifecycleRulesEditor rules={rules} onChange={setRules} baseClass={b.storageClass} errors={patch.errors} />
          {b.objectLock && expiring.length > 0 && <Hint tone="warning">Object lock is on: expiration only deletes objects whose retention period ({b.objectLockRetentionDays ?? 30} days) has passed.</Hint>}
          {b.versioning && <Hint>Versioning is on — expiration adds a delete marker; noncurrent versions are purged after the same number of days.</Hint>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" icon={Undo2} disabled={!dirty} onClick={() => setRules(b.lifecycleRules)}>Revert</Button>
            <Button variant="primary" icon={Save} disabled={!dirty} loading={patch.isPending} onClick={() => patch.mutate({ lifecycleRules: rules })}>Save rules</Button>
          </div>
        </CardBody>
      </Card>
      <div className="space-y-3">
        <LifecycleTimeline rules={rules} baseClass={b.storageClass} />
        <Card className="p-4 text-xs text-muted">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-fg-2"><Info className="size-3.5" />How tiering affects cost</div>
          {(Object.keys(CLASS_META) as StorageClass[]).map((c) => <div key={c} className="flex justify-between py-0.5"><span>{CLASS_META[c].label}</span><span className="tabular text-fg-2">€{CLASS_META[c].price}/GB · {CLASS_META[c].retrieval}</span></div>)}
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ permissions */

const METHOD_LIST = ['GET', 'HEAD', 'PUT', 'POST', 'DELETE'];

export function BucketPermissions({ bucket: b }: { bucket: Bucket }) {
  const { items: keys } = useList<AccessKey>('accessKeys');
  const bucketKeys = keys.filter((k) => k.status === 'active' && k.projectId === b.projectId && (k.bucketIds === '*' || k.bucketIds.includes(b.id)));
  const policy = useMemo(() => {
    const actions: Record<AccessKey['permission'], string[]> = { read: ['s3:GetObject', 's3:ListBucket'], write: ['s3:PutObject', 's3:AbortMultipartUpload'], readwrite: ['s3:GetObject', 's3:ListBucket', 's3:PutObject', 's3:DeleteObject'] };
    const statements: unknown[] = [];
    if (b.access === 'public-read') statements.push({ Sid: 'PublicRead', Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${b.name}/*`] });
    for (const k of bucketKeys) statements.push({ Sid: k.name.replace(/[^a-zA-Z0-9]/g, ''), Effect: 'Allow', Principal: { AWS: [`arn:autark:iam::${b.projectId}:key/${k.accessKeyId}`] }, Action: actions[k.permission], Resource: [`arn:aws:s3:::${b.name}`, `arn:aws:s3:::${b.name}/*`] });
    if (b.encryption !== 'none') statements.push({ Sid: 'DenyInsecureTransport', Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: [`arn:aws:s3:::${b.name}/*`], Condition: { Bool: { 'aws:SecureTransport': 'false' } } });
    return JSON.stringify({ Version: '2012-10-17', Statement: statements }, null, 2);
  }, [b, bucketKeys]);
  const isPublic = b.access === 'public-read';
  const pro = usePro();
  return (
    <div className="space-y-5">
      <div className="grid items-start gap-5 @min-[44rem]:grid-cols-2">
        <Card className={cn(isPublic && 'border-amber-500/40')}>
          <CardHeader title="Public access" icon={isPublic ? ShieldAlert : Lock} />
          <CardBody className="space-y-3">
            <div className="flex items-start gap-3">
              <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', isPublic ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500')}>{isPublic ? <Globe className="size-5" /> : <Lock className="size-5" />}</div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-fg">{isPublic ? 'Objects are publicly readable' : 'Bucket is private'}</div>
                <p className="mt-0.5 text-[13px] text-muted">{pro
                  ? (isPublic ? `Anyone with a URL like ${b.endpoint}/<key> can download objects. Listing the bucket stays disabled.` : 'Only signed requests (access keys or presigned URLs) can read or write objects.')
                  : (isPublic ? 'Anyone with a link can download files.' : 'Only apps with an access key can read or write files.')}</p>
              </div>
            </div>
            {pro && isPublic && <Hint tone="warning">{num(b.objectCount)} objects ({bytes(b.bytesUsed)}) are exposed. {b.egressGBLast30d} GB were downloaded in the last 30 days.</Hint>}
            <Button variant={isPublic ? 'primary' : 'outline-danger'} icon={isPublic ? Lock : Globe} onClick={() => toggleBucketAccess(b)}>{isPublic ? 'Block public access' : 'Make public…'}</Button>
          </CardBody>
        </Card>
        {pro ? (
          <Card>
            <CardHeader title="Effective bucket policy" description="Generated from access settings and keys (read-only)" />
            <CardBody><CodeBlock code={policy} language="json" maxHeight="max-h-72" /></CardBody>
          </Card>
        ) : (
          <Card>
            <CardHeader title="Connect" description="Works with any S3 tool (aws-cli, rclone, boto3…)." />
            <CardBody>
              <KeyValue cols={1} items={[
                ['S3 endpoint', <Mono copy>{`https://s3.${b.locationId}.autark.cloud`}</Mono>],
                ['Bucket', <Mono copy>{b.name}</Mono>],
                ...(isPublic ? [['Public URL', <Mono copy>{b.endpoint}</Mono>] as [string, ReactNode]] : []),
              ]} />
            </CardBody>
          </Card>
        )}
      </div>
      {pro && <CorsEditor bucket={b} />}
      <div>
        <h3 className="mb-2 text-[15px] font-semibold text-fg">{pro ? 'Access keys with access to this bucket' : 'Access keys'}</h3>
        <AccessKeysPanel bucket={b} compact />
      </div>
    </div>
  );
}

type CorsDraft = Omit<CorsRule, 'origins'> & { origins: string };

function CorsEditor({ bucket: b }: { bucket: Bucket }) {
  const toDraft = (rs: CorsRule[]): CorsDraft[] => rs.map((r) => ({ ...r, origins: r.origins.join(', ') }));
  const saved = JSON.stringify(b.cors);
  const [rules, setRules] = useState<CorsDraft[]>(toDraft(b.cors));
  useEffect(() => { setRules(toDraft(b.cors)) }, [saved]); // eslint-disable-line
  const dirty = JSON.stringify(rules) !== JSON.stringify(toDraft(b.cors));
  const patch = usePatch(b, 'CORS configuration saved');
  const xml = `<CORSConfiguration>\n${rules.map((r) => `  <CORSRule>\n${r.origins.split(',').map((o) => o.trim()).filter(Boolean).map((o) => `    <AllowedOrigin>${o}</AllowedOrigin>`).join('\n')}\n${r.methods.map((m) => `    <AllowedMethod>${m}</AllowedMethod>`).join('\n')}\n    <AllowedHeader>*</AllowedHeader>\n    <MaxAgeSeconds>${r.maxAgeSec}</MaxAgeSeconds>\n  </CORSRule>`).join('\n')}\n</CORSConfiguration>`;
  return (
    <Card>
      <CardHeader title="CORS" description="Allow browsers on other origins to call this bucket (e.g. direct uploads from your web app)." actions={dirty && <Badge tone="warning">unsaved</Badge>} />
      <CardBody className="space-y-3">
        <ListEditor
          items={rules}
          onChange={setRules}
          addLabel="Add CORS rule"
          create={(): CorsDraft => ({ id: `cors-new-${Date.now().toString(36)}`, origins: 'https://', methods: ['GET', 'HEAD'], maxAgeSec: 3600 })}
          empty={<p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">No CORS rules — cross-origin browser requests are rejected.</p>}
          render={(r, update, i) => (
            <div className="space-y-2">
              <div className="grid gap-2 @min-[40rem]:grid-cols-[minmax(0,1fr)_auto_130px]">
                <Input value={r.origins} onChange={(e) => update({ origins: e.target.value })} placeholder="https://app.example.com, https://*.example.com" mono invalid={!!patch.errors[`cors.${i}.origins`]} />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {METHOD_LIST.map((m) => <Checkbox key={m} checked={r.methods.includes(m)} onChange={(v) => update({ methods: v ? [...r.methods, m] : r.methods.filter((x) => x !== m) })} label={<span className="font-mono text-xs">{m}</span>} />)}
                </div>
                <NumberInput value={r.maxAgeSec} onChange={(v) => update({ maxAgeSec: v })} min={0} max={86400} step={600} unit="s" />
              </div>
              {Object.entries(patch.errors).filter(([k]) => k.startsWith(`cors.${i}.`)).map(([k, v]) => <p key={k} className="text-xs text-rose-500">{v}</p>)}
              {r.origins.split(',').some((o) => o.trim() === '*') && <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><AlertTriangle className="size-3" />Wildcard origin allows any website to call this bucket from a browser.</p>}
            </div>
          )}
        />
        {rules.length > 0 && <details className="text-xs"><summary className="cursor-pointer text-muted">Show as S3 XML</summary><CodeBlock className="mt-2" code={xml} language="xml" /></details>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" icon={Undo2} disabled={!dirty} onClick={() => setRules(toDraft(b.cors))}>Revert</Button>
          <Button variant="primary" icon={Save} disabled={!dirty} loading={patch.isPending} onClick={() => patch.mutate({ cors: rules.map((r) => ({ ...r, origins: r.origins.split(',').map((o) => o.trim()).filter(Boolean) })) })}>Save CORS</Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ settings */

export function BucketSettings({ bucket: b, onDeleted }: { bucket: Bucket; onDeleted: () => void }) {
  const patch = usePatch(b);
  const pro = usePro();
  const [description, setDescription] = useState(b.description ?? '');
  const [tags, setTags] = useState(b.tags);
  const [quotaOn, setQuotaOn] = useState(b.quotaGB != null);
  const [quotaGB, setQuotaGB] = useState(b.quotaGB ?? Math.max(10, Math.ceil((b.bytesUsed / GB) * 1.5)));
  const [retention, setRetention] = useState(b.objectLockRetentionDays ?? 30);
  useEffect(() => { setDescription(b.description ?? ''); setTags(b.tags); setQuotaOn(b.quotaGB != null); if (b.quotaGB != null) setQuotaGB(b.quotaGB); setRetention(b.objectLockRetentionDays ?? 30) }, [b.updatedAt]); // eslint-disable-line

  const enableLock = async () => {
    const ok = await confirm({ title: `Enable object lock on ${b.name}?`, message: 'Object lock can never be disabled again. New objects get a default retention of 30 days (governance mode) during which they cannot be deleted or overwritten. Versioning is enabled automatically.', confirmLabel: 'Enable object lock', danger: true, typeToConfirm: b.name });
    if (ok) patch.mutate({ objectLock: true });
  };
  const toggleVersioning = async (v: boolean) => {
    if (!v && !await confirm({ title: 'Suspend versioning?', message: 'New overwrites and deletes will no longer keep previous versions. Existing versions are kept until lifecycle rules remove them.', confirmLabel: 'Suspend' })) return;
    patch.mutate({ versioning: v });
  };
  const empty = async () => {
    if (!await confirm({ title: `Empty ${b.name}?`, message: `All ${num(b.objectCount)} objects (${bytes(b.bytesUsed)})${b.versioning ? ' and their versions' : ''} are permanently deleted. The bucket and its settings stay.`, confirmLabel: 'Empty bucket', danger: true, typeToConfirm: b.name })) return;
    api.action('buckets', b.id, 'empty').then(() => toast.success(`${b.name} emptied`)).catch((e) => toast.error('Could not empty bucket', e.message));
  };

  return (
    <div className="grid items-start gap-5 @min-[44rem]:grid-cols-2">
      <Card>
        <CardHeader title="General" />
        <CardBody className="space-y-4">
          <KeyValue items={pro ? [['Name', <Mono copy>{b.name}</Mono>], ['ID', <Mono copy>{b.id}</Mono>], ['Location', b.locationId], ['Created', dateTime(b.createdAt)]] : [['Name', <Mono copy>{b.name}</Mono>], ['Location', b.locationId], ['Created', dateTime(b.createdAt)]]} />
          <Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          {pro && <Field label="Tags" error={patch.errors.tags}><TagEditor value={tags} onChange={setTags} /></Field>}
          <div className="flex justify-end"><Button variant="primary" icon={Save} loading={patch.isPending} disabled={description === (b.description ?? '') && JSON.stringify(tags) === JSON.stringify(b.tags)} onClick={() => patch.mutate({ description, tags })}>Save</Button></div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={pro ? 'Data protection' : 'Protection'} />
        <CardBody className="space-y-4">
          <Switch checked={b.versioning} onChange={toggleVersioning} disabled={b.objectLock || patch.isPending} label={<span className="flex items-center gap-1.5"><History className="size-3.5" />Versioning</span>} description={b.objectLock ? 'Required while object lock is enabled.' : 'Keep previous versions on overwrite & delete.'} />
          {pro && <div className="rounded-xl border border-line p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-sm font-medium text-fg"><ShieldCheck className="size-3.5" />Object lock {b.objectLock && <Badge tone="success">enabled · immutable</Badge>}</div>
                <p className="mt-0.5 text-xs text-muted">{b.objectLock ? `New objects are retained for ${b.objectLockRetentionDays ?? 30} days (${b.objectLockMode ?? 'governance'} mode).` : 'WORM protection against deletion and ransomware.'}</p>
              </div>
              {!b.objectLock && <Button size="sm" onClick={enableLock}>Enable…</Button>}
            </div>
            {b.objectLock && (
              <div className="mt-3 grid gap-3 @min-[36rem]:grid-cols-[1fr_auto] @min-[36rem]:items-end">
                <Field label="Default retention" hint={b.objectLockMode === 'compliance' ? 'Compliance mode: retention can only be extended.' : 'Governance mode: admins may shorten it.'} error={patch.errors.objectLockRetentionDays}>
                  <NumberInput value={retention} onChange={setRetention} min={b.objectLockMode === 'compliance' ? b.objectLockRetentionDays ?? 1 : 1} max={36500} unit="days" />
                </Field>
                <Button disabled={retention === (b.objectLockRetentionDays ?? 30)} loading={patch.isPending} onClick={() => patch.mutate({ objectLockRetentionDays: retention })}>Update</Button>
              </div>
            )}
          </div>}
          {!pro && b.objectLock && <p className="flex items-center gap-1.5 text-xs text-muted"><ShieldCheck className="size-3.5 text-emerald-500" />Object lock is on: files are kept for {b.objectLockRetentionDays ?? 30} days and can't be deleted earlier.</p>}
          {pro && <Field label="Encryption at rest" hint="Changing encryption applies to new objects; existing objects are re-encrypted in the background.">
            <Segmented value={b.encryption} onChange={(v) => patch.mutate({ encryption: v })} options={[{ value: 'SSE', label: 'SSE' }, { value: 'SSE-KMS', label: 'SSE-KMS (Vault)' }, { value: 'none', label: 'None' }]} />
          </Field>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={pro ? 'Storage' : 'Size limit'} />
        <CardBody className="space-y-4">
          {pro && <Field label="Default storage class for new objects">
            <OptionCards cols={3} value={b.storageClass} onChange={(v) => patch.mutate({ storageClass: v })} options={(Object.keys(CLASS_META) as StorageClass[]).map((c) => ({ value: c, title: CLASS_META[c].label, description: `€${CLASS_META[c].price}/GB`, icon: <span className="size-2.5 rounded-sm" style={{ background: CLASS_META[c].color }} /> }))} />
          </Field>}
          <Switch checked={quotaOn} onChange={(v) => { setQuotaOn(v); if (!v && b.quotaGB != null) patch.mutate({ quotaGB: null }) }} label="Bucket quota" description="Reject uploads once the bucket reaches this size." />
          {quotaOn && (
            <div className="space-y-2">
              <div className="flex items-end gap-2">
                <Field label="Quota" error={patch.errors.quotaGB} className="flex-1"><NumberInput value={quotaGB} onChange={setQuotaGB} min={1} max={1_000_000} step={10} unit="GB" /></Field>
                <Button loading={patch.isPending} disabled={quotaGB === b.quotaGB} onClick={() => patch.mutate({ quotaGB })}>Apply</Button>
              </div>
              <Meter value={b.bytesUsed} max={quotaGB * GB} showLabel label={`${bytes(b.bytesUsed)} of ${quotaGB} GB`} />
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="border-rose-500/30">
        <CardHeader title={<span className="text-rose-600 dark:text-rose-400">Danger zone</span>} />
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div><div className="text-sm font-medium text-fg">Empty bucket</div><p className="text-xs text-muted">Delete every object but keep the bucket and its settings.</p></div>
            <Button variant="outline-danger" icon={Eraser} disabled={b.objectCount === 0} onClick={empty}>Empty</Button>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <div><div className="text-sm font-medium text-fg">Delete bucket</div><p className="text-xs text-muted">{b.objectCount ? 'Requires deleting all objects (force).' : 'The name is released immediately.'}{b.objectLock ? ' Locked objects block deletion until retention ends.' : ''}</p></div>
            <Button variant="danger" icon={Trash2} onClick={async () => { if (await deleteBucketFlow(b)) onDeleted() }}>Delete</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
