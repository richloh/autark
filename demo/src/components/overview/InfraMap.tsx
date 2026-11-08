import { Pro } from '@/components/ui/Pro';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Building2, Cloud, Server, Database, Boxes, PackageOpen, Scale, Cpu, AlertTriangle, ArrowRight } from 'lucide-react';
import { Segmented } from '@/components/ui/Tabs';
import { cn } from '@/lib/cn';
import { money, num } from '@/lib/format';
import { fitView, landDots, makeProjection, VIEWS, type View } from './geo';
import { flag, COUNTRY_NAME, workloadsByLocation, type LocWorkload, type Fleet, type Issue, type CostSummary } from './shared';
import type { Location, Operation } from '@/types';

type Health = 'ok' | 'warn' | 'crit' | 'idle';
const HEALTH_COLOR: Record<Health, string> = { ok: '#10b981', warn: '#f59e0b', crit: '#f43f5e', idle: '#94a3b8' };
const HEALTH_LABEL: Record<Health, string> = { ok: 'Healthy', warn: 'Attention', crit: 'Issues', idle: 'Idle' };
const TRANSITIONAL = new Set(['provisioning', 'starting', 'stopping', 'rebooting', 'migrating', 'resizing', 'restoring', 'deleting', 'scaling', 'upgrading', 'updating']);

interface Pin {
  loc: Location; x: number; y: number; px: number; py: number; r: number; health: Health;
  w: LocWorkload;
  hosts: { total: number; ready: number }; cost: number; issues: Issue[]; busy: boolean; providerName?: string;
}

/** Stylised dot-matrix map of own datacenters and cloud regions with health, size by workloads and peering links. */
export function InfraMap({ fleet, issues, summary, runningOps, selected = null, onSelect, showList = false }: {
  fleet: Fleet; issues: Issue[]; summary?: CostSummary; runningOps: Operation[];
  /** controlled selection (location id); clicking a pin calls onSelect (null = deselect) */
  selected?: string | null; onSelect?: (id: string | null) => void;
  /** render the location list next to the map (accessible alternative); off when an external selector exists */
  showList?: boolean;
}) {
  const [mode, setMode] = useState<'fit' | 'europe' | 'world'>('fit');
  const [hover, setHover] = useState<string | null>(null);
  const [localPin, setLocalPin] = useState<string | null>(null);
  const pinned = onSelect ? selected : localPin;
  const togglePin = (id: string) => { const next = pinned === id ? null : id; if (onSelect) onSelect(next); else setLocalPin(next) };
  const active = hover ?? pinned;

  const workloads = useMemo(() => workloadsByLocation(fleet), [fleet]);
  const locations = fleet.locations;

  const view: View = useMemo(() => {
    if (mode !== 'fit') return VIEWS[mode];
    // fit active locations plus nearby (same-continent) regions; far-away idle regions stay reachable via "World"
    const active = (l: Location) => (workloads.get(l.id)?.total ?? 0) > 0 || fleet.hosts.some((h) => h.locationId === l.id);
    const pts = locations.filter((l) => active(l) || (l.lon > -30 && l.lon < 60 && l.lat > 30));
    return fitView(pts.length ? pts : locations);
  }, [mode, locations, workloads, fleet.hosts]);
  const proj = useMemo(() => makeProjection(view), [view]);
  const dots = useMemo(() => {
    const spacingPx = mode === 'world' ? 8 : 10;
    const step = (spacingPx * (view.lon1 - view.lon0) * proj.k) / proj.width;
    return landDots(proj, step);
  }, [proj, view, mode]);

  const pins: Pin[] = useMemo(() => {
    const busyTargets = new Set(runningOps.map((o) => o.target.id));
    const list = locations.map((loc): Pin => {
      const w = workloads.get(loc.id) ?? { vms: 0, dbs: 0, k8s: 0, buckets: 0, lbs: 0, total: 0, vcpus: 0 };
      const hs = fleet.hosts.filter((h) => h.locationId === loc.id);
      const locIssues = issues.filter((i) => i.locationId === loc.id);
      const transitional = fleet.vms.some((v) => v.locationId === loc.id && TRANSITIONAL.has(v.status));
      const busy = [...fleet.vms, ...fleet.dbs, ...fleet.k8s].some((r) => r.locationId === loc.id && busyTargets.has(r.id)) || hs.some((h) => busyTargets.has(h.id));
      const health: Health = locIssues.some((i) => i.severity === 'critical') ? 'crit'
        : locIssues.length || transitional ? 'warn'
          : w.total === 0 && hs.length === 0 ? 'idle' : 'ok';
      const x = proj.x(loc.lon), y = proj.y(loc.lat);
      return {
        loc, x, y, px: x, py: y, r: mode === 'world' ? Math.min(20, 8 + Math.sqrt(w.total) * 2.8) : Math.min(30, 12 + Math.sqrt(w.total) * 3.6), health, w,
        hosts: { total: hs.length, ready: hs.filter((h) => h.status === 'ready').length },
        cost: summary?.byLocation.find((b) => b.locationId === loc.id)?.monthly ?? 0,
        issues: locIssues, busy, providerName: fleet.providers.find((p) => p.id === loc.providerId)?.name,
      };
    });
    // resolve overlaps: simple iterative repulsion, pins stay tethered to their true position
    for (let it = 0; it < 60; it++) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.px - a.px, dy = b.py - a.py;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = a.r + b.r + 6;
        if (d < min) {
          const push = (min - d) / 2;
          const ux = dx / d || 1, uy = dy / d;
          a.px -= ux * push; a.py -= uy * push; b.px += ux * push; b.py += uy * push;
        }
      }
      for (const p of list) { p.px += (p.x - p.px) * 0.04; p.py += (p.y - p.py) * 0.04 }
    }
    return list;
  }, [locations, workloads, fleet, issues, summary, runningOps, proj, mode]);

  const pinById = useMemo(() => new Map(pins.map((p) => [p.loc.id, p])), [pins]);

  const links = useMemo(() => {
    const netLoc = new Map(fleet.networks.map((n) => [n.id, n.locationId]));
    const out = new Map<string, { a: string; b: string; kind: 'peering' | 'vpn'; names: string[] }>();
    const add = (la: string | undefined, lb: string | undefined, kind: 'peering' | 'vpn', name: string) => {
      if (!la || !lb || la === lb) return;
      const key = [la, lb].sort().join('|');
      const cur = out.get(key);
      if (cur) { if (kind === 'vpn') cur.kind = 'vpn'; if (!cur.names.includes(name)) cur.names.push(name) }
      else out.set(key, { a: la, b: lb, kind, names: [name] });
    };
    for (const n of fleet.networks) {
      for (const p of n.peerings ?? []) add(n.locationId, netLoc.get(p.networkId), 'peering', n.name);
      for (const r of n.routes ?? []) if (r.target?.type === 'vpn' && r.target.id) add(n.locationId, netLoc.get(r.target.id), 'vpn', n.name);
    }
    return [...out.values()];
  }, [fleet.networks]);

  const activePin = active ? pinById.get(active) : undefined;
  const inView = (p: Pin) => p.px >= -30 && p.px <= proj.width + 30 && p.py >= -30 && p.py <= proj.height + 30;

  // a location picked from an external selector that lies outside the current frame: zoom out so it is visible
  useEffect(() => {
    const p = selected ? pinById.get(selected) : undefined;
    if (p && mode !== 'world' && !(p.x >= 0 && p.x <= proj.width && p.y >= 0 && p.y <= proj.height)) setMode('world');
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cn('grid gap-4', showList && '@min-[44rem]:grid-cols-[minmax(0,1fr)_260px]')}>
      <div className="min-w-0">
        <Pro>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Legend />
            <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'fit', label: 'Fit' }, { value: 'europe', label: 'Europe' }, { value: 'world', label: 'World' }]} />
          </div>
        </Pro>
        <div className="relative overflow-hidden rounded-lg border border-line/60 bg-surface-2" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${proj.width} ${proj.height}`} className="block h-auto w-full" role="img" aria-label="Map of datacenters and cloud regions">
            <defs>
              <radialGradient id="map-glow">
                <stop offset="0" stopColor="#5b67f8" stopOpacity="0.14" />
                <stop offset="1" stopColor="#5b67f8" stopOpacity="0" />
              </radialGradient>
            </defs>
            {/* land: mixed towards the foreground so it reads on both light and dark surfaces */}
            <g style={{ fill: 'color-mix(in srgb, var(--map-land) 82%, var(--fg) 18%)' }}>
              {dots.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={mode === 'world' ? 2.2 : 2.9} />)}
            </g>
            {pins.filter((p) => p.loc.kind === 'selfHosted' && inView(p)).map((p) => <circle key={`g-${p.loc.id}`} cx={p.px} cy={p.py} r={p.r * 4} fill="url(#map-glow)" />)}
            {/* links */}
            {links.map((l) => {
              const a = pinById.get(l.a), b = pinById.get(l.b);
              if (!a || !b) return null;
              const mx = (a.px + b.px) / 2, my = (a.py + b.py) / 2;
              const dx = b.px - a.px, dy = b.py - a.py;
              const bend = 0.22;
              const cx = mx - dy * bend, cy = my + dx * bend - Math.hypot(dx, dy) * 0.08;
              const d = `M${a.px},${a.py} Q${cx},${cy} ${b.px},${b.py}`;
              const hot = active === l.a || active === l.b;
              return (
                <g key={`${l.a}-${l.b}`} opacity={active && !hot ? 0.25 : 1}>
                  <title>{`${l.kind === 'vpn' ? 'Site-to-site VPN' : 'VPC peering'}: ${l.names.join(', ')}`}</title>
                  <path d={d} fill="none" stroke="#5b67f8" strokeOpacity={0.18} strokeWidth={6} strokeLinecap="round" />
                  <path d={d} fill="none" stroke={l.kind === 'vpn' ? '#a855f7' : '#5b67f8'} strokeWidth={2} strokeDasharray="5 5" strokeLinecap="round" className="animate-flow" />
                </g>
              );
            })}
            {/* tethers for displaced pins */}
            {pins.filter((p) => Math.hypot(p.px - p.x, p.py - p.y) > 4).map((p) => (
              <g key={`t-${p.loc.id}`} stroke="var(--faint)" strokeWidth={1}>
                <line x1={p.x} y1={p.y} x2={p.px} y2={p.py} strokeDasharray="2 2" />
                <circle cx={p.x} cy={p.y} r={2.5} fill="var(--faint)" stroke="none" />
              </g>
            ))}
            {/* pins */}
            {pins.map((p) => {
              const c = HEALTH_COLOR[p.health];
              const isActive = active === p.loc.id;
              const dim = active && !isActive;
              const showLabel = mode !== 'world' && (p.loc.kind === 'selfHosted' || p.w.total > 0 || isActive);
              return (
                <g key={p.loc.id} transform={`translate(${p.px},${p.py})`} opacity={dim ? 0.45 : 1} className="cursor-pointer"
                  onMouseEnter={() => setHover(p.loc.id)} onClick={() => togglePin(p.loc.id)}>
                  {(p.busy || p.health === 'crit') && (
                    <circle r={p.r} fill="none" stroke={c} strokeWidth={2}>
                      <animate attributeName="r" from={p.r} to={p.r + 14} dur="1.8s" repeatCount="indefinite" />
                      <animate attributeName="opacity" from="0.7" to="0" dur="1.8s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle r={p.r + 10} fill="transparent" />
                  {p.loc.kind === 'selfHosted' ? (
                    <rect x={-p.r} y={-p.r} width={p.r * 2} height={p.r * 2} rx={p.r * 0.35} fill={c} fillOpacity={0.9} stroke="var(--surface)" strokeWidth={isActive ? 3.5 : 2} />
                  ) : (
                    <circle r={p.r} fill={c} fillOpacity={p.health === 'idle' ? 0.35 : 0.85} stroke="var(--surface)" strokeWidth={isActive ? 3.5 : 2} />
                  )}
                  {pinned === p.loc.id && <circle r={p.r + 6} fill="none" stroke="var(--fg)" strokeOpacity={0.5} strokeWidth={1.5} strokeDasharray="3 3" />}
                  {p.w.total > 0 && <text textAnchor="middle" dy="0.35em" fontSize={mode === 'world' ? 12 : p.r > 16 ? 16 : 14} fontWeight={700} fill="#fff" style={{ pointerEvents: 'none' }}>{p.w.total}</text>}
                  {showLabel && (
                    <text x={p.r + 7} dy="0.35em" fontSize={17} fontWeight={600} fill="var(--fg)" stroke="var(--surface-2)" strokeWidth={4} paintOrder="stroke" style={{ pointerEvents: 'none' }}>
                      {p.loc.kind === 'selfHosted' ? p.loc.name.replace('On-Prem ', '') : p.loc.region ?? p.loc.city}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {activePin && inView(activePin) && <HoverCard pin={activePin} width={proj.width} height={proj.height} />}
          {(() => {
            const off = pins.filter((p) => !inView(p));
            if (!off.length || mode === 'world') return null;
            return (
              <button type="button" onClick={() => setMode('world')} className="absolute bottom-2 left-2 rounded-md border border-line bg-surface/90 px-2 py-1 text-[11px] text-muted shadow-card backdrop-blur hover:text-fg">
                +{off.length} outside view ({off.slice(0, 2).map((p) => p.loc.city).join(', ')}{off.length > 2 ? '…' : ''}) · show world
              </button>
            );
          })()}
        </div>
      </div>

      {/* location list = accessible table alternative + hover sync */}
      {showList && <ul className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
        {[...pins].sort((a, b) => (a.loc.kind === b.loc.kind ? b.w.total - a.w.total : a.loc.kind === 'selfHosted' ? -1 : 1)).map((p) => (
          <li key={p.loc.id}>
            <button type="button" onMouseEnter={() => setHover(p.loc.id)} onMouseLeave={() => setHover(null)} onClick={() => togglePin(p.loc.id)}
              className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors', active === p.loc.id ? 'bg-surface-2' : 'hover:bg-surface-2/60')}>
              <span className={cn('flex size-6 shrink-0 items-center justify-center', p.loc.kind === 'selfHosted' ? 'rounded-md' : 'rounded-full')} style={{ background: `${HEALTH_COLOR[p.health]}22`, color: HEALTH_COLOR[p.health] }}>
                {p.loc.kind === 'selfHosted' ? <Building2 className="size-3.5" /> : <Cloud className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-fg">{p.loc.name}</span>
                <span className="block truncate text-[11px] text-muted">{flag(p.loc.country)} {p.loc.city} · {HEALTH_LABEL[p.health]}</span>
              </span>
              <span className="text-right">
                <span className="block text-[13px] tabular text-fg">{p.w.total}</span>
                <span className="block text-[11px] tabular text-faint">{p.cost ? money(p.cost) : '—'}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-faint" />Own datacenter</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-faint" />Cloud region</span>
      {(['ok', 'warn', 'crit'] as Health[]).map((h) => <span key={h} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: HEALTH_COLOR[h] }} />{HEALTH_LABEL[h]}</span>)}
      <span className="inline-flex items-center gap-1.5"><svg width="18" height="6"><line x1="1" y1="3" x2="17" y2="3" stroke="#5b67f8" strokeWidth="2" strokeDasharray="4 3" /></svg>Peering</span>
      <span className="inline-flex items-center gap-1.5"><svg width="18" height="6"><line x1="1" y1="3" x2="17" y2="3" stroke="#a855f7" strokeWidth="2" strokeDasharray="4 3" /></svg>VPN</span>
      <span className="text-faint">· size = workloads</span>
    </div>
  );
}

function HoverCard({ pin, width, height }: { pin: Pin; width: number; height: number }) {
  const left = (pin.px / width) * 100;
  const top = (pin.py / height) * 100;
  const flipX = pin.px > width * 0.55;
  const flipY = pin.py > height * 0.55;
  const rows: [typeof Server, string, number][] = [
    [Server, 'VMs', pin.w.vms], [Database, 'Databases', pin.w.dbs], [Boxes, 'Clusters', pin.w.k8s], [PackageOpen, 'Buckets', pin.w.buckets], [Scale, 'Load balancers', pin.w.lbs],
  ];
  return (
    <div className="pointer-events-none absolute z-10 w-60 animate-in rounded-xl border border-line bg-surface/95 p-3 text-xs shadow-pop backdrop-blur"
      style={{ left: `${left}%`, top: `${top}%`, transform: `translate(${flipX ? 'calc(-100% - 18px)' : '18px'}, ${flipY ? 'calc(-100% + 10px)' : '-10px'})` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-fg">{pin.loc.name}</div>
          <div className="truncate text-muted">{flag(pin.loc.country)} {pin.loc.city}, {COUNTRY_NAME[pin.loc.country] ?? pin.loc.country}</div>
        </div>
        <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium" style={{ background: `${HEALTH_COLOR[pin.health]}22`, color: HEALTH_COLOR[pin.health] }}>{HEALTH_LABEL[pin.health]}</span>
      </div>
      <div className="mt-1 text-[11px] text-faint">{pin.loc.kind === 'selfHosted' ? 'Own hardware' : `${pin.providerName ?? 'Cloud'} · ${pin.loc.region ?? ''}`}</div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {rows.filter(([, , n]) => n > 0).map(([Icon, label, n]) => (
          <span key={label} className="flex items-center justify-between gap-1 text-fg-2"><span className="flex items-center gap-1"><Icon className="size-3 text-faint" />{label}</span><span className="tabular text-fg">{n}</span></span>
        ))}
        {pin.w.total === 0 && <span className="col-span-2 text-muted">No workloads in this scope</span>}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
        {pin.hosts.total > 0 ? <span className="flex items-center gap-1 text-fg-2"><Cpu className="size-3 text-faint" />{pin.hosts.ready}/{pin.hosts.total} hosts ready</span> : <span className="text-muted">{num(pin.w.vcpus)} vCPU in use</span>}
        <span className="font-medium tabular text-fg">{money(pin.cost)}<span className="font-normal text-faint">/mo</span></span>
      </div>
      {pin.issues.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {pin.issues.slice(0, 3).map((i) => <li key={i.id} className={cn('flex items-center gap-1', i.severity === 'critical' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400')}><AlertTriangle className="size-3" />{i.label}: {i.detail}</li>)}
        </ul>
      )}
    </div>
  );
}

/** Small link row shown under the map. */
export function MapFootnote({ count }: { count: number }) {
  return (
    <Link to="/topology" className="inline-flex items-center gap-1 text-xs text-muted hover:text-brand-500">
      {count} locations · open topology <ArrowRight className="size-3" />
    </Link>
  );
}
