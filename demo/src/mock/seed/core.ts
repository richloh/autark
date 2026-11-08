import type { Account, Project, Location, User, Role, SystemAccount, ProjectAllowance, AuditEvent, Notification, Operation, Service } from '@/types';
import { ago, ahead, tags, R, E, KX, ME, projectAccount, DAY, HOUR, MIN } from './util';

const REGIOCOM_PROJECTS = ['proj-compass', 'proj-orchestrator', 'proj-isu', 'proj-s4', 'proj-website', 'proj-tools'];
const ENNEO_PROJECTS = ['proj-enneo-regiocom', 'proj-enneo-intern'];
/** Monthly budgets for the Enneo projects (≈ 75–80 % used by the seeded resources). */
const BUDGET_EP = 1500;
const BUDGET_EI = 700;

export function seedCore() {
  const accounts: Account[] = [
    { id: R, name: 'Regiocom Energie', plan: 'enterprise' },
    { id: E, name: 'Enneo', plan: 'enterprise' },
    { id: KX, name: 'Kunde X', plan: 'community' },
  ];
  const projects: Project[] = [
    { id: 'proj-compass', accountId: R, name: 'Compass ERP', description: 'Customer administration & billing: contracts, meter readings, invoices, Abschläge', color: '#2563eb', createdAt: ago(690 * DAY) },
    { id: 'proj-orchestrator', accountId: R, name: 'Orchestrator', description: 'Process & integration orchestration: market communication (EDIFACT/MaKo), workflows', color: '#7c3aed', createdAt: ago(540 * DAY) },
    { id: 'proj-isu', accountId: R, name: 'SAP IS/U', description: 'SAP IS-U utility billing (legacy core, migrating to S/4HANA)', color: '#0f766e', createdAt: ago(700 * DAY) },
    { id: 'proj-s4', accountId: R, name: 'SAP S4', description: 'S/4HANA Utilities transformation — sandbox & migration test system', color: '#14b8a6', createdAt: ago(160 * DAY) },
    { id: 'proj-website', accountId: R, name: 'Website', description: 'regiocom-energie.de — Typo3 corporate website & tariff calculator', color: '#f59e0b', createdAt: ago(610 * DAY) },
    { id: 'proj-tools', accountId: R, name: 'Interne Tools', description: 'GitLab, CI runners, monitoring, VPN, backups', color: '#64748b', createdAt: ago(715 * DAY) },
    { id: 'proj-enneo-regiocom', accountId: E, name: 'Regiocom prod', description: 'Enneo AI customer service for Regiocom — clusters p6 (production) & p9 (staging) plus SIP proxies, hosted sovereignly in RZ Magdeburg', color: '#ec4899', createdAt: ago(240 * DAY) },
    { id: 'proj-enneo-intern', accountId: E, name: 'Enneo-intern', description: 'Enneo internal tooling: admin, monitoring, CI runner and offsite backups (RZ Magdeburg & RZ Frankfurt)', color: '#a855f7', createdAt: ago(250 * DAY) },
  ];
  const locations: Location[] = [
    { id: 'dc1', name: 'RZ Magdeburg', kind: 'selfHosted', city: 'Magdeburg', country: 'DE', lat: 52.13, lon: 11.63 },
    { id: 'dc2', name: 'RZ Frankfurt', kind: 'selfHosted', city: 'Frankfurt am Main', country: 'DE', lat: 50.11, lon: 8.68 },
    { id: 'hetzner-nbg1', name: 'Hetzner nbg1', kind: 'cloud', providerId: 'provider-hetzner', region: 'nbg1', city: 'Nuremberg', country: 'DE', lat: 49.45, lon: 11.08 },
    { id: 'hetzner-fsn1', name: 'Hetzner fsn1', kind: 'cloud', providerId: 'provider-hetzner', region: 'fsn1', city: 'Falkenstein', country: 'DE', lat: 50.48, lon: 12.37 },
    { id: 'hetzner-hel1', name: 'Hetzner hel1', kind: 'cloud', providerId: 'provider-hetzner', region: 'hel1', city: 'Helsinki', country: 'FI', lat: 60.17, lon: 24.94 },
    { id: 'aws-eu-central-1', name: 'AWS eu-central-1', kind: 'cloud', providerId: 'provider-aws', region: 'eu-central-1', city: 'Frankfurt', country: 'DE', lat: 50.0, lon: 8.9 },
    { id: 'ovh-gra', name: 'OVHcloud GRA', kind: 'cloud', providerId: 'provider-ovh', region: 'GRA', city: 'Gravelines', country: 'FR', lat: 50.99, lon: 2.13 },
  ];

  const sess = (id: string, kind: 'browser' | 'cli' | 'mobile', device: string, ip: string, location: string, created: number, active: number, current?: boolean) =>
    ({ id, kind, device, ip, location, createdAt: ago(created), lastActive: ago(active), ...(current ? { current } : {}) });
  const OFFICE_MD = '192.0.2.44';
  const users: User[] = [
    { id: 'user-001', name: 'Dennis', email: ME, title: 'Head of IT Infrastructure', roleIds: ['role-admin'], projectIds: '*', mfa: true, mfaMethod: 'webauthn', mfaRequired: true, status: 'active', lastLogin: ago(5 * MIN), createdAt: ago(715 * DAY), sso: true, tags: tags({ team: 'it-infrastruktur' }),
      sessions: [
        sess('sess-001', 'browser', 'Chrome 131 · Windows 11', OFFICE_MD, 'Magdeburg, DE', 2 * HOUR, 1 * MIN, true),
        sess('sess-002', 'cli', 'autark CLI 1.8 · WSL Ubuntu', OFFICE_MD, 'Magdeburg, DE', 3 * DAY, 4 * HOUR),
        sess('sess-003', 'mobile', 'iPhone · Safari', '198.51.100.71', 'Leipzig, DE', 6 * DAY, 1 * DAY),
      ],
      apiTokens: [
        { id: 'tok-u001', name: 'laptop-cli', prefix: 'atk_live_d3a1', createdAt: ago(40 * DAY), expiresAt: ahead(50 * DAY), lastUsed: ago(4 * HOUR), status: 'active', lastUsedIp: OFFICE_MD },
        { id: 'tok-u002', name: 'grafana-test', prefix: 'atk_live_0b7e', createdAt: ago(120 * DAY), expiresAt: ago(30 * DAY), lastUsed: ago(35 * DAY), status: 'expired' },
      ] },
    { id: 'user-002', name: 'Katrin Schulze', email: 'katrin.schulze@regiocom-energie.de', title: 'Platform Engineer (Ops)', roleIds: ['role-ops'], projectIds: REGIOCOM_PROJECTS, mfa: true, mfaMethod: 'totp', status: 'active', lastLogin: ago(40 * MIN), createdAt: ago(600 * DAY), sso: true, tags: tags({ team: 'it-infrastruktur' }),
      sessions: [sess('sess-004', 'browser', 'Firefox 133 · Ubuntu', OFFICE_MD, 'Magdeburg, DE', 5 * HOUR, 40 * MIN)],
      apiTokens: [{ id: 'tok-u003', name: 'ansible', prefix: 'atk_live_c4a7', createdAt: ago(80 * DAY), expiresAt: null, lastUsed: ago(6 * HOUR), status: 'active', lastUsedIp: '10.50.1.10' }] },
    { id: 'user-003', name: 'Stefan Wagner', email: 'stefan.wagner@regiocom-energie.de', title: 'Network & Security Engineer', roleIds: ['role-ops'], projectIds: REGIOCOM_PROJECTS, mfa: true, mfaMethod: 'webauthn', status: 'active', lastLogin: ago(3 * HOUR), createdAt: ago(520 * DAY), sso: true, tags: tags({ team: 'it-infrastruktur' }),
      sessions: [sess('sess-005', 'browser', 'Edge 131 · Windows 11', OFFICE_MD, 'Magdeburg, DE', 9 * HOUR, 3 * HOUR)], apiTokens: [] },
    { id: 'user-004', name: 'Thomas Becker', email: 'thomas.becker@regiocom-energie.de', title: 'SAP Basis Administrator', roleIds: ['role-sap-basis'], projectIds: ['proj-isu', 'proj-s4'], mfa: true, mfaMethod: 'totp', status: 'active', lastLogin: ago(2 * HOUR), createdAt: ago(480 * DAY), sso: true, tags: tags({ team: 'sap-basis' }),
      sessions: [sess('sess-006', 'browser', 'Chrome 131 · Windows 11', OFFICE_MD, 'Magdeburg, DE', 1 * DAY, 2 * HOUR)], apiTokens: [] },
    { id: 'user-005', name: 'Jana Hoffmann', email: 'jana.hoffmann@regiocom-energie.de', title: 'Senior Developer Compass', roleIds: ['role-compass-dev'], projectIds: ['proj-compass', 'proj-orchestrator'], mfa: true, mfaMethod: 'webauthn', status: 'active', lastLogin: ago(25 * MIN), createdAt: ago(430 * DAY), sso: true, tags: tags({ team: 'compass' }),
      sessions: [sess('sess-007', 'browser', 'Chrome 131 · macOS', '203.0.113.188', 'Berlin, DE', 6 * HOUR, 25 * MIN), sess('sess-008', 'cli', 'autark CLI 1.8 · macOS', '203.0.113.188', 'Berlin, DE', 12 * DAY, 1 * DAY)],
      apiTokens: [{ id: 'tok-u004', name: 'local-dev', prefix: 'atk_live_j4h0', createdAt: ago(25 * DAY), expiresAt: ahead(5 * DAY), lastUsed: ago(1 * DAY), status: 'active', lastUsedIp: '203.0.113.188' }] },
    { id: 'user-006', name: 'Markus Weber', email: 'markus.weber@regiocom-energie.de', title: 'Lead Developer Orchestrator', roleIds: ['role-developer'], projectIds: ['proj-orchestrator', 'proj-compass'], mfa: true, mfaMethod: 'totp', status: 'active', lastLogin: ago(4 * HOUR), createdAt: ago(510 * DAY), sso: true, tags: tags({ team: 'orchestrator' }),
      sessions: [sess('sess-009', 'browser', 'Firefox 133 · Fedora', OFFICE_MD, 'Magdeburg, DE', 8 * HOUR, 4 * HOUR)], apiTokens: [] },
    { id: 'user-007', name: 'Anna Fischer', email: 'anna.fischer@regiocom-energie.de', title: 'Web & Marketing', roleIds: ['role-developer'], projectIds: ['proj-website'], mfa: false, mfaMethod: null, status: 'active', lastLogin: ago(2 * DAY), createdAt: ago(300 * DAY), sso: true, tags: tags({ team: 'marketing' }), sessions: [], apiTokens: [] },
    { id: 'user-008', name: 'Sabine Krüger', email: 'sabine.krueger@regiocom-energie.de', title: 'Controlling', roleIds: ['role-billing', 'role-viewer'], projectIds: REGIOCOM_PROJECTS, mfa: true, mfaMethod: 'totp', status: 'active', lastLogin: ago(4 * DAY), createdAt: ago(350 * DAY), sso: true, tags: tags({ team: 'controlling' }), sessions: [], apiTokens: [] },
    { id: 'user-009', name: 'Richard Lohwasser', email: 'richard@enneo.ai', title: 'Enneo · Platform Engineering', roleIds: ['role-ops', 'role-ai-platform'], projectIds: ENNEO_PROJECTS, mfa: true, mfaMethod: 'webauthn', status: 'active', lastLogin: ago(1 * HOUR), createdAt: ago(250 * DAY), sso: false, tags: tags({ company: 'enneo' }),
      sessions: [sess('sess-010', 'browser', 'Chrome 131 · macOS', '198.51.100.140', 'Munich, DE', 3 * HOUR, 1 * HOUR), sess('sess-011', 'cli', 'autark CLI 1.8 · macOS', '198.51.100.140', 'Munich, DE', 5 * DAY, 3 * HOUR)],
      apiTokens: [{ id: 'tok-u005', name: 'k8s-admin', prefix: 'atk_live_e7e0', createdAt: ago(60 * DAY), expiresAt: ahead(30 * DAY), lastUsed: ago(3 * HOUR), status: 'active', lastUsedIp: '198.51.100.140' }] },
    { id: 'user-010', name: 'Lena Vogt', email: 'lena@enneo.ai', title: 'Enneo · ML Engineer', roleIds: ['role-ai-platform'], projectIds: ['proj-enneo-regiocom'], mfa: true, mfaMethod: 'totp', status: 'active', lastLogin: ago(6 * HOUR), createdAt: ago(140 * DAY), sso: false, tags: tags({ company: 'enneo' }), sessions: [], apiTokens: [] },
    { id: 'user-011', name: 'Lukas Neumann', email: 'lukas.neumann@regiocom-energie.de', title: 'Working student DevOps', roleIds: ['role-developer'], projectIds: ['proj-tools'], mfa: false, mfaMethod: null, mfaRequired: true, status: 'invited', lastLogin: null, createdAt: ago(1 * DAY), sso: true, tags: tags({ team: 'it-infrastruktur' }),
      invitedAt: ago(1 * DAY), invitedBy: ME, inviteExpiresAt: ahead(6 * DAY), sessions: [], apiTokens: [] },
    { id: 'user-012', name: 'Frank Meier', email: 'frank.meier@extern.regiocom-energie.de', title: 'External SAP consultant (contract ended)', roleIds: ['role-sap-basis'], projectIds: ['proj-isu'], mfa: true, mfaMethod: 'totp', status: 'disabled', lastLogin: ago(46 * DAY), createdAt: ago(400 * DAY), sso: false, tags: tags({ company: 'extern' }), disabledAt: ago(40 * DAY), sessions: [], apiTokens: [] },
  ];

  const all = ['*'] as const;
  const full = (...svcs: Service[]) => Object.fromEntries(svcs.map((s) => [s, [...all]]));
  const roles: Role[] = [
    { id: 'role-admin', name: 'Administrator', description: 'Full access to every service, IAM and billing.', system: true, createdAt: ago(715 * DAY), tags: [],
      permissions: full('compute', 'storage', 'network', 'dns', 'db', 'k8s', 'objectStorage', 'loadBalancers', 'hardware', 'iam', 'billing') },
    { id: 'role-ops', name: 'Operations', description: 'Operate all infrastructure and hardware. Read-only IAM.', system: true, createdAt: ago(715 * DAY), tags: [],
      permissions: { ...full('compute', 'storage', 'network', 'dns', 'db', 'k8s', 'objectStorage', 'loadBalancers', 'hardware'), iam: ['read'], billing: ['read'] } },
    { id: 'role-developer', name: 'Developer', description: 'Create and operate workloads in assigned projects. No network or hardware changes.', system: true, createdAt: ago(715 * DAY), tags: [],
      permissions: { compute: ['read', 'create', 'update', 'operate'], storage: ['read', 'create', 'update'], network: ['read'], dns: ['read', 'update'], db: ['read', 'create', 'update', 'operate'], k8s: ['read', 'create', 'update', 'operate'], objectStorage: ['read', 'create', 'update'], loadBalancers: ['read'], hardware: ['read'], iam: ['read'] } },
    { id: 'role-viewer', name: 'Viewer', description: 'Read-only access to all resources.', system: true, createdAt: ago(715 * DAY), tags: [],
      permissions: { compute: ['read'], storage: ['read'], network: ['read'], dns: ['read'], db: ['read'], k8s: ['read'], objectStorage: ['read'], loadBalancers: ['read'], hardware: ['read'], iam: ['read'], billing: ['read'] } },
    { id: 'role-billing', name: 'Billing Admin', description: 'Manage budgets, allowances and cost reports.', system: true, createdAt: ago(715 * DAY), tags: [],
      permissions: { billing: [...all], iam: ['read'] } },
    { id: 'role-sap-basis', name: 'SAP Basis', description: 'Operate SAP systems: large-memory VMs, HANA volumes, snapshots and backups. No network changes.', system: false, createdAt: ago(470 * DAY), tags: tags({ team: 'sap-basis' }),
      permissions: { compute: ['read', 'create', 'update', 'operate'], storage: ['read', 'create', 'update', 'operate'], objectStorage: ['read', 'create', 'update'], network: ['read'], dns: ['read'], hardware: ['read'], billing: ['read'] } },
    { id: 'role-compass-dev', name: 'Compass Developer', description: 'Deploy and operate Compass ERP: app servers, Kubernetes workloads, database parameters and buckets.', system: false, createdAt: ago(420 * DAY), tags: tags({ team: 'compass' }),
      permissions: { compute: ['read', 'update', 'operate'], storage: ['read'], network: ['read'], dns: ['read'], db: ['read', 'update', 'operate'], k8s: ['read', 'create', 'update', 'operate'], objectStorage: ['read', 'create', 'update'], loadBalancers: ['read', 'update'] } },
    { id: 'role-ai-platform', name: 'AI Platform Engineer', description: 'Kubernetes workloads (LLM gateway, embeddings), VMs and object storage for the Enneo AI platform.', system: false, createdAt: ago(230 * DAY), tags: tags({ company: 'enneo' }),
      permissions: { compute: ['read', 'create', 'update', 'delete', 'operate'], storage: ['read', 'create', 'update', 'delete'], k8s: ['read', 'create', 'update', 'operate'], objectStorage: [...all], network: ['read'], hardware: ['read'] } },
  ];

  const systemAccounts: SystemAccount[] = [
    { id: 'svc-001', name: 'gitlab-ci', description: 'GitLab pipelines deploying Compass, Orchestrator and the website', roleIds: ['role-developer'], projectIds: ['proj-compass', 'proj-orchestrator', 'proj-website', 'proj-tools'],
      tokens: [
        { id: 'tok-001', name: 'gitlab-prod', prefix: 'atk_live_3f9a', createdAt: ago(60 * DAY), expiresAt: ahead(30 * DAY), lastUsed: ago(12 * MIN), status: 'active', lastUsedIp: '10.51.1.11' },
        { id: 'tok-002', name: 'gitlab-old', prefix: 'atk_live_91c2', createdAt: ago(200 * DAY), expiresAt: ago(10 * DAY), lastUsed: ago(12 * DAY), status: 'expired' },
      ], ipAllowlist: ['10.51.1.0/24', '10.50.1.10/32'], tagConditions: [], createdAt: ago(600 * DAY), lastUsed: ago(12 * MIN), tags: tags({ owner: 'it-infrastruktur' }) },
    { id: 'svc-002', name: 'terraform', description: 'Infrastructure-as-code pipeline (terraform-provider-autark, Atlantis)', roleIds: ['role-ops'], projectIds: REGIOCOM_PROJECTS,
      tokens: [{ id: 'tok-003', name: 'atlantis', prefix: 'atk_live_77de', createdAt: ago(20 * DAY), expiresAt: ahead(70 * DAY), lastUsed: ago(2 * HOUR), status: 'active', lastUsedIp: '10.50.1.10' }],
      ipAllowlist: ['10.50.1.0/24'], tagConditions: tags({ 'managed-by': 'terraform' }), createdAt: ago(500 * DAY), lastUsed: ago(2 * HOUR), tags: [] },
    { id: 'svc-003', name: 'prometheus-exporter', description: 'Prometheus exporter reading usage, health and cost metrics', roleIds: ['role-viewer'], projectIds: '*',
      tokens: [{ id: 'tok-004', name: 'prometheus', prefix: 'atk_live_c0de', createdAt: ago(90 * DAY), expiresAt: null, lastUsed: ago(1 * MIN), status: 'active', lastUsedIp: '10.50.1.20' }],
      ipAllowlist: ['10.50.1.20/32'], tagConditions: [], createdAt: ago(450 * DAY), lastUsed: ago(1 * MIN), tags: [] },
    { id: 'svc-004', name: 'enneo-deployer', description: 'Argo CD / GitHub Actions (enneo-ci-runner) deploying the Enneo platform to p6 and p9', roleIds: ['role-developer'], projectIds: ['proj-enneo-regiocom'],
      tokens: [{ id: 'tok-005', name: 'argocd', prefix: 'atk_live_e44e', createdAt: ago(35 * DAY), expiresAt: ahead(55 * DAY), lastUsed: ago(20 * MIN), status: 'active', lastUsedIp: '10.71.1.11' }],
      ipAllowlist: ['10.71.1.11/32', '10.60.16.0/20'], tagConditions: [], createdAt: ago(230 * DAY), lastUsed: ago(20 * MIN), tags: tags({ company: 'enneo' }) },
  ];

  const ALL_SVC: Service[] = ['compute', 'network', 'storage', 'db', 'k8s', 'objectStorage', 'dns', 'loadBalancers'];
  const al = (projectId: string, name: string, budgetMonthly: number, quotas: ProjectAllowance['quotas'], allowedLocations: string[], o: Partial<ProjectAllowance> = {}): ProjectAllowance => ({
    id: `allow-${projectId}`, name, projectId, accountId: projectAccount[projectId], budgetMonthly, alertThresholds: [80, 100], hardLimit: false, quotas,
    allowedServices: ALL_SVC, allowedLocations, requiredTags: projectAccount[projectId] === R ? ['env', 'kostenstelle'] : [], createdAt: ago(400 * DAY), tags: [], ...o,
  });
  const allowances: ProjectAllowance[] = [
    al('proj-compass', 'Compass ERP', 4500, { vcpus: 192, ramGB: 768, vms: 20, volumesGB: 6000, dbInstances: 4, k8sClusters: 1, buckets: 6, publicIps: 6 }, ['dc1', 'dc2'], { alertThresholds: [50, 80, 100] }),
    al('proj-orchestrator', 'Orchestrator', 2500, { vcpus: 160, ramGB: 640, vms: 10, volumesGB: 3000, dbInstances: 3, k8sClusters: 2, buckets: 4, publicIps: 4 }, ['dc1', 'dc2']),
    al('proj-isu', 'SAP IS/U', 5500, { vcpus: 192, ramGB: 1536, vms: 10, volumesGB: 16000, dbInstances: 1, k8sClusters: 0, buckets: 3, publicIps: 0 }, ['dc1', 'dc2'],
      { allowedServices: ['compute', 'network', 'storage', 'objectStorage', 'dns'], hardLimit: true, alertThresholds: [80, 90, 100] }),
    al('proj-s4', 'SAP S4', 2500, { vcpus: 96, ramGB: 768, vms: 8, volumesGB: 6000, dbInstances: 1, k8sClusters: 0, buckets: 2, publicIps: 1 }, ['dc1'],
      { allowedServices: ['compute', 'network', 'storage', 'objectStorage', 'dns'], alertThresholds: [50, 80, 100] }),
    al('proj-website', 'Website', 350, { vcpus: 16, ramGB: 48, vms: 5, volumesGB: 500, dbInstances: 1, k8sClusters: 0, buckets: 2, publicIps: 3 }, ['dc2', 'dc1', 'aws-eu-central-1'],
      { allowedServices: ['compute', 'network', 'storage', 'db', 'objectStorage', 'dns', 'loadBalancers'] }),
    al('proj-tools', 'Interne Tools', 1300, { vcpus: 64, ramGB: 192, vms: 12, volumesGB: 8000, dbInstances: 1, k8sClusters: 1, buckets: 4, publicIps: 4 }, ['dc1', 'dc2', 'hetzner-fsn1', 'hetzner-nbg1']),
    al('proj-enneo-regiocom', 'Regiocom prod', BUDGET_EP, { vcpus: 16, ramGB: 32, vms: 4, volumesGB: 500, dbInstances: 0, k8sClusters: 2, buckets: 0, publicIps: 8 }, ['dc1'],
      { allowedServices: ['compute', 'network', 'k8s', 'dns'] }),
    al('proj-enneo-intern', 'Enneo-intern', BUDGET_EI, { vcpus: 48, ramGB: 128, vms: 6, volumesGB: 6000, dbInstances: 0, k8sClusters: 0, buckets: 0, publicIps: 2 }, ['dc1', 'dc2'],
      { allowedServices: ['compute', 'network', 'storage', 'dns'], hardLimit: true, alertThresholds: [50, 80, 100] }),
  ];

  const T = (type: AuditEvent['target']['type'], id: string, name: string) => ({ type, id, name });
  const history: [string, AuditEvent['target'], string, string, AuditEvent['result']?, string?][] = [
    ['vm.resize', T('vm', 'vm-005', 'compass-billing-2'), ME, 'proj-compass', 'success', '16 → 32 vCPU / 64 → 128 GB for Turnusabrechnung'],
    ['volume.snapshot', T('volume', 'vol-007', 'isu-hana-data'), 'system', 'proj-isu', 'success', 'HANA data backup → isu-hana-backups (RZ Frankfurt)'],
    ['provider.sync', T('provider', 'provider-ovh', 'OVHcloud'), 'system', '', 'failure', 'Authentication failed: application key expired'],
    ['k8s.scale', T('k8s', 'k8s-001', 'orchestrator-prod'), 'svc:terraform', 'proj-orchestrator', 'success', 'workers 4 → 6'],
    ['db.backup', T('db', 'db-001', 'compass-db'), 'system', 'proj-compass'],
    ['vm.reboot', T('vm', 'vm-028', 'sip-proxy-1'), 'richard@enneo.ai', 'proj-enneo-regiocom', 'success', 'Kernel update — calls failed over to sip-proxy-2 (keepalived)'],
    ['firewall.update', T('firewall', 'fw-008', 'sap-isu'), 'thomas.becker@regiocom-energie.de', 'proj-isu', 'success', 'rules: RFC 3300-3399 from vpc-orchestrator'],
    ['lb.update', T('lb', 'lb-001', 'compass-lb'), 'jana.hoffmann@regiocom-energie.de', 'proj-compass', 'success', 'listeners: /api → compass-api'],
    ['bareMetal.maintenance', T('bareMetal', 'bm-004', 'mdg-hv-04'), 'katrin.schulze@regiocom-energie.de', '', 'success', 'DIMM B3 replacement (OPS-1182)'],
    ['user.invite', T('user', 'user-011', 'lukas.neumann@regiocom-energie.de'), ME, ''],
    ['k8s.upgrade', T('k8s', 'k8s-003', 'p9'), 'richard@enneo.ai', 'proj-enneo-regiocom', 'success', '1.31 → 1.32'],
    ['dnsZone.update', T('dnsZone', 'zone-001', 'regiocom-energie.de'), 'stefan.wagner@regiocom-energie.de', 'proj-website', 'success', 'records: CAA iodef, DMARC p=reject'],
    ['bucket.update', T('bucket', 'bkt-001', 'compass-invoices'), 'svc:terraform', 'proj-compass', 'success', 'objectLock: compliance 3650 days (GoBD)'],
    ['vm.snapshot', T('vm', 'vm-017', 'gitlab'), 'katrin.schulze@regiocom-energie.de', 'proj-tools', 'success', 'Before GitLab 17.5 upgrade'],
    ['user.disable', T('user', 'user-012', 'frank.meier@extern.regiocom-energie.de'), ME, '', 'success', 'Contract ended'],
    ['volume.resize', T('volume', 'vol-007', 'isu-hana-data'), 'thomas.becker@regiocom-energie.de', 'proj-isu', 'success', '2500 → 3000 GB'],
    ['vm.create', T('vm', 'vm-013', 's4-webdispatcher'), 'thomas.becker@regiocom-energie.de', 'proj-s4'],
    ['systemAccount.rotate', T('systemAccount', 'svc-002', 'terraform'), ME, ''],
    ['k8s.deploy', T('k8s', 'k8s-002', 'p6'), 'svc:enneo-deployer', 'proj-enneo-regiocom', 'success', 'enneo-api 4.18.0 → 4.19.1'],
    ['dnsZone.create', T('dnsZone', 'zone-007', 'e-wie-einfach.enneo.ai'), 'richard@enneo.ai', 'proj-enneo-regiocom', 'success', 'A @ → p6 node IPs (203.0.113.40–42)'],
    ['ip.allocate', T('ip', 'ip-009', '203.0.113.11'), 'jana.hoffmann@regiocom-energie.de', 'proj-compass'],
    ['role.update', T('role', 'role-sap-basis', 'SAP Basis'), ME, ''],
    ['bareMetal.offline', T('bareMetal', 'bm-017', 'fra-hv-04'), 'system', '', 'failure', 'PSU 2 failure — VMs evacuated to fra-hv-01/02'],
    ['allowance.update', T('allowance', 'allow-proj-s4', 'SAP S4'), 'sabine.krueger@regiocom-energie.de', 'proj-s4', 'success', 'budgetMonthly 2200 → 2500'],
    ['vm.start', T('vm', 'vm-016', 'website-dr'), 'stefan.wagner@regiocom-energie.de', 'proj-website', 'success', 'Quarterly DR drill'],
    ['vm.stop', T('vm', 'vm-016', 'website-dr'), 'stefan.wagner@regiocom-energie.de', 'proj-website', 'success', 'DR drill finished'],
  ];
  const auditLog: AuditEvent[] = history.map(([action, target, actor, projectId, result, details], i) => ({
    id: `evt-h${String(i).padStart(3, '0')}`,
    when: ago((i * 6 + 2) * HOUR + i * 13 * MIN),
    actor, action, target, result: result ?? 'success', details,
    accountId: projectId ? projectAccount[projectId] : actor.endsWith('@enneo.ai') ? E : R,
    projectId: projectId || undefined,
    sourceIp: actor === 'system' ? undefined : actor.startsWith('svc:') ? '10.50.1.10' : actor.endsWith('@enneo.ai') ? '198.51.100.140' : OFFICE_MD,
    via: actor === 'system' ? 'system' : actor === 'svc:terraform' ? 'terraform' : actor.startsWith('svc:') ? 'api' : 'console',
  }));

  const notifications: Notification[] = [
    { id: 'ntf-001', level: 'warning', title: 'Certificate expiring soon', message: 'mako.regiocom-energie.de (AS4, SM-PKI) expires in 12 days. Custom certificates cannot auto-renew — upload the renewed certificate.', time: ago(2 * HOUR), read: false, link: '/managed-services/load-balancers?tab=certificates', accountId: R },
    { id: 'ntf-002', level: 'error', title: 'Host fra-hv-04 offline', message: 'BMC reports PSU 2 failure in RZ Frankfurt. Workloads were evacuated automatically to fra-hv-01 and fra-hv-02.', time: ago(5 * HOUR), read: false, link: '/hardware/bare-metals/bm-017', accountId: R },
    { id: 'ntf-003', level: 'success', title: 'HANA backup completed', message: 'isu-hana-db: full data backup (1.9 TB) copied to isu-hana-backups in RZ Frankfurt.', time: ago(7 * HOUR), read: true, link: '/infrastructure/vms/vm-007', accountId: R },
    { id: 'ntf-004', level: 'info', title: 'Kubernetes 1.32 available', message: 'orchestrator-prod runs 1.31. Upgrade is available with zero-downtime surge.', time: ago(1 * DAY), read: false, link: '/managed-services/kubernetes/k8s-001', accountId: R },
    { id: 'ntf-005', level: 'warning', title: 'Budget 80% reached', message: 'SAP S4 has used 84% of its monthly budget (migration test cycle 3).', time: ago(1 * DAY + 3 * HOUR), read: false, link: '/iam/project-allowances/allow-proj-s4', accountId: R },
    { id: 'ntf-006', level: 'error', title: 'OVHcloud sync failed', message: 'Authentication failed: application key expired. Rotate credentials.', time: ago(30 * MIN), read: false, link: '/hardware/cloud-providers/provider-ovh', accountId: R },
    { id: 'ntf-007', level: 'success', title: 'Billing run capacity ready', message: 'compass-billing-2 resized to 32 vCPU / 128 GB for the Turnusabrechnung run tonight.', time: ago(3 * HOUR), read: false, link: '/infrastructure/vms/vm-005', accountId: R },
    { id: 'ntf-008', level: 'warning', title: 'Host certificate expiring', message: 'The agent TLS certificate of fra-hv-04 (installed 2023) expires in 6 days. Renew it once the host is back online.', time: ago(9 * HOUR), read: false, link: '/hardware/bare-metals/bm-017', accountId: R },
    { id: 'ntf-009', level: 'warning', title: 'Disk degrading on mdg-stor-02', message: 'sd7 reports 48 reallocated sectors. Ceph OSD.31 is marked out; data is re-replicating.', time: ago(14 * HOUR), read: true, link: '/hardware/bare-metals/bm-011', accountId: R },
    { id: 'ntf-010', level: 'warning', title: 'Monitoring disk 81% full', message: 'enneo-prometheus-tsdb on enneo-monitoring is 81% full. Resize the volume or lower Prometheus retention (currently 30 days).', time: ago(6 * HOUR), read: false, link: '/infrastructure/vms/vm-025', accountId: E },
    { id: 'ntf-011', level: 'success', title: 'p9 upgraded', message: 'Staging cluster p9: Kubernetes 1.31 → 1.32 completed. All workloads healthy — p6 can follow in its Saturday window.', time: ago(2 * DAY), read: true, link: '/managed-services/kubernetes/k8s-003', accountId: E },
  ];

  const mkOp = (id: string, type: string, title: string, target: Operation['target'], projectId: string, whenMs: number, steps: string[], actor = ME, status: Operation['status'] = 'succeeded', error?: string): Operation => {
    const start = Date.now() - whenMs;
    let t = start;
    return {
      id, type, title, target, projectId: projectId || undefined, accountId: projectAccount[projectId] ?? R, actor, status, progress: status === 'succeeded' ? 1 : 0.6,
      createdAt: new Date(start).toISOString(), startedAt: new Date(start).toISOString(), finishedAt: new Date(start + steps.length * 2500).toISOString(), error,
      steps: steps.map((name, i) => {
        const s = { name, status: (status === 'failed' && i === steps.length - 1 ? 'failed' : 'done') as Operation['steps'][number]['status'], durationMs: 2500, startedAt: new Date(t).toISOString(), finishedAt: new Date(t + 2500).toISOString(), logs: [] as string[] };
        if (s.status === 'failed' && error) s.logs = [`ERROR: ${error}`];
        t += 2500;
        return s;
      }),
    };
  };
  const operations: Operation[] = [
    mkOp('op-h001', 'vm.resize', 'Resize compass-billing-2 for Turnusabrechnung', { type: 'vm', id: 'vm-005', name: 'compass-billing-2' }, 'proj-compass', 3 * HOUR, ['Validate request', 'Check host capacity on mdg-hv-02', 'Stop batch worker gracefully', 'Apply new size (32 vCPU / 128 GB)', 'Start & health check']),
    mkOp('op-h002', 'volume.snapshot', 'HANA backup isu-hana-db', { type: 'volume', id: 'vol-007', name: 'isu-hana-data' }, 'proj-isu', 7 * HOUR, ['BACKUP DATA savepoint', 'Snapshot isu-hana-data & isu-hana-log', 'Copy to isu-hana-backups (RZ Frankfurt)', 'Verify checksum & catalog'], 'system'),
    mkOp('op-h003', 'vm.reboot', 'Reboot sip-proxy-1', { type: 'vm', id: 'vm-028', name: 'sip-proxy-1' }, 'proj-enneo-regiocom', 6 * HOUR, ['Validate request', 'Graceful shutdown (keepalived hands VIP to sip-proxy-2)', 'Start & health check'], 'richard@enneo.ai'),
    mkOp('op-h004', 'provider.sync', 'Sync OVHcloud inventory', { type: 'provider', id: 'provider-ovh', name: 'OVHcloud' }, '', 30 * MIN, ['Authenticate'], 'system', 'failed', 'Authentication failed: application key expired'),
    mkOp('op-h005', 'k8s.upgrade', 'Upgrade p9 to 1.32', { type: 'k8s', id: 'k8s-003', name: 'p9' }, 'proj-enneo-regiocom', 2 * DAY, ['Pre-flight checks', 'Upgrade control plane', 'Surge upgrade workers', 'Verify workloads'], 'richard@enneo.ai'),
    mkOp('op-h006', 'db.backup', 'Backup compass-db', { type: 'db', id: 'db-001', name: 'compass-db' }, 'proj-compass', 9 * HOUR, ['Snapshot WAL', 'Upload to backup store'], 'system'),
    mkOp('op-h007', 'bareMetal.evacuate', 'Evacuate mdg-hv-04 for maintenance', { type: 'bareMetal', id: 'bm-004', name: 'mdg-hv-04' }, '', 2 * DAY + 4 * HOUR, ['Plan moves', 'Live-migrate 6 VMs', 'Cordon Kubernetes nodes', 'Enter maintenance mode'], 'katrin.schulze@regiocom-energie.de'),
    mkOp('op-h008', 'k8s.scale', 'Scale orchestrator-prod/workers to 6 nodes', { type: 'k8s', id: 'k8s-001', name: 'orchestrator-prod' }, 'proj-orchestrator', 4 * DAY, ['Reserve capacity', 'Provision 2 nodes', 'Join cluster', 'Rebalance pods'], 'svc:terraform'),
  ];

  return { accounts, projects, locations, users, roles, systemAccounts, allowances, auditLog, notifications, operations };
}
