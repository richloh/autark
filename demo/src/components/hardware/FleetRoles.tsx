import { Database, Scale, AlertTriangle } from 'lucide-react';
import { useGet } from '@/api/hooks';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { num } from '@/lib/format';
import { hostRoles, isRestricted, ROLE_META } from '@/lib/hostPolicy';
import { HOST_ROLES, type BareMetalHost, type HostRole } from '@/types';
import { ROLE_ICON, ROLE_HEX } from './policy';
import { hostUtil, flag, utilColor } from './visuals';

export interface StoragePool {
  locationId: string; locationName: string; country: string; replication: number;
  hosts: { id: string; name: string; status: string; rawTB: number; disks: number; up: boolean }[]; hostsUp: number;
  rawTB: number; usableTB: number; usedTB: number; volumesTB: number; bucketsTB: number; pct: number | null; health: 'none' | 'degraded' | 'nearfull' | 'ok';
}

export function useStoragePools() {
  return useGet<{ items: StoragePool[] }>(['hosts', 'storage-pools'], '/hosts/storage-pools');
}

type Managed = { kind: 'db' | 'k8s' | 'k8s-cp' | 'lb'; vcpus: number; ramGB: number };
const KIND_ROLE: Record<Managed['kind'], HostRole> = { db: 'compute', k8s: 'k8s-worker', 'k8s-cp': 'k8s-control-plane', lb: 'load-balancer' };

/** Pro fleet summary: capacity per workload role + Ceph pool usage per location. */
export function FleetRoles({ hosts, locationFilter = 'all', className, onRole }: { hosts: BareMetalHost[]; locationFilter?: string; className?: string; onRole?: (r: HostRole) => void }) {
  const { data } = useStoragePools();
  const pools = (data?.items ?? []).filter((p) => locationFilter === 'all' || p.locationId === locationFilter);
  const rows = HOST_ROLES.filter((r) => r !== 'storage').map((r) => {
    const list = hosts.filter((h) => h.hypervisor === 'KVM' && hostRoles(h).includes(r));
    const ready = list.filter((h) => h.status === 'ready');
    const cap = ready.reduce((a, h) => a + hostUtil(h).cap.vcpus, 0);
    let used = 0;
    for (const h of list) {
      const managed: Managed[] = (h.allocated as any)?.managedItems ?? [];
      used += managed.filter((m) => KIND_ROLE[m.kind] === r).reduce((a, m) => a + m.vcpus, 0);
      if (r === 'compute') used += (h.vms ?? []).reduce((a, v) => a + v.vcpus, 0);
    }
    return { role: r, hosts: list.length, ready: ready.length, reserved: list.filter(isRestricted).length, cap, used };
  });
  return (
    <div className={cn('grid gap-5 @min-[60rem]:grid-cols-2', className)}>
      <Card>
        <CardHeader icon={Scale} title="Capacity by role" description="vCPU used by each workload type vs. capacity of ready hosts with that role (hosts can serve several roles)." />
        <ul className="divide-y divide-line">
          {rows.map((x) => {
            const Icon = ROLE_ICON[x.role];
            const r = x.cap ? x.used / x.cap : 0;
            return (
              <li key={x.role}>
                <button type="button" onClick={() => onRole?.(x.role)} disabled={!onRole} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2/60 disabled:hover:bg-transparent">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md" style={{ background: `${ROLE_HEX[x.role]}1a`, color: ROLE_HEX[x.role] }}><Icon className="size-3.5" /></span>
                  <span className="w-36 min-w-0 shrink-0">
                    <span className="block truncate text-[13px] font-medium text-fg">{ROLE_META[x.role].short}</span>
                    <span className="block text-[11px] text-muted">{x.hosts ? `${x.ready}/${x.hosts} hosts ready${x.reserved ? ` · ${x.reserved} reserved` : ''}` : 'no hosts'}</span>
                  </span>
                  {x.hosts ? (
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, r * 100)}%`, background: utilColor(r) }} /></span>
                      <span className="w-24 shrink-0 text-right text-[11px] tabular text-fg-2">{num(x.used)} / {num(x.cap)} vCPU</span>
                    </span>
                  ) : <span className="flex-1 text-right text-[11px] text-amber-600 dark:text-amber-400">nothing can be scheduled</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card>
        <CardHeader icon={Database} title="Ceph storage pools" description="Formed by hosts with the Storage role · 3× replication (usable ≈ raw / 3)." />
        <div className="space-y-4 p-4">
          {pools.map((p) => <PoolRow key={p.locationId} p={p} />)}
          {!pools.length && <p className="text-[13px] text-muted">No self-hosted locations.</p>}
        </div>
      </Card>
    </div>
  );
}

export function PoolRow({ p }: { p: StoragePool }) {
  const r = p.pct ?? 0;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[13px]">
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-fg"><span>{flag(p.country)}</span><span className="truncate">{p.locationName}</span></span>
        {p.health === 'none' ? <Badge tone="warning">no storage hosts</Badge>
          : p.health === 'degraded' ? <Badge tone="warning" title="3× replication needs at least 3 storage hosts up">{p.hostsUp}/3 hosts up</Badge>
          : p.health === 'nearfull' ? <Badge tone="danger">near full</Badge>
          : <Badge tone="success">healthy</Badge>}
      </div>
      {p.hosts.length ? (
        <>
          <div className="relative h-2.5 overflow-hidden rounded-full bg-surface-3">
            <div className="absolute inset-y-0 left-0 bg-[#d97706]/80" style={{ width: `${Math.min(100, (p.volumesTB / Math.max(0.01, p.usableTB)) * 100)}%` }} />
            <div className="absolute inset-y-0 bg-[#d97706]/40" style={{ left: `${Math.min(100, (p.volumesTB / Math.max(0.01, p.usableTB)) * 100)}%`, width: `${Math.min(100, (p.bucketsTB / Math.max(0.01, p.usableTB)) * 100)}%` }} />
          </div>
          <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-[11px] text-muted">
            <span className="tabular"><b className="font-semibold text-fg-2">{p.usedTB.toFixed(1)}</b> of {p.usableTB.toFixed(1)} TB usable ({Math.round(r * 100)}%) · {p.volumesTB.toFixed(1)} volumes · {p.bucketsTB.toFixed(1)} buckets</span>
            <span className="tabular">{p.hosts.length} host{p.hosts.length > 1 ? 's' : ''} · {p.rawTB.toFixed(1)} TB raw</span>
          </div>
        </>
      ) : (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-px size-3 shrink-0" />
          <span>{p.usedTB ? `${p.usedTB.toFixed(1)} TB of volumes & buckets but no host has the Storage role. ` : ''}Give at least 3 hosts the Storage role.</span>
        </p>
      )}
    </div>
  );
}
