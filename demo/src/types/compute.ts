import type { BaseResource, ID, ISODate, Scoped } from './common';

export type VmStatus =
  | 'provisioning' | 'running' | 'stopped' | 'starting' | 'stopping' | 'rebooting'
  | 'migrating' | 'resizing' | 'restoring' | 'error' | 'deleting';

export interface GpuSpec { model: 'A6000' | 'L40S' | 'H100' | 'H200'; count: number }

export interface VmSize {
  presetId?: ID | null;
  vcpus: number;
  ramGB: number;
  systemDiskGB: number;
}

export interface VM extends BaseResource, Scoped {
  status: VmStatus;
  size: VmSize;
  gpu: GpuSpec | null;
  imageId: ID;
  locationId: ID;
  hostId: ID | null; // bare metal host for self-hosted placement
  networkId: ID;
  subnetId: ID;
  privateIp: string;
  ipIds: ID[]; // public IPs (ip collection)
  ipv6: boolean;
  sshKeyIds: ID[];
  volumeIds: ID[];
  firewallIds: ID[];
  backups: { enabled: boolean; schedule: 'daily' | 'weekly'; retention: number; window: string };
  initScript: string; // cloud-init user-data
  deletionProtection: boolean;
  lastStartedAt?: ISODate;
  /** decorated by the API on read */
  monthlyCost?: number;
}

/** Candidate host for placement / migration (GET /vms/:id/placement). */
export interface PlacementCandidate {
  id: ID;
  name: string;
  locationId: ID;
  rack: string;
  status: string;
  cpuModel: string;
  capacity: { vcpus: number; ramGB: number; gpus: number };
  allocated: { vcpus: number; ramGB: number; gpus: number; vms: number };
  current: boolean;
  fits: boolean;
  reason?: string;
}

export interface VmPreset {
  id: ID;
  name: string;
  family: 'general' | 'compute' | 'memory' | 'gpu';
  vcpus: number;
  ramGB: number;
  systemDiskGB: number;
  gpu?: GpuSpec | null;
  description: string;
  builtIn?: boolean;
  /** custom presets belong to an account */
  accountId?: ID;
  createdAt?: ISODate;
  createdBy?: string;
  /** decorated: monthly price on own hardware and number of VMs using it */
  monthlyCost?: number;
  usedBy?: number;
}

export interface Image {
  id: ID;
  name: string; // "Ubuntu 24.04 LTS"
  os: 'ubuntu' | 'debian' | 'fedora' | 'rocky' | 'alma' | 'suse' | 'windows' | 'flatcar' | 'custom';
  version: string;
  kind: 'public' | 'custom';
  arch: 'x86_64' | 'arm64';
  sizeGB: number;
  minDiskGB: number;
  status: 'available' | 'creating' | 'deprecated';
  description: string;
  createdAt: ISODate;
  sourceSnapshotId?: ID;
  sourceVmId?: ID;
  accountId?: ID; // custom images are account scoped
  projectId?: ID;
  tags: { key: string; value: string }[];
  deprecatedAt?: ISODate;
  /** e.g. "Use Ubuntu 24.04 instead" */
  replacementId?: ID;
  /** public images: end of vendor support */
  eol?: string;
  /** decorated: VMs currently running this image (in the caller's account) */
  usedBy?: number;
  monthlyCost?: number;
}

export interface SshKey {
  id: ID;
  name: string;
  fingerprint: string;
  publicKey: string;
  createdAt: ISODate;
  accountId: ID;
  projectId?: ID;
  tags: { key: string; value: string }[];
  keyType?: 'ed25519' | 'rsa' | 'ecdsa';
  bits?: number;
  comment?: string;
  createdBy?: string;
  lastUsedAt?: ISODate;
  /** decorated: VM ids this key is configured on */
  usedBy?: ID[];
}

export interface Snapshot extends BaseResource, Scoped {
  kind: 'vm' | 'volume';
  sourceId: ID;
  sourceName: string;
  sizeGB: number;
  status: 'creating' | 'available' | 'restoring' | 'deleting';
  trigger: 'manual' | 'scheduled' | 'pre-change';
  locationId: ID;
  description?: string;
  /** volume type of the source (volume snapshots) */
  volumeType?: VolumeType;
  /** size of the source disk at snapshot time */
  sourceSizeGB?: number;
  monthlyCost?: number;
}

export type VolumeType = 'ssd' | 'nvme' | 'hdd';
export type VolumeStatus = 'creating' | 'available' | 'in-use' | 'attaching' | 'detaching' | 'resizing' | 'updating' | 'restoring' | 'deleting' | 'error';

export interface Volume extends BaseResource, Scoped {
  type: VolumeType;
  sizeGB: number;
  usedGB: number;
  iops: number;
  throughputMBps: number;
  locationId: ID;
  status: VolumeStatus;
  attachedTo: { vmId: ID; device: string } | null;
  filesystem: 'ext4' | 'xfs' | 'none';
  encrypted: boolean;
  backupPolicy: { enabled: boolean; schedule: 'hourly' | 'daily' | 'weekly'; retention: number };
  sourceSnapshotId?: ID | null;
  description?: string;
  /** decorated */
  monthlyCost?: number;
  snapshotCount?: number;
  lastSnapshotAt?: ISODate | null;
}

export interface VolumePreset {
  id: ID;
  name: string;
  type: VolumeType;
  sizeGB: number;
  iops: number;
  throughputMBps: number;
  description: string;
  builtIn?: boolean;
  accountId?: ID;
  createdAt?: ISODate;
  createdBy?: string;
  monthlyCost?: number;
  usedBy?: number;
}

/** Performance envelope per volume type (shared by API validation and UI sliders). */
export const VOLUME_LIMITS: Record<VolumeType, { label: string; minGB: number; maxGB: number; minIops: number; maxIops: number; iopsPerGB: number; minTp: number; maxTp: number; latencyMs: number; description: string }> = {
  ssd: { label: 'SSD', minGB: 10, maxGB: 16000, minIops: 3000, maxIops: 16000, iopsPerGB: 50, minTp: 125, maxTp: 1000, latencyMs: 0.8, description: 'Balanced price/performance, Ceph replicated ×3' },
  nvme: { label: 'NVMe', minGB: 10, maxGB: 16000, minIops: 3000, maxIops: 80000, iopsPerGB: 500, minTp: 125, maxTp: 4000, latencyMs: 0.2, description: 'Lowest latency, highest IOPS for databases' },
  hdd: { label: 'HDD', minGB: 100, maxGB: 32000, minIops: 250, maxIops: 2000, iopsPerGB: 2, minTp: 40, maxTp: 500, latencyMs: 6, description: 'Cheap capacity for archives & datasets' },
};

/** Max IOPS for a given type + size (scales with size up to the type maximum). */
export function maxIopsFor(type: VolumeType, sizeGB: number): number {
  const l = VOLUME_LIMITS[type];
  return Math.max(l.minIops, Math.min(l.maxIops, Math.round((sizeGB * l.iopsPerGB) / 100) * 100));
}
