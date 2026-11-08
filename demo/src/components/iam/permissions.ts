import type { PermAction, Role, Service } from '@/types';

/* Pure permission-model helpers shared by the mock backend (handlers/iam.ts) and the IAM pages. */

export type Action = Exclude<PermAction, '*'>;
export type Perms = Partial<Record<Service, PermAction[]>>;

export const SERVICES: Service[] = ['compute', 'storage', 'network', 'dns', 'db', 'k8s', 'objectStorage', 'loadBalancers', 'hardware', 'iam', 'billing'];
export const ACTIONS: Action[] = ['read', 'create', 'update', 'delete', 'operate'];

export const SERVICE_META: Record<Service, { label: string; short: string; color: string; noun: string }> = {
  compute: { label: 'Compute', short: 'VMs', color: '#5b67f8', noun: 'virtual machines' },
  storage: { label: 'Block storage', short: 'Volumes', color: '#0ea5e9', noun: 'volumes & snapshots' },
  network: { label: 'Networking', short: 'Network', color: '#10b981', noun: 'networks, IPs & firewalls' },
  dns: { label: 'DNS', short: 'DNS', color: '#06b6d4', noun: 'DNS zones' },
  db: { label: 'Databases', short: 'DBs', color: '#3b82f6', noun: 'managed databases' },
  k8s: { label: 'Kubernetes', short: 'K8s', color: '#326ce5', noun: 'Kubernetes clusters' },
  objectStorage: { label: 'Object storage', short: 'Buckets', color: '#eab308', noun: 'buckets' },
  loadBalancers: { label: 'Load balancers', short: 'LBs', color: '#ec4899', noun: 'load balancers' },
  hardware: { label: 'Hardware', short: 'Hardware', color: '#475569', noun: 'bare-metal hosts & providers' },
  iam: { label: 'IAM', short: 'IAM', color: '#8b5cf6', noun: 'users, roles & system accounts' },
  billing: { label: 'Billing', short: 'Billing', color: '#f59e0b', noun: 'budgets & cost reports' },
};

export const ACTION_META: Record<Action, { label: string; verb: string; hint: string }> = {
  read: { label: 'Read', verb: 'view', hint: 'List and inspect resources, metrics and logs' },
  create: { label: 'Create', verb: 'create', hint: 'Provision new resources' },
  update: { label: 'Update', verb: 'change', hint: 'Modify configuration, resize, edit rules' },
  delete: { label: 'Delete', verb: 'delete', hint: 'Permanently remove resources' },
  operate: { label: 'Operate', verb: 'operate', hint: 'Lifecycle actions: start/stop, reboot, failover, maintenance' },
};

export function isService(s: string): s is Service { return (SERVICES as string[]).includes(s) }
export function isAction(a: string): a is PermAction { return a === '*' || (ACTIONS as string[]).includes(a) }

/** true when `perms` grants `action` on `service` (wildcards honoured). */
export function has(perms: Perms | undefined, service: Service, action: Action): boolean {
  const a = perms?.[service];
  return !!a && (a.includes('*') || a.includes(action));
}

/** Expand into explicit actions (no '*'), in canonical order. */
export function expand(perms: Perms | undefined): Partial<Record<Service, Action[]>> {
  const out: Partial<Record<Service, Action[]>> = {};
  for (const s of SERVICES) {
    const acts = ACTIONS.filter((a) => has(perms, s, a));
    if (acts.length) out[s] = acts;
  }
  return out;
}

/** Normalise: collapse full rows to ['*'], drop empty services, enforce read when anything else is granted. */
export function normalize(perms: Perms): Perms {
  const out: Perms = {};
  for (const s of SERVICES) {
    let acts = ACTIONS.filter((a) => has(perms, s, a));
    if (!acts.length) continue;
    if (!acts.includes('read')) acts = ['read', ...acts];
    out[s] = acts.length === ACTIONS.length ? ['*'] : acts;
  }
  return out;
}

export function countPermissions(perms: Perms | undefined): number {
  return SERVICES.reduce((n, s) => n + ACTIONS.filter((a) => has(perms, s, a)).length, 0);
}
export const MAX_PERMISSIONS = SERVICES.length * ACTIONS.length;

export function toggle(perms: Perms, service: Service, action: Action): Perms {
  const cur = ACTIONS.filter((a) => has(perms, service, a));
  let next = cur.includes(action) ? cur.filter((a) => a !== action) : [...cur, action];
  // removing read removes everything (can't change what you can't see); adding anything implies read
  if (action === 'read' && cur.includes('read')) next = [];
  if (action !== 'read' && !cur.includes(action) && !next.includes('read')) next = ['read', ...next];
  return { ...perms, [service]: next };
}

export function setRow(perms: Perms, service: Service, on: boolean): Perms {
  return { ...perms, [service]: on ? ['*'] : [] };
}

export function setColumn(perms: Perms, action: Action, on: boolean): Perms {
  let next: Perms = { ...perms };
  for (const s of SERVICES) {
    const isOn = has(next, s, action);
    if (isOn !== on) next = toggle(next, s, action);
  }
  return next;
}

/** Effective permissions = union of the given roles; for each cell which roles grant it. */
export function grantsFor(roles: Pick<Role, 'id' | 'permissions'>[]): Partial<Record<Service, Partial<Record<Action, string[]>>>> {
  const out: Partial<Record<Service, Partial<Record<Action, string[]>>>> = {};
  for (const s of SERVICES) {
    for (const a of ACTIONS) {
      const by = roles.filter((r) => has(r.permissions, s, a)).map((r) => r.id);
      if (by.length) (out[s] ??= {})[a] = by;
    }
  }
  return out;
}

export function unionPerms(roles: Pick<Role, 'permissions'>[]): Perms {
  const out: Perms = {};
  for (const s of SERVICES) {
    const acts = ACTIONS.filter((a) => roles.some((r) => has(r.permissions, s, a)));
    if (acts.length) out[s] = acts;
  }
  return out;
}

/* ------------------------------------------------------------------ plain-language summary */

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Human readable sentences describing what a permission set allows. */
export function describe(perms: Perms | undefined): string[] {
  const e = expand(perms);
  const services = Object.keys(e) as Service[];
  if (!services.length) return ['This role grants no access.'];
  if (countPermissions(perms) === MAX_PERMISSIONS) return ['Full control over every service, including IAM and billing.'];
  const full = services.filter((s) => e[s]!.length === ACTIONS.length);
  const readOnly = services.filter((s) => e[s]!.length === 1 && e[s]![0] === 'read');
  const partial = services.filter((s) => !full.includes(s) && !readOnly.includes(s));
  const out: string[] = [];
  if (full.length) out.push(`Full control of ${list(full.map((s) => SERVICE_META[s].noun))}.`);
  for (const s of partial) {
    const verbs = e[s]!.filter((a) => a !== 'read').map((a) => ACTION_META[a].verb);
    out.push(`Can ${list(['view', ...verbs])} ${SERVICE_META[s].noun}.`);
  }
  if (readOnly.length) out.push(readOnly.length === SERVICES.length ? 'Read-only access to everything.' : `Read-only access to ${list(readOnly.map((s) => SERVICE_META[s].noun))}.`);
  const none = SERVICES.filter((s) => !e[s]);
  if (none.length && none.length < SERVICES.length) out.push(`No access to ${list(none.map((s) => SERVICE_META[s].label))}.`);
  return out;
}

/* ------------------------------------------------------------------ blast radius */

export interface Risk { level: 'high' | 'medium'; service: Service; action: Action; text: string }

const RISKS: { service: Service | '*'; action: Action; level: Risk['level']; text: (s: Service) => string }[] = [
  { service: 'hardware', action: 'delete', level: 'high', text: () => 'Can decommission bare-metal hosts and disconnect cloud providers — every workload on them is affected.' },
  { service: 'hardware', action: 'operate', level: 'high', text: () => 'Can put hosts into maintenance, power-cycle and evacuate them.' },
  { service: 'iam', action: 'update', level: 'high', text: () => 'Can change roles and memberships — effectively able to grant itself any permission (privilege escalation).' },
  { service: 'iam', action: 'create', level: 'high', text: () => 'Can create users, roles and API tokens.' },
  { service: 'iam', action: 'delete', level: 'medium', text: () => 'Can remove users and revoke credentials of others.' },
  { service: 'billing', action: 'update', level: 'medium', text: () => 'Can raise budgets and quotas, disabling cost guardrails.' },
  { service: 'network', action: 'update', level: 'medium', text: () => 'Can change firewall rules and expose services to the internet.' },
  { service: 'network', action: 'delete', level: 'high', text: () => 'Can delete networks and release public IPs — causes outages for attached resources.' },
  { service: 'db', action: 'delete', level: 'high', text: () => 'Can delete databases including their backups.' },
  { service: 'storage', action: 'delete', level: 'high', text: () => 'Can delete volumes and snapshots — data loss is irreversible.' },
  { service: 'objectStorage', action: 'delete', level: 'high', text: () => 'Can delete buckets and their objects.' },
  { service: 'compute', action: 'delete', level: 'medium', text: () => 'Can delete virtual machines.' },
  { service: 'k8s', action: 'delete', level: 'medium', text: () => 'Can delete Kubernetes clusters and all workloads in them.' },
];

export function blastRadius(perms: Perms | undefined): Risk[] {
  const out: Risk[] = [];
  for (const r of RISKS) {
    const services = r.service === '*' ? SERVICES : [r.service];
    for (const s of services) if (has(perms, s, r.action)) out.push({ level: r.level, service: s, action: r.action, text: r.text(s) });
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'high' ? -1 : 1));
}

/** Rough 0..100 risk score for visual "blast radius" meters. */
export function riskScore(perms: Perms | undefined): number {
  const r = blastRadius(perms);
  const base = (countPermissions(perms) / MAX_PERMISSIONS) * 40;
  return Math.min(100, Math.round(base + r.reduce((a, x) => a + (x.level === 'high' ? 9 : 4), 0)));
}

/* ------------------------------------------------------------------ presets */

export const PRESETS: { id: string; label: string; description: string; perms: () => Perms }[] = [
  { id: 'readonly', label: 'Read-only everything', description: 'View all resources, no changes', perms: () => Object.fromEntries(SERVICES.map((s) => [s, ['read']])) },
  { id: 'developer', label: 'Workload developer', description: 'Build & run apps, no network/hardware changes', perms: () => ({ compute: ['read', 'create', 'update', 'operate'], storage: ['read', 'create', 'update'], db: ['read', 'create', 'update', 'operate'], k8s: ['read', 'create', 'update', 'operate'], objectStorage: ['read', 'create', 'update'], network: ['read'], dns: ['read'], loadBalancers: ['read'] }) },
  { id: 'network', label: 'Network admin', description: 'Networks, firewalls, DNS & load balancers', perms: () => ({ network: ['*'], dns: ['*'], loadBalancers: ['*'], compute: ['read'], k8s: ['read'] }) },
  { id: 'infra', label: 'All infrastructure', description: 'Everything except IAM & billing', perms: () => Object.fromEntries(SERVICES.filter((s) => s !== 'iam' && s !== 'billing').map((s) => [s, ['*']])) },
  { id: 'finops', label: 'FinOps', description: 'Budgets & costs, read infrastructure', perms: () => ({ ...Object.fromEntries(SERVICES.map((s) => [s, ['read']])), billing: ['*'] }) },
  { id: 'none', label: 'Clear all', description: 'Start from scratch', perms: () => ({}) },
];
