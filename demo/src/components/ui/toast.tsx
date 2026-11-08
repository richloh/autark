import { create } from 'zustand';
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/cn';

type Level = 'success' | 'error' | 'info' | 'warning';
interface Toast { id: number; level: Level; title: string; message?: string; action?: { label: string; onClick: () => void } }
interface ToastState { toasts: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void }

let seq = 0;
const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.level === 'error' ? 7000 : 4200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  success: (title: string, message?: string, action?: Toast['action']) => useToasts.getState().push({ level: 'success', title, message, action }),
  error: (title: string, message?: string) => useToasts.getState().push({ level: 'error', title, message }),
  info: (title: string, message?: string, action?: Toast['action']) => useToasts.getState().push({ level: 'info', title, message, action }),
  warning: (title: string, message?: string) => useToasts.getState().push({ level: 'warning', title, message }),
};

const ICON = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
const TONE = { success: 'text-emerald-500', error: 'text-rose-500', info: 'text-brand-500', warning: 'text-amber-500' };

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICON[t.level];
        return (
          <div key={t.id} role="status" className="pointer-events-auto flex animate-pop items-start gap-3 rounded-xl border border-line bg-surface p-3 pr-2 shadow-pop">
            <Icon className={cn('mt-0.5 size-5 shrink-0', TONE[t.level])} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-fg">{t.title}</div>
              {t.message && <div className="mt-0.5 text-[13px] text-muted">{t.message}</div>}
              {t.action && (
                <button className="mt-1.5 text-[13px] font-medium text-brand-500 hover:underline" onClick={() => { t.action!.onClick(); dismiss(t.id) }}>{t.action.label}</button>
              )}
            </div>
            <button className="rounded p-1 text-faint hover:bg-surface-2 hover:text-fg" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X className="size-4" /></button>
          </div>
        );
      })}
    </div>
  );
}
