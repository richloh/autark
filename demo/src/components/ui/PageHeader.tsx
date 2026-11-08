import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface Crumb { label: string; to?: string }

/** Page title area with breadcrumbs, icon, meta row, and actions. Also sets document.title. */
export function PageHeader({ title, description, icon: Icon, iconColor, actions, crumbs, meta, status, className }: {
  title: ReactNode; description?: ReactNode; icon?: LucideIcon; iconColor?: string; actions?: ReactNode; crumbs?: Crumb[]; meta?: ReactNode; status?: ReactNode; className?: string;
}) {
  useEffect(() => {
    if (typeof title === 'string') document.title = `${title} · Autark`;
  }, [title]);
  return (
    <div className={cn('mb-6', className)}>
      {crumbs && crumbs.length > 0 && (
        <nav className="mb-3 flex items-center gap-1 text-xs text-muted" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3 text-faint" />}
              {c.to ? <Link to={c.to} className="hover:text-fg">{c.label}</Link> : <span className="text-fg-2">{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-4 @min-[40rem]:flex-row @min-[40rem]:items-start @min-[40rem]:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          {Icon && (
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface shadow-card" style={iconColor ? { color: iconColor } : undefined}>
              <Icon className="size-[22px]" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-xl font-semibold tracking-tight text-fg @min-[36rem]:text-[22px]">{title}</h1>
              {status}
            </div>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
            {meta && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">{meta}</div>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Page container with consistent width. */
export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn('mx-auto w-full px-4 py-6 @min-[36rem]:px-6 @min-[44rem]:px-8', wide ? 'max-w-[1600px]' : 'max-w-7xl', className)}>{children}</div>;
}
