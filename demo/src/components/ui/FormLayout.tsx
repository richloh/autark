import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Numbered form section used by create wizards (single page, progressive disclosure). */
export function FormSection({ step, title, description, children, className, aside, id }: { step?: number; title: ReactNode; description?: ReactNode; children: ReactNode; className?: string; aside?: ReactNode; id?: string }) {
  return (
    <section id={id} className={cn('scroll-mt-20 rounded-xl border border-line bg-surface p-5 shadow-card', className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {step != null && <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-xs font-semibold text-brand-600 dark:text-brand-300">{step}</span>}
          <div>
            <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
        </div>
        {aside}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** Two-column create layout: form left, sticky summary/cost right. */
export function CreateLayout({ children, aside }: { children: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid items-start gap-5 @min-[46rem]:grid-cols-[minmax(0,1fr)_272px] @min-[62rem]:grid-cols-[minmax(0,1fr)_320px] @min-[70rem]:grid-cols-[minmax(0,1fr)_340px] @min-[70rem]:gap-6">
      <div className="min-w-0 space-y-5">{children}</div>
      <div className="space-y-4 @min-[46rem]:sticky @min-[46rem]:top-20">{aside}</div>
    </div>
  );
}

/** Map API 422 details into a field->message record. */
export function fieldErrors(e: unknown): Record<string, string> {
  const d = (e as { details?: Record<string, string> })?.details;
  return d ?? {};
}
