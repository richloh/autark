import { useState, type ReactNode } from 'react';
import { Check, Copy, Loader2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { toast } from './toast';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-mono text-[10px] font-medium text-muted', className)}>{children}</kbd>;
}

export function Spinner({ className }: { className?: string }) { return <Loader2 className={cn('size-4 animate-spin text-muted', className)} /> }

export function Skeleton({ className }: { className?: string }) { return <div className={cn('skeleton h-4', className)} /> }

export function CopyButton({ value, className, label = 'Copy' }: { value: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(value).catch(() => {});
        setDone(true);
        toast.success('Copied to clipboard');
        setTimeout(() => setDone(false), 1200);
      }}
      className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-3 hover:text-fg', className)}
    >
      {done ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** Monospace value with copy affordance (IDs, IPs, endpoints). */
export function Mono({ children, copy, className }: { children: ReactNode; copy?: string | boolean; className?: string }) {
  const value = typeof copy === 'string' ? copy : typeof children === 'string' ? children : '';
  return (
    <span className={cn('group inline-flex max-w-full items-center gap-1 font-mono text-[12.5px] text-fg-2', className)}>
      <span className="truncate">{children}</span>
      {copy && value && <CopyButton value={value} className="opacity-0 group-hover:opacity-100" />}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon?: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {Icon && (
        <div className="relative mb-4">
          <div className="absolute inset-0 rounded-2xl bg-brand-500/20 blur-xl" />
          <div className="relative flex size-12 items-center justify-center rounded-2xl border border-line bg-surface shadow-card"><Icon className="size-6 text-brand-500" /></div>
        </div>
      )}
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Progress / usage meter with threshold coloring. */
export function Meter({ value, max = 100, className, size = 'md', tone, showLabel, label, thresholds = [0.75, 0.9] }: {
  value: number; max?: number; className?: string; size?: 'xs' | 'sm' | 'md'; tone?: string; showLabel?: boolean; label?: ReactNode; thresholds?: [number, number];
}) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const color = tone ?? (ratio >= thresholds[1] ? 'bg-rose-500' : ratio >= thresholds[0] ? 'bg-amber-500' : 'bg-brand-500');
  const h = { xs: 'h-1', sm: 'h-1.5', md: 'h-2' }[size];
  return (
    <div className={cn('w-full', className)}>
      {(showLabel || label) && (
        <div className="mb-1 flex justify-between text-xs">
          <span className="text-muted">{label}</span>
          <span className="tabular font-medium text-fg-2">{Math.round(ratio * 100)}%</span>
        </div>
      )}
      <div className={cn('w-full overflow-hidden rounded-full bg-surface-3', h)}>
        <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

/** Stacked segments bar (e.g. used / reserved / free). */
export function StackBar({ segments, total, className, height = 'h-2.5' }: { segments: { value: number; color: string; label?: string }[]; total: number; className?: string; height?: string }) {
  return (
    <div className={cn('flex w-full overflow-hidden rounded-full bg-surface-3', height, className)}>
      {segments.map((s, i) => (
        <div key={i} title={s.label ? `${s.label}: ${s.value}` : undefined} className="h-full transition-all duration-500 first:rounded-l-full" style={{ width: `${total ? (s.value / total) * 100 : 0}%`, background: s.color }} />
      ))}
    </div>
  );
}

/** Circular gauge. */
export function Ring({ value, max = 100, size = 56, stroke = 6, color, label, sublabel, className }: { value: number; max?: number; size?: number; stroke?: number; color?: string; label?: ReactNode; sublabel?: ReactNode; className?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const col = color ?? (ratio >= 0.9 ? '#f43f5e' : ratio >= 0.75 ? '#f59e0b' : '#5b67f8');
  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[13px] font-semibold tabular text-fg">{label ?? `${Math.round(ratio * 100)}%`}</span>
        {sublabel && <span className="mt-0.5 text-[10px] text-muted">{sublabel}</span>}
      </div>
    </div>
  );
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: color }} />;
}
