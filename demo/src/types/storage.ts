import type { BaseResource, ID, ISODate, Scoped } from './common';

export type StorageClass = 'STANDARD' | 'INFREQUENT' | 'ARCHIVE';

export interface LifecycleRule {
  id: ID;
  prefix: string;
  action: 'transition' | 'expire';
  days: number;
  toClass?: 'INFREQUENT' | 'ARCHIVE';
  enabled: boolean;
  /** optional: also applies to noncurrent versions (versioned buckets) */
  noncurrent?: boolean;
}

export interface CorsRule { id: ID; origins: string[]; methods: string[]; maxAgeSec: number; allowedHeaders?: string[] }

export interface Bucket extends BaseResource, Scoped {
  locationId: ID;
  storageClass: StorageClass;
  versioning: boolean;
  objectLock: boolean;
  /** default retention (days) applied to new objects when object lock is on */
  objectLockRetentionDays?: number;
  objectLockMode?: 'governance' | 'compliance';
  encryption: 'none' | 'SSE' | 'SSE-KMS';
  access: 'private' | 'public-read';
  bytesUsed: number;
  objectCount: number;
  requestsLast30d: number;
  egressGBLast30d: number;
  lifecycleRules: LifecycleRule[];
  cors: CorsRule[];
  endpoint: string;
  quotaGB: number | null;
  status?: 'creating' | 'active' | 'deleting';
  description?: string;
  monthlyCost?: number;
  /** computed on read: estimated bytes per storage class (lifecycle transitions applied) */
  classBreakdown?: Record<StorageClass, number>;
}

export interface BucketObject {
  id: ID;
  bucketId: ID;
  accountId: ID;
  projectId: ID;
  key: string; // full path "assets/img/logo.png"; folders end with "/"
  sizeBytes: number;
  contentType: string;
  storageClass: Bucket['storageClass'];
  etag: string;
  lastModified: ISODate;
  createdAt: ISODate;
  /** small inline content (text or data: URL) for previews */
  content?: string;
  tags: { key: string; value: string }[];
  name: string;
  /** number of stored versions (versioned buckets) */
  versions?: number;
  /** object lock: cannot be deleted/overwritten before this time */
  retainUntil?: ISODate | null;
}

/** Response of GET /buckets/:id/objects */
export interface ObjectListing {
  prefix: string;
  folders: { prefix: string; name: string; objectCount: number; sizeBytes: number; lastModified: ISODate | null }[];
  objects: (Omit<BucketObject, 'content'> & { hasContent: boolean })[];
  totalObjects: number;
}

export interface AccessKey {
  id: ID;
  name: string;
  accountId: ID;
  projectId: ID;
  accessKeyId: string;
  secretMasked: string;
  bucketIds: ID[] | '*';
  permission: 'read' | 'write' | 'readwrite';
  createdAt: ISODate;
  lastUsed: ISODate | null;
  status: 'active' | 'revoked';
  expiresAt?: ISODate | null;
  description?: string;
  tags: { key: string; value: string }[];
}

/** Returned once by POST /accessKeys and the rotate action. */
export type AccessKeyWithSecret = AccessKey & { secretAccessKey: string };
