import type { BareMetalHost, CloudProvider } from '@/types';
import { ago, tags, DAY, HOUR } from './util';

const DISK_MODEL: Record<string, string> = { nvme: 'Samsung PM9A3', ssd: 'Micron 5400 PRO', hdd: 'Seagate Exos X16' };
const FW: Record<string, { bios: string; bmc: string; bmcOld: string }> = {
  Dell: { bios: '2.19.1', bmc: 'iDRAC 7.00.30', bmcOld: 'iDRAC 6.10.80' },
  Supermicro: { bios: '3.9', bmc: 'BMC 1.74.11', bmcOld: 'BMC 1.71.02' },
  HPE: { bios: 'U30 v2.90', bmc: 'iLO 5 3.04', bmcOld: 'iLO 5 2.81' },
  Lenovo: { bios: 'KAE118J', bmc: 'XCC 4.20', bmcOld: 'XCC 3.80' },
};

type HostSpec = [id: string, name: string, loc: string, rack: string, u: number, sizeU: number, vendor: string, model: string, cpu: string, sockets: number, cores: number, ramGB: number,
  disks: [BareMetalHost['disks'][number]['type'], number][], gpus: { model: string; count: number }[], status: BareMetalHost['status'], extra?: Partial<BareMetalHost>];

const HOSTS: HostSpec[] = [
  ['bm-001', 'dc1-hv-01', 'dc1', 'R12', 30, 2, 'Dell', 'PowerEdge R740', '2× Intel Xeon E5-2690 v4', 2, 28, 256, [['ssd', 1920], ['nvme', 1920]], [{ model: 'A6000', count: 2 }], 'ready'],
  ['bm-002', 'dc1-hv-02', 'dc1', 'R12', 27, 2, 'Dell', 'PowerEdge R640', 'Intel Xeon Gold 6230', 1, 20, 256, [['ssd', 1920], ['ssd', 1920]], [], 'ready'],
  ['bm-003', 'dc1-db-01', 'dc1', 'R12', 24, 2, 'Supermicro', 'SYS-2029U', 'Intel Xeon Silver 4210', 1, 10, 128, [['nvme', 3840], ['nvme', 3840]], [], 'ready'],
  ['bm-009', 'dc1-hv-04', 'dc1', 'R12', 20, 2, 'Dell', 'PowerEdge R650', '2× Intel Xeon Gold 6338', 2, 64, 512, [['nvme', 3840], ['nvme', 3840]], [], 'maintenance', { tags: tags({ ticket: 'OPS-1182' }) }],
  ['bm-005', 'dc1-hv-03', 'dc1', 'R13', 34, 2, 'HPE', 'ProLiant DL380 Gen10', 'Intel Xeon Gold 6226R', 1, 16, 192, [['ssd', 960], ['ssd', 960]], [], 'ready'],
  ['bm-006', 'dc1-edge-01', 'dc1', 'R13', 40, 1, 'Supermicro', 'SYS-5019C', 'Intel Xeon E-2278G', 1, 8, 64, [['nvme', 960]], [], 'ready'],
  ['bm-008', 'dc1-gpu-01', 'dc1', 'R13', 20, 4, 'Supermicro', 'SYS-4029GP-TRT', '2× Intel Xeon Gold 6248R', 2, 48, 384, [['nvme', 3840], ['nvme', 3840], ['ssd', 7680]], [{ model: 'A6000', count: 4 }], 'ready'],
  ['bm-010', 'dc1-stor-01', 'dc1', 'R13', 10, 4, 'Supermicro', 'SSG-6049P', 'Intel Xeon Silver 4214', 1, 12, 192, [['hdd', 16000], ['hdd', 16000], ['hdd', 16000], ['hdd', 16000], ['nvme', 1920]], [], 'ready', { hypervisor: 'none', tags: tags({ role: 'ceph-osd' }) }],
  ['bm-004', 'dc2-hv-01', 'dc2', 'B3', 30, 2, 'Dell', 'PowerEdge R7525', 'AMD EPYC 7502P', 1, 32, 512, [['nvme', 3840], ['nvme', 3840]], [], 'ready'],
  ['bm-011', 'dc2-hv-02', 'dc2', 'B3', 27, 2, 'Dell', 'PowerEdge R7525', 'AMD EPYC 7513', 1, 32, 512, [['nvme', 3840], ['nvme', 3840]], [], 'ready'],
  ['bm-007', 'dc2-hv-03', 'dc2', 'B3', 24, 2, 'Dell', 'PowerEdge R7625', 'AMD EPYC 9354', 1, 32, 768, [['nvme', 7680], ['nvme', 7680]], [], 'provisioning'],
  ['bm-012', 'dc2-hv-04', 'dc2', 'B4', 30, 2, 'Lenovo', 'ThinkSystem SR655', 'AMD EPYC 7443P', 1, 24, 256, [['nvme', 1920], ['nvme', 1920]], [], 'offline', { tags: tags({ incident: 'PSU-2' }) }],
];

export function seedHardware() {
  const hosts: BareMetalHost[] = HOSTS.map(([id, name, locationId, rack, rackUnit, sizeU, vendor, model, cpuModel, sockets, cpuCores, ramGB, disks, gpus, status, extra], i) => ({
    id, name, locationId, rack, rackUnit, sizeU, vendor, model, serial: `${vendor.slice(0, 2).toUpperCase()}${(731_000 + i * 7919).toString(36).toUpperCase()}`,
    cpuModel, sockets, cpuCores, threads: cpuCores * 2, ramGB,
    disks: disks.map(([type, sizeGB], j) => ({
      slot: `${type === 'nvme' ? 'nvme' : 'sd'}${j}`, type, sizeGB, health: (id === 'bm-012' && j === 1) || (id === 'bm-003' && j === 1) ? 'warning' : 'ok',
      wearPct: type === 'hdd' ? 0 : id === 'bm-003' && j === 1 ? 87 : 4 + ((i * 7 + j * 11) % 30), model: DISK_MODEL[type], powerOnHours: 9_000 + i * 1_700 + j * 310,
      reallocatedSectors: id === 'bm-012' && j === 1 ? 24 : 0, tempC: type === 'hdd' ? 34 : 38 + ((i + j) % 9),
    })),
    nics: [
      { name: 'eno1', speedGbps: 25, mac: `3c:ec:ef:${(10 + i).toString(16)}:a1:01`, link: status === 'offline' ? 'down' : 'up', role: 'data', mtu: 9000 },
      { name: 'eno2', speedGbps: 25, mac: `3c:ec:ef:${(10 + i).toString(16)}:a1:02`, link: status === 'offline' ? 'down' : 'up', role: 'storage', mtu: 9000 },
      { name: vendor === 'Dell' ? 'idrac' : vendor === 'HPE' ? 'ilo' : 'ipmi', speedGbps: 1, mac: `3c:ec:ef:${(10 + i).toString(16)}:a1:ff`, link: 'up', role: 'bmc', mtu: 1500 },
    ],
    bmcUser: vendor === 'Dell' ? 'root' : 'ADMIN', bmcCredential: '••••••••',
    firmware: { bios: FW[vendor]?.bios ?? '2.1.0', bmc: i % 4 === 0 ? FW[vendor]?.bmcOld ?? '1.0.0' : FW[vendor]?.bmc ?? '1.2.0', nic: '22.39.10' },
    maintenanceReason: status === 'maintenance' ? 'Replacing DIMM B3 (correctable ECC errors), ticket OPS-1182' : null,
    lastHealthCheck: status === 'provisioning' ? null : {
      at: ago((2 + i) * HOUR), result: status === 'offline' ? 'failed' : id === 'bm-003' || id === 'bm-009' ? 'warnings' : 'passed',
      checks: [
        { name: 'BMC sensors', status: status === 'offline' ? 'failed' : 'ok', detail: status === 'offline' ? 'PSU 2: no input power' : 'All sensors within thresholds' },
        { name: 'Memory (ECC)', status: id === 'bm-009' ? 'warning' : 'ok', detail: id === 'bm-009' ? '412 correctable errors on DIMM B3 in 24h' : 'No ECC errors in 24h' },
        { name: 'Disks (SMART)', status: id === 'bm-003' ? 'warning' : 'ok', detail: id === 'bm-003' ? 'nvme1 wear level 87%' : 'All disks healthy' },
        { name: 'Network links', status: status === 'offline' ? 'failed' : 'ok', detail: status === 'offline' ? 'eno1/eno2 link down' : 'All links up at negotiated speed' },
        { name: 'Agent heartbeat', status: status === 'offline' ? 'failed' : 'ok', detail: status === 'offline' ? 'Last heartbeat 5h ago' : 'Heartbeat 2s ago' },
      ],
    },
    gpus, hypervisor: 'KVM', bmcIp: `10.0.${locationId === 'dc1' ? 0 : 1}.${110 + i}`, mgmtIp: `10.0.${locationId === 'dc1' ? 0 : 1}.${10 + i}`, status,
    cpuOvercommit: 2, ramOvercommit: 1, agentVersion: status === 'provisioning' ? '—' : i % 4 === 0 ? '0.9.2' : '0.9.4', kernel: '6.8.0-48-generic',
    bootedAt: ago((20 + i * 3) * DAY), createdAt: ago((400 - i * 20) * DAY), tags: [], powerWatts: status === 'offline' ? 0 : 180 + cpuCores * 6 + gpus.reduce((a, g) => a + g.count * 240, 0),
    ...extra,
  }));

  const providers: CloudProvider[] = [
    { id: 'provider-hetzner', name: 'Hetzner Cloud', kind: 'hetzner', status: 'connected', regions: ['nbg1', 'hel1', 'ash'],
      availableRegions: [
        { code: 'nbg1', name: 'Nuremberg', city: 'Nuremberg', country: 'DE', lat: 49.45, lon: 11.08 }, { code: 'fsn1', name: 'Falkenstein', city: 'Falkenstein', country: 'DE', lat: 50.48, lon: 12.37 },
        { code: 'hel1', name: 'Helsinki', city: 'Helsinki', country: 'FI', lat: 60.17, lon: 24.94 }, { code: 'ash', name: 'Ashburn, VA', city: 'Ashburn', country: 'US', lat: 39.04, lon: -77.49 },
        { code: 'hil', name: 'Hillsboro, OR', city: 'Hillsboro', country: 'US', lat: 45.52, lon: -122.99 }, { code: 'sin', name: 'Singapore', city: 'Singapore', country: 'SG', lat: 1.35, lon: 103.82 },
      ],
      credentials: { label: 'API token', masked: 'hzr_••••••••abcd', lastRotatedAt: ago(40 * DAY) }, quotas: { vcpus: 400, ramGB: 1600, vms: 100, ips: 200 },
      lastSyncAt: ago(3 * 60_000), lastError: null, allowedServices: ['vm', 'volume', 'network', 'ip'], createdAt: ago(200 * DAY), tags: tags({ tier: 'burst' }) },
    { id: 'provider-aws', name: 'AWS (EC2 only)', kind: 'aws', status: 'connected', regions: ['eu-central-1', 'eu-west-1'],
      availableRegions: [
        { code: 'eu-central-1', name: 'Frankfurt', city: 'Frankfurt', country: 'DE', lat: 50.0, lon: 8.9 }, { code: 'eu-west-1', name: 'Ireland', city: 'Dublin', country: 'IE', lat: 53.35, lon: -6.26 },
        { code: 'eu-north-1', name: 'Stockholm', city: 'Stockholm', country: 'SE', lat: 59.33, lon: 18.07 }, { code: 'us-east-1', name: 'N. Virginia', city: 'Ashburn', country: 'US', lat: 38.9, lon: -77.3 },
      ],
      credentials: { label: 'Access key + role ARN', masked: 'AKIA••••••••XYZ0', lastRotatedAt: ago(85 * DAY) }, quotas: { vcpus: 256, ramGB: 1024, vms: 50, ips: 20 },
      lastSyncAt: ago(8 * 60_000), lastError: null, allowedServices: ['vm', 'volume', 'ip'], createdAt: ago(150 * DAY), tags: tags({ tier: 'dr' }) },
    { id: 'provider-ovh', name: 'OVHcloud', kind: 'ovh', status: 'error', regions: ['GRA'],
      availableRegions: [
        { code: 'GRA', name: 'Gravelines', city: 'Gravelines', country: 'FR', lat: 50.99, lon: 2.13 }, { code: 'SBG', name: 'Strasbourg', city: 'Strasbourg', country: 'FR', lat: 48.57, lon: 7.75 },
        { code: 'WAW', name: 'Warsaw', city: 'Warsaw', country: 'PL', lat: 52.23, lon: 21.01 },
      ],
      credentials: { label: 'Application key', masked: 'ovh_••••••••7f1e', lastRotatedAt: ago(370 * DAY) }, quotas: { vcpus: 128, ramGB: 512, vms: 30, ips: 16 },
      lastSyncAt: ago(30 * 60_000), lastError: 'Authentication failed: application key expired', allowedServices: ['vm', 'volume', 'network', 'ip'], createdAt: ago(380 * DAY), tags: [], lastTestAt: ago(30 * 60_000) },
  ];
  return { hosts, providers };
}
