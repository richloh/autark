import type { VM, VmPreset, Image, SshKey, Volume, VolumePreset, Snapshot } from '@/types';
import { ago, tags, scope, A, B, DAY, HOUR, MIN } from './util';

export const VM_PRESETS: VmPreset[] = [
  { id: 'vm-s1', name: 'S1', family: 'general', vcpus: 1, ramGB: 2, systemDiskGB: 40, description: 'Tiny utility box, bastions, DNS', builtIn: true },
  { id: 'vm-m2', name: 'M2', family: 'general', vcpus: 2, ramGB: 4, systemDiskGB: 80, description: 'Small services and side-cars', builtIn: true },
  { id: 'vm-m4', name: 'M4', family: 'general', vcpus: 4, ramGB: 8, systemDiskGB: 100, description: 'Web & app servers', builtIn: true },
  { id: 'vm-c8', name: 'C8', family: 'compute', vcpus: 8, ramGB: 16, systemDiskGB: 120, description: 'APIs, CI runners, batch', builtIn: true },
  { id: 'vm-c16', name: 'C16', family: 'compute', vcpus: 16, ramGB: 32, systemDiskGB: 160, description: 'Compute heavy workloads', builtIn: true },
  { id: 'vm-r8', name: 'R8', family: 'memory', vcpus: 8, ramGB: 64, systemDiskGB: 160, description: 'Caches, in-memory analytics', builtIn: true },
  { id: 'vm-g8a', name: 'G8-A6000', family: 'gpu', vcpus: 8, ramGB: 32, systemDiskGB: 200, gpu: { model: 'A6000', count: 1 }, description: 'Inference & fine-tuning', builtIn: true },
  { id: 'vm-g16h', name: 'G16-H100', family: 'gpu', vcpus: 16, ramGB: 128, systemDiskGB: 400, gpu: { model: 'H100', count: 1 }, description: 'Training large models', builtIn: true },
];

/** Account-specific presets created by users (editable). */
const CUSTOM_VM_PRESETS: VmPreset[] = [
  { id: 'preset-ci-xl', name: 'ci-runner-xl', family: 'compute', vcpus: 12, ramGB: 24, systemDiskGB: 200, description: 'GitLab runners with docker-in-docker', builtIn: false, accountId: A, createdAt: ago(40 * DAY), createdBy: 'alice@example.com' },
  { id: 'preset-cache-r', name: 'redis-cache', family: 'memory', vcpus: 4, ramGB: 48, systemDiskGB: 60, description: 'Memory-heavy cache nodes', builtIn: false, accountId: A, createdAt: ago(18 * DAY), createdBy: 'bob@example.com' },
  { id: 'preset-l40s', name: 'G8-L40S', family: 'gpu', vcpus: 8, ramGB: 64, systemDiskGB: 300, gpu: { model: 'L40S', count: 1 }, description: 'Inference serving (vLLM)', builtIn: false, accountId: B, createdAt: ago(12 * DAY), createdBy: 'ml@example.com' },
];

export const IMAGES: Image[] = [
  { id: 'img-ubuntu-2404', name: 'Ubuntu 24.04 LTS', os: 'ubuntu', version: '24.04', kind: 'public', arch: 'x86_64', sizeGB: 2.4, minDiskGB: 10, status: 'available', description: 'Noble Numbat, cloud-init ready', createdAt: ago(200 * DAY), tags: [] },
  { id: 'img-ubuntu-2204', name: 'Ubuntu 22.04 LTS', os: 'ubuntu', version: '22.04', kind: 'public', arch: 'x86_64', sizeGB: 2.2, minDiskGB: 10, status: 'available', description: 'Jammy Jellyfish', createdAt: ago(600 * DAY), tags: [] },
  { id: 'img-debian-13', name: 'Debian 13', os: 'debian', version: '13', kind: 'public', arch: 'x86_64', sizeGB: 1.6, minDiskGB: 8, status: 'available', description: 'Trixie', createdAt: ago(90 * DAY), tags: [] },
  { id: 'img-debian-12', name: 'Debian 12', os: 'debian', version: '12', kind: 'public', arch: 'x86_64', sizeGB: 1.5, minDiskGB: 8, status: 'available', description: 'Bookworm', createdAt: ago(500 * DAY), tags: [] },
  { id: 'img-fedora-42', name: 'Fedora 42', os: 'fedora', version: '42', kind: 'public', arch: 'x86_64', sizeGB: 2.1, minDiskGB: 10, status: 'available', description: 'Fedora Cloud Base', createdAt: ago(150 * DAY), tags: [] },
  { id: 'img-rocky-9', name: 'Rocky Linux 9', os: 'rocky', version: '9.5', kind: 'public', arch: 'x86_64', sizeGB: 1.9, minDiskGB: 10, status: 'available', description: 'RHEL compatible', createdAt: ago(240 * DAY), tags: [] },
  { id: 'img-alma-9', name: 'AlmaLinux 9', os: 'alma', version: '9.5', kind: 'public', arch: 'x86_64', sizeGB: 1.9, minDiskGB: 10, status: 'available', description: 'RHEL compatible', createdAt: ago(240 * DAY), tags: [] },
  { id: 'img-suse-15', name: 'openSUSE Leap 15.6', os: 'suse', version: '15.6', kind: 'public', arch: 'x86_64', sizeGB: 2.0, minDiskGB: 10, status: 'available', description: 'SUSE community', createdAt: ago(300 * DAY), tags: [] },
  { id: 'img-flatcar', name: 'Flatcar Container Linux', os: 'flatcar', version: 'stable', kind: 'public', arch: 'x86_64', sizeGB: 0.9, minDiskGB: 8, status: 'available', description: 'Immutable, container-optimized', createdAt: ago(60 * DAY), tags: [] },
  { id: 'img-windows-2022', name: 'Windows Server 2022', os: 'windows', version: '2022', kind: 'public', arch: 'x86_64', sizeGB: 18, minDiskGB: 60, status: 'available', description: 'Bring your own license', createdAt: ago(400 * DAY), tags: [] },
  { id: 'img-ubuntu-2004', name: 'Ubuntu 20.04 LTS', os: 'ubuntu', version: '20.04', kind: 'public', arch: 'x86_64', sizeGB: 2.0, minDiskGB: 10, status: 'deprecated', description: 'End of standard support', createdAt: ago(1500 * DAY), deprecatedAt: ago(220 * DAY), replacementId: 'img-ubuntu-2404', eol: '2025-05', tags: [] },
  { id: 'img-web-golden', name: 'web-golden-2026-10', os: 'custom', version: '2026.10', kind: 'custom', arch: 'x86_64', sizeGB: 4.2, minDiskGB: 20, status: 'available', description: 'Hardened nginx + node runtime (from web-1)', createdAt: ago(20 * DAY), sourceSnapshotId: 'snap-003', sourceVmId: 'vm-001', accountId: A, projectId: 'proj-app1', tags: tags({ app: 'web' }) },
  { id: 'img-cuda-12', name: 'ubuntu-cuda-12.6', os: 'custom', version: '12.6', kind: 'custom', arch: 'x86_64', sizeGB: 11.5, minDiskGB: 60, status: 'available', description: 'Ubuntu 22.04 + NVIDIA driver 560 + CUDA 12.6 + PyTorch', createdAt: ago(45 * DAY), accountId: B, projectId: 'proj-ml', tags: tags({ team: 'ml' }) },
];

export const SSH_KEYS: SshKey[] = [
  { id: 'ssh-001', name: 'alice-laptop', fingerprint: 'SHA256:9f4f0c2a7b1e3d6c8a9b0e1f2d3c4b5a6e7f8091', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK9z3dQm2yX8vYt7Lw0bJpN4cRsE1uHfGkZq alice@laptop', createdAt: ago(300 * DAY), accountId: A, tags: [], keyType: 'ed25519', bits: 256, comment: 'alice@laptop', createdBy: 'alice@example.com', lastUsedAt: ago(2 * HOUR) },
  { id: 'ssh-002', name: 'ci-deploy', fingerprint: 'SHA256:1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ1k2YhR7pWq0sLmNb3vXc9TzKa5eGdUoF ci@gitlab', createdAt: ago(200 * DAY), accountId: A, tags: tags({ owner: 'ci' }), keyType: 'ed25519', bits: 256, comment: 'ci@gitlab', createdBy: 'alice@example.com', lastUsedAt: ago(25 * MIN) },
  { id: 'ssh-003', name: 'bob-workstation', fingerprint: 'SHA256:aa11bb22cc33dd44ee55ff6677889900aabbccdd', publicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7xK2pLmQ9vRt4sWn8yBh3jFcZ0aEoUiGd5TqNw bob@ws', createdAt: ago(100 * DAY), accountId: A, tags: [], keyType: 'rsa', bits: 4096, comment: 'bob@ws', createdBy: 'bob@example.com', lastUsedAt: ago(9 * DAY) },
  { id: 'ssh-004', name: 'ml-team', fingerprint: 'SHA256:0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM1LxTr8bVq2nZpK6wYs0dHcJf4gEuA7oR ml@team', createdAt: ago(150 * DAY), accountId: B, tags: tags({ team: 'ml' }), keyType: 'ed25519', bits: 256, comment: 'ml@team', createdBy: 'ml@example.com', lastUsedAt: ago(5 * HOUR) },
  { id: 'ssh-005', name: 'ops-break-glass', fingerprint: 'SHA256:5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOps1kQz9WmXv3LbN7cTyRf2sHgP0dJeUa ops@vault', createdAt: ago(370 * DAY), accountId: B, tags: [], keyType: 'ed25519', bits: 256, comment: 'ops@vault', createdBy: 'ops@example.com' },
];

const CLOUD_INIT_WEB = `#cloud-config
package_update: true
packages: [nginx, fail2ban]
runcmd:
  - systemctl enable --now nginx
`;

type VmSpec = [id: string, name: string, project: string, preset: string | [number, number, number], image: string, location: string, host: string | null,
  net: string, subnet: string, privateIp: string, ips: string[], vols: string[], fws: string[], status: VM['status'], extra?: Partial<VM>];

const PRESET = Object.fromEntries(VM_PRESETS.map((p) => [p.id, p]));

const VM_SPECS: VmSpec[] = [
  ['vm-001', 'web-1', 'proj-app1', 'vm-m4', 'img-ubuntu-2404', 'dc1', 'bm-001', 'net-001', 'sn-001', '10.10.1.11', ['ip-001'], ['vol-001'], ['fw-002'], 'running', { tags: tags({ env: 'prod', app: 'web' }) }],
  ['vm-003', 'web-2', 'proj-app1', 'vm-m4', 'img-ubuntu-2404', 'dc1', 'bm-002', 'net-001', 'sn-001', '10.10.1.12', ['ip-004'], ['vol-003'], ['fw-002'], 'running', { tags: tags({ env: 'prod', app: 'web' }) }],
  ['vm-009', 'web-3', 'proj-app1', 'vm-m4', 'img-web-golden', 'dc1', 'bm-005', 'net-001', 'sn-001', '10.10.1.13', [], [], ['fw-002'], 'stopped', { tags: tags({ env: 'staging', app: 'web' }) }],
  ['vm-005', 'db-replica-1', 'proj-app1', 'vm-m2', 'img-ubuntu-2404', 'dc1', 'bm-003', 'net-001', 'sn-002', '10.10.2.21', [], ['vol-005'], ['fw-004'], 'running', { tags: tags({ env: 'prod', app: 'db' }) }],
  ['vm-007', 'bastion-1', 'proj-app1', 'vm-s1', 'img-debian-12', 'dc1', 'bm-005', 'net-001', 'sn-001', '10.10.1.5', ['ip-005'], [], ['fw-001'], 'running', { tags: tags({ env: 'prod', role: 'bastion' }) }],
  ['vm-008', 'lb-edge-1', 'proj-app1', 'vm-m2', 'img-debian-12', 'dc1', 'bm-006', 'net-004', 'sn-006', '10.40.1.10', ['ip-010'], ['vol-008'], ['fw-006'], 'running', { tags: tags({ env: 'prod', role: 'edge' }) }],
  ['vm-004', 'api-1', 'proj-app2', 'vm-c8', 'img-debian-12', 'dc2', 'bm-004', 'net-003', 'sn-004', '10.30.1.10', ['ip-008'], ['vol-004'], ['fw-003'], 'running', { tags: tags({ env: 'staging', app: 'api' }) }],
  ['vm-010', 'api-2', 'proj-app2', 'vm-c8', 'img-debian-12', 'dc2', 'bm-011', 'net-003', 'sn-004', '10.30.1.11', ['ip-011'], [], ['fw-003'], 'running', { tags: tags({ env: 'staging', app: 'api' }) }],
  ['vm-011', 'worker-app2', 'proj-app2', 'vm-m4', 'img-debian-13', 'dc2', 'bm-011', 'net-003', 'sn-005', '10.30.2.20', [], [], ['fw-003'], 'running', { tags: tags({ env: 'prod', app: 'worker' }) }],
  ['vm-012', 'legacy-win', 'proj-app2', 'vm-m4', 'img-windows-2022', 'dc2', 'bm-004', 'net-003', 'sn-005', '10.30.2.30', [], [], ['fw-003'], 'stopped', { tags: tags({ env: 'prod', app: 'erp' }) }],
  ['vm-002', 'ml-gpu-1', 'proj-ml', 'vm-g8a', 'img-cuda-12', 'dc1', 'bm-008', 'net-002', 'sn-003', '10.20.1.10', ['ip-003'], ['vol-002'], ['fw-009'], 'stopped', { tags: tags({ team: 'ml', workload: 'training' }) }],
  ['vm-013', 'jupyter-hub', 'proj-ml', 'vm-r8', 'img-ubuntu-2404', 'dc1', 'bm-008', 'net-002', 'sn-003', '10.20.1.20', [], [], ['fw-009'], 'running', { tags: tags({ team: 'ml', workload: 'notebooks' }) }],
  ['vm-006', 'ml-gpu-2', 'proj-ml', [16, 64, 300], 'img-cuda-12', 'hetzner-nbg1', null, 'net-006', 'sn-010', '10.21.1.10', ['ip-009'], ['vol-006', 'vol-007'], ['fw-009'], 'running', { gpu: { model: 'A6000', count: 2 }, tags: tags({ team: 'ml', workload: 'training', burst: 'true' }) }],
  ['vm-014', 'trainer-burst-1', 'proj-ml', 'vm-g16h', 'img-cuda-12', 'hetzner-nbg1', null, 'net-006', 'sn-010', '10.21.1.11', [], [], ['fw-009'], 'error', { tags: tags({ team: 'ml', burst: 'true' }) }],
  ['vm-015', 'gitlab-runner-1', 'proj-infra', 'vm-c8', 'img-ubuntu-2404', 'dc2', 'bm-011', 'net-005', 'sn-008', '10.50.1.20', [], [], ['fw-010'], 'running', { tags: tags({ role: 'ci' }) }],
  ['vm-016', 'monitoring-1', 'proj-infra', 'vm-c8', 'img-ubuntu-2404', 'dc2', 'bm-004', 'net-005', 'sn-008', '10.50.1.30', [], ['vol-009'], ['fw-010'], 'running', { tags: tags({ role: 'monitoring' }) }],
  ['vm-017', 'vpn-gw', 'proj-infra', 'vm-m2', 'img-debian-12', 'dc2', 'bm-011', 'net-005', 'sn-008', '10.50.1.5', ['ip-012'], [], ['fw-011'], 'running', { tags: tags({ role: 'vpn' }) }],
];

export function seedCompute() {
  const vms: VM[] = VM_SPECS.map(([id, name, project, preset, imageId, locationId, hostId, networkId, subnetId, privateIp, ipIds, volumeIds, firewallIds, status, extra], i) => {
    const p = typeof preset === 'string' ? PRESET[preset] : null;
    const size = p ? { presetId: p.id, vcpus: p.vcpus, ramGB: p.ramGB, systemDiskGB: p.systemDiskGB } : { presetId: null, vcpus: (preset as number[])[0], ramGB: (preset as number[])[1], systemDiskGB: (preset as number[])[2] };
    return {
      id, name, ...scope(project), status, size, gpu: p?.gpu ?? null, imageId, locationId, hostId, networkId, subnetId, privateIp, ipIds, ipv6: i % 3 === 0,
      sshKeyIds: project.startsWith('proj-app') ? ['ssh-001', 'ssh-002'] : ['ssh-004'], volumeIds, firewallIds,
      backups: { enabled: status !== 'error' && i % 4 !== 3, schedule: i % 2 ? 'weekly' : 'daily', retention: 7, window: '02:00-04:00' },
      initScript: name.startsWith('web') ? CLOUD_INIT_WEB : '', deletionProtection: name.startsWith('web-1') || name === 'vpn-gw',
      createdAt: ago((120 - i * 6) * DAY), lastStartedAt: ago((i + 1) * 9 * HOUR), tags: [], ...extra,
    } as VM;
  });

  const vmById = Object.fromEntries(vms.map((v) => [v.id, v]));
  const volSpec: [string, string, Volume['type'], number, number, number, string | null, number, string?][] = [
    ['vol-001', 'web-1-data', 'ssd', 200, 3000, 125, 'vm-001', 0.62],
    ['vol-002', 'ml-datasets', 'hdd', 2000, 500, 250, 'vm-002', 0.81],
    ['vol-003', 'web-2-data', 'ssd', 150, 3000, 125, 'vm-003', 0.44],
    ['vol-004', 'api-1-logs', 'nvme', 250, 10000, 500, 'vm-004', 0.73],
    ['vol-005', 'db-replica-1-data', 'ssd', 300, 6000, 250, 'vm-005', 0.58],
    ['vol-006', 'ml-gpu-2-checkpoints', 'nvme', 1000, 20000, 1000, 'vm-006', 0.67],
    ['vol-007', 'ml-gpu-2-datasets', 'hdd', 4000, 500, 250, 'vm-006', 0.91],
    ['vol-008', 'edge-cache', 'nvme', 200, 10000, 500, 'vm-008', 0.35],
    ['vol-009', 'prometheus-tsdb', 'ssd', 500, 3000, 125, 'vm-016', 0.77],
    ['vol-010', 'restore-staging', 'ssd', 100, 3000, 125, null, 0.12, 'proj-app1'],
    ['vol-011', 'shared-uploads', 'hdd', 1000, 500, 125, null, 0.4, 'proj-app2'],
  ];
  const volumes: Volume[] = volSpec.map(([id, name, type, sizeGB, iops, throughputMBps, vmId, used, proj], i) => {
    const vm = vmId ? vmById[vmId] : null;
    const project = vm ? vm.projectId : proj!;
    const devIdx = vm ? vm.volumeIds.indexOf(id) : 0;
    return {
      id, name, ...scope(project), type, sizeGB, usedGB: Math.round(sizeGB * used), iops, throughputMBps,
      locationId: vm ? vm.locationId : project === 'proj-app2' ? 'dc2' : 'dc1',
      status: vm ? 'in-use' : 'available', attachedTo: vm ? { vmId: vm.id, device: `/dev/vd${String.fromCharCode(98 + devIdx)}` } : null,
      filesystem: type === 'hdd' ? 'xfs' : 'ext4', encrypted: i % 3 !== 2,
      backupPolicy: { enabled: i % 2 === 0, schedule: 'daily', retention: 7 }, createdAt: ago((100 - i * 5) * DAY),
      tags: vm ? vm.tags.slice(0, 1) : tags({ env: 'staging' }),
    } as Volume;
  });

  const snapshots: Snapshot[] = [
    { id: 'snap-001', name: 'web-1-data-auto-1', kind: 'volume', sourceId: 'vol-001', sourceName: 'web-1-data', sizeGB: 48, status: 'available', trigger: 'scheduled', locationId: 'dc1', createdAt: ago(1 * DAY), tags: [], ...scope('proj-app1') },
    { id: 'snap-002', name: 'web-1-data-auto-2', kind: 'volume', sourceId: 'vol-001', sourceName: 'web-1-data', sizeGB: 47, status: 'available', trigger: 'scheduled', locationId: 'dc1', createdAt: ago(2 * DAY), tags: [], ...scope('proj-app1') },
    { id: 'snap-003', name: 'web-1-golden', kind: 'vm', sourceId: 'vm-001', sourceName: 'web-1', sizeGB: 12, status: 'available', trigger: 'manual', locationId: 'dc1', createdAt: ago(21 * DAY), description: 'Before nginx 1.27 upgrade', tags: tags({ keep: 'true' }), ...scope('proj-app1') },
    { id: 'snap-004', name: 'web-1-auto', kind: 'vm', sourceId: 'vm-001', sourceName: 'web-1', sizeGB: 11, status: 'available', trigger: 'scheduled', locationId: 'dc1', createdAt: ago(8 * HOUR), tags: [], ...scope('proj-app1') },
    { id: 'snap-005', name: 'api-1-pre-deploy', kind: 'vm', sourceId: 'vm-004', sourceName: 'api-1', sizeGB: 9, status: 'available', trigger: 'pre-change', locationId: 'dc2', createdAt: ago(3 * DAY), tags: [], ...scope('proj-app2') },
    { id: 'snap-006', name: 'checkpoints-epoch-40', kind: 'volume', sourceId: 'vol-006', sourceName: 'ml-gpu-2-checkpoints', sizeGB: 610, status: 'available', trigger: 'manual', locationId: 'hetzner-nbg1', createdAt: ago(4 * DAY), tags: tags({ team: 'ml' }), ...scope('proj-ml') },
    { id: 'snap-007', name: 'db-replica-1-data-auto', kind: 'volume', sourceId: 'vol-005', sourceName: 'db-replica-1-data', sizeGB: 160, status: 'available', trigger: 'scheduled', locationId: 'dc1', createdAt: ago(20 * HOUR), tags: [], ...scope('proj-app1') },
    { id: 'snap-008', name: 'prometheus-weekly', kind: 'volume', sourceId: 'vol-009', sourceName: 'prometheus-tsdb', sizeGB: 380, status: 'available', trigger: 'scheduled', locationId: 'dc2', createdAt: ago(5 * DAY + 30 * MIN), tags: [], ...scope('proj-infra') },
    { id: 'snap-009', name: 'web-1-auto-2', kind: 'vm', sourceId: 'vm-001', sourceName: 'web-1', sizeGB: 11, status: 'available', trigger: 'scheduled', locationId: 'dc1', createdAt: ago(32 * HOUR), tags: [], ...scope('proj-app1') },
    { id: 'snap-010', name: 'web-1-pre-kernel', kind: 'vm', sourceId: 'vm-001', sourceName: 'web-1', sizeGB: 10, status: 'available', trigger: 'pre-change', locationId: 'dc1', createdAt: ago(6 * DAY), description: 'Before kernel 6.8 upgrade', tags: [], ...scope('proj-app1') },
    { id: 'snap-011', name: 'web-2-auto', kind: 'vm', sourceId: 'vm-003', sourceName: 'web-2', sizeGB: 11, status: 'available', trigger: 'scheduled', locationId: 'dc1', createdAt: ago(14 * HOUR), tags: [], ...scope('proj-app1') },
    { id: 'snap-012', name: 'monitoring-1-auto', kind: 'vm', sourceId: 'vm-016', sourceName: 'monitoring-1', sizeGB: 14, status: 'available', trigger: 'scheduled', locationId: 'dc2', createdAt: ago(2 * DAY), tags: [], ...scope('proj-infra') },
    { id: 'snap-013', name: 'jupyter-before-cuda', kind: 'vm', sourceId: 'vm-013', sourceName: 'jupyter-hub', sizeGB: 19, status: 'available', trigger: 'manual', locationId: 'dc1', createdAt: ago(9 * DAY), description: 'Clean state before CUDA toolkit install', tags: [], ...scope('proj-ml') },
    { id: 'snap-014', name: 'web-1-data-auto-3', kind: 'volume', sourceId: 'vol-001', sourceName: 'web-1-data', sizeGB: 46, status: 'available', trigger: 'scheduled', locationId: 'dc1', createdAt: ago(3 * DAY), tags: [], ...scope('proj-app1') },
  ];
  const volById = Object.fromEntries(volumes.map((v) => [v.id, v]));
  const vmSize = Object.fromEntries(vms.map((v) => [v.id, v.size.systemDiskGB]));
  for (const s of snapshots) {
    if (s.kind === 'volume') { const v = volById[s.sourceId]; if (v) { s.volumeType = v.type; s.sourceSizeGB = v.sizeGB } }
    else s.sourceSizeGB = vmSize[s.sourceId];
  }

  const volumePresets: VolumePreset[] = [
    { id: 'vol-s-100', name: 'SSD-100', type: 'ssd', sizeGB: 100, iops: 3000, throughputMBps: 125, description: 'General purpose data disk', builtIn: true },
    { id: 'vol-s-500', name: 'SSD-500', type: 'ssd', sizeGB: 500, iops: 6000, throughputMBps: 250, description: 'Databases & app data', builtIn: true },
    { id: 'vol-n-500', name: 'NVMe-500', type: 'nvme', sizeGB: 500, iops: 20000, throughputMBps: 1000, description: 'Latency sensitive, high IOPS', builtIn: true },
    { id: 'vol-h-2000', name: 'HDD-2T', type: 'hdd', sizeGB: 2000, iops: 500, throughputMBps: 250, description: 'Cheap capacity for datasets & archives', builtIn: true },
    { id: 'vpre-pg-fast', name: 'postgres-fast', type: 'nvme', sizeGB: 300, iops: 12000, throughputMBps: 600, description: 'Self-managed PostgreSQL data volumes', builtIn: false, accountId: A, createdAt: ago(30 * DAY), createdBy: 'alice@example.com' },
    { id: 'vpre-ml-scratch', name: 'ml-scratch', type: 'nvme', sizeGB: 1000, iops: 20000, throughputMBps: 1000, description: 'Checkpoint scratch space for training jobs', builtIn: false, accountId: B, createdAt: ago(22 * DAY), createdBy: 'ml@example.com' },
  ];

  return { vmPresets: [...VM_PRESETS, ...CUSTOM_VM_PRESETS], images: IMAGES, sshKeys: SSH_KEYS, vms, volumes, snapshots, volumePresets };
}

