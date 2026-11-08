import { Cpu, MemoryStick, HardDrive, Box, Globe2, SlidersHorizontal } from 'lucide-react';
import { Field, NumberInput, OptionCards } from '@/components/ui/form';
import { money } from '@/lib/format';
import { spaceCost } from '@/lib/pricing';
import type { SpaceQuota } from '@/types';
import { CUSTOM_LIMITS, QUOTA_KEYS, SPACE_SIZES, num1, type SizeId } from './spaceUi';

const ICON = { cpuCores: Cpu, memoryGi: MemoryStick, storageGi: HardDrive, pods: Box, loadBalancers: Globe2 };

/** Validate a quota against the platform cluster's per-tenant max and the space's current usage. */
export function quotaErrors(q: SpaceQuota, opts: { max?: SpaceQuota | null; min?: SpaceQuota | null } = {}): Partial<Record<keyof SpaceQuota, string>> {
  const e: Partial<Record<keyof SpaceQuota, string>> = {};
  for (const k of QUOTA_KEYS) {
    const lim = CUSTOM_LIMITS[k];
    const v = q[k];
    const unit = lim.unit ? ` ${lim.unit}` : '';
    if (!Number.isFinite(v) || v < lim.min) e[k] = `At least ${lim.min}${unit}`;
    else if (opts.max && v > opts.max[k]) e[k] = `Max ${num1(opts.max[k])}${unit} per space on this cluster`;
    else if (opts.min && v < opts.min[k]) e[k] = `${num1(opts.min[k])}${unit} already in use`;
  }
  return e;
}

/** Size presets S/M/L + custom quota fields. */
export function QuotaEditor({ size, onSize, value, onChange, errors = {}, serverErrors = {} }: {
  size: SizeId; onSize: (s: SizeId) => void; value: SpaceQuota; onChange: (q: SpaceQuota) => void;
  errors?: Partial<Record<keyof SpaceQuota, string>>; serverErrors?: Record<string, string>;
}) {
  const pick = (s: SizeId) => {
    onSize(s);
    const p = SPACE_SIZES.find((x) => x.id === s);
    if (p) onChange({ ...p.quota });
  };
  return (
    <div className="space-y-4">
      <OptionCards cols={4} value={size} onChange={pick} options={[
        ...SPACE_SIZES.map((s) => ({
          value: s.id as SizeId,
          title: s.name,
          description: s.description,
          meta: (
            <div className="space-y-1 text-xs">
              <div className="flex flex-wrap gap-x-2 text-fg-2">
                <span className="flex items-center gap-0.5"><Cpu className="size-3" />{s.quota.cpuCores}</span>
                <span className="flex items-center gap-0.5"><MemoryStick className="size-3" />{s.quota.memoryGi} GiB</span>
                <span className="flex items-center gap-0.5"><HardDrive className="size-3" />{s.quota.storageGi} GiB</span>
              </div>
              <div className="flex items-center justify-between text-muted"><span>{s.quota.pods} pods</span><span className="font-medium tabular text-fg">{money(spaceCost(s.quota).total)}</span></div>
            </div>
          ),
        })),
        { value: 'custom' as SizeId, title: 'Custom', description: 'Set each limit yourself', icon: <SlidersHorizontal className="size-3.5 text-muted" />, meta: size === 'custom' ? <span className="text-xs font-medium tabular text-fg">{money(spaceCost(value).total)}</span> : undefined },
      ]} />
      {size === 'custom' && (
        <div className="grid gap-3 rounded-xl border border-line bg-surface-2/30 p-3 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-3">
          {QUOTA_KEYS.map((k) => {
            const lim = CUSTOM_LIMITS[k];
            const Icon = ICON[k];
            return (
              <Field key={k} label={<span className="inline-flex items-center gap-1"><Icon className="size-3.5 text-muted" />{lim.label}</span>} error={errors[k] ?? serverErrors[`quota.${k}`]}>
                <NumberInput value={value[k]} onChange={(v) => onChange({ ...value, [k]: v })} min={lim.min} max={lim.max} step={lim.step} unit={lim.unit || undefined} invalid={!!(errors[k] ?? serverErrors[`quota.${k}`])} />
              </Field>
            );
          })}
        </div>
      )}
    </div>
  );
}
