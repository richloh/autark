import { overlayRoot } from '@/lib/overlay';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Cpu, Eye, EyeOff, Gpu, Hourglass, Layers, Loader2, MemoryStick, Server } from 'lucide-react';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/misc';
import { fmtCpu, fmtMem, nsColor, poolNodeCost, presetLabel } from './k8sUi';
import type { K8sCluster, K8sNode, K8sPod, K8sTopology, NodePool } from '@/types';

/* ------------------------------------------------------------------------------------------------
 * Cluster map: node pools as lanes, nodes as cards with allocation bars, pods as colored squares
 * (by namespace). Pods that move between nodes / trays animate (FLIP), new pods pop in.
 * ---------------------------------------------------------------------------------------------- */

function useFlip(container: RefObject<HTMLElement | null>) {
  const prev = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const base = root.getBoundingClientRect();
    const next = new Map<string, { x: number; y: number }>();
    const hadAny = prev.current.size > 0;
    root.querySelectorAll<HTMLElement>('[data-flip]').forEach((el) => {
      const key = el.dataset.flip!;
      const r = el.getBoundingClientRect();
      const pos = { x: r.left - base.left, y: r.top - base.top };
      next.set(key, pos);
      const old = prev.current.get(key);
      if (old && (Math.abs(old.x - pos.x) > 2 || Math.abs(old.y - pos.y) > 2)) {
        el.animate?.([{ transform: `translate(${old.x - pos.x}px, ${old.y - pos.y}px) scale(1.5)`, zIndex: 5 }, { transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)' });
      } else if (!old && hadAny) {
        el.animate?.([{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.4)', opacity: 1, offset: 0.7 }, { transform: 'none' }], { duration: 450, easing: 'ease-out' });
      }
    });
    prev.current = next;
  });
}

function PodDot({ pod, dim, onHover }: { pod: K8sPod; dim: boolean; onHover: (p: K8sPod | null, el?: HTMLElement) => void }) {
  const color = nsColor(pod.namespace);
  const style: React.CSSProperties =
    pod.status === 'Running' ? { background: color } :
    pod.status === 'ContainerCreating' ? { background: `${color}55`, boxShadow: `inset 0 0 0 1.5px ${color}` } :
    pod.status === 'CrashLoopBackOff' ? { background: '#f43f5e', boxShadow: `inset 0 0 0 2px ${color}` } :
    pod.status === 'Terminating' ? { background: color, opacity: 0.25 } :
    { background: 'transparent', boxShadow: `inset 0 0 0 1.5px ${color}` };
  return (
    <span
      data-flip={pod.name}
      onMouseEnter={(e) => onHover(pod, e.currentTarget)}
      onMouseLeave={() => onHover(null)}
      className={cn('relative block size-[11px] shrink-0 cursor-default rounded-[3px] transition-opacity duration-300',
        (pod.status === 'ContainerCreating' || pod.status === 'CrashLoopBackOff') && 'animate-pulse-soft',
        pod.gpu > 0 && 'ring-1 ring-lime-400 ring-offset-1 ring-offset-surface',
        dim && 'opacity-15')}
      style={dim ? { ...style, opacity: 0.15 } : style}
      aria-label={`${pod.name} (${pod.status})`}
    />
  );
}

function AllocBar({ label, icon: Icon, requested, allocatable, usage, fmt }: { label: string; icon: typeof Cpu; requested: number; allocatable: number; usage: number; fmt: (n: number) => string }) {
  const r = allocatable ? Math.min(1, requested / allocatable) : 0;
  const tone = r >= 0.9 ? 'bg-rose-500' : r >= 0.75 ? 'bg-amber-500' : 'bg-brand-500';
  return (
    <div className="flex items-center gap-1.5 text-[10.5px]" title={`${label}: ${fmt(requested)} requested of ${fmt(allocatable)} allocatable · ~${Math.round(usage * 100)}% actually used`}>
      <Icon className="size-3 shrink-0 text-faint" />
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div className={cn('absolute inset-y-0 left-0 rounded-full opacity-35 transition-all duration-700', tone)} style={{ width: `${r * 100}%` }} />
        <div className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-700', tone)} style={{ width: `${Math.min(r, usage) * 100}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right tabular text-muted">{Math.round(r * 100)}%</span>
    </div>
  );
}

const NODE_LOOK: Record<string, { border: string; label?: string; tone?: string }> = {
  Ready: { border: 'border-line' },
  NotReady: { border: 'border-dashed border-sky-500/60', label: 'Joining…', tone: 'text-sky-600 dark:text-sky-400' },
  Provisioning: { border: 'border-dashed border-line-strong', label: 'Provisioning…', tone: 'text-muted' },
  Draining: { border: 'border-amber-500/60', label: 'Draining', tone: 'text-amber-600 dark:text-amber-400' },
  Upgrading: { border: 'border-sky-500/60', label: 'Replacing', tone: 'text-sky-600 dark:text-sky-400' },
};

function NodeCard({ node, pods, focusNs, showSystem, onHover }: { node: K8sNode; pods: K8sPod[]; focusNs: string | null; showSystem: boolean; onHover: (p: K8sPod | null, el?: HTMLElement) => void }) {
  const look = NODE_LOOK[node.status] ?? NODE_LOOK.Ready;
  const shown = pods.filter((p) => showSystem || !p.system);
  const cordoned = node.status === 'Ready' && node.unschedulable;
  const busy = node.status === 'Provisioning' || node.status === 'NotReady';
  return (
    <div className={cn('relative flex min-w-0 flex-col rounded-lg border bg-surface p-2.5 shadow-card transition-colors', look.border, node.surge && 'border-dashed border-emerald-500/60 bg-emerald-500/[0.03]', cordoned && 'border-amber-500/40')}>
      <div className="flex items-center gap-1.5">
        <span className={cn('size-2 shrink-0 rounded-full', node.status === 'Ready' ? (cordoned ? 'bg-amber-500' : 'bg-emerald-500') : node.status === 'Draining' ? 'animate-pulse-soft bg-amber-500' : node.status === 'Provisioning' ? 'bg-faint' : 'animate-pulse-soft bg-sky-500')} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-fg" title={node.name}>{node.name}</span>
        {node.surge && <Badge tone="success" className="h-[18px] px-1.5 text-[10px]">surge</Badge>}
        {cordoned && <Badge tone="warning" className="h-[18px] px-1.5 text-[10px]">cordoned</Badge>}
        {look.label && <span className={cn('flex items-center gap-1 text-[10px] font-medium', look.tone)}>{busy && <Loader2 className="size-3 animate-spin" />}{look.label}</span>}
      </div>
      <div className="mt-0.5 truncate text-[10.5px] text-muted">{node.zone} · {node.internalIp} · {node.version}</div>
      {node.status === 'Provisioning' ? (
        <div className="mt-2 space-y-1.5"><Skeleton className="h-1.5" /><Skeleton className="h-1.5 w-4/5" /><Skeleton className="mt-2 h-8" /></div>
      ) : (
        <>
          <div className="mt-2 space-y-1">
            <AllocBar label="CPU" icon={Cpu} requested={node.requested.cpuM} allocatable={node.allocatable.cpuM} usage={node.usage.cpuPct} fmt={fmtCpu} />
            <AllocBar label="Memory" icon={MemoryStick} requested={node.requested.memMi} allocatable={node.allocatable.memMi} usage={node.usage.memPct} fmt={fmtMem} />
            {node.gpu && (
              <div className="flex items-center gap-1.5 text-[10.5px]" title={`${node.requested.gpu}/${node.allocatable.gpu} GPUs allocated`}>
                <Gpu className="size-3 text-lime-500" />
                <div className="flex flex-1 gap-0.5">{Array.from({ length: node.allocatable.gpu }, (_, i) => <span key={i} className={cn('h-1.5 flex-1 rounded-full', i < node.requested.gpu ? 'bg-lime-500' : 'bg-surface-3')} />)}</div>
                <span className="w-8 shrink-0 text-right text-muted">{node.gpu.model}</span>
              </div>
            )}
          </div>
          <div className="mt-2 flex min-h-[26px] flex-wrap content-start gap-[3px] rounded-md bg-surface-2/70 p-1.5">
            {shown.map((p) => <PodDot key={p.name} pod={p} dim={!!focusNs && p.namespace !== focusNs} onHover={onHover} />)}
            {shown.length === 0 && <span className="text-[10px] text-faint">no pods</span>}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-faint">
            <span>{pods.length} / {node.allocatable.pods} pods</span>
            <span>{fmtCpu(node.allocatable.cpuM - node.requested.cpuM)} · {fmtMem(node.allocatable.memMi - node.requested.memMi)} free</span>
          </div>
        </>
      )}
    </div>
  );
}

function PodTooltip({ pod, anchor }: { pod: K8sPod; anchor: DOMRect }) {
  const left = Math.min(window.innerWidth - 300, Math.max(8, anchor.left - 130));
  const top = anchor.bottom + 8 + 200 > window.innerHeight ? anchor.top - 8 : anchor.bottom + 8;
  const above = top < anchor.top;
  return createPortal(
    <div className="pointer-events-none fixed z-[95] w-[288px] animate-in rounded-xl border border-line bg-surface p-3 text-xs shadow-pop" style={{ left, top, transform: above ? 'translateY(-100%)' : undefined }}>
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-[3px]" style={{ background: nsColor(pod.namespace) }} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-medium text-fg">{pod.name}</span>
      </div>
      <div className="mt-1 text-muted">{pod.namespace} · {pod.kind} {pod.workloadName}</div>
      <div className="mt-2 grid grid-cols-[70px_1fr] gap-x-2 gap-y-1">
        <span className="text-faint">Status</span><span><StatusPill status={pod.status} /></span>
        <span className="text-faint">Node</span><span className="truncate font-mono text-[11px] text-fg-2">{pod.node ?? '—'}</span>
        <span className="text-faint">Requests</span><span className="text-fg-2">{fmtCpu(pod.cpuM)} · {fmtMem(pod.memMi)}{pod.gpu ? ` · ${pod.gpu} GPU` : ''}</span>
        {pod.ip && <><span className="text-faint">Pod IP</span><span className="font-mono text-[11px] text-fg-2">{pod.ip}</span></>}
        <span className="text-faint">Restarts</span><span className={cn('text-fg-2', pod.restarts > 5 && 'text-rose-500')}>{pod.restarts}</span>
        <span className="text-faint">Image</span><span className="truncate font-mono text-[10.5px] text-fg-2">{pod.image}</span>
      </div>
      {pod.reason && <div className={cn('mt-2 rounded-md p-1.5 text-[11px]', pod.unschedulable || pod.status === 'CrashLoopBackOff' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'bg-surface-2 text-muted')}>{pod.reason}</div>}
    </div>,
    overlayRoot(),
  );
}

export function ClusterMap({ cluster, topology, poolActions, className, emptyHint }: {
  cluster: K8sCluster; topology: K8sTopology | undefined; poolActions?: (pool: NodePool) => ReactNode; className?: string; emptyHint?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [focusNs, setFocusNs] = useState<string | null>(null);
  const [showSystem, setShowSystem] = useState(true);
  const [hover, setHover] = useState<{ pod: K8sPod; rect: DOMRect } | null>(null);
  useFlip(ref);

  const nodes = topology?.nodes ?? [];
  const pods = topology?.pods ?? [];
  const podsByNode = useMemo(() => {
    const m = new Map<string, K8sPod[]>();
    for (const p of pods) if (p.node && p.status !== 'Pending') { const l = m.get(p.node); if (l) l.push(p); else m.set(p.node, [p]) }
    for (const l of m.values()) l.sort((a, b) => Number(b.system) - Number(a.system) || a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
    return m;
  }, [pods]);
  const queued = pods.filter((p) => !p.unschedulable && (p.status === 'Pending' || !p.node));
  const unschedulable = pods.filter((p) => p.unschedulable);
  const nsCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pods) if (showSystem || !p.system) m.set(p.namespace, (m.get(p.namespace) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [pods, showSystem]);

  const onHover = (p: K8sPod | null, el?: HTMLElement) => setHover(p && el ? { pod: p, rect: el.getBoundingClientRect() } : null);
  const unschedByWl = useMemo(() => {
    const m = new Map<string, K8sPod[]>();
    for (const p of unschedulable) { const l = m.get(p.workloadId); if (l) l.push(p); else m.set(p.workloadId, [p]) }
    return [...m.values()];
  }, [unschedulable]);

  if (!topology) return <div className={cn('space-y-3', className)}><Skeleton className="h-8 w-64" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>;

  return (
    <div ref={ref} className={cn('relative', className)}>
      {/* legend */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 flex items-center gap-1 text-xs font-medium text-muted"><Layers className="size-3.5" /> Namespaces</span>
        {nsCounts.map(([ns, n]) => (
          <button key={ns} type="button" onClick={() => setFocusNs(focusNs === ns ? null : ns)}
            className={cn('inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors', focusNs === ns ? 'border-brand-500 bg-brand-500/10 text-fg' : 'border-line bg-surface text-fg-2 hover:border-line-strong', focusNs && focusNs !== ns && 'opacity-50')}>
            <span className="size-2.5 rounded-[3px]" style={{ background: nsColor(ns) }} />{ns}<span className="tabular text-faint">{n}</span>
          </button>
        ))}
        <button type="button" onClick={() => setShowSystem(!showSystem)} className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted hover:bg-surface-2 hover:text-fg">
          {showSystem ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />} System pods
        </button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="size-[11px] rounded-[3px] bg-brand-500" /> Running</span>
        <span className="flex items-center gap-1.5"><span className="size-[11px] rounded-[3px] bg-brand-500/30 ring-[1.5px] ring-inset ring-brand-500" /> Starting</span>
        <span className="flex items-center gap-1.5"><span className="size-[11px] rounded-[3px] ring-[1.5px] ring-inset ring-brand-500" /> Queued</span>
        <span className="flex items-center gap-1.5"><span className="size-[11px] rounded-[3px] bg-rose-500" /> CrashLoop</span>
        <span className="flex items-center gap-1.5"><span className="size-[11px] rounded-[3px] bg-brand-500/25" /> Terminating</span>
        <span className="flex items-center gap-1.5"><span className="size-[11px] rounded-[3px] bg-surface-3 ring-1 ring-lime-400 ring-offset-1 ring-offset-surface" /> GPU</span>
        <span className="hidden @min-[36rem]:inline">· bars: requested (light) vs. used (solid)</span>
      </div>

      {/* lanes */}
      <div className="space-y-3">
        {cluster.nodePools.map((pool) => {
          const pnodes = nodes.filter((n) => n.poolId === pool.id);
          const ready = pnodes.filter((n) => n.status === 'Ready' && !n.surge).length;
          return (
            <div key={pool.id} className="rounded-xl border border-line bg-surface-2/40">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-2">
                <Server className="size-4 text-muted" />
                <span className="text-sm font-semibold text-fg">{pool.name}</span>
                <span className="text-xs text-muted">{presetLabel(pool)}</span>
                <span className="text-xs tabular text-fg-2">{ready}/{pool.targetCount ?? pool.count} ready</span>
                {pool.autoscale.enabled && <Badge tone="brand">autoscale {pool.autoscale.min}–{pool.autoscale.max}</Badge>}
                {pool.status !== 'ready' && <StatusPill status={pool.status} />}
                {pool.taints.map((t) => <Badge key={t} tone="warning" className="font-mono text-[10px]">{t}</Badge>)}
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-xs tabular text-muted">{money(poolNodeCost(pool) * (pool.targetCount ?? pool.count))}/mo</span>
                  {poolActions?.(pool)}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 p-2 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-3 @min-[76rem]:grid-cols-4">
                {pnodes.map((n) => <NodeCard key={n.name} node={n} pods={podsByNode.get(n.name) ?? []} focusNs={focusNs} showSystem={showSystem} onHover={onHover} />)}
                {pnodes.length === 0 && <div className="col-span-full py-4 text-center text-xs text-muted">{pool.count === 0 ? 'Scaled to zero — the autoscaler adds nodes when pods need them.' : 'No nodes yet'}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* trays */}
      {(queued.length > 0 || unschedulable.length > 0) && (
        <div className="mt-3 grid gap-3 @min-[44rem]:grid-cols-2">
          {queued.length > 0 && (
            <div className="rounded-xl border border-dashed border-sky-500/40 bg-sky-500/[0.04] p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-sky-700 dark:text-sky-300"><Hourglass className="size-3.5" /> Rolling out · {queued.length} pod{queued.length > 1 ? 's' : ''} waiting to start</div>
              <div className="flex flex-wrap gap-[3px]">{queued.map((p) => <PodDot key={p.name} pod={p} dim={!!focusNs && p.namespace !== focusNs} onHover={onHover} />)}</div>
            </div>
          )}
          {unschedulable.length > 0 && (
            <div className={cn('rounded-xl border border-dashed border-rose-500/50 bg-rose-500/[0.04] p-3', queued.length === 0 && '@min-[44rem]:col-span-2')}>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-rose-700 dark:text-rose-300"><AlertTriangle className="size-3.5" /> Unschedulable · {unschedulable.length} pod{unschedulable.length > 1 ? 's' : ''} pending</div>
              <div className="space-y-2">
                {unschedByWl.map((list) => (
                  <div key={list[0].workloadId} className="flex flex-col gap-1 @min-[36rem]:flex-row @min-[36rem]:items-start @min-[36rem]:gap-3">
                    <div className="flex shrink-0 flex-wrap gap-[3px] pt-0.5">{list.map((p) => <PodDot key={p.name} pod={p} dim={false} onHover={onHover} />)}</div>
                    <div className="min-w-0 text-[11.5px]">
                      <span className="font-medium text-fg">{list[0].namespace}/{list[0].workloadName}</span>
                      <span className="text-muted"> · {list.length}× {fmtCpu(list[0].cpuM)} / {fmtMem(list[0].memMi)}</span>
                      <div className="text-rose-700/90 dark:text-rose-300/90">{list[0].reason}</div>
                    </div>
                  </div>
                ))}
              </div>
              {emptyHint}
            </div>
          )}
        </div>
      )}
      {hover && <PodTooltip pod={hover.pod} anchor={hover.rect} />}
    </div>
  );
}
