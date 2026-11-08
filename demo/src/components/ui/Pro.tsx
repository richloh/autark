import { useState, type ReactNode } from 'react';
import { ChevronDown, SlidersHorizontal, Sparkle } from 'lucide-react';
import { usePro, useUi } from '@/store/ui';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------------------------------------
 * Progressive disclosure. The console defaults to SIMPLE mode: only what most people need.
 * PRO mode (toggle in the sidebar / settings / ⌘K) reveals advanced pages, metrics, IaC and config.
 *   <Pro>…</Pro>            render only in pro mode
 *   <Simple>…</Simple>      render only in simple mode
 *   <Advanced title>…       collapsible section: closed in simple mode, open in pro mode
 * ---------------------------------------------------------------------------------------------- */

export function Pro({ children }: { children: ReactNode }) {
  return usePro() ? <>{children}</> : null;
}

export function Simple({ children }: { children: ReactNode }) {
  return usePro() ? null : <>{children}</>;
}

/** Collapsible "Advanced options" block. */
export function Advanced({ title = 'Advanced options', description, children, className, defaultOpen, open: openProp, onOpenChange }: {
  title?: ReactNode; description?: ReactNode; children: ReactNode; className?: string; defaultOpen?: boolean;
  /** controlled mode (optional) */
  open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const pro = usePro();
  const [openState, setOpenState] = useState(defaultOpen ?? pro);
  const open = openProp ?? openState;
  const setOpen = (fn: (o: boolean) => boolean) => { const n = fn(open); setOpenState(n); onOpenChange?.(n) };
  return (
    <div className={cn('rounded-xl border border-line bg-surface shadow-card', className)}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left">
        <SlidersHorizontal className="size-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-fg">{title}</span>
          {description && !open && <span className="block truncate text-[12.5px] text-muted">{description}</span>}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="space-y-5 border-t border-line px-5 py-4">{children}</div>}
    </div>
  );
}

/** Switch used in sidebar & settings. */
export function ProToggle({ compact }: { compact?: boolean }) {
  const pro = useUi((s) => s.pro);
  const setPro = useUi((s) => s.setPro);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={pro}
      onClick={() => setPro(!pro)}
      title={pro ? 'Pro mode: all features visible. Click for simple mode.' : 'Simple mode. Click to enable Pro mode (advanced features).'}
      className={cn('flex w-full items-center gap-2.5 rounded-lg text-[13px] transition-colors hover:bg-surface-2', compact ? 'h-8 justify-center px-0' : 'h-9 px-2.5')}
    >
      <Sparkle className={cn('size-4 shrink-0', pro ? 'text-violet-500' : 'text-muted')} />
      {!compact && (
        <>
          <span className="flex-1 text-left">
            <span className="font-medium text-fg-2">Pro mode</span>
          </span>
          <span className={cn('relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full transition-colors', pro ? 'bg-violet-500' : 'bg-line-strong')}>
            <span className={cn('inline-block size-3.5 rounded-full bg-white shadow transition-transform', pro ? 'translate-x-4' : 'translate-x-0.5')} />
          </span>
        </>
      )}
    </button>
  );
}

/** Small badge marking pro-only UI when pro mode is on. */
export function ProBadge({ className }: { className?: string }) {
  return <span className={cn('rounded bg-violet-500/10 px-1 text-[9.5px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300', className)}>Pro</span>;
}
