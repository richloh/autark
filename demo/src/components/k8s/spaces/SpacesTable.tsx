import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Box, Plus, MoreHorizontal, Download, Trash2, ExternalLink, Scaling, Cpu, MemoryStick, Users } from 'lucide-react';
import { useList, useLookup } from '@/api/hooks';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusPill, Tags } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Stat } from '@/components/ui/Stat';
import { Pro } from '@/components/ui/Pro';
import { EmptyState } from '@/components/ui/misc';
import { OperationInline } from '@/components/resource/OperationRunner';
import { flagEmoji } from '@/components/compute/vm/util';
import { money, timeAgo } from '@/lib/format';
import { spaceCost } from '@/lib/pricing';
import { usePro } from '@/store/ui';
import type { K8sSpace, Location, Operation, PlatformCluster, Project } from '@/types';
import { SPACE_COLOR, type SpaceView, UsageBar, deleteSpace, downloadSpaceKubeconfig, num1 } from './spaceUi';

export const SPACES_EMPTY = 'Run your apps on the provider’s managed Kubernetes — you get a namespace, a quota and kubectl access. No cluster to operate.';

const TRANSITIONAL: K8sSpace['status'][] = ['provisioning', 'resizing', 'deleting'];

export function SpacesTable({ spaces, loading, error }: { spaces: K8sSpace[]; loading: boolean; error?: boolean }) {
  const [sp] = useSearchParams();
  const pro = usePro();
  const { map: projects } = useLookup<Project>('projects');
  const { map: locations } = useLookup<Location>('locations');
  const { map: pcs } = useLookup<PlatformCluster>('platformClusters');
  const { items: ops } = useList<Operation>('operations', { status: 'running' });
  const opByTarget = useMemo(() => new Map(ops.filter((o) => !o.type.startsWith('k8s.workload')).map((o) => [o.target.id, o])), [ops]);
  const costOf = (s: K8sSpace) => s.monthlyCost ?? spaceCost(s.quota).total;

  const allColumns: (Column<K8sSpace> & { pro?: boolean })[] = [
    {
      id: 'name', header: 'Space', sort: (s) => s.name,
      cell: (s) => {
        const p = projects.get(s.projectId);
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-[26px] shrink-0 items-center justify-center rounded-lg" style={{ background: `${SPACE_COLOR}1a`, color: SPACE_COLOR }}><Box className="size-4" /></div>
            <div className="min-w-0">
              <Link to={`/managed-services/kubernetes/spaces/${s.id}`} className="block truncate font-medium text-fg hover:text-brand-500">{s.name}</Link>
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
                {p && <span className="size-1.5 shrink-0 rounded-full" style={{ background: p.color }} />}
                <span className="truncate">{p?.name ?? s.projectId}</span>
                <span className="text-faint">·</span>
                <span className="truncate font-mono">{s.namespace}</span>
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'status', header: 'Status', sort: (s) => s.status,
      cell: (s) => {
        const op = opByTarget.get(s.id);
        return <div className="w-32"><StatusPill status={s.status} />{op && <OperationInline op={op} className="mt-1.5" />}</div>;
      },
    },
    {
      id: 'location', header: 'Location', hideBelow: 'md', sort: (s) => locations.get(s.locationId)?.city ?? s.locationId,
      cell: (s) => {
        const l = locations.get(s.locationId);
        return (
          <div className="min-w-0 leading-tight" title={l?.name}>
            <div className="flex items-center gap-1.5 whitespace-nowrap text-fg-2"><span className="text-[15px] leading-none">{flagEmoji(l?.country)}</span><span className="truncate">{l?.city ?? s.locationId}</span></div>
            {pro && <div className="truncate text-[11px] text-faint">{pcs.get(s.platformClusterId)?.name ?? (s as SpaceView).platformClusterName ?? s.platformClusterId}</div>}
          </div>
        );
      },
    },
    {
      id: 'quota', header: 'Usage / quota', sort: (s) => s.quota.cpuCores,
      cell: (s) => (
        <div className="space-y-1">
          <UsageBar label="CPU" used={s.used?.cpuCores ?? 0} max={s.quota.cpuCores} value={`${num1(+(s.used?.cpuCores ?? 0).toFixed(1))} / ${num1(s.quota.cpuCores)}`} />
          <UsageBar label="Mem" used={s.used?.memoryGi ?? 0} max={s.quota.memoryGi} value={`${num1(+(s.used?.memoryGi ?? 0).toFixed(1))} / ${num1(s.quota.memoryGi)} GiB`} />
        </div>
      ),
    },
    { id: 'pods', header: 'Pods', pro: true, hideBelow: 'xl', sort: (s) => s.used?.pods ?? 0, cell: (s) => <span className="tabular text-fg-2">{s.used?.pods ?? 0} / {s.quota.pods}</span> },
    { id: 'tags', header: 'Tags', pro: true, hideBelow: 'xl', cell: (s) => <Tags tags={s.tags} max={2} /> },
    { id: 'created', header: 'Created', hideBelow: 'lg', sort: (s) => s.createdAt, cell: (s) => <span className="text-xs text-muted">{timeAgo(s.createdAt)}</span> },
    { id: 'cost', header: 'Monthly', pro: true, align: 'right', sort: costOf, cell: (s) => <span className="tabular text-fg">{money(costOf(s))}</span> },
  ];
  const columns: Column<K8sSpace>[] = allColumns.filter((c) => pro || !c.pro);

  const reservedCpu = spaces.reduce((a, s) => a + s.quota.cpuCores, 0);
  const usedCpu = spaces.reduce((a, s) => a + (s.used?.cpuCores ?? 0), 0);
  const reservedMem = spaces.reduce((a, s) => a + s.quota.memoryGi, 0);
  const usedMem = spaces.reduce((a, s) => a + (s.used?.memoryGi ?? 0), 0);
  const cost = spaces.reduce((a, s) => a + costOf(s), 0);

  if (!loading && spaces.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface shadow-card">
        <EmptyState icon={Box} title={error ? 'Shared Kubernetes is not available yet' : 'No shared spaces yet'} description={SPACES_EMPTY}
          action={<Button variant="primary" icon={Plus} to="/managed-services/kubernetes/new?type=shared">Create space</Button>} />
      </div>
    );
  }

  return (
    <>
      <Pro>
        <div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
          <Stat label="Spaces" value={`${spaces.filter((s) => s.status === 'active').length} / ${spaces.length}`} icon={Box} sub="active" />
          <Stat label="CPU in use" value={`${num1(+usedCpu.toFixed(1))} / ${num1(reservedCpu)}`} icon={Cpu} sub="cores requested / reserved" />
          <Stat label="Memory in use" value={`${num1(+usedMem.toFixed(1))} / ${num1(reservedMem)}`} icon={MemoryStick} sub="GiB requested / reserved" />
          <Stat label="Monthly run-rate" value={money(cost)} sub="billed by reserved quota" accent={SPACE_COLOR} />
        </div>
      </Pro>
      <DataTable
        rows={spaces}
        loading={loading}
        columns={columns}
        initialSearch={sp.get('q') ?? ''}
        searchText={(s) => `${s.name} ${s.id} ${s.namespace} ${s.locationId} ${locations.get(s.locationId)?.city ?? ''} ${projects.get(s.projectId)?.name ?? ''} ${s.tags.map((t) => `${t.key}:${t.value} ${t.value}`).join(' ')}`}
        searchPlaceholder="Search name, namespace, project…"
        rowLink={(s) => `/managed-services/kubernetes/spaces/${s.id}`}
        defaultSort={{ id: 'name', dir: 'asc' }}
        rowClassName={(s) => (TRANSITIONAL.includes(s.status) ? 'bg-brand-500/[0.02]' : undefined)}
        rowActions={(s) => (
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />} items={[
            { label: 'Open', icon: ExternalLink, to: `/managed-services/kubernetes/spaces/${s.id}` },
            { label: 'Download kubeconfig', icon: Download, disabled: s.status === 'provisioning', onClick: () => downloadSpaceKubeconfig(s) },
            { label: 'Resize quota', icon: Scaling, to: `/managed-services/kubernetes/spaces/${s.id}?tab=settings` },
            { label: 'Team access', icon: Users, to: `/managed-services/kubernetes/spaces/${s.id}?tab=access` },
            { divider: true, label: '' },
            { label: 'Delete', icon: Trash2, danger: true, disabled: s.status === 'deleting', onClick: () => deleteSpace(s) },
          ]} />
        )}
        bulkActions={[{ label: 'Delete', icon: Trash2, danger: true, onClick: async (list) => { for (const s of list) await deleteSpace(s) } }]}
        empty={{ icon: Box, title: 'No shared spaces yet', description: SPACES_EMPTY, action: <Button variant="primary" icon={Plus} to="/managed-services/kubernetes/new?type=shared">Create space</Button> }}
      />
    </>
  );
}
