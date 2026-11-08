import { db, type Row } from './db';
import { randomHex } from '@/lib/random';
import type { AuditEvent, Notification, ResourceKind, User, Project } from '@/types';

/* ------------------------------------------------------------------------------------------------
 * Mock backend framework.
 *
 * - `defineCollection` registers a REST resource. The generic router then serves:
 *     GET    /api/v1/{name}                 list (scoped to account/project; ?q= search; ?field=value filters)
 *     GET    /api/v1/{name}/{id}
 *     POST   /api/v1/{name}                 -> def.create(ctx, body)
 *     PATCH  /api/v1/{name}/{id}            -> def.update(ctx, item, patch)
 *     DELETE /api/v1/{name}/{id}            -> def.remove(ctx, item)
 *     POST   /api/v1/{name}/{id}/actions/{action}  -> def.actions[action](ctx, item, body)
 * - `route` registers custom endpoints (matched before the generic ones).
 * - Writes are audited automatically ("{kind}.{verb}").
 * ---------------------------------------------------------------------------------------------- */

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'error', public details?: Record<string, string>) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, `${what} not found`, 'not_found');
export const conflict = (msg: string) => new ApiError(409, msg, 'conflict');
export const badRequest = (msg: string, details?: Record<string, string>) => new ApiError(400, msg, 'bad_request', details);

export interface Ctx {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  scope: { accountId: string; projectId: string | null };
  actor: string; // email of the acting user
  user: User;
}

export interface CollectionDef<T extends Row = Row> {
  name: string; // REST collection name, e.g. "vms"
  kind: ResourceKind;
  idPrefix: string;
  /** whether rows carry accountId/projectId and lists are scoped (default true) */
  scoped?: boolean;
  /** scoped by account only (rows have accountId but projectId optional) */
  accountScopedOnly?: boolean;
  /** text used by ?q= and global search */
  searchText?: (item: T) => string;
  /** UI route for this item (global search, notifications) */
  link?: (item: T) => string;
  subtitle?: (item: T) => string;
  /** include in global search / command palette (default true) */
  searchable?: boolean;
  create?: (ctx: Ctx, body: any) => T;
  /** runs after insert (e.g. start a provisioning operation) */
  afterCreate?: (ctx: Ctx, item: T) => void;
  update?: (ctx: Ctx, item: T, patch: any) => Partial<T> | T;
  /** return 'async' if deletion completes later via an operation */
  remove?: (ctx: Ctx, item: T) => 'deleted' | 'async' | void;
  actions?: Record<string, (ctx: Ctx, item: T, body: any) => unknown>;
  /** computed fields on read */
  decorate?: (item: T) => T;
  readonly?: boolean;
  /** default sort; default createdAt desc */
  sort?: (a: T, b: T) => number;
}

export const collections = new Map<string, CollectionDef<any>>();

export function defineCollection<T extends Row>(def: CollectionDef<T>): CollectionDef<T> {
  collections.set(def.name, def as CollectionDef<any>);
  return def;
}

export function collectionByKind(kind: ResourceKind): CollectionDef | undefined {
  for (const c of collections.values()) if (c.kind === kind) return c;
  return undefined;
}

export type Handler = (ctx: Ctx) => unknown;
export interface RouteDef { method: string; pattern: string; regex: RegExp; keys: string[]; handler: Handler; summary?: string }
export const routes: RouteDef[] = [];

/** Register a custom endpoint. Pattern like "/vms/:id/console" (relative to /api/v1). */
export function route(method: string, pattern: string, handler: Handler, summary?: string) {
  const keys: string[] = [];
  const regex = new RegExp(
    '^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)' }) + '/?$',
  );
  routes.push({ method: method.toUpperCase(), pattern, regex, keys, handler, summary });
}

/* ------------------------------------------------------------------------------------------------
 * Helpers for handlers
 * ---------------------------------------------------------------------------------------------- */

export const nowIso = () => new Date().toISOString();
export const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function newId(prefix: string): string { return `${prefix}-${randomHex(6)}` }

export function getOr404<T extends Row>(collection: string, id: string, label = collection): T {
  const row = db.get<T>(collection, id);
  if (!row) throw notFound(`${label} ${id}`);
  return row;
}

/** Throws a 422 with field errors when `errors` has any entries. */
export function validate(errors: Record<string, string | false | null | undefined>) {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) if (v) clean[k] = v;
  if (Object.keys(clean).length) {
    throw new ApiError(422, Object.values(clean)[0], 'validation_failed', clean);
  }
}

export const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
export function nameError(name: unknown, label = 'Name'): string | null {
  if (typeof name !== 'string' || !name.trim()) return `${label} is required`;
  if (!NAME_RE.test(name)) return `${label} must be lowercase letters, digits and dashes (max 63)`;
  return null;
}

export function uniqueNameError(collection: string, name: string, scope: { accountId?: string; projectId?: string | null }, exceptId?: string): string | null {
  const dup = db.find<Row>(collection, (r) => r.name === name && r.id !== exceptId && (!scope.projectId || r.projectId === scope.projectId));
  return dup ? `"${name}" already exists in this project` : null;
}

/** Determine account/project for a new resource from body.projectId or the request scope. */
export function scopeFor(ctx: Ctx, body: any): { accountId: string; projectId: string } {
  const projectId: string | undefined = body?.projectId || ctx.scope.projectId || undefined;
  if (!projectId) throw new ApiError(422, 'Select a project for this resource', 'validation_failed', { projectId: 'Project is required' });
  const project = db.get<Project>('projects', projectId);
  if (!project) throw new ApiError(422, 'Unknown project', 'validation_failed', { projectId: 'Unknown project' });
  return { accountId: project.accountId, projectId };
}

export function audit(
  ctx: Pick<Ctx, 'actor'> | string,
  action: string,
  target: { type: ResourceKind; id: string; name?: string },
  opts: Partial<Pick<AuditEvent, 'result' | 'details' | 'accountId' | 'projectId' | 'via'>> = {},
) {
  const actor = typeof ctx === 'string' ? ctx : ctx.actor;
  const row: AuditEvent = {
    id: newId('evt'),
    when: nowIso(),
    actor,
    action,
    target,
    result: opts.result ?? 'success',
    accountId: opts.accountId,
    projectId: opts.projectId,
    sourceIp: actor === 'system' ? undefined : '192.0.2.44',
    via: opts.via ?? (actor === 'system' ? 'system' : 'console'),
    details: opts.details,
  };
  db.insert('auditLog', row as any);
}

export function notify(level: Notification['level'], title: string, message: string, link?: string, accountId?: string) {
  const row: Notification = { id: newId('ntf'), level, title, message, time: nowIso(), read: false, link, accountId };
  db.insert('notifications', row as any);
}

export function currentUser(): User {
  const users = db.list<User>('users');
  return users.find((u) => u.id === 'user-001') ?? users[0];
}

/** Clamp integer field validation helper */
export function intIn(v: unknown, min: number, max: number): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

/** Remove a ref from all firewalls / LB targets / IP assignments when a resource disappears. */
export function detachEverywhere(type: ResourceKind, id: string) {
  for (const fw of db.list<any>('firewalls')) {
    if (fw.attachedTo?.some((r: any) => r.type === type && r.id === id)) {
      db.update('firewalls', fw.id, { attachedTo: fw.attachedTo.filter((r: any) => !(r.type === type && r.id === id)) });
    }
  }
  for (const ip of db.list<any>('ips')) {
    if (ip.assignedTo?.type === type && ip.assignedTo?.id === id) db.update('ips', ip.id, { assignedTo: null });
  }
  for (const lb of db.list<any>('loadBalancers')) {
    const touched = lb.targetGroups?.some((tg: any) => tg.targets.some((t: any) => t.ref.type === type && t.ref.id === id));
    if (touched) {
      db.update<any>('loadBalancers', lb.id, (l: any) => {
        for (const tg of l.targetGroups) tg.targets = tg.targets.filter((t: any) => !(t.ref.type === type && t.ref.id === id));
        return l;
      });
    }
  }
}

export function sleepless<T>(v: T) { return v }
