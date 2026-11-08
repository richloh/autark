import { CheckCircle2, AlertTriangle, CircleDashed, XCircle, Cpu, MemoryStick, Server, Box, Puzzle, ArrowUpCircle, Radio } from 'lucide-react';
import { Link } from 'react-router';
import { Card, CardHeader, KeyValue } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Mono } from '@/components/ui/misc';
import { Stat } from '@/components/ui/Stat';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { money, timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { ClusterMap } from './ClusterMap';
import { CNI_INFO, fmtCpu, fmtMem } from './k8sUi';
import { Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import { K8S_ADDONS, K8S_VERSIONS, type K8sCluster, type K8sTopology, type K8sEvent } from '@/types';

const HEALTH_ICON = { healthy: CheckCircle2, degraded: AlertTriangle, down: XCircle, pending: CircleDashed };
const HEALTH_TONE = { healthy: 'text-emerald-500', degraded: 'text-amber-500', down: 'text-rose-500', pending: 'text-faint animate-pulse-soft' };

export function EventsList({ events, limit = 8 }: { events: K8sEvent[]; limit?: number }) {
  if (!events.length) return <div className="px-4 py-6 text-center text-xs text-muted">No recent events</div>;
  return (
    <ul className="divide-y divide-line">
      {events.slice(0, limit).map((e, i) => (
        <li key={i} className="flex gap-2.5 px-4 py-2.5 text-xs">
          <span className={cn('mt-1 size-1.5 shrink-0 rounded-full', e.type === 'Warning' ? 'bg-amber-500' : 'bg-sky-500')} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={cn('font-medium', e.type === 'Warning' ? 'text-amber-700 dark:text-amber-400' : 'text-fg')}>{e.reason}</span>
              <span className="truncate font-mono text-[10.5px] text-muted">{e.object}</span>
              {e.count && e.count > 1 && <span className="text-faint">×{e.count}</span>}
              <span className="ml-auto text-faint">{timeAgo(e.time)}</span>
            </div>
            <div className="mt-0.5 break-words text-muted">{e.message}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ClusterOverviewTab({ cluster: c, topology, onTab }: { cluster: K8sCluster; topology: K8sTopology | undefined; onTab: (t: string) => void }) {
  const s = topology?.summary ?? c.summary;
  const vinfo = K8S_VERSIONS.find((v) => v.version === c.version);
  const installed = K8S_ADDONS.filter((a) => c.addons[a.id]);
  const pro = usePro();
  return (
    <div className="space-y-5">
      <div className={cn('grid grid-cols-2 gap-3', pro ? '@min-[44rem]:grid-cols-5' : '@min-[44rem]:grid-cols-4')}>
        <Stat label="Nodes ready" value={`${s?.readyNodes ?? 0} / ${s?.nodes ?? 0}`} icon={Server} sub={`${c.nodePools.length} pool${c.nodePools.length > 1 ? 's' : ''}`} />
        <Stat label="Pods" value={s?.runningPods ?? 0} icon={Box} sub={s?.pendingPods ? <span className="text-amber-600 dark:text-amber-400">{s.pendingPods} pending</span> : `${s?.workloads ?? 0} workloads · ${s?.namespaces ?? 0} ns`} />
        <Stat label="CPU requested" value={`${Math.round((s?.cpuRequestedPct ?? 0) * 100)}%`} icon={Cpu} sub={`of ${fmtCpu(s?.allocatableCpuM ?? 0)}`} />
        <Stat label="Memory requested" value={`${Math.round((s?.memRequestedPct ?? 0) * 100)}%`} icon={MemoryStick} sub={`of ${fmtMem(s?.allocatableMemMi ?? 0)}`} />
        <Pro><Stat label="Monthly cost" value={money(c.monthlyCost)} sub="control plane + nodes" accent="#326ce5" className="col-span-2 @min-[44rem]:col-span-1" /></Pro>
      </div>

      <div className="grid items-start gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-fg"><Radio className="size-4 text-brand-500" /> Cluster map</h3>
              <p className="mt-0.5 text-xs text-muted">Every square is a pod{pro ? ', colored by namespace' : ''}. Hover for details.</p>
            </div>
            <button type="button" onClick={() => onTab('nodes')} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300">Manage node pools →</button>
          </div>
          <ClusterMap cluster={c} topology={topology} emptyHint={c.nodePools.some((p) => p.autoscale.enabled) ? null : <p className="mt-2 text-[11px] text-muted">Tip: enable autoscaling on a node pool, or scale a pool up in <button className="underline" onClick={() => onTab('nodes')}>Nodes & pools</button>.</p>} />
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title={pro ? 'Control plane' : 'Cluster'} description={c.controlPlane.ha ? (pro ? 'Highly available · 3 replicas' : 'Highly available control plane') : (pro ? 'Single replica' : undefined)} />
            <div className="space-y-3 p-4">
              <div>
                <div className="text-xs font-medium text-muted">API endpoint</div>
                <Mono copy className="mt-1 text-fg">{c.controlPlane.endpoint}</Mono>
                {c.privateEndpoint && <Badge className="mt-1">private</Badge>}
              </div>
              {!pro ? (
                <KeyValue cols={2} items={[
                  ['Version', <span className="font-mono">v{vinfo?.patch ?? c.version}</span>],
                  ['Upgrade', c.upgradeAvailable ? <button onClick={() => onTab('settings')} className="flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-300"><ArrowUpCircle className="size-3.5" />{c.upgradeAvailable} available</button> : <span className="text-muted">latest</span>],
                  ['Location', c.locationId],
                  ['Node pools', c.nodePools.length],
                ]} />
              ) : <KeyValue cols={2} items={[
                ['Version', <span className="flex items-center gap-1.5"><span className="font-mono">v{vinfo?.patch ?? c.version}</span>{c.controlPlaneVersion && c.controlPlaneVersion !== c.version && <Badge tone="info">CP → {c.controlPlaneVersion}</Badge>}</span>],
                ['Upgrade', c.upgradeAvailable ? <button onClick={() => onTab('upgrade')} className="flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-300"><ArrowUpCircle className="size-3.5" />{c.upgradeAvailable} available</button> : <span className="text-muted">latest</span>],
                ['Size', c.controlPlane.size],
                ['CNI', CNI_INFO[c.cni]?.label ?? c.cni],
                ['Pod CIDR', <span className="font-mono text-xs">{c.podCidr}</span>],
                ['Service CIDR', <span className="font-mono text-xs">{c.serviceCidr}</span>],
                ['Network', <ResourceLink type="network" id={c.networkId} />],
                ['Location', c.locationId],
              ]} />}
            </div>
          </Card>
          <Pro>
          <Card>
            <CardHeader title="Component health" />
            <ul className="divide-y divide-line">
              {(c.health ?? []).map((h) => {
                const Icon = HEALTH_ICON[h.status];
                return (
                  <li key={h.component} className="flex items-center gap-2.5 px-4 py-2 text-[13px]">
                    <Icon className={cn('size-4 shrink-0', HEALTH_TONE[h.status])} />
                    <span className="text-fg">{h.component}</span>
                    <span className="ml-auto truncate text-xs text-muted">{h.detail}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Add-ons" icon={Puzzle} actions={<button onClick={() => onTab('addons')} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300">Manage</button>} />
            <div className="flex flex-wrap gap-1.5 p-4">
              {installed.length === 0 && <span className="text-xs text-muted">No add-ons installed</span>}
              {installed.map((a) => <Badge key={a.id} tone="brand">{a.name}</Badge>)}
            </div>
          </Card>
          <Card>
            <CardHeader title="Recent events" actions={<Link to="?tab=activity" onClick={(e) => { e.preventDefault(); onTab('activity') }} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300">All</Link>} />
            <EventsList events={topology?.events ?? []} limit={6} />
          </Card>
          </Pro>
        </div>
      </div>
    </div>
  );
}
