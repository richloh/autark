import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Waypoints, ZoomIn, ZoomOut, Maximize2, Search, X, Cloud, Building2, Network as NetworkIcon, Globe2, Lock, Server, Database, Scale, Boxes, Shield, ExternalLink,
  ChevronsDownUp, ChevronsUpDown, Minus, Plus as PlusIcon,
} from 'lucide-react';
import { useList } from '@/api/hooks';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { StatusPill, statusTone } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { KINDS } from '@/lib/kinds';
import { layoutTopology, connectedSet, type TNode, type TEdge, type FilterKind, type Layout } from '@/components/network/topologyLayout';
import type { Network, VM, DbInstance, LoadBalancer, K8sCluster, IpAddress, Firewall, Location, Project } from '@/types';

const TONE_HEX: Record<string, string> = { success: '#10b981', warning: '#f59e0b', danger: '#f43f5e', info: '#0ea5e9', brand: '#5b67f8', neutral: '#94a3b8', violet: '#8b5cf6' };
const ICON = { location: Building2, network: NetworkIcon, subnet: Globe2, lb: Scale, vm: Server, db: Database, k8s: Boxes, ip: Globe2, internet: Cloud };
const FILTERS: { kind: FilterKind; label: string; color: string; icon: typeof Server }[] = [
  { kind: 'vm', label: 'VMs', color: KINDS.vm.color, icon: Server },
  { kind: 'db', label: 'Databases', color: KINDS.db.color, icon: Database },
  { kind: 'lb', label: 'Load balancers', color: KINDS.lb.color, icon: Scale },
  { kind: 'k8s', label: 'Kubernetes', color: KINDS.k8s.color, icon: Boxes },
  { kind: 'ip', label: 'Public IPs', color: KINDS.ip.color, icon: Globe2 },
];
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

interface View { x: number; y: number; k: number }

export default function Topology() {
  const [sp] = useSearchParams();
  const { items: networks, isLoading } = useList<Network>('networks');
  const { items: vms } = useList<VM>('vms');
  const { items: dbs } = useList<DbInstance>('dbInstances');
  const { items: lbs } = useList<LoadBalancer>('loadBalancers');
  const { items: k8s } = useList<K8sCluster>('k8sClusters');
  const { items: ips } = useList<IpAddress>('ips');
  const { items: firewalls } = useList<Firewall>('firewalls');
  const { items: locations } = useList<Location>('locations');
  const { items: projects } = useList<Project>('projects');

  const [kinds, setKinds] = useState<Set<FilterKind>>(new Set(['vm', 'db', 'lb', 'k8s', 'ip']));
  const [projectId, setProjectId] = useState('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>({ x: 20, y: 20, k: 0.7 });
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const fitted = useRef(false);

  const layout: Layout = useMemo(() => layoutTopology({ locations, networks, vms, dbs, lbs, k8s, ips, firewalls }, { kinds, projectId, collapsed }),
    [locations, networks, vms, dbs, lbs, k8s, ips, firewalls, kinds, projectId, collapsed]);
  const visibleProjects = projects.filter((p) => networks.some((n) => n.projectId === p.id));

  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const cw = el.clientWidth; const ch = el.clientHeight;
    const k = Math.max(0.2, Math.min(1.1, (cw - 48) / layout.width, (ch - 48) / layout.height));
    setView({ k, x: (cw - layout.width * k) / 2, y: Math.max(24, (ch - layout.height * k) / 2) });
  }, [layout.width, layout.height]);
  const centerOn = useCallback((id: string) => {
    const n = layout.byId.get(id);
    const el = wrap.current;
    if (!n || !el) return;
    setView((v) => { const k = Math.max(v.k, 0.9); return { k, x: el.clientWidth / 2 - (n.x + n.w / 2) * k - (selected ? 140 : 0), y: el.clientHeight / 2 - n.y * k } });
  }, [layout, selected]);

  useEffect(() => { if (!fitted.current && layout.nodes.length > 3) { fitted.current = true; fit() } }, [layout.nodes.length, fit]);
  // deep-link: /topology?focus=vm-001
  useEffect(() => {
    const f = sp.get('focus');
    if (!f || !layout.nodes.length) return;
    const n = layout.nodes.find((x) => x.ref?.id === f);
    if (n) { setSelected(n.id); setTimeout(() => centerOn(n.id), 50) }
  }, [layout.nodes.length > 0]); // eslint-disable-line

  // wheel zoom around the cursor (non-passive so the page doesn't scroll)
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest?.('[data-ui]')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left; const my = e.clientY - r.top;
      setView((v) => {
        const k = Math.max(0.15, Math.min(2.5, v.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
        return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const zoom = (f: number) => {
    const el = wrap.current;
    if (!el) return;
    const mx = el.clientWidth / 2; const my = el.clientHeight / 2;
    setView((v) => { const k = Math.max(0.15, Math.min(2.5, v.k * f)); return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k } });
  };

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return null;
    return new Set(layout.nodes.filter((n) => n.search.toLowerCase().includes(t) || n.label.toLowerCase().includes(t)).map((n) => n.id));
  }, [q, layout]);
  const focus = hover ?? selected;
  const lit = useMemo(() => (focus && layout.byId.has(focus) ? connectedSet(layout, focus) : null), [focus, layout]);
  const isDim = (id: string) => (lit ? !lit.has(id) : matches ? !matches.has(id) : false);
  const sel = selected ? layout.byId.get(selected) : undefined;

  const toggleKind = (k: FilterKind) => setKinds((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n });
  const toggleCollapse = (netId: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(netId)) n.delete(netId); else n.add(netId); return n });

  const counts = {
    nets: layout.nodes.filter((n) => n.kind === 'network').length,
    res: layout.nodes.filter((n) => ['vm', 'db', 'lb', 'k8s'].includes(n.kind)).length,
    ips: layout.nodes.filter((n) => n.kind === 'ip').length,
    links: layout.edges.filter((e) => e.kind === 'peering' || e.kind === 'vpn').length,
  };

  return (
    <Page wide className="pb-4">
      <PageHeader title="Topology" icon={Waypoints} iconColor="#5b67f8"
        description="Live map of your locations, VPCs, subnets and everything running in them — including how they reach the internet and each other."
        meta={<><span>{counts.nets} networks</span><span>{counts.res} resources</span><span>{counts.ips} public IPs</span><span>{counts.links} peerings / VPNs</span></>} />

      {/* toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full @min-[36rem]:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find name, IP, CIDR…"
            onKeyDown={(e) => { if (e.key === 'Enter' && matches?.size) { const first = [...matches][0]; setSelected(first); centerOn(first) } }}
            className="h-8 w-full rounded-lg border border-line bg-surface pl-8 pr-7 text-[13px] outline-none placeholder:text-faint focus:border-brand-500" />
          {q && <button onClick={() => setQ('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-fg" aria-label="Clear"><X className="size-3.5" /></button>}
          {matches && <span className="absolute -bottom-4 left-1 text-[10px] text-muted">{matches.size} match{matches.size === 1 ? '' : 'es'} · Enter to focus</span>}
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => {
            const on = kinds.has(f.kind);
            const I = f.icon;
            return (
              <button key={f.kind} type="button" onClick={() => toggleKind(f.kind)} aria-pressed={on}
                className={cn('flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors', on ? 'border-line bg-surface text-fg shadow-card' : 'border-dashed border-line text-faint')}>
                <I className="size-3.5" style={{ color: on ? f.color : undefined }} />{f.label}
              </button>
            );
          })}
        </div>
        {visibleProjects.length > 1 && (
          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={() => setProjectId('all')} className={cn('h-8 rounded-lg border px-2.5 text-xs font-medium', projectId === 'all' ? 'border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-300' : 'border-line text-muted hover:text-fg')}>All projects</button>
            {visibleProjects.map((p) => (
              <button key={p.id} type="button" onClick={() => setProjectId(projectId === p.id ? 'all' : p.id)} className={cn('flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium', projectId === p.id ? 'border-brand-500 bg-brand-500/10 text-fg' : 'border-line text-muted hover:text-fg')}>
                <span className="size-2 rounded-full" style={{ background: p.color }} />{p.name}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={collapsed.size ? ChevronsUpDown : ChevronsDownUp} onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(networks.map((n) => n.id)))}>{collapsed.size ? 'Expand all' : 'Collapse all'}</Button>
        </div>
      </div>

      {/* canvas */}
      <div ref={wrap} className="relative h-[calc(100vh-260px)] min-h-[520px] touch-none select-none overflow-hidden rounded-xl border border-line bg-surface-2/40 bg-dots shadow-card"
        onPointerDown={(e) => { if ((e.target as Element).closest('[data-node],[data-ui]')) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false } }}
        onPointerMove={(e) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x; const dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true; setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy })) }}
        onPointerUp={() => { if (drag.current && !drag.current.moved) setSelected(null); drag.current = null }}
        style={{ cursor: drag.current ? 'grabbing' : 'grab' }}>
        {isLoading ? <div className="p-6"><Skeleton className="h-full min-h-96" /></div> : layout.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">No networks in this scope yet.</div>
        ) : (
          <svg className="absolute inset-0 h-full w-full" role="img" aria-label="Infrastructure topology">
            <defs>
              <marker id="topo-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="var(--line-strong)" /></marker>
            </defs>
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {/* column headers */}
              {[['Locations', 0], ['Networks (VPC)', 250], ['Subnets & LBs', 480], ['Resources', 720], ['Public IPs', 975]].map(([l, x]) => (
                <text key={l as string} x={x as number} y={-14} fontSize={11} fontWeight={600} fill="var(--faint)" letterSpacing={0.6}>{(l as string).toUpperCase()}</text>
              ))}
              {layout.edges.map((e) => <EdgePath key={e.id} e={e} layout={layout} dim={!!lit && !(lit.has(e.from) && lit.has(e.to))} hot={!!lit && lit.has(e.from) && lit.has(e.to)} />)}
              {layout.nodes.map((n) => (
                <NodeShape key={n.id} n={n} dim={isDim(n.id)} selected={selected === n.id} match={!!matches?.has(n.id)}
                  onEnter={() => setHover(n.id)} onLeave={() => setHover((h) => (h === n.id ? null : h))}
                  onClick={() => setSelected(n.id === selected ? null : n.id)}
                  onToggle={n.kind === 'network' ? () => toggleCollapse(n.ref.id) : undefined} collapsed={n.kind === 'network' && collapsed.has(n.ref.id)} />
              ))}
            </g>
          </svg>
        )}

        {/* zoom controls */}
        <div data-ui className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card">
          <IconButton icon={ZoomIn} label="Zoom in" size="sm" onClick={() => zoom(1.25)} />
          <IconButton icon={ZoomOut} label="Zoom out" size="sm" onClick={() => zoom(0.8)} />
          <IconButton icon={Maximize2} label="Fit to screen" size="sm" onClick={fit} />
        </div>
        <div className="pointer-events-none absolute bottom-3 left-14 hidden rounded-lg border border-line bg-surface/90 px-3 py-2 text-[11px] text-muted shadow-card backdrop-blur @min-[40rem]:block">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Legend stroke="var(--line-strong)">contains</Legend>
            <Legend stroke="#10b981" width={2}>peering</Legend>
            <Legend stroke="#8b5cf6" dash="5 4" width={2}>VPN</Legend>
            <Legend stroke="#ec4899" dash="3 3">LB → target</Legend>
            <Legend stroke="#0ea5e9" dash="2 4">internet</Legend>
            <span className="flex items-center gap-1"><Shield className="size-3 text-orange-500" />firewalls</span>
            <span className="tabular">{Math.round(view.k * 100)}%</span>
          </div>
        </div>

        {/* side panel */}
        {sel && <SidePanel n={sel} layout={layout} projects={projects} onClose={() => setSelected(null)} onPick={(id) => { setSelected(id); centerOn(id) }} />}
      </div>
    </Page>
  );
}

function Legend({ stroke, dash, width = 1.5, children }: { stroke: string; dash?: string; width?: number; children: ReactNode }) {
  return <span className="flex items-center gap-1"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={stroke} strokeWidth={width} strokeDasharray={dash} /></svg>{children}</span>;
}

function EdgePath({ e, layout, dim, hot }: { e: TEdge; layout: Layout; dim: boolean; hot: boolean }) {
  const a = layout.byId.get(e.from);
  const b = layout.byId.get(e.to);
  if (!a || !b) return null;
  let d: string;
  let stroke = 'var(--line-strong)';
  let dash: string | undefined;
  let width = 1.3;
  let label: { x: number; y: number; text: string } | null = null;
  if (e.kind === 'peering' || e.kind === 'vpn') {
    // arc bulging left of the network column
    const x = a.x; const y1 = a.y; const y2 = b.y;
    const bulge = 40 + Math.min(60, Math.abs(y2 - y1) * 0.08);
    d = `M ${x} ${y1} C ${x - bulge} ${y1}, ${x - bulge} ${y2}, ${x} ${y2}`;
    stroke = e.kind === 'vpn' ? '#8b5cf6' : '#10b981';
    dash = e.kind === 'vpn' ? '6 4' : undefined;
    width = 2.2;
    label = { x: x - bulge * 0.75 - 4, y: (y1 + y2) / 2, text: e.label ?? '' };
  } else {
    const x1 = a.x + a.w; const y1 = a.y;
    const x2 = b.x; const y2 = e.kind === 'exposure' ? a.y : b.y;
    const dx = Math.max(30, (x2 - x1) / 2);
    d = e.kind === 'exposure' ? `M ${x1} ${y1} L ${x2} ${y2}` : `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    if (e.kind === 'lbTarget') { stroke = e.tone === 'unhealthy' ? '#f43f5e' : e.tone === 'draining' || e.tone === 'initial' ? '#f59e0b' : '#ec4899'; dash = '3 3'; width = 1.4 }
    if (e.kind === 'exposure') { stroke = '#0ea5e9'; dash = '2 4'; width = 1.2 }
  }
  return (
    <g opacity={dim ? 0.12 : 1} style={{ transition: 'opacity .15s' }}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={hot ? width + 0.8 : width} strokeDasharray={dash} className={cn(hot && (e.kind === 'exposure' || e.kind === 'lbTarget' || e.kind === 'vpn') && 'flow-line')} markerEnd={e.kind === 'lbTarget' ? 'url(#topo-arrow)' : undefined} />
      {label && (
        <g transform={`translate(${label.x},${label.y})`}>
          <rect x={-24} y={-8} width={48} height={16} rx={8} fill="var(--surface)" stroke={stroke} strokeWidth={1} />
          <text textAnchor="middle" y={3.5} fontSize={9} fontWeight={600} fill={stroke}>{label.text}</text>
        </g>
      )}
    </g>
  );
}

function NodeShape({ n, dim, selected, match, onEnter, onLeave, onClick, onToggle, collapsed }: {
  n: TNode; dim: boolean; selected: boolean; match: boolean; onEnter: () => void; onLeave: () => void; onClick: () => void; onToggle?: () => void; collapsed?: boolean;
}) {
  const top = n.y - n.h / 2;
  const tone = n.status ? TONE_HEX[statusTone(n.status)] : undefined;
  const Icon = n.kind === 'location' ? (n.ref?.kind === 'cloud' ? Cloud : Building2) : n.kind === 'subnet' ? (n.ref?.public ? Globe2 : Lock) : ICON[n.kind];
  const common = { 'data-node': n.id, onMouseEnter: onEnter, onMouseLeave: onLeave, onClick: (e: React.MouseEvent) => { e.stopPropagation(); onClick() }, style: { cursor: 'pointer', transition: 'opacity .15s' }, opacity: dim ? 0.18 : 1 };

  if (n.kind === 'internet') {
    return (
      <g {...common}>
        <rect x={n.x} y={top} width={n.w} height={n.h} rx={18} fill="#0ea5e9" fillOpacity={0.08} stroke="#0ea5e9" strokeOpacity={0.5} strokeDasharray="5 4" strokeWidth={selected ? 2.5 : 1.5} />
        <g transform={`translate(${n.x + n.w / 2 - 12},${n.y - 26})`}><Cloud width={24} height={24} color="#0ea5e9" /></g>
        <text x={n.x + n.w / 2} y={n.y + 14} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--fg)">Internet</text>
        <text x={n.x + n.w / 2} y={n.y + 29} textAnchor="middle" fontSize={9.5} fill="var(--muted)">{n.sub}</text>
      </g>
    );
  }
  if (n.kind === 'ip') {
    return (
      <g {...common}>
        <rect x={n.x} y={top} width={n.w} height={n.h} rx={13} fill="var(--surface)" stroke={selected ? 'var(--fg)' : match ? '#5b67f8' : '#14b8a6'} strokeOpacity={selected || match ? 1 : 0.55} strokeWidth={selected || match ? 2 : 1} />
        <circle cx={n.x + 13} cy={n.y} r={4} fill="#14b8a6" />
        <text x={n.x + 23} y={n.y + 4} fontSize={11} fill="var(--fg)" className="font-mono">{trunc(n.label, 19)}</text>
      </g>
    );
  }
  const big = n.kind === 'location' || n.kind === 'network';
  return (
    <g {...common}>
      {selected && <rect x={n.x - 4} y={top - 4} width={n.w + 8} height={n.h + 8} rx={12} fill="none" stroke="#5b67f8" strokeWidth={2} strokeOpacity={0.6} />}
      <rect x={n.x} y={top} width={n.w} height={n.h} rx={9} fill="var(--surface)" stroke={match ? '#5b67f8' : 'var(--line-strong)'} strokeWidth={match ? 2 : 1} />
      <rect x={n.x} y={top} width={4} height={n.h} rx={2} fill={n.color} />
      <rect x={n.x + 10} y={n.y - 11} width={22} height={22} rx={6} fill={n.color} fillOpacity={0.14} />
      <g transform={`translate(${n.x + 14},${n.y - 7})`}><Icon width={14} height={14} color={n.color} /></g>
      <text x={n.x + 40} y={n.y - (n.sub ? 2 : -4)} fontSize={big ? 12.5 : 12} fontWeight={600} fill="var(--fg)">{trunc(n.label, big ? 18 : 20)}</text>
      {n.sub && <text x={n.x + 40} y={n.y + 12} fontSize={10} fill="var(--muted)" className="font-mono">{trunc(n.sub, 24)}</text>}
      {tone && <circle cx={n.x + n.w - 10} cy={top + 10} r={3.5} fill={tone} className={cn(statusTone(n.status!) === 'info' && 'animate-pulse-soft')} />}
      {n.fw && n.fw.length > 0 && (
        <g transform={`translate(${n.x + n.w - 14},${top + n.h - 6})`}>
          <circle r={8} fill="var(--surface)" stroke="#f97316" strokeWidth={1.2} />
          <Shield x={-4.5} y={-5} width={9} height={9} color="#f97316" />
          {n.fw.length > 1 && <text x={7} y={-4} fontSize={8} fontWeight={700} fill="#f97316">{n.fw.length}</text>}
        </g>
      )}
      {n.badges?.length ? (
        <text x={n.x + n.w - (n.status ? 20 : 8)} y={top + 13} textAnchor="end" fontSize={8.5} fontWeight={600} fill="var(--faint)">{n.badges.join(' · ').toUpperCase()}</text>
      ) : null}
      {onToggle && (
        <g transform={`translate(${n.x + n.w},${n.y})`} onClick={(e) => { e.stopPropagation(); onToggle() }} style={{ cursor: 'pointer' }}>
          <circle r={8} fill="var(--surface)" stroke="var(--line-strong)" />
          {collapsed ? <PlusIcon x={-5} y={-5} width={10} height={10} color="var(--fg)" /> : <Minus x={-5} y={-5} width={10} height={10} color="var(--fg)" />}
        </g>
      )}
      {collapsed && n.collapsedCount != null && (
        <text x={n.x + n.w + 14} y={n.y + 4} fontSize={10} fill="var(--muted)">{n.collapsedCount} hidden</text>
      )}
    </g>
  );
}

function SidePanel({ n, layout, projects, onClose, onPick }: { n: TNode; layout: Layout; projects: Project[]; onClose: () => void; onPick: (id: string) => void }) {
  const r = n.ref ?? {};
  const proj = projects.find((p) => p.id === n.projectId);
  const kindLabel = n.kind === 'internet' ? 'Internet edge' : n.kind === 'subnet' ? 'Subnet' : n.kind === 'location' ? 'Location' : KINDS[n.kind].label;
  const rows: [string, ReactNode][] = [];
  switch (n.kind) {
    case 'location': rows.push(['Type', r.kind === 'cloud' ? 'Cloud region (burst)' : 'Own data center'], ['City', `${r.city ?? ''} ${r.country ?? ''}`]); break;
    case 'network': rows.push(['CIDR', r.cidr], ['Subnets', r.subnets?.length], ['NAT', r.natGateway ? 'enabled' : 'off'], ['MTU', r.mtu], ['Peerings', r.peerings?.length ?? 0]); break;
    case 'subnet': rows.push(['CIDR', r.cidr], ['Gateway', r.gateway], ['Routing', r.public ? 'public (IGW)' : 'private'], ['VPC', r.networkName]); break;
    case 'vm': rows.push(['Size', `${r.size?.vcpus} vCPU · ${r.size?.ramGB} GB`], ['Private IP', r.privateIp], ['Host', r.hostId ?? 'cloud']); if (r.gpu) rows.push(['GPU', `${r.gpu.count}× ${r.gpu.model}`]); break;
    case 'db': rows.push(['Engine', `${r.engine} ${r.version}`], ['Endpoint', `${r.host}:${r.port}`], ['HA', r.ha ? 'yes' : 'no']); break;
    case 'lb': rows.push(['Type', r.type], ['Hostname', r.hostname], ['Listeners', (r.listeners ?? []).map((l: any) => `${l.protocol}:${l.port}`).join(', ')]); break;
    case 'k8s': rows.push(['Version', r.version], ['Nodes', (r.nodePools ?? []).reduce((a: number, p: any) => a + p.count, 0)], ['CNI', r.cni], ['Endpoint', r.controlPlane?.endpoint]); break;
    case 'ip': rows.push(['Version', `IPv${r.version}`], ['Reverse DNS', r.reverseDns ?? '—']); break;
    case 'internet': rows.push(['Public endpoints', layout.nodes.filter((x) => x.kind === 'ip').length]); break;
  }
  const neighbors = connectedSet(layout, n.id);
  neighbors.delete(n.id);
  const near = [...neighbors].map((id) => layout.byId.get(id)!).filter(Boolean).filter((x) => x.kind !== 'location' || n.kind === 'network').slice(0, 14);
  const lbIn = layout.edges.filter((e) => e.kind === 'lbTarget' && e.to === n.id).map((e) => layout.byId.get(e.from)!).filter(Boolean);

  return (
    <div data-ui className="absolute inset-x-2 bottom-2 z-10 max-h-[60%] animate-slide-in overflow-y-auto rounded-xl border border-line bg-surface shadow-pop @min-[36rem]:inset-x-auto @min-[36rem]:bottom-auto @min-[36rem]:right-3 @min-[36rem]:top-3 @min-[36rem]:max-h-[calc(100%-24px)] @min-[36rem]:w-80"
      onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-start gap-3 border-b border-line p-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${n.color}1f`, color: n.color }}>
          {(() => { const I = n.kind === 'subnet' ? (r.public ? Globe2 : Lock) : n.kind === 'location' ? (r.kind === 'cloud' ? Cloud : Building2) : ICON[n.kind]; return <I className="size-[18px]" /> })()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{kindLabel}</div>
          <div className="truncate text-[15px] font-semibold text-fg">{n.label}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {n.status && <StatusPill status={n.status} />}
            {proj && <span className="flex items-center gap-1 text-[11px] text-muted"><span className="size-1.5 rounded-full" style={{ background: proj.color }} />{proj.name}</span>}
          </div>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-fg" aria-label="Close panel"><X className="size-4" /></button>
      </div>
      <dl className="space-y-1.5 p-3.5 text-[13px]">
        {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="shrink-0 text-muted">{k}</dt><dd className="min-w-0 truncate text-right font-mono text-[12px] text-fg-2">{v ?? '—'}</dd></div>)}
      </dl>
      {n.fw && n.fw.length > 0 && (
        <div className="border-t border-line p-3.5">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">Firewalls</div>
          <div className="space-y-1">
            {n.fw.map((f) => (
              <Link key={f.id} to={`/infrastructure/firewalls/${f.id}`} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] text-fg hover:bg-surface-2">
                <Shield className="size-3.5 text-orange-500" /><span className="truncate">{f.name}</span>
                <span className="ml-auto text-[11px] text-muted">{f.rules.filter((x) => x.enabled && x.direction === 'inbound' && x.action === 'allow').map((x) => x.ports).slice(0, 3).join(' ')}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      {lbIn.length > 0 && (
        <div className="border-t border-line p-3.5">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">Receives traffic from</div>
          {lbIn.map((x) => <button key={x.id} onClick={() => onPick(x.id)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] text-fg hover:bg-surface-2"><Scale className="size-3.5 text-pink-500" />{x.label}</button>)}
        </div>
      )}
      {near.length > 0 && (
        <div className="border-t border-line p-3.5">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">Connected</div>
          <div className="space-y-0.5">
            {near.map((x) => {
              const I = x.kind === 'subnet' ? (x.ref?.public ? Globe2 : Lock) : x.kind === 'location' ? (x.ref?.kind === 'cloud' ? Cloud : Building2) : ICON[x.kind];
              return (
                <button key={x.id} onClick={() => onPick(x.id)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] text-fg-2 hover:bg-surface-2 hover:text-fg">
                  <I className="size-3.5 shrink-0" style={{ color: x.color }} /><span className="truncate">{x.label}</span><span className="ml-auto shrink-0 font-mono text-[10px] text-faint">{x.kind}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {n.link && (
        <div className="border-t border-line p-3.5">
          <Button className="w-full" variant="secondary" icon={ExternalLink} to={n.link}>Open {kindLabel.toLowerCase()}</Button>
        </div>
      )}
    </div>
  );
}

