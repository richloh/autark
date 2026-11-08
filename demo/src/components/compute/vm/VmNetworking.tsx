import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Globe2, Shield, Server, Plus, X, Network as NetIcon, ArrowRight, Unlink, Check } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation, useList } from '@/api/hooks';
import { Card, CardHeader, KeyValue } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Menu';
import { MultiSelect, Switch } from '@/components/ui/form';
import { Mono, EmptyState } from '@/components/ui/misc';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import { usePro } from '@/store/ui';
import type { VmCtx } from './context';
import type { IpAddress, IpPool, FirewallRule } from '@/types';

export function VmNetworking({ c }: { c: VmCtx }) {
  const { vm, network, ips, firewalls, allFirewalls } = c;
  const subnet = network?.subnets.find((s) => s.id === vm.subnetId);
  const { items: projectIps } = useList<IpAddress>('ips', { projectId: vm.projectId });
  const { items: pools } = useList<IpPool>('ipPools');
  const poolLoc = useMemo(() => new Map(pools.map((p) => [p.id, p.locationId])), [pools]);
  const free = projectIps.filter((i) => !i.assignedTo && poolLoc.get(i.poolId) === vm.locationId);
  const pro = usePro();
  const [fwIds, setFwIds] = useState<string[]>(vm.firewallIds);
  useEffect(() => setFwIds(vm.firewallIds), [vm.firewallIds.join()]); // eslint-disable-line
  const fwDirty = fwIds.slice().sort().join() !== vm.firewallIds.slice().sort().join();

  const assign = useApiMutation((body: { ipId: string; version?: 4 | 6 }) => api.action<IpAddress | undefined>('vms', vm.id, 'assignIp', body), {
    success: (r, v) => (v.ipId === 'new' ? `Allocated ${r?.address ?? 'new IP'}` : 'IP assigned'),
  });
  const unassign = async (ip: IpAddress) => {
    const res = await confirm({ title: `Unassign ${ip.address}?`, message: 'Inbound traffic to this address stops immediately.', confirmLabel: 'Unassign', danger: true, options: [{ id: 'release', label: 'Also release the address', description: `Returns it to the pool and stops billing (${money(ip.version === 4 ? 2 : 0)}/mo). Otherwise it stays reserved for the project.` }] });
    if (!res) return;
    try {
      await api.action('vms', vm.id, 'unassignIp', { ipId: ip.id });
      if (res.release) await api.remove('ips', ip.id);
    } catch (e) { toast.error('Failed', (e as Error).message) }
  };
  const setFw = useApiMutation((ids: string[]) => api.action('vms', vm.id, 'setFirewalls', { firewallIds: ids }), { success: 'Firewalls updated' });
  const toggleV6 = useApiMutation((v: boolean) => api.update('vms', vm.id, { ipv6: v }), { success: (_r, v) => (v ? 'IPv6 enabled' : 'IPv6 disabled') });

  const inbound = useMemo(() => firewalls.flatMap((f) => f.rules.filter((r) => r.direction === 'inbound' && r.enabled).map((r) => ({ ...r, fw: f }))).sort((a, b) => a.priority - b.priority), [firewalls]);
  const openPorts = [...new Set(inbound.filter((r) => r.action === 'allow').map((r) => (r.ports === '*' ? 'all' : `${r.ports}/${r.protocol}`)))];

  return (
    <div className="space-y-5">
      {/* path visual */}
      {pro && <Card className="p-4">
        <div className="mb-3 text-[13px] font-medium text-fg-2">Inbound path</div>
        <div className="flex flex-col items-stretch gap-2 @min-[40rem]:flex-row @min-[40rem]:items-center">
          <PathNode icon={Globe2} color="#14b8a6" title="Internet" sub={ips.length ? `${ips.length} public address${ips.length > 1 ? 'es' : ''}` : 'not reachable'} dim={!ips.length} />
          <PathArrow blocked={!ips.length} />
          <PathNode icon={Globe2} color="#14b8a6" title={ips[0]?.address ?? 'No public IP'} sub={ips.length ? '1:1 NAT at edge' : 'egress via NAT gateway'} mono dim={!ips.length} />
          <PathArrow blocked={!firewalls.length} />
          <PathNode icon={Shield} color="#f97316" title={firewalls.length ? `${firewalls.length} firewall${firewalls.length > 1 ? 's' : ''}` : 'No firewall'} sub={firewalls.length ? (openPorts.length ? `allow ${openPorts.slice(0, 3).join(', ')}${openPorts.length > 3 ? '…' : ''}` : 'deny all') : 'default deny'} />
          <PathArrow />
          <PathNode icon={Server} color="#5b67f8" title={vm.name} sub={`eth0 ${vm.privateIp}`} mono highlight />
        </div>
      </Card>}

      <div className="grid [&>*]:min-w-0 gap-5 @min-[44rem]:grid-cols-2">
        <Card>
          <CardHeader title="Public IPs" icon={Globe2} description="Elastic addresses — survive VM deletion if not released" actions={
            <Popover align="end" className="w-72" trigger={() => <Button size="xs" icon={Plus} loading={assign.isPending}>Assign</Button>}>
              {(close) => (
                <div className="p-1">
                  <button className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2" onClick={() => { close(); assign.mutate({ ipId: 'new', version: 4 }) }}>
                    <Plus className="mt-0.5 size-4 text-brand-500" /><span><span className="block text-sm text-fg">Allocate new IPv4</span><span className="block text-xs text-muted">from the {vm.locationId} pool · €2.00/mo</span></span>
                  </button>
                  <button className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2" onClick={() => { close(); assign.mutate({ ipId: 'new', version: 6 }) }}>
                    <Plus className="mt-0.5 size-4 text-brand-500" /><span><span className="block text-sm text-fg">Allocate new IPv6</span><span className="block text-xs text-muted">free</span></span>
                  </button>
                  {free.length > 0 && <div className="mx-2.5 my-1 border-t border-line pt-1.5 text-[11px] font-medium text-faint">Unassigned in this project</div>}
                  {free.map((ip) => (
                    <button key={ip.id} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2" onClick={() => { close(); assign.mutate({ ipId: ip.id }) }}>
                      <Globe2 className="size-4 text-teal-500" /><span className="font-mono text-[13px] text-fg">{ip.address}</span>{ip.name && <span className="truncate text-xs text-muted">{ip.name}</span>}
                    </button>
                  ))}
                </div>
              )}
            </Popover>
          } />
          {ips.length === 0 ? <EmptyState icon={Globe2} title="No public IP" description="This VM is only reachable from its private network. Outbound traffic uses the network's NAT gateway." className="py-8" /> : (
            <ul className="divide-y divide-line">
              {ips.map((ip) => (
                <li key={ip.id} className="flex items-center gap-3 px-4 py-3">
                  <Badge tone={ip.version === 4 ? 'info' : 'violet'}>IPv{ip.version}</Badge>
                  <div className="min-w-0 flex-1">
                    <Mono copy className="text-fg">{ip.address}</Mono>
                    <div className="truncate text-xs text-muted">{ip.reverseDns ? `rDNS ${ip.reverseDns}` : ip.name ?? 'no reverse DNS'}</div>
                  </div>
                  <span className="text-xs tabular text-muted">{money(ip.version === 4 ? 2 : 0)}/mo</span>
                  <Button size="xs" variant="ghost" icon={Unlink} onClick={() => unassign(ip)}>Unassign</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Private network" icon={NetIcon} actions={network && <ResourceLink type="network" id={network.id} name="Open network" className="text-xs" />} />
          <div className="space-y-4 p-4">
            <KeyValue items={[
              ['Network', network ? <ResourceLink key="n" type="network" id={network.id} name={network.name} /> : vm.networkId],
              ...(pro ? [['CIDR', <Mono key="c">{network?.cidr ?? '—'}</Mono>] as [string, ReactNode]] : []),
              ['Subnet', subnet ? <span key="s">{subnet.name} <Mono className="text-muted">{subnet.cidr}</Mono></span> : vm.subnetId],
              ['Private IPv4', <Mono key="p" copy>{vm.privateIp}</Mono>],
              ...(pro ? [
                ['Gateway', <Mono key="g">{subnet?.gateway ?? '—'}</Mono>],
                ['MTU', network?.mtu ?? '—'],
                ['NAT gateway', network?.natGateway ? <Badge key="nat" tone="success" dot>enabled</Badge> : <span className="text-faint">none</span>],
                ['DNS name', <Mono key="d" copy>{`${vm.name}.${vm.projectId}.internal`}</Mono>],
              ] as [string, ReactNode][] : []),
            ]} />
            <div className="border-t border-line pt-3">
              <Switch checked={vm.ipv6} onChange={(v) => toggleV6.mutate(v)} disabled={toggleV6.isPending} label="IPv6 (SLAAC)" description="Assigns a global /128 from the location's IPv6 pool. Free." />
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Firewalls" icon={Shield} description={pro ? 'Rules of all attached firewalls are merged; lower priority numbers win. Default inbound policy: deny.' : 'Inbound traffic is blocked unless a firewall allows it.'} actions={fwDirty && <Button size="xs" variant="primary" icon={Check} loading={setFw.isPending} onClick={() => setFw.mutate(fwIds)}>Apply</Button>} />
        <div className="space-y-4 p-4">
          <MultiSelect options={allFirewalls.map((f) => ({ value: f.id, label: f.name, description: `${f.rules.length} rules · ${f.description}` }))} value={fwIds} onChange={setFwIds} placeholder="No firewall — all inbound traffic is blocked" emptyText="No firewalls in this project" />
          {firewalls.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {firewalls.map((f) => (
                <span key={f.id} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2/50 py-1 pl-2 pr-1 text-xs">
                  <ResourceLink type="firewall" id={f.id} name={f.name} className="text-xs" />
                  <span className="text-faint">{f.rules.filter((r) => r.direction === 'inbound').length} in / {f.rules.filter((r) => r.direction === 'outbound').length} out</span>
                  <button onClick={() => setFw.mutate(vm.firewallIds.filter((x) => x !== f.id))} className="rounded p-0.5 text-faint hover:bg-rose-500/10 hover:text-rose-500" aria-label={`Detach ${f.name}`} title="Detach"><X className="size-3.5" /></button>
                </span>
              ))}
            </div>
          )}
          <div>
            <div className="mb-2 text-xs font-medium text-muted">Effective inbound rules</div>
            {inbound.length === 0 ? <p className="rounded-lg bg-surface-2 p-3 text-xs text-muted">No inbound rules — everything is blocked (except established connections).</p> : (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-left text-[12.5px]">
                  <thead><tr className="border-b border-line bg-surface-2/50 text-xs text-muted"><th className="px-3 py-1.5 font-medium">Prio</th><th className="px-3 py-1.5 font-medium">Action</th><th className="px-3 py-1.5 font-medium">Protocol / ports</th><th className="px-3 py-1.5 font-medium">Source</th><th className="hidden px-3 py-1.5 font-medium @min-[36rem]:table-cell">From</th></tr></thead>
                  <tbody>
                    {inbound.map((r: FirewallRule & { fw: { id: string; name: string } }) => (
                      <tr key={r.fw.id + r.id} className="border-b border-line last:border-0">
                        <td className="px-3 py-1.5 tabular text-muted">{r.priority}</td>
                        <td className="px-3 py-1.5"><Badge tone={r.action === 'allow' ? 'success' : 'danger'}>{r.action}</Badge></td>
                        <td className="px-3 py-1.5 font-mono text-fg">{r.protocol}{r.protocol !== 'icmp' && r.protocol !== 'any' ? `/${r.ports}` : ''}</td>
                        <td className="px-3 py-1.5 font-mono text-fg-2">{r.source}{r.source === '0.0.0.0/0' && <span className="ml-1.5 font-sans text-[10px] text-amber-600 dark:text-amber-400">anywhere</span>}</td>
                        <td className="hidden px-3 py-1.5 text-muted @min-[36rem]:table-cell">{r.fw.name}{r.description ? ` · ${r.description}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function PathNode({ icon: Icon, color, title, sub, mono, highlight, dim }: { icon: typeof Globe2; color: string; title: string; sub: string; mono?: boolean; highlight?: boolean; dim?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border p-2.5', highlight ? 'border-brand-500/30 bg-brand-500/[0.05]' : 'border-line bg-surface-2/40', dim && 'opacity-50')}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${color}1a`, color }}><Icon className="size-4" /></span>
      <span className="min-w-0"><span className={cn('block truncate text-[13px] font-medium text-fg', mono && 'font-mono')}>{title}</span><span className="block truncate text-[11px] text-muted">{sub}</span></span>
    </div>
  );
}

function PathArrow({ blocked }: { blocked?: boolean }) {
  return <div className={cn('flex shrink-0 justify-center', blocked ? 'text-rose-400' : 'text-faint')}><ArrowRight className="size-4 rotate-90 @min-[40rem]:rotate-0" /></div>;
}
