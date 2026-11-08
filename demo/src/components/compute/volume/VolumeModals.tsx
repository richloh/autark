import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Link2, Maximize2, Gauge, Copy, Camera, ArrowRight } from 'lucide-react';
import { api, ApiClientError } from '@/api/client';
import { useApiMutation, useList } from '@/api/hooks';
import { Modal, confirm } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Slider, NumberInput, Textarea, Hint, OptionCards } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { StatusPill } from '@/components/ui/Badge';
import { toast } from '@/components/ui/toast';
import { OsBadge } from '@/lib/images';
import { money, gb } from '@/lib/format';
import { volumeCost } from '@/lib/pricing';
import { cn } from '@/lib/cn';
import { VOLUME_LIMITS, maxIopsFor, type Volume, type VM, type Image } from '@/types';
import { PerformanceVisual } from './PerformanceVisual';

const costOf = (v: Pick<Volume, 'type' | 'sizeGB' | 'iops' | 'throughputMBps'>) => volumeCost({ type: v.type, sizeGB: v.sizeGB, iops: v.iops, throughputMBps: v.throughputMBps }).total;

function CostDiff({ before, after }: { before: number; after: number }) {
  const d = after - before;
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
      <span className="text-muted">Monthly cost</span>
      <span className="flex items-center gap-2 tabular">
        <span className="text-muted">{money(before)}</span><ArrowRight className="size-3.5 text-faint" /><span className="font-semibold text-fg">{money(after)}</span>
        {Math.abs(d) >= 0.01 && <span className={cn('text-xs font-medium', d > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>{d > 0 ? '+' : '−'}{money(Math.abs(d))}</span>}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ imperative actions */

export async function detachVolumeAction(v: Volume, vmName?: string): Promise<boolean> {
  const res = await confirm({
    title: `Detach ${v.name}?`,
    message: `The volume will be unmounted from ${vmName ?? 'the VM'} (${v.attachedTo?.device}). Make sure no process is writing to it.`,
    confirmLabel: 'Detach',
    options: [{ id: 'force', label: 'Force detach', description: 'Skip graceful unmount in the guest (may lose unflushed writes).' }],
  });
  if (!res) return false;
  try { await api.action('volumes', v.id, 'detach', { force: !!res.force }); toast.success(`Detaching ${v.name}`); return true }
  catch (e) { toast.error('Detach failed', (e as Error).message); return false }
}

export async function deleteVolumeAction(v: Volume): Promise<boolean> {
  if (v.attachedTo) { toast.error(`Cannot delete ${v.name}`, 'Volume is attached to a VM. Detach it first.'); return false }
  const res = await confirm({
    title: `Delete volume ${v.name}?`,
    message: `${gb(v.sizeGB)} of data will be destroyed${v.encrypted ? ' (encryption key is crypto-shredded)' : ''}. This cannot be undone.`,
    confirmLabel: 'Delete volume', danger: true, typeToConfirm: v.name,
    options: (v.snapshotCount ?? 0) > 0 ? [{ id: 'deleteSnapshots', label: `Also delete ${v.snapshotCount} snapshot(s)`, description: 'Otherwise snapshots are kept and can restore into a new volume.' }] : undefined,
  });
  if (!res) return false;
  try { await api.remove('volumes', v.id, { deleteSnapshots: String(!!res.deleteSnapshots) }); toast.success(`Deleting ${v.name}`); return true }
  catch (e) { toast.error('Delete failed', (e as Error).message); return false }
}

/* ------------------------------------------------------------------ modals */

export function AttachVolumeModal({ volume: v, open, onClose }: { volume: Volume; open: boolean; onClose: () => void }) {
  const { items: vms } = useList<VM>('vms', { projectId: v.projectId }, { enabled: open });
  const { items: images } = useList<Image>('images', undefined, { enabled: open });
  const candidates = vms.filter((vm) => vm.locationId === v.locationId && !['deleting', 'provisioning', 'error'].includes(vm.status));
  const [vmId, setVmId] = useState('');
  useEffect(() => { if (open) setVmId(candidates[0]?.id ?? '') }, [open, candidates.length]); // eslint-disable-line
  const m = useApiMutation(() => api.action<{ device: string }>('volumes', v.id, 'attach', { vmId }), {
    success: (r) => `Attaching ${v.name} as ${r.device}`, onSuccess: onClose,
  });
  return (
    <Modal open={open} onClose={onClose} title={`Attach ${v.name}`} description={`VMs in the same project and location (${v.locationId}). Running VMs get the disk hot-plugged.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Link2} disabled={!vmId} loading={m.isPending} onClick={() => m.mutate()}>Attach</Button></>}>
      {candidates.length === 0 ? <Hint tone="warning">No eligible VM in {v.locationId} for this project.</Hint> : (
        <OptionCards cols={2} value={vmId} onChange={setVmId} options={candidates.map((vm) => ({
          value: vm.id, title: vm.name, icon: <OsBadge os={images.find((i) => i.id === vm.imageId)?.os ?? 'custom'} size={22} />,
          description: `${vm.size.vcpus} vCPU · ${vm.size.ramGB} GB · ${vm.volumeIds.length} volume${vm.volumeIds.length === 1 ? '' : 's'}`,
          badge: <StatusPill status={vm.status} />,
        }))} />
      )}
    </Modal>
  );
}

export function ResizeVolumeModal({ volume: v, open, onClose }: { volume: Volume; open: boolean; onClose: () => void }) {
  const l = VOLUME_LIMITS[v.type];
  const [size, setSize] = useState(v.sizeGB);
  const [err, setErr] = useState<string>();
  useEffect(() => { if (open) { setSize(Math.min(l.maxGB, Math.ceil((v.sizeGB * 1.5) / 10) * 10)); setErr(undefined) } }, [open, v.sizeGB]); // eslint-disable-line
  const m = useApiMutation(() => api.action('volumes', v.id, 'resize', { sizeGB: size }), {
    success: `Resizing ${v.name} to ${size} GB`, onSuccess: onClose, onError: (e: ApiClientError) => setErr(fieldErrors(e).sizeGB ?? fieldErrors(e).volumesGB ?? e.message),
  });
  const max = l.maxGB;
  return (
    <Modal open={open} onClose={onClose} title={`Resize ${v.name}`} description="Volumes can only grow. Attached volumes are resized online — the filesystem is grown without downtime."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Maximize2} disabled={size <= v.sizeGB} loading={m.isPending} onClick={() => m.mutate()}>Resize to {gb(size)}</Button></>}>
      <div className="space-y-4">
        <Field label={`New size · ${gb(size)}`} error={err}>
          <Slider value={size} onChange={(n) => setSize(Math.max(v.sizeGB + 1, n))} min={v.sizeGB} max={Math.min(max, Math.max(v.sizeGB * 8, v.sizeGB + 1000))} step={10} marks={[v.sizeGB, Math.min(max, v.sizeGB * 2), Math.min(max, v.sizeGB * 4)]} format={(n) => gb(n)} />
        </Field>
        <div className="flex items-center gap-2">
          <NumberInput value={size} onChange={setSize} min={v.sizeGB + 1} max={max} step={10} unit="GB" className="w-44" />
          <span className="text-xs text-muted">max {gb(max)} for {l.label}</span>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted"><span>Used {gb(v.usedGB)}</span><span>{Math.round((v.usedGB / size) * 100)}% after resize</span></div>
          <div className="relative h-3 overflow-hidden rounded-full bg-surface-3">
            <div className="absolute inset-y-0 left-0 bg-brand-500/25" style={{ width: `${(v.sizeGB / size) * 100}%` }} />
            <div className="absolute inset-y-0 left-0 bg-brand-500" style={{ width: `${(v.usedGB / size) * 100}%` }} />
          </div>
          <div className="mt-1 flex gap-3 text-[11px] text-muted"><span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-brand-500" />used</span><span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-brand-500/25" />current size</span><span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-surface-3 ring-1 ring-line" />added</span></div>
        </div>
        <CostDiff before={costOf(v)} after={costOf({ ...v, sizeGB: size })} />
      </div>
    </Modal>
  );
}

export function PerformanceModal({ volume: v, open, onClose }: { volume: Volume; open: boolean; onClose: () => void }) {
  const l = VOLUME_LIMITS[v.type];
  const maxI = maxIopsFor(v.type, v.sizeGB);
  const [iops, setIops] = useState(v.iops);
  const [tp, setTp] = useState(v.throughputMBps);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setIops(v.iops); setTp(v.throughputMBps); setErrors({}) } }, [open, v.iops, v.throughputMBps]);
  const m = useApiMutation(() => api.action('volumes', v.id, 'setPerformance', { iops, throughputMBps: tp }), {
    success: `Updating ${v.name} performance`, onSuccess: onClose, onError: (e: ApiClientError) => setErrors(fieldErrors(e)),
  });
  return (
    <Modal open={open} onClose={onClose} size="lg" title={`Performance of ${v.name}`} description={`Provisioned limits are applied as QoS on the fly — no detach needed. ${l.minIops.toLocaleString()} IOPS and ${l.minTp} MB/s are included.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Gauge} disabled={iops === v.iops && tp === v.throughputMBps} loading={m.isPending} onClick={() => m.mutate()}>Apply</Button></>}>
      <div className="grid gap-5 @min-[40rem]:grid-cols-2">
        <div className="space-y-5">
          <Field label={`IOPS · ${iops.toLocaleString()}`} error={errors.iops} hint={maxI < l.maxIops ? `Grow the volume to unlock up to ${l.maxIops.toLocaleString()} IOPS (${l.iopsPerGB}/GB).` : undefined}>
            <Slider value={iops} onChange={setIops} min={l.minIops} max={maxI} step={100} marks={[l.minIops, maxI]} format={(n) => n.toLocaleString()} />
          </Field>
          <Field label={`Throughput · ${tp} MB/s`} error={errors.throughputMBps}>
            <Slider value={tp} onChange={setTp} min={l.minTp} max={l.maxTp} step={5} marks={[l.minTp, l.maxTp]} />
          </Field>
          <CostDiff before={costOf(v)} after={costOf({ ...v, iops, throughputMBps: tp })} />
        </div>
        <PerformanceVisual type={v.type} sizeGB={v.sizeGB} iops={iops} throughputMBps={tp} />
      </div>
    </Modal>
  );
}

export function CloneVolumeModal({ volume: v, open, onClose }: { volume: Volume; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { items: vms } = useList<VM>('vms', { projectId: v.projectId }, { enabled: open });
  const [name, setName] = useState('');
  const [sizeGB, setSizeGB] = useState(v.sizeGB);
  const [attach, setAttach] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setName(`${v.name}-clone`.slice(0, 63)); setSizeGB(v.sizeGB); setAttach(''); setErrors({}) } }, [open, v.name, v.sizeGB]);
  const m = useApiMutation(() => api.action<{ id: string }>('volumes', v.id, 'clone', { name, sizeGB, attachToVmId: attach || undefined }), {
    success: `Cloning ${v.name} → ${name}`, onSuccess: (r) => { onClose(); navigate(`/infrastructure/volumes/${r.id}`) }, onError: (e: ApiClientError) => setErrors(fieldErrors(e)),
  });
  const candidates = vms.filter((vm) => vm.locationId === v.locationId && !['deleting', 'error'].includes(vm.status));
  return (
    <Modal open={open} onClose={onClose} title={`Clone ${v.name}`} description="Copy-on-write clone of the current data. The clone is independent and billed separately."
      footer={<><span className="mr-auto text-xs text-muted">{money(costOf({ ...v, sizeGB }))}/mo</span><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Copy} loading={m.isPending} onClick={() => m.mutate()}>Clone</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} invalid={!!errors.name} /></Field>
        <Field label="Size" error={errors.sizeGB ?? errors.volumesGB} hint={`At least ${v.sizeGB} GB`}><NumberInput value={sizeGB} onChange={setSizeGB} min={v.sizeGB} max={VOLUME_LIMITS[v.type].maxGB} step={10} unit="GB" /></Field>
        <Field label="Attach clone to" optional error={errors.attachToVmId}>
          <Select value={attach} onChange={(e) => setAttach(e.target.value)} options={[{ value: '', label: 'Do not attach' }, ...candidates.map((vm) => ({ value: vm.id, label: `${vm.name} (${vm.status})` }))]} />
        </Field>
      </div>
    </Modal>
  );
}

export function SnapshotVolumeModal({ volume: v, open, onClose }: { volume: Volume; open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setName(`${v.name}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`.slice(0, 63)); setDescription(''); setErrors({}) } }, [open, v.name]);
  const m = useApiMutation(() => api.action('volumes', v.id, 'snapshot', { name, description: description || undefined }), {
    success: `Snapshot of ${v.name} started`, onSuccess: onClose, onError: (e: ApiClientError) => setErrors(fieldErrors(e)),
  });
  return (
    <Modal open={open} onClose={onClose} size="sm" title={`Snapshot ${v.name}`} description={`Point-in-time copy of ${gb(v.usedGB)} used data, stored off-host. ${v.attachedTo ? 'The filesystem is briefly frozen for consistency.' : ''}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Camera} loading={m.isPending} onClick={() => m.mutate()}>Create snapshot</Button></>}>
      <div className="space-y-4">
        <Field label="Name" error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} invalid={!!errors.name} /></Field>
        <Field label="Description" optional><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. before schema migration" /></Field>
        <p className="text-xs text-muted">≈ {money(Math.max(1, v.usedGB) * 0.02)}/mo snapshot storage</p>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ controller */

export type VolumeModalKind = 'attach' | 'resize' | 'performance' | 'clone' | 'snapshot';

/** Hook managing one open volume modal at a time (for tables / headers). */
export function useVolumeModals(): { open: (kind: VolumeModalKind, v: Volume) => void; element: ReactNode } {
  const [state, setState] = useState<{ kind: VolumeModalKind; v: Volume } | null>(null);
  const close = () => setState(null);
  const v = state?.v;
  const element = v ? (
    <>
      <AttachVolumeModal volume={v} open={state.kind === 'attach'} onClose={close} />
      <ResizeVolumeModal volume={v} open={state.kind === 'resize'} onClose={close} />
      <PerformanceModal volume={v} open={state.kind === 'performance'} onClose={close} />
      <CloneVolumeModal volume={v} open={state.kind === 'clone'} onClose={close} />
      <SnapshotVolumeModal volume={v} open={state.kind === 'snapshot'} onClose={close} />
    </>
  ) : null;
  return { open: (kind, vol) => setState({ kind, v: vol }), element };
}
