import { useState } from 'react';
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import { useNavigate } from 'react-router';
import { cn } from '@/lib/cn';

export interface TreeItem { id: string; label: string; value: number; color: string; group?: string; link?: string; sub?: string }

/** Squarified treemap — great for "where does the money/capacity go". */
export function Treemap({ items, height = 260, className, format = (v) => String(v) }: { items: TreeItem[]; height?: number; className?: string; format?: (v: number) => string }) {
  const navigate = useNavigate();
  const [hover, setHover] = useState<string | null>(null);
  const width = 1000;
  const root = hierarchy<{ children?: TreeItem[] } | TreeItem>({ children: items.filter((i) => i.value > 0) } as any)
    .sum((d: any) => d.value ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  treemap<any>().tile(treemapSquarify.ratio(1.4)).size([width, height]).paddingInner(3).round(true)(root);
  const leaves = root.leaves() as any[];
  const total = root.value ?? 0;
  return (
    <div className={cn('relative w-full overflow-hidden rounded-lg', className)} style={{ height }}>
      {leaves.map((l) => {
        const d = l.data as TreeItem;
        const w = l.x1 - l.x0, h = l.y1 - l.y0;
        const small = w < 90 || h < 44;
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => d.link && navigate(d.link)}
            onMouseEnter={() => setHover(d.id)}
            onMouseLeave={() => setHover(null)}
            title={`${d.label}: ${format(d.value)}`}
            className={cn('absolute overflow-hidden rounded-md p-2 text-left transition-all', d.link && 'cursor-pointer', hover && hover !== d.id && 'opacity-60')}
            style={{ left: `${(l.x0 / width) * 100}%`, top: l.y0, width: `${(w / width) * 100}%`, height: h, background: `linear-gradient(135deg, ${d.color}f0, ${d.color}b8)` }}
          >
            {!small && (
              <>
                <div className="truncate text-[12px] font-semibold text-white drop-shadow-sm">{d.label}</div>
                <div className="truncate text-[11px] tabular text-white/85">{format(d.value)} · {total ? Math.round((d.value / total) * 100) : 0}%</div>
                {d.sub && h > 64 && <div className="mt-0.5 truncate text-[10px] text-white/70">{d.sub}</div>}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
