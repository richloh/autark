import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useList } from '@/api/hooks';
import { Checkbox } from '@/components/ui/form';
import { StatusDot } from '@/components/ui/Badge';
import { KindIcon } from '@/components/resource/ResourceLink';
import { KINDS } from '@/lib/kinds';
import { cn } from '@/lib/cn';
import type { Ref, VM, DbInstance, LoadBalancer, K8sCluster, ResourceKind } from '@/types';

export interface Attachable { type: ResourceKind; id: string; name: string; status: string; sub: string; firewallCount: number }

/** All resources in a project a firewall can attach to. */
export function useAttachables(projectId: string | undefined): Attachable[] {
  const { items: vms } = useList<VM>('vms');
  const { items: dbs } = useList<DbInstance>('dbInstances');
  const { items: lbs } = useList<LoadBalancer>('loadBalancers');
  const { items: k8s } = useList<K8sCluster>('k8sClusters');
  return useMemo(() => {
    if (!projectId) return [];
    return [
      ...vms.filter((x) => x.projectId === projectId).map((x) => ({ type: 'vm' as const, id: x.id, name: x.name, status: x.status, sub: x.privateIp, firewallCount: x.firewallIds.length })),
      ...dbs.filter((x) => x.projectId === projectId).map((x) => ({ type: 'db' as const, id: x.id, name: x.name, status: x.status, sub: `${x.engine} :${x.port}`, firewallCount: x.firewallIds.length })),
      ...lbs.filter((x) => x.projectId === projectId).map((x) => ({ type: 'lb' as const, id: x.id, name: x.name, status: x.status, sub: x.type, firewallCount: x.firewallIds.length })),
      ...k8s.filter((x) => x.projectId === projectId).map((x) => ({ type: 'k8s' as const, id: x.id, name: x.name, status: x.status, sub: `v${x.version}`, firewallCount: -1 })),
    ];
  }, [projectId, vms, dbs, lbs, k8s]);
}

const key = (r: Ref) => `${r.type}:${r.id}`;

/** Checkbox list of attachable resources grouped by kind. */
export function AttachmentPicker({ items, value, onChange, className }: { items: Attachable[]; value: Ref[]; onChange: (v: Ref[]) => void; className?: string }) {
  const [q, setQ] = useState('');
  const sel = new Set(value.map(key));
  const shown = items.filter((i) => !q || `${i.name} ${i.sub} ${i.type}`.toLowerCase().includes(q.toLowerCase()));
  const groups = (['vm', 'db', 'lb', 'k8s'] as const).map((t) => ({ t, rows: shown.filter((i) => i.type === t) })).filter((g) => g.rows.length);
  const toggle = (i: Attachable) => onChange(sel.has(key(i)) ? value.filter((r) => key(r) !== key(i)) : [...value, { type: i.type, id: i.id }]);
  if (!items.length) return <p className="rounded-lg border border-dashed border-line p-4 text-center text-xs text-muted">No VMs, databases, load balancers or clusters in this project yet.</p>;
  return (
    <div className={cn('space-y-3', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter resources…" className="h-8 w-full rounded-lg border border-line bg-surface-2/60 pl-8 pr-3 text-[13px] outline-none placeholder:text-faint focus:border-brand-500" />
      </div>
      {groups.map((g) => (
        <div key={g.t}>
          <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-medium uppercase tracking-wide text-muted">
            <span>{KINDS[g.t].plural}</span>
            <button type="button" className="normal-case text-brand-500 hover:underline" onClick={() => {
              const all = g.rows.every((r) => sel.has(key(r)));
              onChange(all ? value.filter((v) => !g.rows.some((r) => key(r) === key(v))) : [...value, ...g.rows.filter((r) => !sel.has(key(r))).map((r) => ({ type: r.type, id: r.id }))]);
            }}>{g.rows.every((r) => sel.has(key(r))) ? 'none' : 'all'}</button>
          </div>
          <div className="grid gap-1.5 @min-[36rem]:grid-cols-2">
            {g.rows.map((i) => (
              <div key={key(i)} role="button" tabIndex={0} onClick={() => toggle(i)} onKeyDown={(e) => e.key === ' ' && (e.preventDefault(), toggle(i))}
                className={cn('flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-1.5 transition-colors', sel.has(key(i)) ? 'border-brand-500/60 bg-brand-500/[0.05]' : 'border-line hover:bg-surface-2')}>
                <Checkbox checked={sel.has(key(i))} onChange={() => toggle(i)} />
                <KindIcon type={i.type} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate text-[13px] font-medium text-fg"><StatusDot status={i.status} />{i.name}</div>
                  <div className="truncate font-mono text-[11px] text-muted">{i.sub}{i.firewallCount > 0 ? ` · ${i.firewallCount} fw` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
