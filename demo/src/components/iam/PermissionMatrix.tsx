import { useState } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SERVICES, ACTIONS, SERVICE_META, ACTION_META, has, toggle, setRow, setColumn, blastRadius, type Perms, type Action } from './permissions';
import type { EffectivePermissions, Service } from '@/types';

const ROLE_COLORS = ['#5b67f8', '#a855f7', '#06b6d4', '#f59e0b', '#10b981', '#ec4899', '#64748b'];
export const roleColor = (i: number) => ROLE_COLORS[i % ROLE_COLORS.length];

type Grants = EffectivePermissions['grants'];

/**
 * Service × action permission grid.
 * - `perms` + `onChange`: interactive editor (click cells; click a row/column header to toggle all)
 * - `perms` only: read-only view
 * - `grants` + `roles`: effective-permissions heatmap, each cell shows which roles grant it
 * - `baseline`: highlights cells that differ (unsaved changes)
 */
export function PermissionMatrix({ perms, onChange, grants, roles, baseline, className, showRisk = true }: {
  perms?: Perms; onChange?: (p: Perms) => void; grants?: Grants; roles?: { id: string; name: string }[]; baseline?: Perms; className?: string; showRisk?: boolean;
}) {
  const [hover, setHover] = useState<{ s: Service; a: Action } | null>(null);
  const [focusRole, setFocusRole] = useState<string | null>(null);
  const editable = !!onChange && !grants;
  const roleIdx = new Map((roles ?? []).map((r, i) => [r.id, i]));
  const roleName = (id: string) => roles?.find((r) => r.id === id)?.name ?? id;
  const risky = new Set(showRisk ? blastRadius(grants ? undefined : perms).map((r) => `${r.service}:${r.action}`) : []);

  const isOn = (s: Service, a: Action) => (grants ? !!grants[s]?.[a]?.length : has(perms, s, a));
  const rowAll = (s: Service) => ACTIONS.every((a) => isOn(s, a));
  const colAll = (a: Action) => SERVICES.every((s) => isOn(s, a));

  const hoverInfo = hover && (() => {
    const by = grants?.[hover.s]?.[hover.a] ?? [];
    const on = isOn(hover.s, hover.a);
    const label = `${SERVICE_META[hover.s].label} · ${ACTION_META[hover.a].label}`;
    if (grants) return on ? <><b className="text-fg">{label}</b> granted by {by.map((id, i) => <span key={id}>{i > 0 && ', '}<span className="font-medium" style={{ color: roleColor(roleIdx.get(id) ?? 0) }}>{roleName(id)}</span></span>)}</> : <><b className="text-fg">{label}</b> — not granted by any role</>;
    return <><b className="text-fg">{label}</b> — {ACTION_META[hover.a].hint}{on ? '' : ' (not granted)'}{risky.has(`${hover.s}:${hover.a}`) && <span className="ml-1 text-rose-500">· high impact</span>}</>;
  })();

  return (
    <div className={className}>
      {grants && roles && roles.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted">Granted via</span>
          {roles.map((r, i) => (
            <button key={r.id} type="button" onMouseEnter={() => setFocusRole(r.id)} onMouseLeave={() => setFocusRole(null)} onClick={() => setFocusRole(focusRole === r.id ? null : r.id)}
              className={cn('inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors', focusRole === r.id ? 'border-line-strong bg-surface-2 text-fg' : 'border-line text-fg-2 hover:bg-surface-2')}>
              <span className="size-2 rounded-sm" style={{ background: roleColor(i) }} />{r.name}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] border-separate border-spacing-1 text-left">
          <thead>
            <tr>
              <th className="w-40 px-1 text-xs font-medium text-muted">Service</th>
              {ACTIONS.map((a) => (
                <th key={a} className="px-0 text-center">
                  {editable ? (
                    <button type="button" onClick={() => onChange!(setColumn(perms ?? {}, a, !colAll(a)))} title={`Toggle ${ACTION_META[a].label} for all services`}
                      className="w-full rounded-md py-1 text-[11px] font-semibold uppercase tracking-wide text-muted hover:bg-surface-2 hover:text-fg">{ACTION_META[a].label}</button>
                  ) : <span className="block py-1 text-[11px] font-semibold uppercase tracking-wide text-muted" title={ACTION_META[a].hint}>{ACTION_META[a].label}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SERVICES.map((s) => {
              const meta = SERVICE_META[s];
              return (
                <tr key={s}>
                  <td className="px-0">
                    {editable ? (
                      <button type="button" onClick={() => onChange!(setRow(perms ?? {}, s, !rowAll(s)))} title={`Toggle all actions for ${meta.label}`}
                        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] text-fg-2 hover:bg-surface-2 hover:text-fg">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: meta.color }} />{meta.label}
                      </button>
                    ) : (
                      <span className="flex items-center gap-2 px-1.5 py-1 text-[13px] text-fg-2"><span className="size-2 shrink-0 rounded-full" style={{ background: meta.color }} />{meta.label}</span>
                    )}
                  </td>
                  {ACTIONS.map((a) => {
                    const on = isOn(s, a);
                    const by = grants?.[s]?.[a] ?? [];
                    const changed = baseline && has(baseline, s, a) !== on;
                    const risk = on && risky.has(`${s}:${a}`);
                    const dim = focusRole && !by.includes(focusRole);
                    const cellCls = cn(
                      'relative flex h-8 w-full items-center justify-center rounded-md transition-all',
                      on ? (grants ? 'text-white' : 'bg-brand-500 text-white') : 'bg-surface-2 text-transparent',
                      editable && (on ? 'hover:bg-brand-600' : 'hover:bg-surface-3 hover:text-faint'),
                      changed && 'ring-2 ring-amber-500 ring-offset-1 ring-offset-surface',
                      dim && 'opacity-25',
                    );
                    const style = grants && on ? { background: by.length > 1 ? `linear-gradient(135deg, ${by.map((id, i) => `${roleColor(roleIdx.get(id) ?? 0)} ${(i / by.length) * 100}% ${((i + 1) / by.length) * 100}%`).join(', ')})` : roleColor(roleIdx.get(by[0]) ?? 0) } : undefined;
                    const content = (
                      <>
                        {grants && on ? <span className="text-[10px] font-semibold tabular">{by.length > 1 ? `×${by.length}` : <Check className="size-3.5" strokeWidth={3} />}</span> : <Check className="size-3.5" strokeWidth={3} />}
                        {risk && <AlertTriangle className="absolute right-0.5 top-0.5 size-2.5 text-amber-200" />}
                      </>
                    );
                    const title = grants ? (on ? `${meta.label} · ${ACTION_META[a].label}: ${by.map(roleName).join(', ')}` : `${meta.label} · ${ACTION_META[a].label}: not granted`) : `${meta.label} · ${ACTION_META[a].label}`;
                    return (
                      <td key={a} className="p-0" onMouseEnter={() => setHover({ s, a })} onMouseLeave={() => setHover(null)}>
                        {editable
                          ? <button type="button" aria-pressed={on} aria-label={title} title={title} onClick={() => onChange!(toggle(perms ?? {}, s, a))} className={cellCls}>{content}</button>
                          : <div className={cellCls} style={style} title={title} onClick={() => setHover({ s, a })}>{content}</div>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 min-h-5 text-xs text-muted">
        {hoverInfo ?? (editable ? 'Click a cell to toggle · click a service or action header to toggle the whole row/column · granting any action implies Read.' : grants ? 'Hover a cell to see which role grants it.' : null)}
      </div>
    </div>
  );
}

/** Tiny 11 (services) × 5 (actions) dot grid preview of a role's permissions (for lists). */
export function PermissionGlyph({ perms, size = 5, className }: { perms: Perms; size?: number; className?: string }) {
  const gap = 1.5;
  const w = SERVICES.length * (size + gap);
  const h = ACTIONS.length * (size + gap);
  return (
    <svg width={w} height={h} className={className} aria-hidden>
      {SERVICES.map((s, i) => ACTIONS.map((a, j) => (
        <rect key={`${s}${a}`} x={i * (size + gap)} y={j * (size + gap)} width={size} height={size} rx={1}
          fill={has(perms, s, a) ? (a === 'delete' ? '#f43f5e' : a === 'read' ? '#7a86ff' : '#5b67f8') : 'var(--surface-3)'} />
      )))}
    </svg>
  );
}
