import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { hashString } from '@/lib/random';
import { HEALTH_COLOR } from './forms';
import type { LoadBalancer, LbTarget } from '@/types';

/* Live traffic-flow diagram: internet → listeners → (L7 routes) → target groups → targets.
 * Edge thickness is proportional to the share of the current request rate; flow dashes animate
 * faster with more traffic; targets are colored by health. Only healthy, non-drained targets with
 * weight > 0 receive traffic. */

type Kind = 'internet' | 'listener' | 'route' | 'tg' | 'target';
interface FNode { id: string; col: number; kind: Kind; label: string; sub?: string; color: string; traffic: number; warn?: string; order: number; x: number; y: number; h: number; health?: LbTarget['health'] }
interface FEdge { id: string; from: string; to: string; traffic: number; color: string; t: number; y1: number; y2: number }

const COLORS = { internet: '#64748b', listener: '#5b67f8', route: '#a855f7', tg: '#06b6d4' };
const W = 1000;
const NODE_W = 158;
const NODE_H = 46;
const GAP = 14;
const PAD = 18;

export function fmtRate(v: number) { return v >= 100 ? Math.round(v).toLocaleString() : v >= 10 ? v.toFixed(0) : v.toFixed(1) }

function share(id: string, lo: number, hi: number) { return lo + (hashString(id) % 1000) / 1000 * (hi - lo) }

/** Compute nodes, edges and layout for the flow diagram. Exported for tests / reuse. */
export function buildFlow(lb: LoadBalancer, total: number) {
  const nodes = new Map<string, FNode>();
  const edges: Omit<FEdge, 't' | 'y1' | 'y2'>[] = [];
  const tgName = new Map(lb.targetGroups.map((t) => [t.id, t.name]));
  const hasRoutes = lb.type === 'L7' && lb.listeners.some((l) => l.rules.length > 0 && !l.redirectToHttps);
  const colTg = hasRoutes ? 3 : 2;
  const colTarget = colTg + 1;
  const add = (n: Omit<FNode, 'x' | 'y' | 'h' | 'traffic'> & { traffic?: number }) => { if (!nodes.has(n.id)) nodes.set(n.id, { ...n, traffic: n.traffic ?? 0, x: 0, y: 0, h: NODE_H }); return nodes.get(n.id)! };
  const flow = (from: string, to: string, traffic: number, color: string) => {
    edges.push({ id: `${from}>${to}`, from, to, traffic, color });
    nodes.get(to)!.traffic += traffic;
  };

  add({ id: 'internet', col: 0, kind: 'internet', label: 'Internet', sub: 'clients', color: COLORS.internet, order: 0, traffic: total });
  const listeners = [...lb.listeners].sort((a, b) => a.port - b.port);
  const lw = (l: (typeof listeners)[number]) => (l.redirectToHttps ? 0.5 : l.protocol === 'HTTPS' ? share(l.id, 7, 9) : l.protocol === 'HTTP' ? share(l.id, 1.5, 2.5) : share(l.id, 1, 4));
  const lsum = listeners.reduce((a, l) => a + lw(l), 0) || 1;
  listeners.forEach((l, i) => {
    const id = `l:${l.id}`;
    add({ id, col: 1, kind: 'listener', label: `${l.protocol} :${l.port}`, sub: l.redirectToHttps ? '301 → HTTPS' : l.protocol === 'HTTPS' ? 'TLS terminated' : lb.type === 'L4' ? 'passthrough' : undefined, color: COLORS.listener, order: i });
    flow('internet', id, (total * lw(l)) / lsum, COLORS.internet);
  });

  // routes
  listeners.forEach((l, li) => {
    if (l.redirectToHttps) return;
    const lid = `l:${l.id}`;
    const lt = nodes.get(lid)!.traffic;
    if (hasRoutes) {
      const routes = [...l.rules.map((r) => ({ id: `r:${r.id}`, label: `${r.host ?? '*'}${r.pathPrefix ?? ''}`, tg: r.targetGroupId, w: share(r.id, 1, 4) })), { id: `r:${l.id}:default`, label: 'default', tg: l.defaultTargetGroupId, w: 2.2 }];
      const rs = routes.reduce((a, r) => a + r.w, 0);
      routes.forEach((r, ri) => {
        add({ id: r.id, col: 2, kind: 'route', label: r.label, sub: `→ ${tgName.get(r.tg) ?? '?'}`, color: COLORS.route, order: li * 100 + ri });
        flow(lid, r.id, (lt * r.w) / rs, COLORS.listener);
        if (tgName.has(r.tg)) {
          add({ id: `tg:${r.tg}`, col: colTg, kind: 'tg', label: tgName.get(r.tg)!, color: COLORS.tg, order: 0 });
          flow(r.id, `tg:${r.tg}`, (lt * r.w) / rs, COLORS.route);
        }
      });
    } else if (tgName.has(l.defaultTargetGroupId)) {
      add({ id: `tg:${l.defaultTargetGroupId}`, col: colTg, kind: 'tg', label: tgName.get(l.defaultTargetGroupId)!, color: COLORS.tg, order: 0 });
      flow(lid, `tg:${l.defaultTargetGroupId}`, lt, COLORS.listener);
    }
  });
  // unreferenced target groups still show (no traffic)
  for (const tg of lb.targetGroups) add({ id: `tg:${tg.id}`, col: colTg, kind: 'tg', label: tg.name, color: COLORS.tg, order: 0 });

  // targets
  for (const tg of lb.targetGroups) {
    const tid = `tg:${tg.id}`;
    const tn = nodes.get(tid)!;
    tn.sub = `${tg.protocol} :${tg.port} · ${tg.targets.length} target${tg.targets.length === 1 ? '' : 's'}`;
    const eligible = tg.targets.filter((t) => t.health === 'healthy' && !t.drained && t.weight > 0);
    const ws = eligible.reduce((a, t) => a + t.weight, 0);
    if (!eligible.length && tg.targets.length) tn.warn = 'no healthy targets → 503';
    if (!tg.targets.length) tn.warn = 'no targets registered';
    tg.targets.forEach((t, i) => {
      const id = `t:${tg.id}:${t.ref.type}:${t.ref.id}:${t.port ?? ''}`;
      const color = HEALTH_COLOR[t.drained ? 'draining' : t.health] ?? '#64748b';
      add({ id, col: colTarget, kind: 'target', label: t.name ?? t.ref.id, sub: t.drained ? 'drained' : `${t.health}${t.address ? ` · ${t.address}` : ''}`, color, order: i, health: t.drained ? 'draining' : t.health });
      const amount = eligible.includes(t) && ws > 0 ? (tn.traffic * t.weight) / ws : 0;
      flow(tid, id, amount, amount > 0 ? COLORS.tg : '#94a3b8');
    });
  }

  // thickness
  const maxEdge = Math.max(1e-6, ...edges.map((e) => e.traffic));
  const sized = edges.map((e) => ({ ...e, t: e.traffic > 0 ? Math.max(2, (e.traffic / maxEdge) * 22) : 1.2, y1: 0, y2: 0 }));

  // node heights from stacked edges
  for (const n of nodes.values()) {
    const out = sized.filter((e) => e.from === n.id).reduce((a, e) => a + e.t, 0);
    const inn = sized.filter((e) => e.to === n.id).reduce((a, e) => a + e.t, 0);
    n.h = Math.max(NODE_H, out + 10, inn + 10);
  }

  // column ordering: tg/targets by barycenter of their sources
  const cols = colTarget + 1;
  const byCol: FNode[][] = Array.from({ length: cols }, () => []);
  for (const n of nodes.values()) byCol[n.col].push(n);
  const place = (col: FNode[]) => {
    const height = col.reduce((a, n) => a + n.h, 0) + Math.max(0, col.length - 1) * GAP;
    return height;
  };
  const colHeights: number[] = [];
  for (let c = 0; c < cols; c++) {
    if (c >= 2) {
      byCol[c].forEach((n) => {
        const srcs = sized.filter((e) => e.to === n.id).map((e) => nodes.get(e.from)!);
        n.order = srcs.length ? srcs.reduce((a, s) => a + s.y, 0) / srcs.length + (c === colTarget ? n.order * 0.01 : 0) : 1e6 + n.order;
      });
    }
    byCol[c].sort((a, b) => a.order - b.order);
    colHeights[c] = place(byCol[c]);
    // provisional y for barycenter of next column
    let y = 0;
    for (const n of byCol[c]) { n.y = y + n.h / 2; y += n.h + GAP }
  }
  const H = Math.max(...colHeights) + PAD * 2;
  for (let c = 0; c < cols; c++) {
    let y = (H - colHeights[c]) / 2;
    for (const n of byCol[c]) { n.y = y + n.h / 2; y += n.h + GAP }
    const x = cols === 1 ? 0 : (c * (W - NODE_W)) / (cols - 1);
    for (const n of byCol[c]) n.x = x;
  }

  // port stacking
  for (const n of nodes.values()) {
    const out = sized.filter((e) => e.from === n.id).sort((a, b) => nodes.get(a.to)!.y - nodes.get(b.to)!.y);
    let y = n.y - out.reduce((a, e) => a + e.t, 0) / 2;
    for (const e of out) { e.y1 = y + e.t / 2; y += e.t }
    const inn = sized.filter((e) => e.to === n.id).sort((a, b) => nodes.get(a.from)!.y - nodes.get(b.from)!.y);
    y = n.y - inn.reduce((a, e) => a + e.t, 0) / 2;
    for (const e of inn) { e.y2 = y + e.t / 2; y += e.t }
  }

  return { nodes: [...nodes.values()], edges: sized, H, maxEdge };
}

export function TrafficFlow({ lb, total, unit, className }: { lb: LoadBalancer; total: number; unit: string; className?: string }) {
  const { nodes, edges, H, maxEdge } = useMemo(() => buildFlow(lb, total), [lb, total]);
  const [hover, setHover] = useState<string | null>(null);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // highlight path through the hovered node / edge
  const active = useMemo(() => {
    if (!hover) return null;
    const set = new Set<string>([hover]);
    const e0 = edges.find((e) => e.id === hover);
    const seeds = e0 ? [e0.from, e0.to] : [hover];
    seeds.forEach((s) => set.add(s));
    if (e0) set.add(e0.id);
    // walk downstream and upstream
    const walk = (dir: 'down' | 'up') => {
      const queue = e0 ? [dir === 'down' ? e0.to : e0.from] : [hover];
      while (queue.length) {
        const cur = queue.pop()!;
        for (const e of edges) {
          if (dir === 'down' && e.from === cur && !set.has(e.id)) { set.add(e.id); set.add(e.to); queue.push(e.to) }
          if (dir === 'up' && e.to === cur && !set.has(e.id)) { set.add(e.id); set.add(e.from); queue.push(e.from) }
        }
      }
    };
    walk('down'); walk('up');
    return set;
  }, [hover, edges]);

  const tip = hover ? (() => {
    const n = byId.get(hover);
    if (n) return { x: n.x + NODE_W / 2, y: n.y - n.h / 2, title: n.label, lines: [n.sub, `${fmtRate(n.traffic)} ${unit}`, n.warn].filter(Boolean) as string[], warn: !!n.warn };
    const e = edges.find((x) => x.id === hover);
    if (!e) return null;
    const a = byId.get(e.from)!, b = byId.get(e.to)!;
    return { x: (a.x + NODE_W + b.x) / 2, y: (e.y1 + e.y2) / 2 - 10, title: `${a.label} → ${b.label}`, lines: [`${fmtRate(e.traffic)} ${unit}`, `${total > 0 ? ((e.traffic / total) * 100).toFixed(1) : 0}% of traffic`], warn: false };
  })() : null;

  return (
    <div className={cn('relative', className)}>
      <div className="overflow-x-auto">
        <div className="relative min-w-[720px]">
          <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Traffic flow through the load balancer">
            {edges.map((e) => {
              const a = byId.get(e.from)!, b = byId.get(e.to)!;
              const x1 = a.x + NODE_W, x2 = b.x, dx = (x2 - x1) / 2;
              const d = `M${x1},${e.y1} C${x1 + dx},${e.y1} ${x2 - dx},${e.y2} ${x2},${e.y2}`;
              const dim = active && !active.has(e.id);
              const speed = e.traffic > 0 ? Math.max(0.35, 2.2 - (e.traffic / maxEdge) * 1.8) : 0;
              return (
                <g key={e.id} onMouseEnter={() => setHover(e.id)} onMouseLeave={() => setHover(null)} style={{ opacity: dim ? 0.12 : 1, transition: 'opacity .15s' }}>
                  <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(12, e.t)} />
                  <path d={d} fill="none" stroke={e.color} strokeOpacity={e.traffic > 0 ? 0.28 : 0.5} strokeWidth={e.t} strokeDasharray={e.traffic > 0 ? undefined : '3 4'} style={{ transition: 'stroke-width .6s ease' }} />
                  {e.traffic > 0 && (
                    <path d={d} fill="none" stroke={e.color} strokeOpacity={0.9} strokeWidth={Math.max(1.4, Math.min(3, e.t / 3))} strokeLinecap="round" strokeDasharray="3 12"
                      className="animate-flow" style={{ animationDuration: `${speed}s` }} />
                  )}
                </g>
              );
            })}
            {nodes.map((n) => {
              const dim = active && !active.has(n.id);
              const top = n.y - n.h / 2;
              const unhealthy = n.kind === 'target' && n.health === 'unhealthy';
              return (
                <g key={n.id} transform={`translate(${n.x},${top})`} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} style={{ opacity: dim ? 0.3 : 1, transition: 'opacity .15s', cursor: 'default' }}>
                  <rect width={NODE_W} height={n.h} rx={9} fill="var(--surface)" stroke={n.warn || unhealthy ? '#f43f5e' : 'var(--line-strong)'} strokeWidth={n.warn || unhealthy ? 1.5 : 1} />
                  <rect width={4} height={n.h - 12} x={0} y={6} rx={2} fill={n.color} />
                  {n.kind === 'target' && <circle cx={NODE_W - 12} cy={13} r={4.5} fill={n.color}>{n.health === 'initial' || n.health === 'draining' ? <animate attributeName="opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite" /> : null}</circle>}
                  <text x={12} y={n.h / 2 - 4} fontSize={12.5} fontWeight={600} fill="var(--fg)">{clip(n.label, n.kind === 'target' ? 17 : 19)}</text>
                  <text x={12} y={n.h / 2 + 11} fontSize={10.5} fill={n.warn ? '#f43f5e' : 'var(--muted)'}>{clip(n.warn ?? n.sub ?? '', 26)}</text>
                  {n.kind !== 'target' && n.kind !== 'internet' && <text x={NODE_W - 8} y={n.h / 2 - 4} fontSize={10.5} textAnchor="end" fill="var(--fg-2)" fontWeight={500}>{fmtRate(n.traffic)}</text>}
                  {n.kind === 'target' && <text x={NODE_W - 22} y={17} fontSize={10.5} textAnchor="end" fill="var(--fg-2)" fontWeight={500}>{n.traffic > 0 ? fmtRate(n.traffic) : '0'}</text>}
                  {n.kind === 'internet' && <text x={NODE_W - 8} y={n.h / 2 - 4} fontSize={10.5} textAnchor="end" fill="var(--fg-2)" fontWeight={500}>{fmtRate(total)}</text>}
                </g>
              );
            })}
          </svg>
          {tip && (
            <div className="pointer-events-none absolute z-10 w-max max-w-64 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface/95 px-2.5 py-2 text-xs shadow-pop backdrop-blur"
              style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%` }}>
              <div className="font-medium text-fg">{tip.title}</div>
              {tip.lines.map((l, i) => <div key={i} className={cn('tabular', tip.warn && i === tip.lines.length - 1 ? 'text-rose-500' : 'text-muted')}>{l}</div>)}
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        {(['healthy', 'initial', 'draining', 'unhealthy'] as const).map((h) => <span key={h} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: HEALTH_COLOR[h] }} />{h}</span>)}
        <span className="ml-auto">Edge thickness ∝ {unit} · hover to trace a path</span>
      </div>
    </div>
  );
}

function clip(s: string, n: number) { return s.length > n ? `${s.slice(0, n - 1)}…` : s }
