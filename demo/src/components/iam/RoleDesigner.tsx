import { ShieldAlert, ShieldCheck, Sparkles, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PermissionMatrix } from './PermissionMatrix';
import { PRESETS, describe, blastRadius, riskScore, countPermissions, MAX_PERMISSIONS, SERVICE_META, ACTION_META, type Perms } from './permissions';

/** Preset buttons + interactive matrix. */
export function RoleMatrixEditor({ perms, onChange, baseline, error }: { perms: Perms; onChange: (p: Perms) => void; baseline?: Perms; error?: string }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted"><Sparkles className="size-3.5" />Start from a preset</div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" onClick={() => onChange(p.perms())} title={p.description}
              className="inline-flex h-7 items-center rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-fg-2 transition-colors hover:border-brand-500 hover:text-brand-600 dark:hover:text-brand-300">
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <PermissionMatrix perms={perms} onChange={onChange} baseline={baseline} />
      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}

/** Plain-language summary, permission count and blast radius for a permission set. */
export function RoleSummary({ perms, title = 'What this role can do' }: { perms: Perms; title?: string }) {
  const n = countPermissions(perms);
  const risks = blastRadius(perms);
  const score = riskScore(perms);
  const tone = score >= 70 ? 'text-rose-600 dark:text-rose-400' : score >= 35 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';
  const bar = score >= 70 ? 'bg-rose-500' : score >= 35 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <>
      <Card>
        <CardHeader title={title} description={`${n} of ${MAX_PERMISSIONS} permissions`} />
        <CardBody>
          <ul className="space-y-1.5 text-[13px] leading-relaxed text-fg-2">
            {describe(perms).map((l) => <li key={l} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-brand-500" />{l}</li>)}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader icon={risks.length ? ShieldAlert : ShieldCheck} title="Blast radius" description="What could go wrong if a holder's credentials leak" />
        <CardBody className="space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs"><span className="text-muted">Risk</span><span className={cn('font-semibold', tone)}>{score >= 70 ? 'High' : score >= 35 ? 'Medium' : 'Low'} · {score}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3"><div className={cn('h-full rounded-full transition-all duration-500', bar)} style={{ width: `${score}%` }} /></div>
          </div>
          {risks.length === 0 ? <p className="text-[13px] text-muted">No destructive or privilege-escalating permissions. Safe to hand out broadly.</p> : (
            <ul className="space-y-2">
              {risks.slice(0, 6).map((r) => (
                <li key={`${r.service}${r.action}`} className="flex gap-2 text-[12.5px]">
                  <AlertTriangle className={cn('mt-0.5 size-3.5 shrink-0', r.level === 'high' ? 'text-rose-500' : 'text-amber-500')} />
                  <span><b className="font-medium text-fg">{SERVICE_META[r.service].label} · {ACTION_META[r.action].label}</b> <span className="text-muted">— {r.text}</span></span>
                </li>
              ))}
              {risks.length > 6 && <li className="text-xs text-muted">+{risks.length - 6} more</li>}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
