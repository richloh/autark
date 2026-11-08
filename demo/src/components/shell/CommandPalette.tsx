import { overlayRoot } from '@/lib/overlay';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { create } from 'zustand';
import { Search, CornerDownLeft, Plus, Moon, Sun, History, ArrowRight, Terminal, Sparkles, type LucideIcon } from 'lucide-react';
import { ALL_NAV_ITEMS } from '@/nav';
import { api } from '@/api/client';
import { useUi } from '@/store/ui';
import { KINDS } from '@/lib/kinds';
import { cn } from '@/lib/cn';
import { Kbd } from '../ui/misc';
import type { ResourceKind } from '@/types';

export const usePalette = create<{ open: boolean; set: (o: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

interface Cmd { id: string; label: string; sub?: string; icon: LucideIcon; iconColor?: string; group: string; run: () => void; keywords?: string }

const CREATE_ACTIONS: [string, string, ResourceKind][] = [
  ['Create virtual machine', '/infrastructure/vms/new', 'vm'],
  ['Create volume', '/infrastructure/volumes/new', 'volume'],
  ['Create network', '/infrastructure/networks/new', 'network'],
  ['Create firewall', '/infrastructure/firewalls/new', 'firewall'],
  ['Create database', '/managed-services/db/new', 'db'],
  ['Create Kubernetes cluster', '/managed-services/kubernetes/new', 'k8s'],
  ['Create bucket', '/managed-services/object-storage/new', 'bucket'],
  ['Create load balancer', '/managed-services/load-balancers/new', 'lb'],
  ['Add bare metal host', '/hardware/bare-metals/new', 'bareMetal'],
  ['Connect cloud provider', '/hardware/cloud-providers/new', 'provider'],
];

export function CommandPalette() {
  const { open, set } = usePalette();
  const navigate = useNavigate();
  const { theme, setTheme, recent, setInspector } = useUi();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<{ kind: ResourceKind; id: string; name: string; subtitle: string; link: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); set(!usePalette.getState().open) }
      else if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) && !(e.target as HTMLElement).isContentEditable) { e.preventDefault(); set(true) }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [set]);

  useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => inputRef.current?.focus(), 10) } }, [open]);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    let cancelled = false;
    const t = setTimeout(() => {
      api.get_<{ items: any[] }>(`/search?q=${encodeURIComponent(q)}`).then((r) => !cancelled && setResults(r.items)).catch(() => {});
    }, 120);
    return () => { cancelled = true; clearTimeout(t) };
  }, [q]);

  const go = (to: string) => { set(false); navigate(to) };

  const cmds = useMemo<Cmd[]>(() => {
    const s = q.toLowerCase().trim();
    const match = (c: Cmd) => !s || `${c.label} ${c.sub ?? ''} ${c.keywords ?? ''}`.toLowerCase().includes(s);
    const out: Cmd[] = [];
    results.forEach((r) => {
      const meta = KINDS[r.kind];
      out.push({ id: `res-${r.kind}-${r.id}`, label: r.name, sub: r.subtitle, icon: meta?.icon ?? Search, iconColor: meta?.color, group: 'Resources', run: () => go(r.link) });
    });
    if (!s) recent.forEach((r) => out.push({ id: `recent-${r.link}`, label: r.name, sub: KINDS[r.kind as ResourceKind]?.label, icon: History, group: 'Recent', run: () => go(r.link) }));
    CREATE_ACTIONS.filter(([, , kind]) => useUi.getState().pro || (kind !== 'bareMetal' && kind !== 'provider')).forEach(([label, to, kind]) => {
      const c: Cmd = { id: `create-${to}`, label, icon: Plus, iconColor: KINDS[kind].color, group: 'Create', run: () => go(to), keywords: `new add ${KINDS[kind].plural}` };
      if (match(c)) out.push(c);
    });
    ALL_NAV_ITEMS.forEach((n) => {
      const c: Cmd = { id: `nav-${n.path}`, label: n.label, sub: n.group, icon: n.icon, group: 'Go to', run: () => go(n.path), keywords: n.keywords };
      if (match(c)) out.push(c);
    });
    if (s) out.push({ id: 'ask-ai', label: `Ask Copilot: “${q.trim()}”`, sub: 'Answer from live data, propose changes', icon: Sparkles, iconColor: '#5b67f8', group: 'Copilot', run: () => { set(false); window.dispatchEvent(new CustomEvent('autark:ask', { detail: q.trim() })) } });
    const utils: Cmd[] = [
      { id: 'theme', label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', icon: theme === 'dark' ? Sun : Moon, group: 'Preferences', run: () => { setTheme(theme === 'dark' ? 'light' : 'dark'); set(false) }, keywords: 'theme appearance dark light' },
      { id: 'pro', label: useUi.getState().pro ? 'Switch to simple mode' : 'Enable Pro mode', icon: Sparkles, group: 'Preferences', run: () => { useUi.getState().setPro(!useUi.getState().pro); set(false) }, keywords: 'pro mode advanced simple expert' },
      { id: 'copilot', label: 'Toggle Autark Copilot', icon: Sparkles, group: 'Preferences', run: () => { set(false); window.dispatchEvent(new Event('autark:toggle-ai')) }, keywords: 'ai assistant chat llm copilot ⌘J' },
      { id: 'inspector', label: 'Open API inspector', icon: Terminal, group: 'Preferences', run: () => { setInspector(true); set(false) }, keywords: 'requests network debug developer' },
    ];
    utils.forEach((c) => match(c) && out.push(c));
    return out;
  }, [q, results, recent, theme]); // eslint-disable-line

  useEffect(() => { setIdx(0) }, [q, results.length]);
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' }) }, [idx]);

  if (!open) return null;
  const groups = [...new Set(cmds.map((c) => c.group))];
  let n = -1;
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="fixed inset-0 animate-in bg-black/40 backdrop-blur-sm" onClick={() => set(false)} />
      <div className="relative w-full max-w-xl animate-pop overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 text-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search resources, IPs, pages, or type a command…"
            className="h-13 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-faint focus-visible:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(cmds.length - 1, i + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
              else if (e.key === 'Enter') { e.preventDefault(); cmds[idx]?.run() }
              else if (e.key === 'Escape') set(false);
            }}
          />
          <Kbd>esc</Kbd>
        </div>
        <div ref={listRef} className="max-h-[56vh] overflow-y-auto p-2">
          {cmds.length === 0 && <div className="py-10 text-center text-sm text-muted">No results for “{q}”</div>}
          {groups.map((g) => (
            <div key={g} className="mb-1">
              <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{g}</div>
              {cmds.filter((c) => c.group === g).map((c) => {
                n++;
                const i = n;
                return (
                  <button key={c.id} data-idx={i} onMouseMove={() => setIdx(i)} onClick={c.run}
                    className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left', idx === i ? 'bg-surface-2' : '')}>
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface" style={{ color: c.iconColor }}><c.icon className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-fg">{c.label}</span>
                      {c.sub && <span className="block truncate text-[11px] text-muted">{c.sub}</span>}
                    </span>
                    {idx === i && (c.group === 'Create' ? <ArrowRight className="size-4 text-faint" /> : <CornerDownLeft className="size-3.5 text-faint" />)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-line bg-surface-2/50 px-4 py-2 text-[11px] text-muted">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
          <span className="ml-auto flex items-center gap-1"><Kbd>⌘</Kbd><Kbd>K</Kbd> toggle</span>
        </div>
      </div>
    </div>,
    overlayRoot(),
  );
}
