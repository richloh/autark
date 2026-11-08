import { useEffect, useState } from 'react';
import { Plus, Server, Trash2, Check, AlertTriangle, Gpu, TrendingUp, TrendingDown, Pencil } from 'lucide-react';
import { api, ApiClientError } from '@/api/client';
import { useApiMutation } from '@/api/hooks';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Field, NumberInput, Slider, Switch, Hint, TagEditor } from '@/components/ui/form';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, Drawer, confirm } from '@/components/ui/Modal';
import { KeyValue } from '@/components/ui/Card';
import { fieldErrors } from '@/components/ui/FormLayout';
import { toast } from '@/components/ui/toast';
import { money, timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { NodePoolEditor, newPoolDraft, poolBody, type PoolDraft } from './NodePoolEditor';
import { fmtCpu, fmtMem, nsColor, poolNodeCost, presetLabel } from './k8sUi';
import { usePro } from '@/store/ui';
import type { K8sCluster, K8sNode, K8sTopology, NodePool, K8sClusterSummary } from '@/types';

interface Sim { before: K8sClusterSummary; after: K8sClusterSummary; pendingPods: number; newlyPending: number; reasons: string[]; monthlyCost: number }

function useSimulate(clusterId: string, body: unknown, enabled: boolean) {
  const [sim, setSim] = useState<Sim | null>(null);
  const key = JSON.stringify(body);
  useEffect(() => {
    if (!enabled) { setSim(null); return }
    const t = setTimeout(() => { api.post<Sim>(`/k8sClusters/${clusterId}/simulate`, body).then(setSim).catch(() => setSim(null)) }, 250);
    return () => clearTimeout(t);
  }, [key, enabled]); // eslint-disable-line
  return sim;
}

function Bar({ v, className }: { v: number; className?: string }) {
  return <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}><div className={cn('h-full rounded-full transition-all', v > 0.9 ? 'bg-rose-500' : v > 0.75 ? 'bg-amber-500' : 'bg-brand-500')} style={{ width: `${Math.min(100, v * 100)}%` }} /></div>;
}

function PoolCard({ c, pool, nodes, busy }: { c: K8sCluster; pool: NodePool; nodes: K8sNode[]; busy: boolean }) {
  const pro = usePro();
  const current = pool.targetCount ?? pool.count;
  const [count, setCount] = useState(current);
  const [auto, setAuto] = useState(pool.autoscale);
  const [editMeta, setEditMeta] = useState(false);
  useEffect(() => { setCount(pool.targetCount ?? pool.count) }, [pool.count, pool.targetCount]);
  useEffect(() => { setAuto(pool.autoscale) }, [pool.autoscale.enabled, pool.autoscale.min, pool.autoscale.max]); // eslint-disable-line
  const nodeCost = poolNodeCost(pool);
  const diff = (count - current) * nodeCost;
  const sim = useSimulate(c.id, { poolCounts: { [pool.id]: count } }, count < current);
  const autoDirty = auto.enabled !== pool.autoscale.enabled || auto.min !== pool.autoscale.min || auto.max !== pool.autoscale.max;
  const sliderMax = Math.max(10, pool.autoscale.max, current + 5);

  const update = useApiMutation((body: Record<string, unknown>) => api.action('k8sClusters', c.id, 'updateNodePool', { poolId: pool.id, ...body }), { success: (_r, b) => ('count' in b ? `Scaling ${pool.name} to ${b.count} nodes` : `Updated ${pool.name}`) });
  const remove = useApiMutation(() => api.action('k8sClusters', c.id, 'removeNodePool', { poolId: pool.id }), { success: `Draining and removing ${pool.name}` });
  const removeSim = useSimulate(c.id, { removePoolId: pool.id }, true);

  const onRemove = async () => {
    const pods = nodes.reduce((a, n) => a + n.podCount, 0);
    const ok = await confirm({
      title: `Remove node pool ${pool.name}?`,
      message: <span>All {pool.count} nodes are cordoned and drained ({pods} pods are rescheduled), then deleted.{removeSim && removeSim.newlyPending > 0 && <b className="mt-2 block text-rose-600 dark:text-rose-400">{removeSim.newlyPending} pod(s) will not fit on the remaining pools and stay Pending.</b>}</span>,
      confirmLabel: 'Remove pool', danger: true, typeToConfirm: pool.name,
    });
    if (ok) remove.mutate();
  };
  const ready = nodes.filter((n) => n.status === 'Ready' && !n.surge).length;
  const reqCpu = nodes.reduce((a, n) => a + n.requested.cpuM, 0), allocCpu = nodes.reduce((a, n) => a + n.allocatable.cpuM, 0);
  const reqMem = nodes.reduce((a, n) => a + n.requested.memMi, 0), allocMem = nodes.reduce((a, n) => a + n.allocatable.memMi, 0);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-surface-3 text-muted">{pool.gpu ? <Gpu className="size-4 text-lime-500" /> : <Server className="size-4" />}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2"><span className="font-semibold text-fg">{pool.name}</span><StatusPill status={pool.status} />{pool.version && pool.version !== c.version && <Badge tone="info">kubelet {pool.version}</Badge>}</div>
          <div className="text-xs text-muted">{presetLabel(pool)} · {pool.diskGB} GB disk{pro ? ` · surge ${pool.upgradeSettings?.maxSurge ?? 1}` : ''}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm font-semibold tabular text-fg">{money(nodeCost * current)}<span className="text-xs font-normal text-muted">/mo</span></span>
          {pro && <Button size="xs" variant="ghost" icon={Pencil} onClick={() => setEditMeta(true)}>Labels & taints</Button>}
          <Button size="xs" variant="outline-danger" icon={Trash2} disabled={busy || c.nodePools.length === 1} onClick={onRemove} title={c.nodePools.length === 1 ? 'Cannot remove the last pool' : undefined}>Remove</Button>
        </div>
      </div>
      <div className="grid gap-5 p-4 @min-[44rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-medium text-fg-2">Nodes</span>
            <span className="text-xs text-muted">{ready}/{current} ready</span>
          </div>
          <div className="flex items-center gap-3">
            <Slider className="flex-1" value={count} onChange={setCount} min={auto.enabled ? auto.min : 0} max={auto.enabled ? auto.max : sliderMax} marks={auto.enabled ? [auto.min, auto.max] : [0, Math.round(sliderMax / 2), sliderMax]} />
            <NumberInput className="w-28" value={count} onChange={setCount} min={auto.enabled ? auto.min : 0} max={auto.enabled ? auto.max : 100} />
          </div>
          {count !== current && (
            <div className={cn('flex flex-wrap items-center gap-3 rounded-lg p-2.5 text-xs', count > current ? 'bg-brand-500/5' : 'bg-amber-500/5')}>
              {count > current ? <TrendingUp className="size-4 text-brand-500" /> : <TrendingDown className="size-4 text-amber-500" />}
              <span className="text-fg-2">{current} → <b>{count}</b> nodes · <b className={diff > 0 ? 'text-fg' : 'text-emerald-600 dark:text-emerald-400'}>{diff > 0 ? '+' : '−'}{money(Math.abs(diff))}/mo</b></span>
              {count < current && sim && (sim.newlyPending > 0
                ? <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400"><AlertTriangle className="size-3.5" />{sim.newlyPending} pod(s) won't fit</span>
                : <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><Check className="size-3.5" />all pods still fit</span>)}
              <span className="ml-auto flex gap-1.5">
                <Button size="xs" variant="ghost" onClick={() => setCount(current)}>Reset</Button>
                <Button size="xs" variant="primary" loading={update.isPending} disabled={busy} onClick={() => update.mutate({ count })}>Apply</Button>
              </span>
            </div>
          )}
          {busy && count !== current && <p className="text-[11px] text-muted">Another cluster operation is running — apply once it finishes.</p>}
          <div className="grid grid-cols-2 gap-3 text-[11px] text-muted">
            <div><div className="mb-1 flex justify-between"><span>CPU requested</span><span className="tabular">{fmtCpu(reqCpu)} / {fmtCpu(allocCpu)}</span></div><Bar v={allocCpu ? reqCpu / allocCpu : 0} /></div>
            <div><div className="mb-1 flex justify-between"><span>Memory requested</span><span className="tabular">{fmtMem(reqMem)} / {fmtMem(allocMem)}</span></div><Bar v={allocMem ? reqMem / allocMem : 0} /></div>
          </div>
        </div>
        <div className="space-y-3 rounded-lg border border-line p-3">
          <Switch checked={auto.enabled} onChange={(v) => setAuto({ enabled: v, min: Math.min(auto.min, current), max: Math.max(auto.max, current) })} label={pro ? 'Cluster autoscaler' : 'Autoscaling'} description={pro ? 'Scale up for unschedulable pods, scale down idle nodes after 10 min.' : 'Add nodes automatically when apps need room, remove idle ones.'} />
          {auto.enabled && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min"><NumberInput value={auto.min} onChange={(n) => setAuto({ ...auto, min: n })} min={0} max={auto.max} /></Field>
              <Field label="Max"><NumberInput value={auto.max} onChange={(n) => setAuto({ ...auto, max: n })} min={Math.max(1, auto.min)} max={100} /></Field>
              <p className="col-span-2 text-[11px] text-muted">{money(nodeCost * auto.min)} – {money(nodeCost * auto.max)} per month</p>
            </div>
          )}
          {autoDirty && (
            <div className="flex justify-end gap-1.5">
              <Button size="xs" variant="ghost" onClick={() => setAuto(pool.autoscale)}>Cancel</Button>
              <Button size="xs" variant="primary" loading={update.isPending} onClick={() => update.mutate({ autoscale: auto })}>Save autoscaling</Button>
            </div>
          )}
          {pro && <div className="flex flex-wrap gap-1">
            {pool.labels.map((l) => <Badge key={l.key} className="font-mono text-[10px]">{l.key}={l.value}</Badge>)}
            {pool.taints.map((t) => <Badge key={t} tone="warning" className="font-mono text-[10px]">{t}</Badge>)}
            {!pool.labels.length && !pool.taints.length && <span className="text-[11px] text-faint">No labels or taints</span>}
          </div>}
        </div>
      </div>
      <PoolMetaModal open={editMeta} onClose={() => setEditMeta(false)} c={c} pool={pool} />
    </Card>
  );
}

function PoolMetaModal({ open, onClose, c, pool }: { open: boolean; onClose: () => void; c: K8sCluster; pool: NodePool }) {
  const [labels, setLabels] = useState(pool.labels);
  const [taints, setTaints] = useState(pool.taints.join('\n'));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setLabels(pool.labels); setTaints(pool.taints.join('\n')); setError(null) } }, [open]); // eslint-disable-line
  const save = useApiMutation(() => api.action('k8sClusters', c.id, 'updateNodePool', { poolId: pool.id, labels, taints: taints.split(/\n|,/).map((t) => t.trim()).filter(Boolean) }), {
    success: `Updated ${pool.name}`, onSuccess: onClose, onError: (e) => setError(e.message), silent: false,
  });
  return (
    <Modal open={open} onClose={onClose} title={`Labels & taints · ${pool.name}`} description="Changes apply to all nodes in the pool immediately; running pods are not evicted."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      {error && <Hint tone="danger" className="mb-3">{error}</Hint>}
      <div className="space-y-4">
        <Field label="Labels"><TagEditor value={labels} onChange={setLabels} suggestions={['role', 'workload', 'tier']} /></Field>
        <Field label="Taints" hint="One per line, key=value:NoSchedule | PreferNoSchedule | NoExecute">
          <textarea value={taints} onChange={(e) => setTaints(e.target.value)} rows={3} className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[12.5px] text-fg focus:border-brand-500 focus:outline-none" />
        </Field>
      </div>
    </Modal>
  );
}

function AddPoolModal({ open, onClose, c }: { open: boolean; onClose: () => void; c: K8sCluster }) {
  const [draft, setDraft] = useState<PoolDraft>(() => newPoolDraft('pool-2', 'k8s-np-m', 2));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => { if (open) { setDraft(newPoolDraft(`pool-${c.nodePools.length + 1}`, 'k8s-np-m', 2)); setErrors({}); setFormError(null) } }, [open]); // eslint-disable-line
  const add = useApiMutation(() => api.action('k8sClusters', c.id, 'addNodePool', poolBody(draft)), {
    silent: true,
    onSuccess: () => { toast.success(`Adding node pool ${draft.name}`, 'Nodes join the cluster in a few moments.'); onClose() },
    onError: (e: ApiClientError) => { setErrors(Object.fromEntries(Object.entries(fieldErrors(e)).map(([k, v]) => [k.replace(/^pool\./, ''), v]))); setFormError(e.message) },
  });
  const taken = c.nodePools.some((p) => p.name === draft.name);
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Add node pool" description={`New nodes join ${c.name} with kubelet v${c.version}.`}
      footer={<>
        <span className="mr-auto text-sm text-muted">+{money(poolNodeCost(draft) * draft.count)}/mo</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={Plus} loading={add.isPending} disabled={!draft.name || taken} onClick={() => add.mutate()}>Add pool</Button>
      </>}>
      {formError && <Hint tone="danger" className="mb-3">{formError}</Hint>}
      <NodePoolEditor value={draft} onChange={setDraft} errors={errors} nameTaken={taken} />
    </Modal>
  );
}

function NodeDrawer({ node, topology, onClose }: { node: K8sNode | null; topology: K8sTopology | undefined; onClose: () => void }) {
  const pods = (topology?.pods ?? []).filter((p) => p.node === node?.name);
  return (
    <Drawer open={!!node} onClose={onClose} title={node?.name ?? ''} description={node ? `${node.poolName} · ${node.zone} · ${node.internalIp}` : undefined}>
      {node && (
        <div className="space-y-5">
          <KeyValue items={[
            ['Status', <StatusPill status={node.status} label={node.unschedulable && node.status === 'Ready' ? 'Ready, SchedulingDisabled' : node.status} />],
            ['Kubelet', <span className="font-mono">{node.version}</span>],
            ['Capacity', `${node.vcpus} vCPU · ${node.ramGB} GB${node.gpu ? ` · ${node.gpu.count}× ${node.gpu.model}` : ''}`],
            ['Allocatable', `${fmtCpu(node.allocatable.cpuM)} · ${fmtMem(node.allocatable.memMi)} · ${node.allocatable.pods} pods`],
            ['Requested', `${fmtCpu(node.requested.cpuM)} · ${fmtMem(node.requested.memMi)}`],
            ['Created', timeAgo(node.createdAt)],
          ]} />
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted">Labels</div>
            <div className="flex flex-wrap gap-1">{node.labels.map((l) => <Badge key={l.key} className="font-mono text-[10px]">{l.key}={l.value}</Badge>)}</div>
          </div>
          {node.taints.length > 0 && <div><div className="mb-1.5 text-xs font-medium text-muted">Taints</div><div className="flex flex-wrap gap-1">{node.taints.map((t) => <Badge key={t} tone="warning" className="font-mono text-[10px]">{t}</Badge>)}</div></div>}
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted">Pods ({pods.length})</div>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {pods.map((p) => (
                <li key={p.name} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: nsColor(p.namespace) }} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg">{p.namespace}/{p.name}</span>
                  <span className="shrink-0 tabular text-muted">{fmtCpu(p.cpuM)} · {fmtMem(p.memMi)}</span>
                  <StatusPill status={p.status} />
                </li>
              ))}
              {pods.length === 0 && <li className="px-3 py-4 text-center text-xs text-muted">No pods</li>}
            </ul>
          </div>
          <pre className="overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] text-fg-2">{`kubectl describe node ${node.name}\nkubectl cordon ${node.name}\nkubectl drain ${node.name} --ignore-daemonsets --delete-emptydir-data`}</pre>
        </div>
      )}
    </Drawer>
  );
}

export function NodesTab({ cluster: c, topology, busy }: { cluster: K8sCluster; topology: K8sTopology | undefined; busy: boolean }) {
  const [adding, setAdding] = useState(false);
  const [nodeSel, setNodeSel] = useState<K8sNode | null>(null);
  const nodes = topology?.nodes ?? [];
  const pro = usePro();
  const allColumns: (Column<K8sNode> & { pro?: boolean })[] = [
    { id: 'name', header: 'Node', sort: (n) => n.name, cell: (n) => <div className="min-w-0"><div className="truncate font-mono text-[12px] font-medium text-fg">{n.name}</div><div className="text-[11px] text-muted">{n.poolName}{n.surge ? ' · surge' : ''}</div></div> },
    { id: 'status', header: 'Status', sort: (n) => n.status, cell: (n) => <StatusPill status={n.status} label={n.unschedulable && n.status === 'Ready' ? 'cordoned' : n.status} /> },
    { id: 'version', header: 'Kubelet', pro: true, hideBelow: 'md', sort: (n) => n.version, cell: (n) => <span className="font-mono text-xs text-fg-2">{n.version}</span> },
    { id: 'ip', header: 'Internal IP', pro: true, hideBelow: 'lg', cell: (n) => <span className="font-mono text-xs text-fg-2">{n.internalIp}</span> },
    { id: 'zone', header: 'Zone', pro: true, hideBelow: 'xl', sort: (n) => n.zone, cell: (n) => <span className="text-fg-2">{n.zone}</span> },
    { id: 'cpu', header: 'CPU req.', sort: (n) => n.requested.cpuM / n.allocatable.cpuM, cell: (n) => <div className="w-24"><Bar v={n.requested.cpuM / n.allocatable.cpuM} /><div className="mt-0.5 text-[10.5px] tabular text-muted">{fmtCpu(n.requested.cpuM)} / {fmtCpu(n.allocatable.cpuM)}</div></div> },
    { id: 'mem', header: 'Mem req.', hideBelow: 'sm', sort: (n) => n.requested.memMi / n.allocatable.memMi, cell: (n) => <div className="w-24"><Bar v={n.requested.memMi / n.allocatable.memMi} /><div className="mt-0.5 text-[10.5px] tabular text-muted">{fmtMem(n.requested.memMi)} / {fmtMem(n.allocatable.memMi)}</div></div> },
    { id: 'pods', header: 'Pods', align: 'right', sort: (n) => n.podCount, cell: (n) => <span className="tabular text-fg">{n.podCount}</span> },
  ];
  const columns = allColumns.filter((col) => pro || !col.pro);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-fg">Node pools</h3>
          <p className="text-[13px] text-muted">{pro ? 'Scale, autoscale and manage worker pools. Scaling down cordons and drains nodes first.' : 'Drag the slider to add or remove nodes. Apps are moved safely first.'}</p>
        </div>
        <Button variant="primary" icon={Plus} disabled={busy || c.nodePools.length >= 10} onClick={() => setAdding(true)}>Add node pool</Button>
      </div>
      {busy && <Hint>An operation is running on this cluster. Pool changes that add or remove nodes are queued until it finishes.</Hint>}
      <div className="space-y-4">
        {c.nodePools.map((p) => <PoolCard key={p.id} c={c} pool={p} nodes={nodes.filter((n) => n.poolId === p.id && !n.surge)} busy={busy} />)}
      </div>
      <div>
        <h3 className="mb-3 text-[15px] font-semibold text-fg">Nodes <span className="text-sm font-normal text-muted">({nodes.length})</span></h3>
        <DataTable rows={nodes.map((n) => ({ ...n, id: n.name }))} columns={columns as unknown as Column<K8sNode & { id: string }>[]} searchText={(n) => `${n.name} ${n.poolName} ${n.internalIp} ${n.status} ${n.zone}`} searchPlaceholder="Search nodes…"
          onRowClick={(n) => setNodeSel(n)} defaultSort={{ id: 'name', dir: 'asc' }} empty={{ icon: Server, title: 'No nodes yet' }} />
      </div>
      <AddPoolModal open={adding} onClose={() => setAdding(false)} c={c} />
      <NodeDrawer node={nodeSel ? nodes.find((n) => n.name === nodeSel.name) ?? nodeSel : null} topology={topology} onClose={() => setNodeSel(null)} />
    </div>
  );
}
