import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MousePointerClick, Sparkles, Server, ArrowRight, FlaskConical } from 'lucide-react';
import { overlayRoot } from '@/lib/overlay';
import { Logo } from './Logo';

const KEY = 'autark.splash.v1';

/** Re-open the splash from anywhere (e.g. user menu "About this demo"). */
export function showSplash() { window.dispatchEvent(new Event('autark:splash')) }

/** First-visit introduction: explains that this is a click-dummy and what it demonstrates. */
export function Splash() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(KEY) !== 'seen' } catch { return true }
  });
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener('autark:splash', h);
    return () => window.removeEventListener('autark:splash', h);
  }, []);
  const close = () => { try { localStorage.setItem(KEY, 'seen') } catch { /* ignore */ } setOpen(false) };
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Enter') close() };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-labelledby="splash-title">
      <div className="fixed inset-0 animate-in bg-[#0a0b12]/60 backdrop-blur-md" />
      <div className="relative w-full max-w-2xl animate-pop overflow-hidden rounded-3xl border border-line bg-surface shadow-pop">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-gradient-to-br from-cyan-400/30 to-indigo-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-20 size-64 rounded-full bg-gradient-to-tr from-violet-500/20 to-cyan-400/10 blur-3xl" />

        <div className="relative px-6 pb-6 pt-7 sm:px-9 sm:pt-9">
          <div className="flex items-center gap-3">
            <Logo className="size-10" />
            <div className="leading-tight">
              <div className="text-lg font-semibold tracking-tight text-fg">Autark</div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-faint">sovereign cloud platform</div>
            </div>
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              <FlaskConical className="size-3.5" /> Click-dummy
            </span>
          </div>

          <h1 id="splash-title" className="mt-7 text-2xl font-semibold tracking-tight text-fg sm:text-[28px] sm:leading-tight">
            The hyperscaler experience — on your own hardware.
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-fg-2">
            This is an interactive prototype of an <strong className="font-semibold text-fg">administration platform for hosting providers</strong> who
            want to offer their customers what AWS, Azure or Google Cloud offer — while servers and data stay in their own data centers.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              { icon: Server, title: 'Hyperscaler-like', text: 'VMs, Kubernetes, databases, storage, networks and load balancers — one consistent console & API.' },
              { icon: MousePointerClick, title: 'Self-service', text: 'Customers provision and operate everything themselves, within the quotas and budgets you set.' },
              { icon: Sparkles, title: 'AI-native', text: 'A built-in copilot and MCP tools let AI agents explain, plan and change infrastructure — with approval.' },
            ].map((f) => (
              <div key={f.title} className="rounded-2xl border border-line bg-surface-2/60 p-4">
                <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 text-white shadow-sm shadow-indigo-500/30"><f.icon className="size-4" /></span>
                <div className="mt-3 text-[13.5px] font-semibold text-fg">{f.title}</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{f.text}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-line bg-surface-2/40 px-4 py-3 text-[12.5px] leading-relaxed text-muted">
            <span className="font-medium text-fg-2">Everything here is simulated.</span> All data is sample data running in your browser — click, create and delete freely;
            nothing touches real infrastructure. You can reset the demo anytime from the user menu.
          </div>

          <div className="mt-6 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-center text-[11.5px] text-faint sm:text-left">Tip: try <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-[10px]">⌘K</kbd> and the Copilot on the right.</span>
            <button
              autoFocus
              onClick={close}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 text-[15px] font-medium text-white shadow-md shadow-brand-500/25 transition-colors hover:bg-brand-600"
            >
              Explore the demo <ArrowRight className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>,
    overlayRoot(),
  );
}
