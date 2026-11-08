import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Scale, Trash2, Plus, Pencil, Lock, ArrowRight, Route, HeartPulse, Server, Boxes, MoreHorizontal, Pause, Play, X, Weight, Shield, Globe2,
  Activity, BadgeCheck, Settings2, Gauge, Save, Unlink, Layers,
} from 'lucide-react';
import { useItem, useList, useLookup, useApiMutation, useActiveOperation, useOperationsFor, useMetrics } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Card, CardHeader, CardBody, KeyValue } from '@/components/ui/Card';
import { Tabs, useTabParam } from '@/components/ui/Tabs';
import { Menu } from '@/components/ui/Menu';
import { Mono, EmptyState, Skeleton } from '@/components/ui/misc';
import { Field, Select, Switch, MultiSelect, TagEditor } from '@/components/ui/form';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { Sparkline } from '@/components/charts/Sparkline';
import { MetricsPanel, type MetricDef } from '@/components/charts/MetricsPanel';
import { OperationRunner } from '@/components/resource/OperationRunner';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { useFirewallOptions } from '@/components/resource/pickers';
import { TrafficFlow, fmtRate } from '@/components/lb/TrafficFlow';
import { CertificatesPanel, ExpiryMeter } from '@/components/lb/Certificates';
import { HealthBar, ALGORITHMS, HEALTH_COLOR } from '@/components/lb/forms';
import { ListenerModal, RulesModal, TargetGroupModal, AddTargetsModal, WeightModal } from '@/components/lb/modals';
import { deleteLoadBalancers } from '@/components/lb/actions';
import { money, timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import type { LoadBalancer, IpAddress, Network, Location, Listener, TargetGroup, LbTarget, Certificate, Firewall } from '@/types';

export default function LbDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const pro = usePro();
  const { data: lb, isLoading, error } = useItem<LoadBalancer>('loadBalancers', id);
  const op = useActiveOperation(id);
  const [tab, setTab] = useTabParam('overview');
  const { map: ips } = useLookup<IpAddress>('ips');
  const { data: loc } = useItem<Location>('locations', lb?.locationId);

  if (isLoading) return <Page><Skeleton className="mb-4 h-12 w-80" /><Skeleton className="h-96" /></Page>;
  if (error || !lb) return <Page><EmptyState icon={Scale} title="Load balancer not found" description="It may have been deleted, or it belongs to another account." action={<Button to="/managed-services/load-balancers">Back to load balancers</Button>} /></Page>;

  const vips = lb.ipIds.map((i) => ips.get(i)).filter(Boolean) as IpAddress[];
  const unit = lb.type === 'L7' ? 'req/s' : 'conn/s';
  const del = async () => { if (await deleteLoadBalancers([lb])) navigate('/managed-services/load-balancers') };

  return (
    <Page wide>
      <PageHeader
        title={lb.name}
        icon={Scale}
        iconColor="#ec4899"
        status={<StatusPill status={lb.status} />}
        crumbs={[{ label: 'Load Balancers', to: '/managed-services/load-balancers' }, { label: lb.name }]}
        meta={<>
          {pro ? <Badge tone={lb.type === 'L7' ? 'violet' : 'info'}>{lb.type === 'L7' ? 'L7 · HTTP(S)' : 'L4 · TCP/UDP'}</Badge> : <span>{lb.type === 'L7' ? 'Web (HTTP/HTTPS)' : 'TCP/UDP'}</span>}
          {pro && <Mono copy>{lb.hostname}</Mono>}
          {vips.map((ip) => <Mono key={ip.id} copy>{ip.address}</Mono>)}
          <span>{loc?.name ?? lb.locationId}</span>
          <span className="tabular">{money(lb.monthlyCost)}/mo</span>
        </>}
        actions={<>
          <Pro>
            <Button icon={Plus} onClick={() => setTab('listeners')}>Listeners</Button>
            <Button icon={HeartPulse} onClick={() => setTab('targets')}>Targets</Button>
          </Pro>
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="More actions" variant="secondary" />} items={[
            { label: 'Settings', icon: Settings2, onClick: () => setTab('settings') },
            ...(lb.type === 'L7' ? [{ label: 'Certificates', icon: BadgeCheck, onClick: () => setTab('certificates') }] : []),
            { divider: true, label: '' },
            { label: 'Delete load balancer', icon: Trash2, danger: true, onClick: del },
          ]} />
        </>}
      />

      {op && <OperationRunner op={op} compact className="mb-5" />}
      {lb.status === 'error' && !op && <div className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-700 dark:text-rose-300">Provisioning failed. {pro ? 'Check the Activity tab for the failed step, then delete' : 'Delete'} and recreate the load balancer.</div>}

      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={!pro ? [
        { id: 'overview', label: 'Overview' },
        { id: 'targets', label: 'Targets', count: lb.healthSummary?.total },
        { id: 'listeners', label: 'Listeners', count: lb.listeners.length },
        ...(lb.type === 'L7' ? [{ id: 'certificates', label: 'Certificates' }] : []),
        { id: 'settings', label: 'Settings' },
      ] : [
        { id: 'overview', label: 'Overview', icon: <Activity className="size-3.5" /> },
        { id: 'listeners', label: 'Listeners & rules', count: lb.listeners.length },
        { id: 'targets', label: 'Targets', count: lb.healthSummary?.total },
        { id: 'metrics', label: 'Metrics' },
        { id: 'certificates', label: 'Certificates', count: new Set(lb.listeners.map((l) => l.certificateId).filter(Boolean)).size || undefined },
        { id: 'settings', label: 'Settings' },
        { id: 'activity', label: 'Activity' },
      ]} />

      {tab === 'overview' && <Overview lb={lb} vips={vips} unit={unit} loc={loc} onTab={setTab} />}
      {tab === 'listeners' && <ListenersTab lb={lb} />}
      {tab === 'targets' && <TargetsTab lb={lb} />}
      {tab === 'metrics' && <MetricsPanel collection="loadBalancers" id={lb.id} charts={metricCharts(lb)} />}
      {tab === 'certificates' && <CertsTab lb={lb} />}
      {tab === 'settings' && <SettingsTab lb={lb} vips={vips} onDelete={del} />}
      {tab === 'activity' && <ActivityTab lb={lb} />}
    </Page>
  );
}

function metricCharts(lb: LoadBalancer): MetricDef[] {
  const l7 = lb.type === 'L7';
  return [
    { title: l7 ? 'Requests' : 'New connections', metrics: ['requests'], labels: [l7 ? 'req/s' : 'conn/s'] },
    { title: 'Active connections', metrics: ['activeConnections'], labels: ['connections'], colors: ['#06b6d4'] },
    { title: 'Latency', metrics: ['latencyP50', 'latencyP95'], labels: ['p50', 'p95'], colors: ['#10b981', '#f59e0b'], unit: 'ms' },
    ...(l7 ? [{ title: 'Errors', metrics: ['http4xx', 'http5xx'], labels: ['4xx', '5xx'], colors: ['#f59e0b', '#f43f5e'], unit: 'req/s' }] : []),
    { title: 'Bandwidth', metrics: ['bandwidthIn', 'bandwidthOut'], labels: ['in', 'out'], colors: ['#5b67f8', '#a855f7'], unit: 'Mbit/s' },
    ...(l7 && lb.listeners.some((l) => l.protocol === 'HTTPS') ? [{ title: 'TLS handshakes', metrics: ['tlsHandshakes'], labels: ['handshakes/s'], colors: ['#22c55e'] }] : []),
  ];
}

/* ------------------------------------------------------------------------------------------------ Overview */

function Overview({ lb, vips, unit, loc, onTab }: { lb: LoadBalancer; vips: IpAddress[]; unit: string; loc?: Location; onTab: (t: string) => void }) {
  const metrics = ['requests', 'activeConnections', 'latencyP95', ...(lb.type === 'L7' ? ['http5xx'] : [])];
  const { data } = useMetrics('loadBalancers', lb.id, metrics, '15m');
  const s = data?.series ?? {};
  const last = (m: string) => s[m]?.points.at(-1)?.v ?? 0;
  const spark = (m: string) => (s[m]?.points ?? []).map((p) => p.v);
  const live = lb.status !== 'provisioning' && lb.status !== 'error' && lb.status !== 'deleting';
  const total = live ? last('requests') : 0;
  const { data: net } = useItem<Network>('networks', lb.networkId);
  const { map: fws } = useLookup<Firewall>('firewalls');
  const pro = usePro();

  const tiles = [
    { label: lb.type === 'L7' ? 'Requests' : 'New connections', value: `${fmtRate(total)}`, unit, m: 'requests', color: '#5b67f8' },
    { label: 'Active connections', value: fmtRate(last('activeConnections')), unit: '', m: 'activeConnections', color: '#06b6d4' },
    { label: 'Latency p95', value: fmtRate(last('latencyP95')), unit: 'ms', m: 'latencyP95', color: '#f59e0b' },
    ...(lb.type === 'L7' ? [{ label: '5xx errors', value: fmtRate(last('http5xx')), unit: 'req/s', m: 'http5xx', color: '#f43f5e' }] : []),
  ].filter((t) => pro || t.m === 'requests' || t.m === 'latencyP95');

  return (
    <div className="space-y-5">
      <div className={cn('grid grid-cols-2 gap-3', tiles.length === 4 ? '@min-[44rem]:grid-cols-4' : tiles.length === 3 ? '@min-[44rem]:grid-cols-3' : '')}>
        {tiles.map((t) => (
          <Card key={t.m} className="@container flex items-end justify-between gap-2 p-4">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-muted">{t.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular text-fg">{live ? t.value : '—'}<span className="ml-1 text-xs font-normal text-muted">{t.unit}</span></div>
            </div>
            {live && <div className="hidden shrink-0 @min-[14rem]:block"><Sparkline data={spark(t.m)} width={84} height={30} color={t.color} /></div>}
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader icon={Route} title={pro ? 'Live traffic flow' : 'Traffic'} description={pro ? `Where the current ${fmtRate(total)} ${unit} go — from the internet through listeners${lb.type === 'L7' ? ' and routing rules' : ''} to target groups and individual targets.` : `${fmtRate(total)} ${unit} right now, from the internet to your servers.`}
          actions={<span className="flex items-center gap-1.5 text-xs text-muted"><span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-emerald-500" /></span>live</span>} />
        <CardBody>
          {lb.status === 'provisioning' ? <EmptyState icon={Route} title="Waiting for the load balancer" description="Traffic appears here once the proxies are up and targets pass health checks." /> : <TrafficFlow lb={lb} total={total} unit={unit} />}
        </CardBody>
      </Card>

      <div className="grid gap-5 @min-[44rem]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <KeyValue items={!pro ? [
              ['IP address', vips.length ? <div className="space-y-0.5">{vips.map((ip) => <Mono key={ip.id} copy className="block">{ip.address}</Mono>)}</div> : <span className="text-muted">internal only</span>],
              ['Hostname', <Mono copy>{lb.hostname}</Mono>],
              ['Location', loc?.name ?? lb.locationId],
              ['Network', net ? <ResourceLink type="network" id={net.id} name={net.name} /> : lb.networkId],
              ['Firewall', lb.firewallIds.length ? <div className="flex flex-wrap gap-x-3">{lb.firewallIds.map((f) => <ResourceLink key={f} type="firewall" id={f} name={fws.get(f)?.name} />)}</div> : <span className="text-amber-600 dark:text-amber-400">none — open to everyone</span>],
              ['Monthly cost', <span className="tabular">{money(lb.monthlyCost)}</span>],
            ] : [
              ['Hostname', <Mono copy>{lb.hostname}</Mono>],
              ['VIPs', vips.length ? <div className="space-y-0.5">{vips.map((ip) => <Mono key={ip.id} copy className="block">{ip.address}</Mono>)}</div> : <span className="text-muted">internal only</span>],
              ['Type', lb.type === 'L7' ? 'Application (L7) · Envoy' : 'Network (L4) · HAProxy TCP'],
              ['Algorithm', ALGORITHMS.find((a) => a.value === lb.algorithm)?.label ?? lb.algorithm],
              ['Network', net ? <ResourceLink type="network" id={net.id} name={`${net.name} · ${net.cidr}`} /> : lb.networkId],
              ['Location', loc?.name ?? lb.locationId],
              ['Firewalls', lb.firewallIds.length ? <div className="flex flex-wrap gap-x-3">{lb.firewallIds.map((f) => <ResourceLink key={f} type="firewall" id={f} name={fws.get(f)?.name} />)}</div> : <span className="text-amber-600 dark:text-amber-400">none — listeners open to all</span>],
              ['PROXY protocol', lb.type === 'L4' ? (lb.proxyProtocol ? 'v2 enabled' : 'off') : 'n/a (X-Forwarded-For)'],
              ['Monthly cost', <span className="tabular">{money(lb.monthlyCost)}</span>],
              ['Created', timeAgo(lb.createdAt)],
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={HeartPulse} title="Target health" actions={<Button size="xs" variant="ghost" onClick={() => onTab('targets')}>Manage</Button>} />
          <CardBody className="space-y-4">
            <HealthBar summary={lb.healthSummary} />
            {lb.targetGroups.map((tg) => (
              <div key={tg.id}>
                <div className="mb-1.5 flex items-center justify-between text-[13px]"><span className="font-medium text-fg">{tg.name}</span><span className="text-xs text-muted">{pro ? `${tg.protocol}:${tg.port} · ${tg.healthCheck.protocol} ${tg.healthCheck.path}` : `port ${tg.port}`}</span></div>
                <div className="flex flex-wrap gap-1.5">
                  {tg.targets.map((t) => (
                    <span key={`${t.ref.id}:${t.port ?? ''}`} title={t.reason} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2/50 px-2 py-1 text-xs text-fg-2">
                      <span className={cn('size-2 rounded-full', (t.health === 'initial' || t.health === 'draining') && 'animate-pulse-soft')} style={{ background: HEALTH_COLOR[t.drained ? 'draining' : t.health] }} />
                      {t.name ?? t.ref.id}
                    </span>
                  ))}
                  {!tg.targets.length && <span className="text-xs text-faint">no targets</span>}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ Listeners */

function ListenersTab({ lb }: { lb: LoadBalancer }) {
  const [edit, setEdit] = useState<{ open: boolean; listener: Listener | null }>({ open: false, listener: null });
  const [rules, setRules] = useState<Listener | null>(null);
  const { map: certs } = useLookup<Certificate>('certificates');
  const tgName = (id: string) => lb.targetGroups.find((t) => t.id === id)?.name ?? id;
  const remove = useApiMutation((l: Listener) => api.action('loadBalancers', lb.id, 'removeListener', { listenerId: l.id }), { success: 'Listener removed' });
  const removeRule = useApiMutation(({ l, ruleId }: { l: Listener; ruleId: string }) => api.action('loadBalancers', lb.id, 'removeRule', { listenerId: l.id, ruleId }), { success: 'Rule removed' });
  const listeners = [...lb.listeners].sort((a, b) => a.port - b.port);
  const pro = usePro();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{!pro ? 'Ports your load balancer accepts traffic on.' : null}{pro && <>{lb.type === 'L7' ? 'HTTP(S) listeners terminate TLS and route by host and path. Rules are evaluated in order; unmatched requests go to the default target group.' : 'TCP/UDP listeners forward connections unchanged to the default target group.'}</>}</p>
        <Button variant="primary" icon={Plus} onClick={() => setEdit({ open: true, listener: null })}>Add listener</Button>
      </div>
      {listeners.map((l) => {
        const cert = l.certificateId ? certs.get(l.certificateId) : undefined;
        return (
          <Card key={l.id}>
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
              <span className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-semibold', l.protocol === 'HTTPS' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-brand-500/10 text-brand-600 dark:text-brand-300')}>
                {l.protocol === 'HTTPS' && <Lock className="size-3.5" />}{l.protocol} :{l.port}
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-2">
                {l.redirectToHttps ? <span className="flex items-center gap-1"><ArrowRight className="size-3.5" /> 301 redirect to HTTPS</span> : <span className="flex items-center gap-1">{pro && 'default '}<ArrowRight className="size-3.5 text-faint" /> <b className="font-medium text-fg">{tgName(l.defaultTargetGroupId)}</b>{!pro && <span className="text-muted">port {lb.targetGroups.find((t) => t.id === l.defaultTargetGroupId)?.port}</span>}</span>}
                {cert && <span className="flex items-center gap-1.5"><BadgeCheck className="size-3.5 text-emerald-500" />{cert.name}<StatusPill status={cert.status} />{cert.daysLeft != null && cert.daysLeft < 30 && <span className="text-xs text-amber-600 dark:text-amber-400">{cert.daysLeft}d left</span>}</span>}
                {l.protocol === 'HTTPS' && !cert && <span className="text-rose-500">certificate missing</span>}
              </div>
              <div className="flex items-center gap-1">
                {pro && lb.type === 'L7' && !l.redirectToHttps && <Button size="sm" variant="ghost" icon={Route} onClick={() => setRules(l)}>Rules</Button>}
                <IconButton icon={Pencil} label="Edit listener" size="sm" onClick={() => setEdit({ open: true, listener: l })} />
                <IconButton icon={Trash2} label="Remove listener" size="sm" disabled={lb.listeners.length === 1} onClick={async () => { if (await confirm({ title: `Remove listener ${l.protocol} :${l.port}?`, message: 'The port stops accepting new connections after the reload. Existing connections finish.', danger: true, confirmLabel: 'Remove' })) remove.mutate(l) }} />
              </div>
            </div>
            {!pro && lb.type === 'L7' && !l.redirectToHttps && l.rules.length > 0 && <div className="px-4 py-2.5 text-xs text-muted">{l.rules.length} routing rule{l.rules.length > 1 ? 's' : ''} by host/path — manage them in Pro mode.</div>}
            {pro && lb.type === 'L7' && !l.redirectToHttps && (
              l.rules.length ? (
                <div className="divide-y divide-line">
                  {l.rules.map((r, i) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
                      <span className="w-5 text-center text-[11px] font-semibold text-faint">{i + 1}</span>
                      <span className="text-muted">if</span>
                      {r.host && <span>host <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg">{r.host}</code></span>}
                      {r.host && r.pathPrefix && <span className="text-muted">and</span>}
                      {r.pathPrefix && <span>path <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg">{r.pathPrefix}*</code></span>}
                      <ArrowRight className="size-3.5 text-faint" />
                      <b className="font-medium text-fg">{tgName(r.targetGroupId)}</b>
                      <IconButton icon={X} label="Remove rule" size="xs" className="ml-auto" onClick={() => removeRule.mutate({ l, ruleId: r.id })} />
                    </div>
                  ))}
                  <div className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-muted"><span className="w-5" />else <ArrowRight className="size-3.5 text-faint" /> <b className="font-medium text-fg-2">{tgName(l.defaultTargetGroupId)}</b></div>
                </div>
              ) : <div className="px-4 py-3 text-[13px] text-muted">No routing rules — all requests go to <b className="text-fg-2">{tgName(l.defaultTargetGroupId)}</b>. <button className="font-medium text-brand-500 hover:underline" onClick={() => setRules(l)}>Add host/path rules</button></div>
            )}
          </Card>
        );
      })}
      <ListenerModal lb={lb} listener={edit.listener} open={edit.open} onClose={() => setEdit({ open: false, listener: null })} />
      <RulesModal lb={lb} listener={rules ? lb.listeners.find((l) => l.id === rules.id) ?? null : null} onClose={() => setRules(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ Targets */

function TargetsTab({ lb }: { lb: LoadBalancer }) {
  const [tgModal, setTgModal] = useState<{ open: boolean; group: TargetGroup | null }>({ open: false, group: null });
  const [adding, setAdding] = useState<TargetGroup | null>(null);
  const [weight, setWeight] = useState<{ tg: TargetGroup; t: LbTarget } | null>(null);
  const act = useApiMutation(({ a, body }: { a: string; body: Record<string, unknown>; msg: string }) => api.action('loadBalancers', lb.id, a, body), { success: (_r, v) => v.msg });
  const pro = usePro();

  const drain = async (tg: TargetGroup, t: LbTarget) => {
    const res = await confirm({ title: `Drain ${t.name ?? t.ref.id}?`, message: 'Stops sending new connections and waits for in-flight requests to finish. Use before maintenance or deploys.', confirmLabel: 'Drain',
      options: [{ id: 'deregister', label: 'Deregister when drained', description: 'Otherwise the target stays registered (drained) until you re-enable it.' }] });
    if (res) act.mutate({ a: 'drainTarget', body: { targetGroupId: tg.id, ref: t.ref, deregister: !!res.deregister }, msg: `Draining ${t.name ?? t.ref.id}` });
  };
  const removeTarget = async (tg: TargetGroup, t: LbTarget) => {
    if (await confirm({ title: `Deregister ${t.name ?? t.ref.id}?`, message: t.health === 'healthy' ? 'Active connections are cut immediately. Prefer "Drain" for a graceful removal.' : 'The target is removed from the group.', danger: true, confirmLabel: 'Deregister' }))
      act.mutate({ a: 'removeTarget', body: { targetGroupId: tg.id, ref: t.ref }, msg: 'Target deregistered' });
  };
  const removeGroup = async (tg: TargetGroup) => {
    const used = lb.listeners.filter((l) => l.defaultTargetGroupId === tg.id || l.rules.some((r) => r.targetGroupId === tg.id));
    if (used.length) { toast.warning(`${tg.name} is in use`, `Referenced by listener${used.length > 1 ? 's' : ''} ${used.map((l) => `:${l.port}`).join(', ')}. Re-route them first.`); return }
    if (await confirm({ title: `Remove target group ${tg.name}?`, danger: true, confirmLabel: 'Remove', message: `${tg.targets.length} target(s) will be deregistered.` }))
      act.mutate({ a: 'removeTargetGroup', body: { targetGroupId: tg.id }, msg: `Removed ${tg.name}` });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-56 flex-1"><HealthBar summary={lb.healthSummary} className="max-w-sm" /></div>
        {pro ? <Button variant="primary" icon={Plus} onClick={() => setTgModal({ open: true, group: null })}>Add target group</Button>
          : lb.targetGroups.length === 1 && <Button variant="primary" icon={Plus} onClick={() => setAdding(lb.targetGroups[0])}>Add servers</Button>}
      </div>
      {lb.targetGroups.map((tg) => {
        const usedBy = lb.listeners.filter((l) => l.defaultTargetGroupId === tg.id || l.rules.some((r) => r.targetGroupId === tg.id));
        const servingWeight = tg.targets.filter((t) => t.health === 'healthy' && !t.drained).reduce((a, t) => a + t.weight, 0);
        return (
          <Card key={tg.id}>
            <CardHeader icon={Layers} title={<span className="flex flex-wrap items-center gap-2">{tg.name}<Badge>{pro ? `${tg.protocol}:${tg.port}` : `port ${tg.port}`}</Badge>{pro && tg.stickySessions && <Badge tone="violet">sticky</Badge>}</span>}
              description={!pro ? (usedBy.length ? `Receives traffic from ${usedBy.map((l) => `${l.protocol} ${l.port}`).join(', ')}` : 'Not receiving traffic') : <span className="flex flex-wrap items-center gap-x-3"><span className="flex items-center gap-1"><HeartPulse className="size-3 text-rose-500" />{tg.healthCheck.protocol} {tg.healthCheck.path} every {tg.healthCheck.intervalSec}s, timeout {tg.healthCheck.timeoutSec}s, {tg.healthCheck.healthyThreshold}/{tg.healthCheck.unhealthyThreshold}</span><span>{usedBy.length ? `used by ${usedBy.map((l) => `:${l.port}`).join(', ')}` : 'not routed'}</span></span>}
              actions={<>
                <Button size="sm" icon={Plus} onClick={() => setAdding(tg)}>Targets</Button>
                <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Target group actions" size="sm" />} items={[
                  { label: 'Edit group & health check', icon: Pencil, onClick: () => setTgModal({ open: true, group: tg }) },
                  { divider: true, label: '' },
                  { label: 'Remove group', icon: Trash2, danger: true, onClick: () => removeGroup(tg) },
                ]} />
              </>} />
            {tg.targets.length === 0 ? (
              <EmptyState className="py-8" icon={Server} title="No targets" description="Requests routed here receive 503 until a target is registered and healthy." action={<Button size="sm" icon={Plus} onClick={() => setAdding(tg)}>Register targets</Button>} />
            ) : (
              <div className="overflow-x-auto">
                <table className={cn('w-full text-[13px]', pro ? 'min-w-[640px]' : 'min-w-[360px]')}>
                  <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-4 py-2 font-medium">{pro ? 'Target' : 'Server'}</th><th className="px-3 py-2 font-medium">Health</th>{pro && <th className="px-3 py-2 font-medium">Last check</th>}{pro && <th className="px-3 py-2 text-right font-medium">Weight</th>}<th className="w-10" /></tr></thead>
                  <tbody className="divide-y divide-line">
                    {tg.targets.map((t) => {
                      const share = t.health === 'healthy' && !t.drained && servingWeight ? Math.round((t.weight / servingWeight) * 100) : 0;
                      return (
                        <tr key={`${t.ref.type}:${t.ref.id}:${t.port ?? ''}`} className="hover:bg-surface-2/40">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              {t.ref.type === 'vm' ? <Server className="size-3.5 shrink-0 text-brand-500" /> : <Boxes className="size-3.5 shrink-0 text-sky-500" />}
                              <div className="min-w-0"><ResourceLink type={t.ref.type} id={t.ref.id} name={t.name} showIcon={false} /><div className="font-mono text-[11px] text-muted">{t.address ?? '—'}</div></div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5"><span title={pro ? undefined : t.reason}><StatusPill status={t.drained ? 'draining' : t.health} label={t.drained ? 'drained' : undefined} /></span></td>
                          {pro && <td className="max-w-80 px-3 py-2.5 text-xs text-muted"><span className="line-clamp-2" title={t.reason}>{t.reason}</span></td>}
                          {pro && <td className="px-3 py-2.5 text-right">
                            <button onClick={() => setWeight({ tg, t })} className="tabular text-fg hover:text-brand-500" title="Change weight">{t.weight}</button>
                            <div className="text-[11px] text-faint">{share}% traffic</div>
                          </td>}
                          <td className="pr-3">
                            <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Target actions" size="sm" />} items={[
                              ...(pro ? [{ label: 'Set weight', icon: Weight, onClick: () => setWeight({ tg, t }) }] : []),
                              t.drained ? { label: 'Re-enable (undrain)', icon: Play, onClick: () => act.mutate({ a: 'undrainTarget', body: { targetGroupId: tg.id, ref: t.ref }, msg: 'Target back in rotation' }) }
                                : { label: 'Drain connections', icon: Pause, disabled: t.health === 'draining', onClick: () => drain(tg, t) },
                              { divider: true, label: '' },
                              { label: 'Deregister', icon: X, danger: true, onClick: () => removeTarget(tg, t) },
                            ]} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
      <TargetGroupModal lb={lb} group={tgModal.group} open={tgModal.open} onClose={() => setTgModal({ open: false, group: null })} />
      <AddTargetsModal lb={lb} group={adding} onClose={() => setAdding(null)} />
      <WeightModal lb={lb} target={weight} onClose={() => setWeight(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ Certificates */

function CertsTab({ lb }: { lb: LoadBalancer }) {
  const ids = new Set(lb.listeners.map((l) => l.certificateId).filter(Boolean));
  const { items } = useList<Certificate>('certificates');
  const used = items.filter((c) => ids.has(c.id));
  if (lb.type === 'L4') return <EmptyState icon={BadgeCheck} title="No TLS termination on L4" description="L4 load balancers pass TLS through to the targets unchanged. Terminate TLS on the targets, or use an L7 load balancer to manage certificates here." />;
  return (
    <div className="space-y-4">
      {used.length > 0 && (
        <div className="grid gap-3 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-3">
          {used.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate font-medium text-fg">{c.name}</div><div className="truncate font-mono text-[11px] text-muted">{c.domains.join(', ')}</div></div><StatusPill status={c.status} /></div>
              <ExpiryMeter cert={c} className="mt-3 w-full" />
              <div className="mt-2 text-xs text-muted">{c.issuer === 'letsencrypt' ? (c.autoRenew ? 'Auto-renews 30 days before expiry' : 'Auto-renew is off') : 'Uploaded — replace manually before expiry'} · listener{c.usedBy && c.usedBy.filter((u) => u.lbId === lb.id).length > 1 ? 's' : ''} {c.usedBy?.filter((u) => u.lbId === lb.id).map((u) => `:${u.port}`).join(', ')}</div>
            </Card>
          ))}
        </div>
      )}
      <CertificatesPanel filter={(c) => c.projectId === lb.projectId} projectId={lb.projectId} emptyHint="No certificates in this project yet. Issue one, then attach it to an HTTPS listener." />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ Settings */

function SettingsTab({ lb, vips, onDelete }: { lb: LoadBalancer; vips: IpAddress[]; onDelete: () => void }) {
  const [algorithm, setAlgorithm] = useState(lb.algorithm);
  const [proxy, setProxy] = useState(lb.proxyProtocol);
  const [fwIds, setFwIds] = useState(lb.firewallIds);
  const [tags, setTags] = useState(lb.tags);
  useEffect(() => { setAlgorithm(lb.algorithm); setProxy(lb.proxyProtocol) }, [lb.algorithm, lb.proxyProtocol]);
  useEffect(() => { setFwIds(lb.firewallIds) }, [lb.firewallIds.join()]); // eslint-disable-line
  useEffect(() => { setTags(lb.tags) }, [JSON.stringify(lb.tags)]); // eslint-disable-line
  const fwOptions = useFirewallOptions(lb.projectId);
  const { items: ips } = useList<IpAddress>('ips');
  const freeIps = ips.filter((i) => i.projectId === lb.projectId && !i.assignedTo);
  const [ipChoice, setIpChoice] = useState('new');

  const patch = useApiMutation((body: Partial<LoadBalancer>) => api.update('loadBalancers', lb.id, body), { success: 'Settings saved' });
  const setFw = useApiMutation(() => api.action('loadBalancers', lb.id, 'setFirewalls', { firewallIds: fwIds }), { success: 'Firewalls updated' });
  const assign = useApiMutation(() => api.action('loadBalancers', lb.id, 'assignIp', { ipId: ipChoice }), { success: 'IP assigned' });
  const unassign = useApiMutation((ipId: string) => api.action('loadBalancers', lb.id, 'unassignIp', { ipId }), { success: 'IP unassigned (kept in project)' });
  const dirtyLb = algorithm !== lb.algorithm || proxy !== lb.proxyProtocol;
  const dirtyFw = fwIds.join() !== lb.firewallIds.join();
  const dirtyTags = JSON.stringify(tags) !== JSON.stringify(lb.tags);
  const pro = usePro();

  return (
    <div className="grid gap-5 @min-[44rem]:grid-cols-2">
      {pro && <Card>
        <CardHeader icon={Gauge} title="Load balancing" description="Applied with a hot reload — no connections dropped." actions={<Button size="sm" variant="primary" icon={Save} disabled={!dirtyLb} loading={patch.isPending} onClick={() => patch.mutate({ algorithm, ...(lb.type === 'L4' ? { proxyProtocol: proxy } : {}) })}>Save</Button>} />
        <CardBody className="space-y-4">
          <Field label="Algorithm" hint={ALGORITHMS.find((a) => a.value === algorithm)?.description}>
            <Select value={algorithm} onChange={(e) => setAlgorithm(e.target.value as LoadBalancer['algorithm'])} options={ALGORITHMS.map((a) => ({ value: a.value, label: a.label }))} />
          </Field>
          {lb.type === 'L4' ? <Switch checked={proxy} onChange={setProxy} label="PROXY protocol v2" description="Prepend client address info; targets must support it." /> : <p className="text-xs text-muted">L7 adds X-Forwarded-For / X-Forwarded-Proto headers automatically.</p>}
        </CardBody>
      </Card>}
      <Card>
        <CardHeader icon={Shield} title="Firewalls" description={pro ? 'Rules from all attached firewalls apply to listener ports.' : 'Who may connect to your load balancer.'} actions={<Button size="sm" variant="primary" icon={Save} disabled={!dirtyFw} loading={setFw.isPending} onClick={() => setFw.mutate()}>Save</Button>} />
        <CardBody><MultiSelect options={fwOptions} value={fwIds} onChange={setFwIds} placeholder="No firewall (listeners open to all)" emptyText="No firewalls in this project" /></CardBody>
      </Card>
      <Card>
        <CardHeader icon={Globe2} title={pro ? 'Virtual IPs' : 'IP addresses'} description={pro ? 'Announced from both edge nodes; fail over in under a second.' : undefined} />
        <CardBody className="space-y-3">
          {vips.length ? vips.map((ip) => (
            <div key={ip.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
              <div><Mono copy>{ip.address}</Mono><div className="text-[11px] text-muted">IPv{ip.version}{ip.reverseDns ? ` · ${ip.reverseDns}` : ''}</div></div>
              <Button size="xs" variant="ghost" icon={Unlink} onClick={async () => { if (await confirm({ title: `Unassign ${ip.address}?`, message: 'Clients using this address lose connectivity. The IP stays allocated to the project.', danger: true, confirmLabel: 'Unassign' })) unassign.mutate(ip.id) }}>Unassign</Button>
            </div>
          )) : <p className="text-sm text-muted">No public VIP — reachable only inside the VPC.</p>}
          <div className="flex gap-2">
            <Select className="flex-1" value={ipChoice} onChange={(e) => setIpChoice(e.target.value)} options={[{ value: 'new', label: 'Allocate a new IPv4 (+€2/mo)' }, ...freeIps.map((i) => ({ value: i.id, label: `Use ${i.address}` }))]} />
            <Button icon={Plus} loading={assign.isPending} onClick={() => assign.mutate()}>Assign</Button>
          </div>
        </CardBody>
      </Card>
      {pro && <Card>
        <CardHeader title="Tags" actions={<Button size="sm" variant="primary" icon={Save} disabled={!dirtyTags} loading={patch.isPending} onClick={() => patch.mutate({ tags })}>Save</Button>} />
        <CardBody><TagEditor value={tags} onChange={setTags} /></CardBody>
      </Card>}
      <Card className={cn('border-rose-500/30', pro && '@min-[44rem]:col-span-2')}>
        <CardHeader title="Protection & deletion" />
        <CardBody className="space-y-4">
          <Switch checked={!!lb.deletionProtection} onChange={(v) => patch.mutate({ deletionProtection: v })} label={<span className="flex items-center gap-1.5"><Shield className="size-3.5" /> Deletion protection</span>} description="Blocks deletion via console, CLI or Terraform until disabled." />
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
            <div className="text-sm"><div className="font-medium text-fg">Delete this load balancer</div><div className="text-xs text-muted">Drains connections, removes the proxy pair and DNS name. Targets are untouched.</div></div>
            <Button variant="danger" icon={Trash2} disabled={!!lb.deletionProtection} onClick={onDelete}>Delete</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ Activity */

function ActivityTab({ lb }: { lb: LoadBalancer }) {
  const { items: ops } = useOperationsFor(lb.id);
  const recent = useMemo(() => [...ops].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5), [ops]);
  return (
    <div className="grid gap-5 @min-[44rem]:grid-cols-2">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-fg">Recent operations</h3>
        {recent.length ? recent.map((o) => <OperationRunner key={o.id} op={o} compact />) : <Card><EmptyState title="No operations yet" /></Card>}
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-fg">Audit log</h3>
        <Card><ActivityFeed targetId={lb.id} /></Card>
      </div>
    </div>
  );
}
