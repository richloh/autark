import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Box, Database, Container, ShipWheel, Split, Lock, Globe2, Check, AlertTriangle, ArrowRight, CircleSlash, Play, Scale, Users, CheckCircle2, type LucideIcon } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation, useLookup } from '@/api/hooks';
import { cn } from '@/lib/cn';
import { HOST_ROLES, type Account, type BareMetalHost, type HostAccess, type HostRole, type Project } from '@/types';
import { ROLE_META, hostRoles, hostAccess, isRestricted, accessSummary, reservedFor, OPEN_ACCESS, type PolicyNames } from '@/lib/hostPolicy';
import { Checkbox, Hint, OptionCards } from '@/components/ui/form';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';

/* Host policy UI: workload roles (what Autark may schedule on a host) and availability (who may use it). */

export const ROLE_ICON: Record<HostRole, LucideIcon> = { compute: Box, storage: Database, 'k8s-worker': Container, 'k8s-control-plane': ShipWheel, 'load-balancer': Split };
export const ROLE_HEX: Record<HostRole, string> = { compute: '#5b67f8', storage: '#d97706', 'k8s-worker': '#326ce5', 'k8s-control-plane': '#0891b2', 'load-balancer': '#c026d3' };

/** Name lookups for accounts & projects (for "Reserved for …" lines). */
export function usePolicyNames() {
  const { map: accounts, items: accountList } = useLookup<Account>('accounts');
  const { map: projects, items: projectList } = useLookup<Project>('projects');
  const names: PolicyNames = useMemo(() => ({ account: (id) => accounts.get(id)?.name ?? id, project: (id) => projects.get(id)?.name ?? id }), [accounts, projects]);
  return { names, accounts: accountList, projects: projectList, accountMap: accounts, projectMap: projects };
}

/* ------------------------------------------------------------------ chips */

export function RoleChip({ role, compact, className }: { role: HostRole; compact?: boolean; className?: string }) {
  const Icon = ROLE_ICON[role];
  const m = ROLE_META[role];
  if (compact) return (
    <span title={`${m.label} — ${m.description}`} className={cn('inline-flex size-[22px] shrink-0 items-center justify-center rounded-md', className)} style={{ background: `${ROLE_HEX[role]}1a`, color: ROLE_HEX[role] }}>
      <Icon className="size-3.5" aria-label={m.label} />
    </span>
  );
  return (
    <span title={m.description} className={cn('inline-flex h-[22px] shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium', className)} style={{ background: `${ROLE_HEX[role]}17`, color: ROLE_HEX[role] }}>
      <Icon className="size-3" />{m.short}
    </span>
  );
}

export function RoleChips({ roles, compact, className }: { roles: HostRole[]; compact?: boolean; className?: string }) {
  return <span className={cn('flex flex-wrap items-center', compact ? 'gap-1' : 'gap-1.5', className)}>{roles.map((r) => <RoleChip key={r} role={r} compact={compact} />)}</span>;
}

export function AccessLock({ h, names, className, withText }: { h: Pick<BareMetalHost, 'access'>; names: PolicyNames; className?: string; withText?: boolean }) {
  if (!isRestricted(h)) return null;
  const text = accessSummary(h, names);
  return (
    <span title={text} className={cn('inline-flex min-w-0 items-center gap-1 text-amber-600 dark:text-amber-400', className)}>
      <Lock className="size-3.5 shrink-0" aria-label={text} />
      {withText && <span className="truncate text-[11.5px]">{reservedFor(h, names, 2)}</span>}
    </span>
  );
}

/** Compact one-card summary used on the host overview. */
export function PolicySummary({ h, names, onEdit }: { h: BareMetalHost; names: PolicyNames; onEdit?: () => void }) {
  const restricted = isRestricted(h);
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-fg"><Scale className="size-4 text-muted" />Policy</span>
        {onEdit && <button type="button" onClick={onEdit} className="text-xs text-brand-500 hover:underline">Edit</button>}
      </div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Runs</div>
      <RoleChips roles={hostRoles(h)} />
      <div className="mb-1.5 mt-3 text-[11px] font-medium uppercase tracking-wide text-faint">Available to</div>
      <div className={cn('flex items-start gap-1.5 text-[13px]', restricted ? 'text-amber-700 dark:text-amber-300' : 'text-fg-2')}>
        {restricted ? <Lock className="mt-0.5 size-3.5 shrink-0" /> : <Globe2 className="mt-0.5 size-3.5 shrink-0 text-muted" />}
        <span>{restricted ? accessSummary(h, names) : 'All accounts'}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ editors */

/** Five large toggle cards — one per workload role (checkbox semantics). */
export function RoleToggleCards({ value, onChange, error, className }: { value: HostRole[]; onChange: (v: HostRole[]) => void; error?: string; className?: string }) {
  const toggle = (r: HostRole) => onChange(value.includes(r) ? value.filter((x) => x !== r) : HOST_ROLES.filter((x) => x === r || value.includes(x)));
  return (
    <div className={cn('@container', className)}>
      <div className="grid grid-cols-1 gap-2.5 @min-[28rem]:grid-cols-2 @min-[46rem]:grid-cols-3">
        {HOST_ROLES.map((r) => {
          const on = value.includes(r);
          const Icon = ROLE_ICON[r];
          return (
            <button key={r} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(r)}
              className={cn('flex items-start gap-3 rounded-xl border p-3 text-left transition-all', on ? 'border-brand-500 bg-brand-500/[0.05] ring-3 ring-brand-500/15' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2/50')}>
              <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg transition-opacity', !on && 'opacity-60')} style={{ background: `${ROLE_HEX[r]}1a`, color: ROLE_HEX[r] }}><Icon className="size-[18px]" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-snug text-fg">{ROLE_META[r].label}</span>
                <span className="block text-xs text-muted">{ROLE_META[r].description}</span>
              </span>
              <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong')}>{on && <Check className="size-3" strokeWidth={3} />}</span>
            </button>
          );
        })}
      </div>
      {(error || !value.length) && <p className="mt-2 text-xs text-rose-500">{error ?? 'Enable at least one role'}</p>}
    </div>
  );
}

/** "All accounts & projects" vs "Only selected" with a grouped account → projects picker. */
export function AccessPicker({ value, onChange, accounts, projects, error }: {
  value: HostAccess; onChange: (v: HostAccess) => void; accounts: Account[]; projects: Project[]; error?: string;
}) {
  const restricted = value.mode === 'restricted';
  const setMode = (m: 'all' | 'restricted') => onChange(m === 'all' ? { ...OPEN_ACCESS } : { mode: 'restricted', accountIds: value.accountIds, projectIds: value.projectIds });
  const toggleAccount = (id: string) => {
    const on = value.accountIds.includes(id);
    const own = projects.filter((p) => p.accountId === id).map((p) => p.id);
    onChange({ ...value, mode: 'restricted', accountIds: on ? value.accountIds.filter((x) => x !== id) : [...value.accountIds, id], projectIds: value.projectIds.filter((p) => !own.includes(p)) });
  };
  const toggleProject = (id: string) => onChange({ ...value, mode: 'restricted', projectIds: value.projectIds.includes(id) ? value.projectIds.filter((x) => x !== id) : [...value.projectIds, id] });
  const nothing = restricted && !value.accountIds.length && !value.projectIds.length;
  return (
    <div className="space-y-3">
      <OptionCards cols={2} value={value.mode} onChange={setMode} options={[
        { value: 'all', title: 'All accounts & projects', description: 'Any workload may land here.', icon: <Globe2 className="size-4 text-muted" /> },
        { value: 'restricted', title: 'Only selected', description: 'Reserve this host for specific customers or teams.', icon: <Lock className="size-4 text-amber-500" /> },
      ]} />
      {restricted && (
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {accounts.map((a) => {
            const own = projects.filter((p) => p.accountId === a.id);
            const whole = value.accountIds.includes(a.id);
            const some = !whole && own.some((p) => value.projectIds.includes(p.id));
            return (
              <div key={a.id} className={cn('px-3 py-2.5', (whole || some) && 'bg-brand-500/[0.03]')}>
                <div className="flex items-center justify-between gap-2">
                  <Checkbox checked={whole} indeterminate={some} onChange={() => toggleAccount(a.id)} label={<span className="flex items-center gap-1.5 font-medium text-fg"><Users className="size-3.5 text-muted" />{a.name}</span>} />
                  <span className="shrink-0 text-[11px] text-muted">{whole ? 'whole account' : some ? `${own.filter((p) => value.projectIds.includes(p.id)).length} of ${own.length} projects` : `${own.length} project${own.length === 1 ? '' : 's'}`}</span>
                </div>
                {own.length > 0 && (
                  <div className="ml-6 mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                    {own.map((p) => (
                      <Checkbox key={p.id} disabled={whole} checked={whole || value.projectIds.includes(p.id)} onChange={() => toggleProject(p.id)}
                        label={<span className="flex items-center gap-1.5 text-[13px]"><span className="size-2 rounded-full" style={{ background: p.color }} />{p.name}</span>} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {!accounts.length && <div className="px-3 py-4 text-center text-xs text-muted">No accounts</div>}
        </div>
      )}
      {(error || nothing) && <p className="text-xs text-rose-500">{error ?? 'Select at least one account or project'}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ impact */

export interface PolicyViolation { kind: 'vm' | 'db' | 'k8s' | 'k8s-cp' | 'lb' | 'storage'; id: string; name: string; projectId?: string; reason: string; outcome: 'keeps-running' | 'moves' | 'unplaced' | 'rebalance'; detail: string }
export interface PolicyImpactResult { valid?: boolean; errors?: Record<string, string>; violations: PolicyViolation[]; incoming: { kind: string; id: string; name: string; vcpus: number; ramGB: number }[]; summary: string }

const KIND_LABEL: Record<string, string> = { vm: 'VM', db: 'Database', k8s: 'K8s worker', 'k8s-cp': 'Control plane', lb: 'Load balancer', storage: 'Ceph' };
const KIND_LINK: Record<string, (id: string) => string | undefined> = {
  vm: (id) => `/infrastructure/vms/${id}`, db: (id) => `/managed-services/db/${id}`, k8s: (id) => `/managed-services/kubernetes/${id}`,
  'k8s-cp': (id) => `/managed-services/kubernetes/${id}`, lb: (id) => `/managed-services/load-balancers/${id}`, storage: () => undefined,
};
const OUTCOME: Record<PolicyViolation['outcome'], { label: string; icon: LucideIcon; cls: string }> = {
  'keeps-running': { label: 'keeps running', icon: Play, cls: 'text-amber-600 dark:text-amber-400' },
  moves: { label: 'rescheduled', icon: ArrowRight, cls: 'text-sky-600 dark:text-sky-400' },
  unplaced: { label: 'no eligible host', icon: CircleSlash, cls: 'text-rose-600 dark:text-rose-400' },
  rebalance: { label: 'rebalance', icon: Database, cls: 'text-amber-600 dark:text-amber-400' },
};

/** Debounced dry-run of a policy change (POST /hosts/:id/policy-preview). */
export function usePolicyPreview(hostId: string | undefined, roles: HostRole[], access: HostAccess, enabled: boolean) {
  const body = JSON.stringify({ roles, access });
  const [debounced, setDebounced] = useState(body);
  useEffect(() => { const t = setTimeout(() => setDebounced(body), 250); return () => clearTimeout(t) }, [body]);
  return useQuery({
    queryKey: ['hosts', 'policy-preview', hostId, debounced],
    queryFn: () => api.post<PolicyImpactResult>(`/hosts/${hostId}/policy-preview`, JSON.parse(debounced)),
    enabled: !!hostId && enabled,
    placeholderData: (prev) => prev,
  });
}

export function PolicyImpactList({ impact, loading, names, className }: { impact?: PolicyImpactResult; loading?: boolean; names: PolicyNames; className?: string }) {
  if (loading && !impact) return <div className={cn('space-y-2', className)}><Skeleton className="h-4 w-2/3" /><Skeleton className="h-10 w-full" /></div>;
  if (!impact) return null;
  if (impact.valid === false) return <Hint tone="danger" className={className}>{impact.summary}</Hint>;
  const v = impact.violations;
  return (
    <div className={cn('space-y-2.5', className)}>
      {!v.length ? (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5 text-[13px] text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" /><span>{impact.summary}</span>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-amber-500/30">
          <div className="flex items-start gap-2 bg-amber-500/5 px-3 py-2.5 text-[13px] text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span><b className="font-semibold">{v.length} workload{v.length > 1 ? 's' : ''} conflict{v.length > 1 ? '' : 's'} with this policy.</b> Running VMs are never stopped — new placements follow the policy.</span>
          </div>
          <ul className="divide-y divide-line">
            {v.map((x) => {
              const o = OUTCOME[x.outcome];
              const link = KIND_LINK[x.kind]?.(x.id);
              return (
                <li key={`${x.kind}-${x.name}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
                  <span className="w-24 shrink-0 text-[11px] font-medium uppercase tracking-wide text-faint">{KIND_LABEL[x.kind] ?? x.kind}</span>
                  <span className="min-w-0 flex-1">
                    {link ? <Link to={link} className="font-medium text-fg hover:text-brand-500">{x.name}</Link> : <span className="font-medium text-fg">{x.name}</span>}
                    {x.projectId && <span className="text-xs text-muted"> · {names.project(x.projectId)}</span>}
                    <span className="block text-xs text-muted">{x.reason} — {x.detail}</span>
                  </span>
                  <span className={cn('flex shrink-0 items-center gap-1 text-[11px] font-medium', o.cls)}><o.icon className="size-3" />{o.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {impact.incoming.length > 0 && (
        <p className="text-xs text-muted">Will start hosting: {impact.incoming.slice(0, 4).map((m) => m.name).join(', ')}{impact.incoming.length > 4 ? ` +${impact.incoming.length - 4}` : ''}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ bulk */

/** Bulk "Set roles…" / "Restrict…" for several hosts (each host is updated with its own impact report). */
export function BulkPolicyModal({ hosts, mode, onClose }: { hosts: BareMetalHost[]; mode: 'roles' | 'access' | null; onClose: () => void }) {
  const { accounts, projects } = usePolicyNames();
  const [roles, setRoles] = useState<HostRole[]>(['compute', 'k8s-worker']);
  const [access, setAccess] = useState<HostAccess>({ mode: 'restricted', accountIds: [], projectIds: [] });
  useEffect(() => {
    if (!mode || !hosts.length) return;
    setRoles(hostRoles(hosts[0]));
    setAccess(isRestricted(hosts[0]) ? hostAccess(hosts[0]) : { mode: 'restricted', accountIds: [], projectIds: [] });
  }, [mode, hosts.map((h) => h.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = mode === 'roles' ? roles.length > 0 : access.mode === 'all' || access.accountIds.length + access.projectIds.length > 0;
  const m = useApiMutation(async () => {
    const res = await Promise.allSettled(hosts.map((h) => api.action<PolicyImpactResult>('hosts', h.id, 'updatePolicy', mode === 'roles' ? { roles, access: hostAccess(h) } : { roles: hostRoles(h), access })));
    const failed = res.filter((r) => r.status === 'rejected').length;
    const conflicts = res.reduce((a, r) => a + (r.status === 'fulfilled' ? r.value.violations.length : 0), 0);
    return { failed, conflicts };
  }, {
    silent: true,
    onSuccess: ({ failed, conflicts }) => {
      if (failed) toast.error(`${failed} of ${hosts.length} hosts were not updated`);
      else toast.success(`Policy updated on ${hosts.length} host${hosts.length > 1 ? 's' : ''}`, conflicts ? `${conflicts} running workload(s) conflict — they keep running; see each host's Policy tab.` : 'No running workloads affected.');
      onClose();
    },
  });
  return (
    <Modal open={!!mode} onClose={onClose} size="lg" title={mode === 'roles' ? `Set roles on ${hosts.length} host${hosts.length > 1 ? 's' : ''}` : `Availability of ${hosts.length} host${hosts.length > 1 ? 's' : ''}`}
      description={hosts.slice(0, 6).map((h) => h.name).join(', ') + (hosts.length > 6 ? ` +${hosts.length - 6}` : '')}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>Apply to {hosts.length} host{hosts.length > 1 ? 's' : ''}</Button></>}>
      {mode === 'roles' ? <RoleToggleCards value={roles} onChange={setRoles} /> : <AccessPicker value={access} onChange={setAccess} accounts={accounts} projects={projects} />}
      <p className="mt-3 text-xs text-muted">
        {mode === 'roles' ? 'Availability of each host stays as it is.' : 'Workload roles of each host stay as they are.'} Running workloads keep running; new placements follow the new policy.
      </p>
    </Modal>
  );
}
