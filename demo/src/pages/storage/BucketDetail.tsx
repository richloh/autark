import { useParams, useNavigate } from 'react-router';
import { PackageOpen, Files, LayoutDashboard, History, KeyRound, Settings, Activity, MoreHorizontal, Copy, Globe, Lock, Trash2, Building2, Cloud, ShieldCheck, Upload } from 'lucide-react';
import { useItem, useActiveOperation, useLookup } from '@/api/hooks';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { StatusPill, Badge } from '@/components/ui/Badge';
import { Tabs, useTabParam } from '@/components/ui/Tabs';
import { Menu } from '@/components/ui/Menu';
import { Card } from '@/components/ui/Card';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { OperationRunner } from '@/components/resource/OperationRunner';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { ObjectBrowser } from '@/components/storage/ObjectBrowser';
import { BucketOverview, BucketLifecycle, BucketPermissions, BucketSettings } from '@/components/storage/BucketTabs';
import { AccessBadge, ClassBadge } from '@/components/storage/common';
import { deleteBucketFlow, toggleBucketAccess } from '@/components/storage/actions';
import { bytes, compact, money, timeAgo } from '@/lib/format';
import { Pro, ProBadge } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import type { Bucket, Location, Project } from '@/types';

export default function BucketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: b, isLoading, error } = useItem<Bucket>('buckets', id);
  const op = useActiveOperation(id);
  const [tab, setTab] = useTabParam('objects');
  const pro = usePro();
  const { map: locations } = useLookup<Location>('locations');
  const { map: projects } = useLookup<Project>('projects');

  if (isLoading) return <Page wide><Skeleton className="mb-4 h-12 w-80" /><Skeleton className="h-96" /></Page>;
  if (error || !b) {
    return (
      <Page>
        <EmptyState icon={PackageOpen} title="Bucket not found" description={`No bucket with id ${id} in this account — it may have been deleted.`} action={<Button to="/managed-services/object-storage">Back to buckets</Button>} />
      </Page>
    );
  }

  const loc = locations.get(b.locationId);
  const project = projects.get(b.projectId);
  const status = b.status ?? 'active';
  const copy = (text: string, label: string) => { navigator.clipboard?.writeText(text).catch(() => {}); toast.success(label, text) };
  const proLabel = (label: string) => pro ? <span className="inline-flex items-center gap-1.5">{label}<ProBadge /></span> : label;
  const allTabs = [
    { id: 'objects', label: 'Objects', icon: <Files className="size-3.5" /> },
    { id: 'overview', label: proLabel('Overview'), icon: <LayoutDashboard className="size-3.5" />, pro: true },
    { id: 'lifecycle', label: proLabel('Lifecycle'), count: b.lifecycleRules.filter((r) => r.enabled).length, icon: <History className="size-3.5" />, pro: true },
    { id: 'permissions', label: pro ? 'Permissions' : 'Access', icon: <KeyRound className="size-3.5" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="size-3.5" /> },
    { id: 'activity', label: proLabel('Activity'), icon: <Activity className="size-3.5" />, pro: true },
  ];
  const tabs = allTabs.filter((t) => pro || !t.pro).map(({ pro: _p, ...t }) => t);
  const current = tabs.some((t) => t.id === tab) ? tab : 'objects';

  return (
    <Page wide>
      <PageHeader
        title={b.name}
        icon={PackageOpen}
        iconColor="#eab308"
        crumbs={[{ label: 'Object Storage', to: '/managed-services/object-storage' }, { label: b.name }]}
        status={<>{status !== 'active' ? <StatusPill status={status} /> : <AccessBadge access={b.access} />}{b.objectLock && <Badge tone="success"><ShieldCheck className="size-3" />Object lock</Badge>}</>}
        description={b.description || undefined}
        meta={<>
          <span className="flex items-center gap-1">{loc?.kind === 'cloud' ? <Cloud className="size-3.5 text-sky-500" /> : <Building2 className="size-3.5 text-emerald-500" />}{loc?.name ?? b.locationId}</span>
          <Pro><ClassBadge value={b.storageClass} /></Pro>
          <span>{bytes(b.bytesUsed)} · {compact(b.objectCount)} objects</span>
          <Pro>
            {project && <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: project.color }} />{project.name}</span>}
            <span>{money(b.monthlyCost)}/mo</span>
          </Pro>
          <span>created {timeAgo(b.createdAt)}</span>
        </>}
        actions={<>
          {pro && <Button icon={Copy} onClick={() => copy(`s3://${b.name}`, 'S3 URI copied')} className="hidden @min-[36rem]:inline-flex">Copy URI</Button>}
          {current !== 'objects' && <Button variant="primary" icon={Upload} disabled={status !== 'active'} onClick={() => setTab('objects')}>Upload</Button>}
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="More actions" variant="secondary" />} items={[
            { label: 'Copy endpoint URL', icon: Copy, onClick: () => copy(b.endpoint, 'Endpoint copied') },
            { label: 'Copy S3 URI', icon: Copy, onClick: () => copy(`s3://${b.name}`, 'S3 URI copied') },
            { divider: true, label: '' },
            b.access === 'private' ? { label: 'Make public…', icon: Globe, disabled: status !== 'active', onClick: () => toggleBucketAccess(b) } : { label: 'Block public access', icon: Lock, onClick: () => toggleBucketAccess(b) },
            { label: 'Manage access keys', icon: KeyRound, onClick: () => setTab('permissions') },
            { divider: true, label: '' },
            { label: 'Delete bucket', icon: Trash2, danger: true, disabled: status === 'deleting', onClick: async () => { if (await deleteBucketFlow(b) && b.objectCount === 0) navigate('/managed-services/object-storage') } },
          ]} />
        </>}
      />

      {op && <OperationRunner op={op} className="mb-5" compact />}

      <Tabs className="mb-5" value={current} onChange={setTab} tabs={tabs} />

      {current === 'objects' && <ObjectBrowser bucket={b} />}
      {current === 'overview' && <BucketOverview bucket={b} />}
      {current === 'lifecycle' && <BucketLifecycle bucket={b} />}
      {current === 'permissions' && <BucketPermissions bucket={b} />}
      {current === 'settings' && <BucketSettings bucket={b} onDeleted={() => { if (b.objectCount === 0) navigate('/managed-services/object-storage') }} />}
      {current === 'activity' && <Card><ActivityFeed targetId={b.id} /></Card>}
    </Page>
  );
}
