import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Cpu, Cloud, CheckCircle2, AlertTriangle, Pin, Wand2, ChevronDown, Lock, Ban } from 'lucide-react';
import { useGet } from '@/api/hooks';
import { cn } from '@/lib/cn';
import { flagOf } from './placementUtil';
import { Skeleton } from '../ui/misc';

export interface HostView {
  id: string; name: string; rack: string; rackUnit: number; model: string; status: string;
  gpus: { model: string; count: number }[]; fits: boolean; reason: string | null;
  /** host policy excludes this workload (wrong role / reserved for others) */
  excluded?: 'role' | 'access' | null;
  /** reserved for this workload's project/account */
  dedicated?: boolean;
  capacity: { vcpus: number; ramGB: number; gpus: number }; used: { vcpus: number; ramGB: number; gpus: number; vms: number };
  free: { vcpus: number; ramGB: number; gpus: number };
}
export interface PlacementResponse {
  kind: 'selfHosted' | 'cloud';
  location: { id: string; name: string; city: string; country: string };
  provider?: { id: string; name: string; status: string } | null;
  mode?: 'auto' | 'manual';
  chosen?: HostView | null;
  why?: string | null;
  candidates?: HostView[];
  projectId?: string | null;
  excluded?: { role: number; access: number };
}

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms]);
  return d;
}

/** Dry-run of the scheduler: shows which physical host a new VM would land on, live as the form changes. */
export function usePlacement(p: { locationId: string; vcpus: number; ramGB: number; gpu?: { model: string; count: number } | null; hostId?: string; projectId?: string }) {
  const q = useDebounced(`locationId=${p.locationId}&vcpus=${p.vcpus}&ramGB=${p.ramGB}&gpus=${p.gpu?.count ?? 0}&gpuModel=${p.gpu?.model ?? ''}${p.hostId ? `&hostId=${p.hostId}` : ''}${p.projectId ? `&projectId=${p.projectId}` : ''}`);
  return useGet<PlacementResponse>(['hosts', 'placement'], p.locationId ? `/vms/placement-preview?${q}` : null);
}

export function PlacementPreview({ locationId, vcpus, ramGB, gpu, hostId, projectId, onChangeHost }: {
  locationId: string; vcpus: number; ramGB: number; gpu?: { model: string; count: number } | null; hostId?: string; projectId?: string; onChangeHost?: () => void;
}) {
  const { data, isLoading } = usePlacement({ locationId, vcpus, ramGB, gpu, hostId, projectId });
  const allowed = (data?.candidates ?? []).filter((c) => !c.excluded);
  const [showOthers, setShowOthers] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg"><Cpu className="size-4 text-muted" /> Placement</div>
        {data?.kind === 'selfHosted' && (
          data.mode === 'manual'
            ? <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"><Pin className="size-3" /> Pinned</span>
            : <span className="inline-flex items-center gap-1 rounded-md bg-brand-500/10 px-1.5 py-0.5 text-[11px] font-medium text-brand-700 dark:text-brand-300"><Wand2 className="size-3" /> Automatic</span>
        )}
      </div>

      <div className="px-4 py-3.5">
        {isLoading && !data ? (
          <div className="space-y-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-full" /></div>
        ) : !data ? null : data.kind === 'cloud' ? (
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-500"><Cloud className="size-[18px]" /></span>
            <div className="min-w-0 text-[13px]">
              <div className="font-semibold text-fg">{data.provider?.name ?? 'Cloud provider'}</div>
              <div className="text-muted">{flagOf(data.location.country)} {data.location.city} · burst capacity</div>
              <p className="mt-1.5 text-xs text-muted">The provider allocates the physical server. Autark manages it like any other VM.</p>
              {data.provider && data.provider.status !== 'connected' && <p className="mt-1.5 text-xs text-rose-500">Provider is {data.provider.status} — creation will fail until it is fixed.</p>}
            </div>
          </div>
        ) : !data.chosen ? (
          <div className="flex items-start gap-2.5 text-[13px]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-500" />
            <div>
              {(data.candidates?.length ?? 0) > 0 && !allowed.length ? <>
                <div className="font-medium text-fg">No host in {data.location.name} may run VMs for this project</div>
                <p className="mt-0.5 text-xs text-muted">All hosts are reserved for others or not enabled for VMs. Choose another location or ask an admin to adjust <Link to="/hardware/bare-metals" className="text-brand-500 hover:underline">host policies</Link>.</p>
              </> : <>
                <div className="font-medium text-fg">No host in {data.location.name} has room</div>
                <p className="mt-0.5 text-xs text-muted">Choose a smaller size, another location, or <Link to="/hardware/bare-metals/new" className="text-brand-500 hover:underline">add a server</Link>.</p>
              </>}
            </div>
          </div>
        ) : (
          <>
            <ChosenHost h={data.chosen} vcpus={vcpus} ramGB={ramGB} gpus={gpu?.count ?? 0} why={data.why} pinnedBad={data.mode === 'manual' && !data.chosen.fits} />
            {onChangeHost && (
              <button type="button" onClick={onChangeHost} className="mt-3 text-xs font-medium text-brand-600 hover:underline dark:text-brand-300">
                {data.mode === 'manual' ? 'Change host' : 'Choose a host yourself'}
              </button>
            )}
          </>
        )}
      </div>

      {data?.kind === 'selfHosted' && (data.candidates?.length ?? 0) > 1 && (
        <div className="border-t border-line">
          <button type="button" onClick={() => setShowOthers((o) => !o)} className="flex w-full items-center gap-2 px-4 py-2 text-xs text-muted hover:text-fg">
            <span className="flex-1 text-left">
              {data.candidates!.filter((c) => c.fits).length} of {allowed.length} eligible hosts fit
              {(data.excluded?.access ?? 0) + (data.excluded?.role ?? 0) > 0 && <span className="text-faint"> · {[data.excluded!.access ? `${data.excluded!.access} reserved` : '', data.excluded!.role ? `${data.excluded!.role} other role` : ''].filter(Boolean).join(', ')}</span>}
            </span>
            <ChevronDown className={cn('size-3.5 transition-transform', showOthers && 'rotate-180')} />
          </button>
          {showOthers && (
            <ul className="space-y-1.5 px-4 pb-3">
              {data.candidates!.map((c) => (
                <li key={c.id} className={cn('flex items-center gap-2 text-xs', c.id === data.chosen?.id ? 'font-medium text-fg' : c.fits ? 'text-fg-2' : 'text-faint')}>
                  {c.excluded === 'access' ? <Lock className="size-3 shrink-0 text-amber-500" /> : c.excluded === 'role' ? <Ban className="size-3 shrink-0" /> : <span className={cn('mx-[3px] size-1.5 shrink-0 rounded-full', c.fits ? 'bg-emerald-500' : 'bg-line-strong')} />}
                  <span className="min-w-0 flex-1 truncate">{c.name}{c.gpus.length ? ` · ${c.gpus.map((g) => `${g.count}×${g.model}`).join(', ')}` : ''}{c.dedicated ? <span className="ml-1 rounded bg-amber-500/10 px-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">dedicated</span> : null}</span>
                  <span className="max-w-[55%] shrink-0 truncate text-right tabular" title={c.reason ?? undefined}>{c.fits ? `${c.free.ramGB} GB free` : c.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ChosenHost({ h, vcpus, ramGB, gpus, why, pinnedBad }: { h: HostView; vcpus: number; ramGB: number; gpus: number; why?: string | null; pinnedBad: boolean }) {
  return (
    <div>
      <div className="flex items-start gap-3">
        <RackGlyph />
        <div className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <Link to={`/hardware/bare-metals/${h.id}`} className="block truncate text-[15px] font-semibold text-fg hover:text-brand-500">{h.name}</Link>
            {h.dedicated && <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-500/10 px-1 text-[10px] font-medium text-amber-700 dark:text-amber-400"><Lock className="size-2.5" />dedicated</span>}
          </span>
          <div className="truncate text-xs text-muted">Rack {h.rack} · U{h.rackUnit} · {h.model}</div>
        </div>
      </div>
      {pinnedBad ? (
        <p className="mt-2.5 flex items-start gap-1.5 text-xs text-rose-500"><AlertTriangle className="mt-px size-3.5 shrink-0" /> {h.reason}</p>
      ) : why && (
        <p className="mt-2.5 flex items-start gap-1.5 text-xs text-fg-2"><CheckCircle2 className="mt-px size-3.5 shrink-0 text-emerald-500" /> {why}</p>
      )}
      <div className="mt-3 space-y-2.5">
        <AllocBar label="vCPU" used={h.used.vcpus} add={vcpus} cap={h.capacity.vcpus} unit="" />
        <AllocBar label="Memory" used={h.used.ramGB} add={ramGB} cap={h.capacity.ramGB} unit=" GB" />
        {(gpus > 0 || h.capacity.gpus > 0) && <AllocBar label="GPU" used={h.used.gpus} add={gpus} cap={h.capacity.gpus} unit="" />}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-line-strong" /> already allocated</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-brand-500" /> this VM</span>
      </div>
    </div>
  );
}

function AllocBar({ label, used, add, cap, unit }: { label: string; used: number; add: number; cap: number; unit: string }) {
  const after = used + add;
  const over = after > cap;
  const pct = (n: number) => `${cap ? Math.min(100, (n / cap) * 100) : 0}%`;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px]">
        <span className="text-muted">{label}</span>
        <span className={cn('tabular', over ? 'text-rose-500' : 'text-fg-2')}>{after}{unit} / {cap}{unit}</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-surface-3">
        <div className="absolute inset-y-0 left-0 bg-line-strong" style={{ width: pct(used) }} />
        <div className={cn('absolute inset-y-0 transition-all duration-300', over ? 'bg-rose-500' : 'bg-brand-500')} style={{ left: pct(used), width: `calc(${pct(after)} - ${pct(used)})` }} />
      </div>
    </div>
  );
}

/** Tiny server-in-rack glyph. */
function RackGlyph() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" className="shrink-0" aria-hidden>
      <rect x="1" y="1" width="32" height="32" rx="7" fill="var(--surface-2)" stroke="var(--line)" />
      {[7, 13.5, 20].map((y, i) => (
        <g key={y}>
          <rect x="6" y={y} width="22" height="5" rx="1.5" fill={i === 1 ? '#5b67f8' : 'var(--line-strong)'} />
          <circle cx="9" cy={y + 2.5} r="1" fill={i === 1 ? '#fff' : '#10b981'} />
        </g>
      ))}
    </svg>
  );
}
