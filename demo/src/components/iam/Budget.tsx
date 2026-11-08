import { useMemo, useRef, useState } from 'react';
import { area, line, curveMonotoneX } from 'd3-shape';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';
import type { ProjectAllowance } from '@/types';

/** Budget status from forecast vs thresholds. */
export function budgetState(a: Pick<ProjectAllowance, 'budgetMonthly' | 'alertThresholds'> & { forecastSpend?: number; mtdSpend?: number }) {
  const budget = a.budgetMonthly;
  const forecast = a.forecastSpend ?? 0;
  const mtd = a.mtdSpend ?? 0;
  const fPct = budget > 0 ? (forecast / budget) * 100 : forecast > 0 ? 999 : 0;
  const mPct = budget > 0 ? (mtd / budget) * 100 : mtd > 0 ? 999 : 0;
  const thresholds = [...(a.alertThresholds ?? [])].sort((x, y) => x - y);
  const crossed = thresholds.filter((t) => fPct >= t);
  const top = crossed[crossed.length - 1];
  const level: 'ok' | 'warn' | 'over' = fPct >= 100 ? 'over' : top != null || fPct >= 80 ? 'warn' : 'ok';
  return { fPct, mPct, level, crossed, color: level === 'over' ? '#f43f5e' : level === 'warn' ? '#f59e0b' : '#10b981', label: level === 'over' ? 'Over budget' : level === 'warn' ? 'At risk' : 'On track' };
}

/** Semicircular budget gauge: solid arc = spent so far, ghost arc = forecast, ticks = alert thresholds. */
export function BudgetGauge({ allowance, size = 150, className }: { allowance: ProjectAllowance; size?: number; className?: string }) {
  const st = budgetState(allowance);
  const r = size / 2 - 10;
  const cx = size / 2, cy = size / 2;
  const scaleMax = Math.max(120, Math.ceil(Math.max(st.fPct, ...allowance.alertThresholds) / 20) * 20); // degrees map 0..scaleMax%
  const ang = (pct: number) => Math.PI + (Math.min(pct, scaleMax) / scaleMax) * Math.PI;
  const pt = (pct: number, rr = r) => [cx + rr * Math.cos(ang(pct)), cy + rr * Math.sin(ang(pct))];
  const arc = (from: number, to: number) => {
    const [x1, y1] = pt(from); const [x2, y2] = pt(to);
    const large = ang(to) - ang(from) > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };
  const h = size / 2 + 14;
  return (
    <div className={cn('relative inline-block', className)} style={{ width: size, height: h }}>
      <svg width={size} height={h} role="img" aria-label={`Spent ${Math.round(st.mPct)}% of budget, forecast ${Math.round(st.fPct)}%`}>
        <path d={arc(0, scaleMax)} fill="none" stroke="var(--surface-3)" strokeWidth={10} strokeLinecap="round" />
        {/* over-100 zone */}
        <path d={arc(100, scaleMax)} fill="none" stroke="#f43f5e" strokeOpacity={0.14} strokeWidth={10} />
        {st.fPct > 0 && <path d={arc(0, Math.max(0.5, st.fPct))} fill="none" stroke={st.color} strokeOpacity={0.3} strokeWidth={10} strokeLinecap="round" strokeDasharray="3 3" />}
        {st.mPct > 0 && <path d={arc(0, Math.max(0.5, st.mPct))} fill="none" stroke={st.color} strokeWidth={10} strokeLinecap="round" style={{ transition: 'd .6s' }} />}
        {allowance.alertThresholds.map((t) => {
          const [x1, y1] = pt(t, r - 9); const [x2, y2] = pt(t, r + 8);
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke={t >= 100 ? '#f43f5e' : 'var(--muted)'} strokeWidth={1.5}><title>{t}% alert threshold</title></line>;
        })}
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center leading-tight">
        <div className="text-lg font-semibold tabular text-fg">{allowance.budgetMonthly > 0 ? `${Math.round(st.mPct)}%` : money(allowance.mtdSpend)}</div>
        <div className="text-[10.5px] text-muted">{allowance.budgetMonthly > 0 ? `forecast ${Math.round(st.fPct)}%` : 'no budget'}</div>
      </div>
    </div>
  );
}

/** Horizontal burn bar for tables: spent (solid) + forecast (hatched) vs budget with threshold ticks. */
export function BurnBar({ allowance, className }: { allowance: ProjectAllowance; className?: string }) {
  const st = budgetState(allowance);
  const max = Math.max(110, st.fPct * 1.05);
  const w = (p: number) => `${(Math.min(p, max) / max) * 100}%`;
  return (
    <div className={cn('relative h-2.5 w-full rounded-full bg-surface-3', className)} title={`Spent ${money(allowance.mtdSpend)} · forecast ${money(allowance.forecastSpend)} · budget ${money(allowance.budgetMonthly)}`}>
      <div className="absolute inset-y-0 left-0 rounded-full opacity-35" style={{ width: w(st.fPct), background: `repeating-linear-gradient(45deg, ${st.color} 0 3px, transparent 3px 6px)` }} />
      <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500" style={{ width: w(st.mPct), background: st.color }} />
      {allowance.alertThresholds.map((t) => <span key={t} className="absolute -inset-y-0.5 w-px bg-fg/40" style={{ left: w(t) }} />)}
      <span className="absolute -inset-y-1 w-0.5 rounded bg-fg" style={{ left: w(100) }} title="Budget" />
    </div>
  );
}

/**
 * Month burn-down: cumulative actual spend (area) up to today, dashed forecast to month end,
 * flat budget line and threshold lines. Hover for daily values.
 */
export function BurnChart({ allowance, height = 220 }: { allowance: ProjectAllowance; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const daily = allowance.dailySpend ?? [];
  const days = allowance.daysInMonth ?? 30;
  const today = allowance.dayOfMonth ?? daily.length;
  const runRateDay = (allowance.monthlySpend ?? 0) / days;
  const budget = allowance.budgetMonthly;

  const data = useMemo(() => {
    const pts: { day: number; actual: number | null; forecast: number | null; daySpend: number }[] = [];
    let cum = 0;
    for (let d = 1; d <= days; d++) {
      if (d <= daily.length) { cum += daily[d - 1]; pts.push({ day: d, actual: cum, forecast: d === daily.length ? cum : null, daySpend: daily[d - 1] }) }
      else { cum += runRateDay; pts.push({ day: d, actual: null, forecast: cum, daySpend: runRateDay }) }
    }
    return pts;
  }, [daily, days, runRateDay]);

  const width = 640, padL = 46, padR = 10, padT = 12, padB = 22;
  const innerW = width - padL - padR, innerH = height - padT - padB;
  const peak = Math.max(budget * 1.1, ...data.map((p) => p.actual ?? p.forecast ?? 0)) || 1;
  const yMax = niceMax(peak);
  const x = (d: number) => padL + ((d - 1) / Math.max(1, days - 1)) * innerW;
  const y = (v: number) => padT + innerH - (v / yMax) * innerH;
  const actual = data.filter((p) => p.actual != null);
  const fc = data.filter((p) => p.forecast != null);
  const aPath = area<(typeof data)[number]>().x((p) => x(p.day)).y0(y(0)).y1((p) => y(p.actual!)).curve(curveMonotoneX)(actual) ?? '';
  const aLine = line<(typeof data)[number]>().x((p) => x(p.day)).y((p) => y(p.actual!)).curve(curveMonotoneX)(actual) ?? '';
  const fLine = line<(typeof data)[number]>().x((p) => x(p.day)).y((p) => y(p.forecast!)).curve(curveMonotoneX)(fc) ?? '';
  const st = budgetState(allowance);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const monthName = new Date().toLocaleDateString('en-GB', { month: 'short' });
  const crossDay = budget > 0 ? data.find((p) => (p.actual ?? p.forecast ?? 0) > budget)?.day : undefined;

  const onMove = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    setHover(Math.max(1, Math.min(days, Math.round(((px - padL) / innerW) * (days - 1)) + 1)));
  };
  const hp = hover ? data[hover - 1] : null;

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm" style={{ background: st.color }} />Actual (cumulative)</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 border-t-2 border-dashed" style={{ borderColor: st.color }} />Forecast</span>
        {budget > 0 && <span className="inline-flex items-center gap-1.5"><span className="w-3 border-t-2 border-fg" />Budget {money(budget)}</span>}
        {crossDay && <span className="text-rose-600 dark:text-rose-400">Crosses budget on {monthName} {crossDay}</span>}
      </div>
      <div ref={ref} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }}>
          <defs>
            <linearGradient id={`burn-${allowance.id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={st.color} stopOpacity={0.28} /><stop offset="1" stopColor={st.color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {ticks.map((t, i) => <line key={i} x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={i ? '3 4' : undefined} vectorEffect="non-scaling-stroke" />)}
          {budget > 0 && allowance.alertThresholds.filter((t) => t < 100).map((t) => (
            <line key={t} x1={padL} x2={width - padR} y1={y((budget * t) / 100)} y2={y((budget * t) / 100)} stroke="#f59e0b" strokeOpacity={0.5} strokeDasharray="1 4" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={aPath} fill={`url(#burn-${allowance.id})`} />
          <path d={aLine} fill="none" stroke={st.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <path d={fLine} fill="none" stroke={st.color} strokeWidth={2} strokeDasharray="5 4" strokeOpacity={0.8} vectorEffect="non-scaling-stroke" />
          {budget > 0 && <line x1={padL} x2={width - padR} y1={y(budget)} y2={y(budget)} stroke="var(--fg)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
          <line x1={x(today)} x2={x(today)} y1={padT} y2={padT + innerH} stroke="var(--line-strong)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          {hover && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} stroke="var(--muted)" vectorEffect="non-scaling-stroke" />}
        </svg>
        <div className="pointer-events-none absolute inset-0">
          {ticks.map((t, i) => <span key={i} className="absolute left-0 -translate-y-1/2 text-[10px] tabular text-faint" style={{ top: `${(y(t) / height) * 100}%` }}>{money(t, { decimals: false })}</span>)}
          {[1, Math.ceil(days / 4), Math.ceil(days / 2), Math.ceil((3 * days) / 4), days].map((d, i, arr) => (
            <span key={i} className={cn('absolute bottom-0 text-[10px] tabular text-faint', i === 0 ? '' : i === arr.length - 1 ? '-translate-x-full' : '-translate-x-1/2')} style={{ left: `${(x(d) / width) * 100}%` }}>{monthName} {d}</span>
          ))}
          <span className="absolute -translate-x-1/2 rounded bg-surface-2 px-1 text-[10px] text-muted" style={{ left: `${(x(today) / width) * 100}%`, top: 0 }}>today</span>
          {hp && (
            <span className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface" style={{ background: st.color, left: `${(x(hp.day) / width) * 100}%`, top: `${(y(hp.actual ?? hp.forecast ?? 0) / height) * 100}%` }} />
          )}
        </div>
        {hp && (
          <div className="pointer-events-none absolute top-0 z-10 min-w-40 rounded-lg border border-line bg-surface/95 px-2.5 py-2 text-xs shadow-pop backdrop-blur"
            style={{ left: `${(x(hp.day) / width) * 100}%`, transform: x(hp.day) > width * 0.6 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}>
            <div className="mb-1 text-[11px] text-muted">{monthName} {hp.day}{hp.actual == null ? ' · forecast' : hp.day === today ? ' · today (so far)' : ''}</div>
            <Row label={hp.actual == null ? 'Projected total' : 'Spent to date'} value={money(hp.actual ?? hp.forecast)} />
            <Row label="That day" value={money(hp.daySpend)} />
            {budget > 0 && <Row label="of budget" value={`${Math.round(((hp.actual ?? hp.forecast ?? 0) / budget) * 100)}%`} />}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-fg-2">{label}</span><span className="font-medium tabular text-fg">{value}</span></div>;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
