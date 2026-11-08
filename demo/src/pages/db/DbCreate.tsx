import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Database, Rocket, Cpu, MemoryStick, HardDrive, Plus, Shield, FileCode2, ShieldCheck, Clock, Globe2, AlertTriangle } from 'lucide-react';
import { useList, useApiMutation } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Switch, OptionCards, Slider, NumberInput, TagEditor, MultiSelect, Hint } from '@/components/ui/form';
import { FormSection, CreateLayout, fieldErrors } from '@/components/ui/FormLayout';
import { Segmented } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { IacTabs, toCli, toHcl, toCurl } from '@/components/ui/CodeBlock';
import { CostPanel } from '@/components/resource/CostPanel';
import { ProjectField, LocationCards, NetworkSubnetFields, useFirewallOptions } from '@/components/resource/pickers';
import { EngineLogo, ENGINE_META, useDbEngines, DAYS } from '@/components/db/engine';
import { dbCost } from '@/lib/pricing';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import { toast } from '@/components/ui/toast';
import { Pro, Advanced } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import { useAutoSubnet } from '@/components/db/useAutoSubnet';
import type { DbEngine, DbPreset, Location, ProjectAllowance, DbInstance } from '@/types';

const ENGINE_ORDER: DbEngine[] = ['postgres', 'mysql', 'mariadb', 'redis'];
const ENGINE_BLURB: Record<DbEngine, string> = {
  postgres: 'Relational, extensions (PostGIS, pgvector), PgBouncer pooling',
  mysql: 'InnoDB, GTID replication, ProxySQL',
  mariadb: 'MySQL-compatible, thread pool, MaxScale',
  redis: 'In-memory cache, queues & sessions',
};
const ENGINE_SHORT: Record<DbEngine, string> = { postgres: 'Relational', mysql: 'Relational', mariadb: 'MySQL-compatible', redis: 'In-memory cache' };

export default function DbCreate() {
  const navigate = useNavigate();
  const pro = usePro();
  const [sp] = useSearchParams();
  const { engines, byId } = useDbEngines();
  const { items: presets } = useList<DbPreset>('dbPresets');
  const { items: locations } = useList<Location>('locations');
  const { items: allowances } = useList<ProjectAllowance>('allowances');
  const { items: existing } = useList<DbInstance>('dbInstances');

  const [engine, setEngine] = useState<DbEngine>((sp.get('engine') as DbEngine) || 'postgres');
  const [version, setVersion] = useState('');
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [locationId, setLocationId] = useState('dc1');
  const [sizeMode, setSizeMode] = useState<'preset' | 'custom'>('preset');
  const [presetId, setPresetId] = useState('db-pg-m');
  const [custom, setCustom] = useState({ vcpus: 2, ramGB: 8 });
  const [storageGB, setStorageGB] = useState(200);
  const [autoscale, setAutoscale] = useState(true);
  const [ha, setHa] = useState(true);
  const [replicas, setReplicas] = useState(0);
  const [net, setNet] = useState({ networkId: '', subnetId: '' });
  const [firewallIds, setFirewallIds] = useState<string[]>([]);
  const [publicAccess, setPublicAccess] = useState(false);
  const [backups, setBackups] = useState({ enabled: true, schedule: 'daily' as 'daily' | 'hourly', retention: 7, pitr: true, window: '02:00-03:00' });
  const [mw, setMw] = useState<{ day: DbInstance['maintenanceWindow']['day']; hour: number }>({ day: 'sun', hour: 3 });
  const [initialDatabase, setInitialDatabase] = useState('app');
  const [initialUser, setInitialUser] = useState('app');
  const [protection, setProtection] = useState(true);
  const [tags, setTags] = useState<{ key: string; value: string }[]>([{ key: 'env', value: 'prod' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const spec = byId(engine);
  const meta = ENGINE_META[engine];
  const loc = locations.find((l) => l.id === locationId);
  const allowance = allowances.find((a) => a.projectId === projectId);
  const firewallOptions = useFirewallOptions(projectId);
  useAutoSubnet(projectId, locationId, net, setNet);
  const enginePresets = presets.filter((p) => p.engine === engine || p.engine === 'any');
  const preset = enginePresets.find((p) => p.id === presetId);
  const isRedis = engine === 'redis';

  // defaults when the engine changes
  useEffect(() => {
    const cur = presets.find((p) => p.id === presetId);
    const first = presets.find((p) => p.engine === engine && p.ramGB >= 8) ?? presets.find((p) => p.engine === engine) ?? presets.find((p) => p.engine === 'any');
    if (first && !(cur && cur.engine === engine)) { setPresetId(first.id); setStorageGB(first.storageGB) }
    setBackups((b) => ({ ...b, pitr: engine !== 'redis' && b.enabled }));
    if (engine === 'redis') { setHa(false); setReplicas(0) }
  }, [engine, presets.length]); // eslint-disable-line
  useEffect(() => { if (spec) setVersion(spec.versions.find((v) => v.default)?.version ?? spec.versions[0].version) }, [spec?.id]); // eslint-disable-line
  useEffect(() => { setFirewallIds([]); setPublicAccess(false) }, [projectId]);
  useEffect(() => { if (preset && sizeMode === 'preset') setStorageGB((s) => Math.max(s, preset.storageGB)) }, [presetId]); // eslint-disable-line

  const size = sizeMode === 'custom' ? custom : { vcpus: preset?.vcpus ?? 0, ramGB: preset?.ramGB ?? 0 };
  const minStorage = isRedis ? Math.max(10, size.ramGB) : 10;
  useEffect(() => { if (storageGB < minStorage) setStorageGB(minStorage) }, [minStorage]); // eslint-disable-line

  const cost = useMemo(() => dbCost({
    engine, vcpus: size.vcpus, ramGB: size.ramGB, storageGB, ha, readReplicas: replicas,
    backupGB: backups.enabled ? Math.round(storageGB * 0.25 * 0.4 * backups.retention / 7) : 0,
  }), [engine, size.vcpus, size.ramGB, storageGB, ha, replicas, backups.enabled, backups.retention]);

  const body = {
    name, projectId, engine, version, locationId,
    ...(sizeMode === 'custom' ? { vcpus: custom.vcpus, ramGB: custom.ramGB } : { presetId }),
    storageGB, storageAutoscale: autoscale, ha, readReplicas: replicas, networkId: net.networkId, subnetId: net.subnetId, firewallIds, publicAccess,
    backups: { ...backups, pitr: backups.enabled && backups.pitr && !isRedis }, maintenanceWindow: mw,
    ...(spec?.supportsDatabases ? { initialDatabase: initialDatabase || undefined, initialUser: initialUser || undefined } : {}),
    deletionProtection: protection, tags,
  };

  const create = useApiMutation(() => { setErrors({}); setFormError(null); return api.create<DbInstance>('dbInstances', body) }, {
    silent: true,
    onSuccess: (d) => { toast.success(`Provisioning ${d.name}`, 'Your admin password will be shown once on the detail page.'); navigate(`/managed-services/db/${d.id}`) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); setFormError(e.message); window.scrollTo({ top: 0, behavior: 'smooth' }) },
  });

  const nameErr = name && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name) ? 'Lowercase letters, digits and dashes' : name && existing.some((d) => d.name === name && d.projectId === projectId) ? 'Name already used in this project' : undefined;
  const identErr = (v: string) => (v && !/^[a-z_][a-z0-9_]{0,62}$/.test(v) ? 'Lowercase letters, digits, underscores' : undefined);
  const publicNeedsFw = publicAccess && firewallIds.length === 0;
  const canSubmit = !!name && !nameErr && !!projectId && !!net.subnetId && !!version && !publicNeedsFw && !identErr(initialDatabase) && !identErr(initialUser);
  const ver = spec?.versions.find((v) => v.version === version);
  const quota = allowance?.quotas.dbInstances;
  const usedQuota = existing.filter((d) => d.projectId === projectId).length;

  const engineCards = (
    <div className="grid grid-cols-1 gap-2.5 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-4" role="radiogroup">
      {ENGINE_ORDER.map((e) => {
        const active = engine === e;
        const m = ENGINE_META[e];
        return (
          <button key={e} type="button" role="radio" aria-checked={active} onClick={() => setEngine(e)}
            className={cn('relative flex items-start gap-3 overflow-hidden rounded-xl border p-3 text-left transition-all', active ? 'border-brand-500 bg-brand-500/[0.06] ring-3 ring-brand-500/15' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2/50')}>
            <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: active ? m.color : 'transparent' }} />
            <EngineLogo engine={e} size={36} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-fg">{m.label}</span>
              {pro ? <span className="mt-0.5 block text-xs text-muted">{ENGINE_BLURB[e]}</span>
                : <span className="mt-0.5 block text-xs text-muted">{e === engine && version ? `Version ${version}` : ENGINE_SHORT[e]}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );

  const versionField = spec && (
    <div className="grid gap-4 @min-[36rem]:grid-cols-[1fr_1.4fr]">
      <Field label="Version" error={errors.version}>
        <Segmented value={version} onChange={setVersion} options={spec.versions.filter((v) => !v.deprecated || v.version === version).map((v) => ({ value: v.version, label: v.version }))} />
      </Field>
      <div className="flex items-end text-xs text-muted">
        {ver?.default ? <span className="flex items-center gap-1.5"><Badge tone="success">recommended</Badge> Latest stable, longest support window.</span>
          : ver?.eol ? <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400"><AlertTriangle className="size-3.5" /> Upstream end-of-life {ver.eol}. Plan an upgrade.</span>
          : <span>Supported. In-place major upgrades are available later.</span>}
      </div>
    </div>
  );

  const nameField = (
    <Field label="Name" required error={nameErr ?? errors.name} hint={pro ? `Host: ${name || 'name'}.db.${locationId}.autark.internal` : undefined}>
      <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder={isRedis ? 'cache-sessions' : 'pg-orders'} invalid={!!(nameErr ?? errors.name)} autoFocus />
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

  const presetCards = enginePresets.length ? (
    <OptionCards cols={3} value={presetId} onChange={(v) => { setPresetId(v); const p = enginePresets.find((x) => x.id === v); if (p) setStorageGB(Math.max(p.storageGB, minStorage)) }} options={enginePresets.map((p) => ({
      value: p.id, title: p.name, description: pro ? p.description : undefined, badge: pro && p.engine === 'any' ? <Badge>any</Badge> : undefined,
      meta: (
        <div className="flex items-center justify-between text-xs">
          <span className="flex gap-2 text-fg-2"><span className="flex items-center gap-0.5"><Cpu className="size-3" />{p.vcpus}</span><span className="flex items-center gap-0.5"><MemoryStick className="size-3" />{p.ramGB}G</span><span className="flex items-center gap-0.5"><HardDrive className="size-3" />{p.storageGB}G</span></span>
          <span className="font-medium tabular text-fg">{money(dbCost({ vcpus: p.vcpus, ramGB: p.ramGB, storageGB: p.storageGB, ha: false }).total)}</span>
        </div>
      ),
    }))} />
  ) : <Hint>No presets for {meta.label}. <Button size="xs" variant="ghost" to="/managed-services/db/presets">Create one</Button> or switch to custom.</Hint>;
  const customSize = (
    <div className="grid gap-5 @min-[36rem]:grid-cols-2">
      <Field label={`vCPUs · ${custom.vcpus}`} error={errors.vcpus}><Slider value={custom.vcpus} onChange={(v) => setCustom({ ...custom, vcpus: v })} min={1} max={64} marks={[1, 8, 16, 32, 64]} /></Field>
      <Field label={`Memory · ${custom.ramGB} GB`} error={errors.ramGB}><Slider value={custom.ramGB} onChange={(v) => setCustom({ ...custom, ramGB: v })} min={1} max={512} marks={[1, 64, 128, 256, 512]} /></Field>
    </div>
  );
  const sizeModeToggle = <Segmented size="sm" value={sizeMode} onChange={setSizeMode} options={[{ value: 'preset', label: 'Presets' }, { value: 'custom', label: 'Custom' }]} />;
  const storageFields = (
    <>
      <Field label={`Storage · ${storageGB} GB NVMe`} error={errors.storageGB} hint={isRedis ? `Redis persistence (AOF/RDB) needs at least ${minStorage} GB (≥ memory).` : 'Storage can grow online later but never shrink.'}>
        <Slider value={storageGB} onChange={(v) => setStorageGB(Math.max(minStorage, v))} min={10} max={2000} step={10} marks={[10, 500, 1000, 2000]} />
      </Field>
      <Switch checked={autoscale} onChange={setAutoscale} label="Storage autoscaling" description="Grow storage by 20% automatically when usage exceeds 90%." />
    </>
  );

  const haSwitch = (
    <Switch checked={ha} onChange={setHa}
      label={<span className="flex items-center gap-1.5"><ShieldCheck className="size-4 text-emerald-500" /> {pro ? 'Hot standby (HA)' : 'High availability'}</span>}
      description={pro ? `${isRedis ? 'Redis Sentinel' : 'Synchronous replication'} + automatic failover. Adds 70% to compute cost.` : 'A standby copy takes over automatically within seconds if a server fails.'} />
  );
  const replicasField = (
    <Field label="Read replicas" hint="Async replicas with their own read-only endpoint." error={errors.readReplicas}>
      <NumberInput value={replicas} onChange={setReplicas} min={0} max={5} />
    </Field>
  );

  const networkFields = (
    <>
      {projectId && <NetworkSubnetFields projectId={projectId} locationId={locationId} networkId={net.networkId} subnetId={net.subnetId} onChange={setNet} errors={errors} />}
      <Field label="Firewalls" error={errors.firewallIds} hint={`Allow ${meta.port}/tcp from your app subnets. Default inbound policy is deny.`} action={<Button size="xs" variant="ghost" icon={Plus} to="/infrastructure/firewalls/new">New</Button>}>
        <MultiSelect options={firewallOptions} value={firewallIds} onChange={setFirewallIds} placeholder="No firewall (reachable from the VPC only)" emptyText="No firewalls in this project" />
      </Field>
      <Switch checked={publicAccess} onChange={setPublicAccess} label={<span className="flex items-center gap-1.5"><Globe2 className="size-4" /> Public endpoint</span>} description="Expose a TLS-only endpoint on the internet. Requires a firewall that restricts sources." />
      {publicNeedsFw && <Hint tone="warning">Attach at least one firewall that limits source addresses before enabling the public endpoint.</Hint>}
    </>
  );

  const backupFields = (
    <>
      <Switch checked={backups.enabled} onChange={(v) => setBackups({ ...backups, enabled: v, pitr: v && backups.pitr })} label="Automated backups" description="Full backups at the backup window, streamed from the standby when available." />
      {backups.enabled && (
        <div className="grid gap-4 @min-[36rem]:grid-cols-3">
          <Field label="Schedule"><Segmented value={backups.schedule} onChange={(v) => setBackups({ ...backups, schedule: v })} options={[{ value: 'daily', label: 'Daily' }, { value: 'hourly', label: 'Hourly' }]} /></Field>
          <Field label="Retention" error={errors['backups.retention']}><NumberInput value={backups.retention} onChange={(v) => setBackups({ ...backups, retention: v })} min={1} max={35} unit="days" /></Field>
          <Field label="Backup window (UTC)" error={errors['backups.window']}><Input value={backups.window} onChange={(e) => setBackups({ ...backups, window: e.target.value })} placeholder="02:00-03:00" mono /></Field>
        </div>
      )}
      {!isRedis ? (
        <Switch checked={backups.pitr && backups.enabled} disabled={!backups.enabled} onChange={(v) => setBackups({ ...backups, pitr: v })}
          label={<span className="flex items-center gap-1.5"><Clock className="size-4" /> Point-in-time recovery</span>}
          description={`Continuous ${engine === 'postgres' ? 'WAL' : 'binlog'} archiving — restore to any second within the last ${backups.retention} days.`} />
      ) : <p className="text-xs text-muted">Redis uses RDB snapshots + AOF; point-in-time recovery is not available.</p>}
      {errors['backups.pitr'] && <p className="text-xs text-rose-500">{errors['backups.pitr']}</p>}
    </>
  );
  const maintenanceField = (
    <div className="grid gap-4 @min-[36rem]:grid-cols-2">
      <Field label="Maintenance window" hint="Minor version patches and host maintenance happen here (≤ 30s with HA).">
        <div className="flex gap-2">
          <Select className="flex-1" value={mw.day} onChange={(e) => setMw({ ...mw, day: e.target.value as typeof mw.day })} options={DAYS.map((d) => ({ value: d.value, label: d.label }))} />
          <Select className="w-28" value={String(mw.hour)} onChange={(e) => setMw({ ...mw, hour: Number(e.target.value) })} options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }))} />
        </div>
      </Field>
    </div>
  );
  const accessFields = (
    <>
      {spec?.supportsDatabases ? (
        <div className="grid gap-4 @min-[36rem]:grid-cols-2">
          <Field label="Initial database" optional error={identErr(initialDatabase) ?? errors.initialDatabase}><Input value={initialDatabase} onChange={(e) => setInitialDatabase(e.target.value.toLowerCase())} placeholder="app" mono /></Field>
          <Field label="Owner user" optional error={identErr(initialUser) ?? errors.initialUser} hint={`Admin user "${spec.adminUser}" is always created.`}><Input value={initialUser} onChange={(e) => setInitialUser(e.target.value.toLowerCase())} placeholder="app" mono /></Field>
        </div>
      ) : null}
      <Switch checked={protection} onChange={setProtection} label={<span className="flex items-center gap-1.5"><Shield className="size-3.5" /> Deletion protection</span>} description="Prevents accidental deletion via console, CLI or Terraform until disabled." />
    </>
  );

  // fields that the API rejected but are hidden in the collapsed advanced section
  const advancedErrorKeys = ['version', 'vcpus', 'ramGB', 'storageGB', 'readReplicas', 'networkId', 'subnetId', 'firewallIds', 'backups.retention', 'backups.window', 'backups.pitr', 'initialDatabase', 'initialUser', 'tags'];
  const advancedHasError = advancedErrorKeys.some((k) => errors[k]);

  const summary = (
    <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs text-muted">
      <div className="flex justify-between gap-2"><span>Engine</span><span className="text-fg-2">{meta.label} {version}</span></div>
      <div className="flex justify-between gap-2"><span>Size</span><span className="text-fg-2">{size.vcpus} vCPU · {size.ramGB} GB · {storageGB} GB</span></div>
      <div className="flex justify-between gap-2"><span>{pro ? 'Topology' : 'Availability'}</span><span className="text-fg-2">{ha ? (pro ? 'Primary + standby' : 'High availability') : 'Single node'}{replicas ? ` + ${replicas} replica${replicas > 1 ? 's' : ''}` : ''}</span></div>
      {pro && <div className="flex justify-between gap-2"><span>Endpoint</span><span className="truncate font-mono text-[11px] text-fg-2">{name || 'name'}.db.{locationId}.autark.internal:{meta.port}</span></div>}
      {quota != null && <div className="flex justify-between gap-2"><span>Project quota</span><span className={cn(usedQuota >= quota ? 'text-rose-500' : 'text-fg-2')}>{usedQuota} / {quota} databases</span></div>}
    </div>
  );

  return (
    <Page wide>
      <PageHeader
        title="Create database"
        description={pro ? 'Pick an engine and a size — Autark provisions the primary, standby, pooler, TLS and backups for you.' : 'Pick an engine and a size. Backups and encryption are set up for you.'}
        icon={Database}
        iconColor="#3b82f6"
        crumbs={[{ label: 'Databases', to: '/managed-services/db' }, { label: 'Create' }]}
      />
      {formError && <Hint tone="danger" className="mb-5">{formError}</Hint>}

      <CreateLayout aside={<>
        <CostPanel cost={cost} projectId={projectId} footer={
          <div className="space-y-2">
            <Button variant="primary" size="lg" className="w-full" icon={Rocket} loading={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()}>Create database</Button>
            {!canSubmit && <p className="text-center text-[11px] text-muted">{!name ? 'Enter a name to continue' : nameErr ? nameErr : !net.subnetId ? (pro ? 'Pick a network & subnet' : 'No network in this location — see Advanced options') : publicNeedsFw ? 'Public access needs a firewall' : 'Check the highlighted fields'}</p>}
          </div>
        }>
          {summary}
        </CostPanel>
        <Pro>
          <details className="group rounded-xl border border-line bg-surface p-4 shadow-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-fg"><FileCode2 className="size-4 text-muted" /> Infrastructure as code<span className="ml-auto text-xs text-muted group-open:hidden">show</span></summary>
            <IacTabs className="mt-3" snippets={{ terraform: toHcl('database', name || 'my_db', body), cli: toCli('db create', body), curl: toCurl('POST', '/dbInstances', body) }} />
          </details>
        </Pro>
      </>}>
        {pro ? (
          <>
            <FormSection step={1} title="Engine" description="Fully managed open-source engines. Versions follow upstream support windows.">
              {engineCards}
              {versionField}
            </FormSection>

            <FormSection step={2} title="Basics" description="The name becomes the DNS hostname and cannot be changed later.">
              <div className="grid gap-4 @min-[36rem]:grid-cols-2">
                {nameField}
                <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />
              </div>
              {tagsField}
            </FormSection>

            <FormSection step={3} title="Location" description="Databases run on your own hardware; cloud regions are available for burst or DR." aside={allowance && <span className="text-xs text-muted">Allowed: {allowance.allowedLocations.join(', ')}</span>}>
              {locationField}
            </FormSection>

            <FormSection step={4} title="Size & storage" description="Compute is billed per node; standby and replicas use the same size." aside={sizeModeToggle}>
              {sizeMode === 'preset' ? presetCards : customSize}
              {errors.presetId && <p className="text-xs text-rose-500">{errors.presetId}</p>}
              {storageFields}
            </FormSection>

            <FormSection step={5} title="High availability & replicas" description="A synchronous standby in another failure domain takes over automatically within seconds.">
              <HaPreview engine={engine} ha={ha} replicas={replicas} />
              <div className="grid gap-4 @min-[36rem]:grid-cols-2">
                {haSwitch}
                {replicasField}
              </div>
              {!ha && <Hint tone="warning">Without a standby, host failures cause downtime until the instance is restored from backup. Recommended for production: enable HA.</Hint>}
            </FormSection>

            <FormSection step={6} title="Networking" description="Databases are private by default and reachable from the selected VPC.">
              {networkFields}
            </FormSection>

            <FormSection step={7} title="Backups & maintenance" description="Encrypted backups are stored off-host in object storage.">
              {backupFields}
              {maintenanceField}
            </FormSection>

            <FormSection step={8} title="Access" description={spec?.supportsDatabases ? 'An initial database and owner are created; the generated password is shown once.' : 'Redis ACL: the default user gets a generated password, shown once.'}>
              {accessFields}
            </FormSection>
          </>
        ) : (
          <>
            <FormSection step={1} title="Engine">
              {engineCards}
            </FormSection>

            <FormSection step={2} title="Size">
              {sizeMode === 'preset' ? presetCards : (
                <>
                  {customSize}
                  <Button size="xs" variant="ghost" onClick={() => setSizeMode('preset')}>Back to plans</Button>
                </>
              )}
              {errors.presetId && <p className="text-xs text-rose-500">{errors.presetId}</p>}
            </FormSection>

            <FormSection step={3} title="Availability">
              {haSwitch}
            </FormSection>

            <FormSection step={4} title="Name & location">
              <div className="grid gap-4 @min-[36rem]:grid-cols-2">
                {nameField}
                <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />
              </div>
              {locationField}
              {tagsRequired && tagsField}
            </FormSection>

            <Advanced
              key={advancedHasError ? 'adv-err' : 'adv'}
              defaultOpen={advancedHasError || undefined}
              description={`${meta.label} ${version} · ${storageGB} GB${autoscale ? ' autoscaling' : ''} · daily backups${backups.pitr && !isRedis ? ' + point-in-time' : ''} · private network${protection ? ' · deletion protection' : ''}`}
            >
              {versionField}
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-medium text-fg">Custom size</span>
                {sizeModeToggle}
              </div>
              {storageFields}
              {replicasField}
              <SubHeading>Network</SubHeading>
              {networkFields}
              <SubHeading>Backups & maintenance</SubHeading>
              {backupFields}
              {maintenanceField}
              <SubHeading>Access</SubHeading>
              {accessFields}
              {!tagsRequired && tagsField}
            </Advanced>
          </>
        )}
      </CreateLayout>
      {engines.length === 0 && <span className="sr-only">Loading engines…</span>}
    </Page>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="border-t border-line pt-4 text-[12px] font-semibold uppercase tracking-wide text-muted">{children}</h3>;
}

/** Visual of the chosen topology: primary ⇄ standby (sync) → replicas (async). */
function HaPreview({ engine, ha, replicas }: { engine: DbEngine; ha: boolean; replicas: number }) {
  const m = ENGINE_META[engine];
  const W = 560, H = 150;
  const primary = { x: 30, y: 45 };
  const standby = { x: 230, y: 45 };
  const rx = 430;
  const reps = Array.from({ length: replicas }, (_, i) => ({ x: rx, y: replicas === 1 ? 52 : 12 + (i * (H - 40)) / Math.max(1, replicas - 1) }));
  const node = (x: number, y: number, title: string, sub: string, color: string, dashed = false, w = 120, h = 52) => (
    <g transform={`translate(${x},${y})`}>
      <rect width={w} height={h} rx={10} fill="var(--surface)" stroke={color} strokeWidth={1.5} strokeDasharray={dashed ? '4 3' : undefined} />
      <rect width={4} height={h - 16} x={8} y={8} rx={2} fill={color} />
      <text x={20} y={22} fontSize={12} fontWeight={600} fill="var(--fg)">{title}</text>
      <text x={20} y={38} fontSize={10} fill="var(--muted)">{sub}</text>
    </g>
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface-2/40 p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full min-w-[420px]">
        {ha && <path d={`M${primary.x + 120},${primary.y + 26} L${standby.x},${standby.y + 26}`} stroke="#10b981" strokeWidth={2} fill="none" strokeDasharray="6 4" className="animate-flow" />}
        {ha && <text x={(primary.x + 120 + standby.x) / 2} y={primary.y + 18} textAnchor="middle" fontSize={10} fill="#10b981">sync</text>}
        {reps.map((r, i) => {
          const from = ha ? standby : primary;
          const sx = from.x + 120, sy = from.y + 26;
          return <path key={i} d={`M${sx},${sy} C${sx + 50},${sy} ${r.x - 50},${r.y + 13} ${r.x},${r.y + 13}`} stroke="#0ea5e9" strokeWidth={1.5} fill="none" strokeDasharray="3 4" className="animate-flow" />;
        })}
        {node(primary.x, primary.y, 'Primary', 'read / write', m.color)}
        {ha ? node(standby.x, standby.y, 'Standby', 'auto-failover', '#10b981') : node(standby.x, standby.y, 'No standby', 'enable HA', 'var(--line-strong)', true)}
        {reps.map((r, i) => (
          <g key={i} transform={`translate(${r.x},${r.y})`}>
            <rect width={120} height={26} rx={8} fill="var(--surface)" stroke="#0ea5e9" strokeWidth={1.2} />
            <circle cx={12} cy={13} r={4} fill="#0ea5e9" />
            <text x={22} y={17} fontSize={10.5} fill="var(--fg)">replica-{i + 1} · read-only</text>
          </g>
        ))}
        {replicas === 0 && <text x={rx + 60} y={78} textAnchor="middle" fontSize={10.5} fill="var(--faint)">no read replicas</text>}
      </svg>
    </div>
  );
}
