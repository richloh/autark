import { db } from '../db';
import { collections, defineCollection, route, getOr404, ApiError, currentUser, type Ctx } from '../framework';
import { generateSeries, profileFor, RANGES } from '../metrics';
import { setOperationLinker } from '../operations';
import { resetMockData } from '../server';
import type { Operation, Notification, ResourceKind } from '@/types';

/** UI routes for each resource kind — used by search results, notifications, operations. */
export const LINKS: Partial<Record<ResourceKind, (id: string, row?: any) => string>> = {
  vm: (id) => `/infrastructure/vms/${id}`,
  volume: (id) => `/infrastructure/volumes/${id}`,
  snapshot: () => `/infrastructure/images?tab=snapshots`,
  image: () => `/infrastructure/images`,
  sshKey: () => `/infrastructure/ssh-keys`,
  network: (id) => `/infrastructure/networks/${id}`,
  ip: () => `/infrastructure/ips`,
  firewall: (id) => `/infrastructure/firewalls/${id}`,
  dnsZone: (id) => `/infrastructure/dns/${id}`,
  db: (id) => `/managed-services/db/${id}`,
  k8s: (id) => `/managed-services/kubernetes/${id}`,
  bucket: (id) => `/managed-services/object-storage/${id}`,
  lb: (id) => `/managed-services/load-balancers/${id}`,
  certificate: () => `/managed-services/load-balancers?tab=certificates`,
  bareMetal: (id) => `/hardware/bare-metals/${id}`,
  provider: (id) => `/hardware/cloud-providers/${id}`,
  user: (id) => `/iam/users/${id}`,
  role: (id) => `/iam/roles/${id}`,
  systemAccount: (id) => `/iam/system-accounts/${id}`,
  allowance: (id) => `/iam/project-allowances/${id}`,
  project: (id) => `/iam/project-allowances/allow-${id}`,
};

export function registerCore() {
  defineCollection({ name: 'accounts', kind: 'project', idPrefix: 'acc', scoped: false, readonly: true, searchable: false });
  defineCollection({
    name: 'projects', kind: 'project', idPrefix: 'proj', scoped: false, searchable: false,
    sort: (a: any, b: any) => a.name.localeCompare(b.name),
    create: (ctx, body) => {
      if (!body.name?.trim()) throw new ApiError(422, 'Name is required', 'validation_failed', { name: 'Name is required' });
      const id = `proj-${body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)}-${Math.floor(Math.random() * 999)}`;
      const row = { id, accountId: body.accountId || ctx.scope.accountId, name: body.name.trim(), description: body.description ?? '', color: body.color ?? '#5b67f8', createdAt: new Date().toISOString() };
      db.insert('allowances', {
        id: `allow-${id}`, name: row.name, projectId: id, accountId: row.accountId, budgetMonthly: body.budgetMonthly ?? 500, alertThresholds: [80, 100], hardLimit: false,
        quotas: { vcpus: 32, ramGB: 128, vms: 10, volumesGB: 2000, dbInstances: 2, k8sClusters: 1, buckets: 5, publicIps: 5 },
        allowedServices: ['compute', 'network', 'storage', 'db', 'k8s', 'objectStorage', 'dns', 'loadBalancers'], allowedLocations: ['dc1', 'dc2'], requiredTags: [], createdAt: row.createdAt, tags: [],
      });
      return row as any;
    },
  });
  defineCollection({ name: 'locations', kind: 'location', idPrefix: 'loc', scoped: false, readonly: true, searchable: false, sort: (a: any, b: any) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'selfHosted' ? -1 : 1) });

  defineCollection<Operation & { [k: string]: any }>({
    name: 'operations', kind: 'operation', idPrefix: 'op', accountScopedOnly: true, searchable: false,
    actions: {
      cancel: (_ctx, op) => {
        if (op.status !== 'running') throw new ApiError(409, 'Only running operations can be cancelled', 'conflict');
        db.update('operations', op.id, { status: 'cancelled', finishedAt: new Date().toISOString() } as any);
      },
    },
  });
  defineCollection({ name: 'auditLog', kind: 'operation', idPrefix: 'evt', accountScopedOnly: true, readonly: true, searchable: false, sort: (a: any, b: any) => b.when.localeCompare(a.when) });
  defineCollection<Notification & { [k: string]: any }>({
    name: 'notifications', kind: 'operation', idPrefix: 'ntf', searchable: false, accountScopedOnly: true,
    sort: (a, b) => b.time.localeCompare(a.time),
    actions: { read: (_c, n) => { db.update('notifications', n.id, { read: true } as any) } },
  });
  // notifications without accountId are global -> make them visible to all accounts
  route('POST', '/notifications/read-all', (ctx) => {
    for (const n of db.list<Notification>('notifications')) if (!n.read && (!n.accountId || n.accountId === ctx.scope.accountId)) db.update('notifications', n.id, { read: true } as any);
    return { ok: true };
  }, 'Mark all notifications read');

  route('GET', '/me', () => ({ user: currentUser(), roles: db.list('roles').filter((r: any) => currentUser().roleIds.includes(r.id)) }), 'Current user');

  route('POST', '/system/reset', () => { resetMockData(); return { ok: true } }, 'Reset all demo data to the seed state');

  route('GET', '/search', (ctx) => globalSearch(ctx), 'Search all resources (?q=)');

  /** GET /metrics/{kind}/{id}?metrics=cpu,ram&range=1h */
  route('GET', '/metrics/:collection/:id', (ctx) => {
    const def = collections.get(ctx.params.collection);
    if (!def) throw new ApiError(404, 'Unknown collection', 'not_found');
    const item = getOr404<any>(def.name, ctx.params.id);
    const metrics = (ctx.query.get('metrics') ?? '').split(',').filter(Boolean);
    const range = ctx.query.get('range') ?? '1h';
    if (!RANGES[range]) throw new ApiError(400, `Unknown range ${range}`, 'bad_request');
    const series: Record<string, unknown> = {};
    for (const m of metrics) {
      const p = profileFor(def.kind, item, m);
      if (p) series[m] = generateSeries(item.id, m, p, range);
    }
    return { resource: { type: def.kind, id: item.id }, range, series };
  }, 'Time-series metrics for a resource');

  setOperationLinker((op) => LINKS[op.target.type]?.(op.target.id));
}

function globalSearch(ctx: Ctx) {
  const q = (ctx.query.get('q') ?? '').toLowerCase().trim();
  if (!q) return { items: [] };
  const out: { kind: string; id: string; name: string; subtitle: string; link: string; projectId?: string }[] = [];
  for (const def of collections.values()) {
    if (def.searchable === false) continue;
    for (const row of db.list<any>(def.name)) {
      if (row.accountId && row.accountId !== ctx.scope.accountId) continue;
      const text = (def.searchText?.(row) ?? `${row.id} ${row.name ?? ''}`).toLowerCase();
      if (!text.includes(q)) continue;
      const link = def.link?.(row) ?? LINKS[def.kind]?.(row.id, row) ?? '/';
      out.push({ kind: def.kind, id: row.id, name: row.name ?? row.address ?? row.email ?? row.id, subtitle: def.subtitle?.(row) ?? row.id, link, projectId: row.projectId });
      if (out.length > 40) break;
    }
  }
  // exact/prefix matches first
  out.sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)));
  return { items: out.slice(0, 25) };
}
