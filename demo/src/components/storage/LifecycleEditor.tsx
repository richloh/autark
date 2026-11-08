import { ArrowRight, Trash2, Clock } from 'lucide-react';
import { Input, Select, NumberInput, Switch, ListEditor } from '@/components/ui/form';
import { cn } from '@/lib/cn';
import { CLASS_META } from './common';
import type { LifecycleRule, StorageClass } from '@/types';

let seq = 0;
export const newRule = (action: LifecycleRule['action'] = 'transition'): LifecycleRule => ({ id: `lc-new-${++seq}-${Date.now().toString(36)}`, prefix: '', action, days: action === 'expire' ? 365 : 30, toClass: action === 'transition' ? 'INFREQUENT' : undefined, enabled: true });

/** Editable list of lifecycle rules. */
export function LifecycleRulesEditor({ rules, onChange, baseClass, errors = {} }: { rules: LifecycleRule[]; onChange: (r: LifecycleRule[]) => void; baseClass: StorageClass; errors?: Record<string, string> }) {
  return (
    <ListEditor
      items={rules}
      onChange={onChange}
      addLabel="Add rule"
      create={() => newRule(rules.some((r) => r.action === 'transition') ? 'expire' : baseClass === 'ARCHIVE' ? 'expire' : 'transition')}
      empty={<p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">No rules — objects stay in <b>{CLASS_META[baseClass].label}</b> forever.</p>}
      render={(r, update, i) => (
        <div className="space-y-2">
          <div className="grid items-center gap-2 @min-[36rem]:grid-cols-[minmax(0,1fr)_140px_120px_minmax(0,150px)_auto]">
            <Input value={r.prefix} onChange={(e) => update({ prefix: e.target.value })} placeholder="prefix (empty = all objects)" mono prefix="s3://…/" invalid={!!errors[`lifecycleRules.${i}.prefix`]} />
            <Select value={r.action} onChange={(e) => update({ action: e.target.value as LifecycleRule['action'], toClass: e.target.value === 'transition' ? (baseClass === 'INFREQUENT' ? 'ARCHIVE' : 'INFREQUENT') : undefined })}
              options={[{ value: 'transition', label: 'Transition', disabled: baseClass === 'ARCHIVE' }, { value: 'expire', label: 'Expire (delete)' }]} />
            <NumberInput value={r.days} onChange={(d) => update({ days: d })} min={1} max={3650} unit="days" invalid={!!errors[`lifecycleRules.${i}.days`]} />
            {r.action === 'transition'
              ? <Select value={r.toClass ?? 'INFREQUENT'} onChange={(e) => update({ toClass: e.target.value as 'INFREQUENT' | 'ARCHIVE' })} invalid={!!errors[`lifecycleRules.${i}.toClass`]}
                  options={[{ value: 'INFREQUENT', label: '→ Infrequent', disabled: baseClass !== 'STANDARD' }, { value: 'ARCHIVE', label: '→ Archive' }]} />
              : <span className="flex h-9 items-center gap-1.5 px-1 text-xs text-rose-500"><Trash2 className="size-3.5" />objects are deleted</span>}
            <Switch size="sm" checked={r.enabled} onChange={(v) => update({ enabled: v })} />
          </div>
          {Object.entries(errors).filter(([k]) => k.startsWith(`lifecycleRules.${i}.`)).map(([k, v]) => <p key={k} className="text-xs text-rose-500">{v}</p>)}
        </div>
      )}
    />
  );
}

function niceStep(max: number) {
  const steps = [7, 14, 30, 60, 90, 180, 365, 730];
  return steps.find((s) => max / s <= 6) ?? 1825;
}

/** Day 0 → transition(s) → expiry timeline per prefix. */
export function LifecycleTimeline({ rules, baseClass, className }: { rules: LifecycleRule[]; baseClass: StorageClass; className?: string }) {
  const active = rules.filter((r) => r.enabled && r.days > 0);
  const prefixes = [...new Set(active.map((r) => r.prefix))].sort();
  if (!prefixes.length) prefixes.push('');
  const maxDay = Math.max(30, ...active.map((r) => r.days)) * 1.15;
  const step = niceStep(maxDay);
  const ticks = Array.from({ length: Math.floor(maxDay / step) + 1 }, (_, i) => i * step);
  const x = (d: number) => `${Math.min(100, (d / maxDay) * 100)}%`;

  return (
    <div className={cn('rounded-xl border border-line bg-surface-2/40 p-4', className)}>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5 font-medium text-fg-2"><Clock className="size-3.5" />Object age</span>
        {(Object.keys(CLASS_META) as StorageClass[]).map((c) => <span key={c} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: CLASS_META[c].color }} />{CLASS_META[c].label}</span>)}
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[repeating-linear-gradient(45deg,var(--line-strong)_0_2px,transparent_2px_5px)]" />Deleted</span>
      </div>
      <div className="space-y-4">
        {prefixes.map((p) => {
          const rs = active.filter((r) => r.prefix === p);
          const tr = rs.filter((r) => r.action === 'transition' && r.toClass).sort((a, b) => a.days - b.days);
          const exp = rs.find((r) => r.action === 'expire');
          const segs: { from: number; to: number; cls: StorageClass | 'deleted' }[] = [];
          let cur: StorageClass = baseClass; let from = 0;
          for (const t of tr) { if (exp && t.days >= exp.days) break; segs.push({ from, to: t.days, cls: cur }); cur = t.toClass!; from = t.days }
          segs.push({ from, to: exp ? exp.days : maxDay, cls: cur });
          if (exp) segs.push({ from: exp.days, to: maxDay, cls: 'deleted' });
          return (
            <div key={p}>
              <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-mono text-fg-2">{p ? `${p}*` : 'all objects'}</span>
                <span className="shrink-0 text-muted">{tr.length ? tr.map((t) => `${t.days}d→${CLASS_META[t.toClass!].short}`).join(' · ') : 'no transitions'}{exp ? ` · delete at ${exp.days}d` : ''}</span>
              </div>
              <div className="relative h-7">
                {segs.map((s, i) => (
                  <div key={i} className={cn('absolute inset-y-0 flex items-center overflow-hidden px-1.5 text-[10px] font-semibold text-white transition-all duration-500', i === 0 && 'rounded-l-md', i === segs.length - 1 && 'rounded-r-md')}
                    style={{ left: x(s.from), width: `calc(${x(s.to)} - ${x(s.from)})`, background: s.cls === 'deleted' ? 'repeating-linear-gradient(45deg, var(--line-strong) 0 3px, transparent 3px 8px)' : CLASS_META[s.cls].color }}
                    title={s.cls === 'deleted' ? `Deleted after ${s.from} days` : `${CLASS_META[s.cls].label}: day ${s.from} – ${s.to >= maxDay ? '∞' : s.to}`}>
                    {s.cls !== 'deleted' && <span className="truncate">{CLASS_META[s.cls].short}</span>}
                  </div>
                ))}
                {[...tr.filter((t) => !exp || t.days < exp.days), ...(exp ? [exp] : [])].map((r) => (
                  <div key={r.id} className="absolute -top-1 bottom-[-4px] w-px bg-fg/70" style={{ left: x(r.days) }}>
                    <span className={cn('absolute -top-0.5 left-1/2 flex size-3 -translate-x-1/2 items-center justify-center rounded-full border-2 border-surface', r.action === 'expire' ? 'bg-rose-500' : 'bg-fg')} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="relative mt-2 h-4 text-[10px] text-faint">
        {ticks.map((t) => <span key={t} className="absolute -translate-x-1/2 tabular" style={{ left: x(t) }}>{t === 0 ? 'day 0' : t >= 365 && t % 365 === 0 ? `${t / 365}y` : `${t}d`}</span>)}
      </div>
      {active.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-fg-2">
          {active.slice().sort((a, b) => a.prefix.localeCompare(b.prefix) || a.days - b.days).map((r) => (
            <li key={r.id} className="flex items-center gap-1.5">
              <span className="font-mono text-muted">{r.prefix || '*'}</span>
              <ArrowRight className="size-3 text-faint" />
              {r.action === 'transition' ? <>after <b>{r.days} days</b> move to <b style={{ color: CLASS_META[r.toClass!].color }}>{CLASS_META[r.toClass!].label}</b></> : <>after <b>{r.days} days</b> <b className="text-rose-500">delete</b></>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
