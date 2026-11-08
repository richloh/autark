import { db } from '../db';
import { defineCollection, route, ApiError, validate, scopeFor, newId, nowIso, getOr404, audit, intIn, DAY, type Ctx } from '../framework';
import { startOperation, onOperationComplete, transition } from '../operations';
import { registerMetrics } from '../metrics';
import { locationOrThrow, checkQuota, checkRequiredTags, checkLocationAllowed } from './shared';
import { bucketMonthly } from './costs';
import { randomHex, randomToken, hashString } from '@/lib/random';
import type { Bucket, BucketObject, AccessKey, LifecycleRule, CorsRule, StorageClass, ObjectListing } from '@/types';

/* Object storage (S3-compatible, served by Ceph RGW on own hardware): buckets, objects, access keys. */

const GB = 1024 ** 3;
const MAX_INLINE = 150 * 1024;
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const CLASSES: StorageClass[] = ['STANDARD', 'INFREQUENT', 'ARCHIVE'];
const CLASS_RANK: Record<StorageClass, number> = { STANDARD: 0, INFREQUENT: 1, ARCHIVE: 2 };
const METHODS = ['GET', 'HEAD', 'PUT', 'POST', 'DELETE'];

/* ---------------------------------------------------------------- validation helpers */

export function bucketNameError(name: unknown, exceptId?: string): string | null {
  if (typeof name !== 'string' || !name) return 'Bucket name is required';
  if (name.length < 3 || name.length > 63) return 'Bucket names are 3–63 characters';
  if (!BUCKET_RE.test(name)) return 'Use lowercase letters, digits, dots and dashes; start and end with a letter or digit';
  if (/\.\.|\.-|-\./.test(name)) return 'No adjacent dots, or dots next to dashes';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return 'Bucket names must not look like an IP address';
  if (name.startsWith('xn--') || name.endsWith('-s3alias')) return 'Reserved prefix/suffix';
  // global namespace: unique across ALL accounts and projects (DNS-style virtual hosting)
  const dup = db.find<Bucket>('buckets', (b) => b.name === name && b.id !== exceptId);
  if (dup) return `"${name}" is already taken — bucket names are globally unique`;
  return null;
}

function validateLifecycle(rules: unknown, base: StorageClass): LifecycleRule[] {
  if (!Array.isArray(rules)) throw new ApiError(422, 'lifecycleRules must be a list', 'validation_failed', { lifecycleRules: 'Invalid' });
  const out: LifecycleRule[] = rules.map((r: any, i) => {
    const days = Number(r.days);
    validate({
      [`lifecycleRules.${i}.days`]: !(Number.isInteger(days) && days >= 1 && days <= 3650) && `Rule ${i + 1}: days must be 1–3650`,
      [`lifecycleRules.${i}.action`]: !['transition', 'expire'].includes(r.action) && `Rule ${i + 1}: unknown action`,
      [`lifecycleRules.${i}.toClass`]: r.action === 'transition' && (!['INFREQUENT', 'ARCHIVE'].includes(r.toClass) ? `Rule ${i + 1}: choose a target class` : CLASS_RANK[r.toClass as StorageClass] <= CLASS_RANK[base] && `Rule ${i + 1}: objects are already ${base}; transition to a colder class`),
      [`lifecycleRules.${i}.prefix`]: typeof r.prefix === 'string' && r.prefix.startsWith('/') && `Rule ${i + 1}: prefixes must not start with "/"`,
    });
    return { id: r.id || newId('lc'), prefix: String(r.prefix ?? ''), action: r.action, days, ...(r.action === 'transition' ? { toClass: r.toClass } : {}), enabled: r.enabled !== false, noncurrent: !!r.noncurrent };
  });
  // per prefix: expiry must come after every transition; transitions must get colder over time
  const byPrefix = new Map<string, LifecycleRule[]>();
  for (const r of out.filter((x) => x.enabled)) byPrefix.set(r.prefix, [...(byPrefix.get(r.prefix) ?? []), r]);
  for (const [prefix, rs] of byPrefix) {
    const exp = rs.filter((r) => r.action === 'expire');
    if (exp.length > 1) throw new ApiError(422, `Only one expiration rule per prefix ("${prefix || 'all objects'}")`, 'validation_failed', { lifecycleRules: 'Duplicate expiration' });
    const tr = rs.filter((r) => r.action === 'transition').sort((a, b) => a.days - b.days);
    if (exp[0] && tr.some((t) => t.days >= exp[0].days)) throw new ApiError(422, `Expiration (${exp[0].days}d) must come after all transitions for "${prefix || 'all objects'}"`, 'validation_failed', { lifecycleRules: 'Expire before transition' });
    for (let i = 1; i < tr.length; i++) if (CLASS_RANK[tr[i].toClass!] <= CLASS_RANK[tr[i - 1].toClass!]) throw new ApiError(422, `Transitions for "${prefix || 'all objects'}" must move to colder classes over time`, 'validation_failed', { lifecycleRules: 'Order' });
    if (tr.some((t) => t.toClass === 'ARCHIVE') && tr.find((t) => t.toClass === 'ARCHIVE')!.days < 30 && base === 'STANDARD') {
      // allowed, but realistic minimum-storage-duration rule for archive is enforced on INFREQUENT -> ARCHIVE
    }
  }
  return out;
}

function validateCors(rules: unknown): CorsRule[] {
  if (!Array.isArray(rules)) throw new ApiError(422, 'cors must be a list', 'validation_failed', { cors: 'Invalid' });
  if (rules.length > 20) throw new ApiError(422, 'At most 20 CORS rules', 'validation_failed', { cors: 'Too many rules' });
  return rules.map((r: any, i) => {
    const origins: string[] = (Array.isArray(r.origins) ? r.origins : String(r.origins ?? '').split(',')).map((s: string) => s.trim()).filter(Boolean);
    const methods: string[] = (r.methods ?? []).map((m: string) => m.toUpperCase());
    validate({
      [`cors.${i}.origins`]: !origins.length ? `CORS rule ${i + 1}: add at least one origin` : origins.find((o) => o !== '*' && !/^https?:\/\/(\*\.)?[a-z0-9.-]+(:\d+)?$/i.test(o)) && `CORS rule ${i + 1}: "${origins.find((o) => o !== '*' && !/^https?:\/\/(\*\.)?[a-z0-9.-]+(:\d+)?$/i.test(o))}" is not a valid origin`,
      [`cors.${i}.methods`]: !methods.length ? `CORS rule ${i + 1}: choose at least one method` : methods.find((m) => !METHODS.includes(m)) && `CORS rule ${i + 1}: unsupported method`,
      [`cors.${i}.maxAgeSec`]: !intIn(Number(r.maxAgeSec ?? 0), 0, 86400) && `CORS rule ${i + 1}: max age 0–86400 s`,
    });
    return { id: r.id || newId('cors'), origins, methods, maxAgeSec: Number(r.maxAgeSec ?? 3600), allowedHeaders: r.allowedHeaders ?? ['*'] };
  });
}

/* ---------------------------------------------------------------- computed */

/** Estimate how the bucket's bytes are spread over storage classes after lifecycle transitions. */
export function classBreakdown(b: Bucket): Record<StorageClass, number> {
  const out: Record<StorageClass, number> = { STANDARD: 0, INFREQUENT: 0, ARCHIVE: 0 };
  const ageDays = Math.max(1, (Date.now() - Date.parse(b.createdAt)) / DAY);
  // share of data older than d days, assuming steady ingest since creation; prefixed rules cover ~45% of data
  const tr = b.lifecycleRules.filter((r) => r.enabled && r.action === 'transition' && r.toClass).sort((a, c) => a.days - c.days);
  const shares = tr.map((r) => Math.max(0, (ageDays - r.days) / ageDays) * (r.prefix ? 0.45 : 0.95));
  let assigned = 0;
  tr.forEach((r, i) => {
    const band = Math.max(0, shares[i] - (shares[i + 1] ?? 0));
    const bytes = Math.min(b.bytesUsed - assigned, b.bytesUsed * band);
    out[r.toClass!] += bytes;
    assigned += bytes;
  });
  out[b.storageClass] += b.bytesUsed - assigned;
  return out;
}

function decorateBucket(b: Bucket): Bucket {
  return { ...b, status: b.status ?? 'active', monthlyCost: bucketMonthly(b), classBreakdown: classBreakdown(b) };
}

function adjustUsage(bucketId: string, deltaBytes: number, deltaCount: number) {
  if (!db.get('buckets', bucketId)) return;
  db.update<Bucket>('buckets', bucketId, (b) => {
    b.bytesUsed = Math.max(0, b.bytesUsed + deltaBytes);
    b.objectCount = Math.max(0, b.objectCount + deltaCount);
    return b;
  });
}

function etagFor(key: string, size: number) {
  const h = (hashString(`${key}:${size}:${Date.now()}`) >>> 0).toString(16).padStart(8, '0');
  return `"${h}${randomHex(24)}"`;
}

function requireActive(b: Bucket) {
  if (b.status === 'creating') throw new ApiError(409, `Bucket ${b.name} is still being created`, 'invalid_state');
  if (b.status === 'deleting') throw new ApiError(409, `Bucket ${b.name} is being deleted`, 'invalid_state');
}

function objectsIn(bucketId: string, prefix = '') {
  return db.filter<BucketObject>('bucketObjects', (o) => o.bucketId === bucketId && o.key.startsWith(prefix));
}

/** Expand keys (folders end with "/") to concrete object rows (including folder markers). */
function expandKeys(bucketId: string, keys: string[]): BucketObject[] {
  const seen = new Map<string, BucketObject>();
  for (const k of keys) {
    if (k.endsWith('/')) for (const o of objectsIn(bucketId, k)) seen.set(o.id, o);
    else { const o = db.find<BucketObject>('bucketObjects', (x) => x.bucketId === bucketId && x.key === k); if (o) seen.set(o.id, o) }
  }
  return [...seen.values()];
}

function checkKey(key: unknown, field = 'key'): string {
  validate({
    [field]: typeof key !== 'string' || !key ? 'Object key is required'
      : key.length > 1024 ? 'Keys are at most 1024 bytes'
      : key.startsWith('/') ? 'Keys must not start with "/"'
      : /\/\//.test(key) ? 'Keys must not contain "//"'
      : /[\u0000-\u001f\\]/.test(key) && 'Key contains invalid characters',
  });
  return key as string;
}

function checkRetention(o: BucketObject, verb: string) {
  if (o.retainUntil && Date.parse(o.retainUntil) > Date.now()) {
    throw new ApiError(409, `Object lock: "${o.key}" is retained until ${new Date(o.retainUntil).toLocaleString('en-GB')} and cannot be ${verb}`, 'object_locked');
  }
}

function checkBucketQuota(b: Bucket, addBytes: number) {
  if (b.quotaGB != null && b.bytesUsed + addBytes > b.quotaGB * GB) {
    throw new ApiError(422, `Bucket quota exceeded: ${b.name} is limited to ${b.quotaGB} GB (${(b.bytesUsed / GB).toFixed(1)} GB used). Raise the quota in Settings.`, 'quota_exceeded', { quotaGB: 'Quota exceeded' });
  }
}

/** Insert or overwrite an object; keeps bucket usage in sync. */
function putObject(b: Bucket, input: { key: string; sizeBytes: number; contentType?: string; content?: string; storageClass?: StorageClass; tags?: any[] }): BucketObject {
  const existing = db.find<BucketObject>('bucketObjects', (o) => o.bucketId === b.id && o.key === input.key);
  if (existing && b.objectLock) checkRetention(existing, 'overwritten');
  const content = typeof input.content === 'string' && input.content.length <= MAX_INLINE * 1.4 ? input.content : undefined;
  const retainUntil = b.objectLock ? new Date(Date.now() + (b.objectLockRetentionDays ?? 30) * DAY).toISOString() : null;
  const base = {
    key: input.key, name: input.key, sizeBytes: input.sizeBytes, contentType: input.contentType || guessType(input.key), storageClass: input.storageClass ?? b.storageClass,
    etag: etagFor(input.key, input.sizeBytes), lastModified: nowIso(), content, retainUntil,
  };
  if (existing) {
    // versioned buckets keep the previous version (noncurrent) — its bytes stay billed
    const delta = b.versioning ? input.sizeBytes : input.sizeBytes - existing.sizeBytes;
    checkBucketQuota(b, Math.max(0, delta));
    const next = db.update<BucketObject>('bucketObjects', existing.id, { ...base, versions: b.versioning ? (existing.versions ?? 1) + 1 : 1, tags: input.tags ?? existing.tags });
    adjustUsage(b.id, delta, 0);
    return next;
  }
  checkBucketQuota(b, input.sizeBytes);
  const row: BucketObject = { id: newId('obj'), bucketId: b.id, accountId: b.accountId, projectId: b.projectId, ...base, createdAt: nowIso(), tags: input.tags ?? [], versions: 1 };
  db.insert('bucketObjects', row as any);
  adjustUsage(b.id, input.sizeBytes, input.key.endsWith('/') ? 0 : 1);
  return row;
}

function removeObjects(b: Bucket, rows: BucketObject[], bypassLock = false) {
  if (b.objectLock && !bypassLock) for (const o of rows) checkRetention(o, 'deleted');
  let bytes = 0;
  for (const o of rows) { bytes += o.sizeBytes * (b.versioning ? o.versions ?? 1 : 1); db.remove('bucketObjects', o.id) }
  adjustUsage(b.id, -bytes, -rows.filter((o) => !o.key.endsWith('/')).length);
  return { deleted: rows.length, bytes };
}

export function guessType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    txt: 'text/plain', md: 'text/markdown', html: 'text/html', htm: 'text/html', css: 'text/css', js: 'application/javascript', mjs: 'application/javascript', ts: 'text/plain', json: 'application/json',
    jsonl: 'application/jsonl', xml: 'application/xml', csv: 'text/csv', yaml: 'application/yaml', yml: 'application/yaml', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar', mp4: 'video/mp4', parquet: 'application/octet-stream',
  };
  return map[ext] ?? 'application/octet-stream';
}

function listObjects(b: Bucket, prefix: string, q?: string): ObjectListing {
  const all = objectsIn(b.id, prefix);
  const folders = new Map<string, ObjectListing['folders'][number]>();
  const objects: ObjectListing['objects'] = [];
  for (const o of all) {
    const rest = o.key.slice(prefix.length);
    if (!rest) continue; // the folder marker of the current prefix itself
    const slash = rest.indexOf('/');
    if (q && !rest.toLowerCase().includes(q.toLowerCase())) continue;
    if (slash >= 0 && !q) {
      const fp = prefix + rest.slice(0, slash + 1);
      const f = folders.get(fp) ?? { prefix: fp, name: rest.slice(0, slash), objectCount: 0, sizeBytes: 0, lastModified: null };
      if (!o.key.endsWith('/')) { f.objectCount++; f.sizeBytes += o.sizeBytes }
      if (!f.lastModified || o.lastModified > f.lastModified) f.lastModified = o.lastModified;
      folders.set(fp, f);
    } else if (!o.key.endsWith('/') || q) {
      const { content, ...meta } = o;
      objects.push({ ...meta, hasContent: !!content });
    }
  }
  return {
    prefix,
    folders: [...folders.values()].sort((a, c) => a.name.localeCompare(c.name)),
    objects: objects.sort((a, c) => a.key.localeCompare(c.key)),
    totalObjects: all.filter((o) => !o.key.endsWith('/')).length,
  };
}

function relocate(_ctx: Ctx, src: Bucket, body: any, forceMove?: boolean) {
  const keys: string[] = Array.isArray(body.keys) ? body.keys : [];
  if (!keys.length) throw new ApiError(422, 'Select at least one object', 'validation_failed', { keys: 'Nothing selected' });
  const dest = body.destBucketId ? getOr404<Bucket>('buckets', body.destBucketId, 'Destination bucket') : src;
  requireActive(dest);
  if (dest.accountId !== src.accountId) throw new ApiError(403, 'Destination bucket belongs to another account', 'forbidden');
  const destPrefix: string = body.destPrefix ?? '';
  if (destPrefix && !destPrefix.endsWith('/')) throw new ApiError(422, 'Destination prefix must end with "/"', 'validation_failed', { destPrefix: 'End with /' });
  const sourcePrefix: string = body.sourcePrefix ?? '';
  const move = forceMove ?? !!body.move;
  const rows = expandKeys(src.id, keys);
  if (!rows.length) throw new ApiError(404, 'No matching objects', 'not_found');
  if (move && src.objectLock) for (const o of rows) checkRetention(o, 'moved');
  const plan = rows.map((o) => ({ o, newKey: destPrefix + (o.key.startsWith(sourcePrefix) ? o.key.slice(sourcePrefix.length) : o.key) }));
  if (dest.id === src.id && plan.some((p) => p.newKey === p.o.key)) throw new ApiError(422, 'Source and destination are the same', 'validation_failed', { destPrefix: 'Same location' });
  if (dest.id === src.id && keys.some((k) => k.endsWith('/') && destPrefix.startsWith(k))) throw new ApiError(422, 'Cannot copy a folder into itself', 'validation_failed', { destPrefix: 'Inside source folder' });
  checkBucketQuota(dest, plan.reduce((a, p) => a + p.o.sizeBytes, 0));
  for (const p of plan) putObject(dest, { key: p.newKey, sizeBytes: p.o.sizeBytes, contentType: p.o.contentType, content: p.o.content, storageClass: p.o.storageClass, tags: p.o.tags });
  if (move) removeObjects(src, plan.map((p) => p.o).filter((o) => db.get('bucketObjects', o.id)), true);
  return { ok: true, count: plan.length, destBucketId: dest.id, destPrefix };
}

/* ---------------------------------------------------------------- access keys */

function genKeyId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = 'AUTK';
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function genSecret() { return randomToken(40) }
const mask = (secret: string) => `••••••••••••${secret.slice(-4)}`;

function validateKeyScope(projectId: string, body: any): { bucketIds: AccessKey['bucketIds']; permission: AccessKey['permission'] } {
  const bucketIds = body.bucketIds === '*' ? '*' : Array.isArray(body.bucketIds) ? body.bucketIds : [];
  validate({
    bucketIds: bucketIds !== '*' && !bucketIds.length ? 'Choose at least one bucket or "all buckets"'
      : bucketIds !== '*' && bucketIds.find((id: string) => db.get<Bucket>('buckets', id)?.projectId !== projectId) && 'Keys can only be scoped to buckets in the same project',
    permission: !['read', 'write', 'readwrite'].includes(body.permission) && 'Choose a permission',
  });
  return { bucketIds, permission: body.permission };
}

/* ---------------------------------------------------------------- operations */

onOperationComplete('bucket.created', (_op, p: { id: string }) => {
  if (db.get('buckets', p.id)) db.update('buckets', p.id, { status: 'active' } as any);
});
onOperationComplete('bucket.deleted', (_op, p: { id: string }) => {
  for (const o of db.filter<BucketObject>('bucketObjects', (x) => x.bucketId === p.id)) db.remove('bucketObjects', o.id);
  for (const k of db.filter<AccessKey>('accessKeys', (x) => Array.isArray(x.bucketIds) && x.bucketIds.includes(p.id))) {
    db.update<AccessKey>('accessKeys', k.id, { bucketIds: (k.bucketIds as string[]).filter((b) => b !== p.id) });
  }
  db.remove('buckets', p.id);
});
onOperationComplete('bucket.deleteFailed', (_op, p: { id: string }) => {
  if (db.get('buckets', p.id)) db.update('buckets', p.id, { status: 'active' } as any);
});

/* ---------------------------------------------------------------- registration */

export function registerStorage() {
  defineCollection<Bucket>({
    name: 'buckets', kind: 'bucket', idPrefix: 'bkt',
    searchText: (b) => `${b.id} ${b.name} ${b.locationId} ${b.storageClass} ${b.access} ${b.tags.map((t) => `${t.key}:${t.value}`).join(' ')}`,
    subtitle: (b) => `Bucket · ${(b.bytesUsed / GB).toFixed(1)} GB · ${b.storageClass.toLowerCase()} · ${b.access}`,
    decorate: decorateBucket,
    create: (ctx, body) => {
      const sc = scopeFor(ctx, body);
      const loc = locationOrThrow(body.locationId);
      const storageClass: StorageClass = body.storageClass ?? 'STANDARD';
      const quotaGB = body.quotaGB == null || body.quotaGB === '' ? null : Number(body.quotaGB);
      validate({
        name: bucketNameError(body.name),
        storageClass: !CLASSES.includes(storageClass) && 'Unknown storage class',
        encryption: body.encryption && !['none', 'SSE', 'SSE-KMS'].includes(body.encryption) && 'Unknown encryption mode',
        access: body.access && !['private', 'public-read'].includes(body.access) && 'Unknown access mode',
        quotaGB: quotaGB != null && !(Number.isFinite(quotaGB) && quotaGB >= 1 && quotaGB <= 1_000_000) && 'Quota must be 1 GB – 1 PB',
        objectLockRetentionDays: body.objectLock && !intIn(Number(body.objectLockRetentionDays ?? 30), 1, 36500) && 'Retention must be 1–36500 days',
        versioning: body.objectLock && body.versioning === false && 'Object lock requires versioning',
      });
      if (body.access === 'public-read' && !body.acknowledgePublic) throw new ApiError(422, 'Public buckets expose every object to the internet. Confirm with acknowledgePublic: true.', 'validation_failed', { access: 'Acknowledge public access' });
      checkLocationAllowed(sc.projectId, loc.id);
      checkRequiredTags(sc.projectId, body.tags);
      checkQuota(sc.projectId, { buckets: 1 });
      const lifecycleRules = validateLifecycle(body.lifecycleRules ?? [], storageClass);
      const cors = validateCors(body.cors ?? []);
      const bucket: Bucket = {
        id: newId('bkt'), name: body.name, ...sc, locationId: loc.id, storageClass, versioning: !!body.versioning || !!body.objectLock, objectLock: !!body.objectLock,
        ...(body.objectLock ? { objectLockRetentionDays: Number(body.objectLockRetentionDays ?? 30), objectLockMode: body.objectLockMode === 'compliance' ? 'compliance' : 'governance' } : {}),
        encryption: body.encryption ?? 'SSE', access: body.access ?? 'private', bytesUsed: 0, objectCount: 0, requestsLast30d: 0, egressGBLast30d: 0,
        lifecycleRules, cors, endpoint: `https://s3.${loc.id}.autark.cloud/${body.name}`, quotaGB, status: 'creating', description: body.description ?? '', createdAt: nowIso(), tags: body.tags ?? [],
      };
      return bucket;
    },
    afterCreate: (ctx, b) => {
      startOperation({
        type: 'bucket.create', title: `Create bucket ${b.name}`, target: { type: 'bucket', id: b.id, name: b.name }, scope: { accountId: b.accountId, projectId: b.projectId }, actor: ctx.actor, silent: true,
        steps: [
          { name: 'Reserve global bucket name', ms: 600, logs: [`name "${b.name}" reserved in global namespace`, `DNS: ${b.name}.s3.${b.locationId}.autark.cloud → RGW gateways`] },
          { name: 'Create bucket on Ceph RGW', ms: 900, logs: [`placement: ${b.locationId}.rgw.buckets.data (EC 4+2)`, `index shards: 11`, `default storage class: ${b.storageClass}`] },
          { name: 'Apply settings', ms: 700, logs: [
            `versioning: ${b.versioning ? 'Enabled' : 'Off'}`, `object lock: ${b.objectLock ? `${b.objectLockMode} ${b.objectLockRetentionDays}d` : 'off'}`, `encryption: ${b.encryption}`,
            `lifecycle rules: ${b.lifecycleRules.length}`, `CORS rules: ${b.cors.length}`, `policy: ${b.access === 'public-read' ? 'public-read (anonymous GetObject)' : 'private'}`,
          ] },
        ],
        onComplete: 'bucket.created', payload: { id: b.id },
      });
    },
    update: (_ctx, b, patch) => {
      const next: Bucket = { ...b };
      if ('storageClass' in patch) { validate({ storageClass: !CLASSES.includes(patch.storageClass) && 'Unknown storage class' }); next.storageClass = patch.storageClass }
      if ('versioning' in patch) {
        if (!patch.versioning && b.objectLock) throw new ApiError(409, 'Versioning cannot be suspended while object lock is enabled', 'invalid_state');
        next.versioning = !!patch.versioning;
      }
      if ('objectLock' in patch) {
        if (b.objectLock && !patch.objectLock) throw new ApiError(409, 'Object lock cannot be disabled once enabled', 'immutable');
        if (patch.objectLock && !b.objectLock) { next.objectLock = true; next.versioning = true; next.objectLockMode ??= 'governance'; next.objectLockRetentionDays ??= 30 }
      }
      if ('objectLockRetentionDays' in patch) {
        validate({ objectLockRetentionDays: !intIn(Number(patch.objectLockRetentionDays), 1, 36500) && 'Retention must be 1–36500 days' });
        if (b.objectLockMode === 'compliance' && Number(patch.objectLockRetentionDays) < (b.objectLockRetentionDays ?? 0)) throw new ApiError(409, 'Compliance mode retention can only be extended', 'immutable');
        next.objectLockRetentionDays = Number(patch.objectLockRetentionDays);
      }
      if ('objectLockMode' in patch) {
        if (b.objectLockMode === 'compliance' && patch.objectLockMode !== 'compliance') throw new ApiError(409, 'Compliance mode cannot be downgraded', 'immutable');
        next.objectLockMode = patch.objectLockMode;
      }
      if ('encryption' in patch) { validate({ encryption: !['none', 'SSE', 'SSE-KMS'].includes(patch.encryption) && 'Unknown encryption mode' }); next.encryption = patch.encryption }
      if ('access' in patch) {
        validate({ access: !['private', 'public-read'].includes(patch.access) && 'Unknown access mode' });
        if (patch.access === 'public-read' && b.access !== 'public-read' && !patch.acknowledgePublic) throw new ApiError(422, 'Making a bucket public exposes every object to the internet. Confirm with acknowledgePublic: true.', 'validation_failed', { access: 'Acknowledge public access' });
        next.access = patch.access;
      }
      if ('quotaGB' in patch) {
        const q = patch.quotaGB == null || patch.quotaGB === '' ? null : Number(patch.quotaGB);
        validate({ quotaGB: q != null && (!(q >= 1 && q <= 1_000_000) ? 'Quota must be 1 GB – 1 PB' : q * GB < b.bytesUsed && `Quota is below current usage (${(b.bytesUsed / GB).toFixed(1)} GB)`) });
        next.quotaGB = q;
      }
      if ('lifecycleRules' in patch) next.lifecycleRules = validateLifecycle(patch.lifecycleRules, next.storageClass);
      if ('cors' in patch) next.cors = validateCors(patch.cors);
      if ('tags' in patch) { checkRequiredTags(b.projectId, patch.tags); next.tags = patch.tags }
      if ('description' in patch) next.description = String(patch.description ?? '');
      if ('name' in patch && patch.name !== b.name) throw new ApiError(422, 'Buckets cannot be renamed. Create a new bucket and copy the objects.', 'validation_failed', { name: 'Immutable' });
      return next;
    },
    remove: (ctx, b) => {
      if (b.status === 'deleting') throw new ApiError(409, 'Bucket is already being deleted', 'invalid_state');
      const force = ctx.query.get('force') === 'true';
      const rows = objectsIn(b.id);
      const count = Math.max(b.objectCount, rows.filter((o) => !o.key.endsWith('/')).length);
      if (count > 0 && !force) throw new ApiError(409, `Bucket ${b.name} is not empty (${count.toLocaleString()} objects). Empty it first or delete with force.`, 'bucket_not_empty');
      if (count > 0 && b.objectLock) {
        const locked = rows.find((o) => o.retainUntil && Date.parse(o.retainUntil) > Date.now());
        if (locked || b.objectLockMode === 'compliance') throw new ApiError(409, `Object lock (${b.objectLockMode}) protects objects in ${b.name}; it cannot be force-deleted until retention expires.`, 'object_locked');
      }
      if (count === 0) {
        for (const o of rows) db.remove('bucketObjects', o.id);
        for (const k of db.filter<AccessKey>('accessKeys', (x) => Array.isArray(x.bucketIds) && x.bucketIds.includes(b.id))) db.update<AccessKey>('accessKeys', k.id, { bucketIds: (k.bucketIds as string[]).filter((x) => x !== b.id) });
        return 'deleted';
      }
      transition({
        collection: 'buckets', id: b.id, kind: 'bucket', name: b.name, type: 'bucket.delete', title: `Delete bucket ${b.name}`, during: { status: 'deleting' },
        steps: [
          { name: 'Block new writes', ms: 500, logs: ['bucket policy: deny s3:PutObject'] },
          { name: `Delete ${count.toLocaleString()} objects`, ms: Math.min(5000, 1200 + count / 400), logs: ['bulk delete in batches of 1000', `${count.toLocaleString()} objects removed`, b.versioning ? 'noncurrent versions & delete markers purged' : 'no versions to purge'] },
          { name: 'Remove bucket & release name', ms: 600, logs: ['index shards removed', `name "${b.name}" released`] },
        ],
        onComplete: 'bucket.deleted', payload: { id: b.id }, scope: { accountId: b.accountId, projectId: b.projectId }, actor: ctx.actor, silent: false,
      });
      return 'async';
    },
    actions: {
      setAccess: (_ctx, b, body) => {
        if (!['private', 'public-read'].includes(body.access)) throw new ApiError(422, 'Unknown access mode', 'validation_failed', { access: 'Invalid' });
        if (body.access === 'public-read' && !body.acknowledgePublic) throw new ApiError(422, 'Confirm public access with acknowledgePublic: true', 'validation_failed', { access: 'Acknowledge public access' });
        db.update('buckets', b.id, { access: body.access } as any);
      },
      presign: (_ctx, b, body) => {
        requireActive(b);
        const key = checkKey(body.key);
        const method = (body.method ?? 'GET').toUpperCase();
        if (!['GET', 'PUT'].includes(method)) throw new ApiError(422, 'Presigned URLs support GET or PUT', 'validation_failed', { method: 'GET or PUT' });
        if (method === 'GET' && !db.find<BucketObject>('bucketObjects', (o) => o.bucketId === b.id && o.key === key)) throw new ApiError(404, `Object ${key} not found`, 'not_found');
        const expiresIn = Number(body.expiresIn ?? 3600);
        if (!intIn(expiresIn, 60, 7 * 86400)) throw new ApiError(422, 'Expiry must be between 1 minute and 7 days', 'validation_failed', { expiresIn: '60–604800 s' });
        const now = new Date();
        const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        const keyId = db.find<AccessKey>('accessKeys', (k) => k.projectId === b.projectId && k.status === 'active')?.accessKeyId ?? 'AUTKCONSOLE0000';
        const params = new URLSearchParams({
          'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${keyId}/${amzDate.slice(0, 8)}/${b.locationId}/s3/aws4_request`, 'X-Amz-Date': amzDate,
          'X-Amz-Expires': String(expiresIn), 'X-Amz-SignedHeaders': 'host', 'X-Amz-Signature': randomHex(64),
        });
        const url = `${b.endpoint}/${key.split('/').map(encodeURIComponent).join('/')}?${params.toString()}`;
        return { url, method, key, expiresIn, expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString() };
      },
      deleteObjects: (_ctx, b, body) => {
        requireActive(b);
        const rows = expandKeys(b.id, Array.isArray(body.keys) ? body.keys : []);
        if (!rows.length) throw new ApiError(404, 'No matching objects', 'not_found');
        const res = removeObjects(b, rows);
        return { ok: true, ...res };
      },
      copyObjects: (ctx, b, body) => { requireActive(b); return relocate(ctx, b, body) },
      moveObjects: (ctx, b, body) => { requireActive(b); return relocate(ctx, b, body, true) },
      renameObject: (_ctx, b, body) => {
        requireActive(b);
        const key = checkKey(body.key);
        const newKey = checkKey(body.newKey, 'newKey');
        if (key.endsWith('/') !== newKey.endsWith('/')) throw new ApiError(422, 'Folders must stay folders (end with "/")', 'validation_failed', { newKey: 'Keep trailing /' });
        if (key === newKey) throw new ApiError(422, 'New name is the same as the old one', 'validation_failed', { newKey: 'Unchanged' });
        if (!key.endsWith('/') && db.find<BucketObject>('bucketObjects', (o) => o.bucketId === b.id && o.key === newKey)) throw new ApiError(409, `An object named ${newKey} already exists`, 'conflict', { newKey: 'Already exists' });
        const rows = expandKeys(b.id, [key]);
        if (!rows.length) throw new ApiError(404, `Object ${key} not found`, 'not_found');
        if (b.objectLock) for (const o of rows) checkRetention(o, 'renamed');
        for (const o of rows) db.update<BucketObject>('bucketObjects', o.id, { key: newKey + o.key.slice(key.length), name: newKey + o.key.slice(key.length), lastModified: nowIso() });
        return { ok: true, key: newKey, count: rows.length };
      },
      empty: (_ctx, b) => {
        requireActive(b);
        const rows = objectsIn(b.id);
        const res = removeObjects(b, rows);
        db.update('buckets', b.id, { bytesUsed: 0, objectCount: 0 } as any);
        return { ok: true, ...res };
      },
    },
  });

  defineCollection<BucketObject>({
    name: 'bucketObjects', kind: 'bucket', idPrefix: 'obj',
    searchText: (o) => `${o.key} ${o.contentType}`,
    subtitle: (o) => `Object in ${db.get<Bucket>('buckets', o.bucketId)?.name ?? o.bucketId} · ${o.contentType}`,
    link: (o) => {
      const i = o.key.lastIndexOf('/', o.key.length - 2);
      const prefix = i >= 0 ? o.key.slice(0, i + 1) : '';
      return `/managed-services/object-storage/${o.bucketId}?${new URLSearchParams({ ...(prefix ? { prefix } : {}), object: o.key }).toString()}`;
    },
    update: (_ctx, o, patch) => {
      const next = { ...o };
      if ('tags' in patch) next.tags = patch.tags;
      if ('storageClass' in patch) { validate({ storageClass: !CLASSES.includes(patch.storageClass) && 'Unknown storage class' }); next.storageClass = patch.storageClass }
      if ('contentType' in patch) next.contentType = String(patch.contentType);
      return next;
    },
    remove: (_ctx, o) => {
      const b = db.get<Bucket>('buckets', o.bucketId);
      if (b) removeObjects(b, [o]);
      return 'async'; // already removed above (prevents double delete)
    },
  });

  defineCollection<AccessKey>({
    name: 'accessKeys', kind: 'accessKey', idPrefix: 'ak',
    searchText: (k) => `${k.id} ${k.name} ${k.accessKeyId} ${k.permission} ${k.status}`,
    subtitle: (k) => `S3 access key · ${k.accessKeyId} · ${k.permission}`,
    link: () => '/managed-services/object-storage?tab=keys',
    update: (_ctx, k, patch) => {
      const next = { ...k };
      if ('name' in patch) { validate({ name: !String(patch.name ?? '').trim() && 'Name is required' }); next.name = String(patch.name).trim() }
      if ('description' in patch) next.description = patch.description;
      if ('bucketIds' in patch || 'permission' in patch) {
        if (k.status === 'revoked') throw new ApiError(409, 'Revoked keys cannot be changed', 'invalid_state');
        Object.assign(next, validateKeyScope(k.projectId, { bucketIds: patch.bucketIds ?? k.bucketIds, permission: patch.permission ?? k.permission }));
      }
      return next;
    },
    actions: {
      revoke: (_ctx, k) => {
        if (k.status === 'revoked') throw new ApiError(409, 'Key is already revoked', 'invalid_state');
        db.update('accessKeys', k.id, { status: 'revoked' } as any);
      },
      rotate: (_ctx, k) => {
        if (k.status === 'revoked') throw new ApiError(409, 'Revoked keys cannot be rotated — create a new key', 'invalid_state');
        const secret = genSecret();
        const row = db.update<AccessKey>('accessKeys', k.id, { accessKeyId: genKeyId(), secretMasked: mask(secret), createdAt: nowIso(), lastUsed: null });
        return { ...row, secretAccessKey: secret };
      },
    },
  });

  /** Create an access key — the secret is returned ONLY in this response. */
  route('POST', '/accessKeys', (ctx) => {
    const body = ctx.body ?? {};
    const sc = scopeFor(ctx, body);
    validate({ name: !String(body.name ?? '').trim() ? 'Name is required' : String(body.name).length > 64 && 'Name is at most 64 characters' });
    const scope = validateKeyScope(sc.projectId, body);
    if (db.filter<AccessKey>('accessKeys', (k) => k.projectId === sc.projectId && k.status === 'active').length >= 25) throw new ApiError(422, 'At most 25 active access keys per project', 'quota_exceeded');
    const secret = genSecret();
    const key: AccessKey = {
      id: newId('ak'), name: String(body.name).trim(), ...sc, accessKeyId: genKeyId(), secretMasked: mask(secret), ...scope,
      createdAt: nowIso(), lastUsed: null, status: 'active', expiresAt: body.expiresAt ?? null, description: body.description ?? '', tags: body.tags ?? [],
    };
    db.insert('accessKeys', key as any);
    audit(ctx, 'accessKey.create', { type: 'accessKey', id: key.id, name: key.name }, { accountId: key.accountId, projectId: key.projectId, details: `${key.permission} on ${key.bucketIds === '*' ? 'all buckets' : key.bucketIds.length + ' bucket(s)'}` });
    return { ...key, secretAccessKey: secret };
  }, 'Create an S3 access key (secret returned once)');

  /** Bucket name availability (global namespace). */
  route('GET', '/buckets/name-available', (ctx) => {
    const name = ctx.query.get('name') ?? '';
    const err = bucketNameError(name);
    return { name, available: !err, reason: err };
  }, 'Check whether a bucket name is available');

  /** List objects with folder semantics (delimiter "/"). */
  route('GET', '/buckets/:id/objects', (ctx) => {
    const b = getOr404<Bucket>('buckets', ctx.params.id, 'Bucket');
    return listObjects(b, ctx.query.get('prefix') ?? '', ctx.query.get('q') ?? undefined);
  }, 'List objects in a bucket (?prefix=&q=)');

  /** Upload (metadata + optional small inline content). */
  route('POST', '/buckets/:id/objects', (ctx) => {
    const b = getOr404<Bucket>('buckets', ctx.params.id, 'Bucket');
    requireActive(b);
    const body = ctx.body ?? {};
    const key = checkKey(body.key);
    if (key.endsWith('/')) throw new ApiError(422, 'Use POST /buckets/:id/folders to create folders', 'validation_failed', { key: 'Ends with /' });
    const size = Number(body.sizeBytes);
    validate({ sizeBytes: !(Number.isFinite(size) && size >= 0 && size <= 5 * 1024 ** 4) && 'Objects can be 0 B – 5 TB' });
    const obj = putObject(b, { key, sizeBytes: size, contentType: body.contentType, content: body.content, storageClass: body.storageClass, tags: body.tags });
    db.update<Bucket>('buckets', b.id, (x) => { x.requestsLast30d += 1; return x });
    audit(ctx, 'bucket.putObject', { type: 'bucket', id: b.id, name: b.name }, { accountId: b.accountId, projectId: b.projectId, details: `${key} (${size.toLocaleString()} B)` });
    const { content, ...meta } = obj;
    return { ...meta, hasContent: !!content };
  }, 'Upload an object');

  /** Create a "folder" (zero-byte marker object ending with "/"). */
  route('POST', '/buckets/:id/folders', (ctx) => {
    const b = getOr404<Bucket>('buckets', ctx.params.id, 'Bucket');
    requireActive(b);
    const prefix: string = ctx.body?.prefix ?? '';
    const name = String(ctx.body?.name ?? '').trim().replace(/\/+$/, '');
    validate({ name: !name ? 'Folder name is required' : /[/\\]/.test(name) ? 'Folder names cannot contain slashes' : name.length > 255 && 'Too long' });
    const key = checkKey(prefix + name + '/');
    if (objectsIn(b.id, key).length) throw new ApiError(409, `Folder ${name} already exists`, 'conflict', { name: 'Already exists' });
    const row: BucketObject = {
      id: newId('obj'), bucketId: b.id, accountId: b.accountId, projectId: b.projectId, key, name: key, sizeBytes: 0, contentType: 'application/x-directory', storageClass: b.storageClass,
      etag: '"d41d8cd98f00b204e9800998ecf8427e"', lastModified: nowIso(), createdAt: nowIso(), tags: [], versions: 1, retainUntil: null,
    };
    db.insert('bucketObjects', row as any);
    audit(ctx, 'bucket.createFolder', { type: 'bucket', id: b.id, name: b.name }, { accountId: b.accountId, projectId: b.projectId, details: key });
    return { ok: true, key };
  }, 'Create a folder');

  registerMetrics('bucket', (b: any, metric) => {
    if (!('bytesUsed' in b)) return null; // bucketObjects share the kind
    const bucket = b as Bucket;
    const gb = bucket.bytesUsed / GB;
    const rps = bucket.requestsLast30d / (30 * 86400);
    const egressMBs = (bucket.egressGBLast30d * 1024) / (30 * 86400);
    const off = bucket.status === 'creating';
    const growth = bucket.lifecycleRules.some((r) => r.enabled && r.action === 'expire') ? 0.04 : 0.18;
    switch (metric) {
      case 'storage': return { unit: 'GB', base: gb * (1 - growth), amp: gb * 0.004, trend: gb * growth, min: 0 };
      case 'objects': return { unit: '', base: bucket.objectCount * (1 - growth), amp: bucket.objectCount * 0.002, trend: bucket.objectCount * growth, min: 0 };
      case 'requests': return { unit: 'req/s', base: rps || 0.02, amp: (rps || 0.02) * 0.5, diurnal: 0.45, spikiness: 0.3, off };
      case 'getRequests': return { unit: 'req/s', base: (rps || 0.02) * 0.82, amp: (rps || 0.02) * 0.4, diurnal: 0.45, spikiness: 0.3, off };
      case 'putRequests': return { unit: 'req/s', base: (rps || 0.02) * 0.16, amp: (rps || 0.02) * 0.1, diurnal: 0.3, spikiness: 0.5, off };
      case 'egress': return { unit: 'MB/s', base: egressMBs || 0.01, amp: (egressMBs || 0.01) * 0.6, diurnal: 0.5, spikiness: 0.3, off };
      case 'latency': return { unit: 'ms', base: bucket.storageClass === 'ARCHIVE' ? 180 : bucket.storageClass === 'INFREQUENT' ? 38 : 14, amp: 6, spikiness: 0.3, off };
      case 'errors': return { unit: '%', base: bucket.access === 'public-read' ? 0.8 : 0.15, amp: 0.2, max: 100, spikiness: 0.4, off };
      default: return null;
    }
  });
}
