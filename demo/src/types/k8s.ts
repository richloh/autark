import type { BaseResource, ID, ISODate, Scoped, Tag } from './common';

export interface NodePool {
  id: ID;
  name: string;
  presetId?: ID | null;
  vcpus: number;
  ramGB: number;
  diskGB: number;
  count: number;
  autoscale: { enabled: boolean; min: number; max: number };
  labels: Tag[];
  taints: string[]; // "key=value:NoSchedule"
  gpu?: { model: string; count: number } | null;
  status: 'ready' | 'scaling' | 'provisioning' | 'upgrading' | 'draining';
  /** kubelet minor version of this pool (lags the control plane during an upgrade); defaults to the cluster version */
  version?: string;
  /** surge settings used for upgrades */
  upgradeSettings?: { maxSurge: number; maxUnavailable: number };
  /** while scaling up: nodes with index >= readyCount are still joining */
  readyCount?: number;
  /** while scaling down: nodes with index >= targetCount are draining */
  targetCount?: number;
  createdAt?: ISODate;
}

export interface OidcConfig { issuerUrl: string; clientId: string; usernameClaim: string; groupsClaim: string; groupsPrefix?: string }

export interface K8sCluster extends BaseResource, Scoped {
  version: string; // "1.31"
  status: 'provisioning' | 'running' | 'upgrading' | 'scaling' | 'degraded' | 'error' | 'deleting';
  locationId: ID;
  controlPlane: { ha: boolean; size: 'small' | 'medium' | 'large'; endpoint: string };
  nodePools: NodePool[];
  networkId: ID;
  subnetId: ID;
  cni: 'cilium' | 'calico' | 'flannel';
  podCidr: string;
  serviceCidr: string;
  storageClass: string;
  addons: Record<string, boolean>; // ingress, certManager, metricsServer, monitoring, logging, externalDns, argocd, gpuOperator, velero, kyverno
  oidc: boolean;
  oidcConfig?: OidcConfig | null;
  autoUpgrade: boolean;
  maintenanceWindow: { day: string; hour: number };
  /** private API endpoint only (no public LB in front of the API server) */
  privateEndpoint?: boolean;
  /** CIDRs allowed to reach the API server */
  apiAllowlist?: string[];
  credentialsRotatedAt?: ISODate | null;
  credentialGeneration?: number;
  deletionProtection?: boolean;
  monthlyCost?: number;
  /** computed on read */
  summary?: K8sClusterSummary;
  upgradeAvailable?: string | null;
  /** computed: version the control plane currently runs (moves first during an upgrade) */
  controlPlaneVersion?: string;
  health?: { component: string; status: 'healthy' | 'degraded' | 'down' | 'pending'; detail?: string }[];
}

export interface K8sClusterSummary {
  nodes: number;
  readyNodes: number;
  pods: number;
  runningPods: number;
  pendingPods: number;
  cpuRequestedPct: number; // 0..1 of allocatable
  memRequestedPct: number;
  allocatableCpuM: number;
  allocatableMemMi: number;
  workloads: number;
  namespaces: number;
}

export interface K8sWorkload {
  id: ID;
  clusterId: ID;
  accountId: ID;
  projectId: ID;
  namespace: string;
  name: string;
  kind: 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'CronJob';
  image: string;
  replicas: number;
  readyReplicas: number;
  cpuRequestM: number; // millicores per pod
  memRequestMi: number;
  ports: number[];
  status: 'Running' | 'Progressing' | 'Degraded' | 'Pending' | 'Terminating';
  createdAt: ISODate;
  tags: Tag[];
  /** GPUs requested per pod (nvidia.com/gpu) */
  gpuPerPod?: number;
  /** taint keys tolerated by the pods */
  tolerations?: string[];
  /** must run on nodes carrying these labels */
  nodeSelector?: Tag[];
  /** CronJob schedule */
  schedule?: string;
  /** bumps on restart / image change; part of the pod names */
  revision?: number;
  /** add-on that owns this workload, e.g. "ingress" */
  managedBy?: string | null;
  env?: { key: string; value: string }[];
  /** expose via Service type */
  expose?: 'none' | 'ClusterIP' | 'LoadBalancer';
  restartedAt?: ISODate | null;
  /** computed: pods that cannot be scheduled */
  pendingPods?: number;
  /** last scheduling note (e.g. autoscaler triggered) */
  deployNote?: string | null;
}

/* ---------------------------------------------------------------- derived (read-only) views */

export type K8sNodeStatus = 'Ready' | 'NotReady' | 'Provisioning' | 'Draining' | 'Upgrading';

export interface K8sNode {
  name: string;
  poolId: ID;
  poolName: string;
  index: number;
  status: K8sNodeStatus;
  /** cordoned (SchedulingDisabled) */
  unschedulable: boolean;
  internalIp: string;
  version: string; // kubelet "v1.30.10"
  zone: string;
  vcpus: number;
  ramGB: number;
  gpu: { model: string; count: number } | null;
  allocatable: { cpuM: number; memMi: number; pods: number; gpu: number };
  requested: { cpuM: number; memMi: number; gpu: number };
  podCount: number;
  usage: { cpuPct: number; memPct: number };
  taints: string[];
  labels: Tag[];
  createdAt: ISODate;
  /** temporary node created during a surge upgrade */
  surge?: boolean;
}

export type K8sPodStatus = 'Running' | 'Pending' | 'ContainerCreating' | 'CrashLoopBackOff' | 'Terminating' | 'Completed';

export interface K8sPod {
  name: string;
  namespace: string;
  workloadId: ID;
  workloadName: string;
  kind: K8sWorkload['kind'];
  node: string | null;
  status: K8sPodStatus;
  reason?: string;
  cpuM: number;
  memMi: number;
  gpu: number;
  restarts: number;
  ip: string | null;
  startedAt: ISODate | null;
  image: string;
  /** true when the scheduler found no node for this pod (FailedScheduling) */
  unschedulable?: boolean;
  /** true for surge / system pods that should be drawn muted */
  system?: boolean;
}

export interface K8sEvent { type: 'Normal' | 'Warning'; reason: string; object: string; message: string; time: ISODate; count?: number }

export interface K8sTopology {
  nodes: K8sNode[];
  pods: K8sPod[];
  events: K8sEvent[];
  summary: K8sClusterSummary;
}

/* ---------------------------------------------------------------- catalogue (shared by API + UI) */

export interface K8sVersionInfo { version: string; patch: string; status: 'latest' | 'supported' | 'deprecated'; releasedAt: string; endOfSupport: string; highlights: string[] }

/** Supported Kubernetes minor versions, newest first. */
export const K8S_VERSIONS: K8sVersionInfo[] = [
  { version: '1.32', patch: '1.32.3', status: 'latest', releasedAt: '2024-12-11', endOfSupport: '2027-02-28', highlights: ['Dynamic Resource Allocation (beta) for GPUs', 'Custom resource field selectors GA', 'Memory manager GA'] },
  { version: '1.31', patch: '1.31.7', status: 'supported', releasedAt: '2024-08-13', endOfSupport: '2026-10-28', highlights: ['AppArmor support GA', 'Persistent volume last-phase-transition GA', 'nftables kube-proxy backend (beta)'] },
  { version: '1.30', patch: '1.30.11', status: 'supported', releasedAt: '2024-04-17', endOfSupport: '2026-06-28', highlights: ['Pod scheduling readiness GA', 'ValidatingAdmissionPolicy GA', 'Min domains in topology spread GA'] },
  { version: '1.29', patch: '1.29.15', status: 'deprecated', releasedAt: '2023-12-13', endOfSupport: '2026-02-28', highlights: ['ReadWriteOncePod GA', 'KMS v2 encryption GA', 'Sidecar containers (beta)'] },
];

export function k8sNextVersion(v: string): string | null {
  const i = K8S_VERSIONS.findIndex((x) => x.version === v);
  return i > 0 ? K8S_VERSIONS[i - 1].version : null;
}
export function k8sPatch(v: string): string { return K8S_VERSIONS.find((x) => x.version === v)?.patch ?? `${v}.0` }

export interface K8sNodePreset { id: ID; name: string; family: 'general' | 'compute' | 'memory' | 'gpu'; vcpus: number; ramGB: number; diskGB: number; gpu?: { model: string; count: number } | null; description: string }

export const K8S_NODE_PRESETS: K8sNodePreset[] = [
  { id: 'k8s-np-s', name: 'Small', family: 'general', vcpus: 2, ramGB: 4, diskGB: 60, description: 'System add-ons, dev clusters' },
  { id: 'k8s-np-m', name: 'Medium', family: 'general', vcpus: 4, ramGB: 8, diskGB: 80, description: 'General purpose workloads' },
  { id: 'k8s-np-l', name: 'Large', family: 'general', vcpus: 8, ramGB: 16, diskGB: 120, description: 'Busy services, CI runners' },
  { id: 'k8s-np-c16', name: 'Compute 16', family: 'compute', vcpus: 16, ramGB: 32, diskGB: 160, description: 'CPU-bound batch & builds' },
  { id: 'k8s-np-mem', name: 'Memory 64', family: 'memory', vcpus: 8, ramGB: 64, diskGB: 120, description: 'Caches, JVM, search' },
  { id: 'k8s-np-gpu', name: 'GPU A6000', family: 'gpu', vcpus: 8, ramGB: 64, diskGB: 200, gpu: { model: 'A6000', count: 1 }, description: 'Inference, fine-tuning' },
  { id: 'k8s-np-gpu-l40s', name: 'GPU L40S', family: 'gpu', vcpus: 16, ramGB: 128, diskGB: 400, gpu: { model: 'L40S', count: 1 }, description: 'Large-model inference' },
];

export interface K8sAddonWorkload { namespace: string; name: string; kind: K8sWorkload['kind']; image: string; replicas: number; cpuRequestM: number; memRequestMi: number; ports?: number[]; tolerations?: string[]; nodeSelector?: Tag[] }

export interface K8sAddon {
  id: string;
  name: string;
  category: 'networking' | 'security' | 'observability' | 'delivery' | 'storage' | 'gpu';
  description: string;
  version: string;
  namespace: string;
  /** prerequisites (other add-on ids) */
  requires?: string[];
  workloads: K8sAddonWorkload[];
}

export const K8S_ADDONS: K8sAddon[] = [
  { id: 'ingress', name: 'Ingress NGINX', category: 'networking', version: 'v1.11.2', namespace: 'ingress-nginx', description: 'HTTP(S) ingress controller exposed through an Autark load balancer.',
    workloads: [{ namespace: 'ingress-nginx', name: 'ingress-nginx-controller', kind: 'Deployment', image: 'registry.k8s.io/ingress-nginx/controller:v1.11.2', replicas: 2, cpuRequestM: 200, memRequestMi: 256, ports: [80, 443] }] },
  { id: 'certManager', name: 'cert-manager', category: 'security', version: 'v1.15.3', namespace: 'cert-manager', description: "Automatic TLS certificates from Let's Encrypt or your internal CA.",
    workloads: [{ namespace: 'cert-manager', name: 'cert-manager', kind: 'Deployment', image: 'quay.io/jetstack/cert-manager-controller:v1.15.3', replicas: 1, cpuRequestM: 50, memRequestMi: 128 }] },
  { id: 'metricsServer', name: 'Metrics Server', category: 'observability', version: 'v0.7.2', namespace: 'kube-system', description: 'Resource metrics for kubectl top and the Horizontal Pod Autoscaler.',
    workloads: [{ namespace: 'kube-system', name: 'metrics-server', kind: 'Deployment', image: 'registry.k8s.io/metrics-server/metrics-server:v0.7.2', replicas: 1, cpuRequestM: 100, memRequestMi: 200, tolerations: ['CriticalAddonsOnly'] }] },
  { id: 'monitoring', name: 'Prometheus & Grafana', category: 'observability', version: 'v2.54.1', namespace: 'monitoring', description: 'kube-prometheus-stack with node, pod and control-plane dashboards.',
    workloads: [{ namespace: 'monitoring', name: 'prometheus', kind: 'StatefulSet', image: 'prom/prometheus:v2.54.1', replicas: 1, cpuRequestM: 500, memRequestMi: 2048, ports: [9090] }] },
  { id: 'logging', name: 'Loki & Promtail', category: 'observability', version: 'v3.1.1', namespace: 'logging', description: 'Cluster-wide log collection with 14-day retention in object storage.',
    workloads: [{ namespace: 'logging', name: 'loki', kind: 'StatefulSet', image: 'grafana/loki:3.1.1', replicas: 1, cpuRequestM: 300, memRequestMi: 768, ports: [3100] }, { namespace: 'logging', name: 'promtail', kind: 'DaemonSet', image: 'grafana/promtail:3.1.1', replicas: 0, cpuRequestM: 50, memRequestMi: 96, tolerations: ['*'] }] },
  { id: 'externalDns', name: 'ExternalDNS', category: 'networking', version: 'v0.15.0', namespace: 'external-dns', description: 'Publishes Ingress and Service hostnames to Autark DNS zones.',
    workloads: [{ namespace: 'external-dns', name: 'external-dns', kind: 'Deployment', image: 'registry.k8s.io/external-dns/external-dns:v0.15.0', replicas: 1, cpuRequestM: 50, memRequestMi: 64 }] },
  { id: 'argocd', name: 'Argo CD', category: 'delivery', version: 'v2.12.4', namespace: 'argocd', description: 'GitOps continuous delivery: sync manifests from Git repositories.',
    workloads: [{ namespace: 'argocd', name: 'argocd-server', kind: 'Deployment', image: 'quay.io/argoproj/argocd:v2.12.4', replicas: 1, cpuRequestM: 250, memRequestMi: 512, ports: [443] }] },
  { id: 'velero', name: 'Velero backups', category: 'storage', version: 'v1.14.1', namespace: 'velero', description: 'Scheduled backups of resources and volumes to an Autark bucket.',
    workloads: [{ namespace: 'velero', name: 'velero', kind: 'Deployment', image: 'velero/velero:v1.14.1', replicas: 1, cpuRequestM: 100, memRequestMi: 256 }] },
  { id: 'kyverno', name: 'Kyverno policies', category: 'security', version: 'v1.12.5', namespace: 'kyverno', description: 'Admission policies: require labels, block :latest images, enforce PSS.',
    workloads: [{ namespace: 'kyverno', name: 'kyverno-admission-controller', kind: 'Deployment', image: 'ghcr.io/kyverno/kyverno:v1.12.5', replicas: 1, cpuRequestM: 100, memRequestMi: 256 }] },
  { id: 'gpuOperator', name: 'NVIDIA GPU Operator', category: 'gpu', version: 'v24.6.2', namespace: 'gpu-operator', description: 'Drivers, device plugin and DCGM metrics for GPU node pools.',
    workloads: [{ namespace: 'gpu-operator', name: 'nvidia-device-plugin', kind: 'DaemonSet', image: 'nvcr.io/nvidia/k8s-device-plugin:v0.16.2', replicas: 0, cpuRequestM: 50, memRequestMi: 64, tolerations: ['nvidia.com/gpu'], nodeSelector: [{ key: 'nvidia.com/gpu.present', value: 'true' }] }] },
];
