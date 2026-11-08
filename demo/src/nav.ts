import {
  LayoutDashboard, Waypoints, PiggyBank, Activity, Server, Disc3, KeyRound, HardDrive, Network, Globe2, Shield, AtSign, Database, Boxes,
  PackageOpen, Scale, Cpu, Cloud, User, Users, Bot, Wallet, Code2, Settings, type LucideIcon,
} from 'lucide-react';

export interface NavItem { label: string; path: string; icon: LucideIcon; keywords?: string; /** only shown in Pro mode */ pro?: boolean }
export interface NavGroup { label: string; items: NavItem[] }

/**
 * Sidebar navigation. Simple mode shows the everyday essentials (like a classic hosting console);
 * items marked `pro` appear when Pro mode is enabled. All routes stay reachable via ⌘K either way.
 */
export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, keywords: 'home overview' },
      { label: 'Topology', path: '/topology', icon: Waypoints, keywords: 'map graph network diagram', pro: true },
      { label: 'Activity', path: '/activity', icon: Activity, keywords: 'audit log operations events history', pro: true },
    ],
  },
  {
    label: 'Compute',
    items: [
      { label: 'Virtual Machines', path: '/infrastructure/vms', icon: Server, keywords: 'vm instances servers compute' },
      { label: 'Kubernetes', path: '/managed-services/kubernetes', icon: Boxes, keywords: 'k8s clusters containers' },
      { label: 'Volumes', path: '/infrastructure/volumes', icon: HardDrive, keywords: 'disks block storage' },
      { label: 'Images & Snapshots', path: '/infrastructure/images', icon: Disc3, keywords: 'os templates backups', pro: true },
    ],
  },
  {
    label: 'Networking',
    items: [
      { label: 'Networks', path: '/infrastructure/networks', icon: Network, keywords: 'vpc subnets routes' },
      { label: 'Load Balancers', path: '/managed-services/load-balancers', icon: Scale, keywords: 'lb ingress certificates tls' },
      { label: 'Firewalls', path: '/infrastructure/firewalls', icon: Shield, keywords: 'security groups rules' },
      { label: 'IP Addresses', path: '/infrastructure/ips', icon: Globe2, keywords: 'elastic ip floating pools' },
      { label: 'DNS', path: '/infrastructure/dns', icon: AtSign, keywords: 'zones records domains' },
    ],
  },
  {
    label: 'Data',
    items: [
      { label: 'Databases', path: '/managed-services/db', icon: Database, keywords: 'postgres mysql redis mariadb' },
      { label: 'Object Storage', path: '/managed-services/object-storage', icon: PackageOpen, keywords: 's3 buckets' },
    ],
  },
  {
    label: 'Hardware',
    items: [
      { label: 'Bare Metal Hosts', path: '/hardware/bare-metals', icon: Cpu, keywords: 'servers racks hypervisors', pro: true },
      { label: 'Platform Clusters', path: '/hardware/platform-clusters', icon: Boxes, keywords: 'shared kubernetes multi-tenant namespaces spaces', pro: true },
      { label: 'Cloud Providers', path: '/hardware/cloud-providers', icon: Cloud, keywords: 'hetzner aws ovh burst', pro: true },
    ],
  },
  {
    label: 'Account',
    items: [
      { label: 'Team', path: '/iam/users', icon: User, keywords: 'users members invite people' },
      { label: 'SSH Keys', path: '/infrastructure/ssh-keys', icon: KeyRound, keywords: 'security access' },
      { label: 'Costs', path: '/billing/cost-explorer', icon: PiggyBank, keywords: 'billing spend budget showback chargeback cost explorer' },
      { label: 'Roles', path: '/iam/roles', icon: Users, keywords: 'rbac permissions', pro: true },
      { label: 'System Accounts', path: '/iam/system-accounts', icon: Bot, keywords: 'service accounts tokens api keys', pro: true },
      { label: 'Projects & Budgets', path: '/iam/project-allowances', icon: Wallet, keywords: 'quotas allowances budgets', pro: true },
      { label: 'API & IaC', path: '/developer', icon: Code2, keywords: 'terraform cli openapi mcp developer', pro: true },
      { label: 'Settings', path: '/settings', icon: Settings, keywords: 'preferences theme reset demo pro mode' },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));
