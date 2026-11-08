import { db } from '../db';
import {
  defineCollection, route, ApiError, validate, nameError, newId, nowIso, getOr404, audit, notify, currentUser, conflict, DAY, HOUR, type Ctx,
} from '../framework';
import { projectUsage } from './shared';
import { allCostItems } from './costs';
import { isValidCidr, parseCidr, isValidIp, intToIp } from '@/lib/cidr';
import { randomHex, randomToken, noise } from '@/lib/random';
import { ACTIONS, isService, isAction, normalize, countPermissions, grantsFor, has, type Perms, type Action } from '@/components/iam/permissions';
import type { User, Role, SystemAccount, ProjectAllowance, ApiToken, TokenSecret, Project, Location, Tag, Service, QuotaKey, EffectivePermissions, UserSession } from '@/types';

/* Identity & access management: users, roles, system accounts (machine identities with API tokens)
 * and project allowances (budgets, quotas, policy). Every write is audited by the framework. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const QUOTA_KEYS: QuotaKey[] = ['vcpus', 'ramGB', 'vms', 'volumesGB', 'dbInstances', 'k8sClusters', 'buckets', 'publicIps'];
const ALLOWANCE_SERVICES: Service[] = ['compute', 'storage', 'network', 'dns', 'db', 'k8s', 'objectStorage', 'loadBalancers'];

/* ---------------------------------------------------------------- shared validation */

function rolesError(roleIds: unknown, required = true): string | null {
  if (!Array.isArray(roleIds)) return 'Roles must be a list';
  if (required && !roleIds.length) return 'Assign at least one role';
  const unknown = roleIds.filter((id) => !db.get('roles', id));
  return unknown.length ? `Unknown role ${unknown.join(', ')}` : null;
}

function projectsError(projectIds: unknown): string | null {
  if (projectIds === '*') return null;
  if (!Array.isArray(projectIds)) return 'Projects must be "*" or a list';
  if (!projectIds.length) return 'Grant access to at least one project (or all projects)';
  const unknown = projectIds.filter((id) => !db.get('projects', id));
  return unknown.length ? `Unknown project ${unknown.join(', ')}` : null;
}

function tagsError(tags: unknown): string | null {
  if (!Array.isArray(tags)) return 'Tags must be a list';
  for (const t of tags as Tag[]) {
    if (!t?.key?.trim()) return 'Tag keys cannot be empty';
    if (!/^[a-zA-Z0-9_.:/-]{1,63}$/.test(t.key)) return `Invalid tag key "${t.key}"`;
  }
  return null;
}

/** Accepts "10.0.0.0/24" or a bare IPv4 (→ /32). Returns normalised list or throws 422 naming the bad entry. */
function normalizeAllowlist(list: unknown): string[] {
  if (!Array.isArray(list)) throw new ApiError(422, 'IP allowlist must be a list', 'validation_failed', { ipAllowlist: 'Must be a list of CIDRs' });
  const out: string[] = [];
  for (const raw of list as string[]) {
    const v = String(raw ?? '').trim();
    if (!v) continue;
    const cidr = v.includes('/') ? v : isValidIp(v) ? `${v}/32` : v;
    if (!isValidCidr(cidr)) {
      const p = parseCidr(cidr);
      const msg = p ? `${v} has host bits set — did you mean ${intToIp(p.network)}/${p.prefix}?` : `${v} is not a valid IPv4 address or CIDR`;
      throw new ApiError(422, msg, 'validation_failed', { ipAllowlist: msg });
    }
    if (cidr === '0.0.0.0/0') throw new ApiError(422, '0.0.0.0/0 allows every address — leave the allowlist empty instead', 'validation_failed', { ipAllowlist: '0.0.0.0/0 is not allowed' });
    if (!out.includes(cidr)) out.push(cidr);
  }
  if (out.length > 32) throw new ApiError(422, 'At most 32 allowlist entries', 'validation_failed', { ipAllowlist: 'Too many entries' });
  return out;
}

function validatePerms(perms: unknown): Perms {
  if (!perms || typeof perms !== 'object') throw new ApiError(422, 'Permissions are required', 'validation_failed', { permissions: 'Required' });
  for (const [s, acts] of Object.entries(perms as Record<string, unknown>)) {
    if (!isService(s)) throw new ApiError(422, `Unknown service "${s}"`, 'validation_failed', { permissions: `Unknown service ${s}` });
    if (!Array.isArray(acts) || acts.some((a) => !isAction(String(a)))) throw new ApiError(422, `Invalid actions for ${s}`, 'validation_failed', { permissions: `Invalid actions for ${s}` });
  }
  const n = normalize(perms as Perms);
  if (!countPermissions(n)) throw new ApiError(422, 'Grant at least one permission', 'validation_failed', { permissions: 'Grant at least one permission' });
  return n;
}

/* ---------------------------------------------------------------- tokens */

function newToken(name: string, expiresInDays: number | null): TokenSecret {
  const prefix = `atk_live_${randomHex(4)}`;
  const secret = `${prefix}_${randomToken(40)}`;
  const token: ApiToken = {
    id: newId('tok'), name, prefix, createdAt: nowIso(), expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * DAY).toISOString() : null,
    lastUsed: null, status: 'active', revokedAt: null, rotatedTo: null,
  };
  return { token, secret };
}

function tokenBody(body: any, existing: ApiToken[]): { name: string; days: number | null } {
  const name = String(body?.name ?? '').trim();
  const days = body?.expiresInDays == null || body.expiresInDays === 0 ? null : Number(body.expiresInDays);
  validate({
    name: !name ? 'Token name is required' : name.length > 48 ? 'Max 48 characters' : existing.some((t) => t.name === name && t.status === 'active') && `An active token named "${name}" already exists`,
    expiresInDays: days != null && !(Number.isInteger(days) && days >= 1 && days <= 730) && 'Expiry must be 1–730 days (or never)',
  });
  return { name, days };
}

/** Status computed on read: active tokens past expiry are expired. */
function liveTokens(tokens: ApiToken[] | undefined): ApiToken[] {
  const now = Date.now();
  return (tokens ?? []).map((t) => (t.status === 'active' && t.expiresAt && Date.parse(t.expiresAt) < now ? { ...t, status: 'expired' as const } : t));
}

function findToken(tokens: ApiToken[] | undefined, id: unknown): ApiToken {
  const t = (tokens ?? []).find((x) => x.id === id);
  if (!t) throw new ApiError(404, `Token ${String(id)} not found`, 'not_found');
  return t;
}

/* ---------------------------------------------------------------- users */

const isAdmin = (u: User) => u.roleIds.includes('role-admin');
function activeAdmins(exceptId?: string) {
  return db.filter<User>('users', (u) => u.id !== exceptId && u.status === 'active' && isAdmin(u));
}
function guardLastAdmin(u: User, verb: string) {
  if (isAdmin(u) && u.status === 'active' && activeAdmins(u.id).length === 0) {
    throw conflict(`Cannot ${verb} ${u.name}: they are the last active administrator. Promote someone else first.`);
  }
}
function guardSelf(u: User, verb: string) {
  if (u.id === currentUser()?.id) throw conflict(`You cannot ${verb} your own account.`);
}

function nameFromEmail(email: string) {
  return email.split('@')[0].split(/[._-]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join(' ');
}

function inviteUser(ctx: Ctx, body: any): User {
  const email = String(body.email ?? '').trim().toLowerCase();
  const roleIds = body.roleIds ?? [];
  const projectIds = body.projectIds ?? [];
  validate({
    email: !email ? 'Email is required' : !EMAIL_RE.test(email) ? 'Enter a valid email address' : db.find<User>('users', (u) => u.email.toLowerCase() === email) && `${email} is already a member`,
    name: body.name && String(body.name).length > 80 && 'Name is too long',
    roleIds: rolesError(roleIds),
    projectIds: projectsError(projectIds),
  });
  return {
    id: newId('user'), name: String(body.name ?? '').trim() || nameFromEmail(email), email, roleIds, projectIds,
    mfa: false, mfaMethod: null, mfaRequired: !!body.mfaRequired, status: 'invited', lastLogin: null, createdAt: nowIso(),
    sso: !!body.sso, tags: body.tags ?? [], title: body.title ?? '', invitedAt: nowIso(), invitedBy: ctx.actor,
    inviteExpiresAt: new Date(Date.now() + 7 * DAY).toISOString(), sessions: [], apiTokens: [],
  };
}

function updateUser(_ctx: Ctx, u: User, patch: any): User {
  const next: User = { ...u };
  if ('name' in patch) { validate({ name: !String(patch.name ?? '').trim() ? 'Name is required' : String(patch.name).length > 80 && 'Name is too long' }); next.name = String(patch.name).trim() }
  if ('title' in patch) next.title = String(patch.title ?? '').slice(0, 80);
  if ('roleIds' in patch) {
    validate({ roleIds: rolesError(patch.roleIds) });
    if (isAdmin(u) && !patch.roleIds.includes('role-admin')) guardLastAdmin(u, 'remove the Administrator role from');
    next.roleIds = patch.roleIds;
  }
  if ('projectIds' in patch) { validate({ projectIds: projectsError(patch.projectIds) }); next.projectIds = patch.projectIds }
  if ('tags' in patch) { validate({ tags: tagsError(patch.tags) }); next.tags = patch.tags }
  if ('sso' in patch) next.sso = !!patch.sso;
  if ('mfaRequired' in patch) next.mfaRequired = !!patch.mfaRequired;
  return next;
}

function sessionDevice(kind: UserSession['kind']) { return kind === 'cli' ? 'autark CLI 1.8 · Linux' : kind === 'mobile' ? 'iPhone · Safari' : 'Chrome 131 · macOS' }

/* ---------------------------------------------------------------- allowances */

function monthInfo() {
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayFraction = (now.getHours() * 60 + now.getMinutes()) / 1440;
  return { dayOfMonth, daysInMonth, dayFraction };
}

/** Synthesize per-day spend for this month from the run-rate: older days a bit cheaper (growth) + deterministic wobble. */
function dailySpend(projectId: string, monthly: number): number[] {
  const { dayOfMonth, daysInMonth, dayFraction } = monthInfo();
  return Array.from({ length: dayOfMonth }, (_, i) => {
    const daysAgo = dayOfMonth - 1 - i;
    const growth = 1 - Math.min(0.25, daysAgo * 0.006);
    const wobble = 0.86 + noise(projectId, i / 2.5) * 0.28;
    const share = i === dayOfMonth - 1 ? Math.max(0.05, dayFraction) : 1;
    return Math.round((monthly / daysInMonth) * growth * wobble * share * 100) / 100;
  });
}

function decorateAllowance(a: ProjectAllowance): ProjectAllowance {
  const items = allCostItems().filter((i) => i.projectId === a.projectId);
  const monthly = Math.round(items.reduce((s, i) => s + i.monthly, 0) * 100) / 100;
  const byService = new Map<string, number>();
  for (const i of items) byService.set(i.service, (byService.get(i.service) ?? 0) + i.monthly);
  const { dayOfMonth, daysInMonth, dayFraction } = monthInfo();
  const daily = dailySpend(a.projectId, monthly);
  const mtd = Math.round(daily.reduce((s, v) => s + v, 0) * 100) / 100;
  const remaining = daysInMonth - dayOfMonth + (1 - dayFraction);
  const forecast = Math.round((mtd + (monthly / daysInMonth) * remaining) * 100) / 100;
  const members = db.filter<User>('users', (u) => u.status !== 'disabled' && (u.projectIds === '*' || u.projectIds.includes(a.projectId))).length;
  return {
    ...a,
    usage: projectUsage(a.projectId),
    monthlySpend: monthly, mtdSpend: mtd, forecastSpend: forecast, dayOfMonth, daysInMonth, dailySpend: daily,
    spendByService: [...byService].map(([service, m]) => ({ service, monthly: Math.round(m * 100) / 100 })).sort((x, y) => y.monthly - x.monthly),
    resourceCount: items.length, members,
  };
}

function updateAllowance(_ctx: Ctx, a: ProjectAllowance, patch: any): ProjectAllowance {
  const next: ProjectAllowance = { ...a, quotas: { ...a.quotas } };
  const usage = projectUsage(a.projectId);
  if ('budgetMonthly' in patch) {
    const b = Number(patch.budgetMonthly);
    validate({ budgetMonthly: !(Number.isFinite(b) && b >= 0 && b <= 10_000_000) && 'Budget must be between 0 and 10,000,000' });
    next.budgetMonthly = Math.round(b * 100) / 100;
  }
  if ('alertThresholds' in patch) {
    const t = patch.alertThresholds;
    validate({ alertThresholds: !Array.isArray(t) ? 'Thresholds must be a list' : t.some((x: unknown) => !(Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 200)) ? 'Each threshold must be a whole percentage between 1 and 200' : t.length > 6 && 'At most 6 thresholds' });
    next.alertThresholds = [...new Set<number>(t)].sort((x, y) => x - y);
  }
  if ('hardLimit' in patch) next.hardLimit = !!patch.hardLimit;
  if ('quotas' in patch) {
    const errs: Record<string, string | false> = {};
    for (const [k, v] of Object.entries(patch.quotas ?? {})) {
      if (!QUOTA_KEYS.includes(k as QuotaKey)) { errs[k] = `Unknown quota ${k}`; continue }
      const n = Number(v);
      if (!(Number.isInteger(n) && n >= 0 && n <= 1_000_000)) errs[k] = 'Must be a whole number ≥ 0';
      else if (n < usage[k as QuotaKey]) errs[k] = `Cannot be below current usage (${usage[k as QuotaKey]})`;
      else next.quotas[k as QuotaKey] = n;
    }
    validate(errs);
  }
  if ('allowedServices' in patch) {
    const s = patch.allowedServices;
    validate({ allowedServices: !Array.isArray(s) ? 'Must be a list' : s.some((x: string) => !ALLOWANCE_SERVICES.includes(x as Service)) ? 'Unknown service' : !s.length && 'Allow at least one service' });
    next.allowedServices = ALLOWANCE_SERVICES.filter((x) => s.includes(x));
  }
  if ('allowedLocations' in patch) {
    const l = patch.allowedLocations;
    const unknown = Array.isArray(l) ? l.filter((id: string) => !db.get<Location>('locations', id)) : [];
    validate({ allowedLocations: !Array.isArray(l) ? 'Must be a list' : unknown.length ? `Unknown location ${unknown.join(', ')}` : !l.length && 'Allow at least one location' });
    next.allowedLocations = l;
  }
  if ('requiredTags' in patch) {
    const r = patch.requiredTags;
    validate({ requiredTags: !Array.isArray(r) ? 'Must be a list' : r.some((k: string) => !/^[a-zA-Z0-9_.:/-]{1,63}$/.test(k)) && 'Tag keys may contain letters, digits and _ . : / -' });
    next.requiredTags = [...new Set<string>(r)];
  }
  if ('tags' in patch) { validate({ tags: tagsError(patch.tags) }); next.tags = patch.tags }
  // project metadata lives on the project row; keep both in sync
  const projPatch: Partial<Project> = {};
  if ('name' in patch) {
    const n = String(patch.name ?? '').trim();
    validate({ name: !n ? 'Name is required' : n.length > 60 ? 'Max 60 characters' : db.find<Project>('projects', (p) => p.id !== a.projectId && p.accountId === a.accountId && p.name.toLowerCase() === n.toLowerCase()) && `A project named "${n}" already exists` });
    next.name = n; projPatch.name = n;
  }
  if ('description' in patch) projPatch.description = String(patch.description ?? '').slice(0, 200);
  if ('color' in patch) { validate({ color: !/^#[0-9a-f]{6}$/i.test(String(patch.color)) && 'Color must be a hex value like #5b67f8' }); projPatch.color = patch.color }
  if (Object.keys(projPatch).length && db.get('projects', a.projectId)) db.update('projects', a.projectId, projPatch as any);

  // budget alerting: warn immediately when the new settings put the forecast over a threshold
  if ('budgetMonthly' in patch || 'alertThresholds' in patch) {
    const d = decorateAllowance(next);
    const pctNow = next.budgetMonthly > 0 ? ((d.forecastSpend ?? 0) / next.budgetMonthly) * 100 : 0;
    const crossed = next.alertThresholds.filter((t) => pctNow >= t).pop();
    if (crossed) notify(crossed >= 100 ? 'error' : 'warning', `Budget ${crossed}% forecast`, `${next.name} is forecast to reach ${Math.round(pctNow)}% of its €${next.budgetMonthly} budget this month.`, `/iam/project-allowances/${a.id}`, a.accountId);
  }
  return next;
}

/* ---------------------------------------------------------------- effective permissions */

function effectiveFor(subject: { type: 'user' | 'systemAccount'; id: string; name: string }, roleIds: string[], projectIds: string[] | '*'): EffectivePermissions {
  const roles = roleIds.map((id) => db.get<Role>('roles', id)).filter(Boolean) as Role[];
  return {
    subject,
    roles: roles.map((r) => ({ id: r.id, name: r.name, system: r.system })),
    projectIds,
    grants: grantsFor(roles),
  };
}

/* ---------------------------------------------------------------- registration */

export function registerIam() {
  /* ------------------------------ users */
  defineCollection<User>({
    name: 'users', kind: 'user', idPrefix: 'user', scoped: false,
    searchText: (u) => `${u.id} ${u.name} ${u.email} ${u.status} ${u.title ?? ''} ${u.roleIds.join(' ')}`,
    subtitle: (u) => `User · ${u.email} · ${u.status}`,
    sort: (a, b) => a.name.localeCompare(b.name),
    decorate: (u) => ({ ...u, sessions: u.sessions ?? [], apiTokens: liveTokens(u.apiTokens) }),
    create: inviteUser,
    afterCreate: (ctx, u) => {
      notify('info', 'Invitation sent', `${u.email} was invited by ${ctx.actor}. The link expires in 7 days.`, `/iam/users/${u.id}`);
    },
    update: updateUser,
    remove: (_ctx, u) => {
      guardSelf(u, 'delete');
      guardLastAdmin(u, 'delete');
    },
    actions: {
      resendInvite: (_ctx, u) => {
        if (u.status !== 'invited') throw conflict(`${u.email} has already accepted the invitation`);
        db.update('users', u.id, { invitedAt: nowIso(), inviteExpiresAt: new Date(Date.now() + 7 * DAY).toISOString() } as any);
      },
      disable: (_ctx, u) => {
        if (u.status === 'disabled') throw conflict(`${u.name} is already disabled`);
        guardSelf(u, 'disable');
        guardLastAdmin(u, 'disable');
        // disabling signs the user out everywhere and suspends their personal tokens
        db.update('users', u.id, { status: 'disabled', disabledAt: nowIso(), sessions: [] } as any);
      },
      enable: (_ctx, u) => {
        if (u.status !== 'disabled') throw conflict(`${u.name} is not disabled`);
        db.update('users', u.id, { status: u.lastLogin ? 'active' : 'invited', disabledAt: null } as any);
      },
      resetMfa: (_ctx, u) => {
        if (u.sso) throw conflict(`${u.name} signs in via SSO — MFA is managed by your identity provider`);
        if (!u.mfa) throw conflict(`${u.name} has no MFA device enrolled`);
        db.update('users', u.id, { mfa: false, mfaMethod: null } as any);
      },
      requireMfa: (_ctx, u, body) => {
        db.update('users', u.id, { mfaRequired: body?.required !== false } as any);
      },
      revokeSession: (_ctx, u, body) => {
        const s = (u.sessions ?? []).find((x) => x.id === body?.sessionId);
        if (!s) throw new ApiError(404, 'Session not found', 'not_found');
        if (s.current) throw conflict('This is your current session — sign out instead');
        db.update('users', u.id, { sessions: (u.sessions ?? []).filter((x) => x.id !== s.id) } as any);
      },
      revokeAllSessions: (_ctx, u) => {
        const kept = (u.sessions ?? []).filter((s) => s.current);
        db.update('users', u.id, { sessions: kept } as any);
        return { revoked: (u.sessions ?? []).length - kept.length };
      },
      createToken: (_ctx, u, body): TokenSecret => {
        if (u.status !== 'active') throw conflict(`Only active users can own API tokens (${u.name} is ${u.status})`);
        const { name, days } = tokenBody(body, u.apiTokens ?? []);
        const res = newToken(name, days);
        db.update('users', u.id, { apiTokens: [res.token, ...(u.apiTokens ?? [])] } as any);
        return res;
      },
      revokeToken: (_ctx, u, body) => {
        const t = findToken(u.apiTokens, body?.tokenId);
        if (t.status === 'revoked') throw conflict('Token is already revoked');
        db.update('users', u.id, { apiTokens: (u.apiTokens ?? []).map((x) => (x.id === t.id ? { ...x, status: 'revoked', revokedAt: nowIso() } : x)) } as any);
      },
      /** demo helper: simulate a login so sessions appear */
      simulateLogin: (_ctx, u, body) => {
        if (u.status === 'disabled') throw conflict('Disabled users cannot sign in');
        const kind: UserSession['kind'] = body?.kind ?? 'browser';
        const s: UserSession = { id: newId('sess'), device: sessionDevice(kind), kind, ip: '192.0.2.' + Math.floor(10 + Math.random() * 200), location: 'Berlin, DE', createdAt: nowIso(), lastActive: nowIso() };
        db.update('users', u.id, { status: 'active', lastLogin: nowIso(), sessions: [s, ...(u.sessions ?? [])], invitedAt: u.invitedAt, inviteExpiresAt: null } as any);
      },
    },
  });

  /* ------------------------------ roles */
  defineCollection<Role>({
    name: 'roles', kind: 'role', idPrefix: 'role', scoped: false,
    searchText: (r) => `${r.id} ${r.name} ${r.description} ${r.system ? 'system' : 'custom'}`,
    subtitle: (r) => `Role · ${r.system ? 'system' : 'custom'} · ${countPermissions(r.permissions)} permissions`,
    sort: (a, b) => (a.system === b.system ? a.name.localeCompare(b.name) : a.system ? -1 : 1),
    decorate: (r) => ({
      ...r,
      userCount: db.filter<User>('users', (u) => u.roleIds.includes(r.id)).length,
      systemAccountCount: db.filter<SystemAccount>('systemAccounts', (s) => s.roleIds.includes(r.id)).length,
    }),
    create: (_ctx, body) => {
      const name = String(body.name ?? '').trim();
      validate({
        name: !name ? 'Name is required' : name.length > 48 ? 'Max 48 characters' : db.find<Role>('roles', (r) => r.name.toLowerCase() === name.toLowerCase()) && `A role named "${name}" already exists`,
        description: String(body.description ?? '').length > 240 && 'Max 240 characters',
      });
      const permissions = validatePerms(body.permissions);
      return { id: newId('role'), name, description: String(body.description ?? '').trim(), system: false, permissions, createdAt: nowIso(), tags: body.tags ?? [], clonedFrom: body.clonedFrom ?? null };
    },
    update: (_ctx, r, patch) => {
      if (r.system) throw new ApiError(403, `${r.name} is a system role and cannot be modified. Clone it to create a customizable copy.`, 'forbidden');
      const next: Role = { ...r, updatedAt: nowIso() };
      if ('name' in patch) {
        const name = String(patch.name ?? '').trim();
        validate({ name: !name ? 'Name is required' : name.length > 48 ? 'Max 48 characters' : db.find<Role>('roles', (x) => x.id !== r.id && x.name.toLowerCase() === name.toLowerCase()) && `A role named "${name}" already exists` });
        next.name = name;
      }
      if ('description' in patch) next.description = String(patch.description ?? '').slice(0, 240);
      if ('permissions' in patch) next.permissions = validatePerms(patch.permissions);
      if ('tags' in patch) { validate({ tags: tagsError(patch.tags) }); next.tags = patch.tags }
      return next;
    },
    remove: (_ctx, r) => {
      if (r.system) throw new ApiError(403, `${r.name} is a system role and cannot be deleted`, 'forbidden');
      const users = db.filter<User>('users', (u) => u.roleIds.includes(r.id));
      const svcs = db.filter<SystemAccount>('systemAccounts', (s) => s.roleIds.includes(r.id));
      if (users.length || svcs.length) {
        const who = [...users.map((u) => u.email), ...svcs.map((s) => `svc:${s.name}`)];
        throw new ApiError(409, `${r.name} is still assigned to ${who.length} identit${who.length === 1 ? 'y' : 'ies'}: ${who.slice(0, 5).join(', ')}${who.length > 5 ? ` and ${who.length - 5} more` : ''}. Unassign it first.`, 'in_use', { assignedTo: who.join(', ') });
      }
    },
    actions: {
      clone: (ctx, r, body) => {
        let name = String(body?.name ?? '').trim() || `${r.name} (custom)`;
        if (db.find<Role>('roles', (x) => x.name.toLowerCase() === name.toLowerCase())) {
          if (body?.name) throw new ApiError(422, `A role named "${name}" already exists`, 'validation_failed', { name: 'Already exists' });
          let i = 2; while (db.find<Role>('roles', (x) => x.name === `${name} ${i}`)) i++; name = `${name} ${i}`;
        }
        const copy: Role = { id: newId('role'), name, description: body?.description ?? r.description, system: false, permissions: structuredClone(r.permissions), createdAt: nowIso(), tags: [], clonedFrom: r.id };
        db.insert('roles', copy as any);
        audit(ctx, 'role.create', { type: 'role', id: copy.id, name: copy.name }, { details: `cloned from ${r.name}` });
        return copy;
      },
    },
  });

  /* ------------------------------ system accounts */
  defineCollection<SystemAccount>({
    name: 'systemAccounts', kind: 'systemAccount', idPrefix: 'svc', scoped: false,
    searchText: (s) => `${s.id} ${s.name} ${s.description} ${s.tokens.map((t) => `${t.name} ${t.prefix}`).join(' ')}`,
    subtitle: (s) => `System account · ${s.tokens.filter((t) => t.status === 'active').length} active tokens`,
    sort: (a, b) => a.name.localeCompare(b.name),
    decorate: (s) => ({ ...s, status: s.status ?? 'active', tokens: liveTokens(s.tokens) }),
    create: (_ctx, body) => {
      const name = String(body.name ?? '').trim();
      validate({
        name: nameError(name) || (db.find<SystemAccount>('systemAccounts', (s) => s.name === name) && `A system account named "${name}" already exists`),
        description: String(body.description ?? '').length > 240 && 'Max 240 characters',
        roleIds: rolesError(body.roleIds ?? []),
        projectIds: projectsError(body.projectIds ?? []),
        tagConditions: tagsError(body.tagConditions ?? []),
      });
      return {
        id: newId('svc'), name, description: String(body.description ?? '').trim(), roleIds: body.roleIds, projectIds: body.projectIds,
        tokens: [], ipAllowlist: normalizeAllowlist(body.ipAllowlist ?? []), tagConditions: body.tagConditions ?? [], createdAt: nowIso(), lastUsed: null, tags: body.tags ?? [], status: 'active',
      };
    },
    update: (_ctx, s, patch) => {
      const next: SystemAccount = { ...s };
      if ('name' in patch) {
        validate({ name: nameError(patch.name) || (db.find<SystemAccount>('systemAccounts', (x) => x.id !== s.id && x.name === patch.name) && `A system account named "${patch.name}" already exists`) });
        next.name = patch.name;
      }
      if ('description' in patch) next.description = String(patch.description ?? '').slice(0, 240);
      if ('roleIds' in patch) { validate({ roleIds: rolesError(patch.roleIds) }); next.roleIds = patch.roleIds }
      if ('projectIds' in patch) { validate({ projectIds: projectsError(patch.projectIds) }); next.projectIds = patch.projectIds }
      if ('ipAllowlist' in patch) next.ipAllowlist = normalizeAllowlist(patch.ipAllowlist);
      if ('tagConditions' in patch) { validate({ tagConditions: tagsError(patch.tagConditions) }); next.tagConditions = patch.tagConditions }
      if ('tags' in patch) { validate({ tags: tagsError(patch.tags) }); next.tags = patch.tags }
      return next;
    },
    actions: {
      createToken: (_ctx, s, body): TokenSecret => {
        if (s.status === 'disabled') throw conflict(`${s.name} is disabled — enable it before issuing tokens`);
        const live = liveTokens(s.tokens);
        if (live.filter((t) => t.status === 'active').length >= 10) throw conflict('A system account can have at most 10 active tokens. Revoke unused ones first.');
        const { name, days } = tokenBody(body, live);
        const res = newToken(name, days);
        db.update('systemAccounts', s.id, { tokens: [res.token, ...s.tokens] } as any);
        return res;
      },
      rotateToken: (_ctx, s, body): TokenSecret => {
        const old = findToken(liveTokens(s.tokens), body?.tokenId);
        if (old.status !== 'active') throw conflict(`Only active tokens can be rotated (${old.name} is ${old.status})`);
        const overlapH = Math.min(168, Math.max(0, Number(body?.overlapHours ?? 24)));
        const lifetime = old.expiresAt ? Math.max(1, Math.round((Date.parse(old.expiresAt) - Date.parse(old.createdAt)) / DAY)) : null;
        const res = newToken(old.name, lifetime);
        const graceEnd = new Date(Date.now() + overlapH * HOUR).toISOString();
        const tokens = s.tokens.map((t) => (t.id === old.id
          ? { ...t, rotatedTo: res.token.id, expiresAt: overlapH === 0 ? nowIso() : t.expiresAt && t.expiresAt < graceEnd ? t.expiresAt : graceEnd, ...(overlapH === 0 ? { status: 'revoked' as const, revokedAt: nowIso() } : {}) }
          : t));
        db.update('systemAccounts', s.id, { tokens: [res.token, ...tokens] } as any);
        return res;
      },
      revokeToken: (_ctx, s, body) => {
        const t = findToken(s.tokens, body?.tokenId);
        if (t.status === 'revoked') throw conflict('Token is already revoked');
        db.update('systemAccounts', s.id, { tokens: s.tokens.map((x) => (x.id === t.id ? { ...x, status: 'revoked', revokedAt: nowIso() } : x)) } as any);
      },
      disable: (_ctx, s) => {
        if (s.status === 'disabled') throw conflict(`${s.name} is already disabled`);
        db.update('systemAccounts', s.id, { status: 'disabled' } as any);
      },
      enable: (_ctx, s) => {
        if ((s.status ?? 'active') === 'active') throw conflict(`${s.name} is already active`);
        db.update('systemAccounts', s.id, { status: 'active' } as any);
      },
    },
  });

  /* ------------------------------ project allowances */
  defineCollection<ProjectAllowance>({
    name: 'allowances', kind: 'allowance', idPrefix: 'allow', accountScopedOnly: true,
    searchText: (a) => `${a.id} ${a.name} ${a.projectId}`,
    subtitle: (a) => `Project · budget €${a.budgetMonthly}/mo`,
    sort: (a, b) => a.name.localeCompare(b.name),
    decorate: decorateAllowance,
    update: updateAllowance,
    actions: {
      /** Delete the project (and its allowance). Refused while it still contains resources. */
      deleteProject: (_ctx, a) => {
        const items = allCostItems().filter((i) => i.projectId === a.projectId);
        if (items.length) {
          const byType = new Map<string, number>();
          for (const i of items) byType.set(i.type, (byType.get(i.type) ?? 0) + 1);
          throw new ApiError(409, `Project ${a.name} still contains ${items.length} resource${items.length > 1 ? 's' : ''} (${[...byType].map(([t, n]) => `${n} ${t}`).join(', ')}). Delete or move them first.`, 'not_empty');
        }
        const siblings = db.filter<Project>('projects', (p) => p.accountId === a.accountId && p.id !== a.projectId);
        if (!siblings.length) throw conflict('An account needs at least one project');
        for (const u of db.list<User>('users')) if (Array.isArray(u.projectIds) && u.projectIds.includes(a.projectId)) db.update('users', u.id, { projectIds: u.projectIds.filter((p) => p !== a.projectId) } as any);
        for (const s of db.list<SystemAccount>('systemAccounts')) if (Array.isArray(s.projectIds) && s.projectIds.includes(a.projectId)) db.update('systemAccounts', s.id, { projectIds: s.projectIds.filter((p) => p !== a.projectId) } as any);
        if (db.get('projects', a.projectId)) db.remove('projects', a.projectId);
        db.remove('allowances', a.id);
        return { ok: true, deleted: a.projectId };
      },
    },
  });

  /* ------------------------------ custom endpoints */
  route('GET', '/iam/effective', (ctx) => {
    const userId = ctx.query.get('userId');
    const svcId = ctx.query.get('systemAccountId');
    if (userId) {
      const u = getOr404<User>('users', userId, 'User');
      return effectiveFor({ type: 'user', id: u.id, name: u.name }, u.roleIds, u.projectIds);
    }
    if (svcId) {
      const s = getOr404<SystemAccount>('systemAccounts', svcId, 'System account');
      return effectiveFor({ type: 'systemAccount', id: s.id, name: s.name }, s.roleIds, s.projectIds);
    }
    throw new ApiError(400, 'Pass ?userId= or ?systemAccountId=', 'bad_request');
  }, 'Effective permissions (union of roles) for a user or system account');

  route('GET', '/iam/who-can', (ctx) => {
    const service = ctx.query.get('service') ?? '';
    const action = (ctx.query.get('action') ?? 'read') as Action;
    const projectId = ctx.query.get('projectId');
    if (!isService(service) || !(ACTIONS as string[]).includes(action)) throw new ApiError(400, 'Pass a valid ?service= and ?action=', 'bad_request');
    const roles = db.list<Role>('roles').filter((r) => has(r.permissions, service, action));
    const roleIds = new Set(roles.map((r) => r.id));
    const inProject = (p: string[] | '*') => !projectId || p === '*' || p.includes(projectId);
    return {
      service, action, projectId,
      roles: roles.map((r) => ({ id: r.id, name: r.name, system: r.system })),
      users: db.list<User>('users').filter((u) => inProject(u.projectIds) && u.roleIds.some((r) => roleIds.has(r)))
        .map((u) => ({ id: u.id, name: u.name, email: u.email, status: u.status, via: u.roleIds.filter((r) => roleIds.has(r)), projectIds: u.projectIds })),
      systemAccounts: db.list<SystemAccount>('systemAccounts').filter((s) => inProject(s.projectIds) && s.roleIds.some((r) => roleIds.has(r)))
        .map((s) => ({ id: s.id, name: s.name, status: s.status ?? 'active', via: s.roleIds.filter((r) => roleIds.has(r)), projectIds: s.projectIds })),
    };
  }, 'Access explorer: which identities can perform ?action= on ?service= (optionally in ?projectId=)');

}
