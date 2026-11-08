import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Database, Plus, Play, Square, RotateCw, Trash2, MoreHorizontal, Archive, SlidersHorizontal, ShieldCheck, Copy, HardDrive, Layers } from 'lucide-react';
import { useList, useLookup, useApiMutation } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { StatusPill, Tags, Badge } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Stat } from '@/components/ui/Stat';
import { Mono, Meter } from '@/components/ui/misc';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { OperationInline } from '@/components/resource/OperationRunner';
import { EngineLogo, ENGINE_META, DB_TRANSITIONAL, topologyLabel } from '@/components/db/engine';
import { money, num, gb, timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import type { DbInstance, DbEngine, Location, Operation, Project } from '@/types';

type StatusFilter = 'all' | 'available' | 'stopped' | 'transitional' | 'error';

export default function DbList() {
  const [sp] = useSearchParams();
  const pro = usePro();
  const { items: dbs, isLoading } = useList<DbInstance>('dbInstances');
  const { map: locations } = useLookup<Location>('locations');
  const { map: projects } = useLookup<Project>('projects');
  const { items: ops } = useList<Operation>('operations', { status: 'running' });
  const [status, setStatus] = useState<StatusFilter>('all');
  const [engine, setEngine] = useState<'all' | DbEngine>((sp.get('engine') as DbEngine) ?? 'all');

  const opByTarget = useMemo(() => new Map(ops.map((o) => [o.target.id, o])), [ops]);
  const byEngine = dbs.filter((d) => engine === 'all' || d.engine === engine);
  const counts = {
    all: byEngine.length,
    available: byEngine.filter((d) => d.status === 'available').length,
    stopped: byEngine.filter((d) => d.status === 'stopped').length,
    transitional: byEngine.filter((d) => DB_TRANSITIONAL.includes(d.status)).length,
    error: byEngine.filter((d) => d.status === 'error').length,
  };
  const rows = byEngine.filter((d) => status === 'all' || (status === 'transitional' ? DB_TRANSITIONAL.includes(d.status) : d.status === status));
  const engines = (Object.keys(ENGINE_META) as DbEngine[]).filter((e) => dbs.some((d) => d.engine === e));

  const action = useApiMutation(({ id, a }: { id: string; a: string }) => api.action('dbInstances', id, a), { silent: true, onError: (e) => toast.error('Action failed', e.message) });
  const run = (d: DbInstance, a: string, label: string) => action.mutate({ id: d.id, a }, { onSuccess: () => toast.success(`${label} ${d.name}`) });

  const bulk = async (list: DbInstance[], a: 'start' | 'stop' | 'backup') => {
    const ok = list.filter((d) => (a === 'start' ? ['stopped', 'error'].includes(d.status) : d.status === 'available'));
    if (!ok.length) { toast.info(`None of the selected databases can ${a === 'backup' ? 'be backed up' : a} right now`); return }
    const res = await Promise.allSettled(ok.map((d) => action.mutateAsync({ id: d.id, a })));
    const failed = res.filter((r) => r.status === 'rejected').length;
    toast.success(`${a === 'backup' ? 'Backup' : a[0].toUpperCase() + a.slice(1)} requested for ${ok.length - failed} database${ok.length - failed === 1 ? '' : 's'}`);
  };

  const remove = async (list: DbInstance[]) => {
    const protectedOnes = list.filter((d) => d.deletionProtection);
    if (protectedOnes.length === list.length) { toast.error('Deletion protection is enabled', `Disable it in Settings for ${protectedOnes.map((d) => d.name).join(', ')} first.`); return }
    const res = await confirm({
      title: `Delete ${list.length === 1 ? list[0].name : `${list.length} databases`}?`,
      message: <>All data, the standby and read replicas are destroyed. Automated backups are removed; manual backups are kept.{protectedOnes.length > 0 && <span className="mt-1 block text-amber-600 dark:text-amber-400">{protectedOnes.map((d) => d.name).join(', ')} {protectedOnes.length > 1 ? 'are' : 'is'} protected and will be skipped.</span>}</>,
      confirmLabel: 'Delete', danger: true, typeToConfirm: list.length === 1 ? list[0].name : undefined,
      options: [{ id: 'finalBackup', label: 'Take a final backup first', description: 'Kept after deletion so you can restore later.', default: true }],
    });
    if (!res) return;
    const targets = list.filter((d) => !d.deletionProtection);
    const results = await Promise.allSettled(targets.map((d) => api.remove('dbInstances', d.id, { finalBackup: String(!!res.finalBackup) })));
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) toast.error(`${failed.length} deletion(s) failed`, failed[0].reason?.message);
    else toast.success(`Deleting ${targets.length} database${targets.length > 1 ? 's' : ''}`);
  };

  const live = dbs.filter((d) => d.status !== 'stopped');
  const totalCost = dbs.reduce((a, d) => a + (d.monthlyCost ?? 0), 0);
  const storage = dbs.reduce((a, d) => a + d.storageGB, 0);
  const used = dbs.reduce((a, d) => a + d.storageUsedGB, 0);
  const haCount = dbs.filter((d) => d.ha).length;
  const nearlyFull = dbs.filter((d) => d.storageUsedGB / d.storageGB >= 0.8);

  const allColumns: (Column<DbInstance> & { pro?: boolean })[] = [
    {
      id: 'name', header: 'Name', sort: (d) => d.name,
      cell: (d) => {
        const p = projects.get(d.projectId);
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <EngineLogo engine={d.engine} size={28} />
            <div className="min-w-0">
              <Link to={`/managed-services/db/${d.id}`} className="block truncate font-medium text-fg hover:text-brand-500">{d.name}</Link>
              <div className="flex items-center gap-1.5 text-[11px] text-muted">
                {p && <span className="size-1.5 rounded-full" style={{ background: p.color }} title={p.name} />}
                <span>{ENGINE_META[d.engine].label} {d.version}</span>
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'status', header: 'Status', sort: (d) => d.status,
      cell: (d) => {
        const op = opByTarget.get(d.id);
        return (
          <div className={cn(op && 'w-36')}>
            <div className="flex items-center gap-1.5">
              <StatusPill status={d.status} />
              {!!d.pendingRestart?.length && d.status === 'available' && <Badge tone="warning" title={`Pending restart: ${d.pendingRestart.join(', ')}`}>restart</Badge>}
            </div>
            {op && <OperationInline op={op} className="mt-1.5" />}
          </div>
        );
      },
    },
    {
      id: 'size', header: 'Size', sort: (d) => d.size.vcpus * 1000 + d.size.ramGB,
      cell: (d) => <span className="whitespace-nowrap tabular text-fg">{d.size.vcpus} vCPU · {d.size.ramGB} GB</span>,
    },
    {
      id: 'topology', header: 'Topology', pro: true, hideBelow: 'lg', sort: (d) => (d.ha ? 10 : 0) + d.readReplicas,
      cell: (d) => <TopologyGlyph ha={d.ha} replicas={d.readReplicas} />,
    },
    {
      id: 'storage', header: 'Storage', pro: true, hideBelow: 'md', sort: (d) => d.storageUsedGB / d.storageGB,
      cell: (d) => (
        <div className="w-32">
          <div className="mb-1 flex justify-between text-[11px] tabular"><span className="text-fg-2">{gb(Math.round(d.storageUsedGB))}</span><span className="text-muted">/ {gb(d.storageGB)}</span></div>
          <Meter value={d.storageUsedGB} max={d.storageGB} size="xs" />
        </div>
      ),
    },
    {
      id: 'endpoint', header: 'Endpoint', hideBelow: pro ? 'xl' : 'md',
      cell: (d) => (
        <div className="max-w-64 leading-tight">
          <Mono copy={`${d.host}:${d.port}`} className="block">{d.host}:{d.port}</Mono>
          <span className="text-[11px] text-muted">{locations.get(d.locationId)?.name ?? d.locationId}{d.publicAccess ? ' · public' : ' · private'}</span>
        </div>
      ),
    },
    { id: 'tags', header: 'Tags', pro: true, hideBelow: 'xl', cell: (d) => <Tags tags={d.tags} max={2} /> },
    { id: 'cost', header: 'Monthly', pro: true, align: 'right', sort: (d) => d.monthlyCost ?? 0, cell: (d) => <span className="tabular text-fg">{money(d.monthlyCost)}</span> },
  ];
  const columns: Column<DbInstance>[] = allColumns.filter((c) => pro || !c.pro);

  const rowMenu = (d: DbInstance) => (
    <Menu
      trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />}
      items={[
        { label: 'Start', icon: Play, disabled: !['stopped', 'error'].includes(d.status), onClick: () => run(d, 'start', 'Starting') },
        { label: 'Stop', icon: Square, disabled: d.status !== 'available', onClick: () => run(d, 'stop', 'Stopping') },
        { label: d.pendingRestart?.length ? 'Restart (pending changes)' : 'Restart', icon: RotateCw, disabled: d.status !== 'available', onClick: () => run(d, 'restart', 'Restarting') },
        { label: 'Back up now', icon: Archive, disabled: d.status !== 'available', onClick: () => run(d, 'backup', 'Backing up') },
        { divider: true, label: '' },
        { label: 'Copy endpoint', icon: Copy, onClick: () => { navigator.clipboard?.writeText(`${d.host}:${d.port}`).catch(() => {}); toast.success('Endpoint copied') } },
        { label: 'Connection details', icon: Database, to: `/managed-services/db/${d.id}` },
        { divider: true, label: '' },
        { label: 'Delete', icon: Trash2, danger: true, disabled: d.status === 'deleting', onClick: () => remove([d]) },
      ]}
    />
  );

  return (
    <Page wide>
      <PageHeader
        title="Databases"
        description={pro ? 'Managed PostgreSQL, MySQL, MariaDB and Redis on your own hardware — HA, replicas, backups and point-in-time recovery included.' : 'Managed PostgreSQL, MySQL, MariaDB and Redis with automatic backups.'}
        icon={Database}
        iconColor="#3b82f6"
        actions={<>
          <Pro><Button icon={SlidersHorizontal} to="/managed-services/db/presets">Size presets</Button></Pro>
          <Button variant="primary" icon={Plus} to="/managed-services/db/new">Create database</Button>
        </>}
      />

      <Pro>
      <div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Available" value={`${counts.available} / ${dbs.length}`} icon={Database} sub={counts.error ? <span className="text-rose-500">{counts.error} in error</span> : `${live.length} running`} />
        <Stat label="High availability" value={`${haCount} / ${dbs.length}`} icon={ShieldCheck} sub={`${dbs.reduce((a, d) => a + d.readReplicas, 0)} read replicas`} />
        <Stat label="Storage used" value={gb(Math.round(used))} icon={HardDrive} sub={nearlyFull.length ? <span className="text-amber-600 dark:text-amber-400">{nearlyFull.length} above 80%</span> : `of ${gb(storage)} provisioned`} />
        <Stat label="Monthly run-rate" value={money(totalCost)} sub="instances, storage & backups" accent="#3b82f6" />
      </div>
      </Pro>

      {pro && engines.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          <EngineChip active={engine === 'all'} onClick={() => setEngine('all')} label="All engines" count={dbs.length} />
          {engines.map((e) => <EngineChip key={e} engine={e} active={engine === e} onClick={() => setEngine(e)} label={ENGINE_META[e].label} count={dbs.filter((d) => d.engine === e).length} />)}
        </div>
      )}

      <DataTable
        rows={rows}
        loading={isLoading}
        columns={columns}
        initialSearch={sp.get('q') ?? ''}
        searchText={(d) => `${d.name} ${d.id} ${d.engine} ${ENGINE_META[d.engine].label} ${d.version} ${d.host} ${d.privateIp ?? ''} ${d.tags.map((t) => `${t.key}:${t.value} ${t.value}`).join(' ')} ${d.locationId}`}
        searchPlaceholder="Search name, host, engine, tag (env:prod)…"
        rowLink={(d) => `/managed-services/db/${d.id}`}
        rowActions={rowMenu}
        defaultSort={{ id: 'name', dir: 'asc' }}
        toolbar={
          <FilterChips value={status} onChange={setStatus} options={[
            { value: 'all', label: 'All', count: counts.all }, { value: 'available', label: 'Available', count: counts.available }, { value: 'stopped', label: 'Stopped', count: counts.stopped },
            ...(counts.transitional ? [{ value: 'transitional' as const, label: 'In progress', count: counts.transitional }] : []),
            ...(counts.error ? [{ value: 'error' as const, label: 'Error', count: counts.error }] : []),
          ]} />
        }
        bulkActions={[
          { label: 'Start', icon: Play, onClick: (r) => bulk(r, 'start') },
          { label: 'Stop', icon: Square, onClick: (r) => bulk(r, 'stop') },
          { label: 'Back up', icon: Archive, onClick: (r) => bulk(r, 'backup') },
          { label: 'Delete', icon: Trash2, danger: true, onClick: remove },
        ]}
        empty={{ icon: Database, title: 'No databases yet', description: 'Launch a managed PostgreSQL, MySQL, MariaDB or Redis instance with HA and backups in minutes.', action: <Button variant="primary" icon={Plus} to="/managed-services/db/new">Create database</Button> }}
      />

      {pro && rows.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          <Layers className="size-3.5" /> {num(rows.length)} shown · last backups: {rows.filter((d) => d.lastBackupAt).slice(0, 3).map((d) => `${d.name} ${timeAgo(d.lastBackupAt!)}`).join(' · ') || '—'}
        </p>
      )}
    </Page>
  );
}

function EngineChip({ engine, label, count, active, onClick }: { engine?: DbEngine; label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-[13px] font-medium transition-colors', active ? 'border-brand-500 bg-brand-500/[0.06] text-fg' : 'border-line bg-surface text-fg-2 hover:border-line-strong')}>
      {engine ? <EngineLogo engine={engine} size={18} className="rounded" /> : <Database className="size-4 text-muted" />}
      {label}
      <span className="rounded-full bg-surface-3 px-1.5 text-[11px] tabular text-muted">{count}</span>
    </button>
  );
}

/** Small glyph: primary node, optional standby (linked), replica dots. */
function TopologyGlyph({ ha, replicas }: { ha: boolean; replicas: number }) {
  return (
    <div className="flex items-center gap-2" title={topologyLabel({ ha, readReplicas: replicas })}>
      <div className="flex items-center">
        <span className="size-3 rounded-sm bg-brand-500" title="Primary" />
        {ha && <><span className="h-px w-2 bg-emerald-500" /><span className="size-3 rounded-sm border-2 border-emerald-500" title="Standby" /></>}
        {replicas > 0 && <span className="h-px w-2 border-t border-dashed border-sky-500" />}
        {Array.from({ length: replicas }).map((_, i) => <span key={i} className="-ml-0.5 size-2.5 rounded-full border-2 border-surface bg-sky-500 first:ml-0" title="Read replica" />)}
      </div>
      <span className="text-xs text-muted">{ha ? 'HA' : 'Single'}{replicas ? ` +${replicas}` : ''}</span>
    </div>
  );
}
