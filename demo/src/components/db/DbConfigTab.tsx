import { useEffect, useMemo, useState } from 'react';
import { ArrowUpCircle, CalendarClock, RotateCw, Save, SlidersHorizontal, Undo2, Search } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation } from '@/api/hooks';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { confirm } from '@/components/ui/Modal';
import { Field, Input, Select, Hint, Switch } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { useDbEngines, DAYS, ENGINE_META } from './engine';
import type { DbInstance, DbParamSpec } from '@/types';

export function DbConfigTab({ d }: { d: DbInstance }) {
  return (
    <div className="space-y-5">
      <ParametersEditor d={d} />
      <div className="grid gap-5 @min-[44rem]:grid-cols-2">
        <MaintenanceCard d={d} />
        <UpgradeCard d={d} />
      </div>
    </div>
  );
}

function ParamInput({ p, value, onChange, invalid }: { p: DbParamSpec; value: string; onChange: (v: string) => void; invalid?: boolean }) {
  if (p.type === 'enum') return <Select value={value} onChange={(e) => onChange(e.target.value)} options={(p.options ?? []).map((o) => ({ value: o, label: o }))} className="w-full @min-[36rem]:w-48" />;
  if (p.type === 'bool') {
    const on = ['on', 'yes', 'true', '1'].includes(value.toLowerCase());
    const yes = p.default === 'yes' || p.default === 'no' ? 'yes' : 'on';
    return <Switch size="sm" checked={on} onChange={(v) => onChange(v ? yes : yes === 'yes' ? 'no' : 'off')} />;
  }
  return <Input value={value} onChange={(e) => onChange(e.target.value)} mono invalid={invalid} className="h-8 w-full @min-[36rem]:w-48" suffix={p.unit} />;
}

/** Engine parameter editor with restart-required flags and server-side validation. */
export function ParametersEditor({ d }: { d: DbInstance }) {
  const { byId, isLoading } = useDbEngines();
  const spec = byId(d.engine);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  useEffect(() => { setDraft({}); setErrors({}) }, [d.id]);
  const pending = d.pendingRestart ?? [];

  const current = (p: DbParamSpec) => d.parameters[p.name] ?? p.default;
  const changes = useMemo(() => Object.fromEntries(Object.entries(draft).filter(([k, v]) => {
    const p = spec?.parameters.find((x) => x.name === k);
    return p && v !== current(p);
  })), [draft, spec, d.parameters]); // eslint-disable-line
  const changeCount = Object.keys(changes).length;
  const restartChanges = Object.keys(changes).filter((k) => spec?.parameters.find((p) => p.name === k)?.restart);

  const save = useApiMutation((body: { parameters?: Record<string, string>; reset?: string[] }) => api.action<{ applied: string[]; pendingRestart: string[]; restartRequired: boolean }>('dbInstances', d.id, 'updateParameters', body), {
    silent: true,
    onSuccess: (res) => {
      setDraft({}); setErrors({});
      if (res.restartRequired) toast.warning('Saved — restart required', `${res.pendingRestart.join(', ')} take effect after a restart.`);
      else toast.success('Parameters applied', res.applied.length ? `${res.applied.join(', ')} applied online` : undefined);
    },
    onError: (e) => { setErrors(e.details ?? {}); toast.error('Invalid parameters', e.message) },
  });
  const restart = useApiMutation(() => api.action('dbInstances', d.id, 'restart'), { success: 'Restarting to apply parameters' });

  const onSave = async () => {
    if (restartChanges.length && !(await confirm({ title: 'Some changes need a restart', message: `${restartChanges.join(', ')} only take effect after the database restarts. The other changes apply immediately. You can restart later.`, confirmLabel: 'Save changes' }))) return;
    save.mutate({ parameters: changes });
  };
  const onRestart = async () => {
    if (await confirm({ title: `Restart ${d.name}?`, message: d.ha ? 'The standby is restarted first, then a planned switchover (~2s write pause).' : 'The database is unavailable for roughly 30 seconds.', confirmLabel: 'Restart now' })) restart.mutate();
  };

  if (isLoading || !spec) return <Card className="p-4"><Skeleton className="h-40" /></Card>;
  const params = spec.parameters.filter((p) => (!q || `${p.name} ${p.description}`.toLowerCase().includes(q.toLowerCase())) && (!onlyChanged || d.parameters[p.name] != null || p.name in changes));

  return (
    <Card>
      <CardHeader icon={SlidersHorizontal} title={`${spec.label} parameters`} description="Values differing from the engine default are highlighted. Changes are validated against instance size."
        actions={<>
          {changeCount > 0 && <Button size="sm" variant="ghost" icon={Undo2} onClick={() => { setDraft({}); setErrors({}) }}>Discard</Button>}
          <Button size="sm" variant="primary" icon={Save} disabled={!changeCount} loading={save.isPending} onClick={onSave}>Save{changeCount ? ` (${changeCount})` : ''}</Button>
        </>} />
      {pending.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5">
          <RotateCw className="size-4 text-amber-500" />
          <span className="min-w-0 flex-1 text-[13px] text-amber-800 dark:text-amber-300">Pending restart: <span className="font-mono">{pending.join(', ')}</span></span>
          <Button size="xs" variant="primary" icon={RotateCw} loading={restart.isPending} disabled={d.status !== 'available'} onClick={onRestart}>Restart now</Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
        <div className="relative min-w-40 flex-1 @min-[36rem]:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter parameters…" className="h-8 w-full rounded-lg border border-line bg-surface-2/60 pl-8 pr-2 text-[13px] outline-none placeholder:text-faint focus:border-brand-500" />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted"><Switch size="sm" checked={onlyChanged} onChange={setOnlyChanged} /> Only customized</label>
      </div>
      <ul className="divide-y divide-line">
        {params.map((p) => {
          const val = draft[p.name] ?? current(p);
          const custom = d.parameters[p.name] != null;
          const edited = p.name in changes;
          return (
            <li key={p.name} className={cn('flex flex-col gap-2 px-4 py-3 @min-[36rem]:flex-row @min-[36rem]:items-center', edited && 'bg-brand-500/[0.04]')}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <code className="font-mono text-[13px] font-medium text-fg">{p.name}</code>
                  {p.restart && <Badge tone="warning" title="Changing this parameter requires a restart">restart</Badge>}
                  {pending.includes(p.name) && <Badge tone="warning" dot pulse>pending</Badge>}
                  {custom && !edited && <Badge tone="brand">customized</Badge>}
                  {edited && <Badge tone="info">edited</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted">{p.description} <span className="text-faint">Default: <span className="font-mono">{p.default || '""'}</span>{p.min != null ? ` · range ${p.min}–${p.max}` : ''}</span></p>
                {errors[p.name] && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{errors[p.name]}</p>}
              </div>
              <div className="flex items-center gap-1.5">
                <ParamInput p={p} value={val} invalid={!!errors[p.name]} onChange={(v) => setDraft({ ...draft, [p.name]: v })} />
                <IconButton icon={Undo2} label="Reset to default" size="sm" disabled={!custom || save.isPending}
                  onClick={async () => { if (await confirm({ title: `Reset ${p.name} to default (${p.default || 'empty'})?`, message: p.restart ? 'Takes effect after a restart.' : 'Applied immediately.', confirmLabel: 'Reset' })) save.mutate({ reset: [p.name] }) }} />
              </div>
            </li>
          );
        })}
        {!params.length && <li className="p-6 text-center text-sm text-muted">No parameters match.</li>}
      </ul>
    </Card>
  );
}

function MaintenanceCard({ d }: { d: DbInstance }) {
  const [mw, setMw] = useState(d.maintenanceWindow);
  useEffect(() => setMw(d.maintenanceWindow), [d.maintenanceWindow.day, d.maintenanceWindow.hour]); // eslint-disable-line
  const dirty = mw.day !== d.maintenanceWindow.day || mw.hour !== d.maintenanceWindow.hour;
  const save = useApiMutation(() => api.action('dbInstances', d.id, 'setMaintenanceWindow', mw), { success: 'Maintenance window updated' });
  const dayLabel = DAYS.find((x) => x.value === mw.day)?.label;
  return (
    <Card>
      <CardHeader icon={CalendarClock} title="Maintenance window" description="Minor version patches and OS updates are applied in this weekly 1-hour slot." actions={<Button size="sm" variant="primary" icon={Save} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>} />
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Day"><Select value={mw.day} onChange={(e) => setMw({ ...mw, day: e.target.value as typeof mw.day })} options={DAYS.map((x) => ({ value: x.value, label: x.label }))} /></Field>
          <Field label="Start (UTC)"><Select value={String(mw.hour)} onChange={(e) => setMw({ ...mw, hour: Number(e.target.value) })} options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00 – ${String((h + 1) % 24).padStart(2, '0')}:00` }))} /></Field>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {DAYS.map((x) => (
            <button key={x.value} type="button" onClick={() => setMw({ ...mw, day: x.value })} className={cn('rounded-md py-1.5 text-center text-[11px] font-medium transition-colors', mw.day === x.value ? 'bg-brand-500 text-white' : 'bg-surface-2 text-muted hover:text-fg')}>{x.label.slice(0, 3)}</button>
          ))}
        </div>
        <p className="text-xs text-muted">Next window: {dayLabel} {String(mw.hour).padStart(2, '0')}:00 UTC. {d.ha ? 'With HA, maintenance uses a rolling switchover (~2s write pause).' : 'Without HA, expect up to a few minutes of downtime.'}</p>
      </div>
    </Card>
  );
}

function UpgradeCard({ d }: { d: DbInstance }) {
  const { byId } = useDbEngines();
  const spec = byId(d.engine);
  const vnum = (v: string) => { const [a, b = '0'] = v.split('.'); return Number(a) * 1000 + Number(b) };
  const newer = (spec?.versions ?? []).filter((v) => !v.deprecated && vnum(v.version) > vnum(d.version)).sort((a, b) => vnum(a.version) - vnum(b.version));
  const cur = spec?.versions.find((v) => v.version === d.version);
  const upgrade = useApiMutation((version: string) => api.action('dbInstances', d.id, 'upgrade', { version }), { success: 'Upgrade started' });
  const onUpgrade = async (version: string) => {
    if (await confirm({
      title: `Upgrade to ${ENGINE_META[d.engine].label} ${version}?`,
      message: `A pre-upgrade backup is taken automatically. ${d.ha ? 'The standby is upgraded first; ' : ''}expect a downtime window of a few minutes. Major upgrades cannot be rolled back except by restoring the backup.`,
      confirmLabel: `Upgrade to ${version}`, typeToConfirm: d.name,
    })) upgrade.mutate(version);
  };
  return (
    <Card>
      <CardHeader icon={ArrowUpCircle} title="Engine version" description={`Currently ${ENGINE_META[d.engine].label} ${d.version}`} />
      <div className="space-y-3 p-4">
        {cur?.eol && <Hint tone={cur.deprecated || Date.parse(cur.eol) < Date.now() + 90 * 86_400_000 ? 'warning' : 'info'}>{ENGINE_META[d.engine].label} {d.version} reaches end of life on {cur.eol}. Plan an upgrade.</Hint>}
        {newer.length === 0 ? <p className="text-sm text-muted">You are on the latest supported version.</p> : newer.map((v) => (
          <div key={v.version} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-fg">{ENGINE_META[d.engine].label} {v.version}{v.default && <Badge tone="success">recommended</Badge>}</div>
              <div className="text-xs text-muted">{vnum(v.version) - vnum(d.version) >= 1000 ? 'Major upgrade' : 'Minor upgrade'}{v.eol ? ` · EOL ${v.eol}` : ''}</div>
            </div>
            <Button size="sm" icon={ArrowUpCircle} disabled={d.status !== 'available' || upgrade.isPending} onClick={() => onUpgrade(v.version)}>Upgrade</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
