import { useId, useMemo, useRef, useState } from 'react';
import { area, line, curveMonotoneX } from 'd3-shape';
import { PiggyBank } from 'lucide-react';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';
import { HYPERSCALER_MULTIPLIER, SERVICE_LABEL, serviceColor } from './shared';

export interface CostSeries { id: string; label: string; color: string; points: { t: number; v: number }[]; forecast?: { t: number; v: number }[] }

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const fmtDay = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

/**
 * Stacked daily cost areas with a hatched forecast region, a "today" marker and an optional daily budget line.
 * Every series must share the same timestamps (as returned by /costs/history).
 */
export function StackedCostChart({ series, height = 260, budgetDaily, className }: { series: CostSeries[]; height?: number; budgetDaily?: number; className?: string }) {
  const uid = useId().replace(/:/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const width = 600, padL = 44, padR = 8, padT = 12, padB = 22;

  const model = useMemo(() => {
    const base = series[0];
    if (!base) return null;
    const nActual = base.points.length;
    const ts = [...base.points.map((p) => p.t), ...(base.forecast ?? []).map((p) => p.t)];
    const val = (s: CostSeries, i: number) => (i < nActual ? s.points[i]?.v : s.forecast?.[i - nActual]?.v) ?? 0;
    const layers = series.map((s, si) => ts.map((t, i) => {
      const below = series.slice(0, si).reduce((a, x) => a + val(x, i), 0);
      return { t, i, y0: below, y1: below + val(s, i), v: val(s, i) };
    }));
    const totals = ts.map((_, i) => series.reduce((a, s) => a + val(s, i), 0));
    const yMax = niceMax(Math.max(...totals, budgetDaily ?? 0) * 1.1);
    return { ts, nActual, layers, totals, yMax };
  }, [series, budgetDaily]);

  if (!model || !model.ts.length) return <div className={cn('flex items-center justify-center text-sm text-muted', className)} style={{ height }}>No cost data</div>;
  const { ts, nActual, layers, totals, yMax } = model;
  const innerW = width - padL - padR, innerH = height - padT - padB;
  const x = (i: number) => padL + (i / Math.max(1, ts.length - 1)) * innerW;
  const y = (v: number) => padT + innerH - (v / yMax) * innerH;
  const todayX = x(nActual - 1);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const xTicks = [0, Math.floor((ts.length - 1) / 3), Math.floor(((ts.length - 1) * 2) / 3), ts.length - 1];

  const onMove = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    setHover(Math.max(0, Math.min(ts.length - 1, Math.round(((px - padL) / innerW) * (ts.length - 1)))));
  };

  type P = (typeof layers)[number][number];
  const areaGen = area<P>().x((p) => x(p.i)).y0((p) => y(p.y0)).y1((p) => y(p.y1)).curve(curveMonotoneX);
  const lineGen = line<P>().x((p) => x(p.i)).y((p) => y(p.y1)).curve(curveMonotoneX);

  return (
    <div className={cn('relative w-full', className)}>
      <div ref={ref} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }}>
          <defs>
            <pattern id={`${uid}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--surface)" fillOpacity="0" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--surface)" strokeWidth="2.5" strokeOpacity="0.55" />
            </pattern>
            <clipPath id={`${uid}-past`}><rect x="0" y="0" width={todayX} height={height} /></clipPath>
            <clipPath id={`${uid}-future`}><rect x={todayX} y="0" width={width - todayX} height={height} /></clipPath>
          </defs>
          {ticks.map((t, i) => <line key={i} x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={i ? '3 4' : undefined} vectorEffect="non-scaling-stroke" />)}
          {nActual < ts.length && <rect x={todayX} y={padT} width={width - padR - todayX} height={innerH} fill="var(--surface-2)" opacity={0.6} />}
          {layers.map((pts, i) => {
            const s = series[i];
            const a = areaGen(pts) ?? '';
            const l = lineGen(pts) ?? '';
            return (
              <g key={s.id}>
                <g clipPath={`url(#${uid}-past)`}>
                  <path d={a} fill={s.color} fillOpacity={0.72} />
                  <path d={l} fill="none" stroke="var(--surface)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                </g>
                <g clipPath={`url(#${uid}-future)`}>
                  <path d={a} fill={s.color} fillOpacity={0.32} />
                  <path d={a} fill={`url(#${uid}-hatch)`} />
                  <path d={l} fill="none" stroke={s.color} strokeWidth={1.25} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
                </g>
              </g>
            );
          })}
          {nActual < ts.length && <line x1={todayX} x2={todayX} y1={padT} y2={padT + innerH} stroke="var(--fg-2)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
          {budgetDaily ? <line x1={padL} x2={width - padR} y1={y(budgetDaily)} y2={y(budgetDaily)} stroke="#f43f5e" strokeDasharray="6 4" strokeWidth={1.5} vectorEffect="non-scaling-stroke" /> : null}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} stroke="var(--line-strong)" vectorEffect="non-scaling-stroke" />}
        </svg>
        <div className="pointer-events-none absolute inset-0">
          {ticks.map((t, i) => <span key={i} className="absolute left-0 -translate-y-1/2 text-[10px] tabular text-faint" style={{ top: `${(y(t) / height) * 100}%` }}>{money(t, { decimals: false })}</span>)}
          {xTicks.map((idx, i) => (
            <span key={i} className={cn('absolute bottom-0 text-[10px] tabular text-faint', i === 0 ? '' : i === xTicks.length - 1 ? '-translate-x-full' : '-translate-x-1/2')} style={{ left: `${(x(idx) / width) * 100}%` }}>{fmtDay(ts[idx])}</span>
          ))}
          {nActual < ts.length && <span className="absolute top-0 ml-1 text-[10px] font-medium text-muted" style={{ left: `${(todayX / width) * 100}%` }}>Forecast →</span>}
          {budgetDaily ? <span className="absolute right-1 -translate-y-full rounded bg-surface/90 px-1 text-[10px] text-rose-500" style={{ top: `${(y(budgetDaily) / height) * 100}%` }}>Daily budget {money(budgetDaily)}</span> : null}
          {hover != null && series.map((s, i) => (
            <span key={s.id} className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface" style={{ background: s.color, left: `${(x(hover) / width) * 100}%`, top: `${(y(layers[i][hover].y1) / height) * 100}%` }} />
          ))}
        </div>
        {hover != null && (
          <div className="pointer-events-none absolute top-0 z-10 min-w-44 rounded-lg border border-line bg-surface/95 px-2.5 py-2 text-xs shadow-pop backdrop-blur"
            style={{ left: `${(x(hover) / width) * 100}%`, transform: x(hover) > width * 0.6 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}>
            <div className="mb-1 flex justify-between gap-3 text-muted">
              <span>{fmtDay(ts[hover])}{hover >= nActual ? ' · forecast' : ''}</span>
              <span className="font-semibold tabular text-fg">{money(totals[hover])}</span>
            </div>
            {[...series].map((s, i) => ({ s, v: layers[i][hover].v })).filter((r) => r.v > 0).reverse().map(({ s, v }) => (
              <div key={s.id} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-fg-2"><span className="size-2 rounded-sm" style={{ background: s.color }} />{s.label}</span>
                <span className="tabular text-fg">{money(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {series.map((s) => <span key={s.id} className="inline-flex items-center gap-1.5 text-xs text-muted"><span className="h-2 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- savings vs hyperscaler */

export function SavingsCard({ byService, className }: { byService: { service: string; monthly: number }[]; className?: string }) {
  const rows = byService.filter((s) => s.monthly > 0).map((s) => {
    const mult = HYPERSCALER_MULTIPLIER[s.service] ?? 3;
    return { ...s, mult, hyper: s.monthly * mult };
  }).sort((a, b) => b.hyper - a.hyper);
  const autark = rows.reduce((a, r) => a + r.monthly, 0);
  const hyper = rows.reduce((a, r) => a + r.hyper, 0);
  const max = Math.max(1, ...rows.map((r) => r.hyper));
  return (
    <div className={className}>
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><PiggyBank className="size-5" /></div>
        <div className="min-w-0">
          <div className="text-xs text-muted">Estimated savings vs. hyperscaler on-demand</div>
          <div className="text-2xl font-semibold tracking-tight tabular text-fg">{money(hyper - autark, { decimals: false })}<span className="text-sm font-normal text-muted"> / month</span></div>
          <div className="text-xs text-muted">≈ {money((hyper - autark) * 12, { decimals: false })} per year · {autark ? (hyper / autark).toFixed(1) : '—'}× cheaper overall</div>
        </div>
      </div>
      <ul className="mt-4 space-y-2.5">
        {rows.map((r) => (
          <li key={r.service}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-fg-2"><span className="size-2 rounded-sm" style={{ background: serviceColor(r.service) }} />{SERVICE_LABEL[r.service] ?? r.service}<span className="text-faint">×{r.mult}</span></span>
              <span className="tabular text-muted"><span className="text-fg">{money(r.monthly)}</span> vs {money(r.hyper)}</span>
            </div>
            <div className="space-y-[2px]">
              <div className="h-1.5 rounded-full" style={{ width: `${Math.max(1, (r.monthly / max) * 100)}%`, background: serviceColor(r.service) }} title={`Autark ${money(r.monthly)}`} />
              <div className="h-1.5 rounded-full bg-faint/50" style={{ width: `${(r.hyper / max) * 100}%` }} title={`Hyperscaler ${money(r.hyper)}`} />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-brand-500" />Autark (actual)</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-faint/50" />Hyperscaler (estimate)</span>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-faint">
        Estimate only. Equivalent on-demand cost using typical price multiples for comparable managed capability
        (Kubernetes ≈15×, databases ≈8×, compute ≈4×, storage & network ≈3×), excluding egress and support fees.
      </p>
    </div>
  );
}
