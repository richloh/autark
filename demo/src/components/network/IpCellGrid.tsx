import { useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { IpCell, Project } from '@/types';

const STATE_LABEL: Record<IpCell['state'], string> = {
  network: 'Network address', broadcast: 'Broadcast', reserved: 'Reserved (infrastructure)', free: 'Free', allocated: 'Allocated · unassigned', assigned: 'Assigned', foreign: 'In use by another tenant',
};

export const CELL_LEGEND: { state: IpCell['state'] | 'reservedAll'; label: string; cls: string }[] = [
  { state: 'free', label: 'Free', cls: 'bg-surface-3 ring-1 ring-inset ring-line' },
  { state: 'reservedAll', label: 'Reserved', cls: 'cell-reserved' },
  { state: 'allocated', label: 'Allocated (idle)', cls: 'bg-amber-400' },
  { state: 'assigned', label: 'Assigned', cls: 'bg-brand-500' },
  { state: 'foreign', label: 'Other tenant', cls: 'bg-slate-400 dark:bg-slate-600' },
];

const reservedStyle = { backgroundImage: 'repeating-linear-gradient(135deg, var(--line-strong) 0 2px, transparent 2px 5px)', backgroundColor: 'var(--surface-2)' };

/** Pool utilization as a cell grid: one cell per address (a /24 = 256 cells, 16 per row). */
export function IpCellGrid({ cells, projects, selected, onSelect, className, highlightProject }: {
  cells: IpCell[];
  projects: Map<string, Project>;
  selected?: string | null;
  onSelect?: (cell: IpCell) => void;
  className?: string;
  highlightProject?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ cell: IpCell; x: number; y: number } | null>(null);
  const cols = 16;
  return (
    <div className={cn('relative', className)} ref={wrap} onMouseLeave={() => setHover(null)}>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {cells.map((c) => {
          const reserved = c.state === 'network' || c.state === 'broadcast' || c.state === 'reserved';
          const proj = c.projectId ? projects.get(c.projectId) : undefined;
          const dim = highlightProject && c.projectId !== highlightProject && (c.state === 'assigned' || c.state === 'allocated');
          return (
            <button
              key={c.address}
              type="button"
              aria-label={`${c.address} ${STATE_LABEL[c.state]}`}
              onMouseEnter={(e) => { const r = wrap.current!.getBoundingClientRect(); const b = (e.currentTarget as HTMLElement).getBoundingClientRect(); setHover({ cell: c, x: b.left - r.left + b.width / 2, y: b.top - r.top }) }}
              onClick={() => onSelect?.(c)}
              disabled={reserved || c.state === 'foreign'}
              className={cn(
                'relative aspect-square min-w-0 rounded-[3px] transition-transform',
                !reserved && c.state !== 'foreign' && 'hover:z-10 hover:scale-125 hover:shadow-pop',
                c.state === 'free' && 'bg-surface-3 ring-1 ring-inset ring-line hover:bg-brand-500/25',
                c.state === 'allocated' && 'bg-amber-400',
                c.state === 'assigned' && 'bg-brand-500',
                c.state === 'foreign' && 'cursor-not-allowed bg-slate-400 dark:bg-slate-600',
                reserved && 'cursor-not-allowed',
                selected === c.address && 'z-10 scale-125 ring-2 ring-fg',
                dim && 'opacity-30',
              )}
              style={reserved ? reservedStyle : c.state === 'assigned' && proj ? { background: proj.color } : undefined}
            />
          );
        })}
      </div>
      {hover && (
        <div className="pointer-events-none absolute z-20 w-max max-w-64 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-pop" style={{ left: Math.max(90, Math.min(hover.x, (wrap.current?.clientWidth ?? 400) - 90)), top: hover.y - 6 }}>
          <div className="font-mono font-medium text-fg">{hover.cell.address}</div>
          <div className="text-muted">{STATE_LABEL[hover.cell.state]}{hover.cell.state === 'reserved' && hover.cell.name ? ` · ${hover.cell.name}` : ''}</div>
          {hover.cell.owner && <div className="text-fg-2">→ {hover.cell.owner.type.toUpperCase()} {hover.cell.owner.name ?? hover.cell.owner.id}</div>}
          {hover.cell.projectId && <div className="text-faint">{projects.get(hover.cell.projectId)?.name ?? hover.cell.projectId}</div>}
          {hover.cell.reverseDns && <div className="font-mono text-faint">PTR {hover.cell.reverseDns}</div>}
          {hover.cell.state === 'free' && onSelect && <div className="text-brand-500">Click to allocate</div>}
        </div>
      )}
    </div>
  );
}

export function CellLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted', className)}>
      {CELL_LEGEND.map((l) => (
        <span key={l.state} className="flex items-center gap-1.5">
          <span className={cn('size-2.5 rounded-[2px]', l.cls !== 'cell-reserved' && l.cls)} style={l.cls === 'cell-reserved' ? reservedStyle : undefined} />
          {l.label}
        </span>
      ))}
      <span className="text-faint">· assigned cells use the project color</span>
    </div>
  );
}
