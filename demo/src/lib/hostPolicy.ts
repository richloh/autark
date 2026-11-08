import { DEFAULT_HOST_ROLES, HOST_ROLES, type BareMetalHost, type HostAccess, type HostRole } from '@/types';

/* Bare-metal host policies — which workloads a host may run (roles) and who may use it (access).
 * Pure functions shared by the mock scheduler and the console, so both always agree. */

/** What a workload asks of the scheduler: the role it needs and whose it is. */
export interface WorkloadCtx { role: HostRole; accountId?: string | null; projectId?: string | null }

export const ROLE_META: Record<HostRole, { label: string; short: string; workload: string; description: string }> = {
  compute: { label: 'Compute', short: 'Compute', workload: 'VMs', description: 'VMs & managed databases' },
  storage: { label: 'Storage', short: 'Storage', workload: 'storage', description: 'Ceph OSD for volumes & buckets' },
  'k8s-worker': { label: 'Kubernetes worker', short: 'K8s worker', workload: 'Kubernetes worker nodes', description: 'Runs node pools of managed clusters' },
  'k8s-control-plane': { label: 'Kubernetes control plane', short: 'K8s control plane', workload: 'Kubernetes control planes', description: 'API server, etcd & scheduler of clusters' },
  'load-balancer': { label: 'Load balancer', short: 'Load balancer', workload: 'load balancers', description: 'L4/L7 load balancer nodes (HAProxy/Envoy)' },
};

export const OPEN_ACCESS: HostAccess = { mode: 'all', accountIds: [], projectIds: [] };

/** Effective roles of a host (absent → defaults; storage nodes without a hypervisor → storage only). */
export function hostRoles(h: Pick<BareMetalHost, 'roles' | 'hypervisor'>): HostRole[] {
  if (h.roles?.length) return HOST_ROLES.filter((r) => h.roles!.includes(r));
  return h.hypervisor === 'none' ? ['storage'] : [...DEFAULT_HOST_ROLES];
}

export function hostAccess(h: Pick<BareMetalHost, 'access'>): HostAccess {
  const a = h.access;
  if (!a || a.mode !== 'restricted') return OPEN_ACCESS;
  return { mode: 'restricted', accountIds: a.accountIds ?? [], projectIds: a.projectIds ?? [] };
}

export const isRestricted = (h: Pick<BareMetalHost, 'access'>) => hostAccess(h).mode === 'restricted';

/** A restricted host allows a workload if its account OR its project is listed. */
export function hostAllows(h: Pick<BareMetalHost, 'access'>, who: { accountId?: string | null; projectId?: string | null }): boolean {
  const a = hostAccess(h);
  if (a.mode === 'all') return true;
  return (!!who.accountId && a.accountIds.includes(who.accountId)) || (!!who.projectId && a.projectIds.includes(who.projectId));
}

/** Roles that consume CPU/RAM on the host (anything but pure storage). */
export const runsWorkloads = (h: Pick<BareMetalHost, 'roles' | 'hypervisor'>) => h.hypervisor === 'KVM' && hostRoles(h).some((r) => r !== 'storage');

export interface PolicyNames { account: (id: string) => string; project: (id: string) => string }

/** Short human list of who a restricted host is reserved for ("SAP IS/U, SAP S4"). */
export function reservedFor(h: Pick<BareMetalHost, 'access'>, names: PolicyNames, max = 3): string {
  const a = hostAccess(h);
  const all = [...a.accountIds.map(names.account), ...a.projectIds.map(names.project)];
  return all.length > max ? `${all.slice(0, max).join(', ')} +${all.length - max}` : all.join(', ');
}

/** One line: "All accounts & projects" or "Reserved for Enneo". */
export function accessSummary(h: Pick<BareMetalHost, 'access'>, names: PolicyNames): string {
  return isRestricted(h) ? `Reserved for ${reservedFor(h, names) || 'nobody'}` : 'All accounts & projects';
}

export function rolesSummary(roles: HostRole[]): string {
  return roles.map((r) => ROLE_META[r].short.toLowerCase()).join(', ') || 'none';
}

/** Why a host can't take this workload by policy (null = policy allows it). */
export function policyReason(h: Pick<BareMetalHost, 'roles' | 'hypervisor' | 'access'>, wl: WorkloadCtx, names: PolicyNames): string | null {
  const roles = hostRoles(h);
  if (!roles.includes(wl.role)) return `Not enabled for ${ROLE_META[wl.role].workload} — roles: ${rolesSummary(roles)}`;
  if (wl.role !== 'storage' && h.hypervisor !== 'KVM') return 'Storage node (no hypervisor)';
  if (!hostAllows(h, wl)) return `Reserved for ${reservedFor(h, names) || 'nobody'}`;
  return null;
}

/** Normalise/validate a policy body. Returns field errors (empty = valid). */
export function policyErrors(roles: unknown, access: unknown, exists: { account: (id: string) => boolean; project: (id: string) => boolean }): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!Array.isArray(roles) || !roles.length) errs.roles = 'Enable at least one role';
  else if (roles.some((r) => !HOST_ROLES.includes(r as HostRole))) errs.roles = `Unknown role (allowed: ${HOST_ROLES.join(', ')})`;
  const a = access as Partial<HostAccess> | undefined;
  if (a != null) {
    if (a.mode !== 'all' && a.mode !== 'restricted') errs['access.mode'] = 'Mode must be "all" or "restricted"';
    else if (a.mode === 'restricted') {
      const acc = Array.isArray(a.accountIds) ? a.accountIds : [];
      const prj = Array.isArray(a.projectIds) ? a.projectIds : [];
      if (!acc.length && !prj.length) errs.access = 'Select at least one account or project';
      const badA = acc.find((id) => !exists.account(id));
      const badP = prj.find((id) => !exists.project(id));
      if (badA) errs['access.accountIds'] = `Unknown account ${badA}`;
      if (badP) errs['access.projectIds'] = `Unknown project ${badP}`;
    }
  }
  return errs;
}

export function normaliseAccess(a: Partial<HostAccess> | undefined | null): HostAccess {
  if (!a || a.mode !== 'restricted') return { ...OPEN_ACCESS };
  return { mode: 'restricted', accountIds: [...new Set(a.accountIds ?? [])], projectIds: [...new Set(a.projectIds ?? [])] };
}
