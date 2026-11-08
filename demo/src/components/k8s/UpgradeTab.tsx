import { useEffect, useState } from 'react';
import { ArrowUpCircle, Check, CheckCircle2, AlertTriangle, CalendarClock, Server, Info } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation } from '@/api/hooks';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, NumberInput, Select, Switch, Hint } from '@/components/ui/form';
import { confirm } from '@/components/ui/Modal';
import { OperationRunner } from '@/components/resource/OperationRunner';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import { DAYS, poolNodeCost } from './k8sUi';
import { K8S_VERSIONS, k8sPatch, type K8sCluster, type K8sTopology, type NodePool, type Operation } from '@/types';

function VersionPath({ current, next, cpVersion }: { current: string; next: string | null | undefined; cpVersion?: string }) {
  const list = [...K8S_VERSIONS].reverse();
  const ci = list.findIndex((v) => v.version === current);
  return (
    <div className="overflow-x-auto pb-1">
      <div className="relative grid min-w-[520px] grid-cols-4 gap-2">
        <div className="absolute left-[12.5%] right-[12.5%] top-[15px] h-0.5 bg-line" />
        <div className="absolute left-[12.5%] top-[15px] h-0.5 bg-gradient-to-r from-emerald-500 to-brand-500 transition-all" style={{ width: `${(Math.max(0, ci) / (list.length - 1)) * 75}%` }} />
        {list.map((v, i) => {
          const state = i < ci ? 'past' : i === ci ? 'current' : v.version === next ? 'next' : 'future';
          return (
            <div key={v.version} className="relative flex flex-col items-center text-center">
              <div className={cn('relative z-10 flex size-8 items-center justify-center rounded-full border-2 bg-surface text-xs font-semibold',
                state === 'past' && 'border-emerald-500 text-emerald-500', state === 'current' && 'border-brand-500 bg-brand-500 text-white ring-4 ring-brand-500/20',
                state === 'next' && 'border-dashed border-brand-500 text-brand-500', state === 'future' && 'border-dashed border-line-strong text-faint')}>
                {state === 'past' ? <Check className="size-4" /> : state === 'next' ? <ArrowUpCircle className="size-4" /> : v.version.split('.')[1]}
              </div>
              <div className={cn('mt-2 font-mono text-sm font-semibold', state === 'future' ? 'text-faint' : 'text-fg')}>v{v.patch}</div>
              <div className="mt-0.5 flex flex-wrap justify-center gap-1">
                {state === 'current' && <Badge tone="brand">current</Badge>}
                {state === 'next' && <Badge tone="info">next step</Badge>}
                {state === 'future' && <span className="text-[10px] text-faint">via {list[i - 1]?.version}</span>}
                {v.status === 'latest' && <Badge tone="success">latest</Badge>}
                {v.status === 'deprecated' && <Badge tone="warning">EOL soon</Badge>}
                {cpVersion === v.version && cpVersion !== current && <Badge tone="info">control plane</Badge>}
              </div>
              <div className="mt-1 text-[10.5px] text-muted">support until {v.endOfSupport}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SurgePlan({ c, pool, topology, live, onSurge }: { c: K8sCluster; pool: NodePool; topology: K8sTopology | undefined; live: boolean; onSurge?: (n: number) => void }) {
  const surge = Math.max(1, pool.upgradeSettings?.maxSurge ?? 1);
  const nodes = (topology?.nodes ?? []).filter((n) => n.poolId === pool.id && !n.surge);
  const batches: number[][] = [];
  for (let i = 0; i < pool.count; i += surge) batches.push(Array.from({ length: Math.min(surge, pool.count - i) }, (_, j) => i + j));
  const oldVersion = `v${k8sPatch(c.version)}`;
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
        <Server className="size-4 text-muted" /><span className="font-medium text-fg">{pool.name}</span>
        <span className="text-xs text-muted">{pool.count} nodes · {batches.length} batch{batches.length > 1 ? 'es' : ''} · +{Math.min(surge, pool.count)} temporary node{surge > 1 ? 's' : ''}</span>
        {onSurge && <span className="ml-auto flex items-center gap-2 text-xs text-muted">max surge <NumberInput className="w-24" value={surge} onChange={onSurge} min={1} max={5} /></span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {batches.map((b, bi) => (
          <div key={bi} className="flex items-center gap-1 rounded-md border border-dashed border-line-strong px-1.5 py-1">
            <span className="mr-0.5 text-[10px] font-semibold text-faint">{bi + 1}</span>
            {b.map((i) => {
              const n = nodes.find((x) => x.index === i);
              const done = live && n && n.version !== oldVersion;
              const doing = live && n?.status === 'Upgrading';
              return <span key={i} title={n ? `${n.name} · ${n.version}` : `node ${i}`} className={cn('size-3.5 rounded-[4px]', doing ? 'animate-pulse-soft bg-sky-500' : done ? 'bg-emerald-500' : 'bg-surface-3 ring-1 ring-inset ring-line-strong')} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function UpgradeTab({ cluster: c, topology, ops }: { cluster: K8sCluster; topology: K8sTopology | undefined; ops: Operation[] }) {
  const upgradeOp = ops.find((o) => o.type === 'k8s.upgrade' && o.status === 'running');
  const next = c.upgradeAvailable;
  const nextInfo = K8S_VERSIONS.find((v) => v.version === next);
  const curInfo = K8S_VERSIONS.find((v) => v.version === c.version);
  const [auto, setAuto] = useState(c.autoUpgrade);
  const [mw, setMw] = useState(c.maintenanceWindow);
  useEffect(() => { setAuto(c.autoUpgrade); setMw(c.maintenanceWindow) }, [c.autoUpgrade, c.maintenanceWindow.day, c.maintenanceWindow.hour]); // eslint-disable-line

  const upgrade = useApiMutation(() => api.action('k8sClusters', c.id, 'upgrade', { version: next }), { success: `Upgrading ${c.name} to ${next}` });
  const surge = useApiMutation(({ poolId, n }: { poolId: string; n: number }) => api.action('k8sClusters', c.id, 'updateNodePool', { poolId, upgradeSettings: { maxSurge: n, maxUnavailable: 0 } }), { silent: true });
  const patch = useApiMutation((b: Partial<K8sCluster>) => api.update('k8sClusters', c.id, b), { success: 'Maintenance settings saved' });
  const s = topology?.summary ?? c.summary;
  const idle = c.status === 'running' || c.status === 'degraded';

  const checks: { ok: boolean | 'warn'; label: string; detail: string }[] = [
    { ok: true, label: 'No removed APIs in use', detail: `Scanned ${s?.workloads ?? 0} workloads against the ${next ?? ''} removal list` },
    { ok: (s?.readyNodes ?? 0) === (s?.nodes ?? 0), label: 'All nodes Ready', detail: `${s?.readyNodes ?? 0}/${s?.nodes ?? 0} nodes` },
    { ok: c.controlPlane.ha ? true : 'warn', label: 'Control plane availability', detail: c.controlPlane.ha ? 'HA — API stays available during the rolling upgrade' : 'Single replica — API unavailable for ~20 s' },
    { ok: (s?.pendingPods ?? 0) === 0 ? true : 'warn', label: 'Spare capacity for evicted pods', detail: (s?.pendingPods ?? 0) === 0 ? 'Surge nodes keep capacity constant' : `${s?.pendingPods} pods already pending` },
  ];
  const totalBatches = c.nodePools.reduce((a, p) => a + Math.ceil(p.count / Math.max(1, p.upgradeSettings?.maxSurge ?? 1)), 0);
  const surgeCost = c.nodePools.reduce((a, p) => a + poolNodeCost(p) * Math.min(p.count, p.upgradeSettings?.maxSurge ?? 1), 0) / 730;

  const onStart = async () => {
    const ok = await confirm({ title: `Upgrade ${c.name} to v${nextInfo?.patch}?`, message: `The control plane is upgraded first, then ${totalBatches} node batch${totalBatches > 1 ? 'es' : ''} are surge-replaced. Workloads are drained respecting PodDisruptionBudgets. An etcd snapshot is taken before starting. Downgrades are not possible.`, confirmLabel: 'Start upgrade' });
    if (ok) upgrade.mutate();
  };

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[15px] font-semibold text-fg">Version path</h3>
            <p className="text-[13px] text-muted">Kubernetes supports upgrading one minor version at a time.</p>
          </div>
          {curInfo?.status === 'deprecated' && <Badge tone="warning"><AlertTriangle className="size-3" /> v{c.version} support ends {curInfo.endOfSupport}</Badge>}
        </div>
        <VersionPath current={c.version} next={next} cpVersion={c.controlPlaneVersion} />
      </Card>

      {upgradeOp ? (
        <div className="grid gap-5 @min-[44rem]:grid-cols-2">
          <OperationRunner op={upgradeOp} />
          <Card>
            <CardHeader title="Surge progress" description="Each node is replaced by a fresh node on the new version, then drained." />
            <div className="space-y-3 p-4">{c.nodePools.map((p) => <SurgePlan key={p.id} c={c} pool={p} topology={topology} live />)}</div>
          </Card>
        </div>
      ) : next && nextInfo ? (
        <div className="grid gap-5 @min-[44rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader title={`Upgrade to v${nextInfo.patch}`} icon={ArrowUpCircle} description={`Released ${nextInfo.releasedAt} · supported until ${nextInfo.endOfSupport}`} />
            <div className="space-y-4 p-4">
              <ul className="space-y-1.5 text-[13px] text-fg-2">{nextInfo.highlights.map((h) => <li key={h} className="flex gap-2"><span className="text-brand-500">•</span>{h}</li>)}</ul>
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted">Pre-flight checks</div>
                {checks.map((ch) => (
                  <div key={ch.label} className="flex items-start gap-2.5 text-[13px]">
                    {ch.ok === true ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : ch.ok === 'warn' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-500" />}
                    <div><div className="text-fg">{ch.label}</div><div className="text-xs text-muted">{ch.detail}</div></div>
                  </div>
                ))}
              </div>
              <Button variant="primary" icon={ArrowUpCircle} className="w-full" loading={upgrade.isPending} disabled={!idle} onClick={onStart}>Upgrade {c.version} → {next}</Button>
              {!idle && <p className="text-center text-xs text-muted">Wait for the running operation to finish.</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Surge plan" description={`${totalBatches} batches · surge nodes cost ~${money(surgeCost, { decimals: true })}/h while upgrading`} />
            <div className="space-y-3 p-4">
              {c.nodePools.map((p) => <SurgePlan key={p.id} c={c} pool={p} topology={topology} live={false} onSurge={(n) => surge.mutate({ poolId: p.id, n })} />)}
              <p className="flex items-start gap-1.5 text-[11px] text-muted"><Info className="mt-0.5 size-3 shrink-0" /> Higher surge = faster upgrade, more temporary nodes. maxUnavailable is 0, so serving capacity never drops.</p>
            </div>
          </Card>
        </div>
      ) : (
        <Hint tone="success">This cluster runs the latest supported Kubernetes version (v{curInfo?.patch}). Patch releases are applied automatically{c.autoUpgrade ? ' in the maintenance window' : ' when auto-upgrade is enabled'}.</Hint>
      )}

      <Card>
        <CardHeader title="Maintenance" icon={CalendarClock} description="When Autark may apply patch releases and, if enabled, minor upgrades." />
        <div className="grid gap-4 p-4 @min-[36rem]:grid-cols-[1fr_auto_auto_auto] @min-[36rem]:items-end">
          <Switch checked={auto} onChange={setAuto} label="Automatic upgrades" description="Follow the next minor version ~30 days after release." />
          <Field label="Day"><Select className="w-36" value={mw.day} onChange={(e) => setMw({ ...mw, day: e.target.value })} options={DAYS} /></Field>
          <Field label="Hour (UTC)"><Select className="w-28" value={String(mw.hour)} onChange={(e) => setMw({ ...mw, hour: Number(e.target.value) })} options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }))} /></Field>
          <Button variant="primary" loading={patch.isPending} disabled={auto === c.autoUpgrade && mw.day === c.maintenanceWindow.day && mw.hour === c.maintenanceWindow.hour} onClick={() => patch.mutate({ autoUpgrade: auto, maintenanceWindow: mw })}>Save</Button>
        </div>
      </Card>
    </div>
  );
}
