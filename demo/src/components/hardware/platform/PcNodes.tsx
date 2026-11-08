import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Layers, Server, MoreHorizontal, CircleSlash, CirclePlay, Check, Undo2, ShipWheel } from 'lucide-react';
import { api } from '@/api/client';
import { useGet, useApiMutation } from '@/api/hooks';
import { usePro } from '@/store/ui';
import { Card, CardHeader } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusPill, Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { NumberInput } from '@/components/ui/form';
import { Menu } from '@/components/ui/Menu';
import { confirm } from '@/components/ui/Modal';
import { Mono } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import type { NodePool } from '@/types';
import { n1, SYSTEM_RESERVE, type PlatformClusterView, type PlatformNodeRow } from './shared';

const NODE_STATUS: Record<PlatformNodeRow['status'], string> = { Ready: 'Ready', Provisioning: 'provisioning', Draining: 'draining', Upgrading: 'upgrading', SchedulingDisabled: 'disabled' };

export function PcNodes({ pc, busy }: { pc: PlatformClusterView; busy: boolean }) {
  const pro = usePro();
  const { data, isLoading } = useGet<{ items: PlatformNodeRow[] }>(['platformClusters', 'nodes', pc.id], `/platformClusters/${pc.id}/nodes`, { refetchInterval: 2500 });
  const nodes = data?.items ?? [];
  const workers = nodes.filter((n) => n.role === 'worker');
  const cps = nodes.filter((n) => n.role === 'control-plane');
  const hosts = [...new Set(nodes.map((n) => n.hostName).filter(Boolean))];
  const nodeAction = useApiMutation(({ action, node }: { action: 'drainNode' | 'uncordonNode'; node: string }) => api.action(`platformClusters`, pc.id, action, { node }), {
    success: (_r, v) => (v.action === 'drainNode' ? `Draining ${v.node}` : `${v.node} is schedulable again`),
  });
  const drain = async (n: PlatformNodeRow) => {
    const ok = await confirm({ title: `Drain ${n.name}?`, message: `${n.pods} tenant pod${n.pods === 1 ? '' : 's'} are evicted and rescheduled on other nodes (PodDisruptionBudgets are respected). The node stays cordoned until you uncordon it, so its capacity no longer counts.`, confirmLabel: 'Drain node' });
    if (ok) nodeAction.mutate({ action: 'drainNode', node: n.name });
  };

  const columns: Column<PlatformNodeRow>[] = [
    { id: 'name', header: 'Node', sort: (n) => n.name, cell: (n) => (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-medium text-fg">{n.role === 'control-plane' && <ShipWheel className="size-3.5 text-cyan-600" />}{n.name}</div>
        <div className="text-[11px] text-muted">{n.role === 'control-plane' ? 'control plane' : n.poolName} · {n.vcpus} vCPU / {n.ramGB} GB{pro ? ` · ${n.internalIp}` : ''}</div>
      </div>
    ) },
    { id: 'host', header: 'Bare-metal host', sort: (n) => n.hostName ?? '', cell: (n) => n.hostId
      ? <Link to={`/hardware/bare-metals/${n.hostId}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 text-[13px] text-brand-600 hover:underline dark:text-brand-400"><Server className="size-3.5" />{n.hostName}</Link>
      : <span className="text-xs text-amber-600 dark:text-amber-400">no eligible host</span> },
    { id: 'requested', header: 'Requested', hideBelow: 'sm', sort: (n) => (n.allocatable.cpuCores ? n.requested.cpuCores / n.allocatable.cpuCores : 0), cell: (n) => n.role === 'worker' ? (
      <div className="w-32 space-y-1">
        {([['CPU', n.requested.cpuCores, n.allocatable.cpuCores], ['Mem', n.requested.memoryGi, n.allocatable.memoryGi]] as [string, number, number][]).map(([l, v, m]) => (
          <div key={l} className="flex items-center gap-1.5">
            <span className="w-7 text-[10px] text-faint">{l}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full bg-[#326ce5]" style={{ width: `${Math.min(100, (v / Math.max(0.01, m)) * 100)}%` }} /></span>
            <span className="w-9 text-right text-[10px] tabular text-muted">{m ? Math.round((v / m) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    ) : <span className="text-xs text-faint">no tenant pods</span> },
    { id: 'pods', header: 'Pods', hideBelow: 'lg', align: 'right', sort: (n) => n.pods, cell: (n) => <span className="text-xs tabular text-fg-2">{n.role === 'worker' ? n.pods : '—'}</span> },
    ...(pro ? [{ id: 'version', header: 'Kubelet', hideBelow: 'xl', sort: (n: PlatformNodeRow) => n.version, cell: (n: PlatformNodeRow) => <Mono className="text-xs">{n.version}</Mono> } as Column<PlatformNodeRow>] : []),
    { id: 'status', header: 'Status', sort: (n) => n.status, cell: (n) => <StatusPill status={NODE_STATUS[n.status]} label={n.status === 'SchedulingDisabled' ? 'cordoned' : undefined} /> },
  ];

  return (
    <div className="space-y-5">
      <div className="grid [&>*]:min-w-0 gap-4 @min-[60rem]:grid-cols-2">
        {pc.nodePools.map((p) => <PoolCard key={p.id} pc={pc} pool={p} busy={busy} />)}
      </div>
      <Card>
        <CardHeader title="Nodes" icon={Layers} description={`${workers.length} workers + ${cps.length} control plane on ${hosts.length} bare-metal host${hosts.length === 1 ? '' : 's'}`} />
        <DataTable
          rows={nodes.map((n) => ({ ...n, id: n.name }))}
          loading={isLoading}
          columns={columns as Column<PlatformNodeRow & { id: string }>[]}
          searchText={(n) => `${n.name} ${n.hostName ?? ''} ${n.poolName}`}
          searchPlaceholder="Search nodes or hosts…"
          pageSize={50}
          rowActions={(n) => n.role === 'worker' ? (
            <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Node actions" size="sm" />} items={[
              n.cordoned
                ? { label: 'Uncordon', icon: CirclePlay, onClick: () => nodeAction.mutate({ action: 'uncordonNode', node: n.name }) }
                : { label: 'Cordon & drain…', icon: CircleSlash, disabled: n.status !== 'Ready', onClick: () => drain(n) },
              ...(n.hostId ? [{ label: `Open host ${n.hostName}`, icon: Server, to: `/hardware/bare-metals/${n.hostId}` }] : []),
            ]} />
          ) : null}
        />
      </Card>
    </div>
  );
}

function PoolCard({ pc, pool, busy }: { pc: PlatformClusterView; pool: NodePool; busy: boolean }) {
  const pro = usePro();
  const [count, setCount] = useState(pool.targetCount ?? pool.count);
  useEffect(() => { setCount(pool.targetCount ?? pool.count) }, [pool.count, pool.targetCount]);
  const scaling = pool.status === 'scaling';
  const delta = count - pool.count;
  const perNode = { cpu: pool.vcpus * (1 - SYSTEM_RESERVE), mem: pool.ramGB * (1 - SYSTEM_RESERVE) };
  const cap = pc.capacity ?? { cpuCores: 0, memoryGi: 0 };
  const after = { cpu: cap.cpuCores + delta * perNode.cpu, mem: cap.memoryGi + delta * perNode.mem };
  const promised = pc.promised ?? { cpuCores: 0, memoryGi: 0, spaces: 0 };
  const tooSmall = promised.cpuCores > after.cpu * pc.overcommit.cpu || promised.memoryGi > after.mem * pc.overcommit.memory;
  const scale = useApiMutation(() => api.action('platformClusters', pc.id, 'scalePool', { poolId: pool.id, count }), {
    success: `Scaling ${pool.name} to ${count} nodes`,
    onError: () => setCount(pool.count),
  });
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-fg">{pool.name}</span>
            {scaling ? <StatusPill status="scaling" /> : <Badge>{pool.count} nodes</Badge>}
          </div>
          <div className="mt-0.5 text-xs tabular text-muted">{pool.vcpus} vCPU · {pool.ramGB} GB per node · {n1(Math.round(perNode.cpu * 10) / 10)} cores / {n1(Math.round(perNode.mem * 10) / 10)} GiB allocatable each</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <NumberInput value={count} min={1} max={50} onChange={setCount} disabled={busy || scaling} className="w-36" unit="nodes" />
        {delta !== 0 && !scaling && (
          <>
            <Button variant="primary" size="sm" icon={Check} disabled={busy || tooSmall} loading={scale.isPending} onClick={() => {
              if (tooSmall) { toast.error('Not enough capacity', 'Tenants were promised more than this pool size can back.'); return }
              scale.mutate();
            }}>{delta > 0 ? `Add ${delta}` : `Remove ${-delta}`}</Button>
            <Button variant="ghost" size="sm" icon={Undo2} onClick={() => setCount(pool.count)}>Reset</Button>
          </>
        )}
      </div>
      {delta !== 0 && !scaling && (
        <div className={cn('mt-2 text-xs', tooSmall ? 'text-rose-600 dark:text-rose-400' : 'text-muted')}>
          {tooSmall
            ? `Too small: tenants were promised ${n1(promised.cpuCores)} cores / ${n1(promised.memoryGi)} GiB, this would allow only ${n1(Math.round(after.cpu * pc.overcommit.cpu * 10) / 10)} / ${n1(Math.round(after.mem * pc.overcommit.memory))}.`
            : `Promisable after change: ${n1(Math.round(after.cpu * pc.overcommit.cpu * 10) / 10)} cores · ${n1(Math.round(after.mem * pc.overcommit.memory))} GiB${pro ? ` (${delta > 0 ? '+' : ''}${n1(Math.round(delta * perNode.cpu * 10) / 10)} cores allocatable)` : ''}.`}
        </div>
      )}
    </Card>
  );
}
