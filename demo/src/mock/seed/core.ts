import type { Account, Project, Location, User, Role, SystemAccount, ProjectAllowance, AuditEvent, Notification, Operation } from '@/types';
import { ago, ahead, tags, A, B, DAY, HOUR, MIN } from './util';

export function seedCore() {
  const accounts: Account[] = [
    { id: A, name: 'MyCompany · Country Branch A', plan: 'enterprise' },
    { id: B, name: 'MyCompany · Division B', plan: 'community' },
  ];
  const projects: Project[] = [
    { id: 'proj-app1', accountId: A, name: 'Business App 1', description: 'Customer-facing web shop and APIs', color: '#5b67f8', createdAt: ago(400 * DAY) },
    { id: 'proj-app2', accountId: A, name: 'Customer App 2', description: 'B2B portal, staging & production', color: '#06b6d4', createdAt: ago(300 * DAY) },
    { id: 'proj-ml', accountId: B, name: 'ML Platform', description: 'Model training, serving and notebooks', color: '#a855f7', createdAt: ago(200 * DAY) },
    { id: 'proj-infra', accountId: B, name: 'Shared Infra', description: 'CI runners, monitoring, VPN, backups', color: '#f59e0b', createdAt: ago(380 * DAY) },
  ];
  const locations: Location[] = [
    { id: 'dc1', name: 'On-Prem DC1', kind: 'selfHosted', city: 'Frankfurt', country: 'DE', lat: 50.11, lon: 8.68 },
    { id: 'dc2', name: 'On-Prem DC2', kind: 'selfHosted', city: 'Amsterdam', country: 'NL', lat: 52.37, lon: 4.9 },
    { id: 'hetzner-nbg1', name: 'Hetzner nbg1', kind: 'cloud', providerId: 'provider-hetzner', region: 'nbg1', city: 'Nuremberg', country: 'DE', lat: 49.45, lon: 11.08 },
    { id: 'hetzner-hel1', name: 'Hetzner hel1', kind: 'cloud', providerId: 'provider-hetzner', region: 'hel1', city: 'Helsinki', country: 'FI', lat: 60.17, lon: 24.94 },
    { id: 'hetzner-ash', name: 'Hetzner ash', kind: 'cloud', providerId: 'provider-hetzner', region: 'ash', city: 'Ashburn', country: 'US', lat: 39.04, lon: -77.49 },
    { id: 'aws-eu-central-1', name: 'AWS eu-central-1', kind: 'cloud', providerId: 'provider-aws', region: 'eu-central-1', city: 'Frankfurt', country: 'DE', lat: 50.0, lon: 8.9 },
    { id: 'aws-eu-west-1', name: 'AWS eu-west-1', kind: 'cloud', providerId: 'provider-aws', region: 'eu-west-1', city: 'Dublin', country: 'IE', lat: 53.35, lon: -6.26 },
    { id: 'ovh-gra', name: 'OVHcloud GRA', kind: 'cloud', providerId: 'provider-ovh', region: 'GRA', city: 'Gravelines', country: 'FR', lat: 50.99, lon: 2.13 },
  ];
  const sess = (id: string, kind: 'browser' | 'cli' | 'mobile', device: string, ip: string, location: string, created: number, active: number, current?: boolean) =>
    ({ id, kind, device, ip, location, createdAt: ago(created), lastActive: ago(active), ...(current ? { current } : {}) });
  const users: User[] = [
    { id: 'user-001', name: 'Alice Admin', email: 'alice@example.com', title: 'Head of Platform', roleIds: ['role-admin'], projectIds: '*', mfa: true, mfaMethod: 'webauthn', mfaRequired: true, status: 'active', lastLogin: ago(5 * MIN), createdAt: ago(400 * DAY), sso: true, tags: [],
      sessions: [
        sess('sess-001', 'browser', 'Chrome 131 · macOS', '192.0.2.44', 'Frankfurt, DE', 2 * HOUR, 1 * MIN, true),
        sess('sess-002', 'cli', 'autark CLI 1.8 · Linux', '192.0.2.44', 'Frankfurt, DE', 3 * DAY, 4 * HOUR),
        sess('sess-003', 'mobile', 'iPhone · Safari', '198.51.100.71', 'Mainz, DE', 6 * DAY, 1 * DAY),
      ],
      apiTokens: [
        { id: 'tok-u001', name: 'laptop-cli', prefix: 'atk_live_a11c', createdAt: ago(40 * DAY), expiresAt: ahead(50 * DAY), lastUsed: ago(4 * HOUR), status: 'active', lastUsedIp: '192.0.2.44' },
        { id: 'tok-u002', name: 'grafana-test', prefix: 'atk_live_0b7e', createdAt: ago(120 * DAY), expiresAt: ago(30 * DAY), lastUsed: ago(35 * DAY), status: 'expired' },
      ] },
    { id: 'user-002', name: 'Bob Dev', email: 'bob@example.com', title: 'Senior Backend Engineer', roleIds: ['role-developer'], projectIds: ['proj-app1', 'proj-app2'], mfa: false, mfaMethod: null, status: 'active', lastLogin: ago(3 * HOUR), createdAt: ago(320 * DAY), sso: true, tags: tags({ team: 'web' }),
      sessions: [sess('sess-004', 'browser', 'Firefox 133 · Ubuntu', '203.0.113.88', 'Hamburg, DE', 9 * HOUR, 3 * HOUR), sess('sess-005', 'cli', 'autark CLI 1.8 · macOS', '203.0.113.88', 'Hamburg, DE', 12 * DAY, 2 * DAY)],
      apiTokens: [{ id: 'tok-u003', name: 'local-dev', prefix: 'atk_live_b0b1', createdAt: ago(25 * DAY), expiresAt: ahead(5 * DAY), lastUsed: ago(1 * DAY), status: 'active', lastUsedIp: '203.0.113.88' }] },
    { id: 'user-003', name: 'Olivia Ops', email: 'olivia@example.com', title: 'SRE (on leave)', roleIds: ['role-ops'], projectIds: '*', mfa: true, mfaMethod: 'totp', status: 'disabled', lastLogin: ago(26 * DAY), createdAt: ago(380 * DAY), sso: false, tags: tags({ team: 'platform' }), disabledAt: ago(20 * DAY), sessions: [], apiTokens: [] },
    { id: 'user-004', name: 'Charlie Infra', email: 'charlie@example.com', title: 'Infrastructure Engineer', roleIds: ['role-ops'], projectIds: '*', mfa: true, mfaMethod: 'totp', status: 'active', lastLogin: ago(40 * MIN), createdAt: ago(250 * DAY), sso: true, tags: tags({ team: 'platform' }),
      sessions: [sess('sess-006', 'browser', 'Edge 131 · Windows', '192.0.2.61', 'Frankfurt, DE', 5 * HOUR, 40 * MIN)],
      apiTokens: [{ id: 'tok-u004', name: 'ansible', prefix: 'atk_live_c4a7', createdAt: ago(80 * DAY), expiresAt: null, lastUsed: ago(6 * HOUR), status: 'active', lastUsedIp: '10.50.1.12' }] },
    { id: 'user-005', name: 'Dana Data', email: 'dana@example.com', title: 'ML Engineer', roleIds: ['role-developer', 'role-ml'], projectIds: ['proj-ml'], mfa: true, mfaMethod: 'webauthn', status: 'active', lastLogin: ago(2 * HOUR), createdAt: ago(190 * DAY), sso: true, tags: tags({ team: 'ml' }),
      sessions: [sess('sess-007', 'browser', 'Chrome 131 · macOS', '198.51.100.12', 'Amsterdam, NL', 1 * DAY, 2 * HOUR)], apiTokens: [] },
    { id: 'user-006', name: 'Erik Finance', email: 'erik@example.com', title: 'FinOps Lead', roleIds: ['role-billing', 'role-viewer'], projectIds: '*', mfa: true, mfaMethod: 'totp', status: 'active', lastLogin: ago(4 * DAY), createdAt: ago(150 * DAY), sso: true, tags: tags({ team: 'finance' }), sessions: [], apiTokens: [] },
    { id: 'user-007', name: 'Fatima New', email: 'fatima@example.com', title: 'Frontend Engineer', roleIds: ['role-developer'], projectIds: ['proj-app2'], mfa: false, mfaMethod: null, mfaRequired: true, status: 'invited', lastLogin: null, createdAt: ago(1 * DAY), sso: false, tags: [],
      invitedAt: ago(1 * DAY), invitedBy: 'alice@example.com', inviteExpiresAt: ahead(6 * DAY), sessions: [], apiTokens: [] },
  ];
  const all = ['*'] as const;
  const roles: Role[] = [
    { id: 'role-admin', name: 'Administrator', description: 'Full access to every service, IAM and billing.', system: true, createdAt: ago(400 * DAY), tags: [],
      permissions: { compute: [...all], storage: [...all], network: [...all], dns: [...all], db: [...all], k8s: [...all], objectStorage: [...all], loadBalancers: [...all], hardware: [...all], iam: [...all], billing: [...all] } },
    { id: 'role-ops', name: 'Operations', description: 'Operate all infrastructure and hardware. Read-only IAM.', system: true, createdAt: ago(400 * DAY), tags: [],
      permissions: { compute: [...all], storage: [...all], network: [...all], dns: [...all], db: [...all], k8s: [...all], objectStorage: [...all], loadBalancers: [...all], hardware: [...all], iam: ['read'], billing: ['read'] } },
    { id: 'role-developer', name: 'Developer', description: 'Create and operate workloads in assigned projects. No network or hardware changes.', system: true, createdAt: ago(400 * DAY), tags: [],
      permissions: { compute: ['read', 'create', 'update', 'operate'], storage: ['read', 'create', 'update'], network: ['read'], dns: ['read', 'update'], db: ['read', 'create', 'update', 'operate'], k8s: ['read', 'create', 'update', 'operate'], objectStorage: ['read', 'create', 'update'], loadBalancers: ['read'], hardware: ['read'], iam: ['read'] } },
    { id: 'role-viewer', name: 'Viewer', description: 'Read-only access to all resources.', system: true, createdAt: ago(400 * DAY), tags: [],
      permissions: { compute: ['read'], storage: ['read'], network: ['read'], dns: ['read'], db: ['read'], k8s: ['read'], objectStorage: ['read'], loadBalancers: ['read'], hardware: ['read'], iam: ['read'], billing: ['read'] } },
    { id: 'role-billing', name: 'Billing Admin', description: 'Manage budgets, allowances and cost reports.', system: true, createdAt: ago(400 * DAY), tags: [],
      permissions: { billing: [...all], iam: ['read'] } },
    { id: 'role-ml', name: 'ML Engineer', description: 'GPU compute, Kubernetes and object storage for ML workloads.', system: false, createdAt: ago(180 * DAY), tags: tags({ team: 'ml' }),
      permissions: { compute: ['read', 'create', 'update', 'delete', 'operate'], storage: ['read', 'create', 'update', 'delete'], k8s: ['read', 'create', 'update', 'operate'], objectStorage: [...all], network: ['read'] } },
  ];
  const systemAccounts: SystemAccount[] = [
    { id: 'svc-001', name: 'ci-cd', description: 'GitLab pipelines deploying to Kubernetes and VMs', roleIds: ['role-developer'], projectIds: ['proj-app1', 'proj-app2'],
      tokens: [
        { id: 'tok-001', name: 'gitlab-prod', prefix: 'atk_live_3f9a', createdAt: ago(60 * DAY), expiresAt: ahead(30 * DAY), lastUsed: ago(12 * MIN), status: 'active' },
        { id: 'tok-002', name: 'gitlab-old', prefix: 'atk_live_91c2', createdAt: ago(200 * DAY), expiresAt: ago(10 * DAY), lastUsed: ago(12 * DAY), status: 'expired' },
      ], ipAllowlist: ['203.0.113.0/24'], tagConditions: [], createdAt: ago(300 * DAY), lastUsed: ago(12 * MIN), tags: tags({ owner: 'platform' }) },
    { id: 'svc-002', name: 'terraform', description: 'Infrastructure-as-code pipeline (terraform-provider-autark)', roleIds: ['role-ops'], projectIds: '*',
      tokens: [{ id: 'tok-003', name: 'atlantis', prefix: 'atk_live_77de', createdAt: ago(20 * DAY), expiresAt: ahead(70 * DAY), lastUsed: ago(2 * HOUR), status: 'active' }],
      ipAllowlist: ['198.51.100.20/32'], tagConditions: tags({ 'managed-by': 'terraform' }), createdAt: ago(250 * DAY), lastUsed: ago(2 * HOUR), tags: [] },
    { id: 'svc-003', name: 'metrics-exporter', description: 'Prometheus exporter reading usage & health', roleIds: ['role-viewer'], projectIds: '*',
      tokens: [{ id: 'tok-004', name: 'prometheus', prefix: 'atk_live_c0de', createdAt: ago(90 * DAY), expiresAt: null, lastUsed: ago(1 * MIN), status: 'active' }],
      ipAllowlist: ['10.50.1.0/24'], tagConditions: [], createdAt: ago(90 * DAY), lastUsed: ago(1 * MIN), tags: [] },
  ];
  const allowances: ProjectAllowance[] = [
    { id: 'allow-proj-app1', name: 'Business App 1', projectId: 'proj-app1', accountId: A, budgetMonthly: 900, alertThresholds: [50, 80, 100], hardLimit: false,
      quotas: { vcpus: 96, ramGB: 256, vms: 20, volumesGB: 5000, dbInstances: 5, k8sClusters: 2, buckets: 10, publicIps: 20 },
      allowedServices: ['compute', 'network', 'storage', 'db', 'k8s', 'objectStorage', 'dns', 'loadBalancers'], allowedLocations: ['dc1', 'dc2', 'hetzner-nbg1'], requiredTags: ['env'], createdAt: ago(400 * DAY), tags: [] },
    { id: 'allow-proj-app2', name: 'Customer App 2', projectId: 'proj-app2', accountId: A, budgetMonthly: 600, alertThresholds: [80, 100], hardLimit: false,
      quotas: { vcpus: 64, ramGB: 192, vms: 15, volumesGB: 3000, dbInstances: 4, k8sClusters: 1, buckets: 5, publicIps: 10 },
      allowedServices: ['compute', 'network', 'storage', 'db', 'objectStorage', 'dns', 'loadBalancers'], allowedLocations: ['dc2'], requiredTags: ['env', 'app'], createdAt: ago(300 * DAY), tags: [] },
    { id: 'allow-proj-ml', name: 'ML Platform', projectId: 'proj-ml', accountId: B, budgetMonthly: 4200, alertThresholds: [50, 80, 100], hardLimit: true,
      quotas: { vcpus: 192, ramGB: 1024, vms: 30, volumesGB: 20000, dbInstances: 3, k8sClusters: 2, buckets: 10, publicIps: 10 },
      allowedServices: ['compute', 'network', 'storage', 'db', 'k8s', 'objectStorage'], allowedLocations: ['dc1', 'hetzner-nbg1', 'hetzner-hel1'], requiredTags: ['team'], createdAt: ago(200 * DAY), tags: [] },
    { id: 'allow-proj-infra', name: 'Shared Infra', projectId: 'proj-infra', accountId: B, budgetMonthly: 800, alertThresholds: [80, 100], hardLimit: false,
      quotas: { vcpus: 64, ramGB: 256, vms: 20, volumesGB: 10000, dbInstances: 2, k8sClusters: 2, buckets: 10, publicIps: 8 },
      allowedServices: ['compute', 'network', 'storage', 'k8s', 'objectStorage', 'dns'], allowedLocations: ['dc1', 'dc2'], requiredTags: [], createdAt: ago(380 * DAY), tags: [] },
  ];

  const actors = ['alice@example.com', 'bob@example.com', 'charlie@example.com', 'dana@example.com', 'svc:terraform', 'svc:ci-cd', 'system'];
  const history: [string, AuditEvent['target'], string, string, AuditEvent['result']?, string?][] = [
    ['vm.create', { type: 'vm', id: 'vm-001', name: 'web-1' }, 'alice@example.com', 'proj-app1'],
    ['vm.start', { type: 'vm', id: 'vm-003', name: 'web-2' }, 'bob@example.com', 'proj-app1'],
    ['firewall.update', { type: 'firewall', id: 'fw-002', name: 'web-allow' }, 'charlie@example.com', 'proj-app1', 'success', 'rules'],
    ['db.backup', { type: 'db', id: 'db-001', name: 'pg-app1' }, 'system', 'proj-app1'],
    ['k8s.scale', { type: 'k8s', id: 'k8s-001', name: 'app1-cluster' }, 'svc:ci-cd', 'proj-app1', 'success', 'web-pool 2 → 3'],
    ['vm.stop', { type: 'vm', id: 'vm-002', name: 'ml-gpu-1' }, 'dana@example.com', 'proj-ml'],
    ['bucket.update', { type: 'bucket', id: 'bkt-003', name: 'app2-logs' }, 'svc:terraform', 'proj-app2', 'success', 'lifecycleRules'],
    ['user.invite', { type: 'user', id: 'user-007', name: 'fatima@example.com' }, 'alice@example.com', ''],
    ['vm.create', { type: 'vm', id: 'vm-014', name: 'trainer-burst-1' }, 'dana@example.com', 'proj-ml', 'failure', 'Provider quota exceeded for H100 in nbg1'],
    ['lb.update', { type: 'lb', id: 'lb-001', name: 'web-lb' }, 'charlie@example.com', 'proj-app1', 'success', 'listeners'],
    ['dnsZone.update', { type: 'dnsZone', id: 'zone-001', name: 'example.com' }, 'bob@example.com', 'proj-app1', 'success', 'records'],
    ['bareMetal.maintenance', { type: 'bareMetal', id: 'bm-009', name: 'dc1-hv-04' }, 'charlie@example.com', ''],
    ['systemAccount.rotate', { type: 'systemAccount', id: 'svc-002', name: 'terraform' }, 'alice@example.com', ''],
    ['volume.resize', { type: 'volume', id: 'vol-006', name: 'ml-gpu-2-checkpoints' }, 'dana@example.com', 'proj-ml', 'success', '500 → 1000 GB'],
    ['k8s.upgrade', { type: 'k8s', id: 'k8s-002', name: 'ml-platform' }, 'svc:terraform', 'proj-ml', 'success', '1.30 → 1.31'],
    ['ip.allocate', { type: 'ip', id: 'ip-005', name: '203.0.113.13' }, 'bob@example.com', 'proj-app1'],
    ['provider.sync', { type: 'provider', id: 'provider-ovh', name: 'OVHcloud' }, 'system', '', 'failure', 'Authentication failed: application key expired'],
    ['vm.snapshot', { type: 'vm', id: 'vm-001', name: 'web-1' }, 'system', 'proj-app1'],
    ['role.update', { type: 'role', id: 'role-ml', name: 'ML Engineer' }, 'alice@example.com', ''],
    ['db.create', { type: 'db', id: 'db-004', name: 'pg-billing' }, 'svc:terraform', 'proj-app2'],
  ];
  const projectAccount: Record<string, string> = { 'proj-app1': A, 'proj-app2': A, 'proj-ml': B, 'proj-infra': B };
  const auditLog: AuditEvent[] = history.map(([action, target, actor, projectId, result, details], i) => ({
    id: `evt-h${String(i).padStart(3, '0')}`,
    when: ago((i * 7 + 3) * HOUR + i * 13 * MIN),
    actor,
    action,
    target,
    result: result ?? 'success',
    details,
    accountId: projectId ? projectAccount[projectId] : A,
    projectId: projectId || undefined,
    sourceIp: actor === 'system' ? undefined : actor.startsWith('svc:') ? '198.51.100.20' : '192.0.2.44',
    via: actor === 'system' ? 'system' : actor === 'svc:terraform' ? 'terraform' : actor.startsWith('svc:') ? 'api' : 'console',
  }));
  void actors;

  const notifications: Notification[] = [
    { id: 'ntf-001', level: 'warning', title: 'Certificate expiring soon', message: 'api.example.org expires in 9 days and auto-renew is disabled.', time: ago(2 * HOUR), read: false, link: '/managed-services/load-balancers/lb-002', accountId: A },
    { id: 'ntf-002', level: 'error', title: 'Host dc2-hv-04 offline', message: 'BMC reports PSU 2 failure. Workloads were evacuated automatically.', time: ago(5 * HOUR), read: false, link: '/hardware/bare-metals/bm-012', accountId: A },
    { id: 'ntf-003', level: 'success', title: 'Backup completed', message: 'Daily backup finished for pg-app1 (2.4 GB).', time: ago(9 * HOUR), read: true, link: '/managed-services/db/db-001', accountId: A },
    { id: 'ntf-004', level: 'info', title: 'Kubernetes 1.31 available', message: 'app1-cluster runs 1.30. Upgrade is available with zero-downtime surge.', time: ago(1 * DAY), read: false, link: '/managed-services/kubernetes/k8s-001', accountId: A },
    { id: 'ntf-005', level: 'warning', title: 'Budget 80% reached', message: 'ML Platform has used 82% of its monthly budget.', time: ago(1 * DAY + 3 * HOUR), read: false, link: '/iam/project-allowances/allow-proj-ml', accountId: B },
    { id: 'ntf-006', level: 'error', title: 'OVHcloud sync failed', message: 'Authentication failed: application key expired. Rotate credentials.', time: ago(30 * MIN), read: false, link: '/hardware/cloud-providers/provider-ovh', accountId: A },
  ];

  const mkOp = (id: string, type: string, title: string, target: Operation['target'], projectId: string, whenMs: number, steps: string[], status: Operation['status'] = 'succeeded', error?: string): Operation => {
    const start = Date.now() - whenMs;
    let t = start;
    return {
      id, type, title, target, projectId, accountId: projectAccount[projectId] ?? A, actor: 'alice@example.com', status, progress: status === 'succeeded' ? 1 : 0.6,
      createdAt: new Date(start).toISOString(), startedAt: new Date(start).toISOString(), finishedAt: new Date(start + steps.length * 2500).toISOString(), error,
      steps: steps.map((name, i) => {
        const s = { name, status: (status === 'failed' && i === steps.length - 1 ? 'failed' : 'done') as any, durationMs: 2500, startedAt: new Date(t).toISOString(), finishedAt: new Date(t + 2500).toISOString(), logs: [] as string[] };
        if (s.status === 'failed' && error) s.logs = [`ERROR: ${error}`];
        t += 2500;
        return s;
      }),
    };
  };
  const operations: Operation[] = [
    mkOp('op-h001', 'vm.create', 'Provision VM web-3', { type: 'vm', id: 'vm-009', name: 'web-3' }, 'proj-app1', 2 * DAY, ['Validate request', 'Schedule on host', 'Allocate resources', 'Configure network', 'Boot & cloud-init']),
    mkOp('op-h002', 'vm.create', 'Provision VM trainer-burst-1', { type: 'vm', id: 'vm-014', name: 'trainer-burst-1' }, 'proj-ml', 6 * HOUR, ['Validate request', 'Request capacity from Hetzner'], 'failed', 'Provider quota exceeded for H100 in nbg1'),
    mkOp('op-h003', 'k8s.upgrade', 'Upgrade ml-platform to 1.31', { type: 'k8s', id: 'k8s-002', name: 'ml-platform' }, 'proj-ml', 3 * DAY, ['Pre-flight checks', 'Upgrade control plane', 'Surge upgrade cpu-pool', 'Surge upgrade gpu-pool', 'Verify workloads']),
    mkOp('op-h004', 'db.backup', 'Backup pg-app1', { type: 'db', id: 'db-001', name: 'pg-app1' }, 'proj-app1', 9 * HOUR, ['Snapshot WAL', 'Upload to backup store']),
  ];

  return { accounts, projects, locations, users, roles, systemAccounts, allowances, auditLog, notifications, operations };
}
