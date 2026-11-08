import type { ReactNode } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { useNow } from '@/api/hooks';
import { Mono, Meter } from '@/components/ui/misc';
import { confirm } from '@/components/ui/Modal';
import { HOURS_PER_MONTH } from '@/lib/pricing';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import { archLabel, ipv6For, usageThisMonth, trafficOutThisMonth, monthElapsedFraction, TRAFFIC_INCLUDED_TB, VM_TRANSITIONAL } from './util';
import type { VmCtx } from './context';
import type { VM } from '@/types';

/* ------------------------------------------------------------------ power toggle */

/** Hetzner-style ON/OFF power switch. Confirms before powering off; shows a spinner during transitions. */
export function PowerToggle({ vm, pending, onStart, onStop }: { vm: VM; pending: boolean; onStart: () => void; onStop: () => void }) {
  const on = vm.status === 'running' || vm.status === 'starting' || vm.status === 'rebooting';
  const transitional = VM_TRANSITIONAL.includes(vm.status);
  const canToggle = !pending && !transitional && (vm.status === 'running' || vm.status === 'stopped' || vm.status === 'error');
  const spinning = pending || transitional;
  const click = async () => {
    if (!canToggle) return;
    if (vm.status === 'running') {
      const ok = await confirm({ title: `Power off ${vm.name}?`, message: 'Sends an ACPI shutdown to the guest OS and waits for it to stop. Compute billing pauses while it is off; disks, snapshots and IPs are still billed.', confirmLabel: 'Power off', danger: true });
      if (ok) onStop();
    } else onStart();
  };
  const label = spinning ? (vm.status === 'stopping' ? 'Stopping' : vm.status === 'starting' ? 'Starting' : transitional ? vm.status : on ? 'Stopping' : 'Starting') : on ? 'On' : 'Off';
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={`Power: ${label}`} disabled={!canToggle} onClick={click}
      title={canToggle ? (on ? 'Power off' : 'Power on') : `VM is ${vm.status}`}
      className={cn(
        'group inline-flex h-9 items-center gap-2 rounded-full border pl-1 pr-3 text-xs font-semibold uppercase tracking-wide transition-colors disabled:cursor-not-allowed',
        on ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-line bg-surface-2 text-muted',
        canToggle && 'hover:border-line-strong',
      )}>
      <span className={cn('relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors', on ? 'bg-emerald-500' : 'bg-line-strong', spinning && 'opacity-80')}>
        <span className={cn('flex size-6 items-center justify-center rounded-full bg-white shadow transition-transform', on ? 'translate-x-[22px]' : 'translate-x-0.5')}>
          {spinning && <Loader2 className="size-3.5 animate-spin text-muted" />}
        </span>
      </span>
      <span className="min-w-[4.5rem] text-left">{label}{spinning ? '…' : ''}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ inline addresses */

export function HeaderAddresses({ c, onAssign }: { c: VmCtx; onAssign: () => void }) {
  const { vm, ips } = c;
  const v4 = ips.filter((i) => i.version === 4);
  const v6 = ips.find((i) => i.version === 6)?.address ?? ipv6For(vm);
  const Item = ({ k, v }: { k: string; v: string }) => (
    <span className="inline-flex min-w-0 items-center gap-1.5"><span className="text-[10px] font-semibold uppercase tracking-wide text-faint">{k}</span><Mono copy className="text-xs text-fg">{v}</Mono></span>
  );
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
      {v4.map((i) => <Item key={i.id} k="IPv4" v={i.address} />)}
      {v6 && <Item k="IPv6" v={v6} />}
      <Item k="Private" v={vm.privateIp} />
      {!v4.length && (
        <button type="button" onClick={onAssign} className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline"><Plus className="size-3" />Assign IP</button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ spec strip */

function Cell({ label, value, unit, sub, children, accent }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; children?: ReactNode; accent?: boolean }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-3">
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1 whitespace-nowrap">
        <span className={cn('text-2xl font-semibold tabular tracking-tight', accent ? 'text-brand-600 dark:text-brand-300' : 'text-fg')}>{value}</span>
        {unit && <span className="text-sm text-muted">{unit}</span>}
        {children}
      </div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

/** Big-number summary of the VM: size, month-to-date usage, traffic and price. */
export function SpecStrip({ c }: { c: VmCtx }) {
  const { vm, image, volumes, preset } = c;
  const now = useNow(30_000);
  const volGB = volumes.reduce((a, v) => a + v.sizeGB, 0);
  const usage = usageThisMonth(vm, now);
  const frac = monthElapsedFraction(vm, now);
  const traffic = trafficOutThisMonth(vm, now);
  const includedBytes = TRAFFIC_INCLUDED_TB * 1e12;
  const price = vm.monthlyCost ?? 0;
  const stopped = vm.status === 'stopped' || vm.status === 'error';
  const [tv, tu] = traffic >= 1e12 ? [(traffic / 1e12).toFixed(2), 'TB'] : [Math.round(traffic / 1e9).toString(), 'GB'];
  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-line bg-line shadow-card">
      <div className="grid grid-cols-2 gap-px @min-[36rem]:grid-cols-3 @min-[60rem]:grid-cols-6">
        <Cell label="vCPU" value={vm.size.vcpus} sub={vm.gpu ? `+ ${vm.gpu.count}× ${vm.gpu.model} GPU` : preset ? `${preset.name} · ${preset.family}` : 'custom size'}>
          <span className="ml-1 self-center rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-fg-2">{archLabel(image)}</span>
        </Cell>
        <Cell label="Memory" value={vm.size.ramGB} unit="GB" sub={`${(vm.size.ramGB / vm.size.vcpus).toFixed(vm.size.ramGB % vm.size.vcpus ? 1 : 0)} GB per vCPU`} />
        <Cell label="Disk" value={vm.size.systemDiskGB + volGB} unit="GB" sub={volumes.length ? `${vm.size.systemDiskGB} system + ${volumes.length} volume${volumes.length > 1 ? 's' : ''}` : 'system disk · local NVMe'} />
        <Cell label="Usage this month" value={money(usage, { decimals: true })} sub={stopped ? 'compute paused · storage only' : `${Math.round(frac * 100)}% of month · cap ${money(price)}`} />
        <div className="min-w-0 bg-surface px-4 py-3">
          <div className="truncate text-[11px] font-medium uppercase tracking-wide text-faint">Traffic out</div>
          <div className="mt-0.5 flex items-baseline gap-1 whitespace-nowrap">
            <span className="text-2xl font-semibold tabular tracking-tight text-fg">{tv}</span>
            <span className="text-sm text-muted">{tu}</span>
          </div>
          <Meter value={traffic} max={includedBytes} size="sm" className="mt-1" />
          <div className="mt-0.5 truncate text-[11px] text-muted">of {TRAFFIC_INCLUDED_TB} TB included</div>
        </div>
        <Cell label="Price" value={money(price)} unit="/mo" accent sub={`${money(price / HOURS_PER_MONTH, { decimals: true })} per hour`} />
      </div>
    </div>
  );
}
