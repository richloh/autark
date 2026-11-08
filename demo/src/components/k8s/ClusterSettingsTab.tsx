import { ArrowUpCircle, CheckCircle2, Shield, Trash2, Boxes } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation } from '@/api/hooks';
import { Card, CardHeader, KeyValue } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/form';
import { confirm } from '@/components/ui/Modal';
import { OperationRunner } from '@/components/resource/OperationRunner';
import { Pro } from '@/components/ui/Pro';
import { money } from '@/lib/format';
import { K8S_VERSIONS, type K8sCluster, type Operation } from '@/types';

/** Simple settings: version & upgrade, protection, delete. The detailed upgrade plan lives in the (pro) Upgrade tab. */
export function ClusterSettingsTab({ cluster: c, ops, onDelete, onTab }: { cluster: K8sCluster; ops: Operation[]; onDelete: () => void; onTab: (t: string) => void }) {
  const next = c.upgradeAvailable;
  const cur = K8S_VERSIONS.find((v) => v.version === c.version);
  const nextInfo = K8S_VERSIONS.find((v) => v.version === next);
  const idle = c.status === 'running' || c.status === 'degraded';
  const upgradeOp = ops.find((o) => o.type === 'k8s.upgrade' && o.status === 'running');
  const upgrade = useApiMutation(() => api.action('k8sClusters', c.id, 'upgrade', { version: next }), { success: `Upgrading ${c.name} to ${next}` });
  const patch = useApiMutation((b: Partial<K8sCluster>) => api.update('k8sClusters', c.id, b), { success: 'Settings saved' });
  const nodes = c.nodePools.reduce((a, p) => a + p.count, 0);

  const onUpgrade = async () => {
    const ok = await confirm({
      title: `Upgrade ${c.name} to v${nextInfo?.patch ?? next}?`,
      message: `Nodes are replaced one by one, so your apps keep running.${c.controlPlane.ha ? '' : ' The Kubernetes API is briefly unavailable (~20 s).'} A snapshot is taken first. You can't downgrade afterwards.`,
      confirmLabel: 'Upgrade',
    });
    if (ok) upgrade.mutate();
  };

  return (
    <div className="max-w-3xl space-y-5">
      <Card>
        <CardHeader icon={ArrowUpCircle} title="Kubernetes version" />
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <div className="text-xs text-muted">Current</div>
              <div className="font-mono text-2xl font-semibold text-fg">v{cur?.patch ?? c.version}</div>
            </div>
            {next && (
              <>
                <span className="text-faint">→</span>
                <div>
                  <div className="text-xs text-muted">Available</div>
                  <div className="font-mono text-2xl font-semibold text-brand-600 dark:text-brand-300">v{nextInfo?.patch ?? next}</div>
                </div>
              </>
            )}
            <div className="ml-auto">
              {next ? (
                <Button variant="primary" icon={ArrowUpCircle} loading={upgrade.isPending} disabled={!idle || !!upgradeOp} onClick={onUpgrade}>Upgrade</Button>
              ) : (
                <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-4" /> Up to date</span>
              )}
            </div>
          </div>
          {upgradeOp && <OperationRunner op={upgradeOp} compact />}
          {!idle && !upgradeOp && next && <p className="text-xs text-muted">Wait for the running operation to finish.</p>}
          {cur?.status === 'deprecated' && <p className="text-xs text-amber-600 dark:text-amber-400">Support for v{c.version} ends {cur.endOfSupport}. Please upgrade.</p>}
          <Switch checked={c.autoUpgrade} onChange={(v) => patch.mutate({ autoUpgrade: v })} label="Automatic upgrades" description="Keep the cluster up to date during the weekly maintenance window." />
          <Pro>
            <button type="button" onClick={() => onTab('upgrade')} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300">Detailed upgrade plan & maintenance window →</button>
          </Pro>
        </div>
      </Card>

      <Card>
        <CardHeader icon={Boxes} title="Cluster" />
        <div className="space-y-4 p-4">
          <KeyValue cols={3} items={[
            ['Control plane', c.controlPlane.ha ? 'High availability' : 'Single'],
            ['Nodes', `${nodes} in ${c.nodePools.length} pool${c.nodePools.length === 1 ? '' : 's'}`],
            ['Monthly cost', money(c.monthlyCost)],
          ]} />
          <Switch checked={!!c.deletionProtection} onChange={(v) => patch.mutate({ deletionProtection: v })}
            label={<span className="flex items-center gap-1.5"><Shield className="size-3.5" /> Deletion protection</span>} description="Prevents the cluster from being deleted by accident." />
        </div>
      </Card>

      <Card className="border-rose-500/30">
        <CardHeader icon={Trash2} title={<span className="text-rose-600 dark:text-rose-400">Delete cluster</span>} />
        <div className="flex flex-col gap-3 p-4 @min-[36rem]:flex-row @min-[36rem]:items-center @min-[36rem]:justify-between">
          <div className="text-sm text-fg-2">
            Deletes <b>{c.name}</b> with all its nodes and workloads. This cannot be undone.
            {c.deletionProtection && <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">Turn off deletion protection above first.</div>}
          </div>
          <Button variant="outline-danger" icon={Trash2} disabled={!!c.deletionProtection || c.status === 'deleting'} onClick={onDelete}>Delete cluster</Button>
        </div>
      </Card>
    </div>
  );
}
