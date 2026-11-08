import { Gauge, Timer, Zap } from 'lucide-react';
import { cn } from '@/lib/cn';
import { num } from '@/lib/format';
import { VOLUME_LIMITS, maxIopsFor, type VolumeType } from '@/types';

/** "Good for" hints derived from the performance envelope. */
export function goodFor(type: VolumeType, iops: number, tp: number): string[] {
  const out: string[] = [];
  if (type === 'hdd') out.push('Backups & archives', 'Datasets / sequential reads');
  if (iops >= 10000) out.push('OLTP databases (PostgreSQL, MySQL)');
  if (iops >= 30000) out.push('High-concurrency key/value stores');
  if (tp >= 500) out.push('Analytics & ML training data');
  if (type !== 'hdd' && iops < 10000) out.push('Boot / app data', 'Logs & caches');
  if (type === 'nvme' && iops >= 20000) out.push('Message queues (Kafka WAL)');
  return [...new Set(out)].slice(0, 4);
}

/** Estimated average latency in ms (lower with more provisioned IOPS headroom). */
export function estLatency(type: VolumeType, iops: number, sizeGB: number): number {
  const l = VOLUME_LIMITS[type];
  const headroom = iops / Math.max(1, maxIopsFor(type, sizeGB));
  return Math.round(l.latencyMs * (1.25 - headroom * 0.35) * 100) / 100;
}

function Bar({ label, value, max, typeMax, unit, color, icon: Icon }: { label: string; value: number; max: number; typeMax: number; unit: string; color: string; icon: typeof Gauge }) {
  const pct = (value / typeMax) * 100;
  const cap = (max / typeMax) * 100;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-muted"><Icon className="size-3.5" />{label}</span>
        <span className="tabular font-medium text-fg">{num(value)} <span className="font-normal text-muted">{unit}</span></span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-surface-3">
        <div className="absolute inset-y-0 left-0 rounded-full bg-line-strong/50" style={{ width: `${cap}%` }} title={`Max for this size: ${num(max)} ${unit}`} />
        <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-300" style={{ width: `${Math.max(2, pct)}%`, background: color }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-faint"><span>0</span><span>size limit {num(max)}</span><span>type max {num(typeMax)}</span></div>
    </div>
  );
}

/** Visualizes provisioned IOPS / throughput against the type envelope plus est. latency. */
export function PerformanceVisual({ type, sizeGB, iops, throughputMBps, className }: { type: VolumeType; sizeGB: number; iops: number; throughputMBps: number; className?: string }) {
  const l = VOLUME_LIMITS[type];
  const lat = estLatency(type, iops, sizeGB);
  const hints = goodFor(type, iops, throughputMBps);
  const tier = iops >= 30000 ? 'Extreme' : iops >= 10000 ? 'High' : iops > l.minIops ? 'Boosted' : 'Baseline';
  return (
    <div className={cn('rounded-xl border border-line bg-surface-2/40 p-4', className)}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-medium text-fg">Performance profile</span>
        <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-semibold', tier === 'Extreme' ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300' : tier === 'High' ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300' : 'bg-surface-3 text-fg-2')}>{tier}</span>
      </div>
      <div className="space-y-3">
        <Bar label="IOPS" value={iops} max={maxIopsFor(type, sizeGB)} typeMax={l.maxIops} unit="IOPS" color="#5b67f8" icon={Zap} />
        <Bar label="Throughput" value={throughputMBps} max={l.maxTp} typeMax={l.maxTp} unit="MB/s" color="#06b6d4" icon={Gauge} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-surface p-2.5">
          <div className="flex items-center gap-1 text-[11px] text-muted"><Timer className="size-3" />Est. latency</div>
          <div className="text-base font-semibold tabular text-fg">{lat < 1 ? `${Math.round(lat * 1000)} µs` : `${lat} ms`}</div>
        </div>
        <div className="rounded-lg bg-surface p-2.5">
          <div className="text-[11px] text-muted">4K random ops/s ≈</div>
          <div className="text-base font-semibold tabular text-fg">{num(Math.round((iops * 4) / 1024))} MB/s</div>
        </div>
      </div>
      {hints.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-medium text-muted">Good for</div>
          <div className="flex flex-wrap gap-1">{hints.map((h) => <span key={h} className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] text-fg-2">{h}</span>)}</div>
        </div>
      )}
    </div>
  );
}
