import { forwardRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Check, ChevronDown, Minus, Plus, X, Info } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Tag } from '@/types';
import { Popover } from './Menu';

const control =
  'w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg placeholder:text-faint shadow-card transition-colors hover:border-line-strong focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-500/15 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:ring-rose-500/15';

/** Label + hint + error wrapper for any control. */
export function Field({ label, hint, error, children, required, className, optional, action }: {
  label?: ReactNode; hint?: ReactNode; error?: string | null | false; children: ReactNode; required?: boolean; className?: string; optional?: boolean; action?: ReactNode;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      {label && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label className="text-[13px] font-medium text-fg-2">
            {label}
            {required && <span className="ml-0.5 text-rose-500">*</span>}
            {optional && <span className="ml-1.5 text-xs font-normal text-faint">optional</span>}
          </label>
          {action}
        </div>
      )}
      {children}
      {error ? <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">{error}</p> : hint ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; prefix?: ReactNode; suffix?: ReactNode; mono?: boolean }>(
  function Input({ className, invalid, prefix, suffix, mono, ...rest }, ref) {
    if (prefix || suffix) {
      return (
        <div className={cn('flex h-9 items-center overflow-hidden p-0', control, invalid && 'border-rose-500', className)}>
          {prefix && <span className="flex h-full items-center border-r border-line bg-surface-2 px-2.5 text-[13px] text-muted">{prefix}</span>}
          <input ref={ref} aria-invalid={invalid || undefined} className={cn('h-full min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-faint', mono && 'font-mono text-[13px]')} {...rest} />
          {suffix && <span className="flex h-full items-center border-l border-line bg-surface-2 px-2.5 text-[13px] text-muted">{suffix}</span>}
        </div>
      );
    }
    return <input ref={ref} aria-invalid={invalid || undefined} className={cn('h-9', control, mono && 'font-mono text-[13px]', className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; mono?: boolean }>(
  function Textarea({ className, invalid, mono, ...rest }, ref) {
    return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn('min-h-20 py-2', control, mono && 'font-mono text-[12.5px] leading-relaxed', className)} {...rest} />;
  },
);

export interface Option { value: string; label: string; description?: string; disabled?: boolean }

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { options: Option[]; placeholder?: string; invalid?: boolean }>(
  function Select({ options, placeholder, className, invalid, ...rest }, ref) {
    return (
      <div className={cn('relative', className)}>
        <select ref={ref} aria-invalid={invalid || undefined} className={cn('h-9 appearance-none pr-8', control)} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
      </div>
    );
  },
);

export function Switch({ checked, onChange, label, description, disabled, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean; size?: 'sm' | 'md' }) {
  const btn = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        size === 'sm' ? 'h-4.5 w-8' : 'h-5 w-9',
        checked ? 'bg-brand-500' : 'bg-line-strong',
      )}
    >
      <span className={cn('inline-block rounded-full bg-white shadow transition-transform', size === 'sm' ? 'size-3.5' : 'size-4', checked ? (size === 'sm' ? 'translate-x-4' : 'translate-x-[18px]') : 'translate-x-0.5')} />
    </button>
  );
  if (!label) return btn;
  return (
    <label className={cn('flex cursor-pointer items-start justify-between gap-4', disabled && 'cursor-not-allowed')}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
      {btn}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, indeterminate, disabled, className }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; indeterminate?: boolean; disabled?: boolean; className?: string }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm text-fg-2', disabled && 'opacity-50', className)} onClick={(e) => e.stopPropagation()}>
      <span
        role="checkbox"
        aria-checked={indeterminate ? 'mixed' : checked}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(!checked) } }}
        onClick={(e) => { e.preventDefault(); if (!disabled) onChange(!checked) }}
        className={cn('flex size-4 shrink-0 items-center justify-center rounded border transition-colors', checked || indeterminate ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong bg-surface')}
      >
        {indeterminate ? <Minus className="size-3" strokeWidth={3} /> : checked ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
      {label}
    </label>
  );
}

/** Large selectable cards (radio semantics). */
export function OptionCards<T extends string>({ options, value, onChange, cols = 3, className }: {
  options: { value: T; title: ReactNode; description?: ReactNode; icon?: ReactNode; badge?: ReactNode; disabled?: boolean; meta?: ReactNode }[];
  value: T; onChange: (v: T) => void; cols?: 1 | 2 | 3 | 4 | 5; className?: string;
}) {
  // sized by the component's own width (it is its own container), so it works in narrow columns too
  const grid = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 @min-[26rem]:grid-cols-2',
    3: 'grid-cols-1 @min-[26rem]:grid-cols-2 @min-[42rem]:grid-cols-3',
    4: 'grid-cols-1 @min-[22rem]:grid-cols-2 @min-[42rem]:grid-cols-4',
    5: 'grid-cols-2 @min-[30rem]:grid-cols-3 @min-[48rem]:grid-cols-5',
  }[cols];
  return (
    <div className="@container">
    <div className={cn('grid gap-2.5', grid, className)} role="radiogroup">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            type="button"
            key={o.value}
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'group relative flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50',
              active ? 'border-brand-500 bg-brand-500/[0.06] ring-3 ring-brand-500/15' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2/50',
            )}
          >
            <div className="flex w-full items-center gap-2">
              {o.icon}
              <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-fg break-words">{o.title}</span>
              {o.badge}
              <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-full border', active ? 'border-brand-500 bg-brand-500' : 'border-line-strong')}>
                {active && <span className="size-1.5 rounded-full bg-white" />}
              </span>
            </div>
            {o.description && <div className="text-xs text-muted">{o.description}</div>}
            {o.meta && <div className="mt-1 w-full">{o.meta}</div>}
          </button>
        );
      })}
    </div>
    </div>
  );
}

/** Number input with -/+ steppers and unit suffix. */
export function NumberInput({ value, onChange, min = 0, max = 1e9, step = 1, unit, invalid, className, disabled }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; invalid?: boolean; className?: string; disabled?: boolean;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className={cn('flex h-9 items-center overflow-hidden p-0', control, invalid && 'border-rose-500', disabled && 'opacity-60', className)}>
      <button type="button" disabled={disabled || value <= min} onClick={() => onChange(clamp(value - step))} className="flex h-full w-8 items-center justify-center border-r border-line text-muted hover:bg-surface-2 disabled:opacity-40" aria-label="Decrease"><Minus className="size-3.5" /></button>
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? min : Number(e.target.value))}
        onBlur={() => onChange(clamp(value))}
        className="h-full min-w-0 flex-1 bg-transparent text-center text-sm tabular outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        min={min}
        max={max}
        step={step}
      />
      {unit && <span className="pr-2 text-xs text-muted">{unit}</span>}
      <button type="button" disabled={disabled || value >= max} onClick={() => onChange(clamp(value + step))} className="flex h-full w-8 items-center justify-center border-l border-line text-muted hover:bg-surface-2 disabled:opacity-40" aria-label="Increase"><Plus className="size-3.5" /></button>
    </div>
  );
}

/** Range slider with optional marks; shows the value bubble. */
export function Slider({ value, onChange, min, max, step = 1, marks, format = (v) => String(v), className }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step?: number; marks?: number[]; format?: (v: number) => string; className?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={cn('pt-1', className)}>
      <div className="relative h-5">
        <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-surface-3" />
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-brand-400 to-brand-600" style={{ width: `${pct}%` }} />
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-brand-500 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-brand-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow" />
      </div>
      {marks && (
        <div className="relative mt-1 h-4 text-[11px] text-faint">
          {marks.map((m) => (
            <button type="button" key={m} onClick={() => onChange(m)} className="absolute -translate-x-1/2 hover:text-fg" style={{ left: `${((m - min) / (max - min)) * 100}%` }}>{format(m)}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** key=value tag editor */
export function TagEditor({ value, onChange, suggestions = [], required = [] }: { value: Tag[]; onChange: (t: Tag[]) => void; suggestions?: string[]; required?: string[] }) {
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  const add = () => {
    const key = k.trim();
    if (!key) return;
    onChange([...value.filter((t) => t.key !== key), { key, value: v.trim() }]);
    setK(''); setV('');
  };
  const missing = required.filter((r) => !value.some((t) => t.key === r && t.value));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((t) => (
          <span key={t.key} className="inline-flex h-7 items-center overflow-hidden rounded-lg border border-line bg-surface-2 text-xs">
            <span className="px-2 text-muted">{t.key}</span>
            <span className="border-l border-line bg-surface px-2 font-medium text-fg">{t.value || '—'}</span>
            <button type="button" onClick={() => onChange(value.filter((x) => x.key !== t.key))} className="border-l border-line px-1.5 text-faint hover:text-rose-500" aria-label={`Remove tag ${t.key}`}><X className="size-3" /></button>
          </span>
        ))}
        {missing.map((m) => (
          <button type="button" key={m} onClick={() => setK(m)} className="inline-flex h-7 items-center gap-1 rounded-lg border border-dashed border-amber-500/50 px-2 text-xs text-amber-600 dark:text-amber-400" title="Required by project tag policy">
            + {m} <span className="text-[10px] opacity-70">required</span>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <div className="w-32 shrink-0 @min-[36rem]:w-40"><Input value={k} onChange={(e) => setK(e.target.value)} placeholder="key" list="tag-suggest" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} /></div>
        <div className="min-w-0 flex-1"><Input value={v} onChange={(e) => setV(e.target.value)} placeholder="value" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} /></div>
        <button type="button" onClick={add} className="h-9 rounded-lg border border-line px-3 text-sm font-medium text-fg-2 hover:bg-surface-2">Add</button>
        <datalist id="tag-suggest">{[...new Set([...required, ...suggestions, 'env', 'app', 'team', 'owner', 'cost-center'])].map((s) => <option key={s} value={s} />)}</datalist>
      </div>
    </div>
  );
}

/** Multi-select with checkable options in a popover; selected values shown as chips. */
export function MultiSelect({ options, value, onChange, placeholder = 'Select…', className, emptyText = 'No options' }: { options: Option[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string; className?: string; emptyText?: string }) {
  const [q, setQ] = useState('');
  const selected = options.filter((o) => value.includes(o.value));
  const filtered = options.filter((o) => (o.label + ' ' + (o.description ?? '')).toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover
      align="start"
      block
      className="w-[min(28rem,calc(100vw-2rem))]"
      trigger={(open) => (
        <div role="button" tabIndex={0} className={cn('flex min-h-9 w-full cursor-pointer flex-wrap items-center gap-1 py-1 pr-8', control, open && 'border-brand-500 ring-3 ring-brand-500/15', 'relative', className)}>
          {selected.length === 0 && <span className="text-sm text-faint">{placeholder}</span>}
          {selected.map((o) => (
            <span key={o.value} className="inline-flex h-6 items-center gap-1 rounded-md bg-brand-500/10 px-1.5 text-xs font-medium text-brand-700 dark:text-brand-300">
              {o.label}
              <span role="button" onClick={(e) => { e.stopPropagation(); onChange(value.filter((v) => v !== o.value)) }} className="opacity-60 hover:opacity-100"><X className="size-3" /></span>
            </span>
          ))}
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
        </div>
      )}
    >
      {() => (
        <div className="p-1">
          {options.length > 6 && <div className="p-1"><Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="h-8" /></div>}
          {filtered.length === 0 && <div className="p-3 text-center text-sm text-muted">{emptyText}</div>}
          {filtered.map((o) => {
            const on = value.includes(o.value);
            return (
              <button type="button" key={o.value} disabled={o.disabled} onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
                className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2 disabled:opacity-40">
                <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong')}>{on && <Check className="size-3" strokeWidth={3} />}</span>
                <span className="min-w-0">
                  <span className="block text-sm text-fg">{o.label}</span>
                  {o.description && <span className="block truncate text-xs text-muted">{o.description}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

/** Generic list editor with add / remove rows. */
export function ListEditor<T>({ items, onChange, render, create, addLabel = 'Add', empty }: {
  items: T[]; onChange: (items: T[]) => void; render: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode; create: () => T; addLabel?: string; empty?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      {items.length === 0 && empty}
      {items.map((it, i) => (
        <div key={i} className="group flex items-start gap-2 rounded-xl border border-line bg-surface-2/40 p-2.5">
          <div className="min-w-0 flex-1">{render(it, (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))), i)}</div>
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="mt-1.5 rounded-md p-1 text-faint hover:bg-rose-500/10 hover:text-rose-500" aria-label="Remove"><X className="size-4" /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, create()])} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong text-[13px] font-medium text-muted hover:border-brand-500 hover:text-brand-500">
        <Plus className="size-4" /> {addLabel}
      </button>
    </div>
  );
}

export function Hint({ children, tone = 'info', className }: { children: ReactNode; tone?: 'info' | 'warning' | 'danger' | 'success'; className?: string }) {
  const cls = {
    info: 'border-brand-500/20 bg-brand-500/5 text-fg-2',
    warning: 'border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-300',
    danger: 'border-rose-500/30 bg-rose-500/5 text-rose-800 dark:text-rose-300',
    success: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300',
  }[tone];
  return (
    <div className={cn('flex gap-2.5 rounded-xl border p-3 text-[13px] leading-relaxed', cls, className)}>
      <Info className="mt-0.5 size-4 shrink-0 opacity-70" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
