import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Network as NetworkIcon, Plus, Trash2, Globe2, Lock, ArrowLeftRight, Waypoints, Route as RouteIcon, Pencil, Save, Unlink, MapPin, AlertTriangle, Layers } from 'lucide-react';
import { useItem, useList, useLookup, useApiMutation, useActiveOperation } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardHeader, CardBody, KeyValue } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusPill, Badge, Tags } from '@/components/ui/Badge';
import { Tabs, useTabParam, Segmented } from '@/components/ui/Tabs';
import { Modal, confirm } from '@/components/ui/Modal';
import { Field, Input, Select, Switch, TagEditor, Textarea, Hint } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { Mono, Meter, EmptyState, Skeleton } from '@/components/ui/misc';
import { IacTabs, toHcl, toCli, toCurl } from '@/components/ui/CodeBlock';
import { toast } from '@/components/ui/toast';
import { OperationRunner } from '@/components/resource/OperationRunner';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { ResourceLink, KindIcon } from '@/components/resource/ResourceLink';
import { parseCidr, cidrOverlaps, usableHosts, nthHost } from '@/lib/cidr';
import { money, num, timeAgo } from '@/lib/format';
import { KINDS } from '@/lib/kinds';
import { cn } from '@/lib/cn';
import { AddressSpace, nextSuggestion } from '@/components/network/AddressSpace';
import { VpcDiagram } from '@/components/network/VpcDiagram';
import { SubnetConnector, type ConnectorResource } from '@/components/network/SubnetConnector';
import { subnetColor, subnetCidrProblem, cidrRange } from '@/components/network/util';
import { Advanced, Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import type { Network, Subnet, Route, VM, DbInstance, LoadBalancer, K8sCluster, IpAddress, Location, Project, DnsZone, ResourceKind } from '@/types';

export default function NetworkDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const pro = usePro();
  const { data: net, isLoading, error } = useItem<Network>('networks', id);
  const { items: vms } = useList<VM>('vms', { networkId: id });
  const { items: dbs } = useList<DbInstance>('dbInstances', { networkId: id });
  const { items: lbs } = useList<LoadBalancer>('loadBalancers', { networkId: id });
  const { items: k8s } = useList<K8sCluster>('k8sClusters', { networkId: id });
  const { map: ips } = useLookup<IpAddress>('ips');
  const { map: networks, items: allNets } = useLookup<Network>('networks');
  const { map: locations } = useLookup<Location>('locations');
  const { map: projects } = useLookup<Project>('projects');
  const op = useActiveOperation(id);
  const [tab, setTab] = useTabParam('overview');
  const [subnetModal, setSubnetModal] = useState<{ cidr?: string; edit?: Subnet } | null>(null);
  const [routeModal, setRouteModal] = useState(false);
  const [peerModal, setPeerModal] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [subnetView, setSubnetView] = useState<'diagram' | 'table'>('diagram');

  const action = useApiMutation(({ a, body }: { a: string; body?: unknown }) => api.action('networks', id!, a, body), { silent: true, onError: (e) => toast.error('Action failed', e.message) });

  if (isLoading) return <Page><Skeleton className="mb-4 h-10 w-72" /><Skeleton className="h-64" /></Page>;
  if (error || !net) return <Page><EmptyState icon={NetworkIcon} title="Network not found" description="It may have been deleted, or it belongs to another account." action={<Button to="/infrastructure/networks">Back to networks</Button>} /></Page>;

  const loc = locations.get(net.locationId);
  const proj = projects.get(net.projectId);
  const attachedCount = vms.length + dbs.length + lbs.length + k8s.length;
  const v = parseCidr(net.cidr)!;
  const usedSpace = net.subnets.reduce((a, s) => a + (parseCidr(s.cidr)?.size ?? 0), 0);
  const subnetRes = (s: Subnet) => vms.filter((x) => x.subnetId === s.id).length + dbs.filter((x) => x.subnetId === s.id).length + k8s.filter((x) => x.subnetId === s.id).length;

  const remove = async () => {
    if (attachedCount) { toast.error('Network in use', `Detach or delete its ${attachedCount} resource(s) first.`); setTab(pro ? 'resources' : 'overview'); return }
    const ok = await confirm({ title: `Delete ${net.name}?`, message: `Tears down ${net.peerings.length ? `${net.peerings.length} peering(s), ` : ''}the router, DHCP${net.natGateway ? ' and the NAT gateway' : ''}. This cannot be undone.`, confirmLabel: 'Delete network', danger: true, typeToConfirm: net.name });
    if (!ok) return;
    try { await api.remove('networks', net.id); toast.success(`Deleting ${net.name}`); navigate('/infrastructure/networks') } catch (e) { toast.error('Delete failed', (e as Error).message) }
  };
  const removeSubnet = async (s: Subnet) => {
    const ok = await confirm({ title: `Delete subnet ${s.name}?`, message: `${s.cidr} will be released.`, confirmLabel: 'Delete subnet', danger: true });
    if (ok) action.mutate({ a: 'removeSubnet', body: { subnetId: s.id } }, { onSuccess: () => toast.success(`Subnet ${s.name} deleted`) });
  };

  const subnetCols: Column<Subnet>[] = [
    { id: 'name', header: 'Subnet', sort: (s) => s.name, cell: (s) => { const i = net.subnets.indexOf(s); return <div className="flex items-center gap-2"><span className="size-2.5 shrink-0 rounded-sm" style={{ background: subnetColor(i) }} /><div className="min-w-0"><div className="truncate font-medium text-fg">{s.name}</div>{s.description && <div className="truncate text-[11px] text-muted">{s.description}</div>}</div></div> } },
    { id: 'cidr', header: 'CIDR', sort: (s) => parseCidr(s.cidr)?.network ?? 0, cell: (s) => <div><Mono copy>{s.cidr}</Mono><div className="text-[11px] text-faint">{cidrRange(s.cidr)}</div></div> },
    { id: 'type', header: 'Type', cell: (s) => s.public ? <Badge tone="success"><Globe2 className="size-3" />public</Badge> : <Badge><Lock className="size-3" />private{net.natGateway ? ' · NAT' : ''}</Badge> },
    { id: 'gw', header: 'Gateway', hideBelow: 'lg', cell: (s) => <Mono>{s.gateway}</Mono> },
    { id: 'usage', header: 'IP usage', sort: (s) => (s.usedIps ?? 0) / (s.capacity || 1), cell: (s) => <div className="w-36"><Meter size="sm" value={s.usedIps ?? 0} max={s.capacity ?? usableHosts(s.cidr)} /><div className="mt-1 text-[11px] tabular text-muted">{s.usedIps ?? 0} / {num(s.capacity ?? usableHosts(s.cidr))} · {subnetRes(s)} resources</div></div> },
    { id: 'dhcp', header: 'DHCP', hideBelow: 'md', cell: (s) => <span className="text-fg-2">{s.dhcp ? 'on' : 'off'}</span> },
  ];
  const routeCols: Column<Route>[] = [
    { id: 'dest', header: 'Destination', sort: (r) => r.destination, cell: (r) => <Mono>{r.destination}</Mono> },
    {
      id: 'target', header: 'Target', cell: (r) => {
        const t = r.target;
        if (t.type === 'local') return <Badge tone="neutral">local</Badge>;
        if (t.type === 'nat') return <Badge tone="warning"><Lock className="size-3" />NAT gateway</Badge>;
        if (t.type === 'internet') return <Badge tone="success"><Globe2 className="size-3" />Internet gateway</Badge>;
        if (t.type === 'vm') return <ResourceLink type="vm" id={t.id!} name={vms.find((x) => x.id === t.id)?.name} />;
        return <span className="flex items-center gap-1.5">{t.type === 'vpn' ? <Waypoints className="size-3.5 text-violet-500" /> : <ArrowLeftRight className="size-3.5 text-emerald-500" />}<ResourceLink type="network" id={t.id!} name={networks.get(t.id!)?.name} showIcon={false} /><span className="text-[11px] text-muted">{t.type}</span></span>;
      },
    },
    { id: 'desc', header: 'Description', hideBelow: 'md', cell: (r) => <span className="text-fg-2">{r.description}</span> },
    { id: 'kind', header: '', cell: (r) => r.system ? <Badge tone="info">system</Badge> : <Badge tone="brand">custom</Badge> },
  ];

  const attachedGroups: { kind: ResourceKind; label: string; rows: { id: string; name: string; status: string; sub: string; subnet?: string }[] }[] = [
    { kind: 'vm', label: 'Virtual machines', rows: vms.map((x) => ({ id: x.id, name: x.name, status: x.status, sub: x.privateIp, subnet: x.subnetId })) },
    { kind: 'db', label: 'Databases', rows: dbs.map((x) => ({ id: x.id, name: x.name, status: x.status, sub: `${x.engine} ${x.version}`, subnet: x.subnetId })) },
    { kind: 'lb', label: 'Load balancers', rows: lbs.map((x) => ({ id: x.id, name: x.name, status: x.status, sub: `${x.type} · ${x.hostname}` })) },
    { kind: 'k8s', label: 'Kubernetes clusters', rows: k8s.map((x) => ({ id: x.id, name: x.name, status: x.status, sub: `v${x.version} · ${x.nodePools.reduce((a, p) => a + p.count, 0)} nodes`, subnet: x.subnetId })) },
  ];

  const lbx = (x: LoadBalancer) => x as LoadBalancer & { subnetId?: string; privateIp?: string };
  const connectorResources: ConnectorResource[] = [
    ...vms.map((x): ConnectorResource => ({ kind: 'vm', id: x.id, name: x.name, status: x.status, ip: x.privateIp, sub: x.size ? `${x.size.vcpus} vCPU · ${x.size.ramGB} GB` : undefined, subnetId: x.subnetId })),
    ...dbs.map((x): ConnectorResource => ({ kind: 'db', id: x.id, name: x.name, status: x.status, ip: x.privateIp, sub: `${x.engine} ${x.version}${x.ha ? ' · HA' : ''}`, subnetId: x.subnetId })),
    ...lbs.map((x): ConnectorResource => ({ kind: 'lb', id: x.id, name: x.name, status: x.status, ip: lbx(x).privateIp, sub: x.type, subnetId: lbx(x).subnetId })),
    ...k8s.map((x): ConnectorResource => ({ kind: 'k8s', id: x.id, name: x.name, status: x.status, sub: `v${x.version} · ${x.nodePools.reduce((a, p) => a + p.count, 0)} nodes`, subnetId: x.subnetId })),
  ];
  const suggested = nextSuggestion(net.cidr, net.subnets.map((s) => s.cidr));

  return (
    <Page wide>
      <PageHeader
        title={net.name}
        icon={NetworkIcon}
        iconColor="#10b981"
        status={<StatusPill status={net.status} />}
        crumbs={[{ label: 'Networks', to: '/infrastructure/networks' }, { label: net.name }]}
        description={net.description}
        meta={<>
          <span className="font-mono">{net.cidr}</span>
          <span className="flex items-center gap-1"><MapPin className="size-3" />{loc?.name ?? net.locationId}</span>
          {pro && proj && <span className="flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: proj.color }} />{proj.name}</span>}
          <span>{net.subnets.length} subnet{net.subnets.length === 1 ? '' : 's'} · {attachedCount} resource{attachedCount === 1 ? '' : 's'}</span>
          <span>created {timeAgo(net.createdAt)}</span>
          {pro && <Mono copy className="text-[11px]">{net.id}</Mono>}
        </>}
        actions={<>
          <Button icon={Plus} disabled={net.status !== 'available'} onClick={() => setSubnetModal({ cidr: nextSuggestion(net.cidr, net.subnets.map((s) => s.cidr)) ?? '' })}>Add subnet</Button>
          <Pro>
            <Button icon={ArrowLeftRight} disabled={net.status !== 'available'} onClick={() => setPeerModal(true)}>Peer</Button>
            <IconButton icon={Trash2} label="Delete network" variant="secondary" onClick={remove} />
          </Pro>
        </>}
      />
      {op && <OperationRunner op={op} className="mb-5" />}

      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={pro ? [
        { id: 'overview', label: 'Overview' },
        { id: 'subnets', label: 'Subnets', count: net.subnets.length },
        { id: 'routes', label: 'Routes', count: net.routes.length },
        { id: 'peering', label: 'Peering', count: net.peerings.length },
        { id: 'resources', label: 'Resources', count: attachedCount },
        { id: 'settings', label: 'Settings' },
        { id: 'activity', label: 'Activity' },
      ] : [
        { id: 'overview', label: 'Overview' },
        { id: 'subnets', label: 'Subnets', count: net.subnets.length },
        { id: 'settings', label: 'Settings' },
      ]} />

      {tab === 'overview' && !pro && (
        <div className="grid gap-5 @min-[56rem]:grid-cols-[320px_minmax(0,1fr)]">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <KeyValue items={[
                ['IP range', <Mono copy>{net.cidr}</Mono>],
                ['Location', loc?.name ?? net.locationId],
                ['Subnets', `${net.subnets.filter((s) => s.public).length} public · ${net.subnets.filter((s) => !s.public).length} private`],
                ['Internet for private subnets', net.natGateway ? 'Yes (NAT gateway)' : <span className="text-muted">No</span>],
                ['Monthly', money(net.monthlyCost)],
              ]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Resources" description={attachedCount ? undefined : 'Nothing is connected to this network yet.'} />
            {attachedCount > 0 && (
              <ul className="divide-y divide-line">
                {attachedGroups.flatMap((g) => g.rows.map((r) => {
                  const sn = r.subnet ? net.subnets.find((s) => s.id === r.subnet) : undefined;
                  return (
                    <li key={`${g.kind}:${r.id}`} className="flex items-center gap-3 px-4 py-2.5">
                      <KindIcon type={g.kind} size="sm" />
                      <div className="min-w-0 flex-1"><ResourceLink type={g.kind} id={r.id} name={r.name} showIcon={false} /><div className="truncate text-[11px] text-muted">{KINDS[g.kind].label}{sn ? ` · ${sn.name}` : ''}</div></div>
                      <StatusPill status={r.status} />
                    </li>
                  );
                }))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === 'overview' && pro && (
        <div className="space-y-5">
          <div className="grid gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_360px]">
            <Card>
              <CardHeader title="Address space" description="Each cell is 1/256 of the VPC. Click a dashed cell to carve a new subnet there." icon={Layers}
                actions={<Button size="xs" variant="ghost" icon={Plus} onClick={() => setSubnetModal({ cidr: nextSuggestion(net.cidr, net.subnets.map((s) => s.cidr)) ?? '' })}>Subnet</Button>} />
              <CardBody>
                <AddressSpace cidr={net.cidr} blocks={net.subnets.map((s, i) => ({ id: s.id, name: s.name, cidr: s.cidr, public: s.public, color: subnetColor(i), usedIps: s.usedIps, capacity: s.capacity }))}
                  selectedId={selected} onSelect={(sid) => { setSelected(sid); const s = net.subnets.find((x) => x.id === sid); if (s) setSubnetModal({ edit: s }) }}
                  onGapClick={net.status === 'available' ? (c) => setSubnetModal({ cidr: c }) : undefined} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Details" />
              <CardBody className="space-y-4">
                <KeyValue cols={2} items={[
                  ['CIDR', <Mono copy>{net.cidr}</Mono>],
                  ['Addresses', `${num(v.size)} · ${Math.round((usedSpace / v.size) * 100)}% in subnets`],
                  ['Location', loc?.name ?? net.locationId],
                  ['MTU', `${net.mtu}${net.mtu > 1500 ? ' (jumbo)' : ''}`],
                  ['NAT gateway', net.natGateway ? <Badge tone="warning">enabled</Badge> : <span className="text-muted">disabled</span>],
                  ['DNS resolver', <Mono>{nthHost(net.cidr, 2)}</Mono>],
                  ['Private DNS', net.dnsZoneId ? <ResourceLink type="dnsZone" id={net.dnsZoneId} /> : null],
                  ['Monthly', money(net.monthlyCost)],
                ]} />
                <div className="grid grid-cols-4 gap-2 border-t border-line pt-3 text-center">
                  {attachedGroups.map((g) => (
                    <button key={g.kind} type="button" onClick={() => setTab('resources')} className="rounded-lg bg-surface-2 py-2 hover:bg-surface-3">
                      <div className="text-base font-semibold tabular text-fg">{g.rows.length}</div>
                      <div className="text-[10px] text-muted">{KINDS[g.kind].label === 'Kubernetes cluster' ? 'Clusters' : KINDS[g.kind].label + 's'}</div>
                    </button>
                  ))}
                </div>
                <Tags tags={net.tags} max={6} />
              </CardBody>
            </Card>
          </div>
          <Card>
            <CardHeader title="Topology" description="How traffic enters and leaves this VPC, and what runs where." icon={RouteIcon} actions={<Button size="xs" variant="ghost" to="/topology">Global map</Button>} />
            <CardBody><VpcDiagram network={net} vms={vms} dbs={dbs} lbs={lbs} k8s={k8s} ips={ips} networks={networks} /></CardBody>
          </Card>
          <IacTabs snippets={{
            terraform: toHcl('network', net.name.replace(/-/g, '_'), { name: net.name, cidr: net.cidr, location: net.locationId, nat_gateway: net.natGateway, mtu: net.mtu }) + '\n' + net.subnets.map((s) => toHcl('subnet', s.name.replace(/-/g, '_'), { network_id: `autark_network.${net.name.replace(/-/g, '_')}.id`, name: s.name, cidr: s.cidr, public: s.public })).join('\n'),
            cli: toCli('network get', { id: net.id }),
            curl: toCurl('GET', `/networks/${net.id}`),
          }} />
        </div>
      )}

      {tab === 'subnets' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 text-[13px] text-muted">
              <span className="font-mono text-fg-2">{net.cidr}</span> · {net.subnets.length} subnet{net.subnets.length === 1 ? '' : 's'}{pro && ` · ${Math.round((usedSpace / v.size) * 100)}% of the address space allocated`}
            </p>
            {pro ? <Segmented size="sm" value={subnetView} onChange={setSubnetView} options={[{ value: 'diagram', label: 'Diagram' }, { value: 'table', label: 'Table' }]} />
              : <Button size="sm" variant="primary" icon={Plus} disabled={net.status !== 'available'} onClick={() => setSubnetModal({ cidr: suggested ?? '' })}>Add subnet</Button>}
          </div>
          {subnetView === 'diagram' || !pro ? (
            <Card><CardBody>
              <SubnetConnector net={net} resources={connectorResources} selectedId={selected} onSelect={setSelected} suggestedCidr={suggested}
                onAddSubnet={() => setSubnetModal({ cidr: suggested ?? '' })} onEditSubnet={(s) => setSubnetModal({ edit: s })} onDeleteSubnet={removeSubnet} />
            </CardBody></Card>
          ) : (
            <DataTable rows={net.subnets} columns={subnetCols} rowClassName={(s) => (selected === s.id ? 'bg-brand-500/[0.05]' : undefined)} onRowClick={(s) => setSelected(s.id)}
              toolbar={<Button size="sm" variant="primary" icon={Plus} disabled={net.status !== 'available'} onClick={() => setSubnetModal({ cidr: suggested ?? '' })}>Add subnet</Button>}
              rowActions={(s) => <div className="flex gap-0.5"><IconButton size="sm" icon={Pencil} label="Edit" onClick={() => setSubnetModal({ edit: s })} /><IconButton size="sm" icon={Trash2} label="Delete" onClick={() => removeSubnet(s)} /></div>} />
          )}
        </div>
      )}

      {tab === 'routes' && (
        <div className="space-y-3">
          <Hint>Routes are evaluated by longest prefix match. System routes are maintained by Autark (local VPC traffic, NAT egress) — add custom routes to send traffic through an appliance VM, a peering or a VPN.</Hint>
          <DataTable rows={net.routes} columns={routeCols}
            toolbar={<Button size="sm" variant="primary" icon={Plus} onClick={() => setRouteModal(true)}>Add route</Button>}
            rowActions={(r) => r.system ? null : <IconButton size="sm" icon={Trash2} label="Remove route" onClick={async () => { if (await confirm({ title: `Remove route to ${r.destination}?`, danger: true, confirmLabel: 'Remove' })) action.mutate({ a: 'removeRoute', body: { routeId: r.id } }, { onSuccess: () => toast.success('Route removed') }) }} />} />
        </div>
      )}

      {tab === 'peering' && (
        <div className="space-y-3">
          {net.peerings.length === 0 ? (
            <Card><EmptyState icon={ArrowLeftRight} title="No peerings" description="Connect this VPC privately to another network in your account. Networks in different locations are linked by an encrypted site-to-site VPN." action={<Button variant="primary" icon={Plus} onClick={() => setPeerModal(true)}>Peer with network</Button>} /></Card>
          ) : (
            <>
              <div className="flex justify-end"><Button variant="primary" icon={Plus} onClick={() => setPeerModal(true)}>Peer with network</Button></div>
              <div className="grid gap-3 @min-[40rem]:grid-cols-2">
                {net.peerings.map((p) => {
                  const o = networks.get(p.networkId);
                  const vpn = p.kind === 'vpn';
                  return (
                    <Card key={p.id} className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1 rounded-lg bg-surface-2 p-2.5 text-center">
                          <div className="truncate text-sm font-medium text-fg">{net.name}</div>
                          <div className="font-mono text-[11px] text-muted">{net.cidr}</div>
                          <div className="text-[10px] text-faint">{net.locationId}</div>
                        </div>
                        <div className="flex shrink-0 flex-col items-center gap-1">
                          {vpn ? <Waypoints className="size-5 text-violet-500" /> : <ArrowLeftRight className="size-5 text-emerald-500" />}
                          <svg width="56" height="6" aria-hidden><line x1="0" y1="3" x2="56" y2="3" stroke={vpn ? '#8b5cf6' : '#10b981'} strokeWidth="2" className="flow-line" /></svg>
                          <span className="text-[10px] font-medium uppercase text-muted">{vpn ? 'WireGuard VPN' : 'Peering'}</span>
                        </div>
                        <div className="min-w-0 flex-1 rounded-lg bg-surface-2 p-2.5 text-center">
                          <ResourceLink type="network" id={p.networkId} name={o?.name} showIcon={false} className="justify-center font-medium" />
                          <div className="font-mono text-[11px] text-muted">{o?.cidr}</div>
                          <div className="text-[10px] text-faint">{o?.locationId}</div>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                        <StatusPill status={p.status} />
                        <Button size="xs" variant="outline-danger" icon={Unlink} onClick={async () => { if (await confirm({ title: `Remove ${vpn ? 'VPN' : 'peering'} with ${o?.name ?? p.networkId}?`, message: 'Routes between the networks are withdrawn on both sides.', danger: true, confirmLabel: 'Disconnect' })) action.mutate({ a: 'unpeer', body: { networkId: p.networkId } }, { onSuccess: () => toast.success('Disconnected') }) }}>Disconnect</Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'resources' && (
        <div className="grid gap-4 @min-[44rem]:grid-cols-2">
          {attachedGroups.map((g) => (
            <Card key={g.kind}>
              <CardHeader title={<span className="flex items-center gap-2"><KindIcon type={g.kind} size="sm" />{g.label}<span className="text-xs font-normal text-muted">{g.rows.length}</span></span>} />
              {g.rows.length === 0 ? <p className="px-4 py-5 text-center text-xs text-faint">None in this network</p> : (
                <ul className="divide-y divide-line">
                  {g.rows.map((r) => {
                    const sn = r.subnet ? net.subnets.find((s) => s.id === r.subnet) : undefined;
                    return (
                      <li key={r.id} className="flex items-center gap-3 px-4 py-2">
                        <div className="min-w-0 flex-1"><ResourceLink type={g.kind} id={r.id} name={r.name} /><div className="truncate font-mono text-[11px] text-muted">{r.sub}</div></div>
                        {sn && <Badge tone={sn.public ? 'success' : 'neutral'}>{sn.name}</Badge>}
                        <StatusPill status={r.status} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}

      {tab === 'settings' && <NetworkSettings net={net} onDelete={remove} attachedCount={attachedCount} />}
      {tab === 'activity' && <Card><ActivityFeed targetId={net.id} /></Card>}

      <SubnetModal net={net} state={subnetModal} onClose={() => setSubnetModal(null)} />
      <RouteModal net={net} open={routeModal} onClose={() => setRouteModal(false)} vms={vms} networks={networks} />
      <PeerModal net={net} open={peerModal} onClose={() => setPeerModal(false)} networks={allNets} />
    </Page>
  );
}

/* ------------------------------------------------------------------ subnet add / edit */

function SubnetModal({ net, state, onClose }: { net: Network; state: { cidr?: string; edit?: Subnet } | null; onClose: () => void }) {
  const edit = state?.edit;
  const [name, setName] = useState('');
  const [cidr, setCidr] = useState('');
  const [pub, setPub] = useState(false);
  const [dhcp, setDhcp] = useState(true);
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!state) return;
    setErrors({});
    if (state.edit) { setName(state.edit.name); setCidr(state.edit.cidr); setPub(state.edit.public); setDhcp(state.edit.dhcp); setDescription(state.edit.description ?? '') }
    else { setName(`${net.name.replace(/^vpc-/, '')}-subnet-${net.subnets.length + 1}`); setCidr(state.cidr ?? ''); setPub(false); setDhcp(true); setDescription('') }
  }, [state]); // eslint-disable-line
  const others = net.subnets.filter((s) => s.id !== edit?.id);
  const localErr = edit ? null : subnetCidrProblem(net.cidr, cidr, others);
  const save = useApiMutation(() => edit
    ? api.action('networks', net.id, 'updateSubnet', { subnetId: edit.id, name, public: pub, dhcp, description })
    : api.action('networks', net.id, 'addSubnet', { name, cidr, public: pub, dhcp, description }), {
    success: edit ? 'Subnet updated' : `Subnet ${name} created`,
    onSuccess: onClose,
    onError: (e: ApiClientError) => setErrors(fieldErrors(e)),
  });
  const prefix = parseCidr(cidr)?.prefix ?? 24;
  const sizes = [20, 22, 24, 26, 28].filter((p) => p > (parseCidr(net.cidr)?.prefix ?? 16));
  return (
    <Modal open={!!state} onClose={onClose} size="lg" title={edit ? `Edit subnet ${edit.name}` : 'Add subnet'} description={edit ? 'CIDR is immutable — create a new subnet to change the range.' : `Inside ${net.cidr}, non-overlapping with existing subnets.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!!localErr || !name} onClick={() => save.mutate()}>{edit ? 'Save' : 'Create subnet'}</Button></>}>
      <div className="space-y-4">
        <Pro>
          <AddressSpace cidr={net.cidr} blocks={others.map((s) => ({ id: s.id, name: s.name, cidr: s.cidr, public: s.public, color: subnetColor(net.subnets.indexOf(s)) }))} preview={localErr ? null : cidr}
            onGapClick={edit ? undefined : (c) => setCidr(c)} preferredPrefix={prefix} showLegend={false} />
        </Pro>
        <div className="grid gap-4 @min-[36rem]:grid-cols-2">
          <Field label="Name" required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} /></Field>
          <Field label="CIDR" required error={localErr ?? errors.cidr} hint={!localErr && cidr ? `${cidrRange(cidr)} · ${num(usableHosts(cidr))} usable hosts · gateway ${nthHost(cidr, 1)}` : undefined}>
            <Input mono value={cidr} disabled={!!edit} onChange={(e) => setCidr(e.target.value.trim())} invalid={!!(localErr ?? errors.cidr)} />
            {!edit && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {sizes.map((p) => (
                  <button key={p} type="button" onClick={() => { const s = nextSuggestion(net.cidr, others.map((o) => o.cidr), p); if (s) setCidr(s) }} className={cn('rounded-md border px-1.5 py-0.5 font-mono text-[11px]', prefix === p ? 'border-brand-500 text-brand-600 dark:text-brand-300' : 'border-line text-muted hover:text-fg')}>/{p}</button>
                ))}
              </div>
            )}
          </Field>
        </div>
        <Field label="Type"><Segmented value={pub ? 'public' : 'private'} onChange={(x) => setPub(x === 'public')} options={[{ value: 'public', label: 'Public (internet gateway)', icon: <Globe2 className="size-3.5" /> }, { value: 'private', label: net.natGateway ? 'Private (NAT egress)' : 'Private (isolated)', icon: <Lock className="size-3.5" /> }]} /></Field>
        <Advanced description="DHCP, description">
          <Switch checked={dhcp} onChange={setDhcp} label="DHCP" description="Hand out addresses automatically. Disable for static-only appliance subnets." />
          <Field label="Description" optional><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </Advanced>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ routes */

function RouteModal({ net, open, onClose, vms, networks }: { net: Network; open: boolean; onClose: () => void; vms: VM[]; networks: Map<string, Network> }) {
  const [destination, setDestination] = useState('');
  const [type, setType] = useState<'nat' | 'internet' | 'vm' | 'peering' | 'vpn'>('vm');
  const [targetId, setTargetId] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setDestination(''); setType(net.peerings.length ? (net.peerings[0].kind === 'vpn' ? 'vpn' : 'peering') : 'vm'); setTargetId(''); setDescription(''); setErrors({}) } }, [open]); // eslint-disable-line
  const peers = net.peerings.filter((p) => (type === 'vpn' ? p.kind === 'vpn' : p.kind !== 'vpn'));
  const targets = type === 'vm' ? vms.map((x) => ({ value: x.id, label: `${x.name} · ${x.privateIp}` })) : type === 'peering' || type === 'vpn' ? peers.map((p) => ({ value: p.networkId, label: `${networks.get(p.networkId)?.name ?? p.networkId} · ${networks.get(p.networkId)?.cidr ?? ''}` })) : [];
  useEffect(() => { setTargetId(targets[0]?.value ?? '') }, [type, open]); // eslint-disable-line
  const save = useApiMutation(() => api.action('networks', net.id, 'addRoute', { destination, target: { type, ...(targetId ? { id: targetId } : {}) }, description }), {
    success: 'Route added', onSuccess: onClose, onError: (e: ApiClientError) => setErrors(fieldErrors(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title="Add route" description="Send traffic for a destination range to a next hop."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!destination} onClick={() => save.mutate()}>Add route</Button></>}>
      <div className="space-y-4">
        <Field label="Destination CIDR" required error={errors.destination} hint="0.0.0.0/0 for a default route"><Input mono value={destination} onChange={(e) => setDestination(e.target.value.trim())} placeholder="192.168.50.0/24" /></Field>
        <Field label="Target type" error={errors.target}>
          <Select value={type} onChange={(e) => setType(e.target.value as any)} options={[
            { value: 'vm', label: 'Appliance VM (next hop)' }, { value: 'peering', label: 'Peered network', disabled: !net.peerings.some((p) => p.kind !== 'vpn') }, { value: 'vpn', label: 'Site-to-site VPN', disabled: !net.peerings.some((p) => p.kind === 'vpn') },
            { value: 'nat', label: 'NAT gateway', disabled: !net.natGateway }, { value: 'internet', label: 'Internet gateway' },
          ]} />
        </Field>
        {targets.length > 0 && <Field label="Target"><Select value={targetId} onChange={(e) => setTargetId(e.target.value)} options={targets} /></Field>}
        <Field label="Description" optional><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. On-prem office via firewall VM" /></Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ peering */

function PeerModal({ net, open, onClose, networks }: { net: Network; open: boolean; onClose: () => void; networks: Network[] }) {
  const candidates = networks.filter((n) => n.id !== net.id && !net.peerings.some((p) => p.networkId === n.id));
  const [otherId, setOtherId] = useState('');
  const [kind, setKind] = useState<'peering' | 'vpn'>('peering');
  const [routes, setRoutes] = useState(true);
  useEffect(() => { if (open) setOtherId(candidates.find((c) => !cidrOverlaps(c.cidr, net.cidr))?.id ?? candidates[0]?.id ?? '') }, [open]); // eslint-disable-line
  const other = candidates.find((c) => c.id === otherId);
  const overlap = other ? cidrOverlaps(other.cidr, net.cidr) : false;
  const crossLoc = other ? other.locationId !== net.locationId : false;
  const peer = useApiMutation(() => api.action('networks', net.id, 'peer', { networkId: otherId, kind: crossLoc ? 'vpn' : kind, routes }), {
    success: () => `${crossLoc || kind === 'vpn' ? 'VPN' : 'Peering'} with ${other?.name} is being established`, onSuccess: onClose,
  });
  return (
    <Modal open={open} onClose={onClose} title="Peer with network" description="Private connectivity between two VPCs in this account."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={ArrowLeftRight} loading={peer.isPending} disabled={!other || overlap} onClick={() => peer.mutate()}>Connect</Button></>}>
      {candidates.length === 0 ? <p className="text-sm text-muted">No other networks available to peer with.</p> : (
        <div className="space-y-4">
          <Field label="Network">
            <Select value={otherId} onChange={(e) => setOtherId(e.target.value)} options={candidates.map((c) => ({ value: c.id, label: `${c.name} · ${c.cidr} · ${c.locationId}${cidrOverlaps(c.cidr, net.cidr) ? ' (overlaps)' : ''}` }))} />
          </Field>
          {other && (
            <div className={cn('flex items-center gap-3 rounded-xl border p-3 text-sm', overlap ? 'border-rose-500/30 bg-rose-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
              <span className="font-mono text-xs text-fg-2">{net.cidr}</span>
              {overlap ? <AlertTriangle className="size-4 text-rose-500" /> : <ArrowLeftRight className="size-4 text-emerald-500" />}
              <span className="font-mono text-xs text-fg-2">{other.cidr}</span>
              <span className={cn('ml-auto text-xs', overlap ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400')}>{overlap ? 'Ranges overlap — cannot peer' : 'No overlap'}</span>
            </div>
          )}
          {crossLoc ? <Hint>{net.locationId} ↔ {other?.locationId}: different locations are connected with an encrypted WireGuard site-to-site VPN.</Hint> : (
            <Field label="Link type"><Segmented value={kind} onChange={setKind} options={[{ value: 'peering', label: 'Fabric peering', icon: <ArrowLeftRight className="size-3.5" /> }, { value: 'vpn', label: 'Encrypted VPN', icon: <Waypoints className="size-3.5" /> }]} /></Field>
          )}
          <Switch checked={routes} onChange={setRoutes} label="Add routes on both sides" description="Recommended. Otherwise add routes manually." />
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ settings */

function NetworkSettings({ net, onDelete, attachedCount }: { net: Network; onDelete: () => void; attachedCount: number }) {
  const pro = usePro();
  const { items: zones } = useList<DnsZone>('dnsZones');
  const [name, setName] = useState(net.name);
  const [description, setDescription] = useState(net.description ?? '');
  const [tags, setTags] = useState(net.tags);
  const [nat, setNat] = useState(net.natGateway);
  const [mtu, setMtu] = useState(String(net.mtu));
  const [dnsZoneId, setDnsZoneId] = useState(net.dnsZoneId ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setName(net.name); setDescription(net.description ?? ''); setTags(net.tags); setNat(net.natGateway); setMtu(String(net.mtu)); setDnsZoneId(net.dnsZoneId ?? '') }, [net.id, net.name, net.natGateway, net.dnsZoneId]); // eslint-disable-line
  const zoneOpts = zones.filter((z) => z.projectId === net.projectId && (z.kind === 'public' || !z.networkId || z.networkId === net.id));
  const patch = useMemo(() => {
    const p: Record<string, unknown> = {};
    if (name !== net.name) p.name = name;
    if (description !== (net.description ?? '')) p.description = description;
    if (JSON.stringify(tags) !== JSON.stringify(net.tags)) p.tags = tags;
    if (nat !== net.natGateway) p.natGateway = nat;
    if (Number(mtu) !== net.mtu) p.mtu = Number(mtu);
    if (dnsZoneId !== (net.dnsZoneId ?? '')) p.dnsZoneId = dnsZoneId || null;
    return p;
  }, [name, description, tags, nat, mtu, dnsZoneId, net]);
  const save = useApiMutation(() => api.update('networks', net.id, patch), { success: 'Network updated', onSuccess: () => setErrors({}), onError: (e: ApiClientError) => setErrors(fieldErrors(e)) });
  const dirty = Object.keys(patch).length > 0;
  return (
    <div className="grid gap-5 @min-[56rem]:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader title="General" actions={<Button variant="primary" size="sm" icon={Save} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>} />
        <CardBody className="space-y-4">
          <Field label="Name" error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} /></Field>
          <Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Switch checked={nat} onChange={setNat} label="NAT gateway" description={pro ? 'Egress for private subnets. Disabling removes the system 0.0.0.0/0 → NAT route.' : 'Lets private subnets reach the internet.'} />
          {(() => {
            const adv = (
              <>
                <Field label="MTU" error={errors.mtu} hint="Changing MTU requires guests to renew DHCP."><Select value={mtu} onChange={(e) => setMtu(e.target.value)} options={[{ value: '1450', label: '1450 (standard, VXLAN)' }, { value: '1500', label: '1500' }, { value: '9000', label: '9000 (jumbo)' }]} /></Field>
                <Field label="DNS zone" error={errors.dnsZoneId} hint="Private zones bind to this VPC and are resolvable from its resolver.">
                  <Select value={dnsZoneId} onChange={(e) => setDnsZoneId(e.target.value)} placeholder="None" options={zoneOpts.map((z) => ({ value: z.id, label: `${z.name} (${z.kind})` }))} />
                </Field>
                <Field label="Tags" error={errors.tags}><TagEditor value={tags} onChange={setTags} /></Field>
              </>
            );
            return pro ? adv : <Advanced className="shadow-none" description="MTU, DNS zone, tags">{adv}</Advanced>;
          })()}
        </CardBody>
      </Card>
      <Card className="border-rose-500/30">
        <CardHeader title="Danger zone" />
        <CardBody className="space-y-3">
          <p className="text-[13px] text-muted">{attachedCount ? `${attachedCount} resource(s) are still attached. Move or delete them before deleting the network.` : 'No resources are attached. Deleting tears down routing, DHCP, NAT and peerings.'}</p>
          <Button variant="outline-danger" icon={Trash2} onClick={onDelete}>Delete network</Button>
        </CardBody>
      </Card>
    </div>
  );
}
