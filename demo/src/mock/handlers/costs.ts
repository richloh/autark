import { db } from '../db';
import { vmCost, volumeCost, dbCost, k8sCost, bucketCost, lbCost, ipCost, dnsZoneCost, spaceCost, PRICING } from '@/lib/pricing';
import { classBreakdown } from './storage';
import type { VM, Volume, Snapshot, IpAddress, Network, DnsZone, DbInstance, K8sCluster, K8sSpace, Bucket, LoadBalancer, Location } from '@/types';

/* Canonical monthly cost per resource. Used by billing endpoints and by `decorate` in handlers. */

export type Service = 'compute' | 'storage' | 'network' | 'db' | 'k8s' | 'objectStorage' | 'loadBalancers';
export const SERVICE_LABEL: Record<Service, string> = {
  compute: 'Compute', storage: 'Block storage', network: 'Networking', db: 'Databases', k8s: 'Kubernetes', objectStorage: 'Object storage', loadBalancers: 'Load balancers',
};

const isCloud = (locationId: string) => db.get<Location>('locations', locationId)?.kind === 'cloud';

/** VM compute only (volumes and IPs are billed under storage / network). */
export function vmComputeCost(vm: VM): number {
  if (vm.status === 'stopped' || vm.status === 'error') return vmCost({ vcpus: 0, ramGB: 0, systemDiskGB: vm.size.systemDiskGB }).total;
  return vmCost({ vcpus: vm.size.vcpus, ramGB: vm.size.ramGB, systemDiskGB: vm.size.systemDiskGB, gpu: vm.gpu, backups: vm.backups.enabled, cloud: isCloud(vm.locationId) }).total;
}
export const volumeMonthly = (v: Volume) => volumeCost({ type: v.type, sizeGB: v.sizeGB, iops: v.iops, throughputMBps: v.throughputMBps }).total;
export const snapshotMonthly = (s: Snapshot) => Math.round(s.sizeGB * PRICING.snapshotGBPerMonth * 100) / 100;
export const ipMonthly = (ip: IpAddress) => ipCost(ip.version);
export const dnsMonthly = (z: DnsZone) => dnsZoneCost(z.records.length).total;
export const dbMonthly = (d: DbInstance) => (d.status === 'stopped' ? Math.round(d.storageGB * PRICING.db.storageGBPerMonth * 100) / 100 : dbCost({ vcpus: d.size.vcpus, ramGB: d.size.ramGB, storageGB: d.storageGB, ha: d.ha, readReplicas: d.readReplicas, backupGB: d.backups.enabled ? Math.round(d.storageUsedGB * 0.4 * d.backups.retention / 7) : 0 }).total);
export const k8sMonthly = (k: K8sCluster) => k8sCost({ controlPlaneSize: k.controlPlane.size, ha: k.controlPlane.ha, pools: k.nodePools.map((p) => ({ name: p.name, vcpus: p.vcpus, ramGB: p.ramGB, diskGB: p.diskGB, count: p.count, gpu: p.gpu })) }).total;
export const bucketMonthly = (b: Bucket) => {
  // price each storage class separately so lifecycle tiering lowers the bill
  const split = classBreakdown(b);
  const storage = (Object.entries(split) as [string, number][]).reduce((a, [cls, bytes]) => a + (bytes / 1024 ** 3) * ((PRICING.objectStorage as Record<string, number>)[cls] ?? PRICING.objectStorage.STANDARD), 0);
  const rest = bucketCost({ storageClass: b.storageClass, storageGB: 0, requestsMillions: b.requestsLast30d / 1e6, egressGB: b.egressGBLast30d }).total;
  return Math.round((storage + rest) * 100) / 100;
};
export const lbMonthly = (l: LoadBalancer) => lbCost({ type: l.type, dataProcessedGB: l.type === 'L7' ? 1800 : 600 }).total;
/** Shared Kubernetes space: billed by reserved quota; a suspended space only pays for its storage. */
export const spaceMonthly = (sp: Pick<K8sSpace, 'quota' | 'status'>) => (sp.status === 'suspended' ? spaceCost({ cpuCores: 0, memoryGi: 0, storageGi: sp.quota.storageGi, loadBalancers: 0 }).total : spaceCost(sp.quota).total);
export const natMonthly = (n: Network) => (n.natGateway ? PRICING.natGatewayPerMonth : 0);

export interface CostItem { type: string; id: string; name: string; projectId: string; accountId: string; locationId?: string; service: Service; monthly: number }

/** Every billable line item in the platform. */
export function allCostItems(): CostItem[] {
  const out: CostItem[] = [];
  const push = (r: any, type: string, service: Service, monthly: number, name?: string) => out.push({ type, id: r.id, name: name ?? r.name ?? r.address ?? r.id, projectId: r.projectId, accountId: r.accountId, locationId: r.locationId, service, monthly: Math.round(monthly * 100) / 100 });
  for (const v of db.list<VM>('vms')) push(v, 'vm', 'compute', vmComputeCost(v));
  for (const v of db.list<Volume>('volumes')) push(v, 'volume', 'storage', volumeMonthly(v));
  for (const s of db.list<Snapshot>('snapshots')) push(s, 'snapshot', 'storage', snapshotMonthly(s));
  for (const ip of db.list<IpAddress>('ips')) push(ip, 'ip', 'network', ipMonthly(ip), ip.address);
  for (const n of db.list<Network>('networks')) if (n.natGateway) push(n, 'network', 'network', natMonthly(n), `${n.name} NAT gateway`);
  for (const z of db.list<DnsZone>('dnsZones')) push(z, 'dnsZone', 'network', dnsMonthly(z));
  for (const d of db.list<DbInstance>('dbInstances')) push(d, 'db', 'db', dbMonthly(d));
  for (const k of db.list<K8sCluster>('k8sClusters')) push(k, 'k8s', 'k8s', k8sMonthly(k));
  // shared Kubernetes spaces (platform clusters themselves are provider cost, not customer cost)
  for (const sp of db.list<K8sSpace>('k8sSpaces')) if (sp.status !== 'error') push(sp, 'k8sSpace', 'k8s', spaceMonthly(sp));
  for (const b of db.list<Bucket>('buckets')) push(b, 'bucket', 'objectStorage', bucketMonthly(b));
  for (const l of db.list<LoadBalancer>('loadBalancers')) push(l, 'lb', 'loadBalancers', lbMonthly(l));
  return out;
}
