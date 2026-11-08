import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  Sparkles, PanelRightClose, PanelRightOpen, SquarePen, ArrowUp, Wrench, Check, ShieldCheck, Cpu, AtSign, ChevronRight, Square, History, X, ThumbsUp, ThumbsDown, Copy,
} from 'lucide-react';
import { useUi, useWide } from '@/store/ui';
import { ALL_NAV_ITEMS } from '@/nav';
import { cn } from '@/lib/cn';
import { CodeBlock } from '../ui/CodeBlock';
import { toast } from '../ui/toast';
import { contextFor, respond, suggestionsFor, type Part, type PageContext } from './brain';

interface Msg { id: number; role: 'user' | 'assistant'; text?: string; parts?: Part[]; streaming?: boolean; shown?: number }

let seq = 0;

/** Right-hand copilot pane. Docked on wide screens (collapsible to a rail), a drawer on small ones. */
export function AiPane() {
  const open = useUi((s) => s.aiOpen);
  const setOpen = useUi((s) => s.setAiOpen);
  const wide = useWide();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // expose a toggle for the top bar
  useEffect(() => {
    const h = () => (wide ? setOpen(!useUi.getState().aiOpen) : setMobileOpen((o) => !o));
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); h() } };
    const ask = () => (wide ? setOpen(true) : setMobileOpen(true));
    window.addEventListener('autark:toggle-ai', h);
    window.addEventListener('autark:ask', ask);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('autark:toggle-ai', h); window.removeEventListener('autark:ask', ask); window.removeEventListener('keydown', key) };
  }, [wide, setOpen]);
  useEffect(() => { setMobileOpen(false) }, [location.pathname]);

  if (!wide) {
    if (!mobileOpen) return null;
    return (
      <div className="fixed inset-0 z-[65] flex justify-end">
        <div className="absolute inset-0 animate-in bg-black/30" onClick={() => setMobileOpen(false)} />
        <aside className="relative flex h-full w-full max-w-[400px] animate-slide-in flex-col border-l border-line bg-surface shadow-pop">
          <Chat onClose={() => setMobileOpen(false)} closeIcon={X} />
        </aside>
      </div>
    );
  }

  if (!open) {
    return (
      <aside className="sticky top-0 z-20 flex h-screen self-start w-12 shrink-0 flex-col items-center gap-2 border-l border-line bg-surface py-3">
        <button onClick={() => setOpen(true)} title="Open Autark Copilot" aria-label="Open Autark Copilot"
          className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 text-white shadow-sm shadow-indigo-500/30 transition-transform hover:scale-105">
          <Sparkles className="size-4" />
        </button>
        <button onClick={() => setOpen(true)} className="mt-2 text-[11px] font-medium tracking-wide text-muted [writing-mode:vertical-rl] hover:text-fg">Copilot</button>
        <button onClick={() => setOpen(true)} title="Expand" aria-label="Expand copilot" className="mt-auto flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg">
          <PanelRightOpen className="size-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="sticky top-0 z-20 flex h-screen self-start w-[360px] shrink-0 flex-col border-l border-line bg-surface 2xl:w-[400px]" aria-label="Autark Copilot">
      <Chat onClose={() => setOpen(false)} closeIcon={PanelRightClose} />
    </aside>
  );
}

function Chat({ onClose, closeIcon: CloseIcon }: { onClose: () => void; closeIcon: typeof X }) {
  const location = useLocation();
  const [docTitle, setDocTitle] = useState(document.title);
  useEffect(() => {
    const el = document.querySelector('title');
    if (!el) return;
    const obs = new MutationObserver(() => setDocTitle(document.title));
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    return () => obs.disconnect();
  }, []);
  const navLabel = ALL_NAV_ITEMS.filter((n) => location.pathname.startsWith(n.path)).sort((a, b) => b.path.length - a.path.length)[0]?.label ?? '';
  const isDetail = !!contextFor(location.pathname, '').kind;
  const title = isDetail && docTitle.includes(' · ') ? docTitle.replace(' · Autark', '') : navLabel || docTitle.replace(' · Autark', '');
  const ctx = useMemo(() => contextFor(location.pathname, title), [location.pathname, title]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [useContext, setUseContext] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [msgs]);
  const sendRef = useRef<(t: string) => void>(() => {});
  useEffect(() => {
    const h = (e: Event) => { const p = (e as CustomEvent<string>).detail; if (p) setTimeout(() => sendRef.current(p), 50) };
    window.addEventListener('autark:ask', h);
    return () => window.removeEventListener('autark:ask', h);
  }, []);

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setInput('');
    cancelled.current = false;
    const id = ++seq;
    setMsgs((m) => [...m, { id: ++seq, role: 'user', text: prompt }, { id, role: 'assistant', parts: [], streaming: true, shown: 0 }]);
    setBusy(true);
    await new Promise((r) => setTimeout(r, 450));
    const parts = await respond(prompt, useContext ? ctx : { path: '/', title: '' });
    // reveal parts one by one; text streams in word by word
    for (let i = 0; i < parts.length && !cancelled.current; i++) {
      const p = parts[i];
      if (p.type === 'text') {
        const words = p.md.split(/(\s+)/);
        for (let w = 1; w <= words.length && !cancelled.current; w += 3) {
          const partial: Part = { type: 'text', md: words.slice(0, w).join('') };
          setMsgs((m) => m.map((x) => (x.id === id ? { ...x, parts: [...parts.slice(0, i), partial] } : x)));
          await new Promise((r) => setTimeout(r, 18));
        }
      } else {
        await new Promise((r) => setTimeout(r, p.type === 'tool' ? 260 : 120));
      }
      setMsgs((m) => m.map((x) => (x.id === id ? { ...x, parts: parts.slice(0, i + 1) } : x)));
    }
    setMsgs((m) => m.map((x) => (x.id === id ? { ...x, streaming: false } : x)));
    setBusy(false);
  };

  sendRef.current = send;
  const suggestions = suggestionsFor(ctx);

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-3.5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 text-white shadow-sm shadow-indigo-500/30"><Sparkles className="size-3.5" /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[13px] font-semibold text-fg">Autark Copilot</div>
          <div className="flex items-center gap-1 text-[10.5px] text-muted"><span className="size-1.5 rounded-full bg-emerald-500" /> Llama 3.3 70B · on dc1-gpu-01</div>
        </div>
        <button title="History" aria-label="History" onClick={() => toast.info('Conversation history', 'Saved conversations will appear here.')} className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"><History className="size-4" /></button>
        <button title="New chat" aria-label="New chat" onClick={() => { cancelled.current = true; setMsgs([]); setBusy(false) }} className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"><SquarePen className="size-4" /></button>
        <button title="Collapse" aria-label="Collapse copilot" onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"><CloseIcon className="size-4" /></button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3.5 py-4">
        {msgs.length === 0 ? (
          <Welcome ctx={ctx} suggestions={suggestions} onPick={send} />
        ) : (
          <div className="space-y-5">
            {msgs.map((m) => (m.role === 'user' ? <UserMsg key={m.id} text={m.text!} /> : <AssistantMsg key={m.id} msg={m} />))}
            {!busy && msgs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pl-8">
                {suggestions.filter((s) => !msgs.some((m) => m.text?.toLowerCase().replace(/[?!.]/g, '') === s.toLowerCase().replace(/[?!.]/g, ''))).slice(0, 3).map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11.5px] text-fg-2 transition-colors hover:border-brand-500/40 hover:bg-brand-500/5 hover:text-fg">{s}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        <div className="rounded-xl border border-line bg-surface-2/50 shadow-card transition-colors focus-within:border-brand-500 focus-within:bg-surface focus-within:ring-3 focus-within:ring-brand-500/15">
          {useContext && (ctx.kind || ctx.listKind || title) && (
            <div className="flex items-center gap-1.5 px-2.5 pt-2">
              <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-brand-500/10 px-1.5 py-0.5 text-[11px] font-medium text-brand-700 dark:text-brand-300">
                <AtSign className="size-3 shrink-0" /><span className="truncate">{title || 'this page'}</span>
                <button onClick={() => setUseContext(false)} aria-label="Remove page context" className="opacity-60 hover:opacity-100"><X className="size-3" /></button>
              </span>
            </div>
          )}
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px' }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
            rows={2}
            placeholder="Ask about your infrastructure, or describe a change…"
            className="block w-full resize-none bg-transparent px-3 py-2 text-[13px] text-fg outline-none placeholder:text-faint focus-visible:outline-none"
          />
          <div className="flex items-center gap-1.5 px-2 pb-2">
            {!useContext && <button onClick={() => setUseContext(true)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted hover:bg-surface-3 hover:text-fg"><AtSign className="size-3" /> Add page context</button>}
            <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted"><Cpu className="size-3" /> Agent mode</span>
            <button
              onClick={() => (busy ? (cancelled.current = true) : send(input))}
              disabled={!busy && !input.trim()}
              aria-label={busy ? 'Stop' : 'Send'}
              className="ml-auto flex size-7 items-center justify-center rounded-lg bg-brand-500 text-white transition-colors hover:bg-brand-600 disabled:bg-line-strong disabled:text-faint"
            >
              {busy ? <Square className="size-3 fill-current" /> : <ArrowUp className="size-4" />}
            </button>
          </div>
        </div>
        <p className="mt-2 flex items-center justify-center gap-1 text-[10.5px] text-faint"><ShieldCheck className="size-3" /> Runs on your hardware · changes always need your approval</p>
      </div>
    </>
  );
}

function Welcome({ ctx, suggestions, onPick }: { ctx: PageContext; suggestions: string[]; onPick: (s: string) => void }) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="mt-2 rounded-2xl border border-line bg-gradient-to-br from-brand-500/[0.07] via-transparent to-cyan-500/[0.07] p-4">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-white shadow-md shadow-indigo-500/30"><Sparkles className="size-[18px]" /></div>
        <h2 className="mt-3 text-[15px] font-semibold text-fg">How can I help?</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">I can explain what's running, find problems, estimate costs and prepare changes for you to approve — using the same API as the console.</p>
      </div>
      <div className="mt-4 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{ctx.kind || ctx.listKind ? 'For this page' : 'Try asking'}</div>
      <div className="mt-2 space-y-1.5">
        {suggestions.map((s) => (
          <button key={s} onClick={() => onPick(s)} className="group flex w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-left text-[13px] text-fg-2 transition-all hover:border-brand-500/40 hover:bg-brand-500/[0.04] hover:text-fg">
            <Sparkles className="size-3.5 shrink-0 text-brand-500/70" />
            <span className="flex-1">{s}</span>
            <ChevronRight className="size-3.5 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
      </div>
      <div className="mt-auto grid grid-cols-3 gap-2 pt-6 text-center text-[10.5px] text-muted">
        {[['Live data', 'via MCP tools'], ['You approve', 'every change'], ['Sovereign', 'model on-prem']].map(([a, b]) => (
          <div key={a} className="rounded-lg bg-surface-2/70 px-1.5 py-2"><div className="font-medium text-fg-2">{a}</div><div>{b}</div></div>
        ))}
      </div>
    </div>
  );
}

function UserMsg({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-500 px-3 py-2 text-[13px] text-white shadow-sm">{text}</div>
    </div>
  );
}

function AssistantMsg({ msg }: { msg: Msg }) {
  const navigate = useNavigate();
  const parts = msg.parts ?? [];
  const text = parts.filter((p) => p.type === 'text').map((p) => (p as { md: string }).md).join('\n\n');
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-cyan-400 to-indigo-500 text-white"><Sparkles className="size-3" /></span>
      <div className="min-w-0 flex-1 space-y-2.5">
        {parts.length === 0 && msg.streaming && (
          <div className="flex items-center gap-1 py-1.5">{[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-pulse-soft rounded-full bg-faint" style={{ animationDelay: `${i * 0.2}s` }} />)}</div>
        )}
        {parts.some((p) => p.type === 'tool') && (
          <div className="space-y-1">
            {parts.filter((p) => p.type === 'tool').map((p, i) => {
              const t = p as Extract<Part, { type: 'tool' }>;
              return (
                <div key={i} className="flex animate-in items-center gap-1.5 rounded-lg border border-line bg-surface-2/60 px-2 py-1 font-mono text-[11px] text-muted">
                  <Wrench className="size-3 shrink-0" />
                  <span className="text-fg-2">{t.name}</span>
                  <span className="truncate">· {t.summary}</span>
                  <Check className="ml-auto size-3 shrink-0 text-emerald-500" />
                </div>
              );
            })}
          </div>
        )}
        {parts.map((p, i) => {
          if (p.type === 'text') return <Markdown key={i} md={p.md} />;
          if (p.type === 'code') return <CodeBlock key={i} code={p.code} language={p.language} maxHeight="max-h-64" />;
          if (p.type === 'action') return (
            <div key={i} className="animate-pop overflow-hidden rounded-xl border border-brand-500/30 bg-brand-500/[0.04]">
              <div className="flex items-center gap-2 border-b border-brand-500/20 px-3 py-2">
                <span className="text-[12.5px] font-semibold text-fg">{p.title}</span>
                {p.risk && <span className="ml-auto rounded bg-emerald-500/10 px-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">{p.risk} risk</span>}
              </div>
              <div className="space-y-0.5 px-3 py-2 font-mono text-[11px]">
                {p.lines.map((l, j) => <div key={j} className={cn(l.startsWith('+') ? 'text-emerald-600 dark:text-emerald-400' : l.startsWith('~') ? 'text-amber-600 dark:text-amber-400' : l.startsWith('-') && !l.startsWith('- ') ? 'text-rose-500' : 'text-fg-2')}>{l}</div>)}
              </div>
              <div className="flex gap-2 border-t border-brand-500/20 px-3 py-2">
                <button onClick={() => navigate(p.to)} className="inline-flex h-7 items-center rounded-md bg-brand-500 px-2.5 text-[12px] font-medium text-white hover:bg-brand-600">{p.cta}</button>
                <button onClick={() => toast.info('Preview', 'Direct apply from chat is not wired up in this demo — review it in the console.')} className="inline-flex h-7 items-center rounded-md border border-line bg-surface px-2.5 text-[12px] font-medium text-fg-2 hover:bg-surface-2">Apply</button>
              </div>
            </div>
          );
          return null;
        })}
        {!msg.streaming && text && (
          <div className="flex gap-0.5 text-faint">
            <IconBtn label="Copy" onClick={() => { navigator.clipboard?.writeText(text); toast.success('Copied') }}><Copy className="size-3.5" /></IconBtn>
            <IconBtn label="Good answer" onClick={() => toast.success('Thanks for the feedback')}><ThumbsUp className="size-3.5" /></IconBtn>
            <IconBtn label="Bad answer" onClick={() => toast.info('Thanks — we use feedback to improve answers')}><ThumbsDown className="size-3.5" /></IconBtn>
          </div>
        )}
      </div>
    </div>
  );
}

function IconBtn({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return <button aria-label={label} title={label} onClick={onClick} className="rounded-md p-1 hover:bg-surface-2 hover:text-fg">{children}</button>;
}

/** Tiny markdown renderer: paragraphs, "- " bullets, **bold**, *italic*, `code`, [text](/route). */
function Markdown({ md }: { md: string }) {
  const blocks = md.split(/\n{2,}/);
  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-fg-2">
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => l.startsWith('- ') || !l.trim())) {
          return <ul key={i} className="space-y-1">{lines.filter(Boolean).map((l, j) => <li key={j} className="flex gap-2"><span className="mt-[9px] size-1 shrink-0 rounded-full bg-faint" /><span className="min-w-0">{inline(l.slice(2))}</span></li>)}</ul>;
        }
        return <p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{l.startsWith('- ') ? <>• {inline(l.slice(2))}</> : inline(l)}</span>)}</p>;
      })}
    </div>
  );
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const rx = /(\*\*.+?\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = rx.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={k++} className="font-semibold text-fg">{inline(t.slice(2, -2))}</strong>);
    else if (t.startsWith('`')) out.push(<code key={k++} className="rounded bg-surface-3 px-1 py-px font-mono text-[11.5px] text-fg">{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) { const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!; out.push(<Link key={k++} to={mm[2]} className="font-medium text-brand-600 underline decoration-brand-500/30 underline-offset-2 hover:decoration-brand-500 dark:text-brand-300">{mm[1]}</Link>) }
    else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
