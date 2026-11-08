import { usePro } from '@/store/ui';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { ChevronDown, MapPin } from 'lucide-react';
import { useList } from '@/api/hooks';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { KINDS } from '@/lib/kinds';
import { num } from '@/lib/format';
import { cn } from '@/lib/cn';
import { flag, type Fleet } from './shared';
import type { Firewall, DnsZone, IpPool, Location, ResourceKind } from '@/types';

/* Hetzner-style "All locations" inventory: a calm grid of big counts per resource type, filterable by location. */

interface Cell {
  kind: ResourceKind; label: string; to: string; count: number;
  /** resource type that is not bound to one location (counted by attachment / binding when a location is selected) */
  scopeNote?: string; alert?: number;
}

const ERR = new Set(['error', 'failed', 'degraded', 'offline']);

/** Locations ordered for pickers: own datacenters first, then by number of resources. */
export function useLocationOptions(fleet: Fleet) {
  return useMemo(() => {
    const count = new Map<string, number>();
    for (const r of [...fleet.vms, ...fleet.dbs, ...fleet.k8s, ...fleet.buckets, ...fleet.lbs, ...fleet.volumes, ...fleet.networks, ...fleet.hosts]) {
      count.set(r.locationId, (count.get(r.locationId) ?? 0) + 1);
    }
    const list = [...fleet.locations].sort((a, b) => (a.kind === b.kind ? (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) || a.name.localeCompare(b.name) : a.kind === 'selfHosted' ? -1 : 1));
    return { list, count };
  }, [fleet]);
}

export function LocationSelect({ fleet, value, onChange }: { fleet: Fleet; value: string | null; onChange: (id: string | null) => void }) {
  const { list, count } = useLocationOptions(fleet);
  const cur = value ? fleet.locations.find((l) => l.id === value) : undefined;
  const items: MenuItem[] = [
    { label: '🌐  All locations', hint: num([...count.values()].reduce((a, b) => a + b, 0)), onClick: () => onChange(null) },
    { label: '', divider: true },
    ...list.map((l): MenuItem => ({ label: `${flag(l.country)}  ${shortName(l)}`, hint: count.get(l.id) ? num(count.get(l.id)!) : '—', onClick: () => onChange(l.id) })),
  ];
  return (
    <Menu width="w-64" items={items} trigger={(open) => (
      <button type="button" aria-haspopup="menu" aria-expanded={open}
        className={cn('inline-flex h-8 max-w-[14rem] items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors',
          cur ? 'border-brand-500/40 bg-brand-500/[0.06] text-fg' : 'border-line bg-surface text-fg hover:bg-surface-2')}>
        {cur ? <span aria-hidden>{flag(cur.country)}</span> : <MapPin className="size-3.5 text-muted" />}
        <span className="truncate">{cur ? shortName(cur) : 'All locations'}</span>
        <ChevronDown className={cn('size-3.5 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
    )} />
  );
}

export function shortName(l: Location) {
  return l.kind === 'selfHosted' ? `${l.name.replace('On-Prem ', '')} · ${l.city}` : l.name;
}

/** Counts per resource type, optionally narrowed to one location. */
export function InventoryGrid({ fleet, locationId }: { fleet: Fleet; locationId: string | null }) {
  const pro = usePro();
  const { items: firewalls } = useList<Firewall>('firewalls');
  const { items: zones } = useList<DnsZone>('dnsZones');
  const { items: pools } = useList<IpPool>('ipPools');

  const cells: Cell[] = useMemo(() => {
    const at = <T extends { locationId: string }>(xs: T[]) => (locationId ? xs.filter((x) => x.locationId === locationId) : xs);
    const bad = (xs: { status: string }[]) => xs.filter((x) => ERR.has(x.status)).length;
    const poolLoc = new Map(pools.map((p) => [p.id, p.locationId]));
    const netLoc = new Map(fleet.networks.map((n) => [n.id, n.locationId]));
    // where each attachable resource lives (for firewalls)
    const resLoc = new Map<string, string>();
    for (const r of [...fleet.vms, ...fleet.dbs, ...fleet.lbs, ...fleet.k8s]) resLoc.set(r.id, r.locationId);

    const vms = at(fleet.vms), dbs = at(fleet.dbs), k8s = at(fleet.k8s), lbs = at(fleet.lbs), hosts = at(fleet.hosts);
    const ips = locationId ? fleet.ips.filter((i) => poolLoc.get(i.poolId) === locationId) : fleet.ips;
    const fws = locationId ? firewalls.filter((f) => f.attachedTo.some((r) => resLoc.get(r.id) === locationId)) : firewalls;
    const dns = locationId ? zones.filter((z) => z.kind === 'private' && z.networkId && netLoc.get(z.networkId) === locationId) : zones;
    return [
      { kind: 'vm', label: 'VMs', to: '/infrastructure/vms', count: vms.length, alert: bad(vms) },
      { kind: 'volume', label: 'Volumes', to: '/infrastructure/volumes', count: at(fleet.volumes).length },
      { kind: 'network', label: 'Networks', to: '/infrastructure/networks', count: at(fleet.networks).length },
      { kind: 'ip', label: 'Public IPs', to: '/infrastructure/ips', count: ips.length },
      { kind: 'firewall', label: 'Firewalls', to: '/infrastructure/firewalls', count: fws.length, scopeNote: 'attached here' },
      { kind: 'dnsZone', label: 'DNS zones', to: '/infrastructure/dns', count: dns.length, scopeNote: 'private, bound here' },
      { kind: 'db', label: 'Databases', to: '/managed-services/db', count: dbs.length, alert: bad(dbs) },
      { kind: 'k8s', label: 'Kubernetes', to: '/managed-services/kubernetes', count: k8s.length, alert: bad(k8s) },
      { kind: 'bucket', label: 'Buckets', to: '/managed-services/object-storage', count: at(fleet.buckets).length },
      { kind: 'lb', label: 'Load balancers', to: '/managed-services/load-balancers', count: lbs.length, alert: bad(lbs) },
      ...(pro ? [{ kind: 'bareMetal' as const, label: 'Bare-metal hosts', to: '/hardware/bare-metals', count: hosts.length, alert: bad(hosts) }] : []),
    ];
  }, [fleet, locationId, firewalls, zones, pools, pro]);

  return (
    <div className="@container">
      <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line @min-[30rem]:grid-cols-3 @min-[42rem]:grid-cols-4">
        {cells.map((c) => {
          const meta = KINDS[c.kind];
          const Icon = meta.icon;
          return (
            <li key={c.kind} className="bg-surface">
              <Link to={c.to} className="group flex h-full items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${meta.color}1a`, color: meta.color }}>
                  <Icon className="size-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className={cn('flex items-center gap-1.5 text-2xl font-semibold leading-none tracking-tight tabular', c.count ? 'text-fg' : 'text-faint')}>
                    {num(c.count)}
                    {!!c.alert && <span title={`${c.alert} need attention`} className="size-2 rounded-full bg-rose-500" />}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted group-hover:text-fg-2">{c.label}</span>
                  {locationId && c.scopeNote && <span className="block truncate text-[10px] text-faint">{c.scopeNote}</span>}
                </span>
              </Link>
            </li>
          );
        })}
        {/* 11 cells + 1 filler = complete last row at 2, 3 and 4 columns */}
        <li className="bg-surface" aria-hidden />
      </ul>
    </div>
  );
}
