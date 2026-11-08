import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Server, RotateCw, Lock, TerminalSquare, Camera, MoreHorizontal, Scaling, MoveRight, RefreshCcw, Copy, Pencil, Trash2, Zap, Building2, Cloud,
  LayoutDashboard, LineChart, Network as NetIcon, HardDrive, History, Settings2, Activity, ArrowLeft, CheckCircle2, X, ChevronDown, Bell,
} from 'lucide-react';
import { useItem, useList, useLookup, useActiveOperation, useOperationsFor, useApiMutation, useMetrics } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Tabs, useTabParam } from '@/components/ui/Tabs';
import { Card, CardHeader, KeyValue } from '@/components/ui/Card';
import { Mono, EmptyState, Skeleton } from '@/components/ui/misc';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { MetricsPanel, type MetricDef } from '@/components/charts/MetricsPanel';
import { OperationRunner } from '@/components/resource/OperationRunner';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { OsBadge } from '@/lib/images';
import { money, timeAgo, duration, dateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { VmConsole } from '@/components/compute/vm/VmConsole';
import { VmOverview, PlacementVisual } from '@/components/compute/vm/VmOverview';
import { VmNetworking } from '@/components/compute/vm/VmNetworking';
import { VmStorage } from '@/components/compute/vm/VmStorage';
import { VmSnapshots } from '@/components/compute/vm/VmSnapshots';
import { VmSettings } from '@/components/compute/vm/VmSettings';
import { ResizeVmModal, MigrateVmModal, RebuildVmModal, CloneVmModal, RenameModal, SnapshotVmModal, NewVolumeModal } from '@/components/compute/vm/VmModals';
import { defaultUser, archLabel, flagEmoji } from '@/components/compute/vm/util';
import { PowerToggle, SpecStrip, HeaderAddresses } from '@/components/compute/vm/VmHeader';
import { VmRescale } from '@/components/compute/vm/VmRescale';
import { usePro } from '@/store/ui';
import { ProBadge } from '@/components/ui/Pro';
import type { VmCtx, VmModal } from '@/components/compute/vm/context';
import type { VM, Image, Location, BareMetalHost, Network, Project, IpAddress, Firewall, Volume, Snapshot, SshKey, VmPreset, Operation } from '@/types';

const OP_VERB: Record<string, string> = { start: 'Starting', stop: 'Stopping', forceStop: 'Force-stopping', reboot: 'Rebooting' };

export default function VmDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useTabParam('overview');
  const [modal, setModal] = useState<VmModal>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [showFailLog, setShowFailLog] = useState(false);
  const pro = usePro();

  const { data: vm, isLoading, error } = useItem<VM>('vms', id);
  const op = useActiveOperation(id);
  const { items: ops } = useOperationsFor(id);
  const { map: images } = useLookup<Image>('images');
  const { map: locations } = useLookup<Location>('locations');
  const { map: hosts } = useLookup<BareMetalHost>('hosts');
  const { map: networks } = useLookup<Network>('networks');
  const { map: projects } = useLookup<Project>('projects');
  const { items: ips } = useList<IpAddress>('ips', vm ? { projectId: vm.projectId } : undefined, { enabled: !!vm });
  const { items: firewalls } = useList<Firewall>('firewalls', vm ? { projectId: vm.projectId } : undefined, { enabled: !!vm });
  const { items: volumes } = useList<Volume>('volumes', vm ? { projectId: vm.projectId } : undefined, { enabled: !!vm });
  const { items: snapshots } = useList<Snapshot>('snapshots', { sourceId: id }, { enabled: !!id });
  const { items: sshKeys } = useList<SshKey>('sshKeys');
  const { items: presets } = useList<VmPreset>('vmPresets');
  const { data: live } = useMetrics('vms', vm?.status === 'running' && tab === 'console' ? id : undefined, ['cpu', 'ram'], '15m');

  const c: VmCtx | null = useMemo(() => {
    if (!vm) return null;
    return {
      vm, image: images.get(vm.imageId), location: locations.get(vm.locationId), host: vm.hostId ? hosts.get(vm.hostId) : undefined,
      network: networks.get(vm.networkId), project: projects.get(vm.projectId), preset: presets.find((p) => p.id === vm.size.presetId),
      ips: ips.filter((i) => vm.ipIds.includes(i.id)), firewalls: firewalls.filter((f) => vm.firewallIds.includes(f.id)), allFirewalls: firewalls,
      volumes: vm.volumeIds.map((vid) => volumes.find((v) => v.id === vid)).filter(Boolean) as Volume[],
      snapshots: snapshots.filter((s) => s.kind === 'vm'), sshKeys: sshKeys.filter((k) => vm.sshKeyIds.includes(k.id)), allSshKeys: sshKeys,
    };
  }, [vm, images, locations, hosts, networks, projects, presets, ips, firewalls, volumes, snapshots, sshKeys]);

  const power = useApiMutation((a: 'start' | 'stop' | 'forceStop' | 'reboot') => api.action('vms', id!, a), { success: (_r, a) => `${OP_VERB[a]} ${vm?.name}` });

  if (isLoading) return <Page wide><Skeleton className="mb-4 h-12 w-80" /><Skeleton className="mb-6 h-8 w-full" /><div className="grid gap-4 @min-[40rem]:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}</div></Page>;
  if (error || !vm || !c) {
    return (
      <Page>
        <EmptyState icon={Server} title="VM not found" description={`No virtual machine with id ${id} exists in this account. It may have been deleted.`} action={<Button icon={ArrowLeft} to="/infrastructure/vms">Back to virtual machines</Button>} />
      </Page>
    );
  }

  const { image, location, host, project } = c;
  const running = vm.status === 'running';
  const provisioning = !!op && ['vm.create', 'vm.rebuild'].includes(op.type);
  const lastOp: Operation | undefined = ops[0];
  const failedCreate = vm.status === 'error' && lastOp?.status === 'failed' && ['vm.create', 'vm.rebuild'].includes(lastOp.type) ? lastOp : undefined;
  const justCreated = !op && lastOp?.type === 'vm.create' && lastOp.status === 'succeeded' && lastOp.finishedAt && Date.now() - Date.parse(lastOp.finishedAt) < 5 * 60_000 && dismissed !== lastOp.id ? lastOp : undefined;
  const pub = c.ips.find((i) => i.version === 4)?.address;

  const go = (t: string) => { if (t === 'migrate') setModal('migrate'); else { setTab(t); window.scrollTo({ top: 0, behavior: 'smooth' }) } };
  const onPower = (a: 'start' | 'stop' | 'reboot') => power.mutate(a);

  const remove = async () => {
    if (vm.deletionProtection) {
      const ok = await confirm({ title: 'Deletion protection is enabled', message: `${vm.name} is protected against deletion. Disable protection to continue?`, confirmLabel: 'Disable protection' });
      if (!ok) return;
      try { await api.update('vms', vm.id, { deletionProtection: false }) } catch (e) { toast.error('Could not disable protection', (e as Error).message); return }
    }
    const res = await confirm({
      title: `Delete ${vm.name}?`, danger: true, confirmLabel: 'Delete VM', typeToConfirm: vm.name,
      message: `The VM is shut down and its system disk destroyed. ${c.snapshots.length ? `${c.snapshots.length} snapshot(s) are kept.` : ''}`,
      options: [
        ...(c.volumes.length ? [{ id: 'deleteVolumes', label: `Also delete ${c.volumes.length} attached volume${c.volumes.length > 1 ? 's' : ''}`, description: c.volumes.map((v) => `${v.name} (${v.sizeGB} GB)`).join(', ') + ' — otherwise detached and kept.' }] : []),
        ...(c.ips.length ? [{ id: 'releaseIps', label: `Release ${c.ips.length} public IP${c.ips.length > 1 ? 's' : ''}`, description: c.ips.map((i) => i.address).join(', ') + ' — otherwise kept in the project.' }] : []),
      ],
    });
    if (!res) return;
    try {
      await api.remove('vms', vm.id, { deleteVolumes: String(!!res.deleteVolumes), releaseIps: String(!!res.releaseIps) });
      toast.success(`Deleting ${vm.name}`, 'Progress is shown in the operations tray.');
      navigate('/infrastructure/vms');
    } catch (e) { toast.error('Delete failed', (e as Error).message) }
  };

  const snapshotNow = () => setModal('snapshot');
  const reboot = async () => { if (await confirm({ title: `Reboot ${vm.name}?`, message: 'Sends an ACPI reboot to the guest. Typically back within 30 seconds.', confirmLabel: 'Reboot' })) power.mutate('reboot') };

  const metricCharts: MetricDef[] = [
    { title: 'CPU utilization', metrics: ['cpu'], labels: ['CPU'], unit: '%', max: 100 },
    { title: 'Memory utilization', metrics: ['ram'], labels: ['RAM'], unit: '%', max: 100, colors: ['#a855f7'] },
    { title: 'Network throughput', metrics: ['netIn', 'netOut'], labels: ['Inbound', 'Outbound'], unit: 'Mbit/s', colors: ['#06b6d4', '#5b67f8'] },
    { title: 'Disk throughput', metrics: ['diskRead', 'diskWrite'], labels: ['Read', 'Write'], unit: 'MB/s', colors: ['#10b981', '#f59e0b'] },
    { title: 'Disk IOPS', metrics: ['diskIops'], labels: ['IOPS'], unit: 'IOPS', colors: ['#ec4899'] },
    { title: 'Load average', metrics: ['load'], labels: ['1 min'], unit: '', colors: ['#64748b'], format: (v) => v.toFixed(2) },
    ...(vm.gpu ? [
      { title: `GPU utilization (${vm.gpu.count}× ${vm.gpu.model})`, metrics: ['gpu', 'gpuMem'], labels: ['Compute', 'Memory'], unit: '%', max: 100, colors: ['#8b5cf6', '#c084fc'] },
      { title: 'GPU temperature', metrics: ['gpuTemp'], labels: ['Temp'], unit: '°C', max: 95, colors: ['#f43f5e'] },
    ] : []),
  ];

  const cloneItem = { label: 'Clone…', icon: Copy, disabled: vm.status === 'deleting', onClick: () => setModal('clone') };
  const deleteItem = { label: 'Delete…', icon: Trash2, danger: true, disabled: vm.status === 'deleting', onClick: remove };
  const simpleMoreItems = [
    { label: 'Reboot', icon: RotateCw, disabled: !running, onClick: reboot },
    { label: 'Take snapshot…', icon: Camera, disabled: !['running', 'stopped'].includes(vm.status), onClick: snapshotNow },
    cloneItem,
    { divider: true, label: '' },
    deleteItem,
  ];
  const moreItems = [
    { label: 'Reboot', icon: RotateCw, disabled: !running, onClick: reboot },
    { label: 'Take snapshot…', icon: Camera, disabled: !['running', 'stopped'].includes(vm.status), onClick: snapshotNow },
    { label: 'Open console', icon: TerminalSquare, onClick: () => go('console') },
    { divider: true, label: '' },
    { label: 'Force stop', icon: Zap, disabled: !['running', 'starting', 'stopping', 'rebooting', 'error'].includes(vm.status), onClick: async () => { if (await confirm({ title: `Force stop ${vm.name}?`, message: 'Equivalent to pulling the power cord. Unsaved data in the guest may be lost.', confirmLabel: 'Force stop', danger: true })) power.mutate('forceStop') } },
    { divider: true, label: '' },
    { label: 'Rescale…', icon: Scaling, disabled: !['running', 'stopped'].includes(vm.status), onClick: () => go('rescale') },
    { label: 'Migrate to host…', icon: MoveRight, disabled: !vm.hostId || !['running', 'stopped'].includes(vm.status), hint: !vm.hostId ? 'cloud' : undefined, onClick: () => setModal('migrate') },
    { label: 'Rebuild…', icon: RefreshCcw, disabled: !['running', 'stopped', 'error'].includes(vm.status), onClick: () => setModal('rebuild') },
    cloneItem,
    { label: 'Rename…', icon: Pencil, onClick: () => setModal('rename') },
    { divider: true, label: '' },
    deleteItem,
  ];

  const tabs = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="size-3.5" /> },
    { id: 'metrics', label: pro ? 'Metrics' : 'Graphs', icon: <LineChart className="size-3.5" /> },
    { id: 'console', label: 'Console', icon: <TerminalSquare className="size-3.5" /> },
    { id: 'networking', label: 'Networking', icon: <NetIcon className="size-3.5" />, count: c.ips.length + c.firewalls.length || undefined },
    { id: 'storage', label: 'Storage', icon: <HardDrive className="size-3.5" />, count: c.volumes.length + 1 },
    { id: 'snapshots', label: 'Backups', icon: <History className="size-3.5" />, count: c.snapshots.length || undefined },
    { id: 'rescale', label: 'Rescale', icon: <Scaling className="size-3.5" /> },
    { id: 'settings', label: 'Settings', icon: <Settings2 className="size-3.5" /> },
    ...(pro ? [{ id: 'activity', label: <span className="inline-flex items-center gap-1.5">Activity<ProBadge /></span>, icon: <Activity className="size-3.5" /> }] : []),
  ];
  // pro-only tab opened via a link while in simple mode → fall back to the overview
  const activeTab = tabs.some((t) => t.id === tab) ? tab : 'overview';

  return (
    <Page wide>
      <PageHeader
        title={vm.name}
        icon={Server}
        iconColor="#5b67f8"
        status={<StatusPill status={vm.status} />}
        crumbs={[{ label: 'Virtual Machines', to: '/infrastructure/vms' }, { label: vm.name }]}
        meta={<>
          <span className="font-medium tabular text-fg-2" title={`${vm.size.vcpus} vCPU · ${vm.size.ramGB} GB RAM`}>
            {[c.preset?.name ?? 'custom', archLabel(image), `${vm.size.systemDiskGB} GB`, vm.locationId].join(' | ')}
          </span>
          {pro && project && <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: project.color }} />{project.name}</span>}
          <span className="flex items-center gap-1.5"><OsBadge os={image?.os ?? 'custom'} size={14} />{image?.name ?? vm.imageId}</span>
          <span className="flex items-center gap-1.5" title={location?.name}>
            {location ? <span className="text-sm leading-none">{flagEmoji(location.country)}</span> : null}
            {location?.city ?? vm.locationId}
            {location?.kind === 'cloud' ? <Cloud className="size-3.5 text-sky-500" /> : <Building2 className="size-3.5 text-emerald-500" />}
            {pro && host && <span className="text-faint">· {host.name}</span>}
          </span>
          {pro && <Mono copy className="text-xs">{vm.id}</Mono>}
          {vm.deletionProtection && <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400" title="Deletion protection is on"><Lock className="size-3" />protected</span>}
          <div className="w-full"><HeaderAddresses c={c} onAssign={() => go('networking')} /></div>
        </>}
        actions={<>
          <PowerToggle vm={vm} pending={power.isPending && (power.variables === 'start' || power.variables === 'stop')} onStart={() => power.mutate('start')} onStop={() => power.mutate('stop')} />
          {running && <Button icon={RotateCw} loading={power.isPending && power.variables === 'reboot'} onClick={reboot} className="hidden @min-[60rem]:inline-flex">Reboot</Button>}
          <Button icon={TerminalSquare} onClick={() => go('console')} className="hidden @min-[60rem]:inline-flex">Console</Button>
          <Menu trigger={() => <Button icon={MoreHorizontal} iconRight={ChevronDown} aria-label="More actions">More</Button>} items={pro ? moreItems : simpleMoreItems} width="w-60" />
        </>}
      />

      {!provisioning && <SpecStrip c={c} />}

      {/* live provisioning / long running work */}
      {provisioning && op && (
        <div className="mb-6 grid gap-4 @min-[44rem]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <OperationRunner op={op} className="shadow-card" />
          <Card>
            <CardHeader title={op.type === 'vm.create' ? 'Setting up your VM' : 'Rebuilding'} icon={Server} description="You can leave this page — we'll notify you when it's ready." actions={<Bell className="size-4 text-faint" />} />
            <div className="space-y-4 p-4">
              <KeyValue items={[
                ['Image', <span key="i" className="flex items-center gap-1.5"><OsBadge os={image?.os ?? 'custom'} size={16} />{image?.name}</span>],
                ['Size', `${vm.size.vcpus} vCPU · ${vm.size.ramGB} GB · ${vm.size.systemDiskGB} GB`],
                ['Private IP', <Mono key="p">{vm.privateIp}</Mono>],
                ['Public IP', pub ? <Mono key="pub">{pub}</Mono> : 'none'],
                ['Volumes', String(c.volumes.length)],
                ['Run-rate', `${money(vm.monthlyCost)}/mo`],
              ]} />
              {pro && <PlacementVisual c={c} />}
            </div>
          </Card>
        </div>
      )}
      {op && !provisioning && (
        <OperationRunner op={op} compact className="mb-5 shadow-card" />
      )}
      {failedCreate && (
        <div className="mb-5 overflow-hidden rounded-xl border border-rose-500/30 bg-rose-500/5">
          <div className="flex flex-wrap items-center gap-3 p-4">
            <X className="size-5 shrink-0 rounded-full bg-rose-500 p-0.5 text-white" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-fg">{failedCreate.type === 'vm.create' ? 'Provisioning failed' : 'Rebuild failed'}</div>
              <div className="text-[13px] text-rose-700 dark:text-rose-300">{failedCreate.error}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setShowFailLog((s) => !s)}>{showFailLog ? 'Hide' : 'Show'} logs</Button>
            <Button size="sm" icon={RefreshCcw} onClick={() => setModal('rebuild')}>Rebuild</Button>
            <Button size="sm" variant="danger" icon={Trash2} onClick={remove}>Delete VM</Button>
          </div>
          {showFailLog && <OperationRunner op={failedCreate} className="m-4 mt-0" />}
        </div>
      )}
      {justCreated && running && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 @min-[36rem]:flex-row @min-[36rem]:items-center">
          <CheckCircle2 className="size-6 shrink-0 text-emerald-500" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-fg">{vm.name} is up and running</div>
            <div className="text-xs text-muted">Provisioned in {duration(Date.parse(justCreated.finishedAt!) - Date.parse(justCreated.startedAt ?? justCreated.createdAt))} on {host?.name ?? location?.name}. Connect with:</div>
          </div>
          <CodeBlock className="min-w-0 @min-[36rem]:w-80" code={image?.os === 'windows' ? `mstsc /v:${pub ?? vm.privateIp}` : `ssh ${defaultUser(image)}@${pub ?? vm.privateIp}`} language="bash" />
          <button onClick={() => setDismissed(justCreated.id)} className="self-start rounded p-1 text-faint hover:text-fg @min-[36rem]:self-center" aria-label="Dismiss"><X className="size-4" /></button>
        </div>
      )}

      <Tabs tabs={tabs} value={activeTab} onChange={setTab} className="mb-5" />

      {activeTab === 'overview' && <VmOverview c={c} go={go} />}
      {activeTab === 'metrics' && (
        <>
          {!running && <div className="mb-3 rounded-lg border border-line bg-surface-2 p-2.5 text-xs text-muted">The VM is {vm.status}; utilization drops to zero while it is not running. Disk usage is still reported.</div>}
          <MetricsPanel collection="vms" id={vm.id} charts={metricCharts} cols={2} live={running} />
        </>
      )}
      {activeTab === 'console' && (
        <div className="space-y-3">
          <VmConsole vm={vm} image={image} volumes={c.volumes} publicIps={c.ips.map((i) => i.address)} network={c.network} hostName={host?.name} sshKeys={c.sshKeys}
            cpu={live?.series?.cpu?.points.at(-1)?.v} ram={live?.series?.ram?.points.at(-1)?.v} onPower={onPower} />
          <p className="text-xs text-muted">{pro ? 'The serial console works even without network access or SSH keys — use it to debug boot problems or firewall lock-outs. Sessions are audited.' : 'Works even without network access or SSH keys.'}</p>
        </div>
      )}
      {activeTab === 'networking' && <VmNetworking c={c} />}
      {activeTab === 'storage' && <VmStorage c={c} onResize={() => setModal('resize')} onNewVolume={() => setModal('newVolume')} />}
      {activeTab === 'snapshots' && <VmSnapshots c={c} onSnapshot={snapshotNow} />}
      {activeTab === 'rescale' && <VmRescale c={c} />}
      {activeTab === 'settings' && <VmSettings c={c} onRebuild={() => setModal('rebuild')} onDelete={remove} />}
      {activeTab === 'activity' && (
        <div className="grid gap-5 @min-[60rem]:grid-cols-2">
          <Card>
            <CardHeader title="Operations" icon={History} description="Long-running tasks with step logs" />
            <OperationsHistory ops={ops} />
          </Card>
          <Card>
            <CardHeader title="Audit log" icon={Activity} description="Every change, who made it and from where" />
            <ActivityFeed targetId={vm.id} limit={100} />
          </Card>
        </div>
      )}

      <ResizeVmModal vm={vm} open={modal === 'resize'} onClose={() => setModal(null)} isCloud={location?.kind === 'cloud'} extras={{ publicIpv4: c.ips.filter((i) => i.version === 4).length }} />
      <MigrateVmModal vm={vm} open={modal === 'migrate'} onClose={() => setModal(null)} />
      <RebuildVmModal vm={vm} open={modal === 'rebuild'} onClose={() => setModal(null)} />
      <CloneVmModal vm={vm} open={modal === 'clone'} onClose={() => setModal(null)} />
      <SnapshotVmModal vm={vm} open={modal === 'snapshot'} onClose={() => setModal(null)} />
      <NewVolumeModal vm={vm} open={modal === 'newVolume'} onClose={() => setModal(null)} location={location} />
      <RenameModal title={`Rename ${vm.name}`} current={vm.name} open={modal === 'rename'} onClose={() => setModal(null)} onSave={async (name) => { await api.update('vms', vm.id, { name }); toast.success(`Renamed to ${name}`) }} />
    </Page>
  );
}

function OperationsHistory({ ops }: { ops: Operation[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!ops.length) return <EmptyState title="No operations yet" className="py-10" />;
  return (
    <ul className="divide-y divide-line">
      {ops.slice(0, 30).map((o) => (
        <li key={o.id}>
          <button onClick={() => setOpen((x) => (x === o.id ? null : o.id))} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2/60">
            <StatusPill status={o.status} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{o.title}</span>
            <span className="hidden text-xs text-muted @min-[36rem]:inline">{o.actor}</span>
            <span className="shrink-0 text-xs text-faint" title={dateTime(o.createdAt)}>{timeAgo(o.createdAt)}</span>
            <ChevronDown className={cn('size-3.5 shrink-0 text-faint transition-transform', open === o.id && 'rotate-180')} />
          </button>
          {open === o.id && <div className="px-4 pb-3"><OperationRunner op={o} compact /></div>}
        </li>
      ))}
    </ul>
  );
}
