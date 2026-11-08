import { K8S_ADDONS, type K8sCluster, type K8sWorkload } from '@/types';
import { ago, tags, ptags, scope, DAY, HOUR } from './util';

const OIDC_REGIOCOM = { issuerUrl: 'https://sso.regiocom-energie.de/realms/regiocom', clientId: 'kubernetes', usernameClaim: 'email', groupsClaim: 'groups', groupsPrefix: 'oidc:' };
const OIDC_ENNEO = { issuerUrl: 'https://auth.enneo.ai/realms/enneo', clientId: 'kubernetes', usernameClaim: 'email', groupsClaim: 'groups' };

export function seedK8s() {
  const k8sClusters: K8sCluster[] = [
    { id: 'k8s-001', name: 'orchestrator-prod', ...scope('proj-orchestrator'), version: '1.31', status: 'running', locationId: 'dc1',
      controlPlane: { ha: true, size: 'medium', endpoint: 'https://k8s-001.k8s.dc1.autark.cloud:6443' },
      nodePools: [
        { id: 'np-1', name: 'system', presetId: 'k8s-np-m', vcpus: 4, ramGB: 8, diskGB: 80, count: 3, autoscale: { enabled: false, min: 3, max: 3 }, labels: tags({ pool: 'system' }), taints: ['CriticalAddonsOnly=true:NoSchedule'], status: 'ready' },
        { id: 'np-2', name: 'workers', presetId: null, vcpus: 8, ramGB: 32, diskGB: 120, count: 6, autoscale: { enabled: true, min: 4, max: 10 }, labels: tags({ pool: 'workers' }), taints: [], status: 'ready' },
        { id: 'np-3', name: 'kafka', presetId: 'k8s-np-mem', vcpus: 8, ramGB: 64, diskGB: 120, count: 3, autoscale: { enabled: false, min: 3, max: 3 }, labels: tags({ pool: 'kafka' }), taints: ['dedicated=kafka:NoSchedule'], status: 'ready' },
      ],
      networkId: 'net-002', subnetId: 'sn-006', cni: 'cilium', podCidr: '172.16.0.0/16', serviceCidr: '172.20.0.0/16', storageClass: 'autark-nvme',
      addons: { ingress: true, certManager: true, metricsServer: true, monitoring: true, logging: true, externalDns: false, argocd: true, gpuOperator: false },
      oidc: true, oidcConfig: OIDC_REGIOCOM,
      autoUpgrade: false, maintenanceWindow: { day: 'sun', hour: 4 }, credentialsRotatedAt: ago(40 * DAY), credentialGeneration: 3, apiAllowlist: ['10.0.0.0/8', '10.99.0.0/16'], deletionProtection: true, createdAt: ago(520 * DAY), tags: ptags('proj-orchestrator', 'prod') },
    // Enneo · Regiocom prod — p6 (production) and p9 (staging): one node pool of 3 nodes each, no GPUs.
    // Every node has its own public IP (no load balancer); ingress-nginx serves HTTPS on the node IPs.
    { id: 'k8s-002', name: 'p6', ...scope('proj-enneo-regiocom'), version: '1.32', status: 'running', locationId: 'dc1',
      controlPlane: { ha: true, size: 'medium', endpoint: 'https://k8s-002.k8s.dc1.autark.cloud:6443' },
      nodePools: [
        { id: 'np-5', name: 'workers', presetId: null, vcpus: 16, ramGB: 64, diskGB: 200, count: 3, autoscale: { enabled: false, min: 3, max: 3 }, labels: tags({ pool: 'workers' }), taints: [], status: 'ready' },
      ],
      networkId: 'net-012', subnetId: 'sn-023', cni: 'cilium', podCidr: '172.24.0.0/16', serviceCidr: '172.28.0.0/16', storageClass: 'autark-nvme',
      addons: { ingress: true, certManager: true, metricsServer: true, monitoring: true, logging: true, externalDns: false, argocd: true, gpuOperator: false },
      oidc: true, oidcConfig: OIDC_ENNEO,
      autoUpgrade: false, maintenanceWindow: { day: 'sat', hour: 3 }, credentialsRotatedAt: ago(12 * DAY), credentialGeneration: 2, apiAllowlist: ['10.60.0.0/16', '10.70.0.0/16', '10.71.1.11/32', '10.99.0.0/16'], deletionProtection: true, createdAt: ago(236 * DAY), tags: tags({ env: 'production', team: 'enneo' }) },
    { id: 'k8s-003', name: 'p9', ...scope('proj-enneo-regiocom'), version: '1.32', status: 'running', locationId: 'dc1',
      controlPlane: { ha: false, size: 'small', endpoint: 'https://k8s-003.k8s.dc1.autark.cloud:6443' },
      nodePools: [
        { id: 'np-7', name: 'workers', presetId: null, vcpus: 8, ramGB: 32, diskGB: 120, count: 3, autoscale: { enabled: false, min: 3, max: 3 }, labels: tags({ pool: 'workers' }), taints: [], status: 'ready' },
      ],
      networkId: 'net-012', subnetId: 'sn-023', cni: 'cilium', podCidr: '172.25.0.0/16', serviceCidr: '172.29.0.0/16', storageClass: 'autark-nvme',
      addons: { ingress: true, certManager: true, metricsServer: true, monitoring: false, logging: false, externalDns: false, argocd: true, gpuOperator: false },
      oidc: true, oidcConfig: OIDC_ENNEO, autoUpgrade: true, maintenanceWindow: { day: 'wed', hour: 2 }, credentialsRotatedAt: ago(30 * DAY), credentialGeneration: 1, apiAllowlist: ['10.60.0.0/16', '10.70.0.0/16', '10.71.1.11/32', '10.99.0.0/16'], createdAt: ago(232 * DAY), tags: tags({ env: 'staging', team: 'enneo' }) },
  ];

  let n = 0;
  const w = (clusterId: string, project: string, namespace: string, name: string, kind: K8sWorkload['kind'], image: string, replicas: number, cpu: number, mem: number, ports: number[] = [], ready = replicas, status: K8sWorkload['status'] = 'Running', extra: Partial<K8sWorkload> = {}): K8sWorkload =>
    ({ id: `wl-${String(++n).padStart(3, '0')}`, clusterId, ...scope(project), namespace, name, kind, image, replicas, readyReplicas: ready, cpuRequestM: cpu, memRequestMi: mem, ports, status, createdAt: ago((n * 3 + 5) * DAY + n * HOUR), tags: [], revision: 1, ...extra });
  const sys = { tolerations: ['*'] };
  const crit = { tolerations: ['CriticalAddonsOnly'] };
  const O = 'proj-orchestrator';
  const RG = 'registry.regiocom-energie.de';
  const EP = 'proj-enneo-regiocom';
  const ER = 'registry.enneo.ai';

  type Size = [replicas: number, cpuM: number, memMi: number];
  const enneo = (cluster: string, env: 'production' | 'staging', z: Record<'api' | 'frontend' | 'worker' | 'ingest' | 'llm' | 'webhook' | 'voice' | 'embed' | 'postgres' | 'redis', Size> & { cilium: number }, ver: string, rev: number): K8sWorkload[] => {
    const app = (ns: string, name: string, image: string, [rep, cpu, mem]: Size, ports: number[] = [], extra: Partial<K8sWorkload> = {}) =>
      w(cluster, EP, ns, name, 'Deployment', image, rep, cpu, mem, ports, rep, 'Running', { tags: tags({ env }), ...extra });
    return [
      w(cluster, EP, 'kube-system', 'coredns', 'Deployment', 'coredns/coredns:1.11.3', 2, 100, 70, [53], 2, 'Running', crit),
      w(cluster, EP, 'kube-system', 'cilium', 'DaemonSet', 'quay.io/cilium/cilium:v1.16.2', z.cilium, 200, 256, [], z.cilium, 'Running', sys),
      app('enneo', 'enneo-api', `${ER}/enneo/api:${ver}`, z.api, [8000], { expose: 'ClusterIP', revision: rev }),
      app('enneo', 'enneo-frontend', `${ER}/enneo/frontend:${ver}`, z.frontend, [3000], { expose: 'ClusterIP', revision: rev }),
      app('enneo', 'enneo-worker', `${ER}/enneo/worker:${ver}`, z.worker, [], { revision: rev }),
      app('enneo', 'email-ingest', `${ER}/enneo/email-ingest:${ver}`, z.ingest, [], { revision: Math.round(rev / 2) }),
      app('enneo', 'webhook-gateway', `${ER}/enneo/webhook-gateway:${ver}`, z.webhook, [8080], { expose: 'ClusterIP', revision: Math.round(rev / 3) }),
      app('enneo', 'voice-gateway', `${ER}/enneo/voice-gateway:2.3.0`, z.voice, [5060, 8088], { expose: 'ClusterIP', revision: 14 }),
      app('ai', 'llm-gateway', `${ER}/enneo/llm-gateway:1.9.0`, z.llm, [4000], { expose: 'ClusterIP', revision: 21 }),
      app('ai', 'embedding-service', 'ghcr.io/huggingface/text-embeddings-inference:cpu-1.5', z.embed, [8080], { expose: 'ClusterIP' }),
      w(cluster, EP, 'data', 'postgres', 'StatefulSet', 'ghcr.io/cloudnative-pg/postgresql:17.2', z.postgres[0], z.postgres[1], z.postgres[2], [5432], z.postgres[0], 'Running', { expose: 'ClusterIP', tags: tags({ env }) }),
      w(cluster, EP, 'data', 'redis', 'StatefulSet', 'redis:7.4-alpine', z.redis[0], z.redis[1], z.redis[2], [6379], z.redis[0], 'Running', { expose: 'ClusterIP', tags: tags({ env }) }),
      w(cluster, EP, 'enneo', 'nightly-reindex', 'CronJob', `${ER}/enneo/worker:${ver}`, 1, 1000, 2048, [], 1, 'Running', { schedule: '30 2 * * *' }),
      ...(env === 'production' ? [w(cluster, EP, 'data', 'pg-backup', 'CronJob', 'ghcr.io/enneo/pg-restic:1.4.0', 1, 500, 1024, [], 1, 'Running', { schedule: '15 1 * * *' })] : []),
    ];
  };

  const k8sWorkloads: K8sWorkload[] = [
    // orchestrator-prod
    w('k8s-001', O, 'kube-system', 'coredns', 'Deployment', 'coredns/coredns:1.11.3', 2, 100, 70, [53], 2, 'Running', crit),
    w('k8s-001', O, 'kube-system', 'cilium', 'DaemonSet', 'quay.io/cilium/cilium:v1.16.2', 12, 200, 256, [], 12, 'Running', sys),
    w('k8s-001', O, 'orchestrator', 'orchestrator-api', 'Deployment', `${RG}/orchestrator/api:3.14.2`, 3, 500, 1024, [8080], 3, 'Running', { expose: 'ClusterIP', revision: 42 }),
    w('k8s-001', O, 'orchestrator', 'workflow-engine', 'Deployment', `${RG}/orchestrator/workflow-engine:3.14.2`, 4, 1000, 2048, [7233], 4, 'Running', { revision: 42 }),
    w('k8s-001', O, 'mako', 'edifact-gateway', 'Deployment', `${RG}/mako/edifact-gateway:2.8.0`, 2, 500, 1024, [8443], 2, 'Running', { expose: 'ClusterIP', revision: 17 }),
    w('k8s-001', O, 'mako', 'mako-adapter', 'Deployment', `${RG}/mako/mako-adapter:2.8.0`, 2, 500, 1024, [8080], 2, 'Running', { revision: 17 }),
    w('k8s-001', O, 'mako', 'fristen-monitor', 'CronJob', `${RG}/mako/fristen-monitor:1.4.1`, 1, 200, 256, [], 1, 'Running', { schedule: '*/15 * * * *' }),
    w('k8s-001', O, 'kafka', 'kafka', 'StatefulSet', 'bitnami/kafka:3.8.0', 3, 2000, 16384, [9092], 3, 'Running', { tolerations: ['dedicated'], nodeSelector: tags({ pool: 'kafka' }) }),
    w('k8s-001', O, 'temporal', 'temporal-frontend', 'Deployment', 'temporalio/server:1.25.1', 2, 500, 1024, [7233]),
    w('k8s-001', O, 'temporal', 'temporal-history', 'Deployment', 'temporalio/server:1.25.1', 3, 1000, 2048, [7234]),
    w('k8s-001', O, 'temporal', 'temporal-matching', 'Deployment', 'temporalio/server:1.25.1', 2, 500, 1024, [7235]),
    w('k8s-001', O, 'temporal', 'temporal-web', 'Deployment', 'temporalio/ui:2.31.2', 1, 100, 256, [8080]),
    // p6 — Enneo production for Regiocom (3 × 16 vCPU / 64 GB)
    ...enneo('k8s-002', 'production', {
      api: [4, 1000, 2048], frontend: [2, 200, 256], worker: [6, 1000, 2048], ingest: [2, 250, 512], llm: [2, 500, 1024], webhook: [2, 250, 256], voice: [2, 500, 512], embed: [2, 2000, 4096],
      postgres: [2, 4000, 16384], redis: [3, 500, 2048], cilium: 3,
    }, '4.19.1', 128),
    // p9 — Enneo staging (3 × 8 vCPU / 32 GB), same stack with fewer replicas
    ...enneo('k8s-003', 'staging', {
      api: [2, 500, 1024], frontend: [1, 100, 256], worker: [2, 500, 1024], ingest: [1, 250, 512], llm: [1, 250, 512], webhook: [1, 100, 128], voice: [1, 250, 256], embed: [1, 1000, 2048],
      postgres: [1, 2000, 8192], redis: [1, 250, 1024], cilium: 3,
    }, '4.20.0-rc.2', 211),
  ];
  // every enabled add-on has its workloads in the cluster
  for (const c of k8sClusters) {
    for (const addon of K8S_ADDONS) {
      if (!c.addons[addon.id]) continue;
      for (const aw of addon.workloads) {
        if (k8sWorkloads.some((x) => x.clusterId === c.id && x.namespace === aw.namespace && x.name === aw.name)) continue;
        k8sWorkloads.push(w(c.id, c.projectId, aw.namespace, aw.name, aw.kind, aw.image, aw.replicas, aw.cpuRequestM, aw.memRequestMi, aw.ports ?? [], aw.replicas, 'Running',
          { managedBy: addon.id, tolerations: aw.tolerations, nodeSelector: aw.nodeSelector, createdAt: c.createdAt }));
      }
    }
  }
  return { k8sClusters, k8sWorkloads };
}
