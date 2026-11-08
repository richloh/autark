import { db } from '../db';
import { ApiError, newId, nowIso } from '../framework';
import { parseCidr, intToIp, ipToInt } from '@/lib/cidr';
import { hostRoles, hostAllows, isRestricted, policyReason, ROLE_META, type PolicyNames, type WorkloadCtx } from '@/lib/hostPolicy';
import type { BareMetalHost, VM, IpAddress, IpPool, Firewall, Ref, ProjectAllowance, Tag, Volume, Location, Network, HostRole, Account, Project } from '@/types';

/* Cross-domain helpers shared by handlers. Keep relationships (which are stored on both sides for
 * convenient reads) consistent by always going through these functions. */

/* ---------------------------------------------------------------- hosts / placement */

/** Kind of a managed workload placed on a host (besides VMs). */
export type ManagedKind = 'db' | 'k8s' | 'k8s-cp' | 'lb';
export interface ManagedItem { kind: ManagedKind; id: string; name: string; vcpus: number; ramGB: number; gpus: number; projectId?: string; role: HostRole }

/** Lookup names for policy reasons ("Reserved for SAP IS/U"). */
export const policyNames: PolicyNames = {
  account: (id) => db.get<Account>('accounts', id)?.name ?? id,
  project: (id) => db.get<Project>('projects', id)?.name ?? id,
};

/** Workload context for a project (account derived from the project). */
export function workloadFor(projectId: string | null | undefined, role: HostRole = 'compute', accountId?: string | null): WorkloadCtx {
  const p = projectId ? db.get<Project>('projects', projectId) : undefined;
  return { role, projectId: projectId ?? null, accountId: accountId ?? p?.accountId ?? null };
}

const CP_SIZE: Record<string, { vcpus: number; ramGB: number }> = { small: { vcpus: 2, ramGB: 4 }, medium: { vcpus: 4, ramGB: 8 }, large: { vcpus: 8, ramGB: 16 } };
export const LB_NODE = { count: 2, vcpus: 2, ramGB: 4 };

/**
 * Managed workloads that also consume host capacity, placed deterministically on ready hosts whose
 * policy allows them (role + access by the workload's project):
 *  - database primaries/standbys (role compute; primaryHostId/standbyHostId when still eligible)
 *  - Kubernetes worker nodes (role k8s-worker; GPU pools → GPU hosts)
 *  - Kubernetes control planes (role k8s-control-plane; 1 replica, 3 when HA)
 *  - load balancer nodes (role load-balancer; 2 per LB)
 * Workloads with no eligible host are skipped. `override` lets callers simulate a policy change.
 */
export function managedPlacements(override?: Map<string, Pick<BareMetalHost, 'roles' | 'access'>>): Map<string, ManagedItem[]> {
  const out = new Map<string, ManagedItem[]>();
  const add = (hostId: string, w: ManagedItem) => {
    if (!out.has(hostId)) out.set(hostId, []);
    out.get(hostId)!.push(w);
  };
  const ready = db.filter<BareMetalHost>('hosts', (h) => h.status === 'ready' && h.hypervisor === 'KVM')
    .map((h) => (override?.has(h.id) ? { ...h, ...override.get(h.id)! } : h))
    .sort((a, b) => a.id.localeCompare(b.id));
  const eligible = (loc: string, role: HostRole, r: { projectId?: string; accountId?: string }) => {
    const wl = workloadFor(r.projectId, role, r.accountId);
    return ready.filter((h) => h.locationId === loc && hostRoles(h).includes(role) && hostAllows(h, wl));
  };
  const spread = (list: BareMetalHost[], seed: string, n: number) => Array.from({ length: n }, (_, i) => list[(hashIdx(seed, list.length) + i) % list.length]);

  for (const d of db.list<any>('dbInstances')) {
    if (d.status === 'stopped' || d.status === 'deleting') continue;
    const all = eligible(d.locationId, 'compute', d);
    const atLoc = all.filter((h) => !h.gpus.length).length ? all.filter((h) => !h.gpus.length) : all;
    if (!atLoc.length) continue;
    const primary = atLoc.find((h) => h.id === d.primaryHostId) ?? atLoc[hashIdx(d.id, atLoc.length)];
    add(primary.id, { kind: 'db', id: d.id, name: `${d.name} (primary)`, vcpus: d.size.vcpus, ramGB: d.size.ramGB, gpus: 0, projectId: d.projectId, role: 'compute' });
    if (d.ha && atLoc.length > 1) {
      const standby = atLoc.find((h) => h.id === d.standbyHostId && h.id !== primary.id) ?? atLoc[(atLoc.indexOf(primary) + 1) % atLoc.length];
      add(standby.id, { kind: 'db', id: d.id, name: `${d.name} (standby)`, vcpus: d.size.vcpus, ramGB: d.size.ramGB, gpus: 0, projectId: d.projectId, role: 'compute' });
    }
  }
  for (const k of db.list<any>('k8sClusters')) {
    if (k.status === 'deleting') continue;
    // control plane
    const cpAll = eligible(k.locationId, 'k8s-control-plane', k);
    const cpHosts = cpAll.filter((h) => !h.gpus.length).length ? cpAll.filter((h) => !h.gpus.length) : cpAll;
    if (cpHosts.length) {
      const size = CP_SIZE[k.controlPlane?.size] ?? CP_SIZE.small;
      const replicas = k.controlPlane?.ha ? 3 : 1;
      spread(cpHosts, `${k.id}-cp`, replicas).forEach((h, i) => add(h.id, { kind: 'k8s-cp', id: k.id, name: `${k.name}/control-plane-${i + 1}`, vcpus: size.vcpus, ramGB: size.ramGB, gpus: 0, projectId: k.projectId, role: 'k8s-control-plane' }));
    }
    // worker pools
    const workers = eligible(k.locationId, 'k8s-worker', k);
    for (const p of k.nodePools ?? []) {
      const wantsGpu = !!p.gpu;
      const atLoc = workers.filter((h) => (wantsGpu ? h.gpus.length > 0 : !h.gpus.length));
      if (!atLoc.length) continue;
      spread(atLoc, k.id + p.id, p.count).forEach((h, i) => add(h.id, { kind: 'k8s', id: k.id, name: `${k.name}/${p.name}-${i + 1}`, vcpus: p.vcpus, ramGB: p.ramGB, gpus: p.gpu?.count ?? 0, projectId: k.projectId, role: 'k8s-worker' }));
    }
  }
  for (const lb of db.list<any>('loadBalancers')) {
    if (lb.status === 'deleting') continue;
    const loc = db.get<Location>('locations', lb.locationId);
    if (!loc || loc.kind !== 'selfHosted') continue;
    const all = eligible(lb.locationId, 'load-balancer', lb);
    const atLoc = all.filter((h) => !h.gpus.length).length ? all.filter((h) => !h.gpus.length) : all;
    if (!atLoc.length) continue;
    spread(atLoc, lb.id, LB_NODE.count).forEach((h, i) => add(h.id, { kind: 'lb', id: lb.id, name: `${lb.name}/node-${i + 1}`, vcpus: LB_NODE.vcpus, ramGB: LB_NODE.ramGB, gpus: 0, projectId: lb.projectId, role: 'load-balancer' }));
  }
  return out;
}

function hashIdx(s: string, n: number) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % n }

export function hostAllocation(hostId: string, placements = managedPlacements()) {
  const vms = db.filter<VM>('vms', (v) => v.hostId === hostId && v.status !== 'deleting');
  const managed = placements.get(hostId) ?? [];
  return {
    vcpus: vms.reduce((a, v) => a + v.size.vcpus, 0) + managed.reduce((a, m) => a + m.vcpus, 0),
    ramGB: vms.reduce((a, v) => a + v.size.ramGB, 0) + managed.reduce((a, m) => a + m.ramGB, 0),
    diskGB: vms.reduce((a, v) => a + v.size.systemDiskGB, 0),
    gpus: vms.reduce((a, v) => a + (v.gpu?.count ?? 0), 0) + managed.reduce((a, m) => a + m.gpus, 0),
    vms: vms.length,
    managed: managed.length,
    managedItems: managed,
  };
}

export function hostCapacity(h: BareMetalHost) {
  return {
    vcpus: h.threads * h.cpuOvercommit,
    ramGB: Math.floor(h.ramGB * h.ramOvercommit * 0.92), // 8% reserved for hypervisor
    gpus: h.gpus.reduce((a, g) => a + g.count, 0),
    diskGB: h.disks.filter((d) => d.type !== 'hdd').reduce((a, d) => a + d.sizeGB, 0),
  };
}

export interface HostCandidate {
  host: BareMetalHost;
  fits: boolean;
  reason: string | null; // why it does not fit
  /** set when the host's policy (role or access) excludes the workload */
  excluded: 'role' | 'access' | null;
  /** restricted host that is reserved for this workload's account/project */
  dedicated: boolean;
  cap: ReturnType<typeof hostCapacity>;
  used: { vcpus: number; ramGB: number; gpus: number; vms: number };
  score: number;
}

export type Need = { vcpus: number; ramGB: number; gpus: number; gpuModel?: string };
const DEFAULT_WL: WorkloadCtx = { role: 'compute' };

/**
 * Rank all hosts at a self-hosted location for a request (the scheduler's logic, also used for the
 * placement preview). Hosts whose policy excludes the workload (wrong role, reserved for someone
 * else) are never candidates. Among fitting hosts: dedicated (reserved for this project/account)
 * first, GPU hosts kept free for GPU workloads, then most free RAM.
 */
export function rankHosts(locationId: string, need: Need, excludeId?: string, wl: WorkloadCtx = DEFAULT_WL): HostCandidate[] {
  const placements = managedPlacements();
  return db
    .filter<BareMetalHost>('hosts', (h) => h.locationId === locationId && h.id !== excludeId && h.status !== 'decommissioning')
    .map((h) => {
      const cap = hostCapacity(h);
      const a = hostAllocation(h.id, placements);
      const used = { vcpus: a.vcpus, ramGB: a.ramGB, gpus: a.gpus, vms: a.vms };
      const freeRam = cap.ramGB - used.ramGB;
      const freeCpu = cap.vcpus - used.vcpus;
      const gpuOk = need.gpus === 0 || (h.gpus.some((g) => !need.gpuModel || g.model === need.gpuModel) && cap.gpus - used.gpus >= need.gpus);
      const policy = policyReason(h, wl, policyNames);
      const excluded: HostCandidate['excluded'] = !policy ? null : policy.startsWith('Reserved') ? 'access' : 'role';
      const reason = policy
        ?? (h.status !== 'ready' ? `Host is ${h.status}`
        : freeRam < need.ramGB ? `Only ${Math.max(0, freeRam)} GB RAM free`
        : freeCpu < need.vcpus ? `Only ${Math.max(0, freeCpu)} vCPU free`
        : !gpuOk ? (need.gpuModel ? `No free ${need.gpuModel} GPU` : 'No free GPU') : null);
      const dedicated = !policy && isRestricted(h);
      const gpuPenalty = need.gpus === 0 && cap.gpus > 0 ? 1 : 0;
      return { host: h, fits: !reason, reason, excluded, dedicated, cap, used, score: (policy ? -2e6 : reason ? -1e6 : 0) + (dedicated ? 5e5 : 0) - gpuPenalty * 1e5 + freeRam };
    })
    .sort((x, y) => y.score - x.score);
}

/** Choose the best host at a self-hosted location that fits the request and whose policy allows the workload. */
export function pickHost(locationId: string, need: Need, excludeId?: string, wl: WorkloadCtx = DEFAULT_WL): BareMetalHost {
  const ranked = rankHosts(locationId, need, excludeId, wl);
  const best = ranked.find((c) => c.fits);
  if (!best) {
    const allowed = ranked.filter((c) => !c.excluded);
    const what = `${need.vcpus} vCPU / ${need.ramGB} GB${need.gpus ? ` / ${need.gpus}× GPU` : ''}`;
    if (ranked.length && !allowed.length) {
      throw new ApiError(409, `No host in ${locationId} may run ${ROLE_META[wl.role].workload}${wl.projectId ? ` for ${policyNames.project(wl.projectId)}` : ''}: ${[...new Set(ranked.map((c) => c.reason))].slice(0, 3).join('; ')}. Adjust host policies under Bare metal hosts or choose another location.`, 'no_eligible_host');
    }
    throw new ApiError(409, `No eligible host in ${locationId} has capacity for ${what}${ranked.length > allowed.length ? ` (${ranked.length - allowed.length} host(s) excluded by policy)` : ''}. Add hardware or choose another location.`, 'insufficient_capacity');
  }
  return best.host;
}

/** Validate an explicitly chosen host for a request (manual placement override), including its policy. */
export function checkHostFits(hostId: string, locationId: string, need: Need, wl: WorkloadCtx = DEFAULT_WL): BareMetalHost {
  const host = db.get<BareMetalHost>('hosts', hostId);
  if (!host) throw new ApiError(422, 'Unknown host', 'validation_failed', { hostId: 'Unknown host' });
  if (host.locationId !== locationId) throw new ApiError(422, `${host.name} is in ${host.locationId}, not ${locationId}`, 'validation_failed', { hostId: 'Host is in another location' });
  const c = rankHosts(locationId, need, undefined, wl).find((x) => x.host.id === hostId);
  if (c?.excluded) throw new ApiError(422, `${host.name} can't run this workload: ${c.reason}`, 'host_policy', { hostId: c.reason ?? 'Excluded by host policy' });
  if (!c?.fits) throw new ApiError(409, `${host.name} can't take this VM: ${c?.reason ?? 'not schedulable'}`, 'insufficient_capacity', { hostId: c?.reason ?? 'Not schedulable' });
  return host;
}

export function locationOrThrow(id: string): Location {
  const l = db.get<Location>('locations', id);
  if (!l) throw new ApiError(422, `Unknown location ${id}`, 'validation_failed', { locationId: 'Unknown location' });
  return l;
}

/* ---------------------------------------------------------------- governance */

export function allowanceFor(projectId: string): ProjectAllowance | undefined {
  return db.find<ProjectAllowance>('allowances', (a) => a.projectId === projectId);
}

export function projectUsage(projectId: string) {
  const vms = db.filter<VM>('vms', (v) => v.projectId === projectId);
  return {
    vcpus: vms.reduce((a, v) => a + v.size.vcpus, 0),
    ramGB: vms.reduce((a, v) => a + v.size.ramGB, 0),
    vms: vms.length,
    volumesGB: db.filter<Volume>('volumes', (v) => v.projectId === projectId).reduce((a, v) => a + v.sizeGB, 0),
    dbInstances: db.filter<any>('dbInstances', (d) => d.projectId === projectId).length,
    k8sClusters: db.filter<any>('k8sClusters', (d) => d.projectId === projectId).length,
    buckets: db.filter<any>('buckets', (d) => d.projectId === projectId).length,
    publicIps: db.filter<IpAddress>('ips', (d) => d.projectId === projectId).length,
  };
}

export type QuotaKey = keyof ProjectAllowance['quotas'];
const QUOTA_LABEL: Record<QuotaKey, string> = { vcpus: 'vCPUs', ramGB: 'GB RAM', vms: 'VMs', volumesGB: 'GB volumes', dbInstances: 'databases', k8sClusters: 'Kubernetes clusters', buckets: 'buckets', publicIps: 'public IPs' };

/** Throws 422 when adding `delta` would exceed the project's quota. */
export function checkQuota(projectId: string, delta: Partial<Record<QuotaKey, number>>) {
  const a = allowanceFor(projectId);
  if (!a) return;
  const used = projectUsage(projectId);
  for (const [k, d] of Object.entries(delta) as [QuotaKey, number][]) {
    if (!d || d <= 0) continue;
    const limit = a.quotas[k];
    if (limit != null && used[k] + d > limit) {
      throw new ApiError(422, `Quota exceeded: project allows ${limit} ${QUOTA_LABEL[k]} (${used[k]} used, requesting +${d}). Ask an admin to raise the allowance.`, 'quota_exceeded', { [k]: `Quota ${used[k]}/${limit}` });
    }
  }
}

export function checkRequiredTags(projectId: string, tags: Tag[] | undefined) {
  const a = allowanceFor(projectId);
  if (!a?.requiredTags?.length) return;
  const missing = a.requiredTags.filter((k) => !(tags ?? []).some((t) => t.key === k && t.value));
  if (missing.length) throw new ApiError(422, `Tag policy: this project requires tag${missing.length > 1 ? 's' : ''} ${missing.map((m) => `"${m}"`).join(', ')}`, 'tag_policy', { tags: `Missing required: ${missing.join(', ')}` });
}

export function checkLocationAllowed(projectId: string, locationId: string) {
  const a = allowanceFor(projectId);
  if (a?.allowedLocations?.length && !a.allowedLocations.includes(locationId)) {
    throw new ApiError(422, `Location policy: project may only use ${a.allowedLocations.join(', ')}`, 'location_policy', { locationId: 'Not allowed for this project' });
  }
}

/* ---------------------------------------------------------------- IPs */

export function poolUsed(poolId: string): Set<string> {
  return new Set(db.filter<IpAddress>('ips', (i) => i.poolId === poolId).map((i) => i.address));
}

/** Allocate the next free address from a pool and insert the IP row. */
export function allocateIp(poolId: string, scope: { accountId: string; projectId: string }, assignedTo: Ref | null = null, name?: string): IpAddress {
  const pool = db.get<IpPool>('ipPools', poolId);
  if (!pool) throw new ApiError(422, 'Unknown IP pool', 'validation_failed', { poolId: 'Unknown pool' });
  let address: string | null = null;
  const used = poolUsed(poolId);
  if (pool.version === 4) {
    const c = parseCidr(pool.cidr)!;
    for (let n = c.first + pool.reserved + 1; n < c.last; n++) {
      const a = intToIp(n);
      if (!used.has(a)) { address = a; break }
    }
  } else {
    const prefix = pool.cidr.split('::')[0];
    for (let n = 16; n < 65535; n++) {
      const a = `${prefix}::${n.toString(16)}`;
      if (!used.has(a)) { address = a; break }
    }
  }
  if (!address) throw new ApiError(409, `IP pool ${pool.name} is exhausted`, 'pool_exhausted');
  const ip: IpAddress = { id: newId('ip'), address, version: pool.version, poolId, ...scope, assignedTo, reverseDns: null, name, createdAt: nowIso(), tags: [] };
  db.insert('ips', ip as any);
  return ip;
}

export function defaultPool(locationId: string, version: 4 | 6 = 4): IpPool | undefined {
  return db.find<IpPool>('ipPools', (p) => p.locationId === locationId && p.version === version);
}

/** Assign an IP to a VM or LB, keeping vm.ipIds / lb.ipIds in sync. */
export function assignIp(ipId: string, ref: Ref) {
  const ip = db.get<IpAddress>('ips', ipId);
  if (!ip) throw new ApiError(404, `IP ${ipId} not found`, 'not_found');
  if (ip.assignedTo && !(ip.assignedTo.type === ref.type && ip.assignedTo.id === ref.id)) throw new ApiError(409, `${ip.address} is already assigned to ${ip.assignedTo.type} ${ip.assignedTo.id}`, 'conflict');
  db.update('ips', ipId, { assignedTo: ref } as any);
  const col = ref.type === 'vm' ? 'vms' : ref.type === 'lb' ? 'loadBalancers' : null;
  if (col) db.update<any>(col, ref.id, (r: any) => { if (!r.ipIds.includes(ipId)) r.ipIds.push(ipId); return r });
}

export function unassignIp(ipId: string) {
  const ip = db.get<IpAddress>('ips', ipId);
  if (!ip?.assignedTo) return;
  const ref = ip.assignedTo;
  db.update('ips', ipId, { assignedTo: null } as any);
  const col = ref.type === 'vm' ? 'vms' : ref.type === 'lb' ? 'loadBalancers' : null;
  if (col && db.get(col, ref.id)) db.update<any>(col, ref.id, (r: any) => { r.ipIds = r.ipIds.filter((x: string) => x !== ipId); return r });
}

/* ---------------------------------------------------------------- firewalls */

/** Set the exact list of firewalls attached to a resource (updates both sides). */
export function setFirewalls(ref: Ref, firewallIds: string[]) {
  for (const fw of db.list<Firewall>('firewalls')) {
    const has = fw.attachedTo.some((r) => r.type === ref.type && r.id === ref.id);
    const want = firewallIds.includes(fw.id);
    if (has && !want) db.update('firewalls', fw.id, { attachedTo: fw.attachedTo.filter((r) => !(r.type === ref.type && r.id === ref.id)) } as any);
    if (!has && want) db.update('firewalls', fw.id, { attachedTo: [...fw.attachedTo, ref] } as any);
  }
  const col = ref.type === 'vm' ? 'vms' : ref.type === 'db' ? 'dbInstances' : ref.type === 'lb' ? 'loadBalancers' : null;
  if (col && db.get(col, ref.id)) db.update(col, ref.id, { firewallIds } as any);
}

/* ---------------------------------------------------------------- volumes */

export function attachVolume(volumeId: string, vmId: string) {
  const vol = db.get<Volume>('volumes', volumeId);
  const vm = db.get<VM>('vms', vmId);
  if (!vol || !vm) throw new ApiError(404, 'Volume or VM not found', 'not_found');
  if (vol.attachedTo && vol.attachedTo.vmId !== vmId) throw new ApiError(409, `Volume ${vol.name} is attached to another VM. Detach it first.`, 'conflict');
  if (vol.locationId !== vm.locationId) throw new ApiError(409, `Volume is in ${vol.locationId} but the VM runs in ${vm.locationId}`, 'conflict');
  const device = `/dev/vd${String.fromCharCode(98 + vm.volumeIds.filter((v) => v !== volumeId).length)}`;
  db.update('volumes', volumeId, { attachedTo: { vmId, device }, status: 'in-use' } as any);
  if (!vm.volumeIds.includes(volumeId)) db.update('vms', vmId, { volumeIds: [...vm.volumeIds, volumeId] } as any);
}

export function detachVolume(volumeId: string) {
  const vol = db.get<Volume>('volumes', volumeId);
  if (!vol?.attachedTo) return;
  const vmId = vol.attachedTo.vmId;
  db.update('volumes', volumeId, { attachedTo: null, status: 'available' } as any);
  const vm = db.get<VM>('vms', vmId);
  if (vm) db.update('vms', vmId, { volumeIds: vm.volumeIds.filter((v) => v !== volumeId) } as any);
}

/* ---------------------------------------------------------------- networks */

/** Next free host address in a subnet (skips .0, gateway .1, broadcast; avoids used addresses). */
export function nextPrivateIp(networkId: string, subnetId: string): string {
  const net = db.get<Network>('networks', networkId);
  const sn = net?.subnets.find((s) => s.id === subnetId);
  if (!net || !sn) throw new ApiError(422, 'Unknown network or subnet', 'validation_failed', { subnetId: 'Unknown subnet' });
  const used = new Set<string>([
    ...db.filter<VM>('vms', (v) => v.subnetId === subnetId).map((v) => v.privateIp),
    ...db.filter<any>('dbInstances', (d) => d.subnetId === subnetId).map((d) => d.privateIp).filter(Boolean),
  ]);
  const c = parseCidr(sn.cidr)!;
  for (let n = c.first + 10; n < c.last; n++) {
    const a = intToIp(n);
    if (!used.has(a)) return a;
  }
  throw new ApiError(409, `Subnet ${sn.name} has no free addresses`, 'subnet_full');
}

export function ipSortKey(a: string) { return ipToInt(a) }
