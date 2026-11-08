import { useMemo, useState } from 'react';
import { Server, Plus, Play, Square, RotateCw, Trash2, MoreHorizontal, LayoutGrid, List, Camera, TerminalSquare, Cpu, Gpu, SlidersHorizontal, Building2, Cloud, Lock } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { useList, useLookup, useApiMutation } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { StatusPill, Badge } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Segmented } from '@/components/ui/Tabs';
import { Stat } from '@/components/ui/Stat';
import { Mono, EmptyState } from '@/components/ui/misc';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { OperationInline } from '@/components/resource/OperationRunner';
import { OsBadge } from '@/lib/images';
import { money, num, timeAgo, dateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { archLabel, flagEmoji } from '@/components/compute/vm/util';
import { usePro } from '@/store/ui';
import type { VM, Image, IpAddress, Location, Operation, Project, BareMetalHost, VmPreset } from '@/types';

type StatusFilter = 'all' | 'running' | 'stopped' | 'transitional' | 'error';
const TRANSITIONAL: VM['status'][] = ['provisioning', 'starting', 'stopping', 'rebooting', 'migrating', 'resizing', 'restoring', 'deleting'];

export default function VmList() {
  const [sp] = useSearchParams();
  const { items: vms, isLoading } = useList<VM>('vms');
  const { map: images } = useLookup<Image>('images');
  const { map: ips } = useLookup<IpAddress>('ips');
  const { map: locations } = useLookup<Location>('locations');
  const { map: projects } = useLookup<Project>('projects');
  const { map: hosts } = useLookup<BareMetalHost>('hosts');
  const { map: presets } = useLookup<VmPreset>('vmPresets');
  const { items: ops } = useList<Operation>('operations', { status: 'running' });
  const [status, setStatus] = useState<StatusFilter>('all');
  const [viewState, setView] = useState<'table' | 'grid'>('table');
  const pro = usePro();
  const view = pro ? viewState : 'table';

  const opByTarget = useMemo(() => new Map(ops.map((o) => [o.target.id, o])), [ops]);
  const counts = useMemo(() => ({
    all: vms.length,
    running: vms.filter((v) => v.status === 'running').length,
    stopped: vms.filter((v) => v.status === 'stopped').length,
    transitional: vms.filter((v) => TRANSITIONAL.includes(v.status)).length,
    error: vms.filter((v) => v.status === 'error').length,
  }), [vms]);
  const rows = vms.filter((v) => status === 'all' || (status === 'transitional' ? TRANSITIONAL.includes(v.status) : v.status === status));

  const action = useApiMutation(({ id, a }: { id: string; a: string }) => api.action('vms', id, a), { silent: true, onError: (e) => toast.error('Action failed', e.message) });

  const bulk = async (list: VM[], a: 'start' | 'stop' | 'reboot') => {
    const eligible = list.filter((v) => (a === 'start' ? ['stopped', 'error'].includes(v.status) : v.status === 'running'));
    if (!eligible.length) { toast.info(`No selected VMs can ${a}`); return }
    await Promise.allSettled(eligible.map((v) => action.mutateAsync({ id: v.id, a })));
    toast.success(`${a[0].toUpperCase() + a.slice(1)} requested for ${eligible.length} VM${eligible.length > 1 ? 's' : ''}`);
  };

  const remove = async (list: VM[]) => {
    const res = await confirm({
      title: `Delete ${list.length === 1 ? list[0].name : `${list.length} VMs`}?`,
      message: 'The VM will be shut down and its resources released. This cannot be undone.',
      confirmLabel: 'Delete', danger: true,
      typeToConfirm: list.length === 1 ? list[0].name : undefined,
      options: [
        { id: 'deleteVolumes', label: 'Also delete attached volumes', description: 'Otherwise they are detached and kept.' },
        { id: 'releaseIps', label: 'Release public IPs', description: 'Otherwise they stay allocated to the project.' },
      ],
    });
    if (!res) return;
    const results = await Promise.allSettled(list.map((v) => api.remove('vms', v.id, { deleteVolumes: String(!!res.deleteVolumes), releaseIps: String(!!res.releaseIps) })));
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) toast.error(`${failed.length} deletion(s) failed`, failed[0].reason?.message);
    else toast.success(`Deleting ${list.length} VM${list.length > 1 ? 's' : ''}`);
  };

  const running = vms.filter((v) => v.status === 'running');
  const totalCost = vms.reduce((a, v) => a + (v.monthlyCost ?? 0), 0);
  const vcpus = running.reduce((a, v) => a + v.size.vcpus, 0);
  const ram = running.reduce((a, v) => a + v.size.ramGB, 0);
  const gpus = running.reduce((a, v) => a + (v.gpu?.count ?? 0), 0);

  const specLine = (v: VM) => [presets.get(v.size.presetId ?? '')?.name ?? 'custom', archLabel(images.get(v.imageId)), `${v.size.systemDiskGB} GB`, v.locationId].join(' | ');

  const columns: Column<VM>[] = [
    {
      id: 'name', header: 'Name', sort: (v) => v.name,
      cell: (v) => {
        const p = projects.get(v.projectId);
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <OsBadge os={images.get(v.imageId)?.os ?? 'custom'} size={26} />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <Link to={`/infrastructure/vms/${v.id}`} className="truncate font-medium text-fg hover:text-brand-500" title={v.id}>{v.name}</Link>
                {v.deletionProtection && <span title="Deletion protection is on" className="shrink-0 text-faint"><Lock className="size-3" aria-label="Deletion protection" /></span>}
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted" title={`${v.size.vcpus} vCPU · ${v.size.ramGB} GB RAM${v.gpu ? ` · ${v.gpu.count}× ${v.gpu.model}` : ''}${p ? ` · ${p.name}` : ''}`}>
                {p && <span className="size-1.5 shrink-0 rounded-full" style={{ background: p.color }} />}
                <span className="truncate tabular">{specLine(v)}</span>
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'status', header: 'Status', sort: (v) => v.status,
      cell: (v) => {
        const op = opByTarget.get(v.id);
        return op ? <div className="w-36"><StatusPill status={v.status} /><OperationInline op={op} className="mt-1.5" /></div> : <StatusPill status={v.status} />;
      },
    },
    {
      id: 'size', header: 'Size', hideBelow: 'xl', sort: (v) => v.size.vcpus * 1000 + v.size.ramGB,
      cell: (v) => (
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="tabular text-fg">{v.size.vcpus} vCPU · {v.size.ramGB} GB</span>
          {v.gpu && <Badge tone="violet">{v.gpu.count}× {v.gpu.model}</Badge>}
        </div>
      ),
    },
    ...(pro ? [] : [{
      id: 'publicIp', header: 'Public IP', hideBelow: 'md',
      cell: (v) => {
        const pub = v.ipIds.map((id) => ips.get(id)).filter((ip): ip is IpAddress => !!ip).sort((a, b) => a.version - b.version);
        return pub.length ? <Mono copy className="text-fg">{pub[0].address}</Mono> : <span className="text-faint">—</span>;
      },
    } satisfies Column<VM>]),
    {
      id: 'location', header: 'Location', hideBelow: 'md', sort: (v) => locations.get(v.locationId)?.city ?? v.locationId,
      cell: (v) => {
        const l = locations.get(v.locationId);
        return (
          <div className="min-w-0 leading-tight" title={l?.name}>
            <div className="flex items-center gap-1.5 whitespace-nowrap text-fg-2">
              <span className="text-[15px] leading-none">{flagEmoji(l?.country)}</span>
              <span className="truncate">{l?.city ?? v.locationId}</span>
            </div>
            {pro && <div className="flex items-center gap-1 whitespace-nowrap text-[11px] text-faint">
              {l?.kind === 'cloud' ? <Cloud className="size-3 text-sky-500" /> : <Building2 className="size-3 text-emerald-500" />}
              <span className="truncate">{v.hostId ? hosts.get(v.hostId)?.name ?? v.hostId : l?.kind === 'cloud' ? l.region ?? 'cloud' : '—'}</span>
            </div>}
          </div>
        );
      },
    },
    {
      id: 'ip', header: 'IP addresses', hideBelow: 'lg',
      cell: (v) => (
        <div className="leading-tight">
          {v.ipIds.map((id) => ips.get(id)).filter(Boolean).map((ip) => <Mono key={ip!.id} copy className="block text-fg">{ip!.address}</Mono>)}
          <Mono className="block text-muted">{v.privateIp}</Mono>
        </div>
      ),
    },
    { id: 'created', header: 'Created', hideBelow: pro ? 'xl' : 'lg', sort: (v) => Date.parse(v.createdAt) || 0, cell: (v) => <span className="whitespace-nowrap text-fg-2" title={dateTime(v.createdAt)}>{timeAgo(v.createdAt)}</span> },
    { id: 'cost', header: 'Monthly', align: 'right', sort: (v) => v.monthlyCost ?? 0, cell: (v) => <span className="tabular text-fg">{money(v.monthlyCost)}</span> },
  ];
  const visibleColumns = pro ? columns : columns.filter((c) => !['size', 'ip', 'cost'].includes(c.id));

  const rowMenu = (v: VM) => (
    <Menu
      trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />}
      items={[
        { label: 'Start', icon: Play, disabled: !['stopped', 'error'].includes(v.status), onClick: () => action.mutate({ id: v.id, a: 'start' }) },
        { label: 'Stop', icon: Square, disabled: v.status !== 'running', onClick: () => action.mutate({ id: v.id, a: 'stop' }) },
        { label: 'Reboot', icon: RotateCw, disabled: v.status !== 'running', onClick: () => action.mutate({ id: v.id, a: 'reboot' }) },
        { divider: true, label: '' },
        { label: 'Open console', icon: TerminalSquare, to: `/infrastructure/vms/${v.id}?tab=console` },
        { label: 'Take snapshot', icon: Camera, onClick: () => api.action('vms', v.id, 'snapshot', {}).then(() => toast.success('Snapshot started')).catch((e) => toast.error('Snapshot failed', e.message)) },
        { divider: true, label: '' },
        { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove([v]) },
      ]}
    />
  );

  return (
    <Page wide>
      <PageHeader
        title="Virtual Machines"
        description={pro ? 'KVM virtual machines on your own hardware, with optional burst capacity from connected cloud providers.' : undefined}
        icon={Server}
        iconColor="#5b67f8"
        actions={<>
          {pro && <Button icon={SlidersHorizontal} to="/infrastructure/vms/presets">Size presets</Button>}
          <Button variant="primary" icon={Plus} to="/infrastructure/vms/new">Create VM</Button>
        </>}
      />

      {pro && <div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Running" value={`${counts.running} / ${counts.all}`} icon={Server} sub={counts.error ? <span className="text-rose-500">{counts.error} in error</span> : 'all healthy'} />
        <Stat label="Allocated vCPU" value={num(vcpus)} icon={Cpu} sub={`${num(ram)} GB RAM`} />
        <Stat label="GPUs in use" value={num(gpus)} icon={Gpu} sub="across running VMs" />
        <Stat label="Monthly run-rate" value={money(totalCost)} sub="compute, disks & IPs" accent="#5b67f8" />
      </div>}

      {view === 'table' ? (
        <DataTable
          rows={rows}
          loading={isLoading}
          columns={visibleColumns}
          initialSearch={sp.get('q') ?? ''}
          searchText={(v) => `${v.name} ${v.id} ${v.privateIp} ${v.ipIds.map((i) => ips.get(i)?.address).join(' ')} ${v.tags.map((t) => `${t.key}:${t.value} ${t.value}`).join(' ')} ${images.get(v.imageId)?.name} ${v.locationId} ${locations.get(v.locationId)?.city ?? ''} ${presets.get(v.size.presetId ?? '')?.name ?? ''}`}
          searchPlaceholder="Search name, IP, tag (env:prod)…"
          rowLink={(v) => `/infrastructure/vms/${v.id}`}
          rowActions={rowMenu}
          defaultSort={{ id: 'name', dir: 'asc' }}
          toolbar={<>
            <FilterChips value={status} onChange={setStatus} options={[
              { value: 'all', label: 'All', count: counts.all }, { value: 'running', label: 'Running', count: counts.running }, { value: 'stopped', label: 'Stopped', count: counts.stopped },
              ...(pro && counts.transitional ? [{ value: 'transitional' as const, label: 'In progress', count: counts.transitional }] : []),
              ...(counts.error ? [{ value: 'error' as const, label: 'Error', count: counts.error }] : []),
            ]} />
            {pro && <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'table', label: '', icon: <List className="size-3.5" /> }, { value: 'grid', label: '', icon: <LayoutGrid className="size-3.5" /> }]} />}
          </>}
          bulkActions={[
            { label: 'Start', icon: Play, onClick: (r) => bulk(r, 'start') },
            { label: 'Stop', icon: Square, onClick: (r) => bulk(r, 'stop') },
            { label: 'Reboot', icon: RotateCw, onClick: (r) => bulk(r, 'reboot') },
            { label: 'Delete', icon: Trash2, danger: true, onClick: remove },
          ]}
          empty={{ icon: Server, title: 'No virtual machines yet', description: 'Create your first server in under a minute.', action: <Button variant="primary" icon={Plus} to="/infrastructure/vms/new">Create VM</Button> }}
        />
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <FilterChips value={status} onChange={setStatus} options={[{ value: 'all', label: 'All', count: counts.all }, { value: 'running', label: 'Running', count: counts.running }, { value: 'stopped', label: 'Stopped', count: counts.stopped }]} />
            <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'table', label: '', icon: <List className="size-3.5" /> }, { value: 'grid', label: '', icon: <LayoutGrid className="size-3.5" /> }]} />
          </div>
          {rows.length === 0 ? <EmptyState icon={Server} title="No VMs match" /> : (
            <div className="grid grid-cols-1 gap-3 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
              {rows.map((v) => {
                const img = images.get(v.imageId);
                const op = opByTarget.get(v.id);
                const pub = v.ipIds.map((i) => ips.get(i)?.address).filter(Boolean)[0];
                return (
                  <Link key={v.id} to={`/infrastructure/vms/${v.id}`} className={cn('group relative overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop', v.status === 'error' && 'border-rose-500/40')}>
                    <div className={cn('absolute inset-x-0 top-0 h-0.5', v.status === 'running' ? 'bg-emerald-500' : v.status === 'error' ? 'bg-rose-500' : TRANSITIONAL.includes(v.status) ? 'animate-pulse-soft bg-brand-500' : 'bg-line-strong')} />
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <OsBadge os={img?.os ?? 'custom'} size={32} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5"><span className="truncate font-medium text-fg group-hover:text-brand-500">{v.name}</span>{v.deletionProtection && <span title="Deletion protection is on" className="shrink-0 text-faint"><Lock className="size-3" /></span>}</div>
                          <div className="truncate text-[11px] text-muted" title={img?.name}>{flagEmoji(locations.get(v.locationId)?.country)} {specLine(v)}</div>
                        </div>
                      </div>
                      <StatusPill status={v.status} />
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      {[[v.size.vcpus, 'vCPU'], [v.size.ramGB, 'GB RAM'], [v.size.systemDiskGB, 'GB disk']].map(([n, l]) => (
                        <div key={l as string} className="rounded-lg bg-surface-2 py-1.5"><div className="text-sm font-semibold tabular text-fg">{n}</div><div className="text-[10px] text-muted">{l}</div></div>
                      ))}
                    </div>
                    {op ? <OperationInline op={op} className="mt-3" /> : (
                      <div className="mt-3 flex items-center justify-between text-xs text-muted">
                        <span className="font-mono">{pub ?? v.privateIp}</span>
                        <span className="tabular text-fg-2">{money(v.monthlyCost)}/mo</span>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </Page>
  );
}
