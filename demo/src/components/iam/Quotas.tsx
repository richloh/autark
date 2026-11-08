import { Cpu, MemoryStick, Server, HardDrive, Database, Boxes, PackageOpen, Globe2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { NumberInput } from '@/components/ui/form';
import { num } from '@/lib/format';
import type { QuotaKey } from '@/types';

export const QUOTAS: { key: QuotaKey; label: string; unit: string; icon: LucideIcon; step: number }[] = [
  { key: 'vcpus', label: 'vCPUs', unit: 'vCPU', icon: Cpu, step: 8 },
  { key: 'ramGB', label: 'Memory', unit: 'GB', icon: MemoryStick, step: 32 },
  { key: 'vms', label: 'Virtual machines', unit: 'VMs', icon: Server, step: 5 },
  { key: 'volumesGB', label: 'Block storage', unit: 'GB', icon: HardDrive, step: 500 },
  { key: 'dbInstances', label: 'Databases', unit: 'DBs', icon: Database, step: 1 },
  { key: 'k8sClusters', label: 'Kubernetes clusters', unit: 'clusters', icon: Boxes, step: 1 },
  { key: 'buckets', label: 'Buckets', unit: 'buckets', icon: PackageOpen, step: 5 },
  { key: 'publicIps', label: 'Public IPs', unit: 'IPs', icon: Globe2, step: 5 },
];

const tone = (r: number) => (r >= 0.9 ? 'bg-rose-500' : r >= 0.75 ? 'bg-amber-500' : 'bg-brand-500');

/** One quota: used vs limit bar. In edit mode the limit becomes a number input; draft shows the delta. */
export function QuotaRow({ q, used, limit, draft, onDraft, error }: { q: (typeof QUOTAS)[number]; used: number; limit: number; draft?: number; onDraft?: (v: number) => void; error?: string }) {
  const lim = draft ?? limit;
  const r = lim > 0 ? used / lim : used > 0 ? 1 : 0;
  const Icon = q.icon;
  const changed = draft != null && draft !== limit;
  return (
    <div className="grid [&>*]:min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-2.5 @min-[36rem]:grid-cols-[180px_minmax(0,1fr)_auto]">
      <div className="flex items-center gap-2 text-[13px] text-fg-2"><Icon className="size-4 text-faint" />{q.label}</div>
      <div className="order-3 col-span-2 @min-[36rem]:order-none @min-[36rem]:col-span-1">
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-3">
          <div className={cn('h-full rounded-full transition-all duration-500', tone(r))} style={{ width: `${Math.min(1, r) * 100}%` }} />
          {changed && limit > 0 && <span className="absolute inset-y-0 w-0.5 bg-fg/50" style={{ left: `${Math.min(100, (limit / Math.max(lim, limit)) * 100)}%` }} title={`Current limit ${limit}`} />}
        </div>
        {error && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 text-right text-[13px]">
        {onDraft ? (
          <>
            <span className="tabular text-muted">{num(used)} /</span>
            <NumberInput value={lim} onChange={onDraft} min={used} step={q.step} className="w-32" invalid={!!error} />
          </>
        ) : (
          <span className="tabular"><span className={cn('font-medium', r >= 0.9 ? 'text-rose-600 dark:text-rose-400' : 'text-fg')}>{num(used)}</span><span className="text-muted"> / {num(limit)} {q.unit}</span></span>
        )}
      </div>
    </div>
  );
}

/** Compact cluster of mini meters for list rows. */
export function QuotaMini({ usage, quotas, keys = ['vcpus', 'ramGB', 'vms', 'volumesGB'] }: { usage?: Record<QuotaKey, number>; quotas: Record<QuotaKey, number>; keys?: QuotaKey[] }) {
  return (
    <div className="grid [&>*]:min-w-0 grid-cols-2 gap-x-3 gap-y-1.5">
      {keys.map((k) => {
        const q = QUOTAS.find((x) => x.key === k)!;
        const used = usage?.[k] ?? 0;
        const r = quotas[k] > 0 ? used / quotas[k] : 0;
        return (
          <div key={k} title={`${q.label}: ${used} / ${quotas[k]} ${q.unit}`}>
            <div className="flex justify-between text-[10.5px] text-muted"><span>{q.label === 'Virtual machines' ? 'VMs' : q.label === 'Block storage' ? 'Storage' : q.label}</span><span className="tabular">{Math.round(r * 100)}%</span></div>
            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-surface-3"><div className={cn('h-full rounded-full', tone(r))} style={{ width: `${Math.min(1, r) * 100}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}
