import { useState } from 'react';
import { Plus, X, Server, Boxes, ArrowRight, Lock, HeartPulse } from 'lucide-react';
import { Field, Input, Select, Switch, NumberInput } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { Certificate, K8sCluster, LbProtocol, LoadBalancer, Network, TargetGroup, VM, Ref } from '@/types';

/* Reusable editors for listeners, rules, target groups, health checks and targets. Used by the
 * create page (local drafts) and by the detail page modals (submitted as actions). */

export type LbType = LoadBalancer['type'];
export type HealthCheck = TargetGroup['healthCheck'];

export interface TargetDraft { ref: Ref; port?: number; weight: number }
export interface TgDraft { id: string; name: string; protocol: LbProtocol; port: number; stickySessions: boolean; healthCheck: HealthCheck; targets: TargetDraft[] }
export interface RuleDraft { id: string; host?: string; pathPrefix?: string; targetGroupId: string }
export interface ListenerDraft { id: string; port: number; protocol: LbProtocol; certificateId: string | null; defaultTargetGroupId: string; redirectToHttps: boolean; rules: RuleDraft[] }

let seq = 0;
export const tmpId = (p = 'tmp') => `${p}-${Date.now().toString(36)}-${++seq}`;

export const ALGORITHMS = [
  { value: 'round_robin', label: 'Round robin', description: 'Requests rotate evenly across healthy targets (respecting weights).' },
  { value: 'least_connections', label: 'Least connections', description: 'New connections go to the target with the fewest active ones. Best for long-lived requests.' },
  { value: 'ip_hash', label: 'Source IP hash', description: 'Same client IP lands on the same target — session affinity without cookies.' },
] as const;

export function defaultHealthCheck(protocol: LbProtocol): HealthCheck {
  const l7 = protocol === 'HTTP' || protocol === 'HTTPS';
  return { protocol: protocol === 'HTTPS' ? 'HTTPS' : l7 ? 'HTTP' : 'TCP', path: l7 ? '/healthz' : '', intervalSec: 10, timeoutSec: 3, healthyThreshold: 3, unhealthyThreshold: 3 };
}

export function newTargetGroup(type: LbType, name = 'web'): TgDraft {
  const protocol: LbProtocol = type === 'L7' ? 'HTTP' : 'TCP';
  return { id: tmpId('tg'), name, protocol, port: type === 'L7' ? 80 : 8080, stickySessions: false, healthCheck: defaultHealthCheck(protocol), targets: [] };
}

export function newListener(type: LbType, tgId: string, hasCert: boolean, certId?: string): ListenerDraft {
  if (type === 'L4') return { id: tmpId('lst'), port: 443, protocol: 'TCP', certificateId: null, defaultTargetGroupId: tgId, redirectToHttps: false, rules: [] };
  return hasCert
    ? { id: tmpId('lst'), port: 443, protocol: 'HTTPS', certificateId: certId ?? null, defaultTargetGroupId: tgId, redirectToHttps: false, rules: [] }
    : { id: tmpId('lst'), port: 80, protocol: 'HTTP', certificateId: null, defaultTargetGroupId: tgId, redirectToHttps: false, rules: [] };
}

export const protocolsFor = (type: LbType): LbProtocol[] => (type === 'L4' ? ['TCP', 'UDP'] : ['HTTP', 'HTTPS']);

/** Field errors from the API arrive with keys like "listeners.0.port"; pick by prefix. */
export function errAt(errors: Record<string, string> | undefined, key: string) { return errors?.[key] }

/* ------------------------------------------------------------------------------------------------
 * Listener
 * ---------------------------------------------------------------------------------------------- */

export function ListenerFields({ value, onChange, type, targetGroups, certificates, errors, prefix = '', showRules = true, siblings = [] }: {
  value: ListenerDraft; onChange: (v: ListenerDraft) => void; type: LbType; targetGroups: { id: string; name: string }[]; certificates: Certificate[];
  errors?: Record<string, string>; prefix?: string; showRules?: boolean; siblings?: ListenerDraft[];
}) {
  const p = (k: string) => errAt(errors, prefix ? `${prefix}.${k}` : k);
  const usable = certificates.filter((c) => c.status !== 'failed' && c.status !== 'expired');
  const hasHttps = siblings.some((s) => s.protocol === 'HTTPS') || value.protocol === 'HTTPS';
  const set = (patch: Partial<ListenerDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 @min-[36rem]:grid-cols-[140px_130px_1fr]">
        <Field label="Protocol" error={p('protocol')}>
          <Select value={value.protocol} onChange={(e) => {
            const protocol = e.target.value as LbProtocol;
            set({ protocol, port: protocol === 'HTTPS' ? 443 : protocol === 'HTTP' ? 80 : value.port, certificateId: protocol === 'HTTPS' ? value.certificateId ?? usable[0]?.id ?? null : null, redirectToHttps: protocol === 'HTTP' ? value.redirectToHttps : false });
          }} options={protocolsFor(type).map((x) => ({ value: x, label: x }))} />
        </Field>
        <Field label="Port" error={p('port')}><NumberInput value={value.port} onChange={(n) => set({ port: n })} min={1} max={65535} /></Field>
        {!value.redirectToHttps ? (
          <Field label="Default target group" error={p('defaultTargetGroupId')}>
            <Select value={value.defaultTargetGroupId} onChange={(e) => set({ defaultTargetGroupId: e.target.value })} placeholder={targetGroups.length ? undefined : 'Add a target group first'} options={targetGroups.map((t) => ({ value: t.id, label: t.name || '(unnamed)' }))} />
          </Field>
        ) : <div className="flex items-end pb-2 text-xs text-muted"><ArrowRight className="mr-1 size-3.5" /> Responds with 301 to https://</div>}
      </div>
      {value.protocol === 'HTTPS' && (
        <Field label={<span className="flex items-center gap-1.5"><Lock className="size-3.5" /> TLS certificate</span>} required error={p('certificateId')}
          hint={usable.length ? 'TLS terminates at the load balancer; certificates hot-swap on renewal.' : 'No certificate in this project yet — issue one under Load balancers → Certificates.'}>
          <Select value={value.certificateId ?? ''} onChange={(e) => set({ certificateId: e.target.value || null })} placeholder="Choose certificate"
            options={usable.map((c) => ({ value: c.id, label: `${c.name} · ${c.domains.join(', ')}${c.status === 'pending' ? ' (issuing…)' : c.status === 'expiring' ? ' (expiring)' : ''}` }))} />
        </Field>
      )}
      {value.protocol === 'HTTP' && type === 'L7' && (
        <Switch size="sm" checked={value.redirectToHttps} onChange={(v) => set({ redirectToHttps: v })} label="Redirect to HTTPS" description={hasHttps ? 'Answer every request with 301 → https://same-host/path.' : 'Requires an HTTPS listener on this load balancer.'} />
      )}
      {p('redirectToHttps') && <p className="text-xs text-rose-500">{p('redirectToHttps')}</p>}
      {showRules && type === 'L7' && !value.redirectToHttps && (
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-fg-2">Routing rules <span className="text-xs font-normal text-faint">evaluated top to bottom, then the default</span></div>
          <RulesEditor rules={value.rules} onChange={(rules) => set({ rules })} targetGroups={targetGroups} errors={errors} prefix={prefix ? `${prefix}.rules` : 'rules'} />
        </div>
      )}
    </div>
  );
}

export function RulesEditor({ rules, onChange, targetGroups, errors, prefix = 'rules' }: { rules: RuleDraft[]; onChange: (r: RuleDraft[]) => void; targetGroups: { id: string; name: string }[]; errors?: Record<string, string>; prefix?: string }) {
  return (
    <div className="space-y-2">
      {rules.map((r, i) => (
        <div key={r.id}>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2/40 p-2 @min-[36rem]:flex-nowrap">
            <span className="w-5 shrink-0 text-center text-[11px] font-semibold text-faint">{i + 1}</span>
            <Input className="h-8 min-w-0 flex-1 basis-32" value={r.host ?? ''} onChange={(e) => onChange(rules.map((x, j) => (j === i ? { ...x, host: e.target.value.toLowerCase() } : x)))} placeholder="host (any)" />
            <Input className="h-8 min-w-0 flex-1 basis-24" mono value={r.pathPrefix ?? ''} onChange={(e) => onChange(rules.map((x, j) => (j === i ? { ...x, pathPrefix: e.target.value } : x)))} placeholder="/path (any)" />
            <ArrowRight className="hidden size-4 shrink-0 text-faint @min-[36rem]:block" />
            <Select className="min-w-0 flex-1 basis-28" value={r.targetGroupId} onChange={(e) => onChange(rules.map((x, j) => (j === i ? { ...x, targetGroupId: e.target.value } : x)))} options={targetGroups.map((t) => ({ value: t.id, label: t.name || '(unnamed)' }))} />
            <button type="button" onClick={() => onChange(rules.filter((_, j) => j !== i))} className="rounded-md p-1 text-faint hover:bg-rose-500/10 hover:text-rose-500" aria-label="Remove rule"><X className="size-4" /></button>
          </div>
          {errors?.[`${prefix}.${i}`] && <p className="mt-1 text-xs text-rose-500">{errors[`${prefix}.${i}`]}</p>}
        </div>
      ))}
      <Button size="xs" variant="ghost" icon={Plus} disabled={!targetGroups.length} onClick={() => onChange([...rules, { id: tmpId('rule'), host: '', pathPrefix: '/', targetGroupId: targetGroups[0]?.id ?? '' }])}>Add rule</Button>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Health check
 * ---------------------------------------------------------------------------------------------- */

export function HealthCheckFields({ value, onChange, errors, prefix = 'healthCheck' }: { value: HealthCheck; onChange: (v: HealthCheck) => void; errors?: Record<string, string>; prefix?: string }) {
  const e = (k: string) => errors?.[`${prefix}.${k}`];
  const set = (patch: Partial<HealthCheck>) => onChange({ ...value, ...patch });
  const detectS = value.intervalSec * value.unhealthyThreshold;
  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface-2/40 p-3">
      <div className="flex items-center gap-2 text-[13px] font-medium text-fg-2"><HeartPulse className="size-3.5 text-rose-500" /> Health check</div>
      <div className="grid gap-3 @min-[36rem]:grid-cols-[150px_1fr]">
        <Field label="Protocol" error={e('protocol')}>
          <Segmented size="sm" value={value.protocol} onChange={(v) => set({ protocol: v, path: v === 'TCP' ? '' : value.path || '/healthz' })} options={[{ value: 'TCP', label: 'TCP' }, { value: 'HTTP', label: 'HTTP' }, { value: 'HTTPS', label: 'HTTPS' }]} />
        </Field>
        {value.protocol !== 'TCP'
          ? <Field label="Path" error={e('path')}><Input mono value={value.path} onChange={(ev) => set({ path: ev.target.value })} placeholder="/healthz" /></Field>
          : <div className="flex items-end pb-2 text-xs text-muted">Target is healthy when the TCP port accepts connections.</div>}
      </div>
      <div className="grid grid-cols-2 gap-3 @min-[36rem]:grid-cols-4">
        <Field label="Interval" error={e('intervalSec')}><NumberInput value={value.intervalSec} onChange={(n) => set({ intervalSec: n })} min={5} max={300} unit="s" /></Field>
        <Field label="Timeout" error={e('timeoutSec')}><NumberInput value={value.timeoutSec} onChange={(n) => set({ timeoutSec: n })} min={2} max={60} unit="s" /></Field>
        <Field label="Healthy after" error={e('healthyThreshold')}><NumberInput value={value.healthyThreshold} onChange={(n) => set({ healthyThreshold: n })} min={2} max={10} unit="×" /></Field>
        <Field label="Unhealthy after" error={e('unhealthyThreshold')}><NumberInput value={value.unhealthyThreshold} onChange={(n) => set({ unhealthyThreshold: n })} min={2} max={10} unit="×" /></Field>
      </div>
      <p className="text-[11px] text-muted">A failing target is taken out of rotation after ~{detectS}s and returns after {value.intervalSec * value.healthyThreshold}s of passing checks.</p>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Targets
 * ---------------------------------------------------------------------------------------------- */

export function targetCandidates(vms: VM[], clusters: K8sCluster[], ctx: { projectId: string; locationId: string; networkId?: string; networks?: Network[] }) {
  const net = ctx.networks?.find((n) => n.id === ctx.networkId);
  const reachable = (nid: string) => !ctx.networkId || nid === ctx.networkId || !!net?.peerings.some((p) => p.networkId === nid && p.status === 'active');
  return {
    vms: vms.filter((v) => v.projectId === ctx.projectId && v.locationId === ctx.locationId && reachable(v.networkId)),
    clusters: clusters.filter((k) => k.projectId === ctx.projectId && k.locationId === ctx.locationId),
  };
}

/** Pick a VM or a k8s cluster (NodePort) to add as a target. */
export function TargetAdder({ vms, clusters, exclude, onAdd, defaultPort }: { vms: VM[]; clusters: K8sCluster[]; exclude: TargetDraft[]; onAdd: (t: TargetDraft) => void; defaultPort?: number }) {
  const [kind, setKind] = useState<'vm' | 'k8s'>('vm');
  const [id, setId] = useState('');
  const [port, setPort] = useState<number>(30080);
  const taken = (type: string, i: string) => exclude.some((t) => t.ref.type === type && t.ref.id === i);
  const opts = kind === 'vm'
    ? vms.filter((v) => !taken('vm', v.id)).map((v) => ({ value: v.id, label: `${v.name} · ${v.privateIp}${v.status !== 'running' ? ` (${v.status})` : ''}` }))
    : clusters.filter((k) => !taken('k8s', k.id)).map((k) => ({ value: k.id, label: `${k.name} · ${k.nodePools.reduce((a, p) => a + p.count, 0)} nodes` }));
  const sel = opts.find((o) => o.value === id) ? id : '';
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Segmented size="sm" value={kind} onChange={(k) => { setKind(k); setId('') }} options={[{ value: 'vm', label: 'VM', icon: <Server className="size-3" /> }, { value: 'k8s', label: 'Kubernetes', icon: <Boxes className="size-3" /> }]} />
      <Select className="min-w-0 flex-1 basis-48" value={sel} onChange={(e) => setId(e.target.value)} placeholder={opts.length ? `Choose ${kind === 'vm' ? 'a VM' : 'a cluster'}…` : `No eligible ${kind === 'vm' ? 'VMs' : 'clusters'} in this project & location`} options={opts} />
      {kind === 'k8s' && <NumberInput className="w-36" value={port} onChange={setPort} min={30000} max={32767} unit="NodePort" />}
      <Button size="sm" icon={Plus} disabled={!sel} onClick={() => { onAdd({ ref: { type: kind, id: sel }, port: kind === 'k8s' ? port : undefined, weight: 100 }); setId('') }}>Add</Button>
      {kind === 'vm' && defaultPort ? <span className="w-full text-[11px] text-faint">Traffic is sent to the target group port ({defaultPort}) unless overridden.</span> : null}
    </div>
  );
}

export function TargetList({ targets, onChange, vms, clusters, errors, prefix }: { targets: TargetDraft[]; onChange: (t: TargetDraft[]) => void; vms: VM[]; clusters: K8sCluster[]; errors?: Record<string, string>; prefix: string }) {
  if (!targets.length) return <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-center text-xs text-muted">No targets yet — traffic will get 503 until you register some.</p>;
  return (
    <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
      {targets.map((t, i) => {
        const vm = t.ref.type === 'vm' ? vms.find((v) => v.id === t.ref.id) : undefined;
        const k = t.ref.type === 'k8s' ? clusters.find((c) => c.id === t.ref.id) : undefined;
        const err = errors?.[`${prefix}.${i}`];
        return (
          <div key={`${t.ref.type}:${t.ref.id}:${t.port ?? ''}`} className="px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-2">
              {t.ref.type === 'vm' ? <Server className="size-3.5 text-brand-500" /> : <Boxes className="size-3.5 text-sky-500" />}
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{vm?.name ?? k?.name ?? t.ref.id}
                <span className="ml-1.5 font-mono text-[11px] text-muted">{vm ? vm.privateIp : t.port ? `NodePort ${t.port}` : ''}</span>
                {vm && vm.status !== 'running' && <span className="ml-1.5 text-[11px] text-amber-600 dark:text-amber-400">{vm.status} — will be unhealthy</span>}
              </span>
              <span className="text-[11px] text-muted">weight</span>
              <NumberInput className="w-28" value={t.weight} onChange={(n) => onChange(targets.map((x, j) => (j === i ? { ...x, weight: n } : x)))} min={0} max={1000} step={10} />
              <button type="button" onClick={() => onChange(targets.filter((_, j) => j !== i))} className="rounded-md p-1 text-faint hover:bg-rose-500/10 hover:text-rose-500" aria-label="Remove target"><X className="size-4" /></button>
            </div>
            {err && <p className="mt-1 text-xs text-rose-500">{err}</p>}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Target group
 * ---------------------------------------------------------------------------------------------- */

export function TargetGroupFields({ value, onChange, type, vms, clusters, errors, prefix = 'targetGroup', showTargets = true }: {
  value: TgDraft; onChange: (v: TgDraft) => void; type: LbType; vms: VM[]; clusters: K8sCluster[]; errors?: Record<string, string>; prefix?: string; showTargets?: boolean;
}) {
  const e = (k: string) => errors?.[`${prefix}.${k}`];
  const set = (patch: Partial<TgDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 @min-[36rem]:grid-cols-[1fr_130px_130px]">
        <Field label="Name" error={e('name')}><Input value={value.name} onChange={(ev) => set({ name: ev.target.value.toLowerCase() })} placeholder="web" invalid={!!e('name')} /></Field>
        <Field label="Protocol" error={e('protocol')}>
          <Select value={value.protocol} onChange={(ev) => { const protocol = ev.target.value as LbProtocol; set({ protocol, healthCheck: { ...defaultHealthCheck(protocol), intervalSec: value.healthCheck.intervalSec } }) }} options={protocolsFor(type).map((x) => ({ value: x, label: x }))} />
        </Field>
        <Field label="Target port" error={e('port')}><NumberInput value={value.port} onChange={(n) => set({ port: n })} min={1} max={65535} /></Field>
      </div>
      {type === 'L7' && <Switch size="sm" checked={value.stickySessions} onChange={(v) => set({ stickySessions: v })} label="Sticky sessions" description="Cookie-based affinity (AUTARK_LB, 1 h) keeps a client on the same target." />}
      <HealthCheckFields value={value.healthCheck} onChange={(healthCheck) => set({ healthCheck })} errors={errors} prefix={`${prefix}.healthCheck`} />
      {showTargets && (
        <div className="space-y-2">
          <div className="text-[13px] font-medium text-fg-2">Targets <span className="text-xs font-normal text-faint">{value.targets.length} registered</span></div>
          <TargetList targets={value.targets} onChange={(targets) => set({ targets })} vms={vms} clusters={clusters} errors={errors} prefix={`${prefix}.targets`} />
          <TargetAdder vms={vms} clusters={clusters} exclude={value.targets} defaultPort={value.port} onAdd={(t) => set({ targets: [...value.targets, t] })} />
        </div>
      )}
    </div>
  );
}

/** Small colored dot legend chip used for target health. */
export const HEALTH_COLOR: Record<string, string> = { healthy: '#10b981', unhealthy: '#f43f5e', draining: '#f59e0b', initial: '#0ea5e9' };

export function HealthBar({ summary, className }: { summary?: LoadBalancer['healthSummary']; className?: string }) {
  if (!summary || !summary.total) return <span className="text-xs text-faint">no targets</span>;
  const seg = (['healthy', 'initial', 'draining', 'unhealthy'] as const).filter((k) => summary[k] > 0);
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        {seg.map((k) => <div key={k} style={{ width: `${(summary[k] / summary.total) * 100}%`, background: HEALTH_COLOR[k] }} />)}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted">
        <span><b className="font-medium text-fg-2">{summary.healthy}</b>/{summary.total} healthy</span>
        {summary.unhealthy > 0 && <span className="text-rose-500">{summary.unhealthy} down</span>}
        {summary.draining > 0 && <span className="text-amber-600 dark:text-amber-400">{summary.draining} draining</span>}
      </div>
    </div>
  );
}
