import { Check, ChevronsUpDown, FolderKanban, Building, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useList } from '@/api/hooks';
import { useUi } from '@/store/ui';
import { Popover } from '../ui/Menu';
import { cn } from '@/lib/cn';
import type { Account, Project } from '@/types';

/** Combined account + project scope switcher. Changing scope refetches every list. */
export function ScopeSwitcher() {
  const { accountId, projectId, setScope } = useUi();
  const navigate = useNavigate();
  const { items: accounts } = useList<Account>('accounts');
  const { items: projects } = useList<Project>('projects');
  const account = accounts.find((a) => a.id === accountId);
  const project = projects.find((p) => p.id === projectId);
  return (
    <Popover
      align="start"
      className="w-[min(560px,calc(100vw-1rem))]"
      trigger={(open) => (
        <button className={cn('flex h-9 min-w-0 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-left shadow-card transition-colors hover:border-line-strong', open && 'border-brand-500')}>
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white" style={{ background: project?.color ?? '#64748b' }}>
            {(project?.name ?? account?.name ?? 'A').slice(0, 1)}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block max-w-[120px] truncate text-[11px] sm:max-w-[180px] text-muted">{account?.name ?? '…'}</span>
            <span className="block max-w-[120px] truncate text-[13px] sm:max-w-[180px] font-medium text-fg">{project?.name ?? 'All projects'}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-faint" />
        </button>
      )}
    >
      {(close) => (
        <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr]">
          <div className="border-b border-line p-2 sm:border-b-0 sm:border-r">
            <div className="px-2 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint">Account</div>
            {accounts.map((a) => (
              <button key={a.id} onClick={() => setScope(a.id, '')} className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface-2', a.id === accountId ? 'bg-surface-2 text-fg' : 'text-fg-2')}>
                <Building className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{a.name}</span>
                  <span className="block text-[11px] capitalize text-faint">{a.plan}</span>
                </span>
                {a.id === accountId && <Check className="size-4 text-brand-500" />}
              </button>
            ))}
          </div>
          <div className="p-2">
            <div className="px-2 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint">Project</div>
            <button onClick={() => { setScope(accountId, ''); close() }} className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface-2', !projectId ? 'text-fg' : 'text-fg-2')}>
              <FolderKanban className="size-4 text-muted" /><span className="flex-1">All projects</span>{!projectId && <Check className="size-4 text-brand-500" />}
            </button>
            {projects.filter((p) => p.accountId === accountId).map((p) => (
              <button key={p.id} onClick={() => { setScope(accountId, p.id); close() }} className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface-2', p.id === projectId ? 'text-fg' : 'text-fg-2')}>
                <span className="size-4 shrink-0 rounded" style={{ background: p.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.name}</span>
                  <span className="block truncate text-[11px] text-faint">{p.description}</span>
                </span>
                {p.id === projectId && <Check className="size-4 text-brand-500" />}
              </button>
            ))}
            <button onClick={() => { close(); navigate('/iam/project-allowances?new=1') }} className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-brand-600 hover:bg-brand-500/10 dark:text-brand-300">
              <Plus className="size-4" /> New project
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
