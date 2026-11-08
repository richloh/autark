import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Wallet, Pencil, Trash2, ArrowRightLeft, Save, Gauge, ShieldCheck, Users, Activity, Plus, X, Lock, Building2, Cloud, Check, Bell, UserMinus, Bot, TrendingUp, Tag as TagIcon,
} from 'lucide-react';
import { useItem, useList, useLookup, useApiMutation } from '@/api/hooks';
import { api, type ApiClientError } from '@/api/client';
import { useUi } from '@/store/ui';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Tabs, useTabParam } from '@/components/ui/Tabs';
import { Modal, confirm } from '@/components/ui/Modal';
import { Field, Input, Textarea, NumberInput, Switch, Hint, Select } from '@/components/ui/form';
import { EmptyState, Skeleton, StackBar, Mono } from '@/components/ui/misc';
import { IacTabs, toHcl, toCurl } from '@/components/ui/CodeBlock';
import { fieldErrors } from '@/components/ui/FormLayout';
import { toast } from '@/components/ui/toast';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { BudgetGauge, BurnChart, budgetState } from '@/components/iam/Budget';
import { QuotaRow, QUOTAS } from '@/components/iam/Quotas';
import { Avatar, BotAvatar } from '@/components/iam/Avatar';
import { RoleChips } from '@/components/iam/RoleChips';
import { ActorFeed } from '@/components/iam/ActorFeed';
import { SERVICE_META } from '@/components/iam/permissions';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { ProjectAllowance, Project, Location, User, SystemAccount, Role, Service, QuotaKey } from '@/types';

const POLICY_SERVICES: Service[] = ['compute', 'storage', 'network', 'dns', 'db', 'k8s', 'objectStorage', 'loadBalancers'];
const COLORS = ['#5b67f8', '#06b6d4', '#a855f7', '#f59e0b', '#10b981', '#ec4899', '#ef4444', '#64748b'];

export default function AllowanceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: a, isLoading, error } = useItem<ProjectAllowance>('allowances', id);
  const { map: projects } = useLookup<Project>('projects');
  const setScope = useUi((s) => s.setScope);
  const scope = useUi((s) => s.projectId);
  const [tab, setTab] = useTabParam('budget');
  const [editing, setEditing] = useState(false);

  if (isLoading) return <Page><Skeleton className="mb-4 h-12 w-72" /><Skeleton className="h-96" /></Page>;
  if (error || !a) return <Page><EmptyState icon={Wallet} title="Project not found" description="It may have been deleted, or belongs to another account." action={<Button to="/iam/project-allowances">All projects</Button>} /></Page>;

  const p = projects.get(a.projectId);
  const st = budgetState(a);
  const remove = async () => {
    if (!(await confirm({ title: `Delete project ${a.name}?`, message: 'The project, its budget and policies are removed and members lose access to it. Projects that still contain resources cannot be deleted.', confirmLabel: 'Delete project', danger: true, typeToConfirm: a.name }))) return;
    try {
      await api.action('allowances', a.id, 'deleteProject');
      toast.success(`Project ${a.name} deleted`);
      if (scope === a.projectId) setScope(a.accountId, '');
      navigate('/iam/project-allowances');
    } catch (e) { toast.error('Cannot delete project', (e as Error).message) }
  };

  return (
    <Page wide>
      <PageHeader
        crumbs={[{ label: 'Projects & Budgets', to: '/iam/project-allowances' }, { label: a.name }]}
        title={a.name} icon={Wallet} iconColor={p?.color ?? '#f59e0b'}
        status={<Badge tone={st.level === 'over' ? 'danger' : st.level === 'warn' ? 'warning' : 'success'} dot>{st.label}</Badge>}
        description={p?.description}
        meta={<>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: p?.color }} />Project <Mono copy className="text-xs">{a.projectId}</Mono></span>
          <span>{a.resourceCount ?? 0} billable resources</span>
          <span>{a.members ?? 0} members</span>
          {a.hardLimit && <span className="inline-flex items-center gap-1"><Lock className="size-3" />hard budget limit</span>}
        </>}
        actions={<>
          <Button icon={ArrowRightLeft} disabled={scope === a.projectId} onClick={() => { setScope(a.accountId, a.projectId); toast.success(`Now working in ${a.name}`) }}>{scope === a.projectId ? 'Current project' : 'Switch to project'}</Button>
          <Button icon={Pencil} onClick={() => setEditing(true)}>Edit project</Button>
          <IconButton icon={Trash2} label="Delete project" variant="secondary" className="hover:text-rose-500" onClick={remove} />
        </>}
      />

      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[
        { id: 'budget', label: 'Budget', icon: <Wallet className="size-3.5" /> },
        { id: 'quotas', label: 'Quotas', icon: <Gauge className="size-3.5" /> },
        { id: 'policies', label: 'Policies', icon: <ShieldCheck className="size-3.5" /> },
        { id: 'members', label: 'Members', count: a.members },
        { id: 'activity', label: 'Activity', icon: <Activity className="size-3.5" /> },
      ]} />

      {tab === 'budget' && <BudgetTab a={a} />}
      {tab === 'quotas' && <QuotasTab a={a} />}
      {tab === 'policies' && <PoliciesTab a={a} />}
      {tab === 'members' && <MembersTab a={a} />}
      {tab === 'activity' && (
        <div className="grid [&>*]:min-w-0 gap-5 @min-[60rem]:grid-cols-2">
          <Card><CardHeader icon={Activity} title="Resource activity in this project" /><ActorFeed params={{ projectId: a.projectId }} showActor emptyText="No changes to resources in this project yet." /></Card>
          <Card><CardHeader icon={Wallet} title="Budget & policy changes" /><ActivityFeed targetId={a.id} /></Card>
        </div>
      )}
      {p && <EditProjectModal a={a} p={p} open={editing} onClose={() => setEditing(false)} />}
    </Page>
  );
}

/* ------------------------------------------------------------------ budget */

function BudgetTab({ a }: { a: ProjectAllowance }) {
  const st = budgetState(a);
  const [budget, setBudget] = useState(a.budgetMonthly);
  const [thresholds, setThresholds] = useState(a.alertThresholds);
  const [hardLimit, setHardLimit] = useState(a.hardLimit);
  const [newT, setNewT] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setBudget(a.budgetMonthly); setThresholds(a.alertThresholds); setHardLimit(a.hardLimit) }, [a.budgetMonthly, a.alertThresholds.join(), a.hardLimit]); // eslint-disable-line
  const dirty = budget !== a.budgetMonthly || thresholds.join() !== a.alertThresholds.join() || hardLimit !== a.hardLimit;
  const save = useApiMutation(() => api.update('allowances', a.id, { budgetMonthly: budget, alertThresholds: thresholds, hardLimit }), {
    silent: true, onSuccess: () => { toast.success('Budget updated'); setErrors({}) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); toast.error('Could not save budget', e.message) },
  });
  const addT = () => { const n = Number(newT); if (Number.isInteger(n) && n >= 1 && n <= 200 && !thresholds.includes(n)) setThresholds([...thresholds, n].sort((x, y) => x - y)); setNewT('') };
  const preview = { ...a, budgetMonthly: budget, alertThresholds: thresholds };
  const services = a.spendByService ?? [];
  const totalSvc = services.reduce((s, x) => s + x.monthly, 0);
  const daysLeft = (a.daysInMonth ?? 30) - (a.dayOfMonth ?? 1);
  const headroom = budget - (a.forecastSpend ?? 0);
  const previewPct = budget > 0 ? ((a.forecastSpend ?? 0) / budget) * 100 : 0;
  const crossed = thresholds.filter((t) => previewPct >= t);

  return (
    <div className="grid [&>*]:min-w-0 gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Card>
          <CardHeader icon={TrendingUp} title="Budget burn-down" description={`Cumulative spend this month vs. ${money(budget)} budget · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`} />
          <CardBody>
            <div className="mb-4 grid grid-cols-2 gap-3 @min-[36rem]:grid-cols-4">
              <Kpi label="Spent so far" value={money(a.mtdSpend)} sub={`${Math.round(st.mPct)}% of budget`} />
              <Kpi label="Forecast" value={money(a.forecastSpend)} sub={`${Math.round(st.fPct)}% of budget`} color={st.level === 'ok' ? undefined : st.color} />
              <Kpi label="Run-rate" value={`${money(a.monthlySpend)}`} sub="per month at current usage" />
              <Kpi label={headroom >= 0 ? 'Headroom' : 'Overrun'} value={money(Math.abs(headroom))} sub={headroom >= 0 ? 'left after forecast' : 'above budget'} color={headroom < 0 ? '#f43f5e' : undefined} />
            </div>
            <BurnChart allowance={preview} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Run-rate by service" description="Where the money goes (current monthly run-rate)" />
          <CardBody>
            {services.length === 0 ? <p className="text-sm text-muted">No billable resources in this project yet.</p> : (
              <>
                <StackBar total={totalSvc} height="h-3" segments={services.map((s) => ({ value: s.monthly, color: SERVICE_META[s.service as Service]?.color ?? '#94a3b8', label: SERVICE_META[s.service as Service]?.label ?? s.service }))} />
                <ul className="mt-4 grid gap-x-6 gap-y-2 @min-[36rem]:grid-cols-2">
                  {services.map((s) => (
                    <li key={s.service} className="flex items-center gap-2 text-[13px]">
                      <span className="size-2.5 rounded-sm" style={{ background: SERVICE_META[s.service as Service]?.color ?? '#94a3b8' }} />
                      <span className="flex-1 text-fg-2">{SERVICE_META[s.service as Service]?.label ?? s.service}</span>
                      <span className="tabular text-fg">{money(s.monthly)}</span>
                      <span className="w-10 text-right text-xs tabular text-muted">{Math.round((s.monthly / totalSvc) * 100)}%</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 text-right"><Link to="/billing/cost-explorer" className="text-xs font-medium text-brand-500 hover:underline">Open cost explorer →</Link></div>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader icon={Wallet} title="Budget settings" />
          <CardBody className="space-y-5">
            <div className="flex justify-center"><BudgetGauge allowance={preview} size={190} /></div>
            <Field label="Monthly budget" error={errors.budgetMonthly}>
              <NumberInput value={budget} onChange={setBudget} min={0} max={10_000_000} step={100} unit="EUR" invalid={!!errors.budgetMonthly} />
            </Field>
            <Field label="Alert thresholds" error={errors.alertThresholds} hint="Notify project owners when the forecast crosses these percentages.">
              <div className="flex flex-wrap items-center gap-1.5">
                {thresholds.map((t) => (
                  <span key={t} className={cn('inline-flex h-7 items-center gap-1 rounded-lg border pl-2 pr-1 text-xs font-medium tabular', t >= 100 ? 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300' : 'border-line bg-surface-2 text-fg-2')}>
                    <Bell className="size-3 opacity-60" />{t}%
                    <button type="button" onClick={() => setThresholds(thresholds.filter((x) => x !== t))} className="rounded p-0.5 text-faint hover:text-rose-500" aria-label={`Remove ${t}%`}><X className="size-3" /></button>
                  </span>
                ))}
                <span className="inline-flex items-center gap-1">
                  <Input value={newT} onChange={(e) => setNewT(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addT() } }} placeholder="90" className="h-7 w-16 text-xs" suffix="%" />
                  <IconButton size="xs" icon={Plus} label="Add threshold" variant="secondary" onClick={addT} disabled={!newT} />
                </span>
              </div>
              <div className="mt-2 text-xs text-muted">{crossed.length ? <span className="text-amber-600 dark:text-amber-400">Forecast ({Math.round(previewPct)}%) already crosses {crossed.map((t) => `${t}%`).join(', ')}</span> : `No threshold crossed by the current forecast (${Math.round(previewPct)}%).`}</div>
            </Field>
            <div className="rounded-xl border border-line p-3">
              <Switch checked={hardLimit} onChange={setHardLimit} label={<span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" />Hard limit</span>} description="Block creating new billable resources once the budget is exhausted. Running workloads are never stopped." />
            </div>
            {hardLimit && (a.forecastSpend ?? 0) > budget && <Hint tone="danger">With a hard limit, new resources will be blocked around day {Math.max(1, Math.min(a.daysInMonth ?? 30, Math.floor(budget / Math.max(0.01, (a.monthlySpend ?? 0) / (a.daysInMonth ?? 30)))))} of the month.</Hint>}
            <div className="flex gap-2">
              <Button variant="ghost" disabled={!dirty} onClick={() => { setBudget(a.budgetMonthly); setThresholds(a.alertThresholds); setHardLimit(a.hardLimit); setErrors({}) }}>Reset</Button>
              <Button variant="primary" icon={Save} className="flex-1" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save budget</Button>
            </div>
          </CardBody>
        </Card>
        <Card><CardBody><IacTabs snippets={{ terraform: toHcl('project_allowance', a.projectId, { projectId: a.projectId, budgetMonthly: budget, alertThresholds: thresholds, hardLimit }), curl: toCurl('PATCH', `/allowances/${a.id}`, { budgetMonthly: budget, alertThresholds: thresholds, hardLimit }) }} /></CardBody></Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="text-base font-semibold tabular text-fg" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[10.5px] text-muted">{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ quotas */

function QuotasTab({ a }: { a: ProjectAllowance }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<Record<QuotaKey, number>>(a.quotas);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (!edit) setDraft(a.quotas) }, [a.quotas, edit]);
  const changed = QUOTAS.filter((q) => draft[q.key] !== a.quotas[q.key]);
  const save = useApiMutation(() => api.update('allowances', a.id, { quotas: Object.fromEntries(changed.map((q) => [q.key, draft[q.key]])) }), {
    silent: true, onSuccess: () => { toast.success('Quotas updated', `${changed.length} limit${changed.length === 1 ? '' : 's'} changed.`); setEdit(false); setErrors({}) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); toast.error('Could not update quotas', e.message) },
  });
  return (
    <div className="grid [&>*]:min-w-0 gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader icon={Gauge} title="Resource quotas" description="Hard caps enforced when creating or resizing resources in this project."
          actions={edit ? <>
            <Button size="sm" variant="ghost" onClick={() => { setEdit(false); setDraft(a.quotas); setErrors({}) }}>Cancel</Button>
            <Button size="sm" variant="primary" icon={Save} disabled={!changed.length} loading={save.isPending} onClick={() => save.mutate()}>Save {changed.length ? `(${changed.length})` : ''}</Button>
          </> : <Button size="sm" icon={Pencil} onClick={() => setEdit(true)}>Edit limits</Button>} />
        <CardBody className="divide-y divide-line py-1">
          {QUOTAS.map((q) => (
            <QuotaRow key={q.key} q={q} used={a.usage?.[q.key] ?? 0} limit={a.quotas[q.key]} draft={edit ? draft[q.key] : undefined}
              onDraft={edit ? (v) => setDraft({ ...draft, [q.key]: v }) : undefined} error={errors[q.key]} />
          ))}
        </CardBody>
      </Card>
      <div className="space-y-4">
        <Hint>Quotas can't be set below current usage. Members hitting a quota get a clear error with the current usage and a link to request more.</Hint>
        {edit && changed.length > 0 && (
          <Card><CardHeader title="Pending changes" /><CardBody className="space-y-1.5 text-[13px]">
            {changed.map((q) => <div key={q.key} className="flex justify-between"><span className="text-fg-2">{q.label}</span><span className="tabular"><span className="text-muted">{a.quotas[q.key]}</span> → <b className={draft[q.key] > a.quotas[q.key] ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>{draft[q.key]}</b></span></div>)}
          </CardBody></Card>
        )}
        <Card><CardBody><IacTabs snippets={{ terraform: toHcl('project_allowance', a.projectId, { projectId: a.projectId, quotas: draft }), curl: toCurl('PATCH', `/allowances/${a.id}`, { quotas: draft }) }} /></CardBody></Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ policies */

function PoliciesTab({ a }: { a: ProjectAllowance }) {
  const { items: locations } = useList<Location>('locations');
  const [services, setServices] = useState<Service[]>(a.allowedServices);
  const [locs, setLocs] = useState<string[]>(a.allowedLocations);
  const [tags, setTags] = useState<string[]>(a.requiredTags);
  const [newTag, setNewTag] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setServices(a.allowedServices); setLocs(a.allowedLocations); setTags(a.requiredTags) }, [a.allowedServices.join(), a.allowedLocations.join(), a.requiredTags.join()]); // eslint-disable-line
  const dirty = services.join() !== a.allowedServices.join() || [...locs].sort().join() !== [...a.allowedLocations].sort().join() || tags.join() !== a.requiredTags.join();
  const spend = new Map((a.spendByService ?? []).map((s) => [s.service, s.monthly]));
  const save = useApiMutation(() => api.update('allowances', a.id, { allowedServices: services, allowedLocations: locs, requiredTags: tags }), {
    silent: true, onSuccess: () => { toast.success('Policies updated', 'New requests are checked against them immediately.'); setErrors({}) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); toast.error('Could not update policies', e.message) },
  });
  const addTag = () => { const k = newTag.trim(); if (k && !tags.includes(k)) setTags([...tags, k]); setNewTag('') };
  const removedWithSpend = a.allowedServices.filter((s) => !services.includes(s) && (spend.get(s) ?? 0) > 0);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader icon={ShieldCheck} title="Allowed services" description="Members can only create resources of enabled services in this project." />
        <CardBody>
          <div className="grid [&>*]:min-w-0 grid-cols-2 gap-2 @min-[36rem]:grid-cols-4">
            {POLICY_SERVICES.map((s) => {
              const on = services.includes(s);
              const m = SERVICE_META[s];
              return (
                <button key={s} type="button" role="switch" aria-checked={on} onClick={() => setServices(on ? services.filter((x) => x !== s) : POLICY_SERVICES.filter((x) => x === s || services.includes(x)))}
                  className={cn('flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all', on ? 'border-brand-500/60 bg-brand-500/[0.05]' : 'border-line bg-surface opacity-70 hover:opacity-100')}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${m.color}1a`, color: m.color }}><span className="size-2.5 rounded-full" style={{ background: m.color }} /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-fg">{m.label}</span><span className="block text-[11px] text-muted">{spend.get(s) ? `${money(spend.get(s))}/mo in use` : on ? 'allowed' : 'blocked'}</span></span>
                  <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-full', on ? 'bg-brand-500 text-white' : 'border border-line-strong')}>{on && <Check className="size-3" strokeWidth={3} />}</span>
                </button>
              );
            })}
          </div>
          {errors.allowedServices && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{errors.allowedServices}</p>}
          {removedWithSpend.length > 0 && <Hint tone="warning" className="mt-3">{removedWithSpend.map((s) => SERVICE_META[s].label).join(', ')} still {removedWithSpend.length === 1 ? 'has' : 'have'} running resources. They keep running, but no new ones can be created.</Hint>}
        </CardBody>
      </Card>

      <div className="grid [&>*]:min-w-0 gap-5 @min-[44rem]:grid-cols-2">
        <Card>
          <CardHeader icon={Building2} title="Allowed locations" description="Data residency: where this project's resources may run." />
          <CardBody className="space-y-3">
            {(['selfHosted', 'cloud'] as const).map((kind) => (
              <div key={kind}>
                <div className="mb-1.5 text-xs font-medium text-muted">{kind === 'selfHosted' ? 'Own datacenters' : 'Cloud burst regions'}</div>
                <div className="grid [&>*]:min-w-0 gap-2 @min-[36rem]:grid-cols-2">
                  {locations.filter((l) => l.kind === kind).map((l) => {
                    const on = locs.includes(l.id);
                    return (
                      <button key={l.id} type="button" role="checkbox" aria-checked={on} onClick={() => setLocs(on ? locs.filter((x) => x !== l.id) : [...locs, l.id])}
                        className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[13px]', on ? 'border-brand-500 bg-brand-500/[0.05]' : 'border-line hover:bg-surface-2')}>
                        <span className={cn('flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong')}>{on && <Check className="size-3" strokeWidth={3} />}</span>
                        {kind === 'selfHosted' ? <Building2 className="size-3.5 text-emerald-500" /> : <Cloud className="size-3.5 text-sky-500" />}
                        <span className="min-w-0 flex-1 truncate text-fg">{l.name}</span>
                        <span className="text-[11px] text-muted">{l.country}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {errors.allowedLocations && <p className="text-xs text-rose-600 dark:text-rose-400">{errors.allowedLocations}</p>}
            {locs.some((id) => locations.find((l) => l.id === id)?.country === 'US') && <Hint tone="warning">A US region is allowed — check your data-residency requirements.</Hint>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={TagIcon} title="Required tags" description="Every new resource must carry these tag keys with a value (e.g. for chargeback)." />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {tags.length === 0 && <span className="text-[13px] text-muted">No tags required.</span>}
              {tags.map((t) => (
                <span key={t} className="inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-surface-2 pl-2 pr-1 font-mono text-xs text-fg">
                  {t}<button type="button" onClick={() => setTags(tags.filter((x) => x !== t))} className="rounded p-0.5 text-faint hover:text-rose-500" aria-label={`Remove ${t}`}><X className="size-3" /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input mono value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }} placeholder="cost-center" list="req-tag-suggest" className="flex-1" />
              <Button icon={Plus} onClick={addTag} disabled={!newTag.trim()}>Add</Button>
              <datalist id="req-tag-suggest">{['env', 'app', 'team', 'owner', 'cost-center', 'data-class'].map((t) => <option key={t} value={t} />)}</datalist>
            </div>
            {errors.requiredTags && <p className="text-xs text-rose-600 dark:text-rose-400">{errors.requiredTags}</p>}
            <p className="text-xs text-muted">Existing resources are not affected; the policy applies to creates and tag edits.</p>
          </CardBody>
        </Card>
      </div>
      <div className="sticky bottom-4 z-10 flex justify-end">
        <div className={cn('flex items-center gap-2 rounded-xl border border-line bg-surface/95 p-2 shadow-pop backdrop-blur transition-opacity', !dirty && 'pointer-events-none opacity-0')}>
          <span className="px-2 text-[13px] text-muted">Unsaved policy changes</span>
          <Button variant="ghost" onClick={() => { setServices(a.allowedServices); setLocs(a.allowedLocations); setTags(a.requiredTags); setErrors({}) }}>Discard</Button>
          <Button variant="primary" icon={Save} loading={save.isPending} onClick={() => save.mutate()}>Save policies</Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ members */

function MembersTab({ a }: { a: ProjectAllowance }) {
  const { items: users } = useList<User>('users');
  const { items: svcs } = useList<SystemAccount>('systemAccounts');
  const { map: roles } = useLookup<Role>('roles');
  const [pick, setPick] = useState('');
  const has = (p: string[] | '*') => p === '*' || p.includes(a.projectId);
  const members = users.filter((u) => has(u.projectIds));
  const candidates = users.filter((u) => !has(u.projectIds) && u.status !== 'disabled');
  const add = useApiMutation((u: User) => api.update('users', u.id, { projectIds: [...(u.projectIds as string[]), a.projectId] }), { success: (_r, u) => `${u.name} added to ${a.name}`, onSuccess: () => setPick('') });
  const removeMember = async (u: User) => {
    if (u.projectIds === '*') { toast.info(`${u.name} has access to all projects`, 'Change it on their user page to restrict access.'); return }
    if (u.projectIds.length === 1) { toast.error('Cannot remove the last project', `${u.name} needs access to at least one project.`); return }
    if (!(await confirm({ title: `Remove ${u.name} from ${a.name}?`, message: 'They immediately lose access to resources in this project.', confirmLabel: 'Remove', danger: true }))) return;
    try { await api.update('users', u.id, { projectIds: u.projectIds.filter((x) => x !== a.projectId) }); toast.success(`${u.name} removed`) } catch (e) { toast.error('Failed', (e as Error).message) }
  };
  return (
    <div className="grid [&>*]:min-w-0 gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader icon={Users} title={`People (${members.length})`} description="Users whose project access includes this project. Their roles define what they can do here." />
        <div className="flex gap-2 border-b border-line p-3">
          <Select className="flex-1" value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Add a member…" options={candidates.map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` }))} />
          <Button icon={Plus} disabled={!pick} loading={add.isPending} onClick={() => { const u = users.find((x) => x.id === pick); if (u) add.mutate(u) }}>Add</Button>
        </div>
        <ul className="divide-y divide-line">
          {members.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar name={u.name} seed={u.email} size={30} status={u.status} muted={u.status === 'disabled'} />
              <Link to={`/iam/users/${u.id}`} className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-fg hover:text-brand-500">{u.name}</div><div className="truncate text-[11.5px] text-muted">{u.email}</div></Link>
              <RoleChips roleIds={u.roleIds} roles={roles} max={2} className="hidden @min-[40rem]:flex" />
              {u.projectIds === '*' ? <Badge title="Access to all projects">all</Badge> : null}
              {u.status !== 'active' && <StatusPill status={u.status} />}
              <IconButton size="sm" icon={UserMinus} label="Remove from project" className="hover:text-rose-500" onClick={() => removeMember(u)} />
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader icon={Bot} title="System accounts" />
        {svcs.filter((s) => has(s.projectIds)).length === 0 ? <EmptyState icon={Bot} title="No automation has access" /> : (
          <ul className="divide-y divide-line">
            {svcs.filter((s) => has(s.projectIds)).map((s) => (
              <li key={s.id}>
                <Link to={`/iam/system-accounts/${s.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                  <BotAvatar size={28} disabled={s.status === 'disabled'} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg">{s.name}</span>
                  <RoleChips roleIds={s.roleIds} roles={roles} link={false} max={1} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ edit project */

function EditProjectModal({ a, p, open, onClose }: { a: ProjectAllowance; p: Project; open: boolean; onClose: () => void }) {
  const [name, setName] = useState(p.name);
  const [description, setDescription] = useState(p.description);
  const [color, setColor] = useState(p.color);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setName(p.name); setDescription(p.description); setColor(p.color); setErrors({}) } }, [open]); // eslint-disable-line
  const save = useApiMutation(() => api.update('allowances', a.id, { name, description, color }), {
    silent: true, onSuccess: () => { toast.success('Project updated'); onClose() },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); if (!Object.keys(fieldErrors(e)).length) toast.error('Update failed', e.message) },
  });
  return (
    <Modal open={open} onClose={onClose} title="Edit project" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} /></Field>
        <Field label="Description" optional><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Color" error={errors.color}>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} className={cn('flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-surface', color === c && 'ring-2')} style={{ background: c, ['--tw-ring-color' as string]: c }}>
                {color === c && <Check className="size-3.5 text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </Field>
        <p className="text-xs text-muted">The project id <code className="font-mono">{p.id}</code> is permanent.</p>
      </div>
    </Modal>
  );
}
