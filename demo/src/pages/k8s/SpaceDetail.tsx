import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Box, Rocket, Download, MoreHorizontal, RefreshCw, Trash2, LayoutDashboard, KeyRound, BarChart3, History, Settings, Scaling, Boxes } from 'lucide-react';
import { useItem, useList, useLookup, useApiMutation, useOperationsFor } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Tabs, useTabParam } from '@/components/ui/Tabs';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, Mono, Skeleton } from '@/components/ui/misc';
import { confirm } from '@/components/ui/Modal';
import { Hint } from '@/components/ui/form';
import { MetricsPanel } from '@/components/charts/MetricsPanel';
import { OperationRunner } from '@/components/resource/OperationRunner';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { WorkloadsTab } from '@/components/k8s/WorkloadsTab';
import { DeployWorkloadModal } from '@/components/k8s/DeployWorkloadModal';
import { SpaceOverviewTab } from '@/components/k8s/spaces/SpaceOverviewTab';
import { SpaceAccessTab } from '@/components/k8s/spaces/SpaceAccessTab';
import { SpaceSettingsTab } from '@/components/k8s/spaces/SpaceSettingsTab';
import { SPACE_COLOR, type SpaceView, deleteSpace, downloadSpaceKubeconfig, num1, usedFromWorkloads, useSpaceUsage } from '@/components/k8s/spaces/spaceUi';
import { flagEmoji } from '@/components/compute/vm/util';
import { ProBadge } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import { money, timeAgo } from '@/lib/format';
import { spaceCost } from '@/lib/pricing';
import type { K8sWorkload, Location, PlatformCluster, Project } from '@/types';

export default function SpaceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const pro = usePro();
  const { items: allOps } = useOperationsFor(id);
  const running = allOps.filter((o) => o.status === 'running');
  const active = running.length > 0;
  const { data: s, isLoading, error } = useItem<SpaceView>('k8sSpaces', id, { refetchInterval: active ? 1500 : 15000 });
  const { data: pc } = useItem<PlatformCluster>('platformClusters', s?.platformClusterId);
  const { items: workloads } = useList<K8sWorkload>('k8sWorkloads', { spaceId: id }, { enabled: !!s, refetchInterval: 5000 });
  const usageQ = useSpaceUsage(s, active);
  const used = useMemo(() => usageQ.used ?? (s && s.status !== 'provisioning' ? usedFromWorkloads(workloads) : undefined), [usageQ.used, s, workloads]);
  const { map: locations } = useLookup<Location>('locations');
  const { map: projects } = useLookup<Project>('projects');
  const [tab, setTab] = useTabParam('overview');
  const [deploying, setDeploying] = useState(false);
  const rotate = useApiMutation(() => api.action('k8sSpaces', id!, 'rotateCredentials'), { success: 'Credentials rotated' });

  if (isLoading) return <Page wide><Skeleton className="mb-6 h-12 w-80" /><Skeleton className="h-96" /></Page>;
  if (error || !s) return <Page><EmptyState icon={Box} title="Space not found" description="It may have been deleted, or it belongs to another account." action={<Button to="/managed-services/kubernetes">Back to Kubernetes</Button>} /></Page>;

  const loc = locations.get(s.locationId);
  const project = projects.get(s.projectId);
  const deployable = s.status === 'active' || s.status === 'resizing';
  const primary = running.find((o) => !o.type.startsWith('k8s.workload'));
  const cost = s.monthlyCost ?? spaceCost(s.quota).total;

  const onRotate = async () => {
    const ok = await confirm({ title: 'Rotate credentials?', message: 'The current kubeconfig stops working after rotation.', confirmLabel: 'Rotate', danger: true });
    if (ok) rotate.mutate();
  };
  const onDelete = async () => { if (await deleteSpace(s, workloads.length)) navigate('/managed-services/kubernetes?view=spaces') };
  const proLabel = (label: string) => (pro ? <span className="inline-flex items-center gap-1.5">{label}<ProBadge /></span> : label);
  const allTabs = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="size-3.5" /> },
    { id: 'workloads', label: 'Workloads', icon: <Box className="size-3.5" />, count: workloads.length },
    { id: 'access', label: 'Access', icon: <KeyRound className="size-3.5" /> },
    { id: 'metrics', label: proLabel('Metrics'), icon: <BarChart3 className="size-3.5" />, pro: true },
    { id: 'activity', label: proLabel('Activity'), icon: <History className="size-3.5" />, pro: true },
    { id: 'settings', label: 'Settings', icon: <Settings className="size-3.5" /> },
  ];
  const tabs = allTabs.filter((t) => pro || !t.pro).map(({ pro: _p, ...t }) => t);
  const current = tabs.some((t) => t.id === tab) ? tab : 'overview';
  const onResize = () => setTab('settings');

  return (
    <Page wide>
      <PageHeader
        title={s.name}
        icon={Box}
        iconColor={SPACE_COLOR}
        status={<StatusPill status={s.status} />}
        crumbs={[{ label: 'Kubernetes', to: '/managed-services/kubernetes?view=spaces' }, { label: s.name }]}
        meta={<>
          {project && <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: project.color }} />{project.name}</span>}
          <span className="flex items-center gap-1.5" title={loc?.name}><span className="text-[15px] leading-none">{flagEmoji(loc?.country)}</span>{loc?.city ?? s.locationId}</span>
          <span className="flex items-center gap-1"><Boxes className="size-3.5 text-muted" />
            {pro ? <Link to={`/hardware/platform-clusters/${s.platformClusterId}`} className="hover:text-brand-500 hover:underline">{pc?.name ?? s.platformClusterName ?? s.platformClusterId}</Link> : <span>{pc?.name ?? s.platformClusterName ?? 'Shared cluster'}</span>}
          </span>
          <span>{num1(s.quota.cpuCores)} CPU · {num1(s.quota.memoryGi)} GiB</span>
          {pro && <Mono copy={s.namespace} className="hidden text-xs @min-[40rem]:inline-flex">{s.namespace}</Mono>}
          {pro && <span>{money(cost)}/mo</span>}
          <span>created {timeAgo(s.createdAt)}</span>
        </>}
        actions={<>
          <Button icon={Download} disabled={s.status === 'provisioning'} onClick={() => downloadSpaceKubeconfig(s)}>Kubeconfig</Button>
          <Button variant="primary" icon={Rocket} disabled={!deployable} onClick={() => setDeploying(true)}>Deploy workload</Button>
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="More actions" variant="secondary" />} items={[
            { label: 'Resize quota', icon: Scaling, disabled: s.status !== 'active', onClick: onResize },
            { label: 'Rotate credentials', icon: RefreshCw, disabled: !deployable, onClick: onRotate },
            { divider: true, label: '' },
            { label: 'Delete space', icon: Trash2, danger: true, disabled: s.status === 'deleting', onClick: onDelete },
          ]} />
        </>}
      />

      {primary && current !== 'activity' && <OperationRunner op={primary} compact={s.status !== 'provisioning'} className="mb-5" />}
      {s.status === 'error' && <Hint tone="danger" className="mb-5">Creating the space failed. Check the operation log{pro ? ' in Activity' : ''}, then delete it and try again.</Hint>}
      {s.status === 'suspended' && <Hint tone="warning" className="mb-5">This space is suspended by the provider. Your workloads are scaled to zero; contact your provider to resume it.</Hint>}

      <Tabs className="mb-5" value={current} onChange={setTab} tabs={tabs} />

      {current === 'overview' && <SpaceOverviewTab space={s} used={used} usageLoading={usageQ.isLoading} platformCluster={pc} onTab={setTab} />}
      {current === 'workloads' && <WorkloadsTab space={s} spaceUsed={used} onResize={onResize} onDeployed={() => {}} />}
      {current === 'access' && <SpaceAccessTab space={s} />}
      {current === 'metrics' && (
        <MetricsPanel collection="k8sSpaces" id={s.id} cols={2} charts={[
          { title: 'CPU', metrics: ['cpu', 'cpuRequests'], labels: ['Usage', 'Requested'], unit: 'cores', max: s.quota.cpuCores },
          { title: 'Memory', metrics: ['memory', 'memoryRequests'], labels: ['Usage', 'Requested'], unit: 'GiB', max: s.quota.memoryGi },
          { title: 'Pods', metrics: ['pods'], labels: ['Pods'], colors: [SPACE_COLOR], unit: 'pods', max: s.quota.pods },
          { title: 'CPU throttling', metrics: ['throttling'], unit: '%', max: 100 },
          { title: 'Network', metrics: ['netIn', 'netOut'], labels: ['In', 'Out'], unit: 'Mbit/s' },
        ]} />
      )}
      {current === 'activity' && (
        <div className="grid items-start gap-5 @min-[60rem]:grid-cols-2">
          <Card>
            <CardHeader title="Audit log" description="Changes made through the console, kubectl identity rotation, CLI and API." />
            <ActivityFeed targetId={s.id} />
          </Card>
          <Card>
            <CardHeader title="Operations" />
            <div className="space-y-3 p-4">
              {allOps.slice(0, 8).map((o) => <OperationRunner key={o.id} op={o} compact showLogs />)}
              {allOps.length === 0 && <p className="text-center text-xs text-muted">No operations yet</p>}
            </div>
          </Card>
        </div>
      )}
      {current === 'settings' && <SpaceSettingsTab space={s} used={used} platformCluster={pc} onDelete={onDelete} />}

      <DeployWorkloadModal space={s} spaceUsed={used} onResize={onResize} open={deploying} onClose={() => setDeploying(false)}
        onDeployed={() => { if (current !== 'workloads') setTab('workloads') }} />
    </Page>
  );
}
