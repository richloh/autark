import { useId } from 'react';
import { area, line, curveMonotoneX } from 'd3-shape';

export function Sparkline({ data, width = 100, height = 28, color = '#5b67f8', fill = true, strokeWidth = 1.5, max }: { data: number[]; width?: number; height?: number; color?: string; fill?: boolean; strokeWidth?: number; max?: number }) {
  const id = useId();
  if (data.length < 2) return <svg width={width} height={height} />;
  const hi = max ?? Math.max(...data, 1);
  const lo = Math.min(0, ...data);
  const x = (i: number) => (i / (data.length - 1)) * width;
  const y = (v: number) => height - 2 - ((v - lo) / (hi - lo || 1)) * (height - 4);
  const l = line<number>().x((_, i) => x(i)).y(y).curve(curveMonotoneX)(data) ?? '';
  const a = area<number>().x((_, i) => x(i)).y0(height).y1(y).curve(curveMonotoneX)(data) ?? '';
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={a} fill={`url(#${id})`} />}
      <path d={l} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
