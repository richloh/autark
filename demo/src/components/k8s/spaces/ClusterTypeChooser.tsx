import { Check, X, Users, Boxes } from 'lucide-react';
import { money } from '@/lib/format';
import { k8sCost } from '@/lib/pricing';
import { cn } from '@/lib/cn';
import { K8S_NODE_PRESETS } from '@/types';
import { SHARED_FROM, SPACE_COLOR } from './spaceUi';

export type ClusterType = 'shared' | 'dedicated';

const small = K8S_NODE_PRESETS[0];
export const DEDICATED_FROM = k8sCost({ controlPlaneSize: 'small', ha: false, pools: [{ name: 'workers', vcpus: small.vcpus, ramGB: small.ramGB, diskGB: small.diskGB, count: 1 }] }).total;

const OPTIONS: { value: ClusterType; title: string; tagline: string; from: number; icon: typeof Boxes; color: string; pros: string[]; cons: string[] }[] = [
  {
    value: 'shared', title: 'Shared cluster', tagline: 'Run your apps on the provider’s Kubernetes', from: SHARED_FROM, icon: Users, color: SPACE_COLOR,
    pros: ['Ready in seconds', 'Provider operates & upgrades it', 'Your own namespace, quota and kubectl access'],
    cons: ['No cluster-wide CRDs or operators'],
  },
  {
    value: 'dedicated', title: 'Own cluster', tagline: 'A whole cluster just for you', from: DEDICATED_FROM, icon: Boxes, color: '#326ce5',
    pros: ['Full control incl. CRDs, operators, node pools', 'You choose version & add-ons', 'Price includes the control plane'],
    cons: ['Ready in a few minutes'],
  },
];

/** First step of "Create Kubernetes": shared space vs dedicated cluster. */
export function ClusterTypeChooser({ value, onChange }: { value: ClusterType | null; onChange: (t: ClusterType) => void }) {
  return (
    <div className="@container mb-5">
      <div className="grid gap-3 @min-[34rem]:grid-cols-2" role="radiogroup" aria-label="Cluster type">
        {OPTIONS.map((o) => {
          const active = value === o.value;
          const Icon = o.icon;
          return (
            <button key={o.value} type="button" role="radio" aria-checked={active} onClick={() => onChange(o.value)}
              className={cn('flex flex-col gap-3 rounded-xl border p-4 text-left transition-all',
                active ? 'border-brand-500 bg-brand-500/[0.05] ring-3 ring-brand-500/15' : 'border-line bg-surface shadow-card hover:border-line-strong')}>
              <div className="flex w-full items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${o.color}1a`, color: o.color }}><Icon className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-fg">{o.title}</span>
                  <span className="block text-[13px] text-muted">{o.tagline}</span>
                </span>
                <span className={cn('mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border', active ? 'border-brand-500 bg-brand-500' : 'border-line-strong')}>
                  {active && <span className="size-1.5 rounded-full bg-white" />}
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-xs text-muted">from</span>
                <span className="text-xl font-semibold tabular tracking-tight text-fg">{money(o.from)}</span>
                <span className="text-xs text-muted">/ mo</span>
              </div>
              <ul className="space-y-1 text-[13px]">
                {o.pros.map((p) => <li key={p} className="flex items-start gap-1.5 text-fg-2"><Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />{p}</li>)}
                {o.cons.map((p) => <li key={p} className="flex items-start gap-1.5 text-muted"><X className="mt-0.5 size-3.5 shrink-0 text-faint" />{p}</li>)}
              </ul>
            </button>
          );
        })}
      </div>
    </div>
  );
}
