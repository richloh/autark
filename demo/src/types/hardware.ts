import type { ID, ISODate, Tag } from './common';

export type HostStatus =
  | 'discovering' | 'provisioning' | 'ready' | 'maintenance' | 'draining' | 'offline' | 'error' | 'decommissioning' | 'rebooting' | 'updating';

/** What Autark may schedule onto a host. */
export type HostRole = 'compute' | 'storage' | 'k8s-worker' | 'k8s-control-plane' | 'load-balancer';
export const HOST_ROLES: HostRole[] = ['compute', 'storage', 'k8s-worker', 'k8s-control-plane', 'load-balancer'];
/** Roles assumed when a host has no explicit roles (older data). */
export const DEFAULT_HOST_ROLES: HostRole[] = ['compute', 'k8s-worker', 'k8s-control-plane'];

/** Who may use a host. 'all' = every account/project; 'restricted' = only the listed accounts/projects. */
export interface HostAccess { mode: 'all' | 'restricted'; accountIds: ID[]; projectIds: ID[] }

export interface HostDisk { slot: string; type: 'ssd' | 'nvme' | 'hdd'; sizeGB: number; health: 'ok' | 'warning' | 'failed'; wearPct: number; model?: string; powerOnHours?: number; reallocatedSectors?: number; tempC?: number }
export interface HostNic { name: string; speedGbps: number; mac: string; link: 'up' | 'down'; role?: 'data' | 'storage' | 'bmc' | 'mgmt'; mtu?: number }

export interface HostHealthCheck {
  at: ISODate;
  result: 'passed' | 'warnings' | 'failed';
  checks: { name: string; status: 'ok' | 'warning' | 'failed'; detail: string }[];
}

export interface HostSensors {
  inletTempC: number;
  cpuTempC: number;
  fans: { id: string; rpm: number; status: 'ok' | 'warning' | 'failed' }[];
  psus: { id: string; status: 'ok' | 'failed' | 'absent'; watts: number; capacityW: number }[];
}

/** Light summary of a VM placed on a host (decorated by the API, visible to hardware operators across accounts). */
export interface HostVmSummary {
  id: ID; name: string; status: string; projectId: ID; accountId: ID; vcpus: number; ramGB: number; gpus: number; diskGB: number;
}

export interface BareMetalHost {
  id: ID;
  name: string; // hostname, e.g. dc1-hv-01
  locationId: ID;
  rack: string; // "R12"
  rackUnit: number; // bottom U position (1..42)
  sizeU: number; // 1, 2, 4
  vendor: string;
  model: string;
  serial: string;
  cpuModel: string;
  sockets: number;
  cpuCores: number; // physical cores total
  threads: number;
  ramGB: number;
  disks: HostDisk[];
  nics: HostNic[];
  gpus: { model: string; count: number }[];
  hypervisor: 'KVM' | 'none';
  bmcIp: string; // IPMI / Redfish
  mgmtIp: string;
  status: HostStatus;
  cpuOvercommit: number; // e.g. 4 => 4 vCPU per core-thread budget
  ramOvercommit: number;
  agentVersion: string;
  kernel: string;
  bootedAt: ISODate;
  createdAt: ISODate;
  updatedAt?: ISODate;
  tags: Tag[];
  powerWatts: number;
  /** workload roles this host serves (optional; DEFAULT_HOST_ROLES when absent) */
  roles?: HostRole[];
  /** availability restriction (optional; open to everyone when absent) */
  access?: HostAccess;
  /** optional enrichment */
  bmcUser?: string;
  bmcCredential?: string; // masked, never raw
  firmware?: { bios: string; bmc: string; nic?: string };
  maintenanceReason?: string | null;
  lastHealthCheck?: HostHealthCheck | null;
  notes?: string;
  /** decorated: allocations computed from placed VMs */
  allocated?: { vcpus: number; ramGB: number; diskGB: number; gpus: number; vms: number };
  /** decorated: schedulable capacity (after overcommit & hypervisor reserve) */
  capacity?: { vcpus: number; ramGB: number; gpus: number; diskGB: number };
  /** decorated */
  vms?: HostVmSummary[];
  sensors?: HostSensors;
  latestAgentVersion?: string;
  agentUpdateAvailable?: boolean;
  firmwareUpdateAvailable?: boolean;
}

/** One move in an evacuation plan (GET /hosts/:id/evacuation-plan). */
export interface EvacuationMove {
  vmId: ID; vmName: string; status: string; vcpus: number; ramGB: number; gpus: number;
  targetHostId: ID | null; targetHostName: string | null; live: boolean; reason?: string;
}
export interface EvacuationPlan {
  hostId: ID; feasible: boolean; moves: EvacuationMove[]; message: string;
  targets: { id: ID; name: string; before: { vcpus: number; ramGB: number }; after: { vcpus: number; ramGB: number }; capacity: { vcpus: number; ramGB: number } }[];
}

/** Hardware probe result (POST /hosts/probe) — what the BMC reports via Redfish. */
export interface HostProbe {
  bmcIp: string;
  reachable: boolean;
  redfishVersion: string;
  powerState: 'On' | 'Off';
  vendor: string; model: string; serial: string; sizeU: number;
  cpuModel: string; sockets: number; cpuCores: number; threads: number; ramGB: number;
  disks: HostDisk[]; nics: HostNic[]; gpus: { model: string; count: number }[];
  firmware: { bios: string; bmc: string; nic?: string };
  firmwareUpdateAvailable: boolean;
  estimatedWatts: number;
}

export type ProviderKind = 'hetzner' | 'aws' | 'ovh' | 'scaleway' | 'ionos' | 'openstack';

export interface ProviderRegion { code: string; name: string; city: string; country: string; lat: number; lon: number }

export interface CloudProvider {
  id: ID;
  name: string; // display name "Hetzner Cloud"
  kind: ProviderKind;
  status: 'connected' | 'connecting' | 'error' | 'disabled';
  regions: string[]; // enabled region codes
  availableRegions: ProviderRegion[];
  credentials: { label: string; masked: string; lastRotatedAt: ISODate; fields?: Record<string, string> };
  quotas: { vcpus: number; ramGB: number; vms: number; ips: number };
  lastSyncAt: ISODate | null;
  lastError?: string | null;
  allowedServices: ('vm' | 'volume' | 'network' | 'ip')[];
  createdAt: ISODate;
  updatedAt?: ISODate;
  tags: Tag[];
  /** optional enrichment */
  endpoint?: string; // openstack keystone URL, etc.
  credentialsValid?: boolean;
  lastTestAt?: ISODate | null;
  /** decorated */
  usage?: { vcpus: number; ramGB: number; vms: number; ips: number; monthlyCost: number };
  locations?: { id: ID; region: string; vms: number }[];
  resources?: (HostVmSummary & { locationId: ID; monthlyCost: number })[];
}

/** Static catalog entry per provider kind (GET /providers/catalog). */
export interface ProviderCatalogEntry {
  kind: ProviderKind;
  label: string;
  short: string;
  description: string;
  color: string;
  credentialLabel: string;
  fields: { id: string; label: string; placeholder?: string; secret?: boolean; hint?: string; optional?: boolean }[];
  regions: ProviderRegion[];
  defaultQuotas: { vcpus: number; ramGB: number; vms: number; ips: number };
  docsUrl: string;
}
