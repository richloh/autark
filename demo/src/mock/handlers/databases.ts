import { db } from '../db';
import { defineCollection, route, ApiError, validate, nameError, uniqueNameError, scopeFor, newId, nowIso, getOr404, detachEverywhere, audit, DAY, MIN, type Ctx } from '../framework';
import { startOperation, onOperationComplete, transition, type StepSpec } from '../operations';
import { registerMetrics } from '../metrics';
import { locationOrThrow, checkQuota, checkRequiredTags, checkLocationAllowed, setFirewalls, nextPrivateIp, allowanceFor, pickHost } from './shared';
import { dbMonthly } from './costs';
import { dbCost } from '@/lib/pricing';
import type { DbInstance, DbPreset, DbBackup, DbEngine, DbEngineSpec, DbParamSpec, DbUser, Network, Firewall, Location, BareMetalHost, DnsZone } from '@/types';

/* Managed databases (PostgreSQL, MySQL, MariaDB, Redis): provisioning, HA, replicas, backups & PITR,
 * users/databases, parameters, upgrades, failover, scaling. */

const ms = (n: number) => n * 1000;

/* ------------------------------------------------------------------------------------------------
 * Engine catalog
 * ---------------------------------------------------------------------------------------------- */

const P = (name: string, type: DbParamSpec['type'], def: string, restart: boolean, description: string, extra: Partial<DbParamSpec> = {}): DbParamSpec =>
  ({ name, type, default: def, restart, description, ...extra });

export const DB_ENGINES: DbEngineSpec[] = [
  {
    id: 'postgres', label: 'PostgreSQL', defaultPort: 5432, adminUser: 'postgres', supportsPitr: true, supportsDatabases: true, supportsReplicas: true, pooler: 'PgBouncer',
    description: 'The most advanced open-source relational database. Extensions: PostGIS, pgvector, TimescaleDB.',
    versions: [{ version: '17', default: true }, { version: '16' }, { version: '15' }, { version: '14', eol: '2026-11-12' }, { version: '13', eol: '2025-11-13', deprecated: true }],
    parameters: [
      P('max_connections', 'int', '200', true, 'Maximum concurrent connections (PgBouncer pools in front).', { min: 20, max: 5000 }),
      P('shared_buffers', 'size', '25%', true, 'Memory for shared page cache. Typically 25% of RAM.'),
      P('work_mem', 'size', '4MB', false, 'Memory per sort / hash operation before spilling to disk.'),
      P('maintenance_work_mem', 'size', '256MB', false, 'Memory for VACUUM, CREATE INDEX, ALTER TABLE.'),
      P('effective_cache_size', 'size', '75%', false, 'Planner hint for OS + PG cache size.'),
      P('log_min_duration_statement', 'int', '-1', false, 'Log statements slower than this (-1 disables).', { min: -1, max: 600000, unit: 'ms' }),
      P('statement_timeout', 'int', '0', false, 'Abort statements running longer than this (0 = off).', { min: 0, max: 86400000, unit: 'ms' }),
      P('idle_in_transaction_session_timeout', 'int', '0', false, 'Terminate idle-in-transaction sessions.', { min: 0, max: 86400000, unit: 'ms' }),
      P('wal_level', 'enum', 'replica', true, 'WAL detail level; logical enables logical replication / CDC.', { options: ['replica', 'logical'] }),
      P('max_wal_size', 'size', '2GB', false, 'Soft limit for WAL growth between checkpoints.'),
      P('random_page_cost', 'string', '1.1', false, 'Planner cost of a non-sequential page fetch (1.1 for NVMe).'),
      P('autovacuum', 'bool', 'on', false, 'Run the autovacuum launcher.'),
      P('timezone', 'string', 'UTC', false, 'Default session time zone.'),
    ],
  },
  {
    id: 'mysql', label: 'MySQL', defaultPort: 3306, adminUser: 'root', supportsPitr: true, supportsDatabases: true, supportsReplicas: true, pooler: 'ProxySQL',
    description: 'The world’s most popular open-source database, InnoDB with GTID replication.',
    versions: [{ version: '8.4', default: true }, { version: '8.0', eol: '2026-04-30' }, { version: '5.7', eol: '2023-10-31', deprecated: true }],
    parameters: [
      P('max_connections', 'int', '151', false, 'Maximum permitted simultaneous client connections.', { min: 20, max: 10000 }),
      P('innodb_buffer_pool_size', 'size', '70%', true, 'Memory for caching InnoDB data and indexes.'),
      P('innodb_log_file_size', 'size', '512M', true, 'Size of each redo log file.'),
      P('long_query_time', 'int', '10', false, 'Queries slower than this are written to the slow log.', { min: 0, max: 3600, unit: 's' }),
      P('slow_query_log', 'bool', 'off', false, 'Enable the slow query log.'),
      P('wait_timeout', 'int', '28800', false, 'Seconds a non-interactive connection may idle.', { min: 1, max: 31536000, unit: 's' }),
      P('character_set_server', 'enum', 'utf8mb4', true, 'Default server character set.', { options: ['utf8mb4', 'latin1', 'utf8mb3'] }),
      P('sql_mode', 'string', 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION', false, 'SQL modes affecting syntax and validation.'),
      P('binlog_expire_logs_seconds', 'int', '604800', false, 'Binary log retention (also bounds PITR window).', { min: 3600, max: 4294967295, unit: 's' }),
    ],
  },
  {
    id: 'mariadb', label: 'MariaDB', defaultPort: 3306, adminUser: 'root', supportsPitr: true, supportsDatabases: true, supportsReplicas: true, pooler: 'MaxScale',
    description: 'Community-developed MySQL fork with Galera, thread pool and system-versioned tables.',
    versions: [{ version: '11.4', default: true }, { version: '10.11' }, { version: '10.6', eol: '2026-07-06' }],
    parameters: [
      P('max_connections', 'int', '151', false, 'Maximum permitted simultaneous client connections.', { min: 20, max: 10000 }),
      P('innodb_buffer_pool_size', 'size', '70%', true, 'Memory for caching InnoDB data and indexes.'),
      P('thread_pool_size', 'int', '8', true, 'Number of thread groups in the thread pool.', { min: 1, max: 128 }),
      P('long_query_time', 'int', '10', false, 'Queries slower than this are written to the slow log.', { min: 0, max: 3600, unit: 's' }),
      P('slow_query_log', 'bool', 'off', false, 'Enable the slow query log.'),
      P('wait_timeout', 'int', '28800', false, 'Seconds a non-interactive connection may idle.', { min: 1, max: 31536000, unit: 's' }),
      P('query_cache_type', 'enum', 'OFF', true, 'Query cache mode.', { options: ['OFF', 'ON', 'DEMAND'] }),
    ],
  },
  {
    id: 'redis', label: 'Redis', defaultPort: 6379, adminUser: 'default', supportsPitr: false, supportsDatabases: false, supportsReplicas: true,
    description: 'In-memory key-value store for caches, queues, sessions and feature stores. ACL users, AOF persistence.',
    versions: [{ version: '7.4', default: true }, { version: '7.2' }, { version: '6.2', eol: '2025-02-28', deprecated: true }],
    parameters: [
      P('maxmemory-policy', 'enum', 'noeviction', false, 'Eviction policy when maxmemory is reached.', { options: ['noeviction', 'allkeys-lru', 'volatile-lru', 'allkeys-lfu', 'volatile-lfu', 'allkeys-random', 'volatile-ttl'] }),
      P('appendonly', 'bool', 'yes', false, 'Enable AOF persistence.'),
      P('appendfsync', 'enum', 'everysec', false, 'AOF fsync policy.', { options: ['always', 'everysec', 'no'] }),
      P('timeout', 'int', '0', false, 'Close idle client connections after N seconds (0 = never).', { min: 0, max: 86400, unit: 's' }),
      P('maxclients', 'int', '10000', true, 'Maximum number of connected clients.', { min: 100, max: 65000 }),
      P('io-threads', 'int', '1', true, 'Threads for network I/O.', { min: 1, max: 16 }),
      P('notify-keyspace-events', 'string', '', false, 'Keyspace notification classes (e.g. Ex).'),
    ],
  },
];

export const engineSpec = (e: string) => DB_ENGINES.find((x) => x.id === e);

const ADMIN_NAMES = new Set(['postgres', 'root', 'default', 'admin', 'replicator', 'pgbouncer', 'autark', 'mysql.sys', 'rdsadmin']);
const IDENT_RE = /^[a-z_][a-z0-9_]{0,62}$/;

function generatePassword(len = 24) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

function parseSizeMB(v: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(kB|KB|K|MB|M|GB|G|TB|T)?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const u = (m[2] ?? 'MB').toUpperCase();
  return u.startsWith('K') ? n / 1024 : u.startsWith('M') ? n : u.startsWith('G') ? n * 1024 : n * 1024 * 1024;
}

function versionNum(v: string) { const [a, b = '0'] = v.split('.'); return Number(a) * 1000 + Number(b) }

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------- */

const isLive = (d: DbInstance) => !['stopped', 'error', 'provisioning', 'deleting'].includes(d.status);

function requireStatus(d: DbInstance, allowed: DbInstance['status'][], verb: string) {
  if (!allowed.includes(d.status)) throw new ApiError(409, `Cannot ${verb} while the database is ${d.status.replace(/-/g, ' ')}`, 'invalid_state');
}

function checkServiceAllowed(projectId: string, service: string, label: string) {
  const a = allowanceFor(projectId);
  if (a?.allowedServices?.length && !a.allowedServices.includes(service as never)) {
    throw new ApiError(422, `Service policy: ${label} are not enabled for this project`, 'service_policy');
  }
}

function resolveSize(body: any, engine: DbEngine): { presetId: string | null; vcpus: number; ramGB: number; presetStorage?: number } {
  if (body.presetId) {
    const p = db.get<DbPreset>('dbPresets', body.presetId);
    if (!p) throw new ApiError(422, 'Unknown size preset', 'validation_failed', { presetId: 'Unknown preset' });
    if (p.engine !== 'any' && p.engine !== engine) throw new ApiError(422, `Preset ${p.name} is for ${p.engine}`, 'validation_failed', { presetId: `Preset is for ${p.engine}` });
    return { presetId: p.id, vcpus: p.vcpus, ramGB: p.ramGB, presetStorage: p.storageGB };
  }
  const { vcpus, ramGB } = body;
  validate({
    vcpus: !(Number.isInteger(vcpus) && vcpus >= 1 && vcpus <= 64) && 'vCPUs must be between 1 and 64',
    ramGB: !(Number.isFinite(ramGB) && ramGB >= 1 && ramGB <= 512) && 'Memory must be between 1 and 512 GB',
  });
  return { presetId: null, vcpus, ramGB };
}

function primaryHostFor(locationId: string, vcpus: number, ramGB: number, exclude?: string | null): BareMetalHost | null {
  const loc = db.get<Location>('locations', locationId);
  if (loc?.kind !== 'selfHosted') return null;
  try { return pickHost(locationId, { vcpus, ramGB, gpus: 0 }, exclude ?? undefined) }
  catch { return db.find<BareMetalHost>('hosts', (h) => h.locationId === locationId && h.status === 'ready' && h.id !== exclude) ?? null }
}

function hostName(id?: string | null) { return id ? db.get<BareMetalHost>('hosts', id)?.name ?? id : 'provider node' }

function backupsOf(id: string) { return db.filter<DbBackup>('dbBackups', (b) => b.dbId === id) }

function dnsZoneFor(networkId: string): DnsZone | undefined {
  const net = db.get<Network>('networks', networkId);
  return net?.dnsZoneId ? db.get<DnsZone>('dnsZones', net.dnsZoneId) : undefined;
}

function registerDns(d: DbInstance) {
  const zone = dnsZoneFor(d.networkId);
  if (!zone || !d.privateIp) return;
  db.update<any>('dnsZones', zone.id, (z: DnsZone) => {
    z.records = z.records.filter((r) => !(r.managedBy?.type === 'db' && r.managedBy.id === d.id));
    z.records.push({ id: newId('rec'), type: 'A', name: `${d.name}.db`, value: d.privateIp!, ttl: 60, managedBy: { type: 'db', id: d.id } });
    z.serial = (z.serial ?? 0) + 1;
    return z;
  });
}

function unregisterDns(id: string) {
  for (const z of db.list<DnsZone>('dnsZones')) {
    if (z.records?.some((r) => r.managedBy?.type === 'db' && r.managedBy.id === id)) {
      db.update<any>('dnsZones', z.id, { records: z.records.filter((r) => !(r.managedBy?.type === 'db' && r.managedBy.id === id)), serial: (z.serial ?? 0) + 1 });
    }
  }
}

function insertBackup(d: DbInstance, type: DbBackup['type'], status: DbBackup['status'], name?: string): DbBackup {
  const b: DbBackup = {
    id: newId('dbb'), dbId: d.id, accountId: d.accountId, projectId: d.projectId, createdAt: nowIso(), type, status,
    name: name || `${d.name}-${type}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`,
    sizeGB: Math.max(0.1, Math.round(d.storageUsedGB * 0.32 * 10) / 10), tags: [], engine: d.engine, version: d.version, sourceName: d.name,
  };
  db.insert('dbBackups', b as any);
  return b;
}

/* ------------------------------------------------------------------------------------------------
 * Parameter validation
 * ---------------------------------------------------------------------------------------------- */

function validateParameters(d: Pick<DbInstance, 'engine' | 'size'>, params: Record<string, unknown>): { clean: Record<string, string>; restart: string[] } {
  const spec = engineSpec(d.engine)!;
  const errors: Record<string, string> = {};
  const clean: Record<string, string> = {};
  const restart: string[] = [];
  const ramMB = d.size.ramGB * 1024;
  for (const [name, raw] of Object.entries(params)) {
    const p = spec.parameters.find((x) => x.name === name);
    if (!p) { errors[name] = `Unknown ${spec.label} parameter "${name}"`; continue }
    const v = String(raw ?? '').trim();
    if (p.type === 'int') {
      const n = Number(v);
      if (!/^-?\d+$/.test(v)) errors[name] = 'Must be an integer';
      else if ((p.min != null && n < p.min) || (p.max != null && n > p.max)) errors[name] = `Must be between ${p.min} and ${p.max}${p.unit ? ` ${p.unit}` : ''}`;
    } else if (p.type === 'size') {
      if (/^\d{1,2}%$/.test(v)) { if (Number(v.slice(0, -1)) > 80) errors[name] = 'At most 80% of RAM' }
      else {
        const mb = parseSizeMB(v);
        if (mb == null) errors[name] = 'Use a size like 512MB, 4GB or 25%';
        else if ((name === 'shared_buffers' || name === 'innodb_buffer_pool_size') && mb > ramMB * 0.8) errors[name] = `Exceeds 80% of instance memory (${d.size.ramGB} GB)`;
        else if (name === 'work_mem' && mb > ramMB / 4) errors[name] = 'work_mem above 25% of RAM risks OOM under concurrency';
      }
    } else if (p.type === 'enum') {
      if (!p.options!.includes(v)) errors[name] = `One of: ${p.options!.join(', ')}`;
    } else if (p.type === 'bool') {
      if (!['on', 'off', 'yes', 'no', 'true', 'false', '1', '0'].includes(v.toLowerCase())) errors[name] = 'Must be on or off';
    }
    if (!errors[name]) { clean[name] = v; if (p.restart) restart.push(name) }
  }
  validate(errors);
  return { clean, restart };
}

/* ------------------------------------------------------------------------------------------------
 * Create & provisioning
 * ---------------------------------------------------------------------------------------------- */

function provisionSteps(d: DbInstance, opts: { loc: Location; standbyHost: string | null; restore?: { label: string; pitr?: string }; firstBackup: boolean; initialDb?: string; initialUser?: string }): StepSpec[] {
  const spec = engineSpec(d.engine)!;
  const eng = `${spec.label} ${d.version}`;
  const steps: StepSpec[] = [
    { name: 'Validate request & reserve quota', ms: ms(0.7), logs: [`project ${d.projectId}: dbInstances quota ok`, 'policy checks passed (tags, location, services)'] },
  ];
  if (opts.loc.kind === 'selfHosted') {
    steps.push({ name: `Schedule primary on ${hostName(d.primaryHostId)}`, ms: ms(1), logs: [`reserving ${d.size.vcpus} vCPU / ${d.size.ramGB} GiB`, `allocating ${d.storageGB} GB NVMe volume (ceph pool db-nvme, 3× replicated)`] });
  } else {
    steps.push({ name: `Request capacity from ${opts.loc.name}`, ms: ms(1.8), logs: [`POST provider API /servers (region ${opts.loc.region})`, 'server allocated'] });
  }
  const init: Record<DbEngine, string[]> = {
    postgres: [`installing postgresql-${d.version}`, `initdb --data-checksums --encoding=UTF8 -D /var/lib/postgresql/${d.version}/main`, `shared_buffers=${Math.max(1, Math.round(d.size.ramGB / 4))}GB effective_cache_size=${Math.round(d.size.ramGB * 0.75)}GB`, 'postgres listening on :5432'],
    mysql: [`installing mysql-server-${d.version}`, 'mysqld --initialize-insecure --datadir=/var/lib/mysql', `innodb_buffer_pool_size=${Math.max(1, Math.round(d.size.ramGB * 0.7))}G gtid_mode=ON`, 'mysqld ready for connections on :3306'],
    mariadb: [`installing mariadb-server-${d.version}`, 'mariadb-install-db --datadir=/var/lib/mysql', `innodb_buffer_pool_size=${Math.max(1, Math.round(d.size.ramGB * 0.7))}G thread_handling=pool-of-threads`, 'mariadbd ready for connections on :3306'],
    redis: [`installing redis-server ${d.version}`, `maxmemory ${Math.round(d.size.ramGB * 0.85 * 1024)}mb, appendonly yes, appendfsync everysec`, 'ACL default user configured', 'Ready to accept connections tcp :6379'],
  };
  steps.push({ name: `Provision primary (${eng})`, ms: ms(2.2), logs: init[d.engine] });
  if (opts.restore) {
    steps.push({ name: opts.restore.pitr ? `Restore base backup & replay WAL to ${opts.restore.pitr}` : `Restore data from ${opts.restore.label}`, ms: ms(2.6), logs: [
      `fetching ${opts.restore.label} from object storage (encrypted, zstd)`, 'verifying checksums', ...(opts.restore.pitr ? [`recovery_target_time = '${opts.restore.pitr}'`, 'replaying WAL segments…', 'recovery target reached, promoting'] : ['restore complete']),
    ] });
  }
  if (d.ha) {
    const repl: Record<DbEngine, string[]> = {
      postgres: [`pg_basebackup -h ${d.privateIp} -X stream`, 'primary_conninfo set, synchronous_standby_names = ANY 1 (standby)', 'standby streaming, lag 0 bytes', 'Patroni cluster formed (etcd DCS)'],
      mysql: ['CLONE INSTANCE FROM primary', 'CHANGE REPLICATION SOURCE ... SOURCE_AUTO_POSITION=1', 'rpl_semi_sync enabled', 'Orchestrator registered topology'],
      mariadb: ['mariabackup --stream to standby', 'CHANGE MASTER ... MASTER_USE_GTID=slave_pos', 'semi-sync replication enabled', 'MaxScale monitor registered'],
      redis: ['replicaof primary 6379', 'full sync: RDB transferred', 'Redis Sentinel quorum 2/3 configured', 'failover-timeout 10000'],
    };
    steps.push({ name: `Provision standby on ${opts.standbyHost ?? 'second failure domain'}`, ms: ms(1.8), logs: [`anti-affinity: different host & rack from primary`, `standby ${d.size.vcpus} vCPU / ${d.size.ramGB} GiB`] });
    steps.push({ name: d.engine === 'redis' ? 'Configure replication & Sentinel' : 'Configure streaming replication', ms: ms(1.6), logs: repl[d.engine] });
  }
  if (d.readReplicas > 0) {
    steps.push({ name: `Create ${d.readReplicas} read replica${d.readReplicas > 1 ? 's' : ''}`, ms: ms(1.4 + d.readReplicas * 0.5), logs: Array.from({ length: d.readReplicas }, (_, i) => `replica-${i + 1}: async replication started (${d.name}-replica-${i + 1}.db.${d.locationId}.autark.internal)`) });
  }
  if (spec.pooler) steps.push({ name: `Deploy ${spec.pooler} connection pooler`, ms: ms(0.8), logs: [d.engine === 'postgres' ? 'pgbouncer pool_mode=transaction default_pool_size=40' : `${spec.pooler} health monitor attached`, 'pooler listening'] });
  steps.push({ name: 'Issue TLS certificates', ms: ms(0.7), logs: ['internal CA: autark-db-ca', `CN=${d.host}`, 'ssl = on, min protocol TLSv1.2'] });
  if (spec.supportsDatabases && (opts.initialDb || opts.initialUser)) {
    steps.push({ name: 'Create initial database & user', ms: ms(0.6), logs: [...(opts.initialUser ? [`CREATE ROLE ${opts.initialUser} LOGIN`] : []), ...(opts.initialDb ? [`CREATE DATABASE ${opts.initialDb} OWNER ${opts.initialUser ?? spec.adminUser}`] : [])] });
  }
  const zone = dnsZoneFor(d.networkId);
  steps.push({ name: 'Register DNS', ms: ms(0.6), logs: [`${d.host} A ${d.privateIp}`, ...(zone ? [`private zone ${zone.name}: ${d.name}.db A ${d.privateIp}`] : []), ...(d.publicHost ? [`${d.publicHost} → public endpoint`] : [])] });
  steps.push({ name: 'Apply firewalls', ms: ms(0.5), logs: [`${d.firewallIds.length} firewall(s) compiled`, d.publicAccess ? 'public endpoint enabled (TLS required)' : 'private network only'] });
  if (opts.firstBackup) steps.push({ name: 'Take first backup', ms: ms(1.4), logs: [d.engine === 'postgres' ? 'pgBackRest full backup → s3://autark-db-backups' : d.engine === 'redis' ? 'BGSAVE → RDB snapshot uploaded' : 'xtrabackup full backup uploaded', ...(d.backups.pitr ? ['continuous WAL/binlog archiving enabled'] : [])] });
  steps.push({ name: 'Health check', ms: ms(0.6), logs: ['TCP + TLS handshake ok', d.engine === 'redis' ? 'PING → PONG' : 'SELECT 1 → ok', 'database is available'] });
  return steps;
}

export function createDb(ctx: Ctx, body: any): DbInstance {
  const sc = scopeFor(ctx, body);
  const spec = engineSpec(body.engine);
  if (!spec) throw new ApiError(422, 'Choose a database engine', 'validation_failed', { engine: 'Choose postgres, mysql, mariadb or redis' });
  const version = body.version ?? spec.versions.find((v) => v.default)?.version;
  const ver = spec.versions.find((v) => v.version === version);
  const size = resolveSize(body, spec.id);
  const storageGB = body.storageGB ?? size.presetStorage ?? 50;
  const loc = locationOrThrow(body.locationId);
  const net = db.get<Network>('networks', body.networkId);
  const backups = { enabled: body.backups?.enabled ?? true, schedule: body.backups?.schedule ?? 'daily', retention: body.backups?.retention ?? 7, pitr: !!body.backups?.pitr, window: body.backups?.window ?? '02:00-03:00' };
  const readReplicas = body.readReplicas ?? 0;
  const fwIds: string[] = body.firewallIds ?? [];
  validate({
    name: nameError(body.name) || uniqueNameError('dbInstances', body.name, sc),
    version: !ver ? `Unsupported ${spec.label} version` : ver.deprecated && !body.allowDeprecated && `${spec.label} ${ver.version} is end-of-life; choose a supported version`,
    storageGB: !(Number.isInteger(storageGB) && storageGB >= 10 && storageGB <= 16384) ? 'Storage must be 10–16384 GB' : spec.id === 'redis' && storageGB < size.ramGB && `Redis persistence needs storage ≥ memory (${size.ramGB} GB)`,
    readReplicas: !(Number.isInteger(readReplicas) && readReplicas >= 0 && readReplicas <= 5) ? 'Read replicas must be 0–5' : !spec.supportsReplicas && readReplicas > 0 && 'Replicas not supported',
    networkId: !net ? 'Choose a network' : net.projectId !== sc.projectId ? 'Network belongs to another project' : net.locationId !== loc.id && `Network ${net.name} is in ${net.locationId}; pick a network in ${loc.id}`,
    subnetId: net && !net.subnets.some((s) => s.id === body.subnetId) && 'Choose a subnet',
    firewallIds: fwIds.some((id) => db.get<Firewall>('firewalls', id)?.projectId !== sc.projectId) && 'Firewalls must belong to the same project',
    'backups.retention': !(Number.isInteger(backups.retention) && backups.retention >= 1 && backups.retention <= 35) && 'Retention must be 1–35 days',
    'backups.pitr': backups.pitr && (!spec.supportsPitr ? `${spec.label} does not support point-in-time recovery` : !backups.enabled && 'PITR requires automated backups'),
    'backups.window': !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(backups.window) && 'Use HH:MM-HH:MM',
    maintenanceWindow: body.maintenanceWindow && !(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(body.maintenanceWindow.day) && Number.isInteger(body.maintenanceWindow.hour) && body.maintenanceWindow.hour >= 0 && body.maintenanceWindow.hour <= 23) && 'Invalid maintenance window',
    initialDatabase: body.initialDatabase && (!spec.supportsDatabases ? 'Redis uses numbered logical databases (db0–db15)' : !IDENT_RE.test(body.initialDatabase) && 'Lowercase letters, digits and underscores; must start with a letter'),
    initialUser: body.initialUser && (!IDENT_RE.test(body.initialUser) ? 'Lowercase letters, digits and underscores' : ADMIN_NAMES.has(body.initialUser) && `"${body.initialUser}" is reserved`),
  });
  checkServiceAllowed(sc.projectId, 'db', 'managed databases');
  checkLocationAllowed(sc.projectId, loc.id);
  checkRequiredTags(sc.projectId, body.tags);
  checkQuota(sc.projectId, { dbInstances: 1 });

  const primary = primaryHostFor(loc.id, size.vcpus, size.ramGB);
  const standby = body.ha ? primaryHostFor(loc.id, size.vcpus, size.ramGB, primary?.id) : null;
  const now = nowIso();
  const users: DbUser[] = [{ username: spec.adminUser, role: 'owner', createdAt: now }];
  if (body.initialUser) users.push({ username: body.initialUser, role: 'owner', createdAt: now });
  const databases = spec.supportsDatabases
    ? (body.initialDatabase ? [{ name: body.initialDatabase, owner: body.initialUser || spec.adminUser, sizeMB: 8, encoding: spec.id === 'postgres' ? 'UTF8' : 'utf8mb4', createdAt: now }] : [])
    : [{ name: 'db0', owner: 'default', sizeMB: 0 }];
  const id = newId('db');
  const host = `${body.name}.db.${loc.id}.autark.internal`;
  const row: DbInstance = {
    id, name: body.name, ...sc, engine: spec.id, version: ver!.version, status: 'provisioning',
    size: { presetId: size.presetId, vcpus: size.vcpus, ramGB: size.ramGB }, storageGB, storageUsedGB: body.restoreFrom ? body.restoreFrom.usedGB ?? 1 : 0.1, storageAutoscale: body.storageAutoscale ?? true,
    ha: !!body.ha, readReplicas, locationId: loc.id, networkId: net!.id, subnetId: body.subnetId, firewallIds: [], host, port: spec.defaultPort,
    privateIp: nextPrivateIp(net!.id, body.subnetId), publicAccess: !!body.publicAccess, publicHost: body.publicAccess ? `${body.name}.db.${loc.id}.autark.cloud` : null,
    users, databases, backups, maintenanceWindow: body.maintenanceWindow ?? { day: 'sun', hour: 3 }, parameters: {}, primaryHostId: primary?.id ?? null, standbyHostId: standby?.id ?? null,
    deletionProtection: !!body.deletionProtection, pendingRestart: [], restoredFrom: body.restoreFrom?.meta ?? null, createdAt: now, tags: body.tags ?? [],
  };
  if (body.parameters && Object.keys(body.parameters).length) row.parameters = validateParameters(row, body.parameters).clean;
  (row as any)._initialCredentials = { username: body.initialUser || spec.adminUser, password: generatePassword() };
  return row;
}

function afterCreateDb(ctx: Ctx, row: DbInstance, body: any) {
  if (body.firewallIds?.length) setFirewalls({ type: 'db', id: row.id }, body.firewallIds);
  const fresh = db.get<DbInstance>('dbInstances', row.id)!;
  const loc = db.get<Location>('locations', fresh.locationId)!;
  startOperation({
    type: body.restoreFrom ? 'db.restore' : 'db.create', title: `${body.restoreFrom ? 'Restore' : 'Provision'} database ${row.name}`, target: { type: 'db', id: row.id, name: row.name },
    steps: provisionSteps(fresh, { loc, standbyHost: fresh.standbyHostId ? hostName(fresh.standbyHostId) : null, restore: body.restoreFrom ? { label: body.restoreFrom.label, pitr: body.restoreFrom.pitr } : undefined, firstBackup: fresh.backups.enabled, initialDb: body.initialDatabase, initialUser: body.initialUser }),
    scope: { accountId: row.accountId, projectId: row.projectId }, actor: ctx.actor,
    onComplete: 'db.provisioned', onFail: 'db.provisionFailed', payload: { id: row.id, firstBackup: fresh.backups.enabled },
    ...(row.name.includes('fail') ? { failAtStep: 2, failMessage: 'initdb failed: could not allocate shared memory segment (hugepages exhausted on host)' } : {}),
  });
}

onOperationComplete('db.provisioned', (_op, p: { id: string; firstBackup: boolean }) => {
  const d = db.get<DbInstance>('dbInstances', p.id);
  if (!d) return;
  db.update('dbInstances', p.id, { status: 'available' } as any);
  registerDns(d);
  if (p.firstBackup) insertBackup(d, 'automated', 'available', `${d.name}-auto-initial`);
});
onOperationComplete('db.provisionFailed', (_op, p: { id: string }) => {
  if (db.get('dbInstances', p.id)) db.update('dbInstances', p.id, { status: 'error' } as any);
});
onOperationComplete('db.state', (_op, p: { id: string; status: DbInstance['status']; patch?: Partial<DbInstance> }) => {
  const cur = db.get<DbInstance>('dbInstances', p.id);
  if (cur && cur.status !== 'deleting') db.update('dbInstances', p.id, { status: p.status, ...(p.patch ?? {}) } as any);
});
onOperationComplete('db.backupDone', (_op, p: { id: string; backupId: string; restoreStatus?: DbInstance['status'] }) => {
  if (db.get('dbBackups', p.backupId)) db.update('dbBackups', p.backupId, { status: 'available' } as any);
  const d = db.get<DbInstance>('dbInstances', p.id);
  if (d && d.status === 'backing-up') db.update('dbInstances', p.id, { status: p.restoreStatus ?? 'available' } as any);
});
onOperationComplete('db.backupFailed', (_op, p: { id: string; backupId: string }) => {
  if (db.get('dbBackups', p.backupId)) db.update('dbBackups', p.backupId, { status: 'failed' } as any);
  if (db.get('dbInstances', p.id)) db.update('dbInstances', p.id, { status: 'available' } as any);
});
onOperationComplete('db.restoredInPlace', (_op, p: { id: string; backupId?: string; patch: Partial<DbInstance> }) => {
  if (p.backupId && db.get('dbBackups', p.backupId)) db.update('dbBackups', p.backupId, { status: 'available' } as any);
  if (db.get('dbInstances', p.id)) db.update('dbInstances', p.id, { status: 'available', ...p.patch } as any);
});
onOperationComplete('db.failedOver', (_op, p: { id: string }) => {
  const d = db.get<DbInstance>('dbInstances', p.id);
  if (!d) return;
  db.update('dbInstances', p.id, { status: 'available', primaryHostId: d.standbyHostId ?? d.primaryHostId, standbyHostId: d.primaryHostId, lastFailoverAt: nowIso() } as any);
});
onOperationComplete('db.deleted', (_op, p: { id: string }) => {
  const d = db.get<DbInstance>('dbInstances', p.id);
  if (!d) return;
  for (const b of backupsOf(d.id)) {
    if (b.type === 'automated' || b.type === 'pre-upgrade') db.remove('dbBackups', b.id);
    else db.update('dbBackups', b.id, { sourceDeleted: true, sourceName: d.name, status: b.status === 'creating' ? 'available' : b.status } as any);
  }
  unregisterDns(d.id);
  detachEverywhere('db', d.id);
  db.remove('dbInstances', d.id);
});

function dbOp(ctx: Ctx, d: DbInstance, type: string, title: string, during: DbInstance['status'], steps: StepSpec[], final: DbInstance['status'], patch?: Partial<DbInstance>, silent = true) {
  return transition({
    collection: 'dbInstances', id: d.id, kind: 'db', name: d.name, type, title, during: { status: during }, steps,
    onComplete: 'db.state', payload: { id: d.id, status: final, patch }, scope: { accountId: d.accountId, projectId: d.projectId }, actor: ctx.actor, silent,
  });
}

/* ------------------------------------------------------------------------------------------------
 * Registration
 * ---------------------------------------------------------------------------------------------- */

export function registerDatabases() {
  route('GET', '/db/engines', () => ({ engines: DB_ENGINES }), 'Managed database engine catalog (versions, parameters)');

  defineCollection<DbInstance>({
    name: 'dbInstances', kind: 'db', idPrefix: 'db',
    searchText: (d) => `${d.id} ${d.name} ${d.engine} ${d.version} ${d.host} ${d.privateIp ?? ''} ${d.status} ${d.tags.map((t) => `${t.key}:${t.value}`).join(' ')}`,
    subtitle: (d) => `${engineSpec(d.engine)?.label ?? d.engine} ${d.version} · ${d.size.vcpus} vCPU / ${d.size.ramGB} GB${d.ha ? ' · HA' : ''} · ${d.status}`,
    link: (d) => `/managed-services/db/${d.id}`,
    decorate: (d) => {
      const anyD = d as any;
      const hasCreds = !!anyD._initialCredentials;
      delete anyD._initialCredentials;
      const bks = backupsOf(d.id).filter((b) => b.status === 'available').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const earliest = d.backups.enabled && d.backups.pitr ? new Date(Math.max(Date.parse(d.createdAt), Date.now() - d.backups.retention * DAY)).toISOString() : null;
      return { ...d, hasInitialCredentials: hasCreds, monthlyCost: dbMonthly(d), lastBackupAt: bks[0]?.createdAt ?? null, earliestRestoreTime: earliest, pendingRestart: d.pendingRestart ?? [] };
    },
    create: createDb,
    afterCreate: (ctx, d) => afterCreateDb(ctx, d, ctx.body),
    update: (_ctx, d, patch) => {
      const next: any = { ...d };
      if ('name' in patch && patch.name !== d.name) throw new ApiError(422, 'Databases cannot be renamed (the hostname is derived from the name)', 'validation_failed', { name: 'Immutable' });
      if ('tags' in patch) { checkRequiredTags(d.projectId, patch.tags); next.tags = patch.tags }
      if ('deletionProtection' in patch) next.deletionProtection = !!patch.deletionProtection;
      if ('storageAutoscale' in patch) next.storageAutoscale = !!patch.storageAutoscale;
      if ('maintenanceWindow' in patch) {
        const mw = patch.maintenanceWindow;
        validate({ maintenanceWindow: !(mw && ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(mw.day) && Number.isInteger(mw.hour) && mw.hour >= 0 && mw.hour <= 23) && 'Invalid maintenance window' });
        next.maintenanceWindow = { day: mw.day, hour: mw.hour };
      }
      if ('backups' in patch) {
        const b = { ...d.backups, ...patch.backups };
        const spec = engineSpec(d.engine)!;
        validate({
          'backups.retention': !(Number.isInteger(b.retention) && b.retention >= 1 && b.retention <= 35) && 'Retention must be 1–35 days',
          'backups.pitr': b.pitr && (!spec.supportsPitr ? `${spec.label} does not support PITR` : !b.enabled && 'PITR requires automated backups'),
          'backups.window': !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(b.window) && 'Use HH:MM-HH:MM',
        });
        next.backups = b;
      }
      return next;
    },
    remove: (ctx, d) => {
      if (d.deletionProtection) throw new ApiError(409, 'Deletion protection is enabled for this database. Disable it in Settings first.', 'protected');
      if (d.status === 'deleting') throw new ApiError(409, 'Database is already being deleted', 'invalid_state');
      const finalBackup = ctx.query.get('finalBackup') === 'true';
      if (finalBackup && d.status !== 'available' && d.status !== 'stopped') throw new ApiError(409, `Cannot take a final backup while the database is ${d.status}`, 'invalid_state');
      if (finalBackup) insertBackup(d, 'final', 'creating', `${d.name}-final`);
      transition({
        collection: 'dbInstances', id: d.id, kind: 'db', name: d.name, type: 'db.delete', title: `Delete database ${d.name}`, during: { status: 'deleting' },
        steps: [
          ...(finalBackup ? [{ name: 'Take final backup', ms: ms(1.8), logs: ['full backup uploaded', `kept as ${d.name}-final (retained after deletion)`] }] : []),
          { name: 'Stop database processes', ms: ms(1), logs: ['connections terminated', 'shutdown checkpoint complete'] },
          ...(d.ha || d.readReplicas ? [{ name: 'Remove standby & replicas', ms: ms(0.8) }] : []),
          { name: 'Delete storage volumes', ms: ms(0.8), logs: [`wiping ${d.storageGB} GB (crypto-erase)`] },
          { name: 'Remove DNS & firewall attachments', ms: ms(0.5) },
        ],
        onComplete: 'db.deleted', payload: { id: d.id }, scope: { accountId: d.accountId, projectId: d.projectId }, actor: ctx.actor, silent: false,
      });
      return 'async';
    },
    actions: {
      revealCredentials: (_ctx, d) => {
        const creds = (db.get<any>('dbInstances', d.id) as any)?._initialCredentials;
        if (!creds) throw new ApiError(410, 'The initial password was already revealed. Reset the password to get a new one.', 'gone');
        db.update<any>('dbInstances', d.id, (r: any) => { delete r._initialCredentials; return r });
        return { username: creds.username, password: creds.password };
      },
      stop: (ctx, d) => {
        requireStatus(d, ['available'], 'stop');
        if (d.readReplicas > 0) throw new ApiError(409, 'Remove read replicas before stopping the primary', 'invalid_state');
        dbOp(ctx, d, 'db.stop', `Stop ${d.name}`, 'stopping', [{ name: 'Drain connections', ms: ms(1), logs: ['pooler paused', 'clients disconnected'] }, { name: 'Shutdown (checkpoint)', ms: ms(1.2) }, ...(d.ha ? [{ name: 'Stop standby', ms: ms(0.6) }] : [])], 'stopped');
      },
      start: (ctx, d) => {
        requireStatus(d, ['stopped', 'error'], 'start');
        dbOp(ctx, d, 'db.start', `Start ${d.name}`, 'starting', [{ name: 'Attach storage', ms: ms(0.8) }, { name: 'Start database', ms: ms(1.6), logs: ['crash recovery not needed', 'accepting connections'] }, ...(d.ha ? [{ name: 'Start standby & resync', ms: ms(1.2) }] : []), { name: 'Health check', ms: ms(0.5) }], 'available');
      },
      restart: (ctx, d) => {
        requireStatus(d, ['available'], 'restart');
        const pending = d.pendingRestart ?? [];
        dbOp(ctx, d, 'db.restart', `Restart ${d.name}`, 'rebooting', [
          ...(d.ha ? [{ name: 'Restart standby', ms: ms(1.2), logs: ['standby restarted', 'replication caught up'] }, { name: 'Switchover to standby', ms: ms(0.8), logs: ['planned switchover, ~2s write pause'] }] : [{ name: 'Drain connections', ms: ms(0.8) }]),
          { name: 'Restart database', ms: ms(1.8), logs: [...(pending.length ? [`applying ${pending.join(', ')}`] : []), 'database restarted'] },
          { name: 'Health check', ms: ms(0.5) },
        ], 'available', { pendingRestart: [] });
      },
      scale: (ctx, d, body) => {
        requireStatus(d, ['available', 'stopped'], 'scale');
        const spec = engineSpec(d.engine)!;
        const sizeChange = body.presetId || body.vcpus != null || body.ramGB != null;
        const size = sizeChange ? resolveSize({ presetId: body.presetId, vcpus: body.vcpus ?? d.size.vcpus, ramGB: body.ramGB ?? d.size.ramGB }, d.engine) : { presetId: d.size.presetId ?? null, vcpus: d.size.vcpus, ramGB: d.size.ramGB };
        const storageGB = body.storageGB ?? d.storageGB;
        const ha = body.ha ?? d.ha;
        const readReplicas = body.readReplicas ?? d.readReplicas;
        validate({
          storageGB: storageGB < d.storageGB ? `Storage can only grow (currently ${d.storageGB} GB)` : storageGB > 16384 ? 'Max 16384 GB' : d.engine === 'redis' && storageGB < size.ramGB && `Redis persistence needs storage ≥ memory (${size.ramGB} GB)`,
          readReplicas: !(Number.isInteger(readReplicas) && readReplicas >= 0 && readReplicas <= 5) ? 'Read replicas must be 0–5' : !spec.supportsReplicas && readReplicas > 0 && 'Not supported',
        });
        const sizeChanged = size.vcpus !== d.size.vcpus || size.ramGB !== d.size.ramGB;
        if (!sizeChanged && storageGB === d.storageGB && ha === d.ha && readReplicas === d.readReplicas) throw new ApiError(422, 'Nothing to change', 'validation_failed');
        if (d.status === 'stopped' && (ha !== d.ha || readReplicas !== d.readReplicas)) throw new ApiError(409, 'Start the database before changing HA or replicas', 'invalid_state');
        const standby = ha && !d.ha ? primaryHostFor(d.locationId, size.vcpus, size.ramGB, d.primaryHostId) : null;
        const steps: StepSpec[] = [];
        if (storageGB > d.storageGB) steps.push({ name: `Grow storage ${d.storageGB} → ${storageGB} GB (online)`, ms: ms(1.2), logs: ['rbd resize', 'xfs_growfs: online, no downtime'] });
        if (sizeChanged) {
          if (d.ha && ha) steps.push(
            { name: `Resize standby to ${size.vcpus} vCPU / ${size.ramGB} GB`, ms: ms(1.6), logs: ['standby restarted with new size', 'replication caught up'] },
            { name: 'Failover to standby', ms: ms(0.8), logs: ['writes paused ~4s', 'standby promoted'] },
            { name: 'Resize former primary (now standby)', ms: ms(1.6) },
          );
          else steps.push({ name: `Restart with ${size.vcpus} vCPU / ${size.ramGB} GB`, ms: ms(2.2), logs: [d.status === 'stopped' ? 'applied on next start' : 'brief downtime during restart (~30s)', `vcpus ${d.size.vcpus} → ${size.vcpus}, memory ${d.size.ramGB} → ${size.ramGB} GiB`] });
        }
        if (ha && !d.ha) steps.push({ name: `Provision standby on ${hostName(standby?.id)}`, ms: ms(1.8) }, { name: 'Configure replication', ms: ms(1.4), logs: ['base backup streamed', 'synchronous replication enabled'] });
        if (!ha && d.ha) steps.push({ name: 'Decommission standby', ms: ms(1), logs: ['replication slot dropped', 'standby removed'] });
        if (readReplicas > d.readReplicas) steps.push({ name: `Add ${readReplicas - d.readReplicas} read replica(s)`, ms: ms(1.6), logs: Array.from({ length: readReplicas - d.readReplicas }, (_, i) => `replica-${d.readReplicas + i + 1}: async replication started`) });
        if (readReplicas < d.readReplicas) steps.push({ name: `Remove ${d.readReplicas - readReplicas} read replica(s)`, ms: ms(1), logs: Array.from({ length: d.readReplicas - readReplicas }, (_, i) => `replica-${d.readReplicas - i}: removed`) });
        steps.push({ name: 'Health check', ms: ms(0.5) });
        dbOp(ctx, d, 'db.scale', `Scale ${d.name}`, 'scaling', steps, d.status === 'stopped' ? 'stopped' : 'available', {
          size: { presetId: size.presetId, vcpus: size.vcpus, ramGB: size.ramGB }, storageGB, ha, readReplicas,
          standbyHostId: ha ? (d.standbyHostId ?? standby?.id ?? null) : null,
        }, false);
      },
      failover: (ctx, d) => {
        requireStatus(d, ['available'], 'fail over');
        if (!d.ha) throw new ApiError(409, 'Failover requires high availability (a standby). Enable HA in Settings → Scale.', 'invalid_state');
        transition({
          collection: 'dbInstances', id: d.id, kind: 'db', name: d.name, type: 'db.failover', title: `Failover ${d.name}`, during: { status: 'failing-over' },
          steps: [
            { name: 'Check standby replication lag', ms: ms(0.6), logs: ['standby lag: 0 bytes (synchronous)'] },
            { name: 'Fence primary', ms: ms(0.6), logs: [`${hostName(d.primaryHostId)}: demoted, writes blocked`] },
            { name: 'Promote standby', ms: ms(1.2), logs: [`${hostName(d.standbyHostId)}: promoted to primary`, 'timeline 2'] },
            { name: 'Repoint DNS & pooler', ms: ms(0.6), logs: [`${d.host} → ${hostName(d.standbyHostId)}`, 'pooler reconnected, ~3s write unavailability'] },
            { name: 'Rejoin old primary as standby', ms: ms(1.4), logs: ['pg_rewind / resync complete', 'streaming replication restored'] },
          ],
          onComplete: 'db.failedOver', payload: { id: d.id }, scope: { accountId: d.accountId, projectId: d.projectId }, actor: ctx.actor, silent: false,
        });
      },
      backup: (ctx, d, body) => {
        requireStatus(d, ['available'], 'back up');
        const b = insertBackup(d, 'manual', 'creating', body?.name);
        transition({
          collection: 'dbInstances', id: d.id, kind: 'db', name: d.name, type: 'db.backup', title: `Back up ${d.name}`, during: { status: 'backing-up' },
          steps: [
            { name: 'Start backup', ms: ms(0.6), logs: [d.engine === 'postgres' ? 'pg_backup_start()' : d.engine === 'redis' ? 'BGSAVE' : 'FLUSH TABLES WITH READ LOCK (brief)'] },
            { name: `Copy ${b.sizeGB} GB (compressed)`, ms: ms(2), logs: ['streaming from standby to avoid primary load', 'zstd -3, AES-256 encrypted'] },
            { name: 'Upload & verify', ms: ms(1), logs: ['checksum verified', `stored as ${b.name}`] },
          ],
          onComplete: 'db.backupDone', payload: { id: d.id, backupId: b.id }, scope: { accountId: d.accountId, projectId: d.projectId }, actor: ctx.actor, silent: false,
        });
        return b;
      },
      restore: (ctx, d, body) => {
        const b = getOr404<DbBackup>('dbBackups', body.backupId, 'Backup');
        if (b.dbId !== d.id) throw new ApiError(422, 'Backup does not belong to this database', 'validation_failed');
        if (b.status !== 'available') throw new ApiError(409, `Backup is ${b.status}`, 'invalid_state');
        if (body.mode === 'new') {
          const clone = createDb(ctx, {
            name: body.name, projectId: d.projectId, engine: d.engine, version: b.version ?? d.version, presetId: d.size.presetId, vcpus: d.size.vcpus, ramGB: d.size.ramGB, storageGB: d.storageGB,
            ha: false, readReplicas: 0, locationId: d.locationId, networkId: d.networkId, subnetId: d.subnetId, backups: d.backups, maintenanceWindow: d.maintenanceWindow, tags: d.tags,
            restoreFrom: { label: `backup ${b.name}`, usedGB: d.storageUsedGB, meta: { backupId: b.id, sourceId: d.id, sourceName: d.name } }, allowDeprecated: true,
          });
          clone.users = d.users.map((u) => ({ ...u })); clone.databases = d.databases.map((x) => ({ ...x })); clone.parameters = { ...d.parameters };
          db.insert('dbInstances', clone as any);
          audit(ctx, 'db.create', { type: 'db', id: clone.id, name: clone.name }, { accountId: clone.accountId, projectId: clone.projectId, details: `restored from ${b.name}` });
          afterCreateDb(ctx, clone, { firewallIds: d.firewallIds, restoreFrom: { label: `backup ${b.name}` } });
          return db.get('dbInstances', clone.id);
        }
        requireStatus(d, ['available', 'stopped', 'error'], 'restore');
        db.update('dbBackups', b.id, { status: 'restoring' } as any);
        transition({
          collection: 'dbInstances', id: d.id, kind: 'db', name: d.name, type: 'db.restore', title: `Restore ${d.name} from ${b.name}`, during: { status: 'restoring' },
          steps: [
            { name: 'Stop database & block connections', ms: ms(1) },
            { name: `Restore ${b.sizeGB} GB from ${b.name}`, ms: ms(2.6), logs: ['downloading backup', 'verifying checksums', 'data directory replaced'] },
            ...(d.ha ? [{ name: 'Rebuild standby from restored primary', ms: ms(1.6) }] : []),
            { name: 'Start & health check', ms: ms(1) },
          ],
          onComplete: 'db.restoredInPlace', payload: { id: d.id, backupId: b.id, patch: { restoredFrom: { backupId: b.id, sourceId: d.id, sourceName: d.name, timestamp: b.createdAt } } }, scope: { accountId: d.accountId, projectId: d.projectId }, actor: ctx.actor, silent: false,
        });
      },
      pitr: (ctx, d, body) => {
        if (!d.backups.enabled || !d.backups.pitr) throw new ApiError(409, 'Point-in-time recovery is not enabled for this database. Enable it under Backups.', 'invalid_state');
        const t = Date.parse(body.timestamp);
        const earliest = Math.max(Date.parse(d.createdAt), Date.now() - d.backups.retention * DAY);
        validate({ timestamp: !Number.isFinite(t) ? 'Choose a valid timestamp' : t < earliest ? `Earliest restorable time is ${new Date(earliest).toISOString()}` : t > Date.now() - MIN && 'Choose a time at least 1 minute in the past' });
        const iso = new Date(t).toISOString();
        if (body.mode === 'new') {
          const clone = createDb(ctx, {
            name: body.name, projectId: d.projectId, engine: d.engine, version: d.version, presetId: d.size.presetId, vcpus: d.size.vcpus, ramGB: d.size.ramGB, storageGB: d.storageGB,
            ha: false, readReplicas: 0, locationId: d.locationId, networkId: d.networkId, subnetId: d.subnetId, backups: d.backups, maintenanceWindow: d.maintenanceWindow, tags: d.tags,
            restoreFrom: { label: 'nearest base backup', usedGB: d.storageUsedGB, meta: { sourceId: d.id, sourceName: d.name, timestamp: iso } }, allowDeprecated: true,
          });
          clone.users = d.users.map((u) => ({ ...u })); clone.databases = d.databases.map((x) => ({ ...x })); clone.parameters = { ...d.parameters };
          db.insert('dbInstances', clone as any);
          audit(ctx, 'db.create', { type: 'db', id: clone.id, name: clone.name }, { accountId: clone.accountId, projectId: clone.projectId, details: `PITR of ${d.name} to ${iso}` });
          afterCreateDb(ctx, clone, { firewallIds: d.firewallIds, restoreFrom: { label: 'nearest base backup', pitr: iso } });
          return db.get('dbInstances', clone.id);
        }
        requireStatus(d, ['available', 'stopped', 'error'], 'restore');
        transition({
          collection: 'dbInstances', id: d.id, kind: 'db', name: d.name, type: 'db.pitr', title: `Restore ${d.name} to ${iso.slice(0, 16).replace('T', ' ')} UTC`, during: { status: 'restoring' },
          steps: [
            { name: 'Stop database & block connections', ms: ms(1) },
            { name: 'Restore nearest base backup', ms: ms(2), logs: ['base backup selected', 'data directory replaced'] },
            { name: `Replay ${d.engine === 'postgres' ? 'WAL' : 'binlog'} to target time`, ms: ms(2.2), logs: [`recovery_target_time = '${iso}'`, 'replaying segments…', 'target reached, promoting (new timeline)'] },
            ...(d.ha ? [{ name: 'Rebuild standby', ms: ms(1.4) }] : []),
            { name: 'Start & health check', ms: ms(0.8) },
          ],
          onComplete: 'db.restoredInPlace', payload: { id: d.id, patch: { restoredFrom: { sourceId: d.id, sourceName: d.name, timestamp: iso } } }, scope: { accountId: d.accountId, projectId: d.projectId }, actor: ctx.actor, silent: false,
        });
      },
      createUser: (_ctx, d, body) => {
        requireStatus(d, ['available'], 'create users');
        const username = String(body.username ?? '').trim();
        validate({
          username: !username ? 'Username is required' : !IDENT_RE.test(username) ? 'Lowercase letters, digits and underscores; must start with a letter' : ADMIN_NAMES.has(username) ? `"${username}" is reserved` : d.users.some((u) => u.username === username) && `User "${username}" already exists`,
          role: !['owner', 'readwrite', 'readonly'].includes(body.role ?? 'readwrite') && 'Invalid role',
        });
        const password = generatePassword();
        db.update<any>('dbInstances', d.id, (r: DbInstance) => { r.users.push({ username, role: body.role ?? 'readwrite', createdAt: nowIso() }); return r });
        return { username, password };
      },
      deleteUser: (_ctx, d, body) => {
        requireStatus(d, ['available'], 'delete users');
        const spec = engineSpec(d.engine)!;
        if (body.username === spec.adminUser) throw new ApiError(409, `The admin user "${spec.adminUser}" cannot be deleted`, 'conflict');
        if (!d.users.some((u) => u.username === body.username)) throw new ApiError(404, `User ${body.username} not found`, 'not_found');
        const owned = d.databases.filter((x) => x.owner === body.username);
        if (owned.length) throw new ApiError(409, `${body.username} owns ${owned.map((o) => o.name).join(', ')}. Change the owner or drop the database first.`, 'conflict');
        db.update<any>('dbInstances', d.id, (r: DbInstance) => { r.users = r.users.filter((u) => u.username !== body.username); return r });
      },
      resetPassword: (_ctx, d, body) => {
        requireStatus(d, ['available'], 'reset passwords');
        if (!d.users.some((u) => u.username === body.username)) throw new ApiError(404, `User ${body.username} not found`, 'not_found');
        const password = generatePassword();
        db.update<any>('dbInstances', d.id, (r: DbInstance & { _initialCredentials?: unknown }) => {
          r.users = r.users.map((u) => (u.username === body.username ? { ...u, passwordChangedAt: nowIso() } : u));
          if ((r as any)._initialCredentials?.username === body.username) delete (r as any)._initialCredentials;
          return r;
        });
        return { username: body.username, password };
      },
      createDatabase: (_ctx, d, body) => {
        requireStatus(d, ['available'], 'create databases');
        const spec = engineSpec(d.engine)!;
        if (!spec.supportsDatabases) throw new ApiError(422, 'Redis uses numbered logical databases (db0–db15); nothing to create', 'validation_failed');
        const name = String(body.name ?? '').trim();
        const owner = body.owner || spec.adminUser;
        validate({
          name: !name ? 'Name is required' : !IDENT_RE.test(name) ? 'Lowercase letters, digits and underscores; must start with a letter' : ['postgres', 'template0', 'template1', 'mysql', 'sys', 'information_schema', 'performance_schema'].includes(name) ? `"${name}" is reserved` : d.databases.some((x) => x.name === name) && `Database "${name}" already exists`,
          owner: !d.users.some((u) => u.username === owner) && `Unknown user ${owner}`,
        });
        db.update<any>('dbInstances', d.id, (r: DbInstance) => { r.databases.push({ name, owner, sizeMB: 8, encoding: d.engine === 'postgres' ? (body.encoding ?? 'UTF8') : 'utf8mb4', createdAt: nowIso() }); return r });
      },
      dropDatabase: (_ctx, d, body) => {
        requireStatus(d, ['available'], 'drop databases');
        if (!d.databases.some((x) => x.name === body.name)) throw new ApiError(404, `Database ${body.name} not found`, 'not_found');
        if (d.engine === 'redis') throw new ApiError(422, 'Use FLUSHDB to clear a Redis logical database', 'validation_failed');
        db.update<any>('dbInstances', d.id, (r: DbInstance) => { r.databases = r.databases.filter((x) => x.name !== body.name); return r });
      },
      updateParameters: (_ctx, d, body) => {
        requireStatus(d, ['available', 'stopped'], 'change parameters');
        const changes: Record<string, unknown> = body.parameters ?? {};
        const reset: string[] = body.reset ?? [];
        const { clean, restart } = validateParameters(d, changes);
        const spec = engineSpec(d.engine)!;
        const resetRestart = reset.filter((n) => spec.parameters.find((p) => p.name === n)?.restart && d.parameters[n] != null);
        const changedRestart = restart.filter((n) => d.parameters[n] !== clean[n]);
        db.update<any>('dbInstances', d.id, (r: DbInstance) => {
          r.parameters = { ...r.parameters, ...clean };
          for (const n of reset) delete r.parameters[n];
          r.pendingRestart = [...new Set([...(r.pendingRestart ?? []), ...changedRestart, ...resetRestart])];
          return r;
        });
        const pending = [...changedRestart, ...resetRestart];
        return { applied: Object.keys(clean).filter((k) => !pending.includes(k)), pendingRestart: pending, restartRequired: pending.length > 0 };
      },
      upgrade: (ctx, d, body) => {
        requireStatus(d, ['available'], 'upgrade');
        const spec = engineSpec(d.engine)!;
        const target = spec.versions.find((v) => v.version === body.version);
        if (!target || target.deprecated) throw new ApiError(422, `Unsupported target version ${body.version}`, 'validation_failed', { version: 'Unsupported version' });
        if (versionNum(target.version) <= versionNum(d.version)) throw new ApiError(422, `Target must be newer than ${d.version} (downgrades are not supported)`, 'validation_failed', { version: 'Must be newer' });
        const pre = insertBackup(d, 'pre-upgrade', 'creating', `${d.name}-pre-upgrade-${d.version}`);
        const tool: Record<DbEngine, string> = { postgres: `pg_upgrade --link -b /usr/lib/postgresql/${d.version}/bin -B /usr/lib/postgresql/${target.version}/bin`, mysql: 'in-place upgrade: mysqld --upgrade=AUTO', mariadb: 'mariadb-upgrade', redis: 'rolling restart with new binaries' };
        setTimeout(() => { if (db.get('dbBackups', pre.id)) db.update('dbBackups', pre.id, { status: 'available' } as any) }, 3500);
        dbOp(ctx, d, 'db.upgrade', `Upgrade ${d.name} ${spec.label} ${d.version} → ${target.version}`, 'upgrading', [
          { name: 'Pre-upgrade compatibility checks', ms: ms(1.2), logs: [d.engine === 'postgres' ? 'pg_upgrade --check: Clusters are compatible' : 'upgrade checker: no blocking issues', 'extensions: all available for target version'] },
          { name: 'Take pre-upgrade backup', ms: ms(2), logs: [`backup ${pre.name}`] },
          { name: `Install ${spec.label} ${target.version}`, ms: ms(1.2) },
          ...(d.ha ? [{ name: 'Upgrade standby', ms: ms(1.8), logs: ['standby upgraded and resynced'] }] : []),
          { name: 'Upgrade primary', ms: ms(2.4), logs: [tool[d.engine], 'downtime window started', 'upgrade complete'] },
          ...(d.engine === 'postgres' ? [{ name: 'ANALYZE (rebuild planner statistics)', ms: ms(1.2), logs: ['vacuumdb --all --analyze-in-stages'] }] : []),
          ...(d.readReplicas ? [{ name: `Upgrade ${d.readReplicas} read replica(s)`, ms: ms(1.4) }] : []),
          { name: 'Health check', ms: ms(0.5) },
        ], 'available', { version: target.version }, false);
      },
      setMaintenanceWindow: (_ctx, d, body) => {
        validate({ maintenanceWindow: !(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(body.day) && Number.isInteger(body.hour) && body.hour >= 0 && body.hour <= 23) && 'Invalid maintenance window' });
        db.update('dbInstances', d.id, { maintenanceWindow: { day: body.day, hour: body.hour } } as any);
      },
      setPublicAccess: (_ctx, d, body) => {
        const enabled = !!body.enabled;
        if (enabled && !d.firewallIds.length) throw new ApiError(409, 'Attach a firewall that restricts sources before enabling public access', 'conflict');
        db.update('dbInstances', d.id, { publicAccess: enabled, publicHost: enabled ? `${d.name}.db.${d.locationId}.autark.cloud` : null } as any);
      },
      setFirewalls: (_ctx, d, body) => {
        const ids: string[] = body.firewallIds ?? [];
        if (ids.some((id) => db.get<Firewall>('firewalls', id)?.projectId !== d.projectId)) throw new ApiError(422, 'Firewalls must belong to the same project', 'validation_failed');
        if (d.publicAccess && !ids.length) throw new ApiError(409, 'Public access requires at least one firewall', 'conflict');
        setFirewalls({ type: 'db', id: d.id }, ids);
      },
    },
  });

  defineCollection<DbPreset & { createdAt?: string }>({
    name: 'dbPresets', kind: 'db', idPrefix: 'dbp', scoped: false, searchable: false,
    sort: (a, b) => a.engine.localeCompare(b.engine) || a.vcpus - b.vcpus || a.ramGB - b.ramGB,
    decorate: (p) => ({ ...p, usedBy: db.filter<DbInstance>('dbInstances', (d) => d.size.presetId === p.id).length, monthlyCost: dbCost({ vcpus: p.vcpus, ramGB: p.ramGB, storageGB: p.storageGB, ha: false }).total }),
    create: (_ctx, body) => {
      validatePreset(body);
      return { id: newId('dbp'), name: body.name.trim(), engine: body.engine, vcpus: body.vcpus, ramGB: body.ramGB, storageGB: body.storageGB, description: body.description ?? '', builtIn: false, createdAt: nowIso(), createdBy: _ctx.actor };
    },
    update: (_ctx, p, patch) => {
      if (p.builtIn) throw new ApiError(409, 'Built-in presets cannot be modified. Duplicate it instead.', 'conflict');
      const next = { ...p, name: patch.name ?? p.name, engine: patch.engine ?? p.engine, vcpus: patch.vcpus ?? p.vcpus, ramGB: patch.ramGB ?? p.ramGB, storageGB: patch.storageGB ?? p.storageGB, description: patch.description ?? p.description, id: p.id, builtIn: false };
      validatePreset(next, p.id);
      return next;
    },
    remove: (_ctx, p) => {
      if (p.builtIn) throw new ApiError(409, 'Built-in presets cannot be deleted', 'conflict');
      for (const d of db.filter<DbInstance>('dbInstances', (x) => x.size.presetId === p.id)) db.update('dbInstances', d.id, { size: { ...d.size, presetId: null } } as any);
    },
  });

  defineCollection<DbBackup>({
    name: 'dbBackups', kind: 'dbBackup', idPrefix: 'dbb', searchable: false,
    searchText: (b) => `${b.id} ${b.name} ${b.sourceName ?? ''} ${b.type}`,
    remove: (_ctx, b) => {
      if (b.type === 'automated') throw new ApiError(409, 'Automated backups are removed by the retention policy', 'conflict');
      if (b.status === 'creating' || b.status === 'restoring') throw new ApiError(409, `Backup is ${b.status}`, 'invalid_state');
    },
  });

  registerMetrics('db', (d: DbInstance, metric) => {
    const off = !isLive(d);
    const bias = (d.id.charCodeAt(d.id.length - 1) % 7) * 3;
    const maxConn = Number(d.parameters.max_connections ?? d.parameters.maxclients ?? (d.engine === 'redis' ? 10000 : d.engine === 'postgres' ? 200 : 151));
    const redis = d.engine === 'redis';
    const replicaMatch = /^replicaLag(\d+)$/.exec(metric);
    if (replicaMatch) {
      const i = Number(replicaMatch[1]);
      if (i < 1 || i > d.readReplicas) return null;
      return { unit: 'ms', base: 18 + i * 14 + bias, amp: 20, spikiness: 0.6, min: 0, off };
    }
    switch (metric) {
      case 'cpu': return { unit: '%', base: 16 + bias + d.readReplicas * 2, amp: 12, max: 100, diurnal: 0.3, spikiness: 0.35, off };
      case 'memory': return { unit: '%', base: redis ? Math.min(85, 25 + (d.storageUsedGB / Math.max(1, d.size.ramGB)) * 55) : 62 + bias / 2, amp: 4, max: 100, off };
      case 'connections': return { unit: 'conn', base: Math.round(maxConn * (redis ? 0.02 : 0.22)) + bias, amp: Math.max(3, maxConn * (redis ? 0.01 : 0.08)), max: maxConn, diurnal: 0.35, min: 1, off };
      case 'qps': return { unit: 'q/s', base: (redis ? 7000 : 160) * d.size.vcpus + bias * 10, amp: (redis ? 2500 : 60) * d.size.vcpus, diurnal: 0.4, spikiness: 0.3, off };
      case 'replicationLag':
      case 'standbyLag': return d.ha ? { unit: 'ms', base: 1.5, amp: 2, spikiness: 0.4, min: 0, off } : null;
      case 'storageUsed': {
        const growth = Math.max(0.05, d.storageUsedGB * 0.01);
        return { unit: 'GB', base: Math.max(0, d.storageUsedGB - growth), amp: 0.02, trend: growth, max: d.storageGB };
      }
      case 'cacheHitRatio': return { unit: '%', base: redis ? 93 : 99.1, amp: redis ? 3 : 0.5, max: 100, min: 80, off };
      case 'iops': return { unit: 'IOPS', base: 300 * d.size.vcpus + bias * 20, amp: 150 * d.size.vcpus, spikiness: 0.4, off };
      case 'diskLatency': return { unit: 'ms', base: 0.6, amp: 0.3, spikiness: 0.3, off };
      default: return null;
    }
  });
}

function validatePreset(body: any, exceptId?: string) {
  validate({
    name: !body.name?.trim() ? 'Name is required' : db.find<DbPreset>('dbPresets', (p) => p.name.toLowerCase() === body.name.trim().toLowerCase() && p.id !== exceptId) && `Preset "${body.name}" already exists`,
    engine: !['postgres', 'mysql', 'mariadb', 'redis', 'any'].includes(body.engine) && 'Choose an engine',
    vcpus: !(Number.isInteger(body.vcpus) && body.vcpus >= 1 && body.vcpus <= 64) && 'vCPUs must be 1–64',
    ramGB: !(Number.isFinite(body.ramGB) && body.ramGB >= 1 && body.ramGB <= 512) && 'Memory must be 1–512 GB',
    storageGB: !(Number.isInteger(body.storageGB) && body.storageGB >= 10 && body.storageGB <= 16384) ? 'Storage must be 10–16384 GB' : body.engine === 'redis' && body.storageGB < body.ramGB && 'Redis storage must be ≥ memory',
  });
}
