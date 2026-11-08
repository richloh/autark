import { db } from '../db';
import { defineCollection, route, ApiError, validate, nameError, uniqueNameError, scopeFor, newId, nowIso, getOr404, audit, notify, type Ctx } from '../framework';
import { startOperation, onOperationComplete, type StepSpec } from '../operations';
import { registerMetrics } from '../metrics';
import { k8sMonthly } from './costs';
import { locationOrThrow, checkQuota, checkRequiredTags, checkLocationAllowed } from './shared';
import { parseCidr, intToIp, cidrOverlaps, isValidCidr } from '@/lib/cidr';
import { hashString, mulberry32, noise } from '@/lib/random';
import { seedK8s } from '../seed/k8s';
import {
  K8S_VERSIONS, K8S_NODE_PRESETS, K8S_ADDONS, k8sNextVersion, k8sPatch,
  type K8sCluster, type K8sWorkload, type NodePool, type K8sNode, type K8sPod, type K8sEvent, type K8sTopology, type K8sClusterSummary,
  type Network, type Operation, type Tag, type K8sNodeStatus,
} from '@/types';

/* ------------------------------------------------------------------------------------------------
 * Managed Kubernetes.
 *
 * Clusters and workloads are stored; nodes and pods are DERIVED deterministically from node pools
 * and workloads by a small scheduler (taints/tolerations, node selectors, GPU requests, CPU/memory
 * requests, least-allocated scoring, spread). Running operations overlay live state: nodes joining,
 * draining or being surge-upgraded, and pods rolling out step by step — so the UI can animate them.
 * ---------------------------------------------------------------------------------------------- */

const s = (n: number) => Math.round(n * 1000);
const SUFFIX_CHARS = 'bcdfghjklmnpqrstvwxz2456789';
function suffix(seed: string, len = 5) {
  const r = mulberry32(hashString(seed));
  let out = '';
  for (let i = 0; i < len; i++) out += SUFFIX_CHARS[Math.floor(r() * SUFFIX_CHARS.length)];
  return out;
}
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const CNI_IMAGE: Record<K8sCluster['cni'], { name: string; image: string; cpu: number; mem: number }> = {
  cilium: { name: 'cilium', image: 'quay.io/cilium/cilium:v1.16.2', cpu: 200, mem: 256 },
  calico: { name: 'calico-node', image: 'calico/node:v3.28.1', cpu: 250, mem: 128 },
  flannel: { name: 'kube-flannel-ds', image: 'flannel/flannel:v0.25.6', cpu: 100, mem: 50 },
};

/* ================================================================================================
 * Derived topology (nodes + pods)
 * ============================================================================================== */

interface PodOverlay { workloadId: string; mode: 'rollout' | 'restart' | 'terminate' | 'delete'; step?: number; steps?: number[]; fromOrdinal?: number; newRevision?: number }
interface OpPayload {
  id: string;
  nodeSteps?: Record<string, number>; // nodeKey -> step that makes it Ready
  drainSteps?: Record<string, number>; // nodeKey -> step after which it is gone
  upgradeSteps?: Record<string, number>; // nodeKey -> step that replaces it with toVersion
  toVersion?: string;
  cpStep?: number;
  pods?: PodOverlay[];
}

function clusterOps(clusterId: string): Operation[] {
  return db.filter<Operation>('operations', (o) => o.status === 'running' && o.target.id === clusterId);
}
const stepStatus = (op: Operation, i: number | undefined) => (i == null ? undefined : op.steps[i]?.status);

export function nodeAllocatable(vcpus: number, ramGB: number, gpus: number) {
  return { cpuM: vcpus * 1000 - 70 - vcpus * 20, memMi: Math.round(ramGB * 1024 * 0.92 - 100), pods: 110, gpu: gpus };
}

function nodeName(c: K8sCluster, p: NodePool, i: number) { return `${c.name}-${p.name}-${suffix(`${p.id}:${i}`)}` }
const nodeKey = (p: NodePool, i: number) => `${p.id}:${i}`;

function subnetCidr(c: K8sCluster): string {
  const net = db.get<Network>('networks', c.networkId);
  return net?.subnets.find((sn) => sn.id === c.subnetId)?.cidr ?? '10.0.16.0/20';
}

function taintKey(t: string) { return t.split(/[=:]/)[0] }
function taintEffect(t: string) { return t.split(':')[1] ?? 'NoSchedule' }
function tolerates(w: Pick<K8sWorkload, 'tolerations' | 'namespace'>, taints: string[]) {
  const tol = w.tolerations ?? [];
  if (tol.includes('*')) return true;
  return taints.every((t) => taintEffect(t) === 'PreferNoSchedule' || tol.includes(taintKey(t)));
}
function selectorMatches(sel: Tag[] | undefined, labels: Tag[]) {
  return !sel?.length || sel.every((s) => labels.some((l) => l.key === s.key && l.value === s.value));
}

/** pod <-> node bindings remembered between reads so existing pods don't jump around */
const bindings = new Map<string, Map<string, string>>();
const topoCache = new Map<string, { at: number; topo: K8sTopology }>();

interface TopoOpts {
  /** pure simulation: ignore running operations and binding memory */
  simulate?: boolean;
  pools?: NodePool[];
  extraWorkloads?: K8sWorkload[];
  excludeWorkloadIds?: string[];
}

export function clusterWorkloads(clusterId: string) {
  return db.filter<K8sWorkload>('k8sWorkloads', (w) => w.clusterId === clusterId);
}

/** Data persisted by an older build lacks scheduling hints; enrich it once from the seed (by id). */
let migrated = false;
function migrateLegacy() {
  if (migrated) return;
  migrated = true;
  const seed = seedK8s();
  for (const sw of seed.k8sWorkloads) {
    const cur = db.get<K8sWorkload>('k8sWorkloads', sw.id);
    if (cur && cur.revision == null && cur.clusterId === sw.clusterId && cur.name === sw.name) {
      db.update('k8sWorkloads', cur.id, { revision: 1, tolerations: sw.tolerations, nodeSelector: sw.nodeSelector, gpuPerPod: sw.gpuPerPod, managedBy: sw.managedBy, schedule: sw.schedule, expose: sw.expose } as any);
    }
  }
  for (const sc of seed.k8sClusters) {
    const cur = db.get<K8sCluster>('k8sClusters', sc.id);
    if (cur && cur.credentialGeneration == null) {
      db.update('k8sClusters', cur.id, { oidcConfig: sc.oidcConfig, credentialGeneration: sc.credentialGeneration, credentialsRotatedAt: sc.credentialsRotatedAt, apiAllowlist: sc.apiAllowlist, privateEndpoint: sc.privateEndpoint, deletionProtection: sc.deletionProtection } as any);
      for (const sw of seed.k8sWorkloads.filter((w) => w.clusterId === sc.id && !db.get('k8sWorkloads', w.id) && !clusterWorkloads(sc.id).some((x) => x.namespace === w.namespace && x.name === w.name))) db.insert('k8sWorkloads', sw as any);
    }
  }
}

export function computeTopology(c: K8sCluster, opts: TopoOpts = {}): K8sTopology {
  migrateLegacy();
  if (!opts.simulate && !opts.pools && !opts.extraWorkloads) {
    const hit = topoCache.get(c.id);
    if (hit && Date.now() - hit.at < 250) return hit.topo;
  }
  const now = Date.now();
  const ops = opts.simulate ? [] : clusterOps(c.id);
  const join = new Map<string, Operation & { _s: number }>();
  const drain = new Map<string, Operation & { _s: number }>();
  const upgrade = new Map<string, Operation & { _s: number }>();
  let toVersion: string | undefined;
  const podOverlays = new Map<string, { op: Operation; o: PodOverlay }>();
  for (const op of ops) {
    const p = op.completion?.payload as OpPayload | undefined;
    if (!p) continue;
    for (const [k, i] of Object.entries(p.nodeSteps ?? {})) join.set(k, { ...op, _s: i });
    for (const [k, i] of Object.entries(p.drainSteps ?? {})) drain.set(k, { ...op, _s: i });
    for (const [k, i] of Object.entries(p.upgradeSteps ?? {})) upgrade.set(k, { ...op, _s: i });
    if (p.toVersion) toVersion = p.toVersion;
    for (const o of p.pods ?? []) podOverlays.set(o.workloadId, { op, o });
  }

  /* ---- nodes */
  const pools = opts.pools ?? c.nodePools;
  const cidr = parseCidr(subnetCidr(c));
  const span = cidr ? Math.max(32, cidr.last - cidr.first - 20) : 200;
  const nodes: K8sNode[] = [];
  const mkNode = (p: NodePool, i: number, name: string, status: K8sNodeStatus, version: string, extra: Partial<K8sNode> = {}): K8sNode => {
    const gpuCount = p.gpu?.count ?? 0;
    const off = (((hashString(p.id) % 60) * 40 + i) % span) + 10;
    const labels: Tag[] = [
      ...p.labels,
      { key: 'autark.io/pool', value: p.name },
      { key: 'node.kubernetes.io/instance-type', value: p.presetId ?? `custom-${p.vcpus}c${p.ramGB}g` },
      { key: 'topology.kubernetes.io/zone', value: `${c.locationId}-${'abc'[i % 3]}` },
      ...(gpuCount ? [{ key: 'nvidia.com/gpu.present', value: 'true' }, { key: 'nvidia.com/gpu.product', value: p.gpu!.model }] : []),
    ];
    return {
      name, poolId: p.id, poolName: p.name, index: i, status, unschedulable: status !== 'Ready', internalIp: cidr ? intToIp(cidr.first + off) : '10.0.0.10',
      version: `v${k8sPatch(version)}`, zone: `${c.locationId}-${'abc'[i % 3]}`, vcpus: p.vcpus, ramGB: p.ramGB, gpu: p.gpu ?? null,
      allocatable: nodeAllocatable(p.vcpus, p.ramGB, gpuCount), requested: { cpuM: 0, memMi: 0, gpu: 0 }, podCount: 0, usage: { cpuPct: 0, memPct: 0 },
      taints: p.taints, labels, createdAt: p.createdAt ?? c.createdAt, ...extra,
    };
  };
  for (const p of pools) {
    const baseVersion = p.version ?? c.version;
    for (let i = 0; i < p.count; i++) {
      const key = nodeKey(p, i);
      let status: K8sNodeStatus = 'Ready';
      let version = baseVersion;
      const j = join.get(key);
      if (j) {
        const st = stepStatus(j, j._s);
        status = st === 'done' ? 'Ready' : st === 'running' ? 'NotReady' : 'Provisioning';
      }
      const d = drain.get(key);
      let cordoned = false;
      if (d) {
        const st = stepStatus(d, d._s);
        if (st === 'done') continue; // gone
        if (st === 'running') status = 'Draining';
        else cordoned = true;
      }
      const u = upgrade.get(key);
      if (u && toVersion) {
        const st = stepStatus(u, u._s);
        if (st === 'done') version = toVersion;
        else if (st === 'running') {
          status = 'Upgrading';
          // surge node with the new version keeps capacity up while this node is replaced
          nodes.push(mkNode(p, 1000 + i, `${c.name}-${p.name}-${suffix(`${key}:surge:${toVersion}`)}`, 'Ready', toVersion, { surge: true, createdAt: nowIso() }));
        }
      }
      if (c.status === 'deleting') status = 'Draining';
      if (c.status === 'provisioning' && !j && !opts.simulate) status = 'Provisioning';
      nodes.push(mkNode(p, i, nodeName(c, p, i), status, version, cordoned ? { unschedulable: true } : {}));
    }
  }

  /* ---- scheduling */
  const nodeByName = new Map(nodes.map((n) => [n.name, n]));
  const free = new Map(nodes.map((n) => [n.name, { ...n.allocatable }]));
  const memory = opts.simulate ? new Map<string, string>() : bindings.get(c.id) ?? new Map<string, string>();
  const nextMemory = new Map<string, string>();
  const pods: K8sPod[] = [];
  const pending: { pod: K8sPod; reasons: Record<string, number> }[] = [];
  const sameOnNode = new Map<string, number>(); // `${wl}|${node}` -> count

  let workloads = clusterWorkloads(c.id).filter((w) => !opts.excludeWorkloadIds?.includes(w.id));
  if (opts.extraWorkloads) workloads = [...workloads.filter((w) => !opts.extraWorkloads!.some((x) => x.id === w.id)), ...opts.extraWorkloads];
  const order = [...workloads].sort((a, b) =>
    Number(b.kind === 'DaemonSet') - Number(a.kind === 'DaemonSet') || Number(b.namespace === 'kube-system') - Number(a.namespace === 'kube-system') || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  const eligible = (w: K8sWorkload, n: K8sNode) => tolerates(w, n.taints) && selectorMatches(w.nodeSelector, n.labels) && ((w.gpuPerPod ?? 0) === 0 || (n.gpu?.count ?? 0) > 0);
  const fits = (w: K8sWorkload, n: K8sNode) => {
    const f = free.get(n.name)!;
    return f.cpuM >= w.cpuRequestM && f.memMi >= w.memRequestMi && f.pods >= 1 && f.gpu >= (w.gpuPerPod ?? 0);
  };
  const place = (w: K8sWorkload, n: K8sNode) => {
    const f = free.get(n.name)!;
    f.cpuM -= w.cpuRequestM; f.memMi -= w.memRequestMi; f.pods -= 1; f.gpu -= w.gpuPerPod ?? 0;
    n.requested.cpuM += w.cpuRequestM; n.requested.memMi += w.memRequestMi; n.requested.gpu += w.gpuPerPod ?? 0; n.podCount += 1;
    const k = `${w.id}|${n.name}`;
    sameOnNode.set(k, (sameOnNode.get(k) ?? 0) + 1);
  };
  const podIp = (n: K8sNode, slot: number) => {
    const pc = parseCidr(c.podCidr);
    const ord = nodes.indexOf(n);
    return pc ? intToIp(pc.first + ((ord % 250) << 8) + 2 + (slot % 250)) : null;
  };

  for (const w of order) {
    if (w.kind === 'CronJob') continue;
    const ov = podOverlays.get(w.id);
    const rev = w.revision ?? 1;
    const crashing = !ov && w.status === 'Degraded' ? Math.max(0, w.replicas - w.readyReplicas) : 0;
    const base = { namespace: w.namespace, workloadId: w.id, workloadName: w.name, kind: w.kind, cpuM: w.cpuRequestM, memMi: w.memRequestMi, gpu: w.gpuPerPod ?? 0, image: w.image, system: !!w.managedBy || w.namespace === 'kube-system' };
    const started = (seed: string) => new Date(Math.max(Date.parse(w.restartedAt ?? w.createdAt), now - (hashString(seed) % (20 * 86_400_000)))).toISOString();

    if (w.kind === 'DaemonSet') {
      let slot = 0;
      for (const n of nodes) {
        if (n.status === 'Provisioning' || !eligible(w, n)) continue;
        const name = `${w.name}-${suffix(`${w.id}:${n.name}`)}`;
        place(w, n);
        let status: K8sPod['status'] = n.status === 'NotReady' ? 'ContainerCreating' : 'Running';
        if (ov) status = podStatusFor(ov.op, ov.o, slot, status);
        pods.push({ ...base, name, node: n.name, status, restarts: hashString(name) % 3 === 0 ? 1 : 0, ip: n.internalIp, startedAt: started(name) });
        slot++;
      }
      continue;
    }

    const replicas = w.replicas;
    for (let i = 0; i < replicas; i++) {
      // pod name: restarts produce the new revision name once that ordinal is being replaced
      let r = rev;
      if (ov?.o.mode === 'restart' && ov.o.newRevision) {
        const st = stepStatus(ov.op, ov.o.steps?.[i] ?? ov.o.step);
        if (st === 'done' || st === 'running') r = ov.o.newRevision;
      }
      const name = w.kind === 'StatefulSet' ? `${w.name}-${i}` : `${w.name}-${suffix(`${w.id}:rs:${r}`, 9)}-${suffix(`${w.id}:${r}:${i}`)}`;
      // try remembered node first
      let target: K8sNode | undefined;
      const remembered = memory.get(name);
      if (remembered) {
        const n = nodeByName.get(remembered);
        if (n && n.status === 'Ready' && eligible(w, n) && fits(w, n)) target = n;
      }
      const reasons: Record<string, number> = {};
      if (!target) {
        let best: { n: K8sNode; score: number } | null = null;
        for (const n of nodes) {
          if (n.status !== 'Ready' || n.unschedulable) { reasons[`node(s) were unschedulable`] = (reasons['node(s) were unschedulable'] ?? 0) + 1; continue }
          if (!tolerates(w, n.taints)) { const t = n.taints.find((x) => !(w.tolerations ?? []).includes(taintKey(x)))!; const k = `node(s) had untolerated taint {${t.split(':')[0].replace('=', ': ')}}`; reasons[k] = (reasons[k] ?? 0) + 1; continue }
          if (!selectorMatches(w.nodeSelector, n.labels)) { reasons["node(s) didn't match Pod's node affinity/selector"] = (reasons["node(s) didn't match Pod's node affinity/selector"] ?? 0) + 1; continue }
          if ((w.gpuPerPod ?? 0) > 0 && !(n.gpu?.count)) { reasons['Insufficient nvidia.com/gpu'] = (reasons['Insufficient nvidia.com/gpu'] ?? 0) + 1; continue }
          const f = free.get(n.name)!;
          if (f.cpuM < w.cpuRequestM) { reasons['Insufficient cpu'] = (reasons['Insufficient cpu'] ?? 0) + 1; continue }
          if (f.memMi < w.memRequestMi) { reasons['Insufficient memory'] = (reasons['Insufficient memory'] ?? 0) + 1; continue }
          if (f.gpu < (w.gpuPerPod ?? 0)) { reasons['Insufficient nvidia.com/gpu'] = (reasons['Insufficient nvidia.com/gpu'] ?? 0) + 1; continue }
          if (f.pods < 1) { reasons['Too many pods'] = (reasons['Too many pods'] ?? 0) + 1; continue }
          const cpuR = (n.requested.cpuM + w.cpuRequestM) / n.allocatable.cpuM;
          const memR = (n.requested.memMi + w.memRequestMi) / n.allocatable.memMi;
          const score = (cpuR + memR) / 2 + 0.18 * (sameOnNode.get(`${w.id}|${n.name}`) ?? 0) + (n.surge ? 0.05 : 0);
          if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) < 1e-9 && n.name < best.n.name)) best = { n, score };
        }
        target = best?.n;
      }
      if (target) {
        place(w, target);
        nextMemory.set(name, target.name);
        let status: K8sPod['status'] = i >= replicas - crashing ? 'CrashLoopBackOff' : 'Running';
        let node: string | null = target.name;
        if (ov) {
          status = podStatusFor(ov.op, ov.o, i, status);
          if (status === 'Pending') node = null;
        }
        pods.push({ ...base, name, node, status, reason: status === 'CrashLoopBackOff' ? 'Back-off restarting failed container' : status === 'Pending' ? 'Waiting for rollout step' : undefined,
          restarts: status === 'CrashLoopBackOff' ? 14 + (hashString(name) % 40) : hashString(name) % 7 === 0 ? 1 : 0, ip: node && status !== 'Pending' ? podIp(target, target.podCount) : null, startedAt: status === 'Running' ? started(name) : null });
      } else {
        const pod: K8sPod = { ...base, name, node: null, status: ov && ov.o.mode === 'delete' ? 'Terminating' : 'Pending', restarts: 0, ip: null, startedAt: null, unschedulable: true };
        pods.push(pod);
        pending.push({ pod, reasons });
      }
    }
  }
  for (const pe of pending) {
    const total = nodes.length;
    const parts = Object.entries(pe.reasons).map(([k, v]) => `${v} ${k}`);
    pe.pod.reason = `0/${total} nodes are available: ${parts.length ? parts.join(', ') : 'no nodes in the cluster'}.`;
  }
  if (!opts.simulate) bindings.set(c.id, nextMemory);

  /* ---- live usage (actual usage is below requests most of the time) */
  for (const n of nodes) {
    const wob = noise(n.name, now / 300_000);
    n.usage.cpuPct = n.status === 'Ready' || n.status === 'Upgrading' || n.status === 'Draining' ? Math.min(0.98, (n.requested.cpuM / n.allocatable.cpuM) * (0.45 + 0.35 * wob) + 0.04) : 0;
    n.usage.memPct = n.status === 'Provisioning' ? 0 : Math.min(0.97, (n.requested.memMi / n.allocatable.memMi) * (0.7 + 0.15 * wob) + 0.08);
  }

  /* ---- events */
  const events: K8sEvent[] = [];
  const byWl = new Map<string, { pod: K8sPod; count: number }>();
  for (const pe of pending) { const e = byWl.get(pe.pod.workloadId); if (e) e.count++; else byWl.set(pe.pod.workloadId, { pod: pe.pod, count: 1 }) }
  for (const { pod, count } of byWl.values()) events.push({ type: 'Warning', reason: 'FailedScheduling', object: `pod/${pod.name}`, message: pod.reason ?? '', time: new Date(now - 20_000).toISOString(), count });
  for (const p of pods.filter((x) => x.status === 'CrashLoopBackOff')) events.push({ type: 'Warning', reason: 'BackOff', object: `pod/${p.name}`, message: 'Back-off restarting failed container opensearch in pod ' + p.name, time: new Date(now - 95_000).toISOString(), count: p.restarts });
  for (const n of nodes.filter((x) => x.status === 'NotReady' || x.status === 'Provisioning')) events.push({ type: 'Normal', reason: n.status === 'NotReady' ? 'RegisteredNode' : 'Provisioning', object: `node/${n.name}`, message: n.status === 'NotReady' ? `Node ${n.name} event: Registered Node ${n.name} in Controller` : `Creating instance for node pool ${n.poolName}`, time: new Date(now - 5_000).toISOString() });
  for (const n of nodes.filter((x) => x.status === 'Draining' || x.status === 'Upgrading')) events.push({ type: 'Normal', reason: 'NodeNotSchedulable', object: `node/${n.name}`, message: `Node ${n.name} status is now: NodeNotSchedulable`, time: new Date(now - 8_000).toISOString() });
  const recentOps = db.filter<Operation>('operations', (o) => o.target.id === c.id && Date.parse(o.createdAt) > now - 3 * 86_400_000).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
  for (const op of recentOps) events.push({ type: op.status === 'failed' ? 'Warning' : 'Normal', reason: opReason(op.type), object: `cluster/${c.name}`, message: op.title + (op.status === 'running' ? ' (in progress)' : op.status === 'failed' ? ` — ${op.error}` : ''), time: op.createdAt });
  events.sort((a, b) => b.time.localeCompare(a.time));

  /* ---- summary */
  const real = nodes.filter((n) => n.status !== 'Provisioning');
  const allocCpu = real.reduce((a, n) => a + n.allocatable.cpuM, 0);
  const allocMem = real.reduce((a, n) => a + n.allocatable.memMi, 0);
  const summary: K8sClusterSummary = {
    nodes: nodes.filter((n) => !n.surge).length,
    readyNodes: nodes.filter((n) => n.status === 'Ready' && !n.surge).length,
    pods: pods.length,
    runningPods: pods.filter((p) => p.status === 'Running').length,
    pendingPods: pods.filter((p) => p.unschedulable).length,
    cpuRequestedPct: allocCpu ? real.reduce((a, n) => a + n.requested.cpuM, 0) / allocCpu : 0,
    memRequestedPct: allocMem ? real.reduce((a, n) => a + n.requested.memMi, 0) / allocMem : 0,
    allocatableCpuM: allocCpu,
    allocatableMemMi: allocMem,
    workloads: workloads.length,
    namespaces: new Set(workloads.map((w) => w.namespace)).size,
  };
  const topo = { nodes, pods, events: events.slice(0, 40), summary };
  if (!opts.simulate && !opts.pools && !opts.extraWorkloads) topoCache.set(c.id, { at: Date.now(), topo });
  return topo;
}

function podStatusFor(op: Operation, o: PodOverlay, ordinal: number, steady: K8sPod['status']): K8sPod['status'] {
  if (o.mode === 'delete') return 'Terminating';
  if (o.fromOrdinal != null && ordinal < o.fromOrdinal) return steady;
  const st = stepStatus(op, o.steps?.[ordinal - (o.fromOrdinal ?? 0)] ?? o.step);
  if (o.mode === 'terminate') return st === 'done' ? steady : 'Terminating';
  if (o.mode === 'restart') return st === 'running' ? 'ContainerCreating' : steady;
  // rollout
  if (st === 'done') return steady === 'CrashLoopBackOff' ? 'Running' : steady;
  if (st === 'running') return 'ContainerCreating';
  return 'Pending';
}

function opReason(type: string) {
  return ({
    'k8s.create': 'ClusterProvisioning', 'k8s.scale': 'NodePoolScaled', 'k8s.addNodePool': 'NodePoolCreated', 'k8s.removeNodePool': 'NodePoolDeleted', 'k8s.upgrade': 'ClusterUpgrade',
    'k8s.installAddon': 'AddonInstalled', 'k8s.uninstallAddon': 'AddonRemoved', 'k8s.rotateCredentials': 'CredentialsRotated', 'k8s.autoscale': 'TriggeredScaleUp',
    'k8s.workload.deploy': 'ScalingReplicaSet', 'k8s.workload.scale': 'ScalingReplicaSet', 'k8s.workload.restart': 'RollingRestart', 'k8s.workload.delete': 'Killing',
  } as Record<string, string>)[type] ?? 'ClusterEvent';
}

/* ================================================================================================
 * Validation helpers
 * ============================================================================================== */

function resolvePool(body: any, existing: NodePool[], label = 'nodePools'): NodePool {
  const preset = body.presetId ? K8S_NODE_PRESETS.find((p) => p.id === body.presetId) : null;
  if (body.presetId && !preset) throw new ApiError(422, 'Unknown node size preset', 'validation_failed', { [`${label}.presetId`]: 'Unknown preset' });
  const vcpus = preset?.vcpus ?? body.vcpus;
  const ramGB = preset?.ramGB ?? body.ramGB;
  const diskGB = Math.max(preset?.diskGB ?? 20, body.diskGB ?? preset?.diskGB ?? 80);
  const gpu = preset ? preset.gpu ?? null : body.gpu && body.gpu.count > 0 && body.gpu.model && body.gpu.model !== 'none' ? { model: body.gpu.model, count: body.gpu.count } : null;
  const count = body.count ?? 3;
  const autoscale = { enabled: !!body.autoscale?.enabled, min: body.autoscale?.min ?? count, max: body.autoscale?.max ?? count };
  const taints: string[] = (body.taints ?? []).filter((t: string) => t && t.trim());
  validate({
    [`${label}.name`]: nameError(body.name, 'Pool name') || (existing.some((p) => p.name === body.name) && `A node pool named "${body.name}" already exists`) || (body.name.length > 30 && 'Pool name max 30 characters'),
    [`${label}.vcpus`]: !(Number.isInteger(vcpus) && vcpus >= 2 && vcpus <= 128) && 'Nodes need 2–128 vCPUs',
    [`${label}.ramGB`]: !(Number.isFinite(ramGB) && ramGB >= 4 && ramGB <= 1024) && 'Nodes need 4–1024 GB RAM',
    [`${label}.diskGB`]: !(diskGB >= 40 && diskGB <= 2000) && 'Node disk must be 40–2000 GB',
    [`${label}.count`]: !(Number.isInteger(count) && count >= 0 && count <= 100) && 'Node count must be 0–100',
    [`${label}.autoscale`]: autoscale.enabled && (autoscale.min < 0 || autoscale.max > 100 || autoscale.min > autoscale.max ? 'Autoscale needs 0 ≤ min ≤ max ≤ 100' : (count < autoscale.min || count > autoscale.max) && `Initial count must be within autoscale range ${autoscale.min}–${autoscale.max}`),
    [`${label}.taints`]: taints.find((t) => !/^[a-z0-9A-Z./-]+(=[\w.-]*)?:(NoSchedule|PreferNoSchedule|NoExecute)$/.test(t)) && `Invalid taint "${taints.find((t) => !/^[a-z0-9A-Z./-]+(=[\w.-]*)?:(NoSchedule|PreferNoSchedule|NoExecute)$/.test(t))}" — use key=value:NoSchedule`,
  });
  return {
    id: newId('np'), name: body.name, presetId: preset?.id ?? null, vcpus, ramGB, diskGB, count, autoscale, labels: body.labels ?? [], taints, gpu, status: 'provisioning',
    upgradeSettings: { maxSurge: Math.max(0, Math.min(5, body.upgradeSettings?.maxSurge ?? 1)), maxUnavailable: Math.max(0, Math.min(5, body.upgradeSettings?.maxUnavailable ?? 0)) }, createdAt: nowIso(),
  };
}

function requireIdle(c: K8sCluster, verb: string) {
  if (c.status === 'running' || c.status === 'degraded') return;
  throw new ApiError(409, `Cannot ${verb} while the cluster is ${c.status}. Wait for the current operation to finish.`, 'invalid_state');
}
function poolOr404(c: K8sCluster, poolId: string) {
  const p = c.nodePools.find((x) => x.id === poolId || x.name === poolId);
  if (!p) throw new ApiError(404, `Node pool ${poolId} not found`, 'not_found');
  return p;
}
function scopeOf(c: { accountId: string; projectId: string }) { return { accountId: c.accountId, projectId: c.projectId } }
function batches<T>(arr: T[], size: number): T[][] { const out: T[][] = []; for (let i = 0; i < arr.length; i += Math.max(1, size)) out.push(arr.slice(i, i + Math.max(1, size))); return out }

/* ================================================================================================
 * Cluster create / provisioning
 * ============================================================================================== */

function createCluster(ctx: Ctx, body: any): K8sCluster {
  const sc = scopeFor(ctx, body);
  const loc = locationOrThrow(body.locationId);
  const net = db.get<Network>('networks', body.networkId);
  const version = body.version ?? K8S_VERSIONS[0].version;
  const vinfo = K8S_VERSIONS.find((v) => v.version === version);
  const podCidr = body.podCidr || '172.16.0.0/16';
  const serviceCidr = body.serviceCidr || '172.20.0.0/16';
  validate({
    name: nameError(body.name) || uniqueNameError('k8sClusters', body.name, sc) || (body.name.length > 40 && 'Cluster name max 40 characters'),
    version: !vinfo && `Unsupported version ${version}. Supported: ${K8S_VERSIONS.map((v) => v.version).join(', ')}`,
    networkId: !net ? 'Choose a network' : net.projectId !== sc.projectId ? 'Network belongs to another project' : net.locationId !== loc.id && `Network ${net.name} is in ${net.locationId}; pick a network in ${loc.id}`,
    subnetId: net && !net.subnets.some((x) => x.id === body.subnetId) && 'Choose a subnet',
    cni: !['cilium', 'calico', 'flannel'].includes(body.cni ?? 'cilium') && 'Unknown CNI',
    podCidr: !isValidCidr(podCidr) ? 'Invalid pod CIDR' : net && cidrOverlaps(podCidr, net.cidr) && `Pod CIDR overlaps the VPC ${net.cidr}`,
    serviceCidr: !isValidCidr(serviceCidr) ? 'Invalid service CIDR' : cidrOverlaps(serviceCidr, podCidr) ? 'Service CIDR overlaps the pod CIDR' : net && cidrOverlaps(serviceCidr, net.cidr) && `Service CIDR overlaps the VPC ${net.cidr}`,
    nodePools: !(Array.isArray(body.nodePools) && body.nodePools.length) && 'Add at least one node pool',
    'controlPlane.size': !['small', 'medium', 'large'].includes(body.controlPlane?.size ?? 'small') && 'Unknown control plane size',
    oidcConfig: body.oidc && !(body.oidcConfig?.issuerUrl ?? '').startsWith('https://') && 'OIDC issuer URL must start with https://',
  });
  const pools: NodePool[] = [];
  (body.nodePools as any[]).forEach((p, i) => pools.push({ ...resolvePool(p, pools, `nodePools.${i}`), version }));
  if (pools.reduce((a, p) => a + p.count, 0) < 1) throw new ApiError(422, 'The cluster needs at least one node', 'validation_failed', { nodePools: 'At least one node required' });
  const addons: Record<string, boolean> = {};
  for (const a of K8S_ADDONS) addons[a.id] = !!body.addons?.[a.id];
  if (addons.gpuOperator && !pools.some((p) => p.gpu)) throw new ApiError(422, 'The NVIDIA GPU Operator needs a GPU node pool', 'validation_failed', { addons: 'Add a GPU node pool or disable the GPU Operator' });
  for (const a of K8S_ADDONS) for (const r of a.requires ?? []) if (addons[a.id] && !addons[r]) throw new ApiError(422, `${a.name} requires ${r}`, 'validation_failed', { addons: `${a.name} requires ${r}` });
  checkLocationAllowed(sc.projectId, loc.id);
  checkRequiredTags(sc.projectId, body.tags);
  checkQuota(sc.projectId, { k8sClusters: 1 });

  const id = newId('k8s');
  return {
    id, name: body.name, ...sc, version, status: 'provisioning', locationId: loc.id,
    controlPlane: { ha: !!body.controlPlane?.ha, size: body.controlPlane?.size ?? 'small', endpoint: `https://${id}.k8s.${loc.id}.autark.cloud:6443` },
    nodePools: pools, networkId: net!.id, subnetId: body.subnetId, cni: body.cni ?? 'cilium', podCidr, serviceCidr, storageClass: body.storageClass ?? 'autark-ssd',
    addons, oidc: !!body.oidc, oidcConfig: body.oidc ? { issuerUrl: body.oidcConfig.issuerUrl, clientId: body.oidcConfig.clientId || 'kubernetes', usernameClaim: body.oidcConfig.usernameClaim || 'email', groupsClaim: body.oidcConfig.groupsClaim || 'groups', groupsPrefix: body.oidcConfig.groupsPrefix || undefined } : null,
    autoUpgrade: !!body.autoUpgrade, maintenanceWindow: { day: body.maintenanceWindow?.day ?? 'sun', hour: body.maintenanceWindow?.hour ?? 3 },
    privateEndpoint: !!body.privateEndpoint, apiAllowlist: body.apiAllowlist?.length ? body.apiAllowlist : ['0.0.0.0/0'], credentialsRotatedAt: null, credentialGeneration: 1,
    deletionProtection: !!body.deletionProtection, createdAt: nowIso(), tags: body.tags ?? [],
  };
}

function insertWorkload(c: K8sCluster, w: Partial<K8sWorkload> & Pick<K8sWorkload, 'namespace' | 'name' | 'kind' | 'image' | 'replicas' | 'cpuRequestM' | 'memRequestMi'>, status: K8sWorkload['status'] = 'Running'): K8sWorkload {
  const row: K8sWorkload = {
    id: newId('wl'), clusterId: c.id, ...scopeOf(c), ports: [], readyReplicas: status === 'Running' ? w.replicas : 0, status, createdAt: nowIso(), tags: [], revision: 1, ...w,
  } as K8sWorkload;
  db.insert('k8sWorkloads', row as any);
  return row;
}

function addonWorkloads(c: K8sCluster, addonId: string, status: K8sWorkload['status']) {
  const addon = K8S_ADDONS.find((a) => a.id === addonId)!;
  const out: K8sWorkload[] = [];
  for (const aw of addon.workloads) {
    if (clusterWorkloads(c.id).some((w) => w.namespace === aw.namespace && w.name === aw.name)) continue;
    out.push(insertWorkload(c, { ...aw, ports: aw.ports ?? [], managedBy: addon.id, expose: addon.id === 'ingress' ? 'LoadBalancer' : 'none' }, status));
  }
  return out;
}

function afterCreateCluster(ctx: Ctx, c: K8sCluster) {
  // system workloads + add-ons exist from the start; their pods land as node pools join
  const cni = CNI_IMAGE[c.cni];
  insertWorkload(c, { namespace: 'kube-system', name: 'coredns', kind: 'Deployment', image: 'coredns/coredns:1.11.3', replicas: 2, cpuRequestM: 100, memRequestMi: 70, ports: [53], tolerations: ['CriticalAddonsOnly'] });
  insertWorkload(c, { namespace: 'kube-system', name: cni.name, kind: 'DaemonSet', image: cni.image, replicas: 0, cpuRequestM: cni.cpu, memRequestMi: cni.mem, tolerations: ['*'] });
  if (c.cni !== 'cilium') insertWorkload(c, { namespace: 'kube-system', name: 'kube-proxy', kind: 'DaemonSet', image: `registry.k8s.io/kube-proxy:v${k8sPatch(c.version)}`, replicas: 0, cpuRequestM: 100, memRequestMi: 64, tolerations: ['*'] });
  const enabled = K8S_ADDONS.filter((a) => c.addons[a.id]);
  for (const a of enabled) addonWorkloads(c, a.id, 'Running');

  const cps = c.controlPlane.ha ? 3 : 1;
  const patch = k8sPatch(c.version);
  const steps: StepSpec[] = [
    { name: 'Validate request & reserve quota', ms: s(0.8), logs: [`project ${c.projectId}: quota ok (k8sClusters +1)`, `version ${patch} supported`, `network ${c.networkId}/${c.subnetId} reachable`] },
    { name: `Provision ${cps} control-plane VM${cps > 1 ? 's' : ''}`, ms: s(2), logs: [...Array.from({ length: cps }, (_, i) => `created ${c.name}-cp-${i} (${c.controlPlane.size}) on ${c.locationId}${c.controlPlane.ha ? `, zone ${'abc'[i]}` : ''}`), 'attached API load balancer ' + c.controlPlane.endpoint.replace('https://', '')] },
    { name: 'Bootstrap etcd', ms: s(1.8), logs: [...Array.from({ length: cps }, (_, i) => `etcd member ${c.name}-cp-${i} started (peer https://10.0.0.${11 + i}:2380)`), cps > 1 ? 'raft: elected leader cp-0 at term 2, quorum 2/3' : 'single-member etcd (no HA) — consider HA for production', 'etcd encryption at rest: aescbc (KMS v2)'] },
    { name: 'Start control plane', ms: s(1.6), logs: [`kube-apiserver v${patch} listening on :6443`, 'kube-controller-manager acquired leadership', 'kube-scheduler acquired leadership', 'konnectivity-server ready'] },
    { name: `Install CNI (${c.cni})`, ms: s(1.2), logs: [`pod CIDR ${c.podCidr}, service CIDR ${c.serviceCidr}`, `${cni.image} applied`, c.cni === 'cilium' ? 'kube-proxy replacement: strict (eBPF)' : 'kube-proxy (iptables) deployed'] },
  ];
  const nodeSteps: Record<string, number> = {};
  for (const p of c.nodePools) {
    if (!p.count) continue;
    const idx = steps.length;
    const names = Array.from({ length: p.count }, (_, i) => nodeName(c, p, i));
    names.forEach((_, i) => (nodeSteps[nodeKey(p, i)] = idx));
    steps.push({ name: `Join node pool ${p.name} (${p.count} node${p.count > 1 ? 's' : ''})`, ms: s(1.4 + 0.35 * p.count), logs: [
      `creating ${p.count}× ${p.vcpus} vCPU / ${p.ramGB} GB${p.gpu ? ` / ${p.gpu.count}× ${p.gpu.model}` : ''} instances`, ...names.flatMap((n) => [`node/${n} registered`, `node/${n} condition Ready=True`]),
      ...(p.taints.length ? [`applied taints ${p.taints.join(', ')}`] : []),
    ] });
  }
  if (enabled.length) steps.push({ name: `Install ${enabled.length} add-on${enabled.length > 1 ? 's' : ''}`, ms: s(1.2 + 0.25 * enabled.length), logs: enabled.map((a) => `helm upgrade --install ${a.id} → ${a.namespace} (${a.version}) deployed`) });
  steps.push(
    { name: 'Generate kubeconfig & credentials', ms: s(0.6), logs: ['issued admin client certificate CN=autark:cluster-admin (valid 365d)', ...(c.oidc ? [`OIDC issuer ${c.oidcConfig?.issuerUrl} registered`] : [])] },
    { name: 'Health checks', ms: s(1), logs: ['GET /readyz → ok', 'coredns resolving kubernetes.default.svc', `${c.nodePools.reduce((a, p) => a + p.count, 0)} nodes Ready`, 'cluster is running'] },
  );
  startOperation({
    type: 'k8s.create', title: `Provision Kubernetes cluster ${c.name}`, target: { type: 'k8s', id: c.id, name: c.name }, steps, scope: scopeOf(c), actor: ctx.actor,
    onComplete: 'k8s.provisioned', onFail: 'k8s.failed', payload: { id: c.id, nodeSteps } satisfies OpPayload,
    ...(c.name.includes('fail') ? { failAtStep: 2, failMessage: 'etcd: failed to reach quorum (member cp-0 timed out joining)' } : {}),
  });
}

onOperationComplete('k8s.provisioned', (_op, p: { id: string }) => {
  const c = db.get<K8sCluster>('k8sClusters', p.id);
  if (!c) return;
  db.update<K8sCluster>('k8sClusters', p.id, (x) => { x.status = 'running'; x.nodePools.forEach((np) => { np.status = 'ready'; delete np.readyCount }); return x });
});
onOperationComplete('k8s.failed', (_op, p: { id: string }) => { if (db.get('k8sClusters', p.id)) db.update('k8sClusters', p.id, { status: 'error' } as any) });

/* ================================================================================================
 * Node pool lifecycle
 * ============================================================================================== */

function joinSteps(c: K8sCluster, p: NodePool, from: number, to: number, nodeSteps: Record<string, number>, steps: StepSpec[]) {
  const idx = Array.from({ length: to - from }, (_, i) => from + i);
  for (const group of batches(idx, 3)) {
    const si = steps.length;
    const names = group.map((i) => nodeName(c, p, i));
    group.forEach((i) => (nodeSteps[nodeKey(p, i)] = si));
    steps.push({ name: `Boot & join ${names.length > 1 ? `${names.length} nodes` : names[0]}`, ms: s(1.8), logs: names.flatMap((n) => [`instance ${n} booted (${p.vcpus} vCPU / ${p.ramGB} GB)`, `kubelet v${k8sPatch(p.version ?? c.version)} registered node/${n}`, `node/${n} Ready (CNI up)`]) });
  }
}

function drainSteps(c: K8sCluster, p: NodePool, indices: number[], drain: Record<string, number>, steps: StepSpec[]) {
  const topo = computeTopology(c);
  for (const i of indices) {
    const name = nodeName(c, p, i);
    const onNode = topo.pods.filter((x) => x.node === name && x.kind !== 'DaemonSet');
    drain[nodeKey(p, i)] = steps.length;
    steps.push({ name: `Cordon & drain ${name}`, ms: s(1 + Math.min(1.5, onNode.length * 0.15)), logs: [`node/${name} cordoned`, ...onNode.slice(0, 8).map((x) => `evicting pod ${x.namespace}/${x.name}`), ...(onNode.length > 8 ? [`… and ${onNode.length - 8} more`] : []), `node/${name} drained, instance deleted`] });
  }
}

onOperationComplete('k8s.poolReady', (_op, p: { id: string; poolId: string }) => {
  const c = db.get<K8sCluster>('k8sClusters', p.id);
  if (!c) return;
  db.update<K8sCluster>('k8sClusters', p.id, (x) => {
    const np = x.nodePools.find((n) => n.id === p.poolId);
    if (np) { np.status = 'ready'; delete np.readyCount }
    if (x.status === 'scaling') x.status = 'running';
    return x;
  });
  // pods that were pending while the cluster was busy get another chance
  setTimeout(() => maybeAutoscale(p.id), 0);
});
onOperationComplete('k8s.poolScaledDown', (_op, p: { id: string; poolId: string; count: number }) => {
  const c = db.get<K8sCluster>('k8sClusters', p.id);
  if (!c) return;
  db.update<K8sCluster>('k8sClusters', p.id, (x) => {
    const np = x.nodePools.find((n) => n.id === p.poolId);
    if (np) { np.count = p.count; np.status = 'ready'; delete np.targetCount }
    if (x.status === 'scaling') x.status = 'running';
    return x;
  });
});
onOperationComplete('k8s.poolRemoved', (_op, p: { id: string; poolId: string }) => {
  const c = db.get<K8sCluster>('k8sClusters', p.id);
  if (!c) return;
  db.update<K8sCluster>('k8sClusters', p.id, (x) => { x.nodePools = x.nodePools.filter((n) => n.id !== p.poolId); if (x.status === 'scaling') x.status = 'running'; return x });
});
onOperationComplete('k8s.poolOpFailed', (_op, p: { id: string }) => {
  if (db.get('k8sClusters', p.id)) db.update<K8sCluster>('k8sClusters', p.id, (x) => { x.status = 'running'; x.nodePools.forEach((n) => { n.status = 'ready'; delete n.readyCount; delete n.targetCount }); return x });
});

/** Scale a pool to `count` (starts an operation). Shared by the API and the cluster autoscaler. */
function scalePool(c: K8sCluster, p: NodePool, count: number, actor: string, autoscaler = false) {
  if (count === p.count) return null;
  const steps: StepSpec[] = [];
  if (count > p.count) {
    const nodeSteps: Record<string, number> = {};
    steps.push({ name: autoscaler ? 'Cluster autoscaler: evaluate pending pods' : 'Reserve capacity', ms: s(0.7), logs: autoscaler ? ['unschedulable pods detected', `node group ${p.name}: ${p.count} → ${count} (max ${p.autoscale.max})`] : [`${count - p.count} × ${p.vcpus} vCPU / ${p.ramGB} GB`] });
    joinSteps(c, p, p.count, count, nodeSteps, steps);
    db.update<K8sCluster>('k8sClusters', c.id, (x) => { const np = x.nodePools.find((n) => n.id === p.id)!; np.readyCount = np.count; np.count = count; np.status = 'scaling'; x.status = 'scaling'; return x });
    return startOperation({
      type: autoscaler ? 'k8s.autoscale' : 'k8s.scale', title: `${autoscaler ? 'Autoscaler: scale up' : 'Scale'} ${p.name} ${p.count} → ${count} nodes`, target: { type: 'k8s', id: c.id, name: c.name }, steps,
      scope: scopeOf(c), actor, onComplete: 'k8s.poolReady', onFail: 'k8s.poolOpFailed', payload: { id: c.id, poolId: p.id, nodeSteps } satisfies OpPayload & { poolId: string }, silent: !autoscaler,
    });
  }
  const drain: Record<string, number> = {};
  const indices = Array.from({ length: p.count - count }, (_, i) => p.count - 1 - i);
  drainSteps(c, p, indices, drain, steps);
  db.update<K8sCluster>('k8sClusters', c.id, (x) => { const np = x.nodePools.find((n) => n.id === p.id)!; np.targetCount = count; np.status = 'scaling'; x.status = 'scaling'; return x });
  return startOperation({
    type: 'k8s.scale', title: `Scale ${p.name} ${p.count} → ${count} nodes`, target: { type: 'k8s', id: c.id, name: c.name }, steps, scope: scopeOf(c), actor,
    onComplete: 'k8s.poolScaledDown', onFail: 'k8s.poolOpFailed', payload: { id: c.id, poolId: p.id, count, drainSteps: drain } satisfies OpPayload & { poolId: string; count: number }, silent: true,
  });
}

/** If pods are unschedulable and a pool with autoscaling has headroom, scale it up. */
function maybeAutoscale(clusterId: string): { note: string; op?: Operation } | null {
  const c = db.get<K8sCluster>('k8sClusters', clusterId);
  if (!c || c.status !== 'running') {
    const pend = c ? computeTopology(c, { simulate: true }).summary.pendingPods : 0;
    return pend ? { note: `${pend} pod${pend > 1 ? 's' : ''} unschedulable — the cluster is ${c!.status}; the autoscaler retries afterwards` } : null;
  }
  const base = computeTopology(c, { simulate: true }).summary.pendingPods;
  if (!base) return null;
  let best: { pool: NodePool; count: number; pending: number } | null = null;
  for (const p of c.nodePools.filter((x) => x.autoscale.enabled && x.count < x.autoscale.max && x.status === 'ready')) {
    for (let n = p.count + 1; n <= p.autoscale.max; n++) {
      const pools = c.nodePools.map((x) => (x.id === p.id ? { ...x, count: n } : x));
      const pending = computeTopology(c, { simulate: true, pools }).summary.pendingPods;
      if (pending < base && (!best || pending < best.pending || (pending === best.pending && n - p.count < best.count - best.pool.count))) best = { pool: p, count: n, pending };
      if (pending === 0) break;
    }
  }
  if (!best) return { note: `${base} pod${base > 1 ? 's' : ''} unschedulable — no autoscaling node pool has headroom. Scale a pool or add one.` };
  const op = scalePool(c, best.pool, best.count, 'system', true) ?? undefined;
  audit('system', 'k8s.autoscale', { type: 'k8s', id: c.id, name: c.name }, { ...scopeOf(c), details: `${best.pool.name}: ${best.pool.count} → ${best.count} nodes for ${base} pending pod(s)`, via: 'system' });
  return { note: `Cluster autoscaler is adding ${best.count - best.pool.count} node(s) to ${best.pool.name} for ${base} pending pod${base > 1 ? 's' : ''}`, op };
}

/* ================================================================================================
 * Workload rollouts
 * ============================================================================================== */

function podNamesFor(c: K8sCluster, w: K8sWorkload) {
  return computeTopology(c).pods.filter((p) => p.workloadId === w.id);
}

function startRollout(ctx: Pick<Ctx, 'actor'>, c: K8sCluster, w: K8sWorkload, kind: 'deploy' | 'scale', fromOrdinal = 0, autoscaleOp?: Operation) {
  topoCache.delete(c.id);
  // when the autoscaler is adding nodes, plan against the scaled-up cluster
  const topo = autoscaleOp ? computeTopology(db.get<K8sCluster>('k8sClusters', c.id)!, { simulate: true }) : computeTopology(c);
  const pods = topo.pods.filter((p) => p.workloadId === w.id);
  const newPods = w.kind === 'DaemonSet' ? pods : pods.filter((p) => w.kind === 'StatefulSet' ? Number(p.name.split('-').pop()) >= fromOrdinal : true).slice(w.kind === 'StatefulSet' ? 0 : fromOrdinal);
  const scheduled = newPods.filter((p) => !p.unschedulable);
  const unsched = newPods.filter((p) => p.unschedulable);
  const steps: StepSpec[] = [];
  if (kind === 'deploy') {
    steps.push({ name: `Create ${w.kind} ${w.namespace}/${w.name}`, ms: s(0.7), logs: [
      `namespace/${w.namespace} ${clusterWorkloads(c.id).some((x) => x.namespace === w.namespace && x.id !== w.id) ? 'unchanged' : 'created'}`,
      `${w.kind.toLowerCase()}.apps/${w.name} created`, ...(w.kind === 'Deployment' ? [`replicaset.apps/${w.name}-${suffix(`${w.id}:rs:${w.revision ?? 1}`, 9)} created`] : []),
      ...(w.expose && w.expose !== 'none' ? [`service/${w.name} created (${w.expose}${w.ports.length ? `, ports ${w.ports.join(',')}` : ''})`] : []),
    ] });
  } else {
    steps.push({ name: `Scale ${w.namespace}/${w.name} to ${w.replicas}`, ms: s(0.5), logs: [`${w.kind.toLowerCase()}.apps/${w.name} scaled to ${w.replicas} replicas`] });
  }
  steps.push({ name: `Schedule ${newPods.length} pod${newPods.length === 1 ? '' : 's'}`, ms: s(0.8), logs: [
    ...scheduled.slice(0, 12).map((p) => `Successfully assigned ${p.namespace}/${p.name} to ${p.node}`),
    ...(unsched.length ? [`WARN FailedScheduling: ${unsched.length} pod(s) — ${unsched[0].reason}`] : []),
  ] });
  if (autoscaleOp) {
    const total = autoscaleOp.steps.reduce((a, x) => a + x.durationMs, 0);
    steps.push({ name: 'Wait for cluster autoscaler', ms: total + 300, logs: ['pods unschedulable on current nodes → TriggeredScaleUp', autoscaleOp.title, 'new nodes Ready, retrying scheduling'] });
  }
  const nodesUsed = [...new Set(scheduled.map((p) => p.node).filter(Boolean))] as string[];
  if (scheduled.length) steps.push({ name: `Pull image ${w.image.split('/').pop()}`, ms: s(1.4), logs: nodesUsed.slice(0, 6).flatMap((n, i) => [`${n}: Pulling image "${w.image}"`, `${n}: Successfully pulled image in ${(1.4 + ((hashString(n + w.image) % 300) / 100)).toFixed(3)}s (${80 + (hashString(w.image) % 400)} MB)${i ? ' (layer cache hit)' : ''}`]) });
  const podSteps: number[] = [];
  const groups = batches(scheduled.map((p, i) => ({ p, i })), Math.max(1, Math.ceil(scheduled.length / 6)));
  for (const g of groups) {
    const si = steps.length;
    for (const { p } of g) {
      const ord = w.kind === 'DaemonSet' ? pods.indexOf(p) : w.kind === 'StatefulSet' ? Number(p.name.split('-').pop()) - fromOrdinal : pods.indexOf(p) - fromOrdinal;
      podSteps[ord] = si;
    }
    steps.push({ name: g.length === 1 ? `Start ${g[0].p.name}` : `Start ${g.length} pods`, ms: s(0.9), logs: g.flatMap(({ p }) => [`Created container ${w.name} in ${p.name}`, `Started container ${w.name}`]) });
  }
  steps.push({ name: 'Readiness probes', ms: s(0.7), logs: [`${scheduled.length}/${newPods.length} new pods ready`, ...(unsched.length ? [`${unsched.length} pod(s) Pending: insufficient capacity`] : ['rollout complete'])] });
  // StatefulSet / Deployment ordinals not scheduled fall back to the last step
  const fallback = steps.length - 1;
  const overlay: PodOverlay = { workloadId: w.id, mode: 'rollout', steps: Array.from({ length: podSteps.length }, (_, i) => podSteps[i] ?? fallback), step: fallback, fromOrdinal: w.kind === 'DaemonSet' ? 0 : fromOrdinal };
  return startOperation({
    type: kind === 'deploy' ? 'k8s.workload.deploy' : 'k8s.workload.scale', title: kind === 'deploy' ? `Deploy ${w.namespace}/${w.name}` : `Scale ${w.namespace}/${w.name} to ${w.replicas}`,
    target: { type: 'k8s', id: c.id, name: c.name }, steps, scope: scopeOf(c), actor: ctx.actor, silent: true,
    onComplete: 'k8s.workloadReady', payload: { id: c.id, workloadId: w.id, pods: [overlay] } satisfies OpPayload & { workloadId: string },
  });
}

onOperationComplete('k8s.workloadReady', (_op, p: { workloadId: string; patch?: Partial<K8sWorkload> }) => {
  const w = db.get<K8sWorkload>('k8sWorkloads', p.workloadId);
  if (w) db.update('k8sWorkloads', w.id, { status: 'Running', readyReplicas: (p.patch?.replicas ?? w.replicas), ...(p.patch ?? {}) } as any);
});
onOperationComplete('k8s.workloadDeleted', (_op, p: { workloadId: string }) => { db.remove('k8sWorkloads', p.workloadId) });

function workloadIdle(w: K8sWorkload) {
  const busy = db.find<Operation>('operations', (o) => o.status === 'running' && (o.completion?.payload as any)?.workloadId === w.id);
  if (busy) throw new ApiError(409, `${w.name} has a rollout in progress (${busy.title}). Wait for it to finish.`, 'invalid_state');
}
function clusterFor(w: K8sWorkload) {
  const c = db.get<K8sCluster>('k8sClusters', w.clusterId);
  if (!c) throw new ApiError(404, 'Cluster not found', 'not_found');
  if (c.status === 'deleting' || c.status === 'provisioning' || c.status === 'error') throw new ApiError(409, `Cluster ${c.name} is ${c.status}`, 'invalid_state');
  return c;
}

function validateWorkload(c: K8sCluster, body: any, exceptId?: string) {
  const kind = body.kind ?? 'Deployment';
  const ports: number[] = body.ports ?? [];
  const hasGpuPool = c.nodePools.some((p) => p.gpu);
  validate({
    name: nameError(body.name) || (clusterWorkloads(c.id).some((w) => w.namespace === (body.namespace ?? 'default') && w.name === body.name && w.id !== exceptId) && `${kind} ${body.namespace ?? 'default'}/${body.name} already exists`),
    namespace: !DNS_LABEL.test(body.namespace ?? 'default') ? 'Namespace must be a DNS label' : ['kube-system', 'kube-public', 'kube-node-lease'].includes(body.namespace) && !body.system && `${body.namespace} is reserved for system components`,
    kind: !['Deployment', 'StatefulSet', 'DaemonSet', 'CronJob'].includes(kind) && 'Unknown workload kind',
    image: (!body.image || /\s/.test(body.image)) ? 'Container image is required (e.g. nginx:1.27)' : c.addons.kyverno && (/:latest$/.test(body.image) || !/[:@]/.test(body.image.split('/').pop() ?? '')) && 'admission webhook "validate.kyverno.svc" denied the request: policy disallow-latest-tag — pin an explicit image tag',
    replicas: kind !== 'DaemonSet' && !(Number.isInteger(body.replicas ?? 1) && (body.replicas ?? 1) >= 0 && (body.replicas ?? 1) <= 200) && 'Replicas must be 0–200',
    cpuRequestM: !(Number.isFinite(body.cpuRequestM) && body.cpuRequestM >= 10 && body.cpuRequestM <= 64000) && 'CPU request must be 10m–64 cores',
    memRequestMi: !(Number.isFinite(body.memRequestMi) && body.memRequestMi >= 16 && body.memRequestMi <= 512 * 1024) && 'Memory request must be 16Mi–512Gi',
    ports: ports.some((p) => !(Number.isInteger(p) && p >= 1 && p <= 65535)) && 'Ports must be 1–65535',
    gpuPerPod: (body.gpuPerPod ?? 0) > 0 && !hasGpuPool && 'This cluster has no GPU node pool',
    schedule: kind === 'CronJob' && !(typeof body.schedule === 'string' && body.schedule.trim().split(/\s+/).length === 5) && 'Cron schedule needs 5 fields, e.g. "0 2 * * *"',
  });
}

/* ================================================================================================
 * Upgrades, add-ons, credentials
 * ============================================================================================== */

onOperationComplete('k8s.upgraded', (_op, p: { id: string; toVersion: string }) => {
  const c = db.get<K8sCluster>('k8sClusters', p.id);
  if (!c) return;
  db.update<K8sCluster>('k8sClusters', p.id, (x) => { x.version = p.toVersion; x.status = 'running'; x.nodePools.forEach((n) => { n.status = 'ready'; delete n.version }); return x });
  // system images follow the cluster version
  for (const w of clusterWorkloads(c.id).filter((w) => w.name === 'kube-proxy')) db.update('k8sWorkloads', w.id, { image: `registry.k8s.io/kube-proxy:v${k8sPatch(p.toVersion)}` } as any);
  setTimeout(() => maybeAutoscale(p.id), 0);
});
onOperationComplete('k8s.upgradeFailed', (_op, p: { id: string }) => {
  if (db.get('k8sClusters', p.id)) db.update<K8sCluster>('k8sClusters', p.id, (x) => { x.status = 'degraded'; x.nodePools.forEach((n) => (n.status = 'ready')); return x });
});
onOperationComplete('k8s.addonInstalled', (_op, p: { id: string; addon: string }) => {
  const c = db.get<K8sCluster>('k8sClusters', p.id);
  if (!c) return;
  db.update<K8sCluster>('k8sClusters', p.id, (x) => { x.addons = { ...x.addons, [p.addon]: true }; return x });
  for (const w of clusterWorkloads(c.id).filter((w) => w.managedBy === p.addon)) db.update('k8sWorkloads', w.id, { status: 'Running', readyReplicas: w.replicas } as any);
});
onOperationComplete('k8s.addonRemoved', (_op, p: { id: string; addon: string; workloadIds: string[] }) => {
  for (const id of p.workloadIds) db.remove('k8sWorkloads', id);
  if (db.get('k8sClusters', p.id)) db.update<K8sCluster>('k8sClusters', p.id, (x) => { x.addons = { ...x.addons, [p.addon]: false }; return x });
});
onOperationComplete('k8s.rotated', (_op, p: { id: string }) => {
  const c = db.get<K8sCluster>('k8sClusters', p.id);
  if (c) db.update('k8sClusters', p.id, { credentialsRotatedAt: nowIso(), credentialGeneration: (c.credentialGeneration ?? 1) + 1 } as any);
});
onOperationComplete('k8s.deleted', (_op, p: { id: string }) => {
  for (const w of clusterWorkloads(p.id)) db.remove('k8sWorkloads', w.id);
  db.remove('k8sClusters', p.id);
  bindings.delete(p.id);
  topoCache.delete(p.id);
});

/* ================================================================================================
 * kubeconfig
 * ============================================================================================== */

function fakeB64(seed: string, len: number, prefix = '') {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const r = mulberry32(hashString(seed));
  let out = prefix;
  while (out.length < len) out += chars[Math.floor(r() * 64)];
  return out + '==';
}

export function kubeconfig(c: K8sCluster, mode: 'admin' | 'oidc' = 'admin') {
  const gen = c.credentialGeneration ?? 1;
  const user = mode === 'oidc' ? `oidc@${c.name}` : `${c.name}-admin`;
  const lines = [
    'apiVersion: v1',
    'kind: Config',
    'clusters:',
    '- cluster:',
    `    certificate-authority-data: ${fakeB64(`${c.id}:ca`, 220, 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUM')}`,
    `    server: ${c.controlPlane.endpoint}`,
    `  name: ${c.name}`,
    'contexts:',
    '- context:',
    `    cluster: ${c.name}`,
    `    user: ${user}`,
    '    namespace: default',
    `  name: ${c.name}`,
    `current-context: ${c.name}`,
    'preferences: {}',
    'users:',
    `- name: ${user}`,
    '  user:',
  ];
  if (mode === 'oidc' && c.oidcConfig) {
    lines.push(
      '    exec:',
      '      apiVersion: client.authentication.k8s.io/v1beta1',
      '      command: kubectl',
      '      args:',
      '      - oidc-login',
      '      - get-token',
      `      - --oidc-issuer-url=${c.oidcConfig.issuerUrl}`,
      `      - --oidc-client-id=${c.oidcConfig.clientId}`,
      '      - --oidc-extra-scope=email',
      '      - --oidc-extra-scope=groups',
      '      interactiveMode: IfAvailable',
      '      provideClusterInfo: false',
    );
  } else {
    lines.push(
      `    client-certificate-data: ${fakeB64(`${c.id}:crt:${gen}`, 180, 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSURJ')}`,
      `    client-key-data: ${fakeB64(`${c.id}:key:${gen}`, 160, 'LS0tLS1CRUdJTiBFQyBQUklWQVRFIEtFWS0tLS0tCk1IY0')}`,
    );
  }
  const issued = Date.parse(c.credentialsRotatedAt ?? c.createdAt);
  return {
    yaml: lines.join('\n') + '\n',
    filename: `${c.name}-kubeconfig.yaml`,
    mode,
    user,
    issuedAt: new Date(issued).toISOString(),
    expiresAt: mode === 'oidc' ? null : new Date(issued + 365 * 86_400_000).toISOString(),
    generation: gen,
  };
}

/* ================================================================================================
 * Decorators
 * ============================================================================================== */

function controlPlaneVersion(c: K8sCluster) {
  const op = clusterOps(c.id).find((o) => o.type === 'k8s.upgrade');
  const p = op?.completion?.payload as OpPayload | undefined;
  if (op && p?.toVersion && p.cpStep != null && stepStatus(op, p.cpStep) === 'done') return p.toVersion;
  return c.version;
}

function healthOf(c: K8sCluster, summary: K8sClusterSummary): NonNullable<K8sCluster['health']> {
  const prov = c.status === 'provisioning';
  const st = (ok: boolean): 'healthy' | 'pending' => (prov ? 'pending' : ok ? 'healthy' : 'pending');
  const cps = c.controlPlane.ha ? 3 : 1;
  const upgrading = c.status === 'upgrading';
  return [
    { component: 'kube-apiserver', status: c.status === 'error' ? 'down' : st(true), detail: `${cps}/${cps} replicas${upgrading ? ' · rolling upgrade' : ''}` },
    { component: 'etcd', status: c.status === 'error' ? 'down' : st(true), detail: cps > 1 ? 'quorum 3/3 · leader cp-0' : 'single member (no HA)' },
    { component: 'kube-scheduler', status: st(true), detail: 'leader elected' },
    { component: 'kube-controller-manager', status: st(true), detail: 'leader elected' },
    { component: 'CoreDNS', status: st(true), detail: '2/2 ready' },
    { component: `CNI (${c.cni})`, status: st(true), detail: `${summary.readyNodes}/${summary.nodes} agents` },
    { component: 'Nodes', status: prov ? 'pending' : summary.readyNodes < summary.nodes ? 'degraded' : 'healthy', detail: `${summary.readyNodes}/${summary.nodes} Ready` },
    { component: 'Scheduling', status: prov ? 'pending' : summary.pendingPods ? 'degraded' : 'healthy', detail: summary.pendingPods ? `${summary.pendingPods} pod(s) unschedulable` : 'all pods placed' },
  ];
}

function decorateCluster(c: K8sCluster): K8sCluster {
  const topo = computeTopology(c);
  const next = k8sNextVersion(c.version);
  return {
    ...c,
    monthlyCost: k8sMonthly({ ...c, nodePools: c.nodePools.map((p) => ({ ...p, count: p.targetCount ?? p.count })) }),
    summary: topo.summary,
    upgradeAvailable: next,
    controlPlaneVersion: controlPlaneVersion(c),
    health: healthOf(c, topo.summary),
  };
}

function decorateWorkload(w: K8sWorkload): K8sWorkload {
  const c = db.get<K8sCluster>('k8sClusters', w.clusterId);
  if (!c) return w;
  const pods = computeTopology(c).pods.filter((p) => p.workloadId === w.id);
  if (w.kind === 'CronJob') return { ...w, pendingPods: 0 };
  const running = pods.filter((p) => p.status === 'Running').length;
  const pending = pods.filter((p) => p.unschedulable).length;
  const replicas = w.kind === 'DaemonSet' ? pods.length : w.replicas;
  const busy = db.find<Operation>('operations', (o) => o.status === 'running' && (o.completion?.payload as any)?.workloadId === w.id);
  let status: K8sWorkload['status'] = w.status;
  if (w.status !== 'Terminating') {
    if (busy) status = 'Progressing';
    else if (replicas > 0 && running === 0 && pending > 0) status = 'Pending';
    else if (running < replicas) status = 'Degraded';
    else status = 'Running';
  }
  return { ...w, replicas, readyReplicas: running, pendingPods: pending, status };
}

/* ================================================================================================
 * Registration
 * ============================================================================================== */

function clusterInScope(ctx: Ctx): K8sCluster {
  const c = getOr404<K8sCluster>('k8sClusters', ctx.params.id, 'Kubernetes cluster');
  if (c.accountId !== ctx.scope.accountId) throw new ApiError(404, `Kubernetes cluster ${ctx.params.id} not found`, 'not_found');
  return c;
}

export function registerK8s() {
  defineCollection<K8sCluster>({
    name: 'k8sClusters', kind: 'k8s', idPrefix: 'k8s',
    searchText: (c) => `${c.id} ${c.name} ${c.version} ${c.locationId} ${c.cni} ${c.status} ${c.tags.map((t) => `${t.key}:${t.value}`).join(' ')}`,
    subtitle: (c) => `Kubernetes ${c.version} · ${c.nodePools.reduce((a, p) => a + p.count, 0)} nodes · ${c.status}`,
    decorate: decorateCluster,
    create: createCluster,
    afterCreate: afterCreateCluster,
    update: (_ctx, c, patch) => {
      const allowed: (keyof K8sCluster)[] = ['tags', 'autoUpgrade', 'maintenanceWindow', 'oidc', 'oidcConfig', 'apiAllowlist', 'privateEndpoint', 'deletionProtection'];
      const next: any = { ...c };
      for (const k of allowed) if (k in patch) next[k] = patch[k];
      if ('tags' in patch) checkRequiredTags(c.projectId, patch.tags);
      if (next.oidc) validate({ oidcConfig: !(next.oidcConfig?.issuerUrl ?? '').startsWith('https://') ? 'OIDC issuer URL must start with https://' : !next.oidcConfig?.clientId && 'Client ID is required' });
      if ('apiAllowlist' in patch) validate({ apiAllowlist: (patch.apiAllowlist as string[]).find((x) => !isValidCidr(x)) && `Invalid CIDR ${(patch.apiAllowlist as string[]).find((x) => !isValidCidr(x))}` });
      if ('maintenanceWindow' in patch) validate({ maintenanceWindow: !(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(patch.maintenanceWindow?.day) && patch.maintenanceWindow.hour >= 0 && patch.maintenanceWindow.hour <= 23) && 'Pick a day and an hour 0–23' });
      return next;
    },
    remove: (ctx, c) => {
      if (c.deletionProtection) throw new ApiError(409, 'Deletion protection is enabled for this cluster. Disable it in Settings first.', 'protected');
      if (c.status === 'deleting') throw new ApiError(409, 'Cluster is already being deleted', 'invalid_state');
      const nodes = c.nodePools.reduce((a, p) => a + p.count, 0);
      const wls = clusterWorkloads(c.id);
      db.update('k8sClusters', c.id, { status: 'deleting' } as any);
      startOperation({
        type: 'k8s.delete', title: `Delete Kubernetes cluster ${c.name}`, target: { type: 'k8s', id: c.id, name: c.name }, scope: scopeOf(c), actor: ctx.actor,
        steps: [
          { name: 'Delete workloads & load balancers', ms: s(1.2), logs: [`deleting ${wls.length} workloads in ${new Set(wls.map((w) => w.namespace)).size} namespaces`, ...wls.filter((w) => w.expose === 'LoadBalancer').map((w) => `released load balancer for service ${w.namespace}/${w.name}`)] },
          { name: 'Release persistent volumes', ms: s(0.8), logs: ['PVCs with reclaimPolicy=Delete removed', 'retained PVs kept as volumes'] },
          { name: `Delete ${c.nodePools.length} node pool${c.nodePools.length > 1 ? 's' : ''} (${nodes} nodes)`, ms: s(1.6), logs: c.nodePools.map((p) => `node pool ${p.name}: ${p.count} instances terminated`) },
          { name: 'Remove control plane & etcd', ms: s(1.2), logs: ['final etcd snapshot retained for 7 days', 'control-plane VMs deleted', 'API endpoint DNS record removed'] },
        ],
        onComplete: 'k8s.deleted', payload: { id: c.id },
      });
      return 'async';
    },
    actions: {
      addNodePool: (ctx, c, body) => {
        requireIdle(c, 'add a node pool');
        if (c.nodePools.length >= 10) throw new ApiError(422, 'A cluster can have at most 10 node pools', 'validation_failed');
        const pool: NodePool = { ...resolvePool(body, c.nodePools, 'pool'), version: c.version };
        db.update<K8sCluster>('k8sClusters', c.id, (x) => { x.nodePools.push({ ...pool, readyCount: 0 }); x.status = 'scaling'; return x });
        const fresh = db.get<K8sCluster>('k8sClusters', c.id)!;
        const steps: StepSpec[] = [{ name: `Create node pool ${pool.name}`, ms: s(0.8), logs: [`${pool.count}× ${pool.vcpus} vCPU / ${pool.ramGB} GB${pool.gpu ? ` / ${pool.gpu.count}× ${pool.gpu.model}` : ''}, disk ${pool.diskGB} GB`, pool.autoscale.enabled ? `autoscaling ${pool.autoscale.min}–${pool.autoscale.max}` : 'fixed size'] }];
        const nodeSteps: Record<string, number> = {};
        joinSteps(fresh, pool, 0, pool.count, nodeSteps, steps);
        if (pool.gpu && !c.addons.gpuOperator) steps.push({ name: 'Label GPU nodes', ms: s(0.4), logs: ['nvidia.com/gpu.present=true applied', 'hint: install the NVIDIA GPU Operator add-on to expose GPUs to pods'] });
        startOperation({ type: 'k8s.addNodePool', title: `Add node pool ${pool.name} to ${c.name}`, target: { type: 'k8s', id: c.id, name: c.name }, steps, scope: scopeOf(c), actor: ctx.actor, onComplete: 'k8s.poolReady', onFail: 'k8s.poolOpFailed', payload: { id: c.id, poolId: pool.id, nodeSteps } });
        return decorateCluster(db.get<K8sCluster>('k8sClusters', c.id)!);
      },
      updateNodePool: (ctx, c, body) => {
        const p = poolOr404(c, body.poolId);
        const patch: Partial<NodePool> = {};
        if (body.labels) patch.labels = body.labels;
        if (body.taints) {
          const bad = (body.taints as string[]).find((t) => !/^[a-z0-9A-Z./-]+(=[\w.-]*)?:(NoSchedule|PreferNoSchedule|NoExecute)$/.test(t));
          validate({ taints: bad && `Invalid taint "${bad}" — use key=value:NoSchedule` });
          patch.taints = body.taints;
        }
        if (body.upgradeSettings) patch.upgradeSettings = { maxSurge: Math.max(0, Math.min(5, body.upgradeSettings.maxSurge ?? 1)), maxUnavailable: Math.max(0, Math.min(5, body.upgradeSettings.maxUnavailable ?? 0)) };
        let count: number = body.count ?? p.count;
        if (body.autoscale) {
          const a = { enabled: !!body.autoscale.enabled, min: body.autoscale.min ?? p.autoscale.min, max: body.autoscale.max ?? p.autoscale.max };
          validate({ autoscale: a.enabled && (a.min < 0 || a.max > 100 || a.min > a.max) && 'Autoscale needs 0 ≤ min ≤ max ≤ 100' });
          patch.autoscale = a;
          if (a.enabled && body.count == null) count = Math.min(a.max, Math.max(a.min, p.count));
        }
        validate({ count: !(Number.isInteger(count) && count >= 0 && count <= 100) && 'Node count must be 0–100' });
        const a = patch.autoscale ?? p.autoscale;
        if (a.enabled && (count < a.min || count > a.max)) throw new ApiError(422, `Count ${count} is outside the autoscaling range ${a.min}–${a.max}`, 'validation_failed', { count: `Must be within ${a.min}–${a.max}` });
        const otherNodes = c.nodePools.filter((x) => x.id !== p.id).reduce((s2, x) => s2 + x.count, 0);
        if (count + otherNodes < 1) throw new ApiError(422, 'The cluster needs at least one node', 'validation_failed', { count: 'At least one node in the cluster' });
        if (count !== p.count) requireIdle(c, 'scale a node pool');
        if (Object.keys(patch).length) db.update<K8sCluster>('k8sClusters', c.id, (x) => { Object.assign(x.nodePools.find((n) => n.id === p.id)!, patch); return x });
        if (count !== p.count) {
          const fresh = db.get<K8sCluster>('k8sClusters', c.id)!;
          scalePool(fresh, fresh.nodePools.find((n) => n.id === p.id)!, count, ctx.actor);
        }
        topoCache.delete(c.id);
        return decorateCluster(db.get<K8sCluster>('k8sClusters', c.id)!);
      },
      removeNodePool: (ctx, c, body) => {
        requireIdle(c, 'remove a node pool');
        const p = poolOr404(c, body.poolId);
        if (c.nodePools.length === 1) throw new ApiError(409, 'Cannot remove the last node pool. Delete the cluster instead.', 'conflict');
        if (c.nodePools.filter((x) => x.id !== p.id).reduce((a, x) => a + x.count, 0) < 1) throw new ApiError(409, 'The remaining pools have no nodes. Scale another pool up first.', 'conflict');
        const steps: StepSpec[] = [];
        const drain: Record<string, number> = {};
        drainSteps(c, p, Array.from({ length: p.count }, (_, i) => p.count - 1 - i), drain, steps);
        steps.push({ name: `Delete node pool ${p.name}`, ms: s(0.6), logs: ['instance group deleted', 'pool removed from cluster autoscaler'] });
        db.update<K8sCluster>('k8sClusters', c.id, (x) => { x.nodePools.find((n) => n.id === p.id)!.status = 'draining'; x.status = 'scaling'; return x });
        startOperation({ type: 'k8s.removeNodePool', title: `Remove node pool ${p.name} from ${c.name}`, target: { type: 'k8s', id: c.id, name: c.name }, steps, scope: scopeOf(c), actor: ctx.actor, onComplete: 'k8s.poolRemoved', onFail: 'k8s.poolOpFailed', payload: { id: c.id, poolId: p.id, drainSteps: drain } });
      },
      upgrade: (ctx, c, body) => {
        requireIdle(c, 'upgrade');
        const next = k8sNextVersion(c.version);
        if (!next) throw new ApiError(409, `${c.version} is already the latest supported version`, 'conflict');
        if (body.version !== next) throw new ApiError(422, `Kubernetes can only be upgraded one minor version at a time: ${c.version} → ${next}`, 'validation_failed', { version: `Next version is ${next}` });
        const patch = k8sPatch(next);
        const wls = clusterWorkloads(c.id);
        const steps: StepSpec[] = [
          { name: 'Pre-flight checks', ms: s(1), logs: [`scanning ${wls.length} workloads for APIs removed in ${next}`, 'no removed APIs in use', `PodDisruptionBudgets: ${wls.filter((w) => w.replicas > 1).length} workloads protected`, 'node pools healthy'] },
          { name: 'Snapshot etcd', ms: s(0.9), logs: [`etcdctl snapshot save → s3://autark-etcd-backups/${c.id}/pre-${next}.db`, `snapshot ${(4 + wls.length * 0.6).toFixed(1)} MB, sha256 verified`] },
          { name: `Upgrade control plane to v${patch}`, ms: s(c.controlPlane.ha ? 2.6 : 1.8), logs: c.controlPlane.ha ? ['cp-2: kube-apiserver replaced', 'cp-1: kube-apiserver replaced', 'cp-0: kube-apiserver replaced (leader moved)', 'controller-manager & scheduler upgraded'] : ['kube-apiserver restarted on new version (API briefly unavailable ~20s)', 'controller-manager & scheduler upgraded'] },
          { name: 'Upgrade system components', ms: s(1), logs: ['CoreDNS 1.11.3', `${c.cni} agent rolled`, c.cni !== 'cilium' ? `kube-proxy v${patch}` : 'cilium kube-proxy replacement unchanged', 'konnectivity-agent updated'] },
        ];
        const cpStep = 2;
        const upgradeSteps: Record<string, number> = {};
        for (const p of c.nodePools) {
          const surge = Math.max(1, p.upgradeSettings?.maxSurge ?? 1);
          const idx = Array.from({ length: p.count }, (_, i) => i);
          for (const group of batches(idx, surge)) {
            const si = steps.length;
            const names = group.map((i) => nodeName(c, p, i));
            group.forEach((i) => (upgradeSteps[nodeKey(p, i)] = si));
            steps.push({ name: `${p.name}: surge-replace ${names.length > 1 ? `${names.length} nodes` : names[0]}`, ms: s(1.6 + 0.3 * group.length), logs: names.flatMap((n) => [`surge node for ${n} joined (kubelet v${patch})`, `node/${n} cordoned`, `evicting pods from ${n} (respecting PDBs)`, `node/${n} removed`]) });
          }
        }
        steps.push({ name: 'Post-upgrade validation', ms: s(0.8), logs: ['all nodes Ready', `server version v${patch}`, 'conformance smoke tests passed'] });
        db.update<K8sCluster>('k8sClusters', c.id, (x) => { x.status = 'upgrading'; x.nodePools.forEach((n) => (n.status = 'upgrading')); return x });
        startOperation({
          type: 'k8s.upgrade', title: `Upgrade ${c.name} ${c.version} → ${next}`, target: { type: 'k8s', id: c.id, name: c.name }, steps, scope: scopeOf(c), actor: ctx.actor,
          onComplete: 'k8s.upgraded', onFail: 'k8s.upgradeFailed', payload: { id: c.id, toVersion: next, cpStep, upgradeSteps } satisfies OpPayload,
        });
      },
      installAddon: (ctx, c, body) => {
        requireIdle(c, 'install add-ons');
        const addon = K8S_ADDONS.find((a) => a.id === body.addon);
        if (!addon) throw new ApiError(404, `Unknown add-on ${body.addon}`, 'not_found');
        if (c.addons[addon.id]) throw new ApiError(409, `${addon.name} is already installed`, 'conflict');
        if (addon.id === 'gpuOperator' && !c.nodePools.some((p) => p.gpu)) throw new ApiError(409, 'The NVIDIA GPU Operator needs a GPU node pool. Add one first.', 'conflict');
        for (const r of addon.requires ?? []) if (!c.addons[r]) throw new ApiError(409, `${addon.name} requires ${r}`, 'conflict');
        if (clusterOps(c.id).some((o) => o.type === 'k8s.installAddon' || o.type === 'k8s.uninstallAddon')) throw new ApiError(409, 'Another add-on change is in progress', 'invalid_state');
        const created = addonWorkloads(c, addon.id, 'Progressing');
        startOperation({
          type: 'k8s.installAddon', title: `Install ${addon.name} on ${c.name}`, target: { type: 'k8s', id: c.id, name: c.name }, scope: scopeOf(c), actor: ctx.actor, silent: true,
          steps: [
            { name: 'Render Helm chart', ms: s(0.8), logs: [`chart ${addon.id} ${addon.version}`, `values: autark defaults for ${c.locationId}`] },
            { name: 'Apply manifests', ms: s(1), logs: [`namespace/${addon.namespace} configured`, ...addon.workloads.map((w) => `${w.kind.toLowerCase()}.apps/${w.name} created`)] },
            { name: 'Wait for rollout', ms: s(1.6), logs: [...addon.workloads.map((w) => `${w.name}: rollout complete`), `${addon.name} ready`] },
          ],
          onComplete: 'k8s.addonInstalled', payload: { id: c.id, addon: addon.id, pods: created.map((w) => ({ workloadId: w.id, mode: 'rollout', step: 2 })) } satisfies OpPayload & { addon: string },
        });
      },
      uninstallAddon: (ctx, c, body) => {
        const addon = K8S_ADDONS.find((a) => a.id === body.addon);
        if (!addon) throw new ApiError(404, `Unknown add-on ${body.addon}`, 'not_found');
        if (!c.addons[addon.id]) throw new ApiError(409, `${addon.name} is not installed`, 'conflict');
        if (clusterOps(c.id).some((o) => o.type === 'k8s.installAddon' || o.type === 'k8s.uninstallAddon')) throw new ApiError(409, 'Another add-on change is in progress', 'invalid_state');
        const wls = clusterWorkloads(c.id).filter((w) => w.managedBy === addon.id || addon.workloads.some((aw) => aw.namespace === w.namespace && aw.name === w.name));
        for (const w of wls) db.update('k8sWorkloads', w.id, { status: 'Terminating' } as any);
        startOperation({
          type: 'k8s.uninstallAddon', title: `Remove ${addon.name} from ${c.name}`, target: { type: 'k8s', id: c.id, name: c.name }, scope: scopeOf(c), actor: ctx.actor, silent: true,
          steps: [
            { name: 'helm uninstall', ms: s(1), logs: wls.map((w) => `${w.kind.toLowerCase()}.apps/${w.name} deleted`) },
            { name: 'Clean up CRDs & namespace', ms: s(0.8), logs: [`namespace/${addon.namespace} ${addon.namespace === 'kube-system' ? 'kept' : 'deleted'}`] },
          ],
          onComplete: 'k8s.addonRemoved', payload: { id: c.id, addon: addon.id, workloadIds: wls.map((w) => w.id), pods: wls.map((w) => ({ workloadId: w.id, mode: 'delete' })) } satisfies OpPayload & { addon: string; workloadIds: string[] },
        });
      },
      rotateCredentials: (ctx, c) => {
        requireIdle(c, 'rotate credentials');
        startOperation({
          type: 'k8s.rotateCredentials', title: `Rotate credentials for ${c.name}`, target: { type: 'k8s', id: c.id, name: c.name }, scope: scopeOf(c), actor: ctx.actor,
          steps: [
            { name: 'Issue new cluster CA bundle', ms: s(0.8), logs: ['new CA generated (ECDSA P-256)', 'trust bundle = old + new CA'] },
            { name: 'Rotate service-account signing key', ms: s(0.8), logs: ['new SA key added to kube-apiserver --service-account-key-file', 'existing tokens remain valid during grace period'] },
            { name: 'Restart control plane & kubelets', ms: s(1.6), logs: ['kube-apiserver restarted', `${c.nodePools.reduce((a, p) => a + p.count, 0)} kubelets re-bootstrapped`] },
            { name: 'Revoke previous admin credentials', ms: s(0.6), logs: [`client cert generation ${c.credentialGeneration ?? 1} revoked`, 'download a fresh kubeconfig'] },
          ],
          onComplete: 'k8s.rotated', payload: { id: c.id },
        });
      },
    },
  });

  defineCollection<K8sWorkload>({
    name: 'k8sWorkloads', kind: 'k8sWorkload', idPrefix: 'wl',
    searchText: (w) => `${w.id} ${w.namespace}/${w.name} ${w.name} ${w.image} ${w.kind}`,
    subtitle: (w) => `${w.kind} · ${w.namespace} · ${db.get<K8sCluster>('k8sClusters', w.clusterId)?.name ?? w.clusterId}`,
    link: (w) => `/managed-services/kubernetes/${w.clusterId}?tab=workloads&q=${encodeURIComponent(w.name)}`,
    decorate: decorateWorkload,
    sort: (a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name),
    create: (_ctx, body) => {
      const c = getOr404<K8sCluster>('k8sClusters', body.clusterId ?? '', 'Kubernetes cluster');
      if (c.status !== 'running' && c.status !== 'scaling' && c.status !== 'upgrading' && c.status !== 'degraded') throw new ApiError(409, `Cannot deploy to a cluster that is ${c.status}`, 'invalid_state');
      validateWorkload(c, body);
      const kind: K8sWorkload['kind'] = body.kind ?? 'Deployment';
      return {
        id: newId('wl'), clusterId: c.id, ...scopeOf(c), namespace: body.namespace ?? 'default', name: body.name, kind, image: body.image.trim(),
        replicas: kind === 'DaemonSet' ? 0 : kind === 'CronJob' ? 1 : body.replicas ?? 1, readyReplicas: 0, cpuRequestM: body.cpuRequestM, memRequestMi: body.memRequestMi,
        ports: body.ports ?? [], status: 'Progressing', createdAt: nowIso(), tags: body.tags ?? [], gpuPerPod: body.gpuPerPod || undefined, tolerations: body.tolerations?.length ? body.tolerations : (body.gpuPerPod ? ['nvidia.com/gpu'] : undefined),
        nodeSelector: body.nodeSelector?.length ? body.nodeSelector : undefined, schedule: kind === 'CronJob' ? body.schedule.trim() : undefined, revision: 1, env: body.env ?? [], expose: body.expose ?? 'none', managedBy: null,
      } satisfies K8sWorkload;
    },
    afterCreate: (ctx, w) => {
      const c = db.get<K8sCluster>('k8sClusters', w.clusterId)!;
      audit(ctx, 'k8s.deployWorkload', { type: 'k8s', id: c.id, name: c.name }, { ...scopeOf(c), details: `${w.kind} ${w.namespace}/${w.name} (${w.image}, ${w.replicas}× ${w.cpuRequestM}m/${w.memRequestMi}Mi)` });
      if (w.kind === 'CronJob') {
        startOperation({ type: 'k8s.workload.deploy', title: `Create CronJob ${w.namespace}/${w.name}`, target: { type: 'k8s', id: c.id, name: c.name }, scope: scopeOf(c), actor: ctx.actor, silent: true,
          steps: [{ name: `Create CronJob ${w.namespace}/${w.name}`, ms: s(0.6), logs: [`cronjob.batch/${w.name} created`] }, { name: 'Register schedule', ms: s(0.5), logs: [`schedule "${w.schedule}" (UTC)`, 'next run computed'] }],
          onComplete: 'k8s.workloadReady', payload: { id: c.id, workloadId: w.id } });
        return;
      }
      const as = maybeAutoscale(c.id);
      startRollout(ctx, c, w, 'deploy', 0, as?.op);
      if (as) {
        db.update('k8sWorkloads', w.id, { deployNote: as.note } as any);
        notify(as.op ? 'info' : 'warning', as.op ? 'Cluster autoscaler triggered' : `Pods pending in ${c.name}`, as.note, `/managed-services/kubernetes/${c.id}?tab=nodes`, c.accountId);
      }
    },
    update: (_ctx, w, patch) => {
      const next: any = { ...w };
      for (const k of ['tags', 'env'] as const) if (k in patch) next[k] = patch[k];
      return next;
    },
    remove: (ctx, w) => {
      if (w.managedBy) throw new ApiError(409, `${w.name} is managed by the ${K8S_ADDONS.find((a) => a.id === w.managedBy)?.name ?? w.managedBy} add-on. Uninstall the add-on instead.`, 'managed');
      if (w.namespace === 'kube-system') throw new ApiError(409, 'System workloads in kube-system cannot be deleted from the console', 'protected');
      if (w.status === 'Terminating') throw new ApiError(409, 'Workload is already being deleted', 'invalid_state');
      const c = db.get<K8sCluster>('k8sClusters', w.clusterId);
      db.update('k8sWorkloads', w.id, { status: 'Terminating' } as any);
      if (!c) return 'deleted';
      audit(ctx, 'k8s.deleteWorkload', { type: 'k8s', id: c.id, name: c.name }, { ...scopeOf(c), details: `${w.kind} ${w.namespace}/${w.name}` });
      startOperation({
        type: 'k8s.workload.delete', title: `Delete ${w.namespace}/${w.name}`, target: { type: 'k8s', id: c.id, name: c.name }, scope: scopeOf(c), actor: ctx.actor, silent: true,
        steps: [
          { name: `Delete ${w.kind} ${w.name}`, ms: s(0.5), logs: [`${w.kind.toLowerCase()}.apps "${w.name}" deleted`, ...(w.expose && w.expose !== 'none' ? [`service "${w.name}" deleted`] : [])] },
          { name: 'Terminate pods (grace period 30s)', ms: s(1.4), logs: podNamesFor(c, w).slice(0, 10).map((p) => `pod "${p.name}" terminated`) },
        ],
        onComplete: 'k8s.workloadDeleted', payload: { id: c.id, workloadId: w.id, pods: [{ workloadId: w.id, mode: 'delete' }] } satisfies OpPayload & { workloadId: string },
      });
      return 'async';
    },
    actions: {
      scale: (ctx, w, body) => {
        if (w.kind === 'DaemonSet' || w.kind === 'CronJob') throw new ApiError(409, `A ${w.kind} cannot be scaled`, 'invalid_state');
        const c = clusterFor(w);
        workloadIdle(w);
        const replicas = body.replicas;
        validate({ replicas: !(Number.isInteger(replicas) && replicas >= 0 && replicas <= 200) && 'Replicas must be 0–200' });
        if (replicas === w.replicas) return decorateWorkload(w);
        audit(ctx, 'k8s.scaleWorkload', { type: 'k8s', id: c.id, name: c.name }, { ...scopeOf(c), details: `${w.namespace}/${w.name}: ${w.replicas} → ${replicas}` });
        if (replicas > w.replicas) {
          const from = w.replicas;
          db.update('k8sWorkloads', w.id, { replicas, status: 'Progressing', deployNote: null } as any);
          const as = maybeAutoscale(c.id);
          startRollout(ctx, c, db.get<K8sWorkload>('k8sWorkloads', w.id)!, 'scale', from, as?.op);
          if (as) db.update('k8sWorkloads', w.id, { deployNote: as.note } as any);
        } else {
          startOperation({
            type: 'k8s.workload.scale', title: `Scale ${w.namespace}/${w.name} to ${replicas}`, target: { type: 'k8s', id: c.id, name: c.name }, scope: scopeOf(c), actor: ctx.actor, silent: true,
            steps: [{ name: `Scale down ${w.replicas} → ${replicas}`, ms: s(0.5), logs: [`deployment.apps/${w.name} scaled`] }, { name: `Terminate ${w.replicas - replicas} pod${w.replicas - replicas > 1 ? 's' : ''}`, ms: s(1.2), logs: ['SIGTERM sent, waiting for graceful shutdown'] }],
            onComplete: 'k8s.workloadReady', payload: { id: c.id, workloadId: w.id, patch: { replicas, deployNote: null }, pods: [{ workloadId: w.id, mode: 'terminate', step: 1, fromOrdinal: replicas }] },
          });
        }
        return decorateWorkload(db.get<K8sWorkload>('k8sWorkloads', w.id)!);
      },
      restart: (ctx, w, body) => {
        if (w.kind === 'CronJob') throw new ApiError(409, 'CronJobs are not restarted — trigger a run instead', 'invalid_state');
        const c = clusterFor(w);
        workloadIdle(w);
        const image: string | undefined = body.image && body.image !== w.image ? body.image.trim() : undefined;
        if (image) validateWorkload(c, { ...w, image }, w.id);
        const all = podNamesFor(c, w);
        const pods = all.filter((p) => !p.unschedulable);
        const newRevision = (w.revision ?? 1) + 1;
        const steps: StepSpec[] = [{ name: image ? `Update image → ${image.split('/').pop()}` : 'Patch restartedAt annotation', ms: s(0.5), logs: [image ? `kubectl set image ${w.kind.toLowerCase()}/${w.name} ${w.name}=${image}` : `kubectl rollout restart ${w.kind.toLowerCase()}/${w.name}`, `revision ${newRevision}`] }];
        const podSteps: number[] = [];
        // StatefulSets roll in reverse ordinal order
        for (const p of w.kind === 'StatefulSet' ? [...pods].reverse() : pods) {
          podSteps[all.indexOf(p)] = steps.length;
          steps.push({ name: `Replace ${p.name}`, ms: s(1.1), logs: [`pod ${p.name} terminating`, `new pod started${image ? ` with ${image}` : ''}`, 'readiness probe passed'] });
        }
        const lastStep = steps.length - 1;
        db.update('k8sWorkloads', w.id, { status: 'Progressing' } as any);
        audit(ctx, 'k8s.restartWorkload', { type: 'k8s', id: c.id, name: c.name }, { ...scopeOf(c), details: `${w.namespace}/${w.name}${image ? ` → ${image}` : ''}` });
        startOperation({
          type: 'k8s.workload.restart', title: image ? `Roll out ${w.name} → ${image.split('/').pop()}` : `Rolling restart ${w.namespace}/${w.name}`, target: { type: 'k8s', id: c.id, name: c.name }, steps, scope: scopeOf(c), actor: ctx.actor, silent: true,
          onComplete: 'k8s.workloadReady', payload: { id: c.id, workloadId: w.id, patch: { revision: w.kind === 'StatefulSet' || w.kind === 'DaemonSet' ? w.revision ?? 1 : newRevision, restartedAt: nowIso(), ...(image ? { image } : {}), status: 'Running' }, pods: [{ workloadId: w.id, mode: 'restart', steps: Array.from({ length: all.length }, (_, i) => podSteps[i] ?? lastStep), newRevision: w.kind === 'Deployment' ? newRevision : undefined }] },
        });
        return decorateWorkload(db.get<K8sWorkload>('k8sWorkloads', w.id)!);
      },
    },
  });

  /* ---------------------------------------------------------------- derived views */
  route('GET', '/k8sClusters/:id/topology', (ctx) => computeTopology(clusterInScope(ctx)), 'Nodes, pods, events and capacity summary of a cluster');
  route('GET', '/k8sClusters/:id/nodes', (ctx) => { const t = computeTopology(clusterInScope(ctx)); return { items: t.nodes, total: t.nodes.length } }, 'Nodes derived from node pools');
  route('GET', '/k8sClusters/:id/pods', (ctx) => {
    const t = computeTopology(clusterInScope(ctx));
    let pods = t.pods;
    const ns = ctx.query.get('namespace'); if (ns) pods = pods.filter((p) => p.namespace === ns);
    const node = ctx.query.get('node'); if (node) pods = pods.filter((p) => p.node === node);
    return { items: pods, total: pods.length, events: t.events };
  }, 'Pods with scheduling status (?namespace=&node=)');
  route('GET', '/k8sClusters/:id/kubeconfig', (ctx) => {
    const c = clusterInScope(ctx);
    if (c.status === 'provisioning') throw new ApiError(409, 'The kubeconfig is available once the cluster is running', 'invalid_state');
    const mode = ctx.query.get('mode') === 'oidc' ? 'oidc' : 'admin';
    if (mode === 'oidc' && !c.oidc) throw new ApiError(409, 'OIDC is not enabled for this cluster', 'invalid_state');
    if (ctx.query.get('download') === '1') audit(ctx, 'k8s.kubeconfig', { type: 'k8s', id: c.id, name: c.name }, { ...scopeOf(c), details: `${mode} kubeconfig downloaded` });
    return kubeconfig(c, mode);
  }, 'Generate a kubeconfig (?mode=admin|oidc&download=1 to audit a download)');
  route('POST', '/k8sClusters/:id/simulate', (ctx) => {
    const c = clusterInScope(ctx);
    const body = ctx.body ?? {};
    let pools = c.nodePools.map((p) => ({ ...p, count: p.targetCount ?? p.count }));
    if (body.poolCounts) pools = pools.map((p) => (body.poolCounts[p.id] != null ? { ...p, count: body.poolCounts[p.id] } : p));
    if (body.removePoolId) pools = pools.filter((p) => p.id !== body.removePoolId);
    if (body.addPool) pools = [...pools, { ...resolvePool({ ...body.addPool, name: body.addPool.name || 'new-pool' }, [], 'pool'), status: 'ready' as const }];
    const extra: K8sWorkload[] = [];
    if (body.workload) {
      const w = body.workload;
      const existing = w.id ? db.get<K8sWorkload>('k8sWorkloads', w.id) : undefined;
      extra.push({
        ...(existing ?? {}), id: w.id ?? '__new__', clusterId: c.id, ...scopeOf(c), namespace: w.namespace ?? 'default', name: w.name || 'new-workload', kind: w.kind ?? 'Deployment', image: w.image ?? 'nginx',
        replicas: w.replicas ?? existing?.replicas ?? 1, readyReplicas: 0, cpuRequestM: w.cpuRequestM ?? existing?.cpuRequestM ?? 100, memRequestMi: w.memRequestMi ?? existing?.memRequestMi ?? 128, ports: [], status: 'Running',
        createdAt: existing?.createdAt ?? nowIso(), tags: [], gpuPerPod: w.gpuPerPod ?? existing?.gpuPerPod, tolerations: w.tolerations ?? existing?.tolerations ?? (w.gpuPerPod ? ['nvidia.com/gpu'] : undefined), nodeSelector: w.nodeSelector ?? existing?.nodeSelector,
      } as K8sWorkload);
    }
    const before = computeTopology(c, { simulate: true });
    const after = computeTopology(c, { simulate: true, pools, extraWorkloads: extra });
    const newPending = after.pods.filter((p) => p.unschedulable && (!body.workload || p.workloadId === (body.workload.id ?? '__new__')));
    // what would the autoscaler do?
    let autoscale: { poolId: string; poolName: string; from: number; to: number } | null = null;
    if (after.summary.pendingPods > before.summary.pendingPods && body.workload) {
      for (const p of pools.filter((x) => x.autoscale.enabled && x.count < x.autoscale.max)) {
        for (let n = p.count + 1; n <= p.autoscale.max; n++) {
          const t = computeTopology(c, { simulate: true, pools: pools.map((x) => (x.id === p.id ? { ...x, count: n } : x)), extraWorkloads: extra });
          if (t.summary.pendingPods <= before.summary.pendingPods) { if (!autoscale || n - p.count < autoscale.to - autoscale.from) autoscale = { poolId: p.id, poolName: p.name, from: p.count, to: n }; break }
        }
      }
    }
    return {
      before: before.summary, after: after.summary,
      pendingPods: after.summary.pendingPods, newlyPending: Math.max(0, after.summary.pendingPods - before.summary.pendingPods), workloadPending: newPending.length,
      reasons: [...new Set(after.pods.filter((p) => p.unschedulable).map((p) => p.reason))].slice(0, 3),
      autoscale,
      monthlyCost: k8sMonthly({ ...c, nodePools: pools }),
    };
  }, 'Dry-run the scheduler for a pool / workload change');
  route('GET', '/k8s/catalog', () => ({ versions: K8S_VERSIONS, nodePresets: K8S_NODE_PRESETS, addons: K8S_ADDONS, cnis: ['cilium', 'calico', 'flannel'] }), 'Kubernetes versions, node sizes and add-ons');

  /* ---------------------------------------------------------------- metrics */
  registerMetrics('k8s', (c: K8sCluster, metric) => {
    const off = c.status === 'provisioning' || c.status === 'deleting' || c.status === 'error';
    const t = computeTopology(c).summary;
    switch (metric) {
      case 'cpu': return { unit: '%', base: Math.max(3, t.cpuRequestedPct * 62), amp: 9, max: 100, diurnal: 0.25, spikiness: 0.3, off };
      case 'memory': return { unit: '%', base: Math.max(5, t.memRequestedPct * 82), amp: 4, max: 100, off };
      case 'pods': return { unit: 'pods', base: t.runningPods, amp: 0.4, off };
      case 'pending': return { unit: 'pods', base: t.pendingPods, amp: 0, off };
      case 'apiLatency': return { unit: 'ms', base: c.controlPlane.ha ? 22 : 34, amp: 9, spikiness: 0.45, off };
      case 'apiRequests': return { unit: 'req/s', base: 25 + t.pods * 1.6, amp: 12, diurnal: 0.3, off };
      case 'netIn': return { unit: 'Mbit/s', base: 30 + t.runningPods * 6, amp: 25, diurnal: 0.4, off };
      case 'netOut': return { unit: 'Mbit/s', base: 45 + t.runningPods * 8, amp: 35, diurnal: 0.4, off };
      case 'etcdSize': return { unit: 'MB', base: 4 + t.pods * 0.35, amp: 0.2, trend: 1.5, off };
      default: return null;
    }
  });
  registerMetrics('k8sWorkload', (w: K8sWorkload, metric) => {
    const off = w.status === 'Terminating';
    const r = Math.max(0, w.readyReplicas);
    switch (metric) {
      case 'cpu': return { unit: 'm', base: w.cpuRequestM * r * 0.55, amp: w.cpuRequestM * r * 0.2, spikiness: 0.3, diurnal: 0.3, off };
      case 'memory': return { unit: 'Mi', base: w.memRequestMi * r * 0.72, amp: w.memRequestMi * r * 0.05, off };
      case 'restarts': return { unit: '', base: w.status === 'Degraded' ? 3 : 0, amp: w.status === 'Degraded' ? 2 : 0, off };
      default: return null;
    }
  });
}
