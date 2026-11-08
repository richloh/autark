import { Link } from 'react-router';
import { Cloud, Globe2, Lock, ArrowLeftRight, Waypoints, Router, Shield } from 'lucide-react';
import { KINDS } from '@/lib/kinds';
import { statusTone } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import type { Network, VM, DbInstance, LoadBalancer, K8sCluster, IpAddress, ResourceKind } from '@/types';
import { subnetColor } from './util';

const TONE_DOT: Record<string, string> = { success: 'bg-emerald-500', warning: 'bg-amber-500', danger: 'bg-rose-500', info: 'bg-sky-500 animate-pulse-soft', brand: 'bg-brand-500', neutral: 'bg-faint', violet: 'bg-violet-500' };

function Chip({ type, id, name, status, sub, ip, fw }: { type: ResourceKind; id: string; name: string; status: string; sub?: string; ip?: string; fw?: number }) {
  const meta = KINDS[type];
  const Icon = meta.icon;
  return (
    <Link to={meta.link?.(id) ?? '#'} className="group flex min-w-0 items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs shadow-card transition-colors hover:border-brand-500/50">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md" style={{ background: `${meta.color}1a`, color: meta.color }}><Icon className="size-3.5" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5"><span className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[statusTone(status)])} /><span className="truncate font-medium text-fg group-hover:text-brand-500">{name}</span></span>
        {(sub || ip) && <span className="block truncate font-mono text-[10.5px] text-muted">{sub}{ip ? <span className="text-emerald-600 dark:text-emerald-400"> · {ip}</span> : null}</span>}
      </span>
      {!!fw && <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-orange-500" title={`${fw} firewall(s)`}><Shield className="size-3" />{fw}</span>}
    </Link>
  );
}

function VLine({ className, dashed = true, color = 'var(--line-strong)' }: { className?: string; dashed?: boolean; color?: string }) {
  return (
    <svg className={cn('mx-auto block h-6 w-2 overflow-visible', className)} aria-hidden>
      <line x1="4" y1="0" x2="4" y2="24" stroke={color} strokeWidth="2" className={dashed ? 'flow-line' : undefined} />
    </svg>
  );
}

/**
 * Per-VPC topology: internet → gateways → VPC box with LBs and subnets → resources.
 * Public subnets route through the internet gateway, private ones egress via NAT (if enabled).
 */
export function VpcDiagram({ network, vms, dbs, lbs, k8s, ips, networks, className }: {
  network: Network; vms: VM[]; dbs: DbInstance[]; lbs: LoadBalancer[]; k8s: K8sCluster[]; ips: Map<string, IpAddress>; networks: Map<string, Network>; className?: string;
}) {
  const pub = network.subnets.filter((s) => s.public);
  const priv = network.subnets.filter((s) => !s.public);
  const ipOf = (ids: string[]) => ids.map((i) => ips.get(i)?.address).filter(Boolean)[0];
  return (
    <div className={cn('rounded-xl border border-line bg-dots p-4 @min-[36rem]:p-5', className)}>
      {/* edge row */}
      <div className="flex flex-wrap items-start justify-center gap-3">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-medium text-fg shadow-card"><Cloud className="size-4 text-sky-500" /> Internet</div>
        </div>
        {network.peerings.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {network.peerings.map((p) => {
              const other = networks.get(p.networkId);
              const vpn = p.kind === 'vpn';
              return (
                <Link key={p.id} to={`/infrastructure/networks/${p.networkId}`} className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-card', vpn ? 'border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-300' : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300')}>
                  {vpn ? <Waypoints className="size-3.5" /> : <ArrowLeftRight className="size-3.5" />}
                  {vpn ? 'VPN' : 'Peering'} ↔ {other?.name ?? p.networkId}
                  <span className="font-mono text-[10px] opacity-70">{other?.cidr}</span>
                  {p.status === 'pending' && <span className="animate-pulse-soft text-[10px]">pending</span>}
                </Link>
              );
            })}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><VLine color="#10b981" /><div className="mx-auto flex w-fit items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-surface px-2.5 py-1 text-xs font-medium text-fg shadow-card"><Router className="size-3.5 text-emerald-500" /> Internet gateway <span className="text-muted">· {pub.length} public</span></div></div>
        <div>
          <VLine color={network.natGateway ? '#f59e0b' : 'var(--line)'} dashed={network.natGateway} />
          <div className={cn('mx-auto flex w-fit items-center gap-1.5 rounded-lg border bg-surface px-2.5 py-1 text-xs font-medium shadow-card', network.natGateway ? 'border-amber-500/30 text-fg' : 'border-dashed border-line text-faint')}>
            <Lock className={cn('size-3.5', network.natGateway ? 'text-amber-500' : 'text-faint')} /> NAT gateway <span className="text-muted">· {network.natGateway ? `${priv.length} private` : 'disabled'}</span>
          </div>
        </div>
      </div>
      <VLine />
      {/* VPC box */}
      <div className="rounded-2xl border-2 border-dashed border-emerald-500/30 bg-surface/70 p-3 backdrop-blur-[1px]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg"><KindDot /> {network.name} <span className="font-mono text-xs font-normal text-muted">{network.cidr}</span></div>
          <span className="text-[11px] text-muted">MTU {network.mtu} · {network.locationId}</span>
        </div>
        {lbs.length > 0 && (
          <div className="mb-3 rounded-xl border border-pink-500/20 bg-pink-500/5 p-2">
            <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-pink-600 dark:text-pink-400">Load balancers (VPC-wide)</div>
            <div className="grid gap-1.5 @min-[36rem]:grid-cols-2 @min-[44rem]:grid-cols-3">
              {lbs.map((l) => <Chip key={l.id} type="lb" id={l.id} name={l.name} status={l.status} sub={`${l.type} · ${(l.targetGroups ?? []).reduce((a, t) => a + (t.targets?.length ?? 0), 0)} targets`} ip={ipOf(l.ipIds ?? [])} fw={l.firewallIds?.length} />)}
            </div>
          </div>
        )}
        <div className="grid gap-3 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-3">
          {network.subnets.map((s, i) => {
            const color = subnetColor(i);
            const sVms = vms.filter((v) => v.subnetId === s.id);
            const sDbs = dbs.filter((d) => d.subnetId === s.id);
            const sK8s = k8s.filter((k) => k.subnetId === s.id);
            const count = sVms.length + sDbs.length + sK8s.length;
            return (
              <div key={s.id} className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface-2/60">
                <div className="h-1" style={{ background: color }} />
                <div className="flex items-start justify-between gap-2 px-2.5 pt-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-fg">{s.name}</div>
                    <div className="font-mono text-[11px] text-muted">{s.cidr}</div>
                  </div>
                  <span className={cn('flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium', s.public ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : network.natGateway ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-surface-3 text-muted')}>
                    {s.public ? <><Globe2 className="size-3" /> via IGW</> : network.natGateway ? <><Lock className="size-3" /> via NAT</> : <><Lock className="size-3" /> isolated</>}
                  </span>
                </div>
                <div className="space-y-1.5 p-2.5">
                  {count === 0 && <div className="rounded-lg border border-dashed border-line py-3 text-center text-[11px] text-faint">empty</div>}
                  {sK8s.map((k) => <Chip key={k.id} type="k8s" id={k.id} name={k.name} status={k.status} sub={`v${k.version} · ${k.nodePools.reduce((a, p) => a + p.count, 0)} nodes`} />)}
                  {sDbs.map((d) => <Chip key={d.id} type="db" id={d.id} name={d.name} status={d.status} sub={`${d.engine} ${d.version}${d.ha ? ' · HA' : ''}`} fw={d.firewallIds?.length} />)}
                  {sVms.map((v) => <Chip key={v.id} type="vm" id={v.id} name={v.name} status={v.status} sub={v.privateIp} ip={ipOf(v.ipIds ?? [])} fw={v.firewallIds?.length} />)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function KindDot() {
  const Icon = KINDS.network.icon;
  return <Icon className="size-4" style={{ color: KINDS.network.color }} />;
}
