import { FolderPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  LayoutDashboard, Server, Database, Boxes, PackageOpen, Cpu, Plus, Wallet, CalendarClock, HardDrive, Map as MapIcon, ChevronDown, Network as NetworkIcon,
  ShieldCheck, Gauge, Activity, Bell, PieChart, ArrowRight, Building2, Scale, UserPlus, KeyRound, Code2, Cloud, X, Waypoints,
} from 'lucide-react';
import { useGet, useList } from '@/api/hooks';
import { NoProjectNotice } from '@/components/resource/pickers';
import { useUi, usePro } from '@/store/ui';
import { Page } from '@/components/ui/PageHeader';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import { Stat } from '@/components/ui/Stat';
import { Segmented } from '@/components/ui/Tabs';
import { Skeleton } from '@/components/ui/misc';
import { Treemap, type TreeItem } from '@/components/charts/Treemap';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { InfraMap } from '@/components/overview/InfraMap';
import { InventoryGrid, LocationSelect, shortName } from '@/components/overview/Inventory';
import { HealthStrip, SovereigntyPanel, FleetCapacity, BudgetBurn, OpsFeed, NotificationsSummary } from '@/components/overview/DashboardPanels';
import { useFleet, useCostSummary, useCostHistory, collectIssues, serviceColor, SERVICE_ORDER, flag, COUNTRY_NAME } from '@/components/overview/shared';
import { cn } from '@/lib/cn';
import { money, num, gb, plural } from '@/lib/format';
import type { Operation, Project, Account, User } from '@/types';

const DAY = 86_400_000;

/** Number of items (or summed value) that existed on each of the last `days` days, from createdAt. */
function growth<T extends { createdAt?: string }>(items: T[], value: (t: T) => number = () => 1, days = 14): number[] {
  const now = Date.now();
  return Array.from({ length: days }, (_, i) => {
    const cutoff = now - (days - 1 - i) * DAY;
    return items.reduce((a, it) => a + (it.createdAt && Date.parse(it.createdAt) <= cutoff ? value(it) : 0), 0);
  });
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const accountId = useUi((s) => s.accountId);
  const projectId = useUi((s) => s.projectId);
  const fleet = useFleet();
  const { data: summary, isLoading: summaryLoading } = useCostSummary();
  const { data: history } = useCostHistory(30, 'service', 7);
  const { items: runningOps } = useList<Operation>('operations', { status: 'running' });
  const { items: projects, isSuccess: projectsLoaded } = useList<Project>('projects');
  const { items: accounts } = useList<Account>('accounts');
  const { data: me } = useGet<{ user: User }>(['users', 'me'], '/me');
  const [locationId, setLocationId] = useState<string | null>(null);
  const pro = usePro();

  const proMode = usePro();
  // hardware & provider issues are an operator concern → only in Pro mode
  const issues = useMemo(() => collectIssues(fleet, summary).filter((i) => proMode || !i.link?.startsWith('/hardware')), [fleet, summary, proMode]);
  const account = accounts.find((a) => a.id === accountId);
  const accountProjects = projects.filter((p) => p.accountId === accountId);
  const project = projects.find((p) => p.id === projectId);

  const dailyTotals = useMemo(() => {
    const s = history?.series ?? [];
    return (s[0]?.points ?? []).map((_, i) => s.reduce((a, x) => a + (x.points[i]?.v ?? 0), 0));
  }, [history]);
  const mtdSpark = useMemo(() => {
    const d = summary?.dayOfMonth ?? 0;
    let acc = 0;
    return dailyTotals.slice(-d).map((v) => (acc += v));
  }, [dailyTotals, summary]);

  const running = fleet.vms.filter((v) => v.status === 'running');
  const errored = fleet.vms.filter((v) => v.status === 'error').length;
  const vcpus = running.reduce((a, v) => a + (v.size?.vcpus ?? 0), 0);
  const ram = running.reduce((a, v) => a + (v.size?.ramGB ?? 0), 0);
  const volGB = fleet.volumes.reduce((a, v) => a + (v.sizeGB ?? 0), 0);
  const bucketGB = fleet.buckets.reduce((a, b) => a + (b.bytesUsed ?? 0), 0) / 1024 ** 3;
  const delta = summary && summary.lastMonth ? ((summary.total - summary.lastMonth) / summary.lastMonth) * 100 : undefined;
  const resourceCount = fleet.vms.length + fleet.dbs.length + fleet.k8s.length + fleet.buckets.length + fleet.lbs.length + fleet.volumes.length + fleet.networks.length;
  const usedLocations = new Set([...fleet.vms, ...fleet.dbs, ...fleet.k8s, ...fleet.buckets, ...fleet.lbs].map((r) => r.locationId)).size;
  const selectedLoc = locationId ? fleet.locations.find((l) => l.id === locationId) : undefined;
  const selectedCost = locationId ? summary?.byLocation.find((b) => b.locationId === locationId)?.monthly : undefined;

  return (
    <Page wide>
      {/* ---------------------------------------------------------------- hero */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <div className="flex items-center gap-2 text-xs font-medium text-muted"><LayoutDashboard className="size-3.5" />Overview</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">{greeting()}{me?.user?.name ? `, ${me.user.name.split(' ')[0]}` : ''}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span className="font-medium text-fg-2">{account?.name ?? accountId}</span>
            <span className="text-faint">/</span>
            {project ? <span className="inline-flex items-center gap-1.5 text-fg-2"><span className="size-2 rounded-full" style={{ background: project.color }} />{project.name}</span> : <span>All projects ({accountProjects.length})</span>}
            <span className="text-faint">·</span>
            <span>{plural(resourceCount, 'resource')} in {plural(usedLocations, 'location')}</span>
            {!pro && summary && (
              <>
                <span className="text-faint">·</span>
                <Link to="/billing/cost-explorer" className="hover:text-fg">This month <span className="font-medium text-fg-2 tabular-nums">{money(summary.mtd, { decimals: false })}</span> (forecast {money(summary.forecast, { decimals: false })})</Link>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {pro && <Button size="sm" variant="ghost" icon={Waypoints} to="/topology" className="hidden @min-[36rem]:inline-flex">Topology</Button>}
          <CreateSplitButton />
        </div>
      </div>

      <div className="space-y-4">
        {projectsLoaded && !accountProjects.length && <Card><NoProjectNotice /></Card>}
        {(pro || issues.length > 0) && <HealthStrip issues={issues} fleet={fleet} compact={!pro} />}
        {pro && <GetStarted />}

        {/* ---------------------------------------------------------------- KPIs (pro) */}
        {pro && <div className="grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
          <Stat label="Monthly run-rate" icon={Wallet} value={summary ? money(summary.total, { decimals: false }) : <Skeleton className="h-7 w-24" />} delta={delta} deltaGoodWhen="down"
            sub="vs last month" spark={dailyTotals} sparkColor="#5b67f8" accent="#5b67f8" to="/billing/cost-explorer" />
          <Stat label="Month to date" icon={CalendarClock} value={summary ? money(summary.mtd, { decimals: false }) : <Skeleton className="h-7 w-24" />}
            sub={summary ? `forecast ${money(summary.forecast, { decimals: false })}` : undefined} spark={mtdSpark} sparkColor="#06b6d4" to="/billing/cost-explorer" />
          <Stat label="Running VMs" icon={Server} value={`${running.length} / ${fleet.vms.length}`} spark={growth(fleet.vms)} sparkColor="#5b67f8"
            sub={errored ? <span className="text-rose-500">{errored} in error</span> : 'all healthy'} to="/infrastructure/vms" />
          <Stat label="vCPU allocated" icon={Cpu} value={num(vcpus)} sub={`${gb(ram)} RAM · ${gb(Math.round(volGB + bucketGB))} stored`} spark={growth(running, (v) => v.size?.vcpus ?? 0)} sparkColor="#a855f7" to="/hardware/bare-metals" />
        </div>}

        {/* ---------------------------------------------------------------- map + inventory */}
        <Card className="min-w-0">
          <CardHeader icon={MapIcon} title="Infrastructure"
            description={selectedLoc
              ? <span>{flag(selectedLoc.country)} {selectedLoc.city}, {COUNTRY_NAME[selectedLoc.country] ?? selectedLoc.country} · {selectedLoc.kind === 'selfHosted' ? 'own datacenter' : 'cloud region'}{selectedCost != null ? ` · ${money(selectedCost)}/mo` : ''}</span>
              : pro ? 'Own datacenters and connected cloud regions. Click a location to filter.' : 'Click a location to filter.'}
            actions={<>
              {locationId && <button type="button" onClick={() => setLocationId(null)} className="hidden text-xs text-muted hover:text-fg @min-[36rem]:inline">Clear</button>}
              <LocationSelect fleet={fleet} value={locationId} onChange={setLocationId} />
            </>} />
          <CardBody className="grid gap-4 @min-[44rem]:grid-cols-[minmax(0,1fr)_300px] @min-[60rem]:grid-cols-[minmax(0,1fr)_minmax(300px,340px)]">
            <div className="min-w-0">
              {fleet.loading && !fleet.locations.length
                ? <Skeleton className="h-[340px]" />
                : <InfraMap fleet={fleet} issues={issues} summary={summary} runningOps={runningOps} selected={locationId} onSelect={setLocationId} />}
            </div>
            <div className="min-w-0">
              <div className="mb-2 flex h-7 items-center justify-between gap-2">
                <span className="truncate text-[13px] font-medium text-fg">{selectedLoc ? shortName(selectedLoc) : 'All locations'}</span>
                {pro && <Link to="/topology" className="inline-flex shrink-0 items-center gap-1 text-xs text-muted hover:text-brand-500">Topology <ArrowRight className="size-3" /></Link>}
              </div>
              <InventoryGrid fleet={fleet} locationId={locationId} />
            </div>
          </CardBody>
        </Card>

        {/* ---------------------------------------------------------------- simple: activity + get started */}
        {!pro && (
          <div className="grid gap-4 @min-[60rem]:grid-cols-3">
            <Card className="min-w-0 overflow-hidden @min-[60rem]:col-span-2">
              <CardHeader icon={Activity} title="Activity" />
              <ActivityFeed limit={5} showTarget />
            </Card>
            <GetStarted simple />
          </div>
        )}

        {pro && <>
        {/* ---------------------------------------------------------------- cost */}
        <div className="grid gap-4 @min-[60rem]:grid-cols-3">
          <CostCard summary={summary} history={history} loading={summaryLoading} />
          <Card className="min-w-0">
            <CardHeader icon={Gauge} title="Budget burn" description="Run-rate vs. monthly budget"
              actions={<Link to="/iam/project-allowances" className="text-xs text-muted hover:text-brand-500">Allowances</Link>} />
            <CardBody><BudgetBurn summary={summary} /></CardBody>
          </Card>
        </div>

        {/* ---------------------------------------------------------------- capacity + sovereignty */}
        <div className="grid gap-4 @min-[60rem]:grid-cols-3">
          <Card className="min-w-0 @min-[60rem]:col-span-2">
            <CardHeader icon={Building2} title="Fleet capacity" description="Allocated vs. schedulable capacity on own hardware, plus burst quotas."
              actions={<Link to="/hardware/bare-metals" className="text-xs text-muted hover:text-brand-500">Hardware</Link>} />
            <CardBody><FleetCapacity fleet={fleet} /></CardBody>
          </Card>
          <Card className="flex min-w-0 flex-col">
            <CardHeader icon={ShieldCheck} title="Sovereignty" description="Who controls your infrastructure, and under which jurisdiction." />
            <CardBody className="flex-1"><SovereigntyPanel fleet={fleet} summary={summary} /></CardBody>
          </Card>
        </div>

        {/* ---------------------------------------------------------------- activity + ops + notifications */}
        <div className="grid gap-4 @min-[60rem]:grid-cols-3">
          <Card className="min-w-0 overflow-hidden @min-[60rem]:col-span-2">
            <CardHeader icon={Activity} title="Recent activity" description="Audit trail of changes in this scope"
              actions={<Link to="/activity?tab=audit" className="text-xs text-muted hover:text-brand-500">Audit log</Link>} />
            <ActivityFeed limit={8} showTarget />
          </Card>
          <div className="grid min-w-0 content-start gap-4 @min-[44rem]:grid-cols-2 @min-[60rem]:grid-cols-1">
            <Card className="min-w-0">
              <CardHeader icon={Activity} title="Live operations" description={runningOps.length ? `${runningOps.length} running` : 'Control-plane tasks'}
                actions={<Link to="/activity" className="text-xs text-muted hover:text-brand-500">All</Link>} />
              <CardBody><OpsFeed /></CardBody>
            </Card>
            <Card className="min-w-0">
              <CardHeader icon={Bell} title="Notifications" />
              <CardBody><NotificationsSummary /></CardBody>
            </Card>
          </div>
        </div>
        </>}
      </div>
    </Page>
  );
}

/* ---------------------------------------------------------------- header create */

/** Primary "Create VM" with a dropdown for the other common resources (one control instead of a wrapping button row). */
function CreateSplitButton() {
  return (
    <div className="inline-flex rounded-lg shadow-sm shadow-brand-500/20">
      <Link to="/infrastructure/vms/new" className="inline-flex h-8 items-center gap-1.5 rounded-l-lg bg-brand-500 px-3 text-[13px] font-medium text-white transition-colors hover:bg-brand-600">
        <Plus className="size-4" />Create VM
      </Link>
      <Menu width="w-60" items={[
        { label: 'Virtual machine', icon: Server, to: '/infrastructure/vms/new' },
        { label: 'Volume', icon: HardDrive, to: '/infrastructure/volumes/new' },
        { label: 'Network', icon: NetworkIcon, to: '/infrastructure/networks/new' },
        { label: '', divider: true },
        { label: 'Database', icon: Database, to: '/managed-services/db/new' },
        { label: 'Kubernetes cluster', icon: Boxes, to: '/managed-services/kubernetes/new' },
        { label: 'Bucket', icon: PackageOpen, to: '/managed-services/object-storage/new' },
        { label: 'Load balancer', icon: Scale, to: '/managed-services/load-balancers/new' },
        ...(usePro() ? [
          { label: '', divider: true },
          { label: 'Add bare-metal host', icon: Cpu, to: '/hardware/bare-metals/new' },
          { label: 'Connect cloud provider', icon: Cloud, to: '/hardware/cloud-providers/new' },
        ] : []),
      ]} trigger={(open) => (
        <button type="button" aria-label="More create options" aria-haspopup="menu" aria-expanded={open}
          className={cn('inline-flex h-8 items-center rounded-r-lg border-l border-white/25 bg-brand-500 px-2 text-white transition-colors hover:bg-brand-600', open && 'bg-brand-600')}>
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </button>
      )} />
    </div>
  );
}

/* ---------------------------------------------------------------- get started */

const GET_STARTED = [
  { icon: UserPlus, title: 'Invite member', desc: 'Give your team access', to: '/iam/users?invite=1', color: '#5b67f8' },
  { icon: KeyRound, title: 'Add SSH key', desc: 'For password-less VM login', to: '/infrastructure/ssh-keys', color: '#10b981' },
  { icon: Code2, title: 'API & IaC docs', desc: 'Terraform, CLI, REST', to: '/developer', color: '#a855f7' },
  { icon: Cloud, title: 'Connect cloud provider', desc: 'Burst into Hetzner, OVH, AWS…', to: '/hardware/cloud-providers/new', color: '#0ea5e9', pro: true },
  { icon: FolderPlus, title: 'Create a project', desc: 'Own budget, quotas & access', to: '/iam/project-allowances?new=1', color: '#f59e0b', simple: true },
];
const GS_KEY = 'autark.dashboard.getStarted.hidden';

/** Compact "Get started" link list shown next to Activity in simple mode. */
function GetStartedList() {
  const pro = usePro();
  const items = GET_STARTED.filter((g) => g.to !== '/developer' && (pro ? !('simple' in g) : !('pro' in g)));
  return (
    <Card className="min-w-0 self-start">
      <CardHeader title="Get started" />
      <ul className="divide-y divide-line">
        {items.map((g) => (
          <li key={g.title}>
            <Link to={g.to} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/50">
              <g.icon className="size-4 shrink-0 text-muted group-hover:text-brand-500" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{g.title}</span>
              <ArrowRight className="size-3.5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function GetStarted({ simple }: { simple?: boolean }) {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(GS_KEY) === '1' } catch { return false } });
  if (simple) return <GetStartedList />;
  if (hidden) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem(GS_KEY, '1') } catch { /* storage unavailable */ } };
  return (
    <section aria-label="Get started" className="relative">
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="text-xs font-medium text-muted">Get started</h2>
        <button type="button" onClick={hide} aria-label="Hide get started" title="Hide" className="rounded p-0.5 text-faint hover:bg-surface-2 hover:text-fg"><X className="size-3.5" /></button>
      </div>
      <div className="grid grid-cols-1 gap-2 @min-[30rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
        {GET_STARTED.filter((g) => !('simple' in g)).map((g) => (
          <Link key={g.title} to={g.to} className="group flex min-w-0 items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-card transition-colors hover:border-line-strong hover:bg-surface-2/50">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${g.color}1a`, color: g.color }}><g.icon className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-fg">{g.title}</span>
              <span className="block truncate text-[11px] text-muted">{g.desc}</span>
            </span>
            <ArrowRight className="size-3.5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- cost card */

function CostCard({ summary, history, loading }: {
  summary: ReturnType<typeof useCostSummary>['data']; history: ReturnType<typeof useCostHistory>['data']; loading: boolean;
}) {
  const [by, setBy] = useState<'service' | 'project'>('service');
  const items: TreeItem[] = useMemo(() => {
    if (!summary) return [];
    if (by === 'service') return summary.byService.map((s) => ({ id: s.service, label: s.label, value: s.monthly, color: serviceColor(s.service), link: '/billing/cost-explorer' }));
    return summary.byProject.map((p) => ({ id: p.projectId, label: p.name, value: p.monthly, color: p.color, link: p.allowanceId ? `/iam/project-allowances/${p.allowanceId}` : undefined, sub: p.budget ? `budget ${money(p.budget)}` : undefined }));
  }, [summary, by]);

  const bars: BarDatum[] = useMemo(() => {
    const series = [...(history?.series ?? [])].sort((a, b) => SERVICE_ORDER.indexOf(a.key) - SERVICE_ORDER.indexOf(b.key));
    if (!series.length) return [];
    const fmt = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    const actual = series[0].points.map((p, i) => ({
      label: fmt(p.t),
      segments: series.map((s) => ({ id: s.key, label: s.label, value: s.points[i]?.v ?? 0, color: serviceColor(s.key) })),
    }));
    const fc = history?.forecast ?? [];
    const forecast = (fc[0]?.points ?? []).map((p, i) => ({
      label: fmt(p.t), forecast: true,
      segments: series.map((s) => ({ id: s.key, label: s.label, value: fc.find((f) => f.key === s.key)?.points[i]?.v ?? 0, color: serviceColor(s.key) })),
    }));
    return [...actual, ...forecast];
  }, [history]);

  const legend = [...(history?.series ?? [])].sort((a, b) => SERVICE_ORDER.indexOf(a.key) - SERVICE_ORDER.indexOf(b.key));

  return (
    <Card className="min-w-0 @min-[60rem]:col-span-2">
      <CardHeader icon={PieChart} title="Where the money goes" description={summary ? `${money(summary.total)} monthly run-rate · ${money(summary.mtd)} month to date` : 'Monthly run-rate'}
        actions={<>
          <Segmented size="sm" value={by} onChange={setBy} options={[{ value: 'service', label: 'Service' }, { value: 'project', label: 'Project' }]} />
          <Link to="/billing/cost-explorer" className="hidden text-xs text-muted hover:text-brand-500 @min-[36rem]:inline">Explorer</Link>
        </>} />
      <CardBody className="space-y-5">
        {loading && !summary ? <Skeleton className="h-[200px]" /> : items.length ? <Treemap items={items} height={200} format={(v) => money(v)} /> : <div className="py-10 text-center text-sm text-muted">No billable resources in this scope</div>}
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted">Daily spend · last 30 days + 7-day forecast</span>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {legend.map((s) => <span key={s.key} className="inline-flex items-center gap-1 text-[11px] text-muted"><span className="size-2 rounded-sm" style={{ background: serviceColor(s.key) }} />{s.label}</span>)}
            </div>
          </div>
          {bars.length ? (
            <BarChart data={bars} height={150} format={(v) => money(v)} budgetLine={summary?.budget ? { value: summary.budget / 30, label: `daily budget ${money(summary.budget / 30)}` } : undefined} />
          ) : <Skeleton className="h-[150px]" />}
        </div>
      </CardBody>
    </Card>
  );
}

