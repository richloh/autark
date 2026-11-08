import { useState } from 'react';
import { useMetrics } from '@/api/hooks';
import { Card } from '../ui/Card';
import { Segmented } from '../ui/Tabs';
import { Skeleton } from '../ui/misc';
import { AreaChart, chartColor } from './AreaChart';
import { cn } from '@/lib/cn';

export interface MetricDef {
  /** chart title */
  title: string;
  /** metric ids rendered as series in this chart */
  metrics: string[];
  labels?: string[];
  colors?: string[];
  unit?: string;
  max?: number;
  format?: (v: number) => string;
}

export const RANGE_OPTIONS = [
  { value: '15m', label: '15m' }, { value: '1h', label: '1h' }, { value: '6h', label: '6h' }, { value: '24h', label: '24h' }, { value: '7d', label: '7d' }, { value: '30d', label: '30d' },
];

/** Grid of live metric charts for a resource (`collection` + `id`). */
export function MetricsPanel({ collection, id, charts, cols = 2, defaultRange = '1h', className, live = true }: { collection: string; id: string; charts: MetricDef[]; cols?: 1 | 2 | 3; defaultRange?: string; className?: string; live?: boolean }) {
  const [range, setRange] = useState(defaultRange);
  const all = [...new Set(charts.flatMap((c) => c.metrics))];
  const { data, isLoading } = useMetrics(collection, id, all, range);
  return (
    <div className={className}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted">
          {live && <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-emerald-500" /></span>}
          {live ? 'Live' : 'Metrics'} · auto-refresh
        </div>
        <Segmented size="sm" options={RANGE_OPTIONS} value={range} onChange={setRange} />
      </div>
      <div className={cn('grid gap-3', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 @min-[44rem]:grid-cols-2' : 'grid-cols-1 @min-[40rem]:grid-cols-2 @min-[60rem]:grid-cols-3')}>
        {charts.map((c) => {
          const series = c.metrics.map((m, i) => ({ id: m, label: c.labels?.[i] ?? m, color: c.colors?.[i] ?? chartColor(i), points: data?.series?.[m]?.points ?? [] }));
          const last = series[0]?.points.at(-1)?.v;
          const unit = c.unit ?? data?.series?.[c.metrics[0]]?.unit ?? '';
          return (
            <Card key={c.title} className="p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-medium text-fg-2">{c.title}</span>
                {last != null && <span className="text-sm font-semibold tabular text-fg">{c.format ? c.format(last) : `${last.toFixed(last < 10 ? 1 : 0)} ${unit}`}</span>}
              </div>
              {isLoading && !data ? <Skeleton className="h-[150px]" /> : <AreaChart series={series} height={150} unit={unit} max={c.max} format={c.format} />}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
