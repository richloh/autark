import { useId, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Building2, Cloud, Cpu, Server, Network as NetIcon, Terminal, KeyRound, Monitor, ArrowRight, ArrowDown, Activity, Camera, Gauge, MemoryStick, ArrowDownUp, HardDrive } from 'lucide-react';
import { useGet, useList, useMetrics } from '@/api/hooks';
import { Card, CardHeader, KeyValue } from '@/components/ui/Card';
import { Badge, StatusPill, Tags } from '@/components/ui/Badge';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Hint } from '@/components/ui/form';
import { Mono, StackBar, Ring } from '@/components/ui/misc';
import { Button } from '@/components/ui/Button';
import { MiniMap } from '@/components/resource/MiniMap';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { OsBadge } from '@/lib/images';
import { vmCost, HOURS_PER_MONTH, PRICING } from '@/lib/pricing';
import { money, timeAgo, dateTime, gb } from '@/lib/format';
import { cn } from '@/lib/cn';
import { defaultUser, uptimeMs, fmtUptime, flagEmoji, COUNTRY } from './util';
import { TRIGGER_STYLE } from '../SnapshotTimeline';
import { usePro } from '@/store/ui';
import type { VmCtx } from './context';
import type { VM, PlacementCandidate, IpAddress, Location } from '@/types';

/* ------------------------------------------------------------------ live tiles */

function Spark({ data, color, max }: { data: number[]; color: string; max?: number }) {
  const id = useId();
  if (data.length < 2) return <div className="h-7" />;
  const W = 100, H = 28;
  const hi = max ?? Math.max(...data, 1);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * W, H - 2 - (Math.max(0, v) / (hi || 1)) * (H - 4)] as const);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-7 w-full" aria-hidden>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.25" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d}L${W},${H}L0,${H}Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function LiveTile({ icon: Icon, label, value, sub, data, color, max }: { icon: typeof Cpu; label: string; value: string; sub?: string; data: number[]; color: string; max?: number }) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <div className="px-3 pt-2.5">
        <div className="flex items-center gap-1.5 text-xs text-muted"><Icon className="size-3.5 shrink-0" style={{ color }} /><span className="truncate">{label}</span></div>
        <div className="mt-0.5 flex min-w-0 items-baseline gap-2">
          <span className="whitespace-nowrap text-lg font-semibold tabular text-fg">{value}</span>
          {sub && <span className="min-w-0 truncate text-[11px] text-faint">{sub}</span>}
        </div>
      </div>
      <div className="mt-1"><Spark data={data} color={color} max={max} /></div>
    </div>
  );
}

export function LiveTiles({ vm }: { vm: VM }) {
  const { data } = useMetrics('vms', vm.id, ['cpu', 'ram', 'netIn', 'netOut', 'diskRead', 'diskWrite'], '15m');
  const s = (m: string) => data?.series?.[m]?.points.map((p) => p.v) ?? [];
  const last = (m: string) => s(m).at(-1) ?? 0;
  const off = vm.status !== 'running';
  const net = s('netIn').map((v, i) => v + (s('netOut')[i] ?? 0));
  const disk = s('diskRead').map((v, i) => v + (s('diskWrite')[i] ?? 0));
  return (
    <div className="grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
      <LiveTile icon={Cpu} label="CPU" value={off ? '—' : `${Math.round(last('cpu'))}%`} sub={`${vm.size.vcpus} vCPU`} data={s('cpu')} color="#5b67f8" max={100} />
      <LiveTile icon={MemoryStick} label="Memory" value={off ? '—' : `${((last('ram') / 100) * vm.size.ramGB).toFixed(1)} GB`} sub={off ? `${vm.size.ramGB} GB` : `${Math.round(last('ram'))}% of ${vm.size.ramGB} GB`} data={s('ram')} color="#a855f7" max={100} />
      <LiveTile icon={ArrowDownUp} label="Network" value={off ? '—' : `${Math.round(last('netIn') + last('netOut'))} Mb/s`} sub={off ? undefined : `↓ ${Math.round(last('netIn'))} · ↑ ${Math.round(last('netOut'))}`} data={net} color="#06b6d4" />
      <LiveTile icon={HardDrive} label="Disk I/O" value={off ? '—' : `${Math.round(last('diskRead') + last('diskWrite'))} MB/s`} sub={off ? undefined : `R ${Math.round(last('diskRead'))} · W ${Math.round(last('diskWrite'))}`} data={disk} color="#f59e0b" />
    </div>
  );
}

/* ------------------------------------------------------------------ placement */

export function PlacementVisual({ c }: { c: VmCtx }) {
  const { vm, location, host } = c;
  const { data } = useGet<{ items: PlacementCandidate[] }>(['vms', 'placement', vm.id], vm.hostId ? `/vms/${vm.id}/placement` : null);
  const cur = data?.items.find((h) => h.current);
  const cloud = location?.kind === 'cloud';
  const Arrow = () => (
    <div className="flex shrink-0 items-center justify-center text-faint">
      <ArrowRight className="hidden size-4 @min-[40rem]:block" /><ArrowDown className="size-4 @min-[40rem]:hidden" />
    </div>
  );
  const box = 'min-w-0 flex-1 rounded-xl border border-line bg-surface-2/40 p-3';
  return (
    <div className="flex flex-col gap-2 @min-[40rem]:flex-row @min-[40rem]:items-stretch">
      <div className={box}>
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-faint">{cloud ? <Cloud className="size-3.5 text-sky-500" /> : <Building2 className="size-3.5 text-emerald-500" />}Location</div>
        <div className="mt-1.5 truncate text-sm font-medium text-fg">{location?.name ?? vm.locationId}</div>
        <div className="text-xs text-muted">{location ? `${location.city}, ${location.country}` : ''}{cloud ? ' · burst capacity' : ' · own hardware'}</div>
      </div>
      <Arrow />
      <div className={box}>
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-faint"><Cpu className="size-3.5" />{cloud ? 'Provider server' : 'Hypervisor'}</div>
        {host ? (
          <>
            <Link to={`/hardware/bare-metals/${host.id}`} className="mt-1.5 block truncate text-sm font-medium text-fg hover:text-brand-500">{host.name}</Link>
            <div className="truncate text-xs text-muted">rack {host.rack} · {host.cpuModel}</div>
            {cur && (
              <div className="mt-2 space-y-1.5">
                {([['vCPU', cur.allocated.vcpus, cur.capacity.vcpus, vm.size.vcpus], ['RAM', cur.allocated.ramGB, cur.capacity.ramGB, vm.size.ramGB]] as const).map(([l, used, total, mine]) => (
                  <div key={l}>
                    <div className="mb-0.5 flex justify-between text-[10px] text-muted"><span>{l}</span><span className="tabular">{used}/{total}</span></div>
                    <StackBar total={total} height="h-1.5" segments={[{ value: used - mine, color: 'rgb(148 163 184 / 0.6)', label: 'other VMs' }, { value: mine, color: '#5b67f8', label: vm.name }]} />
                  </div>
                ))}
                <div className="text-[10px] text-faint">{cur.allocated.vms} VMs on this host</div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mt-1.5 text-sm font-medium text-fg">{cloud ? `${location?.region ?? ''} dedicated vCPU` : 'Not scheduled'}</div>
            <div className="text-xs text-muted">{cloud ? 'Managed through the provider API' : vm.status === 'provisioning' ? 'Scheduler is choosing a host…' : '—'}</div>
          </>
        )}
      </div>
      <Arrow />
      <div className={cn(box, 'border-brand-500/30 bg-brand-500/[0.04]')}>
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-faint"><Server className="size-3.5 text-brand-500" />Virtual machine</div>
        <div className="mt-1.5 flex items-center gap-2"><span className="truncate text-sm font-medium text-fg">{vm.name}</span><StatusPill status={vm.status} /></div>
        <div className="text-xs text-muted">{vm.size.vcpus} vCPU · {vm.size.ramGB} GB · {vm.size.systemDiskGB} GB disk{vm.gpu ? ` · ${vm.gpu.count}× ${vm.gpu.model}` : ''}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ connection */

export function ConnectionInfo({ c, onConsole, onNetworking }: { c: VmCtx; onConsole: () => void; onNetworking: () => void }) {
  const { vm, image, ips, sshKeys } = c;
  const { items: projectVms } = useList<VM>('vms', { projectId: vm.projectId });
  const { items: allIps } = useList<IpAddress>('ips', { projectId: vm.projectId });
  const user = defaultUser(image);
  const pub = ips.find((i) => i.version === 4)?.address;
  const bastion = useMemo(() => {
    if (pub) return null;
    const b = projectVms.find((v) => v.id !== vm.id && v.networkId === vm.networkId && v.ipIds.length && (v.name.includes('bastion') || v.tags.some((t) => t.value === 'bastion')));
    const ip = b ? allIps.find((i) => b.ipIds.includes(i.id) && i.version === 4)?.address : undefined;
    return b && ip ? { vm: b, ip } : null;
  }, [pub, projectVms, allIps, vm.id, vm.networkId]);
  const win = image?.os === 'windows';
  const pro = usePro();
  const cmd = win
    ? `mstsc /v:${pub ?? vm.privateIp}`
    : pub ? `ssh ${user}@${pub}` : bastion ? `ssh -J ${bastion.vm.name.includes('bastion') ? 'debian' : user}@${bastion.ip} ${user}@${vm.privateIp}` : `ssh ${user}@${vm.privateIp}`;
  return (
    <Card>
      <CardHeader title="Connect" icon={Terminal} description={win ? 'Remote Desktop (RDP) with the Administrator password from the console' : pro ? `Key-based SSH as ${user} — password login is disabled` : `Log in with your SSH key as ${user}`}
        actions={<Button size="xs" variant="ghost" icon={Monitor} onClick={onConsole}>Console</Button>} />
      <div className="space-y-3 p-4">
        <CodeBlock code={cmd} language="bash" />
        {!pub && (bastion
          ? <p className="text-xs text-muted">No public IP — jump through <ResourceLink type="vm" id={bastion.vm.id} name={bastion.vm.name} className="text-xs" /> in the same network.</p>
          : <Hint tone="warning">This VM has no public IP. Connect from inside the network, use the serial console, or <button onClick={onNetworking} className="font-medium underline underline-offset-2">assign a public IP</button>.</Hint>)}
        <div className="grid gap-3 text-xs @min-[36rem]:grid-cols-2">
          {pro && <div><div className="mb-1 font-medium text-muted">Private DNS</div><Mono copy>{`${vm.name}.${vm.projectId}.internal`}</Mono></div>}
          <div>
            <div className="mb-1 font-medium text-muted">SSH keys</div>
            {win ? <span className="text-faint">n/a (Windows)</span> : sshKeys.length ? <div className="flex flex-wrap gap-1">{sshKeys.map((k) => <Badge key={k.id}><KeyRound className="size-3" />{k.name}</Badge>)}</div> : <span className="text-amber-600 dark:text-amber-400">none configured</span>}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ cost */

export function CostBreakdownCard({ c }: { c: VmCtx }) {
  const { vm, location, ips, volumes, snapshots } = c;
  const running = !['stopped', 'error'].includes(vm.status);
  const cost = vmCost({
    vcpus: running ? vm.size.vcpus : 0, ramGB: running ? vm.size.ramGB : 0, systemDiskGB: vm.size.systemDiskGB, gpu: running ? vm.gpu : null,
    publicIpv4: ips.filter((i) => i.version === 4).length, backups: running && vm.backups.enabled, cloud: location?.kind === 'cloud', volumes,
  });
  const snapGB = snapshots.reduce((a, s) => a + s.sizeGB, 0);
  const snapCost = Math.round(snapGB * PRICING.snapshotGBPerMonth * 100) / 100;
  const total = cost.total + snapCost;
  const colors = ['#5b67f8', '#06b6d4', '#a855f7', '#14b8a6', '#f59e0b', '#ec4899', '#64748b', '#10b981'];
  const lines = [...cost.lines, ...(snapCost ? [{ label: `${snapshots.length} snapshot${snapshots.length > 1 ? 's' : ''} · ${gb(Math.round(snapGB))}`, amount: snapCost }] : [])];
  return (
    <Card>
      <CardHeader title="Cost" icon={Gauge} actions={<Link to="/billing/cost-explorer" className="text-xs text-muted hover:text-brand-500">Cost explorer</Link>} />
      <div className="p-4">
        <div className="flex items-baseline gap-1.5"><span className="text-2xl font-semibold tabular text-fg">{money(total)}</span><span className="text-sm text-muted">/ mo</span><span className="ml-auto text-xs tabular text-muted">{money(total / HOURS_PER_MONTH, { decimals: true })}/h</span></div>
        <StackBar className="mt-3" total={total} segments={lines.map((l, i) => ({ value: l.amount, color: colors[i % colors.length], label: l.label }))} />
        <ul className="mt-3 space-y-1.5">
          {lines.map((l, i) => (
            <li key={i} className="flex items-start justify-between gap-3 text-[13px]">
              <span className="flex min-w-0 items-start gap-2 text-fg-2"><span className="mt-1.5 size-2 shrink-0 rounded-sm" style={{ background: colors[i % colors.length] }} /><span className="min-w-0">{l.label}{l.hint && <span className="block text-[11px] text-faint">{l.hint}</span>}</span></span>
              <span className="shrink-0 tabular text-fg">{money(l.amount, { decimals: true })}</span>
            </li>
          ))}
        </ul>
        {!running && <p className="mt-3 rounded-lg bg-surface-2 p-2 text-[11px] text-muted">Stopped VMs only pay for disks, snapshots and IPs. Running it would cost {money(vmCost({ vcpus: vm.size.vcpus, ramGB: vm.size.ramGB, systemDiskGB: vm.size.systemDiskGB, gpu: vm.gpu, publicIpv4: ips.filter((i) => i.version === 4).length, backups: vm.backups.enabled, cloud: location?.kind === 'cloud', volumes }).total + snapCost)}/mo.</p>}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ location */

/** Coarse network zone for a location (Hetzner calls these eu-central, us-east, …). */
function networkZone(lat: number, lon: number, country: string): string {
  if (lon < -100) return 'us-west';
  if (lon < -30) return 'us-east';
  if (lon > 90) return 'ap-southeast';
  if (['FI', 'SE', 'NO', 'DK'].includes(country)) return 'eu-north';
  if (lat < 0) return 'af-south';
  return lon < 2 ? 'eu-west' : 'eu-central';
}

export function LocationCard({ c }: { c: VmCtx }) {
  const { vm, location, host } = c;
  const { items: all } = useList<Location>('locations');
  const pro = usePro();
  if (!location) return null;
  const cloud = location.kind === 'cloud';
  const others = all.filter((l) => l.id !== location.id && Math.abs(l.lat - location.lat) < 12 && Math.abs(l.lon - location.lon) < 25)
    .map((l) => ({ lat: l.lat, lon: l.lon, label: l.name }));
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Location" icon={cloud ? Cloud : Building2} actions={pro ? <Link to="/topology" className="text-xs text-muted hover:text-brand-500">Topology</Link> : undefined} />
      <MiniMap lat={location.lat} lon={location.lon} label={location.city} zoom={6} aspect={2.4} markers={others} className="mx-4 h-32 rounded-lg" />
      <div className="p-4">
        <KeyValue cols={2} items={[
          ['Location', <span key="l" className="flex min-w-0 items-center gap-1.5"><span className="truncate">{location.name}</span></span>],
          ['Network zone', <Mono key="z">{location.region ?? networkZone(location.lat, location.lon, location.country)}</Mono>],
          ['City', location.city],
          ['Country', <span key="c" className="flex items-center gap-1.5"><span className="text-base leading-none">{flagEmoji(location.country)}</span>{COUNTRY[location.country] ?? location.country}</span>],
          ...(pro ? [[cloud ? 'Provider' : 'Host', host
            ? <Link key="h" to={`/hardware/bare-metals/${host.id}`} className="hover:text-brand-500">{host.name}</Link>
            : <span key="h" className="text-muted">{cloud ? 'provider managed' : vm.status === 'provisioning' ? 'scheduling…' : '—'}</span>] as [string, ReactNode]] : []),
          ['Hardware', cloud ? <span key="hw" className="text-sky-600 dark:text-sky-400">burst cloud</span> : <span key="hw" className="text-emerald-600 dark:text-emerald-400">own datacenter</span>],
        ]} />
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ overview */

export function VmOverview({ c, go }: { c: VmCtx; go: (tab: string) => void }) {
  const { vm, image, location, host, network, project, preset, ips, firewalls, volumes, snapshots } = c;
  const subnet = network?.subnets.find((s) => s.id === vm.subnetId);
  const up = uptimeMs(vm);
  const lastSnap = [...snapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const totalStorage = vm.size.systemDiskGB + volumes.reduce((a, v) => a + v.sizeGB, 0);
  const pro = usePro();
  const proOnly = new Set(['GPU', 'Project', 'Firewalls', 'Tags']);
  const details: [string, ReactNode][] = [
    ['Size', <span key="s" className="flex items-center gap-1.5">{preset && <Badge tone="brand">{preset.name}</Badge>}<span className="tabular">{vm.size.vcpus} vCPU · {vm.size.ramGB} GB</span></span>],
    ['GPU', vm.gpu ? <Badge tone="violet">{vm.gpu.count}× NVIDIA {vm.gpu.model}</Badge> : <span className="text-faint">none</span>],
    ['Image', <span key="i" className="flex items-center gap-1.5"><OsBadge os={image?.os ?? 'custom'} size={18} /><span className="truncate">{image?.name ?? vm.imageId}</span>{image?.status === 'deprecated' && <Badge tone="warning">deprecated</Badge>}</span>],
    ['Project', project ? <span key="p" className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: project.color }} />{project.name}</span> : vm.projectId],
    ['Network', network ? <ResourceLink key="n" type="network" id={network.id} name={`${network.name}${subnet ? ` / ${subnet.name}` : ''}`} /> : vm.networkId],
    ['Private IP', <Mono key="pi" copy>{vm.privateIp}</Mono>],
    ['Public IP', ips.length ? <span key="ip" className="flex flex-col">{ips.map((i) => <Mono key={i.id} copy>{i.address}</Mono>)}</span> : <button key="ipb" onClick={() => go('networking')} className="text-xs text-brand-500 hover:underline">Assign…</button>],
    ['Firewalls', firewalls.length ? <span key="fw" className="flex flex-wrap gap-x-2">{firewalls.map((f) => <ResourceLink key={f.id} type="firewall" id={f.id} name={f.name} />)}</span> : <span className="text-amber-600 dark:text-amber-400">none — inbound blocked</span>],
    ['Storage', <button key="st" onClick={() => go('storage')} className="hover:text-brand-500">{gb(totalStorage)} · {volumes.length + 1} disk{volumes.length ? 's' : ''}</button>],
    ['Uptime', vm.status === 'running' ? fmtUptime(up) : <span className="text-faint">{vm.status}</span>],
    ['Created', <span key="c" title={dateTime(vm.createdAt)}>{timeAgo(vm.createdAt)}</span>],
    ['Tags', <Tags key="t" tags={vm.tags} max={4} />],
  ];
  return (
    <div className="grid gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_360px]">
      <div className="@container min-w-0 space-y-5">
        {pro && <LiveTiles vm={vm} />}
        <Card>
          <CardHeader title="Details" icon={Server} />
          <div className="p-4">
            <KeyValue cols={3} items={details.filter(([k]) => pro || !proOnly.has(k) || (k === 'GPU' && vm.gpu))} />
          </div>
        </Card>
        {pro && (
          <Card>
            <CardHeader title="Placement" icon={NetIcon} description="Where this VM physically runs" actions={vm.hostId ? <Button size="xs" variant="ghost" onClick={() => go('migrate')}>Migrate…</Button> : undefined} />
            <div className="p-4"><PlacementVisual c={c} /></div>
          </Card>
        )}
        <ConnectionInfo c={c} onConsole={() => go('console')} onNetworking={() => go('networking')} />
      </div>
      <div className="min-w-0 space-y-5">
        {pro && <CostBreakdownCard c={c} />}
        <LocationCard c={c} />
        <Card>
          <CardHeader title={pro ? 'Protection' : 'Backups'} icon={Camera} actions={<button onClick={() => go('snapshots')} className="text-xs text-muted hover:text-brand-500">Manage</button>} />
          <div className="flex items-center gap-4 p-4">
            <Ring value={vm.backups.enabled ? 100 : 0} size={56} color={vm.backups.enabled ? '#10b981' : '#f59e0b'} label={vm.backups.enabled ? 'On' : 'Off'} />
            <div className="min-w-0 text-[13px]">
              <div className="font-medium text-fg">{vm.backups.enabled ? `${vm.backups.schedule === 'daily' ? 'Daily' : 'Weekly'} backups · keep ${vm.backups.retention}` : 'Automated backups disabled'}</div>
              <div className="text-xs text-muted">{snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'}{lastSnap ? <> · last <span style={{ color: TRIGGER_STYLE[lastSnap.trigger].color }}>{lastSnap.trigger}</span> {timeAgo(lastSnap.createdAt)}</> : ''}</div>
              <div className="mt-0.5 text-xs text-muted">Deletion protection: <span className={vm.deletionProtection ? 'text-emerald-600 dark:text-emerald-400' : 'text-faint'}>{vm.deletionProtection ? 'on' : 'off'}</span></div>
            </div>
          </div>
        </Card>
        {pro && (
          <Card>
            <CardHeader title="Recent activity" icon={Activity} actions={<button onClick={() => go('activity')} className="text-xs text-muted hover:text-brand-500">All</button>} />
            <ActivityFeed targetId={vm.id} limit={5} />
          </Card>
        )}
        {pro && location?.kind === 'cloud' && <Hint>Runs on burst capacity at {location.name} (+25% vs own hardware). Consider moving it home when capacity frees up.</Hint>}
        {host?.status && host.status !== 'ready' && <Hint tone="warning">{pro ? `Host ${host.name} is ${host.status}. Live-migrate this VM to keep it available.` : `The server hosting this VM is in ${host.status}.`}</Hint>}
      </div>
    </div>
  );
}
