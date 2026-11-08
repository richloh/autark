import { CheckCircle2, XCircle, Terminal, Code2, Bot, MonitorSmartphone, Cog } from 'lucide-react';
import { useList } from '@/api/hooks';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { timeAgo, dateTime } from '@/lib/format';
import type { AuditEvent } from '@/types';

const VIA = { console: MonitorSmartphone, api: Code2, terraform: Bot, cli: Terminal, system: Cog };

/** Audit events performed BY an identity (actor = email or "svc:name"), or any audit filter via `params`. */
export function ActorFeed({ actor, params, limit = 50, emptyText = 'No actions recorded in this account yet.', showActor }: { actor?: string; params?: Record<string, string>; limit?: number; emptyText?: string; showActor?: boolean }) {
  const { items, isLoading } = useList<AuditEvent>('auditLog', { ...(actor ? { actor } : {}), ...params, limit });
  if (isLoading) return <div className="space-y-3 p-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-8" />)}</div>;
  if (!items.length) return <EmptyState title="No activity" description={emptyText} />;
  return (
    <ol className="divide-y divide-line">
      {items.map((e) => {
        const Via = VIA[e.via ?? 'console'] ?? MonitorSmartphone;
        return (
          <li key={e.id} className="flex items-start gap-3 px-4 py-3">
            {e.result === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px] text-fg">{e.action}</code>
                <ResourceLink type={e.target.type} id={e.target.id} name={e.target.name} />
                {e.details && <span className="text-muted">· {e.details}</span>}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted"><Via className="size-3" />{showActor && <span className="text-fg-2">{e.actor}</span>}via {e.via ?? 'console'}{e.sourceIp && <span className="text-faint">from {e.sourceIp}</span>}</div>
            </div>
            <time className="shrink-0 text-xs text-faint" title={dateTime(e.when)}>{timeAgo(e.when)}</time>
          </li>
        );
      })}
    </ol>
  );
}
