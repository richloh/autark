import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Shield, Plus, Trash2, MoreHorizontal, Copy, ShieldAlert, ShieldCheck, Unplug, ListChecks, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { useList, useLookup } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { Badge, Tags } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Stat } from '@/components/ui/Stat';
import { toast } from '@/components/ui/toast';
import { KINDS } from '@/lib/kinds';
import { num } from '@/lib/format';
import { exposureOf } from '@/components/network/util';
import { deleteFirewalls } from '@/components/network/firewallActions';
import { Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import type { Firewall, Project, ResourceKind } from '@/types';

type Filter = 'all' | 'exposed' | 'unattached';

export default function FirewallList() {
  const [sp] = useSearchParams();
  const pro = usePro();
  const { items: fws, isLoading } = useList<Firewall>('firewalls');
  const { map: projects } = useLookup<Project>('projects');
  const [filter, setFilter] = useState<Filter>('all');
  const exposure = useMemo(() => new Map(fws.map((f) => [f.id, exposureOf(f.rules, f.defaultInbound)])), [fws]);
  const critical = (f: Firewall) => (exposure.get(f.id) ?? []).filter((e) => e.level === 'critical').length;
  const counts = { all: fws.length, exposed: fws.filter((f) => critical(f) > 0).length, unattached: fws.filter((f) => !f.attachedTo.length).length };
  const rows = fws.filter((f) => !pro || filter === 'all' || (filter === 'exposed' ? critical(f) > 0 : !f.attachedTo.length));

  const duplicate = async (f: Firewall) => {
    try { const c = await api.action<Firewall>('firewalls', f.id, 'duplicate', {}); toast.success(`Created ${c.name}`) } catch (e) { toast.error('Duplicate failed', (e as Error).message) }
  };

  const allColumns: Column<Firewall>[] = [
    {
      id: 'name', header: 'Name', sort: (f) => f.name,
      cell: (f) => (
        <div className="min-w-0">
          <Link to={`/infrastructure/firewalls/${f.id}`} className="block truncate font-medium text-fg hover:text-brand-500">{f.name}</Link>
          <div className="flex items-center gap-1.5 truncate text-[11px] text-muted">
            {projects.get(f.projectId) && <span className="size-1.5 shrink-0 rounded-full" style={{ background: projects.get(f.projectId)!.color }} />}
            {f.description || (pro ? f.id : '')}
          </div>
        </div>
      ),
    },
    {
      id: 'rules', header: 'Rules', sort: (f) => f.rules.length,
      cell: (f) => !pro ? <span className="tabular text-fg-2">{f.rules.filter((r) => r.direction === 'inbound').length}</span> : (
        <span className="flex items-center gap-2 text-xs text-fg-2">
          <span className="flex items-center gap-0.5" title="inbound"><ArrowDownToLine className="size-3 text-sky-500" />{f.rules.filter((r) => r.direction === 'inbound').length}</span>
          <span className="flex items-center gap-0.5" title="outbound"><ArrowUpFromLine className="size-3 text-violet-500" />{f.rules.filter((r) => r.direction === 'outbound').length}</span>
          {f.rules.some((r) => !r.enabled) && <span className="text-faint">· {f.rules.filter((r) => !r.enabled).length} off</span>}
        </span>
      ),
    },
    {
      id: 'exposure', header: 'Internet exposure', sort: (f) => critical(f) * 10 + (exposure.get(f.id)?.length ?? 0),
      cell: (f) => {
        const ex = exposure.get(f.id) ?? [];
        const c = critical(f);
        if (!ex.length) return <Badge tone="success"><ShieldCheck className="size-3" />private</Badge>;
        return (
          <div className="flex flex-wrap gap-1">
            {c > 0 && <Badge tone="danger" title={ex.filter((e) => e.level === 'critical').map((e) => e.title).join('\n')}><ShieldAlert className="size-3" />{c} critical</Badge>}
            {ex.length - c > 0 && <Badge tone={ex.some((e) => e.level === 'warning') ? 'warning' : 'info'} title={ex.filter((e) => e.level !== 'critical').map((e) => e.title).join('\n')}>{ex.length - c} public</Badge>}
          </div>
        );
      },
    },
    {
      id: 'attached', header: pro ? 'Attached to' : 'Applied to', sort: (f) => f.attachedTo.length,
      cell: (f) => {
        if (!f.attachedTo.length) return <span className="flex items-center gap-1 text-xs text-faint"><Unplug className="size-3" />{pro ? 'unattached' : 'nothing'}</span>;
        const by = f.attachedTo.reduce<Record<string, number>>((a, r) => ({ ...a, [r.type]: (a[r.type] ?? 0) + 1 }), {});
        return (
          <span className="flex items-center gap-2 text-xs text-fg-2">
            {Object.entries(by).map(([t, n]) => { const K = KINDS[t as ResourceKind]; const I = K.icon; return <span key={t} className="flex items-center gap-0.5" title={K.plural}><I className="size-3.5" style={{ color: K.color }} />{n}</span> })}
          </span>
        );
      },
    },
    { id: 'default', header: 'Default in / out', hideBelow: 'lg', cell: (f) => <span className="text-xs"><span className={f.defaultInbound === 'deny' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}>{f.defaultInbound}</span> / <span className="text-fg-2">{f.defaultOutbound}</span></span> },
    { id: 'tags', header: 'Tags', hideBelow: 'xl', cell: (f) => <Tags tags={f.tags} max={2} /> },
  ];
  const columns = allColumns.filter((c) => pro || ['name', 'rules', 'attached'].includes(c.id));

  return (
    <Page wide>
      <PageHeader title="Firewalls" description={pro ? 'Stateful, distributed firewalls enforced on every hypervisor. Attach them to VMs, databases, load balancers and Kubernetes nodes.' : 'Control which traffic may reach your servers.'} icon={Shield} iconColor="#f97316"
        actions={<Button variant="primary" icon={Plus} to="/infrastructure/firewalls/new">Create firewall</Button>} />
      <Pro><div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Firewalls" value={num(fws.length)} icon={Shield} sub={`${num(fws.reduce((a, f) => a + f.attachedTo.length, 0))} attachments`} />
        <Stat label="Rules" value={num(fws.reduce((a, f) => a + f.rules.length, 0))} icon={ListChecks} sub="inbound + outbound" />
        <Stat label="Critical exposures" value={num(fws.reduce((a, f) => a + critical(f), 0))} icon={ShieldAlert} sub={counts.exposed ? <span className="text-rose-500">in {counts.exposed} firewall(s)</span> : 'nothing sensitive is public'} />
        <Stat label="Unattached" value={num(counts.unattached)} icon={Unplug} sub="have no effect" accent="#f97316" />
      </div></Pro>
      <DataTable
        rows={rows}
        loading={isLoading}
        columns={columns}
        initialSearch={sp.get('q') ?? ''}
        searchText={(f) => `${f.name} ${f.id} ${f.description} ${f.rules.map((r) => `${r.ports} ${r.source} ${r.description}`).join(' ')}`}
        searchPlaceholder="Search name, port, CIDR…"
        rowLink={(f) => `/infrastructure/firewalls/${f.id}`}
        defaultSort={{ id: 'name', dir: 'asc' }}
        toolbar={pro && <FilterChips value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All', count: counts.all }, { value: 'exposed', label: 'Exposed', count: counts.exposed }, { value: 'unattached', label: 'Unattached', count: counts.unattached }]} />}
        rowActions={(f) => (
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />} items={[
            { label: 'Edit rules', icon: ListChecks, to: `/infrastructure/firewalls/${f.id}` },
            ...(pro ? [{ label: 'Packet tester', icon: ShieldCheck, to: `/infrastructure/firewalls/${f.id}?tab=tester` }] : []),
            { label: 'Duplicate', icon: Copy, onClick: () => duplicate(f) },
            { divider: true, label: '' },
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => deleteFirewalls([f]) },
          ]} />
        )}
        bulkActions={[{ label: 'Delete', icon: Trash2, danger: true, onClick: (r) => { void deleteFirewalls(r) } }]}
        empty={{ icon: Shield, title: 'No firewalls', description: 'Without a firewall, all inbound traffic to a resource is blocked.', action: <Button variant="primary" icon={Plus} to="/infrastructure/firewalls/new">Create firewall</Button> }}
      />
    </Page>
  );
}
