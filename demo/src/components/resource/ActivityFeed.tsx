import { CheckCircle2, XCircle, Terminal, Code2, Bot, MonitorSmartphone, Cog } from 'lucide-react';
import { useList } from '@/api/hooks';
import { timeAgo, dateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { ResourceLink } from './ResourceLink';
import { EmptyState, Skeleton } from '../ui/misc';
import type { AuditEvent, ResourceKind } from '@/types';
import { KINDS } from '@/lib/kinds';
import { usePro } from '@/store/ui';

const VERB: Record<string, string> = {
  create: 'created', delete: 'deleted', update: 'updated', start: 'started', stop: 'stopped', forceStop: 'force-stopped', reboot: 'rebooted', restart: 'restarted',
  resize: 'resized', scale: 'scaled', migrate: 'migrated', snapshot: 'snapshot taken', restore: 'restored', rebuild: 'rebuilt', clone: 'cloned', backup: 'backed up',
  attach: 'attached', detach: 'detached', attachVolume: 'volume attached', detachVolume: 'volume detached', assignIp: 'IP assigned', unassignIp: 'IP removed',
  upgrade: 'upgraded', invite: 'invited', allocate: 'allocated', release: 'released', sync: 'synced', rotate: 'credentials rotated', rotateCredentials: 'credentials rotated',
  maintenance: 'put into maintenance', enterMaintenance: 'put into maintenance', exitMaintenance: 'back from maintenance', failover: 'failed over', setFirewalls: 'firewalls changed',
};

/** "vm.create" -> "VM created" (simple mode wording). */
export function humanAction(action: string): string {
  const [kind, verb = ''] = action.split('.');
  const label = KINDS[kind as ResourceKind]?.label ?? kind;
  return `${label} ${VERB[verb] ?? verb.replace(/([A-Z])/g, ' $1').toLowerCase()}`;
}

const VIA = { console: MonitorSmartphone, api: Code2, terraform: Bot, cli: Terminal, system: Cog };

/** Audit events, optionally filtered to one target resource. */
export function ActivityFeed({ targetId, limit = 50, showTarget = false, className }: { targetId?: string; limit?: number; showTarget?: boolean; className?: string }) {
  const pro = usePro();
  const { items, isLoading } = useList<AuditEvent>('auditLog', targetId ? { 'target.id': targetId, limit } : { limit });
  if (isLoading) return <div className="space-y-3 p-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-8" />)}</div>;
  if (!items.length) return <EmptyState title="No activity yet" description="Changes to this resource will show up here." />;
  return (
    <ol className={cn('divide-y divide-line', className)}>
      {items.map((e) => {
        const Via = VIA[e.via ?? 'console'] ?? MonitorSmartphone;
        return (
          <li key={e.id} className="flex items-start gap-3 px-4 py-3">
            {e.result === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
                {pro ? <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px] text-fg">{e.action}</code> : <span className="font-medium text-fg">{humanAction(e.action)}</span>}
                {showTarget && <ResourceLink type={e.target.type} id={e.target.id} name={e.target.name} />}
                {e.details && <span className="text-muted">· {e.details}</span>}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                <Via className="size-3" />
                <span>{e.actor}</span>
                {pro && e.sourceIp && <span className="text-faint">from {e.sourceIp}</span>}
              </div>
            </div>
            <time className="shrink-0 text-xs text-faint" title={dateTime(e.when)}>{timeAgo(e.when)}</time>
          </li>
        );
      })}
    </ol>
  );
}
