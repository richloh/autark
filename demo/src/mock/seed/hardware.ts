import type { BareMetalHost, CloudProvider, HostAccess, HostRole } from '@/types';
import { ago, tags, DAY, HOUR, MIN } from './util';

const DISK_MODEL: Record<string, string> = { nvme: 'Samsung PM9A3', ssd: 'Micron 5400 PRO', hdd: 'Seagate Exos X18' };
const FW: Record<string, { bios: string; bmc: string; bmcOld: string }> = {
  Dell: { bios: '2.3.5', bmc: 'iDRAC9 7.10.50', bmcOld: 'iDRAC9 6.10.80' },
  Supermicro: { bios: '2.1', bmc: 'BMC 1.05.12', bmcOld: 'BMC 1.02.04' },
  HPE: { bios: 'U54 v2.16', bmc: 'iLO 6 1.62', bmcOld: 'iLO 6 1.55' },
  Lenovo: { bios: 'ESE122T', bmc: 'XCC2 3.10', bmcOld: 'XCC2 2.40' },
};

type Disk = [type: BareMetalHost['disks'][number]['type'], sizeGB: number, count?: number];
interface HostSpec {
  id: string; name: string; loc: 'dc1' | 'dc2'; rack: string; u: number; sizeU: number; vendor: string; model: string; cpu: string; sockets: number; cores: number; ramGB: number;
  disks: Disk[]; gpus?: { model: string; count: number }[]; status: BareMetalHost['status']; roles: HostRole[]; access?: HostAccess; cpuOvercommit?: number;
  hypervisor?: BareMetalHost['hypervisor']; nicGbps?: number; extra?: Partial<BareMetalHost>;
}

const ALL: HostAccess = { mode: 'all', accountIds: [], projectIds: [] };
const SAP_ONLY: HostAccess = { mode: 'restricted', accountIds: [], projectIds: ['proj-isu', 'proj-s4'] };

/* RZ Magdeburg (dc1) — own datacenter, rows A/B. RZ Frankfurt (dc2) — colocation cage near DE-CIX, own hardware. */
const HOSTS: HostSpec[] = [
  // dc1 · general purpose hypervisors (compute + Kubernetes workers)
  { id: 'bm-001', name: 'mdg-hv-01', loc: 'dc1', rack: 'A01', u: 30, sizeU: 2, vendor: 'Dell', model: 'PowerEdge R760', cpu: '2× Intel Xeon Gold 6430', sockets: 2, cores: 64, ramGB: 1024,
    disks: [['nvme', 3840, 4]], status: 'ready', roles: ['compute', 'k8s-worker'], access: ALL },
  { id: 'bm-002', name: 'mdg-hv-02', loc: 'dc1', rack: 'A01', u: 27, sizeU: 2, vendor: 'Dell', model: 'PowerEdge R760', cpu: '2× Intel Xeon Gold 6430', sockets: 2, cores: 64, ramGB: 1024,
    disks: [['nvme', 3840, 4]], status: 'ready', roles: ['compute', 'k8s-worker', 'k8s-control-plane'], access: ALL },
  { id: 'bm-003', name: 'mdg-hv-03', loc: 'dc1', rack: 'A02', u: 30, sizeU: 2, vendor: 'Dell', model: 'PowerEdge R760', cpu: '2× Intel Xeon Gold 6430', sockets: 2, cores: 64, ramGB: 1024,
    disks: [['nvme', 3840, 4]], status: 'ready', roles: ['compute', 'k8s-worker', 'k8s-control-plane'], access: ALL },
  { id: 'bm-004', name: 'mdg-hv-04', loc: 'dc1', rack: 'A02', u: 27, sizeU: 2, vendor: 'HPE', model: 'ProLiant DL380 Gen11', cpu: '2× Intel Xeon Gold 6448Y', sockets: 2, cores: 64, ramGB: 1024,
    disks: [['nvme', 3840, 4]], status: 'maintenance', roles: ['compute', 'k8s-worker'], access: ALL, extra: { tags: tags({ ticket: 'OPS-1182' }) } },
  { id: 'bm-005', name: 'mdg-hv-05', loc: 'dc1', rack: 'A02', u: 24, sizeU: 2, vendor: 'Lenovo', model: 'ThinkSystem SR650 V3', cpu: '2× Intel Xeon Gold 5418Y', sockets: 2, cores: 48, ramGB: 512,
    disks: [['nvme', 1920, 2], ['ssd', 3840, 2]], status: 'ready', roles: ['k8s-control-plane', 'compute'], access: ALL,
    extra: { notes: 'Runs Kubernetes control planes (etcd on local NVMe) plus small infrastructure VMs.' } },
  // dc1 · SAP HANA certified large-memory hosts — reserved for SAP IS/U and SAP S4
  { id: 'bm-006', name: 'mdg-sap-01', loc: 'dc1', rack: 'A03', u: 28, sizeU: 2, vendor: 'Dell', model: 'PowerEdge R760', cpu: '2× Intel Xeon Platinum 8468', sockets: 2, cores: 96, ramGB: 1536,
    disks: [['nvme', 7680, 4], ['ssd', 960, 2]], status: 'ready', roles: ['compute'], access: SAP_ONLY, cpuOvercommit: 1,
    extra: { tags: tags({ certification: 'SAP HANA TDI' }), notes: 'SAP HANA TDI certified. No CPU overcommit. Reserved for SAP IS/U and SAP S4.' } },
  { id: 'bm-007', name: 'mdg-sap-02', loc: 'dc1', rack: 'A03', u: 24, sizeU: 2, vendor: 'HPE', model: 'ProLiant DL380 Gen11', cpu: '2× Intel Xeon Platinum 8468', sockets: 2, cores: 96, ramGB: 1536,
    disks: [['nvme', 7680, 4], ['ssd', 960, 2]], status: 'ready', roles: ['compute'], access: SAP_ONLY, cpuOvercommit: 1,
    extra: { tags: tags({ certification: 'SAP HANA TDI' }), notes: 'SAP HANA TDI certified. No CPU overcommit. Reserved for SAP IS/U and SAP S4.' } },
  // dc1 · GPU hosts — shared GPU pool: runs the Autark copilot model, remaining GPUs available to every project as GPU VMs
  { id: 'bm-008', name: 'mdg-gpu-01', loc: 'dc1', rack: 'A04', u: 20, sizeU: 4, vendor: 'Supermicro', model: 'SYS-421GE-TNRT', cpu: '2× Intel Xeon Gold 6448Y', sockets: 2, cores: 64, ramGB: 1024,
    disks: [['nvme', 7680, 2], ['nvme', 3840, 2]], gpus: [{ model: 'L40S', count: 4 }], status: 'ready', roles: ['compute'], access: ALL, cpuOvercommit: 1,
    extra: { tags: tags({ pool: 'gpu' }), notes: 'Serves the Autark copilot model (Llama 3.3 70B via vLLM, 2× L40S). The remaining GPUs are open to all projects as GPU VMs (G-series presets).' } },
  { id: 'bm-009', name: 'mdg-gpu-02', loc: 'dc1', rack: 'A04', u: 14, sizeU: 4, vendor: 'Supermicro', model: 'SYS-4029GP-TRT', cpu: '2× Intel Xeon Gold 6248R', sockets: 2, cores: 48, ramGB: 512,
    disks: [['nvme', 3840, 2], ['ssd', 7680]], gpus: [{ model: 'L40S', count: 4 }], status: 'ready', roles: ['compute'], access: ALL, cpuOvercommit: 1,
    extra: { tags: tags({ pool: 'gpu' }), notes: 'Shared GPU capacity for all projects (GPU VMs). Currently idle.' } },
  // dc1 · Ceph storage nodes (block volumes + object storage)
  { id: 'bm-010', name: 'mdg-stor-01', loc: 'dc1', rack: 'B01', u: 10, sizeU: 4, vendor: 'Supermicro', model: 'SSG-640P-E1CR36H', cpu: 'Intel Xeon Silver 4314', sockets: 1, cores: 16, ramGB: 256,
    disks: [['hdd', 18000, 12], ['nvme', 3840, 2]], status: 'ready', roles: ['storage'], hypervisor: 'none', extra: { tags: tags({ ceph: 'osd' }) } },
  { id: 'bm-011', name: 'mdg-stor-02', loc: 'dc1', rack: 'B01', u: 4, sizeU: 4, vendor: 'Supermicro', model: 'SSG-640P-E1CR36H', cpu: 'Intel Xeon Silver 4314', sockets: 1, cores: 16, ramGB: 256,
    disks: [['hdd', 18000, 12], ['nvme', 3840, 2]], status: 'ready', roles: ['storage'], hypervisor: 'none', extra: { tags: tags({ ceph: 'osd' }) } },
  // dc1 · edge / load balancer hosts (anycast, 100G uplinks)
  { id: 'bm-012', name: 'mdg-edge-01', loc: 'dc1', rack: 'B02', u: 40, sizeU: 1, vendor: 'Supermicro', model: 'SYS-111C-NR', cpu: 'Intel Xeon Gold 6326', sockets: 1, cores: 16, ramGB: 128,
    disks: [['nvme', 960, 2]], status: 'ready', roles: ['load-balancer'], nicGbps: 100 },
  { id: 'bm-013', name: 'mdg-edge-02', loc: 'dc1', rack: 'B02', u: 39, sizeU: 1, vendor: 'Supermicro', model: 'SYS-111C-NR', cpu: 'Intel Xeon Gold 6326', sockets: 1, cores: 16, ramGB: 128,
    disks: [['nvme', 960, 2]], status: 'ready', roles: ['load-balancer'], nicGbps: 100 },
  // dc2 · RZ Frankfurt (colocation, own hardware)
  { id: 'bm-014', name: 'fra-hv-01', loc: 'dc2', rack: 'K12', u: 30, sizeU: 2, vendor: 'Dell', model: 'PowerEdge R7625', cpu: '2× AMD EPYC 9354', sockets: 2, cores: 64, ramGB: 768,
    disks: [['nvme', 3840, 4]], status: 'ready', roles: ['compute', 'k8s-worker', 'k8s-control-plane'], access: ALL },
  { id: 'bm-015', name: 'fra-hv-02', loc: 'dc2', rack: 'K12', u: 27, sizeU: 2, vendor: 'Dell', model: 'PowerEdge R7625', cpu: '2× AMD EPYC 9354', sockets: 2, cores: 64, ramGB: 768,
    disks: [['nvme', 3840, 4]], status: 'ready', roles: ['compute', 'k8s-worker', 'k8s-control-plane'], access: ALL },
  { id: 'bm-016', name: 'fra-hv-03', loc: 'dc2', rack: 'K12', u: 24, sizeU: 2, vendor: 'Lenovo', model: 'ThinkSystem SR655 V3', cpu: 'AMD EPYC 9454P', sockets: 1, cores: 48, ramGB: 512,
    disks: [['nvme', 3840, 2]], status: 'ready', roles: ['compute', 'k8s-worker'], access: ALL },
  { id: 'bm-017', name: 'fra-hv-04', loc: 'dc2', rack: 'K13', u: 30, sizeU: 2, vendor: 'Lenovo', model: 'ThinkSystem SR655', cpu: 'AMD EPYC 7443P', sockets: 1, cores: 24, ramGB: 256,
    disks: [['nvme', 1920, 2]], status: 'offline', roles: ['compute', 'k8s-worker'], access: ALL, extra: { tags: tags({ incident: 'PSU-2' }) } },
  { id: 'bm-018', name: 'fra-stor-01', loc: 'dc2', rack: 'K13', u: 10, sizeU: 4, vendor: 'Supermicro', model: 'SSG-640P-E1CR36H', cpu: 'Intel Xeon Silver 4314', sockets: 1, cores: 16, ramGB: 256,
    disks: [['hdd', 18000, 12], ['nvme', 3840, 2]], status: 'ready', roles: ['storage'], hypervisor: 'none', extra: { tags: tags({ ceph: 'osd' }) } },
];

export function seedHardware() {
  const hosts: BareMetalHost[] = HOSTS.map((s, i) => {
    const { id, name, loc: locationId, vendor, status } = s;
    const gpus = s.gpus ?? [];
    const disks = s.disks.flatMap(([type, sizeGB, count = 1]) => Array.from({ length: count }, () => ({ type, sizeGB })));
    const offline = status === 'offline';
    const dcOct = locationId === 'dc1' ? 0 : 1;
    const nicGbps = s.nicGbps ?? 25;
    return {
      id, name, locationId, rack: s.rack, rackUnit: s.u, sizeU: s.sizeU, vendor, model: s.model,
      serial: `${vendor.slice(0, 2).toUpperCase()}${(731_000 + i * 7919).toString(36).toUpperCase()}`,
      cpuModel: s.cpu, sockets: s.sockets, cpuCores: s.cores, threads: s.cores * 2, ramGB: s.ramGB,
      disks: disks.map(({ type, sizeGB }, j) => {
        const warnNvme = id === 'bm-003' && j === 1; // worn NVMe
        const warnHdd = id === 'bm-011' && j === 7; // HDD with reallocated sectors
        const warnOffline = id === 'bm-017' && j === 1;
        return {
          slot: `${type === 'nvme' ? 'nvme' : 'sd'}${j}`, type, sizeGB, health: warnNvme || warnHdd || warnOffline ? 'warning' as const : 'ok' as const,
          wearPct: type === 'hdd' ? 0 : warnNvme ? 87 : 3 + ((i * 7 + j * 11) % 28), model: DISK_MODEL[type], powerOnHours: 6_000 + i * 1_300 + j * 310,
          reallocatedSectors: warnHdd ? 48 : warnOffline ? 24 : 0, tempC: type === 'hdd' ? 33 + (j % 4) : 37 + ((i + j) % 9),
        };
      }),
      nics: [
        { name: 'ens1f0', speedGbps: nicGbps, mac: `b4:96:91:${(16 + i).toString(16)}:a1:01`, link: offline ? 'down' as const : 'up' as const, role: 'data' as const, mtu: 9000 },
        { name: 'ens1f1', speedGbps: nicGbps, mac: `b4:96:91:${(16 + i).toString(16)}:a1:02`, link: offline ? 'down' as const : 'up' as const, role: 'storage' as const, mtu: 9000 },
        { name: vendor === 'Dell' ? 'idrac' : vendor === 'HPE' ? 'ilo' : vendor === 'Lenovo' ? 'xcc' : 'ipmi', speedGbps: 1, mac: `b4:96:91:${(16 + i).toString(16)}:a1:ff`, link: 'up' as const, role: 'bmc' as const, mtu: 1500 },
      ],
      bmcUser: vendor === 'Dell' ? 'root' : vendor === 'Lenovo' ? 'USERID' : 'ADMIN', bmcCredential: '••••••••',
      firmware: { bios: FW[vendor]?.bios ?? '2.1.0', bmc: i % 5 === 3 ? FW[vendor]?.bmcOld ?? '1.0.0' : FW[vendor]?.bmc ?? '1.2.0', nic: '22.41.10' },
      maintenanceReason: status === 'maintenance' ? 'Replacing DIMM B3 (correctable ECC errors), ticket OPS-1182. VMs were live-migrated to mdg-hv-01..03.' : null,
      lastHealthCheck: {
        at: ago((1 + (i % 6)) * HOUR + i * 7 * MIN), result: offline ? 'failed' : id === 'bm-003' || id === 'bm-004' || id === 'bm-011' ? 'warnings' : 'passed',
        checks: [
          { name: 'BMC sensors', status: offline ? 'failed' : 'ok', detail: offline ? 'PSU 2: no input power' : 'All sensors within thresholds' },
          { name: 'Memory (ECC)', status: id === 'bm-004' ? 'warning' : 'ok', detail: id === 'bm-004' ? '412 correctable errors on DIMM B3 in 24h' : 'No ECC errors in 24h' },
          { name: 'Disks (SMART)', status: id === 'bm-003' || id === 'bm-011' ? 'warning' : 'ok', detail: id === 'bm-003' ? 'nvme1 wear level 87%' : id === 'bm-011' ? 'sd7: 48 reallocated sectors (Ceph OSD.31 marked for replacement)' : 'All disks healthy' },
          { name: 'Network links', status: offline ? 'failed' : 'ok', detail: offline ? 'ens1f0/ens1f1 link down' : 'All links up at negotiated speed' },
          { name: 'Agent heartbeat', status: offline ? 'failed' : 'ok', detail: offline ? 'Last heartbeat 5h ago' : 'Heartbeat 2s ago' },
        ],
      },
      gpus, hypervisor: s.hypervisor ?? 'KVM', bmcIp: `10.0.${dcOct}.${110 + i}`, mgmtIp: `10.0.${dcOct}.${10 + i}`, status,
      cpuOvercommit: s.cpuOvercommit ?? 2, ramOvercommit: 1, agentVersion: i % 5 === 3 ? '0.9.2' : '0.9.4', kernel: '6.8.0-48-generic',
      bootedAt: ago((12 + i * 3) * DAY), createdAt: ago((720 - i * 25) * DAY), tags: [],
      powerWatts: offline ? 0 : Math.round(160 + s.cores * 5.5 + gpus.reduce((a, g) => a + g.count * (g.model === 'L40S' ? 290 : 240), 0) + disks.filter((d) => d.type === 'hdd').length * 8),
      roles: s.roles, access: s.access ?? ALL,
      ...s.extra,
    } satisfies BareMetalHost;
  });

  const providers: CloudProvider[] = [
    { id: 'provider-hetzner', name: 'Hetzner Cloud', kind: 'hetzner', status: 'connected', regions: ['nbg1', 'fsn1', 'hel1'],
      availableRegions: [
        { code: 'nbg1', name: 'Nuremberg', city: 'Nuremberg', country: 'DE', lat: 49.45, lon: 11.08 }, { code: 'fsn1', name: 'Falkenstein', city: 'Falkenstein', country: 'DE', lat: 50.48, lon: 12.37 },
        { code: 'hel1', name: 'Helsinki', city: 'Helsinki', country: 'FI', lat: 60.17, lon: 24.94 }, { code: 'ash', name: 'Ashburn, VA', city: 'Ashburn', country: 'US', lat: 39.04, lon: -77.49 },
        { code: 'hil', name: 'Hillsboro, OR', city: 'Hillsboro', country: 'US', lat: 45.52, lon: -122.99 }, { code: 'sin', name: 'Singapore', city: 'Singapore', country: 'SG', lat: 1.35, lon: 103.82 },
      ],
      credentials: { label: 'API token', masked: 'hzr_••••••••4e2d', lastRotatedAt: ago(40 * DAY) }, quotas: { vcpus: 400, ramGB: 1600, vms: 100, ips: 200 },
      lastSyncAt: ago(3 * MIN), lastError: null, allowedServices: ['vm', 'volume', 'network', 'ip'], createdAt: ago(260 * DAY), tags: tags({ tier: 'burst' }) },
    { id: 'provider-aws', name: 'AWS (EC2 only)', kind: 'aws', status: 'connected', regions: ['eu-central-1'],
      availableRegions: [
        { code: 'eu-central-1', name: 'Frankfurt', city: 'Frankfurt', country: 'DE', lat: 50.0, lon: 8.9 }, { code: 'eu-west-1', name: 'Ireland', city: 'Dublin', country: 'IE', lat: 53.35, lon: -6.26 },
        { code: 'eu-north-1', name: 'Stockholm', city: 'Stockholm', country: 'SE', lat: 59.33, lon: 18.07 }, { code: 'us-east-1', name: 'N. Virginia', city: 'Ashburn', country: 'US', lat: 38.9, lon: -77.3 },
      ],
      credentials: { label: 'Access key + role ARN', masked: 'AKIA••••••••R3GE', lastRotatedAt: ago(85 * DAY) }, quotas: { vcpus: 128, ramGB: 512, vms: 20, ips: 10 },
      lastSyncAt: ago(8 * MIN), lastError: null, allowedServices: ['vm', 'volume', 'ip'], createdAt: ago(190 * DAY), tags: tags({ tier: 'dr' }) },
    { id: 'provider-ovh', name: 'OVHcloud', kind: 'ovh', status: 'error', regions: ['GRA'],
      availableRegions: [
        { code: 'GRA', name: 'Gravelines', city: 'Gravelines', country: 'FR', lat: 50.99, lon: 2.13 }, { code: 'SBG', name: 'Strasbourg', city: 'Strasbourg', country: 'FR', lat: 48.57, lon: 7.75 },
        { code: 'WAW', name: 'Warsaw', city: 'Warsaw', country: 'PL', lat: 52.23, lon: 21.01 },
      ],
      credentials: { label: 'Application key', masked: 'ovh_••••••••7f1e', lastRotatedAt: ago(370 * DAY) }, quotas: { vcpus: 128, ramGB: 512, vms: 30, ips: 16 },
      lastSyncAt: ago(30 * MIN), lastError: 'Authentication failed: application key expired', allowedServices: ['vm', 'volume', 'network', 'ip'], createdAt: ago(380 * DAY), tags: tags({ tier: 'evaluation' }), lastTestAt: ago(30 * MIN) },
  ];
  return { hosts, providers };
}
