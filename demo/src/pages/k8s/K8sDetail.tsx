import { useNavigate, useParams } from 'react-router';
import { Boxes, Rocket, Download, MoreHorizontal, ArrowUpCircle, RefreshCw, Trash2, Building2, Cloud, LayoutDashboard, Server, Box, Puzzle, KeyRound, BarChart3, History, AlertTriangle, Settings } from 'lucide-react';
import { useState } from 'react';
import { useItem, useLookup, useApiMutation } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Tabs, useTabParam } from '@/components/ui/Tabs';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, Mono, Skeleton } from '@/components/ui/misc';
import { confirm } from '@/components/ui/Modal';
import { Hint } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { MetricsPanel } from '@/components/charts/MetricsPanel';
import { OperationRunner } from '@/components/resource/OperationRunner';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { ClusterOverviewTab, EventsList } from '@/components/k8s/ClusterOverviewTab';
import { NodesTab } from '@/components/k8s/NodesTab';
import { WorkloadsTab } from '@/components/k8s/WorkloadsTab';
import { AddonsTab } from '@/components/k8s/AddonsTab';
import { AccessTab } from '@/components/k8s/AccessTab';
import { UpgradeTab } from '@/components/k8s/UpgradeTab';
import { DeployWorkloadModal } from '@/components/k8s/DeployWorkloadModal';
import { downloadKubeconfig, deleteCluster } from '@/components/k8s/clusterActions';
import { useClusterOps, useTopology } from '@/components/k8s/k8sUi';
import { ClusterSettingsTab } from '@/components/k8s/ClusterSettingsTab';
import { Pro, ProBadge } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import { money, timeAgo } from '@/lib/format';
import { K8S_VERSIONS, type K8sCluster, type Location, type Project } from '@/types';

export default function K8sDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const ops = useClusterOps(id);
  const active = ops.running.length > 0;
  const { data: c, isLoading, error } = useItem<K8sCluster>('k8sClusters', id, { refetchInterval: active ? 1500 : 15000 });
  const topo = useTopology(id, active || (c != null && c.status !== 'running'));
  const [tab, setTab] = useTabParam('overview');
  const pro = usePro();
  const [deploying, setDeploying] = useState(false);
  const { map: locations } = useLookup<Location>('locations');
  const { map: projects } = useLookup<Project>('projects');
  const rotate = useApiMutation(() => api.action('k8sClusters', id!, 'rotateCredentials'), { success: 'Rotating credentials' });

  if (isLoading) return <Page wide><Skeleton className="mb-6 h-12 w-80" /><Skeleton className="h-96" /></Page>;
  if (error || !c) return <Page><EmptyState icon={Boxes} title="Cluster not found" description="It may have been deleted, or it belongs to another account." action={<Button to="/managed-services/kubernetes">Back to clusters</Button>} /></Page>;

  const loc = locations.get(c.locationId);
  const project = projects.get(c.projectId);
  const vinfo = K8S_VERSIONS.find((v) => v.version === c.version);
  const primary = ops.primary;
  const idle = c.status === 'running' || c.status === 'degraded';
  const deployable = c.status !== 'provisioning' && c.status !== 'deleting' && c.status !== 'error';
  const namespaces = [...new Set((topo.data?.pods ?? []).map((p) => p.namespace))];
  const s = topo.data?.summary ?? c.summary;

  const onRotate = async () => {
    const ok = await confirm({ title: 'Rotate cluster credentials?', message: 'The current admin kubeconfig stops working after rotation.', confirmLabel: 'Rotate', danger: true });
    if (ok) rotate.mutate();
  };
  const onDelete = async () => { if (await deleteCluster(c)) navigate('/managed-services/kubernetes') };
  const proLabel = (label: string) => pro ? <span className="inline-flex items-center gap-1.5">{label}<ProBadge /></span> : label;
  const allTabs = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="size-3.5" /> },
    { id: 'nodes', label: 'Nodes & pools', icon: <Server className="size-3.5" />, count: s?.nodes },
    { id: 'workloads', label: 'Workloads', icon: <Box className="size-3.5" />, count: s?.workloads },
    { id: 'addons', label: proLabel('Add-ons'), icon: <Puzzle className="size-3.5" />, pro: true },
    { id: 'access', label: 'Access', icon: <KeyRound className="size-3.5" /> },
    { id: 'upgrade', label: proLabel('Upgrade'), icon: <ArrowUpCircle className="size-3.5" />, pro: true },
    { id: 'metrics', label: proLabel('Metrics'), icon: <BarChart3 className="size-3.5" />, pro: true },
    { id: 'activity', label: proLabel('Activity'), icon: <History className="size-3.5" />, pro: true },
    { id: 'settings', label: 'Settings', icon: <Settings className="size-3.5" /> },
  ];
  const tabs = allTabs.filter((t) => pro || !t.pro).map(({ pro: _p, ...t }) => t);
  const current = tabs.some((t) => t.id === tab) ? tab : 'overview';
  const upgradeTab = pro ? 'upgrade' : 'settings';
  const showRunner = primary && !primary.type.startsWith('k8s.workload') && current !== 'upgrade' && current !== 'addons' && current !== 'settings';
  const onDeployed = () => {
    if (current !== 'overview') toast.info('Pods are rolling out', 'See them land on the cluster map.', { label: 'Open cluster map', onClick: () => setTab('overview') });
  };

  return (
    <Page wide>
      <PageHeader
        title={c.name}
        icon={Boxes}
        iconColor="#326ce5"
        status={<StatusPill status={c.status} />}
        crumbs={[{ label: 'Kubernetes', to: '/managed-services/kubernetes' }, { label: c.name }]}
        meta={<>
          <span className="flex items-center gap-1"><Badge tone={vinfo?.status === 'deprecated' ? 'warning' : 'neutral'} className="font-mono">v{vinfo?.patch ?? c.version}</Badge>{c.upgradeAvailable && c.status !== 'upgrading' && <button onClick={() => setTab(upgradeTab)} className="flex items-center gap-0.5 font-medium text-brand-600 hover:underline dark:text-brand-300"><ArrowUpCircle className="size-3.5" />{c.upgradeAvailable} available</button>}</span>
          <span className="flex items-center gap-1">{loc?.kind === 'cloud' ? <Cloud className="size-3.5 text-sky-500" /> : <Building2 className="size-3.5 text-emerald-500" />}{loc?.name ?? c.locationId}</span>
          <span>{c.nodePools.reduce((a, p) => a + p.count, 0)} nodes{c.controlPlane.ha ? ' · HA' : ''}</span>
          <Pro>
            {project && <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: project.color }} />{project.name}</span>}
            <Mono copy={c.controlPlane.endpoint} className="hidden text-xs @min-[40rem]:inline-flex">{c.controlPlane.endpoint.replace('https://', '')}</Mono>
            <span>{money(c.monthlyCost)}/mo</span>
          </Pro>
          <span>created {timeAgo(c.createdAt)}</span>
        </>}
        actions={<>
          <Button icon={Download} disabled={c.status === 'provisioning'} onClick={() => downloadKubeconfig(c)}>Kubeconfig</Button>
          <Button variant="primary" icon={Rocket} disabled={!deployable} onClick={() => setDeploying(true)}>Deploy workload</Button>
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="More actions" variant="secondary" />} items={[
            { label: c.upgradeAvailable ? `Upgrade to ${c.upgradeAvailable}` : 'Up to date', icon: ArrowUpCircle, disabled: !c.upgradeAvailable || !idle, onClick: () => setTab(upgradeTab) },
            { label: 'Rotate credentials', icon: RefreshCw, disabled: !idle, onClick: onRotate },
            { divider: true, label: '' },
            { label: 'Delete cluster', icon: Trash2, danger: true, disabled: c.status === 'deleting', onClick: onDelete },
          ]} />
        </>}
      />

      {showRunner && <OperationRunner op={primary!} compact={c.status !== 'provisioning'} className="mb-5" />}
      {c.status === 'error' && <Hint tone="danger" className="mb-5">Provisioning failed. Check the operation log{pro ? ' in Activity' : ''}, then delete the cluster and try again (names containing "fail" simulate failures).</Hint>}
      {(s?.pendingPods ?? 0) > 0 && current !== 'overview' && (
        <Hint tone="warning" className="mb-5"><span className="flex flex-wrap items-center gap-2"><AlertTriangle className="size-4" /> {s!.pendingPods} pod(s) cannot be scheduled.<button className="font-medium underline" onClick={() => setTab('nodes')}>Scale a node pool</button></span></Hint>
      )}

      <Tabs className="mb-5" value={current} onChange={setTab} tabs={tabs} />

      {current === 'overview' && <ClusterOverviewTab cluster={c} topology={topo.data} onTab={setTab} />}
      {current === 'nodes' && <NodesTab cluster={c} topology={topo.data} busy={!idle} />}
      {current === 'workloads' && <WorkloadsTab cluster={c} topology={topo.data} onDeployed={onDeployed} />}
      {current === 'addons' && <AddonsTab cluster={c} topology={topo.data} ops={ops.running} />}
      {current === 'access' && <AccessTab cluster={c} busy={!idle} />}
      {current === 'upgrade' && <UpgradeTab cluster={c} topology={topo.data} ops={ops.running} />}
      {current === 'metrics' && (
        <MetricsPanel collection="k8sClusters" id={c.id} cols={2} charts={[
          { title: 'CPU utilization', metrics: ['cpu'], unit: '%', max: 100 },
          { title: 'Memory utilization', metrics: ['memory'], unit: '%', max: 100 },
          { title: 'Pods', metrics: ['pods', 'pending'], labels: ['Running', 'Pending'], colors: ['#326ce5', '#f43f5e'], unit: 'pods' },
          { title: 'API server latency (p99)', metrics: ['apiLatency'], unit: 'ms' },
          { title: 'API requests', metrics: ['apiRequests'], unit: 'req/s' },
          { title: 'Network', metrics: ['netIn', 'netOut'], labels: ['In', 'Out'], unit: 'Mbit/s' },
        ]} />
      )}
      {current === 'settings' && <ClusterSettingsTab cluster={c} ops={ops.running} onDelete={onDelete} onTab={setTab} />}
      {current === 'activity' && (
        <div className="grid items-start gap-5 @min-[60rem]:grid-cols-2">
          <Card>
            <CardHeader title="Audit log" description="Changes made through the console, CLI, API and the autoscaler." />
            <ActivityFeed targetId={c.id} />
          </Card>
          <div className="space-y-5">
            <Card>
              <CardHeader title="Operations" />
              <div className="space-y-3 p-4">
                {ops.all.slice(0, 6).map((o) => <OperationRunner key={o.id} op={o} compact showLogs />)}
                {ops.all.length === 0 && <p className="text-center text-xs text-muted">No operations yet</p>}
              </div>
            </Card>
            <Card>
              <CardHeader title="Kubernetes events" description="kubectl get events -A" />
              <EventsList events={topo.data?.events ?? []} limit={30} />
            </Card>
          </div>
        </div>
      )}

      <DeployWorkloadModal cluster={c} open={deploying} onClose={() => setDeploying(false)} namespaces={namespaces.length ? namespaces : ['default']} onDeployed={onDeployed} />
    </Page>
  );
}
