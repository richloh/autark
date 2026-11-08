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
    { id: 'k8s-002', name: 'enneo-prod', ...scope('proj-enneo-regiocom'), version: '1.32', status: 'running', locationId: 'dc1',
      controlPlane: { ha: true, size: 'medium', endpoint: 'https://k8s-002.k8s.dc1.autark.cloud:6443' },
      nodePools: [
        { id: 'np-4', name: 'system', presetId: 'k8s-np-m', vcpus: 4, ramGB: 8, diskGB: 80, count: 3, autoscale: { enabled: false, min: 3, max: 3 }, labels: tags({ pool: 'system' }), taints: ['CriticalAddonsOnly=true:NoSchedule'], status: 'ready' },
        { id: 'np-5', name: 'cpu', presetId: null, vcpus: 8, ramGB: 32, diskGB: 120, count: 6, autoscale: { enabled: true, min: 4, max: 12 }, labels: tags({ pool: 'cpu' }), taints: [], status: 'ready' },
        { id: 'np-6', name: 'gpu-l40s', presetId: 'k8s-np-gpu-l40s', vcpus: 16, ramGB: 128, diskGB: 400, count: 3, autoscale: { enabled: true, min: 2, max: 4 }, labels: tags({ pool: 'gpu' }), taints: ['nvidia.com/gpu=true:NoSchedule'], gpu: { model: 'L40S', count: 1 }, status: 'ready' },
      ],
      networkId: 'net-012', subnetId: 'sn-023', cni: 'cilium', podCidr: '172.24.0.0/16', serviceCidr: '172.28.0.0/16', storageClass: 'autark-nvme',
      addons: { ingress: true, certManager: true, metricsServer: true, monitoring: true, logging: true, externalDns: false, argocd: true, gpuOperator: true },
      oidc: true, oidcConfig: OIDC_ENNEO,
      autoUpgrade: false, maintenanceWindow: { day: 'sat', hour: 3 }, credentialsRotatedAt: ago(12 * DAY), credentialGeneration: 2, apiAllowlist: ['10.60.0.0/16', '10.99.0.0/16', '192.0.2.0/26'], deletionProtection: true, createdAt: ago(236 * DAY), tags: tags({ env: 'prod', team: 'enneo' }) },
    { id: 'k8s-003', name: 'enneo-staging', ...scope('proj-enneo-intern'), version: '1.32', status: 'running', locationId: 'dc1',
      controlPlane: { ha: false, size: 'small', endpoint: 'https://k8s-003.k8s.dc1.autark.cloud:6443' },
      nodePools: [
        { id: 'np-7', name: 'default', presetId: 'k8s-np-l', vcpus: 8, ramGB: 16, diskGB: 120, count: 3, autoscale: { enabled: true, min: 2, max: 5 }, labels: [], taints: [], status: 'ready' },
        { id: 'np-8', name: 'gpu', presetId: 'k8s-np-gpu-l40s', vcpus: 16, ramGB: 128, diskGB: 400, count: 1, autoscale: { enabled: true, min: 0, max: 2 }, labels: tags({ pool: 'gpu' }), taints: ['nvidia.com/gpu=true:NoSchedule'], gpu: { model: 'L40S', count: 1 }, status: 'ready' },
      ],
      networkId: 'net-010', subnetId: 'sn-019', cni: 'cilium', podCidr: '172.24.0.0/16', serviceCidr: '172.28.0.0/16', storageClass: 'autark-ssd',
      addons: { ingress: true, certManager: true, metricsServer: true, monitoring: false, logging: false, externalDns: false, argocd: true, gpuOperator: true },
      oidc: true, oidcConfig: OIDC_ENNEO, autoUpgrade: true, maintenanceWindow: { day: 'wed', hour: 2 }, credentialsRotatedAt: ago(30 * DAY), credentialGeneration: 1, apiAllowlist: ['10.70.0.0/16', '10.71.0.0/16', '10.99.0.0/16'], createdAt: ago(200 * DAY), tags: tags({ env: 'staging', team: 'enneo' }) },
  ];

  let n = 0;
  const w = (clusterId: string, project: string, namespace: string, name: string, kind: K8sWorkload['kind'], image: string, replicas: number, cpu: number, mem: number, ports: number[] = [], ready = replicas, status: K8sWorkload['status'] = 'Running', extra: Partial<K8sWorkload> = {}): K8sWorkload =>
    ({ id: `wl-${String(++n).padStart(3, '0')}`, clusterId, ...scope(project), namespace, name, kind, image, replicas, readyReplicas: ready, cpuRequestM: cpu, memRequestMi: mem, ports, status, createdAt: ago((n * 3 + 5) * DAY + n * HOUR), tags: [], revision: 1, ...extra });
  const sys = { tolerations: ['*'] };
  const crit = { tolerations: ['CriticalAddonsOnly'] };
  const gpu = { gpuPerPod: 1, tolerations: ['nvidia.com/gpu'] };
  const O = 'proj-orchestrator';
  const RG = 'registry.regiocom-energie.de';
  const EP = 'proj-enneo-regiocom';
  const EI = 'proj-enneo-intern';
  const ER = 'registry.enneo.ai';

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
    // enneo-prod
    w('k8s-002', EP, 'kube-system', 'coredns', 'Deployment', 'coredns/coredns:1.11.3', 2, 100, 70, [53], 2, 'Running', crit),
    w('k8s-002', EP, 'kube-system', 'cilium', 'DaemonSet', 'quay.io/cilium/cilium:v1.16.2', 12, 200, 256, [], 12, 'Running', sys),
    w('k8s-002', EP, 'enneo', 'enneo-api', 'Deployment', `${ER}/enneo/api:4.19.1`, 4, 1000, 2048, [8000], 4, 'Running', { expose: 'ClusterIP', revision: 128 }),
    w('k8s-002', EP, 'enneo', 'enneo-frontend', 'Deployment', `${ER}/enneo/frontend:4.19.1`, 2, 200, 256, [3000], 2, 'Running', { expose: 'ClusterIP', revision: 128 }),
    w('k8s-002', EP, 'enneo', 'enneo-worker', 'Deployment', `${ER}/enneo/worker:4.19.1`, 6, 1000, 2048, [], 6, 'Running', { revision: 128 }),
    w('k8s-002', EP, 'enneo', 'email-ingest', 'Deployment', `${ER}/enneo/email-ingest:4.19.1`, 2, 250, 512, [], 2, 'Running', { revision: 64 }),
    w('k8s-002', EP, 'ai', 'llm-gateway', 'Deployment', `${ER}/enneo/llm-gateway:1.9.0`, 2, 500, 1024, [4000], 2, 'Running', { expose: 'ClusterIP', revision: 21 }),
    w('k8s-002', EP, 'ai', 'vllm-inference', 'Deployment', 'vllm/vllm-openai:v0.6.3', 3, 8000, 65536, [8000], 3, 'Running', { ...gpu, expose: 'ClusterIP', revision: 9 }),
    w('k8s-002', EP, 'ai', 'embedding-service', 'Deployment', 'ghcr.io/huggingface/text-embeddings-inference:cpu-1.5', 2, 2000, 4096, [8080]),
    w('k8s-002', EP, 'enneo', 'nightly-reindex', 'CronJob', `${ER}/enneo/worker:4.19.1`, 1, 1000, 2048, [], 1, 'Running', { schedule: '30 2 * * *' }),
    // enneo-staging
    w('k8s-003', EI, 'kube-system', 'coredns', 'Deployment', 'coredns/coredns:1.11.3', 2, 100, 70, [53], 2, 'Running', crit),
    w('k8s-003', EI, 'kube-system', 'cilium', 'DaemonSet', 'quay.io/cilium/cilium:v1.16.2', 4, 200, 256, [], 4, 'Running', sys),
    w('k8s-003', EI, 'enneo', 'enneo-api', 'Deployment', `${ER}/enneo/api:4.20.0-rc.2`, 1, 500, 1024, [8000], 1, 'Running', { expose: 'ClusterIP', revision: 211 }),
    w('k8s-003', EI, 'enneo', 'enneo-frontend', 'Deployment', `${ER}/enneo/frontend:4.20.0-rc.2`, 1, 100, 256, [3000], 1, 'Running', { expose: 'ClusterIP', revision: 211 }),
    w('k8s-003', EI, 'enneo', 'enneo-worker', 'Deployment', `${ER}/enneo/worker:4.20.0-rc.2`, 2, 500, 1024, [], 2, 'Running', { revision: 211 }),
    w('k8s-003', EI, 'enneo', 'email-ingest', 'Deployment', `${ER}/enneo/email-ingest:4.20.0-rc.2`, 1, 250, 512),
    w('k8s-003', EI, 'ai', 'vllm-inference', 'Deployment', 'vllm/vllm-openai:v0.6.3', 1, 4000, 32768, [8000], 1, 'Running', gpu),
    w('k8s-003', EI, 'ai', 'embedding-service', 'Deployment', 'ghcr.io/huggingface/text-embeddings-inference:cpu-1.5', 1, 1000, 2048, [8080]),
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
