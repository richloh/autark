import { useMemo, useState } from 'react';
import { Camera, CalendarClock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { timeAgo, dateTime, gb } from '@/lib/format';
import type { Snapshot } from '@/types';

export const TRIGGER_STYLE: Record<Snapshot['trigger'], { color: string; label: string }> = {
  manual: { color: '#5b67f8', label: 'Manual' },
  scheduled: { color: '#0ea5e9', label: 'Scheduled' },
  'pre-change': { color: '#f59e0b', label: 'Pre-change' },
};

const DAY = 86_400_000;

/**
 * Horizontal timeline of snapshots (newest on the right, "now" marker). Dot size scales with the
 * snapshot size; colour encodes the trigger. Optionally shows the next scheduled backup.
 */
export function SnapshotTimeline({ snapshots, selectedId, onSelect, nextAt, className, emptyLabel = 'No snapshots yet' }: {
  snapshots: Snapshot[]; selectedId?: string | null; onSelect?: (s: Snapshot) => void; nextAt?: number | null; className?: string; emptyLabel?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const now = Date.now();
  const { start, end, ticks } = useMemo(() => {
    const oldest = Math.min(now - DAY, ...snapshots.map((s) => Date.parse(s.createdAt)));
    const spanDays = Math.min(60, Math.max(2, Math.ceil((now - oldest) / DAY) + 1));
    const start = now - spanDays * DAY;
    const end = nextAt && nextAt > now ? Math.max(now + DAY * 0.08 * spanDays, nextAt + DAY * 0.04 * spanDays) : now + DAY * 0.04 * spanDays;
    const step = spanDays <= 3 ? DAY / 2 : spanDays <= 10 ? DAY : spanDays <= 30 ? 5 * DAY : 10 * DAY;
    const ticks: number[] = [];
    for (let t = now - step; t > start; t -= step) ticks.push(t);
    return { start, end, ticks };
  }, [snapshots, nextAt, now]);
  const x = (t: number) => `${((t - start) / (end - start)) * 100}%`;
  const maxSize = Math.max(1, ...snapshots.map((s) => s.sizeGB));
  const sorted = [...snapshots].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div className={cn('select-none', className)}>
      <div className="relative h-20">
        {/* axis */}
        <div className="absolute inset-x-0 top-10 h-px bg-line-strong" />
        <div className="absolute top-10 h-px bg-gradient-to-r from-transparent to-brand-500/50" style={{ left: 0, width: x(now) }} />
        {ticks.map((t) => (
          <div key={t} className="absolute top-[34px] -translate-x-1/2 text-center" style={{ left: x(t) }}>
            <div className="mx-auto h-3 w-px bg-line-strong" />
            <div className="mt-6 whitespace-nowrap text-[10px] text-faint">{timeAgo(t).replace(' ago', '')}</div>
          </div>
        ))}
        {/* now */}
        <div className="absolute top-3 -translate-x-1/2" style={{ left: x(now) }}>
          <div className="mx-auto h-14 w-px bg-brand-500/60" />
          <div className="-mt-[66px] whitespace-nowrap rounded bg-brand-500 px-1 text-[9px] font-semibold uppercase tracking-wide text-white">now</div>
        </div>
        {nextAt && nextAt > now && (
          <div className="absolute top-10 -translate-x-1/2 -translate-y-1/2" style={{ left: x(nextAt) }} title={`Next scheduled backup ${dateTime(nextAt)}`}>
            <span className="flex size-5 items-center justify-center rounded-full border border-dashed border-sky-500 bg-surface text-sky-500"><CalendarClock className="size-3" /></span>
          </div>
        )}
        {sorted.map((s) => {
          const t = Date.parse(s.createdAt);
          const size = 10 + Math.round((s.sizeGB / maxSize) * 10);
          const st = TRIGGER_STYLE[s.trigger];
          const active = selectedId === s.id || hover === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onMouseEnter={() => setHover(s.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(s)}
              className={cn('absolute top-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface shadow-sm transition-transform', active && 'z-10 scale-125', s.status !== 'available' && 'animate-pulse-soft')}
              style={{ left: x(t), width: size, height: size, background: st.color, boxShadow: selectedId === s.id ? `0 0 0 3px ${st.color}55` : undefined }}
              aria-label={`${s.name}, ${timeAgo(s.createdAt)}`}
            />
          );
        })}
        {hover && (() => {
          const s = snapshots.find((x) => x.id === hover);
          if (!s) return null;
          const pos = (Date.parse(s.createdAt) - start) / (end - start);
          return (
            <div className={cn('pointer-events-none absolute bottom-[calc(100%-26px)] z-20 w-56 rounded-lg border border-line bg-surface px-2.5 py-2 text-xs shadow-pop', pos > 0.6 ? '-translate-x-full' : pos > 0.3 ? '-translate-x-1/2' : '')} style={{ left: `${pos * 100}%` }}>
              <div className="truncate font-medium text-fg">{s.name}</div>
              <div className="mt-0.5 text-muted">{dateTime(s.createdAt)} · {timeAgo(s.createdAt)}</div>
              <div className="mt-1 flex items-center justify-between text-muted"><span style={{ color: TRIGGER_STYLE[s.trigger].color }}>{TRIGGER_STYLE[s.trigger].label}</span><span className="tabular text-fg-2">{gb(s.sizeGB)}</span></div>
              {s.description && <div className="mt-1 text-faint">{s.description}</div>}
            </div>
          );
        })()}
        {snapshots.length === 0 && (
          <div className="absolute inset-x-0 top-2 flex items-center justify-center gap-1.5 text-xs text-muted"><Camera className="size-3.5" />{emptyLabel}</div>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        {Object.entries(TRIGGER_STYLE).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: v.color }} />{v.label}</span>
        ))}
        {nextAt && <span className="flex items-center gap-1.5"><span className="size-2 rounded-full border border-dashed border-sky-500" />Next scheduled</span>}
        <span className="ml-auto text-faint">dot size ∝ snapshot size</span>
      </div>
    </div>
  );
}

/** Next run time of a daily/weekly/hourly schedule with an optional "HH:MM-HH:MM" window. */
export function nextBackupAt(schedule: 'hourly' | 'daily' | 'weekly', window = '02:00-04:00', from = Date.now()): number {
  if (schedule === 'hourly') return Math.ceil(from / 3_600_000) * 3_600_000;
  const [h, m] = (window.split('-')[0] ?? '02:00').split(':').map(Number);
  const d = new Date(from);
  d.setHours(h || 0, m || 0, 0, 0);
  if (d.getTime() <= from) d.setDate(d.getDate() + 1);
  if (schedule === 'weekly') while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  return d.getTime();
}
