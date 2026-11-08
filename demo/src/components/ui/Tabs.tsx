import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { cn } from '@/lib/cn';

export interface TabDef { id: string; label: ReactNode; count?: number; icon?: ReactNode }

/** Underline tabs. If `urlParam` is set, the active tab is synced to ?{urlParam}=id. */
export function Tabs({ tabs, value, onChange, className }: { tabs: TabDef[]; value: string; onChange: (id: string) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ l: false, r: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const upd = () => setFade({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    upd();
    el.addEventListener('scroll', upd, { passive: true });
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    // keep the active tab visible
    el.querySelector<HTMLElement>('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return () => { el.removeEventListener('scroll', upd); ro.disconnect() };
  }, [tabs.length, value]);
  const mask = fade.l && fade.r ? 'linear-gradient(to right, transparent, black 32px, black calc(100% - 32px), transparent)'
    : fade.r ? 'linear-gradient(to right, black calc(100% - 40px), transparent)' : fade.l ? 'linear-gradient(to right, transparent, black 40px)' : undefined;
  return (
    <div ref={ref} style={{ maskImage: mask, WebkitMaskImage: mask }} className={cn('-mb-px flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-[13px] font-medium transition-colors',
            value === t.id ? 'border-brand-500 text-fg' : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {t.icon}
          {t.label}
          {t.count != null && <span className={cn('rounded-full px-1.5 text-[11px] tabular', value === t.id ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300' : 'bg-surface-3 text-muted')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Tab state stored in the URL query (?tab=...), so tabs are linkable. */
export function useTabParam(defaultTab: string, param = 'tab'): [string, (t: string) => void] {
  const [sp, setSp] = useSearchParams();
  const v = sp.get(param) ?? defaultTab;
  return [v, (t: string) => { const n = new URLSearchParams(sp); if (t === defaultTab) n.delete(param); else n.set(param, t); setSp(n, { replace: true }) }];
}

/** Pill-style segmented control. */
export function Segmented<T extends string>({ options, value, onChange, size = 'md', className }: { options: { value: T; label: ReactNode; icon?: ReactNode }[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md'; className?: string }) {
  return (
    <div className={cn('inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-surface-2 p-0.5 [scrollbar-width:none]', className)} role="radiogroup">
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-md font-medium transition-all',
            size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-[13px]',
            value === o.value ? 'bg-surface text-fg shadow-card ring-1 ring-line' : 'text-muted hover:text-fg',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
