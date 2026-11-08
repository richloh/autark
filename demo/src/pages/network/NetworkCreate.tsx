import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Network as NetworkIcon, Rocket, FileCode2, Globe2, Lock, Wand2, Plus, X, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import { useList, useApiMutation } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Field, Input, Switch, TagEditor, Textarea, Hint } from '@/components/ui/form';
import { FormSection, CreateLayout, fieldErrors } from '@/components/ui/FormLayout';
import { Segmented } from '@/components/ui/Tabs';
import { IacTabs, toCli, toHcl, toCurl } from '@/components/ui/CodeBlock';
import { CostPanel } from '@/components/resource/CostPanel';
import { ProjectField, LocationCards } from '@/components/resource/pickers';
import { toast } from '@/components/ui/toast';
import { breakdown, PRICING } from '@/lib/pricing';
import { parseCidr, nextFreeSubnet, usableHosts } from '@/lib/cidr';
import { num } from '@/lib/format';
import { cn } from '@/lib/cn';
import { AddressSpace } from '@/components/network/AddressSpace';
import { vpcCidrProblem, subnetCidrProblem, suggestVpcCidr, subnetColor, cidrRange } from '@/components/network/util';
import { useDefaultProject } from '@/components/network/useDefaultProject';
import { Advanced, Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import type { Network, ProjectAllowance } from '@/types';

interface DraftSubnet { key: number; name: string; cidr: string; public: boolean }
let key = 0;

function plan(cidr: string, base: string, tiers: { suffix: string; public: boolean; prefix?: number }[]): DraftSubnet[] {
  const v = parseCidr(cidr);
  if (!v) return [];
  const taken: string[] = [];
  const out: DraftSubnet[] = [];
  for (const t of tiers) {
    const pre = Math.max(v.prefix + 1, Math.min(28, t.prefix ?? (v.prefix <= 22 ? 24 : v.prefix + 2)));
    const c = nextFreeSubnet(cidr, taken, pre);
    if (!c) continue;
    taken.push(c);
    out.push({ key: ++key, name: `${base || 'vpc'}-${t.suffix}`, cidr: c, public: t.public });
  }
  return out;
}

const PLANS = {
  single: [{ suffix: 'public', public: true }],
  twoTier: [{ suffix: 'public', public: true }, { suffix: 'private', public: false }],
  threeTier: [{ suffix: 'public', public: true }, { suffix: 'app', public: false }, { suffix: 'data', public: false }],
  k8s: [{ suffix: 'public', public: true }, { suffix: 'private', public: false }, { suffix: 'k8s', public: false, prefix: 20 }],
};

export default function NetworkCreate() {
  const navigate = useNavigate();
  const pro = usePro();
  const { items: networks, isLoading: netsLoading } = useList<Network>('networks');
  const { items: allowances } = useList<ProjectAllowance>('allowances');
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<{ key: string; value: string }[]>([]);
  const [locationId, setLocationId] = useState('dc1');
  const [cidr, setCidr] = useState('');
  const [subnets, setSubnets] = useState<DraftSubnet[]>([]);
  const [touched, setTouched] = useState(false);
  const [nat, setNat] = useState(true);
  const [mtu, setMtu] = useState<'1450' | '9000'>('1450');
  const [selected, setSelected] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useDefaultProject(projectId, setProjectId);
  const allowance = allowances.find((a) => a.projectId === projectId);
  const projectNets = networks.filter((n) => n.projectId === projectId);
  const allTaken = networks.map((n) => n.cidr);

  // initial CIDR suggestion avoiding every visible network (keeps peering possible)
  useEffect(() => { if (!cidr && !netsLoading) setCidr(suggestVpcCidr(allTaken)) }, [netsLoading, networks.length]); // eslint-disable-line
  const cidrErr = cidr ? vpcCidrProblem(cidr, projectNets) : null;
  const cidrOk = !!cidr && !cidrErr;
  // auto-plan subnets until the user edits them
  useEffect(() => { if (!touched && cidrOk) setSubnets(plan(cidr, name, PLANS.twoTier)) }, [cidr, cidrOk]); // eslint-disable-line
  useEffect(() => { if (!touched) setSubnets((s) => s.map((x) => ({ ...x, name: x.name.replace(/^.*?-(public|private|app|data|k8s)$/, `${name || 'vpc'}-$1`) }))) }, [name]); // eslint-disable-line

  const subnetErrs = subnets.map((s, i) => subnetCidrProblem(cidr, s.cidr, subnets.filter((_, j) => j < i)) ?? (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(s.name) ? 'Invalid name' : null) ?? errors[`subnets.${i}`] ?? null);
  const overlapWarn = networks.filter((n) => n.projectId !== projectId && cidrOk && parseCidr(n.cidr) && (parseCidr(n.cidr)!.first <= parseCidr(cidr)!.last && parseCidr(cidr)!.first <= parseCidr(n.cidr)!.last));

  const updateSub = (k: number, patch: Partial<DraftSubnet>) => { setTouched(true); setSubnets((s) => s.map((x) => (x.key === k ? { ...x, ...patch } : x))) };
  const addSub = (c?: string | null, pub = false) => {
    const v = parseCidr(cidr);
    const cc = c ?? (v ? nextFreeSubnet(cidr, subnets.map((s) => s.cidr), v.prefix <= 22 ? 24 : v.prefix + 2) : null);
    if (!cc) { toast.info('No free space left in this VPC'); return }
    setTouched(true);
    const k = ++key;
    setSubnets((s) => [...s, { key: k, name: `${name || 'vpc'}-subnet-${s.length + 1}`, cidr: cc, public: pub }]);
    setSelected(String(k));
  };

  const cost = breakdown([
    { label: 'VPC, router & DHCP', amount: 0, hint: 'included' },
    { label: 'NAT gateway (HA pair)', amount: nat ? PRICING.natGatewayPerMonth : 0, hint: nat ? undefined : 'disabled' },
  ]);

  const body = {
    name, projectId, locationId, cidr, natGateway: nat, mtu: Number(mtu), description: description || undefined, tags,
    subnets: subnets.map((s) => ({ name: s.name, cidr: s.cidr, public: s.public })),
  };

  const create = useApiMutation(() => { setErrors({}); setFormError(null); return api.create<Network>('networks', body) }, {
    silent: true,
    onSuccess: (n) => { toast.success(`Creating ${n.name}`, 'Provisioning the VXLAN segment and router.'); navigate(`/infrastructure/networks/${n.id}`) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); setFormError(e.message); window.scrollTo({ top: 0, behavior: 'smooth' }) },
  });

  const nameErr = name && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name) ? 'Lowercase letters, digits and dashes' : undefined;
  const canSubmit = !!name && !nameErr && !!projectId && cidrOk && subnets.length > 0 && subnetErrs.every((e) => !e);
  const v = parseCidr(cidr);
  const prefixPick = (p: number) => setCidr(suggestVpcCidr(allTaken, p));
  const requiredTags = !!allowance?.requiredTags.length;

  /* ---------------------------------------------------------------- building blocks */
  const nameField = (
    <Field label="Name" required error={nameErr ?? errors.name} hint={pro ? 'e.g. vpc-shop, vpc-staging' : undefined}>
      <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="vpc-shop" invalid={!!(nameErr ?? errors.name)} autoFocus />
    </Field>
  );
  const projectField = <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />;
  const descField = <Field label="Description" optional><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What lives in this network?" /></Field>;
  const tagsField = (
    <Field label="Tags" error={errors.tags} hint={requiredTags ? `Project policy requires: ${allowance!.requiredTags.join(', ')}` : undefined}>
      <TagEditor value={tags} onChange={setTags} required={allowance?.requiredTags} />
    </Field>
  );
  const locationBlock = (
    <>
      <LocationCards value={locationId} onChange={setLocationId} filter={(l) => !allowance || allowance.allowedLocations.includes(l.id) || l.id === locationId} />
      {errors.locationId && <p className="text-xs text-rose-500">{errors.locationId}</p>}
    </>
  );
  const cidrInput = (
    <Field label={pro ? 'IPv4 CIDR' : 'IP range'} required error={cidrErr ?? errors.cidr} hint={cidrOk && v ? `${cidrRange(cidr)} · ${num(v.size)} addresses` : undefined}
      action={pro ? undefined : <Button size="xs" variant="ghost" icon={Wand2} onClick={() => prefixPick(v?.prefix ?? 16)}>Suggest a free range</Button>}>
      <Input mono value={cidr} onChange={(e) => setCidr(e.target.value.trim())} placeholder="10.60.0.0/16" invalid={!!(cidrErr ?? errors.cidr)}
        suffix={cidrOk ? '✓ valid' : undefined} />
    </Field>
  );
  const existingRanges = networks.length > 0 && (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="text-muted">Existing:</span>
      {networks.map((n) => {
        const clash = cidrOk && parseCidr(n.cidr) && parseCidr(cidr) && parseCidr(n.cidr)!.first <= parseCidr(cidr)!.last && parseCidr(cidr)!.first <= parseCidr(n.cidr)!.last;
        return (
          <span key={n.id} className={cn('flex items-center gap-1 rounded-md border px-1.5 py-0.5', clash ? (n.projectId === projectId ? 'border-rose-500/40 bg-rose-500/5 text-rose-600 dark:text-rose-400' : 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400') : 'border-line text-muted')}>
            {clash ? <AlertCircle className="size-3" /> : <CheckCircle2 className="size-3 text-emerald-500" />}
            {n.name} <span className="font-mono">{n.cidr}</span>
          </span>
        );
      })}
    </div>
  );
  const overlapHint = overlapWarn.length > 0 && <Hint tone="warning">Overlaps {overlapWarn.map((n) => n.name).join(', ')} in another project — allowed, but these networks could never be peered.</Hint>;
  const planButtons = (
    <div className="flex flex-wrap gap-1">
      {(['single', 'twoTier', 'threeTier', 'k8s'] as const).map((p) => (
        <Button key={p} size="xs" variant="ghost" icon={p === 'twoTier' ? Wand2 : undefined} disabled={!cidrOk} onClick={() => { setSubnets(plan(cidr, name, PLANS[p])); setTouched(true) }}>
          {{ single: '1 subnet', twoTier: '2-tier', threeTier: '3-tier', k8s: '+ k8s /20' }[p]}
        </Button>
      ))}
    </div>
  );
  const addressSpace = (
    <AddressSpace
      cidr={cidrOk ? cidr : ''}
      blocks={subnets.map((s, i) => ({ id: String(s.key), name: s.name, cidr: s.cidr, public: s.public, color: subnetColor(i), invalid: !!subnetErrs[i] }))}
      selectedId={selected}
      onSelect={setSelected}
      onGapClick={(c) => addSub(c)}
    />
  );
  const subnetRows = (
    <div className="space-y-2">
      {subnets.map((s, i) => {
        const err = subnetErrs[i];
        const p = parseCidr(s.cidr);
        return (
          <div key={s.key} onClick={() => setSelected(String(s.key))}
            className={cn('flex flex-wrap items-start gap-2 rounded-xl border bg-surface-2/40 p-2.5 transition-colors', pro && selected === String(s.key) ? 'border-brand-500/60' : 'border-line')}>
            <span className="mt-2.5 size-3 shrink-0 rounded-sm" style={{ background: subnetColor(i) }} />
            <div className="min-w-[140px] flex-1"><Input value={s.name} onChange={(e) => updateSub(s.key, { name: e.target.value.toLowerCase() })} placeholder="subnet name" aria-label="Subnet name" /></div>
            <div className="w-40 min-w-[130px]"><Input mono value={s.cidr} onChange={(e) => updateSub(s.key, { cidr: e.target.value.trim() })} invalid={!!err} aria-label="Subnet CIDR" /></div>
            <Segmented size="sm" className="mt-1" value={s.public ? 'public' : 'private'} onChange={(x) => updateSub(s.key, { public: x === 'public' })}
              options={[{ value: 'public', label: 'Public', icon: <Globe2 className="size-3" /> }, { value: 'private', label: 'Private', icon: <Lock className="size-3" /> }]} />
            {pro && <span className="mt-2 w-24 text-right text-[11px] tabular text-muted">{p && !err ? `${num(usableHosts(s.cidr))} hosts` : ''}</span>}
            <button type="button" onClick={(e) => { e.stopPropagation(); setTouched(true); setSubnets((x) => x.filter((y) => y.key !== s.key)) }} className="mt-1.5 rounded-md p-1 text-faint hover:bg-rose-500/10 hover:text-rose-500" aria-label="Remove subnet"><X className="size-4" /></button>
            {err && <p className="basis-full pl-5 text-xs text-rose-600 dark:text-rose-400">{err}</p>}
          </div>
        );
      })}
      <button type="button" disabled={!cidrOk} onClick={() => addSub()} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong text-[13px] font-medium text-muted hover:border-brand-500 hover:text-brand-500 disabled:opacity-50">
        <Plus className="size-4" /> Add subnet {pro && <span className="text-faint">(next free block)</span>}
      </button>
    </div>
  );
  const natBlock = (
    <>
      <Switch checked={nat} onChange={setNat} label="NAT gateway" description={`Lets private subnets reach the internet (updates, registries) without public IPs. HA pair, €${PRICING.natGatewayPerMonth}/mo.`} />
      {!nat && subnets.some((s) => !s.public) && <Hint tone="warning">Private subnets will have no internet egress without a NAT gateway.</Hint>}
    </>
  );
  const mtuBlock = (
    <Field label="MTU" hint="Jumbo frames speed up GPU / storage traffic but every host on the path must support them.">
      <Segmented value={mtu} onChange={setMtu} options={[{ value: '1450', label: 'Standard 1450' }, { value: '9000', label: 'Jumbo 9000', icon: <Sparkles className="size-3.5" /> }]} />
    </Field>
  );

  return (
    <Page wide>
      <PageHeader title="Create network" description={pro ? 'A private, isolated VPC. Plan the address space, carve subnets, and decide how traffic leaves it.' : 'A private network for your servers. The defaults work for most setups.'} icon={NetworkIcon} iconColor="#10b981"
        crumbs={[{ label: 'Networks', to: '/infrastructure/networks' }, { label: 'Create' }]} />
      {formError && <Hint tone="danger" className="mb-5">{formError}</Hint>}
      <CreateLayout needsProject="network" aside={<>
        <CostPanel cost={cost} projectId={projectId} footer={
          <div className="space-y-2">
            <Button variant="primary" size="lg" className="w-full" icon={Rocket} loading={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()}>Create network</Button>
            {!canSubmit && <p className="text-center text-[11px] text-muted">{!name ? 'Enter a name' : nameErr ? nameErr : !cidrOk ? 'Fix the IP range' : !subnets.length ? 'Add at least one subnet' : 'Fix the subnets'}</p>}
          </div>
        }>
          <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs text-muted">
            <div className="flex justify-between"><span>Range</span><span className="font-mono text-fg-2">{cidrOk ? cidr : '—'}</span></div>
            <Pro><div className="flex justify-between"><span>Addresses</span><span className="text-fg-2">{v && cidrOk ? num(v.size) : '—'}</span></div></Pro>
            <div className="flex justify-between"><span>Subnets</span><span className="text-fg-2">{subnets.filter((s) => s.public).length} public · {subnets.filter((s) => !s.public).length} private</span></div>
            <div className="flex justify-between"><span>{pro ? 'Egress' : 'Internet access'}</span><span className="text-fg-2">{pro ? (nat ? 'IGW + NAT' : 'IGW only') : nat ? 'all subnets' : 'public subnets only'}</span></div>
            <Pro><div className="flex justify-between"><span>MTU</span><span className="text-fg-2">{mtu}{mtu === '9000' ? ' (jumbo)' : ''}</span></div></Pro>
          </div>
        </CostPanel>
        <Pro>
          <details className="group rounded-xl border border-line bg-surface p-4 shadow-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-fg"><FileCode2 className="size-4 text-muted" /> Infrastructure as code<span className="ml-auto text-xs text-muted group-open:hidden">show</span></summary>
            <IacTabs className="mt-3" snippets={{ terraform: toHcl('network', name || 'my_vpc', body), cli: toCli('network create', body), curl: toCurl('POST', '/networks', body) }} />
          </details>
        </Pro>
      </>}>
        {pro ? (
          <>
            <FormSection step={1} title="Basics" description="Name, project and tags.">
              <div className="grid gap-4 @min-[36rem]:grid-cols-2">{nameField}{projectField}</div>
              {descField}
              {tagsField}
            </FormSection>

            <FormSection step={2} title="Location" description="A VPC lives in one location. Connect VPCs across locations with site-to-site VPN.">
              {locationBlock}
            </FormSection>

            <FormSection step={3} title="Address space" description="A private RFC 1918 range between /16 and /24. It must not overlap other networks in the project — keep ranges unique account-wide if you plan to peer.">
              <div className="grid gap-4 @min-[36rem]:grid-cols-[1fr_auto]">
                {cidrInput}
                <Field label="Suggest a free range">
                  <Segmented value={String(v?.prefix ?? 16) as any} onChange={(p) => prefixPick(Number(p))} options={[{ value: '16', label: '/16' }, { value: '20', label: '/20' }, { value: '24', label: '/24' }]} />
                </Field>
              </div>
              {existingRanges}
              {overlapHint}
            </FormSection>

            <FormSection step={4} title="Subnets" description="Carve the VPC into subnets. Public subnets route via the internet gateway; private ones egress via NAT." aside={planButtons}>
              {errors.subnets && <Hint tone="danger">{errors.subnets}</Hint>}
              {addressSpace}
              {subnetRows}
            </FormSection>

            <FormSection step={5} title="Gateways & performance">
              {natBlock}
              {mtuBlock}
            </FormSection>
          </>
        ) : (
          <>
            <FormSection step={1} title="Name & location">
              {nameField}
              {requiredTags && tagsField}
              {locationBlock}
            </FormSection>

            <FormSection step={2} title="IP range & subnets" description="Public subnets are reachable from the internet; private ones are not.">
              {cidrInput}
              {overlapHint}
              {errors.subnets && <Hint tone="danger">{errors.subnets}</Hint>}
              {subnetRows}
            </FormSection>

            <Advanced description="Project, description, subnet planner, NAT gateway, MTU">
              <div className="grid gap-4 @min-[36rem]:grid-cols-2">{projectField}<div className="hidden @min-[36rem]:block" /></div>
              {descField}
              {!requiredTags && tagsField}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-fg-2">Subnet planner</span>
                  {planButtons}
                </div>
                {addressSpace}
                {existingRanges}
              </div>
              {natBlock}
              {mtuBlock}
            </Advanced>
          </>
        )}
      </CreateLayout>
    </Page>
  );
}
