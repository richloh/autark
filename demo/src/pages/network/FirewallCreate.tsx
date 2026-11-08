import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Shield, Rocket, FileCode2, ShieldCheck } from 'lucide-react';
import { useList, useApiMutation } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Field, Input, TagEditor, Hint, Select } from '@/components/ui/form';
import { FormSection, CreateLayout, fieldErrors } from '@/components/ui/FormLayout';
import { Segmented } from '@/components/ui/Tabs';
import { IacTabs, toCli, toHcl, toCurl } from '@/components/ui/CodeBlock';
import { ProjectField } from '@/components/resource/pickers';
import { toast } from '@/components/ui/toast';
import { RuleEditor, ExposureSummary, newRule } from '@/components/network/RuleEditor';
import { AttachmentPicker, useAttachables } from '@/components/network/AttachmentPicker';
import { exposureOf, ruleProblems, normalizeSource } from '@/components/network/util';
import { SimpleRuleList } from '@/components/network/SimpleRules';
import { useDefaultProject } from '@/components/network/useDefaultProject';
import { Advanced, Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import { cn } from '@/lib/cn';
import type { Firewall, FirewallRule, Network, ProjectAllowance, Ref, ResourceKind } from '@/types';

export default function FirewallCreate() {
  const navigate = useNavigate();
  const pro = usePro();
  const [sp] = useSearchParams();
  const { items: networks } = useList<Network>('networks');
  const { items: allowances } = useList<ProjectAllowance>('allowances');
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<{ key: string; value: string }[]>([]);
  const [defaultInbound, setDefaultInbound] = useState<'deny' | 'allow'>('deny');
  const [defaultOutbound, setDefaultOutbound] = useState<'allow' | 'deny'>('allow');
  const [rules, setRules] = useState<FirewallRule[]>(() => [newRule('inbound', [], { protocol: 'tcp', ports: '22', source: '198.51.100.0/24', description: 'SSH from office' })]);
  const [attach, setAttach] = useState<Ref[]>(() => {
    const a = sp.get('attach');
    if (!a) return [];
    const [type, id] = a.split(':');
    return type && id ? [{ type: type as ResourceKind, id }] : [];
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [vpcId, setVpcId] = useState('');

  useDefaultProject(projectId, setProjectId);
  const [template, setTemplate] = useState<string>('');
  const allowance = allowances.find((a) => a.projectId === projectId);
  const projectNets = networks.filter((n) => n.projectId === projectId);
  const vpc = projectNets.find((n) => n.id === vpcId) ?? projectNets[0];
  const attachables = useAttachables(projectId);
  const localErrs = useMemo(() => ruleProblems(rules), [rules]);
  const allErrs = { ...errors, ...localErrs };
  const exposure = exposureOf(rules, defaultInbound);

  const body = {
    name, projectId, description, defaultInbound, defaultOutbound, tags,
    rules: rules.map(({ id: _id, ...r }) => ({ ...r, source: normalizeSource(r.source) })),
    attachTo: attach,
  };
  const create = useApiMutation(() => { setErrors({}); setFormError(null); return api.create<Firewall>('firewalls', body) }, {
    silent: true,
    onSuccess: (f) => { toast.success(`Firewall ${f.name} created`, attach.length ? `Applied to ${attach.length} resource(s).` : undefined); navigate(`/infrastructure/firewalls/${f.id}`) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); setFormError(e.message); window.scrollTo({ top: 0, behavior: 'smooth' }) },
  });
  const nameErr = name && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name) ? 'Lowercase letters, digits and dashes' : undefined;
  const canSubmit = !!name && !nameErr && !!projectId && Object.keys(localErrs).length === 0;
  const requiredTags = !!allowance?.requiredTags.length;
  const TEMPLATES: { id: string; label: string; hint: string; rules: Partial<FirewallRule>[] }[] = [
    { id: 'web', label: 'Web server', hint: 'SSH, HTTP, HTTPS, ping', rules: [
      { protocol: 'tcp', ports: '22', description: 'SSH' }, { protocol: 'tcp', ports: '80,443', description: 'Web' }, { protocol: 'icmp', ports: '*', description: 'Ping' }] },
    { id: 'ssh', label: 'SSH only', hint: 'Remote login', rules: [{ protocol: 'tcp', ports: '22', description: 'SSH' }] },
    { id: 'db', label: 'Private database', hint: 'PostgreSQL & MySQL from your network', rules: [
      { protocol: 'tcp', ports: '5432', source: vpc?.cidr ?? '10.0.0.0/8', description: 'PostgreSQL' }, { protocol: 'tcp', ports: '3306', source: vpc?.cidr ?? '10.0.0.0/8', description: 'MySQL' }] },
    { id: 'empty', label: 'Start empty', hint: 'Block all incoming', rules: [] },
  ];
  const applyTemplate = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id)!;
    let next = rules.filter((r) => r.direction === 'outbound');
    for (const p of t.rules) next = [...next, newRule('inbound', next, { source: '0.0.0.0/0', ...p })];
    setRules(next);
    setTemplate(id);
    setErrors({});
  };

  const tagsField = <Field label="Tags" error={errors.tags} hint={requiredTags ? `Project policy requires: ${allowance!.requiredTags.join(', ')}` : undefined}><TagEditor value={tags} onChange={setTags} required={allowance?.requiredTags} /></Field>;
  const policies = (
    <div className="grid gap-4 @min-[36rem]:grid-cols-2">
      <Field label="Inbound" hint={defaultInbound === 'allow' ? 'Not recommended — everything is open unless denied.' : 'Recommended — only explicitly allowed traffic gets in.'}>
        <Segmented value={defaultInbound} onChange={setDefaultInbound} options={[{ value: 'deny', label: 'Deny' }, { value: 'allow', label: 'Allow' }]} />
      </Field>
      <Field label="Outbound" hint="Allow lets workloads reach updates and APIs.">
        <Segmented value={defaultOutbound} onChange={setDefaultOutbound} options={[{ value: 'allow', label: 'Allow' }, { value: 'deny', label: 'Deny' }]} />
      </Field>
    </div>
  );
  const attachPicker = (
    <>
      {projectId ? <AttachmentPicker items={attachables} value={attach} onChange={setAttach} /> : <p className="text-sm text-muted">Select a project first.</p>}
      {errors.attachTo && <p className="text-xs text-rose-500">{errors.attachTo}</p>}
    </>
  );

  return (
    <Page wide>
      <PageHeader title="Create firewall" description={pro ? 'Group rules once, attach them to many resources. Rules are evaluated by priority — the first match wins.' : 'Choose which incoming traffic is allowed. Everything else is blocked.'} icon={Shield} iconColor="#f97316"
        crumbs={[{ label: 'Firewalls', to: '/infrastructure/firewalls' }, { label: 'Create' }]} />
      {formError && <Hint tone="danger" className="mb-5">{formError}</Hint>}
      <CreateLayout aside={<>
        <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <Pro>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg"><ShieldCheck className="size-4 text-muted" /> Exposure check</div>
            <ExposureSummary items={exposure} />
          </Pro>
          <div className={cn('space-y-1.5 text-xs text-muted', pro && 'mt-4 border-t border-line pt-3')}>
            <div className="flex justify-between"><span>Rules</span><span className="text-fg-2">{pro ? `${rules.filter((r) => r.direction === 'inbound').length} in · ${rules.filter((r) => r.direction === 'outbound').length} out` : `${rules.filter((r) => r.direction === 'inbound').length} inbound`}</span></div>
            <Pro><div className="flex justify-between"><span>Defaults</span><span className="text-fg-2">in: {defaultInbound} · out: {defaultOutbound}</span></div></Pro>
            <div className="flex justify-between"><span>Attached to</span><span className="text-fg-2">{attach.length} resource(s)</span></div>
            <div className="flex justify-between"><span>Price</span><span className="text-emerald-600 dark:text-emerald-400">free</span></div>
          </div>
          <Button variant="primary" size="lg" className="mt-4 w-full" icon={Rocket} loading={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()}>Create firewall</Button>
          {!canSubmit && <p className="mt-2 text-center text-[11px] text-muted">{!name ? 'Enter a name' : nameErr ?? 'Fix the highlighted rules'}</p>}
        </div>
        <Pro>
          <details className="group rounded-xl border border-line bg-surface p-4 shadow-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-fg"><FileCode2 className="size-4 text-muted" /> Infrastructure as code<span className="ml-auto text-xs text-muted group-open:hidden">show</span></summary>
            <IacTabs className="mt-3" snippets={{ terraform: toHcl('firewall', name || 'my_firewall', body), cli: toCli('firewall create', body), curl: toCurl('POST', '/firewalls', body) }} />
          </details>
        </Pro>
      </>}>
        {!pro ? (
          <>
            <FormSection step={1} title="Name">
              <Field label="Name" required error={nameErr ?? errors.name}>
                <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="web-public" invalid={!!(nameErr ?? errors.name)} autoFocus />
              </Field>
              {requiredTags && tagsField}
            </FormSection>

            <FormSection step={2} title="Allowed incoming traffic" description="Start from a template, then adjust.">
              <div className="grid grid-cols-2 gap-2 @min-[44rem]:grid-cols-4">
                {TEMPLATES.map((t) => (
                  <button key={t.id} type="button" onClick={() => applyTemplate(t.id)}
                    className={cn('rounded-xl border p-3 text-left transition-colors', template === t.id ? 'border-brand-500 bg-brand-500/[0.04] ring-3 ring-brand-500/15' : 'border-line hover:border-line-strong')}>
                    <div className="text-[13px] font-medium text-fg">{t.label}</div>
                    <div className="mt-0.5 text-[11px] text-muted">{t.hint}</div>
                  </button>
                ))}
              </div>
              {errors.rules && !Object.keys(localErrs).length && <Hint tone="danger">{errors.rules}</Hint>}
              <SimpleRuleList rules={rules} onChange={(r) => { setRules(r); setErrors({}) }} errors={allErrs} vpcCidr={vpc?.cidr} defaultInbound={defaultInbound} />
            </FormSection>

            <FormSection step={3} title="Apply to" description="Optional — you can do this later.">
              {attachPicker}
            </FormSection>

            <Advanced description="Project, description, default policies, outbound rules">
              <div className="grid gap-4 @min-[36rem]:grid-cols-2">
                <ProjectField value={projectId} onChange={(p) => { setProjectId(p); setAttach((a) => (projectId ? [] : a)) }} error={errors.projectId} />
                <Field label="Description" optional><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Public HTTP(S) for the web tier" /></Field>
              </div>
              {!requiredTags && tagsField}
              {policies}
              <RuleEditor rules={rules} onChange={(r) => { setRules(r); setErrors({}) }} errors={allErrs} vpcCidr={vpc?.cidr} lanes={['outbound']} />
            </Advanced>
          </>
        ) : (<>
        <FormSection step={1} title="Basics">
          <div className="grid gap-4 @min-[36rem]:grid-cols-2">
            <Field label="Name" required error={nameErr ?? errors.name} hint="e.g. web-public, db-internal">
              <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="web-public" invalid={!!(nameErr ?? errors.name)} autoFocus />
            </Field>
            <ProjectField value={projectId} onChange={(p) => { setProjectId(p); setAttach((a) => (projectId ? [] : a)) }} error={errors.projectId} />
          </div>
          <Field label="Description" optional><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Public HTTP(S) for the web tier" /></Field>
          {tagsField}
        </FormSection>

        <FormSection step={2} title="Default policies" description="What happens to traffic no rule matches.">
          {policies}
        </FormSection>

        <FormSection step={3} title="Rules" description="Lower priority numbers are evaluated first. Use presets for common patterns."
          aside={projectNets.length > 1 ? <Select className="w-44" value={vpc?.id ?? ''} onChange={(e) => setVpcId(e.target.value)} options={projectNets.map((n) => ({ value: n.id, label: `Presets for ${n.name}` }))} /> : undefined}>
          {errors.rules && !Object.keys(localErrs).length && <Hint tone="danger">{errors.rules}</Hint>}
          <RuleEditor rules={rules} onChange={(r) => { setRules(r); setErrors({}) }} errors={allErrs} vpcCidr={vpc?.cidr} />
        </FormSection>

        <FormSection step={4} title="Attach to resources" description="Apply now or later from the firewall's page. Rules of all firewalls on a resource are merged.">
          {attachPicker}
        </FormSection>
        </>)}
      </CreateLayout>
    </Page>
  );
}
