import { useEffect, useMemo, useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router';
import { api, ApiClientError } from '@/api/client';
import { useApiMutation } from '@/api/hooks';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, OptionCards, Select, Slider, Hint } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { fieldErrors } from '@/components/ui/FormLayout';
import { toast } from '@/components/ui/toast';
import { dateTime, timeAgo } from '@/lib/format';
import type { DbBackup, DbInstance } from '@/types';

/** Restore from a backup or to a point in time — in place or as a new instance. */
export function DbRestoreModal({ d, backups, open, onClose, initialBackupId, initialSource }: {
  d: DbInstance; backups: DbBackup[]; open: boolean; onClose: () => void; initialBackupId?: string; initialSource?: 'backup' | 'pitr';
}) {
  const navigate = useNavigate();
  const pitrOk = d.backups.enabled && d.backups.pitr && !!d.earliestRestoreTime;
  const available = backups.filter((b) => b.status === 'available').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [source, setSource] = useState<'backup' | 'pitr'>('backup');
  const [backupId, setBackupId] = useState('');
  const [mode, setMode] = useState<'new' | 'in-place'>('new');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openedAt, setOpenedAt] = useState(Date.now());
  const min = d.earliestRestoreTime ? Date.parse(d.earliestRestoreTime) : openedAt - 86_400_000;
  const max = openedAt - 60_000;
  const steps = 500;
  const [pos, setPos] = useState(steps);

  useEffect(() => {
    if (!open) return;
    setOpenedAt(Date.now());
    setSource(initialSource === 'pitr' && pitrOk ? 'pitr' : 'backup');
    setBackupId(initialBackupId ?? available[0]?.id ?? '');
    setMode('new'); setName(`${d.name}-restore`); setErrors({}); setPos(steps);
  }, [open]); // eslint-disable-line

  const ts = useMemo(() => Math.round(min + ((max - min) * pos) / steps), [min, max, pos]);
  const backup = available.find((b) => b.id === backupId);

  const submit = useApiMutation(() => {
    const body = { mode, name: mode === 'new' ? name : undefined };
    return source === 'backup'
      ? api.action<DbInstance | undefined>('dbInstances', d.id, 'restore', { ...body, backupId })
      : api.action<DbInstance | undefined>('dbInstances', d.id, 'pitr', { ...body, timestamp: new Date(ts).toISOString() });
  }, {
    silent: true,
    onSuccess: (res) => {
      onClose();
      if (mode === 'new' && res && (res as DbInstance).id && (res as DbInstance).id !== d.id) {
        toast.success(`Restoring into ${(res as DbInstance).name}`, 'A new instance is being provisioned.');
        navigate(`/managed-services/db/${(res as DbInstance).id}`);
      } else toast.success('Restore started', 'The database is unavailable until the restore completes.');
    },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); if (!Object.keys(fieldErrors(e)).length) toast.error('Restore failed', e.message) },
  });

  // markers on the slider track: backups within the PITR window
  const marks = available.filter((b) => Date.parse(b.createdAt) >= min && Date.parse(b.createdAt) <= max).map((b) => ((Date.parse(b.createdAt) - min) / (max - min)) * 100);
  const canSubmit = (source === 'backup' ? !!backup : pitrOk) && (mode === 'in-place' || !!name);

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Restore database" description="Restoring into a new instance is the safe default: the original keeps running and you can compare data."
      icon={<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-brand-500"><History className="size-[18px]" /></div>}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={mode === 'in-place' ? 'danger' : 'primary'} icon={RotateCcw} loading={submit.isPending} disabled={!canSubmit} onClick={() => submit.mutate()}>{mode === 'in-place' ? 'Overwrite & restore' : 'Restore to new instance'}</Button></>}>
      <div className="space-y-5">
        <Field label="Restore from">
          <Segmented value={source} onChange={setSource} options={[{ value: 'backup', label: 'A backup' }, { value: 'pitr', label: 'Point in time' }]} />
        </Field>
        {source === 'backup' ? (
          available.length ? (
            <Field label="Backup" error={errors.backupId}>
              <Select value={backupId} onChange={(e) => setBackupId(e.target.value)} options={available.map((b) => ({ value: b.id, label: `${b.name} · ${dateTime(b.createdAt)} · ${b.sizeGB} GB · ${b.type}` }))} />
            </Field>
          ) : <Hint tone="warning">No completed backups yet. Take one from the Backups tab.</Hint>
        ) : !pitrOk ? (
          <Hint tone="warning">Point-in-time recovery is not enabled{d.engine === 'redis' ? ' (not supported for Redis)' : ''}. Enable it in the backup settings to restore to any second within the retention window.</Hint>
        ) : (
          <Field label="Target time" error={errors.timestamp} hint={`Restorable from ${dateTime(min)} to ${dateTime(max)} (UTC ${new Date(ts).toISOString().slice(0, 19).replace('T', ' ')})`}>
            <div className="rounded-xl border border-line bg-surface-2/50 p-4">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <span className="text-lg font-semibold tabular text-fg">{dateTime(ts)}</span>
                <span className="text-xs text-muted">{timeAgo(ts)}</span>
              </div>
              <div className="relative">
                <div className="pointer-events-none absolute inset-x-0 top-[13px] h-0">
                  {marks.map((m, i) => <span key={i} className="absolute -top-1 size-2 -translate-x-1/2 rounded-full bg-amber-500 ring-2 ring-surface" style={{ left: `${m}%` }} title="Base backup" />)}
                </div>
                <Slider value={pos} onChange={setPos} min={0} max={steps} />
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-faint"><span>{dateTime(min)}</span><span className="flex items-center gap-1"><span className="size-2 rounded-full bg-amber-500" /> base backups</span><span>now − 1 min</span></div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {[['5 min ago', 5 * 60_000], ['1 hour ago', 3_600_000], ['6 hours ago', 6 * 3_600_000], ['1 day ago', 86_400_000]].map(([l, ago]) => {
                  const t = openedAt - (ago as number);
                  if (t < min) return null;
                  return <button key={l as string} type="button" onClick={() => setPos(Math.round(((t - min) / (max - min)) * steps))} className="rounded-md border border-line px-2 py-0.5 text-xs text-fg-2 hover:bg-surface-3">{l as string}</button>;
                })}
              </div>
            </div>
          </Field>
        )}
        <Field label="Restore into">
          <OptionCards cols={2} value={mode} onChange={setMode} options={[
            { value: 'new', title: 'New instance', description: 'Provision a copy (same size, network, users). The original keeps serving traffic.' },
            { value: 'in-place', title: 'This instance (overwrite)', description: 'Replaces all current data. Downtime until the restore finishes.' },
          ]} />
        </Field>
        {mode === 'new' ? (
          <Field label="New instance name" required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} invalid={!!errors.name} /></Field>
        ) : (
          <Hint tone="danger">All changes made to <b>{d.name}</b> after {source === 'backup' ? (backup ? dateTime(backup.createdAt) : 'the backup') : dateTime(ts)} will be lost.</Hint>
        )}
      </div>
    </Modal>
  );
}
