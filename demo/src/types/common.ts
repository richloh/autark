export type ID = string;
export type ISODate = string;

export interface Tag { key: string; value: string }

/** Every resource kind known to the platform. Used for refs, links, icons, audit. */
export type ResourceKind =
  | 'vm' | 'volume' | 'snapshot' | 'image' | 'sshKey'
  | 'network' | 'ip' | 'ipPool' | 'firewall' | 'dnsZone'
  | 'db' | 'dbBackup' | 'k8s' | 'k8sWorkload' | 'bucket' | 'accessKey' | 'lb' | 'certificate'
  | 'bareMetal' | 'provider' | 'location'
  | 'user' | 'role' | 'systemAccount' | 'project' | 'allowance'
  | 'operation';

export interface Ref { type: ResourceKind; id: ID }

export interface Scoped { accountId: ID; projectId: ID }

export interface BaseResource {
  id: ID;
  name: string;
  createdAt: ISODate;
  updatedAt?: ISODate;
  tags: Tag[];
}

export interface Account { id: ID; name: string; plan: 'community' | 'enterprise' }

export interface Project {
  id: ID;
  accountId: ID;
  name: string;
  description: string;
  color: string; // hex, used for chips & charts
  createdAt: ISODate;
}

export interface Location {
  id: ID; // e.g. "dc1", "hetzner-nbg1"
  name: string; // "On-Prem DC1 · Frankfurt"
  kind: 'selfHosted' | 'cloud';
  providerId?: ID; // for cloud locations -> CloudProvider id
  region?: string; // provider region code
  city: string;
  country: string; // ISO-2
  lat: number;
  lon: number;
}

export type OperationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface OperationStep {
  name: string;
  status: StepStatus;
  durationMs: number;
  startedAt?: ISODate;
  finishedAt?: ISODate;
  logs: string[]; // logs revealed progressively while running
}

/** A long-running, asynchronous task executed by the control plane (mock). */
export interface Operation {
  id: ID;
  type: string; // e.g. "vm.create", "k8s.upgrade"
  title: string; // human title "Provision VM web-3"
  target: Ref & { name?: string };
  accountId?: ID;
  projectId?: ID;
  actor: string;
  status: OperationStatus;
  progress: number; // 0..1
  steps: OperationStep[];
  createdAt: ISODate;
  startedAt?: ISODate;
  finishedAt?: ISODate;
  error?: string;
  /** internal: name of completion handler + payload (mock server only) */
  completion?: { handler: string; payload?: unknown; failHandler?: string };
}

export interface AuditEvent {
  id: ID;
  when: ISODate;
  actor: string;
  action: string; // "vm.create", "vm.start", "firewall.update" ...
  target: Ref & { name?: string };
  result: 'success' | 'failure';
  accountId?: ID;
  projectId?: ID;
  sourceIp?: string;
  via?: 'console' | 'api' | 'terraform' | 'cli' | 'system';
  details?: string;
}

export interface Notification {
  id: ID;
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  time: ISODate;
  read: boolean;
  link?: string;
  accountId?: ID;
}

export interface MetricPoint { t: number; v: number }
export interface MetricSeries { metric: string; unit: string; points: MetricPoint[]; max?: number }

export interface ListResponse<T> { items: T[]; total: number }
