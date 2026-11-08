import type { ReactNode, HTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-line bg-surface shadow-card', className)} {...rest}>{children}</div>;
}

export function CardHeader({ title, description, actions, icon: Icon, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; icon?: LucideIcon; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-line px-4 py-3', className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-muted" />}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-4', className)}>{children}</div>;
}

/** Definition grid for detail pages: [["Label", value], ...] */
export function KeyValue({ items, cols = 2, className }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 | 4; className?: string }) {
  const grid = { 1: 'grid-cols-1', 2: '@min-[26rem]:grid-cols-2', 3: '@min-[26rem]:grid-cols-2 @min-[42rem]:grid-cols-3', 4: '@min-[26rem]:grid-cols-2 @min-[50rem]:grid-cols-4' }[cols];
  return (
    <div className="@container"><dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3.5', grid, className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium text-muted">{k}</dt>
          <dd className="mt-1 truncate text-sm text-fg">{v ?? <span className="text-faint">—</span>}</dd>
        </div>
      ))}
    </dl></div>
  );
}

export function Section({ title, description, children, actions, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
