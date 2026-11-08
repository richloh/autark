import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Rocket, FileCode2, Boxes, Lock, Layers, Server, ShieldCheck, Network as NetworkIcon, Globe2 } from 'lucide-react';
import { useList, useApiMutation } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Input, Select, OptionCards, TagEditor, Hint, MultiSelect } from '@/components/ui/form';
import { FormSection, CreateLayout, fieldErrors } from '@/components/ui/FormLayout';
import { IacTabs, toCli, toHcl, toCurl } from '@/components/ui/CodeBlock';
import { CostPanel } from '@/components/resource/CostPanel';
import { ProjectField } from '@/components/resource/pickers';
import { Pro, Advanced } from '@/components/ui/Pro';
import { Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { flagEmoji } from '@/components/compute/vm/util';
import { spaceCost } from '@/lib/pricing';
import { cn } from '@/lib/cn';
import { usePro, useUi } from '@/store/ui';
import type { K8sSpace, Location, PlatformCluster, ProjectAllowance, SpaceQuota, Tag, User } from '@/types';
import { QuotaEditor, quotaErrors } from './QuotaEditor';
import { SpacePlacementCard, useSpacePlacement } from './SpacePlacementCard';
import { SPACE_NAME_RE, SPACE_SIZES, accountSlug, num1, quotaLine, useUsablePlatformClusters, type SizeId } from './spaceUi';

const SUB = 'text-[12px] font-semibold uppercase tracking-wide text-muted';

export function SpaceCreateForm() {
  const navigate = useNavigate();
  const pro = usePro();
  const [sp, setSp] = useSearchParams();
  const { items: allowances } = useList<ProjectAllowance>('allowances');
  const { items: locations } = useList<Location>('locations');
  const { items: users } = useList<User>('users');
  const pcs = useList<PlatformCluster>('platformClusters');

  const [projectId, setProjectId] = useState('');
  const [locationId, setLocationId] = useState(sp.get('location') ?? '');
  const [size, setSize] = useState<SizeId>('s');
  const [quota, setQuota] = useState<SpaceQuota>({ ...SPACE_SIZES[0].quota });
  const [name, setName] = useState(sp.get('name') ?? '');
  const [overrideId, setOverrideId] = useState('');
  const [networkPolicy, setNetworkPolicy] = useState<K8sSpace['networkPolicy']>('allow-same-namespace');
  const [editors, setEditors] = useState<string[]>([]);
  const [viewers, setViewers] = useState<string[]>([]);
  const [tags, setTags] = useState<Tag[]>([{ key: 'env', value: 'prod' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const allowance = allowances.find((a) => a.projectId === projectId);
  const usable = useUsablePlatformClusters(pcs.items, projectId);
  const byLocation = useMemo(() => {
    const m = new Map<string, PlatformCluster[]>();
    for (const pc of usable) {
      if (allowance && !allowance.allowedLocations.includes(pc.locationId)) continue;
      m.set(pc.locationId, [...(m.get(pc.locationId) ?? []), pc]);
    }
    return m;
  }, [usable, allowance]);
  const locs = locations.filter((l) => byLocation.has(l.id));

  // keep the location valid for the chosen project
  useEffect(() => {
    if (!locs.length) return;
    if (!locs.some((l) => l.id === locationId)) setLocationId((locs.find((l) => l.id === 'dc1') ?? locs[0]).id);
  }, [locs.map((l) => l.id).join(), locationId]); // eslint-disable-line
  useEffect(() => { setOverrideId('') }, [locationId]);

  const placementQ = useSpacePlacement({ locationId: byLocation.has(locationId) ? locationId : '', quota, projectId });
  const placement = placementQ.data;
  const targetId = overrideId || placement?.chosen?.id || byLocation.get(locationId)?.[0]?.id;
  const target = pcs.items.find((p) => p.id === targetId);
  const acct = accountSlug(useUi((s) => s.accountId));

  const qErrors = quotaErrors(quota, { max: target?.maxTenantQuota });
  const cost = useMemo(() => spaceCost(quota), [quota]);
  const nameErr = name && !SPACE_NAME_RE.test(name) ? 'Lowercase letters, digits and dashes (max 30)' : errors.name;
  const ns = `${acct}-${name || 'my-app'}`;
  const host = target ? `*.${name || 'my-app'}.${acct}.${target.ingressDomain}` : null;
  const pinnedBad = overrideId && placement && placement.candidates.find((c) => c.id === overrideId)?.fits === false;
  const noRoom = !!placement && !placement.chosen && !overrideId;
  const quotaBad = Object.keys(qErrors).length > 0;

  const team = [
    ...(editors.length ? [{ userIds: editors, role: 'edit' as const }] : []),
    ...(viewers.length ? [{ userIds: viewers, role: 'view' as const }] : []),
  ];
  const body = {
    name, projectId, locationId, platformClusterId: overrideId || undefined, quota, tier: 'namespace' as const, networkPolicy, team, tags,
  };

  const create = useApiMutation(() => api.create<K8sSpace>('k8sSpaces', body), {
    silent: true,
    onSuccess: (s) => { toast.success(`Creating space ${s.name}`, 'Your namespace and kubectl access are ready in seconds.'); navigate(`/managed-services/kubernetes/spaces/${s.id}`) },
    onError: (e: ApiClientError) => {
      setErrors(fieldErrors(e));
      setFormError(e.status === 404 ? 'Shared Kubernetes is not available on this platform yet.' : e.message);
      if (Object.keys(fieldErrors(e)).some((k) => k.startsWith('quota')) && size !== 'custom') setSize('custom');
      scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  const canSubmit = !!name && !nameErr && !!projectId && !!locationId && byLocation.has(locationId) && !quotaBad && !noRoom && !pinnedBad;
  const blocker = !byLocation.has(locationId) ? 'No shared cluster available' : quotaBad ? 'Fix the size limits' : noRoom || pinnedBad ? 'Not enough room on the shared cluster' : !name ? 'Enter a name' : nameErr ? 'Fix the name' : 'Pick a project';

  const userOpts = users.filter((u) => u.status !== 'disabled' && (u.projectIds === '*' || !projectId || u.projectIds.includes(projectId))).map((u) => ({ value: u.id, label: u.name, description: u.email }));
  const tagsRequired = !!allowance?.requiredTags.length;
  const tagsField = (
    <Field label="Tags" error={errors.tags} hint={tagsRequired ? `Project policy requires: ${allowance!.requiredTags.join(', ')}` : undefined}>
      <TagEditor value={tags} onChange={setTags} required={allowance?.requiredTags} />
    </Field>
  );

  const manifest = [
    'apiVersion: autark.io/v1',
    'kind: KubernetesSpace',
    'metadata:',
    `  name: ${name || 'my-app'}`,
    `  project: ${projectId}`,
    'spec:',
    `  location: ${locationId}`,
    ...(overrideId ? [`  platformCluster: ${overrideId}`] : []),
    '  quota:',
    `    cpu: "${quota.cpuCores}"`,
    `    memory: ${quota.memoryGi}Gi`,
    `    storage: ${quota.storageGi}Gi`,
    `    pods: ${quota.pods}`,
    `    loadBalancers: ${quota.loadBalancers}`,
    `  networkPolicy: ${networkPolicy}`,
    ...(team.length ? ['  team:', ...team.map((t) => `  - { role: ${t.role}, users: [${t.userIds.join(', ')}] }`)] : []),
  ].join('\n');

  const locationStep = pcs.isLoading ? <Skeleton className="h-20" /> : locs.length === 0 ? (
    <div className="rounded-xl border border-dashed border-line p-5 text-center">
      <Boxes className="mx-auto mb-2 size-6 text-muted" />
      <div className="text-sm font-medium text-fg">Shared Kubernetes isn't offered {projectId && pcs.items.length ? 'for this project ' : ''}yet</div>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted">Your provider hasn't opened a shared cluster {pcs.items.length ? 'to this project in an allowed location' : 'on this platform'}. You can still run your own cluster.</p>
      <Button className="mt-3" size="sm" onClick={() => { const n = new URLSearchParams(sp); n.set('type', 'dedicated'); setSp(n, { replace: true }) }}>Create your own cluster instead</Button>
    </div>
  ) : (
    <>
      <OptionCards cols={4} value={locationId} onChange={setLocationId} options={locs.map((l) => {
        const list = byLocation.get(l.id) ?? [];
        return {
          value: l.id,
          title: <span className="flex items-center gap-1.5"><span className="text-[15px] leading-none">{flagEmoji(l.country)}</span>{l.city}</span>,
          description: pro ? `${list.length} shared cluster${list.length === 1 ? '' : 's'} · v${list[0].version}` : l.name,
        };
      })} />
      {errors.locationId && <p className="text-xs text-rose-500">{errors.locationId}</p>}
    </>
  );

  return (
    <>
      {formError && <Hint tone="danger" className="mb-5">{formError}</Hint>}
      <CreateLayout needsProject="Kubernetes space" aside={<>
        <CostPanel cost={cost} projectId={projectId} footer={
          <div className="space-y-2">
            <Button variant="primary" size="lg" className="w-full" icon={Rocket} loading={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()}>Create space</Button>
            {!canSubmit && <p className="text-center text-[11px] text-muted">{blocker}</p>}
          </div>
        }>
          <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs text-muted">
            <div className="flex justify-between gap-2"><span>Reserved</span><span className="text-right text-fg-2">{num1(quota.cpuCores)} CPU · {num1(quota.memoryGi)} GiB</span></div>
            <div className="flex justify-between gap-2"><span>Storage · pods</span><span className="text-fg-2">{quota.storageGi} GiB · {quota.pods}</span></div>
            <p className="pt-1 text-[11px]">No cluster or node fees — you pay only for what you reserve.</p>
          </div>
        </CostPanel>
        <SpacePlacementCard placement={placement} isLoading={placementQ.isLoading} error={placementQ.error} quota={quota} overrideId={overrideId || undefined} />
        <Pro>
          <details className="group rounded-xl border border-line bg-surface p-4 shadow-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-fg"><FileCode2 className="size-4 text-muted" /> Infrastructure as code<span className="ml-auto text-xs text-muted group-open:hidden">show</span></summary>
            <IacTabs className="mt-3" snippets={{
              terraform: toHcl('kubernetes_space', name || 'my_app', body),
              yaml: manifest,
              cli: toCli('k8s space create', { ...body, quota: undefined, team: undefined, cpu: quota.cpuCores, memory: `${quota.memoryGi}Gi`, storage: `${quota.storageGi}Gi`, pods: quota.pods }),
              curl: toCurl('POST', '/k8sSpaces', body),
            }} />
          </details>
        </Pro>
      </>}>
        <FormSection step={1} title="Location" description={pro ? 'Only locations with a shared cluster your project may use.' : undefined}>
          {locationStep}
        </FormSection>

        <FormSection step={2} title="Size" description={pro ? 'Reserved CPU and memory requests (ResourceQuota). You can resize any time.' : 'How much your apps may use. You can change this later.'}>
          <QuotaEditor size={size} onSize={setSize} value={quota} onChange={setQuota} errors={qErrors} serverErrors={errors} />
          {size !== 'custom' && Object.values(qErrors)[0] && <Hint tone="warning">{Object.values(qErrors)[0]} — pick a smaller size or another cluster.</Hint>}
        </FormSection>

        <FormSection step={3} title="Name">
          <div className="grid gap-4 @min-[36rem]:grid-cols-2">
            <Field label="Space name" required error={nameErr} hint={pro ? 'DNS-safe, unique per project' : undefined}>
              <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="website" invalid={!!nameErr} autoFocus />
            </Field>
            <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />
          </div>
          {tagsRequired && tagsField}
          <div className="grid gap-2 rounded-lg bg-surface-2/60 px-3 py-2.5 text-xs @min-[36rem]:grid-cols-2">
            <div className="min-w-0"><span className="text-muted">Namespace</span><div className="truncate font-mono text-fg-2">{ns}</div></div>
            <div className="min-w-0"><span className="text-muted">Your apps' address</span><div className="truncate font-mono text-fg-2" title={host ?? undefined}>{host ?? '—'}</div></div>
          </div>
        </FormSection>

        <Advanced description={`${overrideId ? `Pinned to ${pcs.items.find((p) => p.id === overrideId)?.name ?? overrideId}` : 'Automatic placement'} · ${networkPolicy === 'default-deny' ? 'deny all traffic by default' : 'pods talk within the space'} · ${editors.length + viewers.length} team member${editors.length + viewers.length === 1 ? '' : 's'}`}>
          <h3 className={SUB}>Shared cluster</h3>
          <Field label="Platform cluster" error={errors.platformClusterId} hint="Leave on automatic unless you need a specific cluster.">
            <Select value={overrideId} onChange={(e) => setOverrideId(e.target.value)} options={[
              { value: '', label: `Automatic${placement?.chosen ? ` (${placement.chosen.name})` : ''}` },
              ...(placement?.candidates ?? (byLocation.get(locationId) ?? []).map((p) => ({ id: p.id, name: p.name, fits: true, reason: null, version: p.version }))).map((c) => ({
                value: c.id, label: `${c.name} · v${c.version}${c.fits ? '' : ` — ${c.reason ?? 'no room'}`}`, disabled: !c.fits,
              })),
            ]} />
          </Field>

          <h3 className={cn(SUB, 'border-t border-line pt-4')}>Isolation</h3>
          <OptionCards cols={3} value="namespace" onChange={() => {}} options={[
            { value: 'namespace', title: 'Namespace', icon: <Layers className="size-4 text-muted" />, description: 'Your own namespace with quota, RBAC and network policies.' },
            { value: 'vcluster', title: 'Virtual cluster', icon: <Boxes className="size-4 text-muted" />, disabled: true, badge: <Badge>coming soon</Badge>, description: 'Own API server: install CRDs and cluster-wide tools.' },
            { value: 'pool', title: 'Dedicated node pool', icon: <Server className="size-4 text-muted" />, disabled: true, badge: <Badge>coming soon</Badge>, description: 'Your pods on nodes nobody else uses.' },
          ]} />

          <h3 className={cn(SUB, 'border-t border-line pt-4')}>Network policy</h3>
          <OptionCards cols={2} value={networkPolicy} onChange={setNetworkPolicy} options={[
            { value: 'allow-same-namespace', title: 'Allow within the space', icon: <NetworkIcon className="size-4 text-muted" />, description: 'Pods in this space can reach each other; other tenants are blocked.', badge: <Badge tone="brand">recommended</Badge> },
            { value: 'default-deny', title: 'Deny by default', icon: <ShieldCheck className="size-4 text-muted" />, description: 'All traffic blocked until you add your own NetworkPolicies.' },
          ]} />
          <p className="flex items-center gap-1.5 text-xs text-muted"><Globe2 className="size-3.5" /> Ingress from the shared ingress controller is always allowed.</p>

          <h3 className={cn(SUB, 'border-t border-line pt-4')}>Team access</h3>
          <div className="grid gap-4 @min-[36rem]:grid-cols-2">
            <Field label="Can deploy (edit)" hint="Namespaced edit role via single sign-on">
              <MultiSelect options={userOpts} value={editors} onChange={(v) => { setEditors(v); setViewers(viewers.filter((x) => !v.includes(x))) }} placeholder="Add people…" />
            </Field>
            <Field label="Read only (view)">
              <MultiSelect options={userOpts.filter((o) => !editors.includes(o.value))} value={viewers} onChange={setViewers} placeholder="Add people…" />
            </Field>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted"><Lock className="size-3.5" /> You get edit access when nobody is picked. A kubeconfig for CI is always created.</p>
          {!tagsRequired && <><h3 className={cn(SUB, 'border-t border-line pt-4')}>Tags</h3>{tagsField}</>}
        </Advanced>
        {pro && target && <p className="px-1 text-xs text-muted">Limits on {target.name}: up to {quotaLine(target.maxTenantQuota, { lb: true })} per space · pod security “{target.podSecurity}”.</p>}
      </CreateLayout>
    </>
  );
}
