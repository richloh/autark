import { db } from '../db';
import { defineCollection, route, ApiError, validate, nameError, scopeFor, newId, nowIso, getOr404, audit, notify, type Ctx } from '../framework';
import { startOperation, onOperationComplete, type StepSpec } from '../operations';
import { registerMetrics } from '../metrics';
import { LINKS } from './core';
import { locationOrThrow, checkRequiredTags, checkLocationAllowed, allowanceFor, managedPlacements, hostAllocation, hostCapacity, policyNames } from './shared';
import { spaceMonthly } from './costs';
import { hostAllows, hostRoles, reservedFor } from '@/lib/hostPolicy';
import { hashString, mulberry32 } from '@/lib/random';
import {
  K8S_VERSIONS, k8sNextVersion, k8sPatch,
  type PlatformCluster, type K8sSpace, type SpaceQuota, type PlatformClusterCandidate, type NodePool, type K8sWorkload, type K8sPod,
  type Operation, type Project, type User, type BareMetalHost, type Location,
} from '@/types';

/* ------------------------------------------------------------------------------------------------
 * Shared Kubernetes ("namespace-as-a-service").
 *
 * The provider runs multi-tenant PLATFORM CLUSTERS on bare-metal hosts (roles k8s-worker /
 * k8s-control-plane, open access). Customers create SPACES: a namespace with ResourceQuota,
 * LimitRange, default-deny NetworkPolicy, Pod Security labels and namespaced RBAC. Spaces are billed
 * by their reserved quota; the provider may promise quota up to allocatable × overcommit.
 *
 * Workloads in a space live in the existing `k8sWorkloads` collection (spaceId set, clusterId = the
 * platform cluster). k8s.ts delegates create/scale/restart/delete/decorate for those to this file.
 * ---------------------------------------------------------------------------------------------- */

const s = (n: number) => Math.round(n * 1000);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
/** share of node resources reserved for kubelet, system daemons and eviction thresholds */
export const SYSTEM_RESERVE = 0.1;
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const QUOTA_KEYS: (keyof SpaceQuota)[] = ['cpuCores', 'memoryGi', 'storageGi', 'pods', 'loadBalancers'];
const QUOTA_LABEL: Record<keyof SpaceQuota, string> = { cpuCores: 'CPU cores', memoryGi: 'GiB memory', storageGi: 'GiB storage', pods: 'pods', loadBalancers: 'load balancers' };
const QUOTA_LIMITS: Record<keyof SpaceQuota, [number, number]> = { cpuCores: [0.5, 64], memoryGi: [1, 256], storageGi: [0, 4000], pods: [1, 500], loadBalancers: [0, 10] };
const POD_SECURITY = ['baseline', 'restricted'] as const;

export const accountSlug = (accountId: string) => accountId.replace(/^acc-/, '');
const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(n < 10 ? 2 : 1).replace(/\.?0+$/, ''));
const nodeName = (pc: Pick<PlatformCluster, 'name'>, p: Pick<NodePool, 'name'>, i: number) => `${pc.name}-${p.name}-${String(i + 1).padStart(2, '0')}`;
/** name of the matching ManagedItem in shared.ts → managedPlacements */
const placementName = (pc: Pick<PlatformCluster, 'name'>, p: Pick<NodePool, 'name'>, i: number) => `${pc.name}/${p.name}-${i + 1}`;

type PcRow = PlatformCluster & { cordonedNodes?: string[] };
type SpaceRow = K8sSpace & { credentialGeneration?: number; credentialsRotatedAt?: string | null; movingTo?: string | null; resumeStatus?: K8sSpace['status'] };
type SpaceWl = K8sWorkload & { storageGi?: number; suspendedReplicas?: number };

/* ================================================================================================
 * Capacity accounting
 * ============================================================================================== */

/** Nodes that count towards allocatable capacity (joined, not draining, not cordoned). */
function activeNodeCount(pc: PcRow, p: NodePool) {
  return Math.min(p.count, p.targetCount ?? p.count);
}

export function pcCapacity(pc: PcRow) {
  const cordoned = new Set(pc.cordonedNodes ?? []);
  let cpu = 0; let mem = 0;
  for (const p of pc.nodePools) {
    for (let i = 0; i < activeNodeCount(pc, p); i++) {
      if (cordoned.has(nodeName(pc, p, i))) continue;
      cpu += p.vcpus; mem += p.ramGB;
    }
  }
  return { cpuCores: r1(cpu * (1 - SYSTEM_RESERVE)), memoryGi: r1(mem * (1 - SYSTEM_RESERVE)) };
}

function spacesOn(pcId: string) {
  return db.filter<SpaceRow>('k8sSpaces', (x) => (x.platformClusterId === pcId || x.movingTo === pcId) && x.status !== 'error');
}
export function workloadsOfSpace(spaceId: string) {
  return db.filter<SpaceWl>('k8sWorkloads', (w) => w.spaceId === spaceId);
}

export function pcPromised(pcId: string, exceptSpaceId?: string) {
  const list = spacesOn(pcId).filter((x) => x.id !== exceptSpaceId);
  return { cpuCores: r1(list.reduce((a, x) => a + x.quota.cpuCores, 0)), memoryGi: r1(list.reduce((a, x) => a + x.quota.memoryGi, 0)), spaces: list.length };
}

/** Requests of all workloads in a space (what the ResourceQuota controller counts). */
export function spaceUsage(spaceId: string): SpaceQuota {
  const ws = workloadsOfSpace(spaceId).filter((w) => w.status !== 'Terminating');
  const pods = (w: SpaceWl) => (w.kind === 'CronJob' ? 1 : w.replicas);
  return {
    cpuCores: r2(ws.reduce((a, w) => a + pods(w) * w.cpuRequestM, 0) / 1000),
    memoryGi: r2(ws.reduce((a, w) => a + pods(w) * w.memRequestMi, 0) / 1024),
    storageGi: ws.reduce((a, w) => a + (w.kind === 'StatefulSet' ? (w.storageGi ?? 0) * Math.max(w.replicas, w.suspendedReplicas ?? 0) : (w.storageGi ?? 0)), 0),
    pods: ws.reduce((a, w) => a + pods(w), 0),
    loadBalancers: ws.filter((w) => w.expose === 'LoadBalancer').length,
  };
}

export function pcUsed(pcId: string) {
  const list = db.filter<SpaceRow>('k8sSpaces', (x) => x.platformClusterId === pcId);
  const u = list.map((x) => spaceUsage(x.id));
  return { cpuCores: r1(u.reduce((a, x) => a + x.cpuCores, 0)), memoryGi: r1(u.reduce((a, x) => a + x.memoryGi, 0)), pods: u.reduce((a, x) => a + x.pods, 0) };
}

function promisable(pc: PcRow) {
  const cap = pcCapacity(pc);
  return { cpuCores: r1(cap.cpuCores * pc.overcommit.cpu), memoryGi: r1(cap.memoryGi * pc.overcommit.memory) };
}

/* ================================================================================================
 * Placement (which platform cluster gets a new space)
 * ============================================================================================== */

function accessAllows(pc: PcRow, who: { accountId?: string | null; projectId?: string | null }) {
  return hostAllows(pc, who);
}

function candidateFor(pc: PcRow, need: { cpuCores: number; memoryGi: number; storageGi?: number }, who: { accountId?: string | null; projectId?: string | null }, exceptSpaceId?: string): PlatformClusterCandidate & { score: number; dedicated: boolean } {
  const prom = promisable(pc);
  const promised = pcPromised(pc.id, exceptSpaceId);
  const free = { cpuCores: r1(Math.max(0, prom.cpuCores - promised.cpuCores)), memoryGi: r1(Math.max(0, prom.memoryGi - promised.memoryGi)) };
  const max = pc.maxTenantQuota;
  const reason =
    pc.status === 'provisioning' ? 'Cluster is still being provisioned'
    : !accessAllows(pc, who) ? `Reserved for ${reservedFor(pc, policyNames) || 'nobody'}`
    : !pc.acceptingTenants ? 'Not accepting new spaces (cordoned by the provider)'
    : need.cpuCores > max.cpuCores || need.memoryGi > max.memoryGi || (need.storageGi ?? 0) > max.storageGi ? `Max per space here is ${fmtNum(max.cpuCores)} cores / ${fmtNum(max.memoryGi)} GiB / ${fmtNum(max.storageGi)} GiB storage`
    : need.cpuCores > free.cpuCores ? `Only ${fmtNum(free.cpuCores)} CPU cores left to promise`
    : need.memoryGi > free.memoryGi ? `Only ${fmtNum(free.memoryGi)} GiB memory left to promise`
    : null;
  const dedicated = !reason && pc.access.mode === 'restricted';
  const score = (reason ? -1e6 : 0) + (dedicated ? 5e5 : 0) + (prom.memoryGi ? (free.memoryGi / prom.memoryGi) * 1000 : 0) + free.cpuCores;
  return { id: pc.id, name: pc.name, locationId: pc.locationId, version: pc.version, fits: !reason, reason, free, tenants: promised.spaces, score, dedicated };
}

export function rankPlatformClusters(need: { cpuCores: number; memoryGi: number; storageGi?: number }, who: { accountId?: string | null; projectId?: string | null }, locationId?: string | null, exceptSpaceId?: string) {
  return db.filter<PcRow>('platformClusters', (pc) => !locationId || pc.locationId === locationId)
    .map((pc) => candidateFor(pc, need, who, exceptSpaceId))
    .sort((a, b) => b.score - a.score);
}

function placementWhy(chosen: ReturnType<typeof candidateFor> | undefined, all: ReturnType<typeof candidateFor>[], locationId?: string | null) {
  const where = locationId ? db.get<Location>('locations', locationId)?.name ?? locationId : 'any location';
  if (!all.length) return `No shared Kubernetes platform cluster is available in ${where}.`;
  if (!chosen) return `No platform cluster in ${where} can take this space: ${[...new Set(all.map((c) => `${c.name} — ${c.reason}`))].slice(0, 3).join('; ')}.`;
  const others = all.filter((c) => c.id !== chosen.id);
  return `${chosen.name} ${chosen.dedicated ? 'is reserved for you and ' : ''}has ${others.some((o) => o.fits) ? 'the most' : 'enough'} free capacity in ${where} (${fmtNum(chosen.free.cpuCores)} cores / ${fmtNum(chosen.free.memoryGi)} GiB promisable)${others.length ? `; ${others.filter((o) => o.fits).length} other cluster(s) also fit` : ''}.`;
}

const strip = ({ score: _s, dedicated: _d, ...c }: ReturnType<typeof candidateFor>): PlatformClusterCandidate => c;

/* ================================================================================================
 * Validation helpers
 * ============================================================================================== */

function normaliseQuota(q: any, fallback?: SpaceQuota): SpaceQuota {
  const src = { ...(fallback ?? {}), ...(q ?? {}) } as Record<string, unknown>;
  const cpu = Number(src.cpuCores);
  return {
    cpuCores: cpu,
    memoryGi: Number(src.memoryGi),
    storageGi: Number(src.storageGi ?? 20),
    pods: src.pods != null ? Number(src.pods) : Math.max(10, Math.round((Number.isFinite(cpu) ? cpu : 1) * 10)),
    loadBalancers: Number(src.loadBalancers ?? 0),
  };
}

function quotaErrors(q: SpaceQuota, prefix = 'quota.'): Record<string, string | false> {
  const out: Record<string, string | false> = {};
  for (const k of QUOTA_KEYS) {
    const [min, max] = QUOTA_LIMITS[k];
    const v = q[k];
    const intOnly = k !== 'cpuCores' && k !== 'memoryGi';
    out[prefix + k] = !(Number.isFinite(v) && v >= min && v <= max) ? `${QUOTA_LABEL[k][0].toUpperCase()}${QUOTA_LABEL[k].slice(1)} must be ${min}–${max}`
      : intOnly && !Number.isInteger(v) ? `${QUOTA_LABEL[k]} must be a whole number`
      : k === 'cpuCores' && Math.round(v * 2) !== v * 2 ? 'CPU is reserved in steps of 0.5 cores' : false;
  }
  return out;
}

function checkServiceAllowed(projectId: string) {
  const a = allowanceFor(projectId);
  if (a?.allowedServices?.length && !a.allowedServices.includes('k8s')) {
    throw new ApiError(422, `Service policy: Kubernetes is not enabled for project ${policyNames.project(projectId)}. Ask an admin to allow it in the project allowance.`, 'service_policy');
  }
}

function inScope<T extends { accountId: string }>(ctx: Ctx, row: T, label: string): T {
  if (row.accountId !== ctx.scope.accountId) throw new ApiError(404, `${label} belongs to another account`, 'other_account', { accountId: row.accountId });
  return row;
}

function teamErrors(team: unknown): string | null {
  if (team == null) return null;
  if (!Array.isArray(team)) return 'Team must be a list of bindings';
  for (const b of team as any[]) {
    if (!b || !Array.isArray(b.userIds) || !['edit', 'view'].includes(b.role)) return 'Each binding needs userIds and role edit|view';
    const bad = b.userIds.find((id: string) => !db.get<User>('users', id));
    if (bad) return `Unknown user ${bad}`;
  }
  return null;
}

/* ================================================================================================
 * Platform cluster nodes (derived) & tenant pods
 * ============================================================================================== */

export interface PlatformNode {
  name: string; role: 'worker' | 'control-plane'; poolId: string | null; poolName: string; index: number;
  status: 'Ready' | 'Provisioning' | 'Draining' | 'Upgrading' | 'SchedulingDisabled';
  cordoned: boolean; vcpus: number; ramGB: number; version: string; internalIp: string;
  hostId: string | null; hostName: string | null;
  allocatable: { cpuCores: number; memoryGi: number; pods: number };
  requested: { cpuCores: number; memoryGi: number }; pods: number;
}

function pcOps(pcId: string) { return db.filter<Operation>('operations', (o) => o.status === 'running' && o.target.id === pcId) }
const stepDone = (op: Operation, i: number | undefined) => i != null && op.steps[i]?.status === 'done';
const stepRunning = (op: Operation, i: number | undefined) => i != null && op.steps[i]?.status === 'running';

function nodeIp(pc: PcRow, key: string) { const h = hashString(`${pc.id}:${key}`); return `10.${pc.locationId === 'dc2' ? 41 : 40}.${(h >> 8) % 32}.${10 + (h % 240)}` }

export function platformNodes(pc: PcRow): PlatformNode[] {
  const placements = managedPlacements();
  const hostOf = new Map<string, string>();
  for (const [hid, list] of placements) for (const m of list) if ((m.kind as string) === 'platform' || (m.kind as string) === 'platform-cp') if (m.id === pc.id) hostOf.set(m.name, hid);
  const hostName = (hid: string | undefined) => (hid ? db.get<BareMetalHost>('hosts', hid)?.name ?? hid : null);
  const cordoned = new Set(pc.cordonedNodes ?? []);
  const ops = pcOps(pc.id);
  const upgrade = ops.find((o) => o.type === 'platformCluster.upgrade');
  const up = upgrade?.completion?.payload as { toVersion: string; nodeSteps: Record<string, number>; cpStep: number } | undefined;
  const drain = ops.filter((o) => o.type === 'platformCluster.drainNode').map((o) => (o.completion?.payload as any)?.node as string);
  const out: PlatformNode[] = [];
  const cpCount = pc.controlPlane.ha ? 3 : 1;
  const cpSize = { small: [2, 4], medium: [4, 8], large: [8, 16] }[pc.controlPlane.size];
  const cpVersion = up && upgrade && stepDone(upgrade, up.cpStep) ? up.toVersion : pc.version;
  for (let i = 0; i < cpCount; i++) {
    const n = `${pc.name}-cp-${i + 1}`;
    out.push({ name: n, role: 'control-plane', poolId: null, poolName: 'control-plane', index: i, status: up && upgrade && stepRunning(upgrade, up.cpStep) ? 'Upgrading' : 'Ready', cordoned: true, vcpus: cpSize[0], ramGB: cpSize[1],
      version: `v${k8sPatch(cpVersion)}`, internalIp: nodeIp(pc, n), hostId: hostOf.get(`${pc.name}/control-plane-${i + 1}`) ?? null, hostName: hostName(hostOf.get(`${pc.name}/control-plane-${i + 1}`)),
      allocatable: { cpuCores: 0, memoryGi: 0, pods: 0 }, requested: { cpuCores: 0, memoryGi: 0 }, pods: 0 });
  }
  for (const p of pc.nodePools) {
    const total = Math.max(p.count, p.targetCount ?? 0);
    for (let i = 0; i < total; i++) {
      const n = nodeName(pc, p, i);
      const joining = i >= p.count;
      const leaving = p.targetCount != null && i >= p.targetCount && i < p.count;
      const upStep = up?.nodeSteps?.[n];
      const ver = up && upgrade && stepDone(upgrade, upStep) ? up.toVersion : pc.version;
      const status: PlatformNode['status'] = joining ? 'Provisioning' : leaving || drain.includes(n) ? 'Draining' : up && upgrade && stepRunning(upgrade, upStep) ? 'Upgrading' : cordoned.has(n) ? 'SchedulingDisabled' : 'Ready';
      out.push({ name: n, role: 'worker', poolId: p.id, poolName: p.name, index: i, status, cordoned: cordoned.has(n), vcpus: p.vcpus, ramGB: p.ramGB, version: `v${k8sPatch(ver)}`, internalIp: nodeIp(pc, n),
        hostId: hostOf.get(placementName(pc, p, i)) ?? null, hostName: hostName(hostOf.get(placementName(pc, p, i))),
        allocatable: { cpuCores: r1(p.vcpus * (1 - SYSTEM_RESERVE)), memoryGi: r1(p.ramGB * (1 - SYSTEM_RESERVE)), pods: 110 }, requested: { cpuCores: 0, memoryGi: 0 }, pods: 0 });
    }
  }
  // tenant pods → nodes (requested per node)
  const schedulable = out.filter((n) => n.role === 'worker' && n.status !== 'Provisioning' && n.status !== 'Draining' && !n.cordoned);
  if (schedulable.length) {
    for (const sp of db.filter<SpaceRow>('k8sSpaces', (x) => x.platformClusterId === pc.id)) {
      for (const pod of spacePods(sp, schedulable)) {
        const node = out.find((x) => x.name === pod.node);
        if (!node) continue;
        node.requested.cpuCores = r2(node.requested.cpuCores + pod.cpuM / 1000);
        node.requested.memoryGi = r2(node.requested.memoryGi + pod.memMi / 1024);
        node.pods++;
      }
    }
  }
  return out;
}

const SUFFIX = 'bcdfghjklmnpqrstvwxz2456789';
function suffix(seed: string, len = 5) { const r = mulberry32(hashString(seed)); let o = ''; for (let i = 0; i < len; i++) o += SUFFIX[Math.floor(r() * SUFFIX.length)]; return o }

/** Pods of a space (derived): replicas spread over the platform cluster's schedulable worker nodes. */
export function spacePods(sp: SpaceRow, nodes?: PlatformNode[]): K8sPod[] {
  const pc = db.get<PcRow>('platformClusters', sp.platformClusterId);
  if (!pc) return [];
  const workers = nodes ?? platformNodes(pc).filter((n) => n.role === 'worker' && n.status !== 'Provisioning' && n.status !== 'Draining' && !n.cordoned);
  const out: K8sPod[] = [];
  for (const w of workloadsOfSpace(sp.id)) {
    const busy = db.find<Operation>('operations', (o) => o.status === 'running' && (o.completion?.payload as any)?.workloadId === w.id);
    const n = w.kind === 'CronJob' ? 1 : w.replicas;
    for (let i = 0; i < n; i++) {
      const name = w.kind === 'StatefulSet' ? `${w.name}-${i}` : w.kind === 'CronJob' ? `${w.name}-${29000000 + (hashString(w.id) % 900000)}-${suffix(w.id + 'job', 5)}` : `${w.name}-${suffix(`${w.id}:rs:${w.revision ?? 1}`, 9)}-${suffix(`${w.id}:${i}`)}`;
      const node = workers.length ? workers[(hashString(`${w.id}:${i}`) % workers.length)].name : null;
      const status: K8sPod['status'] = w.status === 'Terminating' ? 'Terminating' : w.kind === 'CronJob' ? 'Completed' : !node ? 'Pending' : busy && i >= w.readyReplicas ? 'ContainerCreating' : 'Running';
      out.push({
        name, namespace: sp.namespace, workloadId: w.id, workloadName: w.name, kind: w.kind, node, status, reason: !node ? 'no schedulable node' : undefined,
        cpuM: w.cpuRequestM, memMi: w.memRequestMi, gpu: 0, restarts: hashString(name) % 7 === 0 ? 1 : 0, ip: node ? `172.${pc.locationId === 'dc2' ? 21 : 20}.${hashString(name) % 250}.${hashString(name + 'ip') % 250}` : null,
        startedAt: status === 'Running' || status === 'Completed' ? w.restartedAt ?? w.createdAt : null, image: w.image,
      });
    }
  }
  return out;
}

/* ================================================================================================
 * Decorators
 * ============================================================================================== */

function pcHealth(pc: PcRow, nodes: PlatformNode[]) {
  const workers = nodes.filter((n) => n.role === 'worker');
  const ready = workers.filter((n) => n.status === 'Ready').length;
  const cap = pcCapacity(pc); const prom = pcPromised(pc.id);
  const over = prom.cpuCores > cap.cpuCores * pc.overcommit.cpu || prom.memoryGi > cap.memoryGi * pc.overcommit.memory;
  const prov = pc.status === 'provisioning';
  return [
    { component: 'Control plane', status: prov ? 'pending' : 'healthy', detail: `${pc.controlPlane.ha ? '3/3' : '1/1'} API servers · etcd ${pc.controlPlane.ha ? 'quorum 3/3' : 'single member'}` },
    { component: 'Worker nodes', status: prov ? 'pending' : ready < workers.length ? 'degraded' : 'healthy', detail: `${ready}/${workers.length} Ready` },
    { component: 'Tenant isolation', status: prov ? 'pending' : 'healthy', detail: `NetworkPolicy default-deny · Pod Security ${pc.podSecurity}` },
    { component: 'Quota headroom', status: prov ? 'pending' : over ? 'degraded' : 'healthy', detail: over ? 'promised quota exceeds capacity × overcommit' : 'within overcommit limits' },
    { component: 'Ingress', status: prov ? 'pending' : 'healthy', detail: `*.${pc.ingressDomain} · wildcard TLS valid` },
  ] as { component: string; status: 'healthy' | 'degraded' | 'down' | 'pending'; detail: string }[];
}

export function decoratePlatformCluster(pc: PcRow): PcRow & Record<string, unknown> {
  const nodes = platformNodes(pc);
  const tenantAccounts = new Set(db.filter<SpaceRow>('k8sSpaces', (x) => x.platformClusterId === pc.id).map((x) => x.accountId));
  return {
    ...pc,
    capacity: pcCapacity(pc),
    promised: pcPromised(pc.id),
    used: pcUsed(pc.id),
    promisable: promisable(pc),
    nodes: { workers: nodes.filter((n) => n.role === 'worker').length, ready: nodes.filter((n) => n.role === 'worker' && n.status === 'Ready').length, controlPlane: nodes.filter((n) => n.role === 'control-plane').length },
    tenantAccounts: tenantAccounts.size,
    upgradeAvailable: k8sNextVersion(pc.version),
    health: pcHealth(pc, nodes),
  };
}

export function decorateSpace(sp: SpaceRow): SpaceRow {
  const pc = db.get<PcRow>('platformClusters', sp.platformClusterId);
  return {
    ...sp,
    used: spaceUsage(sp.id),
    monthlyCost: spaceMonthly(sp),
    platformClusterName: pc?.name, endpoint: pc?.endpoint, version: pc?.version, podSecurity: pc?.podSecurity, storageClasses: pc?.storageClasses,
    workloads: workloadsOfSpace(sp.id).length,
  } as SpaceRow;
}

/** Decorator for k8sWorkloads rows that live in a space (called from k8s.ts). */
export function decorateSpaceWorkload(w: K8sWorkload): K8sWorkload {
  const busy = db.find<Operation>('operations', (o) => o.status === 'running' && (o.completion?.payload as any)?.workloadId === w.id);
  if (w.kind === 'CronJob') return { ...w, pendingPods: 0, status: busy ? 'Progressing' : w.status === 'Terminating' ? 'Terminating' : 'Running' };
  let status: K8sWorkload['status'] = w.status;
  if (w.status !== 'Terminating') status = busy ? 'Progressing' : w.readyReplicas < w.replicas ? 'Degraded' : 'Running';
  return { ...w, readyReplicas: busy ? w.readyReplicas : Math.min(w.readyReplicas, w.replicas), pendingPods: 0, status };
}

/* ================================================================================================
 * Space workloads (delegated from k8s.ts)
 * ============================================================================================== */

function spaceForWorkload(spaceId: string, ctx?: Ctx): SpaceRow {
  const sp = db.get<SpaceRow>('k8sSpaces', spaceId);
  if (!sp) throw new ApiError(422, 'Unknown space', 'validation_failed', { spaceId: 'Unknown space' });
  if (ctx) inScope(ctx, sp, `Space ${sp.name}`);
  return sp;
}

function requireActive(sp: SpaceRow, verb: string) {
  if (sp.status === 'active') return;
  const why = sp.status === 'suspended' ? 'is suspended — resume it first' : sp.status === 'provisioning' ? 'is still being provisioned' : `is ${sp.status}`;
  throw new ApiError(409, `Cannot ${verb}: space ${sp.name} ${why}`, 'invalid_state');
}

/** Throws 422 quota_exceeded when adding `delta` to the space's current requests exceeds its quota. */
export function checkSpaceQuota(sp: SpaceRow, delta: Partial<SpaceQuota>, exceptWorkloadId?: string) {
  const used = exceptWorkloadId ? usageWithout(sp.id, exceptWorkloadId) : spaceUsage(sp.id);
  const fields: Record<keyof SpaceQuota, string> = { cpuCores: 'cpuRequestM', memoryGi: 'memRequestMi', pods: 'replicas', storageGi: 'storageGi', loadBalancers: 'expose' };
  for (const k of QUOTA_KEYS) {
    const d = delta[k] ?? 0;
    if (d <= 0) continue;
    const after = r2(used[k] + d);
    if (after > sp.quota[k] + 1e-9) {
      const what = k === 'cpuCores' ? 'CPU cores requested' : k === 'memoryGi' ? 'GiB memory requested' : k === 'pods' ? 'pods' : k === 'storageGi' ? 'GiB persistent storage' : 'load balancers';
      throw new ApiError(422, `Space quota exceeded: ${fmtNum(after)} / ${fmtNum(sp.quota[k])} ${what} — resize the space or lower ${k === 'pods' ? 'replicas' : k === 'loadBalancers' ? 'the number of LoadBalancer services' : 'requests'}`, 'quota_exceeded',
        { [fields[k]]: `Quota ${fmtNum(used[k])} used + ${fmtNum(r2(d))} > ${fmtNum(sp.quota[k])}` });
    }
  }
}

function usageWithout(spaceId: string, workloadId: string): SpaceQuota {
  const full = spaceUsage(spaceId);
  const w = db.get<SpaceWl>('k8sWorkloads', workloadId);
  if (!w || w.status === 'Terminating') return full;
  const d = wlDemand(w);
  return { cpuCores: r2(full.cpuCores - d.cpuCores), memoryGi: r2(full.memoryGi - d.memoryGi), storageGi: full.storageGi - d.storageGi, pods: full.pods - d.pods, loadBalancers: full.loadBalancers - d.loadBalancers };
}

function wlDemand(w: Pick<SpaceWl, 'kind' | 'replicas' | 'cpuRequestM' | 'memRequestMi' | 'storageGi' | 'expose'>): SpaceQuota {
  const n = w.kind === 'CronJob' ? 1 : w.replicas;
  return { cpuCores: r2((n * w.cpuRequestM) / 1000), memoryGi: r2((n * w.memRequestMi) / 1024), storageGi: (w.storageGi ?? 0) * (w.kind === 'StatefulSet' ? w.replicas : 1), pods: n, loadBalancers: w.expose === 'LoadBalancer' ? 1 : 0 };
}

export function createSpaceWorkload(ctx: Ctx, body: any): K8sWorkload {
  const sp = spaceForWorkload(body.spaceId, ctx);
  requireActive(sp, 'deploy');
  const pc = getOr404<PcRow>('platformClusters', sp.platformClusterId, 'Platform cluster');
  const kind: K8sWorkload['kind'] = body.kind ?? 'Deployment';
  const ports: number[] = body.ports ?? [];
  const replicas = kind === 'CronJob' ? 1 : body.replicas ?? 1;
  const storageGi = Number(body.storageGi ?? 0);
  validate({
    name: nameError(body.name) || (workloadsOfSpace(sp.id).some((w) => w.name === body.name) && `${kind} ${sp.namespace}/${body.name} already exists`),
    namespace: body.namespace && body.namespace !== sp.namespace && `Workloads in this space always run in namespace ${sp.namespace}`,
    kind: kind === 'DaemonSet' ? 'DaemonSets are not allowed in a shared space (they would run on every node of the platform cluster)' : !['Deployment', 'StatefulSet', 'CronJob'].includes(kind) && 'Unknown workload kind',
    image: (!body.image || /\s/.test(body.image)) ? 'Container image is required (e.g. nginx:1.27)' : (/:latest$/.test(body.image) || !/[:@]/.test(String(body.image).split('/').pop() ?? '')) && 'admission webhook "validate.kyverno.svc" denied the request: policy disallow-latest-tag — pin an explicit image tag',
    replicas: !(Number.isInteger(replicas) && replicas >= 0 && replicas <= 100) && 'Replicas must be 0–100',
    cpuRequestM: !(Number.isFinite(body.cpuRequestM) && body.cpuRequestM >= 10 && body.cpuRequestM <= 16000) && 'CPU request must be 10m–16 cores',
    memRequestMi: !(Number.isFinite(body.memRequestMi) && body.memRequestMi >= 16 && body.memRequestMi <= 64 * 1024) && 'Memory request must be 16Mi–64Gi',
    ports: ports.some((p) => !(Number.isInteger(p) && p >= 1 && p <= 65535)) && 'Ports must be 1–65535',
    gpuPerPod: (body.gpuPerPod ?? 0) > 0 && 'GPUs are not available in shared spaces — use a dedicated cluster with a GPU node pool',
    schedule: kind === 'CronJob' && !(typeof body.schedule === 'string' && body.schedule.trim().split(/\s+/).length === 5) && 'Cron schedule needs 5 fields, e.g. "0 2 * * *"',
    storageGi: !(Number.isFinite(storageGi) && storageGi >= 0 && storageGi <= 2000) && 'Storage must be 0–2000 GiB',
    tolerations: body.tolerations?.length && 'Tolerations are managed by the platform in shared spaces',
  });
  // LimitRange: a single pod may not request more than the whole space
  if (body.cpuRequestM / 1000 > sp.quota.cpuCores || body.memRequestMi / 1024 > sp.quota.memoryGi) {
    throw new ApiError(422, `LimitRange: one pod may request at most ${fmtNum(sp.quota.cpuCores)} cores / ${fmtNum(sp.quota.memoryGi)} GiB in this space`, 'limit_range', { cpuRequestM: 'Exceeds the per-pod limit' });
  }
  const expose = body.expose ?? 'none';
  checkSpaceQuota(sp, wlDemand({ kind, replicas, cpuRequestM: body.cpuRequestM, memRequestMi: body.memRequestMi, storageGi, expose }));
  return {
    id: newId('wl'), clusterId: pc.id, accountId: sp.accountId, projectId: sp.projectId, spaceId: sp.id, namespace: sp.namespace, name: body.name, kind, image: String(body.image).trim(),
    replicas, readyReplicas: 0, cpuRequestM: body.cpuRequestM, memRequestMi: body.memRequestMi, ports, status: 'Progressing', createdAt: nowIso(), tags: body.tags ?? [],
    schedule: kind === 'CronJob' ? body.schedule.trim() : undefined, revision: 1, env: body.env ?? [], expose, managedBy: null,
    ...(storageGi ? { storageGi } : {}),
  } as K8sWorkload;
}

function wlTarget(sp: SpaceRow) { return { type: 'k8sSpace' as const, id: sp.id, name: sp.name } }
function spScope(sp: SpaceRow) { return { accountId: sp.accountId, projectId: sp.projectId } }

export function afterCreateSpaceWorkload(ctx: Ctx, w: K8sWorkload) {
  const sp = db.get<SpaceRow>('k8sSpaces', w.spaceId!)!;
  const before = spaceUsage(sp.id);
  const demand = wlDemand(w as SpaceWl);
  audit(ctx, 'k8sSpace.deployWorkload', wlTarget(sp), { ...spScope(sp), details: `${w.kind} ${w.namespace}/${w.name} (${w.image}, ${w.replicas}× ${w.cpuRequestM}m/${w.memRequestMi}Mi)` });
  const pods = spacePods(sp).filter((p) => p.workloadId === w.id);
  const steps: StepSpec[] = [
    { name: 'Admission (quota, limits, pod security)', ms: s(0.6), logs: [
      `ResourceQuota ${sp.namespace}/space-quota: requests.cpu ${fmtNum(r2(before.cpuCores - demand.cpuCores))} → ${fmtNum(before.cpuCores)} / ${fmtNum(sp.quota.cpuCores)} ok`,
      `requests.memory ${fmtNum(r2(before.memoryGi - demand.memoryGi))}Gi → ${fmtNum(before.memoryGi)}Gi / ${fmtNum(sp.quota.memoryGi)}Gi ok`,
      `pod-security.kubernetes.io/enforce=${db.get<PcRow>('platformClusters', sp.platformClusterId)?.podSecurity ?? 'restricted'}: ok`,
      'kyverno: disallow-latest-tag, require-requests ok',
    ] },
    { name: `Create ${w.kind} ${w.namespace}/${w.name}`, ms: s(0.6), logs: [`${w.kind === 'CronJob' ? 'cronjob.batch' : `${w.kind.toLowerCase()}.apps`}/${w.name} created`, ...(w.expose && w.expose !== 'none' ? [`service/${w.name} created (${w.expose})`] : [])] },
  ];
  if (w.kind === 'CronJob') steps.push({ name: 'Register schedule', ms: s(0.5), logs: [`schedule "${w.schedule}" (UTC)`] });
  else {
    steps.push(
      { name: `Schedule ${pods.length} pod${pods.length === 1 ? '' : 's'}`, ms: s(0.7), logs: pods.slice(0, 10).map((p) => `Successfully assigned ${p.namespace}/${p.name} to ${p.node}`) },
      { name: `Pull image ${w.image.split('/').pop()}`, ms: s(1.2), logs: [`Pulling image "${w.image}"`, 'Successfully pulled image'] },
      { name: 'Start pods & readiness probes', ms: s(1), logs: [`${pods.length}/${pods.length} pods ready`, 'rollout complete'] },
    );
  }
  startOperation({ type: 'k8s.workload.deploy', title: `Deploy ${w.namespace}/${w.name}`, target: wlTarget(sp), steps, scope: spScope(sp), actor: ctx.actor, silent: true,
    onComplete: 'k8s.workloadReady', payload: { id: sp.id, workloadId: w.id } });
}

export function removeSpaceWorkload(ctx: Ctx, w: K8sWorkload): 'async' | 'deleted' {
  if (w.status === 'Terminating') throw new ApiError(409, 'Workload is already being deleted', 'invalid_state');
  const sp = db.get<SpaceRow>('k8sSpaces', w.spaceId!);
  db.update('k8sWorkloads', w.id, { status: 'Terminating' } as any);
  if (!sp) return 'deleted';
  audit(ctx, 'k8sSpace.deleteWorkload', wlTarget(sp), { ...spScope(sp), details: `${w.kind} ${w.namespace}/${w.name}` });
  startOperation({ type: 'k8s.workload.delete', title: `Delete ${w.namespace}/${w.name}`, target: wlTarget(sp), scope: spScope(sp), actor: ctx.actor, silent: true,
    steps: [{ name: `Delete ${w.kind} ${w.name}`, ms: s(0.5), logs: [`${w.kind.toLowerCase()} "${w.name}" deleted`] }, { name: 'Terminate pods (grace period 30s)', ms: s(1.2), logs: ['pods terminated', 'quota released'] }],
    onComplete: 'k8s.workloadDeleted', payload: { id: sp.id, workloadId: w.id } });
  return 'async';
}

export function spaceWorkloadAction(ctx: Ctx, w: K8sWorkload, action: 'scale' | 'restart', body: any): K8sWorkload {
  const sp = spaceForWorkload(w.spaceId!, ctx);
  requireActive(sp, action === 'scale' ? 'scale' : 'restart');
  const busy = db.find<Operation>('operations', (o) => o.status === 'running' && (o.completion?.payload as any)?.workloadId === w.id);
  if (busy) throw new ApiError(409, `${w.name} has a rollout in progress (${busy.title}). Wait for it to finish.`, 'invalid_state');
  if (action === 'scale') {
    if (w.kind === 'CronJob') throw new ApiError(409, 'A CronJob cannot be scaled', 'invalid_state');
    const replicas = body.replicas;
    validate({ replicas: !(Number.isInteger(replicas) && replicas >= 0 && replicas <= 100) && 'Replicas must be 0–100' });
    if (replicas === w.replicas) return decorateSpaceWorkload(w);
    if (replicas > w.replicas) checkSpaceQuota(sp, wlDemand({ ...(w as SpaceWl), replicas: replicas - w.replicas, storageGi: w.kind === 'StatefulSet' ? (w as SpaceWl).storageGi : 0, expose: 'none' }));
    audit(ctx, 'k8sSpace.scaleWorkload', wlTarget(sp), { ...spScope(sp), details: `${w.namespace}/${w.name}: ${w.replicas} → ${replicas}` });
    const up = replicas > w.replicas;
    db.update('k8sWorkloads', w.id, { replicas, readyReplicas: up ? w.replicas : replicas, status: 'Progressing' } as any);
    startOperation({ type: 'k8s.workload.scale', title: `Scale ${w.namespace}/${w.name} to ${replicas}`, target: wlTarget(sp), scope: spScope(sp), actor: ctx.actor, silent: true,
      steps: up
        ? [{ name: `Scale ${w.replicas} → ${replicas}`, ms: s(0.5), logs: [`quota check ok (${fmtNum(spaceUsage(sp.id).cpuCores)} / ${fmtNum(sp.quota.cpuCores)} cores)`] }, { name: `Start ${replicas - w.replicas} pod(s)`, ms: s(1.2), logs: ['containers started', 'readiness probes passed'] }]
        : [{ name: `Scale down ${w.replicas} → ${replicas}`, ms: s(0.5), logs: [`${w.kind.toLowerCase()}.apps/${w.name} scaled`] }, { name: `Terminate ${w.replicas - replicas} pod(s)`, ms: s(1), logs: ['SIGTERM sent, graceful shutdown', 'quota released'] }],
      onComplete: 'k8s.workloadReady', payload: { id: sp.id, workloadId: w.id, patch: { replicas } } });
  } else {
    const image: string | undefined = body.image && body.image !== w.image ? String(body.image).trim() : undefined;
    if (image && (/\s/.test(image) || /:latest$/.test(image) || !/[:@]/.test(image.split('/').pop() ?? ''))) throw new ApiError(422, 'admission webhook "validate.kyverno.svc" denied the request: pin an explicit image tag', 'validation_failed', { image: 'Pin an explicit image tag' });
    const rev = (w.revision ?? 1) + 1;
    audit(ctx, 'k8sSpace.restartWorkload', wlTarget(sp), { ...spScope(sp), details: `${w.namespace}/${w.name}${image ? ` → ${image}` : ''}` });
    db.update('k8sWorkloads', w.id, { status: 'Progressing' } as any);
    startOperation({ type: 'k8s.workload.restart', title: image ? `Roll out ${w.name} → ${image.split('/').pop()}` : `Rolling restart ${w.namespace}/${w.name}`, target: wlTarget(sp), scope: spScope(sp), actor: ctx.actor, silent: true,
      steps: [{ name: image ? `Update image → ${image.split('/').pop()}` : 'Patch restartedAt annotation', ms: s(0.5), logs: [`revision ${rev}`] }, ...Array.from({ length: Math.min(4, Math.max(1, w.replicas)) }, (_, i) => ({ name: `Replace pod ${i + 1}`, ms: s(0.9), logs: ['old pod terminating', 'new pod ready'] }))],
      onComplete: 'k8s.workloadReady', payload: { id: sp.id, workloadId: w.id, patch: { revision: rev, restartedAt: nowIso(), ...(image ? { image } : {}) } } });
  }
  return decorateSpaceWorkload(db.get<K8sWorkload>('k8sWorkloads', w.id)!);
}

/* ================================================================================================
 * Spaces: create / lifecycle
 * ============================================================================================== */

function createSpace(ctx: Ctx, body: any): SpaceRow {
  const sc = scopeFor(ctx, body);
  const quota = normaliseQuota(body.quota);
  const name: string = body.name;
  validate({
    name: nameError(name) || (name.length > 30 && 'Space name max 30 characters') || (db.find<SpaceRow>('k8sSpaces', (x) => x.name === name && x.projectId === sc.projectId) && `A space named "${name}" already exists in this project`),
    ...quotaErrors(quota),
    team: teamErrors(body.team),
    networkPolicy: body.networkPolicy && !['default-deny', 'allow-same-namespace'].includes(body.networkPolicy) && 'Network policy must be default-deny or allow-same-namespace',
  });
  checkServiceAllowed(sc.projectId);
  checkRequiredTags(sc.projectId, body.tags);
  const who = { accountId: sc.accountId, projectId: sc.projectId };
  let pc: PcRow;
  if (body.platformClusterId) {
    pc = db.get<PcRow>('platformClusters', body.platformClusterId) as PcRow;
    if (!pc) throw new ApiError(422, 'Unknown platform cluster', 'validation_failed', { platformClusterId: 'Unknown platform cluster' });
    if (body.locationId && body.locationId !== pc.locationId) throw new ApiError(422, `${pc.name} is in ${pc.locationId}, not ${body.locationId}`, 'validation_failed', { platformClusterId: 'Cluster is in another location' });
    checkLocationAllowed(sc.projectId, pc.locationId);
    const c = candidateFor(pc, quota, who);
    if (!c.fits) throw new ApiError(c.reason?.startsWith('Only') ? 409 : 422, `${pc.name} can't take this space: ${c.reason}`, c.reason?.startsWith('Only') ? 'insufficient_capacity' : 'placement_rejected', { platformClusterId: c.reason ?? 'Not available' });
  } else {
    const loc = locationOrThrow(body.locationId);
    checkLocationAllowed(sc.projectId, loc.id);
    const ranked = rankPlatformClusters(quota, who, loc.id);
    const best = ranked.find((c) => c.fits);
    if (!best) {
      const capacityOnly = ranked.length && ranked.every((c) => c.reason?.startsWith('Only'));
      throw new ApiError(409, placementWhy(undefined, ranked, loc.id) + (capacityOnly ? ' Choose a smaller quota or another location.' : ''), capacityOnly ? 'insufficient_capacity' : 'no_platform_cluster', { locationId: ranked[0]?.reason ?? 'No platform cluster here' });
    }
    pc = db.get<PcRow>('platformClusters', best.id)!;
  }
  const slug = accountSlug(sc.accountId);
  const namespace = `${slug}-${name}`.slice(0, 63);
  const clash = db.find<SpaceRow>('k8sSpaces', (x) => x.platformClusterId === pc.id && x.namespace === namespace);
  if (clash) throw new ApiError(422, `Namespace ${namespace} is already used on ${pc.name} (project ${policyNames.project(clash.projectId)}). Choose another space name.`, 'validation_failed', { name: `Namespace ${namespace} is taken on ${pc.name}` });
  return {
    id: newId('spc'), name, ...sc, platformClusterId: pc.id, locationId: pc.locationId, namespace, quota, tier: 'namespace', status: 'provisioning',
    ingressHost: `*.${name}.${slug}.${pc.ingressDomain}`,
    team: Array.isArray(body.team) && body.team.length ? body.team.map((b: any) => ({ userIds: [...new Set<string>(b.userIds)], role: b.role })) : [{ userIds: [ctx.user.id], role: 'edit' }],
    serviceAccount: 'deployer', networkPolicy: body.networkPolicy ?? 'default-deny', createdAt: nowIso(), tags: body.tags ?? [],
    credentialGeneration: 1, credentialsRotatedAt: null,
  };
}

function afterCreateSpace(ctx: Ctx, sp: SpaceRow) {
  const pc = db.get<PcRow>('platformClusters', sp.platformClusterId)!;
  const users = sp.team.flatMap((b) => b.userIds.map((id) => `${db.get<User>('users', id)?.email ?? id} → ${b.role}`));
  const q = sp.quota;
  const steps: StepSpec[] = [
    { name: `Create namespace ${sp.namespace}`, ms: s(0.6), logs: [`placed on ${pc.name} (${pc.locationId}, Kubernetes ${pc.version})`, `namespace/${sp.namespace} created`, `labels: autark.cloud/account=${sp.accountId}, autark.cloud/project=${sp.projectId}, autark.cloud/space=${sp.id}`] },
    { name: 'Apply ResourceQuota & LimitRange', ms: s(0.7), logs: [
      `resourcequota/space-quota created: requests.cpu=${fmtNum(q.cpuCores)}, requests.memory=${fmtNum(q.memoryGi)}Gi, requests.storage=${q.storageGi}Gi, pods=${q.pods}, services.loadbalancers=${q.loadBalancers}`,
      `limitrange/defaults created: default request 100m/128Mi, max per pod ${fmtNum(q.cpuCores)} cores / ${fmtNum(q.memoryGi)}Gi`,
    ] },
    { name: 'NetworkPolicy (default deny + DNS & ingress)', ms: s(0.6), logs: ['networkpolicy/default-deny-all created', 'networkpolicy/allow-dns (kube-system/coredns :53) created', 'networkpolicy/allow-from-ingress (ingress-nginx) created', ...(sp.networkPolicy === 'allow-same-namespace' ? ['networkpolicy/allow-same-namespace created'] : [])] },
    { name: 'Pod Security labels', ms: s(0.4), logs: [`pod-security.kubernetes.io/enforce=${pc.podSecurity}`, 'pod-security.kubernetes.io/warn=restricted', 'pod-security.kubernetes.io/audit=restricted'] },
    { name: 'ServiceAccount + RoleBinding', ms: s(0.5), logs: [`serviceaccount/${sp.serviceAccount} created`, `rolebinding/${sp.serviceAccount}-edit → clusterrole/autark:space-edit`] },
    { name: 'OIDC bindings for team', ms: s(0.5), logs: users.length ? users.map((u) => `rolebinding oidc:${u}`) : ['no team members bound'] },
    { name: 'Ingress wildcard certificate', ms: s(1), logs: [`certificate ${sp.ingressHost} requested (ACME DNS-01)`, 'challenge solved, certificate issued (valid 90 days)'] },
    { name: 'Issue kubeconfig', ms: s(0.5), logs: [`token for system:serviceaccount:${sp.namespace}:${sp.serviceAccount} issued (rotatable)`, `kubeconfig context ${sp.name}@${pc.name} (namespace ${sp.namespace})`] },
  ];
  startOperation({
    type: 'k8sSpace.create', title: `Create Kubernetes space ${sp.name}`, target: wlTarget(sp), steps, scope: spScope(sp), actor: ctx.actor,
    onComplete: 'k8sSpace.provisioned', onFail: 'k8sSpace.failed', payload: { id: sp.id },
    ...(sp.name.includes('fail') ? { failAtStep: 1, failMessage: 'admission webhook "quota.autark.cloud" timed out applying ResourceQuota' } : {}),
  });
}

onOperationComplete('k8sSpace.provisioned', (_op, p: { id: string }) => { if (db.get('k8sSpaces', p.id)) db.update('k8sSpaces', p.id, { status: 'active' } as any) });
onOperationComplete('k8sSpace.failed', (_op, p: { id: string }) => { if (db.get('k8sSpaces', p.id)) db.update('k8sSpaces', p.id, { status: 'error' } as any) });
onOperationComplete('k8sSpace.ready', (_op, p: { id: string; patch?: Record<string, unknown> }) => {
  const sp = db.get<SpaceRow>('k8sSpaces', p.id);
  if (sp) db.update('k8sSpaces', p.id, { status: sp.resumeStatus ?? 'active', resumeStatus: undefined, ...(p.patch ?? {}) } as any);
});
onOperationComplete('k8sSpace.deleted', (_op, p: { id: string }) => {
  for (const w of workloadsOfSpace(p.id)) db.remove('k8sWorkloads', w.id);
  db.remove('k8sSpaces', p.id);
});
onOperationComplete('k8sSpace.moved', (_op, p: { id: string; to: string }) => {
  const sp = db.get<SpaceRow>('k8sSpaces', p.id);
  const pc = db.get<PcRow>('platformClusters', p.to);
  if (!sp || !pc) return;
  db.update('k8sSpaces', sp.id, { platformClusterId: pc.id, locationId: pc.locationId, movingTo: null, ingressHost: `*.${sp.name}.${accountSlug(sp.accountId)}.${pc.ingressDomain}`, status: sp.resumeStatus ?? 'active', resumeStatus: undefined } as any);
  for (const w of workloadsOfSpace(sp.id)) db.update('k8sWorkloads', w.id, { clusterId: pc.id } as any);
});
onOperationComplete('k8sSpace.moveFailed', (_op, p: { id: string }) => {
  const sp = db.get<SpaceRow>('k8sSpaces', p.id);
  if (sp) db.update('k8sSpaces', sp.id, { movingTo: null, status: sp.resumeStatus ?? 'active', resumeStatus: undefined } as any);
});

function spaceKubeconfig(sp: SpaceRow) {
  const pc = db.get<PcRow>('platformClusters', sp.platformClusterId)!;
  const gen = sp.credentialGeneration ?? 1;
  const user = `${sp.serviceAccount}@${sp.namespace}`;
  const ctxName = `${sp.name}@${pc.name}`;
  const r = mulberry32(hashString(`${sp.id}:ca`));
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let ca = 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUM';
  while (ca.length < 200) ca += chars[Math.floor(r() * chars.length)];
  const yaml = [
    'apiVersion: v1',
    'kind: Config',
    'clusters:',
    '- cluster:',
    `    certificate-authority-data: ${ca}==`,
    `    server: ${pc.endpoint}`,
    `  name: ${pc.name}`,
    'contexts:',
    '- context:',
    `    cluster: ${pc.name}`,
    `    namespace: ${sp.namespace}`,
    `    user: ${user}`,
    `  name: ${ctxName}`,
    `current-context: ${ctxName}`,
    'preferences: {}',
    'users:',
    `- name: ${user}`,
    '  user:',
    `    # ServiceAccount system:serviceaccount:${sp.namespace}:${sp.serviceAccount} (generation ${gen}).`,
    '    # Paste the token shown once in the console, or use `autark k8s space login` for OIDC.',
    '    token: <SPACE_TOKEN>',
    '',
  ].join('\n');
  return { yaml, server: pc.endpoint, namespace: sp.namespace, user, context: ctxName, filename: `${sp.name}-kubeconfig.yaml`, generation: gen, issuedAt: sp.credentialsRotatedAt ?? sp.createdAt };
}

/* ================================================================================================
 * Platform clusters: create / lifecycle
 * ============================================================================================== */

function eligibleHosts(locationId: string, role: 'k8s-worker' | 'k8s-control-plane') {
  return db.filter<BareMetalHost>('hosts', (h) => h.locationId === locationId && h.status === 'ready' && h.hypervisor === 'KVM' && hostRoles(h).includes(role) && hostAllows(h, {}) && !h.gpus.length);
}

/** Free host capacity for a platform cluster's nodes (open hosts with the role at the location). */
function hostHeadroom(locationId: string, role: 'k8s-worker' | 'k8s-control-plane') {
  const pl = managedPlacements();
  return eligibleHosts(locationId, role).map((h) => {
    const cap = hostCapacity(h); const a = hostAllocation(h.id, pl);
    return { host: h, vcpus: cap.vcpus - a.vcpus, ramGB: cap.ramGB - a.ramGB };
  });
}

function checkHostCapacity(locationId: string, add: { vcpus: number; ramGB: number; count: number }) {
  const free = hostHeadroom(locationId, 'k8s-worker');
  if (!free.length) throw new ApiError(409, `No open bare-metal host in ${locationId} has the Kubernetes worker role. Enable the role (access: all accounts) under Bare metal hosts → Policy.`, 'no_eligible_host');
  // nodes are spread one per host round-robin; check the simple aggregate and per-node fit
  const fitting = free.filter((f) => f.vcpus >= add.vcpus && f.ramGB >= add.ramGB);
  const slots = free.reduce((a, f) => a + Math.max(0, Math.min(Math.floor(f.vcpus / add.vcpus), Math.floor(f.ramGB / add.ramGB))), 0);
  if (!fitting.length || slots < add.count) {
    throw new ApiError(409, `Not enough bare-metal capacity in ${locationId} for ${add.count}× ${add.vcpus} vCPU / ${add.ramGB} GB nodes (room for ${slots} on ${free.length} eligible host${free.length === 1 ? '' : 's'}). Add hardware or enable the worker role on more hosts.`, 'insufficient_capacity');
  }
}

function validatePool(p: any, existing: NodePool[], label: string): NodePool {
  validate({
    [`${label}.name`]: nameError(p?.name, 'Pool name') || (existing.some((x) => x.name === p.name) && `A pool named "${p.name}" already exists`) || (String(p.name).length > 20 && 'Pool name max 20 characters'),
    [`${label}.vcpus`]: !(Number.isInteger(p?.vcpus) && p.vcpus >= 4 && p.vcpus <= 128) && 'Nodes need 4–128 vCPUs',
    [`${label}.ramGB`]: !(Number.isFinite(p?.ramGB) && p.ramGB >= 8 && p.ramGB <= 1024) && 'Nodes need 8–1024 GB RAM',
    [`${label}.count`]: !(Number.isInteger(p?.count) && p.count >= 1 && p.count <= 50) && 'Node count must be 1–50',
  });
  return { id: newId('pnp'), name: p.name, presetId: null, vcpus: p.vcpus, ramGB: p.ramGB, diskGB: p.diskGB ?? 200, count: p.count, autoscale: { enabled: false, min: p.count, max: p.count }, labels: [], taints: [], status: 'provisioning', createdAt: nowIso() };
}

function accessErrors(a: any): Record<string, string | false | undefined> {
  if (a == null) return {};
  if (a.mode !== 'all' && a.mode !== 'restricted') return { 'access.mode': 'Mode must be "all" or "restricted"' };
  if (a.mode === 'all') return {};
  const acc: string[] = Array.isArray(a.accountIds) ? a.accountIds : [];
  const prj: string[] = Array.isArray(a.projectIds) ? a.projectIds : [];
  return {
    access: !acc.length && !prj.length && 'Select at least one account or project',
    'access.accountIds': acc.find((id) => !db.get('accounts', id)) && `Unknown account ${acc.find((id) => !db.get('accounts', id))}`,
    'access.projectIds': prj.find((id) => !db.get('projects', id)) && `Unknown project ${prj.find((id) => !db.get('projects', id))}`,
  };
}
const normAccess = (a: any): PlatformCluster['access'] => (a?.mode === 'restricted' ? { mode: 'restricted', accountIds: [...new Set<string>(a.accountIds ?? [])], projectIds: [...new Set<string>(a.projectIds ?? [])] } : { mode: 'all', accountIds: [], projectIds: [] });

const DEFAULT_MAX_QUOTA: SpaceQuota = { cpuCores: 16, memoryGi: 64, storageGi: 500, pods: 200, loadBalancers: 3 };
const LOC_SHORT: Record<string, string> = { dc1: 'mdg', dc2: 'fra' };

function createPlatformCluster(_ctx: Ctx, body: any): PcRow {
  const loc = locationOrThrow(body.locationId);
  const version = body.version ?? K8S_VERSIONS[1].version;
  validate({
    name: nameError(body.name) || (String(body.name).length > 30 && 'Name max 30 characters') || (db.find<PcRow>('platformClusters', (x) => x.name === body.name) && `A platform cluster named "${body.name}" already exists`),
    locationId: loc.kind !== 'selfHosted' && 'Platform clusters run on your own bare-metal hosts — choose a self-hosted location',
    version: !K8S_VERSIONS.some((v) => v.version === version) && `Unsupported version ${version}`,
    nodePools: !(Array.isArray(body.nodePools) && body.nodePools.length) && 'Add at least one worker pool',
    'controlPlane.size': body.controlPlane?.size && !['small', 'medium', 'large'].includes(body.controlPlane.size) && 'Unknown control plane size',
    cni: body.cni && !['cilium', 'calico'].includes(body.cni) && 'CNI must be cilium or calico',
    'overcommit.cpu': body.overcommit?.cpu != null && !(body.overcommit.cpu >= 1 && body.overcommit.cpu <= 4) && 'CPU overcommit must be 1–4',
    'overcommit.memory': body.overcommit?.memory != null && !(body.overcommit.memory >= 1 && body.overcommit.memory <= 2) && 'Memory overcommit must be 1–2',
    podSecurity: body.podSecurity && !POD_SECURITY.includes(body.podSecurity) && 'Pod security must be baseline or restricted',
    ingressDomain: body.ingressDomain && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(body.ingressDomain) && 'Ingress domain must be a DNS name',
    ...accessErrors(body.access),
  });
  const pools: NodePool[] = [];
  (body.nodePools as any[]).forEach((p, i) => pools.push(validatePool(p, pools, `nodePools.${i}`)));
  for (const p of pools) checkHostCapacity(loc.id, p);
  if (!eligibleHosts(loc.id, 'k8s-control-plane').length) throw new ApiError(409, `No open bare-metal host in ${loc.id} has the Kubernetes control-plane role.`, 'no_eligible_host');
  const id = newId('pc');
  const short = LOC_SHORT[loc.id] ?? loc.id;
  return {
    id, name: body.name, description: body.description ?? '', locationId: loc.id, version, status: 'provisioning',
    endpoint: `https://api.${body.name}.k8s.${loc.id}.autark.cloud:6443`, ingressDomain: body.ingressDomain || `${body.name}.k8s.${short}.autark.cloud`,
    nodePools: pools, controlPlane: { ha: body.controlPlane?.ha ?? true, size: body.controlPlane?.size ?? 'medium' }, cni: body.cni ?? 'cilium',
    access: normAccess(body.access), overcommit: { cpu: body.overcommit?.cpu ?? 1.5, memory: body.overcommit?.memory ?? 1.2 },
    maxTenantQuota: { ...DEFAULT_MAX_QUOTA, ...(body.maxTenantQuota ?? {}) }, podSecurity: body.podSecurity ?? 'restricted', storageClasses: body.storageClasses?.length ? body.storageClasses : ['autark-nvme', 'autark-ssd'],
    acceptingTenants: false, maintenanceWindow: { day: body.maintenanceWindow?.day ?? 'sun', hour: body.maintenanceWindow?.hour ?? 3 }, createdAt: nowIso(), tags: body.tags ?? [], cordonedNodes: [],
  };
}

function afterCreatePlatformCluster(ctx: Ctx, pc: PcRow) {
  const cps = pc.controlPlane.ha ? 3 : 1;
  const nodes = platformNodes(pc);
  const steps: StepSpec[] = [
    { name: 'Reserve bare-metal capacity', ms: s(0.8), logs: nodes.map((n) => `${n.name} → ${n.hostName ?? 'pending placement'} (${n.vcpus} vCPU / ${n.ramGB} GB)`) },
    { name: `Boot ${cps} control-plane node${cps > 1 ? 's' : ''}`, ms: s(1.6), logs: nodes.filter((n) => n.role === 'control-plane').map((n) => `${n.name} booted on ${n.hostName ?? '?'}`) },
    { name: 'Bootstrap etcd & control plane', ms: s(1.8), logs: [cps > 1 ? 'etcd quorum 3/3, leader elected' : 'single-member etcd', `kube-apiserver v${k8sPatch(pc.version)} listening on ${pc.endpoint}`, 'audit logging → Loki (tenant-labelled)'] },
    { name: `Install CNI (${pc.cni})`, ms: s(1), logs: [pc.cni === 'cilium' ? 'cilium: kube-proxy replacement strict, NetworkPolicy enforcement on' : 'calico: NetworkPolicy enforcement on'] },
    ...pc.nodePools.map((p) => ({ name: `Join worker pool ${p.name} (${p.count}× ${p.vcpus} vCPU / ${p.ramGB} GB)`, ms: s(1.2 + 0.25 * p.count), logs: nodes.filter((n) => n.poolId === p.id).map((n) => `node/${n.name} Ready (host ${n.hostName ?? '?'})`) })),
    { name: 'Install platform add-ons', ms: s(1.4), logs: ['ingress-nginx (wildcard *.' + pc.ingressDomain + ')', 'cert-manager + ACME DNS-01 issuer', 'Kyverno tenant policies (disallow-latest-tag, require-requests, no hostPath)', 'metrics-server, kube-state-metrics, per-namespace Prometheus scraping', `CSI storage classes: ${pc.storageClasses.join(', ')}`] },
    { name: 'Tenant RBAC templates & OIDC', ms: s(0.7), logs: ['clusterrole/autark:space-edit, autark:space-view created', 'OIDC issuer https://sso.autark.cloud registered'] },
    { name: 'Health checks', ms: s(0.8), logs: ['GET /readyz → ok', 'conformance smoke test passed', 'cluster accepts tenants'] },
  ];
  startOperation({ type: 'platformCluster.create', title: `Provision platform cluster ${pc.name}`, target: { type: 'platformCluster', id: pc.id, name: pc.name }, steps, actor: ctx.actor,
    onComplete: 'platformCluster.provisioned', onFail: 'platformCluster.failed', payload: { id: pc.id },
    ...(pc.name.includes('fail') ? { failAtStep: 2, failMessage: 'etcd: member cp-2 failed to join (TLS handshake timeout)' } : {}) });
}

onOperationComplete('platformCluster.provisioned', (_op, p: { id: string }) => {
  if (db.get('platformClusters', p.id)) db.update<PcRow>('platformClusters', p.id, (x) => { x.status = 'running'; x.acceptingTenants = true; x.nodePools.forEach((n) => (n.status = 'ready')); return x });
});
onOperationComplete('platformCluster.failed', (_op, p: { id: string }) => { if (db.get('platformClusters', p.id)) db.update('platformClusters', p.id, { status: 'degraded' } as any) });
onOperationComplete('platformCluster.poolScaled', (_op, p: { id: string; poolId: string; count: number }) => {
  if (db.get('platformClusters', p.id)) db.update<PcRow>('platformClusters', p.id, (x) => {
    const np = x.nodePools.find((n) => n.id === p.poolId);
    if (np) { np.count = p.count; np.status = 'ready'; delete np.targetCount }
    x.cordonedNodes = (x.cordonedNodes ?? []).filter((n) => !np || !n.startsWith(`${x.name}-${np.name}-`) || Number(n.split('-').pop()) <= p.count);
    return x;
  });
});
onOperationComplete('platformCluster.poolScaleFailed', (_op, p: { id: string; poolId: string }) => {
  if (db.get('platformClusters', p.id)) db.update<PcRow>('platformClusters', p.id, (x) => { const np = x.nodePools.find((n) => n.id === p.poolId); if (np) { np.status = 'ready'; delete np.targetCount } return x });
});
onOperationComplete('platformCluster.upgraded', (_op, p: { id: string; toVersion: string }) => {
  const pc = db.get<PcRow>('platformClusters', p.id);
  if (!pc) return;
  db.update<PcRow>('platformClusters', p.id, (x) => { x.version = p.toVersion; x.status = 'running'; x.nodePools.forEach((n) => (n.status = 'ready')); return x });
  const spaces = db.filter<SpaceRow>('k8sSpaces', (x) => x.platformClusterId === p.id);
  for (const acc of new Set(spaces.map((x) => x.accountId))) {
    const first = spaces.find((x) => x.accountId === acc)!;
    notify('success', `Kubernetes ${p.toVersion} is live on ${pc.name}`, 'The platform upgrade finished. Your spaces kept running throughout.', `/managed-services/kubernetes/spaces/${first.id}`, acc);
  }
});
onOperationComplete('platformCluster.drained', (_op, p: { id: string; node: string }) => {
  if (db.get('platformClusters', p.id)) db.update<PcRow>('platformClusters', p.id, (x) => { x.cordonedNodes = [...new Set([...(x.cordonedNodes ?? []), p.node])]; return x });
});
onOperationComplete('platformCluster.deleted', (_op, p: { id: string }) => { db.remove('platformClusters', p.id) });

function requireRunning(pc: PcRow, verb: string) {
  if (pc.status === 'running' || pc.status === 'degraded') {
    const busy = pcOps(pc.id).find((o) => o.type.startsWith('platformCluster.') && o.type !== 'platformCluster.drainNode');
    if (busy) throw new ApiError(409, `Cannot ${verb} while "${busy.title}" is running`, 'invalid_state');
    return;
  }
  throw new ApiError(409, `Cannot ${verb} while the cluster is ${pc.status}`, 'invalid_state');
}

/** Tenant summary rows for the provider (all accounts). */
function tenantsOf(pcId: string) {
  return db.filter<SpaceRow>('k8sSpaces', (x) => x.platformClusterId === pcId || x.movingTo === pcId).map((x) => {
    const used = spaceUsage(x.id);
    return {
      id: x.id, name: x.name, accountId: x.accountId, accountName: policyNames.account(x.accountId), projectId: x.projectId, projectName: db.get<Project>('projects', x.projectId)?.name ?? x.projectId,
      projectColor: db.get<Project>('projects', x.projectId)?.color, namespace: x.namespace, quota: x.quota, used, status: x.status, createdAt: x.createdAt, monthlyCost: spaceMonthly(x),
      workloads: workloadsOfSpace(x.id).length, incoming: x.movingTo === pcId && x.platformClusterId !== pcId,
    };
  }).sort((a, b) => a.accountName.localeCompare(b.accountName) || a.name.localeCompare(b.name));
}

/* ================================================================================================
 * Registration
 * ============================================================================================== */

export function registerK8sShared() {
  LINKS.k8sSpace = (id) => `/managed-services/kubernetes/spaces/${id}`;
  LINKS.platformCluster = (id) => `/hardware/platform-clusters/${id}`;

  /* ---------------------------------------------------------------- platform clusters */
  defineCollection<PcRow>({
    name: 'platformClusters', kind: 'platformCluster', idPrefix: 'pc', scoped: false,
    searchText: (pc) => `${pc.id} ${pc.name} ${pc.description} ${pc.locationId} ${pc.version} shared kubernetes platform`,
    subtitle: (pc) => `Platform cluster · ${pc.locationId} · v${pc.version} · ${pcPromised(pc.id).spaces} spaces`,
    link: (pc) => `/hardware/platform-clusters/${pc.id}`,
    sort: (a, b) => a.locationId.localeCompare(b.locationId) || a.name.localeCompare(b.name),
    decorate: decoratePlatformCluster,
    create: createPlatformCluster,
    afterCreate: afterCreatePlatformCluster,
    update: (_ctx, pc, patch) => {
      const next = { ...pc };
      if ('description' in patch) next.description = String(patch.description ?? '');
      if ('maintenanceWindow' in patch) {
        const mw = patch.maintenanceWindow ?? {};
        validate({ maintenanceWindow: !(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(mw.day) && Number.isInteger(mw.hour) && mw.hour >= 0 && mw.hour <= 23) && 'Day mon–sun and hour 0–23' });
        next.maintenanceWindow = { day: mw.day, hour: mw.hour };
      }
      if ('tags' in patch) next.tags = patch.tags ?? [];
      if ('name' in patch && patch.name !== pc.name) throw new ApiError(422, 'A platform cluster cannot be renamed (node names and endpoints derive from it)', 'validation_failed', { name: 'Immutable' });
      return next;
    },
    remove: (ctx, pc) => {
      const n = spacesOn(pc.id).length;
      if (n) throw new ApiError(409, `${pc.name} still hosts ${n} space${n > 1 ? 's' : ''}. Move or delete them first.`, 'has_tenants');
      requireRunning(pc, 'delete');
      db.update('platformClusters', pc.id, { status: 'provisioning', acceptingTenants: false } as any);
      startOperation({ type: 'platformCluster.delete', title: `Decommission platform cluster ${pc.name}`, target: { type: 'platformCluster', id: pc.id, name: pc.name }, actor: ctx.actor,
        steps: [{ name: 'Drain & delete worker nodes', ms: s(1.5), logs: platformNodes(pc).filter((n) => n.role === 'worker').map((n) => `node/${n.name} deleted (host ${n.hostName ?? '?'} capacity released)`) },
          { name: 'Stop control plane & wipe etcd', ms: s(1), logs: ['etcd snapshot archived', 'control-plane nodes deleted'] }],
        onComplete: 'platformCluster.deleted', payload: { id: pc.id } });
      return 'async';
    },
    actions: {
      updatePolicy: (ctx, pc, body) => {
        const oc = body.overcommit ?? pc.overcommit;
        const max = body.maxTenantQuota ? normaliseQuota(body.maxTenantQuota, pc.maxTenantQuota) : pc.maxTenantQuota;
        const classes: string[] = body.storageClasses ?? pc.storageClasses;
        validate({
          'overcommit.cpu': !(Number.isFinite(oc.cpu) && oc.cpu >= 1 && oc.cpu <= 4) && 'CPU overcommit must be 1–4',
          'overcommit.memory': !(Number.isFinite(oc.memory) && oc.memory >= 1 && oc.memory <= 2) && 'Memory overcommit must be 1–2',
          ...quotaErrors(max, 'maxTenantQuota.'),
          podSecurity: body.podSecurity != null && !POD_SECURITY.includes(body.podSecurity) && 'Pod security must be baseline or restricted',
          storageClasses: !(Array.isArray(classes) && classes.length) ? 'Offer at least one storage class' : classes.find((c) => !DNS_LABEL.test(c)) && `Invalid storage class "${classes.find((c) => !DNS_LABEL.test(c))}"`,
          acceptingTenants: body.acceptingTenants != null && typeof body.acceptingTenants !== 'boolean' && 'acceptingTenants must be true or false',
          ...accessErrors(body.access),
        });
        const cap = pcCapacity(pc); const prom = pcPromised(pc.id);
        if (prom.cpuCores > cap.cpuCores * oc.cpu + 1e-9 || prom.memoryGi > cap.memoryGi * oc.memory + 1e-9) {
          throw new ApiError(422, `Tenants have already been promised ${fmtNum(prom.cpuCores)} cores / ${fmtNum(prom.memoryGi)} GiB; with this overcommit only ${fmtNum(r1(cap.cpuCores * oc.cpu))} cores / ${fmtNum(r1(cap.memoryGi * oc.memory))} GiB could be promised. Add nodes first or keep a higher overcommit.`, 'overcommit_below_promised',
            { [prom.cpuCores > cap.cpuCores * oc.cpu ? 'overcommit.cpu' : 'overcommit.memory']: 'Below already promised quota' });
        }
        const access = body.access ? normAccess(body.access) : pc.access;
        const next = { ...pc, overcommit: { cpu: r2(oc.cpu), memory: r2(oc.memory) }, maxTenantQuota: max, podSecurity: body.podSecurity ?? pc.podSecurity, storageClasses: classes, acceptingTenants: body.acceptingTenants ?? pc.acceptingTenants, access };
        db.update('platformClusters', pc.id, next as any);
        const spaces = db.filter<SpaceRow>('k8sSpaces', (x) => x.platformClusterId === pc.id);
        const warnings = [
          ...spaces.filter((x) => !hostAllows(next, { accountId: x.accountId, projectId: x.projectId })).map((x) => `Space ${x.name} (${policyNames.account(x.accountId)}) is no longer allowed by the availability policy — it keeps running; new spaces follow the policy.`),
          ...spaces.filter((x) => QUOTA_KEYS.some((k) => x.quota[k] > max[k])).map((x) => `Space ${x.name} exceeds the new max tenant quota — it keeps its quota but can't grow.`),
          ...(body.podSecurity && body.podSecurity !== pc.podSecurity ? [`Pod Security "${body.podSecurity}" is now enforced on ${spaces.length} namespace(s); running pods are not evicted.`] : []),
        ];
        audit(ctx, 'platformCluster.updatePolicy', { type: 'platformCluster', id: pc.id, name: pc.name }, { details: `overcommit ${next.overcommit.cpu}/${next.overcommit.memory}, ${next.access.mode}, accepting ${next.acceptingTenants}` });
        return { ...decoratePlatformCluster(db.get<PcRow>('platformClusters', pc.id)!), warnings };
      },
      cordon: (_ctx, pc) => { db.update('platformClusters', pc.id, { acceptingTenants: false } as any); return decoratePlatformCluster(db.get<PcRow>('platformClusters', pc.id)!) },
      uncordon: (_ctx, pc) => {
        if (pc.status === 'provisioning') throw new ApiError(409, 'The cluster is still being provisioned', 'invalid_state');
        db.update('platformClusters', pc.id, { acceptingTenants: true } as any);
        return decoratePlatformCluster(db.get<PcRow>('platformClusters', pc.id)!);
      },
      scalePool: (ctx, pc, body) => {
        requireRunning(pc, 'scale');
        const p = pc.nodePools.find((x) => x.id === body.poolId || x.name === body.poolId);
        if (!p) throw new ApiError(404, `Pool ${body.poolId} not found`, 'not_found');
        const count = body.count;
        validate({ count: !(Number.isInteger(count) && count >= 1 && count <= 50) && 'Node count must be 1–50' });
        if (count === p.count) return decoratePlatformCluster(pc);
        const steps: StepSpec[] = [];
        if (count > p.count) {
          checkHostCapacity(pc.locationId, { vcpus: p.vcpus, ramGB: p.ramGB, count: count - p.count });
          steps.push({ name: 'Reserve bare-metal capacity', ms: s(0.7), logs: [`${count - p.count}× ${p.vcpus} vCPU / ${p.ramGB} GB on hosts with role k8s-worker in ${pc.locationId}`] });
          for (let i = p.count; i < count; i++) steps.push({ name: `Boot & join ${nodeName(pc, p, i)}`, ms: s(1.4), logs: [`kubelet v${k8sPatch(pc.version)} registered node/${nodeName(pc, p, i)}`, 'node Ready (CNI up)', `+${fmtNum(r1(p.vcpus * (1 - SYSTEM_RESERVE)))} cores / ${fmtNum(r1(p.ramGB * (1 - SYSTEM_RESERVE)))} GiB allocatable`] });
        } else {
          // capacity after removing nodes must still cover promised quota
          const after = pcCapacity({ ...pc, nodePools: pc.nodePools.map((x) => (x.id === p.id ? { ...x, count } : x)) });
          const prom = pcPromised(pc.id);
          if (prom.cpuCores > after.cpuCores * pc.overcommit.cpu + 1e-9 || prom.memoryGi > after.memoryGi * pc.overcommit.memory + 1e-9) {
            throw new ApiError(409, `Scaling ${p.name} to ${count} node${count > 1 ? 's' : ''} would leave ${fmtNum(r1(after.cpuCores * pc.overcommit.cpu))} cores / ${fmtNum(r1(after.memoryGi * pc.overcommit.memory))} GiB promisable, but tenants were promised ${fmtNum(prom.cpuCores)} cores / ${fmtNum(prom.memoryGi)} GiB. Move spaces away first.`, 'capacity_promised');
          }
          for (let i = p.count - 1; i >= count; i--) steps.push({ name: `Cordon & drain ${nodeName(pc, p, i)}`, ms: s(1.3), logs: [`node/${nodeName(pc, p, i)} cordoned`, 'tenant pods evicted (PodDisruptionBudgets respected)', 'node deleted, host capacity released'] });
        }
        db.update<PcRow>('platformClusters', pc.id, (x) => { const np = x.nodePools.find((n) => n.id === p.id)!; np.targetCount = count; np.status = 'scaling'; return x });
        audit(ctx, 'platformCluster.scalePool', { type: 'platformCluster', id: pc.id, name: pc.name }, { details: `${p.name}: ${p.count} → ${count}` });
        startOperation({ type: 'platformCluster.scale', title: `Scale ${pc.name}/${p.name} ${p.count} → ${count} nodes`, target: { type: 'platformCluster', id: pc.id, name: pc.name }, steps, actor: ctx.actor, silent: true,
          onComplete: 'platformCluster.poolScaled', onFail: 'platformCluster.poolScaleFailed', payload: { id: pc.id, poolId: p.id, count } });
        return decoratePlatformCluster(db.get<PcRow>('platformClusters', pc.id)!);
      },
      upgrade: (ctx, pc, body) => {
        requireRunning(pc, 'upgrade');
        const next = k8sNextVersion(pc.version);
        if (!next) throw new ApiError(409, `${pc.name} already runs the latest version ${pc.version}`, 'invalid_state');
        if (body.version !== next) throw new ApiError(422, `Upgrade one minor version at a time: ${pc.version} → ${next}`, 'validation_failed', { version: `Next version is ${next}` });
        const nodes = platformNodes(pc).filter((n) => n.role === 'worker');
        const spaces = db.filter<SpaceRow>('k8sSpaces', (x) => x.platformClusterId === pc.id);
        const steps: StepSpec[] = [
          { name: 'Pre-flight: deprecated APIs in tenant namespaces', ms: s(1), logs: [`scanned ${spaces.length} namespaces with pluto`, 'no removed APIs in use', 'PodDisruptionBudgets checked'] },
          { name: `Upgrade control plane → ${k8sPatch(next)}`, ms: s(1.6), logs: ['etcd snapshot taken', `kube-apiserver v${k8sPatch(next)} rolled out (${pc.controlPlane.ha ? '3' : '1'} replica(s))`] },
        ];
        const cpStep = 1;
        const nodeSteps: Record<string, number> = {};
        for (const n of nodes) { nodeSteps[n.name] = steps.length; steps.push({ name: `Surge-replace ${n.name}`, ms: s(1.1), logs: [`surge node ${n.name}-surge Ready`, `node/${n.name} cordoned & drained`, `node/${n.name} replaced with kubelet v${k8sPatch(next)}`] }) }
        steps.push({ name: 'Verify tenants', ms: s(0.8), logs: [`${spaces.length} spaces healthy`, 'all tenant pods Running'] });
        db.update('platformClusters', pc.id, { status: 'upgrading' } as any);
        const accounts = [...new Set(spaces.map((x) => x.accountId))];
        for (const acc of accounts) {
          const mine = spaces.filter((x) => x.accountId === acc);
          notify('info', `Platform upgrade: ${pc.name} → Kubernetes ${next}`, `Nodes are replaced one by one; pods in ${mine.map((x) => x.name).join(', ')} will be rescheduled. Check your PodDisruptionBudgets.`, `/managed-services/kubernetes/spaces/${mine[0].id}`, acc);
        }
        audit(ctx, 'platformCluster.upgrade', { type: 'platformCluster', id: pc.id, name: pc.name }, { details: `${pc.version} → ${next}; notified ${accounts.length} tenant account(s)` });
        startOperation({ type: 'platformCluster.upgrade', title: `Upgrade ${pc.name} to ${next}`, target: { type: 'platformCluster', id: pc.id, name: pc.name }, steps, actor: ctx.actor,
          onComplete: 'platformCluster.upgraded', payload: { id: pc.id, toVersion: next, nodeSteps, cpStep } });
        return { ...decoratePlatformCluster(db.get<PcRow>('platformClusters', pc.id)!), notifiedAccounts: accounts.length };
      },
      drainNode: (ctx, pc, body) => {
        const node = platformNodes(pc).find((n) => n.name === body.node);
        if (!node) throw new ApiError(404, `Node ${body.node} not found`, 'not_found');
        if (node.role !== 'worker') throw new ApiError(409, 'Control-plane nodes are drained by upgrades only', 'invalid_state');
        if (node.cordoned || node.status !== 'Ready') throw new ApiError(409, `${node.name} is ${node.cordoned ? 'already cordoned' : node.status}`, 'invalid_state');
        const after = pcCapacity({ ...pc, cordonedNodes: [...(pc.cordonedNodes ?? []), node.name] });
        const prom = pcPromised(pc.id);
        const pods = db.filter<SpaceRow>('k8sSpaces', (x) => x.platformClusterId === pc.id).flatMap((x) => spacePods(x)).filter((p) => p.node === node.name);
        audit(ctx, 'platformCluster.drainNode', { type: 'platformCluster', id: pc.id, name: pc.name }, { details: `${node.name} (${pods.length} tenant pods)` });
        startOperation({ type: 'platformCluster.drainNode', title: `Drain ${node.name}`, target: { type: 'platformCluster', id: pc.id, name: pc.name }, actor: ctx.actor, silent: true,
          steps: [{ name: `Cordon ${node.name}`, ms: s(0.4), logs: [`node/${node.name} cordoned (SchedulingDisabled)`] },
            { name: `Evict ${pods.length} tenant pod${pods.length === 1 ? '' : 's'}`, ms: s(1.4), logs: pods.slice(0, 12).map((p) => `evicting pod ${p.namespace}/${p.name}`) },
            { name: 'Wait for rescheduling', ms: s(0.8), logs: ['all evicted pods Running on other nodes'] }],
          onComplete: 'platformCluster.drained', payload: { id: pc.id, node: node.name } });
        return { ...decoratePlatformCluster(pc), warning: prom.cpuCores > after.cpuCores * pc.overcommit.cpu || prom.memoryGi > after.memoryGi * pc.overcommit.memory ? 'With this node cordoned, promised quota exceeds capacity × overcommit.' : null };
      },
      uncordonNode: (ctx, pc, body) => {
        if (!(pc.cordonedNodes ?? []).includes(body.node)) throw new ApiError(409, `${body.node} is not cordoned`, 'invalid_state');
        db.update<PcRow>('platformClusters', pc.id, (x) => { x.cordonedNodes = (x.cordonedNodes ?? []).filter((n) => n !== body.node); return x });
        audit(ctx, 'platformCluster.uncordonNode', { type: 'platformCluster', id: pc.id, name: pc.name }, { details: body.node });
        return decoratePlatformCluster(db.get<PcRow>('platformClusters', pc.id)!);
      },
    },
  });

  route('GET', '/platformClusters/:id/tenants', (ctx) => {
    const pc = getOr404<PcRow>('platformClusters', ctx.params.id, 'Platform cluster');
    const items = tenantsOf(pc.id);
    return { items, total: items.length };
  }, 'Spaces on a platform cluster (all accounts) with usage');
  route('POST', '/platformClusters/:id/tenants/:spaceId/:action', (ctx) => {
    // provider-level tenant actions (cross-account; the generic k8sSpaces actions are account-scoped)
    const pc = getOr404<PcRow>('platformClusters', ctx.params.id, 'Platform cluster');
    const sp = getOr404<SpaceRow>('k8sSpaces', ctx.params.spaceId, 'Space');
    if (sp.platformClusterId !== pc.id) throw new ApiError(404, `Space ${sp.name} does not run on ${pc.name}`, 'not_found');
    if (!['suspend', 'resume', 'move'].includes(ctx.params.action)) throw new ApiError(404, `Unknown tenant action ${ctx.params.action}`, 'not_found');
    const res = spacesDef.actions![ctx.params.action](ctx, sp, ctx.body ?? {});
    audit(ctx, `k8sSpace.${ctx.params.action}`, wlTarget(sp), { ...spScope(sp), details: `by provider on ${pc.name}`, via: 'console' });
    return res;
  }, 'Provider action on a tenant space: suspend | resume | move {platformClusterId}');
  route('GET', '/platformClusters/:id/nodes', (ctx) => {
    const pc = getOr404<PcRow>('platformClusters', ctx.params.id, 'Platform cluster');
    const items = platformNodes(pc);
    return { items, total: items.length };
  }, 'Control-plane and worker nodes with the bare-metal host each runs on');
  route('GET', '/platformClusters/:id/host-headroom', (ctx) => {
    const pc = getOr404<PcRow>('platformClusters', ctx.params.id, 'Platform cluster');
    return { items: hostHeadroom(pc.locationId, 'k8s-worker').map((f) => ({ hostId: f.host.id, hostName: f.host.name, freeVcpus: f.vcpus, freeRamGB: f.ramGB })) };
  }, 'Free capacity on hosts that can take more worker nodes');

  /* ---------------------------------------------------------------- spaces */
  route('GET', '/k8sSpaces/placement-preview', (ctx) => {
    const q = ctx.query;
    const need = { cpuCores: Number(q.get('cpuCores') ?? 1), memoryGi: Number(q.get('memoryGi') ?? 2), storageGi: Number(q.get('storageGi') ?? 0) };
    const projectId = q.get('projectId') || ctx.scope.projectId;
    const project = projectId ? db.get<Project>('projects', projectId) : undefined;
    const who = { accountId: project?.accountId ?? ctx.scope.accountId, projectId: project?.id ?? null };
    const locationId = q.get('locationId');
    const ranked = rankPlatformClusters(need, who, locationId);
    const visible = ranked.filter((c) => !c.reason?.startsWith('Reserved'));
    const chosen = visible.find((c) => c.fits);
    return { chosen: chosen ? strip(chosen) : null, candidates: visible.map(strip), why: placementWhy(chosen, visible, locationId) };
  }, 'Which platform cluster a new space would land on (?locationId&cpuCores&memoryGi&storageGi&projectId)');

  const spacesDef = defineCollection<SpaceRow>({
    name: 'k8sSpaces', kind: 'k8sSpace', idPrefix: 'spc',
    searchText: (x) => `${x.id} ${x.name} ${x.namespace} ${x.ingressHost} kubernetes space namespace`,
    subtitle: (x) => `Kubernetes space · ${x.namespace} · ${db.get<PcRow>('platformClusters', x.platformClusterId)?.name ?? x.platformClusterId}`,
    link: (x) => `/managed-services/kubernetes/spaces/${x.id}`,
    decorate: decorateSpace,
    create: createSpace,
    afterCreate: afterCreateSpace,
    update: (_ctx, sp, patch) => {
      const next: SpaceRow = { ...sp };
      if ('name' in patch && patch.name !== sp.name) {
        validate({ name: nameError(patch.name) || (db.find<SpaceRow>('k8sSpaces', (x) => x.name === patch.name && x.projectId === sp.projectId && x.id !== sp.id) && `A space named "${patch.name}" already exists in this project`) });
        next.name = patch.name; // display name only — namespace and ingress host stay
      }
      if ('team' in patch) {
        validate({ team: teamErrors(patch.team) });
        next.team = patch.team;
      }
      if ('tags' in patch) { checkRequiredTags(sp.projectId, patch.tags); next.tags = patch.tags ?? [] }
      return next;
    },
    remove: (ctx, sp) => {
      if (sp.status === 'deleting') throw new ApiError(409, 'Space is already being deleted', 'invalid_state');
      if (sp.status === 'provisioning' || sp.movingTo) throw new ApiError(409, 'Wait for the current operation to finish before deleting', 'invalid_state');
      const ws = workloadsOfSpace(sp.id);
      db.update('k8sSpaces', sp.id, { status: 'deleting' } as any);
      for (const w of ws) db.update('k8sWorkloads', w.id, { status: 'Terminating' } as any);
      startOperation({ type: 'k8sSpace.delete', title: `Delete Kubernetes space ${sp.name}`, target: wlTarget(sp), scope: spScope(sp), actor: ctx.actor,
        steps: [
          { name: `Delete ${ws.length} workload${ws.length === 1 ? '' : 's'}`, ms: s(1.2), logs: ws.length ? ws.map((w) => `${w.kind.toLowerCase()}/${w.name} deleted`) : ['namespace is empty'] },
          { name: `Delete namespace ${sp.namespace}`, ms: s(1.2), logs: ['finalizers: kubernetes, autark.cloud/pvc-cleanup', `namespace/${sp.namespace} deleted`, `persistent volumes released (${spaceUsage(sp.id).storageGi} GiB)`] },
          { name: 'Revoke credentials & RBAC', ms: s(0.5), logs: [`serviceaccount ${sp.serviceAccount} token revoked`, 'OIDC rolebindings removed', `certificate ${sp.ingressHost} revoked`] },
          { name: 'Release quota', ms: s(0.4), logs: [`${fmtNum(sp.quota.cpuCores)} cores / ${fmtNum(sp.quota.memoryGi)} GiB returned to ${db.get<PcRow>('platformClusters', sp.platformClusterId)?.name}`, 'billing stopped'] },
        ],
        onComplete: 'k8sSpace.deleted', payload: { id: sp.id } });
      return 'async';
    },
    actions: {
      resize: (ctx, sp, body) => {
        requireActive(sp, 'resize');
        const pc = getOr404<PcRow>('platformClusters', sp.platformClusterId, 'Platform cluster');
        const quota = normaliseQuota(body.quota, sp.quota);
        validate(quotaErrors(quota));
        const used = spaceUsage(sp.id);
        const below = QUOTA_KEYS.find((k) => quota[k] < used[k] - 1e-9);
        if (below) {
          const what = below === 'cpuCores' ? 'CPU cores' : below === 'memoryGi' ? 'GiB memory' : QUOTA_LABEL[below];
          throw new ApiError(422, `Can't shrink below current usage: workloads request ${fmtNum(used[below])} ${what} (new quota ${fmtNum(quota[below])}). Scale workloads down first.`, 'below_usage', { [`quota.${below}`]: `In use: ${fmtNum(used[below])}` });
        }
        const over = QUOTA_KEYS.find((k) => quota[k] > pc.maxTenantQuota[k]);
        if (over) throw new ApiError(422, `${pc.name} allows at most ${fmtNum(pc.maxTenantQuota[over])} ${QUOTA_LABEL[over]} per space. Ask the provider or move the space.`, 'max_tenant_quota', { [`quota.${over}`]: `Max ${fmtNum(pc.maxTenantQuota[over])}` });
        const prom = promisable(pc); const others = pcPromised(pc.id, sp.id);
        if (quota.cpuCores > sp.quota.cpuCores && others.cpuCores + quota.cpuCores > prom.cpuCores + 1e-9) throw new ApiError(409, `${pc.name} has only ${fmtNum(r1(prom.cpuCores - others.cpuCores))} CPU cores left to promise for this space. Choose less or ask the provider to add capacity.`, 'insufficient_capacity', { 'quota.cpuCores': 'Not enough cluster capacity' });
        if (quota.memoryGi > sp.quota.memoryGi && others.memoryGi + quota.memoryGi > prom.memoryGi + 1e-9) throw new ApiError(409, `${pc.name} has only ${fmtNum(r1(prom.memoryGi - others.memoryGi))} GiB memory left to promise for this space. Choose less or ask the provider to add capacity.`, 'insufficient_capacity', { 'quota.memoryGi': 'Not enough cluster capacity' });
        const old = sp.quota;
        db.update('k8sSpaces', sp.id, { quota, status: 'resizing' } as any);
        audit(ctx, 'k8sSpace.resize', wlTarget(sp), { ...spScope(sp), details: QUOTA_KEYS.filter((k) => old[k] !== quota[k]).map((k) => `${k} ${old[k]} → ${quota[k]}`).join(', ') || 'no change' });
        startOperation({ type: 'k8sSpace.resize', title: `Resize space ${sp.name}`, target: wlTarget(sp), scope: spScope(sp), actor: ctx.actor, silent: true,
          steps: [{ name: 'Check cluster capacity', ms: s(0.5), logs: [`${pc.name}: ${fmtNum(r1(others.cpuCores + quota.cpuCores))} / ${fmtNum(prom.cpuCores)} cores promised after resize`] },
            { name: 'Update ResourceQuota', ms: s(0.6), logs: [`resourcequota/space-quota patched: requests.cpu=${fmtNum(quota.cpuCores)}, requests.memory=${fmtNum(quota.memoryGi)}Gi, requests.storage=${quota.storageGi}Gi, pods=${quota.pods}`] },
            { name: 'Update LimitRange', ms: s(0.4), logs: [`max per pod ${fmtNum(quota.cpuCores)} cores / ${fmtNum(quota.memoryGi)}Gi`] }],
          onComplete: 'k8sSpace.ready', payload: { id: sp.id } });
        return decorateSpace(db.get<SpaceRow>('k8sSpaces', sp.id)!);
      },
      rotateCredentials: (ctx, sp) => {
        if (sp.status === 'deleting' || sp.status === 'provisioning') throw new ApiError(409, `Space is ${sp.status}`, 'invalid_state');
        const gen = (sp.credentialGeneration ?? 1) + 1;
        db.update('k8sSpaces', sp.id, { credentialGeneration: gen, credentialsRotatedAt: nowIso() } as any);
        startOperation({ type: 'k8sSpace.rotate', title: `Rotate credentials of ${sp.name}`, target: wlTarget(sp), scope: spScope(sp), actor: ctx.actor, silent: true,
          steps: [{ name: 'Issue new ServiceAccount token', ms: s(0.5), logs: [`token generation ${gen} issued`] }, { name: 'Revoke previous token', ms: s(0.5), logs: [`generation ${gen - 1} revoked — old kubeconfigs stop working`] }] });
        return { ...decorateSpace(db.get<SpaceRow>('k8sSpaces', sp.id)!), token: `atk_space_${sp.namespace.replace(/-/g, '')}_${hashString(`${sp.id}:${gen}`).toString(36)}${hashString(`${gen}:${sp.id}`).toString(36)}` };
      },
      suspend: (ctx, sp) => {
        requireActive(sp, 'suspend');
        const ws = workloadsOfSpace(sp.id).filter((w) => w.status !== 'Terminating');
        for (const w of ws) if (w.kind !== 'CronJob' && w.replicas > 0) db.update('k8sWorkloads', w.id, { suspendedReplicas: w.replicas, replicas: 0, readyReplicas: 0 } as any);
        db.update('k8sSpaces', sp.id, { status: 'suspended' } as any);
        startOperation({ type: 'k8sSpace.suspend', title: `Suspend space ${sp.name}`, target: wlTarget(sp), scope: spScope(sp), actor: ctx.actor, silent: true,
          steps: [{ name: 'Scale workloads to 0', ms: s(0.8), logs: ws.map((w) => (w.kind === 'CronJob' ? `cronjob/${w.name} suspended` : `${w.kind.toLowerCase()}/${w.name} scaled ${w.replicas} → 0`)) }, { name: 'Block new pods (quota pods=0)', ms: s(0.4), logs: ['resourcequota/space-quota: pods=0 while suspended'] }] });
        notify('warning', `Space ${sp.name} was suspended`, 'All workloads were scaled to 0. Data and configuration are kept; resume to start them again.', `/managed-services/kubernetes/spaces/${sp.id}`, sp.accountId);
        return decorateSpace(db.get<SpaceRow>('k8sSpaces', sp.id)!);
      },
      resume: (ctx, sp) => {
        if (sp.status !== 'suspended') throw new ApiError(409, `Space ${sp.name} is not suspended`, 'invalid_state');
        const ws = workloadsOfSpace(sp.id);
        for (const w of ws) if (w.suspendedReplicas != null) db.update('k8sWorkloads', w.id, { replicas: w.suspendedReplicas, readyReplicas: w.suspendedReplicas, suspendedReplicas: undefined } as any);
        db.update('k8sSpaces', sp.id, { status: 'active' } as any);
        startOperation({ type: 'k8sSpace.resume', title: `Resume space ${sp.name}`, target: wlTarget(sp), scope: spScope(sp), actor: ctx.actor, silent: true,
          steps: [{ name: 'Restore quota', ms: s(0.4), logs: [`resourcequota/space-quota: pods=${sp.quota.pods}`] }, { name: 'Scale workloads back', ms: s(1), logs: ws.map((w) => (w.kind === 'CronJob' ? `cronjob/${w.name} resumed` : `${w.kind.toLowerCase()}/${w.name} scaled 0 → ${w.suspendedReplicas ?? w.replicas}`)) }] });
        return decorateSpace(db.get<SpaceRow>('k8sSpaces', sp.id)!);
      },
      move: (ctx, sp, body) => {
        if (sp.status !== 'active' && sp.status !== 'suspended') throw new ApiError(409, `Cannot move a space that is ${sp.status}`, 'invalid_state');
        const to = db.get<PcRow>('platformClusters', body.platformClusterId ?? '');
        if (!to) throw new ApiError(422, 'Choose a target platform cluster', 'validation_failed', { platformClusterId: 'Unknown platform cluster' });
        if (to.id === sp.platformClusterId) throw new ApiError(422, `${sp.name} already runs on ${to.name}`, 'validation_failed', { platformClusterId: 'Same cluster' });
        checkLocationAllowed(sp.projectId, to.locationId);
        const c = candidateFor(to, sp.quota, { accountId: sp.accountId, projectId: sp.projectId });
        if (!c.fits) throw new ApiError(409, `${to.name} can't take ${sp.name}: ${c.reason}`, 'placement_rejected', { platformClusterId: c.reason ?? '' });
        if (db.find<SpaceRow>('k8sSpaces', (x) => x.platformClusterId === to.id && x.namespace === sp.namespace)) throw new ApiError(409, `Namespace ${sp.namespace} already exists on ${to.name}`, 'conflict');
        const from = db.get<PcRow>('platformClusters', sp.platformClusterId);
        const ws = workloadsOfSpace(sp.id);
        const used = spaceUsage(sp.id);
        db.update('k8sSpaces', sp.id, { movingTo: to.id, resumeStatus: sp.status, status: 'provisioning' } as any);
        audit(ctx, 'k8sSpace.move', wlTarget(sp), { ...spScope(sp), details: `${from?.name ?? sp.platformClusterId} → ${to.name}` });
        startOperation({ type: 'k8sSpace.move', title: `Move space ${sp.name} to ${to.name}`, target: wlTarget(sp), scope: spScope(sp), actor: ctx.actor,
          steps: [
            { name: `Reserve quota on ${to.name}`, ms: s(0.5), logs: [`${fmtNum(sp.quota.cpuCores)} cores / ${fmtNum(sp.quota.memoryGi)} GiB promised on ${to.name}`] },
            { name: 'Create namespace, quota & policies on target', ms: s(0.9), logs: [`namespace/${sp.namespace} created on ${to.name}`, 'ResourceQuota, LimitRange, NetworkPolicies, RBAC applied'] },
            { name: `Back up & restore volumes (${used.storageGi} GiB)`, ms: s(1.6), logs: [`velero backup ${sp.namespace}-move created`, 'restic: PVC data copied', 'secrets & configmaps restored'] },
            { name: `Start ${ws.length} workload${ws.length === 1 ? '' : 's'} on target`, ms: s(1.2), logs: ws.map((w) => `${w.kind.toLowerCase()}/${w.name} ready on ${to.name}`) },
            { name: 'Switch ingress DNS', ms: s(0.6), logs: [`*.${sp.name}.${accountSlug(sp.accountId)}.${to.ingressDomain} → ${to.name} ingress`, 'old hostnames redirect for 7 days'] },
            { name: `Delete namespace on ${from?.name ?? 'source'}`, ms: s(0.8), logs: ['source namespace deleted, quota released'] },
          ],
          onComplete: 'k8sSpace.moved', onFail: 'k8sSpace.moveFailed', payload: { id: sp.id, to: to.id } });
        notify('info', `Space ${sp.name} is moving to ${to.name}`, 'The provider is moving your space to another platform cluster. Workloads restart once; the kubeconfig server URL changes.', `/managed-services/kubernetes/spaces/${sp.id}`, sp.accountId);
        return decorateSpace(db.get<SpaceRow>('k8sSpaces', sp.id)!);
      },
    },
  });

  route('GET', '/k8sSpaces/:id/kubeconfig', (ctx) => {
    const sp = inScope(ctx, getOr404<SpaceRow>('k8sSpaces', ctx.params.id, 'Space'), 'Space');
    if (sp.status === 'provisioning' && !sp.movingTo) throw new ApiError(409, 'The kubeconfig is available once the space is active', 'invalid_state');
    if (ctx.query.get('download') === '1') audit(ctx, 'k8sSpace.kubeconfig', wlTarget(sp), { ...spScope(sp), details: 'kubeconfig downloaded' });
    return spaceKubeconfig(sp);
  }, 'Namespaced kubeconfig for a space');
  route('GET', '/k8sSpaces/:id/usage', (ctx) => {
    const sp = inScope(ctx, getOr404<SpaceRow>('k8sSpaces', ctx.params.id, 'Space'), 'Space');
    const used = spaceUsage(sp.id);
    return {
      quota: sp.quota, used, pods: { used: used.pods, max: sp.quota.pods },
      workloads: workloadsOfSpace(sp.id).map((w) => ({ id: w.id, name: w.name, kind: w.kind, ...wlDemand(w) })),
    };
  }, 'Quota usage of a space (sum of workload requests)');
  route('GET', '/k8sSpaces/:id/pods', (ctx) => {
    const sp = inScope(ctx, getOr404<SpaceRow>('k8sSpaces', ctx.params.id, 'Space'), 'Space');
    const items = spacePods(sp);
    return { items, total: items.length };
  }, 'Pods of a space (derived)');

  /* ---------------------------------------------------------------- metrics */
  registerMetrics('k8sSpace', (sp: SpaceRow, metric) => {
    const off = sp.status === 'suspended' || sp.status === 'deleting' || sp.status === 'provisioning' || sp.status === 'error';
    const u = spaceUsage(sp.id);
    switch (metric) {
      case 'cpu': return { unit: 'cores', base: u.cpuCores * 0.55, amp: Math.max(0.05, u.cpuCores * 0.18), max: sp.quota.cpuCores, diurnal: 0.3, spikiness: 0.3, off };
      case 'cpuRequests': return { unit: 'cores', base: u.cpuCores, amp: 0, max: sp.quota.cpuCores, off };
      case 'memory': return { unit: 'GiB', base: u.memoryGi * 0.7, amp: Math.max(0.05, u.memoryGi * 0.05), max: sp.quota.memoryGi, off };
      case 'memoryRequests': return { unit: 'GiB', base: u.memoryGi, amp: 0, max: sp.quota.memoryGi, off };
      case 'pods': return { unit: 'pods', base: u.pods, amp: 0.3, max: sp.quota.pods, off };
      case 'netIn': return { unit: 'Mbit/s', base: 4 + u.pods * 2.5, amp: 6, diurnal: 0.45, off };
      case 'netOut': return { unit: 'Mbit/s', base: 6 + u.pods * 3.5, amp: 9, diurnal: 0.45, off };
      case 'throttling': return { unit: '%', base: u.cpuCores / Math.max(0.5, sp.quota.cpuCores) > 0.85 ? 6 : 1, amp: 2, max: 100, spikiness: 0.4, off };
      default: return null;
    }
  });
  registerMetrics('platformCluster', (pc: PcRow, metric) => {
    const off = pc.status === 'provisioning';
    const cap = pcCapacity(pc); const used = pcUsed(pc.id);
    switch (metric) {
      case 'cpu': return { unit: '%', base: cap.cpuCores ? Math.max(4, (used.cpuCores / cap.cpuCores) * 60 + 6) : 0, amp: 7, max: 100, diurnal: 0.3, spikiness: 0.25, off };
      case 'memory': return { unit: '%', base: cap.memoryGi ? Math.max(8, (used.memoryGi / cap.memoryGi) * 75 + 10) : 0, amp: 3, max: 100, off };
      case 'pods': return { unit: 'pods', base: used.pods + 24, amp: 0.5, off };
      case 'apiLatency': return { unit: 'ms', base: pc.controlPlane.ha ? 24 : 36, amp: 8, spikiness: 0.4, off };
      case 'apiRequests': return { unit: 'req/s', base: 60 + pcPromised(pc.id).spaces * 18, amp: 20, diurnal: 0.3, off };
      case 'netIn': return { unit: 'Mbit/s', base: 40 + used.pods * 4, amp: 30, diurnal: 0.4, off };
      case 'netOut': return { unit: 'Mbit/s', base: 60 + used.pods * 6, amp: 40, diurnal: 0.4, off };
      default: return null;
    }
  });
}
