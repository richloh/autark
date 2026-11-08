import { Link } from 'react-router';
import { Check, X, Cpu, MemoryStick, HardDrive, Box, Globe2, Info, Scaling } from 'lucide-react';
import { Card, CardHeader, KeyValue } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Mono, Skeleton } from '@/components/ui/misc';
import { IacTabs, toCli, toCurl, toHcl } from '@/components/ui/CodeBlock';
import { cn } from '@/lib/cn';
import { usePro } from '@/store/ui';
import type { PlatformCluster, SpaceQuota } from '@/types';
import { CUSTOM_LIMITS, QUOTA_KEYS, num1, type SpaceView } from './spaceUi';

const ICON = { cpuCores: Cpu, memoryGi: MemoryStick, storageGi: HardDrive, pods: Box, loadBalancers: Globe2 };

export function QuotaGauges({ quota, used, loading }: { quota: SpaceQuota; used?: SpaceQuota; loading?: boolean }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-3 @min-[34rem]:grid-cols-3 @min-[52rem]:grid-cols-5">
        {QUOTA_KEYS.map((k) => {
          const Icon = ICON[k];
          const u = used?.[k] ?? 0;
          const max = quota[k];
          const r = max > 0 ? Math.min(1, u / max) : 0;
          const lim = CUSTOM_LIMITS[k];
          return (
            <Card key={k} className="p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted"><Icon className="size-3.5" />{lim.label}</div>
              {loading && !used ? <Skeleton className="mt-2 h-7 w-20" /> : (
                <div className="mt-1.5 flex items-baseline gap-1">
                  <span className="text-2xl font-semibold tabular tracking-tight text-fg">{num1(+u.toFixed(k === 'cpuCores' ? 2 : 1))}</span>
                  <span className="text-sm text-muted">/ {num1(max)}{lim.unit && k !== 'pods' ? ` ${lim.unit}` : ''}</span>
                </div>
              )}
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className={cn('h-full rounded-full transition-all duration-500', r > 0.9 ? 'bg-rose-500' : r > 0.75 ? 'bg-amber-500' : 'bg-sky-500')} style={{ width: `${r * 100}%` }} />
              </div>
              <div className="mt-1 text-[11px] text-faint">{max === 0 ? 'none in quota' : `${Math.round(r * 100)}% used`}</div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

const CAN = [
  'Deployments, StatefulSets, Jobs & CronJobs',
  'Services, Ingress with automatic HTTPS on your address',
  'ConfigMaps, Secrets and persistent volumes',
  'Helm charts that only use namespaced resources',
  'Roles and RoleBindings inside your namespace',
];
const CANT = [
  'Install CRDs, operators or cluster-wide resources',
  'Privileged pods, host network or host paths',
  'DaemonSets or choosing nodes',
  'Go beyond your quota — extra pods are rejected',
];

export function SpaceOverviewTab({ space: s, used, usageLoading, platformCluster: pc, onTab }: {
  space: SpaceView; used?: SpaceQuota; usageLoading?: boolean; platformCluster?: PlatformCluster; onTab: (t: string) => void;
}) {
  const pro = usePro();
  const example = s.ingressHost.replace(/^\*\./, 'app.');
  const near = used && QUOTA_KEYS.some((k) => s.quota[k] > 0 && used[k] / s.quota[k] > 0.85);
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-fg-2">Quota usage</h2>
          <Button size="xs" variant={near ? 'primary' : 'ghost'} icon={Scaling} onClick={() => onTab('settings')}>{near ? 'Running low — resize' : 'Resize'}</Button>
        </div>
        <QuotaGauges quota={s.quota} used={used} loading={usageLoading} />
        <p className="mt-2 text-[11px] text-muted">Used = sum of the resource requests of your pods.</p>
      </div>

      <div className="grid items-start gap-5 @min-[60rem]:grid-cols-2">
        <Card>
          <CardHeader title="Connection" />
          <div className="p-4">
            <KeyValue cols={1} items={[
              ['Namespace', <Mono copy>{s.namespace}</Mono>],
              ['Your apps’ address', <span className="min-w-0"><Mono copy>{s.ingressHost}</Mono><span className="mt-0.5 block text-[11px] text-muted">e.g. https://{example}</span></span>],
              ...(pro ? [
                ['API server', (pc?.endpoint ?? s.endpoint) ? <Mono copy>{pc?.endpoint ?? s.endpoint}</Mono> : '—'],
                ['kubectl identity', <Mono copy>{s.serviceAccount}</Mono>],
                ['Platform cluster', <Link to={`/hardware/platform-clusters/${s.platformClusterId}`} className="text-brand-600 hover:underline dark:text-brand-300">{pc?.name ?? s.platformClusterName ?? s.platformClusterId}</Link>],
                ['Network policy', s.networkPolicy === 'default-deny' ? 'Deny by default' : 'Allow within the space'],
              ] as [string, React.ReactNode][] : []),
              ['Kubernetes', (pc?.version ?? s.version) ? `v${pc?.version ?? s.version}${pro ? ` · pod security “${pc?.podSecurity ?? s.podSecurity}”` : ''}` : '—'],
            ]} />
            <Button size="sm" className="mt-4" onClick={() => onTab('access')}>Connect with kubectl</Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="What you can do here" icon={Info} />
          <div className="grid gap-4 p-4 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-1 @min-[76rem]:grid-cols-2">
            <ul className="space-y-1.5 text-[13px]">
              {CAN.map((t) => <li key={t} className="flex items-start gap-1.5 text-fg-2"><Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />{t}</li>)}
            </ul>
            <ul className="space-y-1.5 text-[13px]">
              {CANT.map((t) => <li key={t} className="flex items-start gap-1.5 text-muted"><X className="mt-0.5 size-3.5 shrink-0 text-faint" />{t}</li>)}
            </ul>
          </div>
          <p className="border-t border-line px-4 py-3 text-xs text-muted">Need CRDs or operators? <Link to="/managed-services/kubernetes/new?type=dedicated" className="font-medium text-brand-600 hover:underline dark:text-brand-300">Create your own cluster</Link>.</p>
        </Card>
      </div>

      <IacTabs snippets={{
        terraform: toHcl('kubernetes_space', s.name, { name: s.name, project_id: s.projectId, location: s.locationId, quota: s.quota, network_policy: s.networkPolicy }),
        cli: toCli('k8s space create', { name: s.name, projectId: s.projectId, locationId: s.locationId, cpu: s.quota.cpuCores, memory: `${s.quota.memoryGi}Gi`, storage: `${s.quota.storageGi}Gi`, pods: s.quota.pods }),
        curl: toCurl('POST', '/k8sSpaces', { name: s.name, projectId: s.projectId, locationId: s.locationId, quota: s.quota, networkPolicy: s.networkPolicy }),
      }} />
    </div>
  );
}
