import { useState, type ReactNode } from 'react';
import { arc, pie } from 'd3-shape';
import { cn } from '@/lib/cn';

export interface Slice { id: string; label: string; value: number; color: string }

/** Donut with hover highlight and center label. */
export function Donut({ data, size = 160, thickness = 22, center, className, format = (v) => String(v), legend = true }: {
  data: Slice[]; size?: number; thickness?: number; center?: ReactNode; className?: string; format?: (v: number) => string; legend?: boolean;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const total = data.reduce((a, d) => a + d.value, 0);
  const arcs = pie<Slice>().value((d) => d.value).sort(null).padAngle(0.015)(data);
  const r = size / 2;
  const gen = arc<any>().innerRadius(r - thickness).outerRadius(r).cornerRadius(3);
  const genHover = arc<any>().innerRadius(r - thickness - 2).outerRadius(r + 3).cornerRadius(3);
  const h = data.find((d) => d.id === hover);
  return (
    <div className={cn('flex flex-col items-center gap-4 @min-[36rem]:flex-row @min-[36rem]:items-center', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          <g transform={`translate(${r},${r})`}>
            {total === 0 && <circle r={r - thickness / 2} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />}
            {arcs.map((a) => (
              <path key={a.data.id} d={(hover === a.data.id ? genHover : gen)(a) ?? ''} fill={a.data.color} opacity={hover && hover !== a.data.id ? 0.35 : 1}
                onMouseEnter={() => setHover(a.data.id)} onMouseLeave={() => setHover(null)} className="cursor-pointer transition-opacity" />
            ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {h ? (
            <>
              <span className="text-[11px] text-muted">{h.label}</span>
              <span className="text-base font-semibold tabular text-fg">{format(h.value)}</span>
              <span className="text-[11px] tabular text-faint">{total ? Math.round((h.value / total) * 100) : 0}%</span>
            </>
          ) : center}
        </div>
      </div>
      {legend && (
        <ul className="w-full min-w-0 space-y-1.5">
          {data.map((d) => (
            <li key={d.id} onMouseEnter={() => setHover(d.id)} onMouseLeave={() => setHover(null)}
              className={cn('flex cursor-default items-center gap-2 rounded-md px-1.5 py-0.5 text-[13px] transition-colors', hover === d.id && 'bg-surface-2')}>
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
              <span className="min-w-0 flex-1 truncate text-fg-2">{d.label}</span>
              <span className="tabular text-fg">{format(d.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
