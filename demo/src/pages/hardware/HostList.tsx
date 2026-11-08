import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Cpu, Plus, MoreHorizontal, Server, MemoryStick, Gpu, Zap, Building2, Rows3, List, Grid3x3, HeartPulse, Download, Wrench, ArrowUpCircle, Activity } from 'lucide-react';
import { useList, useLookup } from '@/api/hooks';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { StatusPill, Badge, Tags } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Segmented, useTabParam } from '@/components/ui/Tabs';
import { Stat } from '@/components/ui/Stat';
import { Card, CardHeader } from '@/components/ui/Card';
import { Meter, EmptyState, Skeleton, Mono } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { OperationInline } from '@/components/resource/OperationRunner';
import { Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import { RackElevation } from '@/components/hardware/RackElevation';
import { CapacityHeatmap } from '@/components/hardware/CapacityHeatmap';
import { useHostActions } from '@/components/hardware/hostActions';
import { HOST_STATUS_HEX, hostStatusLabel, hostUtil, gpuTotal, flag, Led, utilColor } from '@/components/hardware/visuals';
import { num } from '@/lib/format';
import type { BareMetalHost, Location, Operation } from '@/types';

type StatusFilter = 'all' | 'ready' | 'attention' | 'busy';
const ENERGY_EUR_KWH = 0.24;
const PUE = 1.35;

export default function HostList() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { items: hosts, isLoading } = useList<BareMetalHost>('hosts', undefined, { refetchInterval: 20_000 });
  const { map: locations } = useLookup<Location>('locations');
  const { items: ops } = useList<Operation>('operations', { status: 'running' });
  const pro = usePro();
  const [viewParam, setView] = useTabParam('racks', 'view');
  const view = pro ? viewParam : 'table';
  const [loc, setLoc] = useState<string>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const actions = useHostActions();

  const opsByHost = useMemo(() => new Map(ops.filter((o) => o.target.type === 'bareMetal').map((o) => [o.target.id, o])), [ops]);
  const locIds = [...new Set(hosts.map((h) => h.locationId))].sort();
  const inLoc = hosts.filter((h) => !pro || loc === 'all' || h.locationId === loc);
  const isAttention = (h: BareMetalHost) => ['maintenance', 'offline', 'error', 'draining'].includes(h.status) || h.lastHealthCheck?.result === 'warnings' || h.lastHealthCheck?.result === 'failed';
  const isBusy = (h: BareMetalHost) => opsByHost.has(h.id) || ['provisioning', 'rebooting', 'updating', 'decommissioning'].includes(h.status);
  const rows = inLoc.filter((h) => status === 'all' || (status === 'ready' ? h.status === 'ready' : status === 'attention' ? isAttention(h) : isBusy(h)));

  // fleet stats
  const stats = useMemo(() => {
    const kvm = inLoc.filter((h) => h.hypervisor === 'KVM');
    const sum = (f: (h: BareMetalHost) => number, list = inLoc) => list.reduce((a, h) => a + f(h), 0);
    const capV = sum((h) => hostUtil(h).cap.vcpus, kvm), useV = sum((h) => hostUtil(h).a.vcpus, kvm);
    const capR = sum((h) => hostUtil(h).cap.ramGB, kvm), useR = sum((h) => hostUtil(h).a.ramGB, kvm);
    const gpus = sum(gpuTotal), gpuUsed = sum((h) => h.allocated?.gpus ?? 0);
    const watts = sum((h) => (h.status === 'offline' ? 0 : h.powerWatts));
    return {
      ready: inLoc.filter((h) => h.status === 'ready').length, total: inLoc.length,
      maint: inLoc.filter((h) => h.status === 'maintenance').length, offline: inLoc.filter((h) => h.status === 'offline' || h.status === 'error').length,
      cores: sum((h) => h.cpuCores), threads: sum((h) => h.threads), ramTB: sum((h) => h.ramGB) / 1024,
      gpus, gpuUsed, cpuPct: capV ? useV / capV : 0, ramPct: capR ? useR / capR : 0, useV, capV,
      kw: watts / 1000, energy: (watts / 1000) * 730 * PUE * ENERGY_EUR_KWH,
      outdated: inLoc.filter((h) => h.agentUpdateAvailable).length,
    };
  }, [inLoc]);

  const counts = { all: inLoc.length, ready: inLoc.filter((h) => h.status === 'ready').length, attention: inLoc.filter(isAttention).length, busy: inLoc.filter(isBusy).length };

  const columns: Column<BareMetalHost>[] = [
    {
      id: 'name', header: 'Host', sort: (h) => h.name,
      cell: (h) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="relative flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2">
            <Server className="size-4 text-muted" />
            <Led color={HOST_STATUS_HEX[h.status]} className="absolute -right-0.5 -top-0.5 ring-2 ring-surface" />
          </div>
          <div className="min-w-0">
            <Link to={`/hardware/bare-metals/${h.id}`} className="block truncate font-mono text-[13px] font-medium text-fg hover:text-brand-500">{h.name}</Link>
            <div className="truncate text-[11px] text-muted">{h.vendor} {h.model} · {h.rack} U{h.rackUnit}</div>
          </div>
        </div>
      ),
    },
    {
      id: 'status', header: 'Status', sort: (h) => h.status,
      cell: (h) => {
        const op = opsByHost.get(h.id);
        return (
          <div className="w-36">
            <div className="flex items-center gap-1.5">
              <StatusPill status={h.status} label={hostStatusLabel[h.status]?.toLowerCase()} />
              {h.lastHealthCheck && h.lastHealthCheck.result !== 'passed' && !op && <HeartPulse className={h.lastHealthCheck.result === 'failed' ? 'size-3.5 text-rose-500' : 'size-3.5 text-amber-500'} aria-label={`Health ${h.lastHealthCheck.result}`} />}
            </div>
            {op && <OperationInline op={op} className="mt-1.5" />}
          </div>
        );
      },
    },
    {
      id: 'location', header: 'Location', hideBelow: 'lg', sort: (h) => h.locationId,
      cell: (h) => { const l = locations.get(h.locationId); return <span className="flex items-center gap-1.5 text-fg-2"><span>{flag(l?.country)}</span>{l?.name ?? h.locationId}</span> },
    },
    {
      id: 'specs', header: 'Hardware', hideBelow: 'md', sort: (h) => h.threads,
      cell: (h) => (
        <div className="leading-tight">
          <div className="text-fg-2">{h.cpuCores ? `${h.cpuCores} cores · ${h.ramGB} GB` : <span className="text-muted">discovering…</span>}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="truncate">{h.cpuModel}</span>
            {gpuTotal(h) > 0 && <Badge tone="violet" className="h-[18px] px-1.5 text-[10px]">{h.gpus.map((g) => `${g.count}× ${g.model}`).join(', ')}</Badge>}
          </div>
        </div>
      ),
    },
    {
      id: 'alloc', header: 'Allocation', sort: (h) => hostUtil(h).ram,
      cell: (h) => {
        if (h.hypervisor !== 'KVM') return <span className="text-xs text-muted">storage node</span>;
        const u = hostUtil(h);
        return (
          <div className="w-36 space-y-1">
            <div className="flex items-center gap-2"><span className="w-8 text-[10px] text-muted">vCPU</span><Meter value={u.a.vcpus} max={u.cap.vcpus || 1} size="sm" /><span className="w-8 text-right text-[10px] tabular text-fg-2">{Math.round(u.cpu * 100)}%</span></div>
            <div className="flex items-center gap-2"><span className="w-8 text-[10px] text-muted">RAM</span><Meter value={u.a.ramGB} max={u.cap.ramGB || 1} size="sm" /><span className="w-8 text-right text-[10px] tabular text-fg-2">{Math.round(u.ram * 100)}%</span></div>
          </div>
        );
      },
    },
    { id: 'vms', header: 'VMs', align: 'right', sort: (h) => h.allocated?.vms ?? 0, cell: (h) => <span className="tabular text-fg">{h.allocated?.vms ?? 0}</span> },
    { id: 'power', header: 'Power', align: 'right', hideBelow: 'lg', sort: (h) => h.powerWatts, cell: (h) => <span className="tabular text-fg-2">{h.status === 'offline' ? '—' : `${h.powerWatts} W`}</span> },
    {
      id: 'agent', header: 'Agent', hideBelow: 'xl', sort: (h) => h.agentVersion,
      cell: (h) => <span className="flex items-center gap-1.5"><Mono>{h.agentVersion}</Mono>{h.agentUpdateAvailable && <ArrowUpCircle className="size-3.5 text-brand-500" aria-label="Update available" />}</span>,
    },
    { id: 'tags', header: 'Tags', hideBelow: 'xl', cell: (h) => <Tags tags={h.tags} max={2} /> },
  ];

  // Simple mode: hostname + spec line, location, status, CPU/RAM, VMs, one utilisation bar.
  const simpleColumns: Column<BareMetalHost>[] = [
    {
      id: 'name', header: 'Host', sort: (h) => h.name,
      cell: (h) => (
        <div className="min-w-0">
          <Link to={`/hardware/bare-metals/${h.id}`} className="block truncate font-mono text-[13px] font-medium text-fg hover:text-brand-500">{h.name}</Link>
          <div className="truncate text-[11.5px] text-muted">{h.vendor} {h.model}{gpuTotal(h) > 0 ? ` · ${gpuTotal(h)}× GPU` : ''}</div>
        </div>
      ),
    },
    {
      id: 'location', header: 'Location', hideBelow: 'md', sort: (h) => h.locationId,
      cell: (h) => { const l = locations.get(h.locationId); return <span className="flex items-center gap-1.5 whitespace-nowrap text-fg-2"><span>{flag(l?.country)}</span>{l?.city ?? l?.name ?? h.locationId}</span> },
    },
    {
      id: 'status', header: 'Status', sort: (h) => h.status,
      cell: (h) => { const op = opsByHost.get(h.id); return <div className="w-32"><StatusPill status={h.status} label={hostStatusLabel[h.status]?.toLowerCase()} />{op && <OperationInline op={op} className="mt-1.5" />}</div> },
    },
    {
      id: 'specs', header: 'CPU / RAM', hideBelow: 'sm', sort: (h) => h.threads,
      cell: (h) => <span className="whitespace-nowrap tabular text-fg-2">{h.cpuCores ? `${h.cpuCores} cores · ${h.ramGB >= 1024 ? `${(h.ramGB / 1024).toFixed(1)} TB` : `${h.ramGB} GB`}` : <span className="text-muted">discovering…</span>}</span>,
    },
    { id: 'vms', header: 'VMs', align: 'right', sort: (h) => h.allocated?.vms ?? 0, cell: (h) => <span className="tabular text-fg">{h.allocated?.vms ?? 0}</span> },
    {
      id: 'util', header: 'Used', hideBelow: 'md', sort: (h) => Math.max(hostUtil(h).cpu, hostUtil(h).ram),
      cell: (h) => {
        if (h.hypervisor !== 'KVM') return <span className="text-xs text-muted">storage</span>;
        const u = hostUtil(h); const r = Math.max(u.cpu, u.ram);
        return (
          <div className="flex w-28 items-center gap-2" title={`vCPU ${Math.round(u.cpu * 100)}% · RAM ${Math.round(u.ram * 100)}%`}>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full" style={{ width: `${Math.min(100, r * 100)}%`, background: utilColor(Math.max(r, 0.5)) }} /></div>
            <span className="w-8 text-right text-[11px] tabular text-fg-2">{Math.round(r * 100)}%</span>
          </div>
        );
      },
    },
  ];

  const bulk = async (list: BareMetalHost[], action: 'runHealthCheck' | 'updateAgent') => {
    const eligible = list.filter((h) => (action === 'updateAgent' ? h.agentUpdateAvailable && ['ready', 'maintenance', 'draining'].includes(h.status) : ['ready', 'maintenance', 'draining', 'error'].includes(h.status)) && !opsByHost.has(h.id));
    if (!eligible.length) { toast.info('None of the selected hosts are eligible'); return }
    await Promise.allSettled(eligible.map((h) => actions.act(h, action, action === 'updateAgent' ? `Updating agent on ${h.name}` : `Health check on ${h.name}`)));
  };

  const viewToggle = (
    <Segmented size="sm" value={view} onChange={setView} options={[
      { value: 'racks', label: 'Racks', icon: <Rows3 className="size-3.5" /> },
      { value: 'table', label: 'Table', icon: <List className="size-3.5" /> },
      { value: 'capacity', label: 'Capacity', icon: <Grid3x3 className="size-3.5" /> },
    ]} />
  );
  const statusChips = (
    <FilterChips value={status} onChange={setStatus} options={[
      { value: 'all', label: 'All', count: counts.all }, { value: 'ready', label: 'Ready', count: counts.ready },
      ...(counts.attention ? [{ value: 'attention' as const, label: 'Needs attention', count: counts.attention }] : []),
      ...(counts.busy ? [{ value: 'busy' as const, label: 'In progress', count: counts.busy }] : []),
    ]} />
  );

  return (
    <Page wide>
      <PageHeader
        title="Bare Metal Hosts"
        description={pro ? 'Your physical fleet. Enroll servers via their BMC — Autark installs the hypervisor, joins them to the cluster and schedules VMs onto them.' : 'Your own servers, turned into cloud capacity.'}
        icon={Cpu}
        iconColor="#475569"
        actions={<Button variant="primary" icon={Plus} to="/hardware/bare-metals/new">Enroll host</Button>}
      />

      <Pro>
      <div className="mb-5 grid grid-cols-2 gap-3 @min-[40rem]:grid-cols-3 @min-[60rem]:grid-cols-5">
        <Stat label="Hosts ready" value={`${stats.ready} / ${stats.total}`} icon={Server} sub={stats.maint || stats.offline ? <span className="text-amber-600 dark:text-amber-400">{stats.maint} maintenance · {stats.offline} offline</span> : 'all in service'} />
        <Stat label="Physical compute" value={`${num(stats.cores)} cores`} icon={Cpu} sub={`${num(stats.threads)} threads · ${stats.ramTB.toFixed(1)} TB RAM`} />
        <Stat label="GPUs" value={num(stats.gpus)} icon={Gpu} sub={`${stats.gpuUsed} allocated to VMs`} accent="#8b5cf6" />
        <Stat label="Allocated" value={`${Math.round(stats.cpuPct * 100)}% vCPU`} icon={Activity} sub={`${Math.round(stats.ramPct * 100)}% RAM · ${num(stats.useV)}/${num(stats.capV)} vCPU`} />
        <Stat label="Power draw" value={`${stats.kw.toFixed(1)} kW`} icon={Zap} sub={`≈ €${num(Math.round(stats.energy))}/mo energy (PUE ${PUE})`} accent="#f59e0b" className="col-span-2 @min-[40rem]:col-span-1" />
      </div>

      </Pro>

      {pro && stats.outdated > 0 && view !== 'table' && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand-500/20 bg-brand-500/5 px-4 py-2.5 text-[13px] text-fg-2">
          <ArrowUpCircle className="size-4 text-brand-500" />
          <span><b className="font-semibold text-fg">{stats.outdated} host{stats.outdated > 1 ? 's' : ''}</b> run an outdated agent. Updates restart only the agent — VMs keep running.</span>
          <Button size="xs" variant="secondary" icon={Download} className="ml-auto" onClick={() => bulk(inLoc.filter((h) => h.agentUpdateAvailable), 'updateAgent')}>Update all</Button>
        </div>
      )}

      {view !== 'table' && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <FilterChips value={loc} onChange={setLoc} options={[{ value: 'all', label: 'All locations', count: hosts.length }, ...locIds.map((id) => ({ value: id, label: `${flag(locations.get(id)?.country)} ${locations.get(id)?.name ?? id}`, count: hosts.filter((h) => h.locationId === id).length }))]} />
            {view === 'racks' && statusChips}
          </div>
          {viewToggle}
        </div>
      )}

      {isLoading ? <Skeleton className="h-96 rounded-xl" /> : hosts.length === 0 ? (
        <Card><EmptyState icon={Cpu} title="No hosts enrolled yet" description="Point Autark at a server's BMC (iDRAC, iLO, IPMI) and it turns the machine into cloud capacity in minutes." action={<Button variant="primary" icon={Plus} to="/hardware/bare-metals/new">Enroll your first host</Button>} /></Card>
      ) : view === 'racks' ? (
        <div className="space-y-5">
          {locIds.filter((id) => loc === 'all' || id === loc).map((locId) => {
            const l = locations.get(locId);
            const list = rows.filter((h) => h.locationId === locId);
            const all = hosts.filter((h) => h.locationId === locId);
            const racks = [...new Set(all.map((h) => h.rack))].sort();
            const kw = all.reduce((a, h) => a + (h.status === 'offline' ? 0 : h.powerWatts), 0) / 1000;
            return (
              <Card key={locId}>
                <CardHeader
                  icon={Building2}
                  title={<span className="flex items-center gap-2">{l?.name ?? locId}<span className="text-xs font-normal text-muted">{flag(l?.country)} {l?.city}</span></span>}
                  description={`${all.length} hosts · ${racks.length} rack${racks.length > 1 ? 's' : ''} · ${kw.toFixed(1)} kW`}
                  actions={<Button size="xs" variant="ghost" icon={Plus} to={`/hardware/bare-metals/new?location=${locId}`}>Enroll here</Button>}
                />
                <div className="overflow-x-auto p-4">
                  <div className="flex gap-6">
                    {racks.map((r) => (
                      <RackElevation key={r} name={r} className="w-[240px]" hosts={list.filter((h) => h.rack === r)} opsByHost={opsByHost} onSelect={(h) => navigate(`/hardware/bare-metals/${h.id}`)}
                        subtitle={`${all.filter((h) => h.rack === r).length} hosts`} />
                    ))}
                    <RackLegend />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : view === 'capacity' ? (
        <div className="grid gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <CardHeader title="Capacity heatmap" description="Allocation per host against schedulable capacity (after overcommit and hypervisor reserve)." icon={Grid3x3} />
            <div className="p-3"><CapacityHeatmap hosts={inLoc} locations={locations} /></div>
          </Card>
          <div className="space-y-4">
            {locIds.filter((id) => loc === 'all' || id === loc).map((id) => <LocationCapacity key={id} location={locations.get(id)} hosts={hosts.filter((h) => h.locationId === id)} />)}
          </div>
        </div>
      ) : (
        <DataTable
          rows={rows}
          columns={pro ? columns : simpleColumns}
          initialSearch={sp.get('q') ?? ''}
          searchText={(h) => `${h.name} ${h.id} ${h.vendor} ${h.model} ${h.cpuModel} ${h.mgmtIp} ${h.bmcIp} ${h.rack} ${h.locationId} ${h.status} ${h.gpus.map((g) => g.model).join(' ')} ${h.tags.map((t) => `${t.key}:${t.value}`).join(' ')}`}
          searchPlaceholder={pro ? 'Search hostname, IP, model, GPU…' : 'Search hosts…'}
          rowLink={(h) => `/hardware/bare-metals/${h.id}`}
          rowActions={(h) => <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />} items={actions.items(h)} />}
          defaultSort={{ id: 'name', dir: 'asc' }}
          rowClassName={(h) => (h.status === 'offline' || h.status === 'error' ? 'bg-rose-500/[0.03]' : undefined)}
          toolbar={pro ? <>
            <FilterChips value={loc} onChange={setLoc} options={[{ value: 'all', label: 'All', count: hosts.length }, ...locIds.map((id) => ({ value: id, label: id.toUpperCase(), count: hosts.filter((h) => h.locationId === id).length }))]} />
            {statusChips}
            {viewToggle}
          </> : statusChips}
          bulkActions={!pro ? undefined : [
            { label: 'Run health check', icon: HeartPulse, onClick: (r) => bulk(r, 'runHealthCheck') },
            { label: 'Update agent', icon: Download, onClick: (r) => bulk(r, 'updateAgent') },
            { label: 'Maintenance', icon: Wrench, onClick: (r) => { if (r.length === 1) actions.openMaintenance(r[0]); else toast.info('Enter maintenance one host at a time', 'Evacuations are planned per host so capacity is never double-booked.') } },
          ]}
          empty={{ icon: Cpu, title: 'No hosts match', description: 'Adjust the filters or enroll a new host.' }}
        />
      )}
      {actions.modal}
    </Page>
  );
}

function RackLegend() {
  const items: [string, string][] = [['ready', 'Ready'], ['maintenance', 'Maintenance'], ['draining', 'Cordoned'], ['provisioning', 'In progress'], ['offline', 'Offline / error']];
  return (
    <div className="hidden w-44 shrink-0 self-end pb-2 text-[11px] text-muted @min-[40rem]:block">
      <div className="mb-2 font-medium uppercase tracking-wide text-faint">Legend</div>
      <ul className="space-y-1.5">
        {items.map(([s, l]) => <li key={s} className="flex items-center gap-2"><span className="h-2.5 w-4 rounded-sm" style={{ background: HOST_STATUS_HEX[s] }} />{l}</li>)}
        <li className="flex items-center gap-2"><span className="rounded-[2px] bg-violet-500/80 px-1 font-mono text-[8px] font-semibold text-white">GPU</span>GPU host</li>
        <li className="flex items-center gap-2"><span className="h-1 w-4 rounded-full bg-indigo-400" />CPU / RAM allocated</li>
      </ul>
      <p className="mt-3 leading-snug">Hover a server for details, click to open it.</p>
    </div>
  );
}

function LocationCapacity({ location, hosts }: { location?: Location; hosts: BareMetalHost[] }) {
  const kvm = hosts.filter((h) => h.hypervisor === 'KVM');
  const ready = kvm.filter((h) => h.status === 'ready');
  const agg = (list: BareMetalHost[]) => list.reduce((a, h) => { const u = hostUtil(h); return { cv: a.cv + u.cap.vcpus, uv: a.uv + u.a.vcpus, cr: a.cr + u.cap.ramGB, ur: a.ur + u.a.ramGB, cg: a.cg + u.cap.gpus, ug: a.ug + u.a.gpus } }, { cv: 0, uv: 0, cr: 0, ur: 0, cg: 0, ug: 0 });
  const all = agg(kvm);
  const sched = agg(ready);
  const rows: [string, number, number, string][] = [['vCPU', all.uv, all.cv, ''], ['RAM', all.ur, all.cr, ' GB'], ...(all.cg ? [['GPU', all.ug, all.cg, ''] as [string, number, number, string]] : [])];
  // N+1: can we lose the biggest ready host?
  const biggest = ready.reduce((m, h) => Math.max(m, hostUtil(h).cap.ramGB), 0);
  const headroom = sched.cr - sched.ur;
  const nPlusOne = headroom - biggest >= 0;
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-fg">{flag(location?.country)} {location?.name ?? '—'}</div>
        <Badge tone={nPlusOne ? 'success' : 'warning'} title="Can the location absorb the loss of its largest ready host?">{nPlusOne ? 'N+1 ok' : 'no N+1'}</Badge>
      </div>
      <div className="space-y-3">
        {rows.map(([label, used, cap, unit]) => (
          <div key={label}>
            <div className="mb-1 flex justify-between text-xs"><span className="text-muted">{label}</span><span className="tabular text-fg-2">{num(used)} / {num(cap)}{unit}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (used / Math.max(1, cap)) * 100)}%`, background: utilColor(used / Math.max(1, cap)) }} /></div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-snug text-muted">
        {ready.length} of {kvm.length} hypervisors schedulable · {num(headroom)} GB free RAM on ready hosts{nPlusOne ? '' : ` — losing the largest host (${biggest} GB) would not fit`}.
      </p>
      <div className="mt-2 flex items-center gap-1 text-[11px] text-muted"><MemoryStick className="size-3" />Overcommit: CPU {kvm[0]?.cpuOvercommit ?? 4}× · RAM {kvm[0]?.ramOvercommit ?? 1}×</div>
    </Card>
  );
}
