import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { PackageOpen, Rocket, FileCode2, Globe, Lock, ShieldCheck, History, CheckCircle2, XCircle, Loader2, KeyRound } from 'lucide-react';
import { useList, useApiMutation } from '@/api/hooks';
import { api, type ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Field, Input, Switch, OptionCards, Slider, NumberInput, TagEditor, Hint, Textarea } from '@/components/ui/form';
import { FormSection, CreateLayout, fieldErrors } from '@/components/ui/FormLayout';
import { Segmented } from '@/components/ui/Tabs';
import { IacTabs, toHcl, toCurl } from '@/components/ui/CodeBlock';
import { CostPanel } from '@/components/resource/CostPanel';
import { ProjectField, LocationCards } from '@/components/resource/pickers';
import { LifecycleRulesEditor, LifecycleTimeline } from '@/components/storage/LifecycleEditor';
import { CLASS_META, bucketNameHint } from '@/components/storage/common';
import { bucketCost } from '@/lib/pricing';
import { money } from '@/lib/format';
import { toast } from '@/components/ui/toast';
import { Pro, Advanced } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import type { Bucket, LifecycleRule, ProjectAllowance, StorageClass, Tag } from '@/types';

const TEMPLATES: Record<string, { label: string; description: string; apply: Partial<{ storageClass: StorageClass; versioning: boolean; objectLock: boolean; access: Bucket['access']; rules: LifecycleRule[]; sizeGB: number; reqM: number; egressGB: number }> }> = {
  assets: { label: 'Static website assets', description: 'Public read, CDN-friendly, temp uploads expire', apply: { storageClass: 'STANDARD', versioning: true, objectLock: false, access: 'public-read', rules: [{ id: 'lc-t1', prefix: 'tmp/', action: 'expire', days: 7, enabled: true }], sizeGB: 50, reqM: 40, egressGB: 600 } },
  backups: { label: 'Backups', description: 'Immutable (object lock), tier to archive, expire after 1 year', apply: { storageClass: 'INFREQUENT', versioning: true, objectLock: true, access: 'private', rules: [{ id: 'lc-t2', prefix: '', action: 'transition', days: 30, toClass: 'ARCHIVE', enabled: true }, { id: 'lc-t3', prefix: '', action: 'expire', days: 365, enabled: true }], sizeGB: 500, reqM: 0.1, egressGB: 5 } },
  logs: { label: 'Logs & analytics', description: 'Raw logs expire after 30 days, aggregates tier down', apply: { storageClass: 'STANDARD', versioning: false, objectLock: false, access: 'private', rules: [{ id: 'lc-t4', prefix: 'raw/', action: 'expire', days: 30, enabled: true }, { id: 'lc-t5', prefix: 'aggregated/', action: 'transition', days: 14, toClass: 'INFREQUENT', enabled: true }], sizeGB: 200, reqM: 12, egressGB: 20 } },
  data: { label: 'Data lake / ML artifacts', description: 'Private, versioned, checkpoints tier down', apply: { storageClass: 'STANDARD', versioning: true, objectLock: false, access: 'private', rules: [{ id: 'lc-t6', prefix: 'checkpoints/', action: 'transition', days: 60, toClass: 'INFREQUENT', enabled: true }], sizeGB: 2000, reqM: 3, egressGB: 200 } },
};

export default function BucketCreate() {
  const navigate = useNavigate();
  const pro = usePro();
  const { items: allowances } = useList<ProjectAllowance>('allowances');
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [locationId, setLocationId] = useState('dc1');
  const [storageClass, setStorageClass] = useState<StorageClass>('STANDARD');
  const [versioning, setVersioning] = useState(true);
  const [objectLock, setObjectLock] = useState(false);
  const [lockDays, setLockDays] = useState(30);
  const [lockMode, setLockMode] = useState<'governance' | 'compliance'>('governance');
  const [encryption, setEncryption] = useState<Bucket['encryption']>('SSE');
  const [access, setAccess] = useState<Bucket['access']>('private');
  const [ackPublic, setAckPublic] = useState(false);
  const [quotaOn, setQuotaOn] = useState(false);
  const [quotaGB, setQuotaGB] = useState(500);
  const [rules, setRules] = useState<LifecycleRule[]>([]);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<Tag[]>([{ key: 'env', value: 'prod' }]);
  const [sizeGB, setSizeGB] = useState(100);
  const [reqM, setReqM] = useState(5);
  const [egressGB, setEgressGB] = useState(50);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<{ name: string; available: boolean; reason: string | null } | null>(null);
  const allowance = allowances.find((a) => a.projectId === projectId);

  // live global-name availability check (debounced)
  const localErr = bucketNameHint(name);
  useEffect(() => {
    setAvailability(null);
    if (!name || localErr) return;
    const t = setTimeout(() => { api.get_<{ name: string; available: boolean; reason: string | null }>(`/buckets/name-available?name=${encodeURIComponent(name)}`).then(setAvailability).catch(() => {}) }, 350);
    return () => clearTimeout(t);
  }, [name, localErr]);
  useEffect(() => { if (objectLock) setVersioning(true) }, [objectLock]);
  useEffect(() => {
    const rank: Record<StorageClass, number> = { STANDARD: 0, INFREQUENT: 1, ARCHIVE: 2 };
    setRules((rs) => rs.filter((r) => !(storageClass === 'ARCHIVE' && r.action === 'transition')).map((r) => (r.action === 'transition' && r.toClass && rank[r.toClass] <= rank[storageClass] ? { ...r, toClass: 'ARCHIVE' } : r)));
  }, [storageClass]);

  const applyTemplate = (k: string) => {
    const t = TEMPLATES[k].apply;
    if (t.storageClass) setStorageClass(t.storageClass);
    if (t.versioning != null) setVersioning(t.versioning);
    if (t.objectLock != null) setObjectLock(t.objectLock);
    if (t.access) { setAccess(t.access); setAckPublic(false) }
    if (t.rules) setRules(t.rules.map((r) => ({ ...r, id: `${r.id}-${Date.now().toString(36)}` })));
    if (t.sizeGB) setSizeGB(t.sizeGB);
    if (t.reqM != null) setReqM(t.reqM);
    if (t.egressGB != null) setEgressGB(t.egressGB);
    toast.info(`Applied “${TEMPLATES[k].label}” defaults`);
  };

  const cost = useMemo(() => bucketCost({ storageClass, storageGB: sizeGB, requestsMillions: reqM, egressGB }), [storageClass, sizeGB, reqM, egressGB]);
  const tieredCost = useMemo(() => {
    // what the expected size would cost after lifecycle transitions settle (rough steady state)
    const tr = rules.filter((r) => r.enabled && r.action === 'transition' && r.toClass);
    if (!tr.length) return null;
    const exp = rules.find((r) => r.enabled && r.action === 'expire' && !r.prefix)?.days ?? 365;
    let total = 0; let prev = 0; let cls: StorageClass = storageClass;
    for (const t of tr.sort((a, b) => a.days - b.days)) { const span = Math.min(t.days, exp) - prev; if (span > 0) total += (span / exp) * CLASS_META[cls].price * (t.prefix ? 0.5 : 1); prev = Math.min(t.days, exp); cls = t.toClass! }
    total += Math.max(0, (exp - prev) / exp) * CLASS_META[cls].price;
    return Math.round(total * sizeGB * 100) / 100;
  }, [rules, storageClass, sizeGB]);

  const body = {
    name, projectId, locationId, storageClass, versioning, objectLock, ...(objectLock ? { objectLockRetentionDays: lockDays, objectLockMode: lockMode } : {}),
    encryption, access, ...(access === 'public-read' ? { acknowledgePublic: ackPublic } : {}), quotaGB: quotaOn ? quotaGB : null, lifecycleRules: rules, description, tags,
  };

  const create = useApiMutation(() => api.create<Bucket>('buckets', body), {
    silent: true,
    onSuccess: (b) => { toast.success(`Creating bucket ${b.name}`, 'Ready in a few seconds.'); navigate(`/managed-services/object-storage/${b.id}`) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); setFormError(e.message); window.scrollTo({ top: 0, behavior: 'smooth' }) },
  });

  const nameErr = localErr ?? (availability && !availability.available ? availability.reason : null) ?? errors.name;
  const canSubmit = !!name && !nameErr && !!projectId && (access !== 'public-read' || ackPublic);
  const iacBody = Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'acknowledgePublic' && k !== 'description'));
  const endpoint = `https://s3.${locationId}.autark.cloud`;

  const nameField = (
    <Field label="Bucket name" required error={nameErr} hint={availability?.available ? undefined : '3–63 chars: lowercase, digits, dots, dashes'}>
      <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s/g, '-'))} placeholder="acme-prod-assets" invalid={!!nameErr} autoFocus mono
        suffix={!name || localErr ? undefined : availability == null ? <Loader2 className="size-3.5 animate-spin" /> : availability.available ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <XCircle className="size-3.5 text-rose-500" />} />
      {availability?.available && <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">Available · {`https://${name}.s3.${locationId}.autark.cloud`}</p>}
    </Field>
  );
  const descriptionField = <Field label="Description" optional><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is stored here and who owns it" /></Field>;
  const templatesField = (
    <Field label="Start from a template" optional>
      <div className="grid gap-2 @min-[36rem]:grid-cols-2 @min-[44rem]:grid-cols-4">
        {Object.entries(TEMPLATES).map(([k, t]) => (
          <button key={k} type="button" onClick={() => applyTemplate(k)} className="rounded-xl border border-line p-3 text-left transition-colors hover:border-brand-500 hover:bg-brand-500/5">
            <div className="text-sm font-medium text-fg">{t.label}</div>
            <div className="mt-0.5 text-xs text-muted">{t.description}</div>
          </button>
        ))}
      </div>
    </Field>
  );
  const tagsRequired = !!allowance?.requiredTags.length;
  const tagsField = (
    <Field label="Tags" error={errors.tags} hint={tagsRequired ? `Project policy requires: ${allowance!.requiredTags.join(', ')}` : undefined}>
      <TagEditor value={tags} onChange={setTags} required={allowance?.requiredTags} />
    </Field>
  );
  const locationField = (
    <>
      <LocationCards value={locationId} onChange={setLocationId} filter={(l) => !allowance || allowance.allowedLocations.includes(l.id) || l.id === locationId} />
      {errors.locationId && <p className="text-xs text-rose-500">{errors.locationId}</p>}
    </>
  );
  const classCards = (
    <OptionCards cols={3} value={storageClass} onChange={setStorageClass} options={(Object.keys(CLASS_META) as StorageClass[]).map((c) => ({
      value: c, title: CLASS_META[c].label, description: CLASS_META[c].description,
      icon: <span className="size-3 rounded-sm" style={{ background: CLASS_META[c].color }} />,
      meta: <div className="flex items-center justify-between text-xs"><span className="text-muted">{CLASS_META[c].retrieval}</span><span className="font-medium tabular text-fg">€{CLASS_META[c].price}/GB</span></div>,
    }))} />
  );
  const protectionFields = (
    <>
      <Switch checked={versioning} onChange={setVersioning} disabled={objectLock} label={<span className="flex items-center gap-1.5"><History className="size-3.5" />Versioning</span>} description="Keep every version of every object — protects against accidental overwrites and deletes. Noncurrent versions are billed." />
      <Switch checked={objectLock} onChange={setObjectLock} label={<span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" />Object lock (WORM)</span>} description="Objects cannot be deleted or overwritten during a retention period — ransomware-proof backups. Requires versioning." />
      {objectLock && (
        <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-xs text-amber-800 dark:text-amber-300"><b>Object lock cannot be turned off</b> once the bucket exists. Buckets with locked objects can only be deleted after retention expires.</p>
          <div className="grid gap-3 @min-[36rem]:grid-cols-2">
            <Field label="Mode">
              <Segmented value={lockMode} onChange={setLockMode} options={[{ value: 'governance', label: 'Governance' }, { value: 'compliance', label: 'Compliance' }]} />
            </Field>
            <Field label="Default retention"><NumberInput value={lockDays} onChange={setLockDays} min={1} max={3650} unit="days" /></Field>
          </div>
          <p className="text-[11px] text-muted">{lockMode === 'governance' ? 'Governance: admins with a special permission can still shorten retention.' : 'Compliance: nobody — not even admins — can shorten retention or delete locked objects.'}</p>
        </div>
      )}
      <Field label="Encryption at rest">
        <Segmented value={encryption} onChange={setEncryption} options={[{ value: 'SSE', label: 'SSE (managed keys)' }, { value: 'SSE-KMS', label: 'SSE-KMS (Vault)' }, { value: 'none', label: 'None' }]} />
      </Field>
      {encryption === 'none' && <Hint tone="warning">Data is stored unencrypted on disk. Only choose this for public, non-sensitive data.</Hint>}
    </>
  );
  const accessFields = (
    <>
      <OptionCards cols={2} value={access} onChange={(v) => { setAccess(v); setAckPublic(false) }} options={[
        { value: 'private', title: 'Private', description: pro ? 'Only signed requests with an access key or presigned URLs. Recommended.' : 'Only apps with an access key can read files. Recommended.', icon: <Lock className="size-4 text-emerald-500" /> },
        { value: 'public-read', title: pro ? 'Public read' : 'Public', description: pro ? 'Anyone on the internet can download objects. For static websites & public assets.' : 'Anyone with the link can download files. For websites and public assets.', icon: <Globe className="size-4 text-amber-500" /> },
      ]} />
      {access === 'public-read' && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3">
          <p className="text-[13px] text-rose-800 dark:text-rose-300">Every object uploaded to this bucket will be publicly downloadable — including files uploaded by mistake.{pro ? ' Listing stays disabled.' : ''}</p>
          <label className="mt-2 flex items-center gap-2 text-[13px] font-medium text-fg"><input type="checkbox" className="accent-rose-500" checked={ackPublic} onChange={(e) => setAckPublic(e.target.checked)} />I understand that objects in this bucket are public</label>
          {errors.access && <p className="mt-1 text-xs text-rose-500">{errors.access}</p>}
        </div>
      )}
      {pro && <p className="flex items-center gap-1.5 text-xs text-muted"><KeyRound className="size-3.5" />Create scoped access keys for applications after the bucket exists.</p>}
    </>
  );
  const lifecycleFields = (
    <>
      <LifecycleRulesEditor rules={rules} onChange={setRules} baseClass={storageClass} errors={errors} />
      {rules.length > 0 && <LifecycleTimeline rules={rules} baseClass={storageClass} />}
    </>
  );
  const quotaFields = (
    <>
      <Switch checked={quotaOn} onChange={setQuotaOn} label="Limit bucket size" description="Uploads are rejected once the bucket reaches the quota — protects your budget from runaway writers." />
      {quotaOn && <Field label="Quota" error={errors.quotaGB}><NumberInput value={quotaGB} onChange={setQuotaGB} min={1} max={1_000_000} step={50} unit="GB" className="@min-[36rem]:w-60" /></Field>}
    </>
  );
  const advancedNeeded = Object.keys(errors).some((k) => !['name', 'projectId', 'locationId', 'access'].includes(k));
  const classLabel = CLASS_META[storageClass].label;

  return (
    <Page wide>
      <PageHeader title="Create bucket" description={pro ? 'An S3-compatible bucket for files, backups, logs or static assets.' : 'Store files, backups and assets. Works with any S3 tool.'} icon={PackageOpen} iconColor="#eab308"
        crumbs={[{ label: 'Object Storage', to: '/managed-services/object-storage' }, { label: 'Create' }]} />
      {formError && <Hint tone="danger" className="mb-5">{formError}</Hint>}

      <CreateLayout needsProject="bucket" aside={<>
        <CostPanel cost={cost} projectId={projectId} footer={
          <div className="space-y-2">
            <Button variant="primary" size="lg" className="w-full" icon={Rocket} loading={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()}>Create bucket</Button>
            {!canSubmit && <p className="text-center text-[11px] text-muted">{!name ? 'Enter a bucket name' : nameErr ? 'Fix the bucket name' : access === 'public-read' && !ackPublic ? 'Acknowledge public access' : 'Select a project'}</p>}
          </div>
        }>
          <div className="mt-4 space-y-4 border-t border-line pt-3">
            <p className="text-xs text-muted">{pro ? 'Buckets are billed by usage. Estimate your expected load:' : 'You pay for what you store. Estimate:'}</p>
            <Field label={`Stored data · ${sizeGB >= 1024 ? `${(sizeGB / 1024).toFixed(1)} TB` : `${sizeGB} GB`}`}><Slider value={sizeGB} onChange={setSizeGB} min={1} max={10000} step={1} marks={[1, 2500, 5000, 10000]} format={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))} /></Field>
            {pro && (
              <>
                <Field label={`Requests · ${reqM}M / month`}><Slider value={reqM} onChange={setReqM} min={0} max={100} step={0.5} marks={[0, 50, 100]} /></Field>
                <Field label={`Egress · ${egressGB} GB / month`}><Slider value={egressGB} onChange={setEgressGB} min={0} max={5000} step={10} marks={[0, 2500, 5000]} /></Field>
              </>
            )}
            {tieredCost != null && (
              <div className="rounded-lg bg-emerald-500/5 p-2.5 text-xs text-emerald-700 dark:text-emerald-400">
                With your lifecycle rules, storage settles around <b>{money(tieredCost)}/mo</b> instead of {money(cost.lines[0]?.amount ?? 0)}.
              </div>
            )}
            {pro && (
              <div className="space-y-1 text-xs text-muted">
                <div className="flex justify-between"><span>Endpoint</span><span className="font-mono text-fg-2">{endpoint}</span></div>
                <div className="flex justify-between"><span>Durability</span><span className="text-fg-2">EC 4+2 · 11 nines</span></div>
              </div>
            )}
          </div>
        </CostPanel>
        <Pro>
          <details className="group rounded-xl border border-line bg-surface p-4 shadow-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-fg"><FileCode2 className="size-4 text-muted" /> Infrastructure as code<span className="ml-auto text-xs text-muted group-open:hidden">show</span></summary>
            <IacTabs className="mt-3" snippets={{
              terraform: toHcl('bucket', name || 'my_bucket', iacBody),
              cli: [
                `aws s3api create-bucket --bucket ${name || 'my-bucket'} \\\n  --endpoint-url ${endpoint}`,
                versioning ? `aws s3api put-bucket-versioning --bucket ${name || 'my-bucket'} \\\n  --versioning-configuration Status=Enabled --endpoint-url ${endpoint}` : '',
                access === 'public-read' ? `aws s3api put-bucket-acl --bucket ${name || 'my-bucket'} --acl public-read --endpoint-url ${endpoint}` : '',
                `\n# or with the Autark CLI\nautark bucket create ${name || 'my-bucket'} --project ${projectId} --location ${locationId} --class ${storageClass}${versioning ? ' --versioning' : ''}${objectLock ? ` --object-lock ${lockMode}:${lockDays}d` : ''}${access === 'public-read' ? ' --public' : ''}`,
              ].filter(Boolean).join('\n'),
              curl: toCurl('POST', '/buckets', body),
            }} />
          </details>
        </Pro>
      </>}>
        {pro ? (
          <>
            <FormSection step={1} title="Name & project" description="Bucket names are global across all Autark tenants and become part of the URL.">
              <div className="grid gap-4 @min-[36rem]:grid-cols-2">
                {nameField}
                <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />
              </div>
              {descriptionField}
              {templatesField}
              {tagsField}
            </FormSection>

            <FormSection step={2} title="Location" description="Data never leaves the chosen location unless you replicate it." aside={allowance && <span className="text-xs text-muted">Allowed: {allowance.allowedLocations.join(', ')}</span>}>
              {locationField}
            </FormSection>

            <FormSection step={3} title="Default storage class" description="Applies to new objects. Lifecycle rules can tier data down automatically.">
              {classCards}
            </FormSection>

            <FormSection step={4} title="Data protection" description="Versioning, immutability and encryption at rest.">
              {protectionFields}
            </FormSection>

            <FormSection step={5} title="Access" description="Who can read objects without credentials.">
              {accessFields}
            </FormSection>

            <FormSection step={6} title="Lifecycle rules" description="Automatically move older objects to cheaper classes and delete what you no longer need." aside={<span className="text-xs text-muted">{rules.length} rule{rules.length === 1 ? '' : 's'}</span>}>
              {lifecycleFields}
            </FormSection>

            <FormSection step={7} title="Quota">
              {quotaFields}
            </FormSection>
          </>
        ) : (
          <>
            <FormSection step={1} title="Name" description="Bucket names are unique worldwide and become part of the URL.">
              <div className="grid gap-4 @min-[36rem]:grid-cols-2">
                {nameField}
                <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />
              </div>
              {tagsRequired && tagsField}
            </FormSection>

            <FormSection step={2} title="Location">
              {locationField}
            </FormSection>

            <FormSection step={3} title="Access">
              {accessFields}
            </FormSection>

            <Advanced
              key={advancedNeeded ? 'adv-open' : 'adv'}
              defaultOpen={advancedNeeded || undefined}
              description={`${classLabel} class · versioning ${versioning ? 'on' : 'off'}${objectLock ? ' · object lock' : ''} · ${encryption === 'none' ? 'not encrypted' : 'encrypted'} · ${rules.length ? `${rules.length} lifecycle rule${rules.length === 1 ? '' : 's'}` : 'no lifecycle rules'}${quotaOn ? ` · ${quotaGB} GB quota` : ''}`}
            >
              {templatesField}
              <SubHeading>Storage class</SubHeading>
              {classCards}
              <SubHeading>Data protection</SubHeading>
              {protectionFields}
              <SubHeading>Lifecycle rules</SubHeading>
              {lifecycleFields}
              <SubHeading>Quota</SubHeading>
              {quotaFields}
              <SubHeading>Details</SubHeading>
              {descriptionField}
              {!tagsRequired && tagsField}
            </Advanced>
          </>
        )}
      </CreateLayout>
    </Page>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="border-t border-line pt-4 text-[12px] font-semibold uppercase tracking-wide text-muted">{children}</h3>;
}
