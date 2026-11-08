import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Plus, Globe2, Lock, Pencil, Trash2, Link2, ChevronDown, Server, Database, Boxes, Scale } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { StatusDot } from '@/components/ui/Badge';
import { Meter } from '@/components/ui/misc';
import { KindIcon } from '@/components/resource/ResourceLink';
import { usableHosts } from '@/lib/cidr';
import { KINDS } from '@/lib/kinds';
import { num } from '@/lib/format';
import { cn } from '@/lib/cn';
import { subnetColor, cidrRange } from './util';
import type { Network, Subnet } from '@/types';

export interface ConnectorResource {
  kind: 'vm' | 'db' | 'lb' | 'k8s';
  id: string; name: string; status: string;
  /** private address shown in mono; omitted for resources without a single address (k8s) */
  ip?: string;
  sub?: string;
  subnetId?: string;
}

interface Line { key: string; subnetId: string; resId: string; x1: number; y1: number; x2: number; y2: number; color: string }

/**
 * Hetzner-style subnet view: subnet cards on the left, attached resources on the right,
 * joined by dotted connector lines. Selecting a subnet highlights its resources.
 */
export function SubnetConnector({ net, resources, selectedId, onSelect, onAddSubnet, onEditSubnet, onDeleteSubnet, suggestedCidr }: {
  net: Network; resources: ConnectorResource[]; selectedId: string | null; onSelect: (id: string | null) => void;
  onAddSubnet: () => void; onEditSubnet: (s: Subnet) => void; onDeleteSubnet: (s: Subnet) => void; suggestedCidr?: string | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const subnetEls = useRef(new Map<string, HTMLElement>());
  const resEls = useRef(new Map<string, HTMLElement>());
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverRes, setHoverRes] = useState<string | null>(null);
  const [hoverSubnet, setHoverSubnet] = useState<string | null>(null);
  const editable = net.status === 'available';

  const colorOf = useCallback((sid?: string) => {
    const i = net.subnets.findIndex((s) => s.id === sid);
    return i >= 0 ? subnetColor(i) : 'var(--faint)';
  }, [net.subnets]);

  // resources ordered by subnet (keeps connector lines from crossing), unassigned last
  const order = new Map(net.subnets.map((s, i) => [s.id, i]));
  const kindOrder = { lb: 0, vm: 1, k8s: 2, db: 3 } as const;
  const sorted = [...resources].sort((a, b) =>
    (order.get(a.subnetId ?? '') ?? 999) - (order.get(b.subnetId ?? '') ?? 999) || kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name));
  const groups = [
    ...net.subnets.map((s) => ({ id: s.id as string | null, label: s.name, rows: sorted.filter((r) => r.subnetId === s.id) })),
    { id: null, label: 'Network-level (no subnet)', rows: sorted.filter((r) => !r.subnetId || !order.has(r.subnetId)) },
  ].filter((g) => g.rows.length);

  const layoutKey = `${net.subnets.map((s) => s.id).join(',')}|${sorted.map((r) => `${r.id}:${r.subnetId}`).join(',')}`;

  const measure = useCallback(() => {
    const root = wrap.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    setSize({ w: box.width, h: box.height });
    const out: Line[] = [];
    for (const r of sorted) {
      if (!r.subnetId) continue;
      const a = subnetEls.current.get(r.subnetId), b = resEls.current.get(r.id);
      if (!a || !b) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const x1 = ra.right - box.left, x2 = rb.left - box.left;
      if (x2 - x1 < 16) continue; // stacked layout (narrow): no connectors
      out.push({ key: `${r.subnetId}-${r.id}`, subnetId: r.subnetId, resId: r.id, x1, y1: ra.top - box.top + Math.min(44, ra.height / 2), x2, y2: rb.top - box.top + rb.height / 2, color: colorOf(r.subnetId) });
    }
    setLines(out);
  }, [layoutKey, colorOf]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    measure();
    const root = wrap.current;
    if (!root) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    return () => ro.disconnect();
  }, [measure]);

  const focus = hoverSubnet ?? selectedId;
  const lineActive = (l: Line) => (hoverRes ? hoverRes === l.resId : focus ? focus === l.subnetId : true);
  const anyFocus = !!(hoverRes || focus);
  const target = net.subnets.find((s) => s.id === selectedId) ?? net.subnets.find((s) => !s.public) ?? net.subnets[0];

  const q = (sid?: string) => `location=${encodeURIComponent(net.locationId)}&network=${encodeURIComponent(net.id)}${sid ? `&subnet=${encodeURIComponent(sid)}` : ''}`;
  const attachItems: MenuItem[] = [
    { label: 'Virtual machine', icon: Server, to: `/infrastructure/vms/new?${q(target?.id)}` },
    { label: 'Database', icon: Database, to: `/managed-services/db/new?${q(target?.id)}` },
    { label: 'Kubernetes cluster', icon: Boxes, to: `/managed-services/kubernetes/new?${q(target?.id)}` },
    { label: 'Load balancer', icon: Scale, to: `/managed-services/load-balancers/new?${q(target?.id)}` },
  ];

  return (
    <div ref={wrap} className="relative grid gap-y-5 @min-[40rem]:grid-cols-[minmax(0,1fr)_64px_minmax(0,1.2fr)] @min-[60rem]:grid-cols-[minmax(0,1fr)_96px_minmax(0,1.2fr)]">
      {/* connectors */}
      {size.w > 0 && lines.length > 0 && (
        <svg className="pointer-events-none absolute inset-0" width={size.w} height={size.h} aria-hidden>
          {lines.map((l) => {
            const on = lineActive(l);
            const dx = (l.x2 - l.x1) * 0.55;
            const d = `M${l.x1},${l.y1} C${l.x1 + dx},${l.y1} ${l.x2 - dx},${l.y2} ${l.x2},${l.y2}`;
            return (
              <g key={l.key} opacity={anyFocus && !on ? 0.18 : 1} style={{ transition: 'opacity 150ms' }}>
                <path d={d} fill="none" stroke={l.color} strokeWidth={on && anyFocus ? 2.5 : 2} strokeDasharray="0.5 5" strokeLinecap="round" />
                <circle cx={l.x1} cy={l.y1} r={3.5} fill={l.color} />
                <circle cx={l.x2} cy={l.y2} r={3} fill="var(--surface)" stroke={l.color} strokeWidth={2} />
              </g>
            );
          })}
        </svg>
      )}

      {/* ---------------------------------------------------------------- subnets */}
      <div className="min-w-0 space-y-3">
        <div className="flex h-8 items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-fg">Subnets <span className="font-normal text-muted">{net.subnets.length}</span></h3>
          {selectedId && <button type="button" onClick={() => onSelect(null)} className="text-xs text-muted hover:text-fg">Show all</button>}
        </div>
        {net.subnets.map((s, i) => {
          const color = subnetColor(i);
          const cap = s.capacity ?? usableHosts(s.cidr);
          const used = s.usedIps ?? 0;
          const count = resources.filter((r) => r.subnetId === s.id).length;
          const sel = selectedId === s.id;
          return (
            <div key={s.id} ref={(el) => { if (el) subnetEls.current.set(s.id, el); else subnetEls.current.delete(s.id) }}
              role="button" tabIndex={0} aria-pressed={sel}
              onClick={() => onSelect(sel ? null : s.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(sel ? null : s.id) } }}
              onMouseEnter={() => setHoverSubnet(s.id)} onMouseLeave={() => setHoverSubnet(null)}
              className={cn('group relative cursor-pointer overflow-hidden rounded-xl border bg-surface p-3.5 pl-4 shadow-card outline-none transition-all focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                sel ? 'border-transparent ring-2' : 'border-line hover:border-line-strong', focus && focus !== s.id && !hoverRes && 'opacity-60')}
              style={sel ? { ['--tw-ring-color' as string]: color } : undefined}>
              <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate text-[13px] font-semibold text-fg">{s.name}</span>
                    {s.public
                      ? <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"><Globe2 className="size-3" />public</span>
                      : <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-fg-2"><Lock className="size-3" />private{net.natGateway ? ' · NAT' : ''}</span>}
                  </div>
                  <div className="mt-1 font-mono text-lg font-semibold leading-tight tracking-tight text-fg">{s.cidr}</div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-faint">{cidrRange(s.cidr)} · gw {s.gateway}</div>
                </div>
                <div className="-mr-1.5 -mt-1.5 flex shrink-0 gap-0.5 opacity-100 transition-opacity @min-[60rem]:opacity-0 @min-[60rem]:group-hover:opacity-100 @min-[60rem]:group-focus-within:opacity-100">
                  <IconButton size="xs" icon={Pencil} label={`Edit ${s.name}`} onClick={(e) => { e.stopPropagation(); onEditSubnet(s) }} />
                  <IconButton size="xs" icon={Trash2} label={`Delete ${s.name}`} disabled={!editable} onClick={(e) => { e.stopPropagation(); onDeleteSubnet(s) }} />
                </div>
              </div>
              <div className="mt-3">
                <Meter size="sm" value={used} max={cap} />
                <div className="mt-1 flex justify-between gap-2 text-[11px] tabular text-muted">
                  <span>{num(used)} / {num(cap)} IPs</span>
                  <span>{count ? `${count} resource${count > 1 ? 's' : ''}` : 'empty'}{s.dhcp ? '' : ' · static'}</span>
                </div>
              </div>
            </div>
          );
        })}
        <button type="button" disabled={!editable} onClick={onAddSubnet}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-3 text-[13px] font-medium text-muted transition-colors hover:border-brand-500 hover:bg-brand-500/[0.04] hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-brand-300">
          <Plus className="size-4" />Add subnet
          {suggestedCidr && <span className="font-mono text-[11px] font-normal text-faint">{suggestedCidr}</span>}
        </button>
      </div>

      <div className="hidden @min-[40rem]:block" aria-hidden />

      {/* ---------------------------------------------------------------- resources */}
      <div className="min-w-0 space-y-3">
        <div className="flex h-8 items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-fg">Attached resources <span className="font-normal text-muted">{resources.length}</span></h3>
          <Menu width="w-64" items={attachItems} header={<div className="px-2.5 pb-1 pt-1.5 text-[11px] text-muted">Create in <span className="font-medium text-fg-2">{target?.name ?? net.name}</span>{target ? <span className="font-mono"> · {target.cidr}</span> : null}</div>}
            trigger={(open) => (
              <button type="button" disabled={!editable} aria-haspopup="menu" aria-expanded={open}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-xs font-medium text-fg shadow-card hover:bg-surface-2 disabled:opacity-50">
                <Link2 className="size-3.5" />Attach resource<ChevronDown className="size-3 text-muted" />
              </button>
            )} />
        </div>
        {groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-6 text-center text-[13px] text-muted">
            Nothing runs in this network yet. Use <span className="font-medium text-fg-2">Attach resource</span> to create a VM, database, cluster or load balancer in a subnet.
          </div>
        ) : groups.map((g) => (
          <div key={g.id ?? 'none'} className={cn('space-y-1.5 transition-opacity', focus && g.id !== focus && !hoverRes && 'opacity-45')}>
            {/* group label: only visible when stacked (no connector lines to tell membership) */}
            <div className="flex items-center gap-1.5 px-1 text-[11px] font-medium text-muted @min-[40rem]:hidden">
              <span className="size-2 rounded-sm" style={{ background: colorOf(g.id ?? undefined) }} />{g.label}
            </div>
            {g.id === null && <div className="hidden px-1 text-[11px] text-faint @min-[40rem]:block">{g.label}</div>}
            {g.rows.map((r) => {
              const link = KINDS[r.kind].link?.(r.id) ?? '#';
              return (
                <Link key={r.id} to={link} ref={(el) => { if (el) resEls.current.set(r.id, el); else resEls.current.delete(r.id) }}
                  onMouseEnter={() => setHoverRes(r.id)} onMouseLeave={() => setHoverRes(null)} onFocus={() => setHoverRes(r.id)} onBlur={() => setHoverRes(null)}
                  className={cn('flex items-center gap-2.5 rounded-lg border bg-surface px-2.5 py-2 shadow-card transition-colors hover:border-line-strong',
                    hoverRes === r.id ? 'border-line-strong' : 'border-line')}>
                  <KindIcon type={r.kind} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <StatusDot status={r.status} />
                      <span className="truncate text-[13px] font-medium text-fg">{r.name}</span>
                    </span>
                    <span className="block truncate text-[11px] text-muted">{KINDS[r.kind].label}{r.sub ? ` · ${r.sub}` : ''}</span>
                  </span>
                  {r.ip && <span className="shrink-0 font-mono text-xs text-fg-2">{r.ip}</span>}
                </Link>
              );
            })}
          </div>
        ))}
        {net.subnets.length > 0 && resources.length > 0 && (
          <p className="px-1 text-[11px] text-faint">Hover a resource to trace its subnet · click a subnet to focus it.</p>
        )}
      </div>
    </div>
  );
}
