import type { VM, VmPreset, Image, SshKey, Volume, VolumePreset, Snapshot, Tag } from '@/types';
import { ago, tags, ptags, scope, projectAccount, R, E, ME, DAY, HOUR, MIN } from './util';

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
  { id: 'preset-compass-batch', name: 'compass-batch', family: 'compute', vcpus: 32, ramGB: 128, systemDiskGB: 200, description: 'Compass billing batch workers (Turnusabrechnung, Abschläge)', builtIn: false, accountId: R, createdAt: ago(300 * DAY), createdBy: 'jana.hoffmann@regiocom-energie.de' },
  { id: 'preset-sap-app', name: 'sap-app-32', family: 'memory', vcpus: 32, ramGB: 128, systemDiskGB: 200, description: 'SAP NetWeaver application servers (SAPS-sized)', builtIn: false, accountId: R, createdAt: ago(460 * DAY), createdBy: 'thomas.becker@regiocom-energie.de' },
  { id: 'preset-l40s', name: 'G16-L40S', family: 'gpu', vcpus: 16, ramGB: 128, systemDiskGB: 400, gpu: { model: 'L40S', count: 1 }, description: 'LLM inference / fine-tuning (vLLM)', builtIn: false, accountId: E, createdAt: ago(120 * DAY), createdBy: 'richard@enneo.ai' },
];

export const IMAGES: Image[] = [
  { id: 'img-ubuntu-2604', name: 'Ubuntu 26.04 LTS', os: 'ubuntu', version: '26.04', kind: 'public', arch: 'x86_64', sizeGB: 2.5, minDiskGB: 10, status: 'available', description: 'Resolute Raccoon, cloud-init ready', createdAt: ago(190 * DAY), tags: [] },
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
  { id: 'img-ubuntu-2004', name: 'Ubuntu 20.04 LTS', os: 'ubuntu', version: '20.04', kind: 'public', arch: 'x86_64', sizeGB: 2.0, minDiskGB: 10, status: 'deprecated', description: 'End of standard support', createdAt: ago(1500 * DAY), deprecatedAt: ago(220 * DAY), replacementId: 'img-ubuntu-2604', eol: '2025-05', tags: [] },
  { id: 'img-compass-golden', name: 'compass-app-golden-2026-10', os: 'custom', version: '2026.10', kind: 'custom', arch: 'x86_64', sizeGB: 5.8, minDiskGB: 40, status: 'available', description: 'Ubuntu 24.04 + Java 21 + Compass app server 2026.10, CIS hardened (from compass-app-1)', createdAt: ago(20 * DAY), sourceSnapshotId: 'snap-003', sourceVmId: 'vm-001', accountId: R, projectId: 'proj-compass', tags: tags({ app: 'compass' }) },
  { id: 'img-enneo-node', name: 'enneo-node-2026-11', os: 'custom', version: '2026.11', kind: 'custom', arch: 'x86_64', sizeGB: 4.2, minDiskGB: 40, status: 'available', description: 'Ubuntu 26.04 + containerd, Cilium prerequisites & Enneo node agent, CIS hardened', createdAt: ago(6 * DAY), accountId: E, projectId: 'proj-enneo-regiocom', tags: tags({ company: 'enneo' }) },
  { id: 'img-sles-sap', name: 'sles15-sp6-sap', os: 'suse', version: '15 SP6', kind: 'custom', arch: 'x86_64', sizeGB: 3.4, minDiskGB: 60, status: 'available', description: 'SUSE Linux Enterprise Server 15 SP6 for SAP Applications (BYOS, saptune applied)', createdAt: ago(150 * DAY), accountId: R, projectId: 'proj-isu', tags: tags({ team: 'sap-basis' }) },
];

export const SSH_KEYS: SshKey[] = [
  { id: 'ssh-001', name: 'dennis-laptop', fingerprint: 'SHA256:9f4f0c2a7b1e3d6c8a9b0e1f2d3c4b5a6e7f8091', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK9z3dQm2yX8vYt7Lw0bJpN4cRsE1uHfGkZq dennis@regiocom', createdAt: ago(600 * DAY), accountId: R, tags: [], keyType: 'ed25519', bits: 256, comment: 'dennis@regiocom', createdBy: ME, lastUsedAt: ago(2 * HOUR) },
  { id: 'ssh-002', name: 'gitlab-deploy', fingerprint: 'SHA256:1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ1k2YhR7pWq0sLmNb3vXc9TzKa5eGdUoF deploy@gitlab.intern', createdAt: ago(500 * DAY), accountId: R, tags: tags({ owner: 'ci' }), keyType: 'ed25519', bits: 256, comment: 'deploy@gitlab.intern', createdBy: ME, lastUsedAt: ago(25 * MIN) },
  { id: 'ssh-003', name: 'sap-basis', fingerprint: 'SHA256:aa11bb22cc33dd44ee55ff6677889900aabbccdd', publicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7xK2pLmQ9vRt4sWn8yBh3jFcZ0aEoUiGd5TqNw sapbasis@regiocom', createdAt: ago(460 * DAY), accountId: R, tags: tags({ team: 'sap-basis' }), keyType: 'rsa', bits: 4096, comment: 'sapbasis@regiocom', createdBy: 'thomas.becker@regiocom-energie.de', lastUsedAt: ago(9 * HOUR) },
  { id: 'ssh-004', name: 'enneo-team', fingerprint: 'SHA256:0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM1LxTr8bVq2nZpK6wYs0dHcJf4gEuA7oR team@enneo.ai', createdAt: ago(240 * DAY), accountId: E, tags: tags({ company: 'enneo' }), keyType: 'ed25519', bits: 256, comment: 'team@enneo.ai', createdBy: 'richard@enneo.ai', lastUsedAt: ago(5 * HOUR) },
  { id: 'ssh-005', name: 'ops-break-glass', fingerprint: 'SHA256:5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOps1kQz9WmXv3LbN7cTyRf2sHgP0dJeUa ops@vault', createdAt: ago(700 * DAY), accountId: R, tags: [], keyType: 'ed25519', bits: 256, comment: 'ops@vault', createdBy: ME },
  { id: 'ssh-006', name: 'richard-mbp', fingerprint: 'SHA256:7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIRl0hw4ss3rMbpK2zYqT6nVd8cJf1gEuA9 richard@enneo.ai', createdAt: ago(230 * DAY), accountId: E, tags: [], keyType: 'ed25519', bits: 256, comment: 'richard@enneo.ai', createdBy: 'richard@enneo.ai', lastUsedAt: ago(3 * HOUR) },
];

const CLOUD_INIT_COMPASS = `#cloud-config
package_update: true
packages: [openjdk-21-jre-headless, prometheus-node-exporter]
write_files:
  - path: /etc/compass/app.env
    content: |
      COMPASS_DB_HOST=compass-db.db.dc1.autark.internal
      COMPASS_CACHE_HOST=compass-cache.db.dc1.autark.internal
runcmd:
  - systemctl enable --now compass-app
`;
const CLOUD_INIT_WEB = `#cloud-config
package_update: true
packages: [nginx, php8.2-fpm, php8.2-mysql, fail2ban]
runcmd:
  - systemctl enable --now nginx php8.2-fpm
`;

const CLOUD_INIT_SIP = `#cloud-config
package_update: true
packages: [kamailio, kamailio-tls-modules, kamailio-extra-modules, keepalived, prometheus-node-exporter]
write_files:
  - path: /etc/kamailio/dispatcher.list
    content: |
      # voice-gateway on the p6 nodes (setid 1) and p9 nodes (setid 2, test numbers)
      1 sip:10.60.16.210:5060
      1 sip:10.60.16.211:5060
      1 sip:10.60.16.212:5060
      2 sip:10.60.17.34:5060
      2 sip:10.60.17.35:5060
      2 sip:10.60.17.36:5060
runcmd:
  - systemctl enable --now kamailio keepalived
`;

type VmSpec = [id: string, name: string, project: string, preset: string | [number, number, number], image: string, location: string, host: string | null,
  net: string, subnet: string, privateIp: string, ips: string[], vols: string[], fws: string[], status: VM['status'], vmTags: Tag[], extra?: Partial<VM>];

const PRESET = Object.fromEntries([...VM_PRESETS, ...CUSTOM_VM_PRESETS].map((p) => [p.id, p]));
const enneo = (env: string, extra: Record<string, string> = {}) => tags({ env, team: 'enneo', ...extra });

const VM_SPECS: VmSpec[] = [
  // Compass ERP — app servers behind compass-lb, batch workers for billing runs
  ['vm-001', 'compass-app-1', 'proj-compass', 'vm-c16', 'img-compass-golden', 'dc1', 'bm-001', 'net-001', 'sn-001', '10.10.1.11', [], ['vol-001'], ['fw-001'], 'running', ptags('proj-compass', 'prod', { role: 'app' }), { deletionProtection: true }],
  ['vm-002', 'compass-app-2', 'proj-compass', 'vm-c16', 'img-compass-golden', 'dc1', 'bm-002', 'net-001', 'sn-001', '10.10.1.12', [], ['vol-002'], ['fw-001'], 'running', ptags('proj-compass', 'prod', { role: 'app' })],
  ['vm-003', 'compass-app-3', 'proj-compass', 'vm-c16', 'img-compass-golden', 'dc1', 'bm-003', 'net-001', 'sn-001', '10.10.1.13', [], ['vol-003'], ['fw-001'], 'running', ptags('proj-compass', 'prod', { role: 'app' })],
  ['vm-004', 'compass-billing-1', 'proj-compass', 'preset-compass-batch', 'img-ubuntu-2404', 'dc1', 'bm-001', 'net-001', 'sn-003', '10.10.3.11', [], ['vol-004'], ['fw-002'], 'running', ptags('proj-compass', 'prod', { role: 'batch' })],
  ['vm-005', 'compass-billing-2', 'proj-compass', 'preset-compass-batch', 'img-ubuntu-2404', 'dc1', 'bm-002', 'net-001', 'sn-003', '10.10.3.12', [], ['vol-005'], ['fw-002'], 'running', ptags('proj-compass', 'prod', { role: 'batch' })],
  // Orchestrator — SFTP endpoint for market partners (EDIFACT file exchange)
  ['vm-006', 'mako-sftp', 'proj-orchestrator', 'vm-m4', 'img-debian-12', 'dc1', 'bm-003', 'net-002', 'sn-004', '10.20.1.10', ['ip-003'], ['vol-006'], ['fw-006'], 'running', ptags('proj-orchestrator', 'prod', { role: 'sftp' })],
  // SAP IS/U — HANA + NetWeaver on the reserved SAP hosts
  ['vm-007', 'isu-hana-db', 'proj-isu', [64, 768, 200], 'img-sles-sap', 'dc1', 'bm-006', 'net-003', 'sn-007', '10.30.1.10', [], ['vol-007', 'vol-008', 'vol-009', 'vol-010'], ['fw-008'], 'running', ptags('proj-isu', 'prod', { sid: 'IP1', role: 'hana' }), { deletionProtection: true }],
  ['vm-008', 'isu-ascs', 'proj-isu', [4, 16, 100], 'img-sles-sap', 'dc1', 'bm-007', 'net-003', 'sn-008', '10.30.2.10', [], [], ['fw-008'], 'running', ptags('proj-isu', 'prod', { sid: 'IP1', role: 'ascs' }), { deletionProtection: true }],
  ['vm-009', 'isu-app-1', 'proj-isu', 'preset-sap-app', 'img-sles-sap', 'dc1', 'bm-006', 'net-003', 'sn-008', '10.30.2.11', [], [], ['fw-008'], 'running', ptags('proj-isu', 'prod', { sid: 'IP1', role: 'pas' })],
  ['vm-010', 'isu-app-2', 'proj-isu', 'preset-sap-app', 'img-sles-sap', 'dc1', 'bm-007', 'net-003', 'sn-008', '10.30.2.12', [], [], ['fw-008'], 'running', ptags('proj-isu', 'prod', { sid: 'IP1', role: 'aas' })],
  // SAP S4 — migration / transformation system
  ['vm-011', 's4-hana-db', 'proj-s4', [48, 512, 200], 'img-sles-sap', 'dc1', 'bm-007', 'net-004', 'sn-009', '10.31.1.10', [], ['vol-011', 'vol-012'], ['fw-009'], 'running', ptags('proj-s4', 'staging', { sid: 'S4Q', role: 'hana' })],
  ['vm-012', 's4-app-1', 'proj-s4', [16, 64, 150], 'img-sles-sap', 'dc1', 'bm-007', 'net-004', 'sn-009', '10.31.1.11', [], [], ['fw-009'], 'running', ptags('proj-s4', 'staging', { sid: 'S4Q', role: 'pas' })],
  ['vm-013', 's4-webdispatcher', 'proj-s4', 'vm-m2', 'img-sles-sap', 'dc1', 'bm-006', 'net-004', 'sn-010', '10.31.10.10', [], [], ['fw-009'], 'running', ptags('proj-s4', 'staging', { sid: 'S4Q', role: 'webdisp' })],
  // Website — Typo3 in RZ Frankfurt (close to DE-CIX), cold standby on AWS Frankfurt
  ['vm-014', 'website-web-1', 'proj-website', 'vm-m4', 'img-debian-12', 'dc2', 'bm-014', 'net-005', 'sn-011', '10.40.1.11', [], [], ['fw-010'], 'running', ptags('proj-website', 'prod', { role: 'web' })],
  ['vm-015', 'website-web-2', 'proj-website', 'vm-m4', 'img-debian-12', 'dc2', 'bm-015', 'net-005', 'sn-011', '10.40.1.12', [], [], ['fw-010'], 'running', ptags('proj-website', 'prod', { role: 'web' })],
  ['vm-016', 'website-dr', 'proj-website', 'vm-m2', 'img-debian-12', 'aws-eu-central-1', null, 'net-006', 'sn-013', '10.41.1.10', ['ip-015'], [], ['fw-012'], 'stopped', ptags('proj-website', 'dr', { role: 'web' })],
  // Interne Tools
  ['vm-017', 'gitlab', 'proj-tools', [8, 32, 200], 'img-ubuntu-2404', 'dc1', 'bm-003', 'net-007', 'sn-014', '10.50.1.10', ['ip-005'], ['vol-013'], ['fw-013'], 'running', ptags('proj-tools', 'prod', { role: 'scm' }), { deletionProtection: true }],
  ['vm-018', 'monitoring', 'proj-tools', [8, 32, 120], 'img-ubuntu-2404', 'dc1', 'bm-005', 'net-007', 'sn-014', '10.50.1.20', [], ['vol-014'], ['fw-014'], 'running', ptags('proj-tools', 'prod', { role: 'monitoring' })],
  ['vm-019', 'vpn-gw', 'proj-tools', 'vm-m2', 'img-debian-12', 'dc1', 'bm-005', 'net-007', 'sn-014', '10.50.1.5', ['ip-006'], [], ['fw-015'], 'running', ptags('proj-tools', 'prod', { role: 'vpn' }), { deletionProtection: true }],
  ['vm-020', 'gitlab-runner-1', 'proj-tools', 'vm-c8', 'img-ubuntu-2404', 'dc2', 'bm-014', 'net-008', 'sn-015', '10.51.1.11', [], [], ['fw-014'], 'running', ptags('proj-tools', 'prod', { role: 'ci' })],
  ['vm-021', 'gitlab-runner-2', 'proj-tools', 'vm-c8', 'img-ubuntu-2404', 'dc2', 'bm-015', 'net-008', 'sn-015', '10.51.1.12', [], [], ['fw-014'], 'running', ptags('proj-tools', 'prod', { role: 'ci' })],
  ['vm-022', 'backup-proxy', 'proj-tools', 'vm-m4', 'img-debian-12', 'dc2', 'bm-016', 'net-008', 'sn-015', '10.51.1.20', [], ['vol-015'], ['fw-014'], 'running', ptags('proj-tools', 'prod', { role: 'backup' })],
  ['vm-023', 'status-page', 'proj-tools', 'vm-s1', 'img-debian-12', 'hetzner-fsn1', null, 'net-009', 'sn-016', '10.52.1.10', ['ip-014'], [], ['fw-016'], 'running', ptags('proj-tools', 'prod', { role: 'monitoring', burst: 'true' })],
  // Enneo-intern — two VMs per location (RZ Magdeburg + RZ Frankfurt)
  ['vm-024', 'enneo-internal-admin', 'proj-enneo-intern', 'vm-m4', 'img-ubuntu-2404', 'dc1', 'bm-005', 'net-010', 'sn-017', '10.70.1.10', [], [], ['fw-020'], 'running', enneo('internal', { role: 'admin' }), { deletionProtection: true }],
  ['vm-025', 'enneo-monitoring', 'proj-enneo-intern', [8, 32, 120], 'img-ubuntu-2404', 'dc1', 'bm-001', 'net-010', 'sn-017', '10.70.1.20', [], ['vol-016'], ['fw-020'], 'running', enneo('internal', { role: 'monitoring' })],
  ['vm-026', 'enneo-ci-runner', 'proj-enneo-intern', 'vm-c8', 'img-ubuntu-2404', 'dc2', 'bm-015', 'net-011', 'sn-020', '10.71.1.11', [], [], ['fw-021'], 'running', enneo('internal', { role: 'ci' })],
  ['vm-027', 'enneo-backup', 'proj-enneo-intern', 'vm-m4', 'img-debian-12', 'dc2', 'bm-016', 'net-011', 'sn-020', '10.71.1.20', [], ['vol-019'], ['fw-021'], 'running', enneo('internal', { role: 'backup' })],
  // Enneo · Regiocom prod — Kamailio SIP proxies next to the clusters p6 / p9
  ['vm-028', 'sip-proxy-1', 'proj-enneo-regiocom', 'vm-m2', 'img-debian-12', 'dc1', 'bm-001', 'net-012', 'sn-021', '10.60.1.11', [], [], ['fw-018'], 'running', enneo('production', { role: 'sip' }), { deletionProtection: true }],
  ['vm-029', 'sip-proxy-2', 'proj-enneo-regiocom', 'vm-m2', 'img-debian-12', 'dc1', 'bm-002', 'net-012', 'sn-021', '10.60.1.12', [], [], ['fw-018'], 'running', enneo('production', { role: 'sip' }), { deletionProtection: true }],
];

export function seedCompute() {
  const vms: VM[] = VM_SPECS.map(([id, name, project, preset, imageId, locationId, hostId, networkId, subnetId, privateIp, ipIds, volumeIds, firewallIds, status, vmTags, extra], i) => {
    const p = typeof preset === 'string' ? PRESET[preset] : null;
    const size = p ? { presetId: p.id, vcpus: p.vcpus, ramGB: p.ramGB, systemDiskGB: p.systemDiskGB } : { presetId: null, vcpus: (preset as number[])[0], ramGB: (preset as number[])[1], systemDiskGB: (preset as number[])[2] };
    const acc = projectAccount[project];
    const sshKeyIds = acc === E ? ['ssh-004', 'ssh-006']
      : project === 'proj-isu' || project === 'proj-s4' ? ['ssh-003', 'ssh-005']
      : project === 'proj-compass' || project === 'proj-website' ? ['ssh-001', 'ssh-002', 'ssh-005'] : ['ssh-001', 'ssh-005'];
    return {
      id, name, ...scope(project), status, size, gpu: p?.gpu ?? null, imageId, locationId, hostId, networkId, subnetId, privateIp, ipIds, ipv6: ipIds.length > 0 && locationId === 'dc1',
      sshKeyIds, volumeIds, firewallIds,
      backups: { enabled: status !== 'error' && !name.includes('runner') && !name.startsWith('enneo-dev'), schedule: project === 'proj-isu' || project === 'proj-compass' ? 'daily' : 'weekly', retention: project === 'proj-isu' ? 14 : 7, window: project === 'proj-isu' ? '23:00-01:00' : '02:00-04:00' },
      initScript: name.startsWith('compass-app') ? CLOUD_INIT_COMPASS : name.startsWith('website-web') ? CLOUD_INIT_WEB : name.startsWith('sip-proxy') ? CLOUD_INIT_SIP : '', deletionProtection: false,
      createdAt: ago((420 - i * 13) * DAY), lastStartedAt: ago((i + 1) * 9 * HOUR), tags: vmTags, ...extra,
    } as VM;
  });

  const vmById = Object.fromEntries(vms.map((v) => [v.id, v]));
  const volSpec: [string, string, Volume['type'], number, number, number, string | null, number, string?, string?][] = [
    ['vol-001', 'compass-app-1-logs', 'ssd', 100, 3000, 125, 'vm-001', 0.41],
    ['vol-002', 'compass-app-2-logs', 'ssd', 100, 3000, 125, 'vm-002', 0.39],
    ['vol-003', 'compass-app-3-logs', 'ssd', 100, 3000, 125, 'vm-003', 0.44],
    ['vol-004', 'compass-billing-1-spool', 'nvme', 500, 20000, 1000, 'vm-004', 0.62],
    ['vol-005', 'compass-billing-2-spool', 'nvme', 500, 20000, 1000, 'vm-005', 0.58],
    ['vol-006', 'mako-sftp-data', 'ssd', 500, 6000, 250, 'vm-006', 0.37],
    ['vol-007', 'isu-hana-data', 'nvme', 3000, 20000, 1000, 'vm-007', 0.71],
    ['vol-008', 'isu-hana-log', 'nvme', 512, 20000, 1000, 'vm-007', 0.46],
    ['vol-009', 'isu-hana-shared', 'ssd', 1000, 6000, 250, 'vm-007', 0.52],
    ['vol-010', 'isu-hana-backup', 'hdd', 6000, 500, 250, 'vm-007', 0.64],
    ['vol-011', 's4-hana-data', 'nvme', 2000, 20000, 1000, 'vm-011', 0.48],
    ['vol-012', 's4-hana-log', 'nvme', 512, 20000, 1000, 'vm-011', 0.31],
    ['vol-013', 'gitlab-data', 'ssd', 1000, 6000, 250, 'vm-017', 0.68],
    ['vol-014', 'prometheus-tsdb', 'ssd', 1000, 3000, 125, 'vm-018', 0.77],
    ['vol-015', 'backup-proxy-cache', 'hdd', 4000, 500, 250, 'vm-022', 0.55],
    ['vol-016', 'enneo-prometheus-tsdb', 'ssd', 500, 3000, 125, 'vm-025', 0.81],
    ['vol-017', 'isu-s4-migration-export', 'ssd', 500, 6000, 250, null, 0.73, 'proj-s4', 'dc1'],
    ['vol-018', 'website-restore-test', 'ssd', 50, 3000, 125, null, 0.12, 'proj-website', 'dc2'],
    ['vol-019', 'enneo-backup-repo', 'hdd', 4000, 500, 250, 'vm-027', 0.46],
  ];
  const volumes: Volume[] = volSpec.map(([id, name, type, sizeGB, iops, throughputMBps, vmId, used, proj, loc], i) => {
    const vm = vmId ? vmById[vmId] : null;
    const project = vm ? vm.projectId : proj!;
    const devIdx = vm ? vm.volumeIds.indexOf(id) : 0;
    return {
      id, name, ...scope(project), type, sizeGB, usedGB: Math.round(sizeGB * used), iops, throughputMBps,
      locationId: vm ? vm.locationId : loc!,
      status: vm ? 'in-use' : 'available', attachedTo: vm ? { vmId: vm.id, device: `/dev/vd${String.fromCharCode(98 + devIdx)}` } : null,
      filesystem: type === 'hdd' ? 'xfs' : name.includes('hana') ? 'xfs' : 'ext4', encrypted: true,
      backupPolicy: { enabled: !name.includes('logs') && !name.includes('restore') && !name.includes('cache'), schedule: name.includes('hana') ? 'hourly' : 'daily', retention: name.includes('hana') ? 14 : 7 },
      createdAt: ago((400 - i * 17) * DAY),
      tags: vm ? vm.tags.filter((t) => t.key === 'env' || t.key === 'kostenstelle') : projectAccount[project] === E ? tags({ env: 'dev', team: 'enneo' }) : ptags(project, 'staging'),
      ...(id === 'vol-017' ? { description: 'IS/U data export for S/4HANA migration test cycle 3' } : {}),
    } as Volume;
  });

  const snap = (id: string, name: string, kind: Snapshot['kind'], sourceId: string, sourceName: string, sizeGB: number, trigger: Snapshot['trigger'], whenMs: number, project: string, locationId: string, description?: string, t: Tag[] = []): Snapshot =>
    ({ id, name, kind, sourceId, sourceName, sizeGB, status: 'available', trigger, locationId, createdAt: ago(whenMs), tags: t, ...(description ? { description } : {}), ...scope(project) });
  const snapshots: Snapshot[] = [
    snap('snap-001', 'compass-app-1-auto', 'vm', 'vm-001', 'compass-app-1', 14, 'scheduled', 8 * HOUR, 'proj-compass', 'dc1'),
    snap('snap-002', 'compass-app-1-auto-2', 'vm', 'vm-001', 'compass-app-1', 14, 'scheduled', 32 * HOUR, 'proj-compass', 'dc1'),
    snap('snap-003', 'compass-app-golden', 'vm', 'vm-001', 'compass-app-1', 12, 'manual', 21 * DAY, 'proj-compass', 'dc1', 'Golden image source for Compass 2026.10', tags({ keep: 'true' })),
    snap('snap-004', 'isu-hana-data-pre-sps08', 'volume', 'vol-007', 'isu-hana-data', 2060, 'pre-change', 12 * DAY, 'proj-isu', 'dc1', 'Before HANA 2.0 SPS08 revision 82 patch', tags({ keep: 'true' })),
    snap('snap-005', 'isu-hana-data-auto', 'volume', 'vol-007', 'isu-hana-data', 2130, 'scheduled', 7 * HOUR, 'proj-isu', 'dc1'),
    snap('snap-006', 'isu-hana-log-auto', 'volume', 'vol-008', 'isu-hana-log', 235, 'scheduled', 7 * HOUR, 'proj-isu', 'dc1'),
    snap('snap-007', 's4-hana-data-cycle3', 'volume', 'vol-011', 's4-hana-data', 960, 'manual', 5 * DAY, 'proj-s4', 'dc1', 'Migration test cycle 3 — start state', tags({ keep: 'true' })),
    snap('snap-008', 'gitlab-pre-17-5', 'vm', 'vm-017', 'gitlab', 38, 'pre-change', 3 * DAY, 'proj-tools', 'dc1', 'Before GitLab 17.5 upgrade'),
    snap('snap-009', 'gitlab-data-auto', 'volume', 'vol-013', 'gitlab-data', 680, 'scheduled', 20 * HOUR, 'proj-tools', 'dc1'),
    snap('snap-010', 'prometheus-weekly', 'volume', 'vol-014', 'prometheus-tsdb', 770, 'scheduled', 5 * DAY + 30 * MIN, 'proj-tools', 'dc1'),
    snap('snap-011', 'mako-sftp-auto', 'vm', 'vm-006', 'mako-sftp', 9, 'scheduled', 14 * HOUR, 'proj-orchestrator', 'dc1'),
    snap('snap-012', 'website-web-1-auto', 'vm', 'vm-014', 'website-web-1', 11, 'scheduled', 1 * DAY, 'proj-website', 'dc2'),
    snap('snap-013', 'enneo-internal-admin-pre-upgrade', 'vm', 'vm-024', 'enneo-internal-admin', 11, 'pre-change', 9 * DAY, 'proj-enneo-intern', 'dc1', 'Before Ubuntu 24.04.1 dist-upgrade'),
    snap('snap-014', 'compass-billing-1-spool-auto', 'volume', 'vol-004', 'compass-billing-1-spool', 305, 'scheduled', 2 * DAY, 'proj-compass', 'dc1'),
    snap('snap-015', 'sip-proxy-1-pre-kamailio-5-8', 'vm', 'vm-028', 'sip-proxy-1', 4, 'pre-change', 16 * DAY, 'proj-enneo-regiocom', 'dc1', 'Before Kamailio 5.7 → 5.8 upgrade'),
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
    { id: 'vpre-hana-data', name: 'hana-data', type: 'nvme', sizeGB: 2000, iops: 20000, throughputMBps: 1000, description: 'SAP HANA /hana/data (TDI KPI compliant)', builtIn: false, accountId: R, createdAt: ago(300 * DAY), createdBy: 'thomas.becker@regiocom-energie.de' },
    { id: 'vpre-hana-log', name: 'hana-log', type: 'nvme', sizeGB: 512, iops: 20000, throughputMBps: 1000, description: 'SAP HANA /hana/log', builtIn: false, accountId: R, createdAt: ago(300 * DAY), createdBy: 'thomas.becker@regiocom-energie.de' },
    { id: 'vpre-model-cache', name: 'model-cache', type: 'nvme', sizeGB: 1000, iops: 20000, throughputMBps: 1000, description: 'LLM weights cache for vLLM nodes', builtIn: false, accountId: E, createdAt: ago(90 * DAY), createdBy: 'richard@enneo.ai' },
  ];

  return { vmPresets: [...VM_PRESETS, ...CUSTOM_VM_PRESETS], images: IMAGES, sshKeys: SSH_KEYS, vms, volumes, snapshots, volumePresets };
}
