import { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { api, ApiClientError } from '@/api/client';
import { useApiMutation } from '@/api/hooks';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Slider, NumberInput, Textarea } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { fieldErrors } from '@/components/ui/FormLayout';
import { IacTabs, toCli, toCurl, toHcl } from '@/components/ui/CodeBlock';
import { vmCost, volumeCost, PRICING } from '@/lib/pricing';
import { money } from '@/lib/format';
import { VOLUME_LIMITS, maxIopsFor, type VmPreset, type VolumePreset, type VolumeType, type GpuSpec } from '@/types';

export type PresetMode = 'create' | 'edit' | 'duplicate';

const FAMILIES: { value: VmPreset['family']; label: string }[] = [
  { value: 'general', label: 'General' }, { value: 'compute', label: 'Compute' }, { value: 'memory', label: 'Memory' }, { value: 'gpu', label: 'GPU' },
];
const GPU_MODELS = ['A6000', 'L40S', 'H100', 'H200'] as const;

function PriceBox({ total, lines, sub }: { total: number; lines: { label: string; amount: number }[]; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted">Price on own hardware</span>
        <span><span className="text-xl font-semibold tabular text-fg">{money(total)}</span><span className="text-xs text-muted"> /mo</span></span>
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {lines.map((l) => <li key={l.label} className="flex justify-between gap-2 text-fg-2"><span className="truncate">{l.label}</span><span className="tabular">{money(l.amount, { decimals: true })}</span></li>)}
      </ul>
      {sub && <p className="mt-2 text-[11px] text-faint">{sub}</p>}
    </div>
  );
}

/** Create / edit / duplicate a VM size preset. */
export function VmPresetModal({ open, mode, preset, onClose }: { open: boolean; mode: PresetMode; preset?: VmPreset | null; onClose: () => void }) {
  const [f, setF] = useState({ name: '', family: 'general' as VmPreset['family'], vcpus: 4, ramGB: 8, systemDiskGB: 100, description: '', gpuModel: 'A6000', gpuCount: 0 });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (preset) setF({ name: mode === 'duplicate' ? `${preset.name}-custom`.slice(0, 40) : preset.name, family: preset.family, vcpus: preset.vcpus, ramGB: preset.ramGB, systemDiskGB: preset.systemDiskGB, description: preset.description, gpuModel: preset.gpu?.model ?? 'A6000', gpuCount: preset.gpu?.count ?? 0 });
    else setF({ name: '', family: 'general', vcpus: 4, ramGB: 8, systemDiskGB: 100, description: '', gpuModel: 'A6000', gpuCount: 0 });
  }, [open, preset, mode]);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const gpu = f.family === 'gpu' && f.gpuCount > 0 ? { model: f.gpuModel as GpuSpec['model'], count: f.gpuCount } : null;
  const body = { name: f.name, family: f.family, vcpus: f.vcpus, ramGB: f.ramGB, systemDiskGB: f.systemDiskGB, gpu, description: f.description };
  const cost = vmCost({ vcpus: f.vcpus, ramGB: f.ramGB, systemDiskGB: f.systemDiskGB, gpu });
  const m = useApiMutation(() => (mode === 'edit' && preset ? api.update('vmPresets', preset.id, body) : api.create('vmPresets', body)), {
    success: mode === 'edit' ? 'Preset updated' : `Preset ${f.name} created`,
    onSuccess: onClose,
    onError: (e: ApiClientError) => setErrors(fieldErrors(e)),
  });
  const ratio = f.ramGB / Math.max(1, f.vcpus);
  return (
    <Modal open={open} onClose={onClose} size="lg" title={mode === 'edit' ? `Edit preset ${preset?.name}` : mode === 'duplicate' ? `Duplicate ${preset?.name}` : 'New VM size preset'}
      icon={<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-brand-500"><SlidersHorizontal className="size-[18px]" /></div>}
      description={mode === 'edit' ? 'Changes apply to new VMs only — existing VMs keep their current size.' : 'Custom presets appear in the VM create form for everyone in this account.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>{mode === 'edit' ? 'Save changes' : 'Create preset'}</Button></>}>
      <div className="grid gap-5 @min-[40rem]:grid-cols-[1fr_220px]">
        <div className="space-y-4">
          <div className="grid gap-4 @min-[36rem]:grid-cols-2">
            <Field label="Name" required error={errors.name}><Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="ci-runner-xl" invalid={!!errors.name} /></Field>
            <Field label="Family" error={errors.family}><Select value={f.family} onChange={(e) => set({ family: e.target.value as VmPreset['family'], gpuCount: e.target.value === 'gpu' ? Math.max(1, f.gpuCount) : 0 })} options={FAMILIES} /></Field>
          </div>
          <Field label={`vCPUs · ${f.vcpus}`} error={errors.vcpus}><Slider value={f.vcpus} onChange={(v) => set({ vcpus: v })} min={1} max={128} marks={[1, 16, 32, 64, 128]} /></Field>
          <Field label={`Memory · ${f.ramGB} GB`} error={errors.ramGB} hint={`${ratio.toFixed(ratio < 10 ? 1 : 0)} GB per vCPU — ${ratio >= 6 ? 'memory optimized' : ratio <= 2.5 ? 'compute optimized' : 'balanced'}`}>
            <Slider value={f.ramGB} onChange={(v) => set({ ramGB: v })} min={1} max={1024} marks={[1, 128, 256, 512, 1024]} />
          </Field>
          <div className="grid gap-4 @min-[36rem]:grid-cols-2">
            <Field label="System disk" error={errors.systemDiskGB}><NumberInput value={f.systemDiskGB} onChange={(v) => set({ systemDiskGB: v })} min={10} max={4096} step={10} unit="GB" /></Field>
            {f.family === 'gpu' && (
              <Field label="GPU" error={errors.gpu}>
                <div className="flex gap-2">
                  <Select className="flex-1" value={f.gpuModel} onChange={(e) => set({ gpuModel: e.target.value })} options={GPU_MODELS.map((g) => ({ value: g, label: g }))} />
                  <NumberInput className="w-28" value={f.gpuCount} onChange={(v) => set({ gpuCount: v })} min={1} max={8} unit="×" />
                </div>
              </Field>
            )}
          </div>
          <Field label="Description" optional><Textarea rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="What is this size for?" /></Field>
        </div>
        <div className="space-y-3">
          <PriceBox total={cost.total} lines={cost.lines} sub={`Cloud burst: ${money(vmCost({ vcpus: f.vcpus, ramGB: f.ramGB, systemDiskGB: f.systemDiskGB, gpu, cloud: true }).total)}/mo (+${Math.round((PRICING.cloudMarkup - 1) * 100)}%)`} />
          <details className="rounded-xl border border-line p-3">
            <summary className="cursor-pointer text-xs font-medium text-muted">Equivalent code</summary>
            <IacTabs className="mt-3" snippets={{ terraform: toHcl('vm_preset', f.name || 'preset', body), cli: toCli('vm preset create', body), curl: toCurl(mode === 'edit' ? 'PATCH' : 'POST', mode === 'edit' && preset ? `/vmPresets/${preset.id}` : '/vmPresets', body) }} />
          </details>
        </div>
      </div>
    </Modal>
  );
}

/** Create / edit / duplicate a volume preset. */
export function VolumePresetModal({ open, mode, preset, onClose }: { open: boolean; mode: PresetMode; preset?: VolumePreset | null; onClose: () => void }) {
  const [f, setF] = useState({ name: '', type: 'ssd' as VolumeType, sizeGB: 100, iops: 3000, throughputMBps: 125, description: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (preset) setF({ name: mode === 'duplicate' ? `${preset.name}-custom`.slice(0, 40) : preset.name, type: preset.type, sizeGB: preset.sizeGB, iops: preset.iops, throughputMBps: preset.throughputMBps, description: preset.description });
    else setF({ name: '', type: 'ssd', sizeGB: 100, iops: 3000, throughputMBps: 125, description: '' });
  }, [open, preset, mode]);
  const l = VOLUME_LIMITS[f.type];
  const maxIops = maxIopsFor(f.type, f.sizeGB);
  const set = (p: Partial<typeof f>) => setF((x) => {
    const n = { ...x, ...p };
    const lim = VOLUME_LIMITS[n.type];
    n.sizeGB = Math.min(lim.maxGB, Math.max(lim.minGB, n.sizeGB));
    n.iops = Math.min(maxIopsFor(n.type, n.sizeGB), Math.max(lim.minIops, n.iops));
    n.throughputMBps = Math.min(lim.maxTp, Math.max(lim.minTp, n.throughputMBps));
    return n;
  });
  const body = { name: f.name, type: f.type, sizeGB: f.sizeGB, iops: f.iops, throughputMBps: f.throughputMBps, description: f.description };
  const cost = volumeCost({ type: f.type, sizeGB: f.sizeGB, iops: f.iops, throughputMBps: f.throughputMBps });
  const m = useApiMutation(() => (mode === 'edit' && preset ? api.update('volumePresets', preset.id, body) : api.create('volumePresets', body)), {
    success: mode === 'edit' ? 'Preset updated' : `Preset ${f.name} created`,
    onSuccess: onClose,
    onError: (e: ApiClientError) => setErrors(fieldErrors(e)),
  });
  return (
    <Modal open={open} onClose={onClose} size="lg" title={mode === 'edit' ? `Edit preset ${preset?.name}` : mode === 'duplicate' ? `Duplicate ${preset?.name}` : 'New volume preset'}
      icon={<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-sky-500"><SlidersHorizontal className="size-[18px]" /></div>}
      description="Presets bundle type, size and provisioned performance for one-click volume creation."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>{mode === 'edit' ? 'Save changes' : 'Create preset'}</Button></>}>
      <div className="grid gap-5 @min-[40rem]:grid-cols-[1fr_220px]">
        <div className="space-y-4">
          <Field label="Name" required error={errors.name}><Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="postgres-fast" invalid={!!errors.name} /></Field>
          <Field label="Type" error={errors.type} hint={l.description}>
            <Segmented value={f.type} onChange={(t) => set({ type: t, iops: VOLUME_LIMITS[t].minIops, throughputMBps: VOLUME_LIMITS[t].minTp })} options={(Object.keys(VOLUME_LIMITS) as VolumeType[]).map((t) => ({ value: t, label: VOLUME_LIMITS[t].label }))} />
          </Field>
          <Field label="Size" error={errors.sizeGB}><NumberInput value={f.sizeGB} onChange={(v) => set({ sizeGB: v })} min={l.minGB} max={l.maxGB} step={50} unit="GB" /></Field>
          <Field label={`IOPS · ${f.iops.toLocaleString()}`} error={errors.iops} hint={`${l.minIops.toLocaleString()} included · up to ${maxIops.toLocaleString()} at ${f.sizeGB} GB (${l.iopsPerGB}/GB)`}>
            <Slider value={f.iops} onChange={(v) => set({ iops: v })} min={l.minIops} max={Math.max(l.minIops + 100, maxIops)} step={100} />
          </Field>
          <Field label={`Throughput · ${f.throughputMBps} MB/s`} error={errors.throughputMBps}>
            <Slider value={f.throughputMBps} onChange={(v) => set({ throughputMBps: v })} min={l.minTp} max={l.maxTp} step={l.maxTp > 1000 ? 25 : 5} />
          </Field>
          <Field label="Description" optional><Textarea rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        </div>
        <div className="space-y-3">
          <PriceBox total={cost.total} lines={cost.lines} sub={`${money(cost.total / f.sizeGB, { decimals: true })} per GB · ~${l.latencyMs} ms latency`} />
          <details className="rounded-xl border border-line p-3">
            <summary className="cursor-pointer text-xs font-medium text-muted">Equivalent code</summary>
            <IacTabs className="mt-3" snippets={{ terraform: toHcl('volume_preset', f.name || 'preset', body), cli: toCli('volume preset create', body), curl: toCurl(mode === 'edit' ? 'PATCH' : 'POST', mode === 'edit' && preset ? `/volumePresets/${preset.id}` : '/volumePresets', body) }} />
          </details>
        </div>
      </div>
    </Modal>
  );
}
