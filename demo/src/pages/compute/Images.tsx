import { useMemo, useState } from 'react';
import { Disc3, Plus, Rocket, Camera, HardDrive, Server, MoreHorizontal, Pencil, Archive, ArchiveRestore, Trash2, Layers, AlertTriangle, Cpu, Wallet } from 'lucide-react';
import { useList, useLookup, useApiMutation } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Pro } from '@/components/ui/Pro';
import { Button, IconButton } from '@/components/ui/Button';
import { Tabs, useTabParam, Segmented } from '@/components/ui/Tabs';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Stat } from '@/components/ui/Stat';
import { Mono, EmptyState } from '@/components/ui/misc';
import { Switch } from '@/components/ui/form';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { OperationInline } from '@/components/resource/OperationRunner';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { SnapshotTimeline, TRIGGER_STYLE } from '@/components/compute/SnapshotTimeline';
import { SnapshotMenu, deleteSnapshot } from '@/components/compute/SnapshotActions';
import { CreateImageModal, EditImageModal, DeprecateImageModal } from '@/components/compute/catalog/ImageModals';
import { OsBadge, OS_STYLE } from '@/lib/images';
import { money, gb, timeAgo, dateTime, plural } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Image, Snapshot, VM, Volume, Operation, Project } from '@/types';

export default function Images() {
  const [tab, setTab] = useTabParam('public');
  const { items: images, isLoading } = useList<Image>('images');
  const { items: snapshots, isLoading: snapsLoading } = useList<Snapshot>('snapshots');
  const [createOpen, setCreateOpen] = useState(false);

  const publicImgs = images.filter((i) => i.kind === 'public');
  const customImgs = images.filter((i) => i.kind === 'custom');
  const snapGB = snapshots.reduce((a, s) => a + s.sizeGB, 0);
  const snapCost = snapshots.reduce((a, s) => a + (s.monthlyCost ?? 0), 0);
  const customCost = customImgs.reduce((a, i) => a + (i.monthlyCost ?? 0), 0);

  return (
    <Page wide>
      <PageHeader
        title="Images & Snapshots"
        description="Operating system images to boot from, your own golden images, and point-in-time snapshots of VMs and volumes."
        icon={Disc3}
        iconColor="#8b5cf6"
        actions={<>
          <Button icon={Rocket} to="/infrastructure/vms/new">Launch VM</Button>
          <Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>Create image</Button>
        </>}
      />
      <Pro><div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Public images" value={publicImgs.filter((i) => i.status !== 'deprecated').length} icon={Disc3} sub={`${new Set(publicImgs.map((i) => i.os)).size} OS families`} />
        <Stat label="Custom images" value={customImgs.length} icon={Layers} sub={`${gb(Math.round(customImgs.reduce((a, i) => a + i.sizeGB, 0)))} replicated`} />
        <Stat label="Snapshots" value={snapshots.length} icon={Camera} sub={`${gb(Math.round(snapGB))} stored`} />
        <Stat label="Storage cost" value={money(snapCost + customCost)} icon={Wallet} sub="snapshots + images / mo" accent="#8b5cf6" />
      </div></Pro>

      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[
        { id: 'public', label: 'OS catalog', count: publicImgs.length, icon: <Disc3 className="size-3.5" /> },
        { id: 'custom', label: 'Custom images', count: customImgs.length, icon: <Layers className="size-3.5" /> },
        { id: 'snapshots', label: 'Snapshots', count: snapshots.length, icon: <Camera className="size-3.5" /> },
      ]} />

      {tab === 'public' && <PublicCatalog images={publicImgs} all={images} loading={isLoading} />}
      {tab === 'custom' && <CustomImages images={customImgs} all={images} loading={isLoading} onCreate={() => setCreateOpen(true)} />}
      {tab === 'snapshots' && <Snapshots snapshots={snapshots} loading={snapsLoading} />}

      <CreateImageModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </Page>
  );
}

/* ------------------------------------------------------------------ public OS catalog */

function PublicCatalog({ images, all, loading }: { images: Image[]; all: Image[]; loading: boolean }) {
  const [os, setOs] = useState('all');
  const [showDeprecated, setShowDeprecated] = useState(false);
  const families = [...new Set(images.map((i) => i.os))];
  const rows = images.filter((i) => (os === 'all' || i.os === os) && (showDeprecated || i.status !== 'deprecated'));
  const deprecatedCount = images.filter((i) => i.status === 'deprecated').length;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterChips value={os} onChange={setOs} options={[{ value: 'all', label: 'All', count: images.length }, ...families.map((f) => ({ value: f, label: OS_STYLE[f]?.label ?? f, count: images.filter((i) => i.os === f).length }))]} />
        {deprecatedCount > 0 && <Switch size="sm" checked={showDeprecated} onChange={setShowDeprecated} label={<span className="text-xs font-normal text-muted">Show deprecated ({deprecatedCount})</span>} />}
      </div>
      {loading && !images.length ? <div className="grid grid-cols-1 gap-3 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-4">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-44 rounded-xl" />)}</div> : rows.length === 0 ? <EmptyState icon={Disc3} title="No images match" /> : (
        <div className="grid grid-cols-1 gap-3 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
          {rows.map((img) => {
            const repl = img.replacementId ? all.find((i) => i.id === img.replacementId) : undefined;
            const color = OS_STYLE[img.os]?.color ?? '#8b5cf6';
            return (
              <div key={img.id} className={cn('group relative flex flex-col overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop', img.status === 'deprecated' && 'opacity-80')}>
                <div className="pointer-events-none absolute -right-10 -top-10 size-28 rounded-full opacity-[0.10] blur-2xl" style={{ background: color }} />
                <div className="flex items-start gap-3">
                  <OsBadge os={img.os} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-fg">{img.name}</div>
                    <div className="truncate text-xs text-muted">{img.description}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge>{img.version}</Badge>
                  <Badge tone="info"><Cpu className="size-3" />{img.arch}</Badge>
                  {img.status === 'deprecated' && <Badge tone="warning" title={img.deprecatedAt ? `Deprecated ${dateTime(img.deprecatedAt)}` : undefined}><AlertTriangle className="size-3" />Deprecated{img.eol ? ` · EOL ${img.eol}` : ''}</Badge>}
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[[gb(img.sizeGB), 'image'], [`${img.minDiskGB} GB`, 'min disk'], [String(img.usedBy ?? 0), 'VMs']].map(([v, l]) => (
                    <div key={l} className="rounded-lg bg-surface-2 py-1.5"><dd className="text-sm font-semibold tabular text-fg">{v}</dd><dt className="text-[10px] text-muted">{l}</dt></div>
                  ))}
                </dl>
                {repl && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Use <span className="font-medium">{repl.name}</span> instead.</p>}
                <div className="mt-auto pt-3">
                  <Button size="sm" variant={img.status === 'deprecated' ? 'ghost' : 'secondary'} className="w-full" icon={Rocket} to={`/infrastructure/vms/new?image=${img.id}`} disabled={img.status === 'deprecated'}>
                    {img.status === 'deprecated' ? 'Not available for new VMs' : 'Launch VM'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ custom images */

function CustomImages({ images, all, loading, onCreate }: { images: Image[]; all: Image[]; loading: boolean; onCreate: () => void }) {
  const { items: ops } = useList<Operation>('operations', { status: 'running' });
  const { map: snaps } = useLookup<Snapshot>('snapshots');
  const { map: vms } = useLookup<VM>('vms');
  const { map: projects } = useLookup<Project>('projects');
  const opByTarget = useMemo(() => new Map(ops.map((o) => [o.target.id, o])), [ops]);
  const [editing, setEditing] = useState<Image | null>(null);
  const [deprecating, setDeprecating] = useState<Image | null>(null);
  const undeprecate = useApiMutation((img: Image) => api.action('images', img.id, 'undeprecate'), { success: 'Image is available again' });

  const remove = async (list: Image[]) => {
    const ok = await confirm({
      title: list.length === 1 ? `Delete image ${list[0].name}?` : `Delete ${list.length} images?`,
      message: 'The image is removed from all locations. Existing VMs are not affected, but images still used by VMs cannot be deleted — deprecate them instead.',
      confirmLabel: 'Delete', danger: true, typeToConfirm: list.length === 1 ? list[0].name : undefined,
    });
    if (!ok) return;
    const res = await Promise.allSettled(list.map((i) => api.remove('images', i.id)));
    const failed = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) toast.error(failed.length === list.length ? 'Cannot delete' : `${failed.length} of ${list.length} could not be deleted`, failed[0].reason?.message);
    if (failed.length < list.length) toast.success(`Deleted ${plural(list.length - failed.length, 'image')}`);
  };

  const columns: Column<Image>[] = [
    {
      id: 'name', header: 'Image', sort: (i) => i.name,
      cell: (i) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <OsBadge os={i.os} size={28} />
          <div className="min-w-0">
            <div className="truncate font-medium text-fg">{i.name}</div>
            <div className="truncate text-[11px] text-muted">{i.description}</div>
          </div>
        </div>
      ),
    },
    {
      id: 'status', header: 'Status', sort: (i) => i.status,
      cell: (i) => { const op = opByTarget.get(i.id); return op ? <div className="w-40"><StatusPill status={i.status} /><OperationInline op={op} className="mt-1.5" /></div> : <StatusPill status={i.status} /> },
    },
    {
      id: 'source', header: 'Source', hideBelow: 'md',
      cell: (i) => {
        if (i.sourceSnapshotId) { const s = snaps.get(i.sourceSnapshotId); return <div className="leading-tight"><ResourceLink type="snapshot" id={i.sourceSnapshotId} name={s?.name ?? i.sourceSnapshotId} />{i.sourceVmId && <div className="mt-0.5"><ResourceLink type="vm" id={i.sourceVmId} name={vms.get(i.sourceVmId)?.name ?? i.sourceVmId} muted /></div>}</div> }
        if (i.sourceVmId) return <ResourceLink type="vm" id={i.sourceVmId} name={vms.get(i.sourceVmId)?.name ?? i.sourceVmId} />;
        return <span className="text-xs text-muted">Imported</span>;
      },
    },
    { id: 'size', header: 'Size', align: 'right', sort: (i) => i.sizeGB, cell: (i) => <span className="tabular text-fg-2">{gb(i.sizeGB)}</span> },
    { id: 'minDisk', header: 'Min disk', align: 'right', hideBelow: 'lg', sort: (i) => i.minDiskGB, cell: (i) => <span className="tabular text-fg-2">{i.minDiskGB} GB</span> },
    { id: 'arch', header: 'Arch', hideBelow: 'xl', cell: (i) => <span className="text-fg-2">{i.arch}</span> },
    { id: 'project', header: 'Project', hideBelow: 'xl', cell: (i) => { const p = i.projectId ? projects.get(i.projectId) : undefined; return p ? <span className="flex items-center gap-1.5 text-fg-2"><span className="size-1.5 rounded-full" style={{ background: p.color }} />{p.name}</span> : <span className="text-faint">—</span> } },
    { id: 'used', header: 'Used by', align: 'right', sort: (i) => i.usedBy ?? 0, cell: (i) => <span className={cn('tabular', i.usedBy ? 'text-fg' : 'text-faint')}>{plural(i.usedBy ?? 0, 'VM')}</span> },
    { id: 'age', header: 'Created', hideBelow: 'lg', sort: (i) => i.createdAt, cell: (i) => <span className="text-muted" title={dateTime(i.createdAt)}>{timeAgo(i.createdAt)}</span> },
    { id: 'cost', header: 'Monthly', align: 'right', sort: (i) => i.monthlyCost ?? 0, cell: (i) => <span className="tabular text-fg">{money(i.monthlyCost)}</span> },
  ];

  return (
    <>
      <DataTable
        rows={images}
        loading={loading}
        columns={columns}
        searchText={(i) => `${i.name} ${i.description} ${i.id} ${i.version} ${i.tags.map((t) => `${t.key}:${t.value}`).join(' ')}`}
        searchPlaceholder="Search custom images…"
        defaultSort={{ id: 'age', dir: 'desc' }}
        rowActions={(i) => (
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Image actions" size="sm" />} items={[
            { label: 'Launch VM from image', icon: Rocket, to: `/infrastructure/vms/new?image=${i.id}`, disabled: i.status !== 'available' },
            { label: 'Edit', icon: Pencil, disabled: i.status === 'creating', onClick: () => setEditing(i) },
            i.status === 'deprecated'
              ? { label: 'Mark available again', icon: ArchiveRestore, onClick: () => undeprecate.mutate(i) }
              : { label: 'Deprecate…', icon: Archive, disabled: i.status === 'creating', onClick: () => setDeprecating(i) },
            { divider: true, label: '' },
            { label: 'Delete', icon: Trash2, danger: true, disabled: i.status === 'creating', hint: i.usedBy ? `${i.usedBy} VMs` : undefined, onClick: () => remove([i]) },
          ]} />
        )}
        bulkActions={[{ label: 'Delete', icon: Trash2, danger: true, onClick: remove }]}
        empty={{ icon: Layers, title: 'No custom images yet', description: 'Capture a configured VM or snapshot as a golden image and launch identical VMs from it.', action: <Button variant="primary" icon={Plus} onClick={onCreate}>Create image</Button> }}
      />
      <EditImageModal image={editing} onClose={() => setEditing(null)} />
      <DeprecateImageModal image={deprecating} images={all} onClose={() => setDeprecating(null)} />
    </>
  );
}

/* ------------------------------------------------------------------ snapshots */

type KindFilter = 'all' | 'vm' | 'volume';

function Snapshots({ snapshots, loading }: { snapshots: Snapshot[]; loading: boolean }) {
  const { map: vms } = useLookup<VM>('vms');
  const { map: volumes } = useLookup<Volume>('volumes');
  const [kind, setKind] = useState<KindFilter>('all');
  const [trigger, setTrigger] = useState<'all' | Snapshot['trigger']>('all');
  const [selected, setSelected] = useState<string | null>(null);

  const sourceExists = (s: Snapshot) => (s.kind === 'vm' ? vms.has(s.sourceId) : volumes.has(s.sourceId));
  const rows = snapshots.filter((s) => (kind === 'all' || s.kind === kind) && (trigger === 'all' || s.trigger === trigger) && (!selected || s.id === selected));
  const timelineSnaps = snapshots.filter((s) => (kind === 'all' || s.kind === kind) && (trigger === 'all' || s.trigger === trigger));
  const orphaned = snapshots.filter((s) => !sourceExists(s));

  const bulkDelete = async (list: Snapshot[]) => {
    if (list.length === 1) { await deleteSnapshot(list[0]); return }
    const ok = await confirm({ title: `Delete ${list.length} snapshots?`, message: `${gb(Math.round(list.reduce((a, s) => a + s.sizeGB, 0)))} of snapshot storage will be freed. This cannot be undone.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const res = await Promise.allSettled(list.map((s) => api.remove('snapshots', s.id)));
    const failed = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) toast.error(`${failed.length} could not be deleted`, failed[0].reason?.message);
    else toast.success(`Deleting ${list.length} snapshots`);
  };

  const columns: Column<Snapshot>[] = [
    {
      id: 'name', header: 'Snapshot', sort: (s) => s.name,
      cell: (s) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5"><Camera className="size-3.5 shrink-0 text-muted" /><span className="truncate font-medium text-fg">{s.name}</span></div>
          {s.description && <div className="truncate text-[11px] text-muted">{s.description}</div>}
        </div>
      ),
    },
    {
      id: 'source', header: 'Source', sort: (s) => s.sourceName,
      cell: (s) => sourceExists(s)
        ? <ResourceLink type={s.kind === 'vm' ? 'vm' : 'volume'} id={s.sourceId} name={s.sourceName} />
        : <span className="inline-flex items-center gap-1.5 text-[13px] text-muted" title="The source resource was deleted">{s.kind === 'vm' ? <Server className="size-3.5" /> : <HardDrive className="size-3.5" />}<span className="line-through">{s.sourceName}</span><Badge tone="warning">source gone</Badge></span>,
    },
    { id: 'status', header: 'Status', hideBelow: 'md', sort: (s) => s.status, cell: (s) => <StatusPill status={s.status} /> },
    {
      id: 'trigger', header: 'Trigger', hideBelow: 'sm', sort: (s) => s.trigger,
      cell: (s) => <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: TRIGGER_STYLE[s.trigger].color }}><span className="size-2 rounded-full" style={{ background: TRIGGER_STYLE[s.trigger].color }} />{TRIGGER_STYLE[s.trigger].label}</span>,
    },
    { id: 'size', header: 'Size', align: 'right', sort: (s) => s.sizeGB, cell: (s) => <span className="tabular text-fg-2">{gb(s.sizeGB)}</span> },
    { id: 'location', header: 'Location', hideBelow: 'lg', sort: (s) => s.locationId, cell: (s) => <Mono>{s.locationId}</Mono> },
    { id: 'age', header: 'Created', sort: (s) => s.createdAt, cell: (s) => <span className="text-muted" title={dateTime(s.createdAt)}>{timeAgo(s.createdAt)}</span> },
    { id: 'cost', header: 'Monthly', align: 'right', hideBelow: 'md', sort: (s) => s.monthlyCost ?? 0, cell: (s) => <span className="tabular text-fg">{money(s.monthlyCost)}</span> },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Snapshot timeline" icon={Camera} description="Click a dot to filter the table to that snapshot."
          actions={selected ? <Button size="xs" variant="ghost" onClick={() => setSelected(null)}>Clear selection</Button> : undefined} />
        <CardBody>
          <SnapshotTimeline snapshots={timelineSnaps} selectedId={selected} onSelect={(s) => setSelected(selected === s.id ? null : s.id)} />
        </CardBody>
      </Card>
      {orphaned.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[13px] text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{plural(orphaned.length, 'snapshot')} ({gb(Math.round(orphaned.reduce((a, s) => a + s.sizeGB, 0)))}) belong to deleted resources and still cost {money(orphaned.reduce((a, s) => a + (s.monthlyCost ?? 0), 0))}/mo. Turn them into volumes or images, or delete them.</span>
        </div>
      )}
      <DataTable
        rows={rows}
        loading={loading}
        columns={columns}
        searchText={(s) => `${s.name} ${s.sourceName} ${s.description ?? ''} ${s.id} ${s.trigger} ${s.locationId}`}
        searchPlaceholder="Search snapshots or source…"
        defaultSort={{ id: 'age', dir: 'desc' }}
        toolbar={<>
          <FilterChips value={kind} onChange={setKind} options={[
            { value: 'all', label: 'All', count: snapshots.length },
            { value: 'vm', label: 'VM', count: snapshots.filter((s) => s.kind === 'vm').length },
            { value: 'volume', label: 'Volume', count: snapshots.filter((s) => s.kind === 'volume').length },
          ]} />
          <Segmented size="sm" value={trigger} onChange={setTrigger} options={[{ value: 'all', label: 'Any' }, { value: 'manual', label: 'Manual' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'pre-change', label: 'Pre-change' }]} />
        </>}
        rowActions={(s) => <SnapshotMenu snapshot={s} sourceExists={sourceExists(s)} />}
        bulkActions={[{ label: 'Delete', icon: Trash2, danger: true, onClick: bulkDelete }]}
        empty={{ icon: Camera, title: 'No snapshots', description: 'Take a snapshot from a VM or volume detail page, or enable automated backups.' }}
      />
    </div>
  );
}
