import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { HardDrive, Plus, SlidersHorizontal, MoreHorizontal, Link2, Unlink, Maximize2, Camera, Copy, Trash2, Gauge, Lock, Database, Building2, Cloud } from 'lucide-react';
import { useList, useLookup } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { StatusPill, Tags, Badge } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Segmented } from '@/components/ui/Tabs';
import { Stat } from '@/components/ui/Stat';
import { Meter, StackBar } from '@/components/ui/misc';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { OperationInline } from '@/components/resource/OperationRunner';
import { useVolumeModals, detachVolumeAction, deleteVolumeAction } from '@/components/compute/volume/VolumeModals';
import { TYPE_TONE, TYPE_COLOR, VOLUME_TRANSITIONAL } from '@/components/compute/volume/volumeUi';
import { money, num, gb, timeAgo, dateTime } from '@/lib/format';
import { flagEmoji } from '@/components/compute/vm/util';
import { usePro } from '@/store/ui';
import { VOLUME_LIMITS, type Volume, type VM, type Location, type Project, type Operation, type Snapshot, type VolumeType } from '@/types';

type StatusFilter = 'all' | 'in-use' | 'available' | 'transitional' | 'error';
const TRANSITIONAL = VOLUME_TRANSITIONAL;

export default function VolumeList() {
  const [sp] = useSearchParams();
  const { items: volumes, isLoading } = useList<Volume>('volumes');
  const { map: vms } = useLookup<VM>('vms');
  const { map: locations } = useLookup<Location>('locations');
  const { map: projects } = useLookup<Project>('projects');
  const { items: snapshots } = useList<Snapshot>('snapshots', { kind: 'volume' });
  const { items: ops } = useList<Operation>('operations', { status: 'running' });
  const [status, setStatus] = useState<StatusFilter>('all');
  const [type, setType] = useState<'all' | VolumeType>('all');
  const modals = useVolumeModals();
  const pro = usePro();

  const opByTarget = useMemo(() => new Map(ops.map((o) => [o.target.id, o])), [ops]);
  const counts = useMemo(() => ({
    all: volumes.length,
    'in-use': volumes.filter((v) => v.status === 'in-use').length,
    available: volumes.filter((v) => v.status === 'available').length,
    transitional: volumes.filter((v) => TRANSITIONAL.includes(v.status)).length,
    error: volumes.filter((v) => v.status === 'error').length,
  }), [volumes]);
  const rows = volumes.filter((v) => (status === 'all' || (status === 'transitional' ? TRANSITIONAL.includes(v.status) : v.status === status)) && (!pro || type === 'all' || v.type === type));

  const totalGB = volumes.reduce((a, v) => a + v.sizeGB, 0);
  const usedGB = volumes.reduce((a, v) => a + v.usedGB, 0);
  const byType = (['ssd', 'nvme', 'hdd'] as VolumeType[]).map((t) => ({ t, gb: volumes.filter((v) => v.type === t).reduce((a, v) => a + v.sizeGB, 0) }));
  const cost = volumes.reduce((a, v) => a + (v.monthlyCost ?? 0), 0);
  const snapGB = snapshots.reduce((a, s) => a + s.sizeGB, 0);
  const unattached = volumes.filter((v) => v.status === 'available');
  const idleCost = unattached.reduce((a, v) => a + (v.monthlyCost ?? 0), 0);

  const bulkDelete = async (list: Volume[]) => {
    const attached = list.filter((v) => v.attachedTo);
    const eligible = list.filter((v) => !v.attachedTo);
    if (!eligible.length) { toast.error('Nothing deleted', 'All selected volumes are attached to VMs. Detach them first.'); return }
    const res = await confirm({
      title: `Delete ${eligible.length} volume${eligible.length > 1 ? 's' : ''}?`,
      message: <>{eligible.map((v) => v.name).join(', ')} will be destroyed.{attached.length > 0 && <span className="mt-1 block text-amber-600 dark:text-amber-400">Skipping {attached.length} attached volume(s): {attached.map((v) => v.name).join(', ')}</span>}</>,
      confirmLabel: 'Delete', danger: true,
      options: [{ id: 'deleteSnapshots', label: 'Also delete their snapshots' }],
    });
    if (!res) return;
    const results = await Promise.allSettled(eligible.map((v) => api.remove('volumes', v.id, { deleteSnapshots: String(!!res.deleteSnapshots) })));
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) toast.error(`${failed.length} deletion(s) failed`, failed[0].reason?.message);
    else toast.success(`Deleting ${eligible.length} volume${eligible.length > 1 ? 's' : ''}`);
  };

  const columns: Column<Volume>[] = [
    {
      id: 'name', header: 'Name', sort: (v) => v.name,
      cell: (v) => {
        const p = projects.get(v.projectId);
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg" style={{ background: `${TYPE_COLOR[v.type]}1a`, color: TYPE_COLOR[v.type] }}><HardDrive className="size-3.5" /></span>
            <div className="min-w-0">
              <Link to={`/infrastructure/volumes/${v.id}`} className="flex items-center gap-1 truncate font-medium text-fg hover:text-brand-500">{v.name}{v.encrypted && <Lock className="size-3 text-faint" aria-label="encrypted" />}</Link>
              <div className="flex items-center gap-1.5 text-[11px] text-muted">
                {p && <span className="size-1.5 rounded-full" style={{ background: p.color }} title={p.name} />}
                {pro ? <span className="font-mono">{v.id}</span> : <span className="truncate tabular">{[gb(v.sizeGB), VOLUME_LIMITS[v.type].label].join(' | ')}</span>}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'status', header: 'Status', sort: (v) => v.status,
      cell: (v) => { const op = opByTarget.get(v.id); return op ? <div className="w-36"><StatusPill status={v.status} /><OperationInline op={op} className="mt-1.5" /></div> : <StatusPill status={v.status} /> },
    },
    {
      id: 'size', header: pro ? 'Size & usage' : 'Usage', sort: (v) => v.sizeGB,
      cell: (v) => (
        <div className="w-36">
          <div className="flex items-center justify-between gap-2 text-xs">{pro ? <span className="flex items-center gap-1.5"><Badge tone={TYPE_TONE[v.type]} className="h-[18px] px-1.5 text-[10px]">{VOLUME_LIMITS[v.type].label}</Badge><span className="tabular text-fg">{gb(v.sizeGB)}</span></span> : <span className="tabular text-fg-2">{gb(v.usedGB)} used</span>}<span className="tabular text-muted">{Math.round((v.usedGB / v.sizeGB) * 100)}%</span></div>
          <Meter value={v.usedGB} max={v.sizeGB} size="xs" className="mt-1" />
        </div>
      ),
    },
    {
      id: 'perf', header: 'Performance', hideBelow: 'lg', sort: (v) => v.iops,
      cell: (v) => <div className="whitespace-nowrap text-xs leading-tight"><div className="tabular text-fg">{num(v.iops)} IOPS</div><div className="tabular text-muted">{v.throughputMBps} MB/s</div></div>,
    },
    {
      id: 'attached', header: 'Attached to', sort: (v) => (v.attachedTo ? vms.get(v.attachedTo.vmId)?.name ?? v.attachedTo.vmId : '~'),
      cell: (v) => v.attachedTo ? (
        <div className="min-w-0 leading-tight">
          <ResourceLink type="vm" id={v.attachedTo.vmId} name={vms.get(v.attachedTo.vmId)?.name} />
          <div className="font-mono text-[11px] text-muted">{v.attachedTo.device}</div>
        </div>
      ) : <span className="text-xs text-faint">—</span>,
    },
    {
      id: 'location', header: 'Location', hideBelow: pro ? 'xl' : 'md', sort: (v) => v.locationId,
      cell: (v) => {
        const l = locations.get(v.locationId);
        return pro
          ? <span className="flex items-center gap-1.5 text-fg-2">{l?.kind === 'cloud' ? <Cloud className="size-3.5 text-sky-500" /> : <Building2 className="size-3.5 text-emerald-500" />}<span className="truncate">{l?.name ?? v.locationId}</span></span>
          : <span className="flex items-center gap-1.5 whitespace-nowrap text-fg-2" title={l?.name}><span className="text-[15px] leading-none">{flagEmoji(l?.country)}</span><span className="truncate">{l?.city ?? v.locationId}</span></span>;
      },
    },
    { id: 'created', header: 'Created', hideBelow: 'lg', sort: (v) => Date.parse(v.createdAt) || 0, cell: (v) => <span className="whitespace-nowrap text-fg-2" title={dateTime(v.createdAt)}>{timeAgo(v.createdAt)}</span> },
    {
      id: 'snaps', header: 'Snapshots', hideBelow: 'xl', sort: (v) => v.snapshotCount ?? 0,
      cell: (v) => <span className="text-xs text-fg-2">{v.snapshotCount ? <>{v.snapshotCount} <span className="text-muted">· {timeAgo(v.lastSnapshotAt)}</span></> : <span className="text-faint">none</span>}</span>,
    },
    { id: 'tags', header: 'Tags', hideBelow: 'xl', cell: (v) => <Tags tags={v.tags} max={2} /> },
    { id: 'cost', header: 'Monthly', align: 'right', sort: (v) => v.monthlyCost ?? 0, cell: (v) => <span className="tabular text-fg">{money(v.monthlyCost)}</span> },
  ];
  const visibleColumns = pro ? columns.filter((c) => c.id !== 'created') : columns.filter((c) => !['perf', 'snaps', 'tags', 'cost'].includes(c.id));

  const busy = (v: Volume) => TRANSITIONAL.includes(v.status);
  const rowMenu = (v: Volume) => (
    <Menu
      trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />}
      items={[
        v.attachedTo
          ? { label: 'Detach', icon: Unlink, disabled: busy(v), onClick: () => detachVolumeAction(v, vms.get(v.attachedTo!.vmId)?.name) }
          : { label: 'Attach to VM…', icon: Link2, disabled: v.status !== 'available', onClick: () => modals.open('attach', v) },
        { label: 'Resize…', icon: Maximize2, disabled: busy(v) || v.status === 'error', onClick: () => modals.open('resize', v) },
        ...(pro ? [{ label: 'Change performance…', icon: Gauge, disabled: busy(v) || v.status === 'error', onClick: () => modals.open('performance', v) }] : []),
        { divider: true, label: '' },
        { label: 'Take snapshot…', icon: Camera, disabled: busy(v) || v.status === 'error', onClick: () => modals.open('snapshot', v) },
        { label: 'Clone…', icon: Copy, disabled: busy(v) || v.status === 'error', onClick: () => modals.open('clone', v) },
        { divider: true, label: '' },
        { label: 'Delete', icon: Trash2, danger: true, disabled: !!v.attachedTo || busy(v), hint: v.attachedTo ? 'attached' : undefined, onClick: () => deleteVolumeAction(v) },
      ]}
    />
  );

  return (
    <Page wide>
      <PageHeader
        title="Volumes"
        description={pro ? 'Replicated, encrypted block storage. Attach to any VM in the same location; grow online, snapshot, clone.' : undefined}
        icon={HardDrive}
        iconColor="#0ea5e9"
        actions={<>
          {pro && <Button icon={SlidersHorizontal} to="/infrastructure/volumes/presets">Presets</Button>}
          <Button variant="primary" icon={Plus} to="/infrastructure/volumes/new">Create volume</Button>
        </>}
      />

      {pro && <div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-[13px] font-medium text-muted">Provisioned capacity <Database className="size-4 text-faint" /></div>
          <div className="mt-2 text-2xl font-semibold tracking-tight tabular text-fg">{gb(totalGB)}</div>
          <StackBar className="mt-2" height="h-1.5" total={totalGB} segments={byType.map((b) => ({ value: b.gb, color: TYPE_COLOR[b.t], label: `${VOLUME_LIMITS[b.t].label} ${gb(b.gb)}` }))} />
          <div className="mt-1.5 flex flex-wrap gap-x-2.5 text-[11px] text-muted">{byType.filter((b) => b.gb).map((b) => <span key={b.t} className="flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: TYPE_COLOR[b.t] }} />{VOLUME_LIMITS[b.t].label} {gb(b.gb)}</span>)}</div>
        </div>
        <Stat label="Data stored" value={gb(usedGB)} icon={HardDrive} sub={totalGB ? `${Math.round((usedGB / totalGB) * 100)}% of provisioned` : '—'} />
        <Stat label="Attached" value={`${counts['in-use']} / ${counts.all}`} icon={Link2} sub={unattached.length ? <span className="text-amber-600 dark:text-amber-400">{unattached.length} idle · {money(idleCost)}/mo</span> : 'none idle'} />
        <Stat label="Monthly run-rate" value={money(cost)} accent="#0ea5e9" sub={`+ ${gb(Math.round(snapGB))} in ${snapshots.length} snapshots`} />
      </div>}

      <DataTable
        rows={rows}
        loading={isLoading}
        columns={visibleColumns}
        initialSearch={sp.get('q') ?? ''}
        searchText={(v) => `${v.name} ${v.id} ${v.type} ${v.status} ${v.attachedTo ? vms.get(v.attachedTo.vmId)?.name ?? '' : ''} ${v.locationId} ${v.tags.map((t) => `${t.key}:${t.value} ${t.value}`).join(' ')}`}
        searchPlaceholder="Search name, VM, tag…"
        rowLink={(v) => `/infrastructure/volumes/${v.id}`}
        rowActions={rowMenu}
        defaultSort={{ id: 'name', dir: 'asc' }}
        toolbar={<>
          <FilterChips value={status} onChange={setStatus} options={[
            { value: 'all', label: 'All', count: counts.all }, { value: 'in-use', label: 'In use', count: counts['in-use'] }, { value: 'available', label: 'Available', count: counts.available },
            ...(pro && counts.transitional ? [{ value: 'transitional' as const, label: 'In progress', count: counts.transitional }] : []),
            ...(counts.error ? [{ value: 'error' as const, label: 'Error', count: counts.error }] : []),
          ]} />
          {pro && <Segmented size="sm" value={type} onChange={setType} options={[{ value: 'all', label: 'All types' }, { value: 'ssd', label: 'SSD' }, { value: 'nvme', label: 'NVMe' }, { value: 'hdd', label: 'HDD' }]} />}
        </>}
        bulkActions={[{ label: 'Delete', icon: Trash2, danger: true, onClick: bulkDelete }]}
        empty={{ icon: HardDrive, title: 'No volumes yet', description: 'Create a block volume and attach it to a VM for databases, uploads or datasets.', action: <Button variant="primary" icon={Plus} to="/infrastructure/volumes/new">Create volume</Button> }}
      />
      {modals.element}
    </Page>
  );
}
