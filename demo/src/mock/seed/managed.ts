import type { DbInstance, DbPreset, DbBackup, LoadBalancer, Certificate } from '@/types';
import { ago, ahead, tags, scope, DAY, HOUR } from './util';

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

  const base = { storageAutoscale: true, readReplicas: 0, publicAccess: false, parameters: {} as Record<string, string> };
  const dbInstances: DbInstance[] = [
    { ...base, id: 'db-001', name: 'pg-app1', ...scope('proj-app1'), engine: 'postgres', version: '16', status: 'available', size: { presetId: 'db-pg-m', vcpus: 4, ramGB: 16 }, storageGB: 200, storageUsedGB: 84, ha: true, readReplicas: 1,
      locationId: 'dc1', networkId: 'net-001', subnetId: 'sn-002', firewallIds: ['fw-004'], host: 'pg-app1.db.dc1.autark.internal', port: 5432, privateIp: '10.10.2.50', primaryHostId: 'bm-003', standbyHostId: 'bm-005', deletionProtection: true,
      users: [{ username: 'postgres', role: 'owner', createdAt: ago(300 * DAY) }, { username: 'app', role: 'readwrite', createdAt: ago(300 * DAY) }, { username: 'metabase', role: 'readonly', createdAt: ago(40 * DAY) }],
      databases: [{ name: 'shop', owner: 'app', sizeMB: 61_200 }, { name: 'sessions', owner: 'app', sizeMB: 4_100 }, { name: 'audit', owner: 'postgres', sizeMB: 12_800 }],
      backups: { enabled: true, schedule: 'daily', retention: 14, pitr: true, window: '01:00-02:00' }, maintenanceWindow: { day: 'sun', hour: 3 },
      parameters: { max_connections: '400', shared_buffers: '4GB', work_mem: '16MB', log_min_duration_statement: '500' }, createdAt: ago(300 * DAY), tags: tags({ env: 'prod', app: 'web' }) },
    { ...base, id: 'db-002', name: 'redis-ml', ...scope('proj-ml'), engine: 'redis', version: '7.4', status: 'available', size: { presetId: 'db-rd-m', vcpus: 2, ramGB: 16 }, storageGB: 32, storageUsedGB: 9, ha: false,
      locationId: 'dc1', networkId: 'net-002', subnetId: 'sn-003', firewallIds: ['fw-007'], host: 'redis-ml.db.dc1.autark.internal', port: 6379, privateIp: '10.20.1.50', primaryHostId: 'bm-008',
      users: [{ username: 'default', role: 'owner', createdAt: ago(180 * DAY) }, { username: 'feast', role: 'readwrite', createdAt: ago(100 * DAY) }], databases: [{ name: 'db0', owner: 'default', sizeMB: 9_100 }],
      backups: { enabled: true, schedule: 'daily', retention: 3, pitr: false, window: '03:00-04:00' }, maintenanceWindow: { day: 'sat', hour: 4 }, parameters: { 'maxmemory-policy': 'allkeys-lru' }, createdAt: ago(180 * DAY), tags: tags({ team: 'ml' }) },
    { ...base, id: 'db-003', name: 'mysql-app2', ...scope('proj-app2'), engine: 'mysql', version: '8.0', status: 'available', size: { presetId: 'db-my-m', vcpus: 4, ramGB: 8 }, storageGB: 100, storageUsedGB: 71, ha: false,
      locationId: 'dc2', networkId: 'net-003', subnetId: 'sn-005', firewallIds: ['fw-012'], host: 'mysql-app2.db.dc2.autark.internal', port: 3306, privateIp: '10.30.2.50', primaryHostId: 'bm-004',
      users: [{ username: 'root', role: 'owner', createdAt: ago(280 * DAY) }, { username: 'portal', role: 'readwrite', createdAt: ago(280 * DAY) }], databases: [{ name: 'portal', owner: 'portal', sizeMB: 70_300 }],
      backups: { enabled: true, schedule: 'daily', retention: 7, pitr: false, window: '02:00-03:00' }, maintenanceWindow: { day: 'sun', hour: 2 }, parameters: { innodb_buffer_pool_size: '5G', max_connections: '300' }, pendingRestart: ['innodb_buffer_pool_size'], createdAt: ago(280 * DAY), tags: tags({ env: 'staging', app: 'portal' }) },
    { ...base, id: 'db-004', name: 'pg-billing', ...scope('proj-app2'), engine: 'postgres', version: '17', status: 'available', size: { presetId: 'db-pg-s', vcpus: 2, ramGB: 4 }, storageGB: 50, storageUsedGB: 12, ha: false,
      locationId: 'dc2', networkId: 'net-003', subnetId: 'sn-005', firewallIds: ['fw-012'], host: 'pg-billing.db.dc2.autark.internal', port: 5432, privateIp: '10.30.2.51', primaryHostId: 'bm-011',
      users: [{ username: 'postgres', role: 'owner', createdAt: ago(30 * DAY) }, { username: 'billing', role: 'readwrite', createdAt: ago(30 * DAY) }], databases: [{ name: 'billing', owner: 'billing', sizeMB: 11_900 }],
      backups: { enabled: true, schedule: 'hourly', retention: 7, pitr: true, window: '00:00-24:00' }, maintenanceWindow: { day: 'wed', hour: 2 }, createdAt: ago(30 * DAY), tags: tags({ env: 'prod', app: 'billing' }) },
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
    { id: 'lb-001', name: 'web-lb', ...scope('proj-app1'), type: 'L7', status: 'active', algorithm: 'least_connections', locationId: 'dc1', networkId: 'net-001', ipIds: ['ip-002', 'ip-014'], hostname: 'web-lb.lb.dc1.autark.cloud',
      listeners: [
        { id: 'lst-1', port: 443, protocol: 'HTTPS', certificateId: 'cert-001', defaultTargetGroupId: 'tg-web', rules: [{ id: 'lr-1', pathPrefix: '/api', targetGroupId: 'tg-api' }, { id: 'lr-2', host: 'static.example.com', targetGroupId: 'tg-web' }] },
        { id: 'lst-2', port: 80, protocol: 'HTTP', defaultTargetGroupId: 'tg-web', rules: [], redirectToHttps: true },
      ],
      targetGroups: [
        { id: 'tg-web', name: 'web', protocol: 'HTTP', port: 80, stickySessions: false, healthCheck: hc, targets: [
          { ref: { type: 'vm', id: 'vm-001' }, weight: 100, health: 'healthy' }, { ref: { type: 'vm', id: 'vm-003' }, weight: 100, health: 'healthy' }, { ref: { type: 'vm', id: 'vm-009' }, weight: 50, health: 'unhealthy' }] },
        { id: 'tg-api', name: 'api', protocol: 'HTTP', port: 8080, stickySessions: true, healthCheck: { ...hc, path: '/api/health' }, targets: [
          { ref: { type: 'k8s', id: 'k8s-001' }, port: 30080, weight: 100, health: 'healthy' }] },
      ],
      firewallIds: ['fw-006'], proxyProtocol: false, createdAt: ago(280 * DAY), tags: tags({ env: 'prod' }) },
    { id: 'lb-002', name: 'api-staging-lb', ...scope('proj-app2'), type: 'L4', status: 'active', algorithm: 'round_robin', locationId: 'dc2', networkId: 'net-003', ipIds: ['ip-007'], hostname: 'api-staging-lb.lb.dc2.autark.cloud',
      listeners: [{ id: 'lst-3', port: 8080, protocol: 'TCP', defaultTargetGroupId: 'tg-api2', rules: [] }, { id: 'lst-4', port: 443, protocol: 'TCP', defaultTargetGroupId: 'tg-api2', rules: [] }],
      targetGroups: [{ id: 'tg-api2', name: 'api-servers', protocol: 'TCP', port: 8080, stickySessions: false, healthCheck: { ...hc, protocol: 'TCP', path: '' }, targets: [
        { ref: { type: 'vm', id: 'vm-004' }, weight: 100, health: 'healthy' }, { ref: { type: 'vm', id: 'vm-010' }, weight: 100, health: 'healthy' }] }],
      firewallIds: ['fw-008'], proxyProtocol: true, createdAt: ago(200 * DAY), tags: tags({ env: 'staging' }) },
  ];

  const certificates: Certificate[] = [
    { id: 'cert-001', name: 'example-com', ...scope('proj-app1'), domains: ['example.com', '*.example.com'], issuer: 'letsencrypt', status: 'issued', expiresAt: ahead(62 * DAY), autoRenew: true, createdAt: ago(28 * DAY), tags: [],
      challenge: 'dns-01', keyType: 'ECDSA P-256', issuedAt: ago(28 * DAY), serial: '04:a1:9c:3e:77:10:5b:d2', fingerprint: 'SHA256:3f:9a:12:c4:8e:71:0b:d5:66:20:aa:4e:19:c3:72:e1' },
    { id: 'cert-002', name: 'api-example-org', ...scope('proj-app2'), domains: ['api.example.org'], issuer: 'custom', status: 'expiring', expiresAt: ahead(9 * DAY), autoRenew: false, createdAt: ago(356 * DAY), tags: [],
      keyType: 'RSA 2048', issuedAt: ago(356 * DAY), serial: '1c:07:e2:94:5a:b3:0f:68', fingerprint: 'SHA256:b2:47:0e:91:dd:35:7c:a8:10:f4:63:2b:9e:05:c1:7a' },
    { id: 'cert-003', name: 'static-example-com', ...scope('proj-app1'), domains: ['static.example.com'], issuer: 'letsencrypt', status: 'issued', expiresAt: ahead(80 * DAY), autoRenew: true, createdAt: ago(10 * DAY), tags: [],
      challenge: 'http-01', keyType: 'ECDSA P-256', issuedAt: ago(10 * DAY), serial: '03:5e:aa:10:c9:42:81:7d', fingerprint: 'SHA256:71:c0:2d:e8:55:9b:14:a3:0c:e6:48:bf:23:90:d7:6e' },
  ];

  return { dbInstances, dbPresets, dbBackups, loadBalancers, certificates };
}
