import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AtSign, Plus, Trash2, Pencil, Download, Upload, ShieldCheck, Globe2, Lock, Copy, Save, RefreshCw, CheckCircle2, Bot, FileText, Server } from 'lucide-react';
import { useItem, useList, useLookup, useGet, useApiMutation, useActiveOperation } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardHeader, CardBody, KeyValue } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Tabs, useTabParam, Segmented } from '@/components/ui/Tabs';
import { confirm } from '@/components/ui/Modal';
import { Field, Input, Select, Switch, TagEditor, Textarea, Hint } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { Mono, CopyButton, EmptyState, Skeleton } from '@/components/ui/misc';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { toast } from '@/components/ui/toast';
import { OperationRunner } from '@/components/resource/OperationRunner';
import { ActivityFeed } from '@/components/resource/ActivityFeed';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { money, timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { DnsRecordModal, RECORD_TYPES, TYPE_COLOR } from '@/components/network/DnsRecordModal';
import { downloadText } from '@/components/network/util';
import { Advanced, Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import type { DnsZone, DnsRecord, DnsRecordType, IpAddress, Network, Project, VM, LoadBalancer, ZoneImportResult } from '@/types';

const ttlLabel = (s: number) => (s >= 86400 && s % 86400 === 0 ? `${s / 86400}d` : s >= 3600 && s % 3600 === 0 ? `${s / 3600}h` : s >= 60 && s % 60 === 0 ? `${s / 60}m` : `${s}s`);

export default function DnsDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const pro = usePro();
  const { data: zone, isLoading, error } = useItem<DnsZone>('dnsZones', id);
  const { items: ips } = useList<IpAddress>('ips');
  const { map: vms } = useLookup<VM>('vms');
  const { map: lbs } = useLookup<LoadBalancer>('loadBalancers');
  const { map: networks } = useLookup<Network>('networks');
  const { map: projects } = useLookup<Project>('projects');
  const op = useActiveOperation(id);
  const [tab, setTab] = useTabParam('records');
  const [type, setType] = useState<'all' | DnsRecordType>('all');
  const [modal, setModal] = useState<{ record?: DnsRecord | null; type?: DnsRecordType } | null>(null);
  const action = useApiMutation(({ a, body }: { a: string; body?: unknown }) => api.action('dnsZones', id!, a, body), { silent: true, onError: (e) => toast.error('Action failed', e.message) });

  const ipSuggestions = useMemo(() => ips.filter((i) => !zone || i.projectId === zone.projectId).map((i) => ({
    address: i.address,
    label: i.assignedTo ? (i.assignedTo.type === 'vm' ? vms.get(i.assignedTo.id)?.name : lbs.get(i.assignedTo.id)?.name) ?? i.assignedTo.id : 'unassigned',
  })), [ips, vms, lbs, zone]);

  if (isLoading) return <Page><Skeleton className="mb-4 h-10 w-72" /><Skeleton className="h-64" /></Page>;
  if (error || !zone) return <Page><EmptyState icon={AtSign} title="Zone not found" action={<Button to="/infrastructure/dns">Back to DNS</Button>} /></Page>;

  const proj = projects.get(zone.projectId);
  const counts = zone.records.reduce<Record<string, number>>((a, r) => ({ ...a, [r.type]: (a[r.type] ?? 0) + 1 }), {});
  const rows = zone.records.filter((r) => !pro || type === 'all' || r.type === type);
  const fqdn = (n: string) => (n === '@' ? zone.name : `${n}.${zone.name}`);

  const removeRecords = async (list: DnsRecord[]) => {
    if (list.some((r) => r.system)) { toast.error('Apex NS records are managed by Autark'); return }
    const managed = list.filter((r) => r.managedBy);
    const ok = await confirm({ title: `Delete ${list.length === 1 ? `${list[0].type} ${fqdn(list[0].name)}` : `${list.length} records`}?`, message: 'Resolvers may cache the old answer until the TTL expires.', danger: true, confirmLabel: 'Delete',
      options: managed.length ? [{ id: 'force', label: `Also delete ${managed.length} auto-managed record(s)`, description: 'They may be re-created by the owning resource.' }] : undefined });
    if (!ok) return;
    action.mutate({ a: 'deleteRecord', body: { ids: list.map((r) => r.id), force: !!ok.force } }, { onSuccess: () => toast.success(`Deleted ${list.length} record${list.length > 1 ? 's' : ''}`) });
  };
  const exportZone = async () => {
    try { const r = await api.get_<{ filename: string; text: string }>(`/dnsZones/${zone.id}/export`); downloadText(r.filename, r.text); toast.success(`Downloaded ${r.filename}`) } catch (e) { toast.error('Export failed', (e as Error).message) }
  };
  const remove = async () => {
    const ok = await confirm({ title: `Delete zone ${zone.name}?`, message: `${zone.records.length} records stop resolving immediately.`, danger: true, confirmLabel: 'Delete zone', typeToConfirm: zone.name });
    if (!ok) return;
    try { await api.remove('dnsZones', zone.id); toast.success(`Deleted ${zone.name}`); navigate('/infrastructure/dns') } catch (e) { toast.error('Delete failed', (e as Error).message) }
  };

  const allColumns: Column<DnsRecord>[] = [
    { id: 'name', header: 'Name', sort: (r) => (r.name === '@' ? '' : r.name), cell: (r) => <div className="min-w-0"><span className="font-mono text-[13px] font-medium text-fg">{r.name}</span><div className="truncate font-mono text-[11px] text-faint">{fqdn(r.name)}</div></div> },
    { id: 'type', header: 'Type', sort: (r) => r.type, cell: (r) => <span className="inline-flex h-5 items-center rounded px-1.5 font-mono text-[11px] font-semibold text-white" style={{ background: TYPE_COLOR[r.type] }}>{r.type}</span> },
    { id: 'value', header: 'Value', cell: (r) => <div className="flex min-w-0 max-w-md items-center gap-1.5">{r.priority != null && <span className="shrink-0 rounded bg-surface-3 px-1 font-mono text-[11px] text-muted" title="priority">{r.priority}</span>}<Mono copy={r.value} className="text-fg-2">{r.value}</Mono></div> },
    { id: 'ttl', header: 'TTL', hideBelow: 'md', sort: (r) => r.ttl, cell: (r) => <span className="tabular text-muted">{ttlLabel(r.ttl)}</span> },
    {
      id: 'managed', header: 'Managed by', hideBelow: 'lg',
      cell: (r) => r.system ? <Badge tone="info"><Bot className="size-3" />Autark</Badge> : r.managedBy ? <span className="flex items-center gap-1"><Bot className="size-3 text-muted" /><ResourceLink type={r.managedBy.type} id={r.managedBy.id} name={r.managedBy.type === 'vm' ? vms.get(r.managedBy.id)?.name : r.managedBy.type === 'lb' ? lbs.get(r.managedBy.id)?.name : undefined} /></span> : <span className="text-xs text-faint">manual</span>,
    },
  ];
  const columns = allColumns.filter((c) => pro || ['name', 'type', 'value'].includes(c.id));

  return (
    <Page wide>
      <PageHeader title={zone.name} icon={AtSign} iconColor="#06b6d4" description={zone.description}
        status={<><StatusPill status={zone.status} />{zone.kind === 'public' ? <Badge tone="info"><Globe2 className="size-3" />public</Badge> : <Badge><Lock className="size-3" />private</Badge>}{pro && zone.dnssec && <Badge tone="success"><ShieldCheck className="size-3" />DNSSEC</Badge>}</>}
        crumbs={[{ label: 'DNS', to: '/infrastructure/dns' }, { label: zone.name }]}
        meta={<>
          {pro && proj && <span className="flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: proj.color }} />{proj.name}</span>}
          {pro ? <span>serial <span className="font-mono">{zone.serial}</span></span> : <span>{zone.records.length} records</span>}
          {pro && <span>default TTL {ttlLabel(zone.defaultTtl)}</span>}
          {zone.networkId && <span className="flex items-center gap-1">VPC <ResourceLink type="network" id={zone.networkId} name={networks.get(zone.networkId)?.name} className="text-xs" /></span>}
          <span>{money(zone.monthlyCost, { decimals: true })}/mo</span>
          <span>created {timeAgo(zone.createdAt)}</span>
        </>}
        actions={<>
          <Pro>
            <Button icon={Download} onClick={exportZone}>Export</Button>
            <Button icon={Upload} onClick={() => setTab('import')}>Import</Button>
          </Pro>
          <Button variant="primary" icon={Plus} onClick={() => setModal({ record: null })}>Add record</Button>
        </>}
      />
      {op && <OperationRunner op={op} className="mb-5" compact />}
      {zone.status === 'pending-delegation' && tab !== 'delegation' && (
        <Hint tone="warning" className="mb-5">This zone is not delegated yet — resolvers on the internet won't find it. <button className="font-medium underline" onClick={() => setTab('delegation')}>{pro ? 'Show nameserver instructions' : 'Show nameservers'}</button></Hint>
      )}

      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={!pro ? [
        { id: 'records', label: 'Records', count: zone.records.length },
        { id: 'delegation', label: zone.kind === 'public' ? 'Nameservers' : 'Resolution' },
        { id: 'settings', label: 'Settings' },
      ] : [
        { id: 'records', label: 'Records', count: zone.records.length },
        { id: 'import', label: 'Import / export' },
        { id: 'delegation', label: zone.kind === 'public' ? 'Delegation & DNSSEC' : 'Resolution' },
        { id: 'settings', label: 'Settings' },
        { id: 'activity', label: 'Activity' },
      ]} />

      {tab === 'records' && (
        <div className="space-y-4">
          {/* type distribution — doubles as the type filter */}
          {pro && <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setType('all')} className={cn('h-7 rounded-lg px-2.5 text-xs font-medium ring-1 ring-inset', type === 'all' ? 'bg-fg text-bg ring-fg' : 'text-fg-2 ring-line hover:bg-surface-2')}>All <span className="tabular opacity-70">{zone.records.length}</span></button>
            {RECORD_TYPES.filter((t) => counts[t]).map((t) => (
              <button key={t} type="button" onClick={() => setType(type === t ? 'all' : t)}
                className={cn('flex h-7 items-center gap-1.5 rounded-lg px-2.5 font-mono text-xs font-semibold ring-1 ring-inset transition-colors', type === t ? 'text-white ring-transparent' : 'text-fg-2 ring-line hover:bg-surface-2')}
                style={type === t ? { background: TYPE_COLOR[t] } : undefined}>
                {type !== t && <span className="size-2 rounded-full" style={{ background: TYPE_COLOR[t] }} />}{t} <span className="tabular opacity-70">{counts[t]}</span>
              </button>
            ))}
          </div>}
          <DataTable rows={rows} columns={columns}
            searchText={(r) => `${r.name} ${fqdn(r.name)} ${r.type} ${r.value}`} searchPlaceholder="Search name or value…"
            defaultSort={{ id: 'name', dir: 'asc' }}
            onRowClick={(r) => !r.system && setModal({ record: r })}
            rowActions={(r) => r.system ? null : <div className="flex gap-0.5"><IconButton size="sm" icon={Pencil} label="Edit" onClick={() => setModal({ record: r })} /><IconButton size="sm" icon={Trash2} label="Delete" onClick={() => removeRecords([r])} /></div>}
            bulkActions={[{ label: 'Delete', icon: Trash2, danger: true, onClick: removeRecords }]}
            toolbar={pro && <Button size="sm" icon={Plus} onClick={() => setModal({ record: null, type: type === 'all' ? undefined : type })}>Add {type === 'all' ? 'record' : type}</Button>}
            empty={{ icon: AtSign, title: type === 'all' ? 'No records yet' : `No ${type} records`, description: 'Add records manually or import a BIND zone file.', action: <Button variant="primary" icon={Plus} onClick={() => setModal({ record: null })}>Add record</Button> }}
          />
        </div>
      )}

      {tab === 'import' && <ImportExport zone={zone} onDownload={exportZone} />}
      {tab === 'delegation' && <Delegation zone={zone} networks={networks} pro={pro} />}
      {tab === 'settings' && <ZoneSettings zone={zone} onDelete={remove} />}
      {tab === 'activity' && <Card><ActivityFeed targetId={zone.id} /></Card>}

      <DnsRecordModal open={!!modal} onClose={() => setModal(null)} zone={zone} record={modal?.record} initialType={modal?.type} ipSuggestions={ipSuggestions} />
    </Page>
  );
}

const SAMPLE = (z: string) => `$ORIGIN ${z}.
$TTL 3600
; paste the output of your current provider's zone export
@        IN  A      203.0.113.80
www      IN  CNAME  @
shop 300 IN  A      203.0.113.81
@        IN  MX 10  mx1.mailhost.net.
@        IN  TXT    "v=spf1 include:mailhost.net ~all"
_imaps._tcp IN SRV 0 5 993 mail.${z}.
`;

function ImportExport({ zone, onDownload }: { zone: DnsZone; onDownload: () => void }) {
  const { data: exp } = useGet<{ filename: string; text: string }>(['dnsZones', 'export', zone.id], `/dnsZones/${zone.id}/export`);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [result, setResult] = useState<ZoneImportResult | null>(null);
  const imp = useApiMutation(() => api.action<ZoneImportResult>('dnsZones', zone.id, 'importZone', { text, mode }), {
    silent: true,
    onSuccess: (r) => { setResult(r); toast.success(`Imported ${r.imported} record(s)${r.updated ? `, updated ${r.updated}` : ''}`, r.skipped.length ? `${r.skipped.length} line(s) skipped` : undefined) },
    onError: (e) => toast.error('Import failed', e.message),
  });
  const onFile = (f: File | undefined) => { if (f) f.text().then(setText) };
  return (
    <div className="grid gap-5 @min-[60rem]:grid-cols-2">
      <Card>
        <CardHeader title="Import zone file" description="BIND format. SOA is ignored; apex NS stays managed by Autark." icon={Upload}
          actions={<Button size="xs" variant="ghost" onClick={() => setText(SAMPLE(zone.name))}>Load sample</Button>} />
        <CardBody className="space-y-3">
          <Textarea mono rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={'$ORIGIN example.com.\n$TTL 3600\n@ IN A 203.0.113.10\nwww IN CNAME @'} />
          <div className="flex flex-wrap items-center gap-3">
            <label className="cursor-pointer text-xs font-medium text-brand-500 hover:underline">
              <input type="file" accept=".zone,.txt,.db,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              or choose a file…
            </label>
            <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'merge', label: 'Merge' }, { value: 'replace', label: 'Replace all' }]} />
            <Button className="ml-auto" variant="primary" icon={Upload} loading={imp.isPending} disabled={!text.trim()} onClick={async () => {
              if (mode === 'replace' && !(await confirm({ title: 'Replace all records?', message: 'Every manual record not in the file is deleted. Auto-managed records are kept.', danger: true, confirmLabel: 'Replace' }))) return;
              imp.mutate();
            }}>Import</Button>
          </div>
          {result && (
            <div className="animate-in rounded-xl border border-line bg-surface-2/50 p-3 text-[13px]">
              <div className="flex flex-wrap gap-3">
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-4" />{result.imported} imported</span>
                <span className="text-fg-2">{result.updated} updated</span>
                <span className={result.skipped.length ? 'text-amber-600 dark:text-amber-400' : 'text-muted'}>{result.skipped.length} skipped</span>
              </div>
              {result.skipped.length > 0 && (
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {result.skipped.map((s, i) => <li key={i} className="text-xs"><span className="font-mono text-faint">L{s.line}</span> <span className="font-mono text-fg-2">{s.text.slice(0, 60)}</span> — <span className="text-muted">{s.reason}</span></li>)}
                </ul>
              )}
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Export" description={`Serial ${zone.serial} · ${zone.records.length} records`} icon={FileText}
          actions={<div className="flex gap-1">{exp && <CopyButton value={exp.text} label="Copy zone file" />}<Button size="xs" icon={Download} onClick={onDownload}>Download</Button></div>} />
        <CardBody>{exp ? <CodeBlock code={exp.text} language="dns" maxHeight="max-h-[420px]" /> : <Skeleton className="h-64" />}</CardBody>
      </Card>
    </div>
  );
}

function Delegation({ zone, networks, pro }: { zone: DnsZone; networks: Map<string, Network>; pro: boolean }) {
  const action = useApiMutation(({ a, body }: { a: string; body?: unknown }) => api.action('dnsZones', zone.id, a, body), { silent: true, onError: (e) => toast.error('Action failed', e.message) });
  if (zone.kind === 'private') {
    const n = zone.networkId ? networks.get(zone.networkId) : undefined;
    return (
      <Card>
        <CardHeader title="Private resolution" icon={Server} />
        <CardBody className="space-y-3 text-[13px] text-fg-2">
          <p>Records in <b className="font-mono">{zone.name}</b> resolve only from inside {n ? <ResourceLink type="network" id={n.id} name={n.name} /> : 'its VPC'}. Every resource there uses the VPC resolver automatically via DHCP.</p>
          <KeyValue items={[['Resolver', <Mono copy>{zone.nameservers[0]}</Mono>], ['VPC', n ? `${n.name} · ${n.cidr}` : '—'], ['Try it', <Mono copy>{`dig @${zone.nameservers[0]} ${zone.records[0] ? `${zone.records[0].name === '@' ? '' : `${zone.records[0].name}.`}${zone.name}` : zone.name}`}</Mono>]]} />
        </CardBody>
      </Card>
    );
  }
  return (
    <div className={cn('grid gap-5', pro && '@min-[44rem]:grid-cols-2')}>
      <Card className={pro ? undefined : 'max-w-2xl'}>
        <CardHeader title={pro ? 'Nameserver delegation' : 'Nameservers'} icon={Globe2} actions={<StatusPill status={zone.status} />} />
        <CardBody className="space-y-4">
          <ol className="space-y-4 text-[13px] text-fg-2">
            <li className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-xs font-semibold text-brand-600 dark:text-brand-300">1</span>
              <div className="min-w-0 flex-1">At your registrar, set the nameservers of <b className="font-mono">{zone.name}</b> to:
                <div className="mt-2 space-y-1.5">{zone.nameservers.map((ns) => <div key={ns} className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-1.5"><span className="font-mono text-fg">{ns}</span><CopyButton value={ns} /></div>)}</div>
              </div>
            </li>
            <li className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-xs font-semibold text-brand-600 dark:text-brand-300">2</span>
              <div>Wait for the parent zone (.{zone.name.split('.').slice(1).join('.')}) to publish the change — usually minutes, up to 48 h.</div>
            </li>
            {pro && <li className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-xs font-semibold text-brand-600 dark:text-brand-300">3</span>
              <div className="min-w-0 flex-1">Verify:
                <div className="mt-1.5"><CodeBlock code={`dig NS ${zone.name} +short\ndig @${zone.nameservers[0]} ${zone.name} SOA +short`} language="bash" /></div>
              </div>
            </li>}
          </ol>
          <Button icon={RefreshCw} loading={action.isPending && action.variables?.a === 'checkDelegation'} onClick={() => action.mutate({ a: 'checkDelegation' }, { onSuccess: () => toast.info('Checking delegation…') })}>Check delegation now</Button>
        </CardBody>
      </Card>
      {pro && <Card>
        <CardHeader title="DNSSEC" icon={ShieldCheck} actions={<Switch checked={zone.dnssec} onChange={async (v) => {
          if (!v && !(await confirm({ title: 'Disable DNSSEC?', message: 'Remove the DS record at your registrar FIRST — otherwise validating resolvers will treat the zone as bogus and stop resolving it.', danger: true, confirmLabel: 'Disable' }))) return;
          action.mutate({ a: 'setDnssec', body: { enabled: v } }, { onSuccess: () => toast.success(v ? 'Signing zone with DNSSEC' : 'DNSSEC disabled') });
        }} />} />
        <CardBody className="space-y-3 text-[13px] text-fg-2">
          {zone.dnssec ? (
            <>
              <p>The zone is signed (ECDSA P-256, NSEC3). Publish this DS record at your registrar to complete the chain of trust:</p>
              <div className="flex items-start gap-2 rounded-lg bg-surface-2 p-3"><code className="min-w-0 flex-1 break-all font-mono text-[12px] text-fg">{zone.dsRecord}</code>{zone.dsRecord && <CopyButton value={zone.dsRecord} />}</div>
              <KeyValue cols={2} items={[['Algorithm', '13 · ECDSAP256SHA256'], ['Digest', '2 · SHA-256'], ['Key rollover', 'ZSK every 90 days (automatic)'], ['Denial of existence', 'NSEC3']]} />
            </>
          ) : <p>DNSSEC signs your records so resolvers can detect forged answers. Enabling generates keys and signs every record set; you then add a DS record at your registrar.</p>}
        </CardBody>
      </Card>}
    </div>
  );
}

function ZoneSettings({ zone, onDelete }: { zone: DnsZone; onDelete: () => void }) {
  const pro = usePro();
  const { items: networks } = useList<Network>('networks');
  const [description, setDescription] = useState(zone.description ?? '');
  const [ttl, setTtl] = useState(String(zone.defaultTtl));
  const [tags, setTags] = useState(zone.tags);
  const [networkId, setNetworkId] = useState(zone.networkId ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setDescription(zone.description ?? ''); setTtl(String(zone.defaultTtl)); setTags(zone.tags); setNetworkId(zone.networkId ?? '') }, [zone.id, zone.defaultTtl, zone.networkId]); // eslint-disable-line
  const patch: Record<string, unknown> = {};
  if (description !== (zone.description ?? '')) patch.description = description;
  if (Number(ttl) !== zone.defaultTtl) patch.defaultTtl = Number(ttl);
  if (JSON.stringify(tags) !== JSON.stringify(zone.tags)) patch.tags = tags;
  if (zone.kind === 'private' && networkId !== (zone.networkId ?? '')) patch.networkId = networkId;
  const save = useApiMutation(() => api.update('dnsZones', zone.id, patch), { success: 'Zone updated', onSuccess: () => setErrors({}), onError: (e: ApiClientError) => setErrors(fieldErrors(e)) });
  return (
    <div className="grid gap-5 @min-[56rem]:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader title="General" actions={<Button size="sm" variant="primary" icon={Save} disabled={!Object.keys(patch).length} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>} />
        <CardBody className="space-y-4">
          <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          {zone.kind === 'private' && (
            <Field label="Bound VPC" error={errors.networkId}><Select value={networkId} onChange={(e) => setNetworkId(e.target.value)} options={networks.filter((n) => n.projectId === zone.projectId).map((n) => ({ value: n.id, label: `${n.name} · ${n.cidr}` }))} /></Field>
          )}
          {(() => {
            const adv = (
              <>
                <Field label="Default TTL (seconds)" error={errors.defaultTtl} hint="Used for new records without an explicit TTL. Bumps the SOA serial."><Input mono value={ttl} onChange={(e) => setTtl(e.target.value.replace(/\D/g, ''))} /></Field>
                <Field label="Tags" error={errors.tags}><TagEditor value={tags} onChange={setTags} /></Field>
              </>
            );
            return pro ? adv : <Advanced className="shadow-none" description="Default TTL, tags">{adv}</Advanced>;
          })()}
        </CardBody>
      </Card>
      <Card className="border-rose-500/30">
        <CardHeader title="Danger zone" />
        <CardBody className="space-y-3">
          <p className="text-[13px] text-muted">Deleting removes all {zone.records.length} records. Networks using this zone fall back to the default resolver.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline-danger" icon={Trash2} onClick={onDelete}>Delete zone</Button>
            {pro && <Button variant="ghost" icon={Copy} onClick={() => { navigator.clipboard?.writeText(zone.id); toast.success('Zone ID copied') }}>Copy ID</Button>}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
