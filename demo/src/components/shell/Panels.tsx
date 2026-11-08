import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Bell, CheckCheck, AlertTriangle, CheckCircle2, Info, XCircle, Activity, ChevronUp, ChevronDown, X } from 'lucide-react';
import { useList, useApiMutation } from '@/api/hooks';
import { api } from '@/api/client';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Popover } from '../ui/Menu';
import { OperationRunner, OperationInline } from '../resource/OperationRunner';
import { kindLink } from '@/lib/kinds';
import { useUi, useWide } from '@/store/ui';
import type { Notification, Operation } from '@/types';

const LEVEL = {
  info: { icon: Info, cls: 'text-brand-500' },
  success: { icon: CheckCircle2, cls: 'text-emerald-500' },
  warning: { icon: AlertTriangle, cls: 'text-amber-500' },
  error: { icon: XCircle, cls: 'text-rose-500' },
};

export function NotificationsButton() {
  const { items } = useList<Notification>('notifications');
  const navigate = useNavigate();
  const unread = items.filter((n) => !n.read).length;
  const readAll = useApiMutation(() => api.post('/notifications/read-all'), { silent: true });
  const read = useApiMutation((id: string) => api.action('notifications', id, 'read'), { silent: true });
  return (
    <Popover
      className="w-[min(400px,calc(100vw-1rem))]"
      trigger={(open) => (
        <button aria-label="Notifications" className={cn('relative flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg', open && 'bg-surface-2 text-fg')}>
          <Bell className="size-[18px]" />
          {unread > 0 && <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-4 text-white ring-2 ring-surface">{unread}</span>}
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-semibold text-fg">Notifications</span>
            <button onClick={() => readAll.mutate()} className="flex items-center gap-1 text-xs text-muted hover:text-fg"><CheckCheck className="size-3.5" /> Mark all read</button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 && <div className="p-8 text-center text-sm text-muted">You're all caught up.</div>}
            {items.slice(0, 30).map((n) => {
              const L = LEVEL[n.level];
              return (
                <button key={n.id} onClick={() => { if (!n.read) read.mutate(n.id); if (n.link) { close(); navigate(n.link) } }}
                  className={cn('flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-surface-2', !n.read && 'bg-brand-500/[0.03]')}>
                  <L.icon className={cn('mt-0.5 size-4 shrink-0', L.cls)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-fg">{n.title}</span>
                      {!n.read && <span className="size-1.5 shrink-0 rounded-full bg-brand-500" />}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">{n.message}</span>
                    <span className="mt-1 block text-[11px] text-faint">{timeAgo(n.time)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Popover>
  );
}

/** Floating tray (bottom-right) listing running & recently finished operations. */
export function OperationsTray() {
  const { items } = useList<Operation>('operations', { limit: 40 });
  const [expanded, setExpanded] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const aiOpen = useUi((s) => s.aiOpen);
  const wide = useWide();
  const trayRight = wide ? (aiOpen ? (window.innerWidth >= 1536 ? 416 : 376) : 64) : 16;
  const recentCutoff = Date.now() - 10_000;
  const visible = items.filter((o) => !dismissed.has(o.id) && (o.status === 'running' || Date.parse(o.finishedAt ?? o.createdAt) > recentCutoff));
  const running = visible.filter((o) => o.status === 'running');
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 5000); return () => clearInterval(t) }, []);
  if (!visible.length) return null;
  const focused = visible.find((o) => o.id === focus);
  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[min(380px,calc(100vw-2rem))] animate-pop transition-[right]" style={{ right: trayRight }}>
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
        <button onClick={() => setExpanded((e) => !e)} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left">
          <span className="relative flex size-6 items-center justify-center rounded-md bg-brand-500/10 text-brand-500">
            <Activity className="size-3.5" />
            {running.length > 0 && <span className="absolute -right-0.5 -top-0.5 size-2 animate-pulse-soft rounded-full bg-brand-500" />}
          </span>
          <span className="flex-1 text-[13px] font-medium text-fg">{running.length ? `${running.length} operation${running.length > 1 ? 's' : ''} running` : 'Operations finished'}</span>
          {expanded ? <ChevronDown className="size-4 text-muted" /> : <ChevronUp className="size-4 text-muted" />}
        </button>
        {!expanded && running[0] && <div className="px-3.5 pb-3"><OperationInline op={running[0]} /></div>}
        {expanded && (
          <div className="max-h-[60vh] overflow-y-auto border-t border-line">
            {focused ? (
              <div className="p-3">
                <button onClick={() => setFocus(null)} className="mb-2 text-xs text-muted hover:text-fg">← All operations</button>
                <OperationRunner op={focused} compact />
              </div>
            ) : visible.map((o) => (
              <div key={o.id} className="flex items-center gap-2 border-b border-line px-3.5 py-2.5 last:border-0 hover:bg-surface-2">
                <button className="min-w-0 flex-1 text-left" onClick={() => setFocus(o.id)}>
                  {o.status === 'running' ? <OperationInline op={o} /> : (
                    <div className="flex items-center gap-2 text-xs">
                      {o.status === 'succeeded' ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <XCircle className="size-3.5 text-rose-500" />}
                      <span className="truncate text-fg-2">{o.title}</span>
                    </div>
                  )}
                  <div className="mt-0.5 truncate text-[11px] text-faint">{o.title} · {timeAgo(o.createdAt)}</div>
                </button>
                {kindLink(o.target.type, o.target.id) && <Link to={kindLink(o.target.type, o.target.id)!} className="text-[11px] text-brand-500 hover:underline">Open</Link>}
                {o.status !== 'running' && <button onClick={() => setDismissed(new Set([...dismissed, o.id]))} className="rounded p-0.5 text-faint hover:text-fg" aria-label="Dismiss"><X className="size-3.5" /></button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
