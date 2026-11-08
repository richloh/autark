import { useState } from 'react';
import { Cpu, MemoryStick, Sparkles, ChevronRight, Gpu } from 'lucide-react';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';
import { Field, Input, NumberInput, OptionCards, Select, Slider, Switch, TagEditor } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { poolNodeCost } from './k8sUi';
import { K8S_NODE_PRESETS, type Tag } from '@/types';

export interface PoolDraft {
  name: string;
  presetId: string | null;
  vcpus: number;
  ramGB: number;
  diskGB: number;
  count: number;
  autoscale: { enabled: boolean; min: number; max: number };
  labels: Tag[];
  taints: string[];
  gpu: { model: string; count: number } | null;
  upgradeSettings: { maxSurge: number; maxUnavailable: number };
}

export function newPoolDraft(name = 'default', presetId = 'k8s-np-m', count = 3): PoolDraft {
  const p = K8S_NODE_PRESETS.find((x) => x.id === presetId)!;
  return { name, presetId, vcpus: p.vcpus, ramGB: p.ramGB, diskGB: p.diskGB, count, autoscale: { enabled: false, min: count, max: count + 3 }, labels: [], taints: p.gpu ? ['nvidia.com/gpu=true:NoSchedule'] : [], gpu: p.gpu ?? null, upgradeSettings: { maxSurge: 1, maxUnavailable: 0 } };
}

/** Request body for the API (presets are sent by id, custom sizes explicitly). */
export function poolBody(d: PoolDraft) {
  return {
    name: d.name, ...(d.presetId ? { presetId: d.presetId, diskGB: d.diskGB } : { vcpus: d.vcpus, ramGB: d.ramGB, diskGB: d.diskGB, gpu: d.gpu }),
    count: d.count, autoscale: d.autoscale, labels: d.labels, taints: d.taints, upgradeSettings: d.upgradeSettings,
  };
}

export const poolDraftCost = (d: PoolDraft) => poolNodeCost(d) * d.count;

type Family = 'general' | 'compute' | 'memory' | 'gpu' | 'custom';
const TAINT_RE = /^[a-z0-9A-Z./-]+(=[\w.-]*)?:(NoSchedule|PreferNoSchedule|NoExecute)$/;

export function NodePoolEditor({ value, onChange, errors = {}, errorPrefix = '', nameTaken }: {
  value: PoolDraft; onChange: (d: PoolDraft) => void; errors?: Record<string, string>; errorPrefix?: string; nameTaken?: boolean;
}) {
  const preset = K8S_NODE_PRESETS.find((p) => p.id === value.presetId);
  const [family, setFamily] = useState<Family>(preset?.family ?? 'custom');
  const [taintDraft, setTaintDraft] = useState('');
  const set = (patch: Partial<PoolDraft>) => onChange({ ...value, ...patch });
  const err = (k: string) => errors[`${errorPrefix}${k}`];
  const nameErr = value.name && !/^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$/.test(value.name) ? 'Lowercase letters, digits, dashes (max 30)' : nameTaken ? 'Pool names must be unique' : err('name');

  const pickPreset = (id: string) => {
    const p = K8S_NODE_PRESETS.find((x) => x.id === id)!;
    const gpuTaint = 'nvidia.com/gpu=true:NoSchedule';
    set({ presetId: id, vcpus: p.vcpus, ramGB: p.ramGB, diskGB: p.diskGB, gpu: p.gpu ?? null, taints: p.gpu ? [...new Set([...value.taints, gpuTaint])] : value.taints.filter((t) => t !== gpuTaint) });
  };
  const setCount = (n: number) => set({ count: n, autoscale: value.autoscale.enabled ? { ...value.autoscale, min: Math.min(value.autoscale.min, n), max: Math.max(value.autoscale.max, n) } : { ...value.autoscale, min: n, max: Math.max(n, value.autoscale.max) } });
  const addTaint = () => {
    const t = taintDraft.trim();
    if (!t || !TAINT_RE.test(t)) return;
    set({ taints: [...new Set([...value.taints, t])] });
    setTaintDraft('');
  };
  const nodeCost = poolNodeCost(value);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 @min-[36rem]:grid-cols-[1fr_auto]">
        <Field label="Pool name" required error={nameErr || undefined}>
          <Input value={value.name} onChange={(e) => set({ name: e.target.value.toLowerCase() })} placeholder="workers" invalid={!!nameErr} mono />
        </Field>
        <div className="flex items-end justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2 text-xs @min-[36rem]:flex-col @min-[36rem]:items-end @min-[36rem]:justify-center">
          <span className="text-muted">{money(nodeCost)} / node · month</span>
          <span className="text-sm font-semibold tabular text-fg">{money(nodeCost * value.count)}<span className="text-xs font-normal text-muted"> /mo</span></span>
        </div>
      </div>

      <div className="space-y-3">
        <Segmented size="sm" value={family} onChange={(f) => { setFamily(f); if (f !== 'custom') { const first = K8S_NODE_PRESETS.find((p) => p.family === f); if (first) pickPreset(first.id) } else set({ presetId: null }) }}
          options={[{ value: 'general', label: 'General' }, { value: 'compute', label: 'Compute' }, { value: 'memory', label: 'Memory' }, { value: 'gpu', label: 'GPU', icon: <Sparkles className="size-3" /> }, { value: 'custom', label: 'Custom' }]} />
        {family !== 'custom' ? (
          <OptionCards cols={3} value={value.presetId ?? ''} onChange={pickPreset} options={K8S_NODE_PRESETS.filter((p) => p.family === family).map((p) => ({
            value: p.id, title: p.name, description: p.description,
            meta: (
              <div className="flex items-center justify-between text-xs">
                <span className="flex gap-2 text-fg-2"><span className="flex items-center gap-0.5"><Cpu className="size-3" />{p.vcpus}</span><span className="flex items-center gap-0.5"><MemoryStick className="size-3" />{p.ramGB}G</span>{p.gpu && <span className="flex items-center gap-0.5 text-lime-600 dark:text-lime-400"><Gpu className="size-3" />{p.gpu.model}</span>}</span>
                <span className="font-medium tabular text-fg">{money(poolNodeCost(p))}</span>
              </div>
            ),
          }))} />
        ) : (
          <div className="grid gap-4 @min-[36rem]:grid-cols-2">
            <Field label={`vCPUs · ${value.vcpus}`} error={err('vcpus')}><Slider value={value.vcpus} onChange={(v) => set({ vcpus: v })} min={2} max={64} marks={[2, 16, 32, 64]} /></Field>
            <Field label={`Memory · ${value.ramGB} GB`} error={err('ramGB')}><Slider value={value.ramGB} onChange={(v) => set({ ramGB: v })} min={4} max={512} step={4} marks={[4, 128, 256, 512]} /></Field>
            <Field label="GPU">
              <Select value={value.gpu?.model ?? 'none'} onChange={(e) => set({ gpu: e.target.value === 'none' ? null : { model: e.target.value, count: value.gpu?.count ?? 1 } })}
                options={[{ value: 'none', label: 'No GPU' }, { value: 'A6000', label: 'NVIDIA RTX A6000 (48 GB)' }, { value: 'L40S', label: 'NVIDIA L40S (48 GB)' }, { value: 'H100', label: 'NVIDIA H100 (80 GB)' }, { value: 'H200', label: 'NVIDIA H200 (141 GB)' }]} />
            </Field>
            {value.gpu && <Field label="GPUs per node"><NumberInput value={value.gpu.count} onChange={(n) => set({ gpu: { ...value.gpu!, count: n } })} min={1} max={8} /></Field>}
          </div>
        )}
      </div>

      <div className="grid gap-4 @min-[36rem]:grid-cols-3">
        <Field label="Nodes" error={err('count')}><NumberInput value={value.count} onChange={setCount} min={0} max={100} /></Field>
        <Field label="Disk per node" error={err('diskGB')}><NumberInput value={value.diskGB} onChange={(n) => set({ diskGB: n })} min={40} max={2000} step={20} unit="GB" /></Field>
        <Field label="Upgrade surge" hint="Extra nodes added while upgrading"><NumberInput value={value.upgradeSettings.maxSurge} onChange={(n) => set({ upgradeSettings: { ...value.upgradeSettings, maxSurge: n } })} min={1} max={5} /></Field>
      </div>

      <div className="rounded-lg border border-line p-3">
        <Switch checked={value.autoscale.enabled} onChange={(v) => set({ autoscale: { enabled: v, min: Math.min(value.autoscale.min, value.count), max: Math.max(value.autoscale.max, value.count) } })}
          label="Cluster autoscaler" description="Adds nodes when pods are unschedulable and removes idle nodes, within min/max." />
        {value.autoscale.enabled && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Min nodes" error={err('autoscale')}><NumberInput value={value.autoscale.min} onChange={(n) => set({ autoscale: { ...value.autoscale, min: n }, count: Math.max(n, value.count) })} min={0} max={value.autoscale.max} /></Field>
            <Field label="Max nodes"><NumberInput value={value.autoscale.max} onChange={(n) => set({ autoscale: { ...value.autoscale, max: n }, count: Math.min(n, value.count) })} min={Math.max(1, value.autoscale.min)} max={100} /></Field>
            <p className="col-span-2 text-xs text-muted">Cost range {money(nodeCost * value.autoscale.min)} – {money(nodeCost * value.autoscale.max)} / month</p>
          </div>
        )}
      </div>

      <details className="group rounded-lg border border-line">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[13px] font-medium text-fg-2">
          <ChevronRight className="size-4 transition-transform group-open:rotate-90" /> Labels & taints
          <span className="ml-auto text-xs font-normal text-muted">{value.labels.length} labels · {value.taints.length} taints</span>
        </summary>
        <div className="space-y-4 border-t border-line p-3">
          <Field label="Node labels" hint="Use them in nodeSelector / affinity rules.">
            <TagEditor value={value.labels} onChange={(labels) => set({ labels })} suggestions={['role', 'workload', 'tier']} />
          </Field>
          <Field label="Taints" hint="Only pods with a matching toleration are scheduled here, e.g. dedicated=batch:NoSchedule" error={err('taints')}>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {value.taints.map((t) => (
                <span key={t} className="inline-flex h-7 items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/5 pl-2 font-mono text-[11px] text-amber-800 dark:text-amber-300">
                  {t}<button type="button" onClick={() => set({ taints: value.taints.filter((x) => x !== t) })} className="px-1.5 text-faint hover:text-rose-500" aria-label={`Remove ${t}`}>×</button>
                </span>
              ))}
              {value.taints.length === 0 && <span className="text-xs text-faint">No taints — any pod may run here</span>}
            </div>
            <div className="flex gap-2">
              <Input value={taintDraft} onChange={(e) => setTaintDraft(e.target.value)} placeholder="key=value:NoSchedule" mono invalid={!!taintDraft && !TAINT_RE.test(taintDraft)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTaint())} />
              <button type="button" onClick={addTaint} disabled={!TAINT_RE.test(taintDraft.trim())} className={cn('h-9 shrink-0 rounded-lg border border-line px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-50')}>Add</button>
            </div>
          </Field>
        </div>
      </details>
    </div>
  );
}
