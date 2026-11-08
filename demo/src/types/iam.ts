import type { ID, ISODate, Tag } from './common';

export type Service =
  | 'compute' | 'storage' | 'network' | 'dns' | 'db' | 'k8s' | 'objectStorage' | 'loadBalancers'
  | 'hardware' | 'iam' | 'billing';
export type PermAction = 'read' | 'create' | 'update' | 'delete' | 'operate' | '*';

/** A browser / CLI session of a user. */
export interface UserSession {
  id: ID;
  device: string; // "MacBook Pro · Chrome 131"
  kind: 'browser' | 'cli' | 'mobile';
  ip: string;
  location: string; // "Frankfurt, DE"
  createdAt: ISODate;
  lastActive: ISODate;
  current?: boolean;
}

export interface User {
  id: ID;
  name: string;
  email: string;
  roleIds: ID[];
  projectIds: ID[] | '*';
  mfa: boolean;
  status: 'active' | 'invited' | 'disabled';
  lastLogin: ISODate | null;
  createdAt: ISODate;
  sso: boolean;
  tags: Tag[];
  /** optional enrichments (older persisted rows may lack them) */
  title?: string;
  mfaMethod?: 'totp' | 'webauthn' | null;
  mfaRequired?: boolean;
  invitedAt?: ISODate | null;
  invitedBy?: string | null;
  inviteExpiresAt?: ISODate | null;
  disabledAt?: ISODate | null;
  sessions?: UserSession[];
  apiTokens?: ApiToken[];
}

export interface Role {
  id: ID;
  name: string;
  description: string;
  system: boolean;
  permissions: Partial<Record<Service, PermAction[]>>;
  createdAt: ISODate;
  tags: Tag[];
  clonedFrom?: ID | null;
  updatedAt?: ISODate;
  /* computed on read */
  userCount?: number;
  systemAccountCount?: number;
}

export interface ApiToken {
  id: ID;
  name: string;
  prefix: string; // "atk_live_3f9a"
  createdAt: ISODate;
  expiresAt: ISODate | null;
  lastUsed: ISODate | null;
  status: 'active' | 'revoked' | 'expired';
  revokedAt?: ISODate | null;
  /** set on the old token when it was rotated (it keeps working until expiresAt) */
  rotatedTo?: ID | null;
  lastUsedIp?: string | null;
}

/** Returned once by token-creating actions: the full secret is never stored or shown again. */
export interface TokenSecret { token: ApiToken; secret: string }

export interface SystemAccount {
  id: ID;
  name: string;
  description: string;
  roleIds: ID[];
  projectIds: ID[] | '*';
  tokens: ApiToken[];
  ipAllowlist: string[];
  tagConditions: Tag[]; // can only act on resources with these tags
  createdAt: ISODate;
  lastUsed: ISODate | null;
  tags: Tag[];
  status?: 'active' | 'disabled';
}

export type QuotaKey = 'vcpus' | 'ramGB' | 'vms' | 'volumesGB' | 'dbInstances' | 'k8sClusters' | 'buckets' | 'publicIps';

export interface ProjectAllowance {
  id: ID;
  projectId: ID;
  accountId: ID;
  budgetMonthly: number;
  alertThresholds: number[]; // e.g. [50, 80, 100]
  hardLimit: boolean;
  quotas: Record<QuotaKey, number>;
  allowedServices: Service[];
  allowedLocations: ID[];
  requiredTags: string[];
  createdAt: ISODate;
  tags: Tag[];
  name: string;
  /* computed on read (decorate) */
  usage?: Record<QuotaKey, number>;
  /** current monthly run-rate of all resources in the project */
  monthlySpend?: number;
  /** spend so far this month */
  mtdSpend?: number;
  /** projected spend at month end */
  forecastSpend?: number;
  dayOfMonth?: number;
  daysInMonth?: number;
  spendByService?: { service: string; monthly: number }[];
  /** synthesized spend per day of the current month up to today (index 0 = 1st) */
  dailySpend?: number[];
  resourceCount?: number;
  members?: number;
}

/** Effective permissions: for every service/action, which role(s) grant it. */
export interface EffectivePermissions {
  subject: { type: 'user' | 'systemAccount'; id: ID; name: string };
  roles: { id: ID; name: string; system: boolean }[];
  projectIds: ID[] | '*';
  grants: Partial<Record<Service, Partial<Record<Exclude<PermAction, '*'>, ID[]>>>>;
}
