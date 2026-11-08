import { db } from '../db';
import { defineCollection, route, ApiError, validate, nameError, uniqueNameError, scopeFor, newId, nowIso, getOr404, intIn, type Ctx } from '../framework';
import { startOperation, onOperationComplete, transition, type StepSpec } from '../operations';
import { locationOrThrow, checkQuota, checkRequiredTags, checkLocationAllowed, defaultPool, assignIp, unassignIp, poolUsed, setFirewalls } from './shared';
import { dnsMonthly, ipMonthly, natMonthly } from './costs';
import { parseCidr, isValidCidr, cidrContains, cidrOverlaps, ipInCidr, isValidIp, isValidPortSpec, portMatches, nthHost, intToIp, nextFreeSubnet, usableHosts } from '@/lib/cidr';
import type {
  Network, Subnet, Route, IpPool, IpAddress, IpCell, Firewall, FirewallRule, FirewallEvaluation, FirewallTraceStep, DnsZone, DnsRecord, DnsRecordType,
  VM, DbInstance, LoadBalancer, K8sCluster, Ref, ZoneImportResult,
} from '@/types';

/* ------------------------------------------------------------------------------------------------
 * Networking: VPC networks (subnets, routes, peering), public IPs & pools, firewalls (with a packet
 * tester), DNS zones (records, BIND import/export, DNSSEC).
 * ---------------------------------------------------------------------------------------------- */

const ms = (n: number) => n * 1000;
const RFC1918 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

/* =============================================================================================== */
/* Networks                                                                                         */
/* =============================================================================================== */

export function networkResources(netId: string) {
  return {
    vms: db.filter<VM>('vms', (v) => v.networkId === netId),
    dbs: db.filter<DbInstance>('dbInstances', (d) => d.networkId === netId),
    lbs: db.filter<LoadBalancer>('loadBalancers', (l) => l.networkId === netId),
    k8s: db.filter<K8sCluster>('k8sClusters', (k) => k.networkId === netId),
  };
}

function subnetUsers(netId: string, subnetId: string): (Ref & { name: string })[] {
  const r = networkResources(netId);
  return [
    ...r.vms.filter((v) => v.subnetId === subnetId).map((v) => ({ type: 'vm' as const, id: v.id, name: v.name })),
    ...r.dbs.filter((d) => d.subnetId === subnetId).map((d) => ({ type: 'db' as const, id: d.id, name: d.name })),
    ...r.k8s.filter((k) => k.subnetId === subnetId).map((k) => ({ type: 'k8s' as const, id: k.id, name: k.name })),
  ];
}

function subnetUsedIps(netId: string, subnetId: string): number {
  const r = networkResources(netId);
  const vms = r.vms.filter((v) => v.subnetId === subnetId).length;
  const dbs = r.dbs.filter((d) => d.subnetId === subnetId).reduce((a, d) => a + 1 + (d.ha ? 1 : 0) + (d.readReplicas ?? 0), 0);
  const k8s = r.k8s.filter((k) => k.subnetId === subnetId).reduce((a, k) => a + (k.controlPlane.ha ? 3 : 1) + k.nodePools.reduce((s, p) => s + p.count, 0), 0);
  return 1 + vms + dbs + k8s; // +1 gateway
}

const list = (refs: { name: string }[], max = 4) => refs.slice(0, max).map((r) => r.name).join(', ') + (refs.length > max ? ` and ${refs.length - max} more` : '');

function cidrShapeError(cidr: unknown, label = 'CIDR'): string | null {
  if (typeof cidr !== 'string' || !cidr.trim()) return `${label} is required`;
  const p = parseCidr(cidr);
  if (!p) return `${cidr} is not a valid IPv4 CIDR (e.g. 10.0.0.0/16)`;
  if (!isValidCidr(cidr)) return `${cidr} is not aligned — did you mean ${p.base}/${p.prefix}?`;
  return null;
}

function vpcCidrError(cidr: string, projectId: string, exceptId?: string): string | null {
  const shape = cidrShapeError(cidr);
  if (shape) return shape;
  const p = parseCidr(cidr)!;
  if (p.prefix < 16 || p.prefix > 24) return 'VPC prefix must be between /16 and /24';
  if (!RFC1918.some((r) => cidrContains(r, cidr))) return 'Use a private (RFC 1918) range: 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16';
  const clash = db.find<Network>('networks', (n) => n.projectId === projectId && n.id !== exceptId && cidrOverlaps(n.cidr, cidr));
  if (clash) return `Overlaps ${clash.name} (${clash.cidr}) in this project`;
  return null;
}

function subnetCidrError(vpcCidr: string, cidr: string, others: { name: string; cidr: string }[]): string | null {
  const shape = cidrShapeError(cidr, 'Subnet CIDR');
  if (shape) return shape;
  const p = parseCidr(cidr)!;
  if (p.prefix > 29) return 'Subnets must be /29 or larger';
  if (!cidrContains(vpcCidr, cidr)) return `${cidr} is outside the VPC range ${vpcCidr}`;
  const clash = others.find((o) => cidrOverlaps(o.cidr, cidr));
  if (clash) return `Overlaps subnet ${clash.name} (${clash.cidr})`;
  return null;
}

function makeSubnet(input: any): Subnet {
  return {
    id: newId('sn'), name: input.name, cidr: input.cidr, public: !!input.public, gateway: nthHost(input.cidr, 1), dhcp: input.dhcp !== false,
    ...(input.description ? { description: String(input.description) } : {}),
  };
}

function systemRoutes(cidr: string, nat: boolean, existing: Route[] = []): Route[] {
  const custom = existing.filter((r) => !r.system);
  return [
    { id: 'rt-local', destination: cidr, target: { type: 'local' }, description: 'VPC local traffic', system: true },
    ...(nat ? [{ id: 'rt-nat', destination: '0.0.0.0/0', target: { type: 'nat' as const }, description: 'Private subnets egress via NAT', system: true }] : []),
    ...custom,
  ];
}

function provisionNetworkSteps(n: Network): StepSpec[] {
  return [
    { name: 'Validate address plan', ms: ms(0.6), logs: [`${n.cidr}: RFC 1918, no overlap in project`, `${n.subnets.length} subnet(s) verified`] },
    { name: 'Allocate VXLAN segment', ms: ms(1), logs: [`VNI ${10000 + (parseCidr(n.cidr)!.network >>> 16) % 5000} on ${n.locationId} fabric`, `MTU ${n.mtu}`] },
    { name: 'Configure distributed router', ms: ms(1.2), logs: n.subnets.map((s) => `gateway ${s.gateway} for ${s.name} (${s.cidr})`) },
    { name: 'Start DHCP & metadata service', ms: ms(0.8), logs: [`DNS resolver ${nthHost(n.cidr, 2)}`, 'metadata 169.254.169.254 reachable'] },
    ...(n.natGateway ? [{ name: 'Provision NAT gateway', ms: ms(1.4), logs: ['HA pair on edge nodes', 'SNAT for private subnets enabled'] }] : []),
  ];
}

onOperationComplete('network.provisioned', (_op, p: { id: string }) => {
  if (db.get('networks', p.id)) db.update('networks', p.id, { status: 'available' } as any);
});
onOperationComplete('network.deleted', (_op, p: { id: string }) => {
  const net = db.get<Network>('networks', p.id);
  if (!net) return;
  for (const peer of net.peerings) removePeeringSide(peer.networkId, net.id);
  for (const z of db.filter<DnsZone>('dnsZones', (z) => z.networkId === net.id)) db.update('dnsZones', z.id, { networkId: null } as any);
  db.remove('networks', net.id);
});
onOperationComplete('network.peered', (_op, p: { a: string; b: string }) => {
  for (const [x, y] of [[p.a, p.b], [p.b, p.a]]) {
    const n = db.get<Network>('networks', x);
    if (n) db.update<Network>('networks', x, (row) => { row.peerings = row.peerings.map((pe) => (pe.networkId === y ? { ...pe, status: 'active' } : pe)); return row });
  }
});

function removePeeringSide(onId: string, otherId: string) {
  const n = db.get<Network>('networks', onId);
  if (!n) return;
  db.update<Network>('networks', onId, (row) => {
    row.peerings = row.peerings.filter((p) => p.networkId !== otherId);
    row.routes = row.routes.filter((r) => !((r.target.type === 'peering' || r.target.type === 'vpn') && r.target.id === otherId));
    return row;
  });
}

function decorateNetwork(n: Network): Network {
  const r = networkResources(n.id);
  return {
    ...n,
    subnets: n.subnets.map((s) => ({ ...s, usedIps: subnetUsedIps(n.id, s.id), capacity: usableHosts(s.cidr) })),
    attached: { vms: r.vms.length, dbs: r.dbs.length, lbs: r.lbs.length, k8s: r.k8s.length },
    monthlyCost: natMonthly(n),
  };
}

function createNetwork(ctx: Ctx, body: any): Network {
  const sc = scopeFor(ctx, body);
  const loc = locationOrThrow(body.locationId);
  const cidr = String(body.cidr ?? '').trim();
  const mtu = body.mtu ?? 1450;
  validate({
    name: nameError(body.name) || uniqueNameError('networks', body.name, sc),
    cidr: vpcCidrError(cidr, sc.projectId),
    mtu: !intIn(mtu, 1280, 9000) && 'MTU must be between 1280 and 9000',
  });
  checkLocationAllowed(sc.projectId, loc.id);
  checkRequiredTags(sc.projectId, body.tags);

  let inputs: any[] = Array.isArray(body.subnets) ? body.subnets : [];
  if (!inputs.length) {
    const p = parseCidr(cidr)!;
    const pre = p.prefix <= 23 ? 24 : p.prefix + 1;
    inputs = [{ name: `${body.name}-public`, cidr: nextFreeSubnet(cidr, [], pre), public: true }];
  }
  const errs: Record<string, string> = {};
  const accepted: Subnet[] = [];
  inputs.forEach((s, i) => {
    const e = nameError(s.name, 'Subnet name') || (accepted.some((a) => a.name === s.name) ? `Duplicate subnet name ${s.name}` : null) || subnetCidrError(cidr, String(s.cidr ?? '').trim(), accepted);
    if (e) errs[`subnets.${i}`] = e;
    else accepted.push(makeSubnet({ ...s, cidr: String(s.cidr).trim() }));
  });
  if (Object.keys(errs).length) validate({ subnets: Object.values(errs)[0], ...errs });

  let dnsZoneId: string | null = null;
  if (body.dnsZoneId) {
    const z = db.get<DnsZone>('dnsZones', body.dnsZoneId);
    validate({ dnsZoneId: (!z || z.projectId !== sc.projectId) && 'Unknown DNS zone in this project' });
    dnsZoneId = z!.id;
  }
  const nat = !!body.natGateway;
  return {
    id: newId('net'), name: body.name, ...sc, cidr, locationId: loc.id, status: 'provisioning', natGateway: nat, dnsZoneId, mtu,
    subnets: accepted, routes: systemRoutes(cidr, nat), peerings: [], createdAt: nowIso(), tags: body.tags ?? [],
    ...(body.description ? { description: String(body.description) } : {}),
  };
}

function registerNetworks() {
  defineCollection<Network>({
    name: 'networks', kind: 'network', idPrefix: 'net',
    searchText: (n) => `${n.id} ${n.name} ${n.cidr} ${n.subnets.map((s) => `${s.name} ${s.cidr}`).join(' ')} ${n.locationId} ${n.tags.map((t) => `${t.key}:${t.value}`).join(' ')}`,
    subtitle: (n) => `VPC · ${n.cidr} · ${n.subnets.length} subnets`,
    decorate: decorateNetwork,
    create: createNetwork,
    afterCreate: (ctx, n) => {
      if (n.dnsZoneId) {
        const z = db.get<DnsZone>('dnsZones', n.dnsZoneId);
        if (z?.kind === 'private' && !z.networkId) db.update('dnsZones', z.id, { networkId: n.id } as any);
      }
      startOperation({
        type: 'network.create', title: `Create network ${n.name}`, target: { type: 'network', id: n.id, name: n.name }, steps: provisionNetworkSteps(n),
        scope: { accountId: n.accountId, projectId: n.projectId }, actor: ctx.actor, onComplete: 'network.provisioned', payload: { id: n.id }, silent: true,
      });
    },
    update: (_ctx, n, patch) => {
      const next: Network = { ...n };
      if ('name' in patch) { validate({ name: nameError(patch.name) || uniqueNameError('networks', patch.name, n, n.id) }); next.name = patch.name }
      if ('tags' in patch) { checkRequiredTags(n.projectId, patch.tags); next.tags = patch.tags ?? [] }
      if ('description' in patch) next.description = patch.description ? String(patch.description) : undefined;
      if ('mtu' in patch) { validate({ mtu: !intIn(patch.mtu, 1280, 9000) && 'MTU must be between 1280 and 9000' }); next.mtu = patch.mtu }
      if ('natGateway' in patch) {
        const nat = !!patch.natGateway;
        if (!nat && next.routes.some((r) => r.target.type === 'nat' && !r.system)) throw new ApiError(409, 'Custom routes still target the NAT gateway. Remove them first.', 'conflict');
        next.natGateway = nat;
        next.routes = systemRoutes(n.cidr, nat, n.routes);
      }
      if ('dnsZoneId' in patch) {
        if (patch.dnsZoneId) {
          const z = db.get<DnsZone>('dnsZones', patch.dnsZoneId);
          validate({ dnsZoneId: (!z || z.projectId !== n.projectId) ? 'Unknown DNS zone in this project' : z.kind === 'private' && z.networkId && z.networkId !== n.id && `${z.name} is bound to another VPC` });
          if (z!.kind === 'private' && !z!.networkId) db.update('dnsZones', z!.id, { networkId: n.id } as any);
          next.dnsZoneId = z!.id;
        } else next.dnsZoneId = null;
      }
      return next;
    },
    remove: (ctx, n) => {
      if (n.status === 'deleting') throw new ApiError(409, 'Network is already being deleted', 'invalid_state');
      const r = networkResources(n.id);
      const attached = [...r.vms.map((x) => ({ name: `VM ${x.name}` })), ...r.dbs.map((x) => ({ name: `database ${x.name}` })), ...r.lbs.map((x) => ({ name: `load balancer ${x.name}` })), ...r.k8s.map((x) => ({ name: `cluster ${x.name}` }))];
      if (attached.length) throw new ApiError(409, `${n.name} still has ${attached.length} attached resource${attached.length > 1 ? 's' : ''}: ${list(attached)}. Move or delete them first.`, 'in_use');
      transition({
        collection: 'networks', id: n.id, kind: 'network', name: n.name, type: 'network.delete', title: `Delete network ${n.name}`, during: { status: 'deleting' },
        steps: [
          ...(n.peerings.length ? [{ name: `Tear down ${n.peerings.length} peering(s)`, ms: ms(0.8) }] : []),
          ...(n.natGateway ? [{ name: 'Release NAT gateway', ms: ms(0.8) }] : []),
          { name: 'Remove router & DHCP', ms: ms(0.8) }, { name: 'Free VXLAN segment', ms: ms(0.5) },
        ],
        onComplete: 'network.deleted', payload: { id: n.id }, scope: { accountId: n.accountId, projectId: n.projectId }, actor: ctx.actor, silent: false,
      });
      return 'async';
    },
    actions: {
      addSubnet: (_ctx, n, body) => {
        const cidr = String(body.cidr ?? '').trim();
        validate({
          name: nameError(body.name, 'Subnet name') || (n.subnets.some((s) => s.name === body.name) && `Subnet ${body.name} already exists`),
          cidr: subnetCidrError(n.cidr, cidr, n.subnets),
        });
        const sn = makeSubnet({ ...body, cidr });
        db.update<Network>('networks', n.id, (row) => { row.subnets.push(sn); return row });
        return sn;
      },
      updateSubnet: (_ctx, n, body) => {
        const sn = n.subnets.find((s) => s.id === body.subnetId);
        if (!sn) throw new ApiError(404, 'Subnet not found', 'not_found');
        if ('name' in body) validate({ name: nameError(body.name, 'Subnet name') || (n.subnets.some((s) => s.name === body.name && s.id !== sn.id) && `Subnet ${body.name} already exists`) });
        db.update<Network>('networks', n.id, (row) => {
          row.subnets = row.subnets.map((s) => (s.id === sn.id ? { ...s, ...('name' in body ? { name: body.name } : {}), ...('public' in body ? { public: !!body.public } : {}), ...('dhcp' in body ? { dhcp: !!body.dhcp } : {}), ...('description' in body ? { description: body.description || undefined } : {}) } : s));
          return row;
        });
      },
      removeSubnet: (_ctx, n, body) => {
        const sn = n.subnets.find((s) => s.id === body.subnetId);
        if (!sn) throw new ApiError(404, 'Subnet not found', 'not_found');
        const users = subnetUsers(n.id, sn.id);
        if (users.length) throw new ApiError(409, `Subnet ${sn.name} is used by ${list(users)}. Move or delete them first.`, 'in_use');
        if (n.subnets.length === 1) throw new ApiError(409, 'A network needs at least one subnet', 'conflict');
        db.update<Network>('networks', n.id, (row) => { row.subnets = row.subnets.filter((s) => s.id !== sn.id); return row });
      },
      addRoute: (_ctx, n, body) => {
        const dest = String(body.destination ?? '').trim();
        const t = body.target ?? {};
        const types = ['nat', 'internet', 'vm', 'peering', 'vpn'];
        let targetErr: string | null = null;
        if (!types.includes(t.type)) targetErr = 'Choose a target';
        else if (t.type === 'nat' && !n.natGateway) targetErr = 'Enable the NAT gateway first';
        else if (t.type === 'vm') { const vm = db.get<VM>('vms', t.id); if (!vm || vm.networkId !== n.id) targetErr = 'Next-hop VM must be in this network' }
        else if (t.type === 'peering' || t.type === 'vpn') { if (!n.peerings.some((p) => p.networkId === t.id)) targetErr = 'Target must be a peered network' }
        validate({
          destination: (dest === '0.0.0.0/0' ? null : cidrShapeError(dest, 'Destination')) || (n.routes.some((r) => r.destination === dest && !r.system) && `A route for ${dest} already exists`) || (dest !== '0.0.0.0/0' && cidrContains(n.cidr, dest) && 'Destination is inside the VPC (covered by the local route)'),
          target: targetErr,
        });
        const rt: Route = { id: newId('rt'), destination: dest, target: { type: t.type, ...(t.id ? { id: t.id } : {}) }, description: body.description || undefined };
        db.update<Network>('networks', n.id, (row) => { row.routes.push(rt); return row });
        return rt;
      },
      removeRoute: (_ctx, n, body) => {
        const rt = n.routes.find((r) => r.id === body.routeId);
        if (!rt) throw new ApiError(404, 'Route not found', 'not_found');
        if (rt.system) throw new ApiError(409, 'System routes are managed by Autark and cannot be removed', 'protected');
        db.update<Network>('networks', n.id, (row) => { row.routes = row.routes.filter((r) => r.id !== rt.id); return row });
      },
      peer: (ctx, n, body) => {
        const other = db.get<Network>('networks', body.networkId);
        if (!other || other.accountId !== n.accountId) throw new ApiError(422, 'Choose a network in this account', 'validation_failed', { networkId: 'Unknown network' });
        if (other.id === n.id) throw new ApiError(422, 'A network cannot peer with itself', 'validation_failed', { networkId: 'Pick another network' });
        if (n.peerings.some((p) => p.networkId === other.id)) throw new ApiError(409, `Already peered with ${other.name}`, 'conflict');
        if (cidrOverlaps(n.cidr, other.cidr)) throw new ApiError(422, `Address ranges overlap (${n.cidr} ↔ ${other.cidr}). Peered networks need distinct CIDRs.`, 'validation_failed', { networkId: 'Overlapping CIDR' });
        if (n.status !== 'available' || other.status !== 'available') throw new ApiError(409, 'Both networks must be available', 'invalid_state');
        const kind: 'peering' | 'vpn' = n.locationId !== other.locationId ? 'vpn' : body.kind === 'vpn' ? 'vpn' : 'peering';
        const id = newId('peer');
        const at = nowIso();
        for (const [a, b] of [[n, other], [other, n]] as const) {
          db.update<Network>('networks', a.id, (row) => {
            row.peerings.push({ id, networkId: b.id, status: 'pending', kind, createdAt: at });
            if (body.routes !== false) row.routes.push({ id: newId('rt'), destination: b.cidr, target: { type: kind, id: b.id }, description: `To ${b.name}` });
            return row;
          });
        }
        startOperation({
          type: 'network.peer', title: `${kind === 'vpn' ? 'Site-to-site VPN' : 'Peering'} ${n.name} ↔ ${other.name}`, target: { type: 'network', id: n.id, name: n.name },
          steps: kind === 'vpn'
            ? [{ name: 'Generate WireGuard keys', ms: ms(0.6) }, { name: `Configure tunnel ${n.locationId} ↔ ${other.locationId}`, ms: ms(1.4), logs: ['handshake initiated', 'handshake complete, latency 7.8ms'] }, { name: 'Exchange routes', ms: ms(0.8), logs: [`${n.cidr} ⇄ ${other.cidr}`] }]
            : [{ name: 'Program fabric routes', ms: ms(1), logs: [`${n.cidr} ⇄ ${other.cidr}`] }, { name: 'Verify reachability', ms: ms(0.8), logs: ['ICMP probe ok'] }],
          scope: { accountId: n.accountId, projectId: n.projectId }, actor: ctx.actor, onComplete: 'network.peered', payload: { a: n.id, b: other.id }, silent: true,
        });
        return { id, kind };
      },
      unpeer: (_ctx, n, body) => {
        if (!n.peerings.some((p) => p.networkId === body.networkId)) throw new ApiError(404, 'Peering not found', 'not_found');
        removePeeringSide(n.id, body.networkId);
        removePeeringSide(body.networkId, n.id);
      },
    },
  });
}

/* =============================================================================================== */
/* IP addresses & pools                                                                             */
/* =============================================================================================== */

function poolTotal(p: IpPool): number {
  if (p.version === 6) return 65535 - 16;
  const c = parseCidr(p.cidr);
  return c ? Math.max(0, c.size - p.reserved - 2) : 0;
}

function pickFreeAddress(pool: IpPool): string {
  const used = poolUsed(pool.id);
  if (pool.version === 4) {
    const c = parseCidr(pool.cidr)!;
    for (let n = c.first + pool.reserved + 1; n < c.last; n++) { const a = intToIp(n); if (!used.has(a)) return a }
  } else {
    const prefix = pool.cidr.split('::')[0];
    for (let n = 16; n < 65535; n++) { const a = `${prefix}::${n.toString(16)}`; if (!used.has(a)) return a }
  }
  throw new ApiError(409, `IP pool ${pool.name} is exhausted`, 'pool_exhausted');
}

function requestedAddressError(pool: IpPool, address: string): string | null {
  if (pool.version === 6) return isValidIpv6(address) ? (poolUsed(pool.id).has(address) ? `${address} is already allocated` : null) : 'Not a valid IPv6 address';
  if (!isValidIp(address)) return 'Not a valid IPv4 address';
  const c = parseCidr(pool.cidr)!;
  const n = parseCidr(`${address}/32`)!.first;
  if (n < c.first || n > c.last) return `${address} is outside ${pool.cidr}`;
  if (n <= c.first + pool.reserved || n === c.last) return `${address} is reserved for infrastructure`;
  if (poolUsed(pool.id).has(address)) return `${address} is already allocated`;
  return null;
}

const ownerCollection = (t: string) => (t === 'vm' ? 'vms' : t === 'lb' ? 'loadBalancers' : null);

function ipTargetError(projectId: string, pool: IpPool | undefined, ref: Ref | null | undefined): string | null {
  if (!ref) return null;
  const col = ownerCollection(ref.type);
  if (!col) return 'Public IPs can be assigned to VMs and load balancers';
  const row = db.get<any>(col, ref.id);
  if (!row) return `${ref.type.toUpperCase()} ${ref.id} not found`;
  if (row.projectId !== projectId) return `${row.name} belongs to another project`;
  if (row.status === 'deleting') return `${row.name} is being deleted`;
  if (pool && row.locationId !== pool.locationId) return `${row.name} runs in ${row.locationId}, but this IP is from ${pool.locationId}`;
  return null;
}

function hostnameOk(s: string): boolean {
  return /^(?=.{1,253}\.?$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.?$/i.test(s);
}

function isValidIpv6(s: string): boolean {
  if (!/^[0-9a-f:]+$/i.test(s) || s.length < 2) return false;
  const dbl = s.split('::');
  if (dbl.length > 2) return false;
  const parts = (x: string) => (x ? x.split(':') : []);
  const head = parts(dbl[0]);
  const tail = dbl.length === 2 ? parts(dbl[1]) : [];
  const all = [...head, ...tail];
  if (all.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return false;
  return dbl.length === 2 ? all.length < 8 : all.length === 8;
}

function registerIps() {
  defineCollection<IpPool>({
    name: 'ipPools', kind: 'ipPool', idPrefix: 'pool', scoped: false, readonly: true, searchable: false,
    sort: (a, b) => a.locationId.localeCompare(b.locationId) || a.version - b.version,
    decorate: (p) => {
      const ips = db.filter<IpAddress>('ips', (i) => i.poolId === p.id);
      const total = poolTotal(p);
      return { ...p, allocated: ips.length, assigned: ips.filter((i) => i.assignedTo).length, total, utilization: total ? ips.length / total : 0 };
    },
  });

  route('GET', '/ipPools/:id/map', (ctx) => {
    const pool = getOr404<IpPool>('ipPools', ctx.params.id, 'IP pool');
    const ips = db.filter<IpAddress>('ips', (i) => i.poolId === pool.id);
    const byAddr = new Map(ips.map((i) => [i.address, i]));
    const ownerOf = (ip: IpAddress) => {
      if (!ip.assignedTo) return null;
      const col = ownerCollection(ip.assignedTo.type);
      const row = col ? db.get<any>(col, ip.assignedTo.id) : null;
      return { ...ip.assignedTo, name: row?.name };
    };
    const cellFor = (ip: IpAddress): IpCell => ip.accountId !== ctx.scope.accountId
      ? { address: ip.address, state: 'foreign' }
      : { address: ip.address, state: ip.assignedTo ? 'assigned' : 'allocated', ipId: ip.id, projectId: ip.projectId, owner: ownerOf(ip), reverseDns: ip.reverseDns, name: ip.name };
    const decorated = collectionsDecorate(pool);
    if (pool.version === 6) return { pool: decorated, cells: ips.map(cellFor), truncated: false };
    const c = parseCidr(pool.cidr)!;
    const count = Math.min(c.size, 256);
    const cells: IpCell[] = [];
    for (let i = 0; i < count; i++) {
      const n = c.first + i;
      const address = intToIp(n);
      const ip = byAddr.get(address);
      if (n === c.first) cells.push({ address, state: 'network' });
      else if (n === c.last) cells.push({ address, state: 'broadcast' });
      else if (n <= c.first + pool.reserved) cells.push({ address, state: 'reserved', name: i === 1 ? 'gateway' : 'infrastructure' });
      else cells.push(ip ? cellFor(ip) : { address, state: 'free' });
    }
    return { pool: decorated, cells, truncated: c.size > 256 };
  }, 'Address map of an IP pool (cells: free / reserved / assigned)');

  defineCollection<IpAddress>({
    name: 'ips', kind: 'ip', idPrefix: 'ip',
    searchText: (i) => `${i.id} ${i.address} ${i.name ?? ''} ${i.reverseDns ?? ''} ${i.assignedTo ? `${i.assignedTo.type} ${i.assignedTo.id}` : 'unassigned'}`,
    subtitle: (i) => `Public IPv${i.version} · ${i.assignedTo ? `${i.assignedTo.type} ${i.assignedTo.id}` : 'unassigned'}`,
    decorate: (i) => ({ ...i, monthlyCost: ipMonthly(i) }),
    sort: (a, b) => a.address.localeCompare(b.address, undefined, { numeric: true }),
    create: (ctx, body) => {
      const sc = scopeFor(ctx, body);
      const version: 4 | 6 = body.version === 6 ? 6 : 4;
      const pool = body.poolId ? db.get<IpPool>('ipPools', body.poolId) : body.locationId ? defaultPool(body.locationId, version) : undefined;
      validate({
        poolId: !pool && (body.poolId ? 'Unknown IP pool' : body.locationId ? `No IPv${version} pool in ${body.locationId}` : 'Choose a location or pool'),
        name: body.name ? nameError(body.name) : null,
        address: pool && body.address ? requestedAddressError(pool, String(body.address).trim()) : null,
        reverseDns: body.reverseDns && !hostnameOk(body.reverseDns) && 'Reverse DNS must be a hostname, e.g. web.regiocom-energie.de',
        assignTo: ipTargetError(sc.projectId, pool, body.assignTo),
      });
      checkLocationAllowed(sc.projectId, pool!.locationId);
      checkQuota(sc.projectId, { publicIps: 1 });
      return {
        id: newId('ip'), address: body.address ? String(body.address).trim() : pickFreeAddress(pool!), version: pool!.version, poolId: pool!.id, ...sc, assignedTo: null,
        reverseDns: body.reverseDns || null, ...(body.name ? { name: body.name } : {}), createdAt: nowIso(), tags: body.tags ?? [],
      };
    },
    afterCreate: (ctx, ip) => { if (ctx.body?.assignTo) assignIp(ip.id, { type: ctx.body.assignTo.type, id: ctx.body.assignTo.id }) },
    update: (_ctx, ip, patch) => {
      const next: IpAddress = { ...ip };
      if ('name' in patch) { validate({ name: patch.name ? nameError(patch.name) : null }); next.name = patch.name || undefined }
      if ('tags' in patch) next.tags = patch.tags ?? [];
      if ('reverseDns' in patch) { validate({ reverseDns: patch.reverseDns && !hostnameOk(patch.reverseDns) && 'Reverse DNS must be a hostname, e.g. web.regiocom-energie.de' }); next.reverseDns = patch.reverseDns || null }
      return next;
    },
    remove: (_ctx, ip) => {
      if (ip.assignedTo) {
        const col = ownerCollection(ip.assignedTo.type);
        const name = col ? db.get<any>(col, ip.assignedTo.id)?.name : null;
        throw new ApiError(409, `${ip.address} is assigned to ${ip.assignedTo.type} ${name ?? ip.assignedTo.id}. Unassign it before releasing.`, 'in_use');
      }
    },
    actions: {
      assign: (_ctx, ip, body) => {
        const ref: Ref = { type: body.type, id: body.id };
        const pool = db.get<IpPool>('ipPools', ip.poolId);
        validate({ target: !body.type || !body.id ? 'Choose a VM or load balancer' : ipTargetError(ip.projectId, pool, ref) });
        if (ip.assignedTo && !(ip.assignedTo.type === ref.type && ip.assignedTo.id === ref.id)) unassignIp(ip.id); // re-assign
        assignIp(ip.id, ref);
      },
      unassign: (_ctx, ip) => {
        if (!ip.assignedTo) throw new ApiError(409, `${ip.address} is not assigned`, 'conflict');
        unassignIp(ip.id);
      },
      setReverseDns: (_ctx, ip, body) => {
        const v = String(body.reverseDns ?? '').trim();
        validate({ reverseDns: v && !hostnameOk(v) && 'Reverse DNS must be a hostname, e.g. web.regiocom-energie.de' });
        db.update('ips', ip.id, { reverseDns: v || null } as any);
      },
    },
  });
}

/** decorate an IP pool outside the list endpoint */
function collectionsDecorate(p: IpPool): IpPool {
  const ips = db.filter<IpAddress>('ips', (i) => i.poolId === p.id);
  const total = poolTotal(p);
  return { ...p, allocated: ips.length, assigned: ips.filter((i) => i.assignedTo).length, total, utilization: total ? ips.length / total : 0 };
}

/* =============================================================================================== */
/* Firewalls                                                                                        */
/* =============================================================================================== */

const FW_TARGETS: Record<string, string> = { vm: 'vms', db: 'dbInstances', lb: 'loadBalancers', k8s: 'k8sClusters' };

function normalizeSource(s: unknown): string {
  const v = String(s ?? '').trim();
  if (!v || v === 'any' || v === '*') return '0.0.0.0/0';
  if (isValidIp(v)) return `${v}/32`;
  return v;
}

/** Validate & normalize a full rule list. Throws 422 with details keyed rules.{i}.{field}. */
function validateRules(input: unknown, existing: FirewallRule[] = []): FirewallRule[] {
  if (!Array.isArray(input)) throw new ApiError(422, 'rules must be a list', 'validation_failed', { rules: 'Invalid rules' });
  const errs: Record<string, string> = {};
  const out: FirewallRule[] = [];
  input.forEach((r: any, i: number) => {
    const direction = r.direction === 'outbound' ? 'outbound' : 'inbound';
    const protocol = ['tcp', 'udp', 'icmp', 'any'].includes(r.protocol) ? r.protocol : null;
    const ports = protocol === 'icmp' || protocol === 'any' && (!r.ports || r.ports === '*') ? '*' : String(r.ports ?? '').replace(/\s+/g, '');
    const source = normalizeSource(r.source);
    const priority = Number(r.priority);
    const label = `Rule ${i + 1}`;
    if (!protocol) errs[`rules.${i}.protocol`] = `${label}: choose a protocol`;
    if (!ports || !isValidPortSpec(ports)) errs[`rules.${i}.ports`] = `${label}: invalid ports "${r.ports ?? ''}" — use 22, 80,443, 8000-9000 or *`;
    if (source !== '0.0.0.0/0' && !isValidCidr(source)) {
      const p = parseCidr(source);
      errs[`rules.${i}.source`] = p ? `${label}: ${source} is not aligned — did you mean ${p.base}/${p.prefix}?` : `${label}: "${r.source}" is not a valid IP or CIDR`;
    }
    if (!Number.isInteger(priority) || priority < 1 || priority > 9999) errs[`rules.${i}.priority`] = `${label}: priority must be 1–9999`;
    else {
      const dup = out.find((o) => o.direction === direction && o.priority === priority);
      if (dup) errs[`rules.${i}.priority`] = `${label}: priority ${priority} is already used by another ${direction} rule`;
    }
    if (!['allow', 'deny'].includes(r.action)) errs[`rules.${i}.action`] = `${label}: action must be allow or deny`;
    const keepId = r.id && (existing.some((e) => e.id === r.id) || /^r-/.test(r.id)) && !out.some((o) => o.id === r.id);
    out.push({ id: keepId ? r.id : newId('r'), direction, protocol: protocol ?? 'tcp', ports, source, action: r.action === 'deny' ? 'deny' : 'allow', priority, description: String(r.description ?? '').slice(0, 200), enabled: r.enabled !== false });
  });
  if (Object.keys(errs).length) throw new ApiError(422, Object.values(errs)[0], 'validation_failed', { rules: Object.values(errs)[0], ...errs });
  return out;
}

function fwTargetRow(ref: Ref): any {
  const col = FW_TARGETS[ref.type];
  if (!col) throw new ApiError(422, 'Firewalls attach to VMs, databases, load balancers and Kubernetes clusters', 'validation_failed', { target: 'Unsupported type' });
  const row = db.get<any>(col, ref.id);
  if (!row) throw new ApiError(404, `${ref.type} ${ref.id} not found`, 'not_found');
  return row;
}

function attachFirewall(fw: Firewall, ref: Ref) {
  const row = fwTargetRow(ref);
  if (row.projectId !== fw.projectId) throw new ApiError(422, `${row.name} belongs to another project`, 'validation_failed', { target: 'Different project' });
  if (ref.type === 'k8s') {
    const cur = db.get<Firewall>('firewalls', fw.id)!;
    if (!cur.attachedTo.some((r) => r.type === ref.type && r.id === ref.id)) db.update('firewalls', fw.id, { attachedTo: [...cur.attachedTo, { type: ref.type, id: ref.id }] } as any);
    return;
  }
  const ids: string[] = row.firewallIds ?? [];
  setFirewalls({ type: ref.type, id: ref.id }, ids.includes(fw.id) ? ids : [...ids, fw.id]);
}

function detachFirewall(fw: Firewall, ref: Ref) {
  if (ref.type === 'k8s' || !FW_TARGETS[ref.type] || !db.get(FW_TARGETS[ref.type], ref.id)) {
    const cur = db.get<Firewall>('firewalls', fw.id)!;
    db.update('firewalls', fw.id, { attachedTo: cur.attachedTo.filter((r) => !(r.type === ref.type && r.id === ref.id)) } as any);
    return;
  }
  const row = db.get<any>(FW_TARGETS[ref.type], ref.id);
  setFirewalls({ type: ref.type, id: ref.id }, (row.firewallIds ?? []).filter((x: string) => x !== fw.id));
}

function protoMatches(rule: FirewallRule['protocol'], pkt: string) { return rule === 'any' || rule === pkt }

/** Packet tester: rules evaluated by priority (lowest first); first match wins, else default policy. */
export function evaluateFirewall(fw: Pick<Firewall, 'rules' | 'defaultInbound' | 'defaultOutbound'>, pkt: { direction: 'inbound' | 'outbound'; protocol: string; port?: number; ip: string }): FirewallEvaluation {
  const rules = fw.rules.filter((r) => r.direction === pkt.direction).sort((a, b) => a.priority - b.priority);
  const trace: FirewallTraceStep[] = [];
  let match: FirewallRule | null = null;
  const peer = pkt.direction === 'inbound' ? 'source' : 'destination';
  for (const r of rules) {
    if (match) { trace.push({ ruleId: r.id, priority: r.priority, matched: false, reason: 'not evaluated (earlier rule matched)' }); continue }
    let reason = '';
    if (!r.enabled) reason = 'rule disabled';
    else if (!protoMatches(r.protocol, pkt.protocol)) reason = `protocol ${pkt.protocol} ≠ ${r.protocol}`;
    else if (pkt.protocol !== 'icmp' && r.protocol !== 'icmp' && !portMatches(r.ports, pkt.port ?? 0)) reason = `port ${pkt.port} not in ${r.ports}`;
    else if (!ipInCidr(pkt.ip, r.source)) reason = `${peer} ${pkt.ip} not in ${r.source}`;
    if (reason) trace.push({ ruleId: r.id, priority: r.priority, matched: false, reason });
    else { match = r; trace.push({ ruleId: r.id, priority: r.priority, matched: true, reason: `matches ${r.protocol}/${r.ports} from ${r.source}` }) }
  }
  const def = pkt.direction === 'inbound' ? fw.defaultInbound : fw.defaultOutbound;
  const what = `${pkt.protocol.toUpperCase()}${pkt.protocol !== 'icmp' ? ` :${pkt.port}` : ''} ${pkt.direction === 'inbound' ? 'from' : 'to'} ${pkt.ip}`;
  return match
    ? { verdict: match.action, matchedRuleId: match.id, matchedBy: 'rule', reason: `${what} is ${match.action === 'allow' ? 'allowed' : 'denied'} by rule #${match.priority}${match.description ? ` “${match.description}”` : ''}`, trace }
    : { verdict: def, matchedRuleId: null, matchedBy: 'default', reason: `No rule matched — default ${pkt.direction} policy (${def}) applies to ${what}`, trace };
}

function registerFirewalls() {
  defineCollection<Firewall>({
    name: 'firewalls', kind: 'firewall', idPrefix: 'fw',
    searchText: (f) => `${f.id} ${f.name} ${f.description} ${f.rules.map((r) => `${r.ports} ${r.source} ${r.description}`).join(' ')}`,
    subtitle: (f) => `Firewall · ${f.rules.length} rules · ${f.attachedTo.length} attached`,
    create: (ctx, body) => {
      const sc = scopeFor(ctx, body);
      validate({
        name: nameError(body.name) || uniqueNameError('firewalls', body.name, sc),
        defaultInbound: body.defaultInbound && !['allow', 'deny'].includes(body.defaultInbound) && 'Invalid policy',
        defaultOutbound: body.defaultOutbound && !['allow', 'deny'].includes(body.defaultOutbound) && 'Invalid policy',
      });
      checkRequiredTags(sc.projectId, body.tags);
      const rules = validateRules(body.rules ?? []);
      for (const t of body.attachTo ?? []) {
        const row = fwTargetRow(t);
        if (row.projectId !== sc.projectId) throw new ApiError(422, `${row.name} belongs to another project`, 'validation_failed', { attachTo: 'Different project' });
      }
      return {
        id: newId('fw'), name: body.name, ...sc, description: String(body.description ?? ''), defaultInbound: body.defaultInbound ?? 'deny', defaultOutbound: body.defaultOutbound ?? 'allow',
        rules, attachedTo: [], createdAt: nowIso(), tags: body.tags ?? [],
      };
    },
    afterCreate: (ctx, fw) => { for (const t of ctx.body?.attachTo ?? []) attachFirewall(db.get<Firewall>('firewalls', fw.id)!, t) },
    update: (_ctx, fw, patch) => {
      const next: Firewall = { ...fw };
      if ('name' in patch) { validate({ name: nameError(patch.name) || uniqueNameError('firewalls', patch.name, fw, fw.id) }); next.name = patch.name }
      if ('description' in patch) next.description = String(patch.description ?? '');
      if ('tags' in patch) { checkRequiredTags(fw.projectId, patch.tags); next.tags = patch.tags ?? [] }
      for (const k of ['defaultInbound', 'defaultOutbound'] as const) {
        if (k in patch) { validate({ [k]: !['allow', 'deny'].includes(patch[k]) && 'Policy must be allow or deny' }); next[k] = patch[k] }
      }
      if ('rules' in patch) next.rules = validateRules(patch.rules, fw.rules);
      return next;
    },
    remove: (ctx, fw) => {
      if (fw.attachedTo.length) {
        if (ctx.query.get('force') !== 'true') {
          const names = fw.attachedTo.map((r) => ({ name: `${r.type} ${(FW_TARGETS[r.type] && db.get<any>(FW_TARGETS[r.type], r.id)?.name) || r.id}` }));
          throw new ApiError(409, `${fw.name} is attached to ${list(names)}. Detach first or delete with force.`, 'in_use');
        }
        for (const ref of [...fw.attachedTo]) detachFirewall(db.get<Firewall>('firewalls', fw.id)!, ref);
      }
    },
    actions: {
      addRule: (_ctx, fw, body) => {
        const rules = validateRules([...fw.rules, body], fw.rules);
        db.update('firewalls', fw.id, { rules } as any);
        return rules[rules.length - 1];
      },
      updateRule: (_ctx, fw, body) => {
        if (!fw.rules.some((r) => r.id === body.id)) throw new ApiError(404, 'Rule not found', 'not_found');
        const rules = validateRules(fw.rules.map((r) => (r.id === body.id ? { ...r, ...body } : r)), fw.rules);
        db.update('firewalls', fw.id, { rules } as any);
      },
      removeRule: (_ctx, fw, body) => {
        if (!fw.rules.some((r) => r.id === body.id)) throw new ApiError(404, 'Rule not found', 'not_found');
        db.update('firewalls', fw.id, { rules: fw.rules.filter((r) => r.id !== body.id) } as any);
      },
      attach: (_ctx, fw, body) => {
        const targets: Ref[] = body.targets ?? (body.type ? [{ type: body.type, id: body.id }] : []);
        if (!targets.length) throw new ApiError(422, 'Choose at least one resource', 'validation_failed', { targets: 'Required' });
        for (const t of targets) attachFirewall(db.get<Firewall>('firewalls', fw.id)!, t);
      },
      detach: (_ctx, fw, body) => {
        if (!fw.attachedTo.some((r) => r.type === body.type && r.id === body.id)) throw new ApiError(409, 'Not attached to that resource', 'conflict');
        detachFirewall(fw, { type: body.type, id: body.id });
      },
      setAttachments: (_ctx, fw, body) => {
        const want: Ref[] = body.targets ?? [];
        const key = (r: Ref) => `${r.type}:${r.id}`;
        const wantKeys = new Set(want.map(key));
        for (const r of fw.attachedTo) if (!wantKeys.has(key(r))) detachFirewall(db.get<Firewall>('firewalls', fw.id)!, r);
        for (const r of want) attachFirewall(db.get<Firewall>('firewalls', fw.id)!, r);
      },
      duplicate: (ctx, fw, body) => {
        const name = body.name || `${fw.name}-copy`;
        validate({ name: nameError(name) || uniqueNameError('firewalls', name, fw) });
        const copy: Firewall = { ...structuredClone(fw), id: newId('fw'), name, attachedTo: [], createdAt: nowIso(), rules: fw.rules.map((r) => ({ ...r, id: newId('r') })) };
        db.insert('firewalls', copy as any);
        void ctx;
        return copy;
      },
      evaluate: (_ctx, fw, body) => {
        const direction = body.direction === 'outbound' ? 'outbound' : 'inbound';
        const protocol = ['tcp', 'udp', 'icmp'].includes(body.protocol) ? body.protocol : 'tcp';
        const port = Number(body.port);
        const ip = String(body.ip ?? '').trim();
        validate({
          ip: !isValidIp(ip) && 'Enter a valid IPv4 address',
          port: protocol !== 'icmp' && !(Number.isInteger(port) && port >= 0 && port <= 65535) && 'Port must be 0–65535',
        });
        const rules = body.rules ? validateRules(body.rules, fw.rules) : fw.rules;
        const pol = (v: unknown, d: 'allow' | 'deny') => (v === 'allow' || v === 'deny' ? v : d);
        return evaluateFirewall({ rules, defaultInbound: pol(body.defaultInbound, fw.defaultInbound), defaultOutbound: pol(body.defaultOutbound, fw.defaultOutbound) }, { direction, protocol, port, ip });
      },
    },
  });
}

/* =============================================================================================== */
/* DNS                                                                                              */
/* =============================================================================================== */

const RECORD_TYPES: DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'NS', 'CAA', 'PTR'];
const ZONE_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;
const LABELS_RE = /^(\*|[a-z0-9_]([a-z0-9_-]{0,62})?)(\.[a-z0-9_]([a-z0-9_-]{0,62})?)*$/;

function bumpSerial(serial: number): number {
  const d = new Date();
  const today = Number(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`) * 100;
  return serial >= today ? serial + 1 : today + 1;
}

function relName(zone: DnsZone, raw: unknown): string {
  let n = String(raw ?? '').trim().toLowerCase();
  if (!n || n === '@' || n === `${zone.name}.` || n === zone.name) return '@';
  if (n.endsWith(`.${zone.name}.`)) n = n.slice(0, -(zone.name.length + 2));
  else if (n.endsWith('.')) return n; // FQDN outside the zone — rejected by caller
  return n;
}

function fqdnValue(v: string): string {
  const s = v.trim();
  if (s === '@') return s;
  return s.includes('.') && !s.endsWith('.') ? `${s}.` : s;
}

/** Validate & normalize a DNS record. Throws 422 with field details. */
function normalizeRecord(zone: DnsZone, input: any, exceptId?: string): DnsRecord {
  const type: DnsRecordType = String(input.type ?? '').toUpperCase() as DnsRecordType;
  if (!RECORD_TYPES.includes(type)) throw new ApiError(422, 'Unsupported record type', 'validation_failed', { type: 'Unsupported type' });
  const name = relName(zone, input.name);
  const ttl = input.ttl == null || input.ttl === '' ? zone.defaultTtl : Number(input.ttl);
  let value = String(input.value ?? '').trim();
  let priority: number | undefined = input.priority == null || input.priority === '' ? undefined : Number(input.priority);
  const errs: Record<string, string | false | null> = {
    name: name.endsWith('.') ? `Name must be inside ${zone.name}` : !(name === '@' || LABELS_RE.test(name)) && 'Use letters, digits, - and _ (e.g. www, _dmarc, @ for apex)',
    ttl: !(Number.isInteger(ttl) && ttl >= 30 && ttl <= 86400) && 'TTL must be 30–86400 seconds',
  };
  switch (type) {
    case 'A': errs.value = !isValidIp(value) && 'A records need an IPv4 address, e.g. 203.0.113.10'; break;
    case 'AAAA': errs.value = !isValidIpv6(value) && 'AAAA records need an IPv6 address, e.g. 2001:db8::10'; break;
    case 'CNAME': case 'NS': case 'PTR':
      value = fqdnValue(value);
      errs.value = !hostnameOk(value) && `${type} target must be a hostname, e.g. host.regiocom-energie.de.`;
      if (type === 'CNAME' && name === '@') errs.name = 'CNAME is not allowed at the zone apex (use A/AAAA or ALIAS via a load balancer)';
      break;
    case 'MX':
      value = fqdnValue(value);
      errs.value = !hostnameOk(value) && 'MX target must be a mail server hostname';
      errs.priority = !(priority != null && Number.isInteger(priority) && priority >= 0 && priority <= 65535) && 'MX priority 0–65535 is required';
      break;
    case 'TXT':
      value = value.replace(/^"(.*)"$/s, '$1');
      errs.value = !value ? 'TXT value is required' : value.length > 2048 && 'TXT value too long (max 2048)';
      break;
    case 'SRV': {
      const parts = value.split(/\s+/);
      if (parts.length === 4) { priority = priority ?? Number(parts[0]); parts.shift() }
      const [w, port, target] = parts;
      const ok = parts.length === 3 && intIn(Number(w), 0, 65535) && intIn(Number(port), 1, 65535) && hostnameOk(target ?? '');
      errs.value = !ok && 'SRV value is "weight port target", e.g. 10 5060 sip.regiocom-energie.de.';
      errs.priority = !(priority != null && intIn(priority, 0, 65535)) && 'SRV priority 0–65535 is required';
      if (!/^_[a-z0-9-]+\._(tcp|udp|tls)(\.|$)/.test(name)) errs.name = 'SRV names look like _service._tcp (e.g. _sip._tcp)';
      if (ok) value = `${Number(w)} ${Number(port)} ${fqdnValue(target)}`;
      break;
    }
    case 'CAA':
      errs.value = !/^\d{1,3}\s+(issue|issuewild|iodef)\s+"[^"]*"$/.test(value) && 'CAA value is: flags tag "value", e.g. 0 issue "letsencrypt.org"';
      break;
  }
  validate(errs);
  const others = zone.records.filter((r) => r.id !== exceptId && r.name === name);
  if (type === 'CNAME' && others.length) throw new ApiError(422, `${name} already has ${others[0].type} records — a CNAME cannot coexist with other records`, 'validation_failed', { name: 'Conflicts with existing records' });
  if (type !== 'CNAME' && others.some((r) => r.type === 'CNAME')) throw new ApiError(422, `${name} is a CNAME — no other records may share its name`, 'validation_failed', { name: 'Name is a CNAME' });
  if (others.some((r) => r.type === type && r.value === value)) throw new ApiError(409, `An identical ${type} record for ${name} already exists`, 'conflict');
  return { id: exceptId ?? newId('rec'), type, name, value, ttl, ...(type === 'MX' || type === 'SRV' ? { priority } : {}), managedBy: null };
}

function saveRecords(zone: DnsZone, records: DnsRecord[]) {
  db.update('dnsZones', zone.id, { records, serial: bumpSerial(zone.serial) } as any);
}

function srvRdata(r: DnsRecord) {
  return r.value.split(/\s+/).length === 4 ? r.value : `${r.priority ?? 0} ${r.value}`;
}

/** Render a zone in BIND format. */
export function zoneToBind(z: DnsZone): string {
  const pad = (s: string, n: number) => (s.length >= n ? `${s} ` : s.padEnd(n));
  const lines = [
    `; Zone file for ${z.name} — exported from Autark ${nowIso()}`,
    `$ORIGIN ${z.name}.`,
    `$TTL ${z.defaultTtl}`,
    `@ IN SOA ${z.nameservers[0]?.includes('.') ? `${z.nameservers[0]}.` : 'ns1.autark.example.'} hostmaster.${z.name}. (`,
    `      ${z.serial} ; serial`,
    '      3600       ; refresh',
    '      600        ; retry',
    '      1209600    ; expire',
    '      300 )      ; negative TTL',
    '',
  ];
  if (z.kind === 'public' && !z.records.some((r) => r.type === 'NS' && r.name === '@')) for (const ns of z.nameservers) lines.push(`${pad('@', 24)}${pad(String(z.defaultTtl), 7)}IN  ${pad('NS', 6)}${ns}.`);
  const rank = (n: string) => (n === '@' ? 0 : 1);
  const sorted = [...z.records].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name) || a.type.localeCompare(b.type) || (a.priority ?? 0) - (b.priority ?? 0));
  for (const r of sorted) {
    const rdata = r.type === 'TXT' ? `"${r.value.replace(/"/g, '\\"')}"` : r.type === 'MX' ? `${r.priority ?? 10} ${r.value}` : r.type === 'SRV' ? srvRdata(r) : r.value;
    lines.push(`${pad(r.name, 24)}${pad(String(r.ttl), 7)}IN  ${pad(r.type, 6)}${rdata}${r.managedBy ? `  ; managed by ${r.managedBy.type} ${r.managedBy.id}` : ''}`);
  }
  return lines.join('\n') + '\n';
}

/** Parse a BIND zone file into record inputs (best effort; SOA is ignored). */
export function parseBind(text: string, zoneName: string): { records: { line: number; text: string; rec: any }[]; skipped: ZoneImportResult['skipped'] } {
  const records: { line: number; text: string; rec: any }[] = [];
  const skipped: ZoneImportResult['skipped'] = [];
  let origin = `${zoneName}.`;
  let defTtl: number | undefined;
  let last = '@';
  // join parenthesised multi-line entries
  const raw = text.replace(/\r/g, '').split('\n');
  const logical: { line: number; text: string }[] = [];
  let buf = ''; let start = 0; let depth = 0;
  raw.forEach((l, i) => {
    const noComment = l.replace(/;(?=(?:[^"]*"[^"]*")*[^"]*$).*/, '');
    if (!depth) { buf = noComment; start = i + 1 } else buf += ' ' + noComment.trim();
    depth += (noComment.match(/\(/g) ?? []).length - (noComment.match(/\)/g) ?? []).length;
    if (depth <= 0) { depth = 0; if (buf.trim()) logical.push({ line: start, text: buf.replace(/[()]/g, ' ') }) }
  });
  for (const { line, text: l } of logical) {
    const t = l.trim();
    if (t.startsWith('$ORIGIN')) { origin = t.split(/\s+/)[1] ?? origin; if (!origin.endsWith('.')) origin += '.'; continue }
    if (t.startsWith('$TTL')) { defTtl = Number(t.split(/\s+/)[1]); continue }
    if (t.startsWith('$')) { skipped.push({ line, text: t, reason: 'Unsupported directive' }); continue }
    const tokens = t.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
    let name: string;
    if (/^\s/.test(l)) name = last; else name = tokens.shift()!;
    let ttl: number | undefined;
    let type = '';
    while (tokens.length) {
      const tok = tokens.shift()!;
      const up = tok.toUpperCase();
      if (/^\d+$/.test(tok) && ttl == null) ttl = Number(tok);
      else if (up === 'IN') continue;
      else { type = up; break }
    }
    last = name;
    if (type === 'SOA') continue;
    if (!RECORD_TYPES.includes(type as DnsRecordType)) { skipped.push({ line, text: t, reason: type ? `Unsupported type ${type}` : 'Could not parse' }); continue }
    // resolve name relative to the zone
    let fq = name === '@' ? origin : name.endsWith('.') ? name : `${name}.${origin}`;
    fq = fq.toLowerCase();
    if (fq !== `${zoneName}.` && !fq.endsWith(`.${zoneName}.`)) { skipped.push({ line, text: t, reason: `Name ${fq} is outside ${zoneName}` }); continue }
    const rel = fq === `${zoneName}.` ? '@' : fq.slice(0, -(zoneName.length + 2));
    let priority: number | undefined;
    let value: string;
    if (type === 'MX') { priority = Number(tokens.shift()); value = tokens.join(' ') }
    else if (type === 'SRV') { priority = Number(tokens.shift()); value = tokens.join(' ') }
    else if (type === 'TXT') value = tokens.map((x) => x.replace(/^"|"$/g, '').replace(/\\"/g, '"')).join('');
    else value = tokens.join(' ');
    // relative hostnames → absolute
    if (['CNAME', 'NS', 'PTR', 'MX'].includes(type) && value && !value.endsWith('.') && value !== '@') value = `${value}.${origin}`;
    if (type === 'SRV') { const p = value.split(/\s+/); if (p[2] && !p[2].endsWith('.')) p[2] = `${p[2]}.${origin}`; value = p.join(' ') }
    records.push({ line, text: t, rec: { type, name: rel, ttl: ttl ?? defTtl, value, priority } });
  }
  return { records, skipped };
}

function dsFor(z: DnsZone): string {
  let h = 0;
  for (const c of z.id + z.name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hex = Array.from({ length: 8 }, (_, i) => ((h * (i + 7) * 2654435761) >>> 0).toString(16).padStart(8, '0')).join('').toUpperCase();
  return `${z.name}. 3600 IN DS ${10000 + (h % 50000)} 13 2 ${hex}`;
}

function registerDns() {
  defineCollection<DnsZone>({
    name: 'dnsZones', kind: 'dnsZone', idPrefix: 'zone',
    searchText: (z) => `${z.id} ${z.name} ${z.kind} ${z.records.map((r) => `${r.name} ${r.value}`).join(' ')}`,
    subtitle: (z) => `${z.kind === 'public' ? 'Public' : 'Private'} DNS zone · ${z.records.length} records`,
    decorate: (z) => ({ ...z, monthlyCost: dnsMonthly(z) }),
    sort: (a, b) => a.name.localeCompare(b.name),
    create: (ctx, body) => {
      const sc = scopeFor(ctx, body);
      const name = String(body.name ?? '').trim().toLowerCase().replace(/\.$/, '');
      const kind: DnsZone['kind'] = body.kind === 'private' ? 'private' : 'public';
      const net = body.networkId ? db.get<Network>('networks', body.networkId) : undefined;
      const ttl = body.defaultTtl ?? 3600;
      validate({
        name: !name ? 'Domain is required' : !ZONE_RE.test(name) ? 'Enter a domain like regiocom-energie.de or app.internal' :
          kind === 'public' ? (db.find<DnsZone>('dnsZones', (z) => z.kind === 'public' && z.name === name) && `${name} is already hosted on this platform`) :
            (db.find<DnsZone>('dnsZones', (z) => z.kind === 'private' && z.name === name && z.networkId === body.networkId) && `${name} already exists in that VPC`),
        networkId: kind === 'private' && (!net ? 'Private zones must be bound to a VPC' : net.projectId !== sc.projectId && 'VPC belongs to another project'),
        defaultTtl: !intIn(ttl, 30, 86400) && 'TTL must be 30–86400 seconds',
        dnssec: kind === 'private' && body.dnssec && 'DNSSEC is only available for public zones',
      });
      checkRequiredTags(sc.projectId, body.tags);
      const zone: DnsZone = {
        id: newId('zone'), name, ...sc, kind, networkId: kind === 'private' ? net!.id : null, dnssec: !!body.dnssec, defaultTtl: ttl, serial: bumpSerial(0),
        nameservers: kind === 'public' ? ['ns1.autark.example', 'ns2.autark.example'] : [nthHost(net!.cidr, 2)],
        records: [], status: kind === 'public' ? 'pending-delegation' : 'active', createdAt: nowIso(), tags: body.tags ?? [],
        ...(body.description ? { description: String(body.description) } : {}),
      };
      if (kind === 'public') zone.records = zone.nameservers.map((ns) => ({ id: newId('rec'), type: 'NS' as const, name: '@', value: `${ns}.`, ttl: 86400, managedBy: null, system: true }));
      if (zone.dnssec) zone.dsRecord = dsFor(zone);
      return zone;
    },
    afterCreate: (_ctx, z) => {
      if (z.kind === 'private' && z.networkId) {
        const n = db.get<Network>('networks', z.networkId);
        if (n && !n.dnsZoneId) db.update('networks', n.id, { dnsZoneId: z.id } as any);
      }
    },
    update: (_ctx, z, patch) => {
      const next: DnsZone = { ...z };
      if ('description' in patch) next.description = patch.description || undefined;
      if ('tags' in patch) { checkRequiredTags(z.projectId, patch.tags); next.tags = patch.tags ?? [] }
      if ('defaultTtl' in patch) { validate({ defaultTtl: !intIn(patch.defaultTtl, 30, 86400) && 'TTL must be 30–86400 seconds' }); next.defaultTtl = patch.defaultTtl; next.serial = bumpSerial(z.serial) }
      if ('networkId' in patch && z.kind === 'private') {
        const n = db.get<Network>('networks', patch.networkId);
        validate({ networkId: (!n || n.projectId !== z.projectId) && 'Choose a VPC in this project' });
        next.networkId = n!.id;
        next.nameservers = [nthHost(n!.cidr, 2)];
      }
      return next;
    },
    remove: (_ctx, z) => {
      for (const n of db.filter<Network>('networks', (n) => n.dnsZoneId === z.id)) db.update('networks', n.id, { dnsZoneId: null } as any);
    },
    actions: {
      addRecord: (_ctx, z, body) => {
        const rec = normalizeRecord(z, body);
        saveRecords(z, [...z.records, rec]);
        return rec;
      },
      updateRecord: (_ctx, z, body) => {
        const cur = z.records.find((r) => r.id === body.id);
        if (!cur) throw new ApiError(404, 'Record not found', 'not_found');
        if (cur.system) throw new ApiError(409, 'Apex NS records are managed by Autark', 'protected');
        if (cur.managedBy && !body.force) throw new ApiError(409, `This record is managed by ${cur.managedBy.type} ${cur.managedBy.id}; change it there (or pass force to detach it).`, 'managed');
        const rec = normalizeRecord(z, { ...cur, ...body }, cur.id);
        saveRecords(z, z.records.map((r) => (r.id === cur.id ? rec : r)));
        return rec;
      },
      deleteRecord: (_ctx, z, body) => {
        const ids: string[] = body.ids ?? [body.id];
        const targets = z.records.filter((r) => ids.includes(r.id));
        if (!targets.length) throw new ApiError(404, 'Record not found', 'not_found');
        const sys = targets.find((r) => r.system);
        if (sys) throw new ApiError(409, 'Apex NS records are managed by Autark and cannot be deleted', 'protected');
        const managed = targets.find((r) => r.managedBy);
        if (managed && !body.force) throw new ApiError(409, `${managed.name} ${managed.type} is managed by ${managed.managedBy!.type} ${managed.managedBy!.id}. Delete with force to remove it anyway.`, 'managed');
        saveRecords(z, z.records.filter((r) => !ids.includes(r.id)));
      },
      importZone: (_ctx, z, body): ZoneImportResult => {
        const text = String(body.text ?? '');
        if (!text.trim()) throw new ApiError(422, 'Paste a zone file', 'validation_failed', { text: 'Required' });
        const { records, skipped } = parseBind(text, z.name);
        const replace = body.mode === 'replace';
        let working: DnsZone = { ...z, records: replace ? z.records.filter((r) => r.system || r.managedBy) : [...z.records] };
        let imported = 0; let updated = 0;
        for (const { line, text: t, rec } of records) {
          if (rec.type === 'NS' && rec.name === '@' && z.kind === 'public') { skipped.push({ line, text: t, reason: 'Apex NS is managed by Autark' }); continue }
          const existing = working.records.find((r) => r.type === rec.type && r.name === rec.name && r.value === fqdnValue(rec.value) && !r.system);
          try {
            if (existing) {
              if (existing.ttl !== (rec.ttl ?? z.defaultTtl) || existing.priority !== rec.priority) {
                const n = normalizeRecord(working, { ...rec }, existing.id);
                working = { ...working, records: working.records.map((r) => (r.id === existing.id ? { ...n, managedBy: existing.managedBy ?? null } : r)) };
                updated++;
              } else skipped.push({ line, text: t, reason: 'Already exists' });
              continue;
            }
            const n = normalizeRecord(working, rec);
            working = { ...working, records: [...working.records, n] };
            imported++;
          } catch (e) {
            skipped.push({ line, text: t, reason: e instanceof ApiError ? e.message : 'Invalid record' });
          }
        }
        if (imported || updated || replace) saveRecords(z, working.records);
        return { imported, updated, skipped };
      },
      setDnssec: (ctx, z, body) => {
        const enabled = !!body.enabled;
        if (z.kind === 'private' && enabled) throw new ApiError(422, 'DNSSEC is only available for public zones', 'validation_failed');
        if (enabled === z.dnssec) return db.get('dnsZones', z.id);
        db.update('dnsZones', z.id, { dnssec: enabled, dsRecord: enabled ? dsFor(z) : null, serial: bumpSerial(z.serial) } as any);
        startOperation({
          type: enabled ? 'dns.dnssec.enable' : 'dns.dnssec.disable', title: `${enabled ? 'Enable' : 'Disable'} DNSSEC for ${z.name}`, target: { type: 'dnsZone', id: z.id, name: z.name },
          steps: enabled
            ? [{ name: 'Generate KSK & ZSK (ECDSA P-256)', ms: ms(0.8) }, { name: `Sign ${z.records.length} record sets`, ms: ms(1.2), logs: ['RRSIG generated', 'NSEC3 chain built'] }, { name: 'Publish DNSKEY on nameservers', ms: ms(0.6) }]
            : [{ name: 'Remove signatures', ms: ms(0.8) }, { name: 'Unpublish DNSKEY', ms: ms(0.6), logs: ['Remember to remove the DS record at your registrar first'] }],
          scope: { accountId: z.accountId, projectId: z.projectId }, actor: ctx.actor, silent: true,
        });
      },
      checkDelegation: (ctx, z) => {
        if (z.kind === 'private') throw new ApiError(422, 'Private zones are not delegated', 'validation_failed');
        startOperation({
          type: 'dns.delegation', title: `Check delegation of ${z.name}`, target: { type: 'dnsZone', id: z.id, name: z.name },
          steps: [
            { name: `Query parent zone for ${z.name} NS`, ms: ms(1), logs: z.nameservers.map((n) => `found NS ${n}.`) },
            { name: 'Verify SOA serial on all nameservers', ms: ms(0.8), logs: z.nameservers.map((n) => `${n}: serial ${z.serial}`) },
            ...(z.dnssec ? [{ name: 'Validate DS ↔ DNSKEY chain', ms: ms(0.6), logs: ['chain of trust valid'] }] : []),
          ],
          scope: { accountId: z.accountId, projectId: z.projectId }, actor: ctx.actor, onComplete: 'generic.patch', payload: { collection: 'dnsZones', id: z.id, patch: { status: 'active' } }, silent: false,
        });
        return { ok: true };
      },
    },
  });

  route('GET', '/dnsZones/:id/export', (ctx) => {
    const z = getOr404<DnsZone>('dnsZones', ctx.params.id, 'DNS zone');
    if (z.accountId !== ctx.scope.accountId) throw new ApiError(404, 'DNS zone not found', 'not_found');
    return { filename: `${z.name}.zone`, contentType: 'text/dns', text: zoneToBind(z) };
  }, 'Export a DNS zone as a BIND zone file');
}

/* =============================================================================================== */

export function registerNetwork() {
  registerNetworks();
  registerIps();
  registerFirewalls();
  registerDns();
}
