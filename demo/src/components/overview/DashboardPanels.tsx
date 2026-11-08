import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, CheckCircle2, ChevronRight, XCircle, Info, Bell, Building2, Cloud, ShieldCheck, Activity as ActivityIcon } from 'lucide-react';
import { useList, useApiMutation } from '@/api/hooks';
import { api } from '@/api/client';
import { Ring, StackBar, Meter, EmptyState } from '@/components/ui/misc';
import { StatusPill } from '@/components/ui/Badge';
import { Segmented } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { OperationInline } from '@/components/resource/OperationRunner';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { cn } from '@/lib/cn';
import { money, num, gb, timeAgo, pct } from '@/lib/format';
import {
  computeCapacity, useCapacityEndpoint, flag, COUNTRY_NAME, EU_COUNTRIES, PROVIDER_HQ,
  type Fleet, type Issue, type CostSummary, type LocationCapacity,
} from './shared';
import type { Operation, Notification, Location } from '@/types';

/* ================================================================ health strip */

/** `compact` (simple mode): at most 3 issue chips, no secondary text. */
export function HealthStrip({ issues, fleet, compact }: { issues: Issue[]; fleet: Fleet; compact?: boolean }) {
  const max = compact ? 3 : 6;
  const [expanded, setExpanded] = useState(false);
  const crit = issues.filter((i) => i.severity === 'critical').length;
  const warn = issues.length - crit;
  if (!issues.length) {
    const ready = fleet.hosts.filter((h) => h.status === 'ready').length;
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-2.5 text-[13px]">
        <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
        <span className="font-medium text-fg">All systems operational</span>
        <span className="hidden text-muted @min-[36rem]:inline">· {fleet.locations.length} locations · {ready} hosts ready · no open alerts</span>
      </div>
    );
  }
  const shown = expanded ? issues : issues.slice(0, max);
  return (
    <div className={cn('rounded-xl border px-3 py-2.5', crit ? 'border-rose-500/25 bg-rose-500/[0.04]' : 'border-amber-500/25 bg-amber-500/[0.05]')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 flex items-center gap-1.5 text-[13px] font-medium text-fg">
          {crit ? <XCircle className="size-4 text-rose-500" /> : <AlertTriangle className="size-4 text-amber-500" />}
          {crit > 0 && <span>{crit} critical</span>}
          {crit > 0 && warn > 0 && <span className="text-faint">·</span>}
          {warn > 0 && <span>{warn} warning{warn > 1 ? 's' : ''}</span>}
        </span>
        {shown.map((i) => (
          <Link key={i.id} to={i.link}
            className={cn('group inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-surface px-2 py-1 text-xs transition-colors hover:border-line-strong',
              i.severity === 'critical' ? 'border-rose-500/30' : 'border-amber-500/30')}>
            <span className={cn('size-1.5 shrink-0 rounded-full', i.severity === 'critical' ? 'bg-rose-500' : 'bg-amber-500')} />
            <span className="text-muted">{i.label}</span>
            <span className="truncate font-medium text-fg">{i.detail}</span>
            <ChevronRight className="size-3 text-faint group-hover:text-fg" />
          </Link>
        ))}
        {issues.length > max && (
          <button onClick={() => setExpanded((e) => !e)} className="text-xs font-medium text-muted hover:text-fg">{expanded ? 'Show less' : `+${issues.length - max} more`}</button>
        )}
      </div>
    </div>
  );
}

/* ================================================================ sovereignty */

const OWN_COLORS = { own: '#5b67f8', eu: '#06b6d4', foreign: '#ec4899' };
const COUNTRY_PALETTE = ['#5b67f8', '#06b6d4', '#a855f7', '#10b981', '#f59e0b', '#ec4899', '#64748b', '#0ea5e9'];

type SovMetric = 'workloads' | 'vcpu' | 'spend';

export function SovereigntyPanel({ fleet, summary }: { fleet: Fleet; summary?: CostSummary }) {
  const [metric, setMetric] = useState<SovMetric>('workloads');
  const data = useMemo(() => {
    const locById = new Map(fleet.locations.map((l) => [l.id, l]));
    const provKind = new Map(fleet.providers.map((p) => [p.id, p.kind as string]));
    const weight = new Map<string, number>();
    const add = (locId: string, w: number) => weight.set(locId, (weight.get(locId) ?? 0) + w);
    if (metric === 'spend') {
      for (const b of summary?.byLocation ?? []) if (locById.has(b.locationId)) add(b.locationId, b.monthly);
    } else {
      const v = metric === 'vcpu';
      for (const x of fleet.vms) add(x.locationId, v ? (x.status === 'running' ? x.size?.vcpus ?? 0 : 0) : 1);
      for (const x of fleet.dbs) add(x.locationId, v ? (x.size?.vcpus ?? 0) * (x.ha ? 2 : 1) : 1);
      for (const x of fleet.k8s) add(x.locationId, v ? (x.nodePools ?? []).reduce((a, p) => a + p.vcpus * p.count, 0) : 1);
      if (!v) { for (const x of fleet.buckets) add(x.locationId, 1); for (const x of fleet.lbs) add(x.locationId, 1) }
    }
    const providerHq = (l: Location) => {
      const kind = (l.providerId && provKind.get(l.providerId)) || l.id.split('-')[0];
      return PROVIDER_HQ[kind] ?? 'unknown';
    };
    const own = { own: 0, eu: 0, foreign: 0 };
    const byCountry = new Map<string, number>();
    let total = 0, sovereign = 0, cloudAct = 0;
    for (const [locId, w] of weight) {
      const l = locById.get(locId);
      if (!l || w <= 0) continue;
      total += w;
      byCountry.set(l.country, (byCountry.get(l.country) ?? 0) + w);
      if (l.kind === 'selfHosted') { own.own += w; if (EU_COUNTRIES.has(l.country)) sovereign += w; continue }
      const hq = providerHq(l);
      if (EU_COUNTRIES.has(hq)) { own.eu += w; if (EU_COUNTRIES.has(l.country)) sovereign += w }
      else { own.foreign += w; if (hq === 'US') cloudAct += w }
    }
    const countryOrder = [...new Set(fleet.locations.map((l) => l.country))].sort();
    const countries = [...byCountry].sort((a, b) => b[1] - a[1]).map(([c, v]) => ({ c, v, color: COUNTRY_PALETTE[countryOrder.indexOf(c) % COUNTRY_PALETTE.length] }));
    return { own, countries, total, sovereign, cloudAct };
  }, [fleet, summary, metric]);

  const fmt = (v: number) => (metric === 'spend' ? money(v) : metric === 'vcpu' ? `${num(v)} vCPU` : num(v));
  const share = data.total ? data.sovereign / data.total : 0;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tracking-tight tabular text-fg">{data.total ? pct(share) : '—'}</span>
            <span className="text-[13px] text-muted">sovereign</span>
          </div>
          <p className="mt-0.5 text-xs text-muted">on own hardware or EU-controlled providers inside the EU</p>
        </div>
        <ShieldCheck className={cn('size-8 shrink-0', share >= 0.9 ? 'text-emerald-500' : share >= 0.6 ? 'text-amber-500' : 'text-rose-500')} />
      </div>
      <Segmented size="sm" value={metric} onChange={setMetric} options={[{ value: 'workloads', label: 'Workloads' }, { value: 'vcpu', label: 'vCPU' }, { value: 'spend', label: 'Spend' }]} />

      <SovBar title="Who controls the hardware" total={data.total} fmt={fmt} segments={[
        { id: 'own', label: 'Own hardware', value: data.own.own, color: OWN_COLORS.own },
        { id: 'eu', label: 'EU cloud provider', value: data.own.eu, color: OWN_COLORS.eu },
        { id: 'foreign', label: 'Non-EU cloud provider', value: data.own.foreign, color: OWN_COLORS.foreign },
      ]} />
      <SovBar title="Where data lives (jurisdiction)" total={data.total} fmt={fmt}
        segments={data.countries.map((c) => ({ id: c.c, label: `${flag(c.c)} ${COUNTRY_NAME[c.c] ?? c.c}`, value: c.v, color: c.color }))} />

      <div className={cn('mt-auto rounded-lg border px-3 py-2 text-xs', data.cloudAct > 0 ? 'border-rose-500/25 bg-rose-500/[0.05]' : 'border-emerald-500/25 bg-emerald-500/[0.05]')}>
        {data.cloudAct > 0 ? (
          <span className="text-fg-2"><b className="font-semibold text-fg">{pct(data.cloudAct / data.total)}</b> ({fmt(data.cloudAct)}) runs on US-headquartered providers and is reachable under the CLOUD Act, regardless of region.</span>
        ) : (
          <span className="text-fg-2">No workloads on US-headquartered providers — nothing is exposed to the CLOUD Act.</span>
        )}
      </div>
    </div>
  );
}

function SovBar({ title, segments, total, fmt }: { title: string; segments: { id: string; label: string; value: number; color: string }[]; total: number; fmt: (v: number) => string }) {
  const [hover, setHover] = useState<string | null>(null);
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted">{title}</div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-surface-3">
        {visible.map((s) => (
          <div key={s.id} title={`${s.label}: ${fmt(s.value)} (${pct(s.value / (total || 1))})`} onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}
            className={cn('h-full transition-opacity first:rounded-l-full last:rounded-r-full', hover && hover !== s.id && 'opacity-40')}
            style={{ width: `${(s.value / (total || 1)) * 100}%`, background: s.color }} />
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 @min-[36rem]:grid-cols-2">
        {visible.map((s) => (
          <li key={s.id} onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}
            className={cn('flex items-center gap-1.5 rounded px-1 text-xs', hover === s.id && 'bg-surface-2')}>
            <span className="size-2 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-fg-2">{s.label}</span>
            <span className="tabular text-muted">{pct(s.value / (total || 1))}</span>
          </li>
        ))}
        {!visible.length && <li className="text-xs text-faint">No workloads in this scope</li>}
      </ul>
    </div>
  );
}

/* ================================================================ fleet capacity */

export function FleetCapacity({ fleet }: { fleet: Fleet }) {
  const endpoint = useCapacityEndpoint();
  const caps: LocationCapacity[] = useMemo(
    () => endpoint.data?.locations ?? computeCapacity(fleet.hosts, fleet.vms),
    [endpoint.data, fleet.hosts, fleet.vms],
  );
  const locById = new Map(fleet.locations.map((l) => [l.id, l]));
  const own = caps.filter((c) => locById.get(c.locationId)?.kind !== 'cloud').sort((a, b) => a.locationId.localeCompare(b.locationId));
  const providers = fleet.providers.filter((p) => p.status !== 'disabled');

  return (
    <div className="space-y-5">
      {own.length === 0 ? (
        <EmptyState icon={Building2} title="No hardware enrolled" description="Add a bare metal host to start running workloads on your own hardware." action={<Button size="sm" variant="primary" to="/hardware/bare-metals/new">Add host</Button>} className="py-8" />
      ) : (
        <div className="grid gap-3 @min-[36rem]:grid-cols-2">
          {own.map((c) => {
            const l = locById.get(c.locationId);
            return (
              <Link key={c.locationId} to={`/hardware/bare-metals?location=${c.locationId}`} className="group rounded-xl border border-line p-3.5 transition-colors hover:border-line-strong hover:bg-surface-2/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[13px] font-semibold text-fg"><Building2 className="size-3.5 text-muted" />{l?.name ?? c.locationId}</div>
                    <div className="text-[11px] text-muted">{flag(l?.country)} {l?.city} · {c.hosts.ready}/{c.hosts.total} hosts ready · {c.allocated.vms} VMs</div>
                  </div>
                  <ChevronRight className="size-4 text-faint group-hover:text-fg" />
                </div>
                <div className="mt-3 flex items-center justify-around gap-2">
                  <CapRing label="vCPU" used={c.allocated.vcpus} cap={c.capacity.vcpus} fmt={num} />
                  <CapRing label="RAM" used={c.allocated.ramGB} cap={c.capacity.ramGB} fmt={gb} />
                  <CapRing label="GPU" used={c.allocated.gpus} cap={c.capacity.gpus} fmt={num} />
                </div>
                <div className="mt-3">
                  <StackBar height="h-1.5" total={c.hosts.total} segments={[
                    { value: c.hosts.ready, color: '#10b981', label: 'Ready' },
                    { value: c.hosts.maintenance, color: '#f59e0b', label: 'Maintenance' },
                    { value: c.hosts.offline, color: '#f43f5e', label: 'Offline' },
                    { value: c.hosts.other, color: '#94a3b8', label: 'Provisioning' },
                  ]} />
                  <div className="mt-1 flex gap-3 text-[10px] text-faint">
                    <span>{c.hosts.ready} ready</span>
                    {c.hosts.maintenance > 0 && <span className="text-amber-600 dark:text-amber-400">{c.hosts.maintenance} maintenance</span>}
                    {c.hosts.offline > 0 && <span className="text-rose-600 dark:text-rose-400">{c.hosts.offline} offline</span>}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {providers.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted"><Cloud className="size-3.5" />Burst capacity (provider quotas, current scope)</div>
          <div className="grid gap-x-6 gap-y-3 @min-[36rem]:grid-cols-2">
            {providers.map((p) => {
              const locIds = new Set(fleet.locations.filter((l) => l.providerId === p.id).map((l) => l.id));
              const used = fleet.vms.filter((v) => locIds.has(v.locationId) && v.status !== 'stopped').reduce((a, v) => a + (v.size?.vcpus ?? 0), 0);
              return (
                <Link key={p.id} to={`/hardware/cloud-providers/${p.id}`} className="block rounded-md hover:bg-surface-2/50">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-fg-2">{p.name}{p.status === 'error' && <StatusPill status="error" />}</span>
                    <span className="tabular text-muted">{num(used)} / {num(p.quotas?.vcpus ?? 0)} vCPU</span>
                  </div>
                  <Meter value={used} max={p.quotas?.vcpus || 1} size="sm" />
                </Link>
              );
            })}
          </div>
        </div>
      )}
      {!endpoint.data && fleet.hosts.length > 0 && <p className="text-[11px] text-faint">Allocation computed from VMs visible in the current scope.</p>}
    </div>
  );
}

function CapRing({ label, used, cap, fmt }: { label: string; used: number; cap: number; fmt: (n: number) => string }) {
  if (!cap) return (
    <div className="flex flex-col items-center gap-1 opacity-50">
      <Ring value={0} max={1} size={58} stroke={6} label="—" />
      <span className="text-[11px] text-muted">{label}</span>
    </div>
  );
  return (
    <div className="flex flex-col items-center gap-1" title={`${label}: ${fmt(used)} of ${fmt(cap)} allocated`}>
      <Ring value={used} max={cap} size={58} stroke={6} />
      <span className="text-[11px] text-muted">{label}</span>
      <span className="text-[10px] tabular text-faint">{fmt(used)} / {fmt(cap)}</span>
    </div>
  );
}

/* ================================================================ budgets */

export function BudgetBurn({ summary }: { summary?: CostSummary }) {
  const rows = summary?.byProject ?? [];
  if (!rows.length) return <EmptyState title="No projects" description="Budgets appear once projects have allowances." className="py-8" />;
  const elapsed = summary ? summary.dayOfMonth / summary.daysInMonth : 0;
  return (
    <ul className="space-y-3.5">
      {rows.map((p) => {
        const ratio = p.budget ? p.monthly / p.budget : 0;
        return (
          <li key={p.projectId}>
            <Link to={p.allowanceId ? `/iam/project-allowances/${p.allowanceId}` : '/iam/project-allowances'} className="block rounded-md hover:bg-surface-2/50">
              <div className="mb-1 flex items-center justify-between gap-2 text-[13px]">
                <span className="flex min-w-0 items-center gap-1.5"><span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} /><span className="truncate text-fg">{p.name}</span></span>
                <span className="shrink-0 tabular text-muted"><span className="text-fg">{money(p.monthly)}</span> / {p.budget ? money(p.budget) : 'no budget'}</span>
              </div>
              <div className="relative">
                <Meter value={p.monthly} max={p.budget || p.monthly || 1} thresholds={[0.8, 1]} />
                {p.budget > 0 && <span className="absolute top-[-2px] h-3 w-px bg-fg/40" style={{ left: `${Math.min(100, elapsed * 100)}%` }} title="Month elapsed" />}
              </div>
              <div className="mt-0.5 flex justify-between text-[11px] text-faint">
                <span>{p.budget ? `${Math.round(ratio * 100)}% of budget at current run-rate` : 'Run-rate'}</span>
                {ratio >= 1 && <span className="text-rose-600 dark:text-rose-400">over by {money(p.monthly - p.budget)}</span>}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/* ================================================================ operations */

export function OpsFeed() {
  const { items: ops, isLoading } = useList<Operation>('operations', { limit: 30 });
  const running = ops.filter((o) => o.status === 'running' || o.status === 'queued');
  const recent = ops.filter((o) => o.status !== 'running' && o.status !== 'queued').slice(0, Math.max(3, 6 - running.length));
  if (isLoading) return <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-9" />)}</div>;
  if (!ops.length) return <EmptyState icon={ActivityIcon} title="No operations yet" className="py-8" />;
  return (
    <div className="space-y-4">
      {running.length > 0 ? (
        <ul className="space-y-3">
          {running.map((o) => (
            <li key={o.id} className="rounded-lg border border-brand-500/20 bg-brand-500/[0.04] p-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <ResourceLink type={o.target.type} id={o.target.id} name={o.target.name} />
                <code className="shrink-0 font-mono text-[10.5px] text-faint">{o.type}</code>
              </div>
              <OperationInline op={o} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex items-center gap-2 rounded-lg bg-surface-2/60 px-3 py-2 text-xs text-muted"><CheckCircle2 className="size-3.5 text-emerald-500" />No operations running right now</div>
      )}
      <ul className="divide-y divide-line">
        {recent.map((o) => (
          <li key={o.id} className="flex items-center gap-2.5 py-2">
            {o.status === 'succeeded' ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" /> : o.status === 'failed' ? <XCircle className="size-4 shrink-0 text-rose-500" /> : <Info className="size-4 shrink-0 text-faint" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-fg">{o.title}</div>
              {o.error && <div className="truncate text-[11px] text-rose-600 dark:text-rose-400">{o.error}</div>}
            </div>
            <span className="shrink-0 text-[11px] text-faint">{timeAgo(o.finishedAt ?? o.createdAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ================================================================ notifications */

const LEVEL = {
  error: { icon: XCircle, cls: 'text-rose-500', label: 'Errors' },
  warning: { icon: AlertTriangle, cls: 'text-amber-500', label: 'Warnings' },
  info: { icon: Info, cls: 'text-sky-500', label: 'Info' },
  success: { icon: CheckCircle2, cls: 'text-emerald-500', label: 'Success' },
} as const;

export function NotificationsSummary() {
  const { items } = useList<Notification>('notifications', { limit: 50 });
  const readAll = useApiMutation(() => api.post('/notifications/read-all'), { success: 'All notifications marked as read' });
  const unread = items.filter((n) => !n.read);
  const list = [...unread, ...items.filter((n) => n.read)].slice(0, 5);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {(['error', 'warning', 'info', 'success'] as const).map((lv) => {
          const n = unread.filter((x) => x.level === lv).length;
          const L = LEVEL[lv];
          return (
            <span key={lv} className={cn('inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-xs', !n && 'opacity-50')}>
              <L.icon className={cn('size-3.5', L.cls)} /><span className="tabular text-fg">{n}</span><span className="text-muted">{L.label.toLowerCase()}</span>
            </span>
          );
        })}
        {unread.length > 0 && <Button size="xs" variant="ghost" className="ml-auto" loading={readAll.isPending} onClick={() => readAll.mutate()}>Mark all read</Button>}
      </div>
      {list.length === 0 ? (
        <EmptyState icon={Bell} title="You're all caught up" className="py-6" />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((n) => {
            const L = LEVEL[n.level] ?? LEVEL.info;
            const body = (
              <div className="flex items-start gap-2.5 py-2">
                <L.icon className={cn('mt-0.5 size-4 shrink-0', L.cls)} />
                <div className="min-w-0 flex-1">
                  <div className={cn('truncate text-[13px]', n.read ? 'text-fg-2' : 'font-medium text-fg')}>{n.title}</div>
                  <div className="line-clamp-2 text-xs text-muted">{n.message}</div>
                </div>
                <span className="shrink-0 text-[11px] text-faint">{timeAgo(n.time)}</span>
              </div>
            );
            return <li key={n.id}>{n.link ? <Link to={n.link} className="block rounded-md hover:bg-surface-2/50">{body}</Link> : body}</li>;
          })}
        </ul>
      )}
    </div>
  );
}
