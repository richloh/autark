import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Shield, Copy, Trash2, Save, Undo2, Plug, Unplug, Settings2, FlaskConical, ListChecks, ShieldCheck } from 'lucide-react';
import { useItem, useList, useLookup, useApiMutation } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Tabs, useTabParam, Segmented } from '@/components/ui/Tabs';
import { Modal } from '@/components/ui/Modal';
import { Field, Input, TagEditor, Hint, Switch } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { Mono, EmptyState, Skeleton } from '@/components/ui/misc';
import { IacTabs, toHcl, toCli, toCurl } from '@/components/ui/CodeBlock';
import { toast } from '@/components/ui/toast';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { ResourceLink, KindIcon } from '@/components/resource/ResourceLink';
import { timeAgo } from '@/lib/format';
import { KINDS } from '@/lib/kinds';
import { cn } from '@/lib/cn';
import { RuleEditor, ExposureSummary } from '@/components/network/RuleEditor';
import { PacketTester } from '@/components/network/PacketTester';
import { AttachmentPicker, useAttachables } from '@/components/network/AttachmentPicker';
import { deleteFirewalls } from '@/components/network/firewallActions';
import { exposureOf, ruleProblems, normalizeSource } from '@/components/network/util';
import { SimpleRuleList } from '@/components/network/SimpleRules';
import { Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import type { Firewall, FirewallRule, Network, Project, Ref, VM, DbInstance, LoadBalancer, K8sCluster } from '@/types';

const same = (a: FirewallRule[], b: FirewallRule[]) => JSON.stringify(a.map((r) => ({ ...r, source: normalizeSource(r.source) }))) === JSON.stringify(b);

export default function FirewallDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const pro = usePro();
  const { data: fw, isLoading, error } = useItem<Firewall>('firewalls', id);
  const { items: networks } = useList<Network>('networks');
  const { map: projects } = useLookup<Project>('projects');
  const { map: vms } = useLookup<VM>('vms');
  const { map: dbs } = useLookup<DbInstance>('dbInstances');
  const { map: lbs } = useLookup<LoadBalancer>('loadBalancers');
  const { map: k8s } = useLookup<K8sCluster>('k8sClusters');
  const [tab, setTab] = useTabParam('rules');
  const [draft, setDraft] = useState<FirewallRule[]>([]);
  const [defIn, setDefIn] = useState<'allow' | 'deny'>('deny');
  const [defOut, setDefOut] = useState<'allow' | 'deny'>('allow');
  const [serverErrs, setServerErrs] = useState<Record<string, string>>({});
  const [highlight, setHighlight] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [testDraft, setTestDraft] = useState(true);

  const dirty = !!fw && (!same(draft, fw.rules) || defIn !== fw.defaultInbound || defOut !== fw.defaultOutbound);
  useEffect(() => { if (fw && !dirty) { setDraft(fw.rules); setDefIn(fw.defaultInbound); setDefOut(fw.defaultOutbound) } }, [fw?.rules, fw?.defaultInbound, fw?.defaultOutbound]); // eslint-disable-line
  useEffect(() => { if (fw) { setDraft(fw.rules); setDefIn(fw.defaultInbound); setDefOut(fw.defaultOutbound) } }, [fw?.id]); // eslint-disable-line

  const localErrs = useMemo(() => ruleProblems(draft), [draft]);
  const save = useApiMutation(() => api.update<Firewall>('firewalls', id!, { rules: draft.map((r) => ({ ...r, source: normalizeSource(r.source) })), defaultInbound: defIn, defaultOutbound: defOut }), {
    success: 'Rules saved — applied to all attached resources',
    onSuccess: (f) => { setServerErrs({}); setDraft(f.rules) },
    onError: (e: ApiClientError) => setServerErrs(fieldErrors(e)),
  });
  const detach = useApiMutation((r: Ref) => api.action('firewalls', id!, 'detach', r), { success: 'Detached' });

  if (isLoading) return <Page><Skeleton className="mb-4 h-10 w-72" /><Skeleton className="h-64" /></Page>;
  if (error || !fw) return <Page><EmptyState icon={Shield} title="Firewall not found" action={<Button to="/infrastructure/firewalls">Back to firewalls</Button>} /></Page>;

  const proj = projects.get(fw.projectId);
  const vpc = networks.find((n) => n.projectId === fw.projectId);
  const exposure = exposureOf(draft, defIn);
  const resolve = (r: Ref) => {
    const row: any = r.type === 'vm' ? vms.get(r.id) : r.type === 'db' ? dbs.get(r.id) : r.type === 'lb' ? lbs.get(r.id) : r.type === 'k8s' ? k8s.get(r.id) : undefined;
    return row as { name: string; status: string; privateIp?: string; engine?: string; type?: string; version?: string } | undefined;
  };
  const focusRule = (rid: string) => { setTab('rules'); setHighlight(rid); setTimeout(() => setHighlight(null), 2500) };
  const duplicate = async () => {
    try { const c = await api.action<Firewall>('firewalls', fw.id, 'duplicate', {}); toast.success(`Created ${c.name}`); navigate(`/infrastructure/firewalls/${c.id}`) } catch (e) { toast.error('Duplicate failed', (e as Error).message) }
  };

  const saveBar = dirty && (
    <div className="sticky top-16 z-20 mb-4 flex animate-in flex-wrap items-center gap-3 rounded-xl border border-brand-500/30 bg-surface/95 px-4 py-2.5 shadow-pop backdrop-blur">
      <span className="size-2 animate-pulse-soft rounded-full bg-brand-500" />
      <span className="text-[13px] font-medium text-fg">Unsaved rule changes</span>
      {Object.keys(localErrs).length > 0 && <Badge tone="danger">{Object.keys(localErrs).length} problem(s)</Badge>}
      <div className="ml-auto flex gap-2">
        <Button size="sm" variant="ghost" icon={Undo2} onClick={() => { setDraft(fw.rules); setDefIn(fw.defaultInbound); setDefOut(fw.defaultOutbound); setServerErrs({}) }}>Discard</Button>
        <Button size="sm" variant="primary" icon={Save} loading={save.isPending} disabled={Object.keys(localErrs).length > 0} onClick={() => save.mutate()}>Save & apply</Button>
      </div>
    </div>
  );

  return (
    <Page wide>
      <PageHeader title={fw.name} icon={Shield} iconColor="#f97316" description={fw.description}
        crumbs={[{ label: 'Firewalls', to: '/infrastructure/firewalls' }, { label: fw.name }]}
        status={pro && exposure.some((e) => e.level === 'critical') ? <Badge tone="danger">exposed</Badge> : <StatusPill status="active" />}
        meta={<>
          {pro && proj && <span className="flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: proj.color }} />{proj.name}</span>}
          <span>{pro ? `${fw.rules.length} rules` : `${fw.rules.filter((r) => r.direction === 'inbound').length} rules`}</span>
          <span>applied to {fw.attachedTo.length}</span>
          <span>created {timeAgo(fw.createdAt)}</span>
          {pro && <Mono copy className="text-[11px]">{fw.id}</Mono>}
        </>}
        actions={pro ? <>
          <Button icon={FlaskConical} onClick={() => setTab('tester')}>Test packet</Button>
          <Button icon={Copy} onClick={duplicate}>Duplicate</Button>
          <IconButton icon={Trash2} label="Delete firewall" variant="secondary" onClick={async () => { if (await deleteFirewalls([fw])) navigate('/infrastructure/firewalls') }} />
        </> : <Button icon={Plug} onClick={() => setManage(true)}>Apply to resources</Button>}
      />

      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={pro ? [
        { id: 'rules', label: 'Rules', count: draft.length, icon: <ListChecks className="size-3.5" /> },
        { id: 'tester', label: 'Packet tester', icon: <FlaskConical className="size-3.5" /> },
        { id: 'attachments', label: 'Attachments', count: fw.attachedTo.length, icon: <Plug className="size-3.5" /> },
        { id: 'settings', label: 'Settings', icon: <Settings2 className="size-3.5" /> },
        { id: 'activity', label: 'Activity' },
      ] : [
        { id: 'rules', label: 'Rules', count: draft.filter((r) => r.direction === 'inbound').length },
        { id: 'attachments', label: 'Applied to', count: fw.attachedTo.length },
        { id: 'settings', label: 'Settings' },
      ]} />

      {(tab === 'rules' || tab === 'tester') && saveBar}

      {tab === 'rules' && !pro && (
        <div className="space-y-3">
          {serverErrs.rules && <Hint tone="danger">{serverErrs.rules}</Hint>}
          <SimpleRuleList rules={draft} onChange={(r) => { setDraft(r); setServerErrs({}) }} errors={{ ...serverErrs, ...localErrs }} vpcCidr={vpc?.cidr} highlightId={highlight} defaultInbound={defIn} />
        </div>
      )}

      {tab === 'rules' && pro && (
        <div className="grid gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            {serverErrs.rules && <Hint tone="danger">{serverErrs.rules}</Hint>}
            <RuleEditor rules={draft} onChange={(r) => { setDraft(r); setServerErrs({}) }} errors={{ ...serverErrs, ...localErrs }} vpcCidr={vpc?.cidr} highlightId={highlight} />
          </div>
          <div className="space-y-4">
            <Card>
              <CardHeader title="Default policies" description="Applied when no rule matches." />
              <CardBody className="space-y-3">
                <Field label="Inbound"><Segmented value={defIn} onChange={setDefIn} options={[{ value: 'deny', label: 'Deny' }, { value: 'allow', label: 'Allow' }]} /></Field>
                <Field label="Outbound"><Segmented value={defOut} onChange={setDefOut} options={[{ value: 'allow', label: 'Allow' }, { value: 'deny', label: 'Deny' }]} /></Field>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Internet exposure" icon={ShieldCheck} />
              <CardBody><ExposureSummary items={exposure} onFocus={focusRule} /></CardBody>
            </Card>
            <IacTabs snippets={{
              terraform: toHcl('firewall', fw.name.replace(/-/g, '_'), { name: fw.name, default_inbound: defIn, default_outbound: defOut, rules: draft.map((r) => ({ direction: r.direction, protocol: r.protocol, ports: r.ports, source: r.source, action: r.action, priority: r.priority })) }),
              cli: toCli('firewall update', { id: fw.id, rules: `@rules.json` }),
              curl: toCurl('PATCH', `/firewalls/${fw.id}`, { rules: draft.slice(0, 2) }),
            }} />
          </div>
        </div>
      )}

      {tab === 'tester' && (
        <div className="grid gap-5 @min-[60rem]:grid-cols-2">
          <Card>
            <CardHeader title="Packet tester" description="Which rule decides? Rules are checked by priority; the first match wins." icon={FlaskConical}
              actions={dirty ? <Switch size="sm" checked={testDraft} onChange={setTestDraft} label={<span className="text-xs">unsaved rules</span>} /> : undefined} />
            <CardBody>
              <PacketTester firewall={{ ...fw, defaultInbound: defIn, defaultOutbound: defOut }} draftRules={dirty && testDraft ? draft.map((r) => ({ ...r, source: normalizeSource(r.source) })) : undefined}
                onResult={(r) => setHighlight(r?.matchedRuleId ?? null)} vpcSample={vpc ? vpc.cidr.replace(/0\.0\/\d+$/, '1.40').replace(/\.0\/\d+$/, '.40') : undefined} />
            </CardBody>
          </Card>
          <div className="min-w-0">
            <RuleEditor rules={dirty && testDraft ? draft : fw.rules} onChange={() => {}} readOnly highlightId={highlight} lanes={['inbound', 'outbound']} />
          </div>
        </div>
      )}

      {tab === 'attachments' && (
        <Card>
          <CardHeader title={pro ? 'Attached resources' : 'Applied to'} description={pro ? 'Rules apply to every attached resource immediately. A resource with no firewall blocks all inbound traffic.' : 'Rules apply to these resources immediately.'}
            actions={<Button size="sm" variant="primary" icon={Plug} onClick={() => setManage(true)}>{pro ? 'Manage attachments' : 'Choose resources'}</Button>} />
          {fw.attachedTo.length === 0 ? (
            <EmptyState icon={Unplug} title={pro ? 'Not attached' : 'Not applied yet'} description="This firewall has no effect until you apply it to something." action={<Button variant="primary" icon={Plug} onClick={() => setManage(true)}>{pro ? 'Attach resources' : 'Apply to resources'}</Button>} />
          ) : (
            <ul className="divide-y divide-line">
              {fw.attachedTo.map((r) => {
                const row = resolve(r);
                return (
                  <li key={`${r.type}:${r.id}`} className="flex items-center gap-3 px-4 py-2.5">
                    <KindIcon type={r.type} size="sm" />
                    <div className="min-w-0 flex-1">
                      <ResourceLink type={r.type} id={r.id} name={row?.name} />
                      <div className="truncate font-mono text-[11px] text-muted">{KINDS[r.type].label}{pro || row?.privateIp ? ` · ${row?.privateIp ?? row?.engine ?? row?.type ?? (row?.version ? `v${row.version}` : r.id)}` : ''}</div>
                    </div>
                    {row && <StatusPill status={row.status} />}
                    <Button size="xs" variant="ghost" icon={Unplug} loading={detach.isPending && detach.variables?.id === r.id} onClick={() => detach.mutate(r)}>Detach</Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === 'settings' && <FirewallSettings fw={fw} />}
      {tab === 'activity' && <Card><ActivityFeed targetId={fw.id} /></Card>}

      <ManageAttachments fw={fw} open={manage} onClose={() => setManage(false)} />
    </Page>
  );
}

function ManageAttachments({ fw, open, onClose }: { fw: Firewall; open: boolean; onClose: () => void }) {
  const items = useAttachables(fw.projectId);
  const [value, setValue] = useState<Ref[]>(fw.attachedTo);
  useEffect(() => { if (open) setValue(fw.attachedTo) }, [open]); // eslint-disable-line
  const key = (r: Ref) => `${r.type}:${r.id}`;
  const before = new Set(fw.attachedTo.map(key));
  const after = new Set(value.map(key));
  const added = value.filter((r) => !before.has(key(r))).length;
  const removed = fw.attachedTo.filter((r) => !after.has(key(r))).length;
  const go = useApiMutation(() => api.action('firewalls', fw.id, 'setAttachments', { targets: value }), { success: 'Attachments updated', onSuccess: onClose });
  return (
    <Modal open={open} onClose={onClose} size="lg" title={`Attach ${fw.name}`} description="Select every resource this firewall should protect."
      footer={<>
        <span className="mr-auto text-xs text-muted">{added ? <span className="text-emerald-600 dark:text-emerald-400">+{added} </span> : null}{removed ? <span className="text-rose-500">−{removed}</span> : null}{!added && !removed ? 'No changes' : ''}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={go.isPending} disabled={!added && !removed} onClick={() => go.mutate()}>Apply</Button>
      </>}>
      <div className="max-h-[55vh] overflow-y-auto pr-1"><AttachmentPicker items={items} value={value} onChange={setValue} /></div>
    </Modal>
  );
}

function FirewallSettings({ fw }: { fw: Firewall }) {
  const navigate = useNavigate();
  const [name, setName] = useState(fw.name);
  const [description, setDescription] = useState(fw.description);
  const [tags, setTags] = useState(fw.tags);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setName(fw.name); setDescription(fw.description); setTags(fw.tags) }, [fw.id, fw.name]); // eslint-disable-line
  const dirty = name !== fw.name || description !== fw.description || JSON.stringify(tags) !== JSON.stringify(fw.tags);
  const save = useApiMutation(() => api.update('firewalls', fw.id, { name, description, tags }), { success: 'Firewall updated', onSuccess: () => setErrors({}), onError: (e: ApiClientError) => setErrors(fieldErrors(e)) });
  return (
    <div className="grid gap-5 @min-[56rem]:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader title="General" actions={<Button size="sm" variant="primary" icon={Save} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>} />
        <CardBody className="space-y-4">
          <Field label="Name" error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} /></Field>
          <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="Tags" error={errors.tags}><TagEditor value={tags} onChange={setTags} /></Field>
        </CardBody>
      </Card>
      <Card className="border-rose-500/30">
        <CardHeader title="Danger zone" />
        <CardBody className="space-y-3">
          <p className={cn('text-[13px] text-muted')}>{fw.attachedTo.length ? `Attached to ${fw.attachedTo.length} resource(s); deleting detaches it from all of them.` : 'Not attached to anything.'}</p>
          <Button variant="outline-danger" icon={Trash2} onClick={async () => { if (await deleteFirewalls([fw])) navigate('/infrastructure/firewalls') }}>Delete firewall</Button>
        </CardBody>
      </Card>
    </div>
  );
}
