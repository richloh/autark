import { Link } from 'react-router';
import { Gauge as GaugeIcon, HeartPulse, Info, Network, Users, ArrowRight } from 'lucide-react';
import { useGet } from '@/api/hooks';
import { usePro } from '@/store/ui';
import { Card, CardHeader, CardBody, KeyValue } from '@/components/ui/Card';
import { StatusDot } from '@/components/ui/Badge';
import { Mono } from '@/components/ui/misc';
import { Pro } from '@/components/ui/Pro';
import { MetricsPanel } from '@/components/charts/MetricsPanel';
import { usePolicyNames } from '@/components/hardware/policy';
import { accessSummary } from '@/lib/hostPolicy';
import { date } from '@/lib/format';
import { CapacityBar, PromiseGauge, capacityOf, promisableOf, n1, DAYS, type PlatformClusterView, type TenantRow } from './shared';

export function PcOverview({ pc, onTab }: { pc: PlatformClusterView; onTab: (t: string) => void }) {
  const pro = usePro();
  const { names } = usePolicyNames();
  const cap = capacityOf(pc);
  const lim = promisableOf(pc);
  const prom = pc.promised ?? { cpuCores: 0, memoryGi: 0, spaces: 0 };
  const used = pc.used ?? { cpuCores: 0, memoryGi: 0, pods: 0 };
  const { data: tenants } = useGet<{ items: TenantRow[] }>(['k8sSpaces', 'tenants', pc.id], `/platformClusters/${pc.id}/tenants`, { refetchInterval: 5000 });
  const top = [...(tenants?.items ?? [])].sort((a, b) => b.quota.cpuCores - a.quota.cpuCores).slice(0, 5);
  const freeCpu = Math.max(0, lim.cpuCores - prom.cpuCores);
  const freeMem = Math.max(0, lim.memoryGi - prom.memoryGi);

  return (
    <div className="grid [&>*]:min-w-0 gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <Card>
          <CardHeader title="Capacity" icon={GaugeIcon} description={pro ? 'Promised = sum of tenant quotas (what you bill). Used = requests of running pods.' : 'How much you have promised to customers, and how much they use.'} />
          <CardBody className="space-y-6">
            <div className="grid [&>*]:min-w-0 grid-cols-1 justify-items-center gap-6 @min-[36rem]:grid-cols-2">
              <PromiseGauge title="CPU" unit="cores" capacity={cap.cpuCores} overcommit={pc.overcommit.cpu} promised={prom.cpuCores} used={used.cpuCores} />
              <PromiseGauge title="Memory" unit="GiB" capacity={cap.memoryGi} overcommit={pc.overcommit.memory} promised={prom.memoryGi} used={used.memoryGi} />
            </div>
            <div className="space-y-4">
              <CapacityBar label="CPU" unit="cores" capacity={cap.cpuCores} overcommit={pc.overcommit.cpu} promised={prom.cpuCores} used={used.cpuCores} />
              <CapacityBar label="Memory" unit="GiB" capacity={cap.memoryGi} overcommit={pc.overcommit.memory} promised={prom.memoryGi} used={used.memoryGi} />
            </div>
            <div className="flex gap-3 rounded-xl bg-surface-2/70 p-3.5 text-[13px] text-fg-2">
              <Info className="mt-0.5 size-4 shrink-0 text-muted" />
              <div>
                Tenants rarely use their whole quota, so you may <b className="font-semibold text-fg">promise more than you have</b>: up to allocatable × overcommit
                (CPU ×{pc.overcommit.cpu}, memory ×{pc.overcommit.memory}). Right now <b className="font-semibold text-fg">{n1(freeCpu)} cores</b> and <b className="font-semibold text-fg">{n1(freeMem)} GiB</b> can still be sold.
                {pro && <> Allocatable already excludes ~10% per node for kubelet and system daemons. If actual use approaches allocatable, add nodes in <button type="button" className="font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => onTab('nodes')}>Nodes &amp; pools</button>.</>}
              </div>
            </div>
          </CardBody>
        </Card>

        <Pro>
          <MetricsPanel collection="platformClusters" id={pc.id} charts={[
            { title: 'CPU usage', metrics: ['cpu'], unit: '%', max: 100 },
            { title: 'Memory usage', metrics: ['memory'], unit: '%', max: 100 },
            { title: 'Pods', metrics: ['pods'] },
            { title: 'API latency', metrics: ['apiLatency'], unit: 'ms' },
          ]} />
        </Pro>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader title="Health" icon={HeartPulse} />
          <ul className="divide-y divide-line">
            {(pc.health ?? []).map((h) => (
              <li key={h.component} className="flex items-start gap-2.5 px-4 py-2.5">
                <StatusDot status={h.status} className="mt-1.5" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-fg">{h.component}</div>
                  <div className="text-xs text-muted">{h.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Largest tenants" icon={Users} actions={<button type="button" onClick={() => onTab('tenants')} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">All {tenants?.items.length ?? ''}<ArrowRight className="size-3" /></button>} />
          {top.length ? (
            <ul className="divide-y divide-line">
              {top.map((t) => (
                <li key={t.id} className="flex items-center gap-2.5 px-4 py-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: t.projectColor ?? '#64748b' }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-fg">{t.name}</div>
                    <div className="truncate text-[11px] text-muted">{t.accountName} · {t.projectName}</div>
                  </div>
                  <span className="shrink-0 text-xs tabular text-fg-2">{n1(t.quota.cpuCores)} c · {n1(t.quota.memoryGi)} GiB</span>
                </li>
              ))}
            </ul>
          ) : <div className="px-4 py-6 text-center text-xs text-muted">No spaces yet</div>}
        </Card>

        <Card>
          <CardHeader title="Details" icon={Network} />
          <CardBody>
            <KeyValue cols={1} items={[
              ['API endpoint', <Mono key="e" copy className="text-xs">{pc.endpoint}</Mono>],
              ['Ingress', <Mono key="i" className="text-xs">*.{pc.ingressDomain}</Mono>],
              ['Control plane', `${pc.controlPlane.ha ? 'HA (3 nodes)' : 'Single node'} · ${pc.controlPlane.size}`],
              ['Availability', accessSummary(pc, names)],
              ...(pro ? [
                ['CNI', pc.cni] as [string, string],
                ['Pod security', pc.podSecurity] as [string, string],
                ['Storage classes', pc.storageClasses.join(', ')] as [string, string],
                ['Max per space', `${n1(pc.maxTenantQuota.cpuCores)} cores · ${n1(pc.maxTenantQuota.memoryGi)} GiB · ${pc.maxTenantQuota.storageGi} GiB storage`] as [string, string],
              ] : []),
              ['Maintenance', `${DAYS[pc.maintenanceWindow.day] ?? pc.maintenanceWindow.day} ${String(pc.maintenanceWindow.hour).padStart(2, '0')}:00 UTC`],
              ['Created', date(pc.createdAt)],
            ]} />
            <Link to="/hardware/bare-metals" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">Bare-metal hosts<ArrowRight className="size-3" /></Link>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
