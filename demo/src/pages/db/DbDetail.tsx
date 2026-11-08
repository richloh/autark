import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Database, Play, Square, RotateCw, MoreHorizontal, Shuffle, Camera, Trash2, KeyRound, ArrowLeft, History, Scaling, ShieldAlert } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation, useItem, useActiveOperation, useOperationsFor, useLookup } from '@/api/hooks';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Tabs, useTabParam } from '@/components/ui/Tabs';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, Mono, Skeleton } from '@/components/ui/misc';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { MetricsPanel, type MetricDef } from '@/components/charts/MetricsPanel';
import { OperationRunner } from '@/components/resource/OperationRunner';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { EngineBadge, ENGINE_META } from '@/components/db/engine';
import { PasswordModal } from '@/components/db/PasswordModal';
import { DbOverviewTab } from '@/components/db/DbOverviewTab';
import { DbUsersTab } from '@/components/db/DbUsersTab';
import { DbBackupsTab } from '@/components/db/DbBackupsTab';
import { DbConfigTab } from '@/components/db/DbConfigTab';
import { DbNetworkingTab } from '@/components/db/DbNetworkingTab';
import { DbSettingsTab } from '@/components/db/DbSettingsTab';
import { DbScaleModal } from '@/components/db/DbScaleModal';
import { DbRestoreModal } from '@/components/db/DbRestoreModal';
import { money } from '@/lib/format';
import { useList } from '@/api/hooks';
import { Pro, ProBadge } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import type { DbInstance, DbBackup, Location } from '@/types';

export default function DbDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: d, isLoading, error } = useItem<DbInstance>('dbInstances', id);
  const op = useActiveOperation(id);
  const [tab, setTab] = useTabParam('overview');
  const pro = usePro();
  const [creds, setCreds] = useState<{ username: string; password: string } | null>(null);
  const [scaleOpen, setScaleOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const { map: locations } = useLookup<Location>('locations');
  const { items: backups } = useList<DbBackup>('dbBackups', id ? { dbId: id } : undefined, { enabled: !!id });

  const action = useApiMutation(({ a, body }: { a: string; body?: unknown }) => api.action('dbInstances', id!, a, body), {
    success: (_r, v) => ({ start: 'Starting database', stop: 'Stopping database', restart: 'Restarting database', failover: 'Failover started', backup: 'Backup started' } as Record<string, string>)[v.a] ?? 'Done',
  });
  const reveal = useApiMutation(() => api.action<{ username: string; password: string }>('dbInstances', id!, 'revealCredentials'), { onSuccess: setCreds });

  if (isLoading) return <Page><Skeleton className="mb-4 h-12 w-80" /><Skeleton className="mb-6 h-6 w-full max-w-xl" /><div className="grid gap-4 @min-[44rem]:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div></Page>;
  if (error || !d) return (
    <Page>
      <EmptyState icon={Database} title="Database not found" description={`No database with id ${id} exists in this account, or it was deleted.`} action={<Button icon={ArrowLeft} to="/managed-services/db">Back to databases</Button>} />
    </Page>
  );

  const meta = ENGINE_META[d.engine];
  const pending = d.pendingRestart ?? [];
  const isAvail = d.status === 'available';

  const onStop = async () => {
    if (await confirm({ title: `Stop ${d.name}?`, message: 'Clients are disconnected. While stopped you only pay for storage and backups. Automated backups pause.', confirmLabel: 'Stop database' })) action.mutate({ a: 'stop' });
  };
  const onRestart = async () => {
    if (await confirm({ title: `Restart ${d.name}?`, message: `${pending.length ? `Applies pending parameters: ${pending.join(', ')}. ` : ''}${d.ha ? 'Rolling restart with a planned switchover (~2s write pause).' : 'The database is unavailable for about 30 seconds.'}`, confirmLabel: 'Restart' })) action.mutate({ a: 'restart' });
  };
  const onFailover = async () => {
    if (await confirm({ title: `Fail over ${d.name}?`, message: 'The standby is promoted to primary and the old primary rejoins as standby. Writes are unavailable for a few seconds; connections must reconnect.', confirmLabel: 'Fail over now' })) action.mutate({ a: 'failover' });
  };
  const onDelete = async () => {
    if (d.deletionProtection) { toast.error('Deletion protection is enabled', 'Disable it in Settings first.'); setTab('settings'); return }
    const canFinal = d.status === 'available' || d.status === 'stopped';
    const res = await confirm({
      title: `Delete ${d.name}?`, danger: true, confirmLabel: 'Delete database', typeToConfirm: d.name,
      message: 'The instance, standby, replicas and automated backups are deleted. Manual backups are retained.',
      options: canFinal ? [{ id: 'finalBackup', label: 'Take a final backup', description: 'Kept after deletion so you can restore later.', default: true }] : [],
    });
    if (!res) return;
    try {
      await api.remove('dbInstances', d.id, { finalBackup: String(!!res.finalBackup) });
      toast.success(`Deleting ${d.name}`);
      navigate('/managed-services/db');
    } catch (e) { toast.error('Delete failed', (e as Error).message) }
  };

  const charts: MetricDef[] = [
    { title: 'CPU', metrics: ['cpu'], unit: '%', max: 100 },
    { title: 'Memory', metrics: ['memory'], unit: '%', max: 100 },
    { title: 'Connections', metrics: ['connections'], unit: 'conn' },
    { title: d.engine === 'redis' ? 'Operations / s' : 'Queries / s', metrics: ['qps'] },
    { title: d.engine === 'redis' ? 'Keyspace hit ratio' : 'Buffer cache hit ratio', metrics: ['cacheHitRatio'], unit: '%' },
    { title: 'Storage used', metrics: ['storageUsed'], unit: 'GB', max: d.storageGB },
    { title: 'Disk IOPS', metrics: ['iops'] },
    { title: 'Disk latency', metrics: ['diskLatency'], unit: 'ms' },
  ];
  if (d.ha || d.readReplicas) {
    const lag = [...(d.ha ? ['standbyLag'] : []), ...Array.from({ length: d.readReplicas }, (_, i) => `replicaLag${i + 1}`)];
    charts.splice(4, 0, { title: 'Replication lag', metrics: lag, labels: lag.map((m) => (m === 'standbyLag' ? 'standby (sync)' : `replica ${m.slice(10)}`)), unit: 'ms' });
  }

  const proTab = (label: string) => pro ? <span className="inline-flex items-center gap-1.5">{label}<ProBadge /></span> : label;
  const allTabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'metrics', label: proTab('Metrics'), pro: true },
    { id: 'users', label: 'Databases & users', count: pro ? d.users.length : undefined },
    { id: 'backups', label: 'Backups', count: pro ? backups.length : undefined },
    { id: 'config', label: proTab('Configuration'), count: pending.length || undefined, pro: true },
    { id: 'networking', label: proTab('Networking'), pro: true },
    { id: 'settings', label: 'Settings' },
    { id: 'activity', label: proTab('Activity'), pro: true },
  ];
  const tabs = allTabs.filter((t) => pro || !t.pro);
  const current = tabs.some((t) => t.id === tab) ? tab : 'overview';

  return (
    <Page wide>
      <PageHeader
        title={d.name}
        icon={Database}
        iconColor={meta.color}
        crumbs={[{ label: 'Databases', to: '/managed-services/db' }, { label: d.name }]}
        status={<><StatusPill status={d.status} /><EngineBadge engine={d.engine} version={d.version} /></>}
        meta={<>
          <span>{d.size.vcpus} vCPU · {d.size.ramGB} GB · {d.storageGB} GB</span>
          <span>{d.ha ? 'HA' : 'single node'}{d.readReplicas ? ` · ${d.readReplicas} replica${d.readReplicas > 1 ? 's' : ''}` : ''}</span>
          <span>{locations.get(d.locationId)?.name ?? d.locationId}</span>
          <Pro><Mono copy>{d.host}</Mono></Pro>
          <Pro><span className="tabular text-fg-2">{money(d.monthlyCost)}/mo</span></Pro>
        </>}
        actions={<>
          {['stopped', 'error'].includes(d.status)
            ? <Button icon={Play} onClick={() => action.mutate({ a: 'start' })} loading={action.isPending && action.variables?.a === 'start'}>Start</Button>
            : <Button icon={Square} disabled={!isAvail} onClick={onStop}>Stop</Button>}
          {(pro || pending.length > 0) && (
            <Button icon={RotateCw} variant={pending.length ? 'primary' : 'secondary'} disabled={!isAvail} onClick={onRestart} title={pending.length ? `Pending: ${pending.join(', ')}` : undefined}>
              Restart{pending.length ? ' required' : ''}
            </Button>
          )}
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="More actions" variant="secondary" />} items={[
            ...(!pro && !pending.length ? [{ label: 'Restart', icon: RotateCw, disabled: !isAvail, onClick: onRestart }] : []),
            { label: 'Back up now', icon: Camera, disabled: !isAvail, onClick: () => action.mutate({ a: 'backup', body: {} }) },
            { label: 'Restore…', icon: History, onClick: () => setRestoreOpen(true) },
            { label: 'Scale…', icon: Scaling, disabled: !['available', 'stopped'].includes(d.status), onClick: () => setScaleOpen(true) },
            ...(pro ? [{ label: 'Fail over to standby', icon: Shuffle, disabled: !d.ha || !isAvail, hint: d.ha ? undefined : 'needs HA', onClick: onFailover }] : []),
            { divider: true, label: '' },
            { label: 'Delete', icon: Trash2, danger: true, onClick: onDelete },
          ]} />
        </>}
      />

      {op && <OperationRunner op={op} className="mb-5" compact />}

      {d.hasInitialCredentials && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4 @min-[36rem]:flex-row @min-[36rem]:items-center">
          <ShieldAlert className="size-5 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1 text-[13px] text-amber-900 dark:text-amber-200">
            <div className="font-medium">Your admin password is ready</div>
            It can be revealed <b>once</b>. Afterwards, use “Reset password” in Databases &amp; users to generate a new one.
          </div>
          <Button size="sm" variant="primary" icon={KeyRound} loading={reveal.isPending} onClick={() => reveal.mutate()}>Reveal password</Button>
        </div>
      )}

      <Tabs className="mb-5" value={current} onChange={setTab} tabs={tabs} />

      {current === 'overview' && <DbOverviewTab d={d} />}
      {current === 'metrics' && <MetricsPanel collection="dbInstances" id={d.id} charts={charts} live={d.status !== 'stopped'} />}
      {current === 'users' && <DbUsersTab d={d} />}
      {current === 'backups' && <DbBackupsTab d={d} />}
      {current === 'config' && <DbConfigTab d={d} />}
      {current === 'networking' && <DbNetworkingTab d={d} />}
      {current === 'settings' && <DbSettingsTab d={d} onDelete={onDelete} />}
      {current === 'activity' && <ActivityTab id={d.id} />}

      <PasswordModal creds={creds} onClose={() => setCreds(null)} title="Admin credentials" />
      <DbScaleModal d={d} open={scaleOpen} onClose={() => setScaleOpen(false)} />
      <DbRestoreModal d={d} backups={backups} open={restoreOpen} onClose={() => setRestoreOpen(false)} />
    </Page>
  );
}

function ActivityTab({ id }: { id: string }) {
  const { items: ops } = useOperationsFor(id);
  const recent = [...ops].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  return (
    <div className="grid items-start gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_420px]">
      <Card>
        <CardHeader title="Audit log" description="Every change to this database, by whom and from where." />
        <ActivityFeed targetId={id} />
      </Card>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-fg">Recent operations</h3>
        {recent.length === 0 ? <p className="text-sm text-muted">No operations yet.</p> : recent.map((o) => <OperationRunner key={o.id} op={o} compact />)}
      </div>
    </div>
  );
}
