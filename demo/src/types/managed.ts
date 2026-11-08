import type { BaseResource, ID, ISODate, Ref, Scoped } from './common';

/* ================================================================================================
 * Managed databases
 * ============================================================================================== */

export type DbEngine = 'postgres' | 'mysql' | 'mariadb' | 'redis';
export type DbStatus =
  | 'provisioning' | 'available' | 'backing-up' | 'restoring' | 'scaling' | 'failing-over'
  | 'maintenance' | 'stopped' | 'error' | 'deleting' | 'upgrading' | 'starting' | 'stopping' | 'rebooting';

export interface DbUser { username: string; role: 'owner' | 'readwrite' | 'readonly'; createdAt: ISODate; passwordChangedAt?: ISODate }
export interface DbDatabase { name: string; owner: string; sizeMB: number; encoding?: string; createdAt?: ISODate }

export interface DbInstance extends BaseResource, Scoped {
  engine: DbEngine;
  version: string;
  status: DbStatus;
  size: { presetId?: ID | null; vcpus: number; ramGB: number };
  storageGB: number;
  storageUsedGB: number;
  storageAutoscale: boolean;
  ha: boolean;
  readReplicas: number;
  locationId: ID;
  networkId: ID;
  subnetId: ID;
  firewallIds: ID[];
  host: string; // DNS host
  port: number;
  publicAccess: boolean;
  users: DbUser[];
  databases: DbDatabase[];
  backups: { enabled: boolean; schedule: 'daily' | 'hourly'; retention: number; pitr: boolean; window: string };
  maintenanceWindow: { day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'; hour: number };
  parameters: Record<string, string>;
  primaryHostId?: ID | null;
  standbyHostId?: ID | null;
  privateIp?: string;
  /** public endpoint hostname when publicAccess is on */
  publicHost?: string | null;
  /** parameters changed that only take effect after a restart */
  pendingRestart?: string[];
  deletionProtection?: boolean;
  /** set while the generated admin password has not been revealed yet (server only stores it until revealed) */
  hasInitialCredentials?: boolean;
  /** last completed failover */
  lastFailoverAt?: ISODate | null;
  /** origin when restored from a backup / point in time */
  restoredFrom?: { backupId?: ID; sourceId?: ID; sourceName?: string; timestamp?: ISODate } | null;
  /** computed on read */
  monthlyCost?: number;
  lastBackupAt?: ISODate | null;
  earliestRestoreTime?: ISODate | null;
}

export interface DbPreset {
  id: ID;
  name: string;
  engine: DbEngine | 'any';
  vcpus: number;
  ramGB: number;
  storageGB: number;
  description: string;
  builtIn?: boolean;
  createdAt?: ISODate;
  createdBy?: string;
  /** computed on read */
  usedBy?: number;
  monthlyCost?: number;
}

export interface DbBackup {
  id: ID;
  dbId: ID;
  accountId: ID;
  projectId: ID;
  createdAt: ISODate;
  sizeGB: number;
  type: 'automated' | 'manual' | 'final' | 'pre-upgrade';
  status: 'creating' | 'available' | 'restoring' | 'failed';
  name: string;
  tags: { key: string; value: string }[];
  engine?: DbEngine;
  version?: string;
  /** source instance name (kept when the instance is deleted) */
  sourceName?: string;
  sourceDeleted?: boolean;
}

/** Engine catalog served by GET /db/engines */
export interface DbParamSpec {
  name: string;
  type: 'int' | 'size' | 'enum' | 'bool' | 'string';
  default: string;
  min?: number;
  max?: number;
  options?: string[];
  unit?: string;
  restart: boolean;
  description: string;
}
export interface DbEngineSpec {
  id: DbEngine;
  label: string;
  defaultPort: number;
  adminUser: string;
  versions: { version: string; default?: boolean; eol?: string; deprecated?: boolean }[];
  supportsPitr: boolean;
  supportsDatabases: boolean;
  supportsReplicas: boolean;
  pooler?: string;
  parameters: DbParamSpec[];
  description: string;
}

/* ================================================================================================
 * Load balancers
 * ============================================================================================== */

export type LbProtocol = 'TCP' | 'UDP' | 'HTTP' | 'HTTPS';

export interface LbRule {
  id: ID;
  host?: string;
  pathPrefix?: string;
  targetGroupId: ID;
}

export interface Listener {
  id: ID;
  port: number;
  protocol: LbProtocol;
  certificateId?: ID | null;
  defaultTargetGroupId: ID;
  rules: LbRule[];
  redirectToHttps?: boolean;
}

export type LbTargetHealth = 'healthy' | 'unhealthy' | 'draining' | 'initial';

export interface LbTarget {
  ref: Ref;
  port?: number;
  weight: number;
  health: LbTargetHealth;
  /** when the target was registered (health starts as `initial`) */
  addedAt?: ISODate;
  /** connection draining finished — target receives no traffic until re-enabled */
  drained?: boolean;
  /** computed on read */
  reason?: string;
  name?: string;
  address?: string;
}

export interface TargetGroup {
  id: ID;
  name: string;
  protocol: LbProtocol;
  port: number;
  targets: LbTarget[];
  stickySessions: boolean;
  healthCheck: {
    protocol: 'TCP' | 'HTTP' | 'HTTPS';
    path: string;
    intervalSec: number;
    timeoutSec: number;
    healthyThreshold: number;
    unhealthyThreshold: number;
  };
}

export interface LoadBalancer extends BaseResource, Scoped {
  type: 'L4' | 'L7';
  status: 'provisioning' | 'active' | 'degraded' | 'updating' | 'error' | 'deleting';
  algorithm: 'round_robin' | 'least_connections' | 'ip_hash';
  locationId: ID;
  networkId: ID;
  ipIds: ID[];
  hostname: string;
  listeners: Listener[];
  targetGroups: TargetGroup[];
  firewallIds: ID[];
  proxyProtocol: boolean;
  deletionProtection?: boolean;
  monthlyCost?: number;
  /** computed on read */
  healthSummary?: { healthy: number; unhealthy: number; draining: number; initial: number; total: number };
}

export interface Certificate extends BaseResource, Scoped {
  domains: string[];
  issuer: 'letsencrypt' | 'custom';
  status: 'issued' | 'pending' | 'expiring' | 'failed' | 'expired' | 'renewing';
  expiresAt: ISODate;
  autoRenew: boolean;
  challenge?: 'http-01' | 'dns-01' | null;
  keyType?: 'ECDSA P-256' | 'RSA 2048' | 'RSA 4096';
  issuedAt?: ISODate | null;
  serial?: string;
  fingerprint?: string;
  failureReason?: string | null;
  /** computed on read: LBs/listeners using this certificate */
  usedBy?: { lbId: ID; lbName: string; listenerId: ID; port: number }[];
  daysLeft?: number;
}
