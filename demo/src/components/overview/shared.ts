import { useMemo } from 'react';
import { useGet, useList } from '@/api/hooks';
import type {
  VM, BareMetalHost, DbInstance, K8sCluster, Bucket, LoadBalancer, Network, Location, CloudProvider, Certificate, Volume, IpAddress,
} from '@/types';

/* Shared helpers for the overview pages (dashboard, cost explorer, activity, developer). */

export type ServiceKey = 'compute' | 'storage' | 'network' | 'db' | 'k8s' | 'objectStorage' | 'loadBalancers';

/** Fixed colour per service (entity-bound, never re-assigned by rank). */
export const SERVICE_COLOR: Record<string, string> = {
  compute: '#5b67f8', k8s: '#06b6d4', db: '#a855f7', storage: '#f59e0b', objectStorage: '#10b981', network: '#ec4899', loadBalancers: '#64748b',
};
export const SERVICE_LABEL: Record<string, string> = {
  compute: 'Compute', storage: 'Block storage', network: 'Networking', db: 'Databases', k8s: 'Kubernetes', objectStorage: 'Object storage', loadBalancers: 'Load balancers',
};
export const SERVICE_ORDER: string[] = ['compute', 'k8s', 'db', 'storage', 'objectStorage', 'network', 'loadBalancers'];
export const serviceColor = (s: string) => SERVICE_COLOR[s] ?? '#94a3b8';

/**
 * Rough on-demand price multipliers of a US hyperscaler vs. Autark on owned/rented hardware.
 * Source: Autark manifest (K8s ~15×, databases ~8×, compute ~4×); storage/network/LB are conservative guesses.
 */
export const HYPERSCALER_MULTIPLIER: Record<string, number> = {
  compute: 4, k8s: 15, db: 8, storage: 3, objectStorage: 3, network: 3, loadBalancers: 4,
};

/* ---------------------------------------------------------------- API response types */

export interface CostSummary {
  currency: string; total: number; mtd: number; forecast: number; lastMonth: number; budget: number;
  byService: { service: string; label: string; monthly: number }[];
  byProject: { projectId: string; name: string; color: string; monthly: number; budget: number; allowanceId?: string }[];
  byLocation: { locationId: string; monthly: number }[];
  top: CostItem[];
  dayOfMonth: number; daysInMonth: number;
}
export interface CostItem { type: string; id: string; name: string; projectId: string; accountId: string; locationId?: string; service: string; monthly: number }
export interface CostHistory {
  groupBy: 'service' | 'project'; days: number;
  series: { key: string; label: string; points: { t: number; v: number }[] }[];
  forecast: { key: string; points: { t: number; v: number }[] }[];
}

export function useCostSummary() {
  return useGet<CostSummary>(['costs', 'summary'], '/costs/summary');
}
export function useCostHistory(days: number, groupBy: 'service' | 'project', forecast = 0) {
  return useGet<CostHistory>(['costs', 'history'], `/costs/history?days=${days}&groupBy=${groupBy}&forecast=${forecast}`);
}

/* ---------------------------------------------------------------- geography */

export const COUNTRY_NAME: Record<string, string> = {
  DE: 'Germany', NL: 'Netherlands', FI: 'Finland', FR: 'France', IE: 'Ireland', US: 'United States', GB: 'United Kingdom', PL: 'Poland', AT: 'Austria',
  CH: 'Switzerland', SE: 'Sweden', ES: 'Spain', IT: 'Italy', BE: 'Belgium', DK: 'Denmark', NO: 'Norway', SG: 'Singapore', CA: 'Canada', LU: 'Luxembourg',
};
export const EU_COUNTRIES = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);
/** Legal home of each provider kind (decides CLOUD-Act exposure, independent of region). */
export const PROVIDER_HQ: Record<string, string> = { hetzner: 'DE', ovh: 'FR', scaleway: 'FR', ionos: 'DE', aws: 'US', openstack: 'self' };

export function flag(country: string | undefined): string {
  if (!country || country.length !== 2) return '';
  return String.fromCodePoint(...[...country.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/* ---------------------------------------------------------------- capacity */

export interface Capacity { vcpus: number; ramGB: number; gpus: number }

/** Mirrors the backend's host capacity rule (threads × overcommit, 8 % RAM reserved for the hypervisor). */
export function hostCapacity(h: BareMetalHost): Capacity {
  return {
    vcpus: (h.threads ?? 0) * (h.cpuOvercommit ?? 1),
    ramGB: Math.floor((h.ramGB ?? 0) * (h.ramOvercommit ?? 1) * 0.92),
    gpus: (h.gpus ?? []).reduce((a, g) => a + g.count, 0),
  };
}

export interface LocationCapacity {
  locationId: string;
  hosts: { total: number; ready: number; maintenance: number; offline: number; other: number };
  capacity: Capacity;
  allocated: Capacity & { vms: number };
}

/** Optional backend aggregate (GET /overview/capacity, see handlers/overview.ts); null when not available. */
export function useCapacityEndpoint() {
  return useGet<{ locations: LocationCapacity[] }>(['hosts', 'overview-capacity'], '/overview/capacity');
}

/** Per-location capacity. Uses the server aggregate when present, else derives it from hosts + visible VMs. */
export function computeCapacity(hosts: BareMetalHost[], vms: VM[]): LocationCapacity[] {
  const byLoc = new Map<string, LocationCapacity>();
  const allocByHost = new Map<string, Capacity & { vms: number }>();
  for (const v of vms) {
    if (!v.hostId || v.status === 'deleting') continue;
    const a = allocByHost.get(v.hostId) ?? { vcpus: 0, ramGB: 0, gpus: 0, vms: 0 };
    a.vcpus += v.size?.vcpus ?? 0; a.ramGB += v.size?.ramGB ?? 0; a.gpus += v.gpu?.count ?? 0; a.vms++;
    allocByHost.set(v.hostId, a);
  }
  for (const h of hosts) {
    const l = byLoc.get(h.locationId) ?? { locationId: h.locationId, hosts: { total: 0, ready: 0, maintenance: 0, offline: 0, other: 0 }, capacity: { vcpus: 0, ramGB: 0, gpus: 0 }, allocated: { vcpus: 0, ramGB: 0, gpus: 0, vms: 0 } };
    l.hosts.total++;
    if (h.status === 'ready') l.hosts.ready++;
    else if (h.status === 'maintenance' || h.status === 'draining') l.hosts.maintenance++;
    else if (h.status === 'offline' || h.status === 'error') l.hosts.offline++;
    else l.hosts.other++;
    // only schedulable hosts contribute capacity
    if (h.status === 'ready' || h.status === 'draining' || h.status === 'maintenance') {
      const c = hostCapacity(h);
      l.capacity.vcpus += c.vcpus; l.capacity.ramGB += c.ramGB; l.capacity.gpus += c.gpus;
    }
    const a = h.allocated ?? allocByHost.get(h.id);
    if (a) { l.allocated.vcpus += a.vcpus; l.allocated.ramGB += a.ramGB; l.allocated.gpus += a.gpus; l.allocated.vms += a.vms }
    byLoc.set(h.locationId, l);
  }
  return [...byLoc.values()];
}

/* ---------------------------------------------------------------- fleet data */

/** All inventory needed by the overview, loaded in parallel and scoped by the API. */
export function useFleet() {
  const vms = useList<VM>('vms');
  const hosts = useList<BareMetalHost>('hosts');
  const dbs = useList<DbInstance>('dbInstances');
  const k8s = useList<K8sCluster>('k8sClusters');
  const buckets = useList<Bucket>('buckets');
  const lbs = useList<LoadBalancer>('loadBalancers');
  const networks = useList<Network>('networks');
  const locations = useList<Location>('locations');
  const providers = useList<CloudProvider>('providers');
  const certs = useList<Certificate>('certificates');
  const volumes = useList<Volume>('volumes');
  const ips = useList<IpAddress>('ips');
  const loading = vms.isLoading || locations.isLoading;
  return useMemo(() => ({
    vms: vms.items, hosts: hosts.items, dbs: dbs.items, k8s: k8s.items, buckets: buckets.items, lbs: lbs.items, networks: networks.items,
    locations: locations.items, providers: providers.items, certs: certs.items, volumes: volumes.items, ips: ips.items, loading,
  }), [vms.items, hosts.items, dbs.items, k8s.items, buckets.items, lbs.items, networks.items, locations.items, providers.items, certs.items, volumes.items, ips.items, loading]);
}
export type Fleet = ReturnType<typeof useFleet>;

export interface LocWorkload { vms: number; dbs: number; k8s: number; buckets: number; lbs: number; total: number; vcpus: number }

/** Workload counts per location (VMs, DBs, clusters, buckets, LBs). */
export function workloadsByLocation(f: Fleet) {
  const m = new Map<string, LocWorkload>();
  const get = (id: string) => {
    let x = m.get(id);
    if (!x) { x = { vms: 0, dbs: 0, k8s: 0, buckets: 0, lbs: 0, total: 0, vcpus: 0 }; m.set(id, x) }
    return x;
  };
  for (const v of f.vms) { const x = get(v.locationId); x.vms++; x.total++; if (v.status === 'running') x.vcpus += v.size?.vcpus ?? 0 }
  for (const d of f.dbs) { const x = get(d.locationId); x.dbs++; x.total++; x.vcpus += d.size?.vcpus ?? 0 }
  for (const k of f.k8s) { const x = get(k.locationId); x.k8s++; x.total++; x.vcpus += (k.nodePools ?? []).reduce((a, p) => a + p.vcpus * p.count, 0) }
  for (const b of f.buckets) { const x = get(b.locationId); x.buckets++; x.total++ }
  for (const l of f.lbs) { const x = get(l.locationId); x.lbs++; x.total++ }
  return m;
}

/* ---------------------------------------------------------------- health */

export type Severity = 'critical' | 'warning';
export interface Issue { id: string; severity: Severity; label: string; detail: string; link: string; locationId?: string }

const DAY = 86_400_000;

export function collectIssues(f: Fleet, summary?: CostSummary): Issue[] {
  const out: Issue[] = [];
  for (const v of f.vms.filter((v) => v.status === 'error')) out.push({ id: `vm-${v.id}`, severity: 'critical', label: 'VM in error', detail: v.name, link: `/infrastructure/vms/${v.id}`, locationId: v.locationId });
  for (const h of f.hosts.filter((h) => h.status === 'offline' || h.status === 'error')) out.push({ id: `host-${h.id}`, severity: 'critical', label: `Host ${h.status}`, detail: h.name, link: `/hardware/bare-metals/${h.id}`, locationId: h.locationId });
  for (const h of f.hosts.filter((h) => h.status === 'maintenance')) out.push({ id: `hostm-${h.id}`, severity: 'warning', label: 'Host in maintenance', detail: h.name, link: `/hardware/bare-metals/${h.id}`, locationId: h.locationId });
  for (const l of f.lbs.filter((l) => l.status === 'degraded' || l.status === 'error')) out.push({ id: `lb-${l.id}`, severity: l.status === 'error' ? 'critical' : 'warning', label: `Load balancer ${l.status}`, detail: l.name, link: `/managed-services/load-balancers/${l.id}`, locationId: l.locationId });
  for (const k of f.k8s.filter((k) => k.status === 'degraded' || k.status === 'error')) out.push({ id: `k8s-${k.id}`, severity: k.status === 'error' ? 'critical' : 'warning', label: `Cluster ${k.status}`, detail: k.name, link: `/managed-services/kubernetes/${k.id}`, locationId: k.locationId });
  for (const d of f.dbs.filter((d) => d.status === 'error')) out.push({ id: `db-${d.id}`, severity: 'critical', label: 'Database in error', detail: d.name, link: `/managed-services/db/${d.id}`, locationId: d.locationId });
  for (const c of f.certs) {
    const left = Date.parse(c.expiresAt) - Date.now();
    if (c.status === 'failed') out.push({ id: `cert-${c.id}`, severity: 'critical', label: 'Certificate failed', detail: c.domains?.[0] ?? c.name, link: '/managed-services/load-balancers?tab=certificates' });
    else if (c.status === 'expiring' || (left < 21 * DAY && !c.autoRenew)) out.push({ id: `cert-${c.id}`, severity: left < 7 * DAY ? 'critical' : 'warning', label: 'Certificate expiring', detail: `${c.domains?.[0] ?? c.name} · ${Math.max(0, Math.round(left / DAY))}d`, link: '/managed-services/load-balancers?tab=certificates' });
  }
  for (const p of f.providers.filter((p) => p.status === 'error')) {
    const loc = f.locations.find((l) => l.providerId === p.id);
    out.push({ id: `prov-${p.id}`, severity: 'critical', label: 'Provider error', detail: p.name, link: `/hardware/cloud-providers/${p.id}`, locationId: loc?.id });
  }
  for (const p of summary?.byProject ?? []) {
    if (!p.budget) continue;
    const ratio = p.monthly / p.budget;
    if (ratio >= 0.8) out.push({ id: `budget-${p.projectId}`, severity: ratio >= 1 ? 'critical' : 'warning', label: ratio >= 1 ? 'Over budget' : 'Budget alert', detail: `${p.name} · ${Math.round(ratio * 100)}%`, link: p.allowanceId ? `/iam/project-allowances/${p.allowanceId}` : '/iam/project-allowances' });
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));
}

/* ---------------------------------------------------------------- files */

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export function downloadFile(filename: string, content: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const todayStamp = () => new Date().toISOString().slice(0, 10);
