import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Scaling, Cpu, Zap, MemoryStick, Gpu, SlidersHorizontal, Power, ShieldCheck, ArrowRight, Info } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation, useList } from '@/api/hooks';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Hint, Slider } from '@/components/ui/form';
import { confirm } from '@/components/ui/Modal';
import { vmCost, HOURS_PER_MONTH } from '@/lib/pricing';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { VmCtx } from './context';
import type { VmPreset, VM } from '@/types';

type Family = VmPreset['family'] | 'custom';

const FAMILIES: { id: Family; name: string; icon: typeof Cpu; color: string; blurb: string; tags: string[] }[] = [
  { id: 'general', name: 'General purpose', icon: Cpu, color: '#5b67f8', blurb: 'Balanced vCPU and memory (1:2).', tags: ['Best price/performance', 'Web & app servers', 'Dev & staging'] },
  { id: 'compute', name: 'Compute optimized', icon: Zap, color: '#f59e0b', blurb: 'Dedicated cores, no CPU steal.', tags: ['Sustained high CPU', 'CI runners', 'Batch & encoding'] },
  { id: 'memory', name: 'Memory optimized', icon: MemoryStick, color: '#a855f7', blurb: 'Up to 8 GB RAM per vCPU.', tags: ['In-memory caches', 'Analytics', 'Large JVMs'] },
  { id: 'gpu', name: 'GPU', icon: Gpu, color: '#10b981', blurb: 'NVIDIA GPUs via VFIO passthrough.', tags: ['AI inference', 'Fine-tuning', 'Rendering'] },
  { id: 'custom', name: 'Custom', icon: SlidersHorizontal, color: '#64748b', blurb: 'Any vCPU / RAM combination.', tags: ['Fine-grained', 'Odd ratios'] },
];

interface Target { presetId: string | null; name: string; vcpus: number; ramGB: number; systemDiskGB: number; gpu: VM['gpu'] }

/** Hetzner-style "Rescale" tab: pick a plan family, then a plan in a price table, then confirm. */
export function VmRescale({ c }: { c: VmCtx }) {
  const { vm, location, ips } = c;
  const { items: presets } = useList<VmPreset>('vmPresets');
  const current = presets.find((p) => p.id === vm.size.presetId);
  const [cpuRamOnly, setCpuRamOnly] = useState(true);
  const [family, setFamily] = useState<Family>(current?.family ?? (vm.size.presetId === null ? 'custom' : 'general'));
  const [selected, setSelected] = useState<string | null>(null);
  const [custom, setCustom] = useState({ vcpus: vm.size.vcpus, ramGB: vm.size.ramGB });
  useEffect(() => { if (current) setFamily(current.family) }, [current?.id]); // eslint-disable-line
  useEffect(() => { setSelected(null); setCustom({ vcpus: vm.size.vcpus, ramGB: vm.size.ramGB }) }, [vm.size.vcpus, vm.size.ramGB, vm.size.systemDiskGB, vm.size.presetId]);

  const base = { publicIpv4: ips.filter((i) => i.version === 4).length, backups: vm.backups.enabled, cloud: location?.kind === 'cloud' };
  const priceOf = (t: { vcpus: number; ramGB: number; systemDiskGB: number; gpu: VM['gpu'] }) => vmCost({ ...t, ...base }).total;
  const curCost = priceOf({ vcpus: vm.size.vcpus, ramGB: vm.size.ramGB, systemDiskGB: vm.size.systemDiskGB, gpu: vm.gpu });
  const effDisk = (p: VmPreset) => (cpuRamOnly ? vm.size.systemDiskGB : Math.max(p.systemDiskGB, vm.size.systemDiskGB));

  const plans = useMemo(() => presets.filter((p) => p.family === family).sort((a, b) => a.vcpus - b.vcpus || a.ramGB - b.ramGB), [presets, family]);
  const disabledReason = (p: VmPreset): string | null => {
    if (!cpuRamOnly && p.systemDiskGB < vm.size.systemDiskGB) return `Disk ${p.systemDiskGB} GB < current ${vm.size.systemDiskGB} GB`;
    return null;
  };
  const isCurrentPlan = (p: VmPreset) => p.id === vm.size.presetId && effDisk(p) === vm.size.systemDiskGB;

  const target: Target | null = family === 'custom'
    ? { presetId: null, name: 'custom', vcpus: custom.vcpus, ramGB: custom.ramGB, systemDiskGB: vm.size.systemDiskGB, gpu: vm.gpu }
    : (() => { const p = presets.find((x) => x.id === selected); return p ? { presetId: p.id, name: p.name, vcpus: p.vcpus, ramGB: p.ramGB, systemDiskGB: effDisk(p), gpu: p.gpu ?? null } : null })();
  const unchanged = !target || (target.vcpus === vm.size.vcpus && target.ramGB === vm.size.ramGB && target.systemDiskGB === vm.size.systemDiskGB && target.presetId === vm.size.presetId && JSON.stringify(target.gpu ?? null) === JSON.stringify(vm.gpu ?? null));
  const newCost = target ? priceOf(target) : curCost;
  const diff = newCost - curCost;
  const canRescale = ['running', 'stopped'].includes(vm.status);
  const running = vm.status === 'running';

  const m = useApiMutation(() => api.action('vms', vm.id, 'resize', target!.presetId
    ? { presetId: target!.presetId, systemDiskGB: target!.systemDiskGB, keepDisk: cpuRamOnly }
    : { vcpus: target!.vcpus, ramGB: target!.ramGB, systemDiskGB: vm.size.systemDiskGB, gpu: vm.gpu }), {
    success: `Rescaling ${vm.name}`,
  });

  const submit = async () => {
    if (!target) return;
    const grows = target.systemDiskGB > vm.size.systemDiskGB;
    const ok = await confirm({
      title: `Rescale ${vm.name} to ${target.name === 'custom' ? `${target.vcpus} vCPU / ${target.ramGB} GB` : target.name}?`,
      message: [
        running ? 'The VM will be shut down, rescaled and started again (typically 20–40 s of downtime).' : 'The new size applies on the next start.',
        grows ? `The system disk grows from ${vm.size.systemDiskGB} GB to ${target.systemDiskGB} GB. This is permanent — you will not be able to downgrade to plans with a smaller disk.` : 'Disk size stays the same, so you can downgrade again later.',
        vm.gpu && !target.gpu ? `The ${vm.gpu.count}× ${vm.gpu.model} GPU will be removed.` : '',
        `New price: ${money(newCost)}/mo (${diff >= 0 ? '+' : '−'}${money(Math.abs(diff))}).`,
      ].filter(Boolean).map((l, i) => <p key={i} className={i ? 'mt-1.5' : ''}>{l}</p>),
      confirmLabel: running ? 'Rescale & restart' : 'Rescale', danger: grows,
    });
    if (ok) m.mutate();
  };

  const showGpu = family === 'gpu' || !!vm.gpu;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Rescale" icon={Scaling} description="Change vCPU, memory and GPU of this server" />
        <div className="grid gap-4 p-4 @min-[44rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-2 text-[13px] text-fg-2">
            <p className="flex gap-2"><Power className="mt-0.5 size-4 shrink-0 text-muted" /><span>The VM must be powered off to rescale. {running ? 'It is running, so it will be shut down gracefully, rescaled and booted again automatically.' : 'It is currently off — the new size applies on next start.'}</span></p>
            <p className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" /><span>No data is lost: the system disk, volumes, IPs and firewalls stay attached.</span></p>
          </div>
          <div className={cn('rounded-xl border p-3', cpuRamOnly ? 'border-brand-500/30 bg-brand-500/[0.04]' : 'border-amber-500/30 bg-amber-500/[0.05]')}>
            <Checkbox checked={cpuRamOnly} onChange={(v) => { setCpuRamOnly(v); setSelected(null) }} label={<span className="font-medium text-fg">CPU and RAM only</span>} />
            <p className="mt-1 pl-6 text-xs text-muted">
              {cpuRamOnly
                ? <>Keeps the {vm.size.systemDiskGB} GB disk, so you can always downgrade again later.</>
                : <>The disk grows to the plan’s size. <b className="text-amber-600 dark:text-amber-400">This is permanent</b> — plans with a smaller disk are no longer available afterwards.</>}
            </p>
          </div>
        </div>
        {!canRescale && <Hint tone="warning" className="mx-4 mb-4">The VM is {vm.status}. Rescaling is possible once it is running or stopped.</Hint>}
      </Card>

      {/* families */}
      <div className="grid grid-cols-2 gap-2.5 @min-[40rem]:grid-cols-3 @min-[60rem]:grid-cols-5" role="radiogroup" aria-label="Plan family">
        {FAMILIES.map((f) => {
          const active = family === f.id;
          const count = f.id === 'custom' ? null : presets.filter((p) => p.family === f.id).length;
          const isCur = f.id === (current?.family ?? (vm.size.presetId === null ? 'custom' : ''));
          return (
            <button key={f.id} type="button" role="radio" aria-checked={active} onClick={() => { setFamily(f.id); setSelected(null) }}
              className={cn('flex min-w-0 flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all', active ? 'border-brand-500 bg-brand-500/[0.06] ring-3 ring-brand-500/15' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2/50')}>
              <span className="flex w-full items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${f.color}1f`, color: f.color }}><f.icon className="size-4" /></span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{f.name}</span>
                {isCur && <span className="size-1.5 shrink-0 rounded-full bg-brand-500" title="Current family" />}
              </span>
              <span className="text-xs text-muted">{f.blurb}{count != null && <span className="text-faint"> · {count} plans</span>}</span>
              <span className="flex flex-wrap gap-1">
                {f.tags.map((t) => <span key={t} className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[10.5px] font-medium text-fg-2">{t}</span>)}
              </span>
            </button>
          );
        })}
      </div>

      {/* plans */}
      <Card className="overflow-hidden">
        {family === 'custom' ? (
          <div className="grid gap-5 p-4 @min-[40rem]:grid-cols-2">
            <Field label={`vCPUs · ${custom.vcpus}`}><Slider value={custom.vcpus} onChange={(v) => setCustom({ ...custom, vcpus: v })} min={1} max={64} marks={[1, 8, 16, 32, 64]} /></Field>
            <Field label={`Memory · ${custom.ramGB} GB`}><Slider value={custom.ramGB} onChange={(v) => setCustom({ ...custom, ramGB: v })} min={1} max={512} marks={[1, 64, 128, 256, 512]} /></Field>
            <p className="text-xs text-muted @min-[40rem]:col-span-2">Custom sizes keep the {vm.size.systemDiskGB} GB disk{vm.gpu ? ` and the ${vm.gpu.count}× ${vm.gpu.model} GPU` : ''}. Save frequently used sizes as <Link to="/infrastructure/vms/presets" className="text-brand-500 hover:underline">presets</Link>.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-[13px]">
              <thead>
                <tr className="border-b border-line bg-surface-2/60 text-left text-[11px] font-medium uppercase tracking-wide text-muted">
                  <th className="w-8 py-2 pl-4" />
                  <th className="py-2 pr-3">Plan</th>
                  <th className="py-2 pr-3 text-right">vCPU</th>
                  <th className="py-2 pr-3 text-right">RAM</th>
                  <th className="py-2 pr-3 text-right">Disk</th>
                  {showGpu && <th className="py-2 pr-3">GPU</th>}
                  <th className="hidden py-2 pr-3 text-right @min-[40rem]:table-cell">Per hour</th>
                  <th className="py-2 pr-3 text-right">Per month</th>
                  <th className="py-2 pr-4 text-right">Δ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {plans.map((p) => {
                  const dis = disabledReason(p);
                  const cur = isCurrentPlan(p);
                  const disk = effDisk(p);
                  const price = priceOf({ vcpus: p.vcpus, ramGB: p.ramGB, systemDiskGB: disk, gpu: p.gpu ?? null });
                  const d = price - curCost;
                  const sel = selected === p.id;
                  const pick = () => { if (!dis && !cur) setSelected(p.id) };
                  return (
                    <tr key={p.id} onClick={pick} aria-selected={sel} title={dis ?? undefined}
                      className={cn('transition-colors', sel ? 'bg-brand-500/[0.07]' : cur ? 'bg-surface-2/50' : '', dis ? 'cursor-not-allowed opacity-45' : !cur && 'cursor-pointer hover:bg-surface-2/60')}>
                      <td className="py-2.5 pl-4">
                        <span className={cn('flex size-4 items-center justify-center rounded-full border', sel ? 'border-brand-500 bg-brand-500' : cur ? 'border-brand-500/50' : 'border-line-strong')}>
                          {(sel || cur) && <span className={cn('size-1.5 rounded-full', sel ? 'bg-white' : 'bg-brand-500/60')} />}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-fg">{p.name}</span>
                          {cur && <Badge tone="brand">current</Badge>}
                          {!p.builtIn && <Badge>custom</Badge>}
                        </div>
                        <div className="max-w-[16rem] truncate text-[11px] text-muted">{dis ?? p.description}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular text-fg">{p.vcpus}</td>
                      <td className="py-2.5 pr-3 text-right tabular text-fg">{p.ramGB} GB</td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-right tabular text-fg">
                        {disk} GB
                        {cpuRamOnly && p.systemDiskGB !== disk && <div className="text-[10px] text-faint">plan {p.systemDiskGB} GB</div>}
                      </td>
                      {showGpu && <td className="whitespace-nowrap py-2.5 pr-3">{p.gpu ? <span className="text-violet-600 dark:text-violet-400">{p.gpu.count}× {p.gpu.model}</span> : <span className="text-faint">—</span>}</td>}
                      <td className="hidden py-2.5 pr-3 text-right tabular text-fg-2 @min-[40rem]:table-cell">{money(price / HOURS_PER_MONTH, { decimals: true })}</td>
                      <td className="py-2.5 pr-3 text-right font-medium tabular text-fg">{money(price)}</td>
                      <td className={cn('whitespace-nowrap py-2.5 pr-4 text-right tabular', cur || Math.abs(d) < 0.005 ? 'text-faint' : d > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
                        {cur ? '—' : Math.abs(d) < 0.005 ? '±0' : `${d > 0 ? '+' : '−'}${money(Math.abs(d))}`}
                      </td>
                    </tr>
                  );
                })}
                {!plans.length && <tr><td colSpan={9} className="py-8 text-center text-sm text-muted">No plans in this family.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* confirm bar */}
        <div className="flex flex-col gap-3 border-t border-line bg-surface-2/40 p-4 @min-[40rem]:flex-row @min-[40rem]:items-center">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <span className="text-muted">{current?.name ?? 'custom'} · {vm.size.vcpus} vCPU · {vm.size.ramGB} GB · <span className="tabular">{money(curCost)}/mo</span></span>
            {target && !unchanged ? (
              <>
                <ArrowRight className="size-4 text-faint" />
                <span className="font-medium text-fg">{target.name} · {target.vcpus} vCPU · {target.ramGB} GB{target.systemDiskGB !== vm.size.systemDiskGB ? ` · ${target.systemDiskGB} GB disk` : ''} · <span className="tabular">{money(newCost)}/mo</span></span>
                <span className={cn('rounded-md px-1.5 py-0.5 text-xs font-semibold tabular', diff > 0.005 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : diff < -0.005 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-surface-3 text-muted')}>
                  {Math.abs(diff) < 0.005 ? '±0' : `${diff > 0 ? '+' : '−'}${money(Math.abs(diff))}/mo`}
                </span>
              </>
            ) : <span className="flex items-center gap-1 text-faint"><Info className="size-3.5" />{family === 'custom' ? 'Adjust vCPU or memory' : 'Select a plan above'}</span>}
            {target && vm.gpu && !target.gpu && <span className="w-full text-xs text-amber-600 dark:text-amber-400">This plan has no GPU — the {vm.gpu.model} will be detached.</span>}
          </div>
          <Button variant="primary" icon={Scaling} disabled={!canRescale || unchanged} loading={m.isPending} onClick={submit} className="shrink-0">
            {running ? 'Rescale & restart' : 'Rescale'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
