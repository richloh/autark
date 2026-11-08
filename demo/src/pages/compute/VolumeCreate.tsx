import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { HardDrive, Rocket, FileCode2, Camera, Lock, Link2, Zap, Sparkles } from 'lucide-react';
import { useList, useApiMutation } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Switch, OptionCards, Slider, NumberInput, TagEditor, Hint } from '@/components/ui/form';
import { FormSection, CreateLayout, fieldErrors } from '@/components/ui/FormLayout';
import { Segmented } from '@/components/ui/Tabs';
import { IacTabs, toCli, toHcl, toCurl } from '@/components/ui/CodeBlock';
import { CostPanel } from '@/components/resource/CostPanel';
import { ProjectField, LocationCards } from '@/components/resource/pickers';
import { PerformanceVisual } from '@/components/compute/volume/PerformanceVisual';
import { TYPE_COLOR } from '@/components/compute/volume/volumeUi';
import { volumeCost, PRICING, breakdown } from '@/lib/pricing';
import { money, gb, timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { toast } from '@/components/ui/toast';
import { Advanced } from '@/components/ui/Pro';
import { useUi, usePro } from '@/store/ui';
import { VOLUME_LIMITS, maxIopsFor, type VolumeType, type VolumePreset, type Snapshot, type VM, type ProjectAllowance, type Volume, type Project } from '@/types';

const TYPES: VolumeType[] = ['ssd', 'nvme', 'hdd'];
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export default function VolumeCreate() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const { items: presets } = useList<VolumePreset>('volumePresets');
  const { items: snapshots } = useList<Snapshot>('snapshots');
  const { items: vms } = useList<VM>('vms');
  const { items: volumes } = useList<Volume>('volumes');
  const { items: allowances } = useList<ProjectAllowance>('allowances');
  const { items: allProjects } = useList<Project>('projects');
  const accountId = useUi((s) => s.accountId);
  const scopedProject = useUi((s) => s.projectId);
  const pro = usePro();

  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<{ key: string; value: string }[]>([{ key: 'env', value: 'prod' }]);
  const [locationId, setLocationId] = useState('dc1');
  const [source, setSource] = useState<'empty' | 'snapshot'>('empty');
  const [snapshotId, setSnapshotId] = useState('');
  const [presetId, setPresetId] = useState('');
  const [type, setType] = useState<VolumeType>('ssd');
  const [sizeGB, setSizeGB] = useState(100);
  const [iops, setIops] = useState(3000);
  const [tp, setTp] = useState(125);
  const [encrypted, setEncrypted] = useState(true);
  const [filesystem, setFilesystem] = useState<'ext4' | 'xfs' | 'none'>('ext4');
  const [backup, setBackup] = useState({ enabled: false, schedule: 'daily' as 'hourly' | 'daily' | 'weekly', retention: 7 });
  const [attachVmId, setAttachVmId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // implicit project (ProjectField may sit collapsed inside <Advanced>); declared before the deep-link effect so it wins
  const accountProjects = allProjects.filter((p) => p.accountId === accountId);
  useEffect(() => { if (!projectId && accountProjects.length) setProjectId(scopedProject || accountProjects[0].id) }, [projectId, accountProjects.length, scopedProject]); // eslint-disable-line
  const projectImplicit = !!scopedProject || accountProjects.length <= 1;

  const l = VOLUME_LIMITS[type];
  const maxIops = maxIopsFor(type, sizeGB);
  const allowance = allowances.find((a) => a.projectId === projectId);
  const snap = snapshots.find((s) => s.id === snapshotId);
  const minGB = Math.max(l.minGB, source === 'snapshot' && snap ? snap.sourceSizeGB ?? Math.ceil(snap.sizeGB) : 0);

  // preselect from query (?vm=, ?snapshot=) once data has loaded
  const applied = useRef({ vm: false, snap: false });
  useEffect(() => {
    const vmId = sp.get('vm');
    if (vmId && !applied.current.vm) {
      const vm = vms.find((v) => v.id === vmId);
      if (vm) { applied.current.vm = true; setProjectId(vm.projectId); setLocationId(vm.locationId); setAttachVmId(vm.id); if (!name) setName(`${vm.name}-data`) }
    }
    const sId = sp.get('snapshot');
    if (sId && !applied.current.snap) {
      const s = snapshots.find((x) => x.id === sId);
      if (s) {
        applied.current.snap = true;
        setSource('snapshot'); setSnapshotId(s.id); setLocationId(s.locationId); setProjectId(s.projectId);
        const t = s.volumeType ?? 'ssd'; setType(t); setSizeGB(Math.max(VOLUME_LIMITS[t].minGB, s.sourceSizeGB ?? Math.ceil(s.sizeGB))); setIops(VOLUME_LIMITS[t].minIops); setTp(VOLUME_LIMITS[t].minTp);
        if (!name) setName(`${s.sourceName}-restore`.slice(0, 63));
      }
    }
  }, [vms.length, snapshots.length]); // eslint-disable-line

  // keep perf inside the envelope when type / size change
  useEffect(() => { setIops((v) => clamp(v, l.minIops, maxIops)); setTp((v) => clamp(v, l.minTp, l.maxTp)) }, [type, sizeGB]); // eslint-disable-line
  useEffect(() => { if (sizeGB < minGB) setSizeGB(minGB) }, [minGB]); // eslint-disable-line
  useEffect(() => { if (attachVmId && !vms.some((v) => v.id === attachVmId && v.projectId === projectId && v.locationId === locationId)) setAttachVmId('') }, [projectId, locationId]); // eslint-disable-line
  useEffect(() => { if (snap && snap.locationId !== locationId) setSnapshotId('') }, [locationId]); // eslint-disable-line

  const pickType = (t: VolumeType) => {
    setType(t); setPresetId('');
    const nl = VOLUME_LIMITS[t];
    setSizeGB((s) => clamp(s, Math.max(nl.minGB, minGB), nl.maxGB));
    setIops(nl.minIops); setTp(nl.minTp);
    setFilesystem((f) => (f === 'none' ? f : t === 'hdd' ? 'xfs' : 'ext4'));
  };
  const pickPreset = (p: VolumePreset) => {
    setPresetId(p.id); setType(p.type); setSizeGB(Math.max(p.sizeGB, minGB)); setIops(p.iops); setTp(p.throughputMBps);
  };

  const sourceSnaps = snapshots.filter((s) => s.status === 'available' && s.locationId === locationId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const attachable = vms.filter((v) => v.projectId === projectId && v.locationId === locationId && !['deleting', 'error'].includes(v.status));
  const attachVm = vms.find((v) => v.id === attachVmId);
  const usedQuota = volumes.filter((v) => v.projectId === projectId).reduce((a, v) => a + v.sizeGB, 0);
  const quota = allowance?.quotas.volumesGB;

  const cost = useMemo(() => {
    const base = volumeCost({ type, sizeGB, iops, throughputMBps: tp });
    const lines = [...base.lines];
    if (backup.enabled) lines.push({ label: `Backups (~${backup.retention} incremental copies)`, amount: Math.round(sizeGB * 0.25 * PRICING.snapshotGBPerMonth * Math.min(backup.retention, 10) * 100) / 100, hint: `${money(PRICING.snapshotGBPerMonth)}/GB-month, estimate` });
    return breakdown(lines);
  }, [type, sizeGB, iops, tp, backup]);

  const body = {
    name, projectId, locationId, type, sizeGB, iops, throughputMBps: tp, encrypted, filesystem,
    ...(source === 'snapshot' && snapshotId ? { sourceSnapshotId: snapshotId } : {}),
    ...(attachVmId ? { attachToVmId: attachVmId } : {}),
    backupPolicy: backup, description: description || undefined, tags,
  };

  const create = useApiMutation(() => { setErrors({}); setFormError(null); return api.create<{ id: string }>('volumes', body) }, {
    silent: true,
    onSuccess: (v) => { toast.success(`Creating ${name}`, attachVm ? `Will be attached to ${attachVm.name} when ready.` : 'Follow progress on the detail page.'); navigate(`/infrastructure/volumes/${v.id}`) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); setFormError(e.message); window.scrollTo({ top: 0, behavior: 'smooth' }) },
  });

  const nameErr = name && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name) ? 'Lowercase letters, digits and dashes' : undefined;
  const canSubmit = !!name && !nameErr && !!projectId && (source === 'empty' || !!snapshotId);
  const sizeMarks = [...new Set([minGB, Math.max(minGB, 500), Math.max(minGB, 2000), Math.min(l.maxGB, 8000)])].filter((m) => m <= l.maxGB);

  const requiredTags = allowance?.requiredTags ?? [];

  /* ------------------------------------------------------------ building blocks (shared by both modes) */

  const nameField = (
    <Field label="Name" required error={nameErr ?? errors.name} hint="e.g. pg-data, uploads">
      <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="app-data" invalid={!!(nameErr ?? errors.name)} autoFocus={pro} />
    </Field>
  );
  const projectField = <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />;
  const descriptionField = <Field label="Description" optional><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What lives on this disk?" /></Field>;
  const tagsField = (
    <Field label="Tags" error={errors.tags} hint={requiredTags.length ? `This project requires: ${requiredTags.join(', ')}` : undefined}>
      <TagEditor value={tags} onChange={setTags} required={allowance?.requiredTags} />
    </Field>
  );
  const locationCards = (
    <>
      <LocationCards value={locationId} onChange={setLocationId} filter={(x) => !allowance || allowance.allowedLocations.includes(x.id) || x.id === locationId} />
      {errors.locationId && <p className="text-xs text-rose-500">{errors.locationId}</p>}
    </>
  );
  const sourcePicker = (
    <>
      <Segmented value={source} onChange={setSource} options={[{ value: 'empty', label: 'Empty volume', icon: <HardDrive className="size-3.5" /> }, { value: 'snapshot', label: 'From snapshot', icon: <Camera className="size-3.5" /> }]} />
      {source === 'snapshot' && (
        sourceSnaps.length === 0 ? <Hint tone="warning">No available snapshots in {locationId}. Snapshots can only be restored in the location they are stored in.</Hint> : (
          <Field label="Snapshot" required error={errors.sourceSnapshotId}>
            <Select value={snapshotId} onChange={(e) => {
              const s = snapshots.find((x) => x.id === e.target.value);
              setSnapshotId(e.target.value);
              if (s?.volumeType && s.volumeType !== type) pickType(s.volumeType);
              if (s) { const need = s.sourceSizeGB ?? Math.ceil(s.sizeGB); setSizeGB((v) => Math.max(v, need)); if (!name) setName(`${s.sourceName}-restore`.slice(0, 63)) }
            }} placeholder="Choose a snapshot…" options={sourceSnaps.map((s) => ({ value: s.id, label: `${s.name} · ${s.kind === 'vm' ? 'VM disk' : 'volume'} ${s.sourceName} · ${gb(s.sizeGB)} · ${timeAgo(s.createdAt)}` }))} />
          </Field>
        )
      )}
      {snap?.kind === 'vm' && source === 'snapshot' && <Hint>This is a VM system-disk snapshot — handy for mounting on another VM to recover files.</Hint>}
    </>
  );
  const presetChips = presets.length > 0 && (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted"><Sparkles className="size-3.5" />Quick start from a preset</div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button key={p.id} type="button" onClick={() => pickPreset(p)} title={p.description}
            className={cn('inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors', presetId === p.id ? 'border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-300' : 'border-line text-fg-2 hover:bg-surface-2')}>
            <span className="size-1.5 rounded-full" style={{ background: TYPE_COLOR[p.type] }} />{p.name}<span className="text-faint">{gb(p.sizeGB)}</span>
          </button>
        ))}
      </div>
    </div>
  );
  const SIMPLE_TYPE_DESC: Record<VolumeType, string> = { ssd: 'Fast, good default', nvme: 'Fastest, for databases', hdd: 'Cheapest, for backups & archives' };
  const typeCards = (
    <>
      <OptionCards cols={3} value={type} onChange={pickType} options={TYPES.map((t) => {
        const v = VOLUME_LIMITS[t];
        return {
          value: t, title: v.label, description: pro ? v.description : SIMPLE_TYPE_DESC[t],
          icon: <span className="flex size-6 items-center justify-center rounded-md" style={{ background: `${TYPE_COLOR[t]}1a`, color: TYPE_COLOR[t] }}><HardDrive className="size-3.5" /></span>,
          meta: (
            <div className="flex items-center justify-between text-[11px] text-muted">
              {pro ? <span>up to {v.maxIops.toLocaleString()} IOPS · {v.latencyMs < 1 ? `${v.latencyMs * 1000}µs` : `${v.latencyMs}ms`}</span> : <span />}
              <span className="font-medium tabular text-fg">{money(PRICING.volume[t])}/GB</span>
            </div>
          ),
        };
      })} />
      {errors.type && <p className="text-xs text-rose-500">{errors.type}</p>}
    </>
  );
  const sizeFields = (
    <>
      <Field label={`Size · ${gb(sizeGB)}`} error={errors.sizeGB ?? errors.volumesGB} hint={minGB > l.minGB ? `At least ${minGB} GB to fit the snapshot` : `${l.label}: ${l.minGB}–${l.maxGB.toLocaleString()} GB`}>
        <Slider value={sizeGB} onChange={(n) => { setSizeGB(Math.max(minGB, n)); setPresetId('') }} min={l.minGB} max={Math.min(l.maxGB, 8000)} step={10} marks={sizeMarks} format={(n) => gb(n)} />
      </Field>
      <div className="flex items-center gap-2"><NumberInput value={sizeGB} onChange={(n) => { setSizeGB(n); setPresetId('') }} min={minGB} max={l.maxGB} step={10} unit="GB" className="w-44" /><span className="text-xs text-muted">or type an exact size</span></div>
    </>
  );
  const performance = (
    <div className="grid gap-5 @min-[44rem]:grid-cols-[1fr_300px]">
      <div className="space-y-5">
        <Field label={<span className="flex items-center gap-1.5"><Zap className="size-3.5" />IOPS · {iops.toLocaleString()}</span>} error={errors.iops} hint={maxIops < l.maxIops ? `Max scales with size (${l.iopsPerGB} IOPS/GB). Grow to ${Math.ceil(l.maxIops / l.iopsPerGB).toLocaleString()} GB for ${l.maxIops.toLocaleString()} IOPS.` : `Type maximum reached`}>
          <Slider value={iops} onChange={(n) => { setIops(n); setPresetId('') }} min={l.minIops} max={Math.max(l.minIops + 100, maxIops)} step={100} marks={[l.minIops, maxIops]} format={(n) => n.toLocaleString()} />
        </Field>
        <Field label={`Throughput · ${tp} MB/s`} error={errors.throughputMBps}>
          <Slider value={tp} onChange={(n) => { setTp(n); setPresetId('') }} min={l.minTp} max={l.maxTp} step={5} marks={[l.minTp, Math.round((l.minTp + l.maxTp) / 2), l.maxTp]} />
        </Field>
      </div>
      <PerformanceVisual type={type} sizeGB={sizeGB} iops={iops} throughputMBps={tp} />
    </div>
  );
  const encryptionFs = (
    <>
      <Switch checked={encrypted} onChange={setEncrypted} label={<span className="flex items-center gap-1.5"><Lock className="size-3.5" />Encrypt at rest (LUKS2)</span>} description="Keys are held by the Autark KMS; deleting the volume crypto-shreds the key. No performance penalty on AES-NI hosts." />
      {!encrypted && <Hint tone="warning">Unencrypted volumes may violate your organisation's data policy. Encryption cannot be enabled later (clone into an encrypted volume instead).</Hint>}
      <Field label="Filesystem" hint={source === 'snapshot' ? 'Taken from the snapshot.' : 'Formatted on creation. Choose "raw" to partition yourself or for databases using raw devices.'}>
        <Segmented value={source === 'snapshot' ? 'ext4' : filesystem} onChange={(v) => source !== 'snapshot' && setFilesystem(v)} options={[{ value: 'ext4', label: 'ext4' }, { value: 'xfs', label: 'XFS' }, { value: 'none', label: 'Raw (unformatted)' }]} />
      </Field>
    </>
  );
  const backups = (
    <>
      <Switch checked={backup.enabled} onChange={(v) => setBackup({ ...backup, enabled: v })} label="Scheduled snapshots" description="Crash-consistent snapshots on a schedule; oldest copies are pruned automatically." />
      {backup.enabled && (
        <div className="grid gap-4 @min-[36rem]:grid-cols-2">
          <Field label="Schedule"><Segmented value={backup.schedule} onChange={(v) => setBackup({ ...backup, schedule: v })} options={[{ value: 'hourly', label: 'Hourly' }, { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }]} /></Field>
          <Field label="Retention (copies)" error={errors.backupPolicy}><NumberInput value={backup.retention} onChange={(v) => setBackup({ ...backup, retention: v })} min={1} max={90} /></Field>
        </div>
      )}
    </>
  );
  const attach = (
    <>
      {!projectId ? null : attachable.length === 0 ? <p className="text-sm text-muted">No VMs in this project in {locationId}.</p> : (
        <Field label="VM" optional error={errors.attachToVmId}>
          <Select value={attachVmId} onChange={(e) => setAttachVmId(e.target.value)} options={[{ value: '', label: 'Do not attach (create as available)' }, ...attachable.map((v) => ({ value: v.id, label: pro ? `${v.name} · ${v.status} · ${v.volumeIds.length} volume(s)` : v.name }))]} />
        </Field>
      )}
      {pro && attachVm && <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted"><Link2 className="size-3.5" />Will appear in {attachVm.name} as <code className="font-mono text-fg">/dev/vd{String.fromCharCode(98 + attachVm.volumeIds.length)}</code>{filesystem !== 'none' && <> — mount with <code className="font-mono text-fg">mount /dev/vd{String.fromCharCode(98 + attachVm.volumeIds.length)} /mnt/{name || 'data'}</code></>}</div>}
    </>
  );
  const advancedSummary = [
    source === 'snapshot' ? `from ${snap?.name ?? 'snapshot'}` : 'empty',
    `${iops.toLocaleString()} IOPS`,
    encrypted ? 'encrypted' : 'unencrypted',
    filesystem === 'none' ? 'raw' : filesystem,
    backup.enabled ? `${backup.schedule} snapshots` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Page wide>
      <PageHeader
        title="Create volume"
        description={pro ? 'Block storage replicated 3× across hosts in the location. Grows online; snapshots are stored off-host.' : undefined}
        icon={HardDrive}
        iconColor="#0ea5e9"
        crumbs={[{ label: 'Volumes', to: '/infrastructure/volumes' }, { label: 'Create' }]}
      />
      {formError && <Hint tone="danger" className="mb-5">{formError}</Hint>}

      <CreateLayout needsProject="volume" aside={<>
        <CostPanel cost={cost} projectId={projectId} footer={
          <div className="space-y-2">
            <Button variant="primary" size="lg" className="w-full" icon={Rocket} loading={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()}>Create volume</Button>
            {!canSubmit && <p className="text-center text-[11px] text-muted">{!name ? 'Enter a name to continue' : nameErr ? 'Fix the name' : 'Choose a source snapshot'}</p>}
          </div>
        }>
          <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs text-muted">
            <div className="flex justify-between"><span>Volume</span><span className="text-fg-2">{gb(sizeGB)} {l.label}</span></div>
            {pro && <div className="flex justify-between"><span>Performance</span><span className="text-fg-2">{iops.toLocaleString()} IOPS · {tp} MB/s</span></div>}
            <div className="flex justify-between"><span>Source</span><span className="truncate pl-2 text-fg-2">{source === 'snapshot' ? snap?.name ?? '—' : 'empty'}</span></div>
            <div className="flex justify-between"><span>Attach</span><span className="text-fg-2">{attachVm?.name ?? 'not attached'}</span></div>
            {quota != null && (
              <div className="pt-1">
                <div className="mb-1 flex justify-between"><span>Project volume quota</span><span className={cn('tabular', usedQuota + sizeGB > quota ? 'text-rose-500' : 'text-fg-2')}>{gb(usedQuota + sizeGB)} / {gb(quota)}</span></div>
                <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <div className="absolute inset-y-0 left-0 bg-brand-500/40" style={{ width: `${Math.min(100, (usedQuota / quota) * 100)}%` }} />
                  <div className={cn('absolute inset-y-0', usedQuota + sizeGB > quota ? 'bg-rose-500' : 'bg-brand-500')} style={{ left: `${Math.min(100, (usedQuota / quota) * 100)}%`, width: `${Math.max(0, Math.min(100, ((usedQuota + sizeGB) / quota) * 100) - Math.min(100, (usedQuota / quota) * 100))}%` }} />
                </div>
              </div>
            )}
          </div>
        </CostPanel>
        {pro && (
          <details className="group rounded-xl border border-line bg-surface p-4 shadow-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-fg"><FileCode2 className="size-4 text-muted" /> Infrastructure as code<span className="ml-auto text-xs text-muted group-open:hidden">show</span></summary>
            <IacTabs className="mt-3" snippets={{ terraform: toHcl('volume', name || 'my_volume', body), cli: toCli('volume create', body), curl: toCurl('POST', '/volumes', body) }} />
          </details>
        )}
      </>}>
        {pro ? (
          <>
            <FormSection step={1} title="Basics" description="Name, project and tags. Names are unique per project.">
              <div className="grid gap-4 @min-[36rem]:grid-cols-2">{nameField}{projectField}</div>
              {descriptionField}
              {tagsField}
            </FormSection>
            <FormSection step={2} title="Location" description="Volumes can only attach to VMs in the same location." aside={allowance && <span className="text-xs text-muted">Allowed: {allowance.allowedLocations.join(', ')}</span>}>{locationCards}</FormSection>
            <FormSection step={3} title="Source" description="Start empty or hydrate from a snapshot (data is lazily loaded — usable immediately).">{sourcePicker}</FormSection>
            <FormSection step={4} title="Type & size" description="Choose the media, then dial in capacity.">{presetChips}{typeCards}{sizeFields}</FormSection>
            <FormSection step={5} title="Performance" description={`${l.minIops.toLocaleString()} IOPS and ${l.minTp} MB/s are included. Provision more for demanding workloads — changeable later without downtime.`}>{performance}</FormSection>
            <FormSection step={6} title="Encryption & filesystem">{encryptionFs}</FormSection>
            <FormSection step={7} title="Backups">{backups}</FormSection>
            <FormSection step={8} title="Attach to a VM" description="Optional. The volume is hot-plugged once it is ready.">{attach}</FormSection>
          </>
        ) : (
          <>
            <FormSection step={1} title="Location" description="Volumes attach to servers in the same location.">{locationCards}</FormSection>
            <FormSection step={2} title="Type & size">{typeCards}{sizeFields}</FormSection>
            <FormSection step={3} title="Name">
              <div className={projectImplicit ? '' : 'grid gap-4 @min-[36rem]:grid-cols-2'}>{nameField}{!projectImplicit && projectField}</div>
              {requiredTags.length > 0 && tagsField}
            </FormSection>
            <FormSection step={4} title="Attach to a server" description="Optional. You can also do this later.">{attach}</FormSection>
            <Advanced description={advancedSummary} defaultOpen={sp.get('snapshot') ? true : undefined}>
              {projectImplicit && projectField}
              {descriptionField}
              {requiredTags.length === 0 && tagsField}
              <AdvancedGroup title="Source">{sourcePicker}</AdvancedGroup>
              {presetChips && <AdvancedGroup title="Presets">{presetChips}</AdvancedGroup>}
              <AdvancedGroup title="Performance">{performance}</AdvancedGroup>
              <AdvancedGroup title="Encryption & filesystem">{encryptionFs}</AdvancedGroup>
              <AdvancedGroup title="Backups">{backups}</AdvancedGroup>
            </Advanced>
          </>
        )}
      </CreateLayout>
    </Page>
  );
}

function AdvancedGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-4 border-t border-line pt-4">
      <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
      {children}
    </div>
  );
}
