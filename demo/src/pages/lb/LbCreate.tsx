import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Scale, Rocket, Plus, FileCode2, Shield, Network as NetIcon, Globe, Workflow, X, Sparkles } from 'lucide-react';
import { useList, useApiMutation } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Switch, OptionCards, Slider, TagEditor, MultiSelect, Hint } from '@/components/ui/form';
import { FormSection, CreateLayout, fieldErrors } from '@/components/ui/FormLayout';
import { IacTabs, toCli, toHcl, toCurl } from '@/components/ui/CodeBlock';
import { CostPanel } from '@/components/resource/CostPanel';
import { ProjectField, LocationCards, NetworkSubnetFields, useFirewallOptions } from '@/components/resource/pickers';
import { ListenerFields, TargetGroupFields, newTargetGroup, newListener, defaultHealthCheck, targetCandidates, ALGORITHMS, type TgDraft, type ListenerDraft, type LbType } from '@/components/lb/forms';
import { TrafficFlow } from '@/components/lb/TrafficFlow';
import { IssueCertificateModal } from '@/components/lb/Certificates';
import { lbCost } from '@/lib/pricing';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { SimpleForwarding } from '@/components/lb/SimpleForwarding';
import { useDefaultProject } from '@/components/network/useDefaultProject';
import { Advanced, Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import type { Certificate, IpAddress, K8sCluster, LoadBalancer, Network, ProjectAllowance, VM } from '@/types';

export default function LbCreate() {
  const navigate = useNavigate();
  const pro = usePro();
  const [sp] = useSearchParams();
  const { items: vms } = useList<VM>('vms');
  const { items: clusters } = useList<K8sCluster>('k8sClusters');
  const { items: networks } = useList<Network>('networks');
  const { items: certificates } = useList<Certificate>('certificates');
  const { items: ips } = useList<IpAddress>('ips');
  const { items: allowances } = useList<ProjectAllowance>('allowances');

  const [name, setName] = useState(sp.get('name') ?? '');
  const [projectId, setProjectId] = useState('');
  const [type, setType] = useState<LbType>((sp.get('type') as LbType) === 'L4' ? 'L4' : 'L7');
  const [algorithm, setAlgorithm] = useState<LoadBalancer['algorithm']>('round_robin');
  const [locationId, setLocationId] = useState(sp.get('location') ?? 'dc1');
  const [net, setNet] = useState({ networkId: '', subnetId: '' });
  const [publicIp, setPublicIp] = useState<string>('new');
  const [ipv6, setIpv6] = useState(false);
  const [firewallIds, setFirewallIds] = useState<string[]>([]);
  const [tgs, setTgs] = useState<TgDraft[]>(() => [newTargetGroup('L7', 'web')]);
  const [listeners, setListeners] = useState<ListenerDraft[]>(() => [newListener('L7', tgs[0].id, false)]);
  const [proxyProtocol, setProxyProtocol] = useState(false);
  const [protection, setProtection] = useState(false);
  const [trafficGB, setTrafficGB] = useState(1000);
  const [tags, setTags] = useState<{ key: string; value: string }[]>([{ key: 'env', value: 'prod' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [certOpen, setCertOpen] = useState(false);

  useDefaultProject(projectId, setProjectId);
  const allowance = allowances.find((a) => a.projectId === projectId);
  const firewallOptions = useFirewallOptions(projectId);
  const projectCerts = certificates.filter((c) => c.projectId === projectId);
  const cand = targetCandidates(vms, clusters, { projectId, locationId, networkId: net.networkId, networks });
  const availableIps = ips.filter((i) => !i.assignedTo && i.projectId === projectId && i.version === 4);

  // pick a network automatically (simple mode hides the network picker under Advanced)
  useEffect(() => {
    const nets = networks.filter((n) => n.projectId === projectId && n.locationId === locationId);
    if (!nets.some((n) => n.id === net.networkId)) setNet(nets[0] ? { networkId: nets[0].id, subnetId: nets[0].subnets[0]?.id ?? '' } : { networkId: '', subnetId: '' });
  }, [projectId, locationId, networks.length]); // eslint-disable-line

  // reset project/location-bound selections
  useEffect(() => { setFirewallIds([]); setPublicIp('new') }, [projectId]);
  useEffect(() => {
    setTgs((list) => list.map((tg) => ({ ...tg, targets: tg.targets.filter((t) => (t.ref.type === 'vm' ? cand.vms : cand.clusters).some((x) => x.id === t.ref.id)) })));
  }, [projectId, locationId, net.networkId]); // eslint-disable-line

  const switchType = (t: LbType) => {
    if (t === type) return;
    setType(t);
    const nextTgs = tgs.map((tg) => {
      const protocol = t === 'L7' ? 'HTTP' : 'TCP';
      return { ...tg, protocol, port: t === 'L7' ? 80 : tg.port === 80 ? 8080 : tg.port, stickySessions: false, healthCheck: defaultHealthCheck(protocol) } as TgDraft;
    });
    setTgs(nextTgs);
    setListeners([newListener(t, nextTgs[0]?.id ?? '', false)]);
    if (t === 'L7') setProxyProtocol(false);
  };

  const recommendedHttps = () => {
    const cert = projectCerts.find((c) => c.status === 'issued' || c.status === 'expiring');
    if (!cert) { setCertOpen(true); return }
    const tg = tgs[0]?.id ?? '';
    setListeners([
      { ...newListener('L7', tg, true, cert.id) },
      { ...newListener('L7', tg, false), redirectToHttps: true },
    ]);
  };

  const removeTg = (id: string) => {
    const rest = tgs.filter((t) => t.id !== id);
    setTgs(rest);
    setListeners((ls) => ls.map((l) => ({ ...l, defaultTargetGroupId: l.defaultTargetGroupId === id ? rest[0]?.id ?? '' : l.defaultTargetGroupId, rules: l.rules.filter((r) => r.targetGroupId !== id) })));
  };

  const cost = useMemo(() => lbCost({ type, dataProcessedGB: trafficGB, publicIps: publicIp === 'none' ? 0 : 1 }), [type, trafficGB, publicIp]);

  const body = {
    name, projectId, type, locationId, networkId: net.networkId, subnetId: net.subnetId || undefined, publicIp, ipv6, algorithm,
    listeners: listeners.map((l) => ({ port: l.port, protocol: l.protocol, certificateId: l.protocol === 'HTTPS' ? l.certificateId : undefined, defaultTargetGroupId: l.defaultTargetGroupId, redirectToHttps: l.redirectToHttps || undefined, rules: l.redirectToHttps ? [] : l.rules.map((r) => ({ host: r.host || undefined, pathPrefix: r.pathPrefix || undefined, targetGroupId: r.targetGroupId })) })),
    targetGroups: tgs.map((t) => ({ id: t.id, name: t.name, protocol: t.protocol, port: t.port, stickySessions: t.stickySessions, healthCheck: t.healthCheck, targets: t.targets.map((x) => ({ ref: x.ref, port: x.port, weight: x.weight })) })),
    firewallIds, proxyProtocol: type === 'L4' ? proxyProtocol : undefined, deletionProtection: protection, tags,
  };

  const create = useApiMutation(async () => { setErrors({}); setFormError(null); return api.create<LoadBalancer>('loadBalancers', body) }, {
    silent: true,
    onSuccess: (lb) => { toast.success(`Provisioning ${lb.name}`, 'Follow progress live on the detail page.'); navigate(`/managed-services/load-balancers/${lb.id}`) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); setFormError(e.message); window.scrollTo({ top: 0, behavior: 'smooth' }) },
  });

  // live preview: synthesize an LB from the drafts
  const preview = useMemo<LoadBalancer>(() => ({
    id: 'preview', name: name || 'preview', accountId: '', projectId, type, status: 'active', algorithm, locationId, networkId: net.networkId, ipIds: [], hostname: '', firewallIds: [], proxyProtocol, createdAt: '', tags: [],
    listeners: listeners.map((l) => ({ ...l, rules: l.rules.map((r) => ({ ...r })) })),
    targetGroups: tgs.map((tg) => ({
      ...tg, targets: tg.targets.map((t) => {
        const vm = t.ref.type === 'vm' ? vms.find((v) => v.id === t.ref.id) : undefined;
        const k = t.ref.type === 'k8s' ? clusters.find((c) => c.id === t.ref.id) : undefined;
        const up = vm ? vm.status === 'running' : k ? k.status === 'running' : false;
        return { ...t, health: up ? 'healthy' as const : 'unhealthy' as const, name: vm?.name ?? k?.name, address: vm ? `${vm.privateIp}:${t.port ?? tg.port}` : t.port ? `nodes:${t.port}` : undefined };
      }),
    })),
  }), [name, projectId, type, algorithm, locationId, net.networkId, proxyProtocol, listeners, tgs, vms, clusters]);

  const nameErr = name && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name) ? 'Lowercase letters, digits and dashes' : undefined;
  const missing = !name ? 'Enter a name to continue' : !projectId ? 'Choose a project' : !net.networkId ? 'Pick a network' : !tgs.length ? 'Add a target group' : !listeners.length ? 'Add a listener' : null;
  const canSubmit = !missing && !nameErr;
  const tgRefs = tgs.map((t) => ({ id: t.id, name: t.name }));
  const errKeys = Object.keys(errors);
  const requiredTags = !!allowance?.requiredTags.length;
  const selectedNet = networks.find((n) => n.id === net.networkId);

  /* ---------------------------------------------------------------- building blocks */
  const nameField = (
    <Field label="Name" required error={nameErr ?? errors.name} hint={pro ? 'e.g. compass-lb, website-lb' : undefined}>
      <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="compass-lb" invalid={!!(nameErr ?? errors.name)} autoFocus />
    </Field>
  );
  const projectField = <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />;
  const tagsField = (
    <Field label="Tags" error={errors.tags} hint={requiredTags ? `Project policy requires: ${allowance!.requiredTags.join(', ')}` : undefined}>
      <TagEditor value={tags} onChange={setTags} required={allowance?.requiredTags} />
    </Field>
  );
  const typeCards = pro ? (
    <OptionCards cols={2} value={type} onChange={switchType} options={[
      {
        value: 'L7', title: 'Application (L7) · HTTP/HTTPS', icon: <Globe className="size-4 text-pink-500" />,
        description: 'Terminates TLS and understands HTTP: route by host name and path, redirect HTTP→HTTPS, sticky cookies, X-Forwarded-For. Best for websites and APIs.',
        meta: <div className="flex flex-wrap gap-1 text-[10px]">{['TLS termination', 'host/path rules', "Let's Encrypt", 'HTTP health checks'].map((x) => <span key={x} className="rounded bg-surface-3 px-1.5 py-0.5 text-fg-2">{x}</span>)}</div>,
      },
      {
        value: 'L4', title: 'Network (L4) · TCP/UDP', icon: <NetIcon className="size-4 text-cyan-500" />,
        description: 'Forwards raw connections with minimal latency. Protocol-agnostic: databases, MQTT, game servers, gRPC or TLS passthrough. PROXY protocol keeps client IPs.',
        meta: <div className="flex flex-wrap gap-1 text-[10px]">{['any TCP/UDP', 'TLS passthrough', 'lowest latency', 'PROXY protocol'].map((x) => <span key={x} className="rounded bg-surface-3 px-1.5 py-0.5 text-fg-2">{x}</span>)}</div>,
      },
    ]} />
  ) : (
    <OptionCards cols={2} value={type} onChange={switchType} options={[
      { value: 'L7', title: 'Web (HTTP/HTTPS)', icon: <Globe className="size-4 text-pink-500" />, description: 'For websites and APIs. Handles HTTPS certificates for you.' },
      { value: 'L4', title: 'Any TCP/UDP', icon: <NetIcon className="size-4 text-cyan-500" />, description: 'For databases, game servers and other protocols.' },
    ]} />
  );
  const algorithmField = (
    <Field label="Balancing algorithm" error={errors.algorithm}>
      <OptionCards cols={3} value={algorithm} onChange={(v) => setAlgorithm(v as LoadBalancer['algorithm'])} options={ALGORITHMS.map((a) => ({ value: a.value, title: a.label, description: a.description }))} />
    </Field>
  );
  const locationBlock = (
    <>
      <LocationCards value={locationId} onChange={setLocationId} filter={(l) => !allowance || allowance.allowedLocations.includes(l.id) || l.id === locationId} />
      {errors.locationId && <p className="text-xs text-rose-500">{errors.locationId}</p>}
    </>
  );
  const networkFields = projectId && <NetworkSubnetFields projectId={projectId} locationId={locationId} networkId={net.networkId} subnetId={net.subnetId} onChange={setNet} errors={errors} />;
  const ipFields = (
    <div className="grid gap-4 @min-[36rem]:grid-cols-2">
      <Field label="Public IPv4 (VIP)" error={errors.publicIp ?? errors.publicIps}>
        <Select value={publicIp} onChange={(e) => setPublicIp(e.target.value)} options={[
          { value: 'new', label: 'Allocate a new public IP (+€2/mo)' }, { value: 'none', label: 'Internal only (private VIP in the subnet)' },
          ...availableIps.map((i) => ({ value: i.id, label: `Use existing ${i.address}` })),
        ]} />
      </Field>
      <div className="pt-1 @min-[36rem]:pt-6"><Switch checked={ipv6} onChange={setIpv6} label="Dual-stack IPv6" description="Also allocate an IPv6 VIP (free)." /></div>
    </div>
  );
  const firewallField = (
    <Field label={<span className="flex items-center gap-1.5"><Shield className="size-3.5" /> Firewalls</span>} error={errors.firewallIds} hint="Restrict who may reach the listeners. Without a firewall, listener ports are open to the internet." action={<Button size="xs" variant="ghost" icon={Plus} to="/infrastructure/firewalls/new">New</Button>}>
      <MultiSelect options={firewallOptions} value={firewallIds} onChange={setFirewallIds} placeholder="No firewall (listeners open to all)" emptyText="No firewalls in this project" />
    </Field>
  );
  const addTgButton = <Button size="sm" icon={Plus} onClick={() => setTgs([...tgs, newTargetGroup(type, tgs.length ? `pool-${tgs.length + 1}` : 'web')])}>Add group</Button>;
  const tgEditors = (
    <>
      {errors.targetGroups && <p className="text-xs text-rose-500">{errors.targetGroups}</p>}
      {projectId && !cand.vms.length && !cand.clusters.length && <Hint tone="warning">No VMs or Kubernetes clusters in this project at {locationId}{net.networkId ? ' reachable from the selected network' : ''}. You can add targets later.</Hint>}
      {tgs.map((tg, i) => (
        <div key={tg.id} className="relative rounded-xl border border-line p-3.5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-fg">Target group {i + 1}{tg.name && <span className="ml-1.5 font-mono text-xs font-normal text-muted">{tg.name}</span>}</span>
            {tgs.length > 1 && <button type="button" onClick={() => removeTg(tg.id)} className="rounded-md p-1 text-faint hover:bg-rose-500/10 hover:text-rose-500" aria-label="Remove target group"><X className="size-4" /></button>}
          </div>
          <TargetGroupFields value={tg} onChange={(v) => setTgs(tgs.map((x) => (x.id === tg.id ? v : x)))} type={type} vms={cand.vms} clusters={cand.clusters} errors={errors} prefix={`targetGroups.${i}`} />
        </div>
      ))}
    </>
  );
  const listenerButtons = (
    <div className="flex flex-wrap justify-end gap-1.5">
      {type === 'L7' && <Button size="sm" variant="ghost" icon={Sparkles} onClick={recommendedHttps}>HTTPS + redirect</Button>}
      <Button size="sm" icon={Plus} onClick={() => setListeners([...listeners, { ...newListener(type, tgs[0]?.id ?? '', false), port: type === 'L7' ? (listeners.some((l) => l.port === 80) ? 8080 : 80) : 8000 + listeners.length }])}>Add listener</Button>
    </div>
  );
  const listenerEditors = (
    <>
      {errors.listeners && <p className="text-xs text-rose-500">{errors.listeners}</p>}
      {type === 'L7' && !projectCerts.length && projectId && (
        <Hint>No TLS certificate in this project yet. <button type="button" className="font-medium text-brand-500 hover:underline" onClick={() => setCertOpen(true)}>Issue a free Let's Encrypt certificate</button> to add an HTTPS listener.</Hint>
      )}
      {listeners.map((l, i) => (
        <div key={l.id} className="rounded-xl border border-line p-3.5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className={cn('rounded-md px-2 py-0.5 text-xs font-semibold', l.protocol === 'HTTPS' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-brand-500/10 text-brand-600 dark:text-brand-300')}>{l.protocol} :{l.port}</span>
            {listeners.length > 1 && <button type="button" onClick={() => setListeners(listeners.filter((x) => x.id !== l.id))} className="rounded-md p-1 text-faint hover:bg-rose-500/10 hover:text-rose-500" aria-label="Remove listener"><X className="size-4" /></button>}
          </div>
          <ListenerFields value={l} onChange={(v) => setListeners(listeners.map((x) => (x.id === l.id ? v : x)))} type={type} targetGroups={tgRefs} certificates={projectCerts} errors={errors} prefix={`listeners.${i}`} siblings={listeners.filter((x) => x.id !== l.id)} />
        </div>
      ))}
    </>
  );
  const optionFields = (
    <>
      {type === 'L4' && <Switch checked={proxyProtocol} onChange={setProxyProtocol} label="PROXY protocol v2" description="Prepends the original client address to each connection. Targets must support it (nginx, HAProxy, Envoy…)." />}
      {type === 'L7' && pro && <p className="text-xs text-muted">L7 load balancers always add <code className="font-mono">X-Forwarded-For</code>, <code className="font-mono">X-Forwarded-Proto</code> and <code className="font-mono">X-Request-Id</code> headers.</p>}
      <Switch checked={protection} onChange={setProtection} label={<span className="flex items-center gap-1.5"><Shield className="size-3.5" /> Deletion protection</span>} description="Prevents accidental deletion via console, CLI or Terraform until disabled." />
    </>
  );
  const subHead = (t: string, aside?: React.ReactNode) => <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 first:border-0 first:pt-0"><h3 className="text-[13px] font-semibold text-fg">{t}</h3>{aside}</div>;

  return (
    <Page wide>
      <PageHeader title="Create load balancer" description={pro ? 'A redundant proxy pair with a floating VIP, health-checked targets and zero-downtime config reloads.' : 'One public IP that spreads traffic across your servers.'} icon={Scale} iconColor="#ec4899"
        crumbs={[{ label: 'Load Balancers', to: '/managed-services/load-balancers' }, { label: 'Create' }]} />
      {formError && <Hint tone="danger" className="mb-5">{formError}{errKeys.length > 1 && <span className="block text-xs opacity-80">{errKeys.length} fields need attention below.</span>}</Hint>}

      <CreateLayout needsProject="load balancer" aside={<>
        <CostPanel cost={cost} projectId={projectId} footer={
          <div className="space-y-2">
            <Button variant="primary" size="lg" className="w-full" icon={Rocket} loading={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()}>Create load balancer</Button>
            {missing && <p className="text-center text-[11px] text-muted">{missing}</p>}
          </div>
        }>
          <div className="mt-4 border-t border-line pt-3">
            <Pro>
              <Field label={`Expected traffic · ${trafficGB.toLocaleString()} GB / month`} hint="Only used for the estimate — billed by actual processed data.">
                <Slider value={trafficGB} onChange={setTrafficGB} min={0} max={10000} step={100} marks={[0, 2500, 5000, 10000]} format={(v) => (v >= 1000 ? `${v / 1000}T` : `${v}`)} />
              </Field>
            </Pro>
            <div className={cn('space-y-1.5 text-xs text-muted', pro && 'mt-3')}>
              <div className="flex justify-between"><span>Type</span><span className="text-fg-2">{type === 'L7' ? (pro ? 'L7 · HTTP(S) proxy' : 'Web (HTTP/HTTPS)') : (pro ? 'L4 · TCP/UDP' : 'TCP/UDP')}</span></div>
              <div className="flex justify-between"><span>Listeners</span><span className="text-fg-2">{listeners.map((l) => `${l.protocol}:${l.port}`).join(', ') || '—'}</span></div>
              <div className="flex justify-between"><span>Targets</span><span className="text-fg-2">{pro ? `${tgs.reduce((a, t) => a + t.targets.length, 0)} in ${tgs.length} group(s)` : `${tgs.reduce((a, t) => a + t.targets.length, 0)} server(s)`}</span></div>
              {!pro && <div className="flex justify-between"><span>Estimate includes</span><span className="text-fg-2">{trafficGB.toLocaleString()} GB traffic</span></div>}
            </div>
          </div>
        </CostPanel>
        <Pro>
          <details className="group rounded-xl border border-line bg-surface p-4 shadow-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-fg"><FileCode2 className="size-4 text-muted" /> Infrastructure as code<span className="ml-auto text-xs text-muted group-open:hidden">show</span></summary>
            <IacTabs className="mt-3" snippets={{ terraform: toHcl('load_balancer', name || 'my_lb', body), cli: toCli('lb create', body), curl: toCurl('POST', '/loadBalancers', body) }} />
          </details>
        </Pro>
      </>}>
        {pro ? (
          <>
            <FormSection step={1} title="Basics" description="Name, project and tags. The name becomes the DNS hostname (<name>.lb.<location>.autark.cloud).">
              <div className="grid gap-4 @min-[36rem]:grid-cols-2">{nameField}{projectField}</div>
              {tagsField}
            </FormSection>

            <FormSection step={2} title="Type" description="Pick the layer the load balancer works at. You can't change this later.">
              {typeCards}
              {algorithmField}
            </FormSection>

            <FormSection step={3} title="Location & network" description="The VIP is announced from edge routers at this location; targets must be reachable from the chosen network (same VPC or peered).">
              {locationBlock}
              {networkFields}
              {ipFields}
              {firewallField}
            </FormSection>

            <FormSection step={4} title="Target groups" description="Pools of backends with their own port and health check. Listeners and rules forward to a target group." aside={addTgButton}>
              {tgEditors}
            </FormSection>

            <FormSection step={5} title="Listeners" description="Ports the VIP accepts connections on and where traffic goes." aside={listenerButtons}>
              {listenerEditors}
            </FormSection>

            <FormSection step={6} title="Preview" description="How traffic will flow with the current configuration (simulated load, live target state)." aside={<Workflow className="size-4 text-muted" />}>
              <TrafficFlow lb={preview} total={100} unit={type === 'L7' ? 'req/s' : 'conn/s'} />
            </FormSection>

            <FormSection step={7} title="Options & protection">
              {optionFields}
            </FormSection>
          </>
        ) : (
          <>
            <FormSection step={1} title="Name & location">
              {nameField}
              {requiredTags && tagsField}
              {locationBlock}
              {projectId && (selectedNet
                ? <p className="text-xs text-muted">Network: <span className="font-medium text-fg-2">{selectedNet.name}</span> <span className="font-mono">{selectedNet.cidr}</span> · change under Advanced</p>
                : <Hint tone="warning">No network at this location yet. <Link to="/infrastructure/networks/new" className="font-medium underline">Create a network</Link> first.</Hint>)}
            </FormSection>

            <FormSection step={2} title="Type">
              {typeCards}
            </FormSection>

            <FormSection step={3} title="Forwarding" description="Where incoming traffic goes.">
              <SimpleForwarding type={type} listeners={listeners} setListeners={setListeners} tgs={tgs} setTgs={setTgs} vms={cand.vms} certificates={projectCerts} onIssueCert={() => setCertOpen(true)} errors={errors} />
            </FormSection>

            <Advanced description="Project, network, public IP, firewalls, algorithm, more listeners, health checks, protection">
              <div className="grid gap-4 @min-[36rem]:grid-cols-2">{projectField}</div>
              {!requiredTags && tagsField}
              {subHead('Network & IP')}
              {networkFields}
              {ipFields}
              {firewallField}
              {subHead('Balancing')}
              {algorithmField}
              {subHead('Target groups & health checks', addTgButton)}
              {tgEditors}
              {subHead('Listeners & routing rules', listenerButtons)}
              {listenerEditors}
              {subHead('Options')}
              {optionFields}
            </Advanced>
          </>
        )}
      </CreateLayout>

      <IssueCertificateModal open={certOpen} onClose={() => setCertOpen(false)} defaultProjectId={projectId} onCreated={(c) => toast.info(`${c.name} is being issued`, 'It becomes selectable for HTTPS listeners once Let\'s Encrypt has validated the domain.')} />
    </Page>
  );
}
