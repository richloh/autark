import { useMemo, useRef, useState } from 'react';
import { Globe2, Lock, MousePointerClick, Sparkles } from 'lucide-react';
import { parseCidr, intToIp, cidrOverlaps, nextFreeSubnet } from '@/lib/cidr';
import { cn } from '@/lib/cn';
import { num } from '@/lib/format';
import { subnetColor, cidrRange } from './util';

export interface AddressBlock { id: string; name: string; cidr: string; public?: boolean; color?: string; usedIps?: number; capacity?: number; invalid?: boolean }

const CW = 30; // cell width
const CH = 20; // cell height
const GAP = 2;
const LABEL_W = 78;

interface Placed { block: AddressBlock; color: string; x: number; y: number; w: number; h: number }

/** Find a good subnet suggestion containing `addr`: try `pref` first, then smaller blocks. */
export function suggestAt(vpc: string, taken: string[], addr: number, pref: number, minPrefix: number): string | null {
  const v = parseCidr(vpc);
  if (!v) return null;
  for (let p = Math.max(pref, v.prefix); p <= Math.max(minPrefix, pref); p++) {
    const size = 2 ** (32 - p);
    const base = Math.floor((addr - v.first) / size) * size + v.first;
    const cand = `${intToIp(base)}/${p}`;
    if (!taken.some((t) => cidrOverlaps(t, cand))) return cand;
  }
  return null;
}

/**
 * Address-space visualizer: the VPC range as a 16-column grid of equal blocks (256 cells, each cell is
 * 1/256 of the range — a /24 in a /16 VPC). Subnets are drawn as colored rectangles (power-of-two
 * aligned blocks always form one rectangle), free cells are clickable to create a subnet there.
 */
export function AddressSpace({ cidr, blocks, preview, selectedId, onSelect, onGapClick, preferredPrefix = 24, className, showLegend = true, showLabels = true }: {
  cidr: string;
  blocks: AddressBlock[];
  preview?: string | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onGapClick?: (suggestion: string) => void;
  preferredPrefix?: number;
  className?: string;
  showLegend?: boolean;
  showLabels?: boolean;
}) {
  const vpc = parseCidr(cidr);
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; title: string; lines: string[] } | null>(null);
  const [hoverCell, setHoverCell] = useState<number | null>(null);

  const geo = useMemo(() => {
    if (!vpc) return null;
    const cellPrefix = Math.min(32, vpc.prefix + 8);
    const cells = 2 ** (cellPrefix - vpc.prefix);
    const cols = Math.min(16, cells);
    const rows = Math.ceil(cells / cols);
    const cellSize = 2 ** (32 - cellPrefix);
    return { cellPrefix, cells, cols, rows, cellSize };
  }, [vpc?.network, vpc?.prefix]); // eslint-disable-line

  const placed = useMemo<Placed[]>(() => {
    if (!vpc || !geo) return [];
    const out: Placed[] = [];
    blocks.forEach((b, i) => {
      const p = parseCidr(b.cidr);
      if (!p || p.first < vpc.first || p.last > vpc.last) return;
      const color = b.color ?? subnetColor(i);
      const off = p.first - vpc.first;
      const startCell = Math.floor(off / geo.cellSize);
      const col = startCell % geo.cols;
      const row = Math.floor(startCell / geo.cols);
      if (p.size >= geo.cellSize) {
        const n = p.size / geo.cellSize;
        if (n <= geo.cols) out.push({ block: b, color, x: LABEL_W + col * (CW + GAP), y: row * (CH + GAP), w: n * (CW + GAP) - GAP, h: CH });
        else { const nr = n / geo.cols; out.push({ block: b, color, x: LABEL_W, y: row * (CH + GAP), w: geo.cols * (CW + GAP) - GAP, h: nr * (CH + GAP) - GAP }) }
      } else {
        const frac = (off % geo.cellSize) / geo.cellSize;
        out.push({ block: b, color, x: LABEL_W + col * (CW + GAP) + frac * CW, y: row * (CH + GAP), w: Math.max(2, (p.size / geo.cellSize) * CW), h: CH });
      }
    });
    return out;
  }, [blocks, vpc?.network, vpc?.prefix, geo]); // eslint-disable-line

  if (!vpc || !geo) {
    return <div className={cn('flex h-32 items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted', className)}>Enter a valid CIDR to see the address space</div>;
  }

  const taken = blocks.filter((b) => !b.invalid).map((b) => b.cidr);
  const cellStart = (i: number) => vpc.first + i * geo.cellSize;
  const cellFree = (i: number) => { const c = `${intToIp(cellStart(i))}/${geo.cellPrefix}`; return !taken.some((t) => cidrOverlaps(t, c)) };
  const freeCount = Array.from({ length: geo.cells }, (_, i) => i).filter(cellFree).length;
  const used = blocks.reduce((a, b) => a + (parseCidr(b.cidr)?.size ?? 0), 0);
  const hoverSuggestion = hoverCell != null && onGapClick ? suggestAt(cidr, taken, cellStart(hoverCell), preferredPrefix, geo.cellPrefix) : null;
  const pv = preview ? parseCidr(preview) : null;
  const width = LABEL_W + geo.cols * (CW + GAP) - GAP;
  const height = geo.rows * (CH + GAP) - GAP;

  const rectOf = (c: string) => {
    const p = parseCidr(c);
    if (!p || p.first < vpc.first || p.last > vpc.last) return null;
    const off = p.first - vpc.first;
    const startCell = Math.floor(off / geo.cellSize);
    const col = startCell % geo.cols; const row = Math.floor(startCell / geo.cols);
    if (p.size >= geo.cellSize) {
      const n = p.size / geo.cellSize;
      return n <= geo.cols ? { x: LABEL_W + col * (CW + GAP), y: row * (CH + GAP), w: n * (CW + GAP) - GAP, h: CH } : { x: LABEL_W, y: row * (CH + GAP), w: geo.cols * (CW + GAP) - GAP, h: (n / geo.cols) * (CH + GAP) - GAP };
    }
    return { x: LABEL_W + col * (CW + GAP) + ((off % geo.cellSize) / geo.cellSize) * CW, y: row * (CH + GAP), w: Math.max(3, (p.size / geo.cellSize) * CW), h: CH };
  };
  const previewRect = pv && preview ? rectOf(preview) : null;
  const hoverRect = hoverSuggestion ? rectOf(hoverSuggestion) : null;

  const tip = (e: React.MouseEvent, title: string, lines: string[]) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    setHover({ x: e.clientX - r.left, y: e.clientY - r.top, title, lines });
  };

  return (
    <div className={cn('min-w-0', className)}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span><span className="font-medium text-fg-2">{cidr}</span> · {num(vpc.size)} addresses · each cell = /{geo.cellPrefix} ({num(geo.cellSize)})</span>
        <span className="tabular">{Math.round((used / vpc.size) * 100)}% allocated · {freeCount} free cell{freeCount === 1 ? '' : 's'}</span>
      </div>
      <div ref={wrap} className="relative" onMouseLeave={() => { setHover(null); setHoverCell(null) }}>
        <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full select-none" role="img" aria-label={`Address space of ${cidr}`}>
          {showLabels && Array.from({ length: geo.rows }, (_, r) => (
            <text key={r} x={LABEL_W - 8} y={r * (CH + GAP) + CH / 2 + 3.5} textAnchor="end" fill="var(--faint)" className="font-mono" fontSize={9.5}>{intToIp(cellStart(r * geo.cols))}</text>
          ))}
          {Array.from({ length: geo.cells }, (_, i) => {
            const free = cellFree(i);
            const x = LABEL_W + (i % geo.cols) * (CW + GAP);
            const y = Math.floor(i / geo.cols) * (CH + GAP);
            return (
              <rect key={i} x={x} y={y} width={CW} height={CH} rx={3}
                fill={free ? 'var(--surface-2)' : 'var(--surface-3)'} stroke={hoverCell === i ? 'var(--color-brand-500)' : 'var(--line)'} strokeWidth={hoverCell === i ? 1.5 : 1}
                strokeDasharray={free ? '3 2' : undefined}
                className={cn(free && onGapClick && 'cursor-pointer')}
                onMouseEnter={(e) => { if (free) { setHoverCell(i); tip(e, 'Free space', [`${intToIp(cellStart(i))}/${geo.cellPrefix}`, ...(onGapClick ? ['Click to create a subnet here'] : [])]) } else setHoverCell(null) }}
                onMouseMove={(e) => free && hover && tip(e, hover.title, hover.lines)}
                onClick={() => { if (free && onGapClick) { const s = suggestAt(cidr, taken, cellStart(i), preferredPrefix, geo.cellPrefix); if (s) onGapClick(s) } }}
              />
            );
          })}
          {placed.map((p) => {
            const sel = selectedId === p.block.id;
            const chars = Math.floor((p.w - 10) / 5.6);
            const util = p.block.capacity ? Math.min(1, (p.block.usedIps ?? 0) / p.block.capacity) : null;
            return (
              <g key={p.block.id} className={cn(onSelect && 'cursor-pointer')} onClick={() => onSelect?.(p.block.id)}
                onMouseEnter={(e) => { setHoverCell(null); tip(e, p.block.name || '(unnamed)', [p.block.cidr, cidrRange(p.block.cidr), `${num(parseCidr(p.block.cidr)?.size ?? 0)} addresses · ${p.block.public ? 'public' : 'private'}`, ...(p.block.capacity ? [`${p.block.usedIps ?? 0} / ${p.block.capacity} hosts in use`] : []), ...(p.block.invalid ? ['⚠ invalid'] : [])]) }}
                onMouseMove={(e) => hover && tip(e, hover.title, hover.lines)}
              >
                <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={4} fill={p.color} fillOpacity={p.block.invalid ? 0.25 : sel ? 1 : 0.85}
                  stroke={p.block.invalid ? '#f43f5e' : sel ? 'var(--fg)' : p.color} strokeWidth={sel ? 2 : 1} strokeDasharray={p.block.invalid ? '4 2' : undefined} />
                {util != null && p.w > 24 && <rect x={p.x + 3} y={p.y + p.h - 4} width={(p.w - 6) * util} height={2} rx={1} fill="white" fillOpacity={0.85} />}
                {chars >= 4 && (
                  <text x={p.x + 6} y={p.y + (p.h > CH ? 15 : p.h / 2 + 3.5)} fontSize={10.5} fontWeight={600} fill="white" className="pointer-events-none">
                    {(p.block.name || p.block.cidr).slice(0, chars)}{(p.block.name || p.block.cidr).length > chars ? '…' : ''}
                  </text>
                )}
                {p.h > CH && chars >= 10 && <text x={p.x + 6} y={p.y + 29} fontSize={9.5} fill="white" fillOpacity={0.85} className="pointer-events-none font-mono">{p.block.cidr}</text>}
              </g>
            );
          })}
          {hoverRect && <rect x={hoverRect.x - 1} y={hoverRect.y - 1} width={hoverRect.w + 2} height={hoverRect.h + 2} rx={4} fill="var(--color-brand-500)" fillOpacity={0.12} stroke="var(--color-brand-500)" strokeWidth={1.5} strokeDasharray="4 3" className="pointer-events-none" />}
          {previewRect && <rect x={previewRect.x - 1} y={previewRect.y - 1} width={previewRect.w + 2} height={previewRect.h + 2} rx={4} fill="var(--color-brand-500)" fillOpacity={0.22} stroke="var(--color-brand-500)" strokeWidth={2} className="pointer-events-none animate-pulse-soft" />}
        </svg>
        {hover && (
          <div className="pointer-events-none absolute z-10 max-w-60 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-pop" style={{ left: Math.min(hover.x + 12, (wrap.current?.clientWidth ?? 300) - 200), top: hover.y + 14 }}>
            <div className="font-medium text-fg">{hover.title}</div>
            {hover.lines.map((l, i) => <div key={i} className={cn(i === 0 ? 'font-mono text-fg-2' : 'text-muted')}>{l}</div>)}
            {hoverSuggestion && hover.title === 'Free space' && <div className="mt-0.5 flex items-center gap-1 text-brand-500"><Sparkles className="size-3" /> suggests {hoverSuggestion}</div>}
          </div>
        )}
      </div>
      {showLegend && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          {blocks.map((b, i) => (
            <button key={b.id} type="button" onClick={() => onSelect?.(b.id)} className={cn('flex items-center gap-1.5 rounded-md px-1 py-0.5 text-fg-2 hover:bg-surface-2', selectedId === b.id && 'bg-surface-2 text-fg')}>
              <span className="size-2.5 rounded-sm" style={{ background: b.color ?? subnetColor(i) }} />
              <span className="font-medium">{b.name || 'unnamed'}</span>
              <span className="font-mono text-muted">{b.cidr}</span>
              {b.public ? <Globe2 className="size-3 text-emerald-500" /> : <Lock className="size-3 text-faint" />}
            </button>
          ))}
          {onGapClick && freeCount > 0 && <span className="flex items-center gap-1 text-muted"><MousePointerClick className="size-3" /> click a dashed cell to add a subnet</span>}
        </div>
      )}
    </div>
  );
}

/** Next suggested subnet for a VPC (first free /pref, falling back to smaller sizes). */
export function nextSuggestion(vpc: string, taken: string[], pref = 24): string | null {
  const v = parseCidr(vpc);
  if (!v) return null;
  for (let p = Math.max(pref, v.prefix); p <= 28; p++) {
    const s = nextFreeSubnet(vpc, taken, p);
    if (s) return s;
  }
  return null;
}
