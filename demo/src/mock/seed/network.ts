import type { Network, IpPool, IpAddress, Firewall, FirewallRule, DnsZone, Subnet, Route } from '@/types';
import { ago, tags, scope, DAY } from './util';

const sn = (id: string, name: string, cidr: string, pub: boolean): Subnet => {
  const base = cidr.split('/')[0].split('.').map(Number);
  return { id, name, cidr, public: pub, gateway: `${base[0]}.${base[1]}.${base[2]}.1`, dhcp: true };
};
const sysRoutes = (cidr: string, nat: boolean): Route[] => [
  { id: 'rt-local', destination: cidr, target: { type: 'local' }, description: 'VPC local traffic', system: true },
  ...(nat ? [{ id: 'rt-nat', destination: '0.0.0.0/0', target: { type: 'nat' as const }, description: 'Private subnets egress via NAT', system: true }] : []),
];

export function seedNetwork() {
  const networks: Network[] = [
    { id: 'net-001', name: 'vpc-app1', ...scope('proj-app1'), cidr: '10.10.0.0/16', locationId: 'dc1', status: 'available', natGateway: true, dnsZoneId: 'zone-002', mtu: 1450,
      subnets: [sn('sn-001', 'app1-public', '10.10.1.0/24', true), sn('sn-002', 'app1-private', '10.10.2.0/24', false), sn('sn-007', 'app1-k8s', '10.10.16.0/20', false)],
      routes: [...sysRoutes('10.10.0.0/16', true), { id: 'rt-001', destination: '10.40.0.0/16', target: { type: 'peering', id: 'net-004' }, description: 'To edge VPC' }],
      peerings: [{ id: 'peer-001', networkId: 'net-004', status: 'active', kind: 'peering' }], createdAt: ago(380 * DAY), tags: tags({ env: 'prod' }), description: 'Production VPC for the web shop' },
    { id: 'net-004', name: 'vpc-edge', ...scope('proj-app1'), cidr: '10.40.0.0/16', locationId: 'dc1', status: 'available', natGateway: false, dnsZoneId: null, mtu: 1450,
      subnets: [sn('sn-006', 'edge-public', '10.40.1.0/24', true)],
      routes: [...sysRoutes('10.40.0.0/16', false), { id: 'rt-002', destination: '10.10.0.0/16', target: { type: 'peering', id: 'net-001' }, description: 'To app VPC' }],
      peerings: [{ id: 'peer-001', networkId: 'net-001', status: 'active', kind: 'peering' }], createdAt: ago(360 * DAY), tags: tags({ env: 'prod' }), description: 'Edge proxies / DMZ' },
    { id: 'net-003', name: 'vpc-app2', ...scope('proj-app2'), cidr: '10.30.0.0/16', locationId: 'dc2', status: 'available', natGateway: true, dnsZoneId: null, mtu: 1450,
      subnets: [sn('sn-004', 'app2-public', '10.30.1.0/24', true), sn('sn-005', 'app2-private', '10.30.2.0/24', false)],
      routes: sysRoutes('10.30.0.0/16', true), peerings: [], createdAt: ago(290 * DAY), tags: tags({ env: 'staging' }) },
    { id: 'net-002', name: 'vpc-ml', ...scope('proj-ml'), cidr: '10.20.0.0/16', locationId: 'dc1', status: 'available', natGateway: true, dnsZoneId: null, mtu: 9000,
      subnets: [sn('sn-003', 'ml-compute', '10.20.1.0/24', true), sn('sn-011', 'ml-k8s', '10.20.16.0/20', false)],
      routes: [...sysRoutes('10.20.0.0/16', true), { id: 'rt-003', destination: '10.21.0.0/16', target: { type: 'vpn', id: 'net-006' }, description: 'Site-to-site to Hetzner burst VPC' }],
      peerings: [{ id: 'peer-002', networkId: 'net-006', status: 'active', kind: 'vpn' }], createdAt: ago(190 * DAY), tags: tags({ team: 'ml' }), description: 'Jumbo frames for GPU/RDMA traffic' },
    { id: 'net-006', name: 'vpc-ml-burst', ...scope('proj-ml'), cidr: '10.21.0.0/16', locationId: 'hetzner-nbg1', status: 'available', natGateway: false, dnsZoneId: null, mtu: 1450,
      subnets: [sn('sn-010', 'burst-gpu', '10.21.1.0/24', true)],
      routes: [...sysRoutes('10.21.0.0/16', false), { id: 'rt-004', destination: '10.20.0.0/16', target: { type: 'vpn', id: 'net-002' }, description: 'Site-to-site to DC1' }],
      peerings: [{ id: 'peer-002', networkId: 'net-002', status: 'active', kind: 'vpn' }], createdAt: ago(120 * DAY), tags: tags({ team: 'ml', burst: 'true' }) },
    { id: 'net-005', name: 'vpc-infra', ...scope('proj-infra'), cidr: '10.50.0.0/16', locationId: 'dc2', status: 'available', natGateway: true, dnsZoneId: null, mtu: 1450,
      subnets: [sn('sn-008', 'infra-core', '10.50.1.0/24', true), sn('sn-009', 'infra-k8s', '10.50.16.0/20', false)],
      routes: sysRoutes('10.50.0.0/16', true), peerings: [], createdAt: ago(370 * DAY), tags: [] },
  ];

  const ipPools: IpPool[] = [
    { id: 'pool-dc1', name: 'DC1 Public IPv4', version: 4, cidr: '203.0.113.0/24', locationId: 'dc1', reserved: 8 },
    { id: 'pool-dc1-v6', name: 'DC1 IPv6', version: 6, cidr: '2001:db8:abcd::/48', locationId: 'dc1', reserved: 0 },
    { id: 'pool-dc2', name: 'DC2 Public IPv4', version: 4, cidr: '198.51.100.0/24', locationId: 'dc2', reserved: 8 },
    { id: 'pool-hetzner-nbg1', name: 'Hetzner nbg1 IPv4', version: 4, cidr: '192.0.2.0/25', locationId: 'hetzner-nbg1', reserved: 4 },
  ];

  const ipSpec: [string, string, string, string, IpAddress['assignedTo'], string?][] = [
    ['ip-001', '203.0.113.10', 'pool-dc1', 'proj-app1', { type: 'vm', id: 'vm-001' }, 'web-1.example.com'],
    ['ip-002', '203.0.113.11', 'pool-dc1', 'proj-app1', { type: 'lb', id: 'lb-001' }, 'www.example.com'],
    ['ip-004', '203.0.113.12', 'pool-dc1', 'proj-app1', { type: 'vm', id: 'vm-003' }, 'web-2.example.com'],
    ['ip-005', '203.0.113.13', 'pool-dc1', 'proj-app1', { type: 'vm', id: 'vm-007' }, 'bastion.example.com'],
    ['ip-010', '203.0.113.14', 'pool-dc1', 'proj-app1', { type: 'vm', id: 'vm-008' }],
    ['ip-013', '203.0.113.15', 'pool-dc1', 'proj-app1', null],
    ['ip-003', '203.0.113.21', 'pool-dc1', 'proj-ml', { type: 'vm', id: 'vm-002' }],
    ['ip-006', '198.51.100.10', 'pool-dc2', 'proj-app2', null],
    ['ip-007', '198.51.100.11', 'pool-dc2', 'proj-app2', { type: 'lb', id: 'lb-002' }, 'api-staging.example.org'],
    ['ip-008', '198.51.100.12', 'pool-dc2', 'proj-app2', { type: 'vm', id: 'vm-004' }],
    ['ip-011', '198.51.100.13', 'pool-dc2', 'proj-app2', { type: 'vm', id: 'vm-010' }],
    ['ip-012', '198.51.100.40', 'pool-dc2', 'proj-infra', { type: 'vm', id: 'vm-017' }, 'vpn.example.net'],
    ['ip-009', '192.0.2.31', 'pool-hetzner-nbg1', 'proj-ml', { type: 'vm', id: 'vm-006' }],
    ['ip-014', '2001:db8:abcd::10', 'pool-dc1-v6', 'proj-app1', { type: 'lb', id: 'lb-001' }],
  ];
  const ips: IpAddress[] = ipSpec.map(([id, address, poolId, project, assignedTo, rdns], i) => ({
    id, address, version: address.includes(':') ? 6 : 4, poolId, ...scope(project), assignedTo, reverseDns: rdns ?? null,
    createdAt: ago((200 - i * 9) * DAY), tags: [],
  }));

  let rid = 0;
  const r = (direction: FirewallRule['direction'], protocol: FirewallRule['protocol'], ports: string, source: string, action: FirewallRule['action'], priority: number, description: string): FirewallRule =>
    ({ id: `r-${++rid}`, direction, protocol, ports, source, action, priority, description, enabled: true });

  const firewalls: Firewall[] = [
    { id: 'fw-001', name: 'ssh-bastion', ...scope('proj-app1'), description: 'SSH from office only', defaultInbound: 'deny', defaultOutbound: 'allow',
      rules: [r('inbound', 'tcp', '22', '198.51.100.0/24', 'allow', 100, 'Office VPN'), r('inbound', 'icmp', '*', '0.0.0.0/0', 'allow', 200, 'Ping')],
      attachedTo: [{ type: 'vm', id: 'vm-007' }], createdAt: ago(300 * DAY), tags: tags({ env: 'prod' }) },
    { id: 'fw-002', name: 'web-allow', ...scope('proj-app1'), description: 'Public HTTP(S) for web tier', defaultInbound: 'deny', defaultOutbound: 'allow',
      rules: [r('inbound', 'tcp', '80,443', '0.0.0.0/0', 'allow', 100, 'HTTP/HTTPS'), r('inbound', 'tcp', '22', '10.10.1.5/32', 'allow', 110, 'SSH from bastion'), r('inbound', 'tcp', '9100', '10.50.1.30/32', 'allow', 120, 'node_exporter scrape'), r('inbound', 'tcp', '*', '192.0.2.66/32', 'deny', 50, 'Blocked scanner')],
      attachedTo: [{ type: 'vm', id: 'vm-001' }, { type: 'vm', id: 'vm-003' }, { type: 'vm', id: 'vm-009' }], createdAt: ago(300 * DAY), tags: tags({ env: 'prod' }) },
    { id: 'fw-004', name: 'db-internal', ...scope('proj-app1'), description: 'Postgres from app subnets', defaultInbound: 'deny', defaultOutbound: 'allow',
      rules: [r('inbound', 'tcp', '5432', '10.10.0.0/16', 'allow', 100, 'Postgres from VPC'), r('inbound', 'tcp', '22', '10.10.1.5/32', 'allow', 110, 'SSH from bastion')],
      attachedTo: [{ type: 'vm', id: 'vm-005' }, { type: 'db', id: 'db-001' }], createdAt: ago(290 * DAY), tags: tags({ env: 'prod' }) },
    { id: 'fw-006', name: 'edge-lb', ...scope('proj-app1'), description: 'Edge & LB ingress', defaultInbound: 'deny', defaultOutbound: 'allow',
      rules: [r('inbound', 'tcp', '80,443', '0.0.0.0/0', 'allow', 100, 'Public web'), r('inbound', 'udp', '443', '0.0.0.0/0', 'allow', 110, 'HTTP/3 QUIC')],
      attachedTo: [{ type: 'vm', id: 'vm-008' }, { type: 'lb', id: 'lb-001' }], createdAt: ago(280 * DAY), tags: tags({ env: 'prod' }) },
    { id: 'fw-005', name: 'k8s-nodes', ...scope('proj-app1'), description: 'Kubernetes worker nodes', defaultInbound: 'deny', defaultOutbound: 'allow',
      rules: [r('inbound', 'tcp', '30000-32767', '10.10.0.0/16', 'allow', 100, 'NodePorts from VPC'), r('inbound', 'tcp', '10250', '10.10.16.0/20', 'allow', 110, 'Kubelet')],
      attachedTo: [{ type: 'k8s', id: 'k8s-001' }], createdAt: ago(250 * DAY), tags: [] },
    { id: 'fw-003', name: 'api-staging', ...scope('proj-app2'), description: 'API servers', defaultInbound: 'deny', defaultOutbound: 'allow',
      rules: [r('inbound', 'tcp', '8080', '10.30.0.0/16', 'allow', 100, 'From LB subnet'), r('inbound', 'tcp', '22', '198.51.100.0/24', 'allow', 110, 'Office'), r('outbound', 'tcp', '25', '0.0.0.0/0', 'deny', 50, 'No direct SMTP')],
      attachedTo: [{ type: 'vm', id: 'vm-004' }, { type: 'vm', id: 'vm-010' }, { type: 'vm', id: 'vm-011' }, { type: 'vm', id: 'vm-012' }], createdAt: ago(280 * DAY), tags: tags({ env: 'staging' }) },
    { id: 'fw-008', name: 'lb-staging', ...scope('proj-app2'), description: 'Staging LB', defaultInbound: 'deny', defaultOutbound: 'allow',
      rules: [r('inbound', 'tcp', '8080', '0.0.0.0/0', 'allow', 100, 'Public API')],
      attachedTo: [{ type: 'lb', id: 'lb-002' }], createdAt: ago(200 * DAY), tags: [] },
    { id: 'fw-012', name: 'db-app2', ...scope('proj-app2'), description: 'MySQL & Postgres from app2 VPC', defaultInbound: 'deny', defaultOutbound: 'allow',
      rules: [r('inbound', 'tcp', '3306,5432', '10.30.0.0/16', 'allow', 100, 'DB from VPC')],
      attachedTo: [{ type: 'db', id: 'db-003' }, { type: 'db', id: 'db-004' }], createdAt: ago(200 * DAY), tags: [] },
    { id: 'fw-009', name: 'ml-internal', ...scope('proj-ml'), description: 'ML cluster internal + Jupyter', defaultInbound: 'deny', defaultOutbound: 'allow',
      rules: [r('inbound', 'any', '*', '10.20.0.0/15', 'allow', 100, 'All ML VPCs'), r('inbound', 'tcp', '22', '198.51.100.0/24', 'allow', 110, 'Office SSH'), r('inbound', 'tcp', '8888', '198.51.100.0/24', 'allow', 120, 'Jupyter from office')],
      attachedTo: [{ type: 'vm', id: 'vm-002' }, { type: 'vm', id: 'vm-006' }, { type: 'vm', id: 'vm-013' }, { type: 'vm', id: 'vm-014' }], createdAt: ago(190 * DAY), tags: tags({ team: 'ml' }) },
    { id: 'fw-007', name: 'redis-internal', ...scope('proj-ml'), description: 'Redis for feature store', defaultInbound: 'deny', defaultOutbound: 'allow',
      rules: [r('inbound', 'tcp', '6379', '10.20.0.0/16', 'allow', 100, 'Redis from VPC')],
      attachedTo: [{ type: 'db', id: 'db-002' }], createdAt: ago(180 * DAY), tags: [] },
    { id: 'fw-010', name: 'infra-core', ...scope('proj-infra'), description: 'CI & monitoring', defaultInbound: 'deny', defaultOutbound: 'allow',
      rules: [r('inbound', 'tcp', '22', '10.50.1.5/32', 'allow', 100, 'SSH via VPN'), r('inbound', 'tcp', '3000,9090', '10.0.0.0/8', 'allow', 110, 'Grafana / Prometheus')],
      attachedTo: [{ type: 'vm', id: 'vm-015' }, { type: 'vm', id: 'vm-016' }], createdAt: ago(360 * DAY), tags: [] },
    { id: 'fw-011', name: 'vpn', ...scope('proj-infra'), description: 'WireGuard endpoint', defaultInbound: 'deny', defaultOutbound: 'allow',
      rules: [r('inbound', 'udp', '51820', '0.0.0.0/0', 'allow', 100, 'WireGuard')],
      attachedTo: [{ type: 'vm', id: 'vm-017' }], createdAt: ago(360 * DAY), tags: [] },
  ];

  let rec = 0;
  const d = (type: any, name: string, value: string, ttl = 300, priority?: number, managedBy?: any) => ({ id: `rec-${++rec}`, type, name, value, ttl, priority, managedBy: managedBy ?? null });
  const dnsZones: DnsZone[] = [
    { id: 'zone-001', name: 'example.com', ...scope('proj-app1'), kind: 'public', networkId: null, dnssec: true, defaultTtl: 3600, serial: 2026110801, nameservers: ['ns1.autark.example', 'ns2.autark.example'], status: 'active', createdAt: ago(380 * DAY), tags: tags({ env: 'prod' }), description: 'Public web shop domain',
      dsRecord: 'example.com. 3600 IN DS 31589 13 2 A7C1F0E3B5D2C4A6F8E9D0C1B2A3F4E5D6C7B8A9F0E1D2C3B4A5F6E7D8C9B0A1',
      records: [
        d('A', '@', '203.0.113.11', 300, undefined, { type: 'lb', id: 'lb-001' }), d('AAAA', '@', '2001:db8:abcd::10', 300, undefined, { type: 'lb', id: 'lb-001' }),
        d('CNAME', 'www', 'example.com.', 300), d('A', 'web-1', '203.0.113.10', 300, undefined, { type: 'vm', id: 'vm-001' }), d('A', 'web-2', '203.0.113.12', 300, undefined, { type: 'vm', id: 'vm-003' }),
        d('A', 'bastion', '203.0.113.13', 300), d('MX', '@', 'mail.example.com.', 3600, 10), d('MX', '@', 'mail2.example.com.', 3600, 20),
        d('TXT', '@', 'v=spf1 include:_spf.example.com ~all', 3600), d('TXT', '_dmarc', 'v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com', 3600),
        d('CAA', '@', '0 issue "letsencrypt.org"', 3600), d('SRV', '_sip._tcp', '10 60 5060 sip.example.com.', 3600, 10),
      ] },
    { id: 'zone-002', name: 'app1.internal', ...scope('proj-app1'), kind: 'private', networkId: 'net-001', dnssec: false, defaultTtl: 300, serial: 2026110402, nameservers: ['10.10.0.2'], status: 'active', createdAt: ago(370 * DAY), tags: [], description: 'Service discovery inside vpc-app1',
      records: [d('A', 'pg', '10.10.2.50', 60, undefined, { type: 'db', id: 'db-001' }), d('A', 'replica', '10.10.2.21', 60), d('A', 'k8s-api', '10.10.16.2', 60, undefined, { type: 'k8s', id: 'k8s-001' }), d('CNAME', 'db', 'pg.app1.internal.', 60)] },
    { id: 'zone-003', name: 'example.org', ...scope('proj-app2'), kind: 'public', networkId: null, dnssec: false, defaultTtl: 3600, serial: 2026103101, nameservers: ['ns1.autark.example', 'ns2.autark.example'], status: 'active', createdAt: ago(280 * DAY), tags: [],
      records: [d('A', 'api-staging', '198.51.100.11', 300, undefined, { type: 'lb', id: 'lb-002' }), d('A', '@', '198.51.100.10', 300), d('TXT', '@', 'google-site-verification=abc123', 3600)] },
    { id: 'zone-004', name: 'ml.example.net', ...scope('proj-ml'), kind: 'public', networkId: null, dnssec: false, defaultTtl: 3600, serial: 2026102001, nameservers: ['ns1.autark.example', 'ns2.autark.example'], status: 'pending-delegation', createdAt: ago(6 * DAY), tags: tags({ team: 'ml' }),
      records: [d('A', 'jupyter', '203.0.113.21', 300), d('A', 'gpu-burst', '192.0.2.31', 300)] },
  ];

  return { networks, ipPools, ips, firewalls, dnsZones };
}
