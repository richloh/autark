import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Scale, Plus, Trash2, MoreHorizontal, BadgeCheck, Activity, HeartPulse, Globe2, Lock, Layers } from 'lucide-react';
import { useList, useLookup } from '@/api/hooks';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { StatusPill, Tags, Badge } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Tabs, useTabParam } from '@/components/ui/Tabs';
import { Stat } from '@/components/ui/Stat';
import { Mono } from '@/components/ui/misc';
import { OperationInline } from '@/components/resource/OperationRunner';
import { CertificatesPanel } from '@/components/lb/Certificates';
import { HealthBar } from '@/components/lb/forms';
import { deleteLoadBalancers } from '@/components/lb/actions';
import { money } from '@/lib/format';
import { Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import type { LoadBalancer, IpAddress, Location, Operation, Project, Certificate } from '@/types';

type StatusFilter = 'all' | 'active' | 'degraded' | 'transitional' | 'error';
const TRANSITIONAL: LoadBalancer['status'][] = ['provisioning', 'updating', 'deleting'];

export default function LbList() {
  const [tab, setTab] = useTabParam('lbs');
  const pro = usePro();
  const { items: lbs } = useList<LoadBalancer>('loadBalancers');
  const { items: certs } = useList<Certificate>('certificates');
  const attention = certs.filter((c) => ['expiring', 'expired', 'failed'].includes(c.status)).length;

  return (
    <Page wide>
      <PageHeader
        title="Load Balancers"
        description={pro ? "Highly available L4 (TCP/UDP) and L7 (HTTP/HTTPS) load balancing in front of VMs and Kubernetes, with free Let's Encrypt certificates." : 'Spread traffic across your servers, with free HTTPS certificates.'}
        icon={Scale}
        iconColor="#ec4899"
        actions={tab === 'lbs' ? <Button variant="primary" icon={Plus} to="/managed-services/load-balancers/new">Create load balancer</Button> : undefined}
      />
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[
        { id: 'lbs', label: 'Load balancers', count: lbs.length, icon: <Scale className="size-3.5" /> },
        { id: 'certificates', label: <span className="flex items-center gap-1.5">Certificates{attention > 0 && <span className="size-1.5 rounded-full bg-amber-500" title={`${attention} need attention`} />}</span>, count: certs.length, icon: <BadgeCheck className="size-3.5" /> },
      ]} />
      {tab === 'certificates' ? <CertificatesPanel /> : <LoadBalancerTable />}
    </Page>
  );
}

function LoadBalancerTable() {
  const [sp] = useSearchParams();
  const pro = usePro();
  const { items: lbs, isLoading } = useList<LoadBalancer>('loadBalancers');
  const { map: ips } = useLookup<IpAddress>('ips');
  const { map: locations } = useLookup<Location>('locations');
  const { map: projects } = useLookup<Project>('projects');
  const { items: ops } = useList<Operation>('operations', { status: 'running' });
  const [status, setStatus] = useState<StatusFilter>('all');
  const [type, setType] = useState<'all' | 'L4' | 'L7'>('all');
  const opByTarget = useMemo(() => new Map(ops.filter((o) => o.target.type === 'lb').map((o) => [o.target.id, o])), [ops]);

  const counts = {
    all: lbs.length,
    active: lbs.filter((l) => l.status === 'active').length,
    degraded: lbs.filter((l) => l.status === 'degraded').length,
    transitional: lbs.filter((l) => TRANSITIONAL.includes(l.status)).length,
    error: lbs.filter((l) => l.status === 'error').length,
  };
  const rows = lbs
    .filter((l) => status === 'all' || (status === 'transitional' ? TRANSITIONAL.includes(l.status) : l.status === status))
    .filter((l) => !pro || type === 'all' || l.type === type);

  const totalTargets = lbs.reduce((a, l) => a + (l.healthSummary?.total ?? 0), 0);
  const healthy = lbs.reduce((a, l) => a + (l.healthSummary?.healthy ?? 0), 0);
  const listeners = lbs.reduce((a, l) => a + l.listeners.length, 0);
  const tls = lbs.reduce((a, l) => a + l.listeners.filter((x) => x.protocol === 'HTTPS').length, 0);
  const cost = lbs.reduce((a, l) => a + (l.monthlyCost ?? 0), 0);

  const allColumns: Column<LoadBalancer>[] = [
    {
      id: 'name', header: 'Name', sort: (l) => l.name,
      cell: (l) => {
        const p = projects.get(l.projectId);
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold" style={{ background: l.type === 'L7' ? '#ec48991a' : '#06b6d41a', color: l.type === 'L7' ? '#ec4899' : '#0891b2' }}>{l.type}</span>
            <div className="min-w-0">
              <Link to={`/managed-services/load-balancers/${l.id}`} className="block truncate font-medium text-fg hover:text-brand-500">{l.name}</Link>
              <div className="flex items-center gap-1.5 text-[11px] text-muted">
                {p && <span className="size-1.5 rounded-full" style={{ background: p.color }} title={p.name} />}
                {pro ? <span className="truncate font-mono">{l.hostname}</span>
                  : <span className="truncate">{[...l.listeners].sort((a, b) => a.port - b.port).map((x) => `${x.protocol} ${x.port}`).join(' · ') || 'no listeners'}</span>}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'status', header: 'Status', sort: (l) => l.status,
      cell: (l) => { const op = opByTarget.get(l.id); return op ? <div className="w-36"><StatusPill status={l.status} /><OperationInline op={op} className="mt-1.5" /></div> : <StatusPill status={l.status} /> },
    },
    {
      id: 'listeners', header: 'Listeners', hideBelow: 'md',
      cell: (l) => (
        <div className="flex flex-wrap gap-1">
          {[...l.listeners].sort((a, b) => a.port - b.port).map((x) => (
            <Badge key={x.id} tone={x.protocol === 'HTTPS' ? 'success' : x.redirectToHttps ? 'neutral' : 'info'}>
              {x.protocol === 'HTTPS' && <Lock className="size-3" />}{x.protocol}:{x.port}{x.redirectToHttps ? ' →' : ''}
            </Badge>
          ))}
        </div>
      ),
    },
    { id: 'health', header: pro ? 'Target health' : 'Targets', sort: (l) => (l.healthSummary?.total ? l.healthSummary.healthy / l.healthSummary.total : 0), cell: (l) => <HealthBar summary={l.healthSummary} className="w-36" /> },
    {
      id: 'ips', header: pro ? 'VIP' : 'IP address', hideBelow: pro ? 'lg' : 'md',
      cell: (l) => <div className="leading-tight">{l.ipIds.map((id) => ips.get(id)).filter(Boolean).map((ip) => <Mono key={ip!.id} copy className="block text-fg">{ip!.address}</Mono>)}{!l.ipIds.length && <span className="text-xs text-muted">internal</span>}</div>,
    },
    { id: 'location', header: 'Location', hideBelow: pro ? 'xl' : 'lg', sort: (l) => l.locationId, cell: (l) => <span className="text-fg-2">{locations.get(l.locationId)?.name ?? l.locationId}</span> },
    { id: 'tags', header: 'Tags', hideBelow: 'xl', cell: (l) => <Tags tags={l.tags} max={2} /> },
    { id: 'cost', header: 'Monthly', align: 'right', sort: (l) => l.monthlyCost ?? 0, cell: (l) => <span className="tabular text-fg">{money(l.monthlyCost)}</span> },
  ];
  const columns = allColumns.filter((c) => pro || ['name', 'status', 'health', 'ips', 'location'].includes(c.id));

  return (
    <>
      <Pro><div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Load balancers" value={`${counts.active} / ${counts.all}`} icon={Scale} sub={counts.degraded ? <span className="text-amber-600 dark:text-amber-400">{counts.degraded} degraded</span> : 'all healthy'} />
        <Stat label="Healthy targets" value={`${healthy} / ${totalTargets}`} icon={HeartPulse} sub={totalTargets - healthy ? <span className="text-rose-500">{totalTargets - healthy} not serving</span> : 'all in rotation'} />
        <Stat label="Listeners" value={listeners} icon={Layers} sub={`${tls} with TLS termination`} />
        <Stat label="Monthly run-rate" value={money(cost)} sub="incl. VIPs & processed data" accent="#ec4899" />
      </div></Pro>
      <DataTable
        rows={rows}
        loading={isLoading}
        columns={columns}
        initialSearch={sp.get('q') ?? ''}
        searchText={(l) => `${l.name} ${l.id} ${l.hostname} ${l.type} ${l.ipIds.map((i) => ips.get(i)?.address).join(' ')} ${l.listeners.map((x) => `${x.protocol}:${x.port}`).join(' ')} ${l.tags.map((t) => `${t.key}:${t.value} ${t.value}`).join(' ')}`}
        searchPlaceholder="Search name, VIP, port, tag…"
        rowLink={(l) => `/managed-services/load-balancers/${l.id}`}
        defaultSort={{ id: 'name', dir: 'asc' }}
        toolbar={<>
          <FilterChips value={status} onChange={setStatus} options={[
            { value: 'all', label: 'All', count: counts.all }, { value: 'active', label: 'Active', count: counts.active },
            ...(counts.degraded ? [{ value: 'degraded' as const, label: 'Degraded', count: counts.degraded }] : []),
            ...(counts.transitional ? [{ value: 'transitional' as const, label: 'In progress', count: counts.transitional }] : []),
            ...(counts.error ? [{ value: 'error' as const, label: 'Error', count: counts.error }] : []),
          ]} />
          {pro && <FilterChips value={type} onChange={setType} options={[{ value: 'all', label: 'Any type' }, { value: 'L7', label: 'L7 HTTP' }, { value: 'L4', label: 'L4 TCP/UDP' }]} />}
        </>}
        rowActions={(l) => (
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />} items={[
            { label: pro ? 'Traffic flow' : 'Overview', icon: Activity, to: `/managed-services/load-balancers/${l.id}` },
            { label: 'Targets & health', icon: HeartPulse, to: `/managed-services/load-balancers/${l.id}?tab=targets` },
            { label: pro ? 'Listeners & rules' : 'Listeners', icon: Globe2, to: `/managed-services/load-balancers/${l.id}?tab=listeners` },
            { divider: true, label: '' },
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => { deleteLoadBalancers([l]) } },
          ]} />
        )}
        bulkActions={[{ label: 'Delete', icon: Trash2, danger: true, onClick: async (r) => { await deleteLoadBalancers(r) } }]}
        empty={{ icon: Scale, title: 'No load balancers yet', description: 'Put a highly available VIP with health-checked targets in front of your VMs or Kubernetes services.', action: <Button variant="primary" icon={Plus} to="/managed-services/load-balancers/new">Create load balancer</Button> }}
      />
    </>
  );
}
