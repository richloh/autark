import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Cpu, MoreHorizontal, Wrench, Play, HeartPulse, Server, MemoryStick, Gpu, HardDrive, Network, Thermometer, Fan, Zap, Activity, Settings, ScrollText,
  AlertTriangle, CheckCircle2, XCircle, MoveRight, RefreshCcw, Power, Info, Save, Building2, Clock, RotateCw,
} from 'lucide-react';
import { useItem, useList, useLookup, useMetrics, useApiMutation, useActiveOperation } from '@/api/hooks';
import { api } from '@/api/client';
import { useUi, usePro } from '@/store/ui';
import { Pro } from '@/components/ui/Pro';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardHeader, CardBody, KeyValue } from '@/components/ui/Card';
import { Tabs, useTabParam, Segmented } from '@/components/ui/Tabs';
import { StatusPill, Badge, Tags } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Menu } from '@/components/ui/Menu';
import { Modal } from '@/components/ui/Modal';
import { Meter, Mono, Skeleton, EmptyState } from '@/components/ui/misc';
import { Field, Input, NumberInput, TagEditor, Textarea, Hint } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { IacTabs, toCli, toCurl } from '@/components/ui/CodeBlock';
import { toast } from '@/components/ui/toast';
import { MetricsPanel } from '@/components/charts/MetricsPanel';
import { Treemap } from '@/components/charts/Treemap';
import { OperationRunner } from '@/components/resource/OperationRunner';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { RackElevation } from '@/components/hardware/RackElevation';
import { Gauge, AllocationBar } from '@/components/hardware/gauges';
import { useHostActions } from '@/components/hardware/hostActions';
import { HOST_STATUS_HEX, hostStatusLabel, hostUtil, gpuTotal, flag, utilColor } from '@/components/hardware/visuals';
import { HostPolicyTab } from '@/components/hardware/HostPolicyTab';
import { PolicySummary, RoleChips, AccessLock, usePolicyNames } from '@/components/hardware/policy';
import { hostRoles, policyReason, runsWorkloads, type PolicyNames } from '@/lib/hostPolicy';
import { cn } from '@/lib/cn';
import { timeAgo, dateTime, num, duration } from '@/lib/format';
import type { BareMetalHost, HostVmSummary, Location, Project } from '@/types';

export default function HostDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: h, isLoading, error } = useItem<BareMetalHost>('hosts', id, { refetchInterval: 10_000 });
  const { items: allHosts } = useList<BareMetalHost>('hosts');
  const { map: locations } = useLookup<Location>('locations');
  const { map: projects } = useLookup<Project>('projects');
  const op = useActiveOperation(id);
  const pro = usePro();
  const [tabParam, setTab] = useTabParam('overview');
  const tab = pro || ['overview', 'vms', 'policy', 'settings'].includes(tabParam) ? tabParam : 'overview';
  const actions = useHostActions();
  const { names } = usePolicyNames();

  if (isLoading) return <Page><Skeleton className="mb-4 h-12 w-80" /><Skeleton className="h-96 rounded-xl" /></Page>;
  if (error || !h) return <Page><EmptyState icon={Cpu} title="Host not found" description="It may have been decommissioned." action={<Button to="/hardware/bare-metals">Back to hosts</Button>} /></Page>;

  const loc = locations.get(h.locationId);
  const rackHosts = allHosts.filter((x) => x.locationId === h.locationId && x.rack === h.rack);
  const health = h.lastHealthCheck;

  return (
    <Page wide>
      <PageHeader
        title={h.name}
        icon={Cpu}
        iconColor={HOST_STATUS_HEX[h.status]}
        crumbs={[{ label: 'Bare Metal Hosts', to: '/hardware/bare-metals' }, { label: h.name }]}
        status={<StatusPill status={h.status} label={hostStatusLabel[h.status]?.toLowerCase()} />}
        meta={<>
          <span className="flex items-center gap-1">{flag(loc?.country)} {loc?.name ?? h.locationId}</span>
          {pro && <span className="flex items-center gap-1"><Server className="size-3" />{h.rack} · U{h.rackUnit}{h.sizeU > 1 ? `–${h.rackUnit + h.sizeU - 1}` : ''}</span>}
          <span>{h.vendor} {h.model}</span>
          <RoleChips roles={hostRoles(h)} compact />
          <AccessLock h={h} names={names} withText />
          {h.cpuCores > 0 && !pro && <span>{h.cpuCores} cores · {num(h.ramGB)} GB</span>}
          {pro && <span className="font-mono">{h.mgmtIp}</span>}
          {h.status !== 'offline' && h.status !== 'provisioning' && <span className="flex items-center gap-1"><Clock className="size-3" />up {duration(Date.now() - Date.parse(h.bootedAt))}</span>}
        </>}
        actions={<>
          {h.status === 'maintenance'
            ? <Button icon={Play} disabled={!!op} onClick={() => actions.act(h, 'exitMaintenance', `Returning ${h.name} to service`)}>Exit maintenance</Button>
            : <Button icon={Wrench} disabled={!!op || !['ready', 'draining', 'error'].includes(h.status)} onClick={() => actions.openMaintenance(h)}>Maintenance…</Button>}
          {pro && <Button icon={HeartPulse} disabled={!!op || !['ready', 'maintenance', 'draining', 'error'].includes(h.status)} onClick={() => actions.act(h, 'runHealthCheck', 'Health check started')}>Health check</Button>}
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="More actions" variant="secondary" />} items={actions.items(h)} />
        </>}
      />

      {op && <OperationRunner op={op} className="mb-5" compact={op.type !== 'bareMetal.enroll'} />}
      <StatusBanner h={h} busy={!!op} actions={actions} onHealth={pro ? () => setTab('health') : undefined} />

      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={pro ? [
        { id: 'overview', label: 'Overview' },
        { id: 'vms', label: 'Virtual machines', count: h.vms?.length ?? 0 },
        { id: 'hardware', label: 'Hardware' },
        { id: 'health', label: 'Health', icon: health && health.result !== 'passed' ? <span className={cn('size-1.5 rounded-full', health.result === 'failed' ? 'bg-rose-500' : 'bg-amber-500')} /> : undefined },
        { id: 'metrics', label: 'Metrics' },
        { id: 'activity', label: 'Activity' },
        { id: 'policy', label: 'Policy' },
        { id: 'settings', label: 'Settings' },
      ] : [
        { id: 'overview', label: 'Overview' },
        { id: 'vms', label: 'Virtual machines', count: h.vms?.length ?? 0 },
        { id: 'policy', label: 'Policy' },
        { id: 'settings', label: 'Settings' },
      ]} />

      {tab === 'overview' && (
        <div className="grid gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-5">
            <CapacityCard h={h} projects={projects} />
            <Pro><LiveSensors h={h} /></Pro>
            <Card>
              <CardHeader title={pro ? 'System' : 'Specs'} icon={Info} />
              <CardBody>
                <KeyValue cols={3} items={!pro ? [
                  ['Model', `${h.vendor} ${h.model}`],
                  ['Location', `${flag(loc?.country)} ${loc?.name ?? h.locationId}`],
                  ['CPU', h.cpuCores ? `${h.cpuCores} cores · ${h.cpuModel}` : '—'],
                  ['Memory', h.ramGB ? `${num(h.ramGB)} GB` : '—'],
                  ['GPUs', gpuTotal(h) ? h.gpus.map((g) => `${g.count}× ${g.model}`).join(', ') : 'none'],
                  ['Local disks', h.disks.length ? `${h.disks.length} · ${num(h.disks.reduce((a, d) => a + d.sizeGB, 0))} GB` : '—'],
                  ['IP address', <Mono copy>{h.mgmtIp}</Mono>],
                  ['Enrolled', dateTime(h.createdAt)],
                  ['Last boot', h.status === 'offline' ? 'powered off' : timeAgo(h.bootedAt)],
                ] : [
                  ['Vendor / model', `${h.vendor} ${h.model}`],
                  ['Serial', <Mono copy>{h.serial || '—'}</Mono>],
                  ['CPU', `${h.cpuModel || '—'}`],
                  ['Cores / threads', h.cpuCores ? `${h.sockets}S · ${h.cpuCores}C · ${h.threads}T` : '—'],
                  ['Memory', h.ramGB ? `${num(h.ramGB)} GB ECC` : '—'],
                  ['GPUs', gpuTotal(h) ? h.gpus.map((g) => `${g.count}× ${g.model}`).join(', ') : 'none'],
                  ['Hypervisor', h.hypervisor === 'KVM' ? `KVM · kernel ${h.kernel}` : 'none (storage node)'],
                  ['Agent', <span className="flex items-center gap-1.5">{h.agentVersion}{h.agentUpdateAvailable && <Badge tone="brand">→ {h.latestAgentVersion}</Badge>}</span>],
                  ['Management IP', <Mono copy>{h.mgmtIp}</Mono>],
                  ['BMC', <Mono copy={h.bmcIp}>{`${h.bmcUser ?? 'root'}@${h.bmcIp}`}</Mono>],
                  ['Enrolled', dateTime(h.createdAt)],
                  ['Last boot', h.status === 'offline' ? 'powered off' : timeAgo(h.bootedAt)],
                ]} />
                {pro && h.tags.length > 0 && <div className="mt-4 border-t border-line pt-3"><Tags tags={h.tags} max={10} /></div>}
              </CardBody>
            </Card>
          </div>
          <div className="space-y-5">
            <Pro>
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between text-sm font-semibold text-fg"><span className="flex items-center gap-1.5"><Building2 className="size-4 text-muted" />Rack position</span><Link to="/hardware/bare-metals" className="text-xs font-normal text-brand-500 hover:underline">All racks</Link></div>
              <div className="flex justify-center">
                <RackElevation name={h.rack} className="w-[230px]" uHeight={9} hosts={rackHosts} highlightId={h.id} onSelect={(x) => x.id !== h.id && navigate(`/hardware/bare-metals/${x.id}`)} subtitle={loc?.name} />
              </div>
            </Card>
            </Pro>
            <PolicySummary h={h} names={names} onEdit={() => setTab('policy')} />
            <QuickHealth h={h} onOpen={pro ? () => setTab('health') : undefined} busy={!!op} onRun={() => actions.act(h, 'runHealthCheck', 'Health check started')} />
          </div>
        </div>
      )}

      {tab === 'vms' && <VmsTab h={h} hosts={allHosts} projects={projects} names={names} />}
      {tab === 'policy' && <HostPolicyTab h={h} />}
      {tab === 'hardware' && <HardwareTab h={h} actions={actions} busy={!!op} />}
      {tab === 'health' && <HealthTab h={h} busy={!!op} onRun={() => actions.act(h, 'runHealthCheck', 'Health check started')} />}
      {tab === 'metrics' && (
        <MetricsPanel collection="hosts" id={h.id} live={h.status !== 'offline'} charts={[
          { title: 'CPU utilisation', metrics: ['cpu'], unit: '%', max: 100 },
          { title: 'Memory used', metrics: ['ram'], unit: '%', max: 100 },
          { title: 'Power draw', metrics: ['power'], unit: 'W', colors: ['#f59e0b'] },
          { title: 'Temperatures', metrics: ['inletTemp', 'cpuTemp'], labels: ['Inlet', 'CPU'], unit: '°C', colors: ['#06b6d4', '#f43f5e'] },
          { title: 'Network', metrics: ['netIn', 'netOut'], labels: ['In', 'Out'], unit: 'Gbps', format: (v) => v.toFixed(2) },
          { title: 'Disk I/O', metrics: ['diskRead', 'diskWrite'], labels: ['Read', 'Write'], unit: 'MB/s' },
          ...(gpuTotal(h) ? [{ title: 'GPU utilisation', metrics: ['gpu'], unit: '%', max: 100, colors: ['#8b5cf6'] }] : []),
        ]} />
      )}
      {tab === 'activity' && <Card><ActivityFeed targetId={h.id} /></Card>}
      {tab === 'settings' && <SettingsTab h={h} actions={actions} busy={!!op} />}

      {actions.modal}
    </Page>
  );
}

/* ------------------------------------------------------------------ banners */

function StatusBanner({ h, busy, actions, onHealth }: { h: BareMetalHost; busy: boolean; actions: ReturnType<typeof useHostActions>; onHealth?: () => void }) {
  const box = 'mb-5 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-[13px]';
  if (h.status === 'maintenance') return (
    <div className={cn(box, 'border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-200')}>
      <Wrench className="size-4 shrink-0" />
      <div className="min-w-0 flex-1"><b className="font-semibold">In maintenance</b> — no VMs are scheduled here. {h.maintenanceReason && <span className="opacity-80">Reason: {h.maintenanceReason}</span>}</div>
      <Button size="sm" icon={Play} disabled={busy} onClick={() => actions.act(h, 'exitMaintenance', `Returning ${h.name} to service`)}>Exit maintenance</Button>
    </div>
  );
  if (h.status === 'draining') return (
    <div className={cn(box, 'border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-200')}>
      <Info className="size-4 shrink-0" />
      <div className="min-w-0 flex-1"><b className="font-semibold">Cordoned</b> — existing VMs keep running, but no new VMs are placed on this host.</div>
      {!busy && <Button size="sm" onClick={() => actions.act(h, 'exitMaintenance', `${h.name} accepts new VMs again`)}>Uncordon</Button>}
    </div>
  );
  if (h.status === 'offline') return (
    <div className={cn(box, 'border-rose-500/30 bg-rose-500/5 text-rose-900 dark:text-rose-200')}>
      <Power className="size-4 shrink-0" />
      <div className="min-w-0 flex-1"><b className="font-semibold">Powered off</b> — the BMC is reachable; the host can be powered on remotely.{h.tags.some((t) => t.key === 'incident') && <span className="opacity-80"> Open incident: {h.tags.find((t) => t.key === 'incident')?.value}</span>}</div>
      <Button size="sm" icon={Power} disabled={busy} onClick={() => actions.act(h, 'powerOn', `Powering on ${h.name}`)}>Power on</Button>
    </div>
  );
  if ((h.status === 'error' || h.status === 'provisioning') && !busy) return (
    <div className={cn(box, h.status === 'error' ? 'border-rose-500/30 bg-rose-500/5 text-rose-900 dark:text-rose-200' : 'border-sky-500/30 bg-sky-500/5 text-sky-900 dark:text-sky-200')}>
      <AlertTriangle className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">{h.status === 'error' ? <><b className="font-semibold">Enrollment failed.</b> Check the operation log in Activity, fix the cause and retry.</> : <><b className="font-semibold">Enrollment paused.</b> The control plane lost track of this enrollment — resume it to continue.</>}</div>
      <Button size="sm" icon={RefreshCcw} onClick={() => actions.act(h, 'retryEnrollment', `Retrying enrollment of ${h.name}`)}>{h.status === 'error' ? 'Retry enrollment' : 'Resume enrollment'}</Button>
    </div>
  );
  if (h.lastHealthCheck && h.lastHealthCheck.result !== 'passed') {
    const bad = h.lastHealthCheck.checks.filter((c) => c.status !== 'ok');
    return (
      <button type="button" onClick={onHealth} disabled={!onHealth} className={cn(box, 'w-full text-left disabled:cursor-default', h.lastHealthCheck.result === 'failed' ? 'border-rose-500/30 bg-rose-500/5 text-rose-900 dark:text-rose-200' : 'border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-200')}>
        <HeartPulse className="size-4 shrink-0" />
        <span className="min-w-0 flex-1"><b className="font-semibold">Health check {h.lastHealthCheck.result === 'failed' ? 'failed' : 'found warnings'}</b> {timeAgo(h.lastHealthCheck.at)}: {bad.map((c) => `${c.name} — ${c.detail}`).join(' · ')}</span>
        {onHealth && <span className="text-xs font-medium underline-offset-2 hover:underline">Details</span>}
      </button>
    );
  }
  return null;
}

/* ------------------------------------------------------------------ overview */

type ManagedKind = 'db' | 'k8s' | 'k8s-cp' | 'lb';
const MANAGED: Record<ManagedKind, { color: string; label: string; legend: string; link: (id: string) => string }> = {
  db: { color: '#3b82f6', label: 'Managed database', legend: 'Managed databases', link: (id) => `/managed-services/db/${id}` },
  k8s: { color: '#326ce5', label: 'Kubernetes worker node', legend: 'Kubernetes workers', link: (id) => `/managed-services/kubernetes/${id}` },
  'k8s-cp': { color: '#0891b2', label: 'Kubernetes control plane', legend: 'Control planes', link: (id) => `/managed-services/kubernetes/${id}` },
  lb: { color: '#c026d3', label: 'Load balancer node', legend: 'Load balancers', link: (id) => `/managed-services/load-balancers/${id}` },
};

function CapacityCard({ h, projects }: { h: BareMetalHost; projects: Map<string, Project> }) {
  const pro = usePro();
  const [viewState, setView] = useState<'bars' | 'treemap'>('bars');
  const view = pro ? viewState : 'bars';
  const u = hostUtil(h);
  const vms = h.vms ?? [];
  const accountId = useUi((s) => s.accountId);
  const seg = (v: HostVmSummary, value: number) => ({
    id: v.id, label: v.name, value, color: projects.get(v.projectId)?.color ?? '#64748b', link: v.accountId === accountId ? `/infrastructure/vms/${v.id}` : undefined,
    sub: `${projects.get(v.projectId)?.name ?? v.projectId} · ${v.status}`,
  });
  const usedProjects = [...new Set(vms.map((v) => v.projectId))];
  const managed: { kind: ManagedKind; id: string; name: string; vcpus: number; ramGB: number; gpus?: number }[] = (h.allocated as any)?.managedItems ?? [];
  const mseg = (m: (typeof managed)[number], value: number) => ({
    id: `${m.kind}-${m.name}`, label: m.name, value, color: MANAGED[m.kind].color, link: MANAGED[m.kind].link(m.id), sub: MANAGED[m.kind].label,
  });
  if (!runsWorkloads(h)) return (
    <Card><CardHeader title="Capacity" icon={Activity} /><CardBody><Hint>{h.hypervisor !== 'KVM' ? 'This is a storage node (no hypervisor).' : 'This host only has the Storage role.'} It serves the Ceph cluster of {h.locationId} ({num(Math.round(h.disks.reduce((a, d) => a + d.sizeGB, 0) / 100) / 10)} TB raw) and does not run VMs or other workloads.</Hint></CardBody></Card>
  );
  return (
    <Card>
      <CardHeader title={pro ? 'Capacity allocation' : 'Allocation'} icon={Activity} description={`${vms.length} VM${vms.length === 1 ? '' : 's'}${managed.length ? ` + ${managed.length} managed workload${managed.length === 1 ? '' : 's'}${pro ? ` (${[...new Set(managed.map((m) => MANAGED[m.kind].legend.toLowerCase()))].join(', ')})` : ''}` : ''} on this host`}
        actions={pro && <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'bars', label: 'Bars' }, { value: 'treemap', label: 'Treemap' }]} />} />
      <CardBody className="space-y-6">
        {view === 'bars' ? (
          <>
            <AllocationBar title="vCPU" unit="vCPU" capacity={u.cap.vcpus} physical={h.threads} overcommit={h.cpuOvercommit} segments={[...vms.map((v) => seg(v, v.vcpus)), ...managed.map((m) => mseg(m, m.vcpus))]} />
            <AllocationBar title="Memory" unit="GB" capacity={u.cap.ramGB} physical={Math.floor(h.ramGB * 0.92)} overcommit={h.ramOvercommit} segments={[...vms.map((v) => seg(v, v.ramGB)), ...managed.map((m) => mseg(m, m.ramGB))]} />
          </>
        ) : vms.length + managed.length ? (
          <div>
            <div className="mb-2 text-xs text-muted">VMs sized by memory · free space shown in grey</div>
            <Treemap height={240} format={(v) => `${v} GB`} items={[
              ...vms.map((v) => ({ id: v.id, label: v.name, value: v.ramGB, color: projects.get(v.projectId)?.color ?? '#64748b', link: v.accountId === accountId ? `/infrastructure/vms/${v.id}` : undefined, sub: `${v.vcpus} vCPU · ${projects.get(v.projectId)?.name ?? ''}` })),
              ...managed.map((m) => ({ ...mseg(m, m.ramGB), sub: `${m.vcpus} vCPU · ${mseg(m, 0).sub}` })),
              ...(u.cap.ramGB - u.a.ramGB > 0 ? [{ id: 'free', label: 'Free', value: u.cap.ramGB - u.a.ramGB, color: '#94a3b8', sub: 'schedulable' }] : []),
            ]} />
          </div>
        ) : <EmptyState icon={Server} title="No VMs on this host" description="New VMs in this location are scheduled onto the host with the most free memory." />}
        <div className="grid gap-4 @min-[36rem]:grid-cols-2">
          {u.cap.gpus > 0 && (
            <div>
              <div className="mb-1.5 flex justify-between text-[13px]"><span className="font-medium text-fg">GPU slots</span><span className="text-xs tabular text-muted">{u.a.gpus} / {u.cap.gpus} allocated</span></div>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: u.cap.gpus }, (_, i) => {
                  const owner = (() => { let n = 0; for (const v of vms) { n += v.gpus; if (i < n) return { name: v.name, color: projects.get(v.projectId)?.color } } for (const m of managed) { n += m.gpus ?? 0; if (i < n) return { name: m.name, color: '#326ce5' } } return null })();
                  return (
                    <div key={i} title={owner ? `GPU ${i}: ${owner.name}` : `GPU ${i}: free`} className={cn('flex h-10 w-14 flex-col items-center justify-center rounded-md border text-[9px] font-semibold', owner ? 'border-transparent text-white' : 'border-dashed border-line-strong text-faint')}
                      style={owner ? { background: owner.color ?? '#8b5cf6' } : undefined}>
                      <Gpu className="size-3.5" />{h.gpus[0]?.model}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {pro && <div>
            <div className="mb-1.5 flex justify-between text-[13px]"><span className="font-medium text-fg">Local disk (system disks)</span><span className="text-xs tabular text-muted">{num(u.a.diskGB)} / {num(u.cap.diskGB)} GB</span></div>
            <Meter value={u.a.diskGB} max={u.cap.diskGB || 1} />
            <div className="mt-1 text-[11px] text-muted">Data volumes live on the replicated Ceph cluster, not on this host.</div>
          </div>}
        </div>
        {(usedProjects.length > 0 || managed.length > 0) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[11px] text-muted">
            {usedProjects.map((p) => <span key={p} className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: projects.get(p)?.color ?? '#64748b' }} />{projects.get(p)?.name ?? p}</span>)}
            {(Object.keys(MANAGED) as ManagedKind[]).filter((k) => managed.some((m) => m.kind === k)).map((k) => <span key={k} className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: MANAGED[k].color }} />{MANAGED[k].legend}</span>)}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function useLiveSensors(h: BareMetalHost) {
  const { data } = useMetrics('hosts', h.id, ['cpu', 'ram', 'power', 'inletTemp', 'cpuTemp'], '15m');
  const last = (m: string) => { const p = data?.series[m]?.points; return p?.length ? p[p.length - 1].v : 0 };
  return { cpu: last('cpu'), ram: last('ram'), power: last('power'), inlet: last('inletTemp'), cpuTemp: last('cpuTemp'), ready: !!data };
}

function LiveSensors({ h }: { h: BareMetalHost }) {
  const s = useLiveSensors(h);
  const off = h.status === 'offline';
  const psuCap = h.sensors?.psus[0]?.capacityW ?? 1600;
  return (
    <Card>
      <CardHeader title="Live sensors" icon={Thermometer} description="Read from the BMC via Redfish every few seconds."
        actions={<span className="flex items-center gap-1.5 text-xs text-muted"><span className="relative flex size-2"><span className={cn('absolute inline-flex size-full rounded-full opacity-60', !off && 'animate-ping bg-emerald-400')} /><span className={cn('relative inline-flex size-2 rounded-full', off ? 'bg-faint' : 'bg-emerald-500')} /></span>{off ? 'offline' : 'live'}</span>} />
      <div className="grid grid-cols-2 justify-items-center gap-y-4 p-4 @min-[36rem]:grid-cols-4">
        <Gauge label="CPU load" value={s.cpu} max={100} warn={80} crit={95} unit="%" off={off} />
        <Gauge label="CPU temp" value={s.cpuTemp} min={20} max={100} warn={80} crit={90} unit="°C" off={off} />
        <Gauge label="Inlet temp" value={s.inlet} min={10} max={40} warn={27} crit={32} unit="°C" format={(v) => v.toFixed(1)} />
        <Gauge label={`Power (PSU ${psuCap} W)`} value={s.power} max={psuCap} warn={psuCap * 0.8} crit={psuCap * 0.95} unit="W" off={off} />
      </div>
    </Card>
  );
}

function QuickHealth({ h, onOpen, onRun, busy }: { h: BareMetalHost; onOpen?: () => void; onRun: () => void; busy: boolean }) {
  const hc = h.lastHealthCheck;
  const s = h.sensors;
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-fg"><HeartPulse className="size-4 text-muted" />Health</span>
        {onOpen
          ? <button type="button" onClick={onOpen} className="text-xs text-brand-500 hover:underline">Details</button>
          : <button type="button" onClick={onRun} disabled={busy || !['ready', 'maintenance', 'draining', 'error'].includes(h.status)} className="text-xs text-brand-500 hover:underline disabled:text-faint disabled:no-underline">Run check</button>}
      </div>
      {hc ? (
        <ul className="space-y-1.5">
          {hc.checks.map((c) => (
            <li key={c.name} className="flex items-start gap-2 text-xs">
              <CheckIcon status={c.status} />
              <span className="min-w-0"><span className="text-fg-2">{c.name}</span>{!onOpen && c.status !== 'ok' && <span className="block text-[11px] text-muted">{c.detail}</span>}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted">No health check yet.</p>}
      {s && onOpen && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs">
          <div className="flex items-center gap-1.5 text-muted"><Fan className="size-3.5" />{s.fans.length} fans · {Math.round(s.fans.reduce((a, f) => a + f.rpm, 0) / Math.max(1, s.fans.length))} rpm</div>
          <div className="flex items-center gap-1.5 text-muted"><Zap className="size-3.5" />{s.psus.filter((p) => p.status === 'ok').length}/{s.psus.length} PSUs ok</div>
        </div>
      )}
      {hc && <div className="mt-2 text-[11px] text-faint">Last check {timeAgo(hc.at)}</div>}
    </Card>
  );
}

const CheckIcon = ({ status }: { status: string }) => status === 'ok'
  ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
  : status === 'warning' ? <AlertTriangle className="size-4 shrink-0 text-amber-500" /> : <XCircle className="size-4 shrink-0 text-rose-500" />;

/* ------------------------------------------------------------------ VMs */

function VmsTab({ h, hosts, projects, names }: { h: BareMetalHost; hosts: BareMetalHost[]; projects: Map<string, Project>; names: PolicyNames }) {
  const accountId = useUi((s) => s.accountId);
  const pro = usePro();
  const [migrating, setMigrating] = useState<HostVmSummary | null>(null);
  const vms = h.vms ?? [];
  const columns: Column<HostVmSummary>[] = [
    {
      id: 'name', header: 'VM', sort: (v) => v.name,
      cell: (v) => (
        <div className="min-w-0">
          {v.accountId === accountId
            ? <Link to={`/infrastructure/vms/${v.id}`} className="block truncate font-medium text-fg hover:text-brand-500">{v.name}</Link>
            : <span className="block truncate font-medium text-fg">{v.name}</span>}
          <div className="flex items-center gap-1.5 text-[11px] text-muted">{pro && <span className="font-mono">{v.id}</span>}{v.accountId !== accountId && <Badge className="h-4 px-1 text-[9.5px]">other account</Badge>}</div>
        </div>
      ),
    },
    { id: 'project', header: 'Project', hideBelow: 'md', sort: (v) => projects.get(v.projectId)?.name ?? '', cell: (v) => <span className="flex items-center gap-1.5 text-fg-2"><span className="size-2 rounded-full" style={{ background: projects.get(v.projectId)?.color }} />{projects.get(v.projectId)?.name ?? v.projectId}</span> },
    { id: 'status', header: 'Status', sort: (v) => v.status, cell: (v) => <StatusPill status={v.status} /> },
    { id: 'size', header: 'Size', sort: (v) => v.ramGB, cell: (v) => <span className="whitespace-nowrap tabular text-fg-2">{v.vcpus} vCPU · {v.ramGB} GB{v.gpus ? <Badge tone="violet" className="ml-1.5">{v.gpus}× GPU</Badge> : null}</span> },
    ...(!pro ? [] : [{ id: 'share', header: 'Share of host', hideBelow: 'lg' as const, sort: (v: HostVmSummary) => v.ramGB, cell: (v: HostVmSummary) => <div className="w-28"><Meter value={v.ramGB} max={hostUtil(h).cap.ramGB || 1} size="sm" tone="bg-brand-500" /></div> }]),
  ];
  return (
    <>
      <DataTable rows={vms} columns={columns} searchText={(v) => `${v.name} ${v.id} ${v.status}`} defaultSort={{ id: 'size', dir: 'desc' }}
        rowActions={(v) => <Button size="xs" variant="ghost" icon={MoveRight} disabled={!['running', 'stopped'].includes(v.status)} onClick={() => setMigrating(v)}>Migrate</Button>}
        toolbar={pro ? <span className="text-xs text-muted">Live migration moves running VMs with &lt;50 ms pause.</span> : undefined}
        empty={{ icon: Server, title: 'No VMs on this host', description: 'VMs are placed automatically on the best-fitting ready host in the location.' }} />
      <MigrateModal vm={migrating} host={h} hosts={hosts} names={names} onClose={() => setMigrating(null)} />
    </>
  );
}

function MigrateModal({ vm, host, hosts, names, onClose }: { vm: HostVmSummary | null; host: BareMetalHost; hosts: BareMetalHost[]; names: PolicyNames; onClose: () => void }) {
  const [target, setTarget] = useState<string>('auto');
  useEffect(() => setTarget('auto'), [vm?.id]);
  const candidates = useMemo(() => hosts.filter((x) => x.locationId === host.locationId && x.id !== host.id && x.hypervisor === 'KVM').map((x) => {
    const u = hostUtil(x);
    const fitsGpu = !vm?.gpus || (u.cap.gpus - u.a.gpus >= vm.gpus && x.gpus.some((g) => host.gpus.some((hg) => hg.model === g.model)));
    const policy = vm ? policyReason(x, { role: 'compute', accountId: vm.accountId, projectId: vm.projectId }, names) : null;
    const ok = !policy && x.status === 'ready' && !!vm && u.cap.vcpus - u.a.vcpus >= vm.vcpus && u.cap.ramGB - u.a.ramGB >= vm.ramGB && fitsGpu;
    const reason = policy ?? (x.status !== 'ready' ? x.status : !fitsGpu ? 'no free GPU' : 'insufficient capacity');
    return { x, u, ok, reason };
  }).sort((a, b) => Number(b.ok) - Number(a.ok) || (b.u.cap.ramGB - b.u.a.ramGB) - (a.u.cap.ramGB - a.u.a.ramGB)), [hosts, host, vm, names]);
  const m = useApiMutation(() => api.action('hosts', host.id, 'migrateVm', { vmId: vm!.id, hostId: target === 'auto' ? undefined : target }), {
    success: () => `Migrating ${vm?.name}`, onSuccess: onClose,
  });
  return (
    <Modal open={!!vm} onClose={onClose} size="md" title={`Migrate ${vm?.name ?? ''}`} description={vm?.status === 'running' ? 'Live migration: memory is pre-copied over the storage network, then the VM switches over with a pause under 50 ms.' : 'Cold migration: the VM is stopped, so only its definition moves (disks are on shared storage).'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={MoveRight} loading={m.isPending} disabled={target !== 'auto' && !candidates.find((c) => c.x.id === target)?.ok || !candidates.some((c) => c.ok)} onClick={() => m.mutate()}>Migrate</Button></>}>
      <div className="space-y-2">
        <button type="button" onClick={() => setTarget('auto')} className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left', target === 'auto' ? 'border-brand-500 bg-brand-500/5 ring-3 ring-brand-500/15' : 'border-line hover:bg-surface-2')}>
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand-500/10 text-brand-500"><RefreshCcw className="size-4" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-fg">Automatic placement</span><span className="text-xs text-muted">Scheduler picks the best ready host this VM's project may use</span></span>
        </button>
        {candidates.map(({ x, u, ok, reason }) => (
          <button key={x.id} type="button" disabled={!ok} onClick={() => setTarget(x.id)} className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-50', target === x.id ? 'border-brand-500 bg-brand-500/5 ring-3 ring-brand-500/15' : 'border-line hover:bg-surface-2')}>
            <span className="size-2 shrink-0 rounded-full" style={{ background: HOST_STATUS_HEX[x.status] }} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-mono text-[13px] text-fg">{x.name}</span>{!ok && <span className="min-w-0 truncate text-[11px] text-rose-500" title={reason}>{reason}</span>}</span>
              <span className="mt-1.5 grid grid-cols-2 gap-3">
                <MiniUse label="vCPU" used={u.a.vcpus} add={vm?.vcpus ?? 0} cap={u.cap.vcpus} />
                <MiniUse label="RAM" used={u.a.ramGB} add={vm?.ramGB ?? 0} cap={u.cap.ramGB} />
              </span>
            </span>
          </button>
        ))}
        {!candidates.length && <Hint tone="warning">No other hypervisor in {host.locationId}.</Hint>}
      </div>
    </Modal>
  );
}

function MiniUse({ label, used, add, cap }: { label: string; used: number; add: number; cap: number }) {
  const r0 = cap ? used / cap : 0, r1 = cap ? (used + add) / cap : 0;
  return (
    <span className="block">
      <span className="mb-0.5 flex justify-between text-[10px] text-muted"><span>{label}</span><span className="tabular">{used}+{add}/{cap}</span></span>
      <span className="relative block h-1.5 overflow-hidden rounded-full bg-surface-3">
        <span className="absolute inset-y-0 left-0 rounded-full opacity-40" style={{ width: `${Math.min(100, r1 * 100)}%`, background: utilColor(r1) }} />
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, r0 * 100)}%`, background: utilColor(r1) }} />
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ hardware */

function HardwareTab({ h, actions, busy }: { h: BareMetalHost; actions: ReturnType<typeof useHostActions>; busy: boolean }) {
  if (!h.cpuCores) return <Card><EmptyState icon={Cpu} title="Inventory pending" description="Hardware details appear once discovery has completed during enrollment." /></Card>;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 @min-[44rem]:grid-cols-3">
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-fg"><Cpu className="size-4 text-muted" />Processor</div>
          <div className="text-sm text-fg">{h.cpuModel}</div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[[h.sockets, 'sockets'], [h.cpuCores, 'cores'], [h.threads, 'threads']].map(([v, l]) => <div key={l} className="rounded-lg bg-surface-2 py-2"><div className="text-base font-semibold tabular text-fg">{v}</div><div className="text-[10px] text-muted">{l}</div></div>)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-fg"><MemoryStick className="size-4 text-muted" />Memory</div>
          <div className="text-2xl font-semibold tabular text-fg">{num(h.ramGB)} <span className="text-sm font-normal text-muted">GB ECC</span></div>
          <div className="mt-3 flex flex-wrap gap-1">
            {Array.from({ length: Math.min(24, Math.round(h.ramGB / (h.ramGB >= 512 ? 64 : 32))) }, (_, i) => <span key={i} className="h-6 w-2 rounded-sm bg-emerald-500/70" title={`DIMM ${i + 1}`} />)}
          </div>
          <div className="mt-1.5 text-[11px] text-muted">{Math.round(h.ramGB / (h.ramGB >= 512 ? 64 : 32))}× {h.ramGB >= 512 ? 64 : 32} GB DIMMs</div>
        </Card>
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-fg"><Settings className="size-4 text-muted" />Firmware</div>
          <KeyValue cols={1} items={[['BIOS', <Mono>{h.firmware?.bios ?? '—'}</Mono>], ['BMC', <span className="flex items-center gap-2"><Mono>{h.firmware?.bmc ?? '—'}</Mono>{h.firmwareUpdateAvailable && <Badge tone="warning">update available</Badge>}</span>], ['NIC', <Mono>{h.firmware?.nic ?? '—'}</Mono>]]} />
          {h.firmwareUpdateAvailable && (
            <Button size="sm" className="mt-3" disabled={busy || h.status !== 'maintenance'} onClick={() => actions.act(h, 'updateFirmware', `Flashing firmware on ${h.name}`)}>{h.status === 'maintenance' ? 'Update BMC firmware' : 'Enter maintenance to update'}</Button>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Disks" icon={HardDrive} description="SMART data collected by the agent. NVMe/SSD wear is the percentage of rated endurance used." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted">{['Slot', 'Model', 'Type', 'Capacity', 'SMART', 'Wear', 'Power-on', 'Temp'].map((c) => <th key={c} className="px-4 py-2 font-medium">{c}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {h.disks.map((d) => (
                <tr key={d.slot} className={cn(d.health !== 'ok' && 'bg-amber-500/[0.04]')}>
                  <td className="px-4 py-2.5 font-mono text-[12.5px] text-fg">{d.slot}</td>
                  <td className="px-4 py-2.5 text-fg-2">{d.model ?? '—'}</td>
                  <td className="px-4 py-2.5"><Badge tone={d.type === 'nvme' ? 'brand' : d.type === 'ssd' ? 'info' : 'neutral'}>{d.type.toUpperCase()}</Badge></td>
                  <td className="px-4 py-2.5 tabular text-fg">{d.sizeGB >= 1000 ? `${(d.sizeGB / 1000).toFixed(2)} TB` : `${d.sizeGB} GB`}</td>
                  <td className="px-4 py-2.5"><StatusPill status={d.health === 'ok' ? 'ok' : d.health} label={d.health === 'ok' ? 'healthy' : d.health} />{d.reallocatedSectors ? <div className="mt-0.5 text-[10.5px] text-amber-600 dark:text-amber-400">{d.reallocatedSectors} reallocated</div> : null}</td>
                  <td className="px-4 py-2.5">{d.type === 'hdd' ? <span className="text-xs text-faint">n/a</span> : <div className="flex w-32 items-center gap-2"><Meter value={d.wearPct} size="sm" thresholds={[0.6, 0.8]} /><span className="w-8 text-right text-xs tabular text-fg-2">{d.wearPct}%</span></div>}</td>
                  <td className="px-4 py-2.5 text-xs tabular text-muted">{d.powerOnHours != null ? `${num(d.powerOnHours)} h` : '—'}</td>
                  <td className="px-4 py-2.5 text-xs tabular text-muted">{d.tempC != null ? `${d.tempC}°C` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 @min-[44rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Network interfaces" icon={Network} />
          <ul className="divide-y divide-line">
            {h.nics.map((n) => (
              <li key={n.name} className="flex items-center gap-3 px-4 py-3">
                <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg border font-mono text-[10px] font-bold', n.link === 'up' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'border-rose-500/30 bg-rose-500/10 text-rose-500')}>{n.speedGbps}G</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="font-mono text-[13px] text-fg">{n.name}</span>{n.role && <Badge className="h-[18px] px-1.5 text-[10px]">{n.role}</Badge>}</div>
                  <div className="font-mono text-[11px] text-muted">{n.mac}{n.mtu ? ` · MTU ${n.mtu}` : ''}</div>
                </div>
                <StatusPill status={n.link} label={`link ${n.link}`} />
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Accelerators" icon={Gpu} />
          <CardBody>
            {gpuTotal(h) ? h.gpus.map((g) => (
              <div key={g.model} className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300"><Gpu className="size-6" /></div>
                <div className="flex-1">
                  <div className="font-medium text-fg">{g.count}× NVIDIA {g.model}</div>
                  <div className="text-xs text-muted">VFIO passthrough · {h.allocated?.gpus ?? 0} allocated to VMs</div>
                  <Meter className="mt-1.5" value={h.allocated?.gpus ?? 0} max={g.count} size="sm" tone="bg-violet-500" />
                </div>
              </div>
            )) : <p className="text-sm text-muted">No GPUs installed.</p>}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ health */

function HealthTab({ h, busy, onRun }: { h: BareMetalHost; busy: boolean; onRun: () => void }) {
  const s = useLiveSensors(h);
  const off = h.status === 'offline';
  const sensors = h.sensors;
  const hc = h.lastHealthCheck;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 @min-[56rem]:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title="Last health check" icon={HeartPulse} description={hc ? `${dateTime(hc.at)} · ${timeAgo(hc.at)}` : 'Never run'}
            actions={<Button size="sm" icon={HeartPulse} loading={busy} disabled={busy || !['ready', 'maintenance', 'draining', 'error'].includes(h.status)} onClick={onRun}>Run now</Button>} />
          {hc ? (
            <>
              <div className={cn('flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-medium', hc.result === 'passed' ? 'text-emerald-600 dark:text-emerald-400' : hc.result === 'warnings' ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400')}>
                <CheckIcon status={hc.result === 'passed' ? 'ok' : hc.result === 'warnings' ? 'warning' : 'failed'} />
                {hc.result === 'passed' ? 'All checks passed' : hc.result === 'warnings' ? `${hc.checks.filter((c) => c.status !== 'ok').length} warning(s)` : 'Failed'}
              </div>
              <ul className="divide-y divide-line">
                {hc.checks.map((c) => (
                  <li key={c.name} className="flex items-start gap-3 px-4 py-3">
                    <CheckIcon status={c.status} />
                    <div className="min-w-0"><div className="text-sm font-medium text-fg">{c.name}</div><div className="text-xs text-muted">{c.detail}</div></div>
                  </li>
                ))}
              </ul>
            </>
          ) : <EmptyState icon={HeartPulse} title="No health check yet" description="Checks BMC sensors, ECC memory, SMART, links, hypervisor and agent." />}
        </Card>
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold text-fg">Temperatures</div>
          <div className="grid grid-cols-2 justify-items-center">
            <Gauge size={120} label="Inlet" value={s.inlet} min={10} max={40} warn={27} crit={32} unit="°C" format={(v) => v.toFixed(1)} />
            <Gauge size={120} label="CPU package" value={s.cpuTemp} min={20} max={100} warn={80} crit={90} unit="°C" off={off} />
          </div>
          <p className="mt-2 text-[11px] text-muted">ASHRAE A1 recommends 18–27 °C inlet. Thresholds come from the BMC.</p>
        </Card>
      </div>

      {sensors && (
        <div className="grid gap-5 @min-[44rem]:grid-cols-2">
          <Card>
            <CardHeader title="Fans" icon={Fan} description={`${sensors.fans.length} fans · speed follows CPU temperature`} />
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 @min-[36rem]:grid-cols-3">
              {sensors.fans.map((f) => (
                <div key={f.id}>
                  <div className="mb-1 flex justify-between text-xs"><span className="flex items-center gap-1 text-muted"><Fan className={cn('size-3', f.rpm > 0 && 'animate-spin [animation-duration:1.4s]')} />{f.id}</span><span className="tabular text-fg-2">{num(f.rpm)} rpm</span></div>
                  <Meter value={f.rpm} max={16000} size="sm" thresholds={[0.7, 0.85]} />
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Power supplies" icon={Zap} description={`Current draw ${off ? 0 : Math.round(s.power)} W`} />
            <div className="grid gap-3 p-4 @min-[36rem]:grid-cols-2">
              {sensors.psus.map((p) => (
                <div key={p.id} className={cn('rounded-xl border p-3', p.status === 'ok' ? 'border-line' : 'border-rose-500/40 bg-rose-500/5')}>
                  <div className="flex items-center justify-between"><span className="font-mono text-[13px] font-medium text-fg">{p.id}</span><StatusPill status={p.status === 'ok' ? 'ok' : 'failed'} label={p.status === 'ok' ? 'ok' : 'failed'} /></div>
                  <div className="mt-2 text-xl font-semibold tabular text-fg">{p.watts} <span className="text-xs font-normal text-muted">/ {p.capacityW} W</span></div>
                  <Meter className="mt-1.5" value={p.watts} max={p.capacityW} size="sm" tone={p.status === 'ok' ? 'bg-amber-500' : 'bg-rose-500'} />
                  {p.status !== 'ok' && <div className="mt-1.5 text-[11px] text-rose-600 dark:text-rose-400">No input power — running without redundancy</div>}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ settings */

function SettingsTab({ h, actions, busy }: { h: BareMetalHost; actions: ReturnType<typeof useHostActions>; busy: boolean }) {
  const pro = usePro();
  const [oc, setOc] = useState({ cpu: String(h.cpuOvercommit), ram: String(h.ramOvercommit) });
  const [ocErr, setOcErr] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState({ name: h.name, rack: h.rack, rackUnit: h.rackUnit, notes: h.notes ?? '', tags: h.tags });
  const [metaErr, setMetaErr] = useState<Record<string, string>>({});
  useEffect(() => { setOc({ cpu: String(h.cpuOvercommit), ram: String(h.ramOvercommit) }) }, [h.cpuOvercommit, h.ramOvercommit]);
  useEffect(() => { setMeta({ name: h.name, rack: h.rack, rackUnit: h.rackUnit, notes: h.notes ?? '', tags: h.tags }) }, [h.id, h.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveOc = useApiMutation(() => api.action('hosts', h.id, 'setOvercommit', { cpuOvercommit: Number(oc.cpu), ramOvercommit: Number(oc.ram) }), {
    success: 'Overcommit updated', onSuccess: () => setOcErr({}), onError: (e) => setOcErr(fieldErrors(e)),
  });
  const saveMeta = useApiMutation(() => api.update('hosts', h.id, { name: meta.name, rack: meta.rack, rackUnit: meta.rackUnit, notes: meta.notes, tags: meta.tags }), {
    success: 'Host updated', onSuccess: () => setMetaErr({}), onError: (e) => setMetaErr(fieldErrors(e)),
  });
  const capV = h.threads * Number(oc.cpu);
  const capR = Math.floor(h.ramGB * Number(oc.ram) * 0.92);
  const a = h.allocated ?? { vcpus: 0, ramGB: 0 };
  const dirtyOc = Number(oc.cpu) !== h.cpuOvercommit || Number(oc.ram) !== h.ramOvercommit;

  return (
    <div className="grid gap-5 @min-[44rem]:grid-cols-2">
      {!pro && (
        <Card>
          <CardHeader title="Maintenance" icon={Wrench} />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><div className="text-sm font-medium text-fg">{h.status === 'maintenance' ? 'In maintenance' : 'Maintenance mode'}</div><div className="text-xs text-muted">{h.status === 'maintenance' ? 'No VMs run here right now.' : 'Moves all VMs to other hosts, without downtime.'}</div></div>
              {h.status === 'maintenance'
                ? <Button icon={Play} disabled={busy} onClick={() => actions.act(h, 'exitMaintenance', `Returning ${h.name} to service`)}>Exit maintenance</Button>
                : <Button icon={Wrench} disabled={busy || !['ready', 'draining', 'error'].includes(h.status)} onClick={() => actions.openMaintenance(h)}>Enter maintenance…</Button>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
              <div><div className="text-sm font-medium text-fg">Reboot</div><div className="text-xs text-muted">Restarts the server. It rejoins automatically.</div></div>
              <Button icon={RotateCw} disabled={busy || !['ready', 'maintenance', 'draining', 'error'].includes(h.status)} onClick={() => actions.reboot(h)}>Reboot…</Button>
            </div>
          </CardBody>
        </Card>
      )}
      {pro && <Card>
        <CardHeader title="Overcommit" icon={Activity} description="How many virtual resources the scheduler may hand out per physical resource on this host." />
        <CardBody className="space-y-4">
          <Field label="CPU (vCPU per hardware thread)" error={ocErr.cpuOvercommit} hint={`${h.threads} threads → ${capV} vCPU · ${a.vcpus} allocated`}>
            <Segmented value={oc.cpu} onChange={(v) => setOc({ ...oc, cpu: v })} options={['1', '2', '3', '4', '6', '8'].map((v) => ({ value: v, label: `${v}×` }))} />
          </Field>
          <Field label="RAM" error={ocErr.ramOvercommit} hint={`${h.ramGB} GB → ${capR} GB · ${a.ramGB} GB allocated${Number(oc.ram) > 1 ? ' · relies on KSM & ballooning' : ''}`}>
            <Segmented value={oc.ram} onChange={(v) => setOc({ ...oc, ram: v })} options={['1', '1.25', '1.5'].map((v) => ({ value: v, label: `${v}×` }))} />
          </Field>
          {(a.vcpus > capV || a.ramGB > capR) && <Hint tone="danger">Current allocation exceeds this capacity — migrate VMs away first.</Hint>}
          <div className="flex justify-end"><Button variant="primary" icon={Save} disabled={!dirtyOc} loading={saveOc.isPending} onClick={() => saveOc.mutate()}>Save overcommit</Button></div>
          <IacTabs snippets={{
            cli: toCli('host set-overcommit', { id: h.id, cpu: Number(oc.cpu), ram: Number(oc.ram) }),
            curl: toCurl('POST', `/hosts/${h.id}/actions/setOvercommit`, { cpuOvercommit: Number(oc.cpu), ramOvercommit: Number(oc.ram) }),
          }} />
        </CardBody>
      </Card>}

      <Card>
        <CardHeader title={pro ? 'Identity & placement' : 'Name & notes'} icon={Settings} />
        <CardBody className="space-y-4">
          <Field label="Hostname" error={metaErr.name}><Input mono value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value.toLowerCase() })} /></Field>
          {pro && <div className="grid grid-cols-2 gap-4">
            <Field label="Rack" error={metaErr.rack}><Input mono value={meta.rack} onChange={(e) => setMeta({ ...meta, rack: e.target.value.toUpperCase() })} /></Field>
            <Field label={`Bottom unit (${h.sizeU}U server)`} error={metaErr.rackUnit}><NumberInput value={meta.rackUnit} onChange={(v) => setMeta({ ...meta, rackUnit: v })} min={1} max={43 - h.sizeU} unit="U" /></Field>
          </div>}
          {pro && <Field label="Tags"><TagEditor value={meta.tags} onChange={(t) => setMeta({ ...meta, tags: t })} suggestions={['role', 'ticket', 'owner', 'warranty']} /></Field>}
          <Field label="Notes" optional><Textarea rows={3} value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} placeholder="Warranty until 2027-03, spare PSU in cage 4…" /></Field>
          <div className="flex justify-end"><Button variant="primary" icon={Save} loading={saveMeta.isPending} onClick={() => saveMeta.mutate()}>Save changes</Button></div>
        </CardBody>
      </Card>

      {pro && <Card>
        <CardHeader title="Out-of-band access" icon={ScrollText} />
        <CardBody>
          <KeyValue items={[['BMC address', <Mono copy>{h.bmcIp}</Mono>], ['Protocol', 'Redfish over HTTPS'], ['Username', h.bmcUser ?? 'root'], ['Password', <span className="font-mono">{h.bmcCredential ?? '••••••••'}</span>]]} />
          <p className="mt-3 text-xs text-muted">Credentials are stored in the control-plane vault and never returned by the API.</p>
        </CardBody>
      </Card>}

      <Card className="border-rose-500/30">
        <CardHeader title="Danger zone" icon={AlertTriangle} />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-sm font-medium text-fg">{h.status === 'offline' ? 'Power on' : 'Power off'}</div><div className="text-xs text-muted">Graceful shutdown via BMC. Running VMs must be evacuated first.</div></div>
            {h.status === 'offline'
              ? <Button icon={Power} onClick={() => actions.act(h, 'powerOn', `Powering on ${h.name}`)}>Power on</Button>
              : <Button variant="outline-danger" icon={Power} onClick={() => actions.powerOff(h)}>Power off</Button>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <div><div className="text-sm font-medium text-fg">Decommission host</div><div className="text-xs text-muted">Leaves the cluster and crypto-erases all disks. Only possible when no VMs remain.</div></div>
            <Button variant="danger" disabled={(h.vms?.length ?? 0) > 0} onClick={() => actions.decommission(h)}>Decommission</Button>
          </div>
          {(h.vms?.length ?? 0) > 0 && <Hint tone="warning">{h.vms!.length} VM(s) still on this host. Enter maintenance to evacuate them.</Hint>}
        </CardBody>
      </Card>
    </div>
  );
}
