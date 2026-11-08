import { overlayRoot } from '@/lib/overlay';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Cpu, MemoryStick, Gpu, Zap, Server, Lock } from 'lucide-react';
import { hostRoles, isRestricted, accessSummary, ROLE_META } from '@/lib/hostPolicy';
import { ROLE_ICON, ROLE_HEX, usePolicyNames } from './policy';
import { cn } from '@/lib/cn';
import { HOST_STATUS_HEX, HOST_TRANSITIONAL, hostStatusLabel, hostUtil, gpuTotal, Led, utilColor } from './visuals';
import type { BareMetalHost, Operation } from '@/types';

/* Front-view rack elevation (42U). Racks are drawn dark in both themes, like the real thing.
 * Each host is a faceplate of `sizeU` units at `rackUnit` (bottom U), colored by status, with
 * LEDs, a mini utilisation bar and a GPU marker. Optional "pick a slot" mode for enrollment. */

export interface RackGhost { unit: number; sizeU: number; label?: string; conflict?: boolean }

export function RackElevation({
  name, hosts, units = 42, uHeight = 14, highlightId, onSelect, ghost, pickSizeU, onPickUnit, opsByHost, className, subtitle, showRoles,
}: {
  name: string;
  hosts: BareMetalHost[];
  units?: number;
  uHeight?: number;
  highlightId?: string;
  onSelect?: (h: BareMetalHost) => void;
  ghost?: RackGhost | null;
  /** enables slot picking: hovering empty units previews a server of this height */
  pickSizeU?: number;
  onPickUnit?: (unit: number) => void;
  opsByHost?: Map<string, Operation>;
  className?: string;
  subtitle?: string;
  /** draw a role marker (tiny role icons + lock for restricted hosts) on each faceplate */
  showRoles?: boolean;
}) {
  const [tip, setTip] = useState<{ h: BareMetalHost; x: number; y: number } | null>(null);
  const [hoverU, setHoverU] = useState<number | null>(null);
  const usedU = hosts.reduce((a, h) => a + h.sizeU, 0);
  const power = hosts.reduce((a, h) => a + (h.status === 'offline' ? 0 : h.powerWatts), 0);
  const occupied = (u: number) => hosts.some((h) => u >= h.rackUnit && u <= h.rackUnit + h.sizeU - 1);
  const bayH = units * uHeight;
  const labelEvery = uHeight >= 12 ? 1 : 5;

  const preview: RackGhost | null = onPickUnit && hoverU != null && pickSizeU
    ? { unit: hoverU, sizeU: pickSizeU, conflict: hoverU + pickSizeU - 1 > units || hosts.some((h) => h.rackUnit <= hoverU + pickSizeU - 1 && h.rackUnit + h.sizeU - 1 >= hoverU) }
    : null;

  const move = (h: BareMetalHost) => (e: MouseEvent) => setTip({ h, x: e.clientX, y: e.clientY });

  return (
    <div className={cn('shrink-0', className)}>
      <div className="mb-2 flex items-end justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-fg"><Server className="size-3.5 text-muted" />Rack {name}</div>
          {subtitle && <div className="truncate text-[11px] text-muted">{subtitle}</div>}
        </div>
        <div className="text-right text-[11px] leading-tight text-muted tabular">
          <div>{usedU}/{units}U</div>
          <div className="flex items-center justify-end gap-0.5"><Zap className="size-3" />{(power / 1000).toFixed(1)} kW</div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-700 bg-gradient-to-b from-zinc-800 to-zinc-900 p-1.5 shadow-pop">
        {/* top cap */}
        <div className="mb-1 flex h-3 items-center justify-center gap-1 rounded-sm bg-zinc-950/60">
          {Array.from({ length: 10 }, (_, i) => <span key={i} className="h-0.5 w-2 rounded-full bg-zinc-700" />)}
        </div>
        <div className="flex">
          {/* left rail with U numbers */}
          <div className="relative w-6 shrink-0 select-none" style={{ height: bayH }}>
            {Array.from({ length: units }, (_, i) => i + 1).filter((u) => u % labelEvery === 0 || u === 1).map((u) => (
              <span key={u} className="absolute right-1 font-mono text-[8.5px] leading-none text-zinc-500" style={{ bottom: (u - 1) * uHeight + (uHeight - 8.5) / 2 }}>{u}</span>
            ))}
          </div>
          {/* bay */}
          <div
            className="relative flex-1 overflow-hidden rounded-[3px] border border-zinc-950 bg-zinc-950"
            style={{ height: bayH, backgroundImage: `repeating-linear-gradient(to top, transparent 0, transparent ${uHeight - 1}px, rgba(255,255,255,0.045) ${uHeight - 1}px, rgba(255,255,255,0.045) ${uHeight}px)` }}
            onMouseLeave={() => setHoverU(null)}
          >
            {/* pick layer */}
            {onPickUnit && Array.from({ length: units }, (_, i) => i + 1).map((u) => (
              <button
                type="button"
                key={u}
                aria-label={`U${u}`}
                disabled={occupied(u)}
                onMouseEnter={() => setHoverU(u)}
                onClick={() => onPickUnit(u)}
                className="absolute inset-x-0 z-0 cursor-crosshair disabled:cursor-not-allowed"
                style={{ bottom: (u - 1) * uHeight, height: uHeight }}
              />
            ))}

            {hosts.map((h) => {
              const color = HOST_STATUS_HEX[h.status] ?? '#94a3b8';
              const u = hostUtil(h);
              const gpus = gpuTotal(h);
              const height = h.sizeU * uHeight - 2;
              const tall = height >= 26;
              const op = opsByHost?.get(h.id);
              const blink = HOST_TRANSITIONAL.has(h.status) || !!op;
              const off = h.status === 'offline';
              return (
                <button
                  type="button"
                  key={h.id}
                  onClick={() => onSelect?.(h)}
                  onMouseMove={move(h)}
                  onMouseLeave={() => setTip(null)}
                  className={cn(
                    'group absolute inset-x-[2px] z-10 flex overflow-hidden rounded-[2px] border text-left transition-[filter,transform] hover:z-20 hover:brightness-125 focus-visible:outline-2 focus-visible:outline-brand-400',
                    highlightId === h.id ? 'border-brand-400 ring-2 ring-brand-400/70' : 'border-black/60',
                    !onSelect && 'cursor-default',
                  )}
                  style={{
                    bottom: (h.rackUnit - 1) * uHeight + 1, height,
                    background: `linear-gradient(90deg, ${color}38 0%, ${color}14 38%, transparent 70%), linear-gradient(180deg, #44444c 0%, #2c2c33 55%, #232329 100%)`,
                  }}
                >
                  <span className="w-[3px] shrink-0" style={{ background: color, opacity: off ? 0.5 : 1 }} />
                  {/* ears + LEDs */}
                  <span className={cn('flex shrink-0 flex-col items-center justify-center gap-[3px] px-1', !tall && 'flex-row')}>
                    <Led color={off ? '#3f3f46' : '#22c55e'} title={off ? 'Power off' : 'Power on'} />
                    <Led color={color} blink={blink} title={hostStatusLabel[h.status] ?? h.status} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col justify-center gap-[3px] pr-1.5">
                    <span className="flex min-w-0 items-center gap-1">
                      <span className={cn('truncate font-mono text-[9.5px] font-medium leading-none', off ? 'text-zinc-500' : 'text-zinc-100')}>{h.name}</span>
                      {gpus > 0 && <span className="shrink-0 rounded-[2px] bg-violet-500/80 px-[3px] font-mono text-[8px] font-semibold leading-[11px] text-white" title={`${gpus}× ${h.gpus.map((g) => g.model).join(', ')}`}>GPU×{gpus}</span>}
                      {showRoles && <RoleMarker h={h} />}
                      {!tall && <MiniBar ratio={u.cpu} className="ml-auto w-8" />}
                    </span>
                    {tall && (
                      <span className="flex items-center gap-1.5">
                        <MiniBar ratio={u.cpu} label="CPU" className="flex-1" />
                        <MiniBar ratio={u.ram} label="RAM" className="flex-1" />
                      </span>
                    )}
                    {height >= 50 && (
                      <span className="flex gap-[2px]">
                        {h.disks.slice(0, 8).map((d) => (
                          <span key={d.slot} className="h-2.5 w-2 rounded-[1px] border border-black/50" style={{ background: d.health === 'ok' ? '#52525b' : d.health === 'warning' ? '#f59e0b' : '#f43f5e' }}>
                            <span className="mx-auto mt-[1px] block size-[2px] rounded-full" style={{ background: off ? '#3f3f46' : '#4ade80' }} />
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  {/* vent pattern */}
                  <span className="hidden w-4 shrink-0 opacity-40 @min-[36rem]:block" style={{ backgroundImage: 'radial-gradient(circle, #000 0.8px, transparent 1px)', backgroundSize: '4px 4px' }} />
                </button>
              );
            })}

            {[ghost, preview].filter(Boolean).map((g, i) => (
              <div
                key={i}
                className={cn('pointer-events-none absolute inset-x-[2px] z-30 flex items-center justify-center rounded-[2px] border-2 border-dashed font-mono text-[9.5px] font-semibold',
                  g!.conflict ? 'border-rose-400 bg-rose-500/25 text-rose-200' : 'border-brand-300 bg-brand-500/30 text-brand-100', i === 1 && 'opacity-70')}
                style={{ bottom: (Math.min(g!.unit, units) - 1) * uHeight + 1, height: Math.min(g!.sizeU, units - g!.unit + 1) * uHeight - 2 }}
              >
                {g!.label ?? `U${g!.unit}${g!.sizeU > 1 ? `–${g!.unit + g!.sizeU - 1}` : ''}`}
              </div>
            ))}
          </div>
          {/* right rail */}
          <div className="w-2 shrink-0" style={{ backgroundImage: `repeating-linear-gradient(to top, transparent 0, transparent ${uHeight / 2 - 1}px, #3f3f46 ${uHeight / 2 - 1}px, #3f3f46 ${uHeight / 2}px)` }} />
        </div>
        <div className="mt-1 h-2 rounded-sm bg-zinc-950/60" />
      </div>

      {tip && createPortal(<HostTooltip h={tip.h} x={tip.x} y={tip.y} op={opsByHost?.get(tip.h.id)} />, overlayRoot())}
    </div>
  );
}

/** Tiny role icons (+ lock when restricted) drawn on a faceplate. */
function RoleMarker({ h }: { h: BareMetalHost }) {
  const roles = hostRoles(h);
  return (
    <span className="flex shrink-0 items-center gap-[2px]">
      {roles.map((r) => { const Icon = ROLE_ICON[r]; return <span key={r} title={ROLE_META[r].label} className="flex size-[11px] items-center justify-center rounded-[2px]" style={{ background: `${ROLE_HEX[r]}cc` }}><Icon className="size-[8px] text-white" strokeWidth={2.5} /></span> })}
      {isRestricted(h) && <Lock className="size-[10px] text-amber-400" strokeWidth={2.5} aria-label="Restricted" />}
    </span>
  );
}

function MiniBar({ ratio, label, className }: { ratio: number; label?: string; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-1', className)}>
      {label && <span className="font-mono text-[7.5px] leading-none text-zinc-400">{label}</span>}
      <span className="h-[4px] min-w-0 flex-1 overflow-hidden rounded-full bg-black/50">
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, ratio * 100)}%`, background: ratio >= 0.95 ? '#f43f5e' : ratio >= 0.8 ? '#f59e0b' : '#818cf8' }} />
      </span>
    </span>
  );
}

function HostTooltip({ h, x, y, op }: { h: BareMetalHost; x: number; y: number; op?: Operation }) {
  const u = hostUtil(h);
  const w = 260;
  const left = x + 16 + w > window.innerWidth ? x - w - 12 : x + 16;
  const top = Math.min(y + 12, window.innerHeight - 220);
  const color = HOST_STATUS_HEX[h.status] ?? '#94a3b8';
  const { names } = usePolicyNames();
  return (
    <div className="pointer-events-none fixed z-[90] animate-in rounded-xl border border-line bg-surface p-3 text-xs shadow-pop" style={{ left: Math.max(8, left), top, width: w }}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[13px] font-semibold text-fg">{h.name}</span>
        <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color }}><Led color={color} />{hostStatusLabel[h.status] ?? h.status}</span>
      </div>
      <div className="mt-0.5 truncate text-muted">{h.vendor} {h.model} · {h.rack} U{h.rackUnit}{h.sizeU > 1 ? `–${h.rackUnit + h.sizeU - 1}` : ''}</div>
      <div className="mt-1 truncate text-[11px] text-fg-2">{hostRoles(h).map((r) => ROLE_META[r].short).join(' · ')}</div>
      {isRestricted(h) && <div className="flex items-center gap-1 truncate text-[11px] text-amber-600 dark:text-amber-400"><Lock className="size-3 shrink-0" />{accessSummary(h, names)}</div>}
      {op && <div className="mt-1.5 truncate rounded-md bg-sky-500/10 px-1.5 py-1 text-[11px] text-sky-600 dark:text-sky-300">{op.title}…</div>}
      <div className="mt-2.5 space-y-1.5">
        <TipRow icon={<Cpu className="size-3" />} label="vCPU" value={`${u.a.vcpus} / ${u.cap.vcpus}`} ratio={u.cpu} />
        <TipRow icon={<MemoryStick className="size-3" />} label="RAM" value={`${u.a.ramGB} / ${u.cap.ramGB} GB`} ratio={u.ram} />
        {u.gpu != null && <TipRow icon={<Gpu className="size-3" />} label="GPU" value={`${u.a.gpus} / ${u.cap.gpus}`} ratio={u.gpu} />}
      </div>
      <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2 text-[11px] text-muted">
        <span>{u.a.vms} VM{u.a.vms === 1 ? '' : 's'} · {h.cpuCores} cores</span>
        <span className="flex items-center gap-0.5 tabular"><Zap className="size-3" />{h.status === 'offline' ? 0 : h.powerWatts} W</span>
      </div>
    </div>
  );
}

function TipRow({ icon, label, value, ratio }: { icon: ReactNode; label: string; value: string; ratio: number }) {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-[11px]"><span className="flex items-center gap-1 text-muted">{icon}{label}</span><span className="tabular text-fg-2">{value}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full" style={{ width: `${Math.min(100, ratio * 100)}%`, background: utilColor(ratio) }} /></div>
    </div>
  );
}
