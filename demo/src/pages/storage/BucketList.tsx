import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PackageOpen, Plus, MoreHorizontal, Trash2, Globe, Lock, KeyRound, HardDrive, Files, ShieldAlert, Building2, Cloud, History, ShieldCheck } from 'lucide-react';
import { useList, useLookup } from '@/api/hooks';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { StatusPill, Tags } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Tabs, useTabParam } from '@/components/ui/Tabs';
import { Stat } from '@/components/ui/Stat';
import { Hint } from '@/components/ui/form';
import { OperationInline } from '@/components/resource/OperationRunner';
import { AccessKeysPanel } from '@/components/storage/AccessKeysPanel';
import { AccessBadge, ClassBadge, UsageBar, CLASS_META, GB } from '@/components/storage/common';
import { deleteBucketFlow, toggleBucketAccess } from '@/components/storage/actions';
import { money, num, bytes, compact } from '@/lib/format';
import { Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import type { Bucket, AccessKey, Location, Project, Operation, StorageClass } from '@/types';

type Filter = 'all' | 'public' | 'locked' | StorageClass;

export default function BucketList() {
  const [sp] = useSearchParams();
  const pro = usePro();
  const [tab, setTab] = useTabParam('buckets');
  const { items: buckets, isLoading } = useList<Bucket>('buckets');
  const { items: keys } = useList<AccessKey>('accessKeys');
  const { map: locations } = useLookup<Location>('locations');
  const { map: projects } = useLookup<Project>('projects');
  const { items: ops } = useList<Operation>('operations', { status: 'running' });
  const [filter, setFilter] = useState<Filter>('all');
  const opByTarget = useMemo(() => new Map(ops.map((o) => [o.target.id, o])), [ops]);

  const totalBytes = buckets.reduce((a, b) => a + b.bytesUsed, 0);
  const totalObjects = buckets.reduce((a, b) => a + b.objectCount, 0);
  const totalCost = buckets.reduce((a, b) => a + (b.monthlyCost ?? 0), 0);
  const publicBuckets = buckets.filter((b) => b.access === 'public-read');
  const egress = buckets.reduce((a, b) => a + b.egressGBLast30d, 0);
  const byClass = (Object.keys(CLASS_META) as StorageClass[]).map((c) => ({ c, bytes: buckets.reduce((a, b) => a + (b.classBreakdown?.[c] ?? (b.storageClass === c ? b.bytesUsed : 0)), 0) }));

  const rows = buckets.filter((b) => filter === 'all' || (filter === 'public' ? b.access === 'public-read' : filter === 'locked' ? b.objectLock : b.storageClass === filter));

  const toggleAccess = (b: Bucket) => toggleBucketAccess(b);
  const removeMany = async (list: Bucket[]) => { for (const b of list) if (!await deleteBucketFlow(b)) break };

  const allColumns: (Column<Bucket> & { pro?: boolean })[] = [
    {
      id: 'name', header: 'Name', sort: (b) => b.name,
      cell: (b) => {
        const p = projects.get(b.projectId);
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500"><PackageOpen className="size-4" /></div>
            <div className="min-w-0">
              <Link to={`/managed-services/object-storage/${b.id}`} className="block truncate font-medium text-fg hover:text-brand-500">{b.name}</Link>
              <div className="flex items-center gap-1.5 text-[11px] text-muted">
                {p && <span className="size-1.5 rounded-full" style={{ background: p.color }} title={p.name} />}
                {pro ? <span className="font-mono">{b.id}</span> : <span className="truncate">{locations.get(b.locationId)?.name ?? b.locationId}</span>}
                {pro && b.versioning && <span title="Versioning enabled"><History className="size-3" /></span>}
                {pro && b.objectLock && <span title={`Object lock (${b.objectLockMode ?? 'governance'}, ${b.objectLockRetentionDays ?? 30}d)`}><ShieldCheck className="size-3 text-emerald-500" /></span>}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'status', header: 'Access', sort: (b) => b.access,
      cell: (b) => {
        const op = opByTarget.get(b.id);
        if (op || (b.status && b.status !== 'active')) return <div className="w-32"><StatusPill status={b.status ?? 'active'} />{op && <OperationInline op={op} className="mt-1.5" />}</div>;
        return <AccessBadge access={b.access} />;
      },
    },
    { id: 'usage', header: pro ? 'Usage' : 'Size', sort: (b) => b.bytesUsed, cell: (b) => pro ? <UsageBar bucket={b} className="w-36" /> : <span className="tabular text-fg">{bytes(b.bytesUsed)}</span> },
    { id: 'objects', header: 'Objects', align: 'right', hideBelow: 'md', sort: (b) => b.objectCount, cell: (b) => <span className="tabular text-fg-2">{compact(b.objectCount)}</span> },
    { id: 'class', header: 'Class', pro: true, hideBelow: 'lg', sort: (b) => b.storageClass, cell: (b) => <ClassBadge value={b.storageClass} /> },
    {
      id: 'location', header: 'Location', pro: true, hideBelow: 'xl', sort: (b) => b.locationId,
      cell: (b) => { const l = locations.get(b.locationId); return <span className="flex items-center gap-1.5 text-fg-2">{l?.kind === 'cloud' ? <Cloud className="size-3.5 text-sky-500" /> : <Building2 className="size-3.5 text-emerald-500" />}<span className="truncate">{l?.name ?? b.locationId}</span></span> },
    },
    { id: 'tags', header: 'Tags', pro: true, hideBelow: 'xl', cell: (b) => <Tags tags={b.tags} max={2} /> },
    { id: 'cost', header: 'Monthly', pro: true, align: 'right', sort: (b) => b.monthlyCost ?? 0, cell: (b) => <span className="tabular text-fg">{money(b.monthlyCost)}</span> },
  ];
  const columns: Column<Bucket>[] = allColumns.filter((c) => pro || !c.pro);

  return (
    <Page wide>
      <PageHeader
        title="Object Storage"
        description={pro ? 'S3-compatible buckets on your own hardware — erasure-coded, encrypted, with lifecycle tiering.' : 'S3-compatible storage for files, backups and static assets.'}
        icon={PackageOpen}
        iconColor="#eab308"
        actions={<>
          <Pro><Button icon={KeyRound} onClick={() => setTab('keys')}>Access keys</Button></Pro>
          <Button variant="primary" icon={Plus} to="/managed-services/object-storage/new">Create bucket</Button>
        </>}
      />

      <Pro>
      <div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Stored" value={bytes(totalBytes)} icon={HardDrive} sub={`${buckets.length} bucket${buckets.length === 1 ? '' : 's'}`} />
        <Stat label="Objects" value={compact(totalObjects)} icon={Files} sub={`${num(egress)} GB egress / 30d`} />
        <Stat label="Public buckets" value={publicBuckets.length} icon={publicBuckets.length ? ShieldAlert : Lock} sub={publicBuckets.length ? <span className="text-amber-600 dark:text-amber-400">anonymous read enabled</span> : 'all private'} />
        <Stat label="Monthly run-rate" value={money(totalCost)} sub="storage, requests & egress" accent="#eab308" />
      </div>

      {totalBytes > 0 && (
        <div className="mb-5 rounded-xl border border-line bg-surface p-4 shadow-card">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px]">
            <span className="font-medium text-fg-2">Storage by class</span>
            <span className="text-xs text-muted">after lifecycle transitions</span>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-3">
            {byClass.map(({ c, bytes: v }) => <div key={c} className="h-full transition-all duration-500" style={{ width: `${(v / totalBytes) * 100}%`, background: CLASS_META[c].color }} title={`${CLASS_META[c].label}: ${bytes(v)}`} />)}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
            {byClass.map(({ c, bytes: v }) => (
              <span key={c} className="flex items-center gap-1.5 text-muted"><span className="size-2.5 rounded-sm" style={{ background: CLASS_META[c].color }} />{CLASS_META[c].label}<span className="tabular font-medium text-fg-2">{bytes(v)}</span><span className="text-faint">· {money((v / GB) * CLASS_META[c].price)}/mo</span></span>
            ))}
          </div>
        </div>
      )}
      </Pro>

      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { id: 'buckets', label: 'Buckets', count: buckets.length, icon: <PackageOpen className="size-3.5" /> },
        { id: 'keys', label: 'Access keys', count: keys.filter((k) => k.status === 'active').length, icon: <KeyRound className="size-3.5" /> },
      ]} />

      {tab === 'keys' ? <AccessKeysPanel /> : (
        <>
          {pro && publicBuckets.length > 0 && filter === 'all' && (
            <Hint tone="warning" className="mb-3">
              {publicBuckets.length === 1 ? <><b>{publicBuckets[0].name}</b> is</> : <><b>{publicBuckets.length} buckets</b> are</>} publicly readable. Review that only intended static assets are stored there.
            </Hint>
          )}
          <DataTable
            rows={rows}
            loading={isLoading}
            columns={columns}
            initialSearch={sp.get('q') ?? ''}
            searchText={(b) => `${b.name} ${b.id} ${b.locationId} ${b.storageClass} ${b.access} ${b.tags.map((t) => `${t.key}:${t.value} ${t.value}`).join(' ')}`}
            searchPlaceholder="Search buckets, tags (env:prod)…"
            rowLink={(b) => `/managed-services/object-storage/${b.id}`}
            defaultSort={{ id: 'name', dir: 'asc' }}
            toolbar={(pro || publicBuckets.length > 0) && <FilterChips value={filter} onChange={setFilter} options={[
              { value: 'all', label: 'All', count: buckets.length },
              ...(publicBuckets.length ? [{ value: 'public' as const, label: 'Public', count: publicBuckets.length }] : []),
              ...(pro ? [
                { value: 'locked' as const, label: 'Object lock', count: buckets.filter((b) => b.objectLock).length },
                { value: 'STANDARD' as const, label: 'Standard', count: buckets.filter((b) => b.storageClass === 'STANDARD').length },
                { value: 'INFREQUENT' as const, label: 'Infrequent', count: buckets.filter((b) => b.storageClass === 'INFREQUENT').length },
              ] : []),
              ...(pro && buckets.some((b) => b.storageClass === 'ARCHIVE') ? [{ value: 'ARCHIVE' as const, label: 'Archive', count: buckets.filter((b) => b.storageClass === 'ARCHIVE').length }] : []),
            ]} />}
            rowActions={(b) => (
              <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />} items={[
                { label: 'Browse objects', icon: Files, to: `/managed-services/object-storage/${b.id}` },
                ...(pro ? [{ label: 'Lifecycle rules', icon: History, to: `/managed-services/object-storage/${b.id}?tab=lifecycle` }] : []),
                { label: 'Permissions & keys', icon: KeyRound, to: `/managed-services/object-storage/${b.id}?tab=permissions` },
                { divider: true, label: '' },
                b.access === 'private' ? { label: 'Make public…', icon: Globe, onClick: () => toggleAccess(b) } : { label: 'Make private', icon: Lock, onClick: () => toggleAccess(b) },
                { divider: true, label: '' },
                { label: 'Delete', icon: Trash2, danger: true, onClick: () => deleteBucketFlow(b) },
              ]} />
            )}
            bulkActions={[{ label: 'Delete', icon: Trash2, danger: true, onClick: removeMany }]}
            empty={{ icon: PackageOpen, title: 'No buckets yet', description: 'Store files, backups, logs and static assets with an S3-compatible API.', action: <Button variant="primary" icon={Plus} to="/managed-services/object-storage/new">Create bucket</Button> }}
          />
        </>
      )}
    </Page>
  );
}
