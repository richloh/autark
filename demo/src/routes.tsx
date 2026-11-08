import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from '@/components/shell/AppShell';
import { RouteError } from '@/pages/RouteError';
import { Spinner } from '@/components/ui/misc';

const L = (load: () => Promise<{ default: ComponentType }>) => {
  const C = lazy(load);
  return (
    <Suspense fallback={<div className="flex h-[60vh] items-center justify-center"><Spinner className="size-6" /></div>}>
      <C />
    </Suspense>
  );
};

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: L(() => import('@/pages/dashboard/Dashboard')) },
      { path: 'topology', element: L(() => import('@/pages/topology/Topology')) },
      { path: 'billing/cost-explorer', element: L(() => import('@/pages/billing/CostExplorer')) },
      { path: 'activity', element: L(() => import('@/pages/activity/Activity')) },

      { path: 'infrastructure/vms', element: L(() => import('@/pages/compute/VmList')) },
      { path: 'infrastructure/vms/new', element: L(() => import('@/pages/compute/VmCreate')) },
      { path: 'infrastructure/vms/presets', element: L(() => import('@/pages/compute/VmPresets')) },
      { path: 'infrastructure/vms/:id', element: L(() => import('@/pages/compute/VmDetail')) },
      { path: 'infrastructure/images', element: L(() => import('@/pages/compute/Images')) },
      { path: 'infrastructure/ssh-keys', element: L(() => import('@/pages/compute/SshKeys')) },
      { path: 'infrastructure/volumes', element: L(() => import('@/pages/compute/VolumeList')) },
      { path: 'infrastructure/volumes/new', element: L(() => import('@/pages/compute/VolumeCreate')) },
      { path: 'infrastructure/volumes/presets', element: L(() => import('@/pages/compute/VolumePresets')) },
      { path: 'infrastructure/volumes/:id', element: L(() => import('@/pages/compute/VolumeDetail')) },

      { path: 'infrastructure/networks', element: L(() => import('@/pages/network/NetworkList')) },
      { path: 'infrastructure/networks/new', element: L(() => import('@/pages/network/NetworkCreate')) },
      { path: 'infrastructure/networks/:id', element: L(() => import('@/pages/network/NetworkDetail')) },
      { path: 'infrastructure/ips', element: L(() => import('@/pages/network/Ips')) },
      { path: 'infrastructure/firewalls', element: L(() => import('@/pages/network/FirewallList')) },
      { path: 'infrastructure/firewalls/new', element: L(() => import('@/pages/network/FirewallCreate')) },
      { path: 'infrastructure/firewalls/:id', element: L(() => import('@/pages/network/FirewallDetail')) },
      { path: 'infrastructure/dns', element: L(() => import('@/pages/network/DnsList')) },
      { path: 'infrastructure/dns/:id', element: L(() => import('@/pages/network/DnsDetail')) },

      { path: 'managed-services/db', element: L(() => import('@/pages/db/DbList')) },
      { path: 'managed-services/db/new', element: L(() => import('@/pages/db/DbCreate')) },
      { path: 'managed-services/db/presets', element: L(() => import('@/pages/db/DbPresets')) },
      { path: 'managed-services/db/:id', element: L(() => import('@/pages/db/DbDetail')) },
      { path: 'managed-services/kubernetes', element: L(() => import('@/pages/k8s/K8sList')) },
      { path: 'managed-services/kubernetes/new', element: L(() => import('@/pages/k8s/K8sCreate')) },
      { path: 'managed-services/kubernetes/:id', element: L(() => import('@/pages/k8s/K8sDetail')) },
      { path: 'managed-services/object-storage', element: L(() => import('@/pages/storage/BucketList')) },
      { path: 'managed-services/object-storage/new', element: L(() => import('@/pages/storage/BucketCreate')) },
      { path: 'managed-services/object-storage/:id', element: L(() => import('@/pages/storage/BucketDetail')) },
      { path: 'managed-services/load-balancers', element: L(() => import('@/pages/lb/LbList')) },
      { path: 'managed-services/load-balancers/new', element: L(() => import('@/pages/lb/LbCreate')) },
      { path: 'managed-services/load-balancers/:id', element: L(() => import('@/pages/lb/LbDetail')) },

      { path: 'hardware/bare-metals', element: L(() => import('@/pages/hardware/HostList')) },
      { path: 'hardware/bare-metals/new', element: L(() => import('@/pages/hardware/HostCreate')) },
      { path: 'hardware/bare-metals/:id', element: L(() => import('@/pages/hardware/HostDetail')) },
      { path: 'hardware/cloud-providers', element: L(() => import('@/pages/hardware/ProviderList')) },
      { path: 'hardware/cloud-providers/new', element: L(() => import('@/pages/hardware/ProviderCreate')) },
      { path: 'hardware/cloud-providers/:id', element: L(() => import('@/pages/hardware/ProviderDetail')) },

      { path: 'iam/users', element: L(() => import('@/pages/iam/UserList')) },
      { path: 'iam/users/:id', element: L(() => import('@/pages/iam/UserDetail')) },
      { path: 'iam/roles', element: L(() => import('@/pages/iam/RoleList')) },
      { path: 'iam/roles/new', element: L(() => import('@/pages/iam/RoleEdit')) },
      { path: 'iam/roles/:id', element: L(() => import('@/pages/iam/RoleDetail')) },
      { path: 'iam/system-accounts', element: L(() => import('@/pages/iam/SystemAccountList')) },
      { path: 'iam/system-accounts/:id', element: L(() => import('@/pages/iam/SystemAccountDetail')) },
      { path: 'iam/project-allowances', element: L(() => import('@/pages/iam/AllowanceList')) },
      { path: 'iam/project-allowances/:id', element: L(() => import('@/pages/iam/AllowanceDetail')) },

      { path: 'developer', element: L(() => import('@/pages/platform/Developer')) },
      { path: 'settings', element: L(() => import('@/pages/platform/Settings')) },
      { path: '*', element: L(() => import('@/pages/NotFound')) },
    ],
  },
]);
