import { Link } from 'react-router';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Role } from '@/types';

/** Role chips; system roles show a lock. Pass a lookup map of roles. */
export function RoleChips({ roleIds, roles, max = 3, link = true, className }: { roleIds: string[]; roles: Map<string, Role>; max?: number; link?: boolean; className?: string }) {
  if (!roleIds.length) return <span className="text-faint">No roles</span>;
  const shown = roleIds.slice(0, max);
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {shown.map((id) => {
        const r = roles.get(id);
        const admin = id === 'role-admin';
        const cls = cn('inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11.5px] font-medium ring-1 ring-inset',
          admin ? 'bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300' : r?.system ? 'bg-surface-3 text-fg-2 ring-line-strong/60' : 'bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300');
        const body = <>{r?.system && <Lock className="size-2.5 opacity-60" />}{r?.name ?? id}</>;
        return link ? <Link key={id} to={`/iam/roles/${id}`} onClick={(e) => e.stopPropagation()} className={cn(cls, 'hover:ring-brand-500/40')}>{body}</Link> : <span key={id} className={cls}>{body}</span>;
      })}
      {roleIds.length > max && <span className="text-[11px] text-muted" title={roleIds.slice(max).map((id) => roles.get(id)?.name ?? id).join(', ')}>+{roleIds.length - max}</span>}
    </div>
  );
}

/** Compact project scope display: "All projects" or colored project dots. */
export function ProjectScope({ projectIds, projects, className }: { projectIds: string[] | '*'; projects: Map<string, { id: string; name: string; color: string }>; className?: string }) {
  if (projectIds === '*') return <span className={cn('inline-flex items-center gap-1 text-[12.5px] text-fg-2', className)}><span className="size-1.5 rounded-full bg-gradient-to-r from-brand-500 to-violet-500" />All projects</span>;
  if (!projectIds.length) return <span className="text-faint">None</span>;
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5', className)}>
      {projectIds.map((id) => {
        const p = projects.get(id);
        return <span key={id} className="inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] text-fg-2"><span className="size-1.5 rounded-full" style={{ background: p?.color ?? '#94a3b8' }} />{p?.name ?? id}</span>;
      })}
    </div>
  );
}
