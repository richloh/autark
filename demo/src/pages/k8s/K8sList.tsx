import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Boxes, Plus, MoreHorizontal, Download, ArrowUpCircle, Trash2, Server, Box, AlertTriangle, Building2, Cloud, ExternalLink } from 'lucide-react';
import { useList, useLookup } from '@/api/hooks';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { Badge, StatusPill, Tags } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Stat } from '@/components/ui/Stat';
import { OperationInline } from '@/components/resource/OperationRunner';
import { downloadKubeconfig, deleteCluster } from '@/components/k8s/clusterActions';
import { money, num } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import { K8S_VERSIONS, type K8sCluster, type Location, type Operation, type Project } from '@/types';

const TRANSITIONAL: K8sCluster['status'][] = ['provisioning', 'upgrading', 'scaling', 'deleting'];

function VersionCell({ c }: { c: K8sCluster }) {
  const pro = usePro();
  const info = K8S_VERSIONS.find((v) => v.version === c.version);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={info?.status === 'deprecated' ? 'warning' : 'neutral'} className="font-mono">v{info?.patch ?? c.version}</Badge>
      {c.upgradeAvailable && c.status !== 'upgrading' && (
        <Link to={`/managed-services/kubernetes/${c.id}?tab=${pro ? 'upgrade' : 'settings'}`} onClick={(e) => e.stopPropagation()} title={`Upgrade to ${c.upgradeAvailable} available`}
          className="inline-flex items-center gap-0.5 rounded-md px-1 text-[11px] font-medium text-brand-600 hover:bg-brand-500/10 dark:text-brand-300">
          <ArrowUpCircle className="size-3.5" />{c.upgradeAvailable}
        </Link>
      )}
      {info?.status === 'deprecated' && <span title={`End of support ${info.endOfSupport}`}><AlertTriangle className="size-3.5 text-amber-500" /></span>}
    </div>
  );
}

const POOL_COLORS = ['#326ce5', '#a855f7', '#06b6d4', '#f59e0b', '#10b981', '#ec4899'];

/** Small node map: one square per node, colored per pool, faded when not ready. */
function NodeStrip({ c }: { c: K8sCluster }) {
  const total = c.nodePools.reduce((a, p) => a + p.count, 0);
  return (
    <div className="min-w-0">
      <div className="flex max-w-[180px] flex-wrap gap-[3px]">
        {c.nodePools.flatMap((p, pi) => Array.from({ length: Math.min(p.count, 24) }, (_, i) => {
          const joining = p.readyCount != null && i >= p.readyCount;
          const leaving = p.targetCount != null && i >= p.targetCount;
          return <span key={p.id + i} title={`${p.name} · ${p.vcpus} vCPU / ${p.ramGB} GB${p.gpu ? ` · ${p.gpu.model}` : ''}`} className={cn('size-2.5 rounded-[3px]', (joining || c.status === 'provisioning') && 'animate-pulse-soft opacity-40', leaving && 'opacity-30')} style={{ background: p.gpu ? '#84cc16' : POOL_COLORS[pi % POOL_COLORS.length] }} />;
        }))}
      </div>
      <div className="mt-1 truncate text-[11px] text-muted">{c.summary?.readyNodes ?? total}/{total} ready · {c.nodePools.map((p) => `${p.name} ${p.count}×`).join(' · ')}</div>
    </div>
  );
}

function UtilCell({ c }: { c: K8sCluster }) {
  const s = c.summary;
  if (!s || c.status === 'provisioning') return <span className="text-faint">—</span>;
  const bar = (v: number) => <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3"><div className={cn('h-full rounded-full', v > 0.9 ? 'bg-rose-500' : v > 0.75 ? 'bg-amber-500' : 'bg-brand-500')} style={{ width: `${Math.min(100, v * 100)}%` }} /></div>;
  return (
    <div className="space-y-1 text-[11px] text-muted">
      <div className="flex items-center gap-2"><span className="w-7">CPU</span>{bar(s.cpuRequestedPct)}<span className="tabular">{Math.round(s.cpuRequestedPct * 100)}%</span></div>
      <div className="flex items-center gap-2"><span className="w-7">Mem</span>{bar(s.memRequestedPct)}<span className="tabular">{Math.round(s.memRequestedPct * 100)}%</span></div>
    </div>
  );
}

export default function K8sList() {
  const [sp] = useSearchParams();
  const pro = usePro();
  const { items: clusters, isLoading } = useList<K8sCluster>('k8sClusters');
  const { map: projects } = useLookup<Project>('projects');
  const { map: locations } = useLookup<Location>('locations');
  const { items: ops } = useList<Operation>('operations', { status: 'running' });
  const [filter, setFilter] = useState<'all' | 'running' | 'attention' | 'upgrade'>('all');
  const opByTarget = useMemo(() => new Map(ops.filter((o) => !o.type.startsWith('k8s.workload')).map((o) => [o.target.id, o])), [ops]);

  const attention = (c: K8sCluster) => c.status === 'error' || c.status === 'degraded' || (c.summary?.pendingPods ?? 0) > 0 || K8S_VERSIONS.find((v) => v.version === c.version)?.status === 'deprecated';
  const counts = {
    all: clusters.length,
    running: clusters.filter((c) => c.status === 'running').length,
    attention: clusters.filter(attention).length,
    upgrade: clusters.filter((c) => c.upgradeAvailable).length,
  };
  const rows = clusters.filter((c) => filter === 'all' || (filter === 'running' ? c.status === 'running' : filter === 'attention' ? attention(c) : !!c.upgradeAvailable));
  const nodes = clusters.reduce((a, c) => a + (c.summary?.nodes ?? 0), 0);
  const readyNodes = clusters.reduce((a, c) => a + (c.summary?.readyNodes ?? 0), 0);
  const pods = clusters.reduce((a, c) => a + (c.summary?.runningPods ?? 0), 0);
  const pending = clusters.reduce((a, c) => a + (c.summary?.pendingPods ?? 0), 0);
  const cost = clusters.reduce((a, c) => a + (c.monthlyCost ?? 0), 0);

  const allColumns: (Column<K8sCluster> & { pro?: boolean })[] = [
    {
      id: 'name', header: 'Cluster', sort: (c) => c.name,
      cell: (c) => {
        const p = projects.get(c.projectId);
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-[#326ce5]/10 text-[#326ce5]"><Boxes className="size-4" /></div>
            <div className="min-w-0">
              <Link to={`/managed-services/kubernetes/${c.id}`} className="block truncate font-medium text-fg hover:text-brand-500">{c.name}</Link>
              <div className="flex items-center gap-1.5 text-[11px] text-muted">
                {p && <span className="size-1.5 rounded-full" style={{ background: p.color }} title={p.name} />}
                {pro ? <span className="font-mono">{c.id}</span> : <span>{locations.get(c.locationId)?.name ?? c.locationId}</span>}
                {c.controlPlane.ha && <span className="rounded bg-surface-3 px-1 text-[10px] font-medium text-fg-2">HA</span>}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'status', header: 'Status', sort: (c) => c.status,
      cell: (c) => {
        const op = opByTarget.get(c.id);
        return (
          <div className="w-36">
            <StatusPill status={c.status} />
            {op ? <OperationInline op={op} className="mt-1.5" /> : (c.summary?.pendingPods ?? 0) > 0 && <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{c.summary!.pendingPods} pods pending</div>}
          </div>
        );
      },
    },
    { id: 'version', header: 'Version', sort: (c) => c.version, cell: (c) => <VersionCell c={c} /> },
    { id: 'nodes', header: 'Nodes', sort: (c) => c.summary?.nodes ?? 0, cell: (c) => <NodeStrip c={c} /> },
    { id: 'util', header: 'Requested', pro: true, hideBelow: 'lg', sort: (c) => c.summary?.cpuRequestedPct ?? 0, cell: (c) => <UtilCell c={c} /> },
    { id: 'workloads', header: 'Workloads', pro: true, hideBelow: 'xl', sort: (c) => c.summary?.pods ?? 0, cell: (c) => <span className="text-fg-2"><span className="tabular text-fg">{c.summary?.workloads ?? 0}</span> · {c.summary?.runningPods ?? 0} pods</span> },
    {
      id: 'location', header: 'Location', pro: true, hideBelow: 'xl', sort: (c) => c.locationId,
      cell: (c) => {
        const l = locations.get(c.locationId);
        return <span className="flex items-center gap-1.5 text-fg-2">{l?.kind === 'cloud' ? <Cloud className="size-3.5 text-sky-500" /> : <Building2 className="size-3.5 text-emerald-500" />}{l?.name ?? c.locationId}</span>;
      },
    },
    { id: 'tags', header: 'Tags', pro: true, hideBelow: 'xl', cell: (c) => <Tags tags={c.tags} max={2} /> },
    { id: 'cost', header: 'Monthly', pro: true, align: 'right', sort: (c) => c.monthlyCost ?? 0, cell: (c) => <span className="tabular text-fg">{money(c.monthlyCost)}</span> },
  ];
  const columns: Column<K8sCluster>[] = allColumns.filter((col) => pro || !col.pro);

  return (
    <Page wide>
      <PageHeader
        title="Kubernetes"
        description={pro ? 'Managed, upstream Kubernetes on your own hardware — HA control planes, autoscaling node pools and one-click upgrades.' : 'Managed Kubernetes clusters with one-click upgrades.'}
        icon={Boxes}
        iconColor="#326ce5"
        actions={<Button variant="primary" icon={Plus} to="/managed-services/kubernetes/new">Create cluster</Button>}
      />
      <Pro>
      <div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Clusters" value={`${counts.running} / ${counts.all}`} icon={Boxes} sub={counts.upgrade ? <span className="text-brand-600 dark:text-brand-300">{counts.upgrade} upgrade{counts.upgrade > 1 ? 's' : ''} available</span> : 'all up to date'} />
        <Stat label="Nodes" value={`${num(readyNodes)} / ${num(nodes)}`} icon={Server} sub="ready across all pools" />
        <Stat label="Running pods" value={num(pods)} icon={Box} sub={pending ? <span className="text-amber-600 dark:text-amber-400">{pending} pending</span> : 'none pending'} />
        <Stat label="Monthly run-rate" value={money(cost)} sub="control planes & nodes" accent="#326ce5" />
      </div>
      </Pro>
      <DataTable
        rows={rows}
        loading={isLoading}
        columns={columns}
        initialSearch={sp.get('q') ?? ''}
        searchText={(c) => `${c.name} ${c.id} ${c.version} ${c.locationId} ${c.cni} ${c.tags.map((t) => `${t.key}:${t.value} ${t.value}`).join(' ')} ${c.nodePools.map((p) => p.name).join(' ')}`}
        searchPlaceholder="Search name, version, pool, tag…"
        rowLink={(c) => `/managed-services/kubernetes/${c.id}`}
        defaultSort={{ id: 'name', dir: 'asc' }}
        toolbar={<FilterChips value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All', count: counts.all }, { value: 'running', label: 'Running', count: counts.running },
          ...(counts.attention ? [{ value: 'attention' as const, label: 'Needs attention', count: counts.attention }] : []),
          ...(pro && counts.upgrade ? [{ value: 'upgrade' as const, label: 'Upgrade available', count: counts.upgrade }] : []),
        ]} />}
        rowClassName={(c) => (TRANSITIONAL.includes(c.status) ? 'bg-brand-500/[0.02]' : undefined)}
        rowActions={(c) => (
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />} items={[
            { label: 'Open', icon: ExternalLink, to: `/managed-services/kubernetes/${c.id}` },
            { label: 'Download kubeconfig', icon: Download, disabled: c.status === 'provisioning', onClick: () => downloadKubeconfig(c) },
            { label: c.upgradeAvailable ? `Upgrade to ${c.upgradeAvailable}` : 'Up to date', icon: ArrowUpCircle, disabled: !c.upgradeAvailable, to: `/managed-services/kubernetes/${c.id}?tab=${pro ? 'upgrade' : 'settings'}` },
            { divider: true, label: '' },
            { label: 'Delete', icon: Trash2, danger: true, disabled: c.status === 'deleting', onClick: () => deleteCluster(c) },
          ]} />
        )}
        bulkActions={[{ label: 'Delete', icon: Trash2, danger: true, onClick: async (list) => { for (const c of list) await deleteCluster(c) } }]}
        empty={{ icon: Boxes, title: 'No Kubernetes clusters yet', description: 'Spin up a conformant cluster with autoscaling node pools in a few minutes.', action: <Button variant="primary" icon={Plus} to="/managed-services/kubernetes/new">Create cluster</Button> }}
      />
    </Page>
  );
}
