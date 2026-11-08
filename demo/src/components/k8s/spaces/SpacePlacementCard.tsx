import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Boxes, CheckCircle2, AlertTriangle, ChevronDown, Pin, Wand2 } from 'lucide-react';
import { useGet } from '@/api/hooks';
import { Skeleton } from '@/components/ui/misc';
import { usePro } from '@/store/ui';
import { cn } from '@/lib/cn';
import type { PlatformClusterCandidate, SpaceQuota } from '@/types';
import { num1 } from './spaceUi';

export interface SpacePlacement { chosen: PlatformClusterCandidate | null; candidates: PlatformClusterCandidate[]; why?: string | null }

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms]);
  return d;
}

/** Dry-run of space placement: which platform cluster a new space lands on. */
export function useSpacePlacement(p: { locationId: string; quota: SpaceQuota; projectId: string }) {
  const q = useDebounced(`locationId=${p.locationId}&cpuCores=${p.quota.cpuCores}&memoryGi=${p.quota.memoryGi}&storageGi=${p.quota.storageGi}${p.projectId ? `&projectId=${p.projectId}` : ''}`);
  return useGet<SpacePlacement>(['k8sSpaces', 'placement'], p.locationId ? `/k8sSpaces/placement-preview?${q}` : null);
}

export function SpacePlacementCard({ placement, isLoading, error, quota, overrideId }: {
  placement: SpacePlacement | undefined; isLoading: boolean; error?: unknown; quota: SpaceQuota; overrideId?: string;
}) {
  const pro = usePro();
  const [showOthers, setShowOthers] = useState(false);
  const pinned = overrideId ? placement?.candidates.find((c) => c.id === overrideId) ?? null : null;
  const target = overrideId ? pinned : placement?.chosen ?? null;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg"><Boxes className="size-4 text-muted" /> Placement</div>
        {placement && (overrideId
          ? <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"><Pin className="size-3" /> Pinned</span>
          : <span className="inline-flex items-center gap-1 rounded-md bg-brand-500/10 px-1.5 py-0.5 text-[11px] font-medium text-brand-700 dark:text-brand-300"><Wand2 className="size-3" /> Automatic</span>)}
      </div>
      <div className="px-4 py-3.5">
        {isLoading && !placement ? (
          <div className="space-y-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-full" /></div>
        ) : !placement ? (
          <p className="text-xs text-muted">{error ? 'Placement preview is not available right now. The platform picks a cluster when you create the space.' : 'Pick a location to see where your space will run.'}</p>
        ) : !target ? (
          <div className="flex items-start gap-2.5 text-[13px]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-500" />
            <div>
              <div className="font-medium text-fg">No shared cluster here has room</div>
              <p className="mt-0.5 text-xs text-muted">Choose a smaller size or another location.</p>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#326ce5]/10 text-[#326ce5]"><Boxes className="size-[18px]" /></span>
              <div className="min-w-0">
                {pro ? <Link to={`/hardware/platform-clusters/${target.id}`} className="block truncate text-[15px] font-semibold text-fg hover:text-brand-500">{target.name}</Link>
                  : <div className="truncate text-[15px] font-semibold text-fg">{target.name}</div>}
                <div className="truncate text-xs text-muted">Kubernetes v{target.version} · {target.tenants} other space{target.tenants === 1 ? '' : 's'}</div>
              </div>
            </div>
            {target.fits ? (
              placement.why && !overrideId && <p className="mt-2.5 flex items-start gap-1.5 text-xs text-fg-2"><CheckCircle2 className="mt-px size-3.5 shrink-0 text-emerald-500" /> {placement.why}</p>
            ) : (
              <p className="mt-2.5 flex items-start gap-1.5 text-xs text-rose-500"><AlertTriangle className="mt-px size-3.5 shrink-0" /> {target.reason ?? 'Not enough headroom'}</p>
            )}
            <div className="mt-3 space-y-2.5">
              <Headroom label="CPU" want={quota.cpuCores} free={target.free.cpuCores} unit=" cores" />
              <Headroom label="Memory" want={quota.memoryGi} free={target.free.memoryGi} unit=" GiB" />
            </div>
            <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
              <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-sky-500" /> this space</span>
              <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-surface-3 ring-1 ring-inset ring-line" /> free headroom</span>
            </div>
          </div>
        )}
      </div>
      {pro && placement && placement.candidates.length > 1 && (
        <div className="border-t border-line">
          <button type="button" onClick={() => setShowOthers((o) => !o)} className="flex w-full items-center gap-2 px-4 py-2 text-xs text-muted hover:text-fg">
            <span className="flex-1 text-left">{placement.candidates.filter((c) => c.fits).length} of {placement.candidates.length} shared clusters fit</span>
            <ChevronDown className={cn('size-3.5 transition-transform', showOthers && 'rotate-180')} />
          </button>
          {showOthers && (
            <ul className="space-y-1.5 px-4 pb-3">
              {placement.candidates.map((c) => (
                <li key={c.id} className={cn('flex items-center gap-2 text-xs', c.id === target?.id ? 'font-medium text-fg' : c.fits ? 'text-fg-2' : 'text-faint')}>
                  <span className={cn('size-1.5 shrink-0 rounded-full', c.fits ? 'bg-emerald-500' : 'bg-line-strong')} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="max-w-[55%] shrink-0 truncate text-right tabular" title={c.reason ?? undefined}>{c.fits ? `${num1(c.free.cpuCores)} cores free` : c.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Headroom({ label, want, free, unit }: { label: string; want: number; free: number; unit: string }) {
  const over = want > free;
  const pct = free > 0 ? Math.min(100, (want / free) * 100) : 100;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px]">
        <span className="text-muted">{label}</span>
        <span className={cn('tabular', over ? 'text-rose-500' : 'text-fg-2')}>{num1(want)} of {num1(Math.max(0, free))}{unit} free</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-surface-3">
        <div className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-300', over ? 'bg-rose-500' : 'bg-sky-500')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
