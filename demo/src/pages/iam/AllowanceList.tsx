import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Wallet, Plus, LayoutGrid, List, TrendingUp, AlertTriangle, Gauge, Users, Lock, Boxes } from 'lucide-react';
import { useList, useLookup } from '@/api/hooks';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Segmented } from '@/components/ui/Tabs';
import { Stat } from '@/components/ui/Stat';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { BudgetGauge, BurnBar, budgetState } from '@/components/iam/Budget';
import { QuotaMini, QUOTAS } from '@/components/iam/Quotas';
import { NewProjectModal } from '@/components/iam/NewProjectModal';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { ProjectAllowance, Project, QuotaKey } from '@/types';

type Filter = 'all' | 'risk' | 'over' | 'quota';

function hotQuotas(a: ProjectAllowance) {
  return QUOTAS.filter((q) => a.quotas[q.key] > 0 && (a.usage?.[q.key] ?? 0) / a.quotas[q.key] >= 0.9);
}

export default function AllowanceList() {
  const [sp, setSp] = useSearchParams();
  const { items: allowances, isLoading } = useList<ProjectAllowance>('allowances');
  const { map: projects } = useLookup<Project>('projects');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [filter, setFilter] = useState<Filter>('all');
  const open = sp.get('new') === '1';
  const setOpen = (v: boolean) => { const n = new URLSearchParams(sp); if (v) n.set('new', '1'); else n.delete('new'); setSp(n, { replace: true }) };

  const totals = useMemo(() => {
    const budget = allowances.reduce((a, x) => a + x.budgetMonthly, 0);
    const mtd = allowances.reduce((a, x) => a + (x.mtdSpend ?? 0), 0);
    const forecast = allowances.reduce((a, x) => a + (x.forecastSpend ?? 0), 0);
    const states = allowances.map((a) => budgetState(a));
    return { budget, mtd, forecast, risk: states.filter((s) => s.level !== 'ok').length, over: states.filter((s) => s.level === 'over').length, hot: allowances.filter((a) => hotQuotas(a).length).length };
  }, [allowances]);

  const rows = allowances.filter((a) => {
    const st = budgetState(a);
    return filter === 'all' || (filter === 'risk' ? st.level !== 'ok' : filter === 'over' ? st.level === 'over' : hotQuotas(a).length > 0);
  });

  const columns: Column<ProjectAllowance>[] = [
    {
      id: 'name', header: 'Project', sort: (a) => a.name,
      cell: (a) => {
        const p = projects.get(a.projectId);
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: p?.color ?? '#94a3b8' }} />
            <div className="min-w-0"><Link to={`/iam/project-allowances/${a.id}`} className="block truncate font-medium text-fg hover:text-brand-500">{a.name}</Link><div className="truncate text-[11.5px] text-muted">{p?.description || a.projectId}</div></div>
          </div>
        );
      },
    },
    { id: 'burn', header: 'Budget burn', sort: (a) => budgetState(a).fPct, cell: (a) => <div className="w-40"><BurnBar allowance={a} /><div className="mt-1 text-[11px] text-muted tabular">{Math.round(budgetState(a).mPct)}% spent · forecast {Math.round(budgetState(a).fPct)}%</div></div> },
    { id: 'mtd', header: 'Month to date', align: 'right', sort: (a) => a.mtdSpend ?? 0, cell: (a) => <span className="tabular text-fg">{money(a.mtdSpend)}</span> },
    { id: 'forecast', header: 'Forecast', align: 'right', hideBelow: 'md', sort: (a) => a.forecastSpend ?? 0, cell: (a) => <span className="tabular" style={{ color: budgetState(a).level === 'ok' ? undefined : budgetState(a).color }}>{money(a.forecastSpend)}</span> },
    { id: 'budget', header: 'Budget', align: 'right', sort: (a) => a.budgetMonthly, cell: (a) => <span className="tabular text-fg-2">{money(a.budgetMonthly)}{a.hardLimit && <Lock className="ml-1 inline size-3 text-faint" />}</span> },
    { id: 'quotas', header: 'Quotas', hideBelow: 'lg', cell: (a) => <div className="w-48"><QuotaMini usage={a.usage} quotas={a.quotas} keys={['vcpus', 'ramGB']} /></div> },
    { id: 'members', header: 'Members', align: 'right', hideBelow: 'xl', sort: (a) => a.members ?? 0, cell: (a) => <span className="tabular text-fg-2">{a.members ?? 0}</span> },
  ];

  return (
    <Page wide>
      <PageHeader title="Projects & Budgets" icon={Wallet} iconColor="#f59e0b"
        description="Every project has a monthly budget, alert thresholds, resource quotas and policies (allowed services, locations, required tags)."
        actions={<Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>New project</Button>} />

      <div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Spend this month" value={money(totals.mtd)} icon={Wallet} sub={`of ${money(totals.budget)} budgeted`} />
        <Stat label="Forecast" value={money(totals.forecast)} icon={TrendingUp} accent={totals.forecast > totals.budget ? '#f43f5e' : '#10b981'}
          sub={<span className={totals.forecast > totals.budget ? 'text-rose-600 dark:text-rose-400' : ''}>{totals.budget ? `${Math.round((totals.forecast / totals.budget) * 100)}% of total budget` : '—'}</span>} />
        <Stat label="Projects at risk" value={`${totals.risk} / ${allowances.length}`} icon={AlertTriangle} sub={totals.over ? <span className="text-rose-600 dark:text-rose-400">{totals.over} forecast over budget</span> : 'none over budget'} />
        <Stat label="Quota hot spots" value={totals.hot} icon={Gauge} sub="projects with a quota ≥ 90% used" />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <FilterChips value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All', count: allowances.length }, { value: 'risk', label: 'At risk', count: totals.risk },
          { value: 'over', label: 'Over budget', count: totals.over }, { value: 'quota', label: 'Quota ≥ 90%', count: totals.hot },
        ]} />
        <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'grid', label: '', icon: <LayoutGrid className="size-3.5" /> }, { value: 'table', label: '', icon: <List className="size-3.5" /> }]} />
      </div>

      {view === 'table' ? (
        <DataTable rows={rows} loading={isLoading} columns={columns} searchText={(a) => `${a.name} ${a.projectId}`} rowLink={(a) => `/iam/project-allowances/${a.id}`} defaultSort={{ id: 'burn', dir: 'desc' }}
          empty={{ icon: Wallet, title: 'No projects', action: <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>New project</Button> }} />
      ) : isLoading && !allowances.length ? (
        <div className="grid [&>*]:min-w-0 gap-4 @min-[40rem]:grid-cols-2 @min-[60rem]:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-72" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Wallet} title={allowances.length ? 'No projects match' : 'No projects in this account'} action={<Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>New project</Button>} />
      ) : (
        <div className="grid [&>*]:min-w-0 gap-4 @min-[40rem]:grid-cols-2 @min-[60rem]:grid-cols-3">
          {rows.map((a) => <ProjectCard key={a.id} a={a} color={projects.get(a.projectId)?.color ?? '#94a3b8'} description={projects.get(a.projectId)?.description} />)}
          <button onClick={() => setOpen(true)} className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line text-muted transition-colors hover:border-brand-500 hover:text-brand-500">
            <Plus className="size-6" /><span className="text-sm font-medium">New project</span><span className="text-xs">with its own budget & quotas</span>
          </button>
        </div>
      )}
      <NewProjectModal open={open} onClose={() => setOpen(false)} />
    </Page>
  );
}

function ProjectCard({ a, color, description }: { a: ProjectAllowance; color: string; description?: string }) {
  const st = budgetState(a);
  const hot = hotQuotas(a);
  const usageKeys: QuotaKey[] = ['vcpus', 'ramGB', 'vms', 'volumesGB'];
  return (
    <Link to={`/iam/project-allowances/${a.id}`} className="group relative flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop">
      <div className="h-1" style={{ background: color }} />
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <div className="min-w-0">
          <div className="truncate font-semibold text-fg group-hover:text-brand-500">{a.name}</div>
          <div className="line-clamp-1 text-xs text-muted">{description || a.projectId}</div>
        </div>
        <Badge tone={st.level === 'over' ? 'danger' : st.level === 'warn' ? 'warning' : 'success'} dot>{st.label}</Badge>
      </div>
      <div className="flex items-center gap-4 px-4 pt-2">
        <BudgetGauge allowance={a} size={136} />
        <dl className="min-w-0 flex-1 space-y-1.5 text-[12.5px]">
          <div className="flex justify-between gap-2"><dt className="text-muted">Spent</dt><dd className="tabular font-medium text-fg">{money(a.mtdSpend)}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted">Forecast</dt><dd className={cn('tabular font-medium', st.level === 'ok' ? 'text-fg' : '')} style={st.level !== 'ok' ? { color: st.color } : undefined}>{money(a.forecastSpend)}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted">Budget</dt><dd className="tabular text-fg-2">{money(a.budgetMonthly)}{a.hardLimit && <Lock className="ml-1 inline size-3 text-faint" aria-label="hard limit" />}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted">Run-rate</dt><dd className="tabular text-fg-2">{money(a.monthlySpend)}/mo</dd></div>
        </dl>
      </div>
      <div className="mt-3 border-t border-line px-4 py-3">
        <QuotaMini usage={a.usage} quotas={a.quotas} keys={usageKeys} />
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line bg-surface-2/40 px-4 py-2 text-[11.5px] text-muted">
        <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{a.members ?? 0}</span>
        <span className="inline-flex items-center gap-1"><Boxes className="size-3.5" />{a.resourceCount ?? 0} resources</span>
        {hot.length > 0 ? <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400"><Gauge className="size-3.5" />{hot.map((q) => q.label).join(', ')} near limit</span> : <span>{a.allowedLocations.length} locations</span>}
      </div>
    </Link>
  );
}
