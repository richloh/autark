import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { BareMetalHost } from '@/types';

/* Small shared visuals for the hardware domain: status colors, LEDs, flags, utilisation helpers. */

export const HOST_STATUS_HEX: Record<string, string> = {
  ready: '#10b981', maintenance: '#f59e0b', draining: '#eab308', offline: '#f43f5e', error: '#f43f5e',
  provisioning: '#38bdf8', discovering: '#38bdf8', rebooting: '#38bdf8', updating: '#38bdf8', decommissioning: '#94a3b8',
};
export const HOST_TRANSITIONAL = new Set(['provisioning', 'discovering', 'rebooting', 'updating', 'decommissioning', 'draining']);

export const hostStatusLabel: Record<string, string> = {
  ready: 'Ready', maintenance: 'Maintenance', draining: 'Cordoned', offline: 'Offline', error: 'Error', provisioning: 'Enrolling', discovering: 'Discovering',
  rebooting: 'Rebooting', updating: 'Updating', decommissioning: 'Decommissioning',
};

export function hostCaps(h: BareMetalHost) {
  return h.capacity ?? { vcpus: h.threads * h.cpuOvercommit, ramGB: Math.floor(h.ramGB * h.ramOvercommit * 0.92), gpus: h.gpus.reduce((a, g) => a + g.count, 0), diskGB: h.disks.filter((d) => d.type !== 'hdd').reduce((a, d) => a + d.sizeGB, 0) };
}

export function hostUtil(h: BareMetalHost) {
  const cap = hostCaps(h);
  const a = h.allocated ?? { vcpus: 0, ramGB: 0, gpus: 0, diskGB: 0, vms: 0 };
  return {
    cpu: cap.vcpus ? a.vcpus / cap.vcpus : 0,
    ram: cap.ramGB ? a.ramGB / cap.ramGB : 0,
    gpu: cap.gpus ? a.gpus / cap.gpus : null,
    disk: cap.diskGB ? a.diskGB / cap.diskGB : 0,
    cap, a,
  };
}

export const gpuTotal = (h: BareMetalHost) => h.gpus.reduce((a, g) => a + g.count, 0);

/** Utilisation color (sequential brand → amber → rose at high load). */
export function utilColor(r: number | null): string {
  if (r == null) return 'transparent';
  if (r >= 0.95) return '#f43f5e';
  if (r >= 0.8) return '#f59e0b';
  return `rgba(91, 103, 248, ${0.14 + Math.min(1, r / 0.8) * 0.76})`;
}
export const utilText = (r: number | null) => (r == null ? 'text-faint' : r >= 0.55 ? 'text-white' : 'text-fg-2');

/** Status LED with optional blink for transitional states. */
export function Led({ color, blink, className, title }: { color: string; blink?: boolean; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-block size-1.5 shrink-0 rounded-full', blink && 'animate-pulse-soft', className)}
      style={{ background: color, boxShadow: color === 'transparent' ? undefined : `0 0 4px ${color}` }} />
  );
}

/** Country flag emoji from ISO-2 code. */
export function flag(cc: string | undefined): string {
  if (!cc || cc.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Wizard step indicator (horizontal, collapses to compact on mobile). */
export function StepIndicator({ steps, current, onStep, className }: { steps: { label: string; description?: string }[]; current: number; onStep?: (i: number) => void; className?: string }) {
  return (
    <ol className={cn('flex items-center gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-2 shadow-card', className)}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const clickable = !!onStep && i < current;
        return (
          <li key={s.label} className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onStep!(i)}
              className={cn('flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors', active && 'bg-brand-500/[0.07]', clickable && 'hover:bg-surface-2')}
            >
              <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular',
                done ? 'bg-emerald-500 text-white' : active ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/30' : 'bg-surface-3 text-muted')}>
                {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn('min-w-0', !active && 'hidden @min-[36rem]:block')}>
                <span className={cn('block truncate text-[13px] font-medium', active ? 'text-fg' : done ? 'text-fg-2' : 'text-muted')}>{s.label}</span>
                {s.description && <span className="hidden truncate text-[11px] text-muted @min-[44rem]:block">{s.description}</span>}
              </span>
            </button>
            {i < steps.length - 1 && <span className={cn('h-px w-4 shrink-0 @min-[36rem]:w-6', done ? 'bg-emerald-500' : 'bg-line-strong')} />}
          </li>
        );
      })}
    </ol>
  );
}

/** Small labelled metric used in hardware cards. */
export function SpecPill({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-fg-2', className)}>{icon}{children}</span>;
}
