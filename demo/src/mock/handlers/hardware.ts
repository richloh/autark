import { db } from '../db';
import { defineCollection, route, collections, ApiError, validate, nameError, newId, nowIso, getOr404, notify, type Ctx } from '../framework';
import { startOperation, onOperationComplete, transition, type StepSpec } from '../operations';
import { registerMetrics, generateSeries, type MetricProfile } from '../metrics';
import { hostAllocation, hostCapacity, pickHost, managedPlacements, workloadFor, policyNames, type ManagedItem } from './shared';
import { hostRoles, hostAccess, policyReason, policyErrors, normaliseAccess, ROLE_META, accessSummary } from '@/lib/hostPolicy';
import { vmComputeCost } from './costs';
import { hashString, mulberry32 } from '@/lib/random';
import type {
  BareMetalHost, CloudProvider, VM, Location, Operation, HostDisk, HostNic, HostProbe, HostSensors, HostVmSummary, EvacuationPlan, EvacuationMove,
  ProviderCatalogEntry, ProviderKind, ProviderRegion, IpAddress, IpPool, HostHealthCheck, HostRole, HostAccess, Account, Project, Volume,
} from '@/types';

/* Hardware: bare metal hosts (the physical fleet that VMs are scheduled on) and cloud providers
 * (burst capacity exposed as extra locations). Hosts are global, not project scoped. */

const ms = (n: number) => n * 1000;
export const LATEST_AGENT = '0.9.4';

/* ================================================================================================
 * Helpers
 * ============================================================================================== */

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const isIPv4 = (s: unknown): s is string => typeof s === 'string' && IPV4_RE.test(s);

function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

function hostVms(hostId: string): VM[] {
  return db.filter<VM>('vms', (v) => v.hostId === hostId && v.status !== 'deleting');
}

function vmSummary(v: VM): HostVmSummary {
  return { id: v.id, name: v.name, status: v.status, projectId: v.projectId, accountId: v.accountId, vcpus: v.size.vcpus, ramGB: v.size.ramGB, gpus: v.gpu?.count ?? 0, diskGB: v.size.systemDiskGB };
}

/** Nameplate power draw estimate (used when a powered-off host is turned back on). */
function ratedWatts(h: Pick<BareMetalHost, 'cpuCores' | 'gpus' | 'disks'>): number {
  return 180 + h.cpuCores * 6 + h.gpus.reduce((a, g) => a + g.count * 240, 0) + h.disks.length * 8;
}

function rackConflict(locationId: string, rack: string, unit: number, sizeU: number, exceptId?: string): BareMetalHost | undefined {
  const top = unit + sizeU - 1;
  return db.find<BareMetalHost>('hosts', (h) => h.id !== exceptId && h.locationId === locationId && h.rack.toLowerCase() === rack.toLowerCase()
    && h.rackUnit <= top && h.rackUnit + h.sizeU - 1 >= unit);
}

function maskSecret(v: string): string {
  const s = String(v ?? '');
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0, 4)}••••••••${s.slice(-4)}`;
}

function runningOpFor(targetId: string): Operation | undefined {
  return db.find<Operation>('operations', (o) => o.target.id === targetId && o.status === 'running');
}

function requireNoOp(id: string, what: string) {
  const op = runningOpFor(id);
  if (op) throw new ApiError(409, `${what} is busy: "${op.title}" is still running. Wait for it to finish.`, 'operation_in_progress');
}

function requireHostStatus(h: BareMetalHost, allowed: BareMetalHost['status'][], verb: string) {
  if (!allowed.includes(h.status)) throw new ApiError(409, `Cannot ${verb} ${h.name} while it is ${h.status}`, 'invalid_state');
}

/* ================================================================================================
 * Inventory (simulated Redfish discovery)
 * ============================================================================================== */

interface InventoryTemplate {
  vendor: string; model: string; sizeU: number; cpuModel: string; sockets: number; cpuCores: number; ramGB: number;
  disks: [HostDisk['type'], number][]; gpus: { model: string; count: number }[]; nicGbps: number; fw: { bios: string; bmc: string; nic: string }; bmcName: string;
}

const TEMPLATES: InventoryTemplate[] = [
  { vendor: 'Dell', model: 'PowerEdge R760', sizeU: 2, cpuModel: '2× Intel Xeon Gold 6430', sockets: 2, cpuCores: 64, ramGB: 1024, disks: [['nvme', 3840], ['nvme', 3840], ['nvme', 3840], ['nvme', 3840]], gpus: [], nicGbps: 25, fw: { bios: '2.3.5', bmc: 'iDRAC 7.10.50', nic: '22.39.10' }, bmcName: 'idrac' },
  { vendor: 'Supermicro', model: 'AS-2125HS-TNR', sizeU: 2, cpuModel: '2× AMD EPYC 9354', sockets: 2, cpuCores: 64, ramGB: 768, disks: [['nvme', 7680], ['nvme', 7680]], gpus: [], nicGbps: 25, fw: { bios: '1.6a', bmc: 'BMC 1.74.11', nic: '22.39.10' }, bmcName: 'ipmi' },
  { vendor: 'HPE', model: 'ProLiant DL360 Gen11', sizeU: 1, cpuModel: 'Intel Xeon Gold 5418Y', sockets: 1, cpuCores: 24, ramGB: 256, disks: [['ssd', 1920], ['ssd', 1920]], gpus: [], nicGbps: 25, fw: { bios: 'U54 v1.48', bmc: 'iLO 6 1.55', nic: '22.36.10' }, bmcName: 'ilo' },
  { vendor: 'Supermicro', model: 'SYS-421GE-TNRT', sizeU: 4, cpuModel: '2× Intel Xeon Platinum 8462Y+', sockets: 2, cpuCores: 64, ramGB: 1024, disks: [['nvme', 3840], ['nvme', 3840], ['nvme', 7680]], gpus: [{ model: 'L40S', count: 4 }], nicGbps: 100, fw: { bios: '2.1', bmc: 'BMC 1.03.18', nic: '28.39.10' }, bmcName: 'ipmi' },
  { vendor: 'Lenovo', model: 'ThinkSystem SR645 V3', sizeU: 1, cpuModel: '2× AMD EPYC 9124', sockets: 2, cpuCores: 32, ramGB: 384, disks: [['nvme', 1920], ['nvme', 1920]], gpus: [], nicGbps: 25, fw: { bios: 'KAE120F', bmc: 'XCC 4.20', nic: '22.39.10' }, bmcName: 'xcc' },
  { vendor: 'Dell', model: 'PowerEdge R660xs', sizeU: 1, cpuModel: 'Intel Xeon Silver 4410Y', sockets: 1, cpuCores: 12, ramGB: 128, disks: [['ssd', 960], ['ssd', 960]], gpus: [], nicGbps: 10, fw: { bios: '1.6.2', bmc: 'iDRAC 7.00.30', nic: '22.31.6' }, bmcName: 'idrac' },
];
const DISK_MODEL: Record<string, string> = { nvme: 'Samsung PM9A3', ssd: 'Micron 5400 PRO', hdd: 'Seagate Exos X18' };

function macFor(seed: number, n: number) {
  const r = mulberry32(seed);
  const b = () => Math.floor(r() * 256).toString(16).padStart(2, '0');
  return `b8:ce:f6:${b()}:${b()}:${n.toString(16).padStart(2, '0')}`;
}

function inventoryFor(bmcIp: string): HostProbe {
  const seed = hashString(bmcIp);
  const t = TEMPLATES[seed % TEMPLATES.length];
  const rand = mulberry32(seed);
  const serial = `${t.vendor.slice(0, 2).toUpperCase()}${Math.floor(rand() * 36 ** 6).toString(36).toUpperCase().padStart(6, '0')}`;
  const disks: HostDisk[] = t.disks.map(([type, sizeGB], j) => ({ slot: `${type === 'nvme' ? 'nvme' : 'sd'}${j}`, type, sizeGB, health: 'ok', wearPct: type === 'hdd' ? 0 : Math.floor(rand() * 4), model: DISK_MODEL[type], powerOnHours: Math.floor(rand() * 200), reallocatedSectors: 0, tempC: 36 + Math.floor(rand() * 6) }));
  const nics: HostNic[] = [
    { name: 'ens1f0', speedGbps: t.nicGbps, mac: macFor(seed, 1), link: 'up', role: 'data', mtu: 9000 },
    { name: 'ens1f1', speedGbps: t.nicGbps, mac: macFor(seed, 2), link: 'up', role: 'storage', mtu: 9000 },
    { name: t.bmcName, speedGbps: 1, mac: macFor(seed, 255), link: 'up', role: 'bmc', mtu: 1500 },
  ];
  const fwOld = seed % 3 === 0;
  return {
    bmcIp, reachable: true, redfishVersion: '1.17.0', powerState: seed % 2 ? 'On' : 'Off',
    vendor: t.vendor, model: t.model, serial, sizeU: t.sizeU, cpuModel: t.cpuModel, sockets: t.sockets, cpuCores: t.cpuCores, threads: t.cpuCores * 2, ramGB: t.ramGB,
    disks, nics, gpus: t.gpus, firmware: { ...t.fw, bmc: fwOld ? t.fw.bmc.replace(/\d+$/, (d) => String(Math.max(0, Number(d) - 7)).padStart(d.length, '0')) : t.fw.bmc },
    firmwareUpdateAvailable: fwOld, estimatedWatts: ratedWatts({ cpuCores: t.cpuCores, gpus: t.gpus, disks }),
  };
}

function manualInventory(hw: any, bmcIp: string): HostProbe {
  const base = inventoryFor(bmcIp);
  const cores = Number(hw?.cpuCores);
  const ramGB = Number(hw?.ramGB);
  validate({
    'hardware.cpuCores': !(Number.isInteger(cores) && cores >= 1 && cores <= 512) && 'CPU cores must be 1–512',
    'hardware.ramGB': !(Number.isFinite(ramGB) && ramGB >= 8 && ramGB <= 16384) && 'RAM must be 8–16384 GB',
    'hardware.cpuModel': !String(hw?.cpuModel ?? '').trim() && 'CPU model is required',
  });
  const disks: HostDisk[] = Array.isArray(hw?.disks) && hw.disks.length
    ? hw.disks.map((d: any, j: number) => ({ slot: `${d.type === 'nvme' ? 'nvme' : 'sd'}${j}`, type: (['ssd', 'nvme', 'hdd'].includes(d.type) ? d.type : 'ssd'), sizeGB: Math.max(1, Number(d.sizeGB) || 960), health: 'ok', wearPct: 0, model: DISK_MODEL[d.type] ?? 'Generic', powerOnHours: 0, reallocatedSectors: 0, tempC: 38 }))
    : base.disks;
  const gpus = Array.isArray(hw?.gpus) ? hw.gpus.filter((g: any) => g?.model && Number(g.count) > 0).map((g: any) => ({ model: String(g.model), count: Number(g.count) })) : [];
  return {
    ...base, vendor: String(hw?.vendor || base.vendor), model: String(hw?.model || base.model), cpuModel: String(hw.cpuModel), sockets: Number(hw?.sockets) || 1,
    cpuCores: cores, threads: cores * (hw?.smt === false ? 1 : 2), ramGB, disks, gpus,
    nics: base.nics.map((n) => (n.role === 'bmc' ? n : { ...n, speedGbps: Number(hw?.nicGbps) || n.speedGbps })),
    estimatedWatts: ratedWatts({ cpuCores: cores, gpus, disks }),
  };
}

/* ================================================================================================
 * Sensors & metrics
 * ============================================================================================== */

function hostProfile(h: BareMetalHost, metric: string): MetricProfile | null {
  const off = h.status === 'offline' || h.status === 'decommissioning' || (h.status === 'provisioning' && h.cpuCores === 0);
  const alloc = hostAllocation(h.id);
  const threads = Math.max(1, h.threads);
  const cpuLoad = Math.min(88, 4 + (alloc.vcpus / threads) * 34 + (alloc.gpus ? 12 : 0));
  const ramPct = Math.min(97, 6 + (alloc.ramGB / Math.max(1, h.ramGB)) * 96);
  const watts = h.powerWatts || ratedWatts(h);
  const gpuTotal = h.gpus.reduce((a, g) => a + g.count, 0);
  const nicGbps = Math.max(...h.nics.filter((n) => n.role !== 'bmc').map((n) => n.speedGbps), 1);
  switch (metric) {
    case 'cpu': return { unit: '%', base: cpuLoad, amp: Math.max(3, cpuLoad * 0.3), max: 100, diurnal: 0.2, spikiness: 0.3, off };
    case 'ram': return { unit: '%', base: ramPct, amp: 2, max: 100, off };
    case 'power': return { unit: 'W', base: watts * (0.55 + cpuLoad / 220), amp: watts * 0.06, diurnal: 0.08, off };
    case 'inletTemp': return { unit: '°C', base: h.locationId === 'dc2' ? 23.5 : 22, amp: 1.2, diurnal: 0.04, off: false };
    case 'cpuTemp': return { unit: '°C', base: 42 + cpuLoad * 0.35, amp: 4, max: 95, spikiness: 0.2, off };
    case 'netIn': return { unit: 'Gbps', base: Math.min(nicGbps * 0.6, 0.2 + alloc.vms * 0.35), amp: 0.4 + alloc.vms * 0.1, diurnal: 0.35, spikiness: 0.3, off };
    case 'netOut': return { unit: 'Gbps', base: Math.min(nicGbps * 0.6, 0.15 + alloc.vms * 0.45), amp: 0.5 + alloc.vms * 0.12, diurnal: 0.35, spikiness: 0.3, off };
    case 'diskRead': return { unit: 'MB/s', base: 40 + alloc.vms * 55, amp: 35 + alloc.vms * 10, spikiness: 0.5, off };
    case 'diskWrite': return { unit: 'MB/s', base: 25 + alloc.vms * 38, amp: 25 + alloc.vms * 8, spikiness: 0.5, off };
    case 'gpu': return gpuTotal ? { unit: '%', base: alloc.gpus ? 25 + (alloc.gpus / gpuTotal) * 60 : 1, amp: alloc.gpus ? 14 : 0.5, max: 100, off } : null;
    default: return null;
  }
}

function latest(h: BareMetalHost, metric: string): number {
  const p = hostProfile(h, metric);
  if (!p) return 0;
  const s = generateSeries(h.id, metric, p, '15m');
  return s.points[s.points.length - 1]?.v ?? 0;
}

function sensorsFor(h: BareMetalHost): HostSensors {
  const off = h.status === 'offline';
  const cpuTemp = off ? 0 : latest(h, 'cpuTemp');
  const power = off ? 0 : latest(h, 'power');
  const fanCount = h.sizeU >= 4 ? 8 : h.sizeU >= 2 ? 6 : 5;
  const rand = mulberry32(hashString(h.id));
  const psuFailed = h.tags.some((t) => t.value === 'PSU-2' || t.key === 'psu-failed');
  const capW = Math.round((ratedWatts(h) * 1.4) / 100) * 100;
  return {
    inletTempC: latest(h, 'inletTemp'),
    cpuTempC: cpuTemp,
    fans: Array.from({ length: fanCount }, (_, i) => {
      const rpm = off ? 0 : Math.round(4200 + (cpuTemp - 40) * 95 + rand() * 600);
      return { id: `FAN${i + 1}`, rpm, status: off ? 'failed' : rpm > 11000 ? 'warning' : 'ok' };
    }),
    psus: [
      { id: 'PSU1', status: 'ok', watts: psuFailed ? Math.round(power) : Math.round(power / 2), capacityW: capW },
      { id: 'PSU2', status: psuFailed ? 'failed' : 'ok', watts: psuFailed ? 0 : Math.round(power / 2), capacityW: capW },
    ],
  };
}

/* ================================================================================================
 * Evacuation planning
 * ============================================================================================== */

function planEvacuation(host: BareMetalHost): EvacuationPlan {
  const vms = hostVms(host.id).sort((a, b) => b.size.ramGB - a.size.ramGB || b.size.vcpus - a.size.vcpus);
  const targets = db.filter<BareMetalHost>('hosts', (h) => h.locationId === host.locationId && h.status === 'ready' && h.hypervisor === 'KVM' && h.id !== host.id);
  const state = new Map(targets.map((t) => [t.id, { h: t, cap: hostCapacity(t), used: { ...hostAllocation(t.id) }, before: hostAllocation(t.id) }]));
  const moves: EvacuationMove[] = [];
  for (const vm of vms) {
    const need = { vcpus: vm.size.vcpus, ramGB: vm.size.ramGB, gpus: vm.gpu?.count ?? 0 };
    let best: { id: string; free: number } | null = null;
    let reason = targets.length ? 'No ready host has enough free capacity' : `No other ready host in ${host.locationId}`;
    const wl = workloadFor(vm.projectId, 'compute', vm.accountId);
    const allowed = [...state.values()].filter((s) => !policyReason(s.h, wl, policyNames));
    if (targets.length && !allowed.length) reason = `No other host may run it (host policies: ${[...new Set(targets.map((t) => policyReason(t, wl, policyNames)))].slice(0, 2).join('; ')})`;
    for (const s of allowed) {
      const gpuOk = need.gpus === 0 || (s.h.gpus.some((g) => g.model === vm.gpu?.model) && s.cap.gpus - s.used.gpus >= need.gpus);
      if (!gpuOk) { if (need.gpus) reason = `No host with ${need.gpus}× free ${vm.gpu?.model} GPU`; continue }
      const freeRam = s.cap.ramGB - s.used.ramGB - need.ramGB;
      const freeCpu = s.cap.vcpus - s.used.vcpus - need.vcpus;
      if (freeRam < 0 || freeCpu < 0) continue;
      if (!best || freeRam > best.free) best = { id: s.h.id, free: freeRam };
    }
    if (best) {
      const s = state.get(best.id)!;
      s.used.vcpus += need.vcpus; s.used.ramGB += need.ramGB; s.used.gpus += need.gpus;
      moves.push({ vmId: vm.id, vmName: vm.name, status: vm.status, ...need, targetHostId: s.h.id, targetHostName: s.h.name, live: vm.status === 'running' });
    } else {
      moves.push({ vmId: vm.id, vmName: vm.name, status: vm.status, ...need, targetHostId: null, targetHostName: null, live: false, reason });
    }
  }
  const blocked = moves.filter((m) => !m.targetHostId);
  const feasible = blocked.length === 0;
  const message = !moves.length ? `${host.name} has no VMs. It can enter maintenance immediately.`
    : feasible ? `${moves.length} VM${moves.length > 1 ? 's' : ''} will be ${moves.some((m) => m.live) ? 'live-' : ''}migrated to ${new Set(moves.map((m) => m.targetHostId)).size} host(s) in ${host.locationId}.`
    : `Cannot evacuate ${host.name}: ${blocked.map((m) => `${m.vmName} (${m.vcpus} vCPU / ${m.ramGB} GB${m.gpus ? ` / ${m.gpus}× GPU` : ''})`).join(', ')} ${blocked.length > 1 ? 'do' : 'does'} not fit on any other ready host in ${host.locationId} that its project may use. Add capacity, widen host policies, exit maintenance on another host, or stop/delete ${blocked.length > 1 ? 'these VMs' : 'this VM'}.`;
  return {
    hostId: host.id, feasible, moves, message,
    targets: [...state.values()].map((s) => ({
      id: s.h.id, name: s.h.name, before: { vcpus: s.before.vcpus, ramGB: s.before.ramGB }, after: { vcpus: s.used.vcpus, ramGB: s.used.ramGB }, capacity: { vcpus: s.cap.vcpus, ramGB: s.cap.ramGB },
    })),
  };
}

/* ================================================================================================
 * Host policies (roles & access) and the Ceph storage pool
 * ============================================================================================== */

export const ENROLL_DEFAULT_ROLES: HostRole[] = ['compute', 'k8s-worker'];

const policyExists = { account: (id: string) => !!db.get<Account>('accounts', id), project: (id: string) => !!db.get<Project>('projects', id) };

function validatePolicy(roles: unknown, access: unknown) {
  validate(policyErrors(roles, access, policyExists));
}

export interface PolicyViolation {
  kind: 'vm' | ManagedItem['kind'] | 'storage';
  id: string; name: string; projectId?: string; reason: string;
  /** what happens: VMs keep running; managed workloads are rescheduled (or lose their slot) */
  outcome: 'keeps-running' | 'moves' | 'unplaced' | 'rebalance';
  detail: string;
}
export interface PolicyImpact {
  violations: PolicyViolation[];
  /** managed workloads that would newly be placed on this host */
  incoming: { kind: ManagedItem['kind']; id: string; name: string; vcpus: number; ramGB: number }[];
  summary: string;
}

const rawTB = (h: BareMetalHost) => Math.round(h.disks.reduce((a, d) => a + d.sizeGB, 0) / 100) / 10;
const KIND_LABEL: Record<PolicyViolation['kind'], string> = { vm: 'VM', db: 'Database', k8s: 'Kubernetes worker', 'k8s-cp': 'Kubernetes control plane', lb: 'Load balancer', storage: 'Ceph storage' };

/** What a new policy would mean for workloads already on the host (nothing is changed). */
function policyImpact(h: BareMetalHost, roles: HostRole[], access: HostAccess): PolicyImpact {
  const next: BareMetalHost = { ...h, roles, access };
  const violations: PolicyViolation[] = [];
  for (const vm of hostVms(h.id)) {
    const reason = policyReason(next, workloadFor(vm.projectId, 'compute', vm.accountId), policyNames);
    if (reason) violations.push({ kind: 'vm', id: vm.id, name: vm.name, projectId: vm.projectId, reason, outcome: 'keeps-running', detail: 'Keeps running here. New VMs of this project are placed elsewhere — migrate it to comply.' });
  }
  const before = managedPlacements();
  const after = managedPlacements(new Map([[h.id, { roles, access }]]));
  const whereAfter = (m: ManagedItem) => { for (const [hid, list] of after) if (list.some((x) => x.kind === m.kind && x.name === m.name)) return hid; return null };
  for (const m of before.get(h.id) ?? []) {
    const reason = policyReason(next, workloadFor(m.projectId, m.role), policyNames);
    if (!reason) continue;
    const to = whereAfter(m);
    const toName = to ? db.get<BareMetalHost>('hosts', to)?.name ?? to : null;
    violations.push({
      kind: m.kind, id: m.id, name: m.name, projectId: m.projectId, reason, outcome: to ? 'moves' : 'unplaced',
      detail: to ? `Rescheduled onto ${toName}` : `No other eligible host in ${h.locationId} — it needs a host with the ${ROLE_META[m.role].short.toLowerCase()} role${m.projectId ? ` that ${policyNames.project(m.projectId)} may use` : ''}`,
    });
  }
  const had = before.get(h.id) ?? [];
  const incoming = (after.get(h.id) ?? []).filter((m) => !had.some((x) => x.kind === m.kind && x.name === m.name)).map((m) => ({ kind: m.kind, id: m.id, name: m.name, vcpus: m.vcpus, ramGB: m.ramGB }));
  if (hostRoles(h).includes('storage') && !roles.includes('storage') && h.disks.length) {
    const pool = storagePools().find((p) => p.locationId === h.locationId);
    const remaining = (pool?.hosts ?? []).filter((x) => x.id !== h.id);
    const usableAfter = remaining.reduce((a, x) => a + x.rawTB, 0) / 3;
    const tight = pool && pool.usedTB > usableAfter * 0.85;
    violations.push({
      kind: 'storage', id: h.id, name: `Ceph OSDs on ${h.name}`, reason: 'Storage role removed', outcome: 'rebalance',
      detail: remaining.length < 3 ? `Only ${remaining.length} storage host(s) would remain in ${h.locationId} — 3× replication needs at least 3.`
        : `Ceph rebalances ${rawTB(h)} TB raw onto ${remaining.length} remaining storage hosts${tight ? ` — pool would be ${Math.round(((pool!.usedTB) / Math.max(0.1, usableAfter)) * 100)}% full` : ''}.`,
    });
  }
  const summary = !violations.length
    ? `No running workload conflicts with this policy.${incoming.length ? ` ${incoming.length} managed workload${incoming.length > 1 ? 's' : ''} would be placed here.` : ''}`
    : `${violations.length} workload${violations.length > 1 ? 's' : ''} on ${h.name} ${violations.length > 1 ? 'are' : 'is'} not allowed by the new policy: ${violations.slice(0, 3).map((v) => `${KIND_LABEL[v.kind]} ${v.name}`).join(', ')}${violations.length > 3 ? ', …' : ''}.`;
  return { violations, incoming, summary };
}

/** Ceph pool per self-hosted location, formed by hosts with the storage role (3× replication). */
export function storagePools() {
  const vols = db.list<Volume>('volumes');
  const buckets = db.list<any>('buckets');
  return db.filter<Location>('locations', (l) => l.kind === 'selfHosted').map((l) => {
    const hosts = db.filter<BareMetalHost>('hosts', (h) => h.locationId === l.id && h.status !== 'decommissioning' && hostRoles(h).includes('storage'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((h) => ({ id: h.id, name: h.name, status: h.status, rawTB: rawTB(h), disks: h.disks.length, up: !['offline', 'error', 'provisioning', 'rebooting'].includes(h.status) }));
    const raw = Math.round(hosts.reduce((a, h) => a + h.rawTB, 0) * 10) / 10;
    const usable = Math.round((raw / 3) * 10) / 10;
    const volumesTB = vols.filter((v) => v.locationId === l.id).reduce((a, v) => a + v.sizeGB, 0) / 1000;
    const bucketsTB = buckets.filter((b) => b.locationId === l.id).reduce((a, b) => a + (b.bytesUsed ?? 0), 0) / 1e12;
    const used = Math.round((volumesTB + bucketsTB) * 100) / 100;
    const pct = usable ? used / usable : null;
    const up = hosts.filter((h) => h.up).length;
    const health = !hosts.length ? 'none' : up < 3 ? 'degraded' : pct != null && pct >= 0.85 ? 'nearfull' : 'ok';
    return {
      locationId: l.id, locationName: l.name, country: l.country, replication: 3, hosts, hostsUp: up,
      rawTB: raw, usableTB: usable, usedTB: used, volumesTB: Math.round(volumesTB * 100) / 100, bucketsTB: Math.round(bucketsTB * 100) / 100, pct, health,
    };
  });
}

/* ================================================================================================
 * Host operations
 * ============================================================================================== */

function enrollSteps(h: BareMetalHost, inv: HostProbe, body: { bmcUser: string; mgmtIp: string }): StepSpec[] {
  const ram = inv.ramGB;
  const dimm = ram >= 512 ? 64 : 32;
  const gpuTotal = inv.gpus.reduce((a, g) => a + g.count, 0);
  const cap = hostCapacity({ ...h, threads: inv.threads, ramGB: inv.ramGB, gpus: inv.gpus, disks: inv.disks } as BareMetalHost);
  return [
    { name: 'Connect to BMC (Redfish)', ms: ms(1.4), logs: [`GET https://${h.bmcIp}/redfish/v1 → 200 OK (Redfish ${inv.redfishVersion})`, `session created for user "${body.bmcUser}"`, `chassis power state: ${inv.powerState}`, 'BMC TLS certificate pinned'] },
    { name: 'Inventory discovery', ms: ms(2.2), logs: [
      `system: ${inv.vendor} ${inv.model} · S/N ${inv.serial}`,
      `cpu: ${inv.cpuModel} (${inv.cpuCores} cores / ${inv.threads} threads)`,
      `memory: ${Math.round(ram / dimm)}× ${dimm} GB DDR5 = ${ram} GB (ECC)`,
      ...inv.disks.map((d) => `disk ${d.slot}: ${d.model} ${d.sizeGB >= 1000 ? `${(d.sizeGB / 1000).toFixed(2)} TB` : `${d.sizeGB} GB`} ${d.type.toUpperCase()} — SMART ok`),
      ...inv.nics.filter((n) => n.role !== 'bmc').map((n) => `nic ${n.name}: ${n.speedGbps} GbE ${n.mac}`),
      ...(gpuTotal ? inv.gpus.map((g) => `gpu: ${g.count}× NVIDIA ${g.model}`) : ['gpu: none']),
    ] },
    { name: 'Firmware compliance check', ms: ms(1.2), logs: [`BIOS ${inv.firmware.bios} ✓ baseline`, `BMC ${inv.firmware.bmc} ${inv.firmwareUpdateAvailable ? '⚠ newer version available (non-blocking)' : '✓ baseline'}`, `NIC ${inv.firmware.nic ?? 'n/a'} ✓ baseline`, 'Secure Boot: enabled · TPM 2.0: present'] },
    { name: 'PXE boot installer', ms: ms(1.8), logs: ['set one-time boot device: PXE (UEFI HTTP boot)', 'Redfish ComputerSystem.Reset ResetType=ForceRestart', `DHCP lease ${body.mgmtIp} on ${inv.nics[0].name}`, 'iPXE: loading autark-installer 2026.10 (signed)'] },
    { name: 'Install hypervisor OS & KVM', ms: ms(3.2), logs: [
      `partitioning ${inv.disks.slice(0, 2).map((d) => d.slot).join(' + ')} (mdraid1 for OS)`, 'installing Ubuntu 24.04 LTS (minimal, hardened profile)', 'kernel 6.8.0-48-generic, microcode updated',
      'qemu-kvm 8.2 · libvirt 10.0 · hugepages 1G reserved', ...(gpuTotal ? ['IOMMU enabled, GPUs bound to vfio-pci for passthrough'] : []), 'ceph client & rbd modules loaded',
    ] },
    { name: 'Install Autark agent', ms: ms(1.2), logs: [`autark-agent ${LATEST_AGENT} installed (systemd unit enabled)`, 'mTLS certificate issued by cluster CA (valid 90d, auto-rotate)', 'registered with control plane, heartbeat OK'] },
    { name: 'Join cluster networking (VXLAN/EVPN)', ms: ms(1.6), logs: ['FRR: BGP EVPN sessions established with spine-1, spine-2', `VTEP ${body.mgmtIp} announced (type-3 routes)`, 'MTU 9000 verified end-to-end', 'storage network reachable (ceph mon quorum 3/3)'] },
    { name: 'Burn-in tests', ms: ms(2.4), logs: ['stress-ng cpu 60s: ok, max temp 71°C', 'memtester 5% pass: ok, 0 ECC errors', `fio randread 4k QD32: ${inv.disks[0]?.type === 'nvme' ? '812k' : '96k'} IOPS`, `iperf3 → spine-1: ${(inv.nics[0].speedGbps * 0.95).toFixed(1)} Gbit/s`] },
    { name: 'Mark host ready', ms: ms(0.6), logs: ['scheduler: host added to pool', `roles: ${hostRoles(h).join(', ')} · available to ${accessSummary(h, policyNames).replace(/^Reserved for /, '').replace('All accounts & projects', 'all accounts')}`, ...(hostRoles(h).includes('storage') ? [`ceph: ${inv.disks.length} OSD(s) added to the ${h.locationId} pool`] : []), `schedulable capacity: ${cap.vcpus} vCPU / ${cap.ramGB} GB${gpuTotal ? ` / ${gpuTotal} GPU` : ''}`] },
  ];
}

function applyInventory(id: string, inv: HostProbe) {
  if (!db.get('hosts', id)) return;
  db.update<BareMetalHost>('hosts', id, {
    vendor: inv.vendor, model: inv.model, serial: inv.serial, cpuModel: inv.cpuModel, sockets: inv.sockets, cpuCores: inv.cpuCores, threads: inv.threads, ramGB: inv.ramGB,
    disks: inv.disks, nics: inv.nics, gpus: inv.gpus, firmware: inv.firmware, powerWatts: inv.estimatedWatts,
  });
}

function startEnrollment(ctx: Pick<Ctx, 'actor'>, h: BareMetalHost, inv: HostProbe, opts: { auto: boolean; bmcUser: string; badCredentials?: boolean }) {
  const steps = enrollSteps(h, inv, { bmcUser: opts.bmcUser, mgmtIp: h.mgmtIp });
  const failAt = opts.badCredentials ? 0 : h.name.includes('fail') ? 7 : undefined;
  return startOperation({
    type: 'bareMetal.enroll', title: `Enroll host ${h.name}`, target: { type: 'bareMetal', id: h.id, name: h.name }, steps, actor: ctx.actor,
    onComplete: 'host.enrolled', onFail: 'host.enrollFailed', payload: { id: h.id, inventory: inv, auto: opts.auto, failAt },
    ...(failAt === 0 ? { failAtStep: 0, failMessage: `Redfish authentication failed for "${opts.bmcUser}" at ${h.bmcIp} (401 Unauthorized). Update the BMC credentials and retry.` } : {}),
    ...(failAt === 7 ? { failAtStep: 7, failMessage: 'memtester: uncorrectable ECC error on DIMM A2 — host quarantined. Replace the module and retry enrollment.' } : {}),
  });
}

onOperationComplete('host.enrolled', (_op, p: { id: string; inventory: HostProbe }) => {
  if (!db.get('hosts', p.id)) return;
  applyInventory(p.id, p.inventory);
  db.update<BareMetalHost>('hosts', p.id, { status: 'ready', agentVersion: LATEST_AGENT, kernel: '6.8.0-48-generic', bootedAt: nowIso(), hypervisor: 'KVM' });
});
onOperationComplete('host.enrollFailed', (_op, p: { id: string; inventory: HostProbe; failAt?: number }) => {
  if (!db.get('hosts', p.id)) return;
  if ((p.failAt ?? 0) >= 1) applyInventory(p.id, p.inventory);
  db.update<BareMetalHost>('hosts', p.id, { status: 'error' });
});

onOperationComplete('host.state', (_op, p: { id: string; patch: Partial<BareMetalHost> }) => {
  if (db.get('hosts', p.id)) db.update<BareMetalHost>('hosts', p.id, p.patch);
});

onOperationComplete('host.evacuated', (_op, p: { id: string; reason?: string; moves: { vmId: string; targetHostId: string; prevStatus: VM['status'] }[] }) => {
  const host = db.get<BareMetalHost>('hosts', p.id);
  const stuck: string[] = [];
  for (const m of p.moves) {
    const vm = db.get<VM>('vms', m.vmId);
    if (!vm || vm.hostId !== p.id) continue;
    let target = db.get<BareMetalHost>('hosts', m.targetHostId);
    // re-validate: capacity may have been taken while the evacuation ran
    const wl = workloadFor(vm.projectId, 'compute', vm.accountId);
    if (target) {
      const cap = hostCapacity(target); const used = hostAllocation(target.id);
      if (target.status !== 'ready' || policyReason(target, wl, policyNames) || used.vcpus + vm.size.vcpus > cap.vcpus || used.ramGB + vm.size.ramGB > cap.ramGB) target = undefined;
    }
    if (!target) {
      try { target = pickHost(vm.locationId, { vcpus: vm.size.vcpus, ramGB: vm.size.ramGB, gpus: vm.gpu?.count ?? 0, gpuModel: vm.gpu?.model }, p.id, wl) } catch { target = undefined }
    }
    if (target) db.update<VM>('vms', vm.id, { hostId: target.id, status: vm.status === 'migrating' ? m.prevStatus : vm.status });
    else { stuck.push(vm.name); db.update<VM>('vms', vm.id, { status: vm.status === 'migrating' ? m.prevStatus : vm.status }) }
  }
  if (!host) return;
  db.update<BareMetalHost>('hosts', p.id, { status: 'maintenance', maintenanceReason: p.reason || host.maintenanceReason || 'Planned maintenance' });
  if (stuck.length) notify('warning', `${host.name}: evacuation incomplete`, `${stuck.join(', ')} could not be moved (capacity changed during evacuation) and still run on this host.`, `/hardware/bare-metals/${host.id}`);
});

onOperationComplete('host.rebooted', (_op, p: { id: string; status: BareMetalHost['status']; vmIds: string[] }) => {
  if (db.get('hosts', p.id)) db.update<BareMetalHost>('hosts', p.id, { status: p.status, bootedAt: nowIso() });
  for (const id of p.vmIds) {
    const vm = db.get<VM>('vms', id);
    if (vm && vm.status === 'rebooting') db.update<VM>('vms', id, { status: 'running' });
  }
});

onOperationComplete('host.healthChecked', (_op, p: { id: string }) => {
  const h = db.get<BareMetalHost>('hosts', p.id);
  if (!h) return;
  const result = healthResult(h);
  db.update<BareMetalHost>('hosts', p.id, { lastHealthCheck: result });
  if (result.result !== 'passed') notify(result.result === 'failed' ? 'error' : 'warning', `Health check ${result.result === 'failed' ? 'failed' : 'found warnings'} on ${h.name}`, result.checks.filter((c) => c.status !== 'ok').map((c) => `${c.name}: ${c.detail}`).join(' · '), `/hardware/bare-metals/${h.id}?tab=health`);
});

onOperationComplete('host.decommissioned', (_op, p: { id: string }) => {
  for (const vm of hostVms(p.id)) db.update<VM>('vms', vm.id, { hostId: null });
  db.remove('hosts', p.id);
});

function healthResult(h: BareMetalHost): HostHealthCheck {
  const s = sensorsFor(h);
  const disks = h.disks.filter((d) => d.health !== 'ok' || d.wearPct >= 80);
  const nicsDown = h.nics.filter((n) => n.role !== 'bmc' && n.link === 'down');
  const psuBad = s.psus.filter((p) => p.status !== 'ok');
  const prevMem = h.lastHealthCheck?.checks.find((c) => c.name === 'Memory (ECC)');
  const memWarn = prevMem?.status === 'warning' && h.status === 'maintenance' ? prevMem : null;
  const cap = hostCapacity(h); const alloc = hostAllocation(h.id);
  const checks: HostHealthCheck['checks'] = [
    { name: 'BMC sensors', status: psuBad.length ? 'warning' : s.cpuTempC > 85 ? 'warning' : 'ok', detail: psuBad.length ? `${psuBad.map((p) => p.id).join(', ')} failed — running without PSU redundancy` : `Inlet ${s.inletTempC.toFixed(1)}°C · CPU ${s.cpuTempC.toFixed(0)}°C · ${s.fans.length} fans ok` },
    { name: 'Memory (ECC)', status: memWarn ? 'warning' : 'ok', detail: memWarn ? memWarn.detail : `${h.ramGB} GB, 0 correctable errors in 24h` },
    { name: 'Disks (SMART)', status: disks.some((d) => d.health === 'failed') ? 'failed' : disks.length ? 'warning' : 'ok', detail: disks.length ? disks.map((d) => `${d.slot}: ${d.health !== 'ok' ? `SMART ${d.health}` : ''}${d.reallocatedSectors ? ` (${d.reallocatedSectors} reallocated sectors)` : ''}${d.wearPct >= 80 ? ` wear ${d.wearPct}%` : ''}`.trim()).join('; ') : `${h.disks.length} disks healthy` },
    { name: 'Network links', status: nicsDown.length ? 'failed' : 'ok', detail: nicsDown.length ? `${nicsDown.map((n) => n.name).join(', ')} link down` : h.nics.filter((n) => n.role !== 'bmc').map((n) => `${n.name} ${n.speedGbps}G`).join(' · ') },
    { name: 'Hypervisor', status: h.hypervisor === 'KVM' ? 'ok' : 'warning', detail: h.hypervisor === 'KVM' ? `libvirt responsive · ${alloc.vms} domains · ${alloc.vcpus}/${cap.vcpus} vCPU allocated` : 'No hypervisor (storage node)' },
    { name: 'Agent heartbeat', status: cmpVersion(h.agentVersion, LATEST_AGENT) < 0 ? 'warning' : 'ok', detail: cmpVersion(h.agentVersion, LATEST_AGENT) < 0 ? `Heartbeat ok · agent ${h.agentVersion} is outdated (latest ${LATEST_AGENT})` : `Heartbeat 1s ago · agent ${h.agentVersion}` },
  ];
  const result = checks.some((c) => c.status === 'failed') ? 'failed' : checks.some((c) => c.status === 'warning') ? 'warnings' : 'passed';
  return { at: nowIso(), result, checks };
}

function hostOp(ctx: Ctx, h: BareMetalHost, type: string, title: string, during: BareMetalHost['status'] | null, steps: StepSpec[], patch: Partial<BareMetalHost>, silent = true) {
  if (during) {
    return transition({ collection: 'hosts', id: h.id, kind: 'bareMetal', name: h.name, type, title, during: { status: during }, steps, onComplete: 'host.state', payload: { id: h.id, patch }, actor: ctx.actor, silent });
  }
  return startOperation({ type, title, target: { type: 'bareMetal', id: h.id, name: h.name }, steps, onComplete: 'host.state', payload: { id: h.id, patch }, actor: ctx.actor, silent });
}

function decommission(ctx: Ctx, h: BareMetalHost) {
  const vms = hostVms(h.id);
  if (vms.length) throw new ApiError(409, `${h.name} still hosts ${vms.length} VM${vms.length > 1 ? 's' : ''} (${vms.slice(0, 4).map((v) => v.name).join(', ')}${vms.length > 4 ? ', …' : ''}). Enter maintenance to evacuate them first.`, 'host_not_empty');
  if (h.status === 'decommissioning') throw new ApiError(409, 'Host is already being decommissioned', 'invalid_state');
  requireNoOp(h.id, h.name);
  transition({
    collection: 'hosts', id: h.id, kind: 'bareMetal', name: h.name, type: 'bareMetal.decommission', title: `Decommission ${h.name}`, during: { status: 'decommissioning' }, actor: ctx.actor, silent: false,
    steps: [
      { name: 'Remove from scheduler', ms: ms(0.8), logs: ['host cordoned permanently', 'placement candidates updated'] },
      { name: 'Leave cluster network', ms: ms(1.2), logs: ['withdrawing EVPN type-2/3 routes', 'BGP sessions closed', 'VTEP removed from flood lists'] },
      { name: 'Revoke agent identity', ms: ms(0.8), logs: ['mTLS certificate revoked (CRL updated)', 'autark-agent uninstalled'] },
      { name: 'Secure-erase disks', ms: ms(2.4), logs: h.disks.map((d) => `${d.slot}: ${d.type === 'hdd' ? 'ATA SECURITY ERASE UNIT (enhanced)' : 'nvme format --ses=1 (cryptographic erase)'} ✓`) },
      { name: 'Power off via BMC', ms: ms(0.8), logs: [`Redfish ComputerSystem.Reset ResetType=GracefulShutdown → ${h.bmcIp}`, 'chassis power: Off'] },
      { name: 'Release IP reservations', ms: ms(0.5), logs: [`released mgmt ${h.mgmtIp}`, `released BMC ${h.bmcIp}`, `rack ${h.rack} U${h.rackUnit}–${h.rackUnit + h.sizeU - 1} freed`] },
    ],
    onComplete: 'host.decommissioned', payload: { id: h.id },
  });
}

/* ================================================================================================
 * Cloud providers
 * ============================================================================================== */

const R = (code: string, name: string, city: string, country: string, lat: number, lon: number) => ({ code, name, city, country, lat, lon });

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    kind: 'hetzner', label: 'Hetzner Cloud', short: 'Hetzner', color: '#d50c2d', description: 'Low-cost EU & US cloud servers. Great for burst compute.', credentialLabel: 'API token',
    fields: [{ id: 'token', label: 'API token', secret: true, placeholder: 'hcloud_…', hint: 'Cloud Console → Project → Security → API tokens (Read & Write)' }],
    regions: [R('nbg1', 'Nuremberg', 'Nuremberg', 'DE', 49.45, 11.08), R('fsn1', 'Falkenstein', 'Falkenstein', 'DE', 50.48, 12.37), R('hel1', 'Helsinki', 'Helsinki', 'FI', 60.17, 24.94), R('ash', 'Ashburn, VA', 'Ashburn', 'US', 39.04, -77.49), R('hil', 'Hillsboro, OR', 'Hillsboro', 'US', 45.52, -122.99), R('sin', 'Singapore', 'Singapore', 'SG', 1.35, 103.82)],
    defaultQuotas: { vcpus: 200, ramGB: 800, vms: 50, ips: 50 }, docsUrl: 'https://docs.hetzner.cloud',
  },
  {
    kind: 'aws', label: 'Amazon Web Services', short: 'AWS', color: '#ff9900', description: 'EC2 only — Autark uses generic VMs, EBS volumes and VPCs. No lock-in services.', credentialLabel: 'Access key + role ARN',
    fields: [
      { id: 'accessKeyId', label: 'Access key ID', placeholder: 'AKIA…' },
      { id: 'secretAccessKey', label: 'Secret access key', secret: true, placeholder: '40 characters' },
      { id: 'roleArn', label: 'Role ARN to assume', optional: true, placeholder: 'arn:aws:iam::123456789012:role/autark', hint: 'Recommended: least-privilege role limited to EC2/EBS/VPC.' },
    ],
    regions: [R('eu-central-1', 'Frankfurt', 'Frankfurt', 'DE', 50.0, 8.9), R('eu-west-1', 'Ireland', 'Dublin', 'IE', 53.35, -6.26), R('eu-north-1', 'Stockholm', 'Stockholm', 'SE', 59.33, 18.07), R('eu-south-1', 'Milan', 'Milan', 'IT', 45.46, 9.19), R('us-east-1', 'N. Virginia', 'Ashburn', 'US', 38.9, -77.3), R('us-west-2', 'Oregon', 'Boardman', 'US', 45.84, -119.7), R('ap-southeast-1', 'Singapore', 'Singapore', 'SG', 1.29, 103.85)],
    defaultQuotas: { vcpus: 128, ramGB: 512, vms: 30, ips: 10 }, docsUrl: 'https://docs.aws.amazon.com/ec2',
  },
  {
    kind: 'ovh', label: 'OVHcloud', short: 'OVHcloud', color: '#0050d7', description: 'European public cloud (OpenStack-based) with SecNumCloud regions.', credentialLabel: 'Application key',
    fields: [
      { id: 'applicationKey', label: 'Application key', placeholder: 'ak_…' },
      { id: 'applicationSecret', label: 'Application secret', secret: true },
      { id: 'consumerKey', label: 'Consumer key', secret: true },
      { id: 'projectId', label: 'Public Cloud project ID', placeholder: '32 hex characters' },
    ],
    regions: [R('GRA', 'Gravelines', 'Gravelines', 'FR', 50.99, 2.13), R('SBG', 'Strasbourg', 'Strasbourg', 'FR', 48.57, 7.75), R('WAW', 'Warsaw', 'Warsaw', 'PL', 52.23, 21.01), R('DE1', 'Frankfurt', 'Frankfurt', 'DE', 50.11, 8.68), R('UK1', 'London', 'London', 'GB', 51.51, -0.13), R('BHS', 'Beauharnois', 'Beauharnois', 'CA', 45.31, -73.87)],
    defaultQuotas: { vcpus: 128, ramGB: 512, vms: 30, ips: 16 }, docsUrl: 'https://help.ovhcloud.com',
  },
  {
    kind: 'scaleway', label: 'Scaleway', short: 'Scaleway', color: '#7b2cbf', description: 'French cloud with sovereign EU regions and GPU instances.', credentialLabel: 'API key',
    fields: [
      { id: 'accessKey', label: 'Access key', placeholder: 'SCW…' },
      { id: 'secretKey', label: 'Secret key', secret: true, placeholder: 'UUID' },
      { id: 'projectId', label: 'Project ID', placeholder: 'UUID' },
    ],
    regions: [R('fr-par-1', 'Paris 1', 'Paris', 'FR', 48.86, 2.35), R('fr-par-2', 'Paris 2', 'Paris', 'FR', 48.82, 2.27), R('nl-ams-1', 'Amsterdam', 'Amsterdam', 'NL', 52.37, 4.9), R('pl-waw-1', 'Warsaw', 'Warsaw', 'PL', 52.23, 21.01)],
    defaultQuotas: { vcpus: 96, ramGB: 384, vms: 25, ips: 10 }, docsUrl: 'https://www.scaleway.com/en/docs',
  },
  {
    kind: 'ionos', label: 'IONOS Cloud', short: 'IONOS', color: '#1d4ed8', description: 'German IaaS with C5-certified data centers.', credentialLabel: 'API token',
    fields: [{ id: 'token', label: 'API token', secret: true, placeholder: 'eyJ…', hint: 'DCD → Management → Token Manager' }],
    regions: [R('de-fra', 'Frankfurt', 'Frankfurt', 'DE', 50.11, 8.68), R('de-txl', 'Berlin', 'Berlin', 'DE', 52.52, 13.4), R('es-vit', 'Logroño', 'Logroño', 'ES', 42.46, -2.45), R('fr-par', 'Paris', 'Paris', 'FR', 48.86, 2.35), R('gb-lhr', 'London', 'London', 'GB', 51.51, -0.13), R('us-las', 'Las Vegas', 'Las Vegas', 'US', 36.17, -115.14), R('us-ewr', 'Newark', 'Newark', 'US', 40.74, -74.17)],
    defaultQuotas: { vcpus: 96, ramGB: 384, vms: 25, ips: 10 }, docsUrl: 'https://docs.ionos.com/cloud',
  },
  {
    kind: 'openstack', label: 'OpenStack', short: 'OpenStack', color: '#ed1944', description: 'Any OpenStack cloud (e.g. a sovereign regional provider) via Keystone app credentials.', credentialLabel: 'Application credential',
    fields: [
      { id: 'authUrl', label: 'Keystone auth URL', placeholder: 'https://keystone.example.net:5000/v3' },
      { id: 'applicationCredentialId', label: 'Application credential ID' },
      { id: 'applicationCredentialSecret', label: 'Application credential secret', secret: true },
    ],
    regions: [R('de-fra-1', 'Frankfurt', 'Frankfurt', 'DE', 50.11, 8.68), R('de-ber-1', 'Berlin', 'Berlin', 'DE', 52.52, 13.4), R('ch-zrh-1', 'Zurich', 'Zurich', 'CH', 47.38, 8.54), R('at-vie-1', 'Vienna', 'Vienna', 'AT', 48.21, 16.37)],
    defaultQuotas: { vcpus: 64, ramGB: 256, vms: 20, ips: 8 }, docsUrl: 'https://docs.openstack.org',
  },
];
const catalogFor = (kind: string) => PROVIDER_CATALOG.find((c) => c.kind === kind);

const CREDENTIAL_MAX_AGE_DAYS = 365;
const credentialsExpired = (p: CloudProvider) => Date.now() - Date.parse(p.credentials.lastRotatedAt) > CREDENTIAL_MAX_AGE_DAYS * 86_400_000;
function credentialsBad(p: CloudProvider): boolean {
  return p.credentialsValid === false || credentialsExpired(p);
}

/** Regions known for a provider: what was stored at connect time plus anything new in the catalog. */
function regionsOf(p: CloudProvider): ProviderRegion[] {
  const out = [...p.availableRegions];
  for (const r of catalogFor(p.kind)?.regions ?? []) if (!out.some((x) => x.code === r.code)) out.push(r);
  return out;
}

function providerLocations(p: CloudProvider): Location[] {
  return db.filter<Location>('locations', (l) => l.providerId === p.id);
}

function locationIdFor(p: CloudProvider, region: string): string {
  const existing = db.find<Location>('locations', (l) => l.providerId === p.id && l.region === region);
  if (existing) return existing.id;
  const base = `${p.kind}-${region.toLowerCase()}`;
  return db.get('locations', base) ? `${base}-${p.id.slice(-4)}` : base;
}

/** Make sure a location row exists for every enabled region. */
function ensureLocations(p: CloudProvider) {
  const cat = catalogFor(p.kind);
  for (const code of p.regions) {
    if (db.find<Location>('locations', (l) => l.providerId === p.id && l.region === code)) continue;
    const r = regionsOf(p).find((x) => x.code === code);
    if (!r) continue;
    const loc: Location = { id: locationIdFor(p, code), name: `${cat?.short ?? p.name} ${code}`, kind: 'cloud', providerId: p.id, region: code, city: r.city, country: r.country, lat: r.lat, lon: r.lon };
    db.insert('locations', loc as any);
  }
}

/** Resources (in any account) that live in a location — used to block destructive provider changes. */
function resourcesIn(locationIds: string[]) {
  const inLoc = (r: any) => locationIds.includes(r.locationId);
  const vms = db.filter<VM>('vms', inLoc);
  const volumes = db.filter<any>('volumes', inLoc);
  const networks = db.filter<any>('networks', inLoc);
  const dbs = db.filter<any>('dbInstances', inLoc);
  const k8s = db.filter<any>('k8sClusters', inLoc);
  const lbs = db.filter<any>('loadBalancers', inLoc);
  const parts: string[] = [];
  if (vms.length) parts.push(`${vms.length} VM${vms.length > 1 ? 's' : ''} (${vms.slice(0, 3).map((v) => v.name).join(', ')}${vms.length > 3 ? ', …' : ''})`);
  if (volumes.length) parts.push(`${volumes.length} volume${volumes.length > 1 ? 's' : ''}`);
  if (networks.length) parts.push(`${networks.length} network${networks.length > 1 ? 's' : ''}`);
  if (dbs.length) parts.push(`${dbs.length} database${dbs.length > 1 ? 's' : ''}`);
  if (k8s.length) parts.push(`${k8s.length} Kubernetes cluster${k8s.length > 1 ? 's' : ''}`);
  if (lbs.length) parts.push(`${lbs.length} load balancer${lbs.length > 1 ? 's' : ''}`);
  return { count: vms.length + volumes.length + networks.length + dbs.length + k8s.length + lbs.length, text: parts.join(', ') };
}

function providerUsage(p: CloudProvider) {
  const locs = providerLocations(p);
  const ids = locs.map((l) => l.id);
  const vms = db.filter<VM>('vms', (v) => ids.includes(v.locationId) && v.status !== 'deleting');
  const pools = db.filter<IpPool>('ipPools', (pl) => ids.includes(pl.locationId)).map((pl) => pl.id);
  const ips = db.filter<IpAddress>('ips', (i) => pools.includes(i.poolId)).length;
  return {
    usage: { vcpus: vms.reduce((a, v) => a + v.size.vcpus, 0), ramGB: vms.reduce((a, v) => a + v.size.ramGB, 0), vms: vms.length, ips, monthlyCost: Math.round(vms.reduce((a, v) => a + vmComputeCost(v), 0) * 100) / 100 },
    locations: locs.map((l) => ({ id: l.id, region: l.region ?? '', vms: vms.filter((v) => v.locationId === l.id).length })),
    resources: vms.map((v) => ({ ...vmSummary(v), locationId: v.locationId, monthlyCost: Math.round(vmComputeCost(v) * 100) / 100 })),
  };
}

function validateCredentials(cat: ProviderCatalogEntry, fields: Record<string, unknown> | undefined) {
  const errs: Record<string, string | false> = {};
  for (const f of cat.fields) {
    const v = String(fields?.[f.id] ?? '').trim();
    if (!f.optional && !v) errs[`credentials.${f.id}`] = `${f.label} is required`;
    else if (v && f.secret && v.length < 8) errs[`credentials.${f.id}`] = `${f.label} looks too short`;
    else if (v && f.id === 'authUrl' && !/^https:\/\//.test(v)) errs[`credentials.${f.id}`] = 'Must be an https:// URL';
    else if (v && f.id === 'roleArn' && !/^arn:aws:iam::\d{12}:role\//.test(v)) errs[`credentials.${f.id}`] = 'Expected arn:aws:iam::<account>:role/<name>';
  }
  validate(errs);
}

function maskCredentials(cat: ProviderCatalogEntry, fields: Record<string, unknown>) {
  const masked: Record<string, string> = {};
  for (const f of cat.fields) {
    const v = String(fields?.[f.id] ?? '').trim();
    if (!v) continue;
    masked[f.id] = f.secret ? maskSecret(v) : f.id === 'accessKeyId' || f.id === 'accessKey' || f.id === 'applicationKey' || f.id === 'applicationCredentialId' ? `${v.slice(0, 4)}••••${v.slice(-4)}` : v;
  }
  const primary = cat.fields.find((f) => f.secret) ?? cat.fields[0];
  const raw = Object.values(fields ?? {}).map((v) => String(v ?? ''));
  return {
    credentials: { label: cat.credentialLabel, masked: masked[primary.id] ?? '••••••••', lastRotatedAt: nowIso(), fields: masked },
    credentialsValid: !raw.some((v) => v.toLowerCase().includes('invalid')),
    endpoint: typeof fields?.authUrl === 'string' ? String(fields.authUrl) : undefined,
  };
}

function apiHost(p: CloudProvider): string {
  return { hetzner: 'api.hetzner.cloud', aws: 'ec2.eu-central-1.amazonaws.com', ovh: 'eu.api.ovh.com', scaleway: 'api.scaleway.com', ionos: 'api.ionos.com', openstack: (p.endpoint ?? 'keystone').replace(/^https?:\/\//, '') }[p.kind];
}

type ProviderOpMode = 'connect' | 'test' | 'sync' | 'rotate' | 'enable';

function providerOp(ctx: Pick<Ctx, 'actor'>, p: CloudProvider, mode: ProviderOpMode) {
  const bad = credentialsBad(p);
  const regions = p.regions.length ? p.regions : ['—'];
  const authErr = credentialsExpired(p) && p.credentialsValid !== false
    ? `Authentication failed: ${p.credentials.label.toLowerCase()} expired (HTTP 403 "This credential is not valid"). Rotate credentials.`
    : `Authentication failed: ${p.kind === 'aws' ? 'AuthFailure — AWS was not able to validate the provided access credentials' : '401 Unauthorized — the token is invalid or has been revoked'}. Rotate credentials.`;
  const auth: StepSpec = { name: 'Authenticate', ms: ms(1.1), logs: [`POST https://${apiHost(p)}/… (${p.credentials.label})`, bad ? 'response: 401' : 'response: 200 OK', ...(bad ? [] : [`identity verified · scope: compute read/write`])] };
  let steps: StepSpec[];
  let title: string;
  if (mode === 'sync') {
    const u = providerUsage(p);
    title = `Sync ${p.name}`;
    steps = [
      auth,
      { name: 'List servers & volumes', ms: ms(1.4), logs: [`${regions.length} region(s): ${regions.join(', ')}`, `found ${u.usage.vms} server(s) managed by Autark`, 'no orphaned resources detected'] },
      { name: 'Reconcile state', ms: ms(1), logs: u.resources.map((r) => `${r.name}: ${r.status} ✓ in sync`).slice(0, 6).concat(u.resources.length ? [] : ['nothing to reconcile']) },
      { name: 'Refresh flavors, images & prices', ms: ms(1.2), logs: ['42 server types, 9 images', 'price list updated (EUR, hourly)'] },
      { name: 'Refresh account limits', ms: ms(0.6), logs: [`quota in Autark: ${p.quotas.vcpus} vCPU / ${p.quotas.ramGB} GB / ${p.quotas.vms} VMs`] },
    ];
  } else {
    title = mode === 'connect' ? `Connect ${p.name}` : mode === 'rotate' ? `Verify new credentials for ${p.name}` : mode === 'enable' ? `Re-enable ${p.name}` : `Test connection to ${p.name}`;
    steps = [
      auth,
      { name: 'List regions', ms: ms(1), logs: [`provider offers ${regionsOf(p).length} regions`, `enabled in Autark: ${regions.join(', ')}`] },
      { name: 'Check quotas & limits', ms: ms(0.9), logs: [`provider account limit: ${p.quotas.vcpus * 2} vCPU / ${p.quotas.ramGB * 2} GB`, `Autark quota ${p.quotas.vcpus} vCPU / ${p.quotas.ramGB} GB / ${p.quotas.vms} VMs ✓ fits`] },
      { name: 'Create test network', ms: ms(1.3), logs: [`creating network autark-conntest-${newId('t').slice(2)} (10.250.0.0/24) in ${regions[0]}`, 'subnet + security group created', 'API write permissions ✓'] },
      { name: 'Clean up', ms: ms(0.7), logs: ['deleted test security group', 'deleted test network', 'connection verified'] },
    ];
  }
  const id = startOperation({
    type: `provider.${mode === 'connect' ? 'connect' : mode === 'sync' ? 'sync' : 'test'}`, title, target: { type: 'provider', id: p.id, name: p.name }, steps, actor: ctx.actor,
    onComplete: 'provider.ok', onFail: 'provider.failed', payload: { id: p.id, mode, error: authErr },
    silent: mode === 'test' || mode === 'sync' ? !bad : false,
    ...(bad ? { failAtStep: 0, failMessage: authErr } : {}),
  });
  return id;
}

onOperationComplete('provider.ok', (_op, p: { id: string; mode: ProviderOpMode }) => {
  const prov = db.get<CloudProvider>('providers', p.id);
  if (!prov) return;
  const keepDisabled = prov.status === 'disabled' && p.mode !== 'enable';
  const next = db.update<CloudProvider>('providers', p.id, {
    status: keepDisabled ? 'disabled' : 'connected', lastError: null, lastTestAt: nowIso(), credentialsValid: true,
    ...(p.mode === 'connect' || p.mode === 'sync' || p.mode === 'rotate' ? { lastSyncAt: nowIso() } : {}),
  });
  ensureLocations(next);
});
onOperationComplete('provider.failed', (_op, p: { id: string; mode: ProviderOpMode; error: string }) => {
  const prov = db.get<CloudProvider>('providers', p.id);
  if (!prov) return;
  db.update<CloudProvider>('providers', p.id, { status: prov.status === 'disabled' && p.mode !== 'enable' ? 'disabled' : 'error', lastError: p.error, lastTestAt: nowIso() });
});
onOperationComplete('provider.regionEnabled', (_op, p: { id: string; region: string }) => {
  const prov = db.get<CloudProvider>('providers', p.id);
  if (!prov) return;
  const next = prov.regions.includes(p.region) ? prov : db.update<CloudProvider>('providers', p.id, { regions: [...prov.regions, p.region] });
  ensureLocations(next);
});

function validateQuotas(q: any, current?: { vcpus: number; ramGB: number; vms: number; ips: number }) {
  const errs: Record<string, string | false> = {};
  const lim: Record<string, [number, string]> = { vcpus: [10000, 'vCPUs'], ramGB: [100000, 'GB RAM'], vms: [5000, 'VMs'], ips: [5000, 'IPs'] };
  for (const [k, [max, label]] of Object.entries(lim)) {
    const v = q?.[k];
    if (!(Number.isInteger(v) && v >= 0 && v <= max)) errs[`quotas.${k}`] = `Must be a whole number 0–${max}`;
    else if (current && v < (current as any)[k]) errs[`quotas.${k}`] = `Below current usage (${(current as any)[k]} ${label} in use)`;
  }
  validate(errs);
}

/* ================================================================================================
 * Registration
 * ============================================================================================== */

export function registerHardware() {
  /* ------------------------------------------------------------------ hosts */
  defineCollection<BareMetalHost>({
    name: 'hosts', kind: 'bareMetal', idPrefix: 'bm', scoped: false,
    searchText: (h) => `${h.id} ${h.name} ${h.locationId} ${h.rack} ${h.vendor} ${h.model} ${h.cpuModel} ${h.mgmtIp} ${h.bmcIp} ${h.serial} ${h.status} ${h.gpus.map((g) => g.model).join(' ')} ${h.tags.map((t) => `${t.key}:${t.value}`).join(' ')} ${hostRoles(h).join(' ')} ${accessSummary(h, policyNames)}`,
    subtitle: (h) => `Host · ${h.locationId} ${h.rack} U${h.rackUnit} · ${h.cpuCores} cores / ${h.ramGB} GB · ${h.status}`,
    sort: (a, b) => a.locationId.localeCompare(b.locationId) || a.name.localeCompare(b.name),
    decorate: (h) => {
      const vms = hostVms(h.id);
      const capacity = hostCapacity(h);
      const fwLatest = TEMPLATES.find((t) => t.vendor === h.vendor)?.fw.bmc;
      return {
        ...h,
        roles: hostRoles(h), access: hostAccess(h),
        bmcCredential: h.bmcCredential ? '••••••••' : undefined,
        allocated: hostAllocation(h.id), capacity, vms: vms.map(vmSummary), sensors: sensorsFor(h),
        latestAgentVersion: LATEST_AGENT,
        agentUpdateAvailable: /^\d/.test(h.agentVersion) && cmpVersion(h.agentVersion, LATEST_AGENT) < 0,
        firmwareUpdateAvailable: !!h.firmware && !!fwLatest && h.firmware.bmc.split(' ')[0] === fwLatest.split(' ')[0] && h.firmware.bmc !== fwLatest && cmpVersion(h.firmware.bmc.replace(/^\D+/, ''), fwLatest.replace(/^\D+/, '')) < 0,
      };
    },

    create: (ctx, body) => {
      const loc = db.get<Location>('locations', body.locationId);
      const rackUnit = Number(body.rackUnit);
      const auto = body.discover !== 'manual';
      validate({
        name: nameError(body.name, 'Hostname') || (db.find<BareMetalHost>('hosts', (h) => h.name === body.name) && `Host "${body.name}" is already enrolled`),
        locationId: !loc ? 'Choose a location' : loc.kind !== 'selfHosted' && 'Hosts can only be enrolled into self-hosted locations',
        rack: !String(body.rack ?? '').trim() ? 'Rack is required' : !/^[A-Za-z0-9-]{1,12}$/.test(body.rack) && 'Letters, digits and dashes (max 12)',
        bmcIp: !isIPv4(body.bmcIp) ? 'Enter a valid IPv4 address' : db.find<BareMetalHost>('hosts', (h) => h.bmcIp === body.bmcIp) && `BMC ${body.bmcIp} belongs to an enrolled host`,
        mgmtIp: !isIPv4(body.mgmtIp) ? 'Enter a valid IPv4 address' : body.mgmtIp === body.bmcIp ? 'Must differ from the BMC IP' : db.find<BareMetalHost>('hosts', (h) => h.mgmtIp === body.mgmtIp) && `${body.mgmtIp} is already used by another host`,
        bmcUser: !String(body.bmcUser ?? '').trim() && 'BMC username is required',
        bmcPassword: !String(body.bmcPassword ?? '') && 'BMC password is required',
      });
      const inv = auto ? inventoryFor(body.bmcIp) : manualInventory(body.hardware ?? {}, body.bmcIp);
      const sizeU = Number(body.sizeU ?? inv.sizeU);
      const cpuOc = body.cpuOvercommit ?? 4;
      const ramOc = body.ramOvercommit ?? 1;
      validate({
        sizeU: !(Number.isInteger(sizeU) && sizeU >= 1 && sizeU <= 8) && 'Height must be 1–8U',
        rackUnit: !(Number.isInteger(rackUnit) && rackUnit >= 1 && rackUnit <= 42) ? 'Unit must be 1–42' : rackUnit + sizeU - 1 > 42 && `A ${sizeU}U server at U${rackUnit} exceeds the 42U rack`,
        cpuOvercommit: !(typeof cpuOc === 'number' && cpuOc >= 1 && cpuOc <= 8) && 'CPU overcommit must be 1–8',
        ramOvercommit: !(typeof ramOc === 'number' && ramOc >= 1 && ramOc <= 1.5) && 'RAM overcommit must be 1–1.5',
      });
      const clash = rackConflict(loc!.id, body.rack, rackUnit, sizeU);
      if (clash) validate({ rackUnit: `U${rackUnit}–${rackUnit + sizeU - 1} overlaps ${clash.name} (U${clash.rackUnit}–${clash.rackUnit + clash.sizeU - 1}) in rack ${clash.rack}` });
      const roles: HostRole[] = body.roles ?? ENROLL_DEFAULT_ROLES;
      validatePolicy(roles, body.access ?? undefined);

      const host: BareMetalHost = {
        id: newId('bm'), name: body.name, locationId: loc!.id, rack: String(body.rack).toUpperCase(), rackUnit, sizeU,
        vendor: auto ? 'Discovering…' : inv.vendor, model: auto ? '' : inv.model, serial: auto ? '' : inv.serial, cpuModel: auto ? '' : inv.cpuModel,
        sockets: auto ? 0 : inv.sockets, cpuCores: auto ? 0 : inv.cpuCores, threads: auto ? 0 : inv.threads, ramGB: auto ? 0 : inv.ramGB,
        disks: auto ? [] : inv.disks, nics: auto ? [] : inv.nics, gpus: auto ? [] : inv.gpus,
        hypervisor: 'KVM', bmcIp: body.bmcIp, mgmtIp: body.mgmtIp, status: 'provisioning', cpuOvercommit: cpuOc, ramOvercommit: ramOc,
        agentVersion: '—', kernel: '—', bootedAt: nowIso(), createdAt: nowIso(), tags: Array.isArray(body.tags) ? body.tags : [], powerWatts: auto ? 0 : inv.estimatedWatts,
        bmcUser: String(body.bmcUser), bmcCredential: '••••••••', firmware: auto ? undefined : inv.firmware, maintenanceReason: null, lastHealthCheck: null, notes: body.notes ?? '',
        roles: [...new Set(roles)], access: normaliseAccess(body.access),
      };
      return host;
    },
    afterCreate: (ctx, h) => {
      const body = ctx.body ?? {};
      const inv = body.discover !== 'manual' ? inventoryFor(h.bmcIp) : manualInventory(body.hardware ?? {}, h.bmcIp);
      const pw = String(body.bmcPassword ?? '').toLowerCase();
      startEnrollment(ctx, h, inv, { auto: body.discover !== 'manual', bmcUser: h.bmcUser ?? 'root', badCredentials: pw.includes('invalid') || pw.includes('wrong') });
    },

    update: (_ctx, h, patch) => {
      const next: BareMetalHost = { ...h };
      if ('name' in patch) {
        validate({ name: nameError(patch.name, 'Hostname') || (db.find<BareMetalHost>('hosts', (x) => x.name === patch.name && x.id !== h.id) && `Host "${patch.name}" already exists`) });
        next.name = patch.name;
      }
      if ('tags' in patch) next.tags = Array.isArray(patch.tags) ? patch.tags : [];
      if ('notes' in patch) next.notes = String(patch.notes ?? '');
      if ('rack' in patch || 'rackUnit' in patch) {
        const rack = String(patch.rack ?? h.rack).toUpperCase();
        const unit = Number(patch.rackUnit ?? h.rackUnit);
        validate({
          rack: !/^[A-Za-z0-9-]{1,12}$/.test(rack) && 'Letters, digits and dashes (max 12)',
          rackUnit: !(Number.isInteger(unit) && unit >= 1 && unit + h.sizeU - 1 <= 42) && `Unit must be 1–${43 - h.sizeU} for a ${h.sizeU}U server`,
        });
        const clash = rackConflict(h.locationId, rack, unit, h.sizeU, h.id);
        if (clash) validate({ rackUnit: `Overlaps ${clash.name} (U${clash.rackUnit}–${clash.rackUnit + clash.sizeU - 1})` });
        next.rack = rack; next.rackUnit = unit;
      }
      return next;
    },

    remove: (ctx, h) => { decommission(ctx, h); return 'async' },

    actions: {
      enterMaintenance: (ctx, h, body) => {
        requireHostStatus(h, ['ready', 'draining', 'error'], 'put into maintenance');
        requireNoOp(h.id, h.name);
        const plan = planEvacuation(h);
        if (!plan.feasible) throw new ApiError(409, plan.message, 'insufficient_capacity');
        const reason = String(body?.reason ?? '').trim() || 'Planned maintenance';
        const moves = plan.moves.map((m) => ({ vmId: m.vmId, targetHostId: m.targetHostId!, prevStatus: m.status as VM['status'] }));
        db.update<BareMetalHost>('hosts', h.id, { status: 'draining', maintenanceReason: reason });
        for (const m of plan.moves) if (m.status === 'running') db.update<VM>('vms', m.vmId, { status: 'migrating' });
        const steps: StepSpec[] = [
          { name: 'Cordon host', ms: ms(0.6), logs: [`${h.name} removed from placement candidates`, `reason: ${reason}`] },
          ...(plan.moves.length ? [{ name: 'Plan evacuation', ms: ms(0.8), logs: [`${plan.moves.length} VM(s) to move`, ...plan.targets.filter((t) => plan.moves.some((m) => m.targetHostId === t.id)).map((t) => `${t.name}: ${t.before.vcpus}→${t.after.vcpus}/${t.capacity.vcpus} vCPU · ${t.before.ramGB}→${t.after.ramGB}/${t.capacity.ramGB} GB`)] }] : []),
          ...plan.moves.map((m) => ({
            name: `${m.live ? 'Live-migrate' : 'Move'} ${m.vmName} → ${m.targetHostName}`, ms: ms(m.live ? 1.2 + Math.min(2, m.ramGB / 48) : 0.6),
            logs: m.live
              ? [`pre-copy ${m.ramGB} GiB over 25 GbE`, 'dirty pages: 100% → 7% → 0.3%', `switch-over, downtime ${18 + (hashString(m.vmId) % 30)}ms`, 'gratuitous ARP sent']
              : ['VM is stopped — moving domain definition', 'disk stays on shared storage (ceph rbd)'],
          })),
          { name: 'Verify host is empty', ms: ms(0.5), logs: ['0 libvirt domains running', 'hugepages released'] },
          { name: 'Enter maintenance mode', ms: ms(0.4), logs: ['alerts for this host silenced', 'host ready for hands-on work'] },
        ];
        return startOperation({
          type: 'bareMetal.maintenance', title: `Evacuate ${h.name} for maintenance`, target: { type: 'bareMetal', id: h.id, name: h.name }, steps, actor: ctx.actor,
          onComplete: 'host.evacuated', payload: { id: h.id, moves, reason },
        });
      },
      exitMaintenance: (ctx, h) => {
        requireHostStatus(h, ['maintenance', 'draining'], 'exit maintenance on');
        requireNoOp(h.id, h.name);
        if (h.status === 'draining') { db.update<BareMetalHost>('hosts', h.id, { status: 'ready', maintenanceReason: null }); return }
        return hostOp(ctx, h, 'bareMetal.exitMaintenance', `Return ${h.name} to service`, null, [
          { name: 'Pre-flight health check', ms: ms(1), logs: ['BMC sensors ok', 'agent heartbeat ok', 'storage & EVPN reachable'] },
          { name: 'Uncordon host', ms: ms(0.5), logs: ['host added back to placement candidates', 'alerts re-enabled'] },
        ], { status: 'ready', maintenanceReason: null }, false);
      },
      drain: (_ctx, h) => {
        requireHostStatus(h, ['ready'], 'cordon');
        db.update<BareMetalHost>('hosts', h.id, { status: 'draining' });
      },
      reboot: (ctx, h) => {
        requireHostStatus(h, ['ready', 'maintenance', 'draining', 'error'], 'reboot');
        requireNoOp(h.id, h.name);
        const running = hostVms(h.id).filter((v) => v.status === 'running');
        for (const v of running) db.update<VM>('vms', v.id, { status: 'rebooting' });
        const final = h.status === 'error' ? 'ready' : h.status;
        return transition({
          collection: 'hosts', id: h.id, kind: 'bareMetal', name: h.name, type: 'bareMetal.reboot', title: `Reboot ${h.name}`, during: { status: 'rebooting' }, actor: ctx.actor, silent: false,
          steps: [
            ...(running.length ? [{ name: `Pause ${running.length} running VM${running.length > 1 ? 's' : ''}`, ms: ms(1), logs: running.map((v) => `${v.name}: suspended to RAM (virsh managedsave)`) }] : []),
            { name: 'Graceful OS shutdown', ms: ms(1.2), logs: ['systemd: stopping services', 'agent: final heartbeat sent'] },
            { name: 'Power cycle via BMC', ms: ms(0.8), logs: [`Redfish ComputerSystem.Reset ResetType=ForceRestart → ${h.bmcIp}`] },
            { name: 'POST & memory training', ms: ms(2), logs: [`${h.ramGB} GB memory trained`, 'UEFI boot: ubuntu (nvme0)'] },
            { name: 'Boot hypervisor', ms: ms(1.4), logs: [`kernel ${h.kernel} up`, 'libvirtd active', 'EVPN sessions re-established'] },
            { name: 'Agent reconnect', ms: ms(0.6), logs: ['mTLS session established', 'heartbeat ok'] },
            ...(running.length ? [{ name: 'Resume VMs', ms: ms(0.8), logs: running.map((v) => `${v.name}: resumed`) }] : []),
          ],
          onComplete: 'host.rebooted', payload: { id: h.id, status: final, vmIds: running.map((v) => v.id) },
        });
      },
      runHealthCheck: (ctx, h) => {
        requireHostStatus(h, ['ready', 'maintenance', 'draining', 'error'], 'health-check');
        requireNoOp(h.id, h.name);
        return startOperation({
          type: 'bareMetal.healthCheck', title: `Health check ${h.name}`, target: { type: 'bareMetal', id: h.id, name: h.name }, actor: ctx.actor, silent: true,
          steps: [
            { name: 'Read BMC sensors', ms: ms(0.9), logs: ['Redfish Thermal & Power collections fetched', `${sensorsFor(h).fans.length} fans, 2 PSUs, ${h.sockets || 1} CPU sensor(s)`] },
            { name: 'Memory ECC counters', ms: ms(0.7), logs: ['edac-util: reading counters'] },
            { name: 'SMART self-assessment', ms: ms(1.2), logs: h.disks.map((d) => `${d.slot}: reading SMART log`) },
            { name: 'Network link check', ms: ms(0.6), logs: h.nics.map((n) => `${n.name}: ethtool`) },
            { name: 'Hypervisor & agent', ms: ms(0.6), logs: ['virsh list', 'agent /healthz'] },
          ],
          onComplete: 'host.healthChecked', payload: { id: h.id },
        });
      },
      updateAgent: (ctx, h) => {
        requireHostStatus(h, ['ready', 'maintenance', 'draining'], 'update the agent on');
        requireNoOp(h.id, h.name);
        if (!/^\d/.test(h.agentVersion) || cmpVersion(h.agentVersion, LATEST_AGENT) >= 0) throw new ApiError(409, `${h.name} already runs the latest agent (${LATEST_AGENT})`, 'up_to_date');
        return hostOp(ctx, h, 'bareMetal.updateAgent', `Update agent on ${h.name} to ${LATEST_AGENT}`, 'updating', [
          { name: `Download autark-agent ${LATEST_AGENT}`, ms: ms(0.8), logs: ['fetched from internal mirror (12.4 MB)'] },
          { name: 'Verify signature', ms: ms(0.5), logs: ['cosign verify: OK (key autark-release-2026)'] },
          { name: 'Restart agent', ms: ms(1), logs: ['VMs are not affected (agent runs out-of-band of qemu)', `systemctl restart autark-agent`, `${h.agentVersion} → ${LATEST_AGENT}`] },
          { name: 'Verify heartbeat', ms: ms(0.6), logs: ['heartbeat ok', 'capabilities re-registered'] },
        ], { status: h.status, agentVersion: LATEST_AGENT });
      },
      updateFirmware: (ctx, h) => {
        requireHostStatus(h, ['maintenance'], 'flash firmware on (enter maintenance first)');
        requireNoOp(h.id, h.name);
        const latestFw = TEMPLATES.find((t) => t.vendor === h.vendor)?.fw.bmc ?? h.firmware?.bmc ?? '1.0';
        return hostOp(ctx, h, 'bareMetal.updateFirmware', `Update BMC firmware on ${h.name}`, 'updating', [
          { name: 'Upload firmware image', ms: ms(1.4), logs: [`${latestFw} → BMC update service (Redfish SimpleUpdate)`] },
          { name: 'Flash & verify', ms: ms(2), logs: ['flashing…', 'checksum verified'] },
          { name: 'BMC restart', ms: ms(1.2), logs: ['BMC back online', `firmware ${latestFw}`] },
        ], { status: 'maintenance', firmware: { bios: h.firmware?.bios ?? '—', bmc: latestFw, nic: h.firmware?.nic } });
      },
      powerOff: (ctx, h) => {
        requireHostStatus(h, ['ready', 'maintenance', 'draining', 'error'], 'power off');
        requireNoOp(h.id, h.name);
        const active = hostVms(h.id).filter((v) => v.status !== 'stopped' && v.status !== 'error');
        if (active.length) throw new ApiError(409, `${active.length} VM${active.length > 1 ? 's are' : ' is'} still running on ${h.name} (${active.slice(0, 3).map((v) => v.name).join(', ')}). Enter maintenance to evacuate first.`, 'host_not_empty');
        return hostOp(ctx, h, 'bareMetal.powerOff', `Power off ${h.name}`, null, [
          { name: 'Cordon host', ms: ms(0.4) },
          { name: 'Graceful shutdown via BMC', ms: ms(1.6), logs: [`Redfish ComputerSystem.Reset ResetType=GracefulShutdown → ${h.bmcIp}`, 'chassis power: Off'] },
        ], { status: 'offline', nics: h.nics.map((n) => (n.role === 'bmc' ? n : { ...n, link: 'down' as const })) }, false);
      },
      powerOn: (ctx, h) => {
        requireHostStatus(h, ['offline'], 'power on');
        requireNoOp(h.id, h.name);
        return hostOp(ctx, h, 'bareMetal.powerOn', `Power on ${h.name}`, null, [
          { name: 'Power on via BMC', ms: ms(0.8), logs: [`Redfish ComputerSystem.Reset ResetType=On → ${h.bmcIp}`] },
          { name: 'POST & boot', ms: ms(2.4), logs: [`${h.ramGB} GB memory trained`, `kernel ${h.kernel} up`] },
          { name: 'Rejoin cluster', ms: ms(1), logs: ['EVPN sessions established', 'agent heartbeat ok'] },
        ], { status: 'ready', bootedAt: nowIso(), powerWatts: h.powerWatts || ratedWatts(h), nics: h.nics.map((n) => ({ ...n, link: 'up' as const })) }, false);
      },
      setOvercommit: (_ctx, h, body) => {
        const cpu = Number(body?.cpuOvercommit ?? h.cpuOvercommit);
        const ram = Number(body?.ramOvercommit ?? h.ramOvercommit);
        validate({
          cpuOvercommit: !(cpu >= 1 && cpu <= 8) && 'CPU overcommit must be between 1 and 8',
          ramOvercommit: !(ram >= 1 && ram <= 1.5) && 'RAM overcommit must be between 1.0 and 1.5',
        });
        const cap = hostCapacity({ ...h, cpuOvercommit: cpu, ramOvercommit: ram });
        const used = hostAllocation(h.id);
        validate({
          cpuOvercommit: used.vcpus > cap.vcpus && `Too low: ${used.vcpus} vCPU are allocated but ${cpu}× allows only ${cap.vcpus}`,
          ramOvercommit: used.ramGB > cap.ramGB && `Too low: ${used.ramGB} GB are allocated but ${ram}× allows only ${cap.ramGB} GB`,
        });
        db.update<BareMetalHost>('hosts', h.id, { cpuOvercommit: cpu, ramOvercommit: ram });
      },
      migrateVm: (ctx, h, body) => {
        const vm = getOr404<VM>('vms', body?.vmId, 'VM');
        if (vm.hostId !== h.id) throw new ApiError(422, `${vm.name} does not run on ${h.name}`, 'validation_failed');
        const migrate = collections.get('vms')?.actions?.migrate;
        if (!migrate) throw new ApiError(501, 'Migration is not available', 'not_implemented');
        return migrate(ctx, vm, { hostId: body?.hostId || undefined });
      },
      retryEnrollment: (ctx, h, body) => {
        requireHostStatus(h, ['provisioning', 'error'], 'retry enrollment of');
        requireNoOp(h.id, h.name);
        const pw = String(body?.bmcPassword ?? '').toLowerCase();
        db.update<BareMetalHost>('hosts', h.id, { status: 'provisioning' });
        return startEnrollment(ctx, h, h.cpuCores ? { ...inventoryFor(h.bmcIp), vendor: h.vendor, model: h.model, serial: h.serial, cpuModel: h.cpuModel, sockets: h.sockets, cpuCores: h.cpuCores, threads: h.threads, ramGB: h.ramGB, disks: h.disks, nics: h.nics, gpus: h.gpus, firmware: h.firmware ?? inventoryFor(h.bmcIp).firmware, estimatedWatts: h.powerWatts || ratedWatts(h) } : inventoryFor(h.bmcIp), {
          auto: !h.cpuCores, bmcUser: body?.bmcUser || h.bmcUser || 'root', badCredentials: pw.includes('invalid') || pw.includes('wrong'),
        });
      },
      decommission: (ctx, h) => { decommission(ctx, h); return { ok: true, async: true } },
      /** Set workload roles & availability. Existing workloads keep running; new placements follow the policy. */
      updatePolicy: (_ctx, h, body) => {
        const roles: HostRole[] = Array.isArray(body?.roles) ? [...new Set(body.roles as HostRole[])] : hostRoles(h);
        const access = body?.access !== undefined ? body.access : hostAccess(h);
        validatePolicy(roles, access);
        const norm = normaliseAccess(access);
        const impact = policyImpact(h, roles, norm);
        db.update<BareMetalHost>('hosts', h.id, { roles, access: norm });
        if (impact.violations.some((v) => v.outcome === 'unplaced')) {
          notify('warning', `${h.name}: policy leaves workloads without a host`, impact.violations.filter((v) => v.outcome === 'unplaced').map((v) => `${v.name}: ${v.detail}`).join(' · '), `/hardware/bare-metals/${h.id}?tab=policy`);
        }
        return { ok: true, id: h.id, roles, access: norm, ...impact };
      },
    },
  });

  /** Dry-run of updatePolicy: validation + impact report, nothing is saved (not audited). */
  route('POST', '/hosts/:id/policy-preview', (ctx) => {
    const h = getOr404<BareMetalHost>('hosts', ctx.params.id, 'Host');
    const roles: HostRole[] = Array.isArray(ctx.body?.roles) ? [...new Set(ctx.body.roles as HostRole[])] : hostRoles(h);
    const access = ctx.body?.access !== undefined ? ctx.body.access : hostAccess(h);
    const errors = policyErrors(roles, access, policyExists);
    if (Object.keys(errors).length) return { valid: false, errors, violations: [], incoming: [], summary: Object.values(errors)[0] };
    return { valid: true, errors: {}, ...policyImpact(h, roles, normaliseAccess(access)) };
  }, 'Preview the impact of a host policy change (roles & access) without saving it');

  route('GET', '/hosts/storage-pools', () => ({ items: storagePools() }), 'Ceph storage pool per location (raw / usable / used TB) formed by hosts with the storage role');

  /** Probe a BMC before enrollment (simulated Redfish discovery). */
  route('POST', '/hosts/probe', (ctx) => {
    const b = ctx.body ?? {};
    validate({
      bmcIp: !isIPv4(b.bmcIp) && 'Enter a valid IPv4 address',
      bmcUser: !String(b.bmcUser ?? '').trim() && 'Username is required',
      bmcPassword: !String(b.bmcPassword ?? '') && 'Password is required',
    });
    const dup = db.find<BareMetalHost>('hosts', (h) => h.bmcIp === b.bmcIp);
    if (dup) throw new ApiError(409, `${b.bmcIp} is the BMC of ${dup.name}, which is already enrolled`, 'conflict', { bmcIp: `Already enrolled as ${dup.name}` });
    const last = Number(String(b.bmcIp).split('.')[3]);
    if (last === 0 || last === 254 || last === 255) throw new ApiError(422, `No Redfish/IPMI endpoint answered at ${b.bmcIp} within 10s. Check the out-of-band network, VLAN and IP.`, 'bmc_unreachable', { bmcIp: 'BMC unreachable (timeout)' });
    const pw = String(b.bmcPassword).toLowerCase();
    if (pw.includes('invalid') || pw.includes('wrong')) throw new ApiError(422, `Redfish authentication failed for "${b.bmcUser}" at ${b.bmcIp} (401 Unauthorized).`, 'bmc_auth_failed', { bmcPassword: 'Authentication failed' });
    return inventoryFor(b.bmcIp);
  }, 'Probe a BMC via Redfish and return discovered hardware');

  route('GET', '/hosts/:id/evacuation-plan', (ctx) => planEvacuation(getOr404<BareMetalHost>('hosts', ctx.params.id, 'Host')), 'Preview where each VM goes when the host enters maintenance');

  registerMetrics('bareMetal', (h: BareMetalHost, metric) => hostProfile(h, metric));

  /* ------------------------------------------------------------------ providers */
  defineCollection<CloudProvider>({
    name: 'providers', kind: 'provider', idPrefix: 'provider', scoped: false,
    searchText: (p) => `${p.id} ${p.name} ${p.kind} ${p.status} ${p.regions.join(' ')} ${p.tags.map((t) => `${t.key}:${t.value}`).join(' ')}`,
    subtitle: (p) => `Cloud provider · ${p.kind} · ${p.regions.length} region(s) · ${p.status}`,
    sort: (a, b) => a.name.localeCompare(b.name),
    decorate: (p) => ({ ...p, availableRegions: regionsOf(p), ...providerUsage(p) }),

    create: (_ctx, body) => {
      const cat = catalogFor(body.kind);
      if (!cat) validate({ kind: 'Choose a provider' });
      const name = String(body.name ?? '').trim() || cat!.label;
      const regions: string[] = Array.isArray(body.regions) ? body.regions : [];
      const services = Array.isArray(body.allowedServices) && body.allowedServices.length ? body.allowedServices : ['vm', 'volume', 'network', 'ip'];
      validate({
        name: name.length > 60 ? 'Max 60 characters' : db.find<CloudProvider>('providers', (p) => p.name.toLowerCase() === name.toLowerCase()) && `A provider named "${name}" already exists`,
        regions: !regions.length ? 'Enable at least one region' : regions.find((r) => !cat!.regions.some((x) => x.code === r)) && `Unknown region for ${cat!.label}`,
        allowedServices: !services.includes('vm') ? 'Virtual machines must be allowed' : services.some((s: string) => !['vm', 'volume', 'network', 'ip'].includes(s)) && 'Unknown service',
      });
      validateCredentials(cat!, body.credentials);
      const quotas = body.quotas ?? cat!.defaultQuotas;
      validateQuotas(quotas);
      const m = maskCredentials(cat!, body.credentials);
      const row: CloudProvider = {
        id: newId('provider'), name, kind: cat!.kind as ProviderKind, status: 'connecting', regions: [...new Set(regions)], availableRegions: cat!.regions,
        credentials: m.credentials, credentialsValid: m.credentialsValid, endpoint: m.endpoint, quotas, lastSyncAt: null, lastError: null, lastTestAt: null,
        allowedServices: services, createdAt: nowIso(), tags: Array.isArray(body.tags) ? body.tags : [],
      };
      return row;
    },
    afterCreate: (ctx, p) => { providerOp(ctx, p, 'connect') },

    update: (_ctx, p, patch) => {
      const next: CloudProvider = { ...p };
      if ('name' in patch) {
        const name = String(patch.name ?? '').trim();
        validate({ name: !name ? 'Name is required' : db.find<CloudProvider>('providers', (x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase()) && `A provider named "${name}" already exists` });
        next.name = name;
      }
      if ('tags' in patch) next.tags = Array.isArray(patch.tags) ? patch.tags : [];
      if ('allowedServices' in patch) {
        validate({ allowedServices: !(Array.isArray(patch.allowedServices) && patch.allowedServices.includes('vm')) && 'Virtual machines must be allowed' });
        next.allowedServices = patch.allowedServices;
      }
      return next;
    },

    remove: (_ctx, p) => {
      requireNoOp(p.id, p.name);
      const locs = providerLocations(p);
      const res = resourcesIn(locs.map((l) => l.id));
      if (res.count) throw new ApiError(409, `Cannot remove ${p.name}: ${res.text} still exist in its regions. Migrate or delete them first.`, 'provider_in_use');
      for (const l of locs) db.remove('locations', l.id);
      return 'deleted';
    },

    actions: {
      testConnection: (ctx, p) => { requireNoOp(p.id, p.name); return providerOp(ctx, p, 'test') },
      sync: (ctx, p) => {
        if (p.status === 'disabled') throw new ApiError(409, `${p.name} is disabled. Enable it to sync.`, 'invalid_state');
        requireNoOp(p.id, p.name);
        return providerOp(ctx, p, 'sync');
      },
      rotateCredentials: (ctx, p, body) => {
        const cat = catalogFor(p.kind)!;
        requireNoOp(p.id, p.name);
        validateCredentials(cat, body?.credentials);
        const m = maskCredentials(cat, body.credentials);
        const next = db.update<CloudProvider>('providers', p.id, { credentials: m.credentials, credentialsValid: m.credentialsValid, ...(m.endpoint ? { endpoint: m.endpoint } : {}), status: p.status === 'disabled' ? 'disabled' : 'connecting' });
        return providerOp(ctx, next, 'rotate');
      },
      enableRegion: (ctx, p, body) => {
        const region = String(body?.region ?? '');
        const r = regionsOf(p).find((x) => x.code === region);
        if (!r) throw new ApiError(422, `Unknown region "${region}" for ${p.name}`, 'validation_failed', { region: 'Unknown region' });
        if (p.regions.includes(region)) throw new ApiError(409, `${region} is already enabled`, 'conflict');
        if (p.status !== 'connected') throw new ApiError(409, `${p.name} is ${p.status}. Fix the connection before enabling regions.`, 'invalid_state');
        return startOperation({
          type: 'provider.enableRegion', title: `Enable ${p.name} ${region}`, target: { type: 'provider', id: p.id, name: p.name }, actor: ctx.actor, silent: true,
          steps: [
            { name: 'Validate region access', ms: ms(0.8), logs: [`${r.name} (${r.city}, ${r.country}) available for this account`] },
            { name: 'Create base network & security group', ms: ms(1.2), logs: ['autark-base network 10.200.0.0/16', 'default-deny security group'] },
            { name: 'Import base images', ms: ms(1.2), logs: ['ubuntu-24.04, debian-12, rocky-9 mapped to provider images'] },
            { name: 'Register location', ms: ms(0.5), logs: [`location ${locationIdFor(p, region)} available to projects (subject to allowances)`] },
          ],
          onComplete: 'provider.regionEnabled', payload: { id: p.id, region },
        });
      },
      disableRegion: (_ctx, p, body) => {
        const region = String(body?.region ?? '');
        if (!p.regions.includes(region)) throw new ApiError(409, `${region} is not enabled`, 'conflict');
        const loc = db.find<Location>('locations', (l) => l.providerId === p.id && l.region === region);
        if (loc) {
          const res = resourcesIn([loc.id]);
          if (res.count) throw new ApiError(409, `Cannot disable ${region}: ${res.text} still run there. Migrate or delete them first.`, 'region_in_use');
          db.remove('locations', loc.id);
        }
        db.update<CloudProvider>('providers', p.id, { regions: p.regions.filter((x) => x !== region) });
      },
      updateQuotas: (_ctx, p, body) => {
        const q = { ...p.quotas, ...(body?.quotas ?? {}) };
        const u = providerUsage(p).usage;
        validateQuotas(q, { vcpus: u.vcpus, ramGB: u.ramGB, vms: u.vms, ips: u.ips });
        db.update<CloudProvider>('providers', p.id, { quotas: q });
      },
      disable: (_ctx, p) => {
        if (p.status === 'disabled') throw new ApiError(409, `${p.name} is already disabled`, 'conflict');
        requireNoOp(p.id, p.name);
        db.update<CloudProvider>('providers', p.id, { status: 'disabled' });
      },
      enable: (ctx, p) => {
        if (p.status !== 'disabled') throw new ApiError(409, `${p.name} is not disabled`, 'conflict');
        requireNoOp(p.id, p.name);
        return providerOp(ctx, p, 'enable');
      },
    },
  });

  route('GET', '/providers/catalog', () => ({ items: PROVIDER_CATALOG }), 'Supported cloud provider kinds, credential fields and regions');
}
