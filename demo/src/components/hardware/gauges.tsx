import { Link } from 'react-router';
import { cn } from '@/lib/cn';

/* Gauges and allocation visuals used on the host detail page. */

/** Semicircular sensor gauge with normal / warning / critical zones. */
export function Gauge({ value, min = 0, max, warn, crit, unit, label, size = 132, format = (v) => v.toFixed(0), off, className }: {
  value: number; min?: number; max: number; warn?: number; crit?: number; unit?: string; label: string; size?: number; format?: (v: number) => string; off?: boolean; className?: string;
}) {
  const stroke = 10;
  const r = (size - stroke) / 2 - 2;
  const cx = size / 2, cy = size / 2;
  const h = size / 2 + 18;
  const ang = (v: number) => Math.PI * (1 - (Math.min(max, Math.max(min, v)) - min) / (max - min));
  const pt = (a: number, rr = r) => [cx + rr * Math.cos(a), cy - rr * Math.sin(a)];
  const arc = (from: number, to: number, rr = r) => {
    const [x1, y1] = pt(ang(from), rr); const [x2, y2] = pt(ang(to), rr);
    const large = ang(from) - ang(to) > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${rr} ${rr} 0 ${large} 1 ${x2} ${y2}`;
  };
  const color = off ? 'var(--faint)' : crit != null && value >= crit ? '#f43f5e' : warn != null && value >= warn ? '#f59e0b' : '#10b981';
  const [nx, ny] = pt(ang(value), r - 14);
  return (
    <div className={cn('flex flex-col items-center', className)}>
      <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} className="overflow-visible">
        <path d={arc(min, max)} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} strokeLinecap="round" />
        {warn != null && <path d={arc(warn, crit ?? max, r + stroke / 2 + 3)} fill="none" stroke="#f59e0b" strokeOpacity={0.55} strokeWidth={2.5} />}
        {crit != null && <path d={arc(crit, max, r + stroke / 2 + 3)} fill="none" stroke="#f43f5e" strokeOpacity={0.7} strokeWidth={2.5} />}
        {!off && value > min && <path d={arc(min, value)} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" style={{ transition: 'all .6s ease' }} />}
        {!off && <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--fg-2)" strokeWidth={2} strokeLinecap="round" style={{ transition: 'all .6s ease' }} />}
        <circle cx={cx} cy={cy} r={3.5} fill="var(--fg-2)" />
        <text x={cx} y={cy + 17} textAnchor="middle" className="fill-fg text-[15px] font-semibold tabular">{off ? '—' : format(value)}<tspan className="fill-muted text-[10px] font-normal">{off ? '' : ` ${unit ?? ''}`}</tspan></text>
        <text x={stroke / 2} y={cy + 14} textAnchor="start" className="fill-faint text-[8.5px] tabular">{min}</text>
        <text x={size - stroke / 2} y={cy + 14} textAnchor="end" className="fill-faint text-[8.5px] tabular">{max}</text>
      </svg>
      <div className="-mt-0.5 text-xs font-medium text-muted">{label}</div>
    </div>
  );
}

export interface AllocSegment { id: string; label: string; value: number; color: string; link?: string; sub?: string }

/**
 * Stacked allocation bar: each VM is a segment, sized against schedulable capacity. A marker shows
 * the 1:1 physical line, so overcommit is visible at a glance.
 */
export function AllocationBar({ title, unit, capacity, physical, overcommit, segments, className }: {
  title: string; unit: string; capacity: number; physical: number; overcommit: number; segments: AllocSegment[]; className?: string;
}) {
  const used = segments.reduce((a, s) => a + s.value, 0);
  const basis = Math.max(capacity, used, 1);
  const physPct = Math.min(100, (physical / basis) * 100);
  const ratio = capacity ? used / capacity : 0;
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-fg">{title}</span>
        <span className="text-xs tabular text-muted"><span className={cn('font-semibold', ratio >= 0.95 ? 'text-rose-500' : ratio >= 0.8 ? 'text-amber-500' : 'text-fg')}>{used}</span> / {capacity} {unit} · {Math.round(ratio * 100)}%</span>
      </div>
      <div className="relative">
        <div className="flex h-7 w-full overflow-hidden rounded-lg bg-[repeating-linear-gradient(135deg,var(--surface-2)_0,var(--surface-2)_6px,var(--surface-3)_6px,var(--surface-3)_12px)] ring-1 ring-inset ring-line">
          {segments.map((s) => {
            const pct = (s.value / basis) * 100;
            const inner = (
              <span className="flex h-full items-center overflow-hidden px-1.5 text-[10.5px] font-medium text-white" style={{ background: s.color }}>
                {pct > 9 && <span className="truncate drop-shadow-sm">{s.label}</span>}
              </span>
            );
            return s.link
              ? <Link key={s.id} to={s.link} title={`${s.label}: ${s.value} ${unit}${s.sub ? ` · ${s.sub}` : ''}`} className="h-full border-r border-black/20 transition-[filter] hover:brightness-110" style={{ width: `${pct}%` }}>{inner}</Link>
              : <span key={s.id} title={`${s.label}: ${s.value} ${unit}${s.sub ? ` · ${s.sub}` : ''}`} className="h-full border-r border-black/20" style={{ width: `${pct}%` }}>{inner}</span>;
          })}
        </div>
        {overcommit > 1 && physPct < 100 && (
          <div className="pointer-events-none absolute -bottom-1 -top-1 border-l-2 border-dashed border-fg-2" style={{ left: `${physPct}%` }}>
            <span className="absolute -top-4 left-1 whitespace-nowrap text-[10px] font-medium text-fg-2">1:1 physical</span>
          </div>
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted">
        <span>{overcommit > 1 ? `${physical} ${unit} physical · ${overcommit}× overcommit` : `${unit === 'GB' ? '8% reserved for hypervisor' : 'no overcommit'}`}</span>
        <span className="tabular">{Math.max(0, capacity - used)} {unit} free</span>
      </div>
    </div>
  );
}
