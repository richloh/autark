import { useId, useMemo } from 'react';
import { landDots, makeProjection, type View } from '@/components/overview/geo';
import { cn } from '@/lib/cn';

export interface MiniMapMarker { lat: number; lon: number; label?: string; color?: string }

/**
 * Small dot-matrix map zoomed to a region around a coordinate, with a pin.
 * Reuses the land polygons / projection of the overview InfraMap.
 *
 * - `zoom`: 1 = whole world wide, 4 ≈ Europe, 8 ≈ a country (default 5).
 * - `aspect`: width / height of the drawing (default 2). The SVG fills its box (`slice`), so any CSS size works.
 * - `markers`: additional, secondary points (e.g. other locations) drawn as small dots.
 */
export function MiniMap({ lat, lon, label, zoom = 5, aspect = 2, className, markers = [], color = '#5b67f8' }: {
  lat: number; lon: number; label?: string; zoom?: number; aspect?: number; className?: string; markers?: MiniMapMarker[]; color?: string;
}) {
  const gid = useId().replace(/:/g, '');
  const width = 480;
  const view: View = useMemo(() => {
    const lonSpan = Math.max(4, Math.min(360, 240 / Math.max(0.5, zoom)));
    const k = Math.cos((Math.max(-60, Math.min(60, lat)) * Math.PI) / 180);
    const latSpan = (lonSpan * k) / aspect;
    // quantise the centre so the dot cache is reused across small coordinate differences
    const q = (n: number, s: number) => Math.round(n / s) * s;
    const cLon = q(lon, lonSpan / 40), cLat = q(lat, latSpan / 40);
    return { lon0: cLon - lonSpan / 2, lon1: cLon + lonSpan / 2, lat0: cLat - latSpan / 2, lat1: cLat + latSpan / 2 };
  }, [lat, lon, zoom, aspect]);
  const proj = useMemo(() => makeProjection(view, width), [view]);
  const spacingPx = 9;
  const dots = useMemo(() => landDots(proj, (spacingPx * (view.lon1 - view.lon0) * proj.k) / proj.width), [proj, view]);
  const x = proj.x(lon), y = proj.y(lat);
  const labelLeft = x > proj.width * 0.62;

  return (
    <div className={cn('relative overflow-hidden rounded-lg bg-surface-2/50', className)}>
      <svg viewBox={`0 0 ${proj.width} ${proj.height}`} preserveAspectRatio="xMidYMid slice" className="block size-full" role="img" aria-label={label ? `Map: ${label}` : 'Map'}>
        <defs>
          <radialGradient id={`mm-glow-${gid}`}>
            <stop offset="0" stopColor={color} stopOpacity="0.28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>
        <g fill="var(--map-land)">
          {dots.map(([dx, dy], i) => <circle key={i} cx={dx} cy={dy} r={2.4} />)}
        </g>
        <circle cx={x} cy={y} r={70} fill={`url(#mm-glow-${gid})`} />
        {markers.map((m, i) => (
          <g key={i} transform={`translate(${proj.x(m.lon)},${proj.y(m.lat)})`}>
            {m.label && <title>{m.label}</title>}
            <circle r={5} fill={m.color ?? 'var(--faint)'} stroke="var(--surface)" strokeWidth={2} />
          </g>
        ))}
        <g transform={`translate(${x},${y})`}>
          <circle r={9} fill="none" stroke={color} strokeWidth={2}>
            <animate attributeName="r" from="9" to="26" dur="2.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" from="0.8" to="0" dur="2.2s" repeatCount="indefinite" />
          </circle>
          <circle r={9} fill={color} stroke="var(--surface)" strokeWidth={3} />
          <circle r={3} fill="#fff" />
          {label && (
            <text x={labelLeft ? -16 : 16} dy="0.35em" textAnchor={labelLeft ? 'end' : 'start'} fontSize={12} fontWeight={600} fill="var(--fg)" stroke="var(--surface-2)" strokeWidth={3} paintOrder="stroke">
              {label}
            </text>
          )}
        </g>
      </svg>
    </div>
  );
}
