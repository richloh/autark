import type { DbInstance, DbPreset, DbBackup, LoadBalancer, Certificate } from '@/types';
import { ago, ahead, tags, ptags, scope, DAY, HOUR } from './util';

export function seedManaged() {
  const dbPresets: DbPreset[] = [
    { id: 'db-pg-s', name: 'PG-S', engine: 'postgres', vcpus: 2, ramGB: 4, storageGB: 50, description: 'Small Postgres for services', builtIn: true },
    { id: 'db-pg-m', name: 'PG-M', engine: 'postgres', vcpus: 4, ramGB: 16, storageGB: 200, description: 'Production Postgres', builtIn: true },
    { id: 'db-pg-l', name: 'PG-L', engine: 'postgres', vcpus: 8, ramGB: 32, storageGB: 500, description: 'Large OLTP', builtIn: true },
    { id: 'db-my-m', name: 'MySQL-M', engine: 'mysql', vcpus: 4, ramGB: 8, storageGB: 100, description: 'MySQL 8 general purpose', builtIn: true },
    { id: 'db-ma-m', name: 'MariaDB-M', engine: 'mariadb', vcpus: 4, ramGB: 8, storageGB: 100, description: 'MariaDB 11 general purpose', builtIn: true },
    { id: 'db-dev', name: 'Dev-XS', engine: 'any', vcpus: 1, ramGB: 2, storageGB: 20, description: 'Development & CI databases', builtIn: true },
    { id: 'db-rd-s', name: 'Redis-S', engine: 'redis', vcpus: 1, ramGB: 4, storageGB: 10, description: 'Cache / queues', builtIn: true },
    { id: 'db-rd-m', name: 'Redis-M', engine: 'redis', vcpus: 2, ramGB: 16, storageGB: 32, description: 'Feature stores, sessions', builtIn: true },
  ];

  const enneoTags = (env: string) => tags({ env, team: 'enneo' });
  const base = { storageAutoscale: true, readReplicas: 0, publicAccess: false, parameters: {} as Record<string, string> };
  const dbInstances: DbInstance[] = [
    { ...base, id: 'db-001', name: 'compass-db', ...scope('proj-compass'), engine: 'postgres', version: '16', status: 'available', size: { presetId: null, vcpus: 16, ramGB: 128 }, storageGB: 1000, storageUsedGB: 612, ha: true, readReplicas: 1,
      locationId: 'dc1', networkId: 'net-001', subnetId: 'sn-002', firewallIds: ['fw-003'], host: 'compass-db.db.dc1.autark.internal', port: 5432, privateIp: '10.10.2.50', primaryHostId: 'bm-002', standbyHostId: 'bm-003', deletionProtection: true,
      users: [{ username: 'postgres', role: 'owner', createdAt: ago(670 * DAY) }, { username: 'compass_app', role: 'readwrite', createdAt: ago(670 * DAY) }, { username: 'compass_batch', role: 'readwrite', createdAt: ago(640 * DAY) },
        { username: 'orchestrator', role: 'readonly', createdAt: ago(500 * DAY) }, { username: 'controlling_bi', role: 'readonly', createdAt: ago(120 * DAY) }],
      databases: [{ name: 'compass', owner: 'compass_app', sizeMB: 548_000 }, { name: 'compass_reporting', owner: 'compass_app', sizeMB: 51_200 }, { name: 'compass_audit', owner: 'postgres', sizeMB: 22_400 }],
      backups: { enabled: true, schedule: 'hourly', retention: 30, pitr: true, window: '00:00-24:00' }, maintenanceWindow: { day: 'sun', hour: 3 },
      parameters: { max_connections: '600', shared_buffers: '32GB', effective_cache_size: '96GB', work_mem: '64MB', log_min_duration_statement: '1000' }, createdAt: ago(670 * DAY), tags: ptags('proj-compass', 'prod', { app: 'compass' }) },
    { ...base, id: 'db-002', name: 'compass-cache', ...scope('proj-compass'), engine: 'redis', version: '7.4', status: 'available', size: { presetId: 'db-rd-m', vcpus: 2, ramGB: 16 }, storageGB: 32, storageUsedGB: 6, ha: false,
      locationId: 'dc1', networkId: 'net-001', subnetId: 'sn-002', firewallIds: ['fw-003'], host: 'compass-cache.db.dc1.autark.internal', port: 6379, privateIp: '10.10.2.60', primaryHostId: 'bm-001',
      users: [{ username: 'default', role: 'owner', createdAt: ago(600 * DAY) }, { username: 'compass', role: 'readwrite', createdAt: ago(600 * DAY) }], databases: [{ name: 'db0', owner: 'default', sizeMB: 6_100 }],
      backups: { enabled: true, schedule: 'daily', retention: 3, pitr: false, window: '03:00-04:00' }, maintenanceWindow: { day: 'sun', hour: 4 }, parameters: { 'maxmemory-policy': 'allkeys-lru' }, createdAt: ago(600 * DAY), tags: ptags('proj-compass', 'prod', { app: 'compass' }) },
    { ...base, id: 'db-003', name: 'orchestrator-db', ...scope('proj-orchestrator'), engine: 'postgres', version: '16', status: 'available', size: { presetId: 'db-pg-l', vcpus: 8, ramGB: 32 }, storageGB: 500, storageUsedGB: 188, ha: true,
      locationId: 'dc1', networkId: 'net-002', subnetId: 'sn-005', firewallIds: ['fw-007'], host: 'orchestrator-db.db.dc1.autark.internal', port: 5432, privateIp: '10.20.2.50', primaryHostId: 'bm-001', standbyHostId: 'bm-002', deletionProtection: true,
      users: [{ username: 'postgres', role: 'owner', createdAt: ago(520 * DAY) }, { username: 'temporal', role: 'readwrite', createdAt: ago(520 * DAY) }, { username: 'orchestrator', role: 'readwrite', createdAt: ago(520 * DAY) }],
      databases: [{ name: 'temporal', owner: 'temporal', sizeMB: 96_000 }, { name: 'temporal_visibility', owner: 'temporal', sizeMB: 21_500 }, { name: 'orchestrator', owner: 'orchestrator', sizeMB: 38_200 }, { name: 'mako', owner: 'orchestrator', sizeMB: 27_900 }],
      backups: { enabled: true, schedule: 'hourly', retention: 14, pitr: true, window: '00:00-24:00' }, maintenanceWindow: { day: 'sun', hour: 2 },
      parameters: { max_connections: '400', shared_buffers: '8GB', work_mem: '32MB' }, createdAt: ago(520 * DAY), tags: ptags('proj-orchestrator', 'prod') },
    { ...base, id: 'db-004', name: 'enneo-prod-db', ...scope('proj-enneo-regiocom'), engine: 'postgres', version: '17', status: 'available', size: { presetId: null, vcpus: 8, ramGB: 64 }, storageGB: 1000, storageUsedGB: 420, ha: true,
      locationId: 'dc1', networkId: 'net-012', subnetId: 'sn-022', firewallIds: ['fw-019'], host: 'enneo-prod-db.db.dc1.autark.internal', port: 5432, privateIp: '10.60.2.50', primaryHostId: 'bm-003', standbyHostId: 'bm-001', deletionProtection: true,
      users: [{ username: 'postgres', role: 'owner', createdAt: ago(236 * DAY) }, { username: 'enneo', role: 'readwrite', createdAt: ago(236 * DAY) }, { username: 'analytics', role: 'readonly', createdAt: ago(60 * DAY) }],
      databases: [{ name: 'enneo', owner: 'enneo', sizeMB: 312_000 }, { name: 'enneo_vectors', owner: 'enneo', sizeMB: 98_000 }],
      backups: { enabled: true, schedule: 'hourly', retention: 14, pitr: true, window: '00:00-24:00' }, maintenanceWindow: { day: 'sat', hour: 3 },
      parameters: { shared_preload_libraries: 'vector,pg_stat_statements', shared_buffers: '16GB', max_connections: '300' }, createdAt: ago(236 * DAY), tags: enneoTags('prod') },
    { ...base, id: 'db-005', name: 'enneo-queue', ...scope('proj-enneo-regiocom'), engine: 'redis', version: '7.4', status: 'available', size: { presetId: 'db-rd-m', vcpus: 2, ramGB: 16 }, storageGB: 32, storageUsedGB: 4, ha: false,
      locationId: 'dc1', networkId: 'net-012', subnetId: 'sn-022', firewallIds: ['fw-019'], host: 'enneo-queue.db.dc1.autark.internal', port: 6379, privateIp: '10.60.2.60', primaryHostId: 'bm-002',
      users: [{ username: 'default', role: 'owner', createdAt: ago(236 * DAY) }, { username: 'worker', role: 'readwrite', createdAt: ago(236 * DAY) }], databases: [{ name: 'db0', owner: 'default', sizeMB: 3_900 }],
      backups: { enabled: true, schedule: 'daily', retention: 3, pitr: false, window: '03:00-04:00' }, maintenanceWindow: { day: 'sat', hour: 4 }, parameters: { 'maxmemory-policy': 'noeviction', appendonly: 'yes' }, createdAt: ago(236 * DAY), tags: enneoTags('prod') },
    { ...base, id: 'db-006', name: 'website-db', ...scope('proj-website'), engine: 'mariadb', version: '11.4', status: 'available', size: { presetId: 'db-ma-m', vcpus: 4, ramGB: 8 }, storageGB: 100, storageUsedGB: 23, ha: false,
      locationId: 'dc2', networkId: 'net-005', subnetId: 'sn-012', firewallIds: ['fw-010'], host: 'website-db.db.dc2.autark.internal', port: 3306, privateIp: '10.40.2.50', primaryHostId: 'bm-015',
      users: [{ username: 'root', role: 'owner', createdAt: ago(600 * DAY) }, { username: 'typo3', role: 'readwrite', createdAt: ago(600 * DAY) }], databases: [{ name: 'typo3', owner: 'typo3', sizeMB: 21_800 }],
      backups: { enabled: true, schedule: 'daily', retention: 14, pitr: false, window: '02:00-03:00' }, maintenanceWindow: { day: 'sun', hour: 2 }, parameters: { innodb_buffer_pool_size: '5G', max_connections: '200' }, pendingRestart: ['innodb_buffer_pool_size'], createdAt: ago(600 * DAY), tags: ptags('proj-website', 'prod') },
    { ...base, id: 'db-007', name: 'enneo-staging-db', ...scope('proj-enneo-intern'), engine: 'postgres', version: '17', status: 'available', size: { presetId: 'db-pg-s', vcpus: 2, ramGB: 4 }, storageGB: 100, storageUsedGB: 31, ha: false,
      locationId: 'dc1', networkId: 'net-010', subnetId: 'sn-018', firewallIds: ['fw-020'], host: 'enneo-staging-db.db.dc1.autark.internal', port: 5432, privateIp: '10.70.2.50', primaryHostId: 'bm-005',
      users: [{ username: 'postgres', role: 'owner', createdAt: ago(200 * DAY) }, { username: 'enneo', role: 'readwrite', createdAt: ago(200 * DAY) }], databases: [{ name: 'enneo', owner: 'enneo', sizeMB: 29_000 }],
      backups: { enabled: true, schedule: 'daily', retention: 7, pitr: false, window: '01:00-02:00' }, maintenanceWindow: { day: 'wed', hour: 2 }, parameters: { shared_preload_libraries: 'vector' }, createdAt: ago(200 * DAY), tags: enneoTags('staging') },
  ];

  const dbBackups: DbBackup[] = [];
  for (const d of dbInstances) {
    for (let i = 0; i < 5; i++) {
      dbBackups.push({ id: `dbb-${d.id.slice(3)}-${i}`, dbId: d.id, accountId: d.accountId, projectId: d.projectId, name: `${d.name}-${i === 2 ? 'manual' : 'auto'}-${i}`,
        createdAt: ago(i * DAY + 2 * HOUR), sizeGB: Math.round(d.storageUsedGB * (0.3 + i * 0.01) * 10) / 10, type: i === 2 ? 'manual' : 'automated', status: 'available', tags: [], engine: d.engine, version: d.version, sourceName: d.name });
    }
  }

  const hc = { protocol: 'HTTP' as const, path: '/healthz', intervalSec: 10, timeoutSec: 3, healthyThreshold: 3, unhealthyThreshold: 3 };
  const loadBalancers: LoadBalancer[] = [
    { id: 'lb-001', name: 'compass-lb', ...scope('proj-compass'), type: 'L7', status: 'active', algorithm: 'least_connections', locationId: 'dc1', networkId: 'net-001', ipIds: ['ip-001', 'ip-002'], hostname: 'compass-lb.lb.dc1.autark.cloud',
      listeners: [
        { id: 'lst-1', port: 443, protocol: 'HTTPS', certificateId: 'cert-001', defaultTargetGroupId: 'tg-compass-web', rules: [{ id: 'lr-1', pathPrefix: '/api', targetGroupId: 'tg-compass-api' }] },
        { id: 'lst-2', port: 80, protocol: 'HTTP', defaultTargetGroupId: 'tg-compass-web', rules: [], redirectToHttps: true },
      ],
      targetGroups: [
        { id: 'tg-compass-web', name: 'compass-web', protocol: 'HTTP', port: 8080, stickySessions: true, healthCheck: { ...hc, path: '/actuator/health' }, targets: [
          { ref: { type: 'vm', id: 'vm-001' }, weight: 100, health: 'healthy' }, { ref: { type: 'vm', id: 'vm-002' }, weight: 100, health: 'healthy' }, { ref: { type: 'vm', id: 'vm-003' }, weight: 100, health: 'healthy' }] },
        { id: 'tg-compass-api', name: 'compass-api', protocol: 'HTTP', port: 8081, stickySessions: false, healthCheck: { ...hc, path: '/api/health' }, targets: [
          { ref: { type: 'vm', id: 'vm-001' }, weight: 100, health: 'healthy' }, { ref: { type: 'vm', id: 'vm-002' }, weight: 100, health: 'healthy' }, { ref: { type: 'vm', id: 'vm-003' }, weight: 100, health: 'healthy' }] },
      ],
      firewallIds: ['fw-004'], proxyProtocol: false, createdAt: ago(660 * DAY), tags: ptags('proj-compass', 'prod') },
    { id: 'lb-002', name: 'website-lb', ...scope('proj-website'), type: 'L7', status: 'active', algorithm: 'round_robin', locationId: 'dc2', networkId: 'net-005', ipIds: ['ip-010', 'ip-011'], hostname: 'website-lb.lb.dc2.autark.cloud',
      listeners: [
        { id: 'lst-3', port: 443, protocol: 'HTTPS', certificateId: 'cert-002', defaultTargetGroupId: 'tg-website', rules: [] },
        { id: 'lst-4', port: 80, protocol: 'HTTP', defaultTargetGroupId: 'tg-website', rules: [], redirectToHttps: true },
      ],
      targetGroups: [{ id: 'tg-website', name: 'typo3', protocol: 'HTTP', port: 80, stickySessions: false, healthCheck: { ...hc, path: '/typo3/health' }, targets: [
        { ref: { type: 'vm', id: 'vm-014' }, weight: 100, health: 'healthy' }, { ref: { type: 'vm', id: 'vm-015' }, weight: 100, health: 'healthy' }] }],
      firewallIds: ['fw-011'], proxyProtocol: false, createdAt: ago(600 * DAY), tags: ptags('proj-website', 'prod') },
    { id: 'lb-003', name: 'orchestrator-as4', ...scope('proj-orchestrator'), type: 'L4', status: 'active', algorithm: 'round_robin', locationId: 'dc1', networkId: 'net-002', ipIds: ['ip-004'], hostname: 'orchestrator-as4.lb.dc1.autark.cloud',
      listeners: [{ id: 'lst-5', port: 443, protocol: 'TCP', defaultTargetGroupId: 'tg-edifact', rules: [] }],
      targetGroups: [{ id: 'tg-edifact', name: 'edifact-gateway', protocol: 'TCP', port: 30443, stickySessions: false, healthCheck: { ...hc, protocol: 'TCP', path: '' }, targets: [
        { ref: { type: 'k8s', id: 'k8s-001' }, port: 30443, weight: 100, health: 'healthy' }] }],
      firewallIds: ['fw-006'], proxyProtocol: true, createdAt: ago(500 * DAY), tags: ptags('proj-orchestrator', 'prod') },
    { id: 'lb-004', name: 'enneo-ingress', ...scope('proj-enneo-regiocom'), type: 'L7', status: 'active', algorithm: 'least_connections', locationId: 'dc1', networkId: 'net-012', ipIds: ['ip-007'], hostname: 'enneo-ingress.lb.dc1.autark.cloud',
      listeners: [
        { id: 'lst-6', port: 443, protocol: 'HTTPS', certificateId: 'cert-004', defaultTargetGroupId: 'tg-enneo', rules: [] },
        { id: 'lst-7', port: 80, protocol: 'HTTP', defaultTargetGroupId: 'tg-enneo', rules: [], redirectToHttps: true },
      ],
      targetGroups: [{ id: 'tg-enneo', name: 'ingress-nginx', protocol: 'HTTP', port: 30080, stickySessions: false, healthCheck: hc, targets: [
        { ref: { type: 'k8s', id: 'k8s-002' }, port: 30080, weight: 100, health: 'healthy' }] }],
      firewallIds: ['fw-018'], proxyProtocol: false, createdAt: ago(236 * DAY), tags: enneoTags('prod') },
  ];

  const certificates: Certificate[] = [
    { id: 'cert-001', name: 'compass-regiocom-energie-de', ...scope('proj-compass'), domains: ['compass.regiocom-energie.de'], issuer: 'letsencrypt', status: 'issued', expiresAt: ahead(54 * DAY), autoRenew: true, createdAt: ago(36 * DAY), tags: [],
      challenge: 'dns-01', keyType: 'ECDSA P-256', issuedAt: ago(36 * DAY), serial: '04:a1:9c:3e:77:10:5b:d2', fingerprint: 'SHA256:3f:9a:12:c4:8e:71:0b:d5:66:20:aa:4e:19:c3:72:e1' },
    { id: 'cert-002', name: 'regiocom-energie-de', ...scope('proj-website'), domains: ['regiocom-energie.de', 'www.regiocom-energie.de'], issuer: 'letsencrypt', status: 'issued', expiresAt: ahead(71 * DAY), autoRenew: true, createdAt: ago(19 * DAY), tags: [],
      challenge: 'http-01', keyType: 'ECDSA P-256', issuedAt: ago(19 * DAY), serial: '03:5e:aa:10:c9:42:81:7d', fingerprint: 'SHA256:71:c0:2d:e8:55:9b:14:a3:0c:e6:48:bf:23:90:d7:6e' },
    { id: 'cert-003', name: 'as4-regiocom-energie-de', ...scope('proj-orchestrator'), domains: ['as4.regiocom-energie.de', 'mako.regiocom-energie.de'], issuer: 'custom', status: 'expiring', expiresAt: ahead(12 * DAY), autoRenew: false, createdAt: ago(353 * DAY), tags: tags({ pki: 'SM-PKI' }),
      keyType: 'ECDSA P-256', issuedAt: ago(353 * DAY), serial: '1c:07:e2:94:5a:b3:0f:68', fingerprint: 'SHA256:b2:47:0e:91:dd:35:7c:a8:10:f4:63:2b:9e:05:c1:7a' },
    { id: 'cert-004', name: 'regiocom-enneo-ai', ...scope('proj-enneo-regiocom'), domains: ['regiocom.enneo.ai', 'api.regiocom.enneo.ai'], issuer: 'letsencrypt', status: 'issued', expiresAt: ahead(48 * DAY), autoRenew: true, createdAt: ago(42 * DAY), tags: [],
      challenge: 'dns-01', keyType: 'ECDSA P-256', issuedAt: ago(42 * DAY), serial: '04:7d:31:aa:02:9e:c6:15', fingerprint: 'SHA256:0c:5e:8a:33:d1:47:b9:20:6f:e4:12:7a:c8:93:5d:02' },
    { id: 'cert-005', name: 'gitlab-regiocom-energie-de', ...scope('proj-tools'), domains: ['gitlab.regiocom-energie.de'], issuer: 'letsencrypt', status: 'issued', expiresAt: ahead(33 * DAY), autoRenew: true, createdAt: ago(57 * DAY), tags: [],
      challenge: 'http-01', keyType: 'ECDSA P-256', issuedAt: ago(57 * DAY), serial: '03:e2:19:5b:70:c4:aa:81', fingerprint: 'SHA256:9d:2a:61:f0:3c:84:e7:15:ba:40:6d:c2:91:08:7e:53' },
  ];

  return { dbInstances, dbPresets, dbBackups, loadBalancers, certificates };
}
