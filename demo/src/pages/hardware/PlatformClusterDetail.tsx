import { useNavigate, useParams } from 'react-router';
import { Boxes, MoreHorizontal, Trash2, Ban, DoorOpen, ArrowUpCircle, MapPin, Users, Layers } from 'lucide-react';
import { useItem, useActiveOperation, useLookup, useApiMutation } from '@/api/hooks';
import { api } from '@/api/client';
import { usePro } from '@/store/ui';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Tabs, useTabParam } from '@/components/ui/Tabs';
import { StatusPill, Badge } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { confirm } from '@/components/ui/Modal';
import { Skeleton, EmptyState } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { OperationRunner } from '@/components/resource/OperationRunner';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { flag } from '@/components/hardware/visuals';
import { PC_COLOR, type PlatformClusterView } from '@/components/hardware/platform/shared';
import { PcOverview } from '@/components/hardware/platform/PcOverview';
import { PcTenants } from '@/components/hardware/platform/PcTenants';
import { PcNodes } from '@/components/hardware/platform/PcNodes';
import { PcPolicy } from '@/components/hardware/platform/PcPolicy';
import { PcUpgrades } from '@/components/hardware/platform/PcUpgrades';
import type { Location } from '@/types';

const TABS = ['overview', 'tenants', 'nodes', 'policy', 'upgrades', 'activity'];

export default function PlatformClusterDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const pro = usePro();
  const { data: pc, isLoading, error } = useItem<PlatformClusterView>('platformClusters', id, { refetchInterval: 4000 });
  const { map: locations } = useLookup<Location>('locations');
  const op = useActiveOperation(id);
  const [tabParam, setTab] = useTabParam('overview');
  const tab = TABS.includes(tabParam) && (pro || tabParam !== 'activity') ? tabParam : 'overview';
  const toggle = useApiMutation((open: boolean) => api.action('platformClusters', id!, open ? 'uncordon' : 'cordon'), {
    success: (_r, open) => (open ? 'Accepting new spaces again' : 'Closed to new spaces — existing spaces keep running'),
  });

  if (isLoading) return <Page wide><Skeleton className="mb-4 h-12 w-80" /><Skeleton className="h-96 rounded-xl" /></Page>;
  if (error || !pc) return <Page><EmptyState icon={Boxes} title="Platform cluster not found" action={<Button to="/hardware/platform-clusters">Back to platform clusters</Button>} /></Page>;

  const loc = locations.get(pc.locationId);
  const spaces = pc.promised?.spaces ?? 0;
  const busy = !!op && op.type !== 'platformCluster.drainNode';
  const remove = async () => {
    if (spaces) { toast.error('Cluster has tenants', `Move or delete its ${spaces} space${spaces > 1 ? 's' : ''} first (Tenants tab).`); return }
    const ok = await confirm({ title: `Decommission ${pc.name}?`, message: 'All nodes are drained and deleted; the bare-metal capacity is released.', danger: true, confirmLabel: 'Decommission', typeToConfirm: pc.name });
    if (!ok) return;
    try { await api.remove('platformClusters', pc.id); toast.success(`Decommissioning ${pc.name}`); navigate('/hardware/platform-clusters') } catch (e: any) { toast.error('Cannot delete', e?.message) }
  };

  return (
    <Page wide>
      <PageHeader
        title={pc.name}
        icon={Boxes}
        iconColor={PC_COLOR}
        crumbs={[{ label: 'Platform Clusters', to: '/hardware/platform-clusters' }, { label: pc.name }]}
        status={<>
          <StatusPill status={pc.status} />
          {!pc.acceptingTenants && pc.status !== 'provisioning' && <Badge tone="warning"><Ban className="size-3" />Closed to new spaces</Badge>}
        </>}
        meta={<>
          <span className="flex items-center gap-1"><span aria-hidden>{flag(loc?.country)}</span>{loc?.name ?? pc.locationId}</span>
          <span>Kubernetes {pc.version}</span>
          <span className="flex items-center gap-1"><Layers className="size-3" />{pc.nodes?.workers ?? 0} nodes</span>
          <span className="flex items-center gap-1"><Users className="size-3" />{spaces} space{spaces === 1 ? '' : 's'} · {pc.tenantAccounts ?? 0} account{pc.tenantAccounts === 1 ? '' : 's'}</span>
          {pro && <span className="flex items-center gap-1"><MapPin className="size-3" />{pc.ingressDomain}</span>}
        </>}
        actions={<>
          {pc.upgradeAvailable && pc.status === 'running' && <Button icon={ArrowUpCircle} onClick={() => setTab('upgrades')}>Upgrade to {pc.upgradeAvailable}</Button>}
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="More" variant="secondary" />} items={[
            pc.acceptingTenants
              ? { label: 'Close to new spaces', icon: Ban, disabled: pc.status === 'provisioning', onClick: () => toggle.mutate(false) }
              : { label: 'Accept new spaces', icon: DoorOpen, disabled: pc.status === 'provisioning', onClick: () => toggle.mutate(true) },
            { divider: true, label: '' },
            { label: 'Decommission…', icon: Trash2, danger: true, onClick: remove },
          ]} />
        </>}
      />

      {op && <OperationRunner op={op} className="mb-5" compact />}

      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Overview' },
        { id: 'tenants', label: 'Tenants', count: spaces },
        { id: 'nodes', label: 'Nodes & pools', count: pc.nodes?.workers },
        { id: 'policy', label: 'Policy' },
        { id: 'upgrades', label: 'Upgrades & maintenance', icon: pc.upgradeAvailable ? <span className="size-1.5 rounded-full bg-brand-500" /> : undefined },
        ...(pro ? [{ id: 'activity', label: 'Activity' }] : []),
      ]} />

      {tab === 'overview' && <PcOverview pc={pc} onTab={setTab} />}
      {tab === 'tenants' && <PcTenants pc={pc} />}
      {tab === 'nodes' && <PcNodes pc={pc} busy={busy} />}
      {tab === 'policy' && <PcPolicy pc={pc} />}
      {tab === 'upgrades' && <PcUpgrades pc={pc} busy={busy} />}
      {tab === 'activity' && <Card><ActivityFeed targetId={pc.id} /></Card>}
    </Page>
  );
}
