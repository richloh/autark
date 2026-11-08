import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Network as NetworkIcon, Plus, Trash2, MoreHorizontal, Globe2, Lock, ArrowLeftRight, Waypoints, Building2, Cloud, Layers, Map as MapIcon } from 'lucide-react';
import { useList, useLookup } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusPill, Tags, Badge } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Stat } from '@/components/ui/Stat';
import { Mono } from '@/components/ui/misc';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { OperationInline } from '@/components/resource/OperationRunner';
import { parseCidr } from '@/lib/cidr';
import { money, num } from '@/lib/format';
import type { Network, Location, Operation, Project } from '@/types';
import { subnetColor } from '@/components/network/util';
import { Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';

/** Tiny linear map of the VPC range with subnets as colored segments. */
function MiniSpace({ n }: { n: Network }) {
  const v = parseCidr(n.cidr);
  if (!v) return null;
  return (
    <div className="relative h-2 w-28 overflow-hidden rounded-full bg-surface-3" title={`${n.subnets.length} subnets in ${n.cidr}`}>
      {n.subnets.map((s, i) => {
        const p = parseCidr(s.cidr);
        if (!p) return null;
        return <div key={s.id} className="absolute inset-y-0" style={{ left: `${((p.first - v.first) / v.size) * 100}%`, width: `max(2px, ${(p.size / v.size) * 100}%)`, background: subnetColor(i) }} />;
      })}
    </div>
  );
}

export default function NetworkList() {
  const [sp] = useSearchParams();
  const pro = usePro();
  const { items: nets, isLoading } = useList<Network>('networks');
  const { map: locations } = useLookup<Location>('locations');
  const { map: projects } = useLookup<Project>('projects');
  const { items: ops } = useList<Operation>('operations', { status: 'running' });
  const opByTarget = useMemo(() => new Map(ops.map((o) => [o.target.id, o])), [ops]);
  const byId = useMemo(() => new Map(nets.map((n) => [n.id, n])), [nets]);

  const remove = async (list: Network[]) => {
    const ok = await confirm({
      title: `Delete ${list.length === 1 ? list[0].name : `${list.length} networks`}?`,
      message: 'Networks can only be deleted when no VMs, databases, load balancers or clusters are attached. Peerings are torn down.',
      confirmLabel: 'Delete', danger: true, typeToConfirm: list.length === 1 ? list[0].name : undefined,
    });
    if (!ok) return;
    const res = await Promise.allSettled(list.map((n) => api.remove('networks', n.id)));
    const failed = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) toast.error(`${failed.length} deletion(s) failed`, failed[0].reason?.message);
    else toast.success(`Deleting ${list.length} network${list.length > 1 ? 's' : ''}`);
  };

  const subnets = nets.reduce((a, n) => a + n.subnets.length, 0);
  const attached = nets.reduce((a, n) => a + (n.attached ? n.attached.vms + n.attached.dbs + n.attached.lbs + n.attached.k8s : 0), 0);
  const peerings = nets.reduce((a, n) => a + n.peerings.length, 0) / 2;
  const nat = nets.filter((n) => n.natGateway).length;

  const allColumns: Column<Network>[] = [
    {
      id: 'name', header: 'Name', sort: (n) => n.name,
      cell: (n) => {
        const p = projects.get(n.projectId);
        return (
          <div className="min-w-0">
            <Link to={`/infrastructure/networks/${n.id}`} className="block truncate font-medium text-fg hover:text-brand-500">{n.name}</Link>
            <div className="flex items-center gap-1.5 text-[11px] text-muted">
              {p && <span className="size-1.5 rounded-full" style={{ background: p.color }} title={p.name} />}
              {pro ? <span className="font-mono">{n.id}</span> : n.description ? <span className="truncate">{n.description}</span> : <span>{p?.name}</span>}
            </div>
          </div>
        );
      },
    },
    { id: 'status', header: 'Status', sort: (n) => n.status, cell: (n) => { const op = opByTarget.get(n.id); return op ? <div className="w-32"><StatusPill status={n.status} /><OperationInline op={op} className="mt-1.5" /></div> : <StatusPill status={n.status} /> } },
    {
      id: 'cidr', header: pro ? 'Address space' : 'IP range', sort: (n) => parseCidr(n.cidr)?.network ?? 0,
      cell: (n) => pro ? <div className="space-y-1"><Mono copy>{n.cidr}</Mono><MiniSpace n={n} /></div> : <Mono copy>{n.cidr}</Mono>,
    },
    {
      id: 'subnets', header: 'Subnets', hideBelow: 'md', sort: (n) => n.subnets.length,
      cell: (n) => !pro ? <span className="tabular text-fg-2">{n.subnets.length}</span> : (
        <div className="flex items-center gap-2 text-fg-2">
          <span className="tabular">{n.subnets.length}</span>
          <span className="flex items-center gap-1 text-[11px] text-muted"><Globe2 className="size-3 text-emerald-500" />{n.subnets.filter((s) => s.public).length}<Lock className="ml-1 size-3" />{n.subnets.filter((s) => !s.public).length}</span>
        </div>
      ),
    },
    {
      id: 'location', header: 'Location', hideBelow: pro ? 'lg' : undefined, sort: (n) => n.locationId,
      cell: (n) => { const l = locations.get(n.locationId); return <span className="flex items-center gap-1.5 text-fg-2">{l?.kind === 'cloud' ? <Cloud className="size-3.5 text-sky-500" /> : <Building2 className="size-3.5 text-emerald-500" />}{l?.name ?? n.locationId}</span> },
    },
    {
      id: 'attached', header: pro ? 'Attached' : 'Resources', hideBelow: 'md', sort: (n) => (n.attached ? n.attached.vms + n.attached.dbs + n.attached.lbs + n.attached.k8s : 0),
      cell: (n) => !pro ? <span className="tabular text-fg-2">{n.attached ? n.attached.vms + n.attached.dbs + n.attached.lbs + n.attached.k8s : 0}</span> : n.attached ? (
        <span className="text-xs text-fg-2">{[[n.attached.vms, 'VM'], [n.attached.dbs, 'DB'], [n.attached.lbs, 'LB'], [n.attached.k8s, 'k8s']].filter(([c]) => (c as number) > 0).map(([c, l]) => `${c} ${l}`).join(' · ') || <span className="text-faint">none</span>}</span>
      ) : null,
    },
    {
      id: 'links', header: 'Gateways & links', hideBelow: 'xl',
      cell: (n) => (
        <div className="flex flex-wrap gap-1">
          {n.natGateway && <Badge tone="warning">NAT</Badge>}
          {n.peerings.map((p) => <Badge key={p.id} tone={p.kind === 'vpn' ? 'violet' : 'success'}>{p.kind === 'vpn' ? <Waypoints className="size-3" /> : <ArrowLeftRight className="size-3" />}{byId.get(p.networkId)?.name ?? p.networkId}</Badge>)}
          {n.mtu > 1500 && <Badge tone="info">jumbo {n.mtu}</Badge>}
        </div>
      ),
    },
    { id: 'tags', header: 'Tags', hideBelow: 'xl', cell: (n) => <Tags tags={n.tags} max={2} /> },
    { id: 'cost', header: 'Monthly', align: 'right', sort: (n) => n.monthlyCost ?? 0, cell: (n) => <span className="tabular text-fg">{money(n.monthlyCost)}</span> },
  ];
  const columns = allColumns.filter((c) => pro || !['links', 'tags', 'cost'].includes(c.id));

  return (
    <Page wide>
      <PageHeader
        title="Networks"
        description={pro ? 'Isolated virtual private clouds (VPCs) with subnets, routing, NAT and peering across your locations.' : 'Private networks for your servers, databases and clusters.'}
        icon={NetworkIcon}
        iconColor="#10b981"
        actions={<>
          <Pro><Button icon={MapIcon} to="/topology">Topology map</Button></Pro>
          <Button variant="primary" icon={Plus} to="/infrastructure/networks/new">Create network</Button>
        </>}
      />
      <Pro><div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="VPC networks" value={num(nets.length)} icon={NetworkIcon} sub={`${num(subnets)} subnets`} />
        <Stat label="Attached resources" value={num(attached)} icon={Layers} sub="VMs, DBs, LBs, clusters" />
        <Stat label="Peerings & VPNs" value={num(peerings)} icon={ArrowLeftRight} sub="private links between VPCs" />
        <Stat label="NAT gateways" value={num(nat)} sub={`${money(nets.reduce((a, n) => a + (n.monthlyCost ?? 0), 0))}/mo`} accent="#10b981" />
      </div></Pro>
      <DataTable
        rows={nets}
        loading={isLoading}
        columns={columns}
        initialSearch={sp.get('q') ?? ''}
        searchText={(n) => `${n.name} ${n.id} ${n.cidr} ${n.subnets.map((s) => `${s.name} ${s.cidr}`).join(' ')} ${n.locationId} ${n.tags.map((t) => `${t.key}:${t.value}`).join(' ')}`}
        searchPlaceholder="Search name, CIDR, subnet…"
        rowLink={(n) => `/infrastructure/networks/${n.id}`}
        defaultSort={{ id: 'name', dir: 'asc' }}
        rowActions={(n) => (
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />} items={[
            { label: 'Open', icon: NetworkIcon, to: `/infrastructure/networks/${n.id}` },
            { label: 'Add subnet', icon: Plus, to: `/infrastructure/networks/${n.id}?tab=subnets` },
            { divider: true, label: '' },
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove([n]) },
          ]} />
        )}
        bulkActions={[{ label: 'Delete', icon: Trash2, danger: true, onClick: remove }]}
        empty={{ icon: NetworkIcon, title: 'No networks yet', description: 'Create a VPC to give your VMs, databases and clusters a private network.', action: <Button variant="primary" icon={Plus} to="/infrastructure/networks/new">Create network</Button> }}
      />
    </Page>
  );
}
