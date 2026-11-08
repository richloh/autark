import { K8S_ADDONS, type K8sCluster, type K8sWorkload } from '@/types';
import { ago, tags, scope, DAY, HOUR } from './util';

export function seedK8s() {
  const k8sClusters: K8sCluster[] = [
    { id: 'k8s-001', name: 'app1-cluster', ...scope('proj-app1'), version: '1.30', status: 'running', locationId: 'dc1',
      controlPlane: { ha: false, size: 'small', endpoint: 'https://k8s-001.k8s.dc1.autark.cloud:6443' },
      nodePools: [
        { id: 'np-1', name: 'web-pool', presetId: 'k8s-np-m', vcpus: 4, ramGB: 8, diskGB: 80, count: 3, autoscale: { enabled: true, min: 2, max: 6 }, labels: tags({ role: 'web' }), taints: [], status: 'ready' },
        { id: 'np-2', name: 'system', presetId: 'k8s-np-s', vcpus: 2, ramGB: 4, diskGB: 60, count: 2, autoscale: { enabled: false, min: 2, max: 2 }, labels: tags({ role: 'system' }), taints: ['CriticalAddonsOnly=true:NoSchedule'], status: 'ready' },
      ],
      networkId: 'net-001', subnetId: 'sn-007', cni: 'calico', podCidr: '172.16.0.0/16', serviceCidr: '172.20.0.0/16', storageClass: 'autark-ssd',
      addons: { ingress: true, certManager: true, metricsServer: true, monitoring: true, logging: false, externalDns: true, argocd: false, gpuOperator: false },
      oidc: true, oidcConfig: { issuerUrl: 'https://sso.example.com/realms/autark', clientId: 'kubernetes', usernameClaim: 'email', groupsClaim: 'groups', groupsPrefix: 'oidc:' },
      autoUpgrade: false, maintenanceWindow: { day: 'sun', hour: 4 }, credentialsRotatedAt: ago(40 * DAY), credentialGeneration: 3, apiAllowlist: ['0.0.0.0/0'], deletionProtection: true, createdAt: ago(250 * DAY), tags: tags({ env: 'prod' }) },
    { id: 'k8s-002', name: 'ml-platform', ...scope('proj-ml'), version: '1.31', status: 'running', locationId: 'dc1',
      controlPlane: { ha: true, size: 'medium', endpoint: 'https://k8s-002.k8s.dc1.autark.cloud:6443' },
      nodePools: [
        { id: 'np-3', name: 'cpu-pool', presetId: 'k8s-np-m', vcpus: 4, ramGB: 8, diskGB: 80, count: 3, autoscale: { enabled: true, min: 3, max: 10 }, labels: tags({ workload: 'cpu' }), taints: [], status: 'ready' },
        { id: 'np-4', name: 'gpu-pool', presetId: null, vcpus: 8, ramGB: 64, diskGB: 200, count: 2, autoscale: { enabled: true, min: 0, max: 4 }, labels: tags({ workload: 'gpu' }), taints: ['nvidia.com/gpu=true:NoSchedule'], gpu: { model: 'A6000', count: 1 }, status: 'ready' },
      ],
      networkId: 'net-002', subnetId: 'sn-011', cni: 'cilium', podCidr: '172.24.0.0/16', serviceCidr: '172.28.0.0/16', storageClass: 'autark-nvme',
      addons: { ingress: true, certManager: true, metricsServer: true, monitoring: true, logging: true, externalDns: false, argocd: true, gpuOperator: true },
      oidc: true, oidcConfig: { issuerUrl: 'https://sso.example.com/realms/autark', clientId: 'kubernetes-ml', usernameClaim: 'email', groupsClaim: 'groups' },
      autoUpgrade: true, maintenanceWindow: { day: 'sat', hour: 3 }, credentialsRotatedAt: ago(12 * DAY), credentialGeneration: 1, apiAllowlist: ['10.0.0.0/8', '203.0.113.0/24'], createdAt: ago(180 * DAY), tags: tags({ team: 'ml' }) },
    { id: 'k8s-003', name: 'infra-tools', ...scope('proj-infra'), version: '1.29', status: 'running', locationId: 'dc2',
      controlPlane: { ha: false, size: 'small', endpoint: 'https://k8s-003.k8s.dc2.autark.cloud:6443' },
      nodePools: [{ id: 'np-5', name: 'default', presetId: 'k8s-np-m', vcpus: 4, ramGB: 8, diskGB: 80, count: 2, autoscale: { enabled: false, min: 2, max: 2 }, labels: [], taints: [], status: 'ready' }],
      networkId: 'net-005', subnetId: 'sn-009', cni: 'flannel', podCidr: '172.16.0.0/16', serviceCidr: '172.20.0.0/16', storageClass: 'autark-ssd',
      addons: { ingress: true, certManager: false, metricsServer: true, monitoring: false, logging: false, externalDns: false, argocd: false, gpuOperator: false },
      oidc: false, oidcConfig: null, autoUpgrade: false, maintenanceWindow: { day: 'sun', hour: 2 }, credentialsRotatedAt: null, credentialGeneration: 1, privateEndpoint: true, apiAllowlist: ['10.50.0.0/16'], createdAt: ago(360 * DAY), tags: [] },
  ];

  let n = 0;
  const w = (clusterId: string, project: string, namespace: string, name: string, kind: K8sWorkload['kind'], image: string, replicas: number, cpu: number, mem: number, ports: number[] = [], ready = replicas, status: K8sWorkload['status'] = 'Running', extra: Partial<K8sWorkload> = {}): K8sWorkload =>
    ({ id: `wl-${String(++n).padStart(3, '0')}`, clusterId, ...scope(project), namespace, name, kind, image, replicas, readyReplicas: ready, cpuRequestM: cpu, memRequestMi: mem, ports, status, createdAt: ago((n * 3 + 5) * DAY + n * HOUR), tags: [], revision: 1, ...extra });
  const sys = { tolerations: ['*'] };

  const k8sWorkloads: K8sWorkload[] = [
    w('k8s-001', 'proj-app1', 'kube-system', 'coredns', 'Deployment', 'coredns/coredns:1.11.3', 2, 100, 70, [53], 2, 'Running', { tolerations: ['CriticalAddonsOnly'] }),
    w('k8s-001', 'proj-app1', 'kube-system', 'calico-node', 'DaemonSet', 'calico/node:v3.28.1', 5, 250, 128, [], 5, 'Running', sys),
    w('k8s-001', 'proj-app1', 'ingress-nginx', 'ingress-nginx-controller', 'Deployment', 'registry.k8s.io/ingress-nginx/controller:v1.11.2', 2, 200, 256, [80, 443], 2, 'Running', { managedBy: 'ingress', expose: 'LoadBalancer' }),
    w('k8s-001', 'proj-app1', 'cert-manager', 'cert-manager', 'Deployment', 'quay.io/jetstack/cert-manager-controller:v1.15.3', 1, 50, 128, [], 1, 'Running', { managedBy: 'certManager' }),
    w('k8s-001', 'proj-app1', 'shop', 'storefront', 'Deployment', 'registry.example.com/shop/storefront:4.12.0', 4, 500, 768, [3000], 4, 'Running', { expose: 'ClusterIP', revision: 7 }),
    w('k8s-001', 'proj-app1', 'shop', 'checkout-api', 'Deployment', 'registry.example.com/shop/checkout:2.3.1', 3, 400, 512, [8080]),
    w('k8s-001', 'proj-app1', 'shop', 'search', 'StatefulSet', 'opensearchproject/opensearch:2.17.0', 3, 1000, 2048, [9200], 2, 'Degraded'),
    w('k8s-001', 'proj-app1', 'shop', 'image-resizer', 'Deployment', 'registry.example.com/shop/imgproxy:3.25', 2, 300, 256, [8080]),
    w('k8s-001', 'proj-app1', 'monitoring', 'prometheus', 'StatefulSet', 'prom/prometheus:v2.54.1', 1, 500, 2048, [9090], 1, 'Running', { managedBy: 'monitoring' }),
    w('k8s-001', 'proj-app1', 'shop', 'nightly-report', 'CronJob', 'registry.example.com/shop/reports:1.0.4', 1, 200, 256, [], 1, 'Running', { schedule: '0 2 * * *' }),
    w('k8s-002', 'proj-ml', 'kube-system', 'cilium', 'DaemonSet', 'quay.io/cilium/cilium:v1.16.2', 5, 200, 256, [], 5, 'Running', sys),
    w('k8s-002', 'proj-ml', 'gpu-operator', 'nvidia-device-plugin', 'DaemonSet', 'nvcr.io/nvidia/k8s-device-plugin:v0.16.2', 2, 50, 64, [], 2, 'Running', { managedBy: 'gpuOperator', tolerations: ['nvidia.com/gpu'], nodeSelector: [{ key: 'nvidia.com/gpu.present', value: 'true' }] }),
    w('k8s-002', 'proj-ml', 'ml-serving', 'llm-inference', 'Deployment', 'vllm/vllm-openai:v0.6.3', 2, 4000, 24576, [8000], 2, 'Running', { gpuPerPod: 1, tolerations: ['nvidia.com/gpu'], expose: 'LoadBalancer' }),
    w('k8s-002', 'proj-ml', 'ml-serving', 'embedding-api', 'Deployment', 'ghcr.io/huggingface/text-embeddings-inference:1.5', 3, 1000, 2048, [8080]),
    w('k8s-002', 'proj-ml', 'pipelines', 'feature-ingest', 'Deployment', 'registry.example.net/ml/feast-ingest:0.40', 2, 500, 1024),
    w('k8s-002', 'proj-ml', 'argocd', 'argocd-server', 'Deployment', 'quay.io/argoproj/argocd:v2.12.4', 1, 250, 512, [443], 1, 'Running', { managedBy: 'argocd' }),
    w('k8s-002', 'proj-ml', 'pipelines', 'train-nightly', 'CronJob', 'registry.example.net/ml/trainer:2.1', 1, 2000, 8192, [], 1, 'Running', { gpuPerPod: 1, tolerations: ['nvidia.com/gpu'], schedule: '30 1 * * *' }),
    w('k8s-003', 'proj-infra', 'kube-system', 'coredns', 'Deployment', 'coredns/coredns:1.11.1', 2, 100, 70, [53], 2, 'Running', { tolerations: ['CriticalAddonsOnly'] }),
    w('k8s-003', 'proj-infra', 'tools', 'grafana', 'Deployment', 'grafana/grafana:11.2.0', 1, 200, 512, [3000]),
    w('k8s-003', 'proj-infra', 'tools', 'loki', 'StatefulSet', 'grafana/loki:3.1.1', 1, 500, 1024, [3100]),
    w('k8s-003', 'proj-infra', 'tools', 'renovate', 'CronJob', 'renovate/renovate:38', 1, 500, 1024, [], 1, 'Running', { schedule: '0 */4 * * *' }),
    // added later — appended so earlier seed IDs stay stable
    w('k8s-002', 'proj-ml', 'kube-system', 'coredns', 'Deployment', 'coredns/coredns:1.11.3', 2, 100, 70, [53], 2, 'Running', { tolerations: ['CriticalAddonsOnly'] }),
    w('k8s-003', 'proj-infra', 'kube-system', 'kube-flannel-ds', 'DaemonSet', 'flannel/flannel:v0.25.6', 2, 100, 50, [], 2, 'Running', sys),
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
