import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Cloud, RefreshCw, PlugZap, MoreHorizontal, KeyRound, Power, Trash2, AlertTriangle, MapPin, Server, Gauge as GaugeIcon, Settings, Pencil, Eye, EyeOff, ShieldCheck, Clock, Save, Info } from 'lucide-react';
import { useItem, useGet, useApiMutation, useActiveOperation, useLookup } from '@/api/hooks';
import { api } from '@/api/client';
import { useUi, usePro } from '@/store/ui';
import { Pro } from '@/components/ui/Pro';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardHeader, CardBody, KeyValue } from '@/components/ui/Card';
import { Tabs, useTabParam } from '@/components/ui/Tabs';
import { StatusPill, Badge, Tags } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Menu } from '@/components/ui/Menu';
import { Modal, confirm } from '@/components/ui/Modal';
import { Ring, Mono, Skeleton, EmptyState } from '@/components/ui/misc';
import { Field, Input, NumberInput, Checkbox, TagEditor, Hint } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { IacTabs, toCli, toCurl } from '@/components/ui/CodeBlock';
import { toast } from '@/components/ui/toast';
import { OperationRunner } from '@/components/resource/OperationRunner';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { ProviderLogo, RegionMap, PROVIDER_STYLE } from '@/components/hardware/providers';
import { flag } from '@/components/hardware/visuals';
import { cn } from '@/lib/cn';
import { money, timeAgo, dateTime, num } from '@/lib/format';
import type { CloudProvider, ProviderCatalogEntry, Project } from '@/types';

type Resource = NonNullable<CloudProvider['resources']>[number];

export default function ProviderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: p, isLoading, error } = useItem<CloudProvider>('providers', id);
  const { data: catalog } = useGet<{ items: ProviderCatalogEntry[] }>(['providers', 'catalog'], '/providers/catalog');
  const op = useActiveOperation(id);
  const pro = usePro();
  const [tabParam, setTab] = useTabParam('overview');
  const tab = pro ? tabParam : tabParam === 'credentials' ? 'settings' : ['overview', 'regions', 'settings'].includes(tabParam) ? tabParam : 'overview';
  const [rotateOpen, setRotateOpen] = useState(false);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const run = useApiMutation(({ action, body }: { action: string; body?: unknown }) => api.action('providers', id!, action, body), { silent: true });

  if (isLoading) return <Page><Skeleton className="mb-4 h-12 w-80" /><Skeleton className="h-96 rounded-xl" /></Page>;
  if (error || !p) return <Page><EmptyState icon={Cloud} title="Provider not found" action={<Button to="/hardware/cloud-providers">Back to providers</Button>} /></Page>;

  const cat = catalog?.items.find((c) => c.kind === p.kind);
  const act = async (action: string, success: string, body?: unknown) => {
    try { await run.mutateAsync({ action, body }); toast.success(success); return true } catch (e: any) { toast.error('Request failed', e?.message); return false }
  };
  const remove = async () => {
    const ok = await confirm({ title: `Remove ${p.name}?`, message: 'Its regions disappear as locations. Blocked while any VMs, volumes or networks still exist there. Credentials are deleted from the vault.', danger: true, confirmLabel: 'Remove provider', typeToConfirm: p.name });
    if (!ok) return;
    try { await api.remove('providers', p.id); toast.success(`${p.name} removed`); navigate('/hardware/cloud-providers') } catch (e: any) { toast.error('Cannot remove provider', e?.message) }
  };
  const u = p.usage ?? { vcpus: 0, ramGB: 0, vms: 0, ips: 0, monthlyCost: 0 };
  const rotatedDays = Math.floor((Date.now() - Date.parse(p.credentials.lastRotatedAt)) / 86_400_000);

  return (
    <Page wide>
      <PageHeader
        title={p.name}
        icon={Cloud}
        iconColor={PROVIDER_STYLE[p.kind]?.bg}
        crumbs={[{ label: 'Cloud Providers', to: '/hardware/cloud-providers' }, { label: p.name }]}
        status={<StatusPill status={p.status} />}
        meta={<>
          <span className="flex items-center gap-1.5"><ProviderLogo kind={p.kind} size={16} className="rounded-[4px]" />{cat?.label ?? p.kind}</span>
          <span className="flex items-center gap-1"><MapPin className="size-3" />{p.regions.length} regions</span>
          {pro && <span className="flex items-center gap-1"><Clock className="size-3" />{p.lastSyncAt ? `synced ${timeAgo(p.lastSyncAt)}` : 'never synced'}</span>}
          <span>{money(u.monthlyCost)}/mo</span>
        </>}
        actions={<>
          {pro && <Button icon={RefreshCw} disabled={!!op || p.status === 'disabled'} onClick={() => act('sync', `Syncing ${p.name}`)}>Sync</Button>}
          <Button icon={PlugZap} disabled={!!op} onClick={() => act('testConnection', 'Connection test started')}>Test connection</Button>
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="More" variant="secondary" />} items={[
            ...(pro ? [] : [{ label: 'Sync now', icon: RefreshCw, disabled: !!op || p.status === 'disabled', onClick: () => act('sync', `Syncing ${p.name}`) }]),
            { label: 'Rotate credentials…', icon: KeyRound, disabled: !!op, onClick: () => setRotateOpen(true) },
            { label: 'Edit quotas…', icon: GaugeIcon, onClick: () => setQuotaOpen(true) },
            p.status === 'disabled'
              ? { label: 'Enable provider', icon: Power, onClick: () => act('enable', `Re-enabling ${p.name}`) }
              : { label: 'Disable provider', icon: Power, disabled: !!op, onClick: async () => { if (await confirm({ title: `Disable ${p.name}?`, message: 'No new VMs will be placed in its regions and syncs stop. Existing VMs keep running.', confirmLabel: 'Disable' })) act('disable', `${p.name} disabled`) } },
            { divider: true, label: '' },
            { label: 'Remove provider…', icon: Trash2, danger: true, onClick: remove },
          ]} />
        </>}
      />

      {op && <OperationRunner op={op} className="mb-5" compact />}
      {p.status === 'error' && !op && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-900 dark:text-rose-200">
          <AlertTriangle className="size-4 shrink-0" />
          <div className="min-w-0 flex-1"><b className="font-semibold">Connection failing</b>{p.lastTestAt && <span className="opacity-80"> (checked {timeAgo(p.lastTestAt)})</span>}: {p.lastError}</div>
          <Button size="sm" variant="primary" icon={KeyRound} onClick={() => setRotateOpen(true)}>Rotate credentials</Button>
          <Button size="sm" icon={PlugZap} onClick={() => act('testConnection', 'Retrying connection test')}>Retry</Button>
        </div>
      )}
      {p.status === 'disabled' && !op && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-[13px] text-fg-2">
          <Power className="size-4 shrink-0 text-muted" />
          <div className="min-w-0 flex-1"><b className="font-semibold text-fg">Disabled</b> — no new placements in its regions; {u.vms} existing VM(s) keep running.</div>
          <Button size="sm" icon={Power} onClick={() => act('enable', `Re-enabling ${p.name}`)}>Enable</Button>
        </div>
      )}
      {p.status === 'connected' && rotatedDays > 90 && (
        <Hint tone="warning" className="mb-5">Credentials were last rotated {rotatedDays} days ago. Rotate at least every 90 days. <button type="button" className="font-medium underline" onClick={() => setRotateOpen(true)}>Rotate now</button></Hint>
      )}

      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={!pro ? [
        { id: 'overview', label: 'Overview' },
        { id: 'regions', label: 'Regions', count: p.regions.length },
        { id: 'settings', label: 'Settings', icon: p.status === 'error' ? <span className="size-1.5 rounded-full bg-rose-500" /> : undefined },
      ] : [
        { id: 'overview', label: 'Overview' },
        { id: 'regions', label: 'Regions', count: p.regions.length },
        { id: 'resources', label: 'Resources', count: u.vms },
        { id: 'credentials', label: 'Credentials', icon: p.status === 'error' ? <span className="size-1.5 rounded-full bg-rose-500" /> : undefined },
        { id: 'settings', label: 'Settings' },
        { id: 'activity', label: 'Activity' },
      ]} />

      {tab === 'overview' && (
        <div className="grid gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-5">
            <Card>
              <CardHeader title={pro ? 'Quota usage' : 'Usage'} icon={GaugeIcon} description={pro ? 'Limits enforced by Autark across all projects using this provider.' : 'Against the limits you set.'} actions={<Button size="xs" variant="ghost" icon={Pencil} onClick={() => setQuotaOpen(true)}>Edit</Button>} />
              <div className="grid grid-cols-2 justify-items-center gap-4 p-5 @min-[36rem]:grid-cols-4">
                {([['vCPU', u.vcpus, p.quotas.vcpus], ['RAM', u.ramGB, p.quotas.ramGB, 'GB'], ['VMs', u.vms, p.quotas.vms], ['Public IPs', u.ips, p.quotas.ips]] as [string, number, number, string?][]).map(([l, v, q, unit]) => (
                  <div key={l} className="flex flex-col items-center gap-2">
                    <Ring value={v} max={q || 1} size={84} stroke={8} sublabel={`of ${num(q)}${unit ? ` ${unit}` : ''}`} label={num(v)} />
                    <span className="text-xs font-medium text-muted">{l}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader title="Regions" icon={MapPin} description={`${p.regions.length} of ${p.availableRegions.length} enabled`} actions={<Button size="xs" variant="ghost" onClick={() => setTab('regions')}>Manage</Button>} />
              <div className="p-3"><RegionMap height={230} color={PROVIDER_STYLE[p.kind]?.bg} regions={p.availableRegions.map((r) => ({ ...r, selected: p.regions.includes(r.code), badge: p.locations?.find((l) => l.region === r.code)?.vms || undefined }))} /></div>
            </Card>
          </div>
          <div className="space-y-5">
            <Card className="p-4">
              <div className="mb-4 flex items-center gap-3"><ProviderLogo kind={p.kind} size={48} /><div className="min-w-0"><div className="truncate font-semibold text-fg">{p.name}</div>{pro && <div className="text-xs text-muted">{cat?.description}</div>}</div></div>
              <KeyValue cols={1} items={!pro ? [
                ['Regions', `${p.regions.length} enabled`],
                ['Running VMs', num(u.vms)],
                ['Monthly cost', money(u.monthlyCost)],
                ['Connected since', dateTime(p.createdAt)],
              ] : [
                ['Provider ID', <Mono copy>{p.id}</Mono>],
                ['API endpoint', <Mono>{p.endpoint ?? apiHost(p.kind)}</Mono>],
                ['Allowed services', <span className="flex flex-wrap gap-1">{p.allowedServices.map((s) => <Badge key={s}>{s}</Badge>)}</span>],
                ['Last sync', p.lastSyncAt ? `${timeAgo(p.lastSyncAt)} · ${dateTime(p.lastSyncAt)}` : 'never'],
                ['Connected since', dateTime(p.createdAt)],
                ['Monthly run-rate', money(u.monthlyCost)],
                ['Tags', <Tags tags={p.tags} />],
              ]} />
            </Card>
          </div>
        </div>
      )}

      {tab === 'regions' && <RegionsTab p={p} busy={!!op} act={act} />}
      {tab === 'resources' && <ResourcesTab p={p} />}
      {tab === 'credentials' && (
        <div className="grid gap-5 @min-[44rem]:grid-cols-2">
          <Card>
            <CardHeader title={p.credentials.label} icon={KeyRound} description="Stored encrypted in the control-plane vault. Only masked fingerprints are ever shown." actions={<Button size="sm" variant={p.status === 'error' ? 'primary' : 'secondary'} icon={KeyRound} disabled={!!op} onClick={() => setRotateOpen(true)}>Rotate</Button>} />
            <CardBody>
              <KeyValue cols={1} items={[
                ...Object.entries(p.credentials.fields ?? { key: p.credentials.masked }).map(([k, v]) => [cat?.fields.find((f) => f.id === k)?.label ?? k, <Mono>{v}</Mono>] as [string, React.ReactNode]),
                ['Last rotated', <span className={cn(rotatedDays > 90 && 'text-amber-600 dark:text-amber-400')}>{timeAgo(p.credentials.lastRotatedAt)} ({rotatedDays} days)</span>],
                ['Status', p.status === 'error' ? <span className="text-rose-500">failing — {p.lastError}</span> : <span className="text-emerald-600 dark:text-emerald-400">valid{p.lastTestAt ? ` · verified ${timeAgo(p.lastTestAt)}` : ''}</span>],
              ]} />
            </CardBody>
          </Card>
          <Card className="p-4 text-[13px] leading-relaxed text-muted">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg"><ShieldCheck className="size-4 text-emerald-500" />How rotation works</div>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Create a new key/token in the {cat?.label ?? p.kind} console (keep the old one active).</li>
              <li>Paste it here — Autark verifies it with a full connection test.</li>
              <li>Once the test passes, revoke the old key at the provider.</li>
            </ol>
            <p className="mt-3">Running VMs are never affected by a rotation.</p>
          </Card>
        </div>
      )}
      {tab === 'settings' && <SettingsTab p={p} act={act} remove={remove} onRotate={() => setRotateOpen(true)} onQuotas={() => setQuotaOpen(true)} busy={!!op} />}
      {tab === 'activity' && <Card><ActivityFeed targetId={p.id} /></Card>}

      <RotateModal open={rotateOpen} onClose={() => setRotateOpen(false)} p={p} cat={cat} />
      <QuotaModal open={quotaOpen} onClose={() => setQuotaOpen(false)} p={p} />
    </Page>
  );
}

function apiHost(kind: string) {
  return ({ hetzner: 'api.hetzner.cloud', aws: 'ec2.amazonaws.com', ovh: 'eu.api.ovh.com', scaleway: 'api.scaleway.com', ionos: 'api.ionos.com', openstack: 'keystone' } as Record<string, string>)[kind] ?? kind;
}

function RegionsTab({ p, busy, act }: { p: CloudProvider; busy: boolean; act: (a: string, s: string, b?: unknown) => Promise<boolean> }) {
  const pro = usePro();
  const toggle = async (code: string) => {
    if (p.regions.includes(code)) {
      const n = p.locations?.find((l) => l.region === code)?.vms ?? 0;
      if (n) { toast.error(`Cannot disable ${code}`, `${n} VM(s) still run there. Migrate or delete them first.`); return }
      if (await confirm({ title: `Disable ${code}?`, message: 'The location is removed and projects can no longer deploy there.', confirmLabel: 'Disable region', danger: true })) act('disableRegion', `${code} disabled`, { region: code });
    } else act('enableRegion', `Enabling ${code}`, { region: code });
  };
  return (
    <div className="space-y-5">
      <RegionMap height={pro ? 260 : 200} color={PROVIDER_STYLE[p.kind]?.bg} onToggle={busy ? undefined : toggle} regions={p.availableRegions.map((r) => ({ ...r, selected: p.regions.includes(r.code) }))} />
      {p.status !== 'connected' && <Hint tone="warning">Regions can only be enabled while the provider is connected.</Hint>}
      <Card>
        <ul className="divide-y divide-line">
          {p.availableRegions.map((r) => {
            const on = p.regions.includes(r.code);
            const loc = p.locations?.find((l) => l.region === r.code);
            return (
              <li key={r.code} className="flex flex-wrap items-center gap-3 px-4 py-3 @min-[36rem]:flex-nowrap">
                <span className="text-2xl leading-none">{flag(r.country)}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-fg">{r.name} <span className="font-normal text-muted">· {r.city}, {r.country}</span></div>
                  <div className="font-mono text-[11px] text-muted">{r.code}{pro && loc ? ` → location ${loc.id}` : ''}</div>
                </div>
                {on && <span className="text-xs tabular text-muted">{loc?.vms ?? 0} VM{loc?.vms === 1 ? '' : 's'}</span>}
                <StatusPill status={on ? 'active' : 'disabled'} label={on ? 'enabled' : 'not enabled'} />
                <Button size="sm" variant={on ? 'ghost' : 'secondary'} disabled={busy || (!on && p.status !== 'connected')} onClick={() => toggle(r.code)}>{on ? 'Disable' : 'Enable'}</Button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function ResourcesTab({ p }: { p: CloudProvider }) {
  const accountId = useUi((s) => s.accountId);
  const { map: projects } = useLookup<Project>('projects');
  const rows = p.resources ?? [];
  const columns: Column<Resource>[] = [
    { id: 'name', header: 'VM', sort: (r) => r.name, cell: (r) => r.accountId === accountId ? <Link to={`/infrastructure/vms/${r.id}`} className="font-medium text-fg hover:text-brand-500">{r.name}</Link> : <span className="font-medium text-fg">{r.name} <Badge className="ml-1 h-4 px-1 text-[9.5px]">other account</Badge></span> },
    { id: 'project', header: 'Project', hideBelow: 'md', sort: (r) => r.projectId, cell: (r) => <span className="flex items-center gap-1.5 text-fg-2"><span className="size-2 rounded-full" style={{ background: projects.get(r.projectId)?.color }} />{projects.get(r.projectId)?.name ?? r.projectId}</span> },
    { id: 'region', header: 'Location', sort: (r) => r.locationId, cell: (r) => <Mono>{r.locationId}</Mono> },
    { id: 'status', header: 'Status', sort: (r) => r.status, cell: (r) => <StatusPill status={r.status} /> },
    { id: 'size', header: 'Size', sort: (r) => r.vcpus, cell: (r) => <span className="tabular text-fg-2">{r.vcpus} vCPU · {r.ramGB} GB{r.gpus ? ` · ${r.gpus}× GPU` : ''}</span> },
    { id: 'cost', header: 'Monthly', align: 'right', sort: (r) => r.monthlyCost, cell: (r) => <span className="tabular text-fg">{money(r.monthlyCost)}</span> },
  ];
  return (
    <DataTable rows={rows} columns={columns} searchText={(r) => `${r.name} ${r.locationId} ${r.status}`} defaultSort={{ id: 'cost', dir: 'desc' }}
      toolbar={<span className="text-xs text-muted">Discovered at last sync · tagged managed-by=autark</span>}
      empty={{ icon: Server, title: 'No resources in this provider', description: 'Deploy a VM to one of its locations to burst into the cloud.' }} />
  );
}

function RotateModal({ open, onClose, p, cat }: { open: boolean; onClose: () => void; p: CloudProvider; cat?: ProviderCatalogEntry }) {
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setCreds({}); setErrors({}) } }, [open]);
  const m = useApiMutation(() => api.action('providers', p.id, 'rotateCredentials', { credentials: creds }), {
    success: 'Credentials stored — verifying', onSuccess: onClose, onError: (e) => setErrors(fieldErrors(e)),
  });
  return (
    <Modal open={open} onClose={onClose} size="md" title={`Rotate credentials · ${p.name}`} description="The new credentials are verified with a full connection test. The old ones are discarded from the vault."
      icon={<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-brand-500"><KeyRound className="size-[18px]" /></div>}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={KeyRound} loading={m.isPending} disabled={!cat || cat.fields.some((f) => !f.optional && !(creds[f.id] ?? '').trim())} onClick={() => m.mutate()}>Rotate & verify</Button></>}>
      <div className="space-y-3">
        {cat?.fields.map((f) => (
          <Field key={f.id} label={f.label} required={!f.optional} optional={f.optional} hint={f.hint} error={errors[`credentials.${f.id}`]}>
            <Input mono type={f.secret && !show ? 'password' : 'text'} value={creds[f.id] ?? ''} placeholder={p.credentials.fields?.[f.id] ?? f.placeholder} onChange={(e) => setCreds({ ...creds, [f.id]: e.target.value })} autoComplete="off" />
          </Field>
        ))}
        <button type="button" className="flex items-center gap-1.5 text-xs text-muted hover:text-fg" onClick={() => setShow(!show)}>{show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}{show ? 'Hide' : 'Show'} secrets</button>
      </div>
    </Modal>
  );
}

function QuotaModal({ open, onClose, p }: { open: boolean; onClose: () => void; p: CloudProvider }) {
  const [q, setQ] = useState(p.quotas);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setQ(p.quotas); setErrors({}) } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const u = p.usage ?? { vcpus: 0, ramGB: 0, vms: 0, ips: 0, monthlyCost: 0 };
  const m = useApiMutation(() => api.action('providers', p.id, 'updateQuotas', { quotas: q }), { success: 'Quotas updated', onSuccess: onClose, onError: (e) => setErrors(fieldErrors(e)) });
  const fields: [keyof typeof q, string, number, string?][] = [['vcpus', 'vCPUs', 8], ['ramGB', 'RAM', 32, 'GB'], ['vms', 'VMs', 1], ['ips', 'Public IPs', 1]];
  return (
    <Modal open={open} onClose={onClose} title={`Quotas · ${p.name}`} description="Autark rejects placements beyond these limits. Cannot be set below current usage."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Save} loading={m.isPending} onClick={() => m.mutate()}>Save quotas</Button></>}>
      <div className="grid gap-4 @min-[36rem]:grid-cols-2">
        {fields.map(([k, label, step, unit]) => (
          <Field key={k} label={label} error={errors[`quotas.${k}`]} hint={`${u[k]} in use`}>
            <NumberInput value={q[k]} onChange={(v) => setQ({ ...q, [k]: v })} min={0} max={100000} step={step} unit={unit} invalid={!!errors[`quotas.${k}`]} />
          </Field>
        ))}
      </div>
      <IacTabs className="mt-4" snippets={{ cli: toCli('provider set-quotas', { id: p.id, ...q }), curl: toCurl('POST', `/providers/${p.id}/actions/updateQuotas`, { quotas: q }) }} />
    </Modal>
  );
}

function SettingsTab({ p, act, remove, onRotate, onQuotas, busy }: { p: CloudProvider; act: (a: string, s: string, b?: unknown) => Promise<boolean>; remove: () => void; onRotate: () => void; onQuotas: () => void; busy: boolean }) {
  const pro = usePro();
  const [name, setName] = useState(p.name);
  const [services, setServices] = useState(p.allowedServices);
  const [tags, setTags] = useState(p.tags);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setName(p.name); setServices(p.allowedServices); setTags(p.tags) }, [p.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useApiMutation(() => api.update('providers', p.id, { name, allowedServices: services, tags }), { success: 'Provider updated', onSuccess: () => setErrors({}), onError: (e) => setErrors(fieldErrors(e)) });
  const all: ('vm' | 'volume' | 'network' | 'ip')[] = ['vm', 'volume', 'network', 'ip'];
  return (
    <div className="grid gap-5 @min-[44rem]:grid-cols-2">
      <Card>
        <CardHeader title="General" icon={Settings} />
        <CardBody className="space-y-4">
          <Field label="Display name" error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          {pro && <Field label="Allowed services" error={errors.allowedServices}>
            <div className="flex flex-wrap gap-4">
              {all.map((s) => <Checkbox key={s} label={s} checked={services.includes(s)} disabled={s === 'vm'} onChange={(v) => setServices(v ? [...services, s] : services.filter((x) => x !== s))} />)}
            </div>
          </Field>}
          {pro && <Field label="Tags"><TagEditor value={tags} onChange={setTags} /></Field>}
          <div className="flex justify-end"><Button variant="primary" icon={Save} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
        </CardBody>
      </Card>
      {!pro && (
        <Card>
          <CardHeader title="Access" icon={KeyRound} />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><div className="text-sm font-medium text-fg">{p.credentials.label}</div><div className={cn('text-xs', p.status === 'error' ? 'text-rose-500' : 'text-muted')}>{p.status === 'error' ? `Not working: ${p.lastError}` : `Last changed ${timeAgo(p.credentials.lastRotatedAt)}`}</div></div>
              <Button variant={p.status === 'error' ? 'primary' : 'secondary'} icon={KeyRound} disabled={busy} onClick={onRotate}>Rotate credentials</Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
              <div><div className="text-sm font-medium text-fg">Limits</div><div className="text-xs text-muted">{p.quotas.vcpus} vCPU · {p.quotas.ramGB} GB · {p.quotas.vms} VMs · {p.quotas.ips} IPs</div></div>
              <Button icon={GaugeIcon} onClick={onQuotas}>Edit limits</Button>
            </div>
          </CardBody>
        </Card>
      )}
      <Card className="border-rose-500/30">
        <CardHeader title="Danger zone" icon={AlertTriangle} />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-sm font-medium text-fg">{p.status === 'disabled' ? 'Enable provider' : 'Disable provider'}</div><div className="text-xs text-muted">Stops new placements and syncs. Existing VMs keep running.</div></div>
            {p.status === 'disabled' ? <Button icon={Power} onClick={() => act('enable', `Re-enabling ${p.name}`)}>Enable</Button> : <Button variant="outline-danger" icon={Power} onClick={() => act('disable', `${p.name} disabled`)}>Disable</Button>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <div><div className="text-sm font-medium text-fg">Remove provider</div><div className="text-xs text-muted">Only possible when no resources remain in its regions.</div></div>
            <Button variant="danger" icon={Trash2} disabled={(p.usage?.vms ?? 0) > 0} onClick={remove}>Remove</Button>
          </div>
          {(p.usage?.vms ?? 0) > 0 && <Hint tone="warning">{p.usage!.vms} VM(s) still run in this provider's regions.</Hint>}
        </CardBody>
      </Card>
    </div>
  );
}
