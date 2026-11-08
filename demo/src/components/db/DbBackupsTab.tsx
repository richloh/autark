import { useEffect, useMemo, useState } from 'react';
import { Archive, Camera, History, RotateCcw, Save, Settings2, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation, useList, useNow } from '@/api/hooks';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Stat } from '@/components/ui/Stat';
import { confirm } from '@/components/ui/Modal';
import { Field, Input, NumberInput, Switch, Hint } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/misc';
import { dateTime, timeAgo, num } from '@/lib/format';
import { cn } from '@/lib/cn';
import { DbRestoreModal } from './DbRestoreModal';
import { Pro, Advanced } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import type { DbBackup, DbInstance } from '@/types';

const TYPE_COLOR: Record<DbBackup['type'], string> = { automated: '#5b67f8', manual: '#f59e0b', final: '#ec4899', 'pre-upgrade': '#a855f7' };
const DAY = 86_400_000;

export function DbBackupsTab({ d }: { d: DbInstance }) {
  const { items: backups, isLoading } = useList<DbBackup>('dbBackups', { dbId: d.id });
  const now = useNow(30_000);
  const pro = usePro();
  const [restore, setRestore] = useState<{ open: boolean; backupId?: string; source?: 'backup' | 'pitr' }>({ open: false });
  const [hover, setHover] = useState<DbBackup | null>(null);
  const sorted = useMemo(() => [...backups].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [backups]);

  const backupNow = useApiMutation(() => api.action('dbInstances', d.id, 'backup', {}), { success: 'Backup started' });
  const del = useApiMutation((id: string) => api.remove('dbBackups', id), { success: 'Backup deleted' });

  // timeline window: retention days (min 3) back from now
  const windowDays = Math.max(3, d.backups.retention);
  const t0 = now - windowDays * DAY;
  const x = (t: number) => Math.max(0, Math.min(100, ((t - t0) / (now - t0)) * 100));
  const pitrStart = d.earliestRestoreTime ? Date.parse(d.earliestRestoreTime) : null;
  const totalGB = backups.reduce((a, b) => a + b.sizeGB, 0);

  const onDelete = async (b: DbBackup) => {
    if (await confirm({ title: `Delete backup ${b.name}?`, message: 'This backup can no longer be used for restores.', confirmLabel: 'Delete', danger: true })) del.mutate(b.id);
  };

  return (
    <div className="space-y-5">
      <Pro>
      <div className="grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Last backup" value={d.lastBackupAt ? timeAgo(d.lastBackupAt) : 'never'} icon={Archive} sub={d.backups.enabled ? `${d.backups.schedule}, window ${d.backups.window}` : 'automated backups off'} />
        <Stat label="Retention" value={`${d.backups.retention} days`} icon={History} sub={`${backups.length} backups stored`} />
        <Stat label="Point-in-time" value={d.backups.pitr ? 'Enabled' : 'Off'} icon={RotateCcw} sub={pitrStart ? `since ${timeAgo(pitrStart)}` : d.engine === 'redis' ? 'not supported' : 'enable below'} />
        <Stat label="Backup storage" value={`${num(totalGB, 1)} GB`} sub="compressed, encrypted, off-site" />
      </div>

      <Card>
        <CardHeader icon={History} title="Recovery timeline" description={`Last ${windowDays} days. ${d.backups.pitr ? 'Any second inside the green band can be restored.' : 'Restore to any backup marker.'}`}
          actions={<>
            <Button size="sm" icon={RotateCcw} onClick={() => setRestore({ open: true, source: d.backups.pitr ? 'pitr' : 'backup' })}>Restore…</Button>
            <Button size="sm" variant="primary" icon={Camera} loading={backupNow.isPending} disabled={d.status !== 'available'} onClick={() => backupNow.mutate()}>Back up now</Button>
          </>} />
        <div className="p-4">
          <div className="relative h-20 select-none">
            {/* day grid */}
            {Array.from({ length: windowDays + 1 }, (_, i) => (
              <div key={i} className="absolute inset-y-0 border-l border-dashed border-line" style={{ left: `${(i / windowDays) * 100}%` }}>
                {(windowDays <= 14 || i % 2 === 0) && <span className="absolute bottom-0 -translate-x-1/2 text-[10px] text-faint">{i === windowDays ? 'now' : `-${windowDays - i}d`}</span>}
              </div>
            ))}
            {/* PITR band */}
            {pitrStart && (
              <div className="absolute top-7 h-3 rounded-full bg-emerald-500/25 ring-1 ring-emerald-500/40" style={{ left: `${x(pitrStart)}%`, right: 0 }} title={`Point-in-time recovery available since ${dateTime(pitrStart)}`}>
                <span className="absolute -top-5 left-1 whitespace-nowrap text-[10px] font-medium text-emerald-600 dark:text-emerald-400">PITR window</span>
              </div>
            )}
            {!pitrStart && <div className="absolute inset-x-0 top-[33px] h-px bg-line-strong" />}
            {/* backup markers */}
            {sorted.filter((b) => Date.parse(b.createdAt) >= t0).map((b) => (
              <button key={b.id} type="button" onMouseEnter={() => setHover(b)} onMouseLeave={() => setHover(null)} onClick={() => b.status === 'available' && setRestore({ open: true, backupId: b.id, source: 'backup' })}
                className={cn('absolute top-[26px] size-4 -translate-x-1/2 rounded-full border-2 border-surface shadow transition-transform hover:scale-125', b.status === 'creating' && 'animate-pulse-soft')}
                style={{ left: `${x(Date.parse(b.createdAt))}%`, background: TYPE_COLOR[b.type] }} aria-label={b.name} />
            ))}
            {hover && (
              <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-pop" style={{ left: `${Math.min(85, Math.max(15, x(Date.parse(hover.createdAt))))}%` }}>
                <div className="font-medium text-fg">{hover.name}</div>
                <div className="text-muted">{dateTime(hover.createdAt)} · {hover.sizeGB} GB · {hover.type}</div>
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {(Object.keys(TYPE_COLOR) as DbBackup['type'][]).map((t) => <span key={t} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: TYPE_COLOR[t] }} />{t}</span>)}
          </div>
        </div>
      </Card>
      </Pro>

      <Card>
        <CardHeader icon={Archive} title="Backups"
          description={pro ? 'Automated backups expire with the retention policy. Manual and final backups are kept until you delete them.'
            : `${d.lastBackupAt ? `Last backup ${timeAgo(d.lastBackupAt)}` : 'No backup yet'} · kept for ${d.backups.retention} days${d.backups.pitr ? ' · restore to any point in time' : ''}`}
          actions={pro ? undefined : <>
            <Button size="sm" icon={RotateCcw} onClick={() => setRestore({ open: true, source: d.backups.pitr ? 'pitr' : 'backup' })}>Restore…</Button>
            <Button size="sm" variant="primary" icon={Camera} loading={backupNow.isPending} disabled={d.status !== 'available'} onClick={() => backupNow.mutate()}>Back up now</Button>
          </>} />
        {isLoading ? <div className="p-6 text-sm text-muted">Loading…</div> : sorted.length === 0 ? <EmptyState icon={Archive} title="No backups yet" description="Take a backup now or enable automated backups." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-4 py-2 font-medium">Name</th><th className="px-4 py-2 font-medium">Type</th><th className="hidden px-4 py-2 font-medium @min-[40rem]:table-cell">Created</th>{pro && <th className="hidden px-4 py-2 font-medium @min-[36rem]:table-cell">Version</th>}<th className="px-4 py-2 text-right font-medium">Size</th><th className="px-4 py-2 font-medium">Status</th><th className="w-20" /></tr></thead>
              <tbody className="divide-y divide-line">
                {sorted.map((b) => (
                  <tr key={b.id} className="hover:bg-surface-2/50">
                    <td className="max-w-[220px] truncate px-4 py-2.5 font-mono text-fg">{b.name}</td>
                    <td className="px-4 py-2.5"><Badge tone={b.type === 'automated' ? 'brand' : b.type === 'manual' ? 'warning' : 'violet'}>{b.type}</Badge></td>
                    <td className="hidden px-4 py-2.5 text-muted @min-[40rem]:table-cell" title={dateTime(b.createdAt)}>{timeAgo(b.createdAt)}</td>
                    {pro && <td className="hidden px-4 py-2.5 text-muted @min-[36rem]:table-cell">{b.version ?? '—'}</td>}
                    <td className="px-4 py-2.5 text-right tabular text-fg">{b.sizeGB} GB</td>
                    <td className="px-4 py-2.5"><StatusPill status={b.status} /></td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <IconButton icon={RotateCcw} label="Restore" size="sm" disabled={b.status !== 'available'} onClick={() => setRestore({ open: true, backupId: b.id, source: 'backup' })} />
                      <IconButton icon={Trash2} label={b.type === 'automated' ? 'Automated backups expire automatically' : 'Delete'} size="sm" disabled={b.type === 'automated' || b.status !== 'available'} onClick={() => onDelete(b)} className="hover:text-rose-500" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {pro ? <BackupSettings d={d} /> : (
        <Advanced title="Backup settings" description={d.backups.enabled ? `${d.backups.schedule === 'daily' ? 'Daily' : 'Hourly'}, kept ${d.backups.retention} days` : 'Automated backups are off'}>
          <BackupSettings d={d} bare />
        </Advanced>
      )}
      <DbRestoreModal d={d} backups={backups} open={restore.open} initialBackupId={restore.backupId} initialSource={restore.source} onClose={() => setRestore({ open: false })} />
    </div>
  );
}

function BackupSettings({ d, bare }: { d: DbInstance; bare?: boolean }) {
  const [b, setB] = useState(d.backups);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => setB(d.backups), [JSON.stringify(d.backups)]); // eslint-disable-line
  const dirty = JSON.stringify(b) !== JSON.stringify(d.backups);
  const save = useApiMutation(() => api.update('dbInstances', d.id, { backups: b }), {
    success: 'Backup settings saved', onSuccess: () => setErrors({}), onError: (e) => setErrors(e.details ?? {}),
  });
  const redis = d.engine === 'redis';
  const saveBtn = <Button size="sm" variant="primary" icon={Save} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>;
  const body = (
      <div className={cn('space-y-4', !bare && 'p-4')}>
        <Switch checked={b.enabled} onChange={(v) => setB({ ...b, enabled: v, pitr: v ? b.pitr : false })} label="Automated backups" description="Full backups on a schedule, streamed from the standby when available." />
        {b.enabled && (
          <div className="grid gap-4 @min-[36rem]:grid-cols-3">
            <Field label="Schedule"><Segmented value={b.schedule} onChange={(v) => setB({ ...b, schedule: v })} options={[{ value: 'daily', label: 'Daily' }, { value: 'hourly', label: 'Hourly' }]} /></Field>
            <Field label="Retention (days)" error={errors['backups.retention']}><NumberInput value={b.retention} onChange={(v) => setB({ ...b, retention: v })} min={1} max={35} /></Field>
            <Field label="Backup window (UTC)" error={errors['backups.window']}><Input value={b.window} onChange={(e) => setB({ ...b, window: e.target.value })} placeholder="02:00-03:00" mono /></Field>
          </div>
        )}
        <Switch checked={b.pitr} disabled={!b.enabled || redis} onChange={(v) => setB({ ...b, pitr: v })} label="Point-in-time recovery" description={redis ? 'Not supported for Redis (AOF persistence only).' : `Continuously archives ${d.engine === 'postgres' ? 'WAL' : 'binlogs'} so you can restore to any second within the retention window.`} />
        {errors['backups.pitr'] && <Hint tone="danger">{errors['backups.pitr']}</Hint>}
        {bare && <div className="flex justify-end">{saveBtn}</div>}
      </div>
  );
  if (bare) return body;
  return (
    <Card>
      <CardHeader icon={Settings2} title="Backup settings" actions={saveBtn} />
      {body}
    </Card>
  );
}
