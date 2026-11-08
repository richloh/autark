import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Sparkline } from '../charts/Sparkline';

/** KPI tile with optional sparkline and delta. */
export function Stat({ label, value, sub, icon: Icon, delta, deltaGoodWhen = 'up', spark, sparkColor, to, className, accent }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: LucideIcon; delta?: number; deltaGoodWhen?: 'up' | 'down'; spark?: number[]; sparkColor?: string; to?: string; className?: string; accent?: string;
}) {
  const good = delta == null ? null : deltaGoodWhen === 'up' ? delta >= 0 : delta <= 0;
  const body = (
    <div className={cn('@container group relative h-full overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-card transition-all', to && 'hover:border-line-strong hover:shadow-pop', className)}>
      {accent && <div className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full opacity-[0.12] blur-2xl" style={{ background: accent }} />}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        {Icon && <Icon className="size-4 text-faint transition-colors group-hover:text-brand-500" />}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xl font-semibold tracking-tight tabular text-fg @min-[11rem]:text-2xl">{value}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted">
            {delta != null && (
              <span className={cn('inline-flex items-center gap-0.5 font-medium', good ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                {delta >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                {Math.abs(delta).toFixed(1)}%
              </span>
            )}
            {sub}
          </div>
        </div>
        {spark && spark.length > 1 && <div className="hidden shrink-0 @min-[13rem]:block"><Sparkline data={spark} width={84} height={32} color={sparkColor} /></div>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}
