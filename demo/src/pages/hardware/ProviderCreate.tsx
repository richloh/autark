import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Cloud, ArrowLeft, ArrowRight, PlugZap, Eye, EyeOff, ShieldCheck, MapPin, Gauge as GaugeIcon, ClipboardCheck, ExternalLink, KeyRound, Check, Plus } from 'lucide-react';
import { useGet, useApiMutation, useItem, useOperationsFor } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, KeyValue } from '@/components/ui/Card';
import { Field, Input, NumberInput, Checkbox, TagEditor, Hint } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { Badge } from '@/components/ui/Badge';
import { CodeBlock, IacTabs, toCli, toHcl, toCurl } from '@/components/ui/CodeBlock';
import { Skeleton } from '@/components/ui/misc';
import { OperationRunner } from '@/components/resource/OperationRunner';
import { Advanced, Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import { toast } from '@/components/ui/toast';
import { ProviderLogo, RegionMap } from '@/components/hardware/providers';
import { StepIndicator, flag } from '@/components/hardware/visuals';
import { cn } from '@/lib/cn';
import type { CloudProvider, ProviderCatalogEntry, ProviderKind, Tag } from '@/types';

const STEPS = [
  { label: 'Provider', description: 'Which cloud' },
  { label: 'Credentials', description: 'API access' },
  { label: 'Regions', description: 'Where to burst' },
  { label: 'Quotas & policy', description: 'Guardrails' },
  { label: 'Review', description: 'Connect & test' },
];
/** Simple mode: quotas & policy fold into the Regions step (as an Advanced section). */
const SIMPLE_STEPS = [STEPS[0], STEPS[1], STEPS[2], STEPS[4]];

const SERVICES: { id: 'vm' | 'volume' | 'network' | 'ip'; label: string; description: string }[] = [
  { id: 'vm', label: 'Virtual machines', description: 'Required — the core burst primitive' },
  { id: 'volume', label: 'Block volumes', description: 'Persistent disks attached to cloud VMs' },
  { id: 'network', label: 'Private networks', description: 'VPC / private network per project' },
  { id: 'ip', label: 'Public IPs', description: 'Floating / elastic IPv4 addresses' },
];

const POLICY_HINT: Partial<Record<ProviderKind, string>> = {
  aws: `{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["ec2:*Instance*", "ec2:*Volume*", "ec2:*Vpc*", "ec2:*Subnet*",
               "ec2:*SecurityGroup*", "ec2:*Address*", "ec2:Describe*", "ec2:CreateTags"],
    "Resource": "*",
    "Condition": { "StringEquals": { "aws:RequestTag/managed-by": "autark" } }
  }]
}`,
  hetzner: '# Create a project-scoped token with "Read & Write" permission.\n# Autark tags every resource with label managed-by=autark and never\n# touches servers it did not create.',
  openstack: 'openstack application credential create autark \\\n  --role member --restricted \\\n  --description "Autark burst capacity"',
};

export default function ProviderCreate() {
  const [sp] = useSearchParams();
  const pro = usePro();
  const { data: catalog, isLoading } = useGet<{ items: ProviderCatalogEntry[] }>(['providers', 'catalog'], '/providers/catalog');
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<ProviderKind | null>((sp.get('kind') as ProviderKind) ?? null);
  const [name, setName] = useState('');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [regions, setRegions] = useState<string[]>([]);
  const [quotas, setQuotas] = useState({ vcpus: 0, ramGB: 0, vms: 0, ips: 0 });
  const [services, setServices] = useState<('vm' | 'volume' | 'network' | 'ip')[]>(['vm', 'volume', 'network', 'ip']);
  const [tags, setTags] = useState<Tag[]>([{ key: 'tier', value: 'burst' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const cat = catalog?.items.find((c) => c.kind === kind);
  useEffect(() => { if (!pro && step === 3) setStep(2) }, [pro, step]);
  useEffect(() => {
    if (!cat) return;
    setName(cat.label); setCreds({}); setRegions(cat.regions.slice(0, 1).map((r) => r.code)); setQuotas(cat.defaultQuotas);
  }, [cat?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = { kind, name, credentials: creds, regions, quotas, allowedServices: services, tags };
  const masked = Object.fromEntries(Object.entries(creds).map(([k, v]) => [k, cat?.fields.find((f) => f.id === k)?.secret ? '••••••••' : v]));

  const create = useApiMutation(() => api.create<CloudProvider>('providers', body), {
    silent: true,
    onSuccess: (p) => { setCreatedId(p.id); toast.success(`Connecting ${p.name}`, 'Running the connection test…') },
    onError: (e: ApiClientError) => {
      const fe = fieldErrors(e);
      setErrors(fe); setFormError(e.message);
      const keys = Object.keys(fe);
      if (keys.some((k) => k.startsWith('credentials.') || k === 'name')) setStep(1);
      else if (keys.includes('regions')) setStep(2);
      else if (keys.some((k) => k.startsWith('quotas.') || k === 'allowedServices')) setStep(pro ? 3 : 2);
    },
  });

  const credsOk = !!cat && cat.fields.every((f) => f.optional || (creds[f.id] ?? '').trim().length > 0);

  const quotaFields = (
    <>
      <div className="grid gap-4 @min-[36rem]:grid-cols-2 @min-[44rem]:grid-cols-4">
        <Field label="vCPUs" error={errors['quotas.vcpus']}><NumberInput value={quotas.vcpus} onChange={(v) => setQuotas({ ...quotas, vcpus: v })} min={0} max={10000} step={8} /></Field>
        <Field label="RAM" error={errors['quotas.ramGB']}><NumberInput value={quotas.ramGB} onChange={(v) => setQuotas({ ...quotas, ramGB: v })} min={0} max={100000} step={32} unit="GB" /></Field>
        <Field label="VMs" error={errors['quotas.vms']}><NumberInput value={quotas.vms} onChange={(v) => setQuotas({ ...quotas, vms: v })} min={0} max={5000} /></Field>
        <Field label="Public IPs" error={errors['quotas.ips']}><NumberInput value={quotas.ips} onChange={(v) => setQuotas({ ...quotas, ips: v })} min={0} max={5000} /></Field>
      </div>
      <Field label="Allowed services" error={errors.allowedServices} hint="Only portable primitives are ever used.">
        <div className="grid gap-2 @min-[36rem]:grid-cols-2">
          {SERVICES.map((s) => (
            <label key={s.id} className={cn('flex cursor-pointer items-start gap-2.5 rounded-xl border border-line p-3 hover:bg-surface-2/60', s.id === 'vm' && 'cursor-default opacity-90')}>
              <Checkbox checked={services.includes(s.id)} disabled={s.id === 'vm'} onChange={(v) => setServices(v ? [...services, s.id] : services.filter((x) => x !== s.id))} />
              <span><span className="block text-sm font-medium text-fg">{s.label}</span><span className="text-xs text-muted">{s.description}</span></span>
            </label>
          ))}
        </div>
      </Field>
      <Field label="Tags" optional><TagEditor value={tags} onChange={setTags} suggestions={['tier', 'owner', 'cost-center']} /></Field>
    </>
  );

  if (createdId) return <Connecting id={createdId} onAnother={() => { setCreatedId(null); setKind(null); setStep(0); setFormError(null); setErrors({}) }} />;

  return (
    <Page wide>
      <PageHeader title="Connect cloud provider" description={pro ? 'Add burst capacity from a public cloud. Each enabled region becomes a location your projects can deploy to (subject to their allowances).' : 'Add extra capacity from a public cloud. Each region becomes a location you can deploy to.'} icon={Cloud} iconColor="#0ea5e9"
        crumbs={[{ label: 'Cloud Providers', to: '/hardware/cloud-providers' }, { label: 'Connect' }]} />
      {pro
        ? <StepIndicator steps={STEPS} current={step} onStep={setStep} className="mb-5" />
        : <StepIndicator steps={SIMPLE_STEPS} current={step >= 3 ? 3 : step} onStep={(i) => setStep(i >= 3 ? 4 : i)} className="mb-5" />}
      {formError && <Hint tone="danger" className="mb-5">{formError}</Hint>}

      <div className="grid items-start gap-6 @min-[56rem]:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {step === 0 && (
            <Card>
              <CardHeader icon={Cloud} title="Choose a provider" description="Autark treats every cloud as an interchangeable VM pool — no provider-specific managed services." />
              <div className="grid gap-3 p-5 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-3">
                {isLoading || !catalog ? [1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />) : catalog.items.map((c) => (
                  <button key={c.kind} type="button" onClick={() => setKind(c.kind)}
                    className={cn('group relative flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all', kind === c.kind ? 'border-brand-500 bg-brand-500/[0.05] ring-3 ring-brand-500/15' : 'border-line hover:border-line-strong hover:bg-surface-2/50')}>
                    <div className="flex w-full items-center gap-3">
                      <ProviderLogo kind={c.kind} size={40} />
                      <div className="min-w-0 flex-1"><div className="font-semibold text-fg">{c.label}</div><div className="text-xs text-muted">{c.regions.length} regions · {[...new Set(c.regions.map((r) => r.country))].map(flag).join(' ')}</div></div>
                      {kind === c.kind && <span className="flex size-5 items-center justify-center rounded-full bg-brand-500 text-white"><Check className="size-3" strokeWidth={3} /></span>}
                    </div>
                    <p className="text-xs leading-relaxed text-muted">{c.description}</p>
                  </button>
                ))}
              </div>
              <Nav onNext={() => setStep(1)} nextDisabled={!cat} />
            </Card>
          )}

          {step === 1 && cat && (
            <Card>
              <CardHeader icon={KeyRound} title={`${cat.label} credentials`} description="Secrets are encrypted in the control-plane vault. The API only ever returns a masked fingerprint." />
              <div className="space-y-4 p-5">
                <Field label="Display name" required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
                {cat.fields.map((f) => (
                  <Field key={f.id} label={f.label} required={!f.optional} optional={f.optional} hint={f.hint} error={errors[`credentials.${f.id}`]}>
                    <div className="relative">
                      <Input mono type={f.secret && !show[f.id] ? 'password' : 'text'} value={creds[f.id] ?? ''} placeholder={f.placeholder} invalid={!!errors[`credentials.${f.id}`]}
                        onChange={(e) => setCreds({ ...creds, [f.id]: e.target.value })} className={f.secret ? 'pr-10' : undefined} autoComplete="off" />
                      {f.secret && (
                        <button type="button" onClick={() => setShow({ ...show, [f.id]: !show[f.id] })} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-fg" aria-label={show[f.id] ? 'Hide' : 'Show'}>
                          {show[f.id] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      )}
                    </div>
                  </Field>
                ))}
                {POLICY_HINT[cat.kind] && (
                  <details className="group rounded-xl border border-line bg-surface-2/40 p-3">
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-medium text-fg"><ShieldCheck className="size-4 text-emerald-500" />Least-privilege setup<span className="ml-auto text-xs text-muted group-open:hidden">show</span></summary>
                    <CodeBlock className="mt-3" code={POLICY_HINT[cat.kind]!} language={cat.kind === 'aws' ? 'json' : 'bash'} />
                  </details>
                )}
                <Pro><p className="text-xs text-muted">Demo tip: any value containing <code className="font-mono text-fg-2">invalid</code> makes the connection test fail at authentication.</p></Pro>
              </div>
              <Nav onBack={() => setStep(0)} onNext={() => setStep(2)} nextDisabled={!credsOk || !name.trim()} />
            </Card>
          )}

          {step === 2 && cat && (
            <Card>
              <CardHeader icon={MapPin} title="Regions" description={pro ? 'Each enabled region becomes a location (e.g. hetzner-nbg1). Pick regions close to your users or your own data centers.' : 'Pick the regions you want to use.'} />
              <div className="space-y-4 p-5">
                <RegionMap regions={cat.regions.map((r) => ({ ...r, selected: regions.includes(r.code) }))} onToggle={(c) => setRegions((rs) => (rs.includes(c) ? rs.filter((x) => x !== c) : [...rs, c]))} height={240} />
                <div className="grid gap-2 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-3">
                  {cat.regions.map((r) => {
                    const on = regions.includes(r.code);
                    return (
                      <button key={r.code} type="button" onClick={() => setRegions((rs) => (on ? rs.filter((x) => x !== r.code) : [...rs, r.code]))}
                        className={cn('flex items-center gap-3 rounded-xl border p-3 text-left transition-all', on ? 'border-brand-500 bg-brand-500/[0.05]' : 'border-line hover:bg-surface-2/60')}>
                        <span className="text-2xl leading-none">{flag(r.country)}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-fg">{r.city}</span><span className="font-mono text-[11px] text-muted">{r.code}</span></span>
                        <Checkbox checked={on} onChange={() => setRegions((rs) => (on ? rs.filter((x) => x !== r.code) : [...rs, r.code]))} />
                      </button>
                    );
                  })}
                </div>
                {errors.regions && <p className="text-xs text-rose-500">{errors.regions}</p>}
                {!pro && (
                  <Advanced title="Quotas & policy" description={`Limits: ${quotas.vcpus} vCPU · ${quotas.ramGB} GB · ${quotas.vms} VMs · ${quotas.ips} IPs`}>
                    {quotaFields}
                  </Advanced>
                )}
              </div>
              <Nav onBack={() => setStep(1)} onNext={() => setStep(pro ? 3 : 4)} nextDisabled={!regions.length} />
            </Card>
          )}

          {step === 3 && cat && pro && (
            <Card>
              <CardHeader icon={GaugeIcon} title="Quotas & policy" description="Hard limits Autark enforces across all projects for this provider — protects you from runaway cloud bills." />
              <div className="space-y-5 p-5">
                {quotaFields}
              </div>
              <Nav onBack={() => setStep(2)} onNext={() => setStep(4)} />
            </Card>
          )}

          {step === 4 && cat && (
            <Card>
              <CardHeader icon={ClipboardCheck} title="Review & connect" description={pro ? 'Autark authenticates, lists regions, checks quotas, creates and deletes a test network to verify write access.' : 'We test the connection before saving.'} />
              <div className="space-y-5 p-5">
                <div className="flex items-center gap-3"><ProviderLogo kind={cat.kind} size={44} /><div><div className="font-semibold text-fg">{name}</div><div className="text-xs text-muted">{cat.label} · {cat.credentialLabel}</div></div></div>
                <KeyValue cols={2} items={[
                  ['Regions', <span className="flex flex-wrap gap-1">{regions.map((c) => { const r = cat.regions.find((x) => x.code === c); return <Badge key={c}>{flag(r?.country)} {c}</Badge> })}</span>],
                  ['Quotas', `${quotas.vcpus} vCPU · ${quotas.ramGB} GB · ${quotas.vms} VMs · ${quotas.ips} IPs`],
                  ...(pro ? [
                    ['Services', services.join(', ')] as [string, ReactNode],
                    ['Credentials', <span className="font-mono text-xs">{Object.entries(masked).map(([k, v]) => `${k}=${v}`).join('  ')}</span>] as [string, ReactNode],
                  ] : []),
                ]} />
                <IacTabs snippets={{
                  terraform: toHcl('cloud_provider', name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'provider', { ...body, credentials: Object.fromEntries(cat.fields.map((f) => [f.id, `var.${cat.kind}_${f.id}`])) }),
                  cli: toCli('provider connect', { kind, name, regions: regions.join(','), quotas: `${quotas.vcpus}vcpu,${quotas.ramGB}gb` }),
                  curl: toCurl('POST', '/providers', { ...body, credentials: masked }),
                }} />
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-4">
                <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(pro ? 3 : 2)}>Back</Button>
                <Button variant="primary" size="lg" icon={PlugZap} loading={create.isPending} onClick={() => create.mutate()}>Connect & test</Button>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4 @min-[44rem]:sticky @min-[44rem]:top-20">
          <Card className="p-4">
            <div className="mb-3 text-sm font-semibold text-fg">Summary</div>
            {cat ? (
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2"><ProviderLogo kind={cat.kind} size={28} /><span className="font-medium text-fg">{name || cat.label}</span></div>
                <Row k="Credentials" v={credsOk ? <span className="text-emerald-600 dark:text-emerald-400">provided</span> : <span className="text-muted">missing</span>} />
                <Row k="Regions" v={regions.length ? regions.join(', ') : '—'} />
                <Row k="vCPU quota" v={quotas.vcpus} />
                <Row k="RAM quota" v={`${quotas.ramGB} GB`} />
                {pro && <Row k="New locations" v={regions.map((r) => `${cat.kind}-${r.toLowerCase()}`).join(', ') || '—'} />}
              </div>
            ) : <p className="text-xs text-muted">Pick a provider to start.</p>}
          </Card>
          <Pro>
          <Card className="p-4 text-xs leading-relaxed text-muted">
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-fg"><ShieldCheck className="size-4 text-emerald-500" />Portable by design</div>
            Autark creates only VMs, volumes, networks and IPs, tagged <code className="font-mono text-fg-2">managed-by=autark</code>. Projects opt into cloud locations through their allowances; cloud capacity is billed with a markup in cost reports so the trade-off stays visible.
          </Card>
          </Pro>
        </div>
      </div>
    </Page>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return <div className="flex justify-between gap-3"><span className="text-muted">{k}</span><span className="truncate text-right text-fg-2">{v}</span></div>;
}

function Nav({ onBack, onNext, nextDisabled }: { onBack?: () => void; onNext: () => void; nextDisabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-4">
      {onBack ? <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>Back</Button> : <span />}
      <Button variant="primary" iconRight={ArrowRight} disabled={nextDisabled} onClick={onNext}>Continue</Button>
    </div>
  );
}

function Connecting({ id, onAnother }: { id: string; onAnother: () => void }) {
  const { data: p } = useItem<CloudProvider>('providers', id);
  const { items: ops } = useOperationsFor(id);
  const op = ops.find((o) => o.type === 'provider.connect') ?? ops[0];
  const pro = usePro();
  const ok = op?.status === 'succeeded';
  const failed = op?.status === 'failed';
  return (
    <Page>
      <PageHeader title={`Connecting ${p?.name ?? ''}`} icon={Cloud} iconColor="#0ea5e9" crumbs={[{ label: 'Cloud Providers', to: '/hardware/cloud-providers' }, { label: 'Connect' }]}
        description="Running the connection test against the provider API." />
      <StepIndicator steps={[...(pro ? STEPS.slice(0, 4) : STEPS.slice(0, 3)), { label: ok ? 'Connected' : failed ? 'Failed' : 'Testing', description: '' }]} current={(pro ? 4 : 3) + (ok ? 1 : 0)} className="mb-5" />
      {ok && <Hint tone="success" className="mb-4"><b>{p?.name}</b> is connected. {p?.regions.length} region(s) are now available as locations: {p?.locations?.map((l) => l.id).join(', ')}.</Hint>}
      {failed && <Hint tone="danger" className="mb-4">{op?.error} The provider was saved in an error state — rotate the credentials on its page to retry.</Hint>}
      {op ? <OperationRunner op={op} /> : <Card className="p-8 text-center text-sm text-muted">Starting…</Card>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button icon={Plus} onClick={onAnother}>Connect another</Button>
        <Button variant="primary" icon={failed ? KeyRound : ExternalLink} to={`/hardware/cloud-providers/${id}${failed ? '?tab=credentials' : ''}`}>{failed ? 'Fix credentials' : 'Open provider'}</Button>
      </div>
    </Page>
  );
}
