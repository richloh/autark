import { useMemo, useState } from 'react';
import { Activity as ActivityIcon, ListChecks, ScrollText, Ban, Download, Search, X, CheckCircle2, XCircle, MonitorSmartphone, Code2, Bot, Terminal, Cog, Loader2, AlertTriangle } from 'lucide-react';
import { useList, useApiMutation, useNow } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { Stat } from '@/components/ui/Stat';
import { Tabs, useTabParam, Segmented } from '@/components/ui/Tabs';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/Badge';
import { Select } from '@/components/ui/form';
import { Drawer, confirm } from '@/components/ui/Modal';
import { KeyValue } from '@/components/ui/Card';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { EmptyState, Mono, Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { OperationRunner, OperationInline } from '@/components/resource/OperationRunner';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { toCsv, downloadFile, todayStamp } from '@/components/overview/shared';
import { KINDS } from '@/lib/kinds';
import { timeAgo, dateTime, duration } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Operation, AuditEvent, Project } from '@/types';

const DAY = 86_400_000;
const VIA = { console: MonitorSmartphone, api: Code2, terraform: Bot, cli: Terminal, system: Cog } as const;
const VIA_LABEL: Record<string, string> = { console: 'Console', api: 'API', terraform: 'Terraform', cli: 'CLI', system: 'System' };

export default function Activity() {
  const [tab, setTab] = useTabParam('operations');
  const { items: ops, isLoading: opsLoading } = useList<Operation>('operations', { limit: 500 });
  const { items: events, isLoading: evLoading } = useList<AuditEvent>('auditLog', { limit: 2000 });
  const now = Date.now();
  const running = ops.filter((o) => o.status === 'running' || o.status === 'queued').length;
  const failedOps24 = ops.filter((o) => o.status === 'failed' && now - Date.parse(o.finishedAt ?? o.createdAt) < DAY).length;
  const events24 = events.filter((e) => now - Date.parse(e.when) < DAY);
  const failures24 = events24.filter((e) => e.result === 'failure').length;

  return (
    <Page wide>
      <PageHeader title="Activity" icon={ActivityIcon} description="Every long-running operation the control plane executes and a tamper-evident audit trail of every change." />
      <div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Running operations" icon={Loader2} value={running} sub={running ? 'in progress now' : 'idle'} accent={running ? '#5b67f8' : undefined} />
        <Stat label="Failed operations" icon={AlertTriangle} value={failedOps24} sub="last 24 hours" />
        <Stat label="Audit events" icon={ScrollText} value={events24.length} sub="last 24 hours" />
        <Stat label="Denied / failed actions" icon={XCircle} value={failures24} sub="last 24 hours" />
      </div>
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { id: 'operations', label: 'Operations', count: ops.length, icon: <ListChecks className="size-4" /> },
        { id: 'audit', label: 'Audit log', count: events.length, icon: <ScrollText className="size-4" /> },
      ]} />
      {tab === 'operations' ? <OperationsTab ops={ops} loading={opsLoading} /> : <AuditTab events={events} loading={evLoading} />}
    </Page>
  );
}

/* ================================================================ operations */

type OpFilter = 'all' | 'running' | 'succeeded' | 'failed' | 'cancelled';

function OperationsTab({ ops, loading }: { ops: Operation[]; loading: boolean }) {
  const [status, setStatus] = useState<OpFilter>('all');
  const [type, setType] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const { items: projects } = useList<Project>('projects');
  const projectName = (id?: string) => projects.find((p) => p.id === id)?.name;
  useNow(1000); // live durations

  const cancel = useApiMutation((id: string) => api.action('operations', id, 'cancel'), { success: 'Operation cancelled' });
  const askCancel = async (op: Operation) => {
    const ok = await confirm({ title: `Cancel “${op.title}”?`, message: 'Steps already completed are not rolled back automatically. The target resource may be left in a partial state.', confirmLabel: 'Cancel operation', danger: true });
    if (ok) cancel.mutate(op.id);
  };

  const isRunning = (o: Operation) => o.status === 'running' || o.status === 'queued';
  const counts = {
    all: ops.length, running: ops.filter(isRunning).length, succeeded: ops.filter((o) => o.status === 'succeeded').length,
    failed: ops.filter((o) => o.status === 'failed').length, cancelled: ops.filter((o) => o.status === 'cancelled').length,
  };
  const types = [...new Set(ops.map((o) => o.type.split('.')[0]))].sort();
  const rows = ops.filter((o) => (status === 'all' || (status === 'running' ? isRunning(o) : o.status === status)) && (!type || o.type.startsWith(`${type}.`)));
  const open = ops.find((o) => o.id === openId);

  const columns: Column<Operation>[] = [
    {
      id: 'title', header: 'Operation', sort: (o) => o.title,
      cell: (o) => <div className="min-w-0"><div className="truncate font-medium text-fg">{o.title}</div><code className="font-mono text-[11px] text-faint">{o.type}</code></div>,
    },
    { id: 'target', header: 'Target', hideBelow: 'md', sort: (o) => o.target.name ?? o.target.id, cell: (o) => <ResourceLink type={o.target.type} id={o.target.id} name={o.target.name} /> },
    {
      id: 'status', header: 'Status', sort: (o) => o.status,
      cell: (o) => isRunning(o) ? <div className="w-40"><StatusPill status={o.status} /><OperationInline op={o} className="mt-1.5" /></div> : (
        <div className="max-w-52"><StatusPill status={o.status} />{o.error && <div className="mt-0.5 truncate text-[11px] text-rose-600 dark:text-rose-400" title={o.error}>{o.error}</div>}</div>
      ),
    },
    { id: 'actor', header: 'Actor', hideBelow: 'lg', sort: (o) => o.actor, cell: (o) => <span className="text-fg-2">{o.actor}</span> },
    { id: 'project', header: 'Project', hideBelow: 'xl', cell: (o) => <span className="text-muted">{projectName(o.projectId) ?? '—'}</span> },
    { id: 'started', header: 'Started', sort: (o) => o.createdAt, cell: (o) => <span className="whitespace-nowrap text-muted" title={dateTime(o.createdAt)}>{timeAgo(o.createdAt)}</span> },
    {
      id: 'duration', header: 'Duration', hideBelow: 'lg', align: 'right',
      sort: (o) => Date.parse(o.finishedAt ?? new Date().toISOString()) - Date.parse(o.startedAt ?? o.createdAt),
      cell: (o) => <span className="tabular text-muted">{duration(Math.max(0, (o.finishedAt ? Date.parse(o.finishedAt) : Date.now()) - Date.parse(o.startedAt ?? o.createdAt)))}</span>,
    },
  ];

  return (
    <>
      <DataTable
        rows={rows} loading={loading} columns={columns}
        searchText={(o) => `${o.title} ${o.type} ${o.target.name ?? ''} ${o.target.id} ${o.actor} ${o.id}`}
        searchPlaceholder="Search operation, target, actor…"
        onRowClick={(o) => setOpenId(o.id)}
        defaultSort={{ id: 'started', dir: 'desc' }}
        toolbar={<>
          <FilterChips value={status} onChange={setStatus} options={[
            { value: 'all', label: 'All', count: counts.all }, { value: 'running', label: 'Running', count: counts.running },
            { value: 'succeeded', label: 'Succeeded', count: counts.succeeded }, { value: 'failed', label: 'Failed', count: counts.failed },
            ...(counts.cancelled ? [{ value: 'cancelled' as const, label: 'Cancelled', count: counts.cancelled }] : []),
          ]} />
          <Select className="w-40" value={type} onChange={(e) => setType(e.target.value)} placeholder="All services" options={types.map((t) => ({ value: t, label: KINDS[t as keyof typeof KINDS]?.plural ?? t }))} />
        </>}
        rowActions={(o) => isRunning(o) ? <IconButton icon={Ban} label="Cancel operation" size="sm" onClick={() => askCancel(o)} /> : null}
        bulkActions={[{
          label: 'Cancel running', icon: Ban, danger: true,
          onClick: async (sel) => {
            const list = sel.filter(isRunning);
            if (!list.length) { toast.info('None of the selected operations are running'); return }
            const ok = await confirm({ title: `Cancel ${list.length} operation${list.length > 1 ? 's' : ''}?`, danger: true, confirmLabel: 'Cancel operations' });
            if (!ok) return;
            const res = await Promise.allSettled(list.map((o) => api.action('operations', o.id, 'cancel')));
            const failed = res.filter((r) => r.status === 'rejected').length;
            if (failed) toast.error(`${failed} could not be cancelled`); else toast.success(`Cancelled ${list.length} operation${list.length > 1 ? 's' : ''}`);
          },
        }]}
        empty={{ icon: ListChecks, title: 'No operations', description: 'Provisioning, scaling, backups and other long-running tasks appear here.' }}
      />
      <Drawer open={!!open} onClose={() => setOpenId(null)} title={open?.title ?? ''} description={open ? <code className="font-mono text-xs">{open.type} · {open.id}</code> : undefined}
        footer={open && <>
          <Button variant="ghost" onClick={() => setOpenId(null)}>Close</Button>
          {isRunning(open) && <Button variant="outline-danger" icon={Ban} loading={cancel.isPending} onClick={() => askCancel(open)}>Cancel operation</Button>}
        </>}>
        {open && (
          <div className="space-y-5">
            <OperationRunner op={open} />
            <KeyValue items={[
              ['Target', <ResourceLink type={open.target.type} id={open.target.id} name={open.target.name} />],
              ['Status', <StatusPill status={open.status} />],
              ['Started by', open.actor],
              ['Project', projectName(open.projectId) ?? '—'],
              ['Created', dateTime(open.createdAt)],
              ['Finished', open.finishedAt ? dateTime(open.finishedAt) : '—'],
            ]} />
            <div>
              <div className="mb-2 text-xs font-medium text-muted">API</div>
              <CodeBlock language="bash" code={`curl -H "Authorization: Bearer $AUTARK_TOKEN" \\\n  https://autark.regiocom-energie.de/api/v1/operations/${open.id}${isRunning(open) ? `\n\n# cancel\ncurl -X POST -H "Authorization: Bearer $AUTARK_TOKEN" \\\n  https://autark.regiocom-energie.de/api/v1/operations/${open.id}/actions/cancel` : ''}`} />
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}

/* ================================================================ audit log */

type Period = '24h' | '7d' | '30d' | 'all';
const PERIOD_MS: Record<Period, number> = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY, all: Infinity };

function dayLabel(t: number) {
  const d = new Date(t); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: diff > 300 ? 'numeric' : undefined });
}

function AuditTab({ events, loading }: { events: AuditEvent[]; loading: boolean }) {
  const [q, setQ] = useState('');
  const [result, setResult] = useState<'all' | 'success' | 'failure'>('all');
  const [via, setVia] = useState('');
  const [actor, setActor] = useState('');
  const [kind, setKind] = useState('');
  const [period, setPeriod] = useState<Period>('7d');
  const [limit, setLimit] = useState(100);
  const [openId, setOpenId] = useState<string | null>(null);

  const actors = useMemo(() => [...new Set(events.map((e) => e.actor))].sort(), [events]);
  const kinds = useMemo(() => [...new Set(events.map((e) => e.target.type))].sort(), [events]);
  const filtered = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const now = Date.now();
    return events.filter((e) => {
      if (now - Date.parse(e.when) > PERIOD_MS[period]) return false;
      if (result !== 'all' && e.result !== result) return false;
      if (via && (e.via ?? 'console') !== via) return false;
      if (actor && e.actor !== actor) return false;
      if (kind && e.target.type !== kind) return false;
      if (terms.length) {
        const t = `${e.action} ${e.actor} ${e.target.name ?? ''} ${e.target.id} ${e.details ?? ''} ${e.sourceIp ?? ''}`.toLowerCase();
        if (!terms.every((x) => t.includes(x))) return false;
      }
      return true;
    }).sort((a, b) => b.when.localeCompare(a.when));
  }, [events, q, result, via, actor, kind, period]);

  const groups = useMemo(() => {
    const out: { label: string; items: AuditEvent[] }[] = [];
    for (const e of filtered.slice(0, limit)) {
      const label = dayLabel(Date.parse(e.when));
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(e); else out.push({ label, items: [e] });
    }
    return out;
  }, [filtered, limit]);

  const active = !!(q || result !== 'all' || via || actor || kind);
  const open = events.find((e) => e.id === openId);
  const exportCsv = () => {
    downloadFile(`autark-audit-${todayStamp()}.csv`, toCsv(filtered.map((e) => ({
      time: e.when, actor: e.actor, action: e.action, target_type: e.target.type, target_id: e.target.id, target_name: e.target.name ?? '',
      result: e.result, via: e.via ?? 'console', source_ip: e.sourceIp ?? '', project: e.projectId ?? '', details: e.details ?? '',
    }))));
    toast.success(`Exported ${filtered.length} events`);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
        <div className="relative min-w-48 flex-1 @min-[36rem]:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(100) }} placeholder="Search action, actor, resource, IP…"
            className="h-8 w-full rounded-lg border border-line bg-surface-2/60 pl-8 pr-7 text-[13px] outline-none placeholder:text-faint focus:border-brand-500 focus:bg-surface" />
          {q && <button onClick={() => setQ('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-fg" aria-label="Clear search"><X className="size-3.5" /></button>}
        </div>
        <FilterChips value={result} onChange={setResult} options={[{ value: 'all', label: 'All' }, { value: 'success', label: 'Success' }, { value: 'failure', label: 'Failed', count: events.filter((e) => e.result === 'failure').length }]} />
        <Select className="w-32" value={via} onChange={(e) => setVia(e.target.value)} placeholder="Any channel" options={Object.entries(VIA_LABEL).map(([value, label]) => ({ value, label }))} />
        <Select className="w-44" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Any actor" options={actors.map((a) => ({ value: a, label: a }))} />
        <Select className="w-40" value={kind} onChange={(e) => setKind(e.target.value)} placeholder="Any resource" options={kinds.map((k) => ({ value: k, label: KINDS[k]?.label ?? k }))} />
        <Segmented size="sm" value={period} onChange={(p) => { setPeriod(p); setLimit(100) }} options={[{ value: '24h', label: '24h' }, { value: '7d', label: '7d' }, { value: '30d', label: '30d' }, { value: 'all', label: 'All' }]} />
        {active && <Button size="xs" variant="ghost" icon={X} onClick={() => { setQ(''); setResult('all'); setVia(''); setActor(''); setKind('') }}>Reset</Button>}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs tabular text-muted">{filtered.length} events</span>
          <Button size="sm" icon={Download} onClick={exportCsv} disabled={!filtered.length}>CSV</Button>
        </div>
      </div>

      {loading && !events.length ? (
        <div className="space-y-2 p-4">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : !filtered.length ? (
        <EmptyState icon={ScrollText} title="No events match" description={period !== 'all' ? 'Try a longer time range or fewer filters.' : 'Try fewer filters.'} action={period !== 'all' ? <Button size="sm" onClick={() => setPeriod('all')}>Show all time</Button> : undefined} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface-2/50 text-xs text-muted">
                <th className="w-20 px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="hidden px-3 py-2 font-medium @min-[40rem]:table-cell">Target</th>
                <th className="hidden px-3 py-2 font-medium @min-[36rem]:table-cell">Actor</th>
                <th className="hidden px-3 py-2 font-medium @min-[44rem]:table-cell">Via</th>
                <th className="hidden px-3 py-2 font-medium @min-[60rem]:table-cell">Source IP</th>
                <th className="px-3 py-2 text-right font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows key={g.label} label={g.label} items={g.items} onOpen={setOpenId} />
              ))}
            </tbody>
          </table>
          {filtered.length > limit && (
            <div className="border-t border-line p-3 text-center">
              <Button size="sm" onClick={() => setLimit((l) => l + 200)}>Load more ({filtered.length - limit} remaining)</Button>
            </div>
          )}
        </div>
      )}

      <Drawer open={!!open} onClose={() => setOpenId(null)} title={open ? <code className="font-mono">{open.action}</code> : ''} description={open ? dateTime(open.when) : undefined}>
        {open && (
          <div className="space-y-5">
            <KeyValue items={[
              ['Target', <ResourceLink type={open.target.type} id={open.target.id} name={open.target.name} />],
              ['Result', <StatusPill status={open.result} />],
              ['Actor', open.actor],
              ['Via', VIA_LABEL[open.via ?? 'console']],
              ['Source IP', open.sourceIp ? <Mono copy>{open.sourceIp}</Mono> : '—'],
              ['Event ID', <Mono copy>{open.id}</Mono>],
            ]} />
            {open.details && <div className="rounded-lg border border-line bg-surface-2/60 p-3 text-[13px] text-fg-2">{open.details}</div>}
            <div>
              <div className="mb-2 text-xs font-medium text-muted">Raw event</div>
              <CodeBlock language="json" code={JSON.stringify(open, null, 2)} />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-muted">Other events for this resource</div>
              <div className="overflow-hidden rounded-xl border border-line"><ActivityFeed targetId={open.target.id} limit={10} /></div>
            </div>
          </div>
        )}
      </Drawer>
    </Card>
  );
}

function GroupRows({ label, items, onOpen }: { label: string; items: AuditEvent[]; onOpen: (id: string) => void }) {
  return (
    <>
      <tr>
        <td colSpan={7} className="border-b border-line bg-surface-2/30 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {label} <span className="ml-1 font-normal normal-case tracking-normal text-faint">{items.length} event{items.length > 1 ? 's' : ''}</span>
        </td>
      </tr>
      {items.map((e) => {
        const Via = VIA[(e.via ?? 'console') as keyof typeof VIA] ?? MonitorSmartphone;
        return (
          <tr key={e.id} onClick={(ev) => { if (!(ev.target as HTMLElement).closest('a')) onOpen(e.id) }}
            className={cn('cursor-pointer border-b border-line last:border-0 hover:bg-surface-2/60', e.result === 'failure' && 'bg-rose-500/[0.03]')}>
            <td className="whitespace-nowrap px-3 py-2 tabular text-muted" title={dateTime(e.when)}>{new Date(e.when).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
            <td className="px-3 py-2">
              <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px] text-fg">{e.action}</code>
              {e.details && <div className="mt-0.5 max-w-xs truncate text-[11px] text-muted" title={e.details}>{e.details}</div>}
              <div className="mt-0.5 @min-[40rem]:hidden"><ResourceLink type={e.target.type} id={e.target.id} name={e.target.name} muted /></div>
            </td>
            <td className="hidden max-w-56 px-3 py-2 @min-[40rem]:table-cell"><ResourceLink type={e.target.type} id={e.target.id} name={e.target.name} /></td>
            <td className="hidden max-w-48 truncate px-3 py-2 text-fg-2 @min-[36rem]:table-cell">{e.actor}</td>
            <td className="hidden px-3 py-2 @min-[44rem]:table-cell"><span className="inline-flex items-center gap-1.5 text-muted"><Via className="size-3.5" />{VIA_LABEL[e.via ?? 'console']}</span></td>
            <td className="hidden px-3 py-2 font-mono text-[12px] text-muted @min-[60rem]:table-cell">{e.sourceIp ?? '—'}</td>
            <td className="px-3 py-2 text-right">{e.result === 'success' ? <CheckCircle2 className="ml-auto size-4 text-emerald-500" aria-label="success" /> : <XCircle className="ml-auto size-4 text-rose-500" aria-label="failure" />}</td>
          </tr>
        );
      })}
    </>
  );
}
