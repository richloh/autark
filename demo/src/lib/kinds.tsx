import {
  Server, HardDrive, Camera, Disc3, KeyRound, Network, Globe2, Shield, AtSign, Database, Archive, Boxes, Box, PackageOpen, Key, Scale,
  BadgeCheck, Cpu, Cloud, MapPin, User, Users, Bot, FolderKanban, Wallet, Activity, Layers, type LucideIcon,
} from 'lucide-react';
import type { ResourceKind } from '@/types';

export interface KindMeta { label: string; plural: string; icon: LucideIcon; color: string; link?: (id: string) => string }

/** Display metadata for every resource kind (icons, colors, routes). */
export const KINDS: Record<ResourceKind, KindMeta> = {
  vm: { label: 'VM', plural: 'Virtual machines', icon: Server, color: '#5b67f8', link: (id) => `/infrastructure/vms/${id}` },
  volume: { label: 'Volume', plural: 'Volumes', icon: HardDrive, color: '#0ea5e9', link: (id) => `/infrastructure/volumes/${id}` },
  snapshot: { label: 'Snapshot', plural: 'Snapshots', icon: Camera, color: '#64748b', link: () => `/infrastructure/images?tab=snapshots` },
  image: { label: 'Image', plural: 'Images', icon: Disc3, color: '#8b5cf6', link: () => `/infrastructure/images` },
  sshKey: { label: 'SSH key', plural: 'SSH keys', icon: KeyRound, color: '#64748b', link: () => `/infrastructure/ssh-keys` },
  network: { label: 'Network', plural: 'Networks', icon: Network, color: '#10b981', link: (id) => `/infrastructure/networks/${id}` },
  ip: { label: 'IP address', plural: 'IP addresses', icon: Globe2, color: '#14b8a6', link: () => `/infrastructure/ips` },
  ipPool: { label: 'IP pool', plural: 'IP pools', icon: Layers, color: '#14b8a6', link: () => `/infrastructure/ips` },
  firewall: { label: 'Firewall', plural: 'Firewalls', icon: Shield, color: '#f97316', link: (id) => `/infrastructure/firewalls/${id}` },
  dnsZone: { label: 'DNS zone', plural: 'DNS zones', icon: AtSign, color: '#06b6d4', link: (id) => `/infrastructure/dns/${id}` },
  db: { label: 'Database', plural: 'Databases', icon: Database, color: '#3b82f6', link: (id) => `/managed-services/db/${id}` },
  dbBackup: { label: 'DB backup', plural: 'DB backups', icon: Archive, color: '#64748b' },
  k8s: { label: 'Kubernetes cluster', plural: 'Kubernetes', icon: Boxes, color: '#326ce5', link: (id) => `/managed-services/kubernetes/${id}` },
  k8sWorkload: { label: 'Workload', plural: 'Workloads', icon: Box, color: '#326ce5' },
  bucket: { label: 'Bucket', plural: 'Buckets', icon: PackageOpen, color: '#eab308', link: (id) => `/managed-services/object-storage/${id}` },
  accessKey: { label: 'Access key', plural: 'Access keys', icon: Key, color: '#64748b' },
  lb: { label: 'Load balancer', plural: 'Load balancers', icon: Scale, color: '#ec4899', link: (id) => `/managed-services/load-balancers/${id}` },
  certificate: { label: 'Certificate', plural: 'Certificates', icon: BadgeCheck, color: '#22c55e', link: () => `/managed-services/load-balancers?tab=certificates` },
  bareMetal: { label: 'Host', plural: 'Bare metal hosts', icon: Cpu, color: '#475569', link: (id) => `/hardware/bare-metals/${id}` },
  provider: { label: 'Cloud provider', plural: 'Cloud providers', icon: Cloud, color: '#0ea5e9', link: (id) => `/hardware/cloud-providers/${id}` },
  location: { label: 'Location', plural: 'Locations', icon: MapPin, color: '#64748b' },
  user: { label: 'User', plural: 'Users', icon: User, color: '#64748b', link: (id) => `/iam/users/${id}` },
  role: { label: 'Role', plural: 'Roles', icon: Users, color: '#64748b', link: (id) => `/iam/roles/${id}` },
  systemAccount: { label: 'System account', plural: 'System accounts', icon: Bot, color: '#64748b', link: (id) => `/iam/system-accounts/${id}` },
  project: { label: 'Project', plural: 'Projects', icon: FolderKanban, color: '#64748b', link: (id) => `/iam/project-allowances/allow-${id}` },
  allowance: { label: 'Allowance', plural: 'Project allowances', icon: Wallet, color: '#64748b', link: (id) => `/iam/project-allowances/${id}` },
  operation: { label: 'Operation', plural: 'Operations', icon: Activity, color: '#64748b', link: () => `/activity` },
};

export function kindLink(type: ResourceKind, id: string): string | undefined {
  return KINDS[type]?.link?.(id);
}
