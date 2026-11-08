import { useEffect, useMemo, useState } from 'react';
import { Camera, ShieldCheck, Clock, Check, Layers } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation, useList } from '@/api/hooks';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, NumberInput, Select, Switch, Checkbox } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SnapshotTimeline, TRIGGER_STYLE, nextBackupAt } from '../SnapshotTimeline';
import { SnapshotMenu } from '../SnapshotActions';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { money, timeAgo, dateTime, gb } from '@/lib/format';
import { vmCost } from '@/lib/pricing';
import { usePro } from '@/store/ui';
import type { VmCtx } from './context';
import type { Snapshot, VM } from '@/types';

const WINDOWS = ['00:00-02:00', '02:00-04:00', '04:00-06:00', '22:00-24:00'];

export function VmSnapshots({ c, onSnapshot }: { c: VmCtx; onSnapshot: () => void }) {
  const { vm, volumes, location } = c;
  const [withVolumes, setWithVolumes] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const { items: volSnaps } = useList<Snapshot>('snapshots', { kind: 'volume', projectId: vm.projectId }, { enabled: withVolumes });
  const volIds = new Set(volumes.map((v) => v.id));
  const all = useMemo(() => [...c.snapshots, ...(withVolumes ? volSnaps.filter((s) => volIds.has(s.sourceId)) : [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [c.snapshots, volSnaps, withVolumes, volumes]); // eslint-disable-line
  const rows = selected ? all.filter((s) => s.id === selected) : all;

  const [b, setB] = useState<VM['backups']>(vm.backups);
  useEffect(() => setB(vm.backups), [JSON.stringify(vm.backups)]); // eslint-disable-line
  const dirty = JSON.stringify(b) !== JSON.stringify(vm.backups);
  const save = useApiMutation(() => api.update('vms', vm.id, { backups: b }), { success: 'Backup policy saved' });
  const extra = vmCost({ vcpus: vm.size.vcpus, ramGB: vm.size.ramGB, systemDiskGB: vm.size.systemDiskGB, gpu: vm.gpu, cloud: location?.kind === 'cloud', backups: true }).lines.find((l) => l.label.startsWith('Automated'))?.amount ?? 0;
  const next = vm.backups.enabled ? nextBackupAt(vm.backups.schedule, vm.backups.window) : null;
  const totalGB = all.reduce((a, s) => a + s.sizeGB, 0);

  const pro = usePro();
  const columns: Column<Snapshot>[] = [
    { id: 'name', header: 'Snapshot', sort: (s) => s.name, cell: (s) => (
      <div className="min-w-0">
        <div className="truncate font-medium text-fg">{s.name}</div>
        <div className="truncate text-[11px] text-muted">{s.kind === 'volume' ? <ResourceLink type="volume" id={s.sourceId} name={s.sourceName} className="text-[11px]" /> : 'system disk'}{s.description ? ` · ${s.description}` : ''}</div>
      </div>
    ) },
    { id: 'trigger', header: 'Trigger', sort: (s) => s.trigger, cell: (s) => <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: TRIGGER_STYLE[s.trigger].color }}><span className="size-2 rounded-full" style={{ background: TRIGGER_STYLE[s.trigger].color }} />{TRIGGER_STYLE[s.trigger].label}</span> },
    { id: 'status', header: 'Status', hideBelow: 'sm', cell: (s) => <StatusPill status={s.status} /> },
    { id: 'size', header: 'Size', align: 'right', sort: (s) => s.sizeGB, cell: (s) => <span className="tabular">{gb(s.sizeGB)}</span> },
    { id: 'created', header: 'Created', sort: (s) => s.createdAt, hideBelow: 'md', cell: (s) => <span className="text-fg-2" title={dateTime(s.createdAt)}>{timeAgo(s.createdAt)}</span> },
    ...(pro ? [{ id: 'cost', header: 'Monthly', align: 'right', hideBelow: 'lg', sort: (s) => s.monthlyCost ?? 0, cell: (s) => <span className="tabular text-muted">{money(s.monthlyCost)}</span> } satisfies Column<Snapshot>] : []),
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-5 @min-[56rem]:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title="Timeline" icon={Clock} description={`${all.length} restore point${all.length === 1 ? '' : 's'} · ${gb(Math.round(totalGB))} stored`} actions={
            <div className="flex items-center gap-2">
              {volumes.length > 0 && <Checkbox checked={withVolumes} onChange={setWithVolumes} label={<span className="flex items-center gap-1 text-xs"><Layers className="size-3.5" />volumes</span>} />}
              <Button size="xs" variant="primary" icon={Camera} onClick={onSnapshot} disabled={!['running', 'stopped'].includes(vm.status)}>Snapshot now</Button>
            </div>
          } />
          <div className="px-4 pb-3 pt-6">
            <SnapshotTimeline snapshots={all} selectedId={selected} onSelect={(s) => setSelected((x) => (x === s.id ? null : s.id))} nextAt={next} />
            {selected && <button onClick={() => setSelected(null)} className="mt-2 text-xs text-brand-500 hover:underline">Show all snapshots</button>}
          </div>
        </Card>

        <Card>
          <CardHeader title="Automated backups" icon={ShieldCheck} actions={dirty && <Button size="xs" variant="primary" icon={Check} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>} />
          <div className="space-y-4 p-4">
            <Switch checked={b.enabled} onChange={(v) => setB({ ...b, enabled: v })} label="Enabled" description={`Crash-consistent copies kept off-host. +${money(extra)}/mo (20%).`} />
            <div className={b.enabled ? 'space-y-4' : 'pointer-events-none space-y-4 opacity-50'}>
              <Field label="Schedule"><Segmented value={b.schedule} onChange={(v) => setB({ ...b, schedule: v })} options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly (Sun)' }]} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Window (UTC)"><Select value={b.window} onChange={(e) => setB({ ...b, window: e.target.value })} options={WINDOWS.map((w) => ({ value: w, label: w }))} /></Field>
                <Field label="Keep"><NumberInput value={b.retention} onChange={(v) => setB({ ...b, retention: v })} min={1} max={30} unit="copies" /></Field>
              </div>
              <div className="rounded-lg bg-surface-2 p-2.5 text-xs text-muted">
                {b.enabled ? <>Next run <b className="text-fg">{dateTime(nextBackupAt(b.schedule, b.window))}</b>. Restore points reach back <b className="text-fg">{b.schedule === 'daily' ? b.retention : b.retention * 7} days</b>.</> : 'No automatic restore points will be created.'}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <DataTable rows={rows} columns={columns} searchText={(s) => `${s.name} ${s.description ?? ''} ${s.trigger} ${s.sourceName}`} searchPlaceholder="Search snapshots…" defaultSort={{ id: 'created', dir: 'desc' }}
        rowActions={(s) => <SnapshotMenu snapshot={s} />}
        toolbar={pro && <Badge tone="neutral">{all.filter((s) => s.trigger === 'scheduled').length} scheduled · {all.filter((s) => s.trigger !== 'scheduled').length} manual</Badge>}
        empty={{ icon: Camera, title: 'No snapshots yet', description: 'Take a snapshot before risky changes — restores take seconds.', action: <Button size="sm" variant="primary" icon={Camera} onClick={onSnapshot}>Snapshot now</Button> }} />
    </div>
  );
}
