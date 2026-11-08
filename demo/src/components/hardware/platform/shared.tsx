import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { PlatformCluster, SpaceQuota, K8sSpace } from '@/types';

/* Shared types & visuals for the provider's platform-cluster pages. */

export interface PlatformClusterView extends PlatformCluster {
  cordonedNodes?: string[];
  promisable?: { cpuCores: number; memoryGi: number };
  nodes?: { workers: number; ready: number; controlPlane: number };
  tenantAccounts?: number;
  upgradeAvailable?: string | null;
  health?: { component: string; status: 'healthy' | 'degraded' | 'down' | 'pending'; detail: string }[];
}

export interface TenantRow {
  id: string; name: string; accountId: string; accountName: string; projectId: string; projectName: string; projectColor?: string;
  namespace: string; quota: SpaceQuota; used: SpaceQuota; status: K8sSpace['status']; createdAt: string; monthlyCost: number; workloads: number; incoming?: boolean;
}

export interface PlatformNodeRow {
  name: string; role: 'worker' | 'control-plane'; poolId: string | null; poolName: string; index: number;
  status: 'Ready' | 'Provisioning' | 'Draining' | 'Upgrading' | 'SchedulingDisabled';
  cordoned: boolean; vcpus: number; ramGB: number; version: string; internalIp: string; hostId: string | null; hostName: string | null;
  allocatable: { cpuCores: number; memoryGi: number; pods: number }; requested: { cpuCores: number; memoryGi: number }; pods: number;
}

export const SYSTEM_RESERVE = 0.1;
export const PC_COLOR = '#326ce5';
export const USED_COLOR = '#326ce5';
export const PROMISED_COLOR = '#93b4f5';
export const OVER_COLOR = '#f59e0b';

/** 1.5 → "1.5", 12.25 → "12.3", 3 → "3" */
export const n1 = (n: number | undefined) => {
  const v = n ?? 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(v < 10 ? 2 : 1).replace(/\.?0+$/, '');
};

export function capacityOf(pc: PlatformClusterView) {
  return pc.capacity ?? { cpuCores: 0, memoryGi: 0 };
}
export function promisableOf(pc: PlatformClusterView) {
  const c = capacityOf(pc);
  return pc.promisable ?? { cpuCores: c.cpuCores * pc.overcommit.cpu, memoryGi: c.memoryGi * pc.overcommit.memory };
}

/**
 * Three-segment capacity bar: used (requests of running pods) ⊂ promised (sum of tenant quotas),
 * drawn against the promisable limit (allocatable × overcommit). A tick marks the 1:1 allocatable line,
 * so the overcommitted zone is visible at a glance.
 */
export function CapacityBar({ label, unit, capacity, overcommit, promised, used, size = 'md', className, legend = true }: {
  label?: ReactNode; unit: string; capacity: number; overcommit: number; promised: number; used: number; size?: 'sm' | 'md'; className?: string; legend?: boolean;
}) {
  const limit = capacity * overcommit;
  const basis = Math.max(limit, promised, used, 0.0001);
  const pct = (v: number) => `${Math.min(100, (v / basis) * 100)}%`;
  const capPct = Math.min(100, (capacity / basis) * 100);
  const promisedRatio = limit ? promised / limit : 0;
  const overPromised = promised > capacity;
  return (
    <div className={className}>
      {label != null && (
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-[13px] font-medium text-fg">{label}</span>
          <span className="text-xs tabular text-muted">
            <span className={cn('font-semibold', promisedRatio >= 0.95 ? 'text-rose-500' : promisedRatio >= 0.8 ? 'text-amber-500' : 'text-fg')}>{n1(promised)}</span> of {n1(limit)} {unit} promised
          </span>
        </div>
      )}
      <div className={cn('relative', size === 'sm' ? 'h-2' : 'h-3.5')}>
        <div className="absolute inset-0 overflow-hidden rounded-full bg-surface-3">
          {/* promised beyond 1:1 capacity is overcommitted */}
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(promised), background: overPromised ? `linear-gradient(90deg, ${PROMISED_COLOR} 0 ${(capacity / Math.max(promised, 0.0001)) * 100}%, ${OVER_COLOR} ${(capacity / Math.max(promised, 0.0001)) * 100}% 100%)` : PROMISED_COLOR, opacity: 0.85 }} />
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(used), background: USED_COLOR }} />
        </div>
        {overcommit > 1 && (
          <div className="absolute -inset-y-1 w-0 border-l-2 border-dashed border-fg-2/70" style={{ left: `${capPct}%` }} title={`Allocatable ${n1(capacity)} ${unit} (1:1)`} />
        )}
      </div>
      {legend && (
        <div className={cn('mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 tabular text-muted', size === 'sm' ? 'text-[10.5px]' : 'text-[11px]')}>
          <span className="flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: USED_COLOR }} />Used {n1(used)}</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: PROMISED_COLOR }} />Promised {n1(promised)}</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-0 border-l-2 border-dashed border-fg-2/70" />Capacity {n1(capacity)}</span>
          {overcommit > 1 && <span>×{overcommit} = {n1(limit)} {unit}</span>}
        </div>
      )}
    </div>
  );
}

/** Concentric gauge: outer ring = promised of promisable, inner ring = used of capacity. */
export function PromiseGauge({ title, unit, capacity, overcommit, promised, used, size = 148 }: {
  title: string; unit: string; capacity: number; overcommit: number; promised: number; used: number; size?: number;
}) {
  const limit = capacity * overcommit;
  const c = size / 2;
  const ring = (r: number, frac: number, color: string, w: number) => {
    const circ = 2 * Math.PI * r;
    const f = Math.max(0, Math.min(1, frac));
    return (
      <>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={w} />
        <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeDasharray={`${circ * f} ${circ}`} transform={`rotate(-90 ${c} ${c})`} style={{ transition: 'stroke-dasharray .6s ease' }} />
      </>
    );
  };
  const pPct = limit ? promised / limit : 0;
  const uPct = capacity ? used / capacity : 0;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${title}: ${Math.round(pPct * 100)}% promised, ${Math.round(uPct * 100)}% used`}>
        {ring(c - 9, pPct, pPct > 1 ? '#f43f5e' : PROMISED_COLOR, 12)}
        {ring(c - 25, uPct, USED_COLOR, 10)}
        <text x={c} y={c - 3} textAnchor="middle" className="fill-fg text-[20px] font-semibold tabular">{Math.round(pPct * 100)}%</text>
        <text x={c} y={c + 14} textAnchor="middle" className="fill-muted text-[10px]">promised</text>
      </svg>
      <div className="text-center">
        <div className="text-[13px] font-medium text-fg">{title}</div>
        <div className="text-[11px] tabular text-muted">{n1(used)} used · {n1(promised)} promised · {n1(capacity)} {unit}</div>
      </div>
    </div>
  );
}

/** Tiny used/quota bar for tenant tables. */
export function QuotaMini({ used, quota, unit }: { used: number; quota: number; unit: string }) {
  const r = quota ? used / quota : 0;
  return (
    <div className="w-24">
      <div className="flex justify-between text-[11px] tabular"><span className="text-fg-2">{n1(used)}</span><span className="text-faint">/ {n1(quota)} {unit}</span></div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, r * 100)}%`, background: r >= 0.9 ? '#f43f5e' : r >= 0.75 ? '#f59e0b' : '#10b981' }} />
      </div>
    </div>
  );
}

export const DAYS: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
