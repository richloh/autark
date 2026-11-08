import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Globe2, Plus, Link2, Unlink, Trash2, MoreHorizontal, AtSign, Layers, CircleDollarSign, AlertTriangle, Building2, Cloud } from 'lucide-react';
import { useList, useLookup, useGet, useApiMutation } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Stat } from '@/components/ui/Stat';
import { Mono, Meter, EmptyState, Skeleton } from '@/components/ui/misc';
import { Modal, confirm } from '@/components/ui/Modal';
import { Field, Input, Select, Hint } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { fieldErrors } from '@/components/ui/FormLayout';
import { ProjectField } from '@/components/resource/pickers';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { toast } from '@/components/ui/toast';
import { money, num, timeAgo, pct } from '@/lib/format';
import { ipToInt } from '@/lib/cidr';
import { PRICING } from '@/lib/pricing';
import { cn } from '@/lib/cn';
import { IpCellGrid, CellLegend } from '@/components/network/IpCellGrid';
import { Advanced, Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import { useDefaultProject } from '@/components/network/useDefaultProject';
import type { IpAddress, IpPool, IpPoolMap, IpCell, VM, LoadBalancer, K8sCluster, Project, Location } from '@/types';

type Filter = 'all' | 'assigned' | 'idle' | 'v6';

export default function Ips() {
  const [sp] = useSearchParams();
  const pro = usePro();
  const { items: ips, isLoading } = useList<IpAddress>('ips');
  const { items: pools } = useList<IpPool>('ipPools');
  const { map: vms, items: vmList } = useLookup<VM>('vms');
  const { map: lbs, items: lbList } = useLookup<LoadBalancer>('loadBalancers');
  const { map: clusters } = useLookup<K8sCluster>('k8sClusters');
  const { map: projects } = useLookup<Project>('projects');
  const { map: locations } = useLookup<Location>('locations');
  const [poolId, setPoolId] = useState<string>('');
  const [selectedCell, setSelectedCell] = useState<IpCell | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [allocate, setAllocate] = useState<{ poolId?: string; address?: string } | null>(null);
  const [assignFor, setAssignFor] = useState<IpAddress | null>(null);
  const [rdnsFor, setRdnsFor] = useState<IpAddress | null>(null);

  useEffect(() => { if (!poolId && pools.length) setPoolId(pools.find((p) => p.version === 4)?.id ?? pools[0].id) }, [pools.length]); // eslint-disable-line
  const pool = pools.find((p) => p.id === poolId);
  const { data: map, isLoading: mapLoading } = useGet<IpPoolMap>(['ips', 'poolmap', poolId], poolId ? `/ipPools/${poolId}/map` : null);
  const ipById = useMemo(() => new Map(ips.map((i) => [i.id, i])), [ips]);

  const action = useApiMutation(({ id, a, body }: { id: string; a: string; body?: unknown }) => api.action('ips', id, a, body), { silent: true, onError: (e) => toast.error('Action failed', e.message) });
  const release = async (list: IpAddress[]) => {
    const assigned = list.filter((i) => i.assignedTo);
    if (assigned.length) { toast.error(`${assigned.map((i) => i.address).join(', ')} ${assigned.length > 1 ? 'are' : 'is'} assigned`, 'Unassign before releasing.'); return }
    const ok = await confirm({ title: `Release ${list.length === 1 ? list[0].address : `${list.length} IPs`}?`, message: 'The address returns to the pool and may be handed to someone else. DNS records pointing to it will break.', confirmLabel: 'Release', danger: true });
    if (!ok) return;
    const res = await Promise.allSettled(list.map((i) => api.remove('ips', i.id)));
    const failed = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) toast.error('Release failed', failed[0].reason?.message); else toast.success(`Released ${list.length} IP${list.length > 1 ? 's' : ''}`);
    setSelectedCell(null);
  };
  const unassign = (ip: IpAddress) => action.mutate({ id: ip.id, a: 'unassign' }, { onSuccess: () => toast.success(`${ip.address} unassigned`) });

  const ownerName = (ip: IpAddress) => {
    const a = ip.assignedTo;
    if (!a) return undefined;
    if (a.type === 'k8s') return clusters.get(a.id)?.name;
    return a.type === 'vm' ? vms.get(a.id)?.name : lbs.get(a.id)?.name;
  };
  /** Kubernetes node IPs: link the cluster and name the node ("p6 · node 2"). */
  const owner = (ip: IpAddress) => !ip.assignedTo ? null : (
    <span className="inline-flex min-w-0 items-center gap-1">
      <ResourceLink type={ip.assignedTo.type} id={ip.assignedTo.id} name={ownerName(ip)} />
      {ip.assignedTo.type === 'k8s' && ip.name && <span className="truncate text-[11px] text-muted">· {ip.name.replace(/^.*?-?node-?/, 'node ')}</span>}
    </span>
  );
  const idle = ips.filter((i) => !i.assignedTo);
  const counts = { all: ips.length, assigned: ips.length - idle.length, idle: idle.length, v6: ips.filter((i) => i.version === 6).length };
  const rows = ips.filter((i) => filter === 'all' || (filter === 'assigned' ? i.assignedTo : filter === 'idle' ? !i.assignedTo : i.version === 6));
  const poolOf = (i: IpAddress) => pools.find((x) => x.id === i.poolId);

  const simpleColumns: Column<IpAddress>[] = [
    {
      id: 'address', header: 'Address', sort: (i) => (i.version === 4 ? ipToInt(i.address) : 1e10 + i.address.length),
      cell: (i) => (
        <div className="min-w-0">
          <Mono copy className="font-medium text-fg">{i.address}</Mono>
          <div className="truncate text-[11px] text-muted">IPv{i.version}{i.name ? ` · ${i.name}` : ''}</div>
        </div>
      ),
    },
    {
      id: 'assigned', header: 'Assigned to', sort: (i) => ownerName(i) ?? 'zzz',
      cell: (i) => i.assignedTo ? owner(i)
        : <button type="button" className="text-xs font-medium text-brand-500 hover:underline" onClick={(e) => { e.stopPropagation(); setAssignFor(i) }}>Assign…</button>,
    },
    { id: 'location', header: 'Location', hideBelow: 'md', sort: (i) => poolOf(i)?.locationId ?? '', cell: (i) => { const l = locations.get(poolOf(i)?.locationId ?? ''); return <span className="flex items-center gap-1.5 text-fg-2">{l?.kind === 'cloud' ? <Cloud className="size-3.5 text-sky-500" /> : <Building2 className="size-3.5 text-emerald-500" />}{l?.name ?? poolOf(i)?.locationId ?? '—'}</span> } },
    { id: 'created', header: 'Allocated', hideBelow: 'lg', sort: (i) => i.createdAt, cell: (i) => <span className="text-muted">{timeAgo(i.createdAt)}</span> },
  ];

  const columns: Column<IpAddress>[] = [
    {
      id: 'address', header: 'Address', sort: (i) => (i.version === 4 ? ipToInt(i.address) : 1e10 + i.address.length),
      cell: (i) => (
        <div className="min-w-0">
          <Mono copy className="font-medium text-fg">{i.address}</Mono>
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            {projects.get(i.projectId) && <span className="size-1.5 rounded-full" style={{ background: projects.get(i.projectId)!.color }} />}
            {i.name ?? i.id}
          </div>
        </div>
      ),
    },
    { id: 'version', header: 'Type', hideBelow: 'md', sort: (i) => i.version, cell: (i) => <Badge tone={i.version === 6 ? 'violet' : 'info'}>IPv{i.version}</Badge> },
    {
      id: 'assigned', header: 'Assigned to', sort: (i) => ownerName(i) ?? 'zzz',
      cell: (i) => i.assignedTo ? owner(i) : <Badge tone="warning">idle · {money(PRICING.ip.v4PerMonth * (i.version === 4 ? 1 : 0))}/mo</Badge>,
    },
    { id: 'rdns', header: 'Reverse DNS', hideBelow: 'lg', cell: (i) => i.reverseDns ? <Mono className="text-fg-2">{i.reverseDns}</Mono> : <button type="button" className="text-xs text-faint hover:text-brand-500" onClick={(e) => { e.stopPropagation(); setRdnsFor(i) }}>set PTR…</button> },
    { id: 'pool', header: 'Pool', hideBelow: 'xl', sort: (i) => i.poolId, cell: (i) => { const p = pools.find((x) => x.id === i.poolId); return <span className="text-fg-2">{p?.name ?? i.poolId}</span> } },
    { id: 'created', header: 'Allocated', hideBelow: 'xl', sort: (i) => i.createdAt, cell: (i) => <span className="text-muted">{timeAgo(i.createdAt)}</span> },
    { id: 'cost', header: 'Monthly', align: 'right', sort: (i) => i.monthlyCost ?? 0, cell: (i) => <span className="tabular text-fg">{money(i.monthlyCost, { decimals: true })}</span> },
  ];

  const rowMenu = (i: IpAddress) => (
    <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />} items={[
      { label: i.assignedTo ? 'Re-assign…' : 'Assign…', icon: Link2, onClick: () => setAssignFor(i) },
      { label: 'Unassign', icon: Unlink, disabled: !i.assignedTo, onClick: () => unassign(i) },
      { label: 'Reverse DNS…', icon: AtSign, onClick: () => setRdnsFor(i) },
      { divider: true, label: '' },
      { label: 'Release', icon: Trash2, danger: true, disabled: !!i.assignedTo, hint: i.assignedTo ? 'unassign first' : undefined, onClick: () => release([i]) },
    ]} />
  );

  const selIp = selectedCell?.ipId ? ipById.get(selectedCell.ipId) : undefined;

  return (
    <Page wide>
      <PageHeader title="IP Addresses" description={pro ? 'Public IPv4/IPv6 addresses from your own provider-independent ranges and cloud pools. Assign them to VMs and load balancers.' : 'Public addresses you can assign to servers and load balancers.'} icon={Globe2} iconColor="#14b8a6"
        actions={<Button variant="primary" icon={Plus} onClick={() => setAllocate({ poolId })}>Allocate IP</Button>} />

      <Pro>
      <div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Allocated" value={num(ips.length)} icon={Globe2} sub={`${counts.v6} IPv6`} />
        <Stat label="Assigned" value={num(counts.assigned)} icon={Link2} sub={`${ips.length ? Math.round((counts.assigned / ips.length) * 100) : 0}% in use`} />
        <Stat label="Idle" value={num(counts.idle)} icon={AlertTriangle} sub={counts.idle ? <span className="text-amber-600 dark:text-amber-400">{money(idle.reduce((a, i) => a + (i.monthlyCost ?? 0), 0), { decimals: true })}/mo unused</span> : 'nothing wasted'} />
        <Stat label="Monthly" value={money(ips.reduce((a, i) => a + (i.monthlyCost ?? 0), 0), { decimals: true })} icon={CircleDollarSign} sub={`€${PRICING.ip.v4PerMonth}/IPv4 · IPv6 free`} accent="#14b8a6" />
      </div>

      {/* pools */}
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {pools.map((p) => {
          const loc = locations.get(p.locationId);
          return (
            <button key={p.id} type="button" onClick={() => { setPoolId(p.id); setSelectedCell(null) }}
              className={cn('min-w-56 shrink-0 rounded-xl border bg-surface p-3 text-left shadow-card transition-all', poolId === p.id ? 'border-brand-500 ring-3 ring-brand-500/15' : 'border-line hover:border-line-strong')}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 truncate text-[13px] font-medium text-fg">{loc?.kind === 'cloud' ? <Cloud className="size-3.5 text-sky-500" /> : <Building2 className="size-3.5 text-emerald-500" />}{p.name}</span>
                <Badge tone={p.version === 6 ? 'violet' : 'info'}>v{p.version}</Badge>
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-muted">{p.cidr}</div>
              <Meter className="mt-2" size="sm" value={p.allocated ?? 0} max={p.version === 6 ? Math.max(64, (p.allocated ?? 0) * 4) : p.total ?? 1} />
              <div className="mt-1 text-[11px] tabular text-muted">{p.version === 6 ? `${p.allocated} allocated` : `${p.allocated} / ${p.total} · ${pct(p.utilization ?? 0)}`}</div>
            </button>
          );
        })}
      </div>

      <div className="mb-5 grid gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title={pool ? `${pool.name} · address map` : 'Address map'} icon={Layers}
            description={pool?.version === 6 ? 'IPv6 pools are vast — only allocated addresses are listed.' : 'One cell per address. Hover for details, click a free cell to allocate exactly that address.'} />
          <CardBody>
            {mapLoading || !map ? <Skeleton className="h-64" /> : pool?.version === 6 ? (
              map.cells.length === 0 ? <EmptyState title="No addresses allocated" /> : (
                <ul className="grid gap-1.5 @min-[36rem]:grid-cols-2">
                  {map.cells.map((c) => (
                    <li key={c.address}>
                      <button type="button" onClick={() => setSelectedCell(c)} disabled={c.state === 'foreign'} className={cn('flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs', selectedCell?.address === c.address ? 'border-brand-500' : 'border-line')}>
                        <span className="font-mono text-fg">{c.address}</span><span className="text-muted">{c.owner?.name ?? c.state}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <>
                <IpCellGrid cells={map.cells} projects={projects} selected={selectedCell?.address} onSelect={(c) => { setSelectedCell(c); if (c.state === 'free') setAllocate({ poolId, address: c.address }) }} />
                <CellLegend className="mt-3" />
                {map.truncated && <p className="mt-2 text-[11px] text-faint">Showing the first 256 addresses of this pool.</p>}
              </>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Selection" />
          <CardBody>
            {!selectedCell ? <p className="py-6 text-center text-[13px] text-muted">Click an address in the map to inspect it.</p> : (
              <div className="space-y-3">
                <div><div className="font-mono text-lg font-semibold text-fg">{selectedCell.address}</div><StatusPill status={selectedCell.state === 'assigned' ? 'in-use' : selectedCell.state === 'allocated' ? 'pending' : selectedCell.state === 'free' ? 'available' : 'disabled'} label={selectedCell.state} /></div>
                {selIp ? (
                  <>
                    <dl className="space-y-1.5 text-[13px]">
                      <div className="flex justify-between gap-2"><dt className="text-muted">Assigned to</dt><dd>{selIp.assignedTo ? owner(selIp) : <span className="text-amber-600">idle</span>}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-muted">Project</dt><dd className="text-fg-2">{projects.get(selIp.projectId)?.name}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-muted">PTR</dt><dd className="truncate font-mono text-xs text-fg-2">{selIp.reverseDns ?? '—'}</dd></div>
                    </dl>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" icon={Link2} onClick={() => setAssignFor(selIp)}>{selIp.assignedTo ? 'Re-assign' : 'Assign'}</Button>
                      {selIp.assignedTo && <Button size="sm" icon={Unlink} onClick={() => unassign(selIp)}>Unassign</Button>}
                      <Button size="sm" icon={AtSign} onClick={() => setRdnsFor(selIp)}>PTR</Button>
                      <Button size="sm" variant="outline-danger" icon={Trash2} disabled={!!selIp.assignedTo} onClick={() => release([selIp])}>Release</Button>
                    </div>
                  </>
                ) : selectedCell.state === 'free' ? (
                  <Button variant="primary" icon={Plus} onClick={() => setAllocate({ poolId, address: selectedCell.address })}>Allocate this address</Button>
                ) : selectedCell.ipId ? (
                  <p className="text-xs text-muted">Belongs to {projects.get(selectedCell.projectId ?? '')?.name ?? 'another project'} — switch scope to manage it.</p>
                ) : <p className="text-xs text-muted">This address is not available to tenants.</p>}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
      </Pro>

      <DataTable
        rows={rows}
        loading={isLoading}
        columns={pro ? columns : simpleColumns}
        initialSearch={sp.get('q') ?? ''}
        searchText={(i) => `${i.address} ${i.name ?? ''} ${i.reverseDns ?? ''} ${ownerName(i) ?? 'idle'} ${i.poolId}`}
        searchPlaceholder="Search address, owner, PTR…"
        rowActions={rowMenu}
        onRowClick={pro ? (i) => { setPoolId(i.poolId); setSelectedCell({ address: i.address, state: i.assignedTo ? 'assigned' : 'allocated', ipId: i.id, projectId: i.projectId }) } : undefined}
        defaultSort={{ id: 'address', dir: 'asc' }}
        toolbar={<FilterChips value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All', count: counts.all }, { value: 'assigned', label: 'Assigned', count: counts.assigned }, { value: 'idle', label: pro ? 'Idle' : 'Not assigned', count: counts.idle }, ...(pro ? [{ value: 'v6' as const, label: 'IPv6', count: counts.v6 }] : [])]} />}
        bulkActions={[{ label: 'Release', icon: Trash2, danger: true, onClick: release }]}
        empty={{ icon: Globe2, title: 'No public IPs', description: 'Allocate an address to expose a VM or load balancer to the internet.', action: <Button variant="primary" icon={Plus} onClick={() => setAllocate({ poolId })}>Allocate IP</Button> }}
      />

      <AllocateModal state={allocate} onClose={() => setAllocate(null)} pools={pools} vms={vmList} lbs={lbList} />
      <AssignModal ip={assignFor} onClose={() => setAssignFor(null)} pools={pools} vms={vmList} lbs={lbList} />
      <RdnsModal ip={rdnsFor} onClose={() => setRdnsFor(null)} />
    </Page>
  );
}

function targetOptions(projectId: string, locationId: string | undefined, vms: VM[], lbs: LoadBalancer[]) {
  return [
    ...vms.filter((v) => v.projectId === projectId && (!locationId || v.locationId === locationId) && v.status !== 'deleting').map((v) => ({ value: `vm:${v.id}`, label: `VM · ${v.name} (${v.privateIp})${v.ipIds.length ? ` · has ${v.ipIds.length} IP` : ''}` })),
    ...lbs.filter((l) => l.projectId === projectId && (!locationId || l.locationId === locationId) && l.status !== 'deleting').map((l) => ({ value: `lb:${l.id}`, label: `LB · ${l.name}` })),
  ];
}

function AllocateModal({ state, onClose, pools, vms, lbs }: { state: { poolId?: string; address?: string } | null; onClose: () => void; pools: IpPool[]; vms: VM[]; lbs: LoadBalancer[] }) {
  const [projectId, setProjectId] = useState('');
  const [poolId, setPoolId] = useState('');
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [mode, setMode] = useState<'next' | 'specific'>('next');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const pro = usePro();
  const { map: locations } = useLookup<Location>('locations');
  useDefaultProject(projectId, setProjectId);
  useEffect(() => { if (state) { setPoolId(state.poolId || pools[0]?.id || ''); setAddress(state.address ?? ''); setMode(state.address ? 'specific' : 'next'); setName(''); setTarget(''); setErrors({}); setFormError(null) } }, [state]); // eslint-disable-line
  const pool = pools.find((p) => p.id === poolId);
  const opts = targetOptions(projectId, pool?.locationId, vms, lbs);
  const go = useApiMutation(() => api.create<IpAddress>('ips', {
    projectId, poolId, ...(mode === 'specific' && address ? { address } : {}), ...(name ? { name } : {}),
    ...(target ? { assignTo: { type: target.split(':')[0], id: target.split(':')[1] } } : {}),
  }), {
    success: (ip) => `Allocated ${ip.address}${target ? ' and assigned' : ''}`,
    onSuccess: onClose,
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); setFormError(e.message) },
  });
  return (
    <Modal open={!!state} onClose={onClose} title="Allocate public IP" description="Reserve an address for this project. It stays yours until released."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Plus} loading={go.isPending} disabled={!poolId || !projectId} onClick={() => go.mutate()}>Allocate</Button></>}>
      <div className="space-y-4">
        {formError && <Hint tone="danger">{formError}</Hint>}
        <Field label={pro ? 'Pool' : 'Location & type'} error={errors.poolId}>
          <Select value={poolId} onChange={(e) => setPoolId(e.target.value)} options={pools.map((p) => ({ value: p.id, label: pro
            ? `${p.name} · ${p.cidr} (${p.locationId})${p.version === 4 ? ` · ${(p.total ?? 0) - (p.allocated ?? 0)} free` : ''}`
            : `${locations.get(p.locationId)?.name ?? p.locationId} · IPv${p.version}${p.version === 4 ? ` · ${(p.total ?? 0) - (p.allocated ?? 0)} free` : ''}` }))} />
        </Field>
        <Field label="Assign to" optional error={errors.assignTo} hint={pro ? `Only resources in this project running in ${pool?.locationId ?? 'the pool location'} are listed.` : undefined}>
          <Select value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Keep unassigned" options={opts} />
        </Field>
        <p className="text-xs text-muted">{pool?.version === 6 ? 'IPv6 addresses are free.' : `€${PRICING.ip.v4PerMonth}/month while you keep it, assigned or not.`}</p>
        <Advanced description="Project, specific address, name">
          <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />
          <Field label="Address" error={errors.address}>
            <Segmented value={mode} onChange={setMode} options={[{ value: 'next', label: 'Next free' }, { value: 'specific', label: 'Specific address' }]} />
            {mode === 'specific' && <Input mono className="mt-2" value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder={pool?.version === 6 ? '2001:db8:abcd::100' : '203.0.113.50'} invalid={!!errors.address} />}
          </Field>
          <Field label="Name" optional error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="web-vip" /></Field>
        </Advanced>
      </div>
    </Modal>
  );
}

function AssignModal({ ip, onClose, pools, vms, lbs }: { ip: IpAddress | null; onClose: () => void; pools: IpPool[]; vms: VM[]; lbs: LoadBalancer[] }) {
  const [target, setTarget] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (ip) { setTarget(ip.assignedTo ? `${ip.assignedTo.type}:${ip.assignedTo.id}` : ''); setErrors({}) } }, [ip]);
  const pool = pools.find((p) => p.id === ip?.poolId);
  const opts = ip ? targetOptions(ip.projectId, pool?.locationId, vms, lbs) : [];
  const go = useApiMutation(() => api.action('ips', ip!.id, 'assign', { type: target.split(':')[0], id: target.split(':')[1] }), {
    success: `${ip?.address} assigned`, onSuccess: onClose, onError: (e: ApiClientError) => setErrors(fieldErrors(e)),
  });
  return (
    <Modal open={!!ip} onClose={onClose} title={`Assign ${ip?.address ?? ''}`} description={ip?.assignedTo ? 'Re-assigning moves the address; existing connections drop.' : 'Traffic to this address is NATed 1:1 to the resource.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Link2} loading={go.isPending} disabled={!target} onClick={() => go.mutate()}>Assign</Button></>}>
      <Field label="Resource" error={errors.target} hint={opts.length ? `Same project, location ${pool?.locationId}.` : 'No eligible VMs or load balancers in this project & location.'}>
        <Select value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Choose…" options={opts} />
      </Field>
    </Modal>
  );
}

function RdnsModal({ ip, onClose }: { ip: IpAddress | null; onClose: () => void }) {
  const [v, setV] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (ip) { setV(ip.reverseDns ?? ''); setErrors({}) } }, [ip]);
  const go = useApiMutation(() => api.action('ips', ip!.id, 'setReverseDns', { reverseDns: v }), { success: v ? 'Reverse DNS updated' : 'Reverse DNS cleared', onSuccess: onClose, onError: (e: ApiClientError) => setErrors(fieldErrors(e)) });
  const arpa = ip?.version === 4 ? `${ip.address.split('.').reverse().join('.')}.in-addr.arpa` : 'ip6.arpa';
  return (
    <Modal open={!!ip} onClose={onClose} title="Reverse DNS (PTR)" description="Mail servers and many services check that the PTR matches a forward A record."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={go.isPending} onClick={() => go.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Hostname" error={errors.reverseDns} hint="Leave empty to remove."><Input mono value={v} onChange={(e) => setV(e.target.value.trim().toLowerCase())} placeholder="mail.regiocom-energie.de" /></Field>
        <code className="block rounded-lg bg-surface-2 px-3 py-2 font-mono text-[12px] text-fg-2">{arpa}. IN PTR {v || '…'}{v && !v.endsWith('.') ? '.' : ''}</code>
      </div>
    </Modal>
  );
}
