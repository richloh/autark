import { Globe2, ShieldCheck, Activity, GitBranch, HardDrive, Gpu, Download, Trash2, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation } from '@/api/hooks';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { confirm } from '@/components/ui/Modal';
import { Hint } from '@/components/ui/form';
import { OperationRunner } from '@/components/resource/OperationRunner';
import { cn } from '@/lib/cn';
import { fmtCpu, fmtMem } from './k8sUi';
import { K8S_ADDONS, type K8sAddon, type K8sCluster, type K8sTopology, type Operation } from '@/types';

const CATEGORY: Record<K8sAddon['category'], { icon: typeof Globe2; label: string }> = {
  networking: { icon: Globe2, label: 'Networking' }, security: { icon: ShieldCheck, label: 'Security' }, observability: { icon: Activity, label: 'Observability' },
  delivery: { icon: GitBranch, label: 'Delivery' }, storage: { icon: HardDrive, label: 'Backup & storage' }, gpu: { icon: Gpu, label: 'GPU' },
};

export function AddonsTab({ cluster: c, topology, ops }: { cluster: K8sCluster; topology: K8sTopology | undefined; ops: Operation[] }) {
  const addonOp = ops.find((o) => o.type === 'k8s.installAddon' || o.type === 'k8s.uninstallAddon');
  const install = useApiMutation((id: string) => api.action('k8sClusters', c.id, 'installAddon', { addon: id }), { success: (_r, id) => `Installing ${K8S_ADDONS.find((a) => a.id === id)?.name}` });
  const uninstall = useApiMutation((id: string) => api.action('k8sClusters', c.id, 'uninstallAddon', { addon: id }), { success: (_r, id) => `Removing ${K8S_ADDONS.find((a) => a.id === id)?.name}` });
  const hasGpu = c.nodePools.some((p) => p.gpu);
  const idle = c.status === 'running' || c.status === 'degraded';

  const onUninstall = async (a: K8sAddon) => {
    const ok = await confirm({ title: `Remove ${a.name}?`, message: `The Helm release and its workloads in "${a.namespace}" are deleted.${a.id === 'ingress' ? ' Ingress routes stop working and the load balancer is released.' : a.id === 'certManager' ? ' Existing certificates stay valid but are no longer renewed.' : ''}`, confirmLabel: 'Remove', danger: true });
    if (ok) uninstall.mutate(a.id);
  };

  const groups = (Object.keys(CATEGORY) as K8sAddon['category'][]).map((cat) => ({ cat, items: K8S_ADDONS.filter((a) => a.category === cat) })).filter((g) => g.items.length);
  return (
    <div className="space-y-5">
      {addonOp && <OperationRunner op={addonOp} compact />}
      {!idle && <Hint>Add-ons can be changed once the cluster is running.</Hint>}
      {groups.map(({ cat, items }) => {
        const Meta = CATEGORY[cat];
        return (
          <section key={cat}>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg"><Meta.icon className="size-4 text-muted" />{Meta.label}</h3>
            <div className="grid gap-3 @min-[40rem]:grid-cols-2 @min-[60rem]:grid-cols-3">
              {items.map((a) => {
                const on = !!c.addons[a.id];
                const busy = addonOp && addonOp.title.includes(a.name);
                const wls = (topology?.pods ?? []).filter((p) => a.workloads.some((w) => w.name === p.workloadName && w.namespace === p.namespace));
                const running = wls.filter((p) => p.status === 'Running').length;
                const req = a.workloads.reduce((acc, w) => ({ cpu: acc.cpu + w.cpuRequestM * Math.max(1, w.replicas), mem: acc.mem + w.memRequestMi * Math.max(1, w.replicas) }), { cpu: 0, mem: 0 });
                const blocked = a.id === 'gpuOperator' && !hasGpu;
                return (
                  <Card key={a.id} className={cn('flex flex-col p-4', on && 'border-brand-500/30')}>
                    <div className="flex items-start gap-3">
                      <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', on ? 'bg-brand-500 text-white' : 'bg-surface-3 text-muted')}><Meta.icon className="size-4" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5"><span className="font-medium text-fg">{a.name}</span><span className="font-mono text-[10.5px] text-faint">{a.version}</span></div>
                        <p className="mt-0.5 text-xs text-muted">{a.description}</p>
                      </div>
                      {busy ? <StatusPill status="updating" label={on ? 'removing' : 'installing'} /> : on ? <Badge tone="success" dot>installed</Badge> : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                      <span>ns <span className="font-mono text-fg-2">{a.namespace}</span></span>
                      <span>requests ~{fmtCpu(req.cpu)} · {fmtMem(req.mem)}</span>
                      {on && wls.length > 0 && <span className={cn(running === wls.length ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600')}>{running}/{wls.length} pods running</span>}
                    </div>
                    <div className="mt-auto flex items-center justify-end gap-2 pt-3">
                      {blocked && !on && <span className="mr-auto text-[11px] text-muted">Needs a GPU node pool</span>}
                      {on ? (
                        <Button size="sm" variant="outline-danger" icon={busy ? Loader2 : Trash2} disabled={!!addonOp || !idle} onClick={() => onUninstall(a)}>Remove</Button>
                      ) : (
                        <Button size="sm" variant="primary" icon={busy ? Loader2 : Download} disabled={!!addonOp || !idle || blocked} loading={install.isPending && install.variables === a.id} onClick={() => install.mutate(a.id)}>Install</Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
      <p className="flex items-center gap-1.5 text-xs text-muted"><CheckCircle2 className="size-3.5 text-emerald-500" /> Add-on versions are tested against each Kubernetes release and upgraded with the cluster.</p>
    </div>
  );
}
