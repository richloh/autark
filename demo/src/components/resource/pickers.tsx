import { useEffect, useMemo } from 'react';
import { Building2, Cloud } from 'lucide-react';
import { useList } from '@/api/hooks';
import { useUi } from '@/store/ui';
import { Field, Select, OptionCards } from '../ui/form';
import type { Project, Location, Network, Firewall } from '@/types';

/** Project selector for create forms. Defaults to the currently scoped project. */
export function ProjectField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const accountId = useUi((s) => s.accountId);
  const scoped = useUi((s) => s.projectId);
  const { items } = useList<Project>('projects');
  const projects = items.filter((p) => p.accountId === accountId);
  useEffect(() => {
    if (!value && projects.length) onChange(scoped || projects[0].id);
  }, [value, projects.length, scoped]); // eslint-disable-line
  return (
    <Field label="Project" required error={error}>
      <Select value={value} onChange={(e) => onChange(e.target.value)} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
    </Field>
  );
}

/** Location chooser as cards (own datacenters vs cloud regions). */
export function LocationCards({ value, onChange, allowCloud = true, filter }: { value: string; onChange: (id: string) => void; allowCloud?: boolean; filter?: (l: Location) => boolean }) {
  const { items } = useList<Location>('locations');
  const locs = items.filter((l) => (allowCloud || l.kind === 'selfHosted') && (!filter || filter(l)));
  return (
    <OptionCards
      cols={4}
      value={value}
      onChange={onChange}
      options={locs.map((l) => ({
        value: l.id,
        title: l.name,
        description: `${l.city}, ${l.country}`,
        icon: l.kind === 'selfHosted' ? <Building2 className="size-4 text-emerald-500" /> : <Cloud className="size-4 text-sky-500" />,
        badge: l.kind === 'cloud' ? <span className="rounded bg-sky-500/10 px-1.5 text-[10px] font-medium text-sky-600 dark:text-sky-400">burst</span> : undefined,
      }))}
    />
  );
}

export function useLocations() {
  const { items } = useList<Location>('locations');
  return useMemo(() => new Map(items.map((l) => [l.id, l])), [items]);
}

/** Network + subnet selects filtered by project and location. */
export function NetworkSubnetFields({ projectId, locationId, networkId, subnetId, onChange, errors = {} }: {
  projectId: string; locationId?: string; networkId: string; subnetId: string; onChange: (v: { networkId: string; subnetId: string }) => void; errors?: Record<string, string | undefined>;
}) {
  const { items } = useList<Network>('networks');
  const nets = items.filter((n) => n.projectId === projectId && (!locationId || n.locationId === locationId));
  const net = nets.find((n) => n.id === networkId);
  useEffect(() => {
    if (nets.length && !nets.some((n) => n.id === networkId)) onChange({ networkId: nets[0].id, subnetId: nets[0].subnets[0]?.id ?? '' });
    if (!nets.length && networkId) onChange({ networkId: '', subnetId: '' });
  }, [nets.map((n) => n.id).join(), networkId]); // eslint-disable-line
  return (
    <div className="grid gap-4 @min-[36rem]:grid-cols-2">
      <Field label="Network (VPC)" required error={errors.networkId} hint={!nets.length ? 'No network in this project & location — create one first.' : undefined}>
        <Select value={networkId} onChange={(e) => { const n = nets.find((x) => x.id === e.target.value); onChange({ networkId: e.target.value, subnetId: n?.subnets[0]?.id ?? '' }) }}
          options={nets.map((n) => ({ value: n.id, label: `${n.name} · ${n.cidr}` }))} placeholder={nets.length ? undefined : 'No networks available'} />
      </Field>
      <Field label="Subnet" required error={errors.subnetId}>
        <Select value={subnetId} onChange={(e) => onChange({ networkId, subnetId: e.target.value })}
          options={(net?.subnets ?? []).map((s) => ({ value: s.id, label: `${s.name} · ${s.cidr}${s.public ? ' · public' : ''}` }))} />
      </Field>
    </div>
  );
}

export function useFirewallOptions(projectId: string) {
  const { items } = useList<Firewall>('firewalls');
  return items.filter((f) => f.projectId === projectId).map((f) => ({ value: f.id, label: f.name, description: `${f.rules.length} rules · ${f.description}` }));
}
