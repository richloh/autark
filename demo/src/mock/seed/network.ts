import type { Network, IpPool, IpAddress, Firewall, FirewallRule, DnsZone, DnsRecord, Subnet, Route, Ref } from '@/types';
import { ago, tags, ptags, scope, DAY } from './util';

const sn = (id: string, name: string, cidr: string, pub: boolean, description?: string): Subnet => {
  const base = cidr.split('/')[0].split('.').map(Number);
  return { id, name, cidr, public: pub, gateway: `${base[0]}.${base[1]}.${base[2]}.1`, dhcp: true, ...(description ? { description } : {}) };
};
const sysRoutes = (cidr: string, nat: boolean): Route[] => [
  { id: 'rt-local', destination: cidr, target: { type: 'local' }, description: 'VPC local traffic', system: true },
  ...(nat ? [{ id: 'rt-nat', destination: '0.0.0.0/0', target: { type: 'nat' as const }, description: 'Private subnets egress via NAT', system: true }] : []),
];

/** WireGuard client range — admins reach every VPC through vpn-gw. */
const VPN = '10.99.0.0/16';
const MONITORING = '10.50.1.20/32';

export function seedNetwork() {
  const enneoTags = (env: string) => tags({ env, team: 'enneo' });
  const networks: Network[] = [
    { id: 'net-001', name: 'vpc-compass', ...scope('proj-compass'), cidr: '10.10.0.0/16', locationId: 'dc1', status: 'available', natGateway: true, dnsZoneId: 'zone-004', mtu: 1450,
      subnets: [sn('sn-001', 'compass-app', '10.10.1.0/24', true, 'App servers behind compass-lb'), sn('sn-002', 'compass-data', '10.10.2.0/24', false, 'PostgreSQL & Redis'), sn('sn-003', 'compass-batch', '10.10.3.0/24', false, 'Billing batch workers')],
      routes: [...sysRoutes('10.10.0.0/16', true), { id: 'rt-001', destination: '10.20.0.0/16', target: { type: 'peering', id: 'net-002' }, description: 'To Orchestrator' }],
      peerings: [{ id: 'peer-001', networkId: 'net-002', status: 'active', kind: 'peering' }], createdAt: ago(680 * DAY), tags: ptags('proj-compass', 'prod'), description: 'Production VPC for Compass ERP' },
    { id: 'net-002', name: 'vpc-orchestrator', ...scope('proj-orchestrator'), cidr: '10.20.0.0/16', locationId: 'dc1', status: 'available', natGateway: true, dnsZoneId: null, mtu: 1450,
      subnets: [sn('sn-004', 'orch-edge', '10.20.1.0/24', true, 'AS4 / SFTP endpoints for market partners'), sn('sn-005', 'orch-data', '10.20.2.0/24', false), sn('sn-006', 'orch-k8s', '10.20.16.0/20', false)],
      routes: [...sysRoutes('10.20.0.0/16', true),
        { id: 'rt-002', destination: '10.10.0.0/16', target: { type: 'peering', id: 'net-001' }, description: 'To Compass ERP' },
        { id: 'rt-003', destination: '10.30.0.0/16', target: { type: 'peering', id: 'net-003' }, description: 'To SAP IS/U (RFC / IDoc)' }],
      peerings: [{ id: 'peer-001', networkId: 'net-001', status: 'active', kind: 'peering' }, { id: 'peer-002', networkId: 'net-003', status: 'active', kind: 'peering' }],
      createdAt: ago(530 * DAY), tags: ptags('proj-orchestrator', 'prod'), description: 'Market communication & workflow orchestration' },
    { id: 'net-003', name: 'vpc-sap-isu', ...scope('proj-isu'), cidr: '10.30.0.0/16', locationId: 'dc1', status: 'available', natGateway: true, dnsZoneId: null, mtu: 9000,
      subnets: [sn('sn-007', 'isu-db', '10.30.1.0/24', false, 'HANA'), sn('sn-008', 'isu-app', '10.30.2.0/24', false, 'ASCS & application servers')],
      routes: [...sysRoutes('10.30.0.0/16', true),
        { id: 'rt-004', destination: '10.20.0.0/16', target: { type: 'peering', id: 'net-002' }, description: 'To Orchestrator' },
        { id: 'rt-005', destination: '10.31.0.0/16', target: { type: 'peering', id: 'net-004' }, description: 'To SAP S4 (migration data transfer)' }],
      peerings: [{ id: 'peer-002', networkId: 'net-002', status: 'active', kind: 'peering' }, { id: 'peer-003', networkId: 'net-004', status: 'active', kind: 'peering' }],
      createdAt: ago(690 * DAY), tags: ptags('proj-isu', 'prod'), description: 'SAP IS-U production landscape (jumbo frames for HANA replication)' },
    { id: 'net-004', name: 'vpc-sap-s4', ...scope('proj-s4'), cidr: '10.31.0.0/16', locationId: 'dc1', status: 'available', natGateway: true, dnsZoneId: null, mtu: 9000,
      subnets: [sn('sn-009', 's4-core', '10.31.1.0/24', false), sn('sn-010', 's4-dmz', '10.31.10.0/24', true, 'Web Dispatcher')],
      routes: [...sysRoutes('10.31.0.0/16', true), { id: 'rt-006', destination: '10.30.0.0/16', target: { type: 'peering', id: 'net-003' }, description: 'To SAP IS/U' }],
      peerings: [{ id: 'peer-003', networkId: 'net-003', status: 'active', kind: 'peering' }], createdAt: ago(158 * DAY), tags: ptags('proj-s4', 'staging') },
    { id: 'net-005', name: 'vpc-website', ...scope('proj-website'), cidr: '10.40.0.0/16', locationId: 'dc2', status: 'available', natGateway: true, dnsZoneId: null, mtu: 1450,
      subnets: [sn('sn-011', 'web-public', '10.40.1.0/24', true), sn('sn-012', 'web-data', '10.40.2.0/24', false)],
      routes: sysRoutes('10.40.0.0/16', true), peerings: [], createdAt: ago(600 * DAY), tags: ptags('proj-website', 'prod'), description: 'regiocom-energie.de' },
    { id: 'net-006', name: 'vpc-website-dr', ...scope('proj-website'), cidr: '10.41.0.0/16', locationId: 'aws-eu-central-1', status: 'available', natGateway: false, dnsZoneId: null, mtu: 1450,
      subnets: [sn('sn-013', 'dr-public', '10.41.1.0/24', true)],
      routes: sysRoutes('10.41.0.0/16', false), peerings: [], createdAt: ago(180 * DAY), tags: ptags('proj-website', 'dr'), description: 'Cold standby for the website (static fallback)' },
    { id: 'net-007', name: 'vpc-tools', ...scope('proj-tools'), cidr: '10.50.0.0/16', locationId: 'dc1', status: 'available', natGateway: true, dnsZoneId: 'zone-002', mtu: 1450,
      subnets: [sn('sn-014', 'tools-core', '10.50.1.0/24', true)],
      routes: [...sysRoutes('10.50.0.0/16', true), { id: 'rt-007', destination: '10.51.0.0/16', target: { type: 'peering', id: 'net-008' }, description: 'To RZ Frankfurt tools VPC' },
        { id: 'rt-008', destination: VPN, target: { type: 'vm', id: 'vm-019' }, description: 'WireGuard clients via vpn-gw' }],
      peerings: [{ id: 'peer-004', networkId: 'net-008', status: 'active', kind: 'peering' }], createdAt: ago(710 * DAY), tags: ptags('proj-tools', 'prod'), description: 'GitLab, monitoring, VPN' },
    { id: 'net-008', name: 'vpc-tools-fra', ...scope('proj-tools'), cidr: '10.51.0.0/16', locationId: 'dc2', status: 'available', natGateway: true, dnsZoneId: null, mtu: 1450,
      subnets: [sn('sn-015', 'tools-fra', '10.51.1.0/24', false)],
      routes: [...sysRoutes('10.51.0.0/16', true), { id: 'rt-009', destination: '10.50.0.0/16', target: { type: 'peering', id: 'net-007' }, description: 'To RZ Magdeburg tools VPC' }],
      peerings: [{ id: 'peer-004', networkId: 'net-007', status: 'active', kind: 'peering' }], createdAt: ago(560 * DAY), tags: ptags('proj-tools', 'prod'), description: 'CI runners and offsite backup proxy' },
    { id: 'net-009', name: 'vpc-tools-ext', ...scope('proj-tools'), cidr: '10.52.0.0/16', locationId: 'hetzner-fsn1', status: 'available', natGateway: false, dnsZoneId: null, mtu: 1450,
      subnets: [sn('sn-016', 'ext-public', '10.52.1.0/24', true)],
      routes: sysRoutes('10.52.0.0/16', false), peerings: [], createdAt: ago(300 * DAY), tags: ptags('proj-tools', 'prod'), description: 'External status page & uptime checks (outside our own DCs)' },
    { id: 'net-010', name: 'vpc-enneo-intern', ...scope('proj-enneo-intern'), cidr: '10.70.0.0/16', locationId: 'dc1', status: 'available', natGateway: true, dnsZoneId: null, mtu: 1450,
      subnets: [sn('sn-017', 'intern-dev', '10.70.1.0/24', true), sn('sn-018', 'intern-data', '10.70.2.0/24', false), sn('sn-019', 'intern-k8s', '10.70.16.0/20', false)],
      routes: [...sysRoutes('10.70.0.0/16', true), { id: 'rt-010', destination: '10.71.0.0/16', target: { type: 'vpn', id: 'net-011' }, description: 'Site-to-site to Hetzner burst VPC' }],
      peerings: [{ id: 'peer-005', networkId: 'net-011', status: 'active', kind: 'vpn' }], createdAt: ago(245 * DAY), tags: enneoTags('dev') },
    { id: 'net-011', name: 'vpc-enneo-burst', ...scope('proj-enneo-intern'), cidr: '10.71.0.0/16', locationId: 'hetzner-nbg1', status: 'available', natGateway: false, dnsZoneId: null, mtu: 1450,
      subnets: [sn('sn-020', 'burst', '10.71.1.0/24', true)],
      routes: [...sysRoutes('10.71.0.0/16', false), { id: 'rt-011', destination: '10.70.0.0/16', target: { type: 'vpn', id: 'net-010' }, description: 'Site-to-site to RZ Magdeburg' }],
      peerings: [{ id: 'peer-005', networkId: 'net-010', status: 'active', kind: 'vpn' }], createdAt: ago(130 * DAY), tags: tags({ env: 'ci', team: 'enneo', burst: 'true' }) },
    { id: 'net-012', name: 'vpc-enneo-prod', ...scope('proj-enneo-regiocom'), cidr: '10.60.0.0/16', locationId: 'dc1', status: 'available', natGateway: true, dnsZoneId: null, mtu: 1450,
      subnets: [sn('sn-021', 'enneo-edge', '10.60.1.0/24', true), sn('sn-022', 'enneo-data', '10.60.2.0/24', false), sn('sn-023', 'enneo-k8s', '10.60.16.0/20', false)],
      routes: sysRoutes('10.60.0.0/16', true), peerings: [], createdAt: ago(238 * DAY), tags: enneoTags('prod'), description: 'Enneo platform for Regiocom — customer data stays in RZ Magdeburg' },
  ];

  const ipPools: IpPool[] = [
    { id: 'pool-dc1', name: 'RZ Magdeburg IPv4', version: 4, cidr: '203.0.113.0/24', locationId: 'dc1', reserved: 8 },
    { id: 'pool-dc1-v6', name: 'RZ Magdeburg IPv6', version: 6, cidr: '2001:db8:4d47::/48', locationId: 'dc1', reserved: 0 },
    { id: 'pool-dc2', name: 'RZ Frankfurt IPv4', version: 4, cidr: '198.51.100.0/24', locationId: 'dc2', reserved: 8 },
    { id: 'pool-dc2-v6', name: 'RZ Frankfurt IPv6', version: 6, cidr: '2001:db8:4652::/48', locationId: 'dc2', reserved: 0 },
    { id: 'pool-hetzner-nbg1', name: 'Hetzner nbg1 IPv4', version: 4, cidr: '192.0.2.0/26', locationId: 'hetzner-nbg1', reserved: 4 },
    { id: 'pool-hetzner-fsn1', name: 'Hetzner fsn1 IPv4', version: 4, cidr: '192.0.2.64/26', locationId: 'hetzner-fsn1', reserved: 4 },
    { id: 'pool-hetzner-hel1', name: 'Hetzner hel1 IPv4', version: 4, cidr: '192.0.2.128/27', locationId: 'hetzner-hel1', reserved: 4 },
    { id: 'pool-aws-euc1', name: 'AWS eu-central-1 Elastic IPs', version: 4, cidr: '192.0.2.160/27', locationId: 'aws-eu-central-1', reserved: 4 },
  ];

  const ipSpec: [string, string, string, string, IpAddress['assignedTo'], string?][] = [
    ['ip-001', '203.0.113.10', 'pool-dc1', 'proj-compass', { type: 'lb', id: 'lb-001' }, 'compass.regiocom-energie.de'],
    ['ip-002', '2001:db8:4d47::10', 'pool-dc1-v6', 'proj-compass', { type: 'lb', id: 'lb-001' }, 'compass.regiocom-energie.de'],
    ['ip-009', '203.0.113.11', 'pool-dc1', 'proj-compass', null],
    ['ip-003', '203.0.113.20', 'pool-dc1', 'proj-orchestrator', { type: 'vm', id: 'vm-006' }, 'mako.regiocom-energie.de'],
    ['ip-004', '203.0.113.21', 'pool-dc1', 'proj-orchestrator', { type: 'lb', id: 'lb-003' }, 'as4.regiocom-energie.de'],
    ['ip-005', '203.0.113.30', 'pool-dc1', 'proj-tools', { type: 'vm', id: 'vm-017' }, 'gitlab.regiocom-energie.de'],
    ['ip-006', '203.0.113.31', 'pool-dc1', 'proj-tools', { type: 'vm', id: 'vm-019' }, 'vpn.regiocom-energie.de'],
    ['ip-007', '203.0.113.40', 'pool-dc1', 'proj-enneo-regiocom', { type: 'lb', id: 'lb-004' }, 'regiocom.enneo.ai'],
    ['ip-008', '203.0.113.41', 'pool-dc1', 'proj-enneo-regiocom', null],
    ['ip-010', '198.51.100.10', 'pool-dc2', 'proj-website', { type: 'lb', id: 'lb-002' }, 'www.regiocom-energie.de'],
    ['ip-011', '2001:db8:4652::10', 'pool-dc2-v6', 'proj-website', { type: 'lb', id: 'lb-002' }, 'www.regiocom-energie.de'],
    ['ip-012', '192.0.2.10', 'pool-hetzner-nbg1', 'proj-enneo-intern', { type: 'vm', id: 'vm-026' }],
    ['ip-013', '192.0.2.11', 'pool-hetzner-nbg1', 'proj-enneo-intern', { type: 'vm', id: 'vm-027' }],
    ['ip-014', '192.0.2.70', 'pool-hetzner-fsn1', 'proj-tools', { type: 'vm', id: 'vm-023' }, 'status.regiocom-energie.de'],
    ['ip-015', '192.0.2.170', 'pool-aws-euc1', 'proj-website', { type: 'vm', id: 'vm-016' }],
  ];
  const ips: IpAddress[] = ipSpec.map(([id, address, poolId, project, assignedTo, rdns], i) => ({
    id, address, version: address.includes(':') ? 6 : 4, poolId, ...scope(project), assignedTo, reverseDns: rdns ?? null,
    createdAt: ago((600 - i * 31) * DAY), tags: [],
  }));

  let rid = 0;
  const r = (direction: FirewallRule['direction'], protocol: FirewallRule['protocol'], ports: string, source: string, action: FirewallRule['action'], priority: number, description: string): FirewallRule =>
    ({ id: `r-${++rid}`, direction, protocol, ports, source, action, priority, description, enabled: true });
  const sshVpn = (p = 110) => r('inbound', 'tcp', '22', VPN, 'allow', p, 'SSH via WireGuard VPN');
  const nodeExp = (p = 120) => r('inbound', 'tcp', '9100', MONITORING, 'allow', p, 'node_exporter scrape (monitoring)');
  const vm = (id: string): Ref => ({ type: 'vm', id });
  const fw = (id: string, name: string, project: string, env: string, description: string, rules: FirewallRule[], attachedTo: Ref[], days: number): Firewall =>
    ({ id, name, ...scope(project), description, defaultInbound: 'deny', defaultOutbound: 'allow', rules, attachedTo, createdAt: ago(days * DAY), tags: project.startsWith('proj-enneo') ? enneoTags(env) : ptags(project, env) });

  const firewalls: Firewall[] = [
    fw('fw-001', 'compass-app', 'proj-compass', 'prod', 'Compass app servers (from compass-lb only)',
      [r('inbound', 'tcp', '8080,8081', '10.10.1.0/24', 'allow', 100, 'HTTP from compass-lb'), r('inbound', 'tcp', '8080', '10.20.16.0/20', 'allow', 105, 'Compass API from Orchestrator'), sshVpn(), nodeExp()],
      [vm('vm-001'), vm('vm-002'), vm('vm-003')], 670),
    fw('fw-002', 'compass-batch', 'proj-compass', 'prod', 'Billing batch workers — no inbound except ops',
      [sshVpn(100), nodeExp(110), r('outbound', 'tcp', '25', '0.0.0.0/0', 'deny', 50, 'No direct SMTP (use mail relay)')],
      [vm('vm-004'), vm('vm-005')], 640),
    fw('fw-003', 'compass-data', 'proj-compass', 'prod', 'PostgreSQL & Redis for Compass',
      [r('inbound', 'tcp', '5432', '10.10.0.0/16', 'allow', 100, 'Postgres from Compass VPC'), r('inbound', 'tcp', '5432', '10.20.16.0/20', 'allow', 105, 'Read access from Orchestrator'), r('inbound', 'tcp', '6379', '10.10.1.0/24', 'allow', 110, 'Redis from app servers')],
      [{ type: 'db', id: 'db-001' }, { type: 'db', id: 'db-002' }], 670),
    fw('fw-004', 'compass-lb', 'proj-compass', 'prod', 'Public HTTPS for compass.regiocom-energie.de',
      [r('inbound', 'tcp', '80,443', '0.0.0.0/0', 'allow', 100, 'HTTP/HTTPS'), r('inbound', 'udp', '443', '0.0.0.0/0', 'allow', 110, 'HTTP/3 QUIC'), r('inbound', 'tcp', '*', '192.0.2.66/32', 'deny', 50, 'Blocked scanner')],
      [{ type: 'lb', id: 'lb-001' }], 660),
    fw('fw-005', 'orchestrator-nodes', 'proj-orchestrator', 'prod', 'Kubernetes nodes of orchestrator-prod',
      [r('inbound', 'tcp', '30000-32767', '10.20.0.0/16', 'allow', 100, 'NodePorts from VPC'), r('inbound', 'tcp', '10250', '10.20.16.0/20', 'allow', 110, 'Kubelet'), nodeExp()],
      [{ type: 'k8s', id: 'k8s-001' }], 520),
    fw('fw-006', 'mako-edge', 'proj-orchestrator', 'prod', 'AS4 & SFTP for market partners (MaKo)',
      [r('inbound', 'tcp', '443', '0.0.0.0/0', 'allow', 100, 'AS4 (mTLS, SM-PKI)'), r('inbound', 'tcp', '22', '0.0.0.0/0', 'allow', 110, 'SFTP market partners (key auth only)'), nodeExp()],
      [vm('vm-006'), { type: 'lb', id: 'lb-003' }], 500),
    fw('fw-007', 'orchestrator-db', 'proj-orchestrator', 'prod', 'Temporal & orchestrator databases',
      [r('inbound', 'tcp', '5432', '10.20.16.0/20', 'allow', 100, 'Postgres from cluster')],
      [{ type: 'db', id: 'db-003' }], 520),
    fw('fw-008', 'sap-isu', 'proj-isu', 'prod', 'SAP IS/U: DIAG, RFC, HTTP, HANA SQL',
      [r('inbound', 'tcp', '3200-3299', VPN, 'allow', 100, 'SAP GUI (DIAG) via VPN'), r('inbound', 'tcp', '3300-3399', '10.20.16.0/20', 'allow', 105, 'RFC / IDoc from Orchestrator'),
        r('inbound', 'tcp', '3300-3399,3600-3699', '10.30.0.0/16', 'allow', 110, 'RFC & message server inside landscape'), r('inbound', 'tcp', '30013-30015', '10.30.2.0/24', 'allow', 115, 'HANA SQL from app servers'),
        r('inbound', 'tcp', '30013-30015', '10.31.0.0/16', 'allow', 118, 'HANA SQL from S4 (migration)'), sshVpn(120), nodeExp(130)],
      [vm('vm-007'), vm('vm-008'), vm('vm-009'), vm('vm-010')], 690),
    fw('fw-009', 'sap-s4', 'proj-s4', 'staging', 'SAP S4 migration system',
      [r('inbound', 'tcp', '3200-3299,3300-3399', VPN, 'allow', 100, 'SAP GUI & RFC via VPN'), r('inbound', 'tcp', '443,8000-8099', VPN, 'allow', 105, 'Fiori via Web Dispatcher'),
        r('inbound', 'tcp', '30013-30015', '10.31.1.0/24', 'allow', 110, 'HANA SQL'), sshVpn(120)],
      [vm('vm-011'), vm('vm-012'), vm('vm-013')], 158),
    fw('fw-010', 'website-web', 'proj-website', 'prod', 'Typo3 web servers & database',
      [r('inbound', 'tcp', '80', '10.40.1.0/24', 'allow', 100, 'HTTP from website-lb'), r('inbound', 'tcp', '3306', '10.40.1.0/24', 'allow', 105, 'MariaDB from web servers'), sshVpn(), nodeExp()],
      [vm('vm-014'), vm('vm-015'), { type: 'db', id: 'db-006' }], 600),
    fw('fw-011', 'website-lb', 'proj-website', 'prod', 'Public web',
      [r('inbound', 'tcp', '80,443', '0.0.0.0/0', 'allow', 100, 'HTTP/HTTPS'), r('inbound', 'udp', '443', '0.0.0.0/0', 'allow', 110, 'HTTP/3 QUIC')],
      [{ type: 'lb', id: 'lb-002' }], 600),
    fw('fw-012', 'website-dr', 'proj-website', 'dr', 'DR standby on AWS',
      [r('inbound', 'tcp', '443', '0.0.0.0/0', 'allow', 100, 'HTTPS (only during failover)'), r('inbound', 'tcp', '22', '203.0.113.31/32', 'allow', 110, 'SSH from vpn-gw')],
      [vm('vm-016')], 180),
    fw('fw-013', 'gitlab', 'proj-tools', 'prod', 'GitLab web & Git over SSH',
      [r('inbound', 'tcp', '443', '0.0.0.0/0', 'allow', 100, 'GitLab web (SSO enforced)'), r('inbound', 'tcp', '22', '10.0.0.0/8', 'allow', 110, 'Git over SSH (internal & VPN)'), nodeExp()],
      [vm('vm-017')], 700),
    fw('fw-014', 'tools-internal', 'proj-tools', 'prod', 'Monitoring, CI runners, backup proxy',
      [r('inbound', 'tcp', '3000,9090,9093', '10.0.0.0/8', 'allow', 100, 'Grafana / Prometheus / Alertmanager'), sshVpn(), nodeExp()],
      [vm('vm-018'), vm('vm-020'), vm('vm-021'), vm('vm-022')], 700),
    fw('fw-015', 'vpn', 'proj-tools', 'prod', 'WireGuard endpoint',
      [r('inbound', 'udp', '51820', '0.0.0.0/0', 'allow', 100, 'WireGuard')],
      [vm('vm-019')], 710),
    fw('fw-016', 'status-page', 'proj-tools', 'prod', 'Public status page',
      [r('inbound', 'tcp', '80,443', '0.0.0.0/0', 'allow', 100, 'HTTP/HTTPS'), r('inbound', 'tcp', '22', '203.0.113.31/32', 'allow', 110, 'SSH from vpn-gw')],
      [vm('vm-023')], 300),
    fw('fw-017', 'enneo-nodes', 'proj-enneo-regiocom', 'prod', 'Kubernetes nodes of enneo-prod',
      [r('inbound', 'tcp', '30000-32767', '10.60.0.0/16', 'allow', 100, 'NodePorts from VPC'), r('inbound', 'tcp', '10250', '10.60.16.0/20', 'allow', 110, 'Kubelet')],
      [{ type: 'k8s', id: 'k8s-002' }], 236),
    fw('fw-018', 'enneo-ingress', 'proj-enneo-regiocom', 'prod', 'Public HTTPS for regiocom.enneo.ai',
      [r('inbound', 'tcp', '80,443', '0.0.0.0/0', 'allow', 100, 'HTTP/HTTPS')],
      [{ type: 'lb', id: 'lb-004' }], 236),
    fw('fw-019', 'enneo-data', 'proj-enneo-regiocom', 'prod', 'PostgreSQL (pgvector) & Redis queue',
      [r('inbound', 'tcp', '5432', '10.60.16.0/20', 'allow', 100, 'Postgres from cluster'), r('inbound', 'tcp', '6379', '10.60.16.0/20', 'allow', 110, 'Redis from cluster')],
      [{ type: 'db', id: 'db-004' }, { type: 'db', id: 'db-005' }], 236),
    fw('fw-020', 'enneo-dev', 'proj-enneo-intern', 'dev', 'Dev VMs & staging cluster',
      [r('inbound', 'tcp', '22', VPN, 'allow', 100, 'SSH via VPN'), r('inbound', 'tcp', '8000', '10.70.0.0/16', 'allow', 110, 'vLLM OpenAI API inside VPC'), r('inbound', 'any', '*', '10.71.0.0/16', 'allow', 120, 'CI runners (burst VPC)'),
        r('inbound', 'tcp', '5432', '10.70.16.0/20', 'allow', 130, 'Postgres from staging cluster')],
      [vm('vm-024'), vm('vm-025'), { type: 'k8s', id: 'k8s-003' }, { type: 'db', id: 'db-007' }], 240),
    fw('fw-021', 'enneo-burst', 'proj-enneo-intern', 'ci', 'Hetzner burst VMs',
      [r('inbound', 'tcp', '22', '10.70.0.0/16', 'allow', 100, 'SSH from RZ Magdeburg (site-to-site)')],
      [vm('vm-026'), vm('vm-027'), vm('vm-028')], 130),
  ];

  let rec = 0;
  const d = (type: DnsRecord['type'], name: string, value: string, ttl = 300, priority?: number, managedBy?: Ref): DnsRecord => ({ id: `rec-${++rec}`, type, name, value, ttl, priority, managedBy: managedBy ?? null });
  const NS = ['ns1.autark.regiocom-energie.de', 'ns2.autark.regiocom-energie.de'];
  const dnsZones: DnsZone[] = [
    { id: 'zone-001', name: 'regiocom-energie.de', ...scope('proj-website'), kind: 'public', networkId: null, dnssec: true, defaultTtl: 3600, serial: 2026110801, nameservers: NS, status: 'active', createdAt: ago(600 * DAY), tags: ptags('proj-website', 'prod'), description: 'Corporate domain',
      dsRecord: 'regiocom-energie.de. 3600 IN DS 31589 13 2 A7C1F0E3B5D2C4A6F8E9D0C1B2A3F4E5D6C7B8A9F0E1D2C3B4A5F6E7D8C9B0A1',
      records: [
        d('A', '@', '198.51.100.10', 300, undefined, { type: 'lb', id: 'lb-002' }), d('AAAA', '@', '2001:db8:4652::10', 300, undefined, { type: 'lb', id: 'lb-002' }),
        d('CNAME', 'www', 'regiocom-energie.de.', 300),
        d('A', 'compass', '203.0.113.10', 300, undefined, { type: 'lb', id: 'lb-001' }), d('AAAA', 'compass', '2001:db8:4d47::10', 300, undefined, { type: 'lb', id: 'lb-001' }),
        d('A', 'mako', '203.0.113.20', 300, undefined, { type: 'vm', id: 'vm-006' }), d('A', 'as4', '203.0.113.21', 300, undefined, { type: 'lb', id: 'lb-003' }),
        d('A', 'gitlab', '203.0.113.30', 300, undefined, { type: 'vm', id: 'vm-017' }), d('A', 'vpn', '203.0.113.31', 300, undefined, { type: 'vm', id: 'vm-019' }),
        d('A', 'status', '192.0.2.70', 300, undefined, { type: 'vm', id: 'vm-023' }),
        d('A', 'mail', '198.51.100.25', 3600),
        d('MX', '@', 'mail.regiocom-energie.de.', 3600, 10), d('MX', '@', 'mx2.regiocom-energie.de.', 3600, 20),
        d('TXT', '@', 'v=spf1 mx ip4:198.51.100.25 -all', 3600),
        d('TXT', '_dmarc', 'v=DMARC1; p=reject; rua=mailto:dmarc@regiocom-energie.de; adkim=s; aspf=s', 3600),
        d('TXT', 'mail._domainkey', 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu8xq2…IDAQAB', 3600),
        d('CAA', '@', '0 issue "letsencrypt.org"', 3600), d('CAA', '@', '0 iodef "mailto:security@regiocom-energie.de"', 3600),
        d('SRV', '_autodiscover._tcp', '0 443 mail.regiocom-energie.de.', 3600, 10),
      ] },
    { id: 'zone-002', name: 'intern.regiocom-energie.de', ...scope('proj-tools'), kind: 'private', networkId: 'net-007', dnssec: false, defaultTtl: 300, serial: 2026110402, nameservers: ['10.50.0.2'], status: 'active', createdAt: ago(700 * DAY), tags: ptags('proj-tools', 'prod'), description: 'Internal names (resolved via VPN)',
      records: [
        d('A', 'gitlab', '10.50.1.10', 60, undefined, { type: 'vm', id: 'vm-017' }), d('A', 'monitoring', '10.50.1.20', 60, undefined, { type: 'vm', id: 'vm-018' }),
        d('CNAME', 'grafana', 'monitoring.intern.regiocom-energie.de.', 60), d('CNAME', 'prometheus', 'monitoring.intern.regiocom-energie.de.', 60),
        d('A', 'vpn', '10.50.1.5', 60), d('A', 'runner-1', '10.51.1.11', 60), d('A', 'runner-2', '10.51.1.12', 60), d('A', 'backup', '10.51.1.20', 60),
        d('A', 'isu', '10.30.2.10', 60), d('A', 's4', '10.31.10.10', 60),
      ] },
    { id: 'zone-003', name: 'regiocom.enneo.ai', ...scope('proj-enneo-regiocom'), kind: 'public', networkId: null, dnssec: true, defaultTtl: 3600, serial: 2026110301, nameservers: NS, status: 'active', createdAt: ago(236 * DAY), tags: enneoTags('prod'), description: 'Delegated from enneo.ai',
      dsRecord: 'regiocom.enneo.ai. 3600 IN DS 50211 13 2 3B9E1C77D0A4F2E8B6C5D4A3F2E1D0C9B8A7F6E5D4C3B2A1F0E9D8C7B6A5F4E3',
      records: [
        d('A', '@', '203.0.113.40', 300, undefined, { type: 'lb', id: 'lb-004' }), d('CNAME', 'api', 'regiocom.enneo.ai.', 300),
        d('CAA', '@', '0 issue "letsencrypt.org"', 3600), d('TXT', '@', 'v=spf1 include:regiocom-energie.de -all', 3600),
      ] },
    { id: 'zone-004', name: 'compass.internal', ...scope('proj-compass'), kind: 'private', networkId: 'net-001', dnssec: false, defaultTtl: 300, serial: 2026110501, nameservers: ['10.10.0.2'], status: 'active', createdAt: ago(670 * DAY), tags: ptags('proj-compass', 'prod'), description: 'Service discovery inside vpc-compass',
      records: [
        d('A', 'db', '10.10.2.50', 60, undefined, { type: 'db', id: 'db-001' }), d('A', 'cache', '10.10.2.60', 60, undefined, { type: 'db', id: 'db-002' }),
        d('A', 'app-1', '10.10.1.11', 60, undefined, { type: 'vm', id: 'vm-001' }), d('A', 'app-2', '10.10.1.12', 60, undefined, { type: 'vm', id: 'vm-002' }), d('A', 'app-3', '10.10.1.13', 60, undefined, { type: 'vm', id: 'vm-003' }),
        d('A', 'billing-1', '10.10.3.11', 60), d('A', 'billing-2', '10.10.3.12', 60),
      ] },
    { id: 'zone-005', name: 'regiocom-energie.com', ...scope('proj-website'), kind: 'public', networkId: null, dnssec: false, defaultTtl: 3600, serial: 2026110701, nameservers: NS, status: 'pending-delegation', createdAt: ago(1 * DAY), tags: ptags('proj-website', 'prod'), description: 'Defensive registration — redirects to regiocom-energie.de',
      records: [d('A', '@', '198.51.100.10', 300), d('CNAME', 'www', 'regiocom-energie.com.', 300)] },
  ];

  return { networks, ipPools, ips, firewalls, dnsZones };
}
