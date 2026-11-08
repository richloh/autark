import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, X, Minus, Terminal } from 'lucide-react';
import { cn } from '@/lib/cn';
import { duration } from '@/lib/format';
import { useNow } from '@/api/hooks';
import type { Operation } from '@/types';
import { usePro } from '@/store/ui';

/** Smooth live progress computed client-side from step timestamps. */
export function liveProgress(op: Operation, now: number): number {
  if (op.status === 'succeeded') return 1;
  if (op.status !== 'running') return op.progress;
  const total = op.steps.reduce((a, s) => a + s.durationMs, 0);
  const elapsed = now - Date.parse(op.startedAt ?? op.createdAt);
  return Math.min(0.99, Math.max(0, elapsed / Math.max(1, total)));
}

/** Full step-by-step view of a provisioning operation with logs. */
export function OperationRunner({ op, className, showLogs = true, compact }: { op: Operation; className?: string; showLogs?: boolean; compact?: boolean }) {
  const now = useNow(200);
  const progress = liveProgress(op, now);
  const pro = usePro();
  const [logsOpen, setLogsOpen] = useState(!compact && pro);
  const logRef = useRef<HTMLDivElement>(null);
  const logLines = op.steps.flatMap((s) => s.logs.map((l) => ({ step: s.name, line: l, failed: l.startsWith('ERROR') })));
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }) }, [logLines.length]);
  const startedAt = Date.parse(op.startedAt ?? op.createdAt);
  const elapsed = (op.finishedAt ? Date.parse(op.finishedAt) : now) - startedAt;

  return (
    <div className={cn('overflow-hidden rounded-xl border border-line bg-surface', className)}>
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-fg">{op.title}</div>
            <div className="mt-0.5 text-xs text-muted">
              {op.status === 'running' ? 'In progress' : op.status === 'succeeded' ? 'Completed' : op.status === 'failed' ? 'Failed' : op.status} · {duration(Math.max(0, elapsed))}
            </div>
          </div>
          <span className={cn('text-lg font-semibold tabular', op.status === 'failed' ? 'text-rose-500' : op.status === 'succeeded' ? 'text-emerald-500' : 'text-fg')}>{Math.round(progress * 100)}%</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div className={cn('h-full rounded-full transition-[width] duration-200', op.status === 'failed' ? 'bg-rose-500' : op.status === 'succeeded' ? 'bg-emerald-500' : 'bg-gradient-to-r from-brand-400 to-brand-600')} style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <ol className="space-y-0 px-4 py-3">
        {op.steps.map((s, i) => (
          <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
            {i < op.steps.length - 1 && <span className={cn('absolute left-[9px] top-5 h-[calc(100%-12px)] w-px', s.status === 'done' ? 'bg-emerald-500/40' : 'bg-line')} />}
            <StepIcon status={s.status} />
            <div className="min-w-0 flex-1">
              <div className={cn('text-[13px]', s.status === 'pending' || s.status === 'skipped' ? 'text-faint' : 'text-fg', s.status === 'running' && 'font-medium')}>{s.name}</div>
              {s.status === 'running' && s.logs.length > 0 && <div className="mt-0.5 truncate font-mono text-[11px] text-muted">{s.logs[s.logs.length - 1]}</div>}
            </div>
            {s.startedAt && (s.status === 'done' || s.status === 'failed') && (
              <span className="shrink-0 text-[11px] tabular text-faint">{duration(Date.parse(s.finishedAt ?? s.startedAt) - Date.parse(s.startedAt))}</span>
            )}
          </li>
        ))}
      </ol>
      {op.error && <div className="mx-4 mb-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-2.5 text-[13px] text-rose-700 dark:text-rose-300">{op.error}</div>}
      {showLogs && logLines.length > 0 && (
        <div className="border-t border-line">
          <button onClick={() => setLogsOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-muted hover:text-fg">
            <Terminal className="size-3.5" /> Logs <span className="text-faint">({logLines.length})</span>
            <ChevronDown className={cn('ml-auto size-3.5 transition-transform', logsOpen && 'rotate-180')} />
          </button>
          {logsOpen && (
            <div ref={logRef} className="max-h-48 overflow-y-auto bg-[#0d0f18] px-4 py-2.5 font-mono text-[11.5px] leading-relaxed text-slate-300">
              {logLines.map((l, i) => (
                <div key={i} className={cn(l.failed && 'text-rose-400')}><span className="select-none text-slate-500">›</span> {l.line}</div>
              ))}
              {op.status === 'running' && <div className="animate-pulse-soft text-slate-500">▍</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  if (status === 'done') return <span className="z-10 flex size-[19px] shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="size-3" strokeWidth={3} /></span>;
  if (status === 'running') return <span className="z-10 flex size-[19px] shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-500"><Loader2 className="size-3 animate-spin" strokeWidth={3} /></span>;
  if (status === 'failed') return <span className="z-10 flex size-[19px] shrink-0 items-center justify-center rounded-full bg-rose-500 text-white"><X className="size-3" strokeWidth={3} /></span>;
  if (status === 'skipped') return <span className="z-10 flex size-[19px] shrink-0 items-center justify-center rounded-full bg-surface-3 text-faint"><Minus className="size-3" /></span>;
  return <span className="z-10 size-[19px] shrink-0 rounded-full border-2 border-line bg-surface" />;
}

/** Compact one-line progress for lists / banners. */
export function OperationInline({ op, className }: { op: Operation; className?: string }) {
  const now = useNow(250);
  const p = liveProgress(op, now);
  const current = op.steps.find((s) => s.status === 'running');
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-fg-2">{current?.name ?? op.title}</span>
        <span className="tabular text-muted">{Math.round(p * 100)}%</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-brand-500 transition-[width] duration-200" style={{ width: `${p * 100}%` }} />
      </div>
    </div>
  );
}
