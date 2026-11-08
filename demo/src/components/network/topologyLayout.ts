import type { Network, VM, DbInstance, LoadBalancer, K8sCluster, IpAddress, Firewall, Location, Subnet } from '@/types';
import { KINDS } from '@/lib/kinds';
import { subnetColor } from './util';

/* Deterministic column/lane layout for the global topology map (no physics):
 *   location → VPC → subnet / LB → resource → public IP → internet edge
 * Each leaf (resource, LB, empty subnet) owns one or more rows; parents are centered on their children. */

export type TKind = 'internet' | 'location' | 'network' | 'subnet' | 'lb' | 'vm' | 'db' | 'k8s' | 'ip';
export type FilterKind = 'vm' | 'db' | 'lb' | 'k8s' | 'ip';

export interface TNode {
  id: string; kind: TKind; label: string; sub?: string;
  x: number; y: number; w: number; h: number; // y = vertical center
  status?: string; color: string; link?: string; projectId?: string;
  ref?: any; fw?: Firewall[]; badges?: string[]; search: string; parent?: string; collapsedCount?: number;
}
export interface TEdge { id: string; from: string; to: string; kind: 'tree' | 'peering' | 'vpn' | 'lbTarget' | 'exposure'; tone?: string; label?: string }

export interface TopologyData {
  locations: Location[]; networks: Network[]; vms: VM[]; dbs: DbInstance[]; lbs: LoadBalancer[]; k8s: K8sCluster[]; ips: IpAddress[]; firewalls: Firewall[];
}
export interface LayoutOpts { kinds: Set<FilterKind>; projectId: string; collapsed: Set<string> }
export interface Layout { nodes: TNode[]; edges: TEdge[]; width: number; height: number; byId: Map<string, TNode> }

export const COL = { location: 0, network: 250, subnet: 480, res: 720, ip: 975, internet: 1170 };
export const W = { location: 170, network: 180, subnet: 180, res: 200, ip: 150, internet: 120 };
const ROW = 40;
const NET_GAP = 22;
const LOC_GAP = 40;
const SUBNET_GAP = 6;

export const nid = (kind: string, id: string) => `${kind}:${id}`;

export function layoutTopology(d: TopologyData, o: LayoutOpts): Layout {
  const nodes: TNode[] = [];
  const edges: TEdge[] = [];
  const byId = new Map<string, TNode>();
  const add = (n: TNode) => { nodes.push(n); byId.set(n.id, n); return n };
  const edge = (e: TEdge) => edges.push(e);
  const inProject = (r: { projectId?: string }) => o.projectId === 'all' || r.projectId === o.projectId;

  const fwByRef = new Map<string, Firewall[]>();
  for (const f of d.firewalls) for (const r of f.attachedTo) { const k = `${r.type}:${r.id}`; fwByRef.set(k, [...(fwByRef.get(k) ?? []), f]) }
  const ipsOf = (type: 'vm' | 'lb' | 'k8s', id: string) => (o.kinds.has('ip') ? d.ips.filter((i) => i.assignedTo?.type === type && i.assignedTo.id === id) : []);

  const nets = d.networks.filter(inProject);
  const locIds = [...new Set(nets.map((n) => n.locationId))];
  const locs = locIds.map((id) => d.locations.find((l) => l.id === id) ?? ({ id, name: id, kind: 'selfHosted', city: '', country: '', lat: 0, lon: 0 } as Location))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'selfHosted' ? -1 : 1));

  let y = 0;
  const ipNodes: TNode[] = [];

  const placeIps = (owner: TNode, ips: IpAddress[], top: number) => {
    ips.forEach((ip, i) => {
      const n = add({ id: nid('ip', ip.id), kind: 'ip', label: ip.address, sub: ip.reverseDns ?? ip.name ?? (ip.version === 6 ? 'IPv6' : 'IPv4'), x: COL.ip, y: top + i * ROW + ROW / 2, w: W.ip, h: 26,
        color: KINDS.ip.color, link: KINDS.ip.link?.(ip.id), projectId: ip.projectId, ref: ip, search: `${ip.address} ${ip.reverseDns ?? ''}`, parent: owner.id });
      ipNodes.push(n);
      edge({ id: `${owner.id}>${n.id}`, from: owner.id, to: n.id, kind: 'tree' });
    });
  };

  for (const loc of locs) {
    const locStart = y;
    const locNode = add({ id: nid('location', loc.id), kind: 'location', label: loc.name, sub: loc.city ? `${loc.city}, ${loc.country}` : loc.id, x: COL.location, y: 0, w: W.location, h: 50,
      color: loc.kind === 'cloud' ? '#0ea5e9' : '#10b981', search: `${loc.name} ${loc.city}`, ref: loc, badges: [loc.kind === 'cloud' ? 'cloud' : 'own DC'] });
    const locNets = nets.filter((n) => n.locationId === loc.id).sort((a, b) => a.name.localeCompare(b.name));
    for (const net of locNets) {
      const netStart = y;
      const r = {
        vms: o.kinds.has('vm') ? d.vms.filter((v) => v.networkId === net.id) : [],
        dbs: o.kinds.has('db') ? d.dbs.filter((v) => v.networkId === net.id) : [],
        lbs: o.kinds.has('lb') ? d.lbs.filter((v) => v.networkId === net.id) : [],
        k8s: o.kinds.has('k8s') ? d.k8s.filter((v) => v.networkId === net.id) : [],
      };
      const collapsed = o.collapsed.has(net.id);
      const total = r.vms.length + r.dbs.length + r.lbs.length + r.k8s.length;
      const netNode = add({ id: nid('network', net.id), kind: 'network', label: net.name, sub: net.cidr, x: COL.network, y: 0, w: W.network, h: 46, status: net.status, color: KINDS.network.color,
        link: KINDS.network.link?.(net.id), projectId: net.projectId, ref: net, search: `${net.name} ${net.cidr}`, parent: locNode.id, collapsedCount: collapsed ? total + net.subnets.length : undefined,
        badges: [...(net.natGateway ? ['NAT'] : []), ...(net.mtu > 1500 ? ['jumbo'] : [])] });
      edge({ id: `${locNode.id}>${netNode.id}`, from: locNode.id, to: netNode.id, kind: 'tree' });

      if (collapsed) { y += ROW + 8 }
      else {
        for (const lb of r.lbs) {
          const ips = ipsOf('lb', lb.id);
          const rows = Math.max(1, ips.length);
          const n = add({ id: nid('lb', lb.id), kind: 'lb', label: lb.name, sub: `${lb.type} · ${lb.algorithm?.replace(/_/g, ' ') ?? ''}`, x: COL.subnet, y: y + (rows * ROW) / 2, w: W.subnet, h: 34, status: lb.status, color: KINDS.lb.color,
            link: KINDS.lb.link?.(lb.id), projectId: lb.projectId, ref: lb, fw: fwByRef.get(`lb:${lb.id}`), search: `${lb.name} ${lb.hostname}`, parent: netNode.id });
          edge({ id: `${netNode.id}>${n.id}`, from: netNode.id, to: n.id, kind: 'tree' });
          placeIps(n, ips, y);
          y += rows * ROW;
        }
        net.subnets.forEach((s: Subnet, si: number) => {
          const subStart = y;
          const res: { kind: 'vm' | 'db' | 'k8s'; row: any }[] = [
            ...r.k8s.filter((k) => k.subnetId === s.id).map((row) => ({ kind: 'k8s' as const, row })),
            ...r.dbs.filter((k) => k.subnetId === s.id).map((row) => ({ kind: 'db' as const, row })),
            ...r.vms.filter((k) => k.subnetId === s.id).sort((a, b) => a.name.localeCompare(b.name)).map((row) => ({ kind: 'vm' as const, row })),
          ];
          const sn = add({ id: nid('subnet', s.id), kind: 'subnet', label: s.name, sub: s.cidr, x: COL.subnet, y: 0, w: W.subnet, h: 34, color: subnetColor(si), projectId: net.projectId,
            ref: { ...s, networkId: net.id, networkName: net.name }, link: `${KINDS.network.link?.(net.id)}?tab=subnets`, search: `${s.name} ${s.cidr}`, parent: netNode.id, badges: [s.public ? 'public' : 'private'] });
          edge({ id: `${netNode.id}>${sn.id}`, from: netNode.id, to: sn.id, kind: 'tree' });
          if (!res.length) y += ROW;
          for (const { kind, row } of res) {
            const ips = kind === 'db' ? [] : ipsOf(kind, row.id);
            const rows = Math.max(1, ips.length);
            const sub = kind === 'vm' ? row.privateIp : kind === 'db' ? `${row.engine} ${row.version}${row.ha ? ' · HA' : ''}` : `k8s ${row.version} · ${row.nodePools?.reduce((a: number, p: any) => a + p.count, 0) ?? 0} nodes`;
            const n = add({ id: nid(kind, row.id), kind, label: row.name, sub, x: COL.res, y: y + (rows * ROW) / 2, w: W.res, h: 34, status: row.status, color: KINDS[kind].color,
              link: KINDS[kind].link?.(row.id), projectId: row.projectId, ref: row, fw: fwByRef.get(`${kind}:${row.id}`), search: `${row.name} ${sub} ${row.id}`, parent: sn.id,
              badges: kind === 'vm' && row.gpu ? [`${row.gpu.count}× ${row.gpu.model}`] : undefined });
            edge({ id: `${sn.id}>${n.id}`, from: sn.id, to: n.id, kind: 'tree' });
            placeIps(n, ips, y);
            y += rows * ROW;
          }
          sn.y = (subStart + y) / 2;
          y += SUBNET_GAP;
        });
      }
      netNode.y = (netStart + y) / 2;
      y += NET_GAP;
    }
    locNode.y = (locStart + y - NET_GAP) / 2;
    y += LOC_GAP;
  }

  // LB → target edges (health-colored)
  for (const lb of d.lbs) {
    const from = byId.get(nid('lb', lb.id));
    if (!from) continue;
    const seen = new Set<string>();
    for (const tg of lb.targetGroups ?? []) for (const t of tg.targets ?? []) {
      const to = t?.ref ? byId.get(nid(t.ref.type, t.ref.id)) : undefined;
      if (!to || seen.has(to.id)) continue;
      seen.add(to.id);
      edge({ id: `${from.id}~${to.id}`, from: from.id, to: to.id, kind: 'lbTarget', tone: t.health });
    }
  }
  // peerings / VPN
  const done = new Set<string>();
  for (const n of nets) for (const p of n.peerings) {
    const key = [n.id, p.networkId].sort().join('|');
    if (done.has(key)) continue;
    done.add(key);
    const a = byId.get(nid('network', n.id)); const b = byId.get(nid('network', p.networkId));
    if (a && b) edge({ id: `peer:${key}`, from: a.id, to: b.id, kind: p.kind === 'vpn' ? 'vpn' : 'peering', tone: p.status, label: p.kind === 'vpn' ? 'VPN' : 'peering' });
  }
  // internet edge
  let height = Math.max(0, y - LOC_GAP);
  if (ipNodes.length) {
    const top = Math.min(...ipNodes.map((n) => n.y)) - 30;
    const bottom = Math.max(...ipNodes.map((n) => n.y)) + 30;
    const inet = add({ id: 'internet', kind: 'internet', label: 'Internet', sub: `${ipNodes.length} public endpoints`, x: COL.internet, y: (top + bottom) / 2, w: W.internet, h: Math.max(80, bottom - top), color: '#0ea5e9', search: 'internet' });
    for (const ip of ipNodes) edge({ id: `${ip.id}>internet`, from: ip.id, to: inet.id, kind: 'exposure' });
    height = Math.max(height, bottom);
  }
  return { nodes, edges, width: COL.internet + W.internet, height: Math.max(height, 200), byId };
}

/** Nodes "connected" to `id`: ancestors, descendants and direct non-tree neighbors. */
export function connectedSet(layout: Layout, id: string): Set<string> {
  const set = new Set<string>([id]);
  const children = new Map<string, string[]>();
  for (const n of layout.nodes) if (n.parent) children.set(n.parent, [...(children.get(n.parent) ?? []), n.id]);
  let cur = layout.byId.get(id);
  while (cur?.parent) { set.add(cur.parent); cur = layout.byId.get(cur.parent) }
  const down = (x: string) => { for (const c of children.get(x) ?? []) { set.add(c); down(c) } };
  down(id);
  for (const e of layout.edges) {
    if (e.kind === 'tree') continue;
    if (e.from === id) set.add(e.to);
    if (e.to === id && e.kind !== 'exposure') set.add(e.from);
  }
  // an IP's path to the internet
  if (layout.byId.get(id)?.kind === 'ip' || [...set].some((s) => s.startsWith('ip:'))) set.add('internet');
  if (id === 'internet') for (const n of layout.nodes) if (n.kind === 'ip') { set.add(n.id); if (n.parent) set.add(n.parent) }
  return set;
}
