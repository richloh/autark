import { Check, Lock, Globe2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useList } from '@/api/hooks';
import { useUi } from '@/store/ui';
import { Switch } from '@/components/ui/form';
import { countPermissions, MAX_PERMISSIONS } from './permissions';
import { PermissionGlyph } from './PermissionMatrix';
import type { Role, Project, Account } from '@/types';

/** Multi-select role cards with description and a permission glyph. */
export function RolePicker({ value, onChange, error, compact }: { value: string[]; onChange: (ids: string[]) => void; error?: string; compact?: boolean }) {
  const { items: roles } = useList<Role>('roles');
  return (
    <div>
      <div className={cn('grid gap-2', compact ? 'grid-cols-1 @min-[36rem]:grid-cols-2' : 'grid-cols-1 @min-[36rem]:grid-cols-2 @min-[44rem]:grid-cols-3')}>
        {roles.map((r) => {
          const on = value.includes(r.id);
          return (
            <button key={r.id} type="button" role="checkbox" aria-checked={on} onClick={() => onChange(on ? value.filter((x) => x !== r.id) : [...value, r.id])}
              className={cn('flex items-start gap-2.5 rounded-xl border p-2.5 text-left transition-all', on ? 'border-brand-500 bg-brand-500/[0.06] ring-3 ring-brand-500/15' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2/50')}>
              <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong')}>{on && <Check className="size-3" strokeWidth={3} />}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
                  {r.system && <Lock className="size-3 text-faint" />}{r.name}
                  {r.id === 'role-admin' && <span className="rounded bg-rose-500/10 px-1 text-[10px] font-semibold text-rose-600 dark:text-rose-400">full access</span>}
                </span>
                {!compact && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{r.description}</span>}
                <span className="mt-1.5 flex items-center gap-2 text-[11px] text-faint">
                  <PermissionGlyph perms={r.permissions} size={4} />
                  {countPermissions(r.permissions)}/{MAX_PERMISSIONS}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {error && <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}

/** "All projects" switch + per-project checkboxes grouped by account. */
export function ProjectScopePicker({ value, onChange, error, hideAllSwitch }: { value: string[] | '*'; onChange: (v: string[] | '*') => void; error?: string; hideAllSwitch?: boolean }) {
  const { items: projects } = useList<Project>('projects');
  const { items: accounts } = useList<Account>('accounts');
  const accountId = useUi((s) => s.accountId);
  const all = value === '*';
  const sel = all ? [] : value;
  const ordered = [...accounts].sort((a, b) => (a.id === accountId ? -1 : b.id === accountId ? 1 : 0));
  return (
    <div className="space-y-3">
      {!hideAllSwitch && <div className="rounded-xl border border-line p-3">
        <Switch checked={all} onChange={(v) => onChange(v ? '*' : [])} label={<span className="flex items-center gap-1.5"><Globe2 className="size-4 text-brand-500" />All projects, including future ones</span>} description="Recommended only for platform operators and auditors." />
      </div>}
      {!all && ordered.map((acc) => {
        const ps = projects.filter((p) => p.accountId === acc.id);
        if (!ps.length) return null;
        return (
          <div key={acc.id}>
            <div className="mb-1.5 text-xs font-medium text-muted">{acc.name}</div>
            <div className="grid [&>*]:min-w-0 grid-cols-1 gap-2 @min-[36rem]:grid-cols-2">
              {ps.map((p) => {
                const on = sel.includes(p.id);
                return (
                  <button key={p.id} type="button" role="checkbox" aria-checked={on} onClick={() => onChange(on ? sel.filter((x) => x !== p.id) : [...sel, p.id])}
                    className={cn('flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors', on ? 'border-brand-500 bg-brand-500/[0.06]' : 'border-line hover:bg-surface-2')}>
                    <span className={cn('flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong')}>{on && <Check className="size-3" strokeWidth={3} />}</span>
                    <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />
                    <span className="min-w-0 flex-1 truncate text-fg">{p.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
