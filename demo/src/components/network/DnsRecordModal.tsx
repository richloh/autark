import { useEffect, useState } from 'react';
import { api, ApiClientError } from '@/api/client';
import { useApiMutation } from '@/api/hooks';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea, Hint, Checkbox } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { isValidIp } from '@/lib/cidr';
import { cn } from '@/lib/cn';
import { Pro } from '@/components/ui/Pro';
import type { DnsRecord, DnsRecordType, DnsZone } from '@/types';

export const RECORD_TYPES: DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS', 'PTR'];
export const TYPE_HELP: Record<DnsRecordType, string> = {
  A: 'Points a name to an IPv4 address.',
  AAAA: 'Points a name to an IPv6 address.',
  CNAME: 'Alias to another hostname. Cannot coexist with other records and is not allowed at the apex.',
  MX: 'Mail server for the domain; lower priority is preferred.',
  TXT: 'Free text — SPF, DKIM, DMARC, domain verification.',
  SRV: 'Service location: priority, weight, port and target host.',
  CAA: 'Which certificate authorities may issue certificates for this domain.',
  NS: 'Delegate a sub-domain to other nameservers.',
  PTR: 'Reverse mapping (IP → name), mostly in reverse zones.',
};
export const TYPE_COLOR: Record<DnsRecordType, string> = {
  A: '#5b67f8', AAAA: '#8b5cf6', CNAME: '#06b6d4', MX: '#f59e0b', TXT: '#64748b', SRV: '#ec4899', CAA: '#10b981', NS: '#0ea5e9', PTR: '#f97316',
};
const TTLS = [{ value: '60', label: '1 min' }, { value: '300', label: '5 min' }, { value: '3600', label: '1 hour' }, { value: '86400', label: '1 day' }];
const TXT_TEMPLATES: { label: string; value: (z: string) => string; name?: string }[] = [
  { label: 'SPF', value: () => 'v=spf1 mx include:_spf.example.com ~all' },
  { label: 'DMARC', value: (z) => `v=DMARC1; p=quarantine; rua=mailto:dmarc@${z}`, name: '_dmarc' },
  { label: 'Verification', value: () => 'site-verification=REPLACE_ME' },
];

interface Draft { type: DnsRecordType; name: string; ttl: string; value: string; priority: string; srvService: string; srvProto: string; srvWeight: string; srvPort: string; srvTarget: string; caaFlags: string; caaTag: string; caaValue: string }

function initDraft(zone: DnsZone, r?: DnsRecord | null, type?: DnsRecordType): Draft {
  const d: Draft = { type: r?.type ?? type ?? 'A', name: r?.name ?? '', ttl: String(r?.ttl ?? zone.defaultTtl), value: r?.value ?? '', priority: r?.priority != null ? String(r.priority) : '10',
    srvService: '_sip', srvProto: '_tcp', srvWeight: '10', srvPort: '5060', srvTarget: '', caaFlags: '0', caaTag: 'issue', caaValue: 'letsencrypt.org' };
  if (r?.type === 'SRV') {
    const m = /^(_[^.]+)\.(_[^.]+)(?:\.(.*))?$/.exec(r.name);
    if (m) { d.srvService = m[1]; d.srvProto = m[2]; d.name = m[3] ?? '' }
    const p = r.value.split(/\s+/);
    if (p.length === 4) p.shift();
    [d.srvWeight, d.srvPort, d.srvTarget] = [p[0] ?? '', p[1] ?? '', p[2] ?? ''];
  }
  if (r?.type === 'CAA') {
    const m = /^(\d+)\s+(\S+)\s+"(.*)"$/.exec(r.value);
    if (m) { d.caaFlags = m[1]; d.caaTag = m[2]; d.caaValue = m[3] }
  }
  return d;
}

function bodyOf(d: Draft) {
  const ttl = Number(d.ttl);
  switch (d.type) {
    case 'SRV': return { type: d.type, name: `${d.srvService}.${d.srvProto}${d.name && d.name !== '@' ? `.${d.name}` : ''}`, ttl, priority: Number(d.priority), value: `${d.srvWeight} ${d.srvPort} ${d.srvTarget}` };
    case 'CAA': return { type: d.type, name: d.name || '@', ttl, value: `${d.caaFlags} ${d.caaTag} "${d.caaValue}"` };
    case 'MX': return { type: d.type, name: d.name || '@', ttl, priority: Number(d.priority), value: d.value };
    default: return { type: d.type, name: d.name || '@', ttl, value: d.value };
  }
}

/** Add / edit a DNS record with type-aware fields. */
export function DnsRecordModal({ open, onClose, zone, record, ipSuggestions = [], initialType }: {
  open: boolean; onClose: () => void; zone: DnsZone; record?: DnsRecord | null; ipSuggestions?: { address: string; label: string }[]; initialType?: DnsRecordType;
}) {
  const [d, setD] = useState<Draft>(() => initDraft(zone, record, initialType));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  useEffect(() => { if (open) { setD(initDraft(zone, record, initialType)); setErrors({}); setFormError(null); setForce(false) } }, [open, record?.id]); // eslint-disable-line
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const editing = !!record;

  const save = useApiMutation(() => editing
    ? api.action('dnsZones', zone.id, 'updateRecord', { id: record!.id, ...bodyOf(d), ...(force ? { force: true } : {}) })
    : api.action('dnsZones', zone.id, 'addRecord', bodyOf(d)), {
    success: editing ? 'Record updated' : 'Record added',
    silent: false,
    onSuccess: () => onClose(),
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); setFormError(e.message) },
  });

  const localValueErr = d.type === 'A' && d.value && !isValidIp(d.value) ? 'Enter an IPv4 address' : undefined;
  const fqdn = (n: string) => (!n || n === '@' ? zone.name : `${n}.${zone.name}`);
  const previewName = d.type === 'SRV' ? fqdn(`${d.srvService}.${d.srvProto}${d.name && d.name !== '@' ? `.${d.name}` : ''}`) : fqdn(d.name);
  const b = bodyOf(d);
  const preview = `${previewName}. ${b.ttl} IN ${d.type} ${'priority' in b && b.priority != null ? `${b.priority} ` : ''}${d.type === 'TXT' ? `"${b.value}"` : b.value}`;

  return (
    <Modal open={open} onClose={onClose} size="lg" title={editing ? `Edit ${record!.type} record` : 'Add DNS record'} description={TYPE_HELP[d.type]}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!!localValueErr || (record?.managedBy != null && !force)} onClick={() => save.mutate()}>{editing ? 'Save record' : 'Add record'}</Button>
      </>}>
      <div className="space-y-4">
        {formError && <Hint tone="danger">{formError}</Hint>}
        {record?.managedBy && (
          <Hint tone="warning">
            This record is managed by <b>{record.managedBy.type} {record.managedBy.id}</b> and is updated automatically.
            <Checkbox className="mt-2" checked={force} onChange={setForce} label="Edit anyway (detaches it from automatic management)" />
          </Hint>
        )}
        <Field label="Type">
          <div className="flex flex-wrap gap-1.5">
            {RECORD_TYPES.map((t) => (
              <button key={t} type="button" disabled={editing && t !== d.type} onClick={() => set({ type: t })}
                className={cn('h-7 rounded-md px-2.5 font-mono text-xs font-semibold ring-1 ring-inset transition-colors disabled:opacity-30', d.type === t ? 'text-white ring-transparent' : 'text-fg-2 ring-line hover:bg-surface-2')}
                style={d.type === t ? { background: TYPE_COLOR[t] } : undefined}>{t}</button>
            ))}
          </div>
        </Field>
        <div className={cn('grid gap-3', d.type === 'SRV' ? '@min-[36rem]:grid-cols-[1fr_1fr_1.3fr]' : '@min-[36rem]:grid-cols-[1.6fr_1fr]')}>
          {d.type === 'SRV' && <>
            <Field label="Service" error={errors.name}><Input mono value={d.srvService} onChange={(e) => set({ srvService: e.target.value })} placeholder="_sip" /></Field>
            <Field label="Protocol"><Select value={d.srvProto} onChange={(e) => set({ srvProto: e.target.value })} options={[{ value: '_tcp', label: '_tcp' }, { value: '_udp', label: '_udp' }, { value: '_tls', label: '_tls' }]} /></Field>
          </>}
          <Field label={d.type === 'SRV' ? 'Sub-domain' : 'Name'} error={d.type !== 'SRV' ? errors.name : undefined} hint={d.type === 'SRV' ? 'optional' : '@ for the apex'}>
            <Input mono value={d.name} onChange={(e) => set({ name: e.target.value.toLowerCase() })} placeholder={d.type === 'SRV' ? '' : '@ or www'} suffix={`.${zone.name}`} />
          </Field>
          {d.type !== 'SRV' && (
            <Field label="TTL" error={errors.ttl}>
              <div className="flex gap-1.5">
                <Select className="flex-1" value={TTLS.some((t) => t.value === d.ttl) ? d.ttl : 'custom'} onChange={(e) => e.target.value !== 'custom' && set({ ttl: e.target.value })} options={[...TTLS, { value: 'custom', label: 'Custom' }]} />
                <Input mono className="w-24" value={d.ttl} onChange={(e) => set({ ttl: e.target.value.replace(/\D/g, '') })} aria-label="TTL seconds" />
              </div>
            </Field>
          )}
        </div>

        {(d.type === 'A' || d.type === 'AAAA') && (
          <Field label={d.type === 'A' ? 'IPv4 address' : 'IPv6 address'} error={localValueErr ?? errors.value}>
            <Input mono list="dns-ip-suggestions" value={d.value} onChange={(e) => set({ value: e.target.value.trim() })} placeholder={d.type === 'A' ? '203.0.113.10' : '2001:db8::10'} invalid={!!(localValueErr ?? errors.value)} />
            <datalist id="dns-ip-suggestions">{ipSuggestions.filter((s) => (d.type === 'A') === !s.address.includes(':')).map((s) => <option key={s.address} value={s.address}>{s.label}</option>)}</datalist>
            {ipSuggestions.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {ipSuggestions.filter((s) => (d.type === 'A') === !s.address.includes(':')).slice(0, 6).map((s) => (
                  <button key={s.address} type="button" onClick={() => set({ value: s.address })} className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted hover:text-fg"><span className="font-mono">{s.address}</span> · {s.label}</button>
                ))}
              </div>
            )}
          </Field>
        )}
        {(d.type === 'CNAME' || d.type === 'NS' || d.type === 'PTR') && (
          <Field label="Target hostname" error={errors.value} hint="A trailing dot is added for fully-qualified names.">
            <Input mono value={d.value} onChange={(e) => set({ value: e.target.value.trim() })} placeholder={d.type === 'NS' ? 'ns1.provider.net' : 'target.example.com'} />
          </Field>
        )}
        {d.type === 'MX' && (
          <div className="grid gap-3 @min-[36rem]:grid-cols-[110px_1fr]">
            <Field label="Priority" error={errors.priority}><Input mono value={d.priority} onChange={(e) => set({ priority: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Mail server" error={errors.value}><Input mono value={d.value} onChange={(e) => set({ value: e.target.value.trim() })} placeholder="mail.example.com" /></Field>
          </div>
        )}
        {d.type === 'TXT' && (
          <Field label="Text" error={errors.value} action={<div className="flex gap-1">{TXT_TEMPLATES.map((t) => <Button key={t.label} size="xs" variant="ghost" onClick={() => set({ value: t.value(zone.name), ...(t.name && !d.name ? { name: t.name } : {}) })}>{t.label}</Button>)}</div>}>
            <Textarea mono rows={3} value={d.value} onChange={(e) => set({ value: e.target.value })} placeholder="v=spf1 include:_spf.example.com ~all" />
          </Field>
        )}
        {d.type === 'SRV' && (
          <div className="grid gap-3 @min-[36rem]:grid-cols-[90px_90px_90px_1fr]">
            <Field label="Priority" error={errors.priority}><Input mono value={d.priority} onChange={(e) => set({ priority: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Weight"><Input mono value={d.srvWeight} onChange={(e) => set({ srvWeight: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Port"><Input mono value={d.srvPort} onChange={(e) => set({ srvPort: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Target" error={errors.value}><Input mono value={d.srvTarget} onChange={(e) => set({ srvTarget: e.target.value.trim() })} placeholder="sip.example.com" /></Field>
          </div>
        )}
        {d.type === 'SRV' && (
          <Field label="TTL" error={errors.ttl}><Select value={TTLS.some((t) => t.value === d.ttl) ? d.ttl : '3600'} onChange={(e) => set({ ttl: e.target.value })} options={TTLS} /></Field>
        )}
        {d.type === 'CAA' && (
          <div className="grid gap-3 @min-[36rem]:grid-cols-[80px_140px_1fr]">
            <Field label="Flags"><Input mono value={d.caaFlags} onChange={(e) => set({ caaFlags: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Tag"><Select value={d.caaTag} onChange={(e) => set({ caaTag: e.target.value })} options={[{ value: 'issue', label: 'issue' }, { value: 'issuewild', label: 'issuewild' }, { value: 'iodef', label: 'iodef' }]} /></Field>
            <Field label={d.caaTag === 'iodef' ? 'Report URL' : 'Certificate authority'} error={errors.value}><Input mono value={d.caaValue} onChange={(e) => set({ caaValue: e.target.value })} placeholder="letsencrypt.org" /></Field>
          </div>
        )}
<Pro>
        <div className="rounded-lg bg-surface-2 px-3 py-2">
          <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-faint">Zone file preview</div>
          <code className="block break-all font-mono text-[12px] text-fg-2">{preview}</code>
        </div>
        </Pro>
      </div>
    </Modal>
  );
}
