import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Box, Rocket, MoreHorizontal, Scaling, RotateCw, Trash2, ImageUp, Layers, Clock, Database, Cpu, Puzzle, AlertTriangle, Check } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation, useGet, useList } from '@/api/hooks';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { Menu } from '@/components/ui/Menu';
import { Modal, Drawer, confirm } from '@/components/ui/Modal';
import { Field, Input, Slider, NumberInput, Hint } from '@/components/ui/form';
import { KeyValue } from '@/components/ui/Card';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Tabs } from '@/components/ui/Tabs';
import { toast } from '@/components/ui/toast';
import { MetricsPanel } from '@/components/charts/MetricsPanel';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { DeployWorkloadModal, toManifest } from './DeployWorkloadModal';
import { fmtCpu, fmtMem, nsColor } from './k8sUi';
import { EventsList } from './ClusterOverviewTab';
import { usePro } from '@/store/ui';
import type { K8sCluster, K8sTopology, K8sWorkload, K8sPod, K8sClusterSummary, K8sSpace, SpaceQuota } from '@/types';
import { synthPods } from './spaces/spaceUi';

const KIND_ICON = { Deployment: Layers, StatefulSet: Database, DaemonSet: Cpu, CronJob: Clock };

function ScaleModal({ c, space, spaceUsed, w, onClose }: { c?: K8sCluster; space?: K8sSpace; spaceUsed?: SpaceQuota; w: K8sWorkload | null; onClose: () => void }) {
  const [n, setN] = useState(1);
  const [sim, setSim] = useState<{ workloadPending: number; autoscale: { poolName: string; from: number; to: number } | null; after: K8sClusterSummary } | null>(null);
  useEffect(() => { if (w) setN(w.replicas) }, [w?.id]); // eslint-disable-line
  useEffect(() => {
    if (!w || !c) return;
    const t = setTimeout(() => { api.post<typeof sim>(`/k8sClusters/${c.id}/simulate`, { workload: { id: w.id, replicas: n } }).then(setSim).catch(() => setSim(null)) }, 250);
    return () => clearTimeout(t);
  }, [n, w?.id]); // eslint-disable-line
  const scale = useApiMutation(() => api.action('k8sWorkloads', w!.id, 'scale', { replicas: n }), { success: `Scaling ${w?.name} to ${n}`, onSuccess: onClose });
  // in a space: how many replicas the quota allows (this workload's current requests are freed first)
  const quotaMax = space && w ? (() => {
    const used = spaceUsed ?? { cpuCores: 0, memoryGi: 0, storageGi: 0, pods: 0, loadBalancers: 0 };
    const lim = [
      w.cpuRequestM > 0 ? (space.quota.cpuCores - used.cpuCores + (w.cpuRequestM * w.replicas) / 1000) / (w.cpuRequestM / 1000) : Infinity,
      w.memRequestMi > 0 ? (space.quota.memoryGi - used.memoryGi + (w.memRequestMi * w.replicas) / 1024) / (w.memRequestMi / 1024) : Infinity,
      space.quota.pods - used.pods + w.replicas,
    ];
    return Math.max(0, Math.floor(Math.min(...lim) + 1e-9));
  })() : null;
  return (
    <Modal open={!!w} onClose={onClose} title={`Scale ${w?.namespace}/${w?.name}`} description={w ? `${fmtCpu(w.cpuRequestM)} · ${fmtMem(w.memRequestMi)} requested per pod` : undefined}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Scaling} loading={scale.isPending} disabled={!w || n === w.replicas} onClick={() => scale.mutate()}>Scale to {n}</Button></>}>
      {w && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Slider className="flex-1" value={n} onChange={setN} min={0} max={Math.max(20, w.replicas * 2)} marks={[0, Math.max(20, w.replicas * 2)]} />
            <NumberInput className="w-28" value={n} onChange={setN} min={0} max={200} />
          </div>
          <div className="flex flex-wrap gap-[3px]">{Array.from({ length: n }, (_, i) => <span key={i} className={cn('size-3 rounded-[3px]', i >= w.replicas ? 'animate-pulse-soft' : '')} style={{ background: i >= w.replicas ? `${nsColor(w.namespace)}66` : nsColor(w.namespace) }} />)}</div>
          {quotaMax != null && (n > quotaMax
            ? <Hint tone="warning">Your space quota allows up to <b>{quotaMax}</b> copies of this workload. Resize the quota in Settings to go higher.</Hint>
            : <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"><Check className="size-3.5" /> Fits in your quota (up to {quotaMax} copies)</div>)}
          {sim && n > w.replicas && (sim.workloadPending > 0
            ? <Hint tone="warning"><b>{sim.workloadPending}</b> pod(s) won't fit. {sim.autoscale ? <>The autoscaler will grow <b>{sim.autoscale.poolName}</b> {sim.autoscale.from} → {sim.autoscale.to}.</> : 'No autoscaling headroom — they will stay Pending.'}</Hint>
            : <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"><Check className="size-3.5" /> All replicas fit · cluster CPU requested → {Math.round(sim.after.cpuRequestedPct * 100)}%</div>)}
          {n === 0 && <Hint tone="warning">Scaling to 0 stops all pods. The {w.kind} and its configuration are kept.</Hint>}
        </div>
      )}
    </Modal>
  );
}

function ImageModal({ w, onClose }: { w: K8sWorkload | null; onClose: () => void }) {
  const [image, setImage] = useState('');
  useEffect(() => { if (w) setImage(w.image) }, [w?.id]); // eslint-disable-line
  const roll = useApiMutation(() => api.action('k8sWorkloads', w!.id, 'restart', { image }), { success: `Rolling out ${image.split('/').pop()}`, onSuccess: onClose });
  return (
    <Modal open={!!w} onClose={onClose} title={`Update image · ${w?.name}`} description="Pods are replaced one by one (rolling update, maxUnavailable 0)."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={ImageUp} loading={roll.isPending} disabled={!image || image === w?.image} onClick={() => roll.mutate()}>Roll out</Button></>}>
      <Field label="Container image" hint={`Current: ${w?.image}`}><Input value={image} onChange={(e) => setImage(e.target.value)} mono /></Field>
    </Modal>
  );
}

function WorkloadDrawer({ c, w, topology, onClose }: { c: { name: string }; w: K8sWorkload | null; topology: Pick<K8sTopology, 'pods' | 'events'> | undefined; onClose: () => void }) {
  const [tab, setTab] = useState('pods');
  const pods = (topology?.pods ?? []).filter((p) => p.workloadId === w?.id);
  const events = (topology?.events ?? []).filter((e) => w && e.object.includes(w.name));
  return (
    <Drawer open={!!w} onClose={onClose} width="max-w-2xl" title={w ? `${w.namespace}/${w.name}` : ''} description={w ? `${w.kind} · ${w.image}` : undefined}>
      {w && (
        <div className="space-y-5">
          <KeyValue cols={3} items={[
            ['Status', <StatusPill status={w.status} />],
            ['Ready', `${w.readyReplicas}/${w.replicas}`],
            ['Revision', w.revision ?? 1],
            ['Requests / pod', `${fmtCpu(w.cpuRequestM)} · ${fmtMem(w.memRequestMi)}${w.gpuPerPod ? ` · ${w.gpuPerPod} GPU` : ''}`],
            ['Ports', w.ports.length ? w.ports.join(', ') : '—'],
            ['Service', w.expose && w.expose !== 'none' ? w.expose : '—'],
            ...(w.schedule ? [['Schedule', <span className="font-mono">{w.schedule}</span>] as [string, React.ReactNode]] : []),
            ['Created', timeAgo(w.createdAt)],
            ['Restarted', w.restartedAt ? timeAgo(w.restartedAt) : '—'],
          ]} />
          {w.deployNote && <Hint tone={w.deployNote.startsWith('Cluster autoscaler') ? 'info' : 'warning'}>{w.deployNote}</Hint>}
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'pods', label: 'Pods', count: pods.length }, { id: 'metrics', label: 'Metrics' }, { id: 'yaml', label: 'YAML' }, { id: 'events', label: 'Events', count: events.length }]} />
          {tab === 'pods' && (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {pods.map((p) => (
                <li key={p.name} className="px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg">{p.name}</span>
                    <StatusPill status={p.status} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-muted">
                    <span>node <span className="font-mono">{p.node ?? '—'}</span></span>
                    {p.ip && <span className="font-mono">{p.ip}</span>}
                    <span>restarts {p.restarts}</span>
                    {p.startedAt && <span>up {timeAgo(p.startedAt).replace(' ago', '')}</span>}
                  </div>
                  {p.reason && <div className={cn('mt-1', p.unschedulable || p.status === 'CrashLoopBackOff' ? 'text-rose-600 dark:text-rose-400' : 'text-muted')}>{p.reason}</div>}
                </li>
              ))}
              {pods.length === 0 && <li className="px-3 py-4 text-center text-xs text-muted">{w.kind === 'CronJob' ? `Runs on schedule "${w.schedule}" — no pods right now.` : 'No pods'}</li>}
            </ul>
          )}
          {tab === 'metrics' && <MetricsPanel collection="k8sWorkloads" id={w.id} cols={1} charts={[{ title: 'CPU usage', metrics: ['cpu'], unit: 'm', format: (v) => fmtCpu(v) }, { title: 'Memory usage', metrics: ['memory'], unit: 'Mi', format: (v) => fmtMem(v) }]} />}
          {tab === 'yaml' && <CodeBlock code={toManifest(c, { ...w, env: w.env })} language="yaml" maxHeight="max-h-[60vh]" />}
          {tab === 'events' && <div className="rounded-lg border border-line"><EventsList events={events} limit={20} /></div>}
        </div>
      )}
    </Drawer>
  );
}

function PodDots({ pods, max = 16 }: { pods: K8sPod[]; max?: number }) {
  return (
    <div className="flex flex-wrap gap-[2px]">
      {pods.slice(0, max).map((p) => (
        <span key={p.name} title={`${p.name} · ${p.status}`} className={cn('size-2 rounded-[2px]', p.status === 'ContainerCreating' && 'animate-pulse-soft opacity-60', p.status === 'Terminating' && 'opacity-30')}
          style={{ background: p.unschedulable ? 'transparent' : p.status === 'CrashLoopBackOff' ? '#f43f5e' : nsColor(p.namespace), boxShadow: p.unschedulable || p.status === 'Pending' ? `inset 0 0 0 1px ${p.unschedulable ? '#f43f5e' : nsColor(p.namespace)}` : undefined }} />
      ))}
      {pods.length > max && <span className="text-[10px] text-faint">+{pods.length - max}</span>}
    </div>
  );
}

/**
 * Workloads of a dedicated cluster (`cluster` + `topology`) or of a shared-cluster space (`space`).
 * Spaces have a single, fixed namespace, no system workloads and quota-based headroom.
 */
export function WorkloadsTab({ cluster: c, space, spaceUsed, onResize, topology, onDeployed }: {
  cluster?: K8sCluster; space?: K8sSpace; spaceUsed?: SpaceQuota; onResize?: () => void; topology?: K8sTopology; onDeployed: () => void;
}) {
  const [sp] = useSearchParams();
  const { items: workloads, isLoading } = useList<K8sWorkload>('k8sWorkloads', space ? { spaceId: space.id } : { clusterId: c?.id }, { refetchInterval: 3000 });
  const [ns, setNs] = useState('all');
  const [deploying, setDeploying] = useState(false);
  const [scaleW, setScaleW] = useState<K8sWorkload | null>(null);
  const [imageW, setImageW] = useState<K8sWorkload | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [showSystem, setShowSystem] = useState(false);
  const pro = usePro();

  // spaces: derived pods from the API, synthesized from replica counts as a fallback
  const spacePods = useGet<{ items: K8sPod[] }>(['k8sWorkloads', 'spacePods', space?.id], space ? `/k8sSpaces/${space.id}/pods` : null, { refetchInterval: 3000 });
  const spaceTopology = useMemo(() => (space ? { pods: spacePods.data?.items ?? (spacePods.isError ? workloads.flatMap(synthPods) : []), events: [] } : undefined), [space, workloads, spacePods.data, spacePods.isError]);
  const topo = space ? spaceTopology : topology;
  const podsByWl = useMemo(() => {
    const m = new Map<string, K8sPod[]>();
    for (const p of topo?.pods ?? []) { const l = m.get(p.workloadId); if (l) l.push(p); else m.set(p.workloadId, [p]) }
    return m;
  }, [topo]);
  const isSystem = (w: K8sWorkload) => !space && (!!w.managedBy || w.namespace === 'kube-system');
  const visible = workloads.filter((w) => showSystem || !isSystem(w));
  const namespaces = [...new Set(workloads.map((w) => w.namespace))].sort();
  const nsCounts = new Map<string, number>();
  for (const w of visible) nsCounts.set(w.namespace, (nsCounts.get(w.namespace) ?? 0) + 1);
  const rows = visible.filter((w) => ns === 'all' || w.namespace === ns);
  const deployable = space ? space.status === 'active' || space.status === 'resizing' : !!c && c.status !== 'provisioning' && c.status !== 'deleting' && c.status !== 'error';

  const restart = useApiMutation((w: K8sWorkload) => api.action('k8sWorkloads', w.id, 'restart', {}), { success: (_r, w) => `Rolling restart of ${w.name}` });
  const remove = async (list: K8sWorkload[]) => {
    const blocked = list.filter(isSystem);
    const ok = list.filter((w) => !isSystem(w));
    if (blocked.length) toast.info(`${blocked.length} system / add-on workload(s) skipped`, 'Manage add-ons in the Add-ons tab.');
    if (!ok.length) return;
    const res = await confirm({ title: ok.length === 1 ? `Delete ${ok[0].namespace}/${ok[0].name}?` : `Delete ${ok.length} workloads?`, message: 'Pods are terminated with a 30s grace period. Services exposed by the workload are deleted too.', confirmLabel: 'Delete', danger: true, typeToConfirm: ok.length === 1 ? ok[0].name : undefined });
    if (!res) return;
    const results = await Promise.allSettled(ok.map((w) => api.remove('k8sWorkloads', w.id)));
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) toast.error(`${failed.length} deletion(s) failed`, failed[0].reason?.message);
    else toast.success(`Deleting ${ok.length} workload${ok.length > 1 ? 's' : ''}`);
  };

  const allColumns: (Column<K8sWorkload> & { pro?: boolean })[] = [
    {
      id: 'name', header: 'Workload', sort: (w) => `${w.namespace}/${w.name}`,
      cell: (w) => {
        const Icon = KIND_ICON[w.kind];
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${nsColor(w.namespace)}1a`, color: nsColor(w.namespace) }}><Icon className="size-3.5" /></div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5"><span className="truncate font-medium text-fg">{w.name}</span>{w.managedBy && <Badge className="h-[18px] px-1.5 text-[10px]"><Puzzle className="size-3" />add-on</Badge>}</div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted"><span className="size-1.5 rounded-full" style={{ background: nsColor(w.namespace) }} />{w.namespace} · {w.kind}</div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'status', header: 'Status', sort: (w) => w.status,
      cell: (w) => (
        <div className="space-y-1">
          <StatusPill status={w.status} />
          {(w.pendingPods ?? 0) > 0 && <div className="flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400"><AlertTriangle className="size-3" />{w.pendingPods} unschedulable</div>}
        </div>
      ),
    },
    {
      id: 'ready', header: 'Pods', sort: (w) => w.readyReplicas,
      cell: (w) => w.kind === 'CronJob' ? <span className="font-mono text-xs text-fg-2">{w.schedule}</span> : (
        <div className="min-w-[90px] space-y-1">
          <span className="tabular text-fg">{w.readyReplicas}/{w.replicas}</span>
          <PodDots pods={podsByWl.get(w.id) ?? []} />
        </div>
      ),
    },
    { id: 'image', header: 'Image', hideBelow: 'lg', sort: (w) => w.image, cell: (w) => <span className="block max-w-[260px] truncate font-mono text-[11.5px] text-fg-2" title={w.image}>{w.image}</span> },
    { id: 'req', header: 'Requests / pod', pro: true, hideBelow: 'md', sort: (w) => w.cpuRequestM, cell: (w) => <span className="whitespace-nowrap text-xs text-fg-2">{fmtCpu(w.cpuRequestM)} · {fmtMem(w.memRequestMi)}{w.gpuPerPod ? <Badge tone="violet" className="ml-1.5">{w.gpuPerPod} GPU</Badge> : null}</span> },
    { id: 'svc', header: 'Service', pro: true, hideBelow: 'xl', cell: (w) => (w.expose && w.expose !== 'none' ? <span className="text-xs text-fg-2">{w.expose}{w.ports.length ? ` :${w.ports.join(',')}` : ''}</span> : <span className="text-faint">—</span>) },
    { id: 'age', header: 'Age', pro: true, hideBelow: 'xl', align: 'right', sort: (w) => w.createdAt, cell: (w) => <span className="text-xs text-muted">{timeAgo(w.createdAt).replace(' ago', '')}</span> },
  ];
  const columns: Column<K8sWorkload>[] = allColumns.filter((col) => pro || !col.pro);

  const detailW = workloads.find((w) => w.id === detail) ?? null;

  return (
    <div className="space-y-4">
      <DataTable
        rows={rows}
        loading={isLoading}
        columns={columns}
        initialSearch={sp.get('q') ?? ''}
        searchText={(w) => `${w.namespace} ${w.name} ${w.image} ${w.kind} ${w.status}`}
        searchPlaceholder="Search workloads, images…"
        onRowClick={(w) => setDetail(w.id)}
        defaultSort={{ id: 'name', dir: 'asc' }}
        toolbar={<>
          {(pro || nsCounts.size > 1) && <FilterChips value={ns} onChange={setNs} options={[{ value: 'all', label: 'All namespaces', count: visible.length }, ...[...nsCounts.entries()].sort().map(([n, count]) => ({ value: n, label: n, count }))]} />}
          {pro && !space && <Button size="sm" variant="ghost" onClick={() => setShowSystem(!showSystem)}>{showSystem ? 'Hide' : 'Show'} system</Button>}
          <Button size="sm" variant="primary" icon={Rocket} disabled={!deployable} onClick={() => setDeploying(true)}>Deploy</Button>
        </>}
        rowActions={(w) => (
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />} items={[
            { label: 'Scale…', icon: Scaling, disabled: w.kind === 'DaemonSet' || w.kind === 'CronJob' || w.status === 'Terminating', onClick: () => setScaleW(w) },
            { label: 'Rolling restart', icon: RotateCw, disabled: w.kind === 'CronJob' || w.status === 'Terminating', onClick: () => restart.mutate(w) },
            { label: 'Update image…', icon: ImageUp, disabled: w.kind === 'CronJob' || w.status === 'Terminating' || !!w.managedBy, onClick: () => setImageW(w) },
            { divider: true, label: '' },
            { label: isSystem(w) ? 'Managed (cannot delete)' : 'Delete', icon: Trash2, danger: true, disabled: isSystem(w) || w.status === 'Terminating', onClick: () => remove([w]) },
          ]} />
        )}
        bulkActions={[
          { label: 'Restart', icon: RotateCw, onClick: async (list) => { await Promise.allSettled(list.filter((w) => w.kind !== 'CronJob').map((w) => api.action('k8sWorkloads', w.id, 'restart', {}))); toast.success(`Restarting ${list.length} workload(s)`) } },
          { label: 'Delete', icon: Trash2, danger: true, onClick: remove },
        ]}
        empty={{ icon: Box, title: 'No workloads here', description: space ? 'Deploy a container image, or use kubectl with the kubeconfig from the Access tab.' : 'Deploy a container image — the scheduler places its pods on your nodes.', action: deployable ? <Button variant="primary" icon={Rocket} onClick={() => setDeploying(true)}>Deploy workload</Button> : undefined }}
      />
      <DeployWorkloadModal cluster={c} space={space} spaceUsed={spaceUsed} onResize={onResize} open={deploying} onClose={() => setDeploying(false)} namespaces={namespaces.length ? namespaces : ['default']} onDeployed={() => onDeployed()} />
      <ScaleModal c={c} space={space} spaceUsed={spaceUsed} w={scaleW} onClose={() => setScaleW(null)} />
      <ImageModal w={imageW} onClose={() => setImageW(null)} />
      <WorkloadDrawer c={{ name: c?.name ?? space?.name ?? '' }} w={detailW} topology={topo} onClose={() => setDetail(null)} />
    </div>
  );
}
