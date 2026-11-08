import { useState, type ReactNode } from 'react';
import { Receipt, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';
import { HOURS_PER_MONTH, type CostBreakdown } from '@/lib/pricing';
import { Segmented } from '../ui/Tabs';
import { useList, useGet } from '@/api/hooks';
import type { ProjectAllowance } from '@/types';
import { usePro } from '@/store/ui';

/**
 * Sticky live cost estimate for create/edit forms. Shows the breakdown and, when a project is
 * known, the impact on the project's monthly budget.
 */
export function CostPanel({ cost, projectId, children, className, title = 'Estimated cost', footer, quantity = 1 }: {
  cost: CostBreakdown; projectId?: string; children?: ReactNode; className?: string; title?: string; footer?: ReactNode; quantity?: number;
}) {
  const [unit, setUnit] = useState<'month' | 'hour'>('month');
  const pro = usePro();
  const { items: allowances } = useList<ProjectAllowance>('allowances');
  const allowance = allowances.find((a) => a.projectId === projectId);
  const { data: summary } = useGet<{ byProject: { projectId: string; monthly: number }[] }>(['costs'], '/costs/summary');
  const current = summary?.byProject?.find((p) => p.projectId === projectId)?.monthly ?? 0;
  const total = cost.total * quantity;
  const shown = unit === 'month' ? total : total / HOURS_PER_MONTH;
  const after = current + total;
  const budget = allowance?.budgetMonthly ?? 0;

  return (
    <div className={cn('overflow-hidden rounded-xl border border-line bg-surface shadow-card', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 whitespace-nowrap text-sm font-semibold text-fg"><Receipt className="size-4 text-muted" />{title}</div>
        {pro && <Segmented size="sm" value={unit} onChange={setUnit} options={[{ value: 'month', label: 'Monthly' }, { value: 'hour', label: 'Hourly' }]} />}
      </div>
      <div className="px-4 pb-4 pt-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-semibold tracking-tight tabular text-fg">{money(shown, { decimals: unit === 'hour' || shown < 1000 })}</span>
          <span className="text-sm text-muted">/ {unit === 'month' ? 'mo' : 'hr'}</span>
        </div>
        {quantity > 1 && <div className="mt-0.5 text-xs text-muted">{quantity} × {money(unit === 'month' ? cost.total : cost.total / HOURS_PER_MONTH, { decimals: true })}</div>}
        <ul className="mt-3 space-y-1.5">
          {cost.lines.map((l, i) => (
            <li key={i} className="flex items-start justify-between gap-3 text-[13px]">
              <span className="min-w-0 text-fg-2">
                {l.label}
                {l.hint && <span className="block text-[11px] text-faint">{l.hint}</span>}
              </span>
              <span className="shrink-0 tabular text-fg">{money(unit === 'month' ? l.amount * quantity : (l.amount * quantity) / HOURS_PER_MONTH, { decimals: true })}</span>
            </li>
          ))}
        </ul>
        {budget > 0 && unit === 'month' && (
          <div className="mt-4 rounded-lg bg-surface-2 p-3">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 font-medium text-fg-2"><TrendingUp className="size-3.5" /> Budget impact</span>
              <span className={cn('tabular font-medium', after > budget ? 'text-rose-500' : 'text-fg-2')}>{money(after)} / {money(budget)}</span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-surface-3">
              <div className="absolute inset-y-0 left-0 rounded-full bg-brand-500/40" style={{ width: `${Math.min(100, (current / budget) * 100)}%` }} />
              <div className={cn('absolute inset-y-0 rounded-r-full', after > budget ? 'bg-rose-500' : 'bg-brand-500')} style={{ left: `${Math.min(100, (current / budget) * 100)}%`, width: `${Math.max(0, Math.min(100, (after / budget) * 100) - Math.min(100, (current / budget) * 100))}%` }} />
            </div>
            {after > budget && <p className="mt-1.5 text-[11px] text-rose-500">Exceeds the monthly budget{allowance?.hardLimit ? ' — hard limit is enforced' : ''}.</p>}
          </div>
        )}
        {children}
      </div>
      {footer && <div className="border-t border-line bg-surface-2/50 px-4 py-3">{footer}</div>}
    </div>
  );
}
