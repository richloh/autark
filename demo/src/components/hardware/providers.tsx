import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { flag } from './visuals';
import type { ProviderKind, ProviderRegion } from '@/types';

/* Provider branding badges and a dot-matrix region map (no external assets). */

export const PROVIDER_STYLE: Record<ProviderKind, { bg: string; fg: string; mono: string; label: string }> = {
  hetzner: { bg: '#d50c2d', fg: '#fff', mono: 'H', label: 'Hetzner' },
  aws: { bg: '#232f3e', fg: '#ff9900', mono: 'aws', label: 'AWS' },
  ovh: { bg: '#0050d7', fg: '#fff', mono: 'OVH', label: 'OVHcloud' },
  scaleway: { bg: '#4f0599', fg: '#fff', mono: 'SCW', label: 'Scaleway' },
  ionos: { bg: '#003d8f', fg: '#fff', mono: 'IONOS', label: 'IONOS' },
  openstack: { bg: '#ed1944', fg: '#fff', mono: 'OS', label: 'OpenStack' },
};

export function ProviderLogo({ kind, size = 40, className }: { kind: ProviderKind; size?: number; className?: string }) {
  const s = PROVIDER_STYLE[kind] ?? { bg: '#64748b', fg: '#fff', mono: '?', label: kind };
  const fs = s.mono.length >= 5 ? size * 0.22 : s.mono.length >= 3 ? size * 0.3 : size * 0.48;
  return (
    <span
      aria-label={s.label}
      className={cn('relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-xl font-bold tracking-tight shadow-card ring-1 ring-black/10', className)}
      style={{ width: size, height: size, background: `linear-gradient(145deg, ${s.bg}, ${s.bg}d0)`, color: s.fg, fontSize: fs }}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-white/10" />
      <span className="relative">{s.mono}</span>
      {kind === 'aws' && <span className="absolute bottom-[22%] left-1/2 h-[2px] w-[46%] -translate-x-1/2 rounded-full" style={{ background: s.fg, borderRadius: '0 0 50% 50%' }} />}
    </span>
  );
}

/* ------------------------------------------------------------------ dot-matrix world map */

type Poly = [number, number][];
// Very coarse continent outlines (lon, lat). Good enough for a stylised dot-matrix map.
const LAND: Poly[] = [
  // North America
  [[-168, 66], [-162, 70], [-140, 70], [-125, 71], [-95, 72], [-80, 73], [-62, 66], [-55, 52], [-66, 45], [-70, 42], [-76, 35], [-81, 31], [-80, 25], [-82, 28], [-84, 30], [-90, 29], [-97, 27], [-97, 22], [-92, 18], [-88, 21], [-87, 16], [-83, 10], [-79, 9], [-80, 7], [-85, 11], [-92, 14], [-105, 20], [-112, 30], [-117, 32], [-121, 35], [-124, 40], [-124, 48], [-130, 54], [-140, 59], [-152, 58], [-165, 54], [-158, 58], [-165, 62]],
  // Canadian arctic archipelago
  [[-122, 70], [-80, 70], [-68, 77], [-90, 81], [-120, 77]],
  // Greenland
  [[-73, 78], [-60, 82], [-30, 83], [-20, 75], [-22, 70], [-40, 65], [-44, 60], [-50, 62], [-55, 68], [-60, 75]],
  // South America
  [[-80, 8], [-72, 12], [-62, 11], [-52, 5], [-50, 0], [-35, -5], [-35, -10], [-39, -15], [-41, -22], [-48, -26], [-53, -34], [-58, -38], [-63, -41], [-65, -46], [-68, -52], [-72, -54], [-75, -48], [-73, -38], [-71, -30], [-70, -18], [-76, -14], [-81, -6], [-80, 0], [-77, 4]],
  // Eurasia
  [[-10, 36], [-9, 43], [-2, 44], [-5, 48], [2, 51], [8, 54], [8, 57], [5, 58], [5, 62], [14, 68], [20, 70], [28, 71], [40, 67], [60, 69], [70, 73], [80, 73], [100, 77], [115, 74], [140, 72], [160, 70], [180, 68], [180, 65], [178, 62], [163, 60], [156, 57], [155, 51], [142, 53], [141, 47], [135, 43], [129, 41], [127, 35], [126, 37], [121, 40], [122, 37], [119, 35], [121, 31], [122, 29], [117, 24], [110, 21], [108, 21], [106, 17], [109, 12], [105, 9], [103, 11], [100, 13], [100, 8], [103, 1.5], [98, 8], [98, 16], [94, 17], [92, 22], [88, 22], [86, 20], [80, 15], [80, 10], [77, 8], [73, 16], [72, 21], [67, 25], [58, 25], [57, 23], [59, 22], [52, 17], [44, 13], [43, 16], [35, 28], [33, 30], [32, 31], [35, 33], [36, 36], [30, 36], [27, 37], [26, 40], [22, 37], [19, 42], [13, 46], [12, 44], [16, 40], [16, 38], [12, 41], [10, 44], [3, 43], [3, 42], [0, 39], [-2, 37], [-6, 36]],
  // Africa
  [[-17, 21], [-16, 28], [-10, 30], [-6, 36], [0, 36], [10, 37], [11, 33], [20, 31], [25, 32], [32, 31], [35, 28], [37, 20], [43, 12], [51, 12], [50, 8], [42, -1], [40, -10], [40, -16], [35, -24], [32, -29], [27, -34], [20, -35], [18, -32], [15, -27], [12, -18], [13, -10], [9, -1], [10, 3], [6, 4], [-4, 5], [-8, 4], [-13, 8], [-17, 14]],
  // UK, Ireland, Iceland
  [[-6, 50], [2, 51], [1, 53], [-2, 56], [-2, 58.5], [-5, 58.5], [-6, 56], [-5, 54], [-3, 54], [-5, 52]],
  [[-10, 51.5], [-6, 52], [-6, 55], [-8, 55.3], [-10, 54]],
  [[-24, 63.5], [-14, 64], [-14, 66.5], [-22, 66.5]],
  // Japan
  [[130, 31], [135, 34], [140, 35], [141, 38], [142, 42], [145, 44], [141, 45.5], [140, 41], [136, 37], [131, 34]],
  // SE Asia islands
  [[109, 2], [117, 7], [119, 1], [116, -4], [110, -3]],
  [[95, 5.5], [98, 4], [106, -6], [101, -3]],
  [[105, -6], [114, -7], [114, -8.5], [105, -7]],
  [[131, -1], [141, -2], [150, -6], [147, -10], [141, -9], [137, -5]],
  [[120, 18.5], [122, 18.5], [126, 7], [122, 7]],
  // Australia, NZ, Madagascar
  [[114, -22], [122, -18], [130, -12], [137, -12], [136, -15], [141, -12], [143, -11], [146, -19], [153, -25], [153, -29], [150, -37], [141, -38], [138, -35], [132, -32], [124, -34], [115, -34], [113, -26]],
  [[172, -34], [178, -38], [175, -41], [171, -46], [167, -46], [172, -41]],
  [[44, -25], [47, -25], [50, -15], [49, -12], [44, -17]],
];

function inPoly(x: number, y: number, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const STEP = 2;
const LAT_TOP = 82, LAT_BOTTOM = -56;
let dotsCache: [number, number][] | null = null;
function landDots(): [number, number][] {
  if (dotsCache) return dotsCache;
  const out: [number, number][] = [];
  for (let lat = LAT_TOP - STEP / 2; lat > LAT_BOTTOM; lat -= STEP) {
    for (let lon = -180 + STEP / 2; lon < 180; lon += STEP) {
      if (LAND.some((p) => inPoly(lon, lat, p))) out.push([lon, lat]);
    }
  }
  dotsCache = out;
  return out;
}

const X = (lon: number) => lon + 180;
const Y = (lat: number) => LAT_TOP - lat;

export interface MapRegion extends ProviderRegion { selected?: boolean; badge?: string | number }

/**
 * Stylised dot-matrix world map with region markers. Auto-zooms to fit the given regions.
 * Click a marker to toggle it (when `onToggle` is set).
 */
export function RegionMap({ regions, onToggle, color = '#5b67f8', height = 220, className, extra = [] }: {
  regions: MapRegion[]; onToggle?: (code: string) => void; color?: string; height?: number; className?: string;
  /** additional fixed markers (e.g. your own data centers) */
  extra?: { id: string; label: string; lat: number; lon: number; color: string }[];
}) {
  const [hover, setHover] = useState<string | null>(null);
  const dots = useMemo(landDots, []);
  const pts = [...regions.map((r) => [r.lon, r.lat]), ...extra.map((e) => [e.lon, e.lat])];
  const vb = useMemo(() => {
    if (!pts.length) return { x: 0, y: 0, w: 360, h: LAT_TOP - LAT_BOTTOM };
    const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    let x0 = Math.min(...lons) - 14, x1 = Math.max(...lons) + 14;
    let y0 = Math.max(...lats) + 9, y1 = Math.min(...lats) - 9;
    // enforce minimum span & aspect ~ 2.4:1
    const minW = 60;
    if (x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = c - minW / 2; x1 = c + minW / 2 }
    let w = x1 - x0, hh = y0 - y1;
    const aspect = 2.4;
    if (w / hh > aspect) { const c = (y0 + y1) / 2; hh = w / aspect; y0 = c + hh / 2; y1 = c - hh / 2 }
    else { const c = (x0 + x1) / 2; w = hh * aspect; x0 = c - w / 2; x1 = c + w / 2 }
    x0 = Math.max(-180, x0); x1 = Math.min(180, x1); y0 = Math.min(LAT_TOP, y0); y1 = Math.max(LAT_BOTTOM, y1);
    return { x: X(x0), y: Y(y0), w: x1 - x0, h: y0 - y1 };
  }, [pts.map((p) => p.join(',')).join(';')]); // eslint-disable-line react-hooks/exhaustive-deps
  const unit = vb.w / 100;
  const dotPath = useMemo(() => dots.map(([lon, lat]) => `M${X(lon) - STEP * 0.3} ${Y(lat) - STEP * 0.3}h${STEP * 0.6}v${STEP * 0.6}h${-STEP * 0.6}z`).join(''), [dots]);
  const hovered = regions.find((r) => r.code === hover);

  return (
    <div className={cn('relative w-full overflow-hidden rounded-xl border border-line bg-surface-2', className)} style={{ height }}>
      <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" className="size-full">
        <path d={dotPath} className="fill-line-strong" />
        {extra.map((e) => (
          <g key={e.id} transform={`translate(${X(e.lon)} ${Y(e.lat)})`}>
            <rect x={-unit * 0.9} y={-unit * 0.9} width={unit * 1.8} height={unit * 1.8} rx={unit * 0.3} fill={e.color} stroke="var(--surface)" strokeWidth={unit * 0.3} />
            <text x={unit * 1.6} y={unit * 0.6} fontSize={unit * 2} className="fill-fg-2 font-medium">{e.label}</text>
          </g>
        ))}
        {regions.map((r) => {
          const sel = r.selected;
          return (
            <g key={r.code} transform={`translate(${X(r.lon)} ${Y(r.lat)})`} className={onToggle ? 'cursor-pointer' : undefined}
              onClick={() => onToggle?.(r.code)} onMouseEnter={() => setHover(r.code)} onMouseLeave={() => setHover(null)}>
              {sel && <circle r={unit * 2.6} fill={color} opacity={0.18}><animate attributeName="r" values={`${unit * 1.4};${unit * 3.2};${unit * 1.4}`} dur="2.4s" repeatCount="indefinite" /></circle>}
              <circle r={unit * (sel ? 1.25 : 0.95)} fill={sel ? color : 'var(--surface)'} stroke={sel ? 'var(--surface)' : 'var(--muted)'} strokeWidth={unit * 0.35} />
              <circle r={unit * 3} fill="transparent" />
              {(sel || hover === r.code) && <text x={unit * 1.8} y={-unit * 1.1} fontSize={unit * 2.1} className="pointer-events-none fill-fg font-semibold" paintOrder="stroke" stroke="var(--surface-2)" strokeWidth={unit * 0.6}>{r.code}{r.badge != null ? ` · ${r.badge}` : ''}</text>}
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg border border-line bg-surface/95 px-2.5 py-1.5 text-xs shadow-card backdrop-blur">
          <span className="mr-1">{flag(hovered.country)}</span><span className="font-medium text-fg">{hovered.name}</span> <span className="text-muted">· {hovered.code}{onToggle ? ` · click to ${hovered.selected ? 'disable' : 'enable'}` : ''}</span>
        </div>
      )}
    </div>
  );
}
