import { overlayRoot } from '@/lib/overlay';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onClick?: () => void;
  to?: string;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  divider?: boolean;
}

/** Dropdown menu anchored to a trigger. Items with `divider: true` render a separator. */
export function Menu({ trigger, items, align = 'end', width = 'w-56', header }: { trigger: (open: boolean) => ReactNode; items: MenuItem[]; align?: 'start' | 'end'; width?: string; header?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; right: number }>({ top: 0, left: 0, right: 0 });
  const ref = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', () => setOpen(false), { once: true, capture: true });
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) };
  }, [open]);

  const toggle = () => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, right: window.innerWidth - r.right });
    setOpen((o) => !o);
  };

  return (
    <>
      <span ref={ref} onClick={toggle} className="inline-flex">{trigger(open)}</span>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={align === 'end' ? { top: pos.top, right: pos.right } : { top: pos.top, left: pos.left }}
          className={cn('fixed z-[90] animate-pop overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-pop', width)}
        >
          {header}
          {items.map((it, i) =>
            it.divider ? <div key={i} className="my-1 h-px bg-line" /> : (
              <button
                key={i}
                role="menuitem"
                disabled={it.disabled}
                onClick={() => { setOpen(false); if (it.to) navigate(it.to); it.onClick?.() }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors disabled:opacity-40',
                  it.danger ? 'text-rose-600 hover:bg-rose-500/10 dark:text-rose-400' : 'text-fg-2 hover:bg-surface-2 hover:text-fg',
                )}
              >
                {it.icon && <it.icon className="size-4 shrink-0 opacity-80" />}
                <span className="flex-1">{it.label}</span>
                {it.hint && <span className="text-[11px] text-faint">{it.hint}</span>}
              </button>
            ),
          )}
        </div>,
        overlayRoot(),
      )}
    </>
  );
}

/** Lightweight popover (generic content) anchored to a trigger. */
export function Popover({ trigger, children, align = 'end', className, block }: { trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: 'start' | 'end'; className?: string; block?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, right: 0 });
  const ref = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !popRef.current?.contains(e.target as Node)) setOpen(false) };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) };
  }, [open]);
  const toggle = () => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, right: window.innerWidth - r.right });
    setOpen((o) => !o);
  };
  return (
    <>
      <span ref={ref} onClick={toggle} className={block ? 'flex w-full' : 'inline-flex'}>{trigger(open)}</span>
      {open && createPortal(
        <div ref={popRef} style={align === 'end' ? { top: pos.top, right: Math.max(8, pos.right) } : { top: pos.top, left: pos.left }}
          className={cn('fixed z-[90] max-h-[70vh] animate-pop overflow-auto rounded-xl border border-line bg-surface shadow-pop', className)}>
          {children(() => setOpen(false))}
        </div>,
        overlayRoot(),
      )}
    </>
  );
}
