/**
 * Pricing catalogue + cost functions. Shared by the mock backend (to decorate resources with
 * `monthlyCost`) and the UI (live cost estimators). All prices in EUR.
 */
export const CURRENCY = 'EUR';
export const HOURS_PER_MONTH = 730;

export const PRICING = {
  vm: { vCPUPerMonth: 7, ramGBPerMonth: 1.5, systemDiskGBPerMonth: 0.05, publicIPv4PerMonth: 2, backupsPct: 0.2 },
  gpuPerHour: { A6000: 0.9, L40S: 1.4, H100: 2.8, H200: 3.6 } as Record<string, number>,
  cloudMarkup: 1.25, // VMs on burst cloud capacity cost more than on own hardware
  volume: { ssd: 0.08, nvme: 0.12, hdd: 0.04, iopsPer1000PerMonth: 1.2, throughputMBpsPerMonth: 0.05, includedIops: 3000, includedThroughput: 125 },
  snapshotGBPerMonth: 0.02,
  db: { vCPUPerMonth: 9, ramGBPerMonth: 2, storageGBPerMonth: 0.1, haMultiplier: 1.7, backupGBPerMonth: 0.03, replicaMultiplier: 0.85 },
  k8s: { controlPlane: { small: 20, medium: 45, large: 90 } as Record<string, number>, haAddOn: 35 },
  objectStorage: { STANDARD: 0.022, INFREQUENT: 0.012, ARCHIVE: 0.004, requestsPerMillion: 0.4, egressPerGB: 0.02 } as Record<string, number>,
  loadBalancer: { L4PerHour: 0.012, L7PerHour: 0.025, dataProcessedPerGB: 0.01 },
  ip: { v4PerMonth: 2, v6PerMonth: 0 },
  dns: { zonePerMonth: 0.5, recordPerMonth: 0.01 },
  natGatewayPerMonth: 12,
} as const;

export interface CostLine { label: string; amount: number; hint?: string }
export interface CostBreakdown { lines: CostLine[]; total: number }

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (lines: CostLine[]) => r2(lines.reduce((a, l) => a + l.amount, 0));
export const breakdown = (lines: CostLine[]): CostBreakdown => ({ lines: lines.filter((l) => l.amount !== 0 || l.hint), total: sum(lines) });

export interface VmCostInput {
  vcpus: number;
  ramGB: number;
  systemDiskGB: number;
  gpu?: { model: string; count: number } | null;
  publicIpv4?: number;
  backups?: boolean;
  cloud?: boolean;
  volumes?: VolumeCostInput[];
}

export function vmCost(i: VmCostInput): CostBreakdown {
  const p = PRICING.vm;
  const markup = i.cloud ? PRICING.cloudMarkup : 1;
  const compute = (i.vcpus * p.vCPUPerMonth + i.ramGB * p.ramGBPerMonth) * markup;
  const disk = i.systemDiskGB * p.systemDiskGBPerMonth;
  const lines: CostLine[] = [
    { label: `${i.vcpus} vCPU · ${i.ramGB} GB RAM`, amount: r2(compute), hint: i.cloud ? 'incl. 25% cloud burst markup' : undefined },
    { label: `System disk ${i.systemDiskGB} GB`, amount: r2(disk) },
  ];
  if (i.gpu && i.gpu.count > 0) {
    lines.push({ label: `${i.gpu.count}× ${i.gpu.model} GPU`, amount: r2((PRICING.gpuPerHour[i.gpu.model] ?? 0) * HOURS_PER_MONTH * i.gpu.count) });
  }
  if (i.publicIpv4) lines.push({ label: `${i.publicIpv4}× public IPv4`, amount: r2(i.publicIpv4 * p.publicIPv4PerMonth) });
  if (i.backups) lines.push({ label: 'Automated backups (+20%)', amount: r2((compute + disk) * p.backupsPct) });
  for (const v of i.volumes ?? []) {
    const vc = volumeCost(v);
    lines.push({ label: `Volume ${v.sizeGB} GB ${v.type.toUpperCase()}`, amount: vc.total });
  }
  return breakdown(lines);
}

export interface VolumeCostInput { type: 'ssd' | 'nvme' | 'hdd'; sizeGB: number; iops?: number; throughputMBps?: number; snapshotsGB?: number }

export function volumeCost(v: VolumeCostInput): CostBreakdown {
  const p = PRICING.volume;
  const lines: CostLine[] = [{ label: `${v.sizeGB} GB ${v.type.toUpperCase()}`, amount: r2(v.sizeGB * p[v.type]) }];
  const extraIops = Math.max(0, (v.iops ?? 0) - p.includedIops);
  if (extraIops) lines.push({ label: `+${extraIops.toLocaleString()} provisioned IOPS`, amount: r2((extraIops / 1000) * p.iopsPer1000PerMonth) });
  const extraTp = Math.max(0, (v.throughputMBps ?? 0) - p.includedThroughput);
  if (extraTp) lines.push({ label: `+${extraTp} MB/s throughput`, amount: r2(extraTp * p.throughputMBpsPerMonth) });
  if (v.snapshotsGB) lines.push({ label: `Snapshots ${v.snapshotsGB} GB`, amount: r2(v.snapshotsGB * PRICING.snapshotGBPerMonth) });
  return breakdown(lines);
}

export interface DbCostInput { engine?: string; vcpus: number; ramGB: number; storageGB: number; ha: boolean; readReplicas?: number; backupGB?: number }

export function dbCost(i: DbCostInput): CostBreakdown {
  const p = PRICING.db;
  const base = i.vcpus * p.vCPUPerMonth + i.ramGB * p.ramGBPerMonth + i.storageGB * p.storageGBPerMonth;
  const lines: CostLine[] = [
    { label: `${i.vcpus} vCPU · ${i.ramGB} GB RAM`, amount: r2(i.vcpus * p.vCPUPerMonth + i.ramGB * p.ramGBPerMonth) },
    { label: `Storage ${i.storageGB} GB`, amount: r2(i.storageGB * p.storageGBPerMonth) },
  ];
  if (i.ha) lines.push({ label: 'High availability standby (×1.7)', amount: r2(base * (p.haMultiplier - 1)) });
  if (i.readReplicas) lines.push({ label: `${i.readReplicas}× read replica`, amount: r2(base * p.replicaMultiplier * i.readReplicas) });
  if (i.backupGB) lines.push({ label: `Backups ~${i.backupGB} GB`, amount: r2(i.backupGB * p.backupGBPerMonth) });
  return breakdown(lines);
}

export interface K8sCostInput {
  controlPlaneSize: 'small' | 'medium' | 'large';
  ha: boolean;
  pools: { name: string; vcpus: number; ramGB: number; diskGB: number; count: number; gpu?: { model: string; count: number } | null }[];
}

export function k8sCost(i: K8sCostInput): CostBreakdown {
  const lines: CostLine[] = [{ label: `Control plane (${i.controlPlaneSize})`, amount: PRICING.k8s.controlPlane[i.controlPlaneSize] ?? 20 }];
  if (i.ha) lines.push({ label: 'HA control plane (3 replicas)', amount: PRICING.k8s.haAddOn });
  for (const pool of i.pools) {
    const node = vmCost({ vcpus: pool.vcpus, ramGB: pool.ramGB, systemDiskGB: pool.diskGB, gpu: pool.gpu }).total;
    lines.push({ label: `${pool.name}: ${pool.count}× ${pool.vcpus} vCPU/${pool.ramGB} GB`, amount: r2(node * pool.count) });
  }
  return breakdown(lines);
}

export interface BucketCostInput { storageClass: string; storageGB: number; requestsMillions: number; egressGB: number }

export function bucketCost(i: BucketCostInput): CostBreakdown {
  const p = PRICING.objectStorage;
  return breakdown([
    { label: `${i.storageGB.toLocaleString()} GB ${i.storageClass.toLowerCase()}`, amount: r2(i.storageGB * (p[i.storageClass] ?? p.STANDARD)) },
    { label: `${i.requestsMillions.toFixed(1)}M requests`, amount: r2(i.requestsMillions * p.requestsPerMillion) },
    { label: `${i.egressGB} GB egress`, amount: r2(i.egressGB * p.egressPerGB) },
  ]);
}

export interface LbCostInput { type: 'L4' | 'L7'; dataProcessedGB: number; publicIps?: number }

export function lbCost(i: LbCostInput): CostBreakdown {
  const p = PRICING.loadBalancer;
  const lines: CostLine[] = [
    { label: `${i.type} load balancer (${HOURS_PER_MONTH} h)`, amount: r2((i.type === 'L7' ? p.L7PerHour : p.L4PerHour) * HOURS_PER_MONTH) },
    { label: `~${i.dataProcessedGB} GB processed`, amount: r2(i.dataProcessedGB * p.dataProcessedPerGB) },
  ];
  if (i.publicIps) lines.push({ label: `${i.publicIps}× public IPv4`, amount: r2(i.publicIps * PRICING.ip.v4PerMonth) });
  return breakdown(lines);
}

export function ipCost(version: 4 | 6): number { return version === 4 ? PRICING.ip.v4PerMonth : PRICING.ip.v6PerMonth }

export function dnsZoneCost(records: number): CostBreakdown {
  return breakdown([
    { label: 'Hosted zone', amount: PRICING.dns.zonePerMonth },
    { label: `${records} records`, amount: r2(records * PRICING.dns.recordPerMonth) },
  ]);
}

/** Shared Kubernetes space: billed by reserved quota (no control-plane or node fees). */
export const SPACE_PRICING = { cpuCorePerMonth: 9, memoryGiPerMonth: 1.6, storageGiPerMonth: 0.1, loadBalancerPerMonth: 6 };
export function spaceCost(q: { cpuCores: number; memoryGi: number; storageGi: number; loadBalancers: number }): CostBreakdown {
  const p = SPACE_PRICING;
  return breakdown([
    { label: `${q.cpuCores} CPU cores reserved`, amount: r2(q.cpuCores * p.cpuCorePerMonth) },
    { label: `${q.memoryGi} GiB memory reserved`, amount: r2(q.memoryGi * p.memoryGiPerMonth) },
    { label: `${q.storageGi} GiB persistent storage`, amount: r2(q.storageGi * p.storageGiPerMonth) },
    ...(q.loadBalancers ? [{ label: `${q.loadBalancers}× load balancer endpoint`, amount: r2(q.loadBalancers * p.loadBalancerPerMonth) }] : []),
  ]);
}
