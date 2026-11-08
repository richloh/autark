import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { area, line, curveMonotoneX } from 'd3-shape';
import { cn } from '@/lib/cn';

export interface Series { id: string; label: string; color: string; points: { t: number; v: number }[]; dashed?: boolean }

const PALETTE = ['#5b67f8', '#06b6d4', '#a855f7', '#f59e0b', '#10b981', '#ec4899', '#64748b'];
export const chartColor = (i: number) => PALETTE[i % PALETTE.length];

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function fmtTime(t: number, spanMs: number) {
  const d = new Date(t);
  if (spanMs > 3 * 86_400_000) return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Responsive multi-series area/line chart with hover crosshair + tooltip. Pure SVG.
 * `stacked` renders cumulative areas.
 */
export function AreaChart({ series, height = 180, unit = '', max, className, format, stacked, showLegend = true, yTicks = 4, emptyLabel, markers }: {
  series: Series[]; height?: number; unit?: string; max?: number; className?: string; format?: (v: number) => string; stacked?: boolean; showLegend?: boolean; yTicks?: number; emptyLabel?: ReactNode;
  markers?: { t: number; label: string; color?: string }[];
}) {
  const uid = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const width = 600; // viewBox width; scales responsively
  const padL = 40, padR = 8, padT = 10, padB = 22;
  const fmt = format ?? ((v: number) => `${v >= 100 ? Math.round(v) : v.toFixed(v < 10 ? 1 : 0)}${unit ? ` ${unit}` : ''}`);

  const { xs, layers, yMax, tMin, tMax } = useMemo(() => {
    const base = series[0]?.points ?? [];
    const xs = base.map((p) => p.t);
    const layers = series.map((s, si) => s.points.map((p, i) => {
      const below = stacked ? series.slice(0, si).reduce((a, x) => a + (x.points[i]?.v ?? 0), 0) : 0;
      return { t: p.t, y0: below, y1: below + p.v, v: p.v };
    }));
    const peak = Math.max(1e-9, ...layers.flat().map((p) => p.y1), ...(markers ?? []).map(() => 0));
    return { xs, layers, yMax: max ?? niceMax(peak * 1.08), tMin: xs[0] ?? 0, tMax: xs[xs.length - 1] ?? 1 };
  }, [series, stacked, max, markers]);

  if (!xs.length) {
    return <div className={cn('flex items-center justify-center text-sm text-muted', className)} style={{ height }}>{emptyLabel ?? 'No data'}</div>;
  }

  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const x = (t: number) => padL + ((t - tMin) / Math.max(1, tMax - tMin)) * innerW;
  const y = (v: number) => padT + innerH - (v / yMax) * innerH;

  const onMove = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    const t = tMin + ((px - padL) / innerW) * (tMax - tMin);
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - t) < Math.abs(xs[best] - t)) best = i;
    setHover(best);
  };

  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => (yMax / yTicks) * i);
  const xTickIdx = [0, Math.floor(xs.length / 4), Math.floor(xs.length / 2), Math.floor((3 * xs.length) / 4), xs.length - 1];

  return (
    <div className={cn('relative w-full', className)}>
      {showLegend && series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
          {series.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5 text-xs text-muted"><span className="h-2 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>
          ))}
        </div>
      )}
      <div ref={ref} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.id} id={`${uid}-g${i}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity={stacked ? 0.55 : 0.25} />
                <stop offset="1" stopColor={s.color} stopOpacity={stacked ? 0.3 : 0} />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t, i) => (
            <line key={i} x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={i === 0 ? undefined : '3 4'} vectorEffect="non-scaling-stroke" />
          ))}
          {layers.map((pts, i) => {
            const s = series[i];
            const a = area<(typeof pts)[number]>().x((p) => x(p.t)).y0((p) => y(p.y0)).y1((p) => y(p.y1)).curve(curveMonotoneX)(pts) ?? '';
            const l = line<(typeof pts)[number]>().x((p) => x(p.t)).y((p) => y(p.y1)).curve(curveMonotoneX)(pts) ?? '';
            return (
              <g key={s.id}>
                {!s.dashed && <path d={a} fill={`url(#${uid}-g${i})`} />}
                <path d={l} fill="none" stroke={s.color} strokeWidth={1.75} strokeDasharray={s.dashed ? '5 4' : undefined} vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
          {markers?.map((m, i) => (
            <line key={i} x1={x(m.t)} x2={x(m.t)} y1={padT} y2={padT + innerH} stroke={m.color ?? '#f59e0b'} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          ))}
          {hover != null && <line x1={x(xs[hover])} x2={x(xs[hover])} y1={padT} y2={padT + innerH} stroke="var(--line-strong)" vectorEffect="non-scaling-stroke" />}
        </svg>
        {/* Axis labels as HTML so they don't stretch */}
        <div className="pointer-events-none absolute inset-0">
          {ticks.map((t, i) => (
            <span key={i} className="absolute left-0 -translate-y-1/2 text-[10px] tabular text-faint" style={{ top: `${(y(t) / height) * 100}%` }}>{fmt(t).replace(` ${unit}`, '')}</span>
          ))}
          {xTickIdx.map((idx, i) => (
            <span key={i} className={cn('absolute bottom-0 text-[10px] tabular text-faint', i === 0 ? '' : i === xTickIdx.length - 1 ? '-translate-x-full' : '-translate-x-1/2')} style={{ left: `${(x(xs[idx]) / width) * 100}%` }}>{fmtTime(xs[idx], tMax - tMin)}</span>
          ))}
          {hover != null && series.map((s, i) => (
            <span key={s.id} className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface" style={{ background: s.color, left: `${(x(xs[hover]) / width) * 100}%`, top: `${(y(layers[i][hover].y1) / height) * 100}%` }} />
          ))}
        </div>
        {hover != null && (
          <div className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-line bg-surface/95 px-2.5 py-2 text-xs shadow-pop backdrop-blur"
            style={{ left: `${(x(xs[hover]) / width) * 100}%`, transform: x(xs[hover]) > width * 0.6 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}>
            <div className="mb-1 text-[11px] text-muted">{new Date(xs[hover]).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
            {series.map((s, i) => (
              <div key={s.id} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-fg-2"><span className="size-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
                <span className="font-medium tabular text-fg">{fmt(layers[i][hover].v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
