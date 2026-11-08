import { useEffect, useState } from 'react';
import { Save, Plus } from 'lucide-react';
import { useApiMutation, useList } from '@/api/hooks';
import { api } from '@/api/client';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, NumberInput } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { ListenerFields, RulesEditor, TargetGroupFields, TargetAdder, TargetList, newListener, newTargetGroup, targetCandidates, type ListenerDraft, type TgDraft, type RuleDraft, type TargetDraft } from './forms';
import type { Certificate, K8sCluster, LoadBalancer, Listener, Network, TargetGroup, VM, LbTarget } from '@/types';

/* Modals used by the load balancer detail page; each submits one API action. */

function useLbCandidates(lb: LoadBalancer) {
  const { items: vms } = useList<VM>('vms');
  const { items: clusters } = useList<K8sCluster>('k8sClusters');
  const { items: networks } = useList<Network>('networks');
  return { ...targetCandidates(vms, clusters, { projectId: lb.projectId, locationId: lb.locationId, networkId: lb.networkId, networks }), allVms: vms, allClusters: clusters };
}

export function ListenerModal({ lb, listener, open, onClose }: { lb: LoadBalancer; listener: Listener | null; open: boolean; onClose: () => void }) {
  const { items: certs } = useList<Certificate>('certificates');
  const projectCerts = certs.filter((c) => c.projectId === lb.projectId);
  const [draft, setDraft] = useState<ListenerDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (listener) setDraft({ id: listener.id, port: listener.port, protocol: listener.protocol, certificateId: listener.certificateId ?? null, defaultTargetGroupId: listener.defaultTargetGroupId, redirectToHttps: !!listener.redirectToHttps, rules: [] });
    else {
      const free = lb.type === 'L7' ? (lb.listeners.some((l) => l.port === 443) ? (lb.listeners.some((l) => l.port === 80) ? 8443 : 80) : 443) : 8000 + lb.listeners.length;
      const cert = projectCerts.find((c) => c.status === 'issued' || c.status === 'expiring');
      const base = newListener(lb.type, lb.targetGroups[0]?.id ?? '', free === 443 && !!cert, cert?.id);
      setDraft({ ...base, port: free, protocol: lb.type === 'L4' ? 'TCP' : free === 443 && cert ? 'HTTPS' : 'HTTP' });
    }
  }, [open, listener?.id]); // eslint-disable-line
  const idx = listener ? lb.listeners.findIndex((l) => l.id === listener.id) : lb.listeners.length;
  const save = useApiMutation(() => {
    const d = draft!;
    const payload = { port: d.port, protocol: d.protocol, certificateId: d.protocol === 'HTTPS' ? d.certificateId : null, defaultTargetGroupId: d.defaultTargetGroupId, redirectToHttps: d.redirectToHttps };
    return listener ? api.action('loadBalancers', lb.id, 'updateListener', { listenerId: listener.id, ...payload }) : api.action('loadBalancers', lb.id, 'addListener', payload);
  }, { success: listener ? 'Listener updated — reloading proxies' : 'Listener added — reloading proxies', onSuccess: onClose, onError: (e) => setErrors(fieldErrors(e)) });
  if (!draft) return null;
  return (
    <Modal open={open} onClose={onClose} size="lg" title={listener ? `Edit listener ${listener.protocol} :${listener.port}` : 'Add listener'} description="Changes are applied with a hot reload — existing connections are not dropped."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Save} loading={save.isPending} onClick={() => save.mutate()}>{listener ? 'Save' : 'Add listener'}</Button></>}>
      <ListenerFields value={draft} onChange={setDraft} type={lb.type} targetGroups={lb.targetGroups} certificates={projectCerts} errors={errors} prefix={`listeners.${idx}`} showRules={false}
        siblings={lb.listeners.filter((l) => l.id !== listener?.id).map((l) => ({ ...l, certificateId: l.certificateId ?? null, redirectToHttps: !!l.redirectToHttps, rules: [] }))} />
      {Object.entries(errors).filter(([k]) => !k.startsWith(`listeners.${idx}.`)).map(([k, v]) => <p key={k} className="mt-2 text-xs text-rose-500">{v}</p>)}
    </Modal>
  );
}

export function RulesModal({ lb, listener, onClose }: { lb: LoadBalancer; listener: Listener | null; onClose: () => void }) {
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (listener) { setRules(listener.rules.map((r) => ({ ...r }))); setErrors({}) } }, [listener?.id]); // eslint-disable-line
  const idx = listener ? lb.listeners.findIndex((l) => l.id === listener.id) : 0;
  const save = useApiMutation(() => api.action('loadBalancers', lb.id, 'setRules', { listenerId: listener!.id, rules: rules.map((r) => ({ id: r.id.startsWith('rule-') ? undefined : r.id, host: r.host || undefined, pathPrefix: r.pathPrefix || undefined, targetGroupId: r.targetGroupId })) }),
    { success: 'Routing rules updated', onSuccess: onClose, onError: (e) => setErrors(fieldErrors(e)) });
  const tgName = (id: string) => lb.targetGroups.find((t) => t.id === id)?.name ?? '?';
  return (
    <Modal open={!!listener} onClose={onClose} size="lg" title={`Routing rules · ${listener?.protocol} :${listener?.port}`} description="First match wins. Host supports wildcards (*.example.com); path matches by prefix."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Save} loading={save.isPending} onClick={() => save.mutate()}>Save rules</Button></>}>
      <RulesEditor rules={rules} onChange={setRules} targetGroups={lb.targetGroups} errors={errors} prefix={`listeners.${idx}.rules`} />
      {listener && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">Anything else → default target group <b className="text-fg-2">{tgName(listener.defaultTargetGroupId)}</b></p>}
    </Modal>
  );
}

export function TargetGroupModal({ lb, group, open, onClose }: { lb: LoadBalancer; group: TargetGroup | null; open: boolean; onClose: () => void }) {
  const cand = useLbCandidates(lb);
  const [draft, setDraft] = useState<TgDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setDraft(group ? { id: group.id, name: group.name, protocol: group.protocol, port: group.port, stickySessions: group.stickySessions, healthCheck: { ...group.healthCheck }, targets: [] } : newTargetGroup(lb.type, `pool-${lb.targetGroups.length + 1}`));
  }, [open, group?.id]); // eslint-disable-line
  const save = useApiMutation(() => {
    const d = draft!;
    const payload = { name: d.name, protocol: d.protocol, port: d.port, stickySessions: d.stickySessions, healthCheck: d.healthCheck };
    return group ? api.action('loadBalancers', lb.id, 'updateTargetGroup', { targetGroupId: group.id, ...payload }) : api.action('loadBalancers', lb.id, 'addTargetGroup', { ...payload, targets: d.targets });
  }, { success: group ? 'Target group updated' : 'Target group added', onSuccess: onClose, onError: (e) => setErrors(fieldErrors(e)) });
  if (!draft) return null;
  return (
    <Modal open={open} onClose={onClose} size="lg" title={group ? `Edit target group ${group.name}` : 'Add target group'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={group ? Save : Plus} loading={save.isPending} onClick={() => save.mutate()}>{group ? 'Save' : 'Add group'}</Button></>}>
      <TargetGroupFields value={draft} onChange={setDraft} type={lb.type} vms={cand.vms} clusters={cand.clusters} errors={errors} prefix="targetGroup" showTargets={!group} />
    </Modal>
  );
}

export function AddTargetsModal({ lb, group, onClose }: { lb: LoadBalancer; group: TargetGroup | null; onClose: () => void }) {
  const cand = useLbCandidates(lb);
  const [targets, setTargets] = useState<TargetDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setTargets([]); setErrors({}) }, [group?.id]);
  const save = useApiMutation(() => api.action('loadBalancers', lb.id, 'addTarget', { targetGroupId: group!.id, targets }), {
    success: () => `Registered ${targets.length} target${targets.length > 1 ? 's' : ''} — health checks starting`, onSuccess: onClose, onError: (e) => setErrors(fieldErrors(e)),
  });
  const existing: TargetDraft[] = (group?.targets ?? []).map((t) => ({ ref: t.ref, port: t.port, weight: t.weight }));
  return (
    <Modal open={!!group} onClose={onClose} size="lg" title={`Register targets in ${group?.name ?? ''}`} description={`Only VMs and clusters in this project at ${lb.locationId}, reachable from the load balancer's network, are listed.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Plus} disabled={!targets.length} loading={save.isPending} onClick={() => save.mutate()}>Register {targets.length || ''}</Button></>}>
      <div className="space-y-3">
        <TargetAdder vms={cand.vms} clusters={cand.clusters} exclude={[...existing, ...targets]} defaultPort={group?.port} onAdd={(t) => setTargets([...targets, t])} />
        <TargetList targets={targets} onChange={setTargets} vms={cand.allVms} clusters={cand.allClusters} errors={Object.fromEntries(Object.entries(errors).map(([k, v]) => [k === 'ref' ? 'targets.0' : k, v]))} prefix="targets" />
      </div>
    </Modal>
  );
}

export function WeightModal({ lb, target, onClose }: { lb: LoadBalancer; target: { tg: TargetGroup; t: LbTarget } | null; onClose: () => void }) {
  const [weight, setWeight] = useState(100);
  useEffect(() => { if (target) setWeight(target.t.weight) }, [target]);
  const save = useApiMutation(() => api.action('loadBalancers', lb.id, 'setTargetWeight', { targetGroupId: target!.tg.id, ref: target!.t.ref, weight }), { success: 'Weight updated', onSuccess: onClose });
  const total = target ? target.tg.targets.filter((x) => x.health === 'healthy' && !x.drained).reduce((a, x) => a + (x === target.t ? weight : x.weight), 0) : 0;
  return (
    <Modal open={!!target} onClose={onClose} size="sm" title={`Weight · ${target?.t.name ?? target?.t.ref.id ?? ''}`} description="Relative share of new connections among healthy targets. 0 removes it from rotation without deregistering."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Save} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <Field label="Weight" hint={total > 0 && target?.t.health === 'healthy' ? `≈ ${Math.round((weight / total) * 100)}% of ${target?.tg.name} traffic` : undefined}>
        <NumberInput value={weight} onChange={setWeight} min={0} max={1000} step={10} />
      </Field>
    </Modal>
  );
}

