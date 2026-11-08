import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { HardDrive, Plus, Unlink, Camera, Link2, Disc3, Scaling, ExternalLink } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation, useList, useMetrics } from '@/api/hooks';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Select } from '@/components/ui/form';
import { Meter, StackBar, EmptyState, Mono } from '@/components/ui/misc';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { OperationInline } from '@/components/resource/OperationRunner';
import { OsBadge } from '@/lib/images';
import { money, gb } from '@/lib/format';
import { volumeCost, PRICING } from '@/lib/pricing';
import { usePro } from '@/store/ui';
import type { VmCtx } from './context';
import type { Volume, Operation } from '@/types';

const TYPE_COLOR: Record<Volume['type'], string> = { ssd: '#0ea5e9', nvme: '#a855f7', hdd: '#64748b' };

export function VmStorage({ c, onResize, onNewVolume }: { c: VmCtx; onResize: () => void; onNewVolume: () => void }) {
  const { vm, image, volumes } = c;
  const { items: projectVols } = useList<Volume>('volumes', { projectId: vm.projectId });
  const { items: ops } = useList<Operation>('operations', { status: 'running' });
  const opBy = useMemo(() => new Map(ops.map((o) => [o.target.id, o])), [ops]);
  const { data } = useMetrics('vms', vm.id, ['diskUsed'], '1h');
  const diskPct = data?.series?.diskUsed?.points.at(-1)?.v ?? 30;
  const attachable = projectVols.filter((v) => v.status === 'available' && v.locationId === vm.locationId && !v.attachedTo);
  const [pick, setPick] = useState('');
  const pro = usePro();
  // include volumes currently being created for this VM (not yet attached)
  const pending = projectVols.filter((v) => v.status === 'creating' && opBy.get(v.id) && !volumes.some((x) => x.id === v.id) && opBy.get(v.id)!.steps.some((s) => s.name.includes(vm.name)));

  const attach = useApiMutation((volumeId: string) => api.action('volumes', volumeId, 'attach', { vmId: vm.id }), { success: 'Attaching volume', onSuccess: () => setPick('') });
  const detach = async (v: Volume) => {
    const res = await confirm({
      title: `Detach ${v.name}?`, confirmLabel: 'Detach', danger: true,
      message: vm.status === 'running' ? `The guest will sync and unmount ${v.attachedTo?.device}. Make sure no process is writing to /mnt/${v.name}.` : `${v.attachedTo?.device} is removed from the VM definition.`,
      options: vm.status === 'running' ? [{ id: 'force', label: 'Force detach', description: 'Skip the guest unmount (risk of data loss for unflushed writes).' }] : undefined,
    });
    if (!res) return;
    try { await api.action('volumes', v.id, 'detach', { force: !!res.force }); toast.success(`Detaching ${v.name}`) } catch (e) { toast.error('Detach failed', (e as Error).message) }
  };
  const snap = async (v: Volume) => {
    try { await api.action('volumes', v.id, 'snapshot', {}); toast.success(`Snapshot of ${v.name} started`) } catch (e) { toast.error('Snapshot failed', (e as Error).message) }
  };

  const total = vm.size.systemDiskGB + volumes.reduce((a, v) => a + v.sizeGB, 0);
  const sysCost = vm.size.systemDiskGB * PRICING.vm.systemDiskGBPerMonth;
  const volCost = volumes.reduce((a, v) => a + (v.monthlyCost ?? volumeCost(v).total), 0);
  const segments = [{ value: vm.size.systemDiskGB, color: '#5b67f8', label: 'System disk' }, ...volumes.map((v) => ({ value: v.sizeGB, color: TYPE_COLOR[v.type], label: v.name }))];

  return (
    <div className="space-y-5">
      {pro && <Card className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs text-muted">Total provisioned</div>
            <div className="text-2xl font-semibold tabular text-fg">{gb(total)}</div>
          </div>
          <div className="text-right text-xs text-muted">{volumes.length + 1} disk{volumes.length ? 's' : ''} · <span className="tabular text-fg-2">{money(sysCost + volCost)}/mo</span></div>
        </div>
        <StackBar className="mt-3" height="h-3" total={total} segments={segments} />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          {segments.map((s) => <span key={s.label} className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: s.color }} />{s.label} · {gb(s.value)}</span>)}
        </div>
      </Card>}

      <Card>
        <CardHeader title="System disk" icon={Disc3} description={pro ? 'Copy-on-write clone of the image, replicated ×3' : undefined} actions={<Button size="xs" icon={Scaling} onClick={onResize} disabled={!['running', 'stopped'].includes(vm.status)}>Grow</Button>} />
        <div className="flex flex-col gap-4 p-4 @min-[36rem]:flex-row @min-[36rem]:items-center">
          <div className="flex min-w-0 items-center gap-3 @min-[36rem]:w-72">
            <OsBadge os={image?.os ?? 'custom'} size={36} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-fg"><Mono>/dev/vda</Mono><Badge>{vm.size.systemDiskGB} GB</Badge></div>
              <div className="truncate text-xs text-muted">{image?.name ?? vm.imageId} · ext4 · mounted at /</div>
            </div>
          </div>
          <div className="flex-1">
            <Meter value={diskPct} max={100} label={`${Math.round((diskPct / 100) * vm.size.systemDiskGB)} GB of ${vm.size.systemDiskGB} GB used`} showLabel />
            {diskPct > 80 && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Running low on space — grow the disk or move data to a volume.</p>}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Attached volumes" icon={HardDrive} description={pro ? 'Block volumes are hot-pluggable and keep their data independent of the VM' : undefined}
          actions={<Button size="xs" variant="primary" icon={Plus} onClick={onNewVolume} disabled={['deleting', 'error'].includes(vm.status)}>Create & attach</Button>} />
        {volumes.length === 0 && pending.length === 0 ? <EmptyState icon={HardDrive} title="No data volumes" description="Attach an existing volume or create a new one — it shows up in the guest as /dev/vdb." className="py-8" /> : (
          <ul className="divide-y divide-line">
            {[...volumes, ...pending].map((v) => {
              const op = opBy.get(v.id);
              return (
                <li key={v.id} className="grid gap-3 px-4 py-3 @min-[36rem]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] @min-[36rem]:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${TYPE_COLOR[v.type]}1a`, color: TYPE_COLOR[v.type] }}><HardDrive className="size-4" /></span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/infrastructure/volumes/${v.id}`} className="truncate text-sm font-medium text-fg hover:text-brand-500">{v.name}</Link>
                        <Badge>{v.type.toUpperCase()}</Badge>
                        {v.status !== 'in-use' && <StatusPill status={v.status} />}
                      </div>
                      <div className="truncate text-xs text-muted"><span className="font-mono">{v.attachedTo?.device ?? 'pending'}</span> · {v.filesystem !== 'none' ? `/mnt/${v.name}` : 'raw'}{pro && <> · {v.iops.toLocaleString()} IOPS · {v.throughputMBps} MB/s{v.encrypted ? ' · encrypted' : ''}</>}</div>
                    </div>
                  </div>
                  <div className="min-w-0">
                    {op ? <OperationInline op={op} /> : <Meter value={v.usedGB} max={v.sizeGB} size="sm" label={`${gb(v.usedGB)} / ${gb(v.sizeGB)}`} showLabel />}
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <span className="mr-2 text-xs tabular text-muted">{money(v.monthlyCost)}/mo</span>
                    <IconButton icon={Camera} label="Snapshot volume" size="sm" disabled={!['in-use', 'available'].includes(v.status)} onClick={() => snap(v)} />
                    <IconButton icon={Unlink} label="Detach" size="sm" disabled={v.status !== 'in-use'} onClick={() => detach(v)} />
                    <Link to={`/infrastructure/volumes/${v.id}`} className="inline-flex size-8 items-center justify-center rounded-lg text-fg-2 hover:bg-surface-2" title="Open volume" aria-label="Open volume"><ExternalLink className="size-4" /></Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-col gap-2 border-t border-line bg-surface-2/40 p-3 @min-[36rem]:flex-row @min-[36rem]:items-center">
          <Link2 className="hidden size-4 text-muted @min-[36rem]:block" />
          <Select className="min-w-0 flex-1" value={pick} onChange={(e) => setPick(e.target.value)} placeholder={attachable.length ? 'Attach an existing volume…' : `No unattached volumes in ${vm.locationId} for this project`}
            options={attachable.map((v) => ({ value: v.id, label: `${v.name} · ${v.sizeGB} GB ${v.type.toUpperCase()} · ${v.iops.toLocaleString()} IOPS` }))} disabled={!attachable.length} />
          <Button size="sm" icon={Link2} disabled={!pick} loading={attach.isPending} onClick={() => attach.mutate(pick)}>Attach</Button>
        </div>
      </Card>
    </div>
  );
}
