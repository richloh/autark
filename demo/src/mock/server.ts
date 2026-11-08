import { db, type Row } from './db';
import { emit, type RequestLogEntry } from './bus';
import { collections, routes, ApiError, audit, currentUser, notFound, type Ctx, type CollectionDef } from './framework';
import { ensureTicker } from './operations';
import { buildSeed } from './seed';
import { registerAllHandlers } from './handlers';
import type { Project } from '@/types';

/* ------------------------------------------------------------------------------------------------
 * Mock HTTP server. Intercepts window.fetch for /api/v1/* and dispatches to the registered routes
 * and collections. Adds latency, request logging (for the in-app API inspector) and audit events.
 * ---------------------------------------------------------------------------------------------- */

export const API_PREFIX = '/api/v1';

export interface MockSettings { latency: boolean; chaos: boolean; opSpeed: number }
export function getSettings(): MockSettings {
  try { return { latency: true, chaos: false, opSpeed: 1, ...JSON.parse(localStorage.getItem('autark.mock.settings') || '{}') } }
  catch { return { latency: true, chaos: false, opSpeed: 1 } }
}
export function setSettings(s: Partial<MockSettings>) {
  localStorage.setItem('autark.mock.settings', JSON.stringify({ ...getSettings(), ...s }));
}

const requestLog: RequestLogEntry[] = [];
let reqSeq = 0;
export function getRequestLog() { return requestLog }

function isWrite(m: string) { return m !== 'GET' && m !== 'HEAD' }

function verbFor(method: string): string {
  return method === 'POST' ? 'create' : method === 'PATCH' || method === 'PUT' ? 'update' : method === 'DELETE' ? 'delete' : 'read';
}

function inScope(def: CollectionDef, row: Row, ctx: Ctx): boolean {
  if (def.scoped === false) return true;
  if (row.accountId && row.accountId !== ctx.scope.accountId) return false;
  if (def.accountScopedOnly) return true;
  if (ctx.scope.projectId && row.projectId && row.projectId !== ctx.scope.projectId) return false;
  return true;
}

function decorate(def: CollectionDef, row: Row): Row {
  return def.decorate ? def.decorate(structuredClone(row)) : row;
}

const RESERVED_QUERY = new Set(['q', 'limit', 'offset', 'sort', 'order']);

function listCollection(def: CollectionDef, ctx: Ctx) {
  let rows = db.list<Row>(def.name).filter((r) => inScope(def, r, ctx));
  const q = ctx.query.get('q')?.toLowerCase().trim();
  if (q) rows = rows.filter((r) => (def.searchText?.(r) ?? `${r.id} ${r.name ?? ''}`).toLowerCase().includes(q));
  for (const [k, v] of ctx.query.entries()) {
    if (RESERVED_QUERY.has(k)) continue;
    rows = rows.filter((r) => String(getPath(r, k)) === v);
  }
  rows.sort(def.sort ?? ((a, b) => String(b.createdAt ?? b.when ?? '').localeCompare(String(a.createdAt ?? a.when ?? ''))));
  const total = rows.length;
  const offset = Number(ctx.query.get('offset') ?? 0);
  const limit = Number(ctx.query.get('limit') ?? 1000);
  return { items: rows.slice(offset, offset + limit).map((r) => decorate(def, r)), total };
}

function getPath(obj: any, path: string) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function targetOf(def: CollectionDef, row: Row) {
  return { type: def.kind, id: row.id, name: row.name ?? row.key ?? row.address ?? row.email ?? row.id };
}

async function dispatch(method: string, url: URL, body: any, headers: Headers): Promise<{ status: number; body: unknown }> {
  const path = url.pathname.slice(API_PREFIX.length) || '/';
  const user = currentUser();
  const accountId = headers.get('x-autark-account') || db.list<any>('accounts')[0]?.id;
  const projectId = headers.get('x-autark-project') || null;
  const ctx: Ctx = { method, path, params: {}, query: url.searchParams, body, scope: { accountId, projectId }, actor: user?.email ?? 'anonymous', user };

  // 1) custom routes
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.regex.exec(path);
    if (!m) continue;
    r.keys.forEach((k, i) => (ctx.params[k] = decodeURIComponent(m[i + 1])));
    const res = await r.handler(ctx);
    return { status: method === 'POST' ? 201 : 200, body: res ?? { ok: true } };
  }

  // 2) generic collections
  const parts = path.split('/').filter(Boolean);
  const def = collections.get(parts[0]);
  if (!def) throw notFound(`Endpoint ${method} ${path}`);
  const id = parts[1] ? decodeURIComponent(parts[1]) : undefined;

  if (!id) {
    if (method === 'GET') return { status: 200, body: listCollection(def, ctx) };
    if (method === 'POST') {
      if (!def.create || def.readonly) throw new ApiError(405, `Cannot create ${def.name}`, 'method_not_allowed');
      const row = def.create(ctx, body ?? {});
      db.insert(def.name, row);
      audit(ctx, `${def.kind}.create`, targetOf(def, row), { accountId: row.accountId, projectId: row.projectId });
      def.afterCreate?.(ctx, row);
      return { status: 201, body: decorate(def, db.get(def.name, row.id) ?? row) };
    }
    throw new ApiError(405, 'Method not allowed', 'method_not_allowed');
  }

  const row = db.get<Row>(def.name, id);
  if (!row) throw notFound(`${def.kind} ${id}`);
  if (!inScope(def, row, { ...ctx, scope: { ...ctx.scope, projectId: null } })) {
    // the user can access it, but it lives in another account -> let the console switch scope
    throw new ApiError(404, `${def.kind} ${id} belongs to another account`, 'other_account', { accountId: row.accountId });
  }

  if (parts[2] === 'actions' && parts[3]) {
    if (method !== 'POST') throw new ApiError(405, 'Actions require POST', 'method_not_allowed');
    const action = def.actions?.[parts[3]];
    if (!action) throw notFound(`Action ${parts[3]} on ${def.kind}`);
    const res = await action(ctx, row, body ?? {});
    audit(ctx, `${def.kind}.${parts[3]}`, targetOf(def, db.get(def.name, id) ?? row), { accountId: row.accountId, projectId: row.projectId });
    const fresh = db.get<Row>(def.name, id);
    return { status: 200, body: res ?? (fresh ? decorate(def, fresh) : { ok: true }) };
  }
  if (parts.length > 2) throw notFound(`Endpoint ${method} ${path}`);

  if (method === 'GET') return { status: 200, body: decorate(def, row) };
  if (method === 'PATCH' || method === 'PUT') {
    if (def.readonly) throw new ApiError(405, `${def.name} is read-only`, 'method_not_allowed');
    const patch = body ?? {};
    const next = def.update ? def.update(ctx, structuredClone(row), patch) : defaultUpdate(row, patch);
    const saved = db.update(def.name, id, next as any);
    audit(ctx, `${def.kind}.update`, targetOf(def, saved), { accountId: row.accountId, projectId: row.projectId, details: Object.keys(patch).join(', ') });
    return { status: 200, body: decorate(def, saved) };
  }
  if (method === 'DELETE') {
    if (def.readonly) throw new ApiError(405, `${def.name} is read-only`, 'method_not_allowed');
    const res = def.remove ? def.remove(ctx, row) : 'deleted';
    if (res !== 'async') db.remove(def.name, id);
    audit(ctx, `${def.kind}.delete`, targetOf(def, row), { accountId: row.accountId, projectId: row.projectId });
    return { status: res === 'async' ? 202 : 200, body: { ok: true, async: res === 'async' } };
  }
  throw new ApiError(405, 'Method not allowed', 'method_not_allowed');
}

const IMMUTABLE = new Set(['id', 'accountId', 'createdAt', 'projectId']);
function defaultUpdate(row: Row, patch: Record<string, unknown>) {
  const next: Row = { ...row };
  for (const [k, v] of Object.entries(patch)) if (!IMMUTABLE.has(k)) next[k] = v;
  return next;
}

export async function handleRequest(method: string, rawUrl: string, body: unknown, headers: Headers) {
  const url = new URL(rawUrl, location.origin);
  const started = performance.now();
  let status = 500;
  let resBody: unknown;
  const settings = getSettings();
  try {
    if (settings.chaos && isWrite(method) && Math.random() < 0.15) {
      throw new ApiError(503, 'Chaos mode: the control plane is temporarily unavailable. Please retry.', 'unavailable');
    }
    const res = await dispatch(method, url, body, headers);
    status = res.status;
    resBody = res.body;
  } catch (e) {
    if (e instanceof ApiError) {
      status = e.status;
      resBody = { error: { code: e.code, message: e.message, details: e.details } };
    } else {
      console.error('[mock server] unhandled error', e);
      status = 500;
      resBody = { error: { code: 'internal', message: (e as Error)?.message ?? 'Internal error' } };
    }
  }
  if (settings.latency) {
    const base = isWrite(method) ? 180 + Math.random() * 260 : 60 + Math.random() * 160;
    const spent = performance.now() - started;
    if (spent < base) await new Promise((r) => setTimeout(r, base - spent));
  }
  const entry: RequestLogEntry = {
    id: ++reqSeq,
    method,
    path: url.pathname + url.search,
    status,
    durationMs: Math.round(performance.now() - started),
    at: Date.now(),
    requestBody: body,
    responseBody: resBody,
  };
  requestLog.unshift(entry);
  if (requestLog.length > 300) requestLog.pop();
  emit({ kind: 'request', entry });
  return { status, body: resBody };
}

let installed = false;
export function installMockServer() {
  if (installed) return;
  installed = true;
  registerAllHandlers();
  db.init(buildSeed);
  ensureTicker();
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url, location.origin);
    if (u.origin !== location.origin || !u.pathname.startsWith(API_PREFIX)) return realFetch(input as any, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    let body: unknown = undefined;
    if (init?.body && typeof init.body === 'string') {
      try { body = JSON.parse(init.body) } catch { body = init.body }
    }
    const headers = new Headers(init?.headers);
    const res = await handleRequest(method, u.href, body, headers);
    return new Response(res.status === 204 ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: { 'content-type': 'application/json', 'x-autark-mock': '1' },
    });
  };
}

export function resetMockData() {
  db.reset(buildSeed);
}

/** used by the API explorer page */
export function describeApi() {
  const generic = [...collections.values()].map((c) => ({ name: c.name, kind: c.kind, actions: Object.keys(c.actions ?? {}), readonly: !!c.readonly, creatable: !!c.create }));
  const custom = routes.map((r) => ({ method: r.method, path: API_PREFIX + r.pattern, summary: r.summary }));
  return { generic, custom };
}

export function projectsOf(accountId: string) { return db.filter<Project>('projects', (p) => p.accountId === accountId) }
