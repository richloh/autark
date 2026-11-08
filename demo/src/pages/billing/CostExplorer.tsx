import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Wallet, Download, CalendarClock, TrendingUp, Gauge, AreaChart as AreaIcon, BarChart3, Filter, X, Building2, Cloud, PiggyBank } from 'lucide-react';
import { useGet, useList } from '@/api/hooks';
import { useUi, usePro } from '@/store/ui';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Stat } from '@/components/ui/Stat';
import { Segmented, Tabs, useTabParam } from '@/components/ui/Tabs';
import { Select } from '@/components/ui/form';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Meter, Skeleton, Mono } from '@/components/ui/misc';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { toast } from '@/components/ui/toast';
import { StackedCostChart, SavingsCard, type CostSeries } from '@/components/overview/CostCharts';
import {
  useCostSummary, useCostHistory, serviceColor, SERVICE_LABEL, SERVICE_ORDER, HYPERSCALER_MULTIPLIER, flag, toCsv, downloadFile, todayStamp, type CostItem,
} from '@/components/overview/shared';
import { money, pct } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Project, Location, Tag, ResourceKind } from '@/types';
import type { CostSummary } from '@/components/overview/shared';

type Range = '7' | '30' | '90';
type GroupBy = 'service' | 'project';

const TAGGED_COLLECTIONS = ['vms', 'volumes', 'snapshots', 'ips', 'networks', 'dnsZones', 'dbInstances', 'k8sClusters', 'buckets', 'loadBalancers'];
const KIND_OK = new Set<string>(['vm', 'volume', 'snapshot', 'ip', 'network', 'dnsZone', 'db', 'k8s', 'bucket', 'lb']);

/** id -> tags for every billable resource in scope (for tag filtering). */
function useTagIndex() {
  const lists = TAGGED_COLLECTIONS.map((c) => useList<{ id: string; tags?: Tag[] }>(c)); // fixed-length list: hook order is stable
  return useMemo(() => {
    const m = new Map<string, Tag[]>();
    for (const l of lists) for (const r of l.items) m.set(r.id, r.tags ?? []);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, lists.map((l) => l.items));
}

export default function CostExplorer() {
  const [sp, setSp] = useSearchParams();
  const accountId = useUi((s) => s.accountId);
  const pro = usePro();
  // Simple mode: one clear month view — no filters, ranges or grouping.
  const range = pro ? (sp.get('range') as Range) || '30' : '30';
  const groupBy = pro ? (sp.get('groupBy') as GroupBy) || 'service' : 'service';
  const projectFilter = pro ? sp.get('project') ?? '' : '';
  const tagFilter = pro ? sp.get('tag') ?? '' : '';
  const setParam = (k: string, v: string, def = '') => { const n = new URLSearchParams(sp); if (!v || v === def) n.delete(k); else n.set(k, v); setSp(n, { replace: true }) };

  const [chart, setChart] = useState<'area' | 'bar'>('area');
  const [view, setView] = useTabParam('service', 'view');
  const { data: summary, isLoading } = useCostSummary();
  // simple mode charts the current calendar month: actual days so far + forecast to month end
  const days = pro ? Number(range) : summary?.dayOfMonth ?? 30;
  const forecastDays = pro ? (days === 7 ? 3 : days === 30 ? 7 : 14) : summary ? summary.daysInMonth - summary.dayOfMonth : 0;

  const { data: history } = useCostHistory(days, groupBy, forecastDays);
  const { data: itemsRes, isLoading: itemsLoading } = useGet<{ items: CostItem[] }>(['costs', 'items'], '/costs/items');
  const { items: projects } = useList<Project>('projects');
  const { items: locations } = useList<Location>('locations');
  const tagIndex = useTagIndex();

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const allItems = itemsRes?.items ?? [];
  const accountProjects = projects.filter((p) => p.accountId === accountId && (summary?.byProject.some((b) => b.projectId === p.id) ?? true));

  const tagOptions = useMemo(() => {
    const s = new Map<string, number>();
    for (const i of allItems) for (const t of tagIndex.get(i.id) ?? []) { const k = `${t.key}=${t.value}`; s.set(k, (s.get(k) ?? 0) + 1) }
    return [...s].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => ({ value: k, label: `${k} (${n})` }));
  }, [allItems, tagIndex]);

  const items = useMemo(() => allItems.filter((i) => {
    if (projectFilter && i.projectId !== projectFilter) return false;
    if (tagFilter) {
      const [k, v] = tagFilter.split('=');
      if (!(tagIndex.get(i.id) ?? []).some((t) => t.key === k && t.value === v)) return false;
    }
    return true;
  }), [allItems, projectFilter, tagFilter, tagIndex]);
  const filtered = !!(projectFilter || tagFilter);

  const totalAll = allItems.reduce((a, i) => a + i.monthly, 0);
  const total = items.reduce((a, i) => a + i.monthly, 0);
  const share = totalAll ? total / totalAll : 1;

  const byService = useMemo(() => group(items, (i) => i.service), [items]);
  const byProject = useMemo(() => group(items, (i) => i.projectId), [items]);
  const byLocation = useMemo(() => group(items, (i) => i.locationId ?? 'global'), [items]);

  /* history, apportioned by current share when a filter is active */
  const series: CostSeries[] = useMemo(() => {
    if (!history) return [];
    const allByKey = group(allItems, (i) => (groupBy === 'service' ? i.service : i.projectId));
    const fByKey = group(items, (i) => (groupBy === 'service' ? i.service : i.projectId));
    const ordered = [...history.series].sort((a, b) => groupBy === 'service' ? SERVICE_ORDER.indexOf(a.key) - SERVICE_ORDER.indexOf(b.key) : a.label.localeCompare(b.label));
    return ordered.map((s) => {
      const k = filtered ? (allByKey.get(s.key) ? (fByKey.get(s.key) ?? 0) / allByKey.get(s.key)! : 0) : 1;
      const f = history.forecast.find((x) => x.key === s.key);
      return {
        id: s.key,
        label: groupBy === 'service' ? SERVICE_LABEL[s.key] ?? s.label : projectById.get(s.key)?.name ?? s.label,
        color: groupBy === 'service' ? serviceColor(s.key) : projectById.get(s.key)?.color ?? '#94a3b8',
        points: s.points.map((p) => ({ t: p.t, v: p.v * k })),
        forecast: (f?.points ?? []).map((p) => ({ t: p.t, v: p.v * k })),
      };
    }).filter((s) => s.points.some((p) => p.v > 0));
  }, [history, items, allItems, groupBy, filtered, projectById]);

  const periodTotal = series.reduce((a, s) => a + s.points.reduce((x, p) => x + p.v, 0), 0);
  const budget = projectFilter ? summary?.byProject.find((p) => p.projectId === projectFilter)?.budget ?? 0 : summary?.budget ?? 0;
  const budgetDaily = budget && !tagFilter ? budget / 30 : undefined;

  const bars: BarDatum[] = useMemo(() => {
    if (!series.length) return [];
    const fmt = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    const actual = series[0].points.map((p, i) => ({ label: fmt(p.t), segments: series.map((s) => ({ id: s.id, label: s.label, value: s.points[i]?.v ?? 0, color: s.color })) }));
    const fc = (series[0].forecast ?? []).map((p, i) => ({ label: fmt(p.t), forecast: true, segments: series.map((s) => ({ id: s.id, label: s.label, value: s.forecast?.[i]?.v ?? 0, color: s.color })) }));
    return [...actual, ...fc];
  }, [series]);

  const exportCsv = () => {
    const rows = items.map((i) => ({
      id: i.id, name: i.name, type: i.type, service: SERVICE_LABEL[i.service] ?? i.service, project: projectById.get(i.projectId)?.name ?? i.projectId,
      location: i.locationId ?? '', tags: (tagIndex.get(i.id) ?? []).map((t) => `${t.key}=${t.value}`).join(' '), monthly_eur: i.monthly.toFixed(2), daily_eur: (i.monthly / 30).toFixed(2),
    }));
    downloadFile(`autark-cost-items-${todayStamp()}.csv`, toCsv(rows));
    toast.success(`Exported ${rows.length} line items`);
  };

  const savings = useMemo(() => [...byService].map(([service, monthly]) => ({ service, monthly })), [byService]);
  const hyperTotal = savings.reduce((a, s) => a + s.monthly * (HYPERSCALER_MULTIPLIER[s.service] ?? 3), 0);

  if (!pro) return <SimpleCosts summary={summary} loading={isLoading} series={series} historyLoaded={!!history} byService={byService} items={items} itemsLoading={itemsLoading} total={total} onExport={exportCsv} />;

  return (
    <Page wide>
      <PageHeader
        title="Cost Explorer"
        icon={Wallet}
        iconColor="#10b981"
        description="Showback for every resource in scope: trends, forecast, budgets and a breakdown down to individual line items."
        actions={<Button icon={Download} onClick={exportCsv} disabled={!items.length}>Export CSV</Button>}
      />

      {/* filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted"><Filter className="size-3.5" />Filter</span>
        <Select className="w-full @min-[36rem]:w-52" value={projectFilter} onChange={(e) => setParam('project', e.target.value)} placeholder="All projects in scope"
          options={accountProjects.map((p) => ({ value: p.id, label: p.name }))} />
        <Select className="w-full @min-[36rem]:w-60" value={tagFilter} onChange={(e) => setParam('tag', e.target.value)} placeholder="Any tag" options={tagOptions} />
        {filtered && <Button size="sm" variant="ghost" icon={X} onClick={() => { const n = new URLSearchParams(sp); n.delete('project'); n.delete('tag'); setSp(n, { replace: true }) }}>Clear</Button>}
        {filtered && <span className="text-xs text-muted">{items.length} of {allItems.length} line items · {pct(share)} of spend</span>}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Monthly run-rate" icon={Wallet} accent="#10b981" value={isLoading ? <Skeleton className="h-7 w-24" /> : money(total, { decimals: false })}
          delta={!filtered && summary?.lastMonth ? ((summary.total - summary.lastMonth) / summary.lastMonth) * 100 : undefined} deltaGoodWhen="down" sub={filtered ? 'filtered' : 'vs last month'} />
        <Stat label="Month to date" icon={CalendarClock} value={summary ? money(summary.mtd * share, { decimals: false }) : '—'} sub={summary ? `day ${summary.dayOfMonth} of ${summary.daysInMonth}` : undefined} />
        <Stat label="Forecast (month end)" icon={TrendingUp} value={summary ? money(summary.forecast * share, { decimals: false }) : '—'}
          sub={budget ? <span className={cn(summary && summary.forecast * share > budget ? 'text-rose-500' : '')}>{pct((summary?.forecast ?? 0) * share / budget)} of budget</span> : 'no budget set'} />
        <Stat label="Budget" icon={Gauge} value={budget ? money(budget, { decimals: false }) : '—'} sub={budget ? `${money(Math.max(0, budget - total))} headroom` : 'set in project allowances'} to="/iam/project-allowances" />
      </div>

      <div className="mb-4 grid gap-4 @min-[60rem]:grid-cols-3">
        <Card className="min-w-0 @min-[60rem]:col-span-2">
          <CardHeader title="Daily cost" description={series.length ? `${money(periodTotal, { decimals: false })} over the last ${days} days · Ø ${money(periodTotal / days)}/day${filtered ? ' · apportioned by current share' : ''}` : 'Loading…'} />
          <CardBody>
            <div className="mb-3 flex flex-wrap gap-2">
              <Segmented size="sm" value={range} onChange={(v) => setParam('range', v, '30')} options={[{ value: '7', label: '7d' }, { value: '30', label: '30d' }, { value: '90', label: '90d' }]} />
              <Segmented size="sm" value={groupBy} onChange={(v) => setParam('groupBy', v, 'service')} options={[{ value: 'service', label: 'Service' }, { value: 'project', label: 'Project' }]} />
              <Segmented size="sm" value={chart} onChange={setChart} options={[{ value: 'area', label: '', icon: <AreaIcon className="size-3.5" /> }, { value: 'bar', label: '', icon: <BarChart3 className="size-3.5" /> }]} />
            </div>
            {!history ? <Skeleton className="h-[280px]" /> : chart === 'area' ? (
              <StackedCostChart series={series} height={280} budgetDaily={budgetDaily} />
            ) : (
              <>
                <BarChart data={bars} height={260} format={(v) => money(v)} budgetLine={budgetDaily ? { value: budgetDaily, label: `daily budget ${money(budgetDaily)}` } : undefined} />
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">{series.map((s) => <span key={s.id} className="inline-flex items-center gap-1.5 text-xs text-muted"><span className="h-2 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}</div>
              </>
            )}
          </CardBody>
        </Card>
        <Card className="min-w-0">
          <CardHeader icon={PiggyBank} title="Savings vs. hyperscaler" description="What the same footprint would cost on-demand" />
          <CardBody>{savings.length ? <SavingsCard byService={savings} /> : <div className="py-10 text-center text-sm text-muted">No spend in this selection</div>}</CardBody>
        </Card>
      </div>

      <Card className="min-w-0 overflow-hidden">
        <div className="px-4 pt-3">
          <Tabs value={view} onChange={setView} tabs={[
            { id: 'service', label: 'By service', count: byService.size },
            { id: 'project', label: 'By project', count: byProject.size },
            { id: 'location', label: 'By location', count: byLocation.size },
            { id: 'items', label: 'Line items', count: items.length },
          ]} />
        </div>
        {view === 'service' && (
          <BreakdownTable total={total} rows={[...byService].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({
            id: k, value: v, count: items.filter((i) => i.service === k).length,
            label: <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: serviceColor(k) }} />{SERVICE_LABEL[k] ?? k}</span>,
            extra: <span className="text-muted" title="Estimated hyperscaler on-demand equivalent">{money(v * (HYPERSCALER_MULTIPLIER[k] ?? 3))}</span>,
            color: serviceColor(k),
          }))} extraHeader="Hyperscaler est." />
        )}
        {view === 'project' && (
          <BreakdownTable total={total} rows={[...byProject].sort((a, b) => b[1] - a[1]).map(([k, v]) => {
            const p = projectById.get(k);
            const b = summary?.byProject.find((x) => x.projectId === k);
            return {
              id: k, value: v, count: items.filter((i) => i.projectId === k).length, color: p?.color ?? '#94a3b8',
              label: <Link to={b?.allowanceId ? `/iam/project-allowances/${b.allowanceId}` : '/iam/project-allowances'} className="flex items-center gap-2 hover:text-brand-500"><span className="size-2.5 rounded-full" style={{ background: p?.color }} />{p?.name ?? k}</Link>,
              extra: b?.budget ? <div className="w-32"><Meter value={b.monthly} max={b.budget} size="sm" thresholds={[0.8, 1]} /><div className="mt-0.5 text-[11px] text-faint">{pct(b.monthly / b.budget)} of {money(b.budget)}</div></div> : <span className="text-faint">no budget</span>,
            };
          })} extraHeader="Budget" />
        )}
        {view === 'location' && (
          <BreakdownTable total={total} rows={[...byLocation].sort((a, b) => b[1] - a[1]).map(([k, v]) => {
            const l = locById.get(k);
            return {
              id: k, value: v, count: items.filter((i) => (i.locationId ?? 'global') === k).length, color: l?.kind === 'cloud' ? '#0ea5e9' : '#5b67f8',
              label: <span className="flex items-center gap-2">{l?.kind === 'cloud' ? <Cloud className="size-3.5 text-sky-500" /> : <Building2 className="size-3.5 text-brand-500" />}{l?.name ?? (k === 'global' ? 'Global (DNS, IPs)' : k)}</span>,
              extra: l ? <span className="text-muted">{flag(l.country)} {l.city}</span> : <span className="text-faint">—</span>,
            };
          })} extraHeader="Where" />
        )}
        {view === 'items' && (
          <ItemsTable items={items} loading={itemsLoading} projectById={projectById} locById={locById} tagIndex={tagIndex} onExport={exportCsv} />
        )}
        {view !== 'items' && hyperTotal > 0 && <div className="border-t border-line px-4 py-2 text-[11px] text-faint">Hyperscaler figures are estimates for comparison only.</div>}
      </Card>
    </Page>
  );
}

/* ------------------------------------------------------------------ simple mode */

function SimpleCosts({ summary, loading, series, historyLoaded, byService, items, itemsLoading, total, onExport }: {
  summary?: CostSummary; loading: boolean; series: CostSeries[]; historyLoaded: boolean; byService: Map<string, number>; items: CostItem[]; itemsLoading: boolean; total: number; onExport: () => void;
}) {
  const mtd = summary?.mtd ?? 0, forecast = summary?.forecast ?? 0, budget = summary?.budget ?? 0;
  const over = budget > 0 && forecast > budget;
  const month = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const bars: BarDatum[] = useMemo(() => {
    if (!series.length) return [];
    const fmt = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    const sum = (i: number, key: 'points' | 'forecast') => series.reduce((a, s) => a + (s[key]?.[i]?.v ?? 0), 0);
    const actual = series[0].points.map((p, i) => ({ label: fmt(p.t), segments: [{ id: 'cost', label: 'Cost', value: sum(i, 'points'), color: '#10b981' }] }));
    const fc = (series[0].forecast ?? []).map((p, i) => ({ label: fmt(p.t), forecast: true, segments: [{ id: 'cost', label: 'Forecast', value: sum(i, 'forecast'), color: '#10b981' }] }));
    return [...actual, ...fc];
  }, [series]);
  const top = items.slice().sort((a, b) => b.monthly - a.monthly).slice(0, 8);

  return (
    <Page wide>
      <PageHeader title="Costs" icon={Wallet} iconColor="#10b981" description="What you are spending this month."
        actions={<Button size="sm" icon={Download} onClick={onExport} disabled={!items.length}>CSV</Button>} />

      <Card className="mb-4 p-5">
        <div className="mb-4 text-[13px] font-medium text-muted">{month}</div>
        <div className="grid gap-5 @min-[36rem]:grid-cols-3 @min-[36rem]:divide-x @min-[36rem]:divide-line">
          <BigNumber label="This month so far" value={loading ? null : money(mtd, { decimals: false })} sub={summary ? `day ${summary.dayOfMonth} of ${summary.daysInMonth}` : undefined} />
          <BigNumber label="Forecast" value={loading ? null : money(forecast, { decimals: false })} sub={summary?.lastMonth ? `last month ${money(summary.lastMonth, { decimals: false })}` : undefined} className="@min-[36rem]:pl-5" tone={over ? 'text-rose-600 dark:text-rose-400' : undefined} />
          <BigNumber label="Budget" value={loading ? null : budget ? money(budget, { decimals: false }) : '—'} sub={budget ? (over ? `forecast ${money(forecast - budget, { decimals: false })} over` : `${money(Math.max(0, budget - forecast), { decimals: false })} to spare`) : <Link to="/iam/project-allowances" className="text-brand-500 hover:underline">Set a budget</Link>} className="@min-[36rem]:pl-5" />
        </div>
        {budget > 0 && (
          <div className="mt-5">
            <div className="relative h-2.5 overflow-hidden rounded-full bg-surface-3">
              <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-500/30" style={{ width: `${Math.min(100, (forecast / budget) * 100)}%` }} />
              <div className={cn('absolute inset-y-0 left-0 rounded-full', over ? 'bg-rose-500' : 'bg-emerald-500')} style={{ width: `${Math.min(100, (mtd / budget) * 100)}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-[11.5px] text-muted"><span>{pct(mtd / budget)} of budget used</span><span>forecast {pct(forecast / budget)}</span></div>
          </div>
        )}
      </Card>

      <Card className="mb-4 min-w-0">
        <CardHeader title="Daily cost" description="Lighter bars after today are a forecast." />
        <CardBody>
          {!historyLoaded ? <Skeleton className="h-[220px]" /> : <BarChart data={bars} height={220} format={(v) => money(v)} />}
        </CardBody>
      </Card>

      <div className="grid gap-4 @min-[60rem]:grid-cols-2">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader title="By service" />
          <BreakdownTable total={total} rows={[...byService].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({
            id: k, value: v, count: items.filter((i) => i.service === k).length, color: serviceColor(k),
            label: <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: serviceColor(k) }} />{SERVICE_LABEL[k] ?? k}</span>,
          }))} />
        </Card>
        <Card className="min-w-0 overflow-hidden">
          <CardHeader title="Top resources" description="Monthly run-rate" />
          {itemsLoading ? <div className="p-4"><Skeleton className="h-48" /></div> : !top.length ? <div className="py-12 text-center text-sm text-muted">Nothing billable yet</div> : (
            <ul className="divide-y divide-line">
              {top.map((i) => (
                <li key={`${i.type}:${i.id}`} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: serviceColor(i.service) }} title={SERVICE_LABEL[i.service] ?? i.service} />
                  <span className="min-w-0 flex-1 truncate">{KIND_OK.has(i.type) ? <ResourceLink type={i.type as ResourceKind} id={i.id} name={i.name} /> : <span className="text-fg">{i.name}</span>}</span>
                  <span className="hidden text-xs text-muted @min-[36rem]:inline">{SERVICE_LABEL[i.service] ?? i.service}</span>
                  <span className="w-20 text-right font-medium tabular text-fg">{money(i.monthly)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Page>
  );
}

function BigNumber({ label, value, sub, className, tone }: { label: string; value: React.ReactNode | null; sub?: React.ReactNode; className?: string; tone?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-[13px] text-muted">{label}</div>
      <div className={cn('mt-1 text-[28px] font-semibold leading-tight tracking-tight tabular text-fg', tone)}>{value ?? <Skeleton className="h-8 w-28" />}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function group(items: CostItem[], key: (i: CostItem) => string) {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + i.monthly);
  return m;
}

function BreakdownTable({ rows, total, extraHeader }: { rows: { id: string; label: React.ReactNode; value: number; count: number; color: string; extra?: React.ReactNode }[]; total: number; extraHeader?: string }) {
  if (!rows.length) return <div className="py-12 text-center text-sm text-muted">Nothing billable in this selection</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line bg-surface-2/50 text-xs text-muted">
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="hidden px-3 py-2 font-medium @min-[36rem]:table-cell">Items</th>
            <th className="hidden w-1/3 px-3 py-2 font-medium @min-[40rem]:table-cell">Share</th>
            {extraHeader && <th className="hidden px-3 py-2 font-medium @min-[44rem]:table-cell">{extraHeader}</th>}
            <th className="px-4 py-2 text-right font-medium">Monthly</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-2/40">
              <td className="px-4 py-2.5 text-fg">{r.label}</td>
              <td className="hidden px-3 py-2.5 tabular text-muted @min-[36rem]:table-cell">{r.count}</td>
              <td className="hidden px-3 py-2.5 @min-[40rem]:table-cell">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full" style={{ width: `${total ? (r.value / total) * 100 : 0}%`, background: r.color }} /></div>
                  <span className="w-10 text-right text-xs tabular text-muted">{pct(total ? r.value / total : 0)}</span>
                </div>
              </td>
              {extraHeader && <td className="hidden px-3 py-2.5 @min-[44rem]:table-cell">{r.extra}</td>}
              <td className="px-4 py-2.5 text-right font-medium tabular text-fg">{money(r.value)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-surface-2/40 text-[13px]">
            <td className="px-4 py-2 font-medium text-fg">Total</td>
            <td className="hidden px-3 py-2 tabular text-muted @min-[36rem]:table-cell">{rows.reduce((a, r) => a + r.count, 0)}</td>
            <td className="hidden @min-[40rem]:table-cell" />
            {extraHeader && <td className="hidden @min-[44rem]:table-cell" />}
            <td className="px-4 py-2 text-right font-semibold tabular text-fg">{money(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ItemsTable({ items, loading, projectById, locById, tagIndex, onExport }: {
  items: CostItem[]; loading: boolean; projectById: Map<string, Project>; locById: Map<string, Location>; tagIndex: Map<string, Tag[]>; onExport: () => void;
}) {
  const rows = useMemo(() => items.map((i) => ({ ...i, id: `${i.type}:${i.id}`, resId: i.id })), [items]);
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    {
      id: 'name', header: 'Resource', sort: (r) => r.name,
      cell: (r) => (
        <div className="min-w-0">
          {KIND_OK.has(r.type) ? <ResourceLink type={r.type as ResourceKind} id={r.resId} name={r.name} /> : <span className="text-fg">{r.name}</span>}
          <Mono className="block text-[11px] text-faint">{r.resId}</Mono>
        </div>
      ),
    },
    { id: 'service', header: 'Service', sort: (r) => r.service, cell: (r) => <span className="flex items-center gap-1.5 text-fg-2"><span className="size-2 rounded-sm" style={{ background: serviceColor(r.service) }} />{SERVICE_LABEL[r.service] ?? r.service}</span> },
    { id: 'project', header: 'Project', hideBelow: 'md', sort: (r) => projectById.get(r.projectId)?.name ?? '', cell: (r) => { const p = projectById.get(r.projectId); return <span className="flex items-center gap-1.5 text-fg-2"><span className="size-1.5 rounded-full" style={{ background: p?.color }} />{p?.name ?? r.projectId}</span> } },
    { id: 'location', header: 'Location', hideBelow: 'lg', sort: (r) => r.locationId ?? '', cell: (r) => <span className="text-fg-2">{r.locationId ? locById.get(r.locationId)?.name ?? r.locationId : '—'}</span> },
    { id: 'tags', header: 'Tags', hideBelow: 'xl', cell: (r) => <span className="text-[11px] text-muted">{(tagIndex.get(r.resId) ?? []).slice(0, 2).map((t) => `${t.key}=${t.value}`).join(' · ')}</span> },
    { id: 'monthly', header: 'Monthly', align: 'right', sort: (r) => r.monthly, cell: (r) => <span className="font-medium tabular text-fg">{money(r.monthly)}</span> },
  ];
  return (
    <DataTable rows={rows} loading={loading} columns={columns} className="rounded-none border-0 shadow-none" defaultSort={{ id: 'monthly', dir: 'desc' }}
      searchText={(r) => `${r.name} ${r.resId} ${r.type} ${r.service} ${projectById.get(r.projectId)?.name} ${r.locationId} ${(tagIndex.get(r.resId) ?? []).map((t) => `${t.key}=${t.value}`).join(' ')}`}
      searchPlaceholder="Search resource, type, tag…"
      toolbar={<Button size="sm" icon={Download} onClick={onExport}>CSV</Button>}
      empty={{ icon: Wallet, title: 'No line items', description: 'Nothing billable matches the current filters.' }} />
  );
}
