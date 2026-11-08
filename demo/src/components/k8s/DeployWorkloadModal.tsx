import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Rocket, Zap } from 'lucide-react';
import { api, ApiClientError } from '@/api/client';
import { useApiMutation } from '@/api/hooks';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Hint, Input, NumberInput, Select, Slider, TagEditor } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { IacTabs, toCurl } from '@/components/ui/CodeBlock';
import { fieldErrors } from '@/components/ui/FormLayout';
import { toast } from '@/components/ui/toast';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import { fmtCpu, fmtMem, poolNodeCost } from './k8sUi';
import { Advanced } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import type { K8sCluster, K8sClusterSummary, K8sWorkload, Tag } from '@/types';

const TEMPLATES: Record<string, { label: string; name: string; image: string; replicas: number; cpu: number; mem: number; ports: string; kind: K8sWorkload['kind']; expose: K8sWorkload['expose']; gpu?: number; schedule?: string }> = {
  nginx: { label: 'nginx web', name: 'web', image: 'nginx:1.27-alpine', replicas: 3, cpu: 100, mem: 128, ports: '80', kind: 'Deployment', expose: 'ClusterIP' },
  api: { label: 'Node.js API', name: 'api', image: 'registry.regiocom-energie.de/team/api:1.4.2', replicas: 4, cpu: 500, mem: 512, ports: '8080', kind: 'Deployment', expose: 'ClusterIP' },
  redis: { label: 'Redis', name: 'redis', image: 'redis:7.4-alpine', replicas: 1, cpu: 250, mem: 1024, ports: '6379', kind: 'StatefulSet', expose: 'ClusterIP' },
  worker: { label: 'Queue worker (big)', name: 'worker', image: 'registry.regiocom-energie.de/team/worker:2.0.1', replicas: 6, cpu: 1500, mem: 3072, ports: '', kind: 'Deployment', expose: 'none' },
  llm: { label: 'LLM inference (GPU)', name: 'llm', image: 'vllm/vllm-openai:v0.6.3', replicas: 1, cpu: 4000, mem: 24576, ports: '8000', kind: 'Deployment', expose: 'LoadBalancer', gpu: 1 },
  cron: { label: 'Nightly job', name: 'nightly-report', image: 'registry.regiocom-energie.de/team/report:1.0.0', replicas: 1, cpu: 200, mem: 256, ports: '', kind: 'CronJob', expose: 'none', schedule: '0 2 * * *' },
};

interface SimResult { before: K8sClusterSummary; after: K8sClusterSummary; workloadPending: number; newlyPending: number; reasons: string[]; autoscale: { poolId: string; poolName: string; from: number; to: number } | null }

export function toManifest(c: K8sCluster, w: { namespace: string; name: string; kind: string; image: string; replicas: number; cpuRequestM: number; memRequestMi: number; ports: number[]; gpuPerPod?: number; schedule?: string; env?: Tag[]; expose?: string }): string {
  const container = [
    `      - name: ${w.name}`,
    `        image: ${w.image}`,
    ...(w.ports.length ? ['        ports:', ...w.ports.map((p) => `        - containerPort: ${p}`)] : []),
    ...(w.env?.length ? ['        env:', ...w.env.flatMap((e) => [`        - name: ${e.key}`, `          value: "${e.value}"`])] : []),
    '        resources:',
    '          requests:',
    `            cpu: ${w.cpuRequestM}m`,
    `            memory: ${w.memRequestMi}Mi`,
    ...(w.gpuPerPod ? ['          limits:', `            nvidia.com/gpu: ${w.gpuPerPod}`] : []),
  ];
  const tol = w.gpuPerPod ? ['      tolerations:', '      - key: nvidia.com/gpu', '        operator: Exists', '        effect: NoSchedule'] : [];
  const podSpec = (indent: string) => [`${indent}metadata:`, `${indent}  labels:`, `${indent}    app: ${w.name}`, `${indent}spec:`, ...tol.map((l) => indent.slice(4) + l), ...[`      containers:`, ...container].map((l) => indent.slice(4) + l)];
  const lines = w.kind === 'CronJob'
    ? ['apiVersion: batch/v1', 'kind: CronJob', 'metadata:', `  name: ${w.name}`, `  namespace: ${w.namespace}`, 'spec:', `  schedule: "${w.schedule}"`, '  jobTemplate:', '    spec:', '      template:', ...podSpec('        ').map((l) => '    ' + l), '            restartPolicy: OnFailure']
    : ['apiVersion: apps/v1', `kind: ${w.kind}`, 'metadata:', `  name: ${w.name}`, `  namespace: ${w.namespace}`, 'spec:', ...(w.kind !== 'DaemonSet' ? [`  replicas: ${w.replicas}`] : []), ...(w.kind === 'StatefulSet' ? [`  serviceName: ${w.name}`] : []), '  selector:', '    matchLabels:', `      app: ${w.name}`, '  template:', ...podSpec('    ')];
  if (w.expose && w.expose !== 'none' && w.ports.length) {
    lines.push('---', 'apiVersion: v1', 'kind: Service', 'metadata:', `  name: ${w.name}`, `  namespace: ${w.namespace}`, 'spec:', `  type: ${w.expose}`, '  selector:', `    app: ${w.name}`, '  ports:', ...w.ports.map((p) => `  - port: ${p}\n    targetPort: ${p}`));
  }
  return `# kubectl --context ${c.name} apply -f -\n` + lines.join('\n');
}

export function DeployWorkloadModal({ cluster, open, onClose, namespaces, onDeployed }: { cluster: K8sCluster; open: boolean; onClose: () => void; namespaces: string[]; onDeployed?: (w: K8sWorkload) => void }) {
  const pro = usePro();
  const [tpl, setTpl] = useState('nginx');
  const [name, setName] = useState('web');
  const [namespace, setNamespace] = useState('default');
  const [kind, setKind] = useState<K8sWorkload['kind']>('Deployment');
  const [image, setImage] = useState('nginx:1.27-alpine');
  const [replicas, setReplicas] = useState(3);
  const [cpu, setCpu] = useState(100);
  const [mem, setMem] = useState(128);
  const [gpu, setGpu] = useState(0);
  const [ports, setPorts] = useState('80');
  const [expose, setExpose] = useState<NonNullable<K8sWorkload['expose']>>('ClusterIP');
  const [schedule, setSchedule] = useState('0 2 * * *');
  const [env, setEnv] = useState<Tag[]>([]);
  const [pool, setPool] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sim, setSim] = useState<SimResult | null>(null);
  const hasGpu = cluster.nodePools.some((p) => p.gpu);

  const applyTpl = (k: string) => {
    const t = TEMPLATES[k];
    setTpl(k); setName(t.name); setImage(t.image); setReplicas(t.replicas); setCpu(t.cpu); setMem(t.mem); setPorts(t.ports); setKind(t.kind); setExpose(t.expose ?? 'none'); setGpu(t.gpu ?? 0); if (t.schedule) setSchedule(t.schedule);
  };
  useEffect(() => { if (open) { setErrors({}); setFormError(null) } }, [open]);

  const portList = ports.split(/[,\s]+/).filter(Boolean).map(Number);
  const nodeSelector = pool ? [{ key: 'autark.io/pool', value: pool }] : undefined;
  const body = {
    clusterId: cluster.id, namespace, name, kind, image, replicas: kind === 'DaemonSet' ? 0 : replicas, cpuRequestM: cpu, memRequestMi: mem, ports: portList,
    gpuPerPod: gpu || undefined, expose, schedule: kind === 'CronJob' ? schedule : undefined, env, nodeSelector,
  };

  // dry-run the scheduler while the user edits (debounced)
  const simKey = JSON.stringify([kind, replicas, cpu, mem, gpu, pool, namespace, open]);
  useEffect(() => {
    if (!open || kind === 'CronJob') { setSim(null); return }
    const t = setTimeout(() => {
      api.post<SimResult>(`/k8sClusters/${cluster.id}/simulate`, { workload: { namespace, name, kind, replicas: kind === 'DaemonSet' ? 0 : replicas, cpuRequestM: cpu, memRequestMi: mem, gpuPerPod: gpu || undefined, nodeSelector } })
        .then(setSim).catch(() => setSim(null));
    }, 300);
    return () => clearTimeout(t);
  }, [simKey]); // eslint-disable-line

  const deploy = useApiMutation(() => api.create<K8sWorkload>('k8sWorkloads', body), {
    silent: true,
    onSuccess: (w) => { toast.success(`Deploying ${w.namespace}/${w.name}`, 'Watch the pods land on the cluster map.'); onDeployed?.(w); onClose() },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); setFormError(e.message) },
  });

  const nameErr = name && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name) ? 'Lowercase letters, digits and dashes' : errors.name;
  const totalCpu = cpu * (kind === 'DaemonSet' ? cluster.nodePools.reduce((a, p) => a + p.count, 0) : replicas);
  const totalMem = mem * (kind === 'DaemonSet' ? cluster.nodePools.reduce((a, p) => a + p.count, 0) : replicas);
  const manifest = useMemo(() => toManifest(cluster, { ...body, env }), [JSON.stringify(body)]); // eslint-disable-line

  const nameField = <Field label="Name" required error={nameErr}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} mono invalid={!!nameErr} /></Field>;
  const namespaceField = (
    <Field label="Namespace" error={errors.namespace} hint="New namespaces are created automatically">
      <Input value={namespace} onChange={(e) => setNamespace(e.target.value.toLowerCase())} list="k8s-ns" mono />
      <datalist id="k8s-ns">{namespaces.filter((n) => n !== 'kube-system').map((n) => <option key={n} value={n} />)}</datalist>
    </Field>
  );
  const kindField = <Field label="Kind"><Segmented value={kind} onChange={setKind} options={[{ value: 'Deployment', label: 'Deployment' }, { value: 'StatefulSet', label: 'StatefulSet' }, { value: 'DaemonSet', label: 'DaemonSet' }, { value: 'CronJob', label: 'CronJob' }]} /></Field>;
  const imageField = (
    <Field label="Container image" required error={errors.image} hint={cluster.addons.kyverno ? (pro ? 'Kyverno policy is active: images must use a pinned tag (no :latest).' : 'Use a fixed version tag, not :latest.') : undefined}>
      <Input value={image} onChange={(e) => setImage(e.target.value)} mono placeholder="registry/app:1.0.0" invalid={!!errors.image} />
    </Field>
  );
  const replicasField = kind === 'CronJob' ? (
    <Field label="Schedule (cron, UTC)" error={errors.schedule}><Input value={schedule} onChange={(e) => setSchedule(e.target.value)} mono /></Field>
  ) : kind !== 'DaemonSet' ? (
    <Field label={`${pro ? 'Replicas' : 'Copies'} · ${replicas}`} error={errors.replicas}><Slider value={replicas} onChange={setReplicas} min={0} max={30} marks={[0, 5, 10, 20, 30]} /></Field>
  ) : <p className="text-xs text-muted">A DaemonSet runs one pod on every eligible node.</p>;
  const resourcesFields = (
    <div className="grid gap-3 @min-[36rem]:grid-cols-3">
      <Field label="CPU request / pod" error={errors.cpuRequestM}><NumberInput value={cpu} onChange={setCpu} min={10} max={32000} step={cpu < 1000 ? 50 : 250} unit="m" /></Field>
      <Field label="Memory / pod" error={errors.memRequestMi}><NumberInput value={mem} onChange={setMem} min={16} max={262144} step={mem < 1024 ? 64 : 512} unit="Mi" /></Field>
      {hasGpu ? <Field label="GPUs / pod" error={errors.gpuPerPod}><NumberInput value={gpu} onChange={setGpu} min={0} max={8} /></Field> : <div />}
    </div>
  );
  const portsField = <Field label={pro ? 'Container ports' : 'Port'} error={errors.ports}><Input value={ports} onChange={(e) => setPorts(e.target.value)} placeholder={pro ? '8080, 9090' : '8080'} mono /></Field>;
  const exposeField = (
    <Field label="Expose as">
      <Select value={expose} onChange={(e) => setExpose(e.target.value as typeof expose)} options={[{ value: 'none', label: 'Not exposed' }, { value: 'ClusterIP', label: pro ? 'ClusterIP service' : 'Inside the cluster' }, { value: 'LoadBalancer', label: pro ? 'LoadBalancer (public)' : 'Public (load balancer)' }]} />
    </Field>
  );
  const poolField = (
    <Field label="Node pool">
      <Select value={pool} onChange={(e) => setPool(e.target.value)} options={[{ value: '', label: 'Any (scheduler decides)' }, ...cluster.nodePools.map((p) => ({ value: p.name, label: p.name }))]} />
    </Field>
  );
  const envField = <Field label="Environment variables" optional><TagEditor value={env} onChange={setEnv} suggestions={['LOG_LEVEL', 'PORT', 'NODE_ENV']} /></Field>;
  const advancedNeeded = ['namespace', 'cpuRequestM', 'memRequestMi', 'gpuPerPod', 'schedule'].some((k) => errors[k]);

  return (
    <Modal open={open} onClose={onClose} size="xl" title="Deploy workload" description={pro ? `Runs on ${cluster.name}. Requests are reserved on nodes by the scheduler — pods that don't fit stay Pending.` : `Run a container image on ${cluster.name}.`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={Rocket} loading={deploy.isPending} disabled={!name || !!nameErr || !image} onClick={() => deploy.mutate()}>Deploy</Button>
      </>}>
      {formError && <Hint tone="danger" className="mb-4">{formError}</Hint>}
      <div className="grid gap-5 @min-[56rem]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <Field label="Start from">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(TEMPLATES).filter(([k]) => k !== 'llm' || hasGpu).map(([k, t]) => (
                <button key={k} type="button" onClick={() => applyTpl(k)} className={cn('h-7 rounded-lg border px-2.5 text-xs font-medium transition-colors', tpl === k ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-line text-fg-2 hover:bg-surface-2')}>{t.label}</button>
              ))}
            </div>
          </Field>
          {pro ? (
            <>
              <div className="grid gap-3 @min-[36rem]:grid-cols-2">
                {nameField}
                {namespaceField}
              </div>
              {kindField}
              {imageField}
              {replicasField}
              {resourcesFields}
              <div className="grid gap-3 @min-[36rem]:grid-cols-3">
                {portsField}
                {exposeField}
                {poolField}
              </div>
              {envField}
              <details className="group">
                <summary className="cursor-pointer text-xs font-medium text-muted hover:text-fg">Show manifest / kubectl</summary>
                <IacTabs className="mt-2" title="Equivalent manifest" snippets={{
                  yaml: manifest,
                  cli: kind === 'CronJob' ? `kubectl --context ${cluster.name} -n ${namespace} create cronjob ${name} --image=${image} --schedule="${schedule}"` : `kubectl --context ${cluster.name} -n ${namespace} create deployment ${name} \\\n  --image=${image} --replicas=${replicas}${portList[0] ? ` --port=${portList[0]}` : ''}\nkubectl -n ${namespace} set resources deployment ${name} --requests=cpu=${cpu}m,memory=${mem}Mi`,
                  curl: toCurl('POST', '/k8sWorkloads', body),
                }} />
              </details>
            </>
          ) : (
            <>
              {nameField}
              {imageField}
              <div className="grid gap-3 @min-[36rem]:grid-cols-[minmax(0,1fr)_140px]">
                {replicasField}
                {portsField}
              </div>
              <Advanced key={advancedNeeded ? 'adv-open' : 'adv'} defaultOpen={advancedNeeded || undefined} description={`${kind} · ${fmtCpu(cpu)} CPU, ${fmtMem(mem)} per pod · namespace ${namespace} · ${expose === 'LoadBalancer' ? 'public' : expose === 'ClusterIP' ? 'internal service' : 'not exposed'}`}>
                {kindField}
                {namespaceField}
                {resourcesFields}
                <div className="grid gap-3 @min-[36rem]:grid-cols-2">
                  {exposeField}
                  {poolField}
                </div>
                {envField}
              </Advanced>
            </>
          )}
        </div>

        <aside className="space-y-3">
          {pro && <div className="rounded-xl border border-line bg-surface-2/50 p-3">
            <div className="text-xs font-medium text-muted">Total requests</div>
            <div className="mt-1 text-lg font-semibold tabular text-fg">{fmtCpu(totalCpu)} · {fmtMem(totalMem)}</div>
            {gpu > 0 && <div className="text-xs text-lime-600 dark:text-lime-400">{gpu * replicas}× GPU</div>}
          </div>}
          {kind !== 'CronJob' && (
            <div className="rounded-xl border border-line p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted"><Zap className="size-3.5" /> Scheduler dry-run</div>
              {!sim ? <div className="text-xs text-faint">Calculating…</div> : (
                <div className="space-y-3 text-xs">
                  {sim.workloadPending === 0 ? (
                    <div className="flex items-start gap-2 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /> All pods fit on existing nodes.</div>
                  ) : (
                    <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      <div>
                        <b>{sim.workloadPending}</b> pod{sim.workloadPending > 1 ? 's' : ''} won't fit.
                        {sim.autoscale ? <> The autoscaler will grow <b>{sim.autoscale.poolName}</b> {sim.autoscale.from} → {sim.autoscale.to} nodes.</> : <> No autoscaling pool has headroom — they will stay <b>Pending</b>.</>}
                        {sim.reasons[0] && <div className="mt-1 text-[11px] text-muted">{sim.reasons[0]}</div>}
                      </div>
                    </div>
                  )}
                  {[['CPU requested', sim.before.cpuRequestedPct, sim.after.cpuRequestedPct], ['Memory requested', sim.before.memRequestedPct, sim.after.memRequestedPct]].map(([label, b, a]) => (
                    <div key={label as string}>
                      <div className="mb-1 flex justify-between"><span className="text-muted">{label}</span><span className="tabular text-fg-2">{Math.round((b as number) * 100)}% → <b className={cn((a as number) > 0.9 && 'text-rose-500')}>{Math.round((a as number) * 100)}%</b></span></div>
                      <div className="relative h-2 overflow-hidden rounded-full bg-surface-3">
                        <div className="absolute inset-y-0 left-0 rounded-full bg-brand-500/40" style={{ width: `${Math.min(100, (b as number) * 100)}%` }} />
                        <div className={cn('absolute inset-y-0 rounded-r-full', (a as number) > 0.9 ? 'bg-rose-500' : 'bg-brand-500')} style={{ left: `${Math.min(100, (b as number) * 100)}%`, width: `${Math.max(0, Math.min(100, (a as number) * 100) - Math.min(100, (b as number) * 100))}%` }} />
                      </div>
                    </div>
                  ))}
                  <div className="text-[11px] text-muted">Pods after deploy: {sim.after.pods} ({sim.after.pendingPods} pending)</div>
                </div>
              )}
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-muted">
            Workloads don't change the bill directly — nodes do.
            {sim?.autoscale && (() => { const p = cluster.nodePools.find((x) => x.id === sim.autoscale!.poolId); return p ? <> Autoscaling adds about <b className="text-fg-2">{money(poolNodeCost(p) * (sim.autoscale!.to - sim.autoscale!.from))}/mo</b>.</> : null })()}
          </p>
        </aside>
      </div>
    </Modal>
  );
}
