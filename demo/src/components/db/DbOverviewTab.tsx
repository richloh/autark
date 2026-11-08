import { Activity, Cpu, Gauge, HardDrive, Info, Users } from 'lucide-react';
import { useLookup, useMetrics } from '@/api/hooks';
import { Card, CardHeader, KeyValue } from '@/components/ui/Card';
import { Stat } from '@/components/ui/Stat';
import { Meter, Mono } from '@/components/ui/misc';
import { Tags } from '@/components/ui/Badge';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { compact, dateTime, money, timeAgo } from '@/lib/format';
import { ConnectionPanel } from './ConnectionPanel';
import { DbTopology } from './DbTopology';
import { DAYS, ENGINE_META, topologyLabel } from './engine';
import { usePro } from '@/store/ui';
import type { DbInstance, Location, BareMetalHost } from '@/types';

export function DbOverviewTab({ d }: { d: DbInstance }) {
  const { map: locations } = useLookup<Location>('locations');
  const { map: hosts } = useLookup<BareMetalHost>('hosts');
  const { map: networks } = useLookup<{ id: string; name: string }>('networks');
  const { data } = useMetrics('dbInstances', d.id, ['cpu', 'connections', 'qps', 'storageUsed', 'cacheHitRatio'], '1h');
  const series = (m: string) => data?.series?.[m]?.points.map((p) => p.v) ?? [];
  const last = (m: string) => data?.series?.[m]?.points.at(-1)?.v;
  const usedNow = last('storageUsed') ?? d.storageUsedGB;
  const meta = ENGINE_META[d.engine];
  const live = !['stopped', 'error', 'provisioning', 'deleting'].includes(d.status);
  const maxConn = Number(d.parameters.max_connections ?? d.parameters.maxclients ?? (d.engine === 'redis' ? 10000 : d.engine === 'postgres' ? 200 : 151));
  const mw = d.maintenanceWindow;
  const pro = usePro();

  if (!pro) {
    return (
      <div className="space-y-5">
        <div className="grid items-start gap-5 @min-[56rem]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <ConnectionPanel d={d} simple />
          <Card>
            <CardHeader icon={Info} title="Details" />
            <div className="space-y-4 p-4">
              <KeyValue cols={2} items={[
                ['Engine', `${meta.label} ${d.version}`],
                ['Size', `${d.size.vcpus} vCPU · ${d.size.ramGB} GB RAM`],
                ['Availability', d.ha ? 'High availability' : 'Single node'],
                ['Location', locations.get(d.locationId)?.name ?? d.locationId],
                ['Last backup', d.lastBackupAt ? timeAgo(d.lastBackupAt) : 'never'],
                ['Created', dateTime(d.createdAt)],
              ]} />
              <Meter value={usedNow} max={d.storageGB} label={`Storage · ${usedNow.toFixed(1)} of ${d.storageGB} GB`} showLabel />
            </div>
          </Card>
        </div>
        <div className="grid grid-cols-1 gap-3 @min-[36rem]:grid-cols-2">
          <Stat label="CPU" icon={Cpu} value={live && last('cpu') != null ? `${Math.round(last('cpu')!)}%` : '—'} sub={`${d.size.vcpus} vCPU · last hour`} spark={series('cpu')} sparkColor="#5b67f8" />
          <Stat label="Connections" icon={Users} value={live && last('connections') != null ? Math.round(last('connections')!) : '—'} sub={`of ${maxConn} max · last hour`} spark={series('connections')} sparkColor="#06b6d4" />
        </div>
        {(d.ha || d.readReplicas > 0) && <DbTopology d={d} />}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="CPU" icon={Cpu} value={live && last('cpu') != null ? `${Math.round(last('cpu')!)}%` : '—'} sub={`${d.size.vcpus} vCPU`} spark={series('cpu')} sparkColor="#5b67f8" />
        <Stat label="Connections" icon={Users} value={live && last('connections') != null ? Math.round(last('connections')!) : '—'} sub={`of ${maxConn} max`} spark={series('connections')} sparkColor="#06b6d4" />
        <Stat label={d.engine === 'redis' ? 'Ops / sec' : 'Queries / sec'} icon={Activity} value={live && last('qps') != null ? compact(last('qps')!) : '—'} sub={`cache hit ${last('cacheHitRatio')?.toFixed(1) ?? '—'}%`} spark={series('qps')} sparkColor="#a855f7" />
        <Stat label="Storage" icon={HardDrive} value={`${usedNow.toFixed(1)} GB`} sub={<span className="w-24"><Meter size="xs" value={usedNow} max={d.storageGB} /></span>} accent={usedNow / d.storageGB > 0.85 ? '#f43f5e' : undefined} />
      </div>

      <div className="grid items-start gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <div className="min-w-0 space-y-5">
          <DbTopology d={d} />
          <Card>
            <CardHeader icon={Info} title="Details" />
            <div className="p-4">
              <KeyValue cols={3} items={[
                ['Engine', `${meta.label} ${d.version}`],
                ['Compute', `${d.size.vcpus} vCPU · ${d.size.ramGB} GB RAM`],
                ['Topology', topologyLabel(d)],
                ['Location', locations.get(d.locationId)?.name ?? d.locationId],
                ['Primary host', d.primaryHostId ? <ResourceLink type="bareMetal" id={d.primaryHostId} name={hosts.get(d.primaryHostId)?.name} /> : 'provider managed'],
                ['Standby host', d.ha && d.standbyHostId ? <ResourceLink type="bareMetal" id={d.standbyHostId} name={hosts.get(d.standbyHostId)?.name} /> : null],
                ['Network', <ResourceLink type="network" id={d.networkId} name={networks.get(d.networkId)?.name} />],
                ['Private IP', d.privateIp ? <Mono copy>{d.privateIp}</Mono> : null],
                ['Backups', d.backups.enabled ? `${d.backups.schedule}, ${d.backups.retention}d${d.backups.pitr ? ' + PITR' : ''}` : 'disabled'],
                ['Last backup', d.lastBackupAt ? timeAgo(d.lastBackupAt) : 'never'],
                ['Maintenance', `${DAYS.find((x) => x.value === mw.day)?.label} ${String(mw.hour).padStart(2, '0')}:00 UTC`],
                ['Last failover', d.lastFailoverAt ? timeAgo(d.lastFailoverAt) : d.ha ? 'never' : null],
                ['Created', dateTime(d.createdAt)],
                ['Monthly cost', money(d.monthlyCost)],
                ['Restored from', d.restoredFrom ? `${d.restoredFrom.sourceName ?? d.restoredFrom.sourceId ?? ''}${d.restoredFrom.timestamp ? ` @ ${dateTime(d.restoredFrom.timestamp)}` : ''}` : null],
              ]} />
              <div className="mt-4 flex items-center gap-2 border-t border-line pt-3"><span className="text-xs text-muted">Tags</span><Tags tags={d.tags} max={8} /></div>
            </div>
          </Card>
        </div>
        <div className="min-w-0 space-y-5">
          <ConnectionPanel d={d} />
          <Card>
            <CardHeader icon={Gauge} title="Storage" description={d.storageAutoscale ? 'Autoscaling on: grows 20% at 90% usage' : 'Autoscaling off'} />
            <div className="space-y-3 p-4">
              <Meter value={usedNow} max={d.storageGB} label={`${usedNow.toFixed(1)} GB of ${d.storageGB} GB`} showLabel />
              <div className="space-y-1.5">
                {d.databases.slice(0, 6).map((x) => (
                  <div key={x.name} className="flex items-center gap-2 text-xs">
                    <span className="w-24 truncate font-mono text-fg-2">{x.name}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full" style={{ width: `${Math.min(100, (x.sizeMB / 1024 / Math.max(0.1, d.storageGB)) * 100)}%`, background: meta.color }} /></div>
                    <span className="w-16 text-right tabular text-muted">{x.sizeMB >= 1024 ? `${(x.sizeMB / 1024).toFixed(1)} GB` : `${x.sizeMB} MB`}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
