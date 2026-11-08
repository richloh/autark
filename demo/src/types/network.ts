import type { BaseResource, ID, Ref, Scoped, ISODate, Tag } from './common';

export interface Subnet {
  id: ID;
  name: string;
  cidr: string;
  public: boolean;
  gateway: string;
  dhcp: boolean;
  description?: string;
  /** decorated on read: addresses in use (gateway + VMs + DBs + k8s nodes) and usable capacity */
  usedIps?: number;
  capacity?: number;
}

export interface Route {
  id: ID;
  destination: string; // CIDR
  target: { type: 'local' | 'nat' | 'internet' | 'vm' | 'peering' | 'vpn'; id?: ID };
  description?: string;
  system?: boolean;
}

export interface Peering { id: ID; networkId: ID; status: 'active' | 'pending'; kind?: 'peering' | 'vpn'; createdAt?: ISODate }

export interface Network extends BaseResource, Scoped {
  cidr: string;
  locationId: ID;
  status: 'available' | 'provisioning' | 'deleting';
  natGateway: boolean;
  dnsZoneId: ID | null;
  mtu: number;
  subnets: Subnet[];
  routes: Route[];
  peerings: Peering[];
  description?: string;
  /** decorated on read */
  attached?: { vms: number; dbs: number; lbs: number; k8s: number };
  monthlyCost?: number;
}

export interface IpPool {
  id: ID;
  name: string;
  version: 4 | 6;
  cidr: string;
  locationId: ID;
  reserved: number; // addresses reserved for infra (gateway, broadcast, ...)
  /** decorated on read (across all tenants) */
  allocated?: number;
  assigned?: number;
  total?: number;
  utilization?: number; // 0..1
}

export type IpCellState = 'network' | 'reserved' | 'broadcast' | 'free' | 'allocated' | 'assigned' | 'foreign';
export interface IpCell { address: string; state: IpCellState; ipId?: ID; projectId?: ID; owner?: (Ref & { name?: string }) | null; reverseDns?: string | null; name?: string }
export interface IpPoolMap { pool: IpPool; cells: IpCell[]; truncated: boolean }

export interface IpAddress {
  id: ID;
  address: string;
  version: 4 | 6;
  poolId: ID;
  accountId: ID;
  projectId: ID;
  assignedTo: Ref | null;
  reverseDns: string | null;
  name?: string;
  createdAt: ISODate;
  tags: Tag[];
  monthlyCost?: number;
}

export type FirewallProtocol = 'tcp' | 'udp' | 'icmp' | 'any';

export interface FirewallRule {
  id: ID;
  direction: 'inbound' | 'outbound';
  protocol: FirewallProtocol;
  ports: string; // "22", "80,443", "8000-9000", "*"
  source: string; // CIDR or "0.0.0.0/0" (for outbound it's the destination)
  action: 'allow' | 'deny';
  priority: number; // lower = evaluated first
  description: string;
  enabled: boolean;
}

export interface Firewall extends BaseResource, Scoped {
  description: string;
  defaultInbound: 'allow' | 'deny';
  defaultOutbound: 'allow' | 'deny';
  rules: FirewallRule[];
  attachedTo: Ref[];
}

export interface FirewallTraceStep { ruleId: ID; priority: number; matched: boolean; reason: string }
export interface FirewallEvaluation {
  verdict: 'allow' | 'deny';
  matchedRuleId: ID | null;
  matchedBy: 'rule' | 'default';
  reason: string;
  trace: FirewallTraceStep[];
}

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'NS' | 'CAA' | 'PTR';

export interface DnsRecord {
  id: ID;
  type: DnsRecordType;
  name: string; // relative, "@" for apex
  value: string;
  ttl: number;
  priority?: number; // MX / SRV
  managedBy?: Ref | null; // auto-created by a resource (e.g. LB, VM)
  system?: boolean; // apex NS etc., cannot be removed
}

export interface DnsZone extends BaseResource, Scoped {
  kind: 'public' | 'private';
  networkId?: ID | null; // private zones bind to a VPC
  dnssec: boolean;
  defaultTtl: number;
  serial: number;
  nameservers: string[];
  records: DnsRecord[];
  status: 'active' | 'pending-delegation';
  description?: string;
  dsRecord?: string | null; // DNSSEC DS record to publish at the registrar
  monthlyCost?: number;
}

export interface ZoneImportResult { imported: number; updated: number; skipped: { line: number; text: string; reason: string }[] }
