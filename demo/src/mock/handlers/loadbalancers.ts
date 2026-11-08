import { db } from '../db';
import { defineCollection, ApiError, validate, nameError, uniqueNameError, scopeFor, newId, nowIso, getOr404, detachEverywhere, DAY, type Ctx } from '../framework';
import { startOperation, onOperationComplete, transition, type StepSpec } from '../operations';
import { registerMetrics } from '../metrics';
import { locationOrThrow, checkQuota, checkRequiredTags, checkLocationAllowed, setFirewalls, allocateIp, defaultPool, assignIp, unassignIp, allowanceFor, nextPrivateIp } from './shared';
import { lbMonthly } from './costs';
import { randomHex } from '@/lib/random';
import type { LoadBalancer, Listener, TargetGroup, LbTarget, LbRule, Certificate, VM, K8sCluster, Network, Firewall, IpAddress, DnsZone, Location, LbProtocol } from '@/types';

/* Load balancers (L4 TCP/UDP and L7 HTTP/HTTPS with host/path routing) and TLS certificates
 * (Let's Encrypt via ACME HTTP-01 / DNS-01, or uploaded PEM). Target health is simulated from the
 * real state of the referenced VMs / clusters. */

const ms = (n: number) => n * 1000;
const L4_PROTOCOLS: LbProtocol[] = ['TCP', 'UDP'];
const L7_PROTOCOLS: LbProtocol[] = ['HTTP', 'HTTPS'];
const HOST_RE = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const TG_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

type LbRow = LoadBalancer & { privateIp?: string; subnetId?: string };

/* ------------------------------------------------------------------------------------------------
 * Health simulation
 * ---------------------------------------------------------------------------------------------- */

function latencyFor(seed: string) { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0; return 3 + Math.abs(h % 23) }

export function targetHealth(lb: LoadBalancer, tg: TargetGroup, t: LbTarget): { health: LbTarget['health']; reason: string; name?: string; address?: string } {
  const hc = tg.healthCheck;
  const port = t.port ?? tg.port;
  let name: string | undefined; let address: string | undefined;
  if (t.ref.type === 'vm') { const vm = db.get<VM>('vms', t.ref.id); name = vm?.name; address = vm ? `${vm.privateIp}:${port}` : undefined }
  else if (t.ref.type === 'k8s') { const k = db.get<K8sCluster>('k8sClusters', t.ref.id); name = k?.name; address = k ? `nodes:${port}` : undefined }
  const base = { name, address };
  if (lb.status === 'provisioning') return { ...base, health: 'initial', reason: 'Waiting for the load balancer to come up' };
  if (t.drained) return { ...base, health: 'draining', reason: 'Drained — receives no new traffic until re-enabled' };
  if (t.health === 'draining') return { ...base, health: 'draining', reason: 'Draining in-flight connections' };
  const check = hc.protocol === 'TCP' ? `TCP connect :${port}` : `${hc.protocol} GET ${hc.path || '/'} :${port}`;
  const warmup = Math.min(20_000, hc.healthyThreshold * hc.intervalSec * 1000);
  const fresh = t.addedAt && Date.now() - Date.parse(t.addedAt) < warmup;
  if (t.ref.type === 'vm') {
    const vm = db.get<VM>('vms', t.ref.id);
    if (!vm) return { ...base, health: 'unhealthy', reason: 'Target no longer exists' };
    if (vm.status === 'running') {
      if (fresh) return { ...base, health: 'initial', reason: `Registering — waiting for ${hc.healthyThreshold} consecutive passing checks` };
      return { ...base, health: 'healthy', reason: `${check} → ${hc.protocol === 'TCP' ? 'open' : '200 OK'} in ${latencyFor(vm.id + tg.id)}ms` };
    }
    if (vm.status === 'stopped') return { ...base, health: 'unhealthy', reason: `${check} → connection refused (VM is stopped)` };
    if (vm.status === 'error') return { ...base, health: 'unhealthy', reason: `${check} → timeout (VM in error state)` };
    return { ...base, health: 'unhealthy', reason: `${check} → timeout after ${hc.timeoutSec}s (VM is ${vm.status})` };
  }
  if (t.ref.type === 'k8s') {
    const k = db.get<K8sCluster>('k8sClusters', t.ref.id);
    if (!k) return { ...base, health: 'unhealthy', reason: 'Cluster no longer exists' };
    const nodes = k.nodePools.reduce((a, p) => a + p.count, 0);
    if (k.status === 'running' || k.status === 'upgrading' || k.status === 'scaling') {
      if (fresh) return { ...base, health: 'initial', reason: 'Registering NodePort on all nodes' };
      return { ...base, health: 'healthy', reason: `${check} → ${hc.protocol === 'TCP' ? 'open' : '200 OK'} on ${nodes}/${nodes} nodes` };
    }
    if (k.status === 'degraded') return { ...base, health: 'healthy', reason: `${check} passing on some nodes (cluster degraded)` };
    return { ...base, health: 'unhealthy', reason: `${check} → no ready nodes (cluster ${k.status})` };
  }
  return { ...base, health: 'unhealthy', reason: 'Unsupported target type' };
}

function decorateLb(lb: LbRow): LbRow {
  const summary = { healthy: 0, unhealthy: 0, draining: 0, initial: 0, total: 0 };
  const targetGroups = lb.targetGroups.map((tg) => ({
    ...tg,
    targets: tg.targets.map((t) => {
      const h = targetHealth(lb, tg, t);
      summary[h.health]++; summary.total++;
      return { ...t, health: h.health, reason: h.reason, name: h.name, address: h.address };
    }),
  }));
  let status = lb.status;
  if (status === 'active' || status === 'degraded') status = summary.unhealthy > 0 ? 'degraded' : 'active';
  return { ...lb, targetGroups, status, healthSummary: summary, monthlyCost: lbMonthly(lb) + lb.ipIds.reduce((a, id) => a + (db.get<IpAddress>('ips', id)?.version === 4 ? 2 : 0), 0) };
}

/* ------------------------------------------------------------------------------------------------
 * Validation
 * ---------------------------------------------------------------------------------------------- */

function usableCert(certId: string | null | undefined, projectId: string): string | null {
  if (!certId) return 'HTTPS listeners require a TLS certificate';
  const c = db.get<Certificate>('certificates', certId);
  if (!c) return 'Unknown certificate';
  if (c.projectId !== projectId) return 'Certificate belongs to another project';
  if (c.status === 'failed') return `Certificate ${c.name} failed to issue`;
  if (Date.parse(c.expiresAt) < Date.now()) return `Certificate ${c.name} has expired`;
  return null;
}

const transport = (p: LbProtocol) => (p === 'UDP' ? 'udp' : 'tcp');

function validateListeners(lb: Pick<LoadBalancer, 'type' | 'projectId' | 'targetGroups'>, listeners: Listener[], prefix = 'listeners') {
  const errors: Record<string, string> = {};
  if (!listeners.length) errors[prefix] = 'Add at least one listener';
  const allowed = lb.type === 'L4' ? L4_PROTOCOLS : L7_PROTOCOLS;
  const tgIds = new Set(lb.targetGroups.map((t) => t.id));
  const seen = new Map<string, number>();
  listeners.forEach((l, i) => {
    const k = `${prefix}.${i}`;
    if (!allowed.includes(l.protocol)) errors[`${k}.protocol`] = `${lb.type} load balancers support ${allowed.join('/')} listeners${lb.type === 'L4' ? ' (use TCP 443 for TLS passthrough)' : ''}`;
    if (!(Number.isInteger(l.port) && l.port >= 1 && l.port <= 65535)) errors[`${k}.port`] = 'Port must be 1–65535';
    const key = `${transport(l.protocol)}:${l.port}`;
    if (seen.has(key)) errors[`${k}.port`] = `Port ${l.port}/${transport(l.protocol)} is already used by another listener`;
    seen.set(key, i);
    if (l.protocol === 'HTTPS') { const e = usableCert(l.certificateId, lb.projectId); if (e) errors[`${k}.certificateId`] = e }
    else if (l.certificateId) errors[`${k}.certificateId`] = 'Certificates only apply to HTTPS listeners';
    if (!l.redirectToHttps && !tgIds.has(l.defaultTargetGroupId)) errors[`${k}.defaultTargetGroupId`] = 'Choose a default target group';
    if (l.redirectToHttps) {
      if (l.protocol !== 'HTTP') errors[`${k}.redirectToHttps`] = 'Only HTTP listeners can redirect to HTTPS';
      else if (!listeners.some((x) => x.protocol === 'HTTPS')) errors[`${k}.redirectToHttps`] = 'Add an HTTPS listener to redirect to';
    }
    if (l.rules?.length && lb.type === 'L4') errors[`${k}.rules`] = 'Routing rules require an L7 load balancer';
    (l.rules ?? []).forEach((r, j) => {
      if (!r.host && !r.pathPrefix) errors[`${k}.rules.${j}`] = 'A rule needs a host and/or a path prefix';
      else if (r.host && !HOST_RE.test(r.host)) errors[`${k}.rules.${j}`] = `Invalid host "${r.host}"`;
      else if (r.pathPrefix && !r.pathPrefix.startsWith('/')) errors[`${k}.rules.${j}`] = 'Path prefix must start with /';
      else if (!tgIds.has(r.targetGroupId)) errors[`${k}.rules.${j}`] = 'Rule points to an unknown target group';
    });
  });
  validate(errors);
}

function validateHealthCheck(hc: TargetGroup['healthCheck'], key: string): Record<string, string | false> {
  return {
    [`${key}.protocol`]: !['TCP', 'HTTP', 'HTTPS'].includes(hc.protocol) && 'Health check protocol must be TCP, HTTP or HTTPS',
    [`${key}.path`]: hc.protocol !== 'TCP' && !(hc.path ?? '').startsWith('/') && 'Path must start with /',
    [`${key}.intervalSec`]: !(Number.isInteger(hc.intervalSec) && hc.intervalSec >= 5 && hc.intervalSec <= 300) && 'Interval must be 5–300 s',
    [`${key}.timeoutSec`]: !(Number.isInteger(hc.timeoutSec) && hc.timeoutSec >= 2 && hc.timeoutSec <= 60) ? 'Timeout must be 2–60 s' : hc.timeoutSec >= hc.intervalSec && 'Timeout must be shorter than the interval',
    [`${key}.healthyThreshold`]: !(Number.isInteger(hc.healthyThreshold) && hc.healthyThreshold >= 2 && hc.healthyThreshold <= 10) && 'Healthy threshold must be 2–10',
    [`${key}.unhealthyThreshold`]: !(Number.isInteger(hc.unhealthyThreshold) && hc.unhealthyThreshold >= 2 && hc.unhealthyThreshold <= 10) && 'Unhealthy threshold must be 2–10',
  };
}

function reachable(lb: Pick<LoadBalancer, 'networkId'>, networkId: string) {
  if (networkId === lb.networkId) return true;
  const net = db.get<Network>('networks', lb.networkId);
  return !!net?.peerings.some((p) => p.networkId === networkId && p.status === 'active');
}

function validateTarget(lb: Pick<LoadBalancer, 'projectId' | 'locationId' | 'networkId'>, tg: Pick<TargetGroup, 'targets' | 'port'>, t: Partial<LbTarget>, key: string, exceptIndex?: number): Record<string, string | false> {
  const ref = t.ref;
  let err: string | false = false;
  if (!ref || !['vm', 'k8s'].includes(ref.type)) err = 'Targets must be VMs or Kubernetes clusters';
  else if (ref.type === 'vm') {
    const vm = db.get<VM>('vms', ref.id);
    if (!vm) err = `VM ${ref.id} not found`;
    else if (vm.projectId !== lb.projectId) err = `${vm.name} belongs to another project`;
    else if (vm.locationId !== lb.locationId) err = `${vm.name} runs in ${vm.locationId}; the load balancer is in ${lb.locationId}`;
    else if (!reachable(lb, vm.networkId)) err = `${vm.name} is in a network that is neither the LB's network nor peered with it`;
  } else {
    const k = db.get<K8sCluster>('k8sClusters', ref.id);
    if (!k) err = `Cluster ${ref.id} not found`;
    else if (k.projectId !== lb.projectId) err = `${k.name} belongs to another project`;
    else if (k.locationId !== lb.locationId) err = `${k.name} runs in ${k.locationId}`;
    else if (!(t.port && t.port >= 30000 && t.port <= 32767)) err = 'Kubernetes targets need a NodePort (30000–32767)';
  }
  if (!err && t.port != null && !(Number.isInteger(t.port) && t.port >= 1 && t.port <= 65535)) err = 'Port must be 1–65535';
  if (!err && t.weight != null && !(Number.isInteger(t.weight) && t.weight >= 0 && t.weight <= 1000)) err = 'Weight must be 0–1000';
  if (!err && tg.targets.some((x, i) => i !== exceptIndex && x.ref.type === ref!.type && x.ref.id === ref!.id && (x.port ?? tg.port) === (t.port ?? tg.port))) err = 'Target is already registered on this port';
  return { [key]: err };
}

function normalizeTargetGroup(body: any, type: 'L4' | 'L7'): TargetGroup {
  const protocol: LbProtocol = body.protocol ?? (type === 'L4' ? 'TCP' : 'HTTP');
  return {
    id: newId('tg'), name: String(body.name ?? '').trim(), protocol, port: body.port ?? 80, stickySessions: !!body.stickySessions,
    healthCheck: {
      protocol: body.healthCheck?.protocol ?? (protocol === 'HTTPS' ? 'HTTPS' : protocol === 'HTTP' ? 'HTTP' : 'TCP'), path: body.healthCheck?.path ?? (L7_PROTOCOLS.includes(protocol) ? '/healthz' : ''),
      intervalSec: body.healthCheck?.intervalSec ?? 10, timeoutSec: body.healthCheck?.timeoutSec ?? 3, healthyThreshold: body.healthCheck?.healthyThreshold ?? 3, unhealthyThreshold: body.healthCheck?.unhealthyThreshold ?? 3,
    },
    targets: (body.targets ?? []).map((t: any): LbTarget => ({ ref: t.ref, port: t.port ?? undefined, weight: t.weight ?? 100, health: 'initial', addedAt: nowIso() })),
  };
}

function validateTargetGroup(lb: Pick<LoadBalancer, 'type' | 'projectId' | 'locationId' | 'networkId' | 'targetGroups'>, tg: TargetGroup, key: string, exceptId?: string) {
  const allowed = lb.type === 'L4' ? L4_PROTOCOLS : L7_PROTOCOLS;
  const errors: Record<string, string | false> = {
    [`${key}.name`]: !tg.name ? 'Name is required' : !TG_NAME_RE.test(tg.name) ? 'Lowercase letters, digits and dashes (max 32)' : lb.targetGroups.some((x) => x.name === tg.name && x.id !== exceptId) && `Target group "${tg.name}" already exists`,
    [`${key}.protocol`]: !allowed.includes(tg.protocol) && `${lb.type} target groups use ${allowed.join('/')}`,
    [`${key}.port`]: !(Number.isInteger(tg.port) && tg.port >= 1 && tg.port <= 65535) && 'Port must be 1–65535',
    ...validateHealthCheck(tg.healthCheck, `${key}.healthCheck`),
  };
  tg.targets.forEach((t, i) => Object.assign(errors, validateTarget(lb, { targets: tg.targets, port: tg.port }, t, `${key}.targets.${i}`, i)));
  validate(errors);
}

function checkServiceAllowed(projectId: string) {
  const a = allowanceFor(projectId);
  if (a?.allowedServices?.length && !a.allowedServices.includes('loadBalancers')) throw new ApiError(422, 'Service policy: load balancers are not enabled for this project', 'service_policy');
}

/* ------------------------------------------------------------------------------------------------
 * Config apply (hot reload)
 * ---------------------------------------------------------------------------------------------- */

function proxyName(lb: LoadBalancer) { return lb.type === 'L7' ? 'Envoy' : 'HAProxy (TCP mode)' }

function applyConfig(ctx: Ctx, lb: LoadBalancer, title: string, logs: string[]) {
  db.update('loadBalancers', lb.id, { status: 'updating' } as any);
  startOperation({
    type: 'lb.update', title: `${title} · ${lb.name}`, target: { type: 'lb', id: lb.id, name: lb.name }, scope: { accountId: lb.accountId, projectId: lb.projectId }, actor: ctx.actor, silent: true,
    steps: [
      { name: 'Validate configuration', ms: ms(0.5), logs },
      { name: `Hot-reload ${proxyName(lb)} on 2 edge nodes`, ms: ms(1.1), logs: ['edge-a: config v+1 applied, 0 dropped connections', 'edge-b: config v+1 applied, 0 dropped connections'] },
    ],
    onComplete: 'lb.state', payload: { id: lb.id, status: 'active' },
  });
}

function requireMutable(lb: LoadBalancer) {
  if (lb.status === 'provisioning' || lb.status === 'deleting') throw new ApiError(409, `Load balancer is ${lb.status}`, 'invalid_state');
}

function mutate(ctx: Ctx, lb: LoadBalancer, title: string, logs: string[], fn: (l: LoadBalancer) => void) {
  requireMutable(lb);
  const next = structuredClone(lb);
  fn(next);
  validateListeners(next, next.listeners);
  db.update<any>('loadBalancers', lb.id, { listeners: next.listeners, targetGroups: next.targetGroups });
  applyConfig(ctx, next, title, logs);
  return decorateLb(db.get<LbRow>('loadBalancers', lb.id)!);
}

const tgOf = (lb: LoadBalancer, id: string) => { const tg = lb.targetGroups.find((t) => t.id === id); if (!tg) throw new ApiError(404, `Target group ${id} not found`, 'not_found'); return tg };
const listenerOf = (lb: LoadBalancer, id: string) => { const l = lb.listeners.find((t) => t.id === id); if (!l) throw new ApiError(404, `Listener ${id} not found`, 'not_found'); return l };
const sameRef = (a: LbTarget['ref'], b: LbTarget['ref']) => a.type === b.type && a.id === b.id;

function normalizeListener(body: any): Listener {
  return {
    id: newId('lst'), port: Number(body.port), protocol: body.protocol, certificateId: body.protocol === 'HTTPS' ? body.certificateId ?? null : null,
    defaultTargetGroupId: body.defaultTargetGroupId ?? '', redirectToHttps: body.protocol === 'HTTP' ? !!body.redirectToHttps : false,
    rules: (body.rules ?? []).map((r: any): LbRule => ({ id: newId('lr'), host: r.host || undefined, pathPrefix: r.pathPrefix || undefined, targetGroupId: r.targetGroupId })),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Create
 * ---------------------------------------------------------------------------------------------- */

function createLb(ctx: Ctx, body: any): LbRow {
  const sc = scopeFor(ctx, body);
  const loc = locationOrThrow(body.locationId);
  const net = db.get<Network>('networks', body.networkId);
  const type: 'L4' | 'L7' = body.type === 'L4' ? 'L4' : 'L7';
  validate({
    name: nameError(body.name) || uniqueNameError('loadBalancers', body.name, sc),
    type: !['L4', 'L7'].includes(body.type) && 'Choose L4 or L7',
    algorithm: body.algorithm && !['round_robin', 'least_connections', 'ip_hash'].includes(body.algorithm) && 'Unknown algorithm',
    networkId: !net ? 'Choose a network' : net.projectId !== sc.projectId ? 'Network belongs to another project' : net.locationId !== loc.id && `Network ${net.name} is in ${net.locationId}; pick a network in ${loc.id}`,
    publicIp: body.publicIp && !['new', 'none'].includes(body.publicIp) && (() => { const ip = db.get<IpAddress>('ips', body.publicIp); return !ip ? 'Unknown IP' : ip.projectId !== sc.projectId ? 'IP belongs to another project' : ip.assignedTo ? `${ip.address} is already assigned` : false })(),
    firewallIds: (body.firewallIds ?? []).some((id: string) => db.get<Firewall>('firewalls', id)?.projectId !== sc.projectId) && 'Firewalls must belong to the same project',
    proxyProtocol: body.proxyProtocol && type === 'L7' && 'PROXY protocol applies to L4 load balancers (L7 adds X-Forwarded-For)',
  });
  checkServiceAllowed(sc.projectId);
  checkLocationAllowed(sc.projectId, loc.id);
  checkRequiredTags(sc.projectId, body.tags);
  checkQuota(sc.projectId, { publicIps: body.publicIp === 'new' ? 1 : 0 });

  // target groups get server ids; listeners/rules may reference the client's temporary ids or names
  const idMap = new Map<string, string>();
  const tgs: TargetGroup[] = (body.targetGroups ?? []).map((raw: any) => {
    const tg = normalizeTargetGroup(raw, type);
    if (raw.id) idMap.set(raw.id, tg.id);
    idMap.set(tg.name, tg.id);
    return tg;
  });
  const lbStub = { type, projectId: sc.projectId, locationId: loc.id, networkId: net!.id, targetGroups: [] as TargetGroup[] };
  if (!tgs.length) validate({ targetGroups: 'Add at least one target group' });
  tgs.forEach((tg, i) => { validateTargetGroup(lbStub, tg, `targetGroups.${i}`); lbStub.targetGroups.push(tg) });
  const remap = (id: string) => idMap.get(id) ?? id;
  const listeners: Listener[] = (body.listeners ?? []).map((raw: any) => {
    const l = normalizeListener(raw);
    l.defaultTargetGroupId = remap(l.defaultTargetGroupId);
    l.rules = l.rules.map((r) => ({ ...r, targetGroupId: remap(r.targetGroupId) }));
    return l;
  });
  validateListeners(lbStub, listeners);

  const subnetId = body.subnetId ?? net!.subnets[0]?.id;
  return {
    id: newId('lb'), name: body.name, ...sc, type, status: 'provisioning', algorithm: body.algorithm ?? 'round_robin', locationId: loc.id, networkId: net!.id, subnetId,
    privateIp: subnetId ? nextPrivateIp(net!.id, subnetId) : undefined,
    ipIds: [], hostname: `${body.name}.lb.${loc.id}.autark.cloud`, listeners, targetGroups: tgs, firewallIds: [], proxyProtocol: type === 'L4' && !!body.proxyProtocol,
    deletionProtection: !!body.deletionProtection, createdAt: nowIso(), tags: body.tags ?? [],
  };
}

function afterCreateLb(ctx: Ctx, lb: LbRow, body: any) {
  const addrs: string[] = [];
  if (body.publicIp === 'new') {
    const pool = defaultPool(lb.locationId, 4);
    if (pool) { const ip = allocateIp(pool.id, { accountId: lb.accountId, projectId: lb.projectId }, null, `${lb.name}-vip`); assignIp(ip.id, { type: 'lb', id: lb.id }); addrs.push(ip.address) }
  } else if (body.publicIp && body.publicIp !== 'none') {
    assignIp(body.publicIp, { type: 'lb', id: lb.id });
    addrs.push(db.get<IpAddress>('ips', body.publicIp)?.address ?? '');
  }
  if (body.ipv6) {
    const pool6 = defaultPool(lb.locationId, 6);
    if (pool6) { const ip = allocateIp(pool6.id, { accountId: lb.accountId, projectId: lb.projectId }, null, `${lb.name}-vip6`); assignIp(ip.id, { type: 'lb', id: lb.id }); addrs.push(ip.address) }
  }
  if (body.firewallIds?.length) setFirewalls({ type: 'lb', id: lb.id }, body.firewallIds);
  const loc = db.get<Location>('locations', lb.locationId)!;
  const certs = lb.listeners.filter((l) => l.certificateId).map((l) => db.get<Certificate>('certificates', l.certificateId!)?.name ?? l.certificateId);
  const targets = lb.targetGroups.reduce((a, t) => a + t.targets.length, 0);
  const steps: StepSpec[] = [
    { name: 'Validate configuration', ms: ms(0.6), logs: [`${lb.listeners.length} listener(s), ${lb.targetGroups.length} target group(s), ${targets} target(s)`] },
    { name: addrs.length ? `Allocate VIP ${addrs[0]}` : `Allocate private VIP ${lb.privateIp ?? ''}`, ms: ms(0.9), logs: [...addrs.map((a) => `VIP ${a}`), loc.kind === 'selfHosted' ? 'announce via BGP (ECMP) from edge routers' : `provider floating IP in ${loc.region}`] },
    { name: `Deploy ${proxyName(lb)} pair`, ms: ms(1.8), logs: [lb.type === 'L7' ? 'envoy v1.32 on edge-a / edge-b' : 'haproxy 3.0 (mode tcp) on edge-a / edge-b', 'keepalived VRRP active/active', `algorithm: ${lb.algorithm.replace('_', ' ')}`] },
    { name: 'Configure listeners', ms: ms(0.8), logs: lb.listeners.map((l) => `${l.protocol} :${l.port}${l.redirectToHttps ? ' → 301 https' : ''}${l.rules.length ? ` (${l.rules.length} rules)` : ''}`) },
    ...(certs.length ? [{ name: 'Load TLS certificates', ms: ms(0.6), logs: certs.map((c) => `SDS secret ${c}`) }] : []),
    { name: 'Register targets & start health checks', ms: ms(1.2), logs: lb.targetGroups.map((t) => `${t.name}: ${t.targets.length} target(s), ${t.healthCheck.protocol} ${t.healthCheck.path || ''} every ${t.healthCheck.intervalSec}s`) },
    { name: 'Apply firewalls', ms: ms(0.5), logs: [`${(body.firewallIds ?? []).length} firewall(s)`] },
    { name: 'Publish DNS name', ms: ms(0.5), logs: [`${lb.hostname} A ${addrs[0] ?? lb.privateIp}`] },
  ];
  startOperation({
    type: 'lb.create', title: `Provision load balancer ${lb.name}`, target: { type: 'lb', id: lb.id, name: lb.name }, steps, scope: { accountId: lb.accountId, projectId: lb.projectId }, actor: ctx.actor,
    onComplete: 'lb.state', onFail: 'lb.failed', payload: { id: lb.id, status: 'active', touchTargets: true },
    ...(lb.name.includes('fail') ? { failAtStep: 1, failMessage: 'BGP session to edge router not established (peer 10.255.0.1 idle)' } : {}),
  });
}

onOperationComplete('lb.state', (_op, p: { id: string; status: LoadBalancer['status']; touchTargets?: boolean }) => {
  const cur = db.get<LoadBalancer>('loadBalancers', p.id);
  if (!cur || cur.status === 'deleting') return;
  db.update<any>('loadBalancers', p.id, (l: LoadBalancer) => {
    l.status = p.status;
    if (p.touchTargets) for (const tg of l.targetGroups) for (const t of tg.targets) t.addedAt = nowIso();
    return l;
  });
});
onOperationComplete('lb.failed', (_op, p: { id: string }) => { if (db.get('loadBalancers', p.id)) db.update('loadBalancers', p.id, { status: 'error' } as any) });
onOperationComplete('lb.targetDrained', (_op, p: { id: string; tgId: string; ref: LbTarget['ref']; deregister: boolean }) => {
  if (!db.get('loadBalancers', p.id)) return;
  db.update<any>('loadBalancers', p.id, (l: LoadBalancer) => {
    const tg = l.targetGroups.find((t) => t.id === p.tgId);
    if (!tg) return l;
    if (p.deregister) tg.targets = tg.targets.filter((t) => !sameRef(t.ref, p.ref));
    else tg.targets = tg.targets.map((t) => (sameRef(t.ref, p.ref) ? { ...t, drained: true, health: 'draining' } : t));
    return l;
  });
});
onOperationComplete('lb.deleted', (_op, p: { id: string; releaseIps: boolean }) => {
  const lb = db.get<LoadBalancer>('loadBalancers', p.id);
  if (!lb) return;
  for (const ipId of lb.ipIds) { if (p.releaseIps) db.remove('ips', ipId); else unassignIp(ipId) }
  for (const z of db.list<DnsZone>('dnsZones')) {
    if (z.records?.some((r) => r.managedBy?.type === 'lb' && r.managedBy.id === lb.id)) db.update<any>('dnsZones', z.id, { records: z.records.filter((r) => !(r.managedBy?.type === 'lb' && r.managedBy.id === lb.id)) });
  }
  detachEverywhere('lb', lb.id);
  db.remove('loadBalancers', lb.id);
});

/* ------------------------------------------------------------------------------------------------
 * Certificates
 * ---------------------------------------------------------------------------------------------- */

function publicZoneFor(projectId: string, domain: string): DnsZone | undefined {
  const d = domain.replace(/^\*\./, '');
  return db.filter<DnsZone>('dnsZones', (z) => z.kind === 'public' && z.projectId === projectId && (d === z.name || d.endsWith(`.${z.name}`))).sort((a, b) => b.name.length - a.name.length)[0];
}

function fakeHex(n: number) { return randomHex(n).match(/.{2}/g)!.join(':') }

function issuanceSteps(c: Certificate, renew: boolean): { steps: StepSpec[]; failAt?: number; failMessage?: string } {
  const steps: StepSpec[] = [
    { name: renew ? 'Create ACME renewal order' : 'Create ACME account & order', ms: ms(0.8), logs: ['POST https://acme-v02.api.letsencrypt.org/acme/new-order', `identifiers: ${c.domains.join(', ')}`, `${c.domains.length} authorization(s) pending`] },
  ];
  let failAt: number | undefined; let failMessage: string | undefined;
  for (const d of c.domains) {
    if (c.challenge === 'dns-01') {
      const zone = publicZoneFor(c.projectId, d);
      steps.push({ name: `DNS-01 challenge for ${d}`, ms: ms(1.6), logs: zone
        ? [`TXT _acme-challenge.${d.replace(/^\*\./, '')} created in Autark DNS zone ${zone.name}`, 'waiting for propagation to authoritative nameservers', 'Let\'s Encrypt validated from 3 vantage points', 'TXT record removed']
        : [`looking up a managed zone for ${d}…`, 'no Autark-managed public zone found'] });
      if (!zone && failAt == null) { failAt = steps.length - 1; failMessage = `No Autark-managed DNS zone for ${d.replace(/^\*\./, '')}. Create the public zone (or delegate it) or use HTTP-01 for non-wildcard names.` }
    } else {
      const bad = /\.(local|internal|lan|test)$/.test(d) || d.includes('fail');
      steps.push({ name: `HTTP-01 challenge for ${d}`, ms: ms(1.4), logs: [`serving /.well-known/acme-challenge/${randomHex(10)} on all edge proxies`, ...(bad ? [`DNS problem: NXDOMAIN looking up A for ${d}`] : [`GET http://${d}/.well-known/acme-challenge/… → 200`, 'authorization valid'])] });
      if (bad && failAt == null) { failAt = steps.length - 1; failMessage = `DNS problem: NXDOMAIN looking up A for ${d} — the name must resolve to one of your load balancers` }
    }
  }
  steps.push(
    { name: 'Finalize order', ms: ms(0.8), logs: [`generating ${c.keyType ?? 'ECDSA P-256'} key (never leaves the control plane, sealed with KMS)`, 'CSR submitted', 'order valid'] },
    { name: 'Download certificate chain', ms: ms(0.6), logs: ['leaf + intermediate E6 → ISRG Root X2', 'valid for 90 days'] },
  );
  const used = usedBy(c.id);
  if (used.length) steps.push({ name: `Deploy to ${used.length} listener(s)`, ms: ms(0.8), logs: used.map((u) => `${u.lbName} :${u.port} — hot-swapped via SDS`) });
  return { steps, failAt, failMessage };
}

function usedBy(certId: string) {
  const out: { lbId: string; lbName: string; listenerId: string; port: number }[] = [];
  for (const lb of db.list<LoadBalancer>('loadBalancers')) for (const l of lb.listeners) if (l.certificateId === certId) out.push({ lbId: lb.id, lbName: lb.name, listenerId: l.id, port: l.port });
  return out;
}

function startIssuance(ctx: Ctx | null, c: Certificate, renew: boolean) {
  const { steps, failAt, failMessage } = issuanceSteps(c, renew);
  startOperation({
    type: renew ? 'certificate.renew' : 'certificate.issue', title: `${renew ? 'Renew' : 'Issue'} certificate ${c.name}`, target: { type: 'certificate', id: c.id, name: c.name },
    steps, scope: { accountId: c.accountId, projectId: c.projectId }, actor: ctx?.actor ?? 'system', silent: false,
    onComplete: 'cert.issued', onFail: 'cert.failed', payload: { id: c.id, renew, reason: failMessage }, ...(failAt != null ? { failAtStep: failAt, failMessage } : {}),
  });
}

onOperationComplete('cert.issued', (_op, p: { id: string }) => {
  if (!db.get('certificates', p.id)) return;
  db.update('certificates', p.id, { status: 'issued', issuedAt: nowIso(), expiresAt: new Date(Date.now() + 90 * DAY).toISOString(), serial: fakeHex(8), fingerprint: `SHA256:${fakeHex(16)}`, failureReason: null } as any);
});
onOperationComplete('cert.failed', (_op, p: { id: string; renew: boolean; reason?: string }) => {
  const c = db.get<Certificate>('certificates', p.id);
  if (!c) return;
  // a failed renewal keeps the still-valid old certificate
  db.update('certificates', p.id, { status: p.renew && Date.parse(c.expiresAt) > Date.now() ? 'issued' : 'failed', failureReason: p.reason ?? 'ACME validation failed' } as any);
});

function validatePem(body: any) {
  validate({
    certificatePem: !/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(body.certificatePem ?? '') && 'Paste a PEM certificate (-----BEGIN CERTIFICATE-----)',
    privateKeyPem: !/-----BEGIN (RSA |EC |ENCRYPTED )?PRIVATE KEY-----[\s\S]+-----END (RSA |EC |ENCRYPTED )?PRIVATE KEY-----/.test(body.privateKeyPem ?? '') ? 'Paste the matching PEM private key' : /ENCRYPTED/.test(body.privateKeyPem) && 'Encrypted private keys are not supported — remove the passphrase first',
    expiresAt: body.expiresAt && !Number.isFinite(Date.parse(body.expiresAt)) && 'Invalid expiry date',
  });
}

/* ------------------------------------------------------------------------------------------------
 * Registration
 * ---------------------------------------------------------------------------------------------- */

export function registerLoadBalancers() {
  defineCollection<LbRow>({
    name: 'loadBalancers', kind: 'lb', idPrefix: 'lb',
    searchText: (l) => {
      const ips = l.ipIds.map((id) => db.get<IpAddress>('ips', id)?.address ?? '').join(' ');
      return `${l.id} ${l.name} ${l.type} ${l.hostname} ${ips} ${l.status} ${l.tags.map((t) => `${t.key}:${t.value}`).join(' ')}`;
    },
    subtitle: (l) => `${l.type} load balancer · ${l.listeners.map((x) => `${x.protocol}:${x.port}`).join(', ')} · ${l.status}`,
    link: (l) => `/managed-services/load-balancers/${l.id}`,
    decorate: decorateLb,
    create: createLb,
    afterCreate: (ctx, lb) => afterCreateLb(ctx, lb, ctx.body),
    update: (ctx, lb, patch) => {
      const next: any = { ...lb };
      if ('name' in patch && patch.name !== lb.name) throw new ApiError(422, 'Load balancers cannot be renamed (the hostname is derived from the name)', 'validation_failed', { name: 'Immutable' });
      if ('tags' in patch) { checkRequiredTags(lb.projectId, patch.tags); next.tags = patch.tags }
      if ('deletionProtection' in patch) next.deletionProtection = !!patch.deletionProtection;
      let reload = false;
      if ('algorithm' in patch) {
        validate({ algorithm: !['round_robin', 'least_connections', 'ip_hash'].includes(patch.algorithm) && 'Unknown algorithm' });
        reload ||= patch.algorithm !== lb.algorithm; next.algorithm = patch.algorithm;
      }
      if ('proxyProtocol' in patch) {
        validate({ proxyProtocol: patch.proxyProtocol && lb.type === 'L7' && 'PROXY protocol applies to L4 load balancers' });
        reload ||= !!patch.proxyProtocol !== lb.proxyProtocol; next.proxyProtocol = !!patch.proxyProtocol;
      }
      if (reload) {
        requireMutable(lb);
        next.status = 'updating';
        startOperation({
          type: 'lb.update', title: `Update settings · ${lb.name}`, target: { type: 'lb', id: lb.id, name: lb.name }, scope: { accountId: lb.accountId, projectId: lb.projectId }, actor: ctx.actor, silent: true,
          steps: [{ name: 'Validate configuration', ms: ms(0.4), logs: [`algorithm ${next.algorithm}`, `proxy protocol ${next.proxyProtocol ? 'v2' : 'off'}`] }, { name: `Hot-reload ${proxyName(lb)}`, ms: ms(1) }],
          onComplete: 'lb.state', payload: { id: lb.id, status: 'active' },
        });
      }
      return next;
    },
    remove: (ctx, lb) => {
      if (lb.deletionProtection) throw new ApiError(409, 'Deletion protection is enabled for this load balancer. Disable it in Settings first.', 'protected');
      if (lb.status === 'deleting') throw new ApiError(409, 'Load balancer is already being deleted', 'invalid_state');
      const releaseIps = ctx.query.get('releaseIps') === 'true';
      transition({
        collection: 'loadBalancers', id: lb.id, kind: 'lb', name: lb.name, type: 'lb.delete', title: `Delete load balancer ${lb.name}`, during: { status: 'deleting' },
        steps: [
          { name: 'Stop accepting new connections', ms: ms(0.8) },
          { name: 'Drain in-flight connections', ms: ms(1.2), logs: ['active connections → 0'] },
          { name: `Remove ${proxyName(lb)} pair`, ms: ms(0.8) },
          { name: releaseIps ? 'Release VIPs' : 'Unassign VIPs (kept in project)', ms: ms(0.5) },
        ],
        onComplete: 'lb.deleted', payload: { id: lb.id, releaseIps }, scope: { accountId: lb.accountId, projectId: lb.projectId }, actor: ctx.actor, silent: false,
      });
      return 'async';
    },
    actions: {
      addListener: (ctx, lb, body) => {
        const l = normalizeListener(body);
        return mutate(ctx, lb, `Add listener ${l.protocol}:${l.port}`, [`+ listener ${l.protocol} :${l.port}`], (n) => { n.listeners.push(l) });
      },
      updateListener: (ctx, lb, body) => {
        const cur = listenerOf(lb, body.listenerId);
        return mutate(ctx, lb, `Update listener :${cur.port}`, [`~ listener ${cur.protocol} :${cur.port}`], (n) => {
          n.listeners = n.listeners.map((l) => (l.id !== cur.id ? l : {
            ...l, port: body.port ?? l.port, protocol: body.protocol ?? l.protocol, defaultTargetGroupId: body.defaultTargetGroupId ?? l.defaultTargetGroupId,
            certificateId: (body.protocol ?? l.protocol) === 'HTTPS' ? (body.certificateId !== undefined ? body.certificateId : l.certificateId) : null,
            redirectToHttps: (body.protocol ?? l.protocol) === 'HTTP' ? (body.redirectToHttps ?? l.redirectToHttps) : false,
          }));
        });
      },
      removeListener: (ctx, lb, body) => {
        const cur = listenerOf(lb, body.listenerId);
        if (lb.listeners.length === 1) throw new ApiError(409, 'A load balancer needs at least one listener', 'conflict');
        return mutate(ctx, lb, `Remove listener :${cur.port}`, [`- listener ${cur.protocol} :${cur.port}`], (n) => { n.listeners = n.listeners.filter((l) => l.id !== cur.id) });
      },
      setRules: (ctx, lb, body) => {
        const cur = listenerOf(lb, body.listenerId);
        if (lb.type !== 'L7') throw new ApiError(422, 'Routing rules require an L7 load balancer', 'validation_failed');
        return mutate(ctx, lb, `Update routing rules :${cur.port}`, (body.rules ?? []).map((r: any) => `rule ${r.host ?? '*'}${r.pathPrefix ?? ''} → ${lb.targetGroups.find((t) => t.id === r.targetGroupId)?.name ?? r.targetGroupId}`), (n) => {
          n.listeners = n.listeners.map((l) => (l.id !== cur.id ? l : { ...l, rules: (body.rules ?? []).map((r: any) => ({ id: r.id && !String(r.id).startsWith('tmp') ? r.id : newId('lr'), host: r.host || undefined, pathPrefix: r.pathPrefix || undefined, targetGroupId: r.targetGroupId })) }));
        });
      },
      addRule: (ctx, lb, body) => {
        const cur = listenerOf(lb, body.listenerId);
        if (lb.type !== 'L7') throw new ApiError(422, 'Routing rules require an L7 load balancer', 'validation_failed');
        return mutate(ctx, lb, `Add rule :${cur.port}`, [`+ rule ${body.host ?? '*'}${body.pathPrefix ?? ''}`], (n) => {
          listenerOf(n, cur.id).rules.push({ id: newId('lr'), host: body.host || undefined, pathPrefix: body.pathPrefix || undefined, targetGroupId: body.targetGroupId });
        });
      },
      removeRule: (ctx, lb, body) => {
        const cur = listenerOf(lb, body.listenerId);
        return mutate(ctx, lb, `Remove rule :${cur.port}`, [`- rule ${body.ruleId}`], (n) => { const l = listenerOf(n, cur.id); l.rules = l.rules.filter((r) => r.id !== body.ruleId) });
      },
      addTargetGroup: (ctx, lb, body) => {
        requireMutable(lb);
        const tg = normalizeTargetGroup(body, lb.type);
        validateTargetGroup(lb, tg, 'targetGroup');
        return mutate(ctx, lb, `Add target group ${tg.name}`, [`+ target group ${tg.name} (${tg.protocol}:${tg.port}, ${tg.targets.length} targets)`], (n) => { n.targetGroups.push(tg) });
      },
      updateTargetGroup: (ctx, lb, body) => {
        const cur = tgOf(lb, body.targetGroupId);
        const next: TargetGroup = { ...cur, name: body.name ?? cur.name, protocol: body.protocol ?? cur.protocol, port: body.port ?? cur.port, stickySessions: body.stickySessions ?? cur.stickySessions, healthCheck: { ...cur.healthCheck, ...(body.healthCheck ?? {}) } };
        validateTargetGroup(lb, next, 'targetGroup', cur.id);
        return mutate(ctx, lb, `Update target group ${next.name}`, [`~ target group ${next.name}`], (n) => { n.targetGroups = n.targetGroups.map((t) => (t.id === cur.id ? next : t)) });
      },
      updateHealthCheck: (ctx, lb, body) => {
        const cur = tgOf(lb, body.targetGroupId);
        const hc = { ...cur.healthCheck, ...(body.healthCheck ?? {}) };
        validate(validateHealthCheck(hc, 'healthCheck'));
        return mutate(ctx, lb, `Update health check ${cur.name}`, [`health check ${hc.protocol} ${hc.path} every ${hc.intervalSec}s`], (n) => { tgOf(n, cur.id).healthCheck = hc });
      },
      removeTargetGroup: (ctx, lb, body) => {
        const cur = tgOf(lb, body.targetGroupId);
        const refs = lb.listeners.filter((l) => l.defaultTargetGroupId === cur.id || l.rules.some((r) => r.targetGroupId === cur.id));
        if (refs.length) throw new ApiError(409, `Target group ${cur.name} is used by listener${refs.length > 1 ? 's' : ''} ${refs.map((l) => `:${l.port}`).join(', ')}. Re-route them first.`, 'conflict');
        return mutate(ctx, lb, `Remove target group ${cur.name}`, [`- target group ${cur.name}`], (n) => { n.targetGroups = n.targetGroups.filter((t) => t.id !== cur.id) });
      },
      addTarget: (ctx, lb, body) => {
        const cur = tgOf(lb, body.targetGroupId);
        const list: any[] = body.targets ?? [body];
        const errors: Record<string, string | false> = {};
        const staged = { targets: [...cur.targets], port: cur.port };
        list.forEach((t, i) => { Object.assign(errors, validateTarget(lb, staged, t, list.length > 1 ? `targets.${i}` : 'ref')); staged.targets.push({ ref: t.ref, port: t.port, weight: t.weight ?? 100, health: 'initial' }) });
        validate(errors);
        return mutate(ctx, lb, `Register ${list.length} target(s) in ${cur.name}`, list.map((t) => `+ ${t.ref.type} ${t.ref.id}${t.port ? `:${t.port}` : ''}`), (n) => {
          tgOf(n, cur.id).targets.push(...list.map((t): LbTarget => ({ ref: t.ref, port: t.port ?? undefined, weight: t.weight ?? 100, health: 'initial', addedAt: nowIso() })));
        });
      },
      removeTarget: (ctx, lb, body) => {
        const cur = tgOf(lb, body.targetGroupId);
        if (!cur.targets.some((t) => sameRef(t.ref, body.ref))) throw new ApiError(404, 'Target not registered', 'not_found');
        return mutate(ctx, lb, `Deregister target from ${cur.name}`, [`- ${body.ref.type} ${body.ref.id}`], (n) => { const tg = tgOf(n, cur.id); tg.targets = tg.targets.filter((t) => !sameRef(t.ref, body.ref)) });
      },
      setTargetWeight: (ctx, lb, body) => {
        const cur = tgOf(lb, body.targetGroupId);
        validate({ weight: !(Number.isInteger(body.weight) && body.weight >= 0 && body.weight <= 1000) && 'Weight must be 0–1000' });
        return mutate(ctx, lb, `Set target weight in ${cur.name}`, [`${body.ref.id} weight → ${body.weight}`], (n) => { const tg = tgOf(n, cur.id); tg.targets = tg.targets.map((t) => (sameRef(t.ref, body.ref) ? { ...t, weight: body.weight } : t)) });
      },
      drainTarget: (ctx, lb, body) => {
        requireMutable(lb);
        const cur = tgOf(lb, body.targetGroupId);
        const t = cur.targets.find((x) => sameRef(x.ref, body.ref));
        if (!t) throw new ApiError(404, 'Target not registered', 'not_found');
        if (t.drained || t.health === 'draining') throw new ApiError(409, 'Target is already draining', 'invalid_state');
        db.update<any>('loadBalancers', lb.id, (l: LoadBalancer) => { const tg = tgOf(l, cur.id); tg.targets = tg.targets.map((x) => (sameRef(x.ref, body.ref) ? { ...x, health: 'draining' } : x)); return l });
        const name = t.ref.type === 'vm' ? db.get<VM>('vms', t.ref.id)?.name : db.get<K8sCluster>('k8sClusters', t.ref.id)?.name;
        startOperation({
          type: 'lb.drain', title: `Drain ${name ?? t.ref.id} from ${cur.name}`, target: { type: 'lb', id: lb.id, name: lb.name }, scope: { accountId: lb.accountId, projectId: lb.projectId }, actor: ctx.actor, silent: true,
          steps: [
            { name: 'Stop routing new connections', ms: ms(0.6), logs: ['weight → 0 on both edge nodes'] },
            { name: 'Wait for in-flight connections', ms: ms(3), logs: ['142 active connections', '37 active connections', '4 active connections', '0 active connections'] },
            { name: body.deregister ? 'Deregister target' : 'Mark target drained', ms: ms(0.4) },
          ],
          onComplete: 'lb.targetDrained', payload: { id: lb.id, tgId: cur.id, ref: t.ref, deregister: !!body.deregister },
        });
      },
      undrainTarget: (ctx, lb, body) => {
        const cur = tgOf(lb, body.targetGroupId);
        return mutate(ctx, lb, `Re-enable target in ${cur.name}`, [`${body.ref.id} back in rotation`], (n) => {
          const tg = tgOf(n, cur.id);
          tg.targets = tg.targets.map((t) => (sameRef(t.ref, body.ref) ? { ...t, drained: false, health: 'initial', addedAt: nowIso() } : t));
        });
      },
      setFirewalls: (_ctx, lb, body) => {
        const ids: string[] = body.firewallIds ?? [];
        if (ids.some((id) => db.get<Firewall>('firewalls', id)?.projectId !== lb.projectId)) throw new ApiError(422, 'Firewalls must belong to the same project', 'validation_failed');
        setFirewalls({ type: 'lb', id: lb.id }, ids);
      },
      assignIp: (_ctx, lb, body) => {
        if (body.ipId === 'new') {
          const pool = defaultPool(lb.locationId, body.version ?? 4);
          if (!pool) throw new ApiError(409, `No IPv${body.version ?? 4} pool in ${lb.locationId}`, 'conflict');
          if ((body.version ?? 4) === 4) checkQuota(lb.projectId, { publicIps: 1 });
          const ip = allocateIp(pool.id, { accountId: lb.accountId, projectId: lb.projectId }, null, `${lb.name}-vip`);
          assignIp(ip.id, { type: 'lb', id: lb.id });
          return ip;
        }
        const ip = getOr404<IpAddress>('ips', body.ipId, 'IP');
        if (ip.projectId !== lb.projectId) throw new ApiError(422, 'IP belongs to another project', 'validation_failed');
        assignIp(ip.id, { type: 'lb', id: lb.id });
      },
      unassignIp: (_ctx, lb, body) => {
        if (!lb.ipIds.includes(body.ipId)) throw new ApiError(409, 'IP is not assigned to this load balancer', 'conflict');
        unassignIp(body.ipId);
      },
    },
  });

  defineCollection<Certificate>({
    name: 'certificates', kind: 'certificate', idPrefix: 'cert',
    searchText: (c) => `${c.id} ${c.name} ${c.domains.join(' ')} ${c.issuer} ${c.status}`,
    subtitle: (c) => `Certificate · ${c.domains.join(', ')} · ${c.status}`,
    link: () => '/managed-services/load-balancers?tab=certificates',
    decorate: (c) => {
      const daysLeft = Math.floor((Date.parse(c.expiresAt) - Date.now()) / DAY);
      let status = c.status;
      if (status === 'issued' || status === 'expiring') status = daysLeft < 0 ? 'expired' : daysLeft < 30 ? 'expiring' : 'issued';
      return { ...c, status, daysLeft, usedBy: usedBy(c.id) };
    },
    create: (ctx, body) => {
      const sc = scopeFor(ctx, body);
      const domains: string[] = (body.domains ?? []).map((d: string) => String(d).trim().toLowerCase()).filter(Boolean);
      const issuer = body.issuer === 'custom' ? 'custom' : 'letsencrypt';
      const challenge = issuer === 'letsencrypt' ? (body.challenge === 'dns-01' ? 'dns-01' : 'http-01') : null;
      const bad = domains.find((d) => !HOST_RE.test(d));
      validate({
        name: nameError(body.name) || uniqueNameError('certificates', body.name, sc),
        domains: !domains.length ? 'Add at least one domain' : bad ? `Invalid domain "${bad}"` : domains.length > 100 ? 'At most 100 names per certificate' : new Set(domains).size !== domains.length ? 'Duplicate domain'
          : challenge === 'http-01' && domains.some((d) => d.startsWith('*.')) && 'Wildcard names require the DNS-01 challenge',
        keyType: body.keyType && !['ECDSA P-256', 'RSA 2048', 'RSA 4096'].includes(body.keyType) && 'Unsupported key type',
      });
      if (issuer === 'custom') validatePem(body);
      const now = nowIso();
      return {
        id: newId('cert'), name: body.name, ...sc, domains, issuer, challenge, keyType: body.keyType ?? (issuer === 'custom' ? 'RSA 2048' : 'ECDSA P-256'),
        status: issuer === 'custom' ? 'issued' : 'pending', autoRenew: issuer === 'letsencrypt' ? body.autoRenew ?? true : false,
        expiresAt: issuer === 'custom' ? (body.expiresAt ? new Date(body.expiresAt).toISOString() : new Date(Date.now() + 365 * DAY).toISOString()) : new Date(Date.now() + 90 * DAY).toISOString(),
        issuedAt: issuer === 'custom' ? now : null, serial: issuer === 'custom' ? fakeHex(8) : undefined, fingerprint: issuer === 'custom' ? `SHA256:${fakeHex(16)}` : undefined,
        failureReason: null, createdAt: now, tags: body.tags ?? [],
      } as Certificate;
    },
    afterCreate: (ctx, c) => { if (c.issuer === 'letsencrypt') startIssuance(ctx, c, false) },
    update: (_ctx, c, patch) => {
      const next: any = { ...c };
      if ('autoRenew' in patch) {
        if (patch.autoRenew && c.issuer === 'custom') throw new ApiError(422, 'Only Let\'s Encrypt certificates can renew automatically. Upload a new certificate before expiry.', 'validation_failed', { autoRenew: 'Not available for uploaded certificates' });
        next.autoRenew = !!patch.autoRenew;
      }
      if ('tags' in patch) next.tags = patch.tags;
      if ('name' in patch) { validate({ name: nameError(patch.name) || uniqueNameError('certificates', patch.name, c, c.id) }); next.name = patch.name }
      return next;
    },
    remove: (_ctx, c) => {
      const used = usedBy(c.id);
      if (used.length) throw new ApiError(409, `Certificate is used by ${used.map((u) => `${u.lbName} :${u.port}`).join(', ')}. Change those listeners first.`, 'in_use');
    },
    actions: {
      renew: (ctx, c, body) => {
        if (c.status === 'pending' || c.status === 'renewing') throw new ApiError(409, 'Issuance is already in progress', 'invalid_state');
        if (c.issuer === 'custom') {
          validatePem(body);
          db.update('certificates', c.id, { status: 'issued', issuedAt: nowIso(), expiresAt: body.expiresAt ? new Date(body.expiresAt).toISOString() : new Date(Date.now() + 365 * DAY).toISOString(), serial: fakeHex(8), fingerprint: `SHA256:${fakeHex(16)}`, failureReason: null } as any);
          return;
        }
        db.update('certificates', c.id, { status: c.status === 'failed' ? 'pending' : 'renewing' } as any);
        startIssuance(ctx, db.get<Certificate>('certificates', c.id)!, c.status !== 'failed');
      },
    },
  });

  registerMetrics('lb', (lb: LoadBalancer, metric) => {
    const off = ['provisioning', 'deleting', 'error'].includes(lb.status);
    const dec = decorateLb(lb as LbRow);
    const degraded = dec.status === 'degraded';
    const bias = (lb.id.charCodeAt(lb.id.length - 1) % 7) * 20;
    const l7 = lb.type === 'L7';
    switch (metric) {
      case 'requests': return { unit: l7 ? 'req/s' : 'conn/s', base: (l7 ? 420 : 180) + bias, amp: l7 ? 120 : 60, diurnal: 0.45, spikiness: 0.3, off };
      case 'activeConnections': return { unit: 'conn', base: (l7 ? 1300 : 2400) + bias * 4, amp: 300, diurnal: 0.4, off };
      case 'latencyP50': return { unit: 'ms', base: (l7 ? 14 : 2) + (degraded ? 6 : 0), amp: l7 ? 4 : 1, spikiness: 0.2, off };
      case 'latencyP95': return { unit: 'ms', base: (l7 ? 70 : 9) + (degraded ? 60 : 0), amp: l7 ? 25 : 4, spikiness: 0.45, off };
      case 'http4xx': return l7 ? { unit: 'req/s', base: 6 + bias / 20, amp: 4, spikiness: 0.3, off } : null;
      case 'http5xx': return l7 ? { unit: 'req/s', base: degraded ? 7 : 0.3, amp: degraded ? 4 : 0.4, spikiness: 0.4, off } : null;
      case 'bandwidthIn': return { unit: 'Mbit/s', base: 60 + bias, amp: 25, diurnal: 0.45, off };
      case 'bandwidthOut': return { unit: 'Mbit/s', base: 240 + bias * 3, amp: 90, diurnal: 0.45, off };
      case 'tlsHandshakes': return l7 && lb.listeners.some((x) => x.protocol === 'HTTPS') ? { unit: '/s', base: 40 + bias / 4, amp: 14, diurnal: 0.4, off } : null;
      default: return null;
    }
  });
}
