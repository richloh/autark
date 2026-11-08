import { Link } from 'react-router';
import { cn } from '@/lib/cn';
import { KINDS } from '@/lib/kinds';
import { useItem } from '@/api/hooks';
import type { ResourceKind } from '@/types';

/** REST collection per kind — used to resolve display names when only an id is known. */
const COLLECTION: Partial<Record<ResourceKind, string>> = {
  vm: 'vms', volume: 'volumes', network: 'networks', firewall: 'firewalls', dnsZone: 'dnsZones', db: 'dbInstances', k8s: 'k8sClusters',
  bucket: 'buckets', lb: 'loadBalancers', bareMetal: 'hosts', provider: 'providers', user: 'users', role: 'roles', systemAccount: 'systemAccounts',
  image: 'images', sshKey: 'sshKeys', snapshot: 'snapshots', certificate: 'certificates', ip: 'ips',
};

/** Link to a resource with its kind icon. Pass `name` when known; otherwise the id is shown. */
export function ResourceLink({ type, id, name, className, showIcon = true, muted }: { type: ResourceKind; id: string; name?: string; className?: string; showIcon?: boolean; muted?: boolean }) {
  const meta = KINDS[type];
  const col = !name || name === id ? COLLECTION[type] : undefined;
  const { data } = useItem<{ name?: string; address?: string; email?: string }>(col ?? '_', col ? id : null);
  name = name && name !== id ? name : data?.name ?? data?.address ?? name;
  const Icon = meta?.icon;
  const to = meta?.link?.(id);
  const content = (
    <>
      {showIcon && Icon && <Icon className="size-3.5 shrink-0" style={{ color: meta.color }} />}
      <span className="truncate">{name ?? id}</span>
    </>
  );
  const cls = cn('inline-flex max-w-full items-center gap-1.5 text-[13px]', muted ? 'text-muted' : 'text-fg', className);
  if (!to) return <span className={cls}>{content}</span>;
  return <Link to={to} className={cn(cls, 'hover:text-brand-500 hover:underline decoration-brand-500/40 underline-offset-2')} onClick={(e) => e.stopPropagation()}>{content}</Link>;
}

/** Resource kind icon in a soft tinted square. */
export function KindIcon({ type, size = 'md', className }: { type: ResourceKind; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const meta = KINDS[type];
  const Icon = meta.icon;
  const dim = { sm: 'size-6 rounded-md', md: 'size-8 rounded-lg', lg: 'size-10 rounded-xl' }[size];
  const ic = { sm: 'size-3.5', md: 'size-4', lg: 'size-5' }[size];
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', dim, className)} style={{ background: `${meta.color}1a`, color: meta.color }}>
      <Icon className={ic} />
    </span>
  );
}
