import type { PlatformCluster, K8sSpace, K8sWorkload, SpaceQuota, NodePool } from '@/types';
import { ago, tags, ptags, scope, DAY, HOUR } from './util';

/* Shared Kubernetes: two provider-operated platform clusters and the customer spaces on them.
 * Platform cluster nodes run on open bare-metal hosts with the k8s-worker / k8s-control-plane roles
 * (dc1: mdg-hv-01..03 + mdg-hv-05, dc2: fra-hv-01..03). Workloads in spaces carry `spaceId`. */

const pool = (id: string, name: string, vcpus: number, ramGB: number, count: number, created: number): NodePool => ({
  id, name, presetId: null, vcpus, ramGB, diskGB: 200, count, autoscale: { enabled: false, min: count, max: count }, labels: tags({ 'autark.cloud/pool': name }), taints: [], status: 'ready', createdAt: ago(created * DAY),
});

const Q = (cpuCores: number, memoryGi: number, storageGi: number, pods: number, loadBalancers = 0): SpaceQuota => ({ cpuCores, memoryGi, storageGi, pods, loadBalancers });

export function seedK8sShared() {
  const platformClusters: (PlatformCluster & { cordonedNodes?: string[] })[] = [
    {
      id: 'pc-mdg-1', name: 'shared-mdg-1', description: 'Multi-tenant Kubernetes in RZ Magdeburg for customer spaces (namespace-as-a-service).', locationId: 'dc1', version: '1.31', status: 'running',
      endpoint: 'https://api.shared-mdg-1.k8s.dc1.autark.cloud:6443', ingressDomain: 'k8s.mdg.autark.cloud',
      nodePools: [pool('pnp-mdg-gp', 'general', 16, 64, 4, 180), pool('pnp-mdg-batch', 'batch', 8, 32, 2, 95)],
      controlPlane: { ha: true, size: 'medium' }, cni: 'cilium', access: { mode: 'all', accountIds: [], projectIds: [] }, overcommit: { cpu: 1.5, memory: 1.2 },
      maxTenantQuota: Q(16, 64, 500, 200, 2), podSecurity: 'restricted', storageClasses: ['autark-nvme', 'autark-ssd'], acceptingTenants: true,
      maintenanceWindow: { day: 'tue', hour: 3 }, createdAt: ago(180 * DAY), tags: tags({ tier: 'shared', env: 'production' }), cordonedNodes: [],
    },
    {
      id: 'pc-fra-1', name: 'shared-fra-1', description: 'Smaller shared cluster in RZ Frankfurt — geo-redundant jobs such as backup verification.', locationId: 'dc2', version: '1.32', status: 'running',
      endpoint: 'https://api.shared-fra-1.k8s.dc2.autark.cloud:6443', ingressDomain: 'k8s.fra.autark.cloud',
      nodePools: [pool('pnp-fra-gp', 'general', 8, 32, 3, 120)],
      controlPlane: { ha: false, size: 'small' }, cni: 'cilium', access: { mode: 'all', accountIds: [], projectIds: [] }, overcommit: { cpu: 1.25, memory: 1.1 },
      maxTenantQuota: Q(8, 32, 1000, 100, 1), podSecurity: 'restricted', storageClasses: ['autark-ssd', 'autark-hdd'], acceptingTenants: true,
      maintenanceWindow: { day: 'thu', hour: 2 }, createdAt: ago(120 * DAY), tags: tags({ tier: 'shared', env: 'production' }), cordonedNodes: [],
    },
  ];

  const sp = (id: string, name: string, projectId: string, pcId: string, quota: SpaceQuota, team: K8sSpace['team'], createdDays: number, env: string): K8sSpace & { credentialGeneration: number; credentialsRotatedAt: string | null } => {
    const pc = platformClusters.find((p) => p.id === pcId)!;
    const sc = scope(projectId);
    const slug = sc.accountId.replace(/^acc-/, '');
    return {
      id, name, ...sc, platformClusterId: pc.id, locationId: pc.locationId, namespace: `${slug}-${name}`, quota, tier: 'namespace', status: 'active',
      ingressHost: `*.${name}.${slug}.${pc.ingressDomain}`, team, serviceAccount: 'deployer', networkPolicy: 'default-deny', createdAt: ago(createdDays * DAY),
      tags: sc.accountId === 'acc-regiocom' ? ptags(projectId, env) : tags({ env }), credentialGeneration: 1, credentialsRotatedAt: null,
    };
  };

  const k8sSpaces = [
    sp('spc-website', 'website', 'proj-website', 'pc-mdg-1', Q(2, 4, 20, 30), [{ userIds: ['user-007', 'user-001'], role: 'edit' }], 64, 'production'),
    sp('spc-tools', 'tools', 'proj-tools', 'pc-mdg-1', Q(3, 4, 10, 40), [{ userIds: ['user-002', 'user-011'], role: 'edit' }, { userIds: ['user-003'], role: 'view' }], 150, 'production'),
    sp('spc-compass-reports', 'compass-reports', 'proj-compass', 'pc-mdg-1', Q(12, 32, 50, 60), [{ userIds: ['user-005', 'user-006'], role: 'edit' }, { userIds: ['user-008'], role: 'view' }], 41, 'production'),
    sp('spc-edifact-test', 'edifact-test', 'proj-orchestrator', 'pc-mdg-1', Q(8, 16, 20, 40), [{ userIds: ['user-006'], role: 'edit' }, { userIds: ['user-005'], role: 'view' }], 97, 'test'),
    sp('spc-backup-verify', 'backup-verify', 'proj-tools', 'pc-fra-1', Q(2, 6, 50, 10), [{ userIds: ['user-002'], role: 'edit' }], 88, 'production'),
  ];
  k8sSpaces[1].credentialGeneration = 2;
  k8sSpaces[1].credentialsRotatedAt = ago(30 * DAY);

  let n = 0;
  const w = (spaceId: string, name: string, kind: K8sWorkload['kind'], image: string, replicas: number, cpu: number, mem: number, extra: Partial<K8sWorkload> & { storageGi?: number } = {}): K8sWorkload => {
    const s = k8sSpaces.find((x) => x.id === spaceId)!;
    n++;
    return {
      id: `wl-s${String(n).padStart(2, '0')}`, clusterId: s.platformClusterId, accountId: s.accountId, projectId: s.projectId, spaceId, namespace: s.namespace, name, kind, image,
      replicas, readyReplicas: replicas, cpuRequestM: cpu, memRequestMi: mem, ports: [], status: 'Running', createdAt: ago(Date.now() - Date.parse(s.createdAt) - (n % 5) * DAY - n * HOUR), tags: [], revision: 1 + (n % 4), expose: 'none', managedBy: null,
      ...extra,
    } as K8sWorkload;
  };
  const RG = 'registry.regiocom-energie.de';
  const ER = 'registry.enneo.ai';

  const k8sWorkloads: K8sWorkload[] = [
    // website — headless CMS + preview builds; 1.8 / 2 cores requested (90 %, shows the quota warning)
    w('spc-website', 'strapi', 'Deployment', `${RG}/website/strapi-cms:4.25.9`, 1, 500, 1024, { ports: [1337], expose: 'ClusterIP', storageGi: 10 }),
    w('spc-website', 'preview-builder', 'Deployment', `${RG}/website/preview-builder:2.14.0`, 1, 1000, 1536, { ports: [3000], expose: 'ClusterIP' }),
    w('spc-website', 'cms-sync', 'CronJob', `${RG}/website/cms-sync:1.3.2`, 1, 300, 512, { schedule: '*/30 * * * *' }),
    // tools — Renovate, internal dashboards
    w('spc-tools', 'renovate', 'CronJob', 'ghcr.io/renovatebot/renovate:39.42.4', 1, 1000, 2048, { schedule: '0 */4 * * *' }),
    w('spc-tools', 'backstage', 'Deployment', `${RG}/tools/backstage:1.33.0`, 1, 500, 768, { ports: [7007], expose: 'ClusterIP' }),
    w('spc-tools', 'uptime-kuma', 'StatefulSet', 'louislam/uptime-kuma:1.23.15', 1, 250, 256, { ports: [3001], expose: 'ClusterIP', storageGi: 5 }),
    w('spc-tools', 'oauth2-proxy', 'Deployment', 'quay.io/oauth2-proxy/oauth2-proxy:v7.7.1', 2, 100, 64, { ports: [4180], expose: 'ClusterIP' }),
    // compass-reports — PDF rendering for invoices / Turnusabrechnung
    w('spc-compass-reports', 'report-renderer', 'Deployment', 'gotenberg/gotenberg:8.14.1', 4, 1000, 2048, { ports: [3000], expose: 'ClusterIP' }),
    w('spc-compass-reports', 'report-api', 'Deployment', `${RG}/compass/report-api:5.2.0`, 2, 500, 1024, { ports: [8080], expose: 'ClusterIP' }),
    w('spc-compass-reports', 'turnus-batch', 'CronJob', `${RG}/compass/report-batch:5.2.0`, 1, 3000, 6144, { schedule: '0 1 * * *' }),
    w('spc-compass-reports', 'redis', 'StatefulSet', 'redis:7.4-alpine', 1, 250, 1024, { ports: [6379], expose: 'ClusterIP', storageGi: 10 }),
    // edifact-test — MaKo partner simulator for Orchestrator integration tests
    w('spc-edifact-test', 'mako-partner-sim', 'Deployment', `${RG}/mako/partner-simulator:0.9.3`, 2, 1000, 2048, { ports: [8443], expose: 'ClusterIP' }),
    w('spc-edifact-test', 'as4-test-gateway', 'Deployment', `${RG}/mako/as4-gateway:2.8.0`, 1, 500, 1024, { ports: [8080], expose: 'ClusterIP' }),
    w('spc-edifact-test', 'edifact-replay', 'CronJob', `${RG}/mako/edifact-replay:1.2.0`, 1, 2000, 4096, { schedule: '*/20 6-20 * * 1-5' }),
    // backup-verify (RZ Frankfurt) — restore tests of the Magdeburg backups
    w('spc-backup-verify', 'restic-verify', 'CronJob', 'restic/restic:0.17.3', 1, 1000, 2048, { schedule: '30 3 * * *', storageGi: 20 }),
    w('spc-backup-verify', 'restore-test-db', 'StatefulSet', 'postgres:17.2-alpine', 1, 500, 2048, { ports: [5432], expose: 'ClusterIP', storageGi: 20 }),
    w('spc-backup-verify', 'verify-exporter', 'Deployment', `${RG}/tools/backup-verify-exporter:1.1.0`, 1, 100, 128, { ports: [9100], expose: 'ClusterIP' }),
  ];

  return { platformClusters, k8sSpaces, k8sWorkloads };
}
