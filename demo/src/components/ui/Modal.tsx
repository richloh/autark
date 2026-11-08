import { overlayRoot } from '@/lib/overlay';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { X, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { Input } from './form';

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  icon?: ReactNode;
}

/** Centered dialog. Footer is rendered in a sticky bar. */
export function Modal({ open, onClose, title, description, children, footer, size = 'md', icon }: ModalProps) {
  useEscape(open, onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) setTimeout(() => ref.current?.querySelector<HTMLElement>('input,select,textarea,button[data-autofocus]')?.focus(), 30);
  }, [open]);
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-4 pt-[8vh]" role="dialog" aria-modal="true">
      <div className="fixed inset-0 animate-in bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={ref} className={cn('relative w-full animate-pop rounded-2xl border border-line bg-surface shadow-pop', width)}>
        <div className="flex items-start gap-3 px-5 pb-3 pt-5">
          {icon}
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="-mr-1 -mt-1 rounded-lg p-1.5 text-faint hover:bg-surface-2 hover:text-fg" aria-label="Close"><X className="size-4" /></button>
        </div>
        {children && <div className="px-5 pb-5">{children}</div>}
        {footer && <div className="flex items-center justify-end gap-2 rounded-b-2xl border-t border-line bg-surface-2/60 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    overlayRoot(),
  );
}

/** Right-side sheet for details / inspectors. */
export function Drawer({ open, onClose, title, description, children, footer, width = 'max-w-xl' }: Omit<ModalProps, 'size'> & { width?: string }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex justify-end" role="dialog" aria-modal="true">
      <div className="fixed inset-0 animate-in bg-black/30" onClick={onClose} />
      <div className={cn('relative flex h-full w-full animate-slide-in flex-col border-l border-line bg-surface shadow-pop', width)}>
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-faint hover:bg-surface-2 hover:text-fg" aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    overlayRoot(),
  );
}

/* ------------------------------------------------------------------ imperative confirm dialog */

interface ConfirmOpts {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** require typing this text to enable the confirm button (for destructive actions) */
  typeToConfirm?: string;
  /** extra options rendered as checkboxes; their values are returned */
  options?: { id: string; label: string; description?: string; default?: boolean }[];
}
interface ConfirmState { req: (ConfirmOpts & { resolve: (v: false | Record<string, boolean>) => void }) | null; set: (r: ConfirmState['req']) => void }
const useConfirmStore = create<ConfirmState>((set) => ({ req: null, set: (req) => set({ req }) }));

/** `const ok = await confirm({...})` → false or an object with option values. */
export function confirm(opts: ConfirmOpts): Promise<false | Record<string, boolean>> {
  return new Promise((resolve) => useConfirmStore.getState().set({ ...opts, resolve }));
}

export function ConfirmHost() {
  const { req, set } = useConfirmStore();
  const [typed, setTyped] = useState('');
  const [opts, setOpts] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setTyped('');
    setOpts(Object.fromEntries((req?.options ?? []).map((o) => [o.id, !!o.default])));
  }, [req]);
  if (!req) return null;
  const close = (v: false | Record<string, boolean>) => { req.resolve(v); set(null) };
  const blocked = !!req.typeToConfirm && typed !== req.typeToConfirm;
  return (
    <Modal
      open
      onClose={() => close(false)}
      size="sm"
      title={req.title}
      icon={req.danger ? <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-rose-500"><AlertTriangle className="size-[18px]" /></div> : undefined}
      description={req.message}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
          <Button data-autofocus variant={req.danger ? 'danger' : 'primary'} disabled={blocked} onClick={() => close(opts)}>{req.confirmLabel ?? 'Confirm'}</Button>
        </>
      }
    >
      {(req.options?.length || req.typeToConfirm) && (
        <div className="space-y-3">
          {req.options?.map((o) => (
            <label key={o.id} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-2.5 hover:bg-surface-2">
              <input type="checkbox" className="mt-0.5 accent-brand-500" checked={!!opts[o.id]} onChange={(e) => setOpts({ ...opts, [o.id]: e.target.checked })} />
              <span>
                <span className="block text-sm text-fg">{o.label}</span>
                {o.description && <span className="block text-xs text-muted">{o.description}</span>}
              </span>
            </label>
          ))}
          {req.typeToConfirm && (
            <div>
              <p className="mb-1.5 text-[13px] text-muted">Type <code className="rounded bg-surface-3 px-1 font-mono text-fg">{req.typeToConfirm}</code> to confirm</p>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={req.typeToConfirm} autoFocus />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
