import { useState } from 'react';
import { Link } from 'react-router';
import { Boxes, Plus, Users, Cpu, MemoryStick, Layers, ShieldCheck, ArrowUpCircle, Ban, Server } from 'lucide-react';
import { useList, useLookup } from '@/api/hooks';
import { usePro } from '@/store/ui';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusPill, Badge } from '@/components/ui/Badge';
import { Stat } from '@/components/ui/Stat';
import { Pro } from '@/components/ui/Pro';
import { Skeleton, EmptyState } from '@/components/ui/misc';
import { OperationInline } from '@/components/resource/OperationRunner';
import { flag } from '@/components/hardware/visuals';
import { CapacityBar, capacityOf, promisableOf, n1, PC_COLOR, type PlatformClusterView } from '@/components/hardware/platform/shared';
import { CreatePlatformClusterModal } from '@/components/hardware/platform/CreatePlatformClusterModal';
import { accessSummary } from '@/lib/hostPolicy';
import { usePolicyNames } from '@/components/hardware/policy';
import type { Location, Operation } from '@/types';

export default function PlatformClusterList() {
  const pro = usePro();
  const { items, isLoading } = useList<PlatformClusterView>('platformClusters', undefined, { refetchInterval: 5000 });
  const { map: locations } = useLookup<Location>('locations');
  const { items: ops } = useList<Operation>('operations', { status: 'running' });
  const { names } = usePolicyNames();
  const [createOpen, setCreateOpen] = useState(false);
  const opBy = new Map(ops.filter((o) => o.target.type === 'platformCluster').map((o) => [o.target.id, o]));

  const sum = (f: (p: PlatformClusterView) => number) => items.reduce((a, p) => a + f(p), 0);
  const capCpu = sum((p) => capacityOf(p).cpuCores);
  const promCpu = sum((p) => p.promised?.cpuCores ?? 0);
  const usedCpu = sum((p) => p.used?.cpuCores ?? 0);
  const spaces = sum((p) => p.promised?.spaces ?? 0);

  return (
    <Page wide>
      <PageHeader
        title="Platform Clusters"
        icon={Boxes}
        iconColor={PC_COLOR}
        description={pro
          ? 'Multi-tenant Kubernetes you operate on your bare-metal hosts. Customers create spaces (namespace + quota) on them and are billed for reserved quota; you may promise more than you have, up to the overcommit.'
          : 'Shared Kubernetes clusters. Customers get their own space on them.'}
        actions={<Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>Create platform cluster</Button>}
      />

      <Pro>
        <div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
          <Stat label="Clusters" value={String(items.length)} icon={Boxes} sub={`${items.filter((p) => p.acceptingTenants).length} accepting new spaces`} />
          <Stat label="Tenant spaces" value={String(spaces)} icon={Users} sub={`on ${items.length} cluster${items.length === 1 ? '' : 's'}`} />
          <Stat label="CPU promised" value={`${n1(promCpu)} cores`} icon={Cpu} sub={`of ${n1(capCpu)} allocatable`} />
          <Stat label="CPU in use" value={`${n1(usedCpu)} cores`} icon={Layers} sub={capCpu ? `${Math.round((usedCpu / capCpu) * 100)}% of allocatable` : '—'} accent={PC_COLOR} />
        </div>
      </Pro>

      {isLoading ? (
        <div className="grid [&>*]:min-w-0 gap-4 @min-[60rem]:grid-cols-2">{[1, 2].map((i) => <Skeleton key={i} className="h-64 rounded-xl" />)}</div>
      ) : !items.length ? (
        <Card><EmptyState icon={Boxes} title="No platform clusters yet" description="Create one to offer shared Kubernetes spaces to your customers." action={<Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>Create platform cluster</Button>} /></Card>
      ) : (
        <div className="grid [&>*]:min-w-0 gap-4 @min-[60rem]:grid-cols-2">
          {items.map((pc) => {
            const loc = locations.get(pc.locationId);
            const cap = capacityOf(pc);
            const lim = promisableOf(pc);
            const op = opBy.get(pc.id);
            const workers = pc.nodePools.reduce((a, p) => a + p.count, 0);
            return (
              <Card key={pc.id} className="flex flex-col transition-shadow hover:shadow-md">
                <Link to={`/hardware/platform-clusters/${pc.id}`} className="block flex-1 p-4 @min-[36rem]:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg leading-none" aria-hidden>{flag(loc?.country)}</span>
                        <span className="truncate text-base font-semibold text-fg">{pc.name}</span>
                        <StatusPill status={pc.status} />
                      </div>
                      <div className="mt-1 text-xs tabular text-muted">
                        v{pc.version} | {workers} nodes | {n1(cap.cpuCores)} cores · {n1(cap.memoryGi)} GiB | {loc?.name ?? pc.locationId}
                      </div>
                    </div>
                    {pc.acceptingTenants
                      ? <Badge tone="success" dot>Accepting spaces</Badge>
                      : <Badge tone="warning"><Ban className="size-3" />Closed to new spaces</Badge>}
                  </div>

                  <div className="mt-4 space-y-4">
                    <CapacityBar label={<span className="flex items-center gap-1.5"><Cpu className="size-3.5 text-muted" />CPU</span>} unit="cores" capacity={cap.cpuCores} overcommit={pc.overcommit.cpu} promised={pc.promised?.cpuCores ?? 0} used={pc.used?.cpuCores ?? 0} legend={pro} />
                    <CapacityBar label={<span className="flex items-center gap-1.5"><MemoryStick className="size-3.5 text-muted" />Memory</span>} unit="GiB" capacity={cap.memoryGi} overcommit={pc.overcommit.memory} promised={pc.promised?.memoryGi ?? 0} used={pc.used?.memoryGi ?? 0} legend={pro} />
                  </div>
                </Link>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-xs text-muted @min-[36rem]:px-5">
                  <span className="flex items-center gap-1.5"><Users className="size-3.5" /><b className="font-semibold text-fg">{pc.promised?.spaces ?? 0}</b> space{pc.promised?.spaces === 1 ? '' : 's'} · {pc.tenantAccounts ?? 0} account{pc.tenantAccounts === 1 ? '' : 's'}</span>
                  <span className="flex items-center gap-1.5"><Server className="size-3.5" />{n1(Math.max(0, lim.cpuCores - (pc.promised?.cpuCores ?? 0)))} cores free to promise</span>
                  {pro && <span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" />{accessSummary(pc, names)}</span>}
                  {pc.upgradeAvailable && <Link to={`/hardware/platform-clusters/${pc.id}?tab=upgrades`} className="ml-auto flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-400"><ArrowUpCircle className="size-3.5" />{pc.upgradeAvailable} available</Link>}
                </div>
                {op && <div className="border-t border-line px-4 py-2.5 @min-[36rem]:px-5"><OperationInline op={op} /></div>}
              </Card>
            );
          })}
        </div>
      )}

      <CreatePlatformClusterModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </Page>
  );
}
