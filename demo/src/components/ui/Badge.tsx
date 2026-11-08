import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Tag } from '@/types';

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet';

const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-fg-2 ring-line-strong/60',
  brand: 'bg-brand-500/10 text-brand-600 dark:text-brand-300 ring-brand-500/20',
  success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/25',
  danger: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-rose-500/20',
  info: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 ring-sky-500/20',
  violet: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/20',
};
const DOT: Record<Tone, string> = {
  neutral: 'bg-faint', brand: 'bg-brand-500', success: 'bg-emerald-500', warning: 'bg-amber-500', danger: 'bg-rose-500', info: 'bg-sky-500', violet: 'bg-violet-500',
};

export function Badge({ tone = 'neutral', children, className, dot, pulse, title }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean; pulse?: boolean; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium ring-1 ring-inset', TONE[tone], className)}>
      {dot && <span className={cn('size-1.5 rounded-full', DOT[tone], pulse && 'animate-pulse-soft')} />}
      {children}
    </span>
  );
}

/** Maps any resource status to a tone. Transitional states pulse. */
const STATUS_TONE: Record<string, Tone> = {
  running: 'success', available: 'success', active: 'success', healthy: 'success', ready: 'success', connected: 'success', issued: 'success', 'in-use': 'brand',
  succeeded: 'success', success: 'success', Running: 'success', Ready: 'success', ok: 'success', up: 'success',
  stopped: 'neutral', disabled: 'neutral', revoked: 'neutral', cancelled: 'neutral', expired: 'neutral', offline: 'danger', decommissioning: 'neutral', invited: 'info', draining: 'warning',
  provisioning: 'info', starting: 'info', stopping: 'info', rebooting: 'info', creating: 'info', attaching: 'info', detaching: 'info', resizing: 'info', restoring: 'info',
  migrating: 'info', scaling: 'info', upgrading: 'info', updating: 'info', 'backing-up': 'info', 'failing-over': 'warning', connecting: 'info', discovering: 'info', queued: 'info', deleting: 'warning', Progressing: 'info', Pending: 'info', initial: 'info',
  maintenance: 'warning', degraded: 'warning', warning: 'warning', expiring: 'warning', 'pending-delegation': 'warning', pending: 'warning', Degraded: 'warning',
  error: 'danger', failed: 'danger', failure: 'danger', unhealthy: 'danger', NotReady: 'danger', down: 'danger',
};
const TRANSITIONAL = new Set(['provisioning', 'starting', 'stopping', 'rebooting', 'creating', 'attaching', 'detaching', 'resizing', 'restoring', 'migrating', 'scaling', 'upgrading', 'updating', 'backing-up', 'failing-over', 'connecting', 'discovering', 'deleting', 'queued', 'running-op', 'Progressing', 'draining', 'initial']);

export function statusTone(s: string): Tone { return STATUS_TONE[s] ?? 'neutral' }
export function isTransitional(s: string) { return TRANSITIONAL.has(s) }

export function StatusPill({ status, className, label }: { status: string; className?: string; label?: string }) {
  return (
    <Badge tone={statusTone(status)} dot pulse={isTransitional(status)} className={className}>
      {label ?? status.replace(/-/g, ' ')}
    </Badge>
  );
}

/** Small status dot only. */
export function StatusDot({ status, className }: { status: string; className?: string }) {
  return <span title={status} className={cn('inline-block size-2 shrink-0 rounded-full', DOT[statusTone(status)], isTransitional(status) && 'animate-pulse-soft', className)} />;
}

export function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <span className="inline-flex h-[22px] items-center overflow-hidden rounded-md border border-line bg-surface-2 text-[11px] font-medium">
      <span className="px-1.5 text-muted">{tag.key}</span>
      {tag.value && <span className="border-l border-line bg-surface px-1.5 text-fg-2">{tag.value}</span>}
      {onRemove && <button type="button" onClick={onRemove} className="border-l border-line px-1 text-faint hover:text-rose-500" aria-label={`Remove ${tag.key}`}>×</button>}
    </span>
  );
}

export function Tags({ tags, max = 3, className }: { tags: Tag[] | undefined; max?: number; className?: string }) {
  if (!tags?.length) return <span className="text-faint">—</span>;
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {tags.slice(0, max).map((t) => <TagChip key={t.key + t.value} tag={t} />)}
      {tags.length > max && <span className="text-[11px] text-muted" title={tags.slice(max).map((t) => `${t.key}=${t.value}`).join(', ')}>+{tags.length - max}</span>}
    </div>
  );
}
