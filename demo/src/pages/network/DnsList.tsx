import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AtSign, Plus, Trash2, MoreHorizontal, Globe2, Lock, ShieldCheck, Clock, ListTree, Download } from 'lucide-react';
import { useList, useLookup, useApiMutation } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { Badge, StatusPill, Tags } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Stat } from '@/components/ui/Stat';
import { Modal, confirm } from '@/components/ui/Modal';
import { Field, Input, Select, Switch, TagEditor, Hint } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { fieldErrors } from '@/components/ui/FormLayout';
import { ProjectField } from '@/components/resource/pickers';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { toast } from '@/components/ui/toast';
import { money, num } from '@/lib/format';
import { dnsZoneCost } from '@/lib/pricing';
import { downloadText } from '@/components/network/util';
import { TYPE_COLOR } from '@/components/network/DnsRecordModal';
import { Advanced, Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import { useDefaultProject } from '@/components/network/useDefaultProject';
import type { DnsZone, DnsRecordType, Network, Project } from '@/types';

type Filter = 'all' | 'public' | 'private';

export default function DnsList() {
  const [sp, setSp] = useSearchParams();
  const pro = usePro();
  const { items: zones, isLoading } = useList<DnsZone>('dnsZones');
  const { map: networks } = useLookup<Network>('networks');
  const { map: projects } = useLookup<Project>('projects');
  const [filter, setFilter] = useState<Filter>('all');
  const [create, setCreate] = useState(sp.get('new') === '1');
  const rows = zones.filter((z) => filter === 'all' || z.kind === filter);

  const remove = async (list: DnsZone[]) => {
    const recs = list.reduce((a, z) => a + z.records.length, 0);
    const ok = await confirm({ title: `Delete ${list.length === 1 ? list[0].name : `${list.length} zones`}?`, message: `${recs} record(s) will stop resolving immediately.`, confirmLabel: 'Delete', danger: true, typeToConfirm: list.length === 1 ? list[0].name : undefined });
    if (!ok) return;
    const res = await Promise.allSettled(list.map((z) => api.remove('dnsZones', z.id)));
    const failed = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) toast.error('Delete failed', failed[0].reason?.message); else toast.success(`Deleted ${list.length} zone${list.length > 1 ? 's' : ''}`);
  };
  const exportZone = async (z: DnsZone) => {
    try { const r = await api.get_<{ filename: string; text: string }>(`/dnsZones/${z.id}/export`); downloadText(r.filename, r.text) } catch (e) { toast.error('Export failed', (e as Error).message) }
  };

  const allColumns: Column<DnsZone>[] = [
    {
      id: 'name', header: 'Zone', sort: (z) => z.name,
      cell: (z) => (
        <div className="min-w-0">
          <Link to={`/infrastructure/dns/${z.id}`} className="block truncate font-medium text-fg hover:text-brand-500">{z.name}</Link>
          <div className="flex items-center gap-1.5 truncate text-[11px] text-muted">
            {projects.get(z.projectId) && <span className="size-1.5 shrink-0 rounded-full" style={{ background: projects.get(z.projectId)!.color }} />}
            {z.description || (pro ? z.id : '')}
          </div>
        </div>
      ),
    },
    { id: 'kind', header: 'Type', sort: (z) => z.kind, cell: (z) => z.kind === 'public' ? <Badge tone="info"><Globe2 className="size-3" />public</Badge> : <span className="flex items-center gap-1.5"><Badge><Lock className="size-3" />private</Badge>{z.networkId && <ResourceLink type="network" id={z.networkId} name={networks.get(z.networkId)?.name} className="text-xs" />}</span> },
    { id: 'status', header: 'Status', sort: (z) => z.status, cell: (z) => <StatusPill status={z.status} /> },
    {
      id: 'records', header: 'Records', sort: (z) => z.records.length,
      cell: (z) => {
        if (!pro) return <span className="tabular text-fg-2">{z.records.length}</span>;
        const by = z.records.reduce<Record<string, number>>((a, r) => ({ ...a, [r.type]: (a[r.type] ?? 0) + 1 }), {});
        return (
          <div className="flex items-center gap-2">
            <span className="w-6 tabular text-fg">{z.records.length}</span>
            <div className="flex h-1.5 w-24 overflow-hidden rounded-full bg-surface-3">
              {Object.entries(by).map(([t, n]) => <div key={t} title={`${n} ${t}`} style={{ width: `${(n / Math.max(1, z.records.length)) * 100}%`, background: TYPE_COLOR[t as DnsRecordType] }} />)}
            </div>
          </div>
        );
      },
    },
    { id: 'dnssec', header: 'DNSSEC', hideBelow: 'md', sort: (z) => Number(z.dnssec), cell: (z) => z.dnssec ? <Badge tone="success"><ShieldCheck className="size-3" />signed</Badge> : <span className="text-xs text-faint">{z.kind === 'private' ? 'n/a' : 'off'}</span> },
    { id: 'ns', header: 'Nameservers', hideBelow: 'xl', cell: (z) => <span className="font-mono text-[11px] text-muted">{z.nameservers.join(', ')}</span> },
    { id: 'tags', header: 'Tags', hideBelow: 'xl', cell: (z) => <Tags tags={z.tags} max={2} /> },
    { id: 'cost', header: 'Monthly', align: 'right', sort: (z) => z.monthlyCost ?? 0, cell: (z) => <span className="tabular text-fg">{money(z.monthlyCost, { decimals: true })}</span> },
  ];
  const columns = allColumns.filter((c) => pro || ['name', 'kind', 'status', 'records'].includes(c.id));

  const recs = zones.reduce((a, z) => a + z.records.length, 0);
  return (
    <Page wide>
      <PageHeader title="DNS" description={pro ? 'Authoritative public zones and private VPC zones. Records for load balancers and VMs can be managed automatically.' : 'Host your domains and manage their records.'} icon={AtSign} iconColor="#06b6d4"
        actions={<Button variant="primary" icon={Plus} onClick={() => setCreate(true)}>Create zone</Button>} />
      <Pro><div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Zones" value={num(zones.length)} icon={AtSign} sub={`${zones.filter((z) => z.kind === 'public').length} public · ${zones.filter((z) => z.kind === 'private').length} private`} />
        <Stat label="Records" value={num(recs)} icon={ListTree} sub={`${zones.reduce((a, z) => a + z.records.filter((r) => r.managedBy).length, 0)} auto-managed`} />
        <Stat label="DNSSEC signed" value={`${zones.filter((z) => z.dnssec).length} / ${zones.filter((z) => z.kind === 'public').length}`} icon={ShieldCheck} sub="public zones" />
        <Stat label="Pending delegation" value={num(zones.filter((z) => z.status === 'pending-delegation').length)} icon={Clock} sub={`${money(zones.reduce((a, z) => a + (z.monthlyCost ?? 0), 0), { decimals: true })}/mo total`} accent="#06b6d4" />
      </div></Pro>
      <DataTable
        rows={rows}
        loading={isLoading}
        columns={columns}
        initialSearch={sp.get('q') ?? ''}
        searchText={(z) => `${z.name} ${z.id} ${z.kind} ${z.records.map((r) => `${r.name} ${r.value}`).join(' ')}`}
        searchPlaceholder="Search zone or record value…"
        rowLink={(z) => `/infrastructure/dns/${z.id}`}
        defaultSort={{ id: 'name', dir: 'asc' }}
        toolbar={<FilterChips value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All', count: zones.length }, { value: 'public', label: 'Public', count: zones.filter((z) => z.kind === 'public').length }, { value: 'private', label: 'Private', count: zones.filter((z) => z.kind === 'private').length }]} />}
        rowActions={(z) => (
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />} items={[
            { label: 'Records', icon: ListTree, to: `/infrastructure/dns/${z.id}` },
            ...(pro ? [{ label: 'Export zone file', icon: Download, onClick: () => exportZone(z) }] : []),
            { divider: true, label: '' },
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove([z]) },
          ]} />
        )}
        bulkActions={[{ label: 'Delete', icon: Trash2, danger: true, onClick: remove }]}
        empty={{ icon: AtSign, title: 'No DNS zones', description: 'Host your domain on your own nameservers, or create a private zone for service discovery inside a VPC.', action: <Button variant="primary" icon={Plus} onClick={() => setCreate(true)}>Create zone</Button> }}
      />
      <CreateZoneModal open={create} onClose={() => { setCreate(false); if (sp.get('new')) { sp.delete('new'); setSp(sp, { replace: true }) } }} />
    </Page>
  );
}

function CreateZoneModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { items: networks } = useList<Network>('networks');
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'public' | 'private'>('public');
  const [networkId, setNetworkId] = useState('');
  const [ttl, setTtl] = useState('3600');
  const [dnssec, setDnssec] = useState(true);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<{ key: string; value: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const nets = networks.filter((n) => n.projectId === projectId);
  const pro = usePro();
  useDefaultProject(projectId, setProjectId);
  useEffect(() => { if (open) { setName(''); setErrors({}); setFormError(null); setDescription('') } }, [open]);
  useEffect(() => { if (!nets.some((n) => n.id === networkId)) setNetworkId(nets[0]?.id ?? '') }, [projectId, nets.length]); // eslint-disable-line
  useEffect(() => { setTtl(kind === 'public' ? '3600' : '300') }, [kind]);
  const go = useApiMutation(() => api.create<DnsZone>('dnsZones', { projectId, name, kind, networkId: kind === 'private' ? networkId : null, defaultTtl: Number(ttl), dnssec: kind === 'public' && dnssec, description, tags }), {
    success: (z) => `Zone ${z.name} created`,
    onSuccess: (z) => { onClose(); navigate(`/infrastructure/dns/${z.id}${z.kind === 'public' ? '?tab=delegation' : ''}`) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); setFormError(e.message) },
  });
  const cost = dnsZoneCost(kind === 'public' ? 2 : 0).total;
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Create DNS zone" description={pro ? "Public zones are served by Autark's authoritative nameservers; private zones resolve only inside a VPC." : undefined}
      footer={<><span className="mr-auto text-xs text-muted">≈ {money(cost, { decimals: true })}/mo + €0.01 per record</span><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={go.isPending} disabled={!name || !projectId || (kind === 'private' && !networkId)} onClick={() => go.mutate()}>Create zone</Button></>}>
      <div className="space-y-4">
        {formError && <Hint tone="danger">{formError}</Hint>}
        <Field label="Visibility">
          <Segmented value={kind} onChange={setKind} options={[{ value: 'public', label: 'Public', icon: <Globe2 className="size-3.5" /> }, { value: 'private', label: 'Private (VPC)', icon: <Lock className="size-3.5" /> }]} />
        </Field>
        <Field label="Domain" required error={errors.name} hint={kind === 'public' ? (pro ? 'You must own it — delegate NS at your registrar afterwards.' : "You'll point your registrar to our nameservers afterwards.") : 'e.g. app.internal, corp.lan'}>
          <Input mono value={name} onChange={(e) => setName(e.target.value.trim().toLowerCase())} placeholder={kind === 'public' ? 'example.com' : 'app.internal'} autoFocus invalid={!!errors.name} />
        </Field>
        {kind === 'private' && (
          <Field label="VPC" required error={errors.networkId} hint={!nets.length ? 'No VPC in this project.' : 'Records resolve via the VPC resolver (x.x.0.2).'}>
            <Select value={networkId} onChange={(e) => setNetworkId(e.target.value)} options={nets.map((n) => ({ value: n.id, label: `${n.name} · ${n.cidr}` }))} />
          </Field>
        )}
        <Advanced description={kind === 'public' ? 'Project, TTL, DNSSEC, description, tags' : 'Project, TTL, description, tags'}>
        <div className="grid gap-4 @min-[36rem]:grid-cols-2">
          <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />
          <Field label="Default TTL" error={errors.defaultTtl}>
            <Select value={ttl} onChange={(e) => setTtl(e.target.value)} options={[{ value: '60', label: '1 minute' }, { value: '300', label: '5 minutes' }, { value: '3600', label: '1 hour' }, { value: '86400', label: '1 day' }]} />
          </Field>
        </div>
        <Field label="Description" optional><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {kind === 'public' && <Switch checked={dnssec} onChange={setDnssec} label="Sign with DNSSEC" description="Protects resolvers from spoofed answers. You'll publish a DS record at your registrar." />}
        <Field label="Tags" error={errors.tags}><TagEditor value={tags} onChange={setTags} /></Field>
        </Advanced>
      </div>
    </Modal>
  );
}
