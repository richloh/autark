import { useState } from 'react';
import { cn } from '@/lib/cn';

export interface BarDatum { label: string; segments: { id: string; value: number; color: string; label?: string }[]; highlight?: boolean; forecast?: boolean }

/** Vertical stacked bar chart (e.g. daily cost by service). */
export function BarChart({ data, height = 180, className, format = (v) => String(Math.round(v)), budgetLine }: { data: BarDatum[]; height?: number; className?: string; format?: (v: number) => string; budgetLine?: { value: number; label: string } }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.segments.reduce((a, s) => a + s.value, 0)), budgetLine?.value ?? 0) * 1.08;
  return (
    <div className={cn('relative', className)}>
      <div className="relative flex items-end gap-[3px]" style={{ height }}>
        {budgetLine && (
          <div className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-rose-400" style={{ bottom: `${(budgetLine.value / max) * 100}%` }}>
            <span className="absolute -top-4 right-0 rounded bg-surface px-1 text-[10px] text-rose-500">{budgetLine.label}</span>
          </div>
        )}
        {data.map((d, i) => {
          const total = d.segments.reduce((a, s) => a + s.value, 0);
          return (
            <div key={i} className="relative flex h-full flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <div className={cn('flex w-full flex-col-reverse overflow-hidden rounded-t-[3px] transition-opacity', hover != null && hover !== i && 'opacity-50', d.forecast && 'opacity-45')} style={{ height: `${(total / max) * 100}%` }}>
                {d.segments.map((s) => (
                  <div key={s.id} style={{ height: `${total ? (s.value / total) * 100 : 0}%`, background: s.color, backgroundImage: d.forecast ? 'repeating-linear-gradient(45deg, transparent 0 3px, rgba(255,255,255,.35) 3px 5px)' : undefined }} />
                ))}
              </div>
              {hover === i && (
                <div className={cn('pointer-events-none absolute bottom-full z-20 mb-2 min-w-40 rounded-lg border border-line bg-surface px-2.5 py-2 text-xs shadow-pop', i > data.length / 2 ? 'right-0' : 'left-0')}>
                  <div className="mb-1 flex justify-between gap-2 text-muted"><span>{d.label}{d.forecast ? ' (forecast)' : ''}</span><span className="font-medium tabular text-fg">{format(total)}</span></div>
                  {d.segments.filter((s) => s.value > 0).map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-fg-2"><span className="size-2 rounded-sm" style={{ background: s.color }} />{s.label ?? s.id}</span>
                      <span className="tabular">{format(s.value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[3px] text-[10px] text-faint">
        {data.map((d, i) => <div key={i} className="relative h-3 flex-1">{i % Math.ceil(data.length / 7) === 0 && <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{d.label}</span>}</div>)}
      </div>
    </div>
  );
}
