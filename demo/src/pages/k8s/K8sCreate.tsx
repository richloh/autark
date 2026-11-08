import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Boxes, Rocket, FileCode2, Plus, Trash2, Shield, Network as NetworkIcon, Globe2, ShieldCheck, Activity, GitBranch, HardDrive, Gpu, Lock, Sparkles, Server, Cpu, MemoryStick } from 'lucide-react';
import { useList, useApiMutation } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Input, Select, Switch, OptionCards, TagEditor, Hint, Textarea, Slider } from '@/components/ui/form';
import { FormSection, CreateLayout, fieldErrors } from '@/components/ui/FormLayout';
import { IacTabs, toCli, toHcl, toCurl } from '@/components/ui/CodeBlock';
import { CostPanel } from '@/components/resource/CostPanel';
import { ProjectField, LocationCards, NetworkSubnetFields } from '@/components/resource/pickers';
import { NodePoolEditor, newPoolDraft, poolBody, poolDraftCost, type PoolDraft } from '@/components/k8s/NodePoolEditor';
import { CNI_INFO, DAYS, poolNodeCost } from '@/components/k8s/k8sUi';
import { Pro, Advanced } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import { useAutoSubnet } from '@/components/db/useAutoSubnet';
import { toast } from '@/components/ui/toast';
import { k8sCost, PRICING } from '@/lib/pricing';
import { cidrOverlaps, isValidCidr } from '@/lib/cidr';
import { money, num } from '@/lib/format';
import { cn } from '@/lib/cn';
import { K8S_VERSIONS, K8S_ADDONS, K8S_NODE_PRESETS, type Network, type ProjectAllowance, type K8sAddon } from '@/types';

const CATEGORY_ICON: Record<K8sAddon['category'], typeof Shield> = { networking: Globe2, security: ShieldCheck, observability: Activity, delivery: GitBranch, storage: HardDrive, gpu: Gpu };
const CP_SIZES = [
  { value: 'small' as const, title: 'Small', description: 'Up to 25 nodes · 2 vCPU / 4 GB API servers' },
  { value: 'medium' as const, title: 'Medium', description: 'Up to 100 nodes · 4 vCPU / 16 GB' },
  { value: 'large' as const, title: 'Large', description: 'Up to 500 nodes · 8 vCPU / 32 GB, dedicated etcd' },
];

export default function K8sCreate() {
  const navigate = useNavigate();
  const pro = usePro();
  const [sp] = useSearchParams();
  const { items: allowances } = useList<ProjectAllowance>('allowances');
  const { items: networks } = useList<Network>('networks');

  const [name, setName] = useState(sp.get('name') ?? '');
  const [projectId, setProjectId] = useState('');
  const [tags, setTags] = useState<{ key: string; value: string }[]>([{ key: 'env', value: 'prod' }]);
  const [locationId, setLocationId] = useState('dc1');
  const [version, setVersion] = useState(K8S_VERSIONS[0].version);
  const [autoUpgrade, setAutoUpgrade] = useState(true);
  const [mw, setMw] = useState({ day: 'sun', hour: 3 });
  const [cp, setCp] = useState<{ size: 'small' | 'medium' | 'large'; ha: boolean }>({ size: 'small', ha: true });
  const [privateEndpoint, setPrivateEndpoint] = useState(false);
  const [allowlist, setAllowlist] = useState('0.0.0.0/0');
  const [net, setNet] = useState({ networkId: '', subnetId: '' });
  const [cni, setCni] = useState<'cilium' | 'calico' | 'flannel'>('cilium');
  const [podCidr, setPodCidr] = useState('172.16.0.0/16');
  const [serviceCidr, setServiceCidr] = useState('172.20.0.0/16');
  const [pools, setPools] = useState<PoolDraft[]>(() => !pro ? [newPoolDraft('workers', 'k8s-np-m', 3)] : [{ ...newPoolDraft('system', 'k8s-np-s', 2), taints: ['CriticalAddonsOnly=true:NoSchedule'], labels: [{ key: 'role', value: 'system' }] }, { ...newPoolDraft('workers', 'k8s-np-m', 3), autoscale: { enabled: true, min: 2, max: 8 } }]);
  useAutoSubnet(projectId, locationId, net, setNet);
  const [addons, setAddons] = useState<Record<string, boolean>>({ ingress: true, certManager: true, metricsServer: true, monitoring: true });
  const [oidc, setOidc] = useState(false);
  const [oidcConfig, setOidcConfig] = useState({ issuerUrl: 'https://sso.regiocom-energie.de/realms/regiocom', clientId: 'kubernetes', usernameClaim: 'email', groupsClaim: 'groups' });
  const [protection, setProtection] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const allowance = allowances.find((a) => a.projectId === projectId);
  const vpc = networks.find((n) => n.id === net.networkId);
  const hasGpu = pools.some((p) => p.gpu);
  const effectiveAddons: Record<string, boolean> = { ...addons, gpuOperator: !!addons.gpuOperator && hasGpu };

  const cost = useMemo(() => k8sCost({ controlPlaneSize: cp.size, ha: cp.ha, pools: pools.map((p) => ({ name: p.name || 'pool', vcpus: p.vcpus, ramGB: p.ramGB, diskGB: p.diskGB, count: p.count, gpu: p.gpu })) }), [cp, pools]);
  const totals = pools.reduce((a, p) => ({ nodes: a.nodes + p.count, vcpus: a.vcpus + p.vcpus * p.count, ram: a.ram + p.ramGB * p.count, gpus: a.gpus + (p.gpu?.count ?? 0) * p.count }), { nodes: 0, vcpus: 0, ram: 0, gpus: 0 });
  const maxCost = pools.reduce((a, p) => a + (p.autoscale.enabled ? poolDraftCost({ ...p, count: p.autoscale.max }) : poolDraftCost(p)), 0) + (PRICING.k8s.controlPlane[cp.size] ?? 0) + (cp.ha ? PRICING.k8s.haAddOn : 0);

  const podErr = !isValidCidr(podCidr) ? 'Invalid CIDR' : vpc && cidrOverlaps(podCidr, vpc.cidr) ? `Overlaps VPC ${vpc.cidr}` : errors.podCidr;
  const svcErr = !isValidCidr(serviceCidr) ? 'Invalid CIDR' : isValidCidr(podCidr) && cidrOverlaps(serviceCidr, podCidr) ? 'Overlaps the pod CIDR' : vpc && cidrOverlaps(serviceCidr, vpc.cidr) ? `Overlaps VPC ${vpc.cidr}` : errors.serviceCidr;
  const poolNames = pools.map((p) => p.name);
  const poolsValid = pools.length > 0 && totals.nodes > 0 && pools.every((p) => /^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$/.test(p.name)) && new Set(poolNames).size === poolNames.length;
  const nameErr = name && !/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(name) ? 'Lowercase letters, digits and dashes (max 40)' : errors.name;

  const body = {
    name, projectId, locationId, version, autoUpgrade, maintenanceWindow: mw,
    controlPlane: cp, privateEndpoint, apiAllowlist: allowlist.split(/[,\s]+/).filter(Boolean),
    networkId: net.networkId, subnetId: net.subnetId, cni, podCidr, serviceCidr,
    nodePools: pools.map(poolBody), addons: effectiveAddons, oidc, oidcConfig: oidc ? oidcConfig : undefined, deletionProtection: protection, tags,
  };

  const create = useApiMutation(() => api.create<{ id: string }>('k8sClusters', body), {
    silent: true,
    onSuccess: (c) => { toast.success(`Provisioning ${name}`, 'Watch the control plane and node pools come up live.'); navigate(`/managed-services/kubernetes/${c.id}`) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); setFormError(e.message); scrollTo({ top: 0, behavior: 'smooth' }) },
  });

  const canSubmit = !!name && !nameErr && !!projectId && !!net.subnetId && poolsValid && !podErr && !svcErr && (!oidc || oidcConfig.issuerUrl.startsWith('https://'));
  const blocker = !name ? 'Enter a cluster name' : !net.subnetId ? 'Pick a network & subnet' : !poolsValid ? 'Fix the node pools (unique names, ≥ 1 node)' : podErr || svcErr ? 'Fix the CIDR ranges' : 'Complete the OIDC settings';

  const manifest = [
    'apiVersion: autark.io/v1',
    'kind: KubernetesCluster',
    'metadata:',
    `  name: ${name || 'my-cluster'}`,
    `  project: ${projectId}`,
    'spec:',
    `  version: "${version}"`,
    `  location: ${locationId}`,
    `  controlPlane: { size: ${cp.size}, highAvailability: ${cp.ha} }`,
    `  network: { vpc: ${net.networkId || '<vpc>'}, subnet: ${net.subnetId || '<subnet>'}, cni: ${cni}, podCIDR: ${podCidr}, serviceCIDR: ${serviceCidr} }`,
    '  nodePools:',
    ...pools.flatMap((p) => [
      `  - name: ${p.name}`,
      `    ${p.presetId ? `size: ${p.presetId}` : `resources: { vcpus: ${p.vcpus}, memoryGB: ${p.ramGB}${p.gpu ? `, gpu: ${p.gpu.count}x${p.gpu.model}` : ''} }`}`,
      `    count: ${p.count}`,
      ...(p.autoscale.enabled ? [`    autoscaling: { min: ${p.autoscale.min}, max: ${p.autoscale.max} }`] : []),
      ...(p.taints.length ? [`    taints: [${p.taints.map((t) => `"${t}"`).join(', ')}]`] : []),
    ]),
    `  addons: [${Object.entries(effectiveAddons).filter(([, v]) => v).map(([k]) => k).join(', ')}]`,
    ...(oidc ? [`  oidc: { issuerURL: ${oidcConfig.issuerUrl}, clientID: ${oidcConfig.clientId} }`] : []),
    `  maintenance: { autoUpgrade: ${autoUpgrade}, window: "${mw.day} ${String(mw.hour).padStart(2, '0')}:00 UTC" }`,
    '---',
    '# once running:',
    `#   autark k8s kubeconfig ${name || 'my-cluster'} > ~/.kube/${name || 'my-cluster'}.yaml`,
    `#   kubectl --kubeconfig ~/.kube/${name || 'my-cluster'}.yaml get nodes`,
  ].join('\n');

  const nameField = (
    <Field label="Cluster name" required error={nameErr} hint={pro ? 'e.g. orchestrator-prod, tools' : undefined}>
      <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="prod-eu" invalid={!!nameErr} autoFocus />
    </Field>
  );
  const tagsRequired = !!allowance?.requiredTags.length;
  const tagsField = (
    <Field label="Tags" error={errors.tags} hint={tagsRequired ? `Project policy requires: ${allowance!.requiredTags.join(', ')}` : undefined}>
      <TagEditor value={tags} onChange={setTags} required={allowance?.requiredTags} />
    </Field>
  );
  const locationField = (
    <>
      <LocationCards value={locationId} onChange={setLocationId} filter={(l) => !allowance || allowance.allowedLocations.includes(l.id) || l.id === locationId} />
      {errors.locationId && <p className="text-xs text-rose-500">{errors.locationId}</p>}
    </>
  );
  const maintenanceFields = (
    <div className="grid gap-4 @min-[36rem]:grid-cols-[1fr_auto_auto] @min-[36rem]:items-end">
      <Switch checked={autoUpgrade} onChange={setAutoUpgrade} label="Automatic upgrades" description="Patch releases and minor upgrades are applied in the maintenance window." />
      <Field label="Maintenance day"><Select className="w-36" value={mw.day} onChange={(e) => setMw({ ...mw, day: e.target.value })} options={DAYS} /></Field>
      <Field label="Hour (UTC)"><Select className="w-28" value={String(mw.hour)} onChange={(e) => setMw({ ...mw, hour: Number(e.target.value) })} options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }))} /></Field>
    </div>
  );
  const haSwitch = (
    <Switch checked={cp.ha} onChange={(ha) => setCp({ ...cp, ha })} label={<span className="flex items-center gap-1.5">{pro ? 'High availability' : 'HA control plane'} <Badge tone="brand">+{money(PRICING.k8s.haAddOn)}/mo</Badge></span>}
      description={pro ? '3 control-plane replicas across racks with a 3-member etcd quorum. Survives the loss of one host; required for a 99.95% API SLA.' : 'Keeps the cluster manageable if a server fails. Recommended for production.'} />
  );
  const cpSizeAndApi = (
    <>
      <OptionCards cols={3} value={cp.size} onChange={(size) => setCp({ ...cp, size })} options={CP_SIZES.map((s) => ({ ...s, meta: <span className="text-xs font-medium tabular text-fg">{money(PRICING.k8s.controlPlane[s.value])}/mo</span> }))} />
      {pro && haSwitch}
      {pro && !cp.ha && <Hint tone="warning">A single control plane is fine for dev/test. The API is briefly unavailable during upgrades and host maintenance.</Hint>}
      <div className="grid gap-4 @min-[36rem]:grid-cols-2">
        <Switch checked={privateEndpoint} onChange={setPrivateEndpoint} label={<span className="flex items-center gap-1.5"><Lock className="size-3.5" /> Private API endpoint</span>} description="Reachable only from the VPC or via VPN." />
        <Field label="API allowlist (CIDRs)" hint="Comma separated; 0.0.0.0/0 = everyone">
          <Input value={allowlist} onChange={(e) => setAllowlist(e.target.value)} mono disabled={privateEndpoint} />
        </Field>
      </div>
    </>
  );
  const networkFields = (
    <>
      {projectId && <NetworkSubnetFields projectId={projectId} locationId={locationId} networkId={net.networkId} subnetId={net.subnetId} onChange={setNet} errors={errors} />}
      <Field label="CNI plugin">
        <OptionCards cols={3} value={cni} onChange={setCni} options={(['cilium', 'calico', 'flannel'] as const).map((k) => ({ value: k, title: CNI_INFO[k].label, description: CNI_INFO[k].description, icon: <NetworkIcon className="size-4 text-muted" />, badge: k === 'cilium' ? <Badge tone="brand">recommended</Badge> : undefined }))} />
      </Field>
      <div className="grid gap-4 @min-[36rem]:grid-cols-2">
        <Field label="Pod CIDR" error={podErr}><Input value={podCidr} onChange={(e) => setPodCidr(e.target.value)} mono invalid={!!podErr} /></Field>
        <Field label="Service CIDR" error={svcErr}><Input value={serviceCidr} onChange={(e) => setServiceCidr(e.target.value)} mono invalid={!!svcErr} /></Field>
      </div>
    </>
  );
  const poolsEditor = (
    <>
      {errors.nodePools && <Hint tone="danger">{errors.nodePools}</Hint>}
      <div className="space-y-3">
        {pools.map((p, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface-2/30 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Server className="size-4 text-muted" />
              <span className="text-sm font-semibold text-fg">{p.name || `pool ${i + 1}`}</span>
              {p.gpu && <Badge tone="violet">GPU</Badge>}
              {p.taints.some((t) => t.startsWith('CriticalAddonsOnly')) && <Badge>system</Badge>}
              <span className="ml-auto" />
              <Button size="xs" variant="ghost" icon={Trash2} disabled={pools.length === 1} onClick={() => setPools(pools.filter((_, j) => j !== i))}>Remove</Button>
            </div>
            <NodePoolEditor value={p} onChange={(d) => setPools(pools.map((x, j) => (j === i ? d : x)))} errors={errors} errorPrefix={`nodePools.${i}.`} nameTaken={poolNames.filter((n) => n === p.name).length > 1} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={Plus} onClick={() => setPools([...pools, newPoolDraft(`pool-${pools.length + 1}`, 'k8s-np-m', 2)])}>Add pool</Button>
        <Button size="sm" icon={Sparkles} onClick={() => { setPools([...pools, { ...newPoolDraft('gpu', 'k8s-np-gpu', 1), autoscale: { enabled: true, min: 0, max: 4 }, labels: [{ key: 'workload', value: 'gpu' }] }]); setAddons({ ...addons, gpuOperator: true }) }}>Add GPU pool</Button>
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => setPools([...pools, { ...newPoolDraft('batch', 'k8s-np-c16', 0), autoscale: { enabled: true, min: 0, max: 10 }, taints: ['dedicated=batch:NoSchedule'] }])}>Scale-to-zero batch pool</Button>
      </div>
    </>
  );
  const addonsGrid = (
    <>
      <div className="grid gap-2.5 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-3">
        {K8S_ADDONS.map((a) => {
          const Icon = CATEGORY_ICON[a.category];
          const disabled = a.id === 'gpuOperator' && !hasGpu;
          const on = !!effectiveAddons[a.id];
          return (
            <button key={a.id} type="button" disabled={disabled} onClick={() => setAddons({ ...addons, [a.id]: !addons[a.id] })}
              className={cn('flex items-start gap-3 rounded-xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50', on ? 'border-brand-500 bg-brand-500/[0.06] ring-3 ring-brand-500/15' : 'border-line bg-surface hover:border-line-strong')}>
              <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', on ? 'bg-brand-500 text-white' : 'bg-surface-3 text-muted')}><Icon className="size-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5"><span className="truncate text-sm font-medium text-fg">{a.name}</span><span className="text-[10px] text-faint">{a.version}</span></div>
                <div className="mt-0.5 text-xs text-muted">{disabled ? 'Needs a GPU node pool' : a.description}</div>
              </div>
              <span className={cn('mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors', on ? 'bg-brand-500' : 'bg-line-strong')}><span className={cn('size-3 rounded-full bg-white transition-transform', on && 'translate-x-3')} /></span>
            </button>
          );
        })}
      </div>
      {errors.addons && <p className="text-xs text-rose-500">{errors.addons}</p>}
    </>
  );
  const accessFields = (
    <>
      <Switch checked={oidc} onChange={setOidc} label="OIDC single sign-on" description="kubectl authenticates through your identity provider (Keycloak, Dex, Entra ID, Google…). Map IdP groups to RBAC roles." />
      {oidc && (
        <div className="grid gap-4 rounded-xl border border-line p-3 @min-[36rem]:grid-cols-2">
          <Field label="Issuer URL" required error={errors.oidcConfig || (!oidcConfig.issuerUrl.startsWith('https://') ? 'Must start with https://' : undefined)} className="@min-[36rem]:col-span-2"><Input value={oidcConfig.issuerUrl} onChange={(e) => setOidcConfig({ ...oidcConfig, issuerUrl: e.target.value })} mono /></Field>
          <Field label="Client ID"><Input value={oidcConfig.clientId} onChange={(e) => setOidcConfig({ ...oidcConfig, clientId: e.target.value })} mono /></Field>
          <Field label="Username claim"><Input value={oidcConfig.usernameClaim} onChange={(e) => setOidcConfig({ ...oidcConfig, usernameClaim: e.target.value })} mono /></Field>
          <Field label="Groups claim" className="@min-[36rem]:col-span-2" hint="Bind with e.g. kubectl create clusterrolebinding devs --clusterrole=edit --group=oidc:developers"><Textarea rows={1} className="min-h-9" value={oidcConfig.groupsClaim} onChange={(e) => setOidcConfig({ ...oidcConfig, groupsClaim: e.target.value })} mono /></Field>
        </div>
      )}
      <Switch checked={protection} onChange={setProtection} label={<span className="flex items-center gap-1.5"><Shield className="size-3.5" /> Deletion protection</span>} description="Blocks deleting the cluster until disabled." />
    </>
  );

  // simple mode: the first pool is edited with size cards + a node count slider
  const main = pools[0];
  const setMain = (patch: Partial<PoolDraft>) => setPools(pools.map((p, i) => (i === 0 ? { ...p, ...patch } : p)));
  const pickMainPreset = (id: string) => {
    const pr = K8S_NODE_PRESETS.find((x) => x.id === id)!;
    setMain({ presetId: id, vcpus: pr.vcpus, ramGB: pr.ramGB, diskGB: pr.diskGB, gpu: null, taints: main.taints.filter((t) => t !== 'nvidia.com/gpu=true:NoSchedule') });
  };
  const setMainCount = (n: number) => setMain({ count: n, autoscale: main.autoscale.enabled ? { ...main.autoscale, min: Math.min(main.autoscale.min, n), max: Math.max(main.autoscale.max, n) } : { ...main.autoscale, min: n, max: Math.max(n, main.autoscale.max) } });
  const advancedErrorKeys = Object.keys(errors).filter((k) => !['name', 'projectId', 'locationId', 'version'].includes(k));
  const advancedNeeded = advancedErrorKeys.length > 0 || !!podErr || !!svcErr || !poolsValid;

  return (
    <Page wide>
      <PageHeader title="Create Kubernetes cluster" description={pro ? 'Upstream, CNCF-conformant Kubernetes. Autark runs the control plane; you pick the nodes.' : 'Autark runs Kubernetes for you. You pick the nodes.'}
        icon={Boxes} iconColor="#326ce5" crumbs={[{ label: 'Kubernetes', to: '/managed-services/kubernetes' }, { label: 'Create' }]} />
      {formError && <Hint tone="danger" className="mb-5">{formError}</Hint>}

      <CreateLayout needsProject="Kubernetes cluster" aside={<>
        <CostPanel cost={cost} projectId={projectId} footer={
          <div className="space-y-2">
            <Button variant="primary" size="lg" className="w-full" icon={Rocket} loading={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()}>Create cluster</Button>
            {!canSubmit && <p className="text-center text-[11px] text-muted">{!pro && !net.subnetId && name ? 'No network in this location — see Advanced options' : blocker}</p>}
          </div>
        }>
          {maxCost > cost.total + 0.5 && <p className="mt-2 text-[11px] text-muted">Up to {money(maxCost)}/mo when autoscaling reaches max.</p>}
          <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs text-muted">
            <div className="flex justify-between"><span>Version</span><span className="text-fg-2">v{K8S_VERSIONS.find((v) => v.version === version)?.patch}</span></div>
            <div className="flex justify-between"><span>Control plane</span><span className="text-fg-2">{pro ? cp.size : ''}{cp.ha ? (pro ? ' · HA (3)' : 'High availability') : (pro ? ' · single' : 'Single')}</span></div>
            <div className="flex justify-between"><span>Nodes</span><span className="text-fg-2">{totals.nodes} · {num(totals.vcpus)} vCPU · {num(totals.ram)} GB{totals.gpus ? ` · ${totals.gpus} GPU` : ''}</span></div>
            {pro && <div className="flex justify-between"><span>Add-ons</span><span className="text-fg-2">{Object.values(effectiveAddons).filter(Boolean).length} enabled</span></div>}
          </div>
        </CostPanel>
        <Pro>
          <details className="group rounded-xl border border-line bg-surface p-4 shadow-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-fg"><FileCode2 className="size-4 text-muted" /> Infrastructure as code<span className="ml-auto text-xs text-muted group-open:hidden">show</span></summary>
            <IacTabs className="mt-3" snippets={{
              terraform: toHcl('kubernetes_cluster', name || 'my_cluster', body),
              yaml: manifest,
              cli: toCli('k8s cluster create', { ...body, nodePools: undefined, pool: pools.map((p) => `name=${p.name},size=${p.presetId ?? `${p.vcpus}x${p.ramGB}`},count=${p.count}${p.autoscale.enabled ? `,min=${p.autoscale.min},max=${p.autoscale.max}` : ''}`) }),
              curl: toCurl('POST', '/k8sClusters', body),
            }} />
          </details>
        </Pro>
      </>}>
        {pro ? (
          <>
            <FormSection step={1} title="Basics" description="Cluster names are DNS-safe and unique per project.">
              <div className="grid gap-4 @min-[36rem]:grid-cols-2">
                {nameField}
                <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />
              </div>
              {tagsField}
              {allowance && <p className="text-xs text-muted">Project quota: {allowance.quotas.k8sClusters} cluster{allowance.quotas.k8sClusters === 1 ? '' : 's'}.</p>}
            </FormSection>

            <FormSection step={2} title="Location" description="Control plane and nodes run in one location; nodes are spread across racks / zones.">
              {locationField}
            </FormSection>

            <FormSection step={3} title="Kubernetes version" description="Supported minor versions. Upgrades move one minor version at a time.">
              <OptionCards cols={4} value={version} onChange={setVersion} options={K8S_VERSIONS.map((v) => ({
                value: v.version, title: `v${v.patch}`,
                badge: v.status === 'latest' ? <Badge tone="success">latest</Badge> : v.status === 'deprecated' ? <Badge tone="warning">EOL soon</Badge> : undefined,
                description: `Supported until ${v.endOfSupport}`,
                meta: <ul className="space-y-0.5 text-[11px] text-muted">{v.highlights.slice(0, 2).map((h) => <li key={h} className="truncate">• {h}</li>)}</ul>,
              }))} />
              {K8S_VERSIONS.find((v) => v.version === version)?.status === 'deprecated' && <Hint tone="warning">v{version} reaches end of support on {K8S_VERSIONS.find((v) => v.version === version)?.endOfSupport}. Start on a newer version unless you need it for compatibility.</Hint>}
              {maintenanceFields}
            </FormSection>

            <FormSection step={4} title="Control plane" description="API server, scheduler, controller-manager and etcd — fully managed.">
              {cpSizeAndApi}
            </FormSection>

            <FormSection step={5} title="Networking" description="Nodes get addresses from the subnet; pods and services use separate overlay ranges.">
              {networkFields}
            </FormSection>

            <FormSection step={6} title="Node pools" description="Groups of identical worker nodes. Use taints to dedicate pools (system, GPU, batch)." aside={<span className="text-xs text-muted">{pools.length} pool{pools.length === 1 ? '' : 's'} · {totals.nodes} nodes</span>}>
              {poolsEditor}
            </FormSection>

            <FormSection step={7} title="Add-ons" description="Curated, versioned and upgraded together with the cluster. You can change them later.">
              {addonsGrid}
            </FormSection>

            <FormSection step={8} title="Access & protection" description="Admin credentials are always available as a kubeconfig. Add SSO for your team.">
              {accessFields}
            </FormSection>
          </>
        ) : (
          <>
            <FormSection step={1} title="Name & version">
              <div className="grid gap-4 @min-[36rem]:grid-cols-2">
                {nameField}
                <Field label="Kubernetes version">
                  <Select value={version} onChange={(e) => setVersion(e.target.value)} options={K8S_VERSIONS.map((v) => ({ value: v.version, label: `v${v.patch}${v.status === 'latest' ? ' (latest)' : v.status === 'deprecated' ? ' (end of support soon)' : ''}` }))} />
                </Field>
                <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />
              </div>
              {tagsRequired && tagsField}
            </FormSection>

            <FormSection step={2} title="Location">
              {locationField}
            </FormSection>

            <FormSection step={3} title="Nodes" description={pools.length > 1 ? `Size of the "${main.name}" pool. ${pools.length - 1} more pool${pools.length > 2 ? 's' : ''} in Advanced options.` : 'The servers your apps run on.'}>
              <OptionCards cols={3} value={main.presetId ?? ''} onChange={pickMainPreset} options={K8S_NODE_PRESETS.filter((p) => !p.gpu).map((p) => ({
                value: p.id, title: p.name,
                meta: (
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex gap-2 text-fg-2"><span className="flex items-center gap-0.5"><Cpu className="size-3" />{p.vcpus}</span><span className="flex items-center gap-0.5"><MemoryStick className="size-3" />{p.ramGB}G</span></span>
                    <span className="font-medium tabular text-fg">{money(poolNodeCost(p))}</span>
                  </div>
                ),
              }))} />
              <Field label={`Number of nodes · ${main.count}`} error={errors['nodePools.0.count']}>
                <Slider value={Math.max(1, main.count)} onChange={setMainCount} min={1} max={20} marks={[1, 5, 10, 15, 20]} />
              </Field>
            </FormSection>

            <FormSection step={4} title="Availability">
              {haSwitch}
            </FormSection>

            <Advanced
              key={advancedNeeded ? 'adv-open' : 'adv'}
              defaultOpen={advancedNeeded || undefined}
              description={`Autoscaling ${main.autoscale.enabled ? 'on' : 'off'} · ${CNI_INFO[cni]?.label ?? cni} networking · ${Object.values(effectiveAddons).filter(Boolean).length} add-ons (ingress, certificates, monitoring) · auto-upgrades ${autoUpgrade ? 'on' : 'off'}`}
            >
              <SubHeading first>Node pools</SubHeading>
              {poolsEditor}
              <SubHeading>Add-ons</SubHeading>
              {addonsGrid}
              <SubHeading>Network</SubHeading>
              {networkFields}
              <SubHeading>Control plane & API</SubHeading>
              {cpSizeAndApi}
              <SubHeading>Upgrades & maintenance</SubHeading>
              {maintenanceFields}
              <SubHeading>Access & protection</SubHeading>
              {accessFields}
              {!tagsRequired && tagsField}
            </Advanced>
          </>
        )}
      </CreateLayout>
    </Page>
  );
}

function SubHeading({ children, first }: { children: ReactNode; first?: boolean }) {
  return <h3 className={cn('text-[12px] font-semibold uppercase tracking-wide text-muted', !first && 'border-t border-line pt-4')}>{children}</h3>;
}
