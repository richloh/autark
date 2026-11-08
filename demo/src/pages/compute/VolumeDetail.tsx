import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  HardDrive, Link2, Unlink, Camera, MoreHorizontal, Maximize2, Gauge, Copy, Trash2, Lock, LockOpen, Server, ArrowRight, Activity, Settings, LayoutDashboard,
  CalendarClock, Save, TrendingUp, Building2, Cloud, ArrowLeft, FileCode2,
} from 'lucide-react';
import { useItem, useList, useLookup, useActiveOperation, useApiMutation, useMetrics } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardBody, KeyValue } from '@/components/ui/Card';
import { StatusPill, Badge } from '@/components/ui/Badge';
import { Tabs, useTabParam, Segmented } from '@/components/ui/Tabs';
import { Menu } from '@/components/ui/Menu';
import { Mono, Ring, Meter, EmptyState, Skeleton } from '@/components/ui/misc';
import { Field, Input, Textarea, TagEditor, Switch, NumberInput, Hint } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { IacTabs, toCli, toHcl, toCurl } from '@/components/ui/CodeBlock';
import { MetricsPanel } from '@/components/charts/MetricsPanel';
import { Sparkline } from '@/components/charts/Sparkline';
import { OperationRunner } from '@/components/resource/OperationRunner';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { OsBadge } from '@/lib/images';
import { usePro } from '@/store/ui';
import { ProBadge } from '@/components/ui/Pro';
import { flagEmoji } from '@/components/compute/vm/util';
import { SnapshotTimeline, nextBackupAt, TRIGGER_STYLE } from '@/components/compute/SnapshotTimeline';
import { SnapshotMenu } from '@/components/compute/SnapshotActions';
import { useVolumeModals, detachVolumeAction, deleteVolumeAction } from '@/components/compute/volume/VolumeModals';
import { PerformanceVisual, estLatency } from '@/components/compute/volume/PerformanceVisual';
import { TYPE_TONE, TYPE_COLOR, VOLUME_TRANSITIONAL } from '@/components/compute/volume/volumeUi';
import { money, gb, num, timeAgo, dateTime, date } from '@/lib/format';
import { volumeCost, PRICING } from '@/lib/pricing';
import { cn } from '@/lib/cn';
import { VOLUME_LIMITS, type Volume, type VM, type Snapshot, type Location, type Project, type Image } from '@/types';

export default function VolumeDetail() {
  const { id } = useParams();
  const { data: vol, isLoading, error } = useItem<Volume>('volumes', id);
  const op = useActiveOperation(id);
  const [tab, setTab] = useTabParam('overview');
  const modals = useVolumeModals();
  const { data: vm } = useItem<VM>('vms', vol?.attachedTo?.vmId);
  const { items: snapshots } = useList<Snapshot>('snapshots', { sourceId: id });
  const { map: locations } = useLookup<Location>('locations');
  const { map: projects } = useLookup<Project>('projects');
  const pro = usePro();

  if (isLoading) return <Page><Skeleton className="mb-4 h-12 w-1/3" /><Skeleton className="h-64" /></Page>;
  if (!vol || error) {
    return (
      <Page>
        <EmptyState icon={HardDrive} title="Volume not found" description={`${id} does not exist, was deleted, or belongs to another account.`}
          action={<Button icon={ArrowLeft} to="/infrastructure/volumes">Back to volumes</Button>} />
      </Page>
    );
  }

  const busy = VOLUME_TRANSITIONAL.includes(vol.status);
  const loc = locations.get(vol.locationId);
  const usedPct = vol.usedGB / vol.sizeGB;
  const snapsSorted = [...snapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const tabs = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="size-3.5" /> },
    { id: 'performance', label: pro ? 'Performance' : 'Graphs', icon: <Gauge className="size-3.5" /> },
    { id: 'snapshots', label: pro ? 'Snapshots & backups' : 'Snapshots', icon: <Camera className="size-3.5" />, count: snapshots.length },
    { id: 'settings', label: 'Settings', icon: <Settings className="size-3.5" /> },
    ...(pro ? [{ id: 'activity', label: <span className="inline-flex items-center gap-1.5">Activity<ProBadge /></span>, icon: <Activity className="size-3.5" /> }] : []),
  ];
  const activeTab = tabs.some((t) => t.id === tab) ? tab : 'overview';
  const proDetail = new Set(['Provisioned IOPS', 'Throughput', 'Est. latency', 'Project', 'Source']);

  return (
    <Page wide>
      <PageHeader
        title={vol.name}
        icon={HardDrive}
        iconColor={TYPE_COLOR[vol.type]}
        status={<StatusPill status={vol.status} />}
        crumbs={[{ label: 'Volumes', to: '/infrastructure/volumes' }, { label: vol.name }]}
        meta={<>
          {pro && <Mono copy>{vol.id}</Mono>}
          <Badge tone={TYPE_TONE[vol.type]}>{gb(vol.sizeGB)} {VOLUME_LIMITS[vol.type].label}</Badge>
          {pro
            ? <span className="flex items-center gap-1">{loc?.kind === 'cloud' ? <Cloud className="size-3.5 text-sky-500" /> : <Building2 className="size-3.5 text-emerald-500" />}{loc?.name ?? vol.locationId}</span>
            : <span className="flex items-center gap-1.5" title={loc?.name}><span className="text-sm leading-none">{flagEmoji(loc?.country)}</span>{loc?.city ?? vol.locationId}</span>}
          {vol.attachedTo && <span className="flex items-center gap-1"><Link2 className="size-3.5" />{vm?.name ?? vol.attachedTo.vmId}{pro && <> · <code className="font-mono">{vol.attachedTo.device}</code></>}</span>}
          <span>{money(vol.monthlyCost)}/mo</span>
        </>}
        actions={<>
          {vol.attachedTo
            ? <Button icon={Unlink} disabled={busy} onClick={() => detachVolumeAction(vol, vm?.name)}>Detach</Button>
            : <Button icon={Link2} disabled={vol.status !== 'available'} onClick={() => modals.open('attach', vol)}>Attach</Button>}
          <Button icon={Camera} disabled={busy || vol.status === 'error'} onClick={() => modals.open('snapshot', vol)}>Snapshot</Button>
          <Button icon={Maximize2} disabled={busy || vol.status === 'error'} onClick={() => modals.open('resize', vol)}>Resize</Button>
          <Menu
            trigger={() => <Button icon={MoreHorizontal} aria-label="More actions" />}
            items={[
              ...(pro ? [{ label: 'Change performance…', icon: Gauge, disabled: busy || vol.status === 'error', onClick: () => modals.open('performance', vol) }] : []),
              { label: 'Clone volume…', icon: Copy, disabled: busy || vol.status === 'error', onClick: () => modals.open('clone', vol) },
              { divider: true, label: '' },
              { label: 'Delete volume', icon: Trash2, danger: true, disabled: busy || !!vol.attachedTo, hint: vol.attachedTo ? 'detach first' : undefined, onClick: () => deleteVolumeAction(vol) },
            ]}
          />
        </>}
      />

      {op && <OperationRunner op={op} className="mb-5 shadow-card" compact={op.type !== 'volume.create'} />}
      {vol.status === 'error' && !op && <Hint tone="danger" className="mb-5">Provisioning failed. Check the Activity tab for details; you can delete this volume and try again.</Hint>}
      {vol.status === 'deleting' && <Hint tone="warning" className="mb-5">This volume is being deleted.</Hint>}

      <Tabs className="mb-5" value={activeTab} onChange={setTab} tabs={tabs} />

      {activeTab === 'overview' && (
        <div className="grid gap-5 @min-[60rem]:grid-cols-3">
          <div className="space-y-5 @min-[60rem]:col-span-2">
            <AttachmentCard vol={vol} vm={vm} onAttach={() => modals.open('attach', vol)} onDetach={() => detachVolumeAction(vol, vm?.name)} />
            {pro && <LiveCard vol={vol} />}
            <Card>
              <CardHeader title="Details" icon={HardDrive} />
              <CardBody>
                <KeyValue cols={3} items={([
                  ['Type', <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: TYPE_COLOR[vol.type] }} />{VOLUME_LIMITS[vol.type].label}</span>],
                  ['Size', gb(vol.sizeGB)],
                  ['Filesystem', vol.filesystem === 'none' ? 'Raw block device' : vol.filesystem],
                  ['Provisioned IOPS', num(vol.iops)],
                  ['Throughput', `${vol.throughputMBps} MB/s`],
                  ['Est. latency', `${estLatency(vol.type, vol.iops, vol.sizeGB)} ms`],
                  ['Encryption', vol.encrypted ? <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><Lock className="size-3.5" />LUKS2 (KMS)</span> : <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><LockOpen className="size-3.5" />Not encrypted</span>],
                  ['Location', loc?.name ?? vol.locationId],
                  ['Project', <span className="flex items-center gap-1.5">{projects.get(vol.projectId) && <span className="size-2 rounded-full" style={{ background: projects.get(vol.projectId)!.color }} />}{projects.get(vol.projectId)?.name ?? vol.projectId}</span>],
                  ['Source', vol.sourceSnapshotId ? <ResourceLink type="snapshot" id={vol.sourceSnapshotId} name={vol.sourceSnapshotId} /> : 'Empty'],
                  ['Backups', vol.backupPolicy.enabled ? `${vol.backupPolicy.schedule}, keep ${vol.backupPolicy.retention}` : 'Off'],
                  ['Created', <span title={dateTime(vol.createdAt)}>{date(vol.createdAt)} · {timeAgo(vol.createdAt)}</span>],
                ] as [string, ReactNode][]).filter(([k]) => pro || !proDetail.has(k))} />
                {vol.description && <p className="mt-4 border-t border-line pt-3 text-sm text-fg-2">{vol.description}</p>}
              </CardBody>
            </Card>
          </div>
          <div className="space-y-5">
            <UsageCard vol={vol} usedPct={usedPct} onResize={() => modals.open('resize', vol)} busy={busy} />
            {pro && <CostCard vol={vol} snapshots={snapshots} />}
            {pro && <Card>
              <CardHeader title="Equivalent code" icon={FileCode2} />
              <CardBody>
                <IacTabs title="" snippets={{
                  terraform: toHcl('volume', vol.name, { name: vol.name, project_id: vol.projectId, location_id: vol.locationId, type: vol.type, sizeGB: vol.sizeGB, iops: vol.iops, throughputMBps: vol.throughputMBps, encrypted: vol.encrypted, tags: vol.tags }),
                  cli: toCli(`volume get ${vol.id}`, {}),
                  curl: toCurl('GET', `/volumes/${vol.id}`),
                }} />
              </CardBody>
            </Card>}
          </div>
        </div>
      )}

      {activeTab === 'performance' && (
        <div className="space-y-5">
          {vol.status !== 'in-use' && <Hint>The volume is not attached, so there is no I/O. Capacity metrics are still collected.</Hint>}
          <div className={pro ? 'grid gap-5 @min-[44rem]:grid-cols-[1fr_320px]' : ''}>
            <MetricsPanel collection="volumes" id={vol.id} charts={[
              { title: 'IOPS', metrics: ['readIops', 'writeIops'], labels: ['Read', 'Write'], unit: 'IOPS', format: (v) => num(Math.round(v)) },
              { title: 'Throughput', metrics: ['readTp', 'writeTp'], labels: ['Read', 'Write'], unit: 'MB/s', colors: ['#06b6d4', '#a855f7'] },
              ...(pro ? [
                { title: 'Latency', metrics: ['latency'], labels: ['Avg latency'], unit: 'ms', colors: ['#f59e0b'], format: (v: number) => `${v.toFixed(2)} ms` },
                { title: 'Queue depth', metrics: ['queueDepth'], labels: ['Queue depth'], colors: ['#64748b'], format: (v: number) => v.toFixed(1) },
              ] : []),
              { title: 'Used capacity', metrics: ['usedGB'], labels: ['Used'], unit: 'GB', max: vol.sizeGB, colors: ['#10b981'], format: (v) => gb(Math.round(v)) },
            ]} />
            {pro && <div className="space-y-4">
              <PerformanceVisual type={vol.type} sizeGB={vol.sizeGB} iops={vol.iops} throughputMBps={vol.throughputMBps} />
              <Button className="w-full" icon={Gauge} disabled={busy || vol.status === 'error'} onClick={() => modals.open('performance', vol)}>Change provisioned performance</Button>
            </div>}
          </div>
        </div>
      )}

      {activeTab === 'snapshots' && <SnapshotsTab vol={vol} snapshots={snapsSorted} onSnapshot={() => modals.open('snapshot', vol)} busy={busy} />}
      {activeTab === 'settings' && <SettingsTab vol={vol} />}
      {activeTab === 'activity' && <Card><ActivityFeed targetId={vol.id} /></Card>}

      {modals.element}
    </Page>
  );
}

/* ------------------------------------------------------------------ overview pieces */

function AttachmentCard({ vol, vm, onAttach, onDetach }: { vol: Volume; vm?: VM; onAttach: () => void; onDetach: () => void }) {
  const { data: img } = useItem<Image>('images', vm?.imageId);
  const attached = !!vol.attachedTo;
  const transient = vol.status === 'attaching' || vol.status === 'detaching';
  const pro = usePro();
  return (
    <Card>
      <CardHeader title="Attachment" icon={Link2} description={attached ? (pro ? 'Mounted as a virtio block device' : undefined) : 'Not attached to any VM'}
        actions={attached ? <Button size="sm" variant="ghost" icon={Unlink} disabled={VOLUME_TRANSITIONAL.includes(vol.status)} onClick={onDetach}>Detach</Button> : <Button size="sm" icon={Link2} disabled={vol.status !== 'available'} onClick={onAttach}>Attach to VM</Button>} />
      <CardBody>
        <div className="flex flex-col items-stretch gap-3 @min-[36rem]:flex-row @min-[36rem]:items-center">
          <div className={cn('flex min-w-0 flex-1 items-center gap-3 rounded-xl border p-3', attached ? 'border-line bg-surface-2/50' : 'border-dashed border-line-strong')}>
            {attached && vm ? (
              <>
                <OsBadge os={img?.os ?? 'custom'} size={34} />
                <div className="min-w-0">
                  <Link to={`/infrastructure/vms/${vm.id}`} className="block truncate text-sm font-medium text-fg hover:text-brand-500">{vm.name}</Link>
                  <div className="flex items-center gap-1.5 text-xs text-muted"><StatusPill status={vm.status} className="h-[18px]" />{vm.size.vcpus} vCPU · {vm.size.ramGB} GB</div>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3 text-sm text-muted"><Server className="size-8 text-faint" />Available — attach to a VM in {vol.locationId}</div>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-center px-2 text-center">
            <code className={cn('rounded-md px-2 py-0.5 font-mono text-xs', attached ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300' : 'bg-surface-3 text-faint')}>{vol.attachedTo?.device ?? '/dev/vd?'}</code>
            <div className="relative my-1 h-px w-20 overflow-hidden bg-line-strong @max-[36rem]:h-6 @max-[36rem]:w-px">
              {attached && <span className={cn('absolute inset-0 bg-gradient-to-r from-transparent via-brand-500 to-transparent', (vol.status === 'in-use' || transient) && 'animate-pulse-soft')} />}
            </div>
            {pro && <span className="flex items-center gap-1 text-[10px] text-faint"><ArrowRight className="size-3 @max-[36rem]:rotate-90" />virtio-blk</span>}
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-line bg-surface-2/50 p-3">
            <span className="flex size-[34px] shrink-0 items-center justify-center rounded-lg" style={{ background: `${TYPE_COLOR[vol.type]}1a`, color: TYPE_COLOR[vol.type] }}><HardDrive className="size-4" /></span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-fg">{vol.name}</div>
              <div className="text-xs text-muted">{gb(vol.sizeGB)} {VOLUME_LIMITS[vol.type].label} · {vol.filesystem === 'none' ? 'raw' : vol.filesystem}</div>
            </div>
          </div>
        </div>
        {attached && vol.filesystem !== 'none' && vol.status === 'in-use' && (
          <div className="mt-3 flex items-center gap-2 overflow-x-auto rounded-lg bg-[#0d0f18] px-3 py-2 font-mono text-[11.5px] text-slate-300">
            <span className="select-none text-slate-500">$</span><span className="whitespace-nowrap">sudo mount {vol.attachedTo!.device} /mnt/{vol.name}</span>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function LiveCard({ vol }: { vol: Volume }) {
  const { data } = useMetrics('volumes', vol.id, ['readIops', 'writeIops', 'readTp', 'writeTp', 'latency'], '1h');
  const s = data?.series ?? {};
  const pts = (m: string) => s[m]?.points.map((p) => p.v) ?? [];
  const sum = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] ?? 0));
  const iops = sum(pts('readIops'), pts('writeIops'));
  const tp = sum(pts('readTp'), pts('writeTp'));
  const lat = pts('latency');
  const tiles = [
    { label: 'IOPS', value: iops.at(-1), fmt: (v: number) => num(Math.round(v)), sub: `of ${num(vol.iops)} provisioned`, data: iops, color: '#5b67f8', max: vol.iops },
    { label: 'Throughput', value: tp.at(-1), fmt: (v: number) => `${v.toFixed(0)} MB/s`, sub: `of ${vol.throughputMBps} MB/s`, data: tp, color: '#06b6d4', max: vol.throughputMBps },
    { label: 'Latency', value: lat.at(-1), fmt: (v: number) => `${v.toFixed(2)} ms`, sub: 'avg, last minute', data: lat, color: '#f59e0b' },
  ];
  return (
    <Card>
      <CardHeader title="Live I/O" icon={Activity} description={vol.status === 'in-use' ? 'Last hour, auto-refreshing' : 'Idle — attach the volume to generate I/O'}
        actions={vol.status === 'in-use' && <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-emerald-500" /></span>} />
      <div className="grid divide-y divide-line @min-[36rem]:grid-cols-3 @min-[36rem]:divide-x @min-[36rem]:divide-y-0">
        {tiles.map((t) => (
          <div key={t.label} className="flex items-end justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="text-xs text-muted">{t.label}</div>
              <div className="mt-1 text-lg font-semibold tabular text-fg">{t.value != null ? t.fmt(t.value) : '—'}</div>
              <div className="text-[11px] text-faint">{t.sub}</div>
            </div>
            <Sparkline data={t.data} width={96} height={34} color={t.color} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function UsageCard({ vol, usedPct, onResize, busy }: { vol: Volume; usedPct: number; onResize: () => void; busy: boolean }) {
  const { data } = useMetrics('volumes', vol.id, ['usedGB'], '30d');
  const pts = data?.series?.usedGB?.points ?? [];
  const growthPerDay = pts.length > 1 ? (pts.at(-1)!.v - pts[0].v) / ((pts.at(-1)!.t - pts[0].t) / 86_400_000) : 0;
  const daysToFull = growthPerDay > 0.01 ? Math.round((vol.sizeGB - vol.usedGB) / growthPerDay) : null;
  return (
    <Card>
      <CardHeader title="Capacity" icon={HardDrive} actions={<Button size="xs" variant="ghost" icon={Maximize2} disabled={busy || vol.status === 'error'} onClick={onResize}>Grow</Button>} />
      <CardBody>
        <div className="flex items-center gap-4">
          <Ring value={vol.usedGB} max={vol.sizeGB} size={84} stroke={8} sublabel="used" />
          <div className="min-w-0 flex-1 space-y-1 text-[13px]">
            <div className="flex justify-between"><span className="text-muted">Used</span><span className="tabular text-fg">{gb(vol.usedGB)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Free</span><span className="tabular text-fg">{gb(vol.sizeGB - vol.usedGB)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Provisioned</span><span className="tabular text-fg">{gb(vol.sizeGB)}</span></div>
          </div>
        </div>
        <Meter value={vol.usedGB} max={vol.sizeGB} className="mt-4" />
        {pts.length > 1 && (
          <div className="mt-3">
            <Sparkline data={pts.map((p) => p.v)} width={280} height={36} color="#10b981" max={vol.sizeGB} />
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
              <TrendingUp className="size-3.5" />
              {daysToFull != null
                ? <span>+{growthPerDay.toFixed(1)} GB/day · full in <span className={cn('font-medium', daysToFull < 30 ? 'text-rose-500' : daysToFull < 90 ? 'text-amber-600 dark:text-amber-400' : 'text-fg-2')}>~{daysToFull} days</span></span>
                : <span>Stable over 30 days</span>}
            </div>
          </div>
        )}
        {usedPct > 0.85 && <Hint tone="warning" className="mt-3">Volume is {Math.round(usedPct * 100)}% full. Grow it online before it runs out of space.</Hint>}
      </CardBody>
    </Card>
  );
}

function CostCard({ vol, snapshots }: { vol: Volume; snapshots: Snapshot[] }) {
  const snapGB = snapshots.reduce((a, s) => a + s.sizeGB, 0);
  const c = volumeCost({ type: vol.type, sizeGB: vol.sizeGB, iops: vol.iops, throughputMBps: vol.throughputMBps, snapshotsGB: Math.round(snapGB) });
  const max = Math.max(...c.lines.map((l) => l.amount), 0.01);
  return (
    <Card>
      <CardHeader title="Monthly cost" icon={Gauge} actions={<span className="text-sm font-semibold tabular text-fg">{money(c.total)}</span>} />
      <CardBody className="space-y-2.5">
        {c.lines.map((l) => (
          <div key={l.label}>
            <div className="flex justify-between text-[13px]"><span className="text-fg-2">{l.label}</span><span className="tabular text-fg">{money(l.amount, { decimals: true })}</span></div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-brand-500/70" style={{ width: `${(l.amount / max) * 100}%` }} /></div>
          </div>
        ))}
        <p className="pt-1 text-[11px] text-faint">{money(PRICING.volume[vol.type])}/GB-month · {PRICING.volume.includedIops.toLocaleString()} IOPS & {PRICING.volume.includedThroughput} MB/s included · snapshots {money(PRICING.snapshotGBPerMonth)}/GB</p>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ snapshots tab */

function SnapshotsTab({ vol, snapshots, onSnapshot, busy }: { vol: Volume; snapshots: Snapshot[]; onSnapshot: () => void; busy: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [policy, setPolicy] = useState(vol.backupPolicy);
  useEffect(() => setPolicy(vol.backupPolicy), [vol.backupPolicy.enabled, vol.backupPolicy.schedule, vol.backupPolicy.retention]); // eslint-disable-line
  const dirty = JSON.stringify(policy) !== JSON.stringify(vol.backupPolicy);
  const save = useApiMutation(() => api.update('volumes', vol.id, { backupPolicy: policy }), { success: 'Backup policy updated' });
  const nextAt = vol.backupPolicy.enabled ? nextBackupAt(vol.backupPolicy.schedule) : null;
  const totalGB = snapshots.reduce((a, s) => a + s.sizeGB, 0);
  const rows = useMemo(() => snapshots, [snapshots]);

  const columns: Column<Snapshot>[] = [
    { id: 'name', header: 'Name', sort: (s) => s.name, cell: (s) => <div className="min-w-0"><div className="truncate font-medium text-fg">{s.name}</div>{s.description && <div className="truncate text-[11px] text-muted">{s.description}</div>}</div> },
    { id: 'trigger', header: 'Trigger', sort: (s) => s.trigger, cell: (s) => <span className="flex items-center gap-1.5 text-xs text-fg-2"><span className="size-2 rounded-full" style={{ background: TRIGGER_STYLE[s.trigger].color }} />{TRIGGER_STYLE[s.trigger].label}</span> },
    { id: 'status', header: 'Status', hideBelow: 'sm', cell: (s) => <StatusPill status={s.status} /> },
    { id: 'size', header: 'Size', align: 'right', sort: (s) => s.sizeGB, cell: (s) => <span className="tabular">{gb(s.sizeGB)}</span> },
    { id: 'created', header: 'Created', sort: (s) => s.createdAt, cell: (s) => <span className="text-xs text-fg-2" title={dateTime(s.createdAt)}>{timeAgo(s.createdAt)}</span> },
    { id: 'cost', header: 'Monthly', align: 'right', hideBelow: 'md', cell: (s) => <span className="tabular text-muted">{money(s.monthlyCost)}</span> },
  ];

  return (
    <div className="grid gap-5 @min-[60rem]:grid-cols-3">
      <div className="space-y-5 @min-[60rem]:col-span-2">
        <Card>
          <CardHeader title="Timeline" icon={CalendarClock} description={`${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'} · ${gb(Math.round(totalGB))} stored off-host`}
            actions={<Button size="sm" variant="primary" icon={Camera} disabled={busy || vol.status === 'error'} onClick={onSnapshot}>Create snapshot</Button>} />
          <CardBody>
            <SnapshotTimeline snapshots={snapshots} selectedId={selected} onSelect={(s) => setSelected(s.id === selected ? null : s.id)} nextAt={nextAt} />
          </CardBody>
        </Card>
        <DataTable rows={rows} columns={columns} rowClassName={(s) => (s.id === selected ? 'bg-brand-500/[0.06]' : undefined)} onRowClick={(s) => setSelected(s.id)}
          rowActions={(s) => <SnapshotMenu snapshot={s} />} defaultSort={{ id: 'created', dir: 'desc' }}
          empty={{ icon: Camera, title: 'No snapshots yet', description: 'Snapshots are point-in-time copies you can restore or turn into new volumes.' }} />
      </div>
      <Card className="h-fit">
        <CardHeader title="Backup policy" icon={CalendarClock} description="Scheduled snapshots with automatic pruning" />
        <CardBody className="space-y-4">
          <Switch checked={policy.enabled} onChange={(v) => setPolicy({ ...policy, enabled: v })} label="Scheduled snapshots" description="Crash-consistent; filesystem is frozen briefly if attached." />
          {policy.enabled && (
            <>
              <Field label="Schedule"><Segmented value={policy.schedule} onChange={(v) => setPolicy({ ...policy, schedule: v })} options={[{ value: 'hourly', label: 'Hourly' }, { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }]} /></Field>
              <Field label="Keep last" hint={`≈ ${money(Math.max(1, vol.usedGB) * 0.25 * Math.min(policy.retention, 10) * PRICING.snapshotGBPerMonth)}/mo with incremental copies`}>
                <NumberInput value={policy.retention} onChange={(v) => setPolicy({ ...policy, retention: v })} min={1} max={90} unit="copies" />
              </Field>
              <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">Next run: <span className="text-fg-2">{dateTime(nextBackupAt(policy.schedule))}</span></div>
            </>
          )}
          <Button variant="primary" icon={Save} className="w-full" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save policy</Button>
        </CardBody>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ settings tab */

function SettingsTab({ vol }: { vol: Volume }) {
  const pro = usePro();
  const [name, setName] = useState(vol.name);
  const [description, setDescription] = useState(vol.description ?? '');
  const [tags, setTags] = useState(vol.tags);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setName(vol.name); setDescription(vol.description ?? ''); setTags(vol.tags) }, [vol.name, vol.description, JSON.stringify(vol.tags)]); // eslint-disable-line
  const dirty = name !== vol.name || description !== (vol.description ?? '') || JSON.stringify(tags) !== JSON.stringify(vol.tags);
  const save = useApiMutation(() => api.update('volumes', vol.id, { ...(name !== vol.name ? { name } : {}), description, tags }), {
    success: 'Volume updated', onSuccess: () => setErrors({}), onError: (e: ApiClientError) => setErrors(fieldErrors(e)),
  });
  return (
    <div className="grid gap-5 @min-[44rem]:grid-cols-3">
      <Card className="@min-[44rem]:col-span-2">
        <CardHeader title="General" icon={Settings} />
        <CardBody className="space-y-4">
          <Field label="Name" error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} invalid={!!errors.name} /></Field>
          <Field label="Description" optional><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="Tags" error={errors.tags}><TagEditor value={tags} onChange={setTags} /></Field>
          <div className="flex justify-end gap-2">
            {dirty && <Button variant="ghost" onClick={() => { setName(vol.name); setDescription(vol.description ?? ''); setTags(vol.tags) }}>Reset</Button>}
            <Button variant="primary" icon={Save} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>
          </div>
        </CardBody>
      </Card>
      <div className="space-y-5">
        {pro && <Card>
          <CardHeader title="Immutable properties" />
          <CardBody>
            <KeyValue cols={1} items={[
              ['Encryption', vol.encrypted ? 'Enabled (LUKS2)' : 'Disabled — clone into a new volume to change'],
              ['Location', vol.locationId],
              ['Type', `${VOLUME_LIMITS[vol.type].label} — clone to change media type`],
            ]} />
          </CardBody>
        </Card>}
        <Card className="border-rose-500/30">
          <CardHeader title={<span className="text-rose-600 dark:text-rose-400">Danger zone</span>} />
          <CardBody className="space-y-3">
            <p className="text-[13px] text-muted">{vol.attachedTo ? 'Detach the volume before deleting it.' : 'Deleting destroys all data on this volume.'}</p>
            <Button variant="outline-danger" icon={Trash2} disabled={!!vol.attachedTo || VOLUME_TRANSITIONAL.includes(vol.status)} onClick={() => deleteVolumeAction(vol)}>Delete volume</Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
