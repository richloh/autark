import { useMemo, useState } from 'react';
import { BadgeCheck, Plus, RefreshCw, Trash2, MoreHorizontal, Upload, Globe2, AtSign, AlertTriangle, ShieldCheck, Lock } from 'lucide-react';
import { useList, useApiMutation, useOperationsFor } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Modal, Drawer, confirm } from '@/components/ui/Modal';
import { Field, Input, Textarea, Select, Switch, OptionCards, Hint } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { KeyValue } from '@/components/ui/Card';
import { Mono } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { fieldErrors } from '@/components/ui/FormLayout';
import { OperationInline, OperationRunner } from '@/components/resource/OperationRunner';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { ProjectField } from '@/components/resource/pickers';
import { SimpleAdvanced } from '@/components/network/SimpleAdvanced';
import { usePro } from '@/store/ui';
import { useDefaultProject } from '@/components/network/useDefaultProject';
import { date, dateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Certificate, Operation, DnsZone } from '@/types';

/* TLS certificates: Let's Encrypt (ACME HTTP-01 / DNS-01) or uploaded PEM. */

export function ExpiryMeter({ cert, className }: { cert: Certificate; className?: string }) {
  const days = cert.daysLeft ?? Math.floor((Date.parse(cert.expiresAt) - Date.now()) / 86_400_000);
  const total = cert.issuer === 'letsencrypt' ? 90 : 365;
  const ratio = Math.max(0, Math.min(1, days / total));
  const tone = days < 0 ? 'bg-rose-500' : days < 7 ? 'bg-rose-500' : days < 30 ? 'bg-amber-500' : 'bg-emerald-500';
  const text = days < 0 ? 'text-rose-500' : days < 7 ? 'text-rose-500' : days < 30 ? 'text-amber-600 dark:text-amber-400' : 'text-fg-2';
  if (cert.status === 'pending') return <span className="text-xs text-muted">issuing…</span>;
  return (
    <div className={cn('w-32', className)} title={`Expires ${dateTime(cert.expiresAt)}`}>
      <div className="flex items-baseline justify-between text-xs">
        <span className={cn('font-medium tabular', text)}>{days < 0 ? `expired ${-days}d ago` : `${days}d left`}</span>
        <span className="text-[11px] text-faint">{date(cert.expiresAt)}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3"><div className={cn('h-full rounded-full', tone)} style={{ width: `${Math.max(3, ratio * 100)}%` }} /></div>
    </div>
  );
}

export function IssuerBadge({ cert }: { cert: Certificate }) {
  return cert.issuer === 'letsencrypt'
    ? <Badge tone="success" title="Let's Encrypt (ACME)">Let's Encrypt{cert.challenge ? ` · ${cert.challenge.toUpperCase()}` : ''}</Badge>
    : <Badge tone="neutral">Uploaded</Badge>;
}

/** Full certificates manager (list + issue/upload + renew + delete). */
export function CertificatesPanel({ filter, projectId, emptyHint }: { filter?: (c: Certificate) => boolean; projectId?: string; emptyHint?: string }) {
  const { items, isLoading } = useList<Certificate>('certificates');
  const pro = usePro();
  const { items: ops } = useList<Operation>('operations', { status: 'running' });
  const opByTarget = useMemo(() => new Map(ops.map((o) => [o.target.id, o])), [ops]);
  const [status, setStatus] = useState<'all' | 'attention' | 'letsencrypt' | 'custom'>('all');
  const [issueOpen, setIssueOpen] = useState(false);
  const [renewCustom, setRenewCustom] = useState<Certificate | null>(null);
  const [detail, setDetail] = useState<Certificate | null>(null);
  const certs = items.filter((c) => !filter || filter(c));
  const attention = certs.filter((c) => ['expiring', 'expired', 'failed'].includes(c.status));
  const rows = certs.filter((c) => !pro || status === 'all' || (status === 'attention' ? attention.includes(c) : c.issuer === status));

  const toggle = useApiMutation(({ c, v }: { c: Certificate; v: boolean }) => api.update('certificates', c.id, { autoRenew: v }), { success: (_r, { v }) => (v ? 'Auto-renew enabled' : 'Auto-renew disabled') });
  const renew = useApiMutation((c: Certificate) => api.action('certificates', c.id, 'renew'), { success: (_r, c) => `Renewing ${c.name}` });

  const doRenew = async (c: Certificate) => {
    if (c.issuer === 'custom') { setRenewCustom(c); return }
    const ok = await confirm({ title: `Renew ${c.name}?`, message: `Requests a fresh 90-day certificate from Let's Encrypt via ${c.challenge?.toUpperCase()}. ${c.usedBy?.length ? `It is hot-swapped on ${c.usedBy.length} listener(s) without dropping connections.` : ''}`, confirmLabel: 'Renew now' });
    if (ok) renew.mutate(c);
  };
  const remove = async (c: Certificate) => {
    if (c.usedBy?.length) { toast.warning(`${c.name} is in use`, `Used by ${c.usedBy.map((u) => `${u.lbName} :${u.port}`).join(', ')}. Switch those listeners to another certificate first.`); return }
    const ok = await confirm({ title: `Delete certificate ${c.name}?`, message: 'The certificate and its private key are destroyed. This cannot be undone.', danger: true, confirmLabel: 'Delete', typeToConfirm: c.name });
    if (!ok) return;
    api.remove('certificates', c.id).then(() => toast.success(`Deleted ${c.name}`)).catch((e) => toast.error('Delete failed', e.message));
  };

  const allColumns: Column<Certificate>[] = [
    {
      id: 'name', header: 'Certificate', sort: (c) => c.name,
      cell: (c) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', c.status === 'failed' || c.status === 'expired' ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500')}><BadgeCheck className="size-4" /></span>
          <div className="min-w-0">
            <button onClick={() => setDetail(c)} className="block truncate text-left font-medium text-fg hover:text-brand-500">{c.name}</button>
            <div className="truncate font-mono text-[11px] text-muted" title={c.domains.join(', ')}>{c.domains.slice(0, 2).join(', ')}{c.domains.length > 2 ? ` +${c.domains.length - 2}` : ''}</div>
          </div>
        </div>
      ),
    },
    {
      id: 'status', header: 'Status', sort: (c) => c.status,
      cell: (c) => {
        const op = opByTarget.get(c.id);
        return (
          <div className="w-40">
            <StatusPill status={c.status} />
            {op ? <OperationInline op={op} className="mt-1.5" /> : c.failureReason && (c.status === 'failed') ? <div className="mt-1 line-clamp-2 text-[11px] text-rose-500" title={c.failureReason}>{c.failureReason}</div> : null}
          </div>
        );
      },
    },
    { id: 'issuer', header: 'Issuer', hideBelow: 'md', sort: (c) => c.issuer, cell: (c) => <IssuerBadge cert={c} /> },
    { id: 'expires', header: 'Expires', sort: (c) => Date.parse(c.expiresAt), cell: (c) => <ExpiryMeter cert={c} /> },
    {
      id: 'renew', header: 'Auto-renew', hideBelow: 'lg',
      cell: (c) => <span title={c.issuer === 'custom' ? 'Uploaded certificates must be replaced manually' : 'Renews 30 days before expiry'}><Switch size="sm" checked={c.autoRenew} disabled={c.issuer === 'custom'} onChange={(v) => toggle.mutate({ c, v })} /></span>,
    },
    {
      id: 'used', header: 'Used by', hideBelow: 'lg',
      cell: (c) => c.usedBy?.length ? <div className="space-y-0.5">{c.usedBy.slice(0, 2).map((u) => <div key={u.listenerId} className="flex items-center gap-1"><ResourceLink type="lb" id={u.lbId} name={u.lbName} /><span className="text-[11px] text-muted">:{u.port}</span></div>)}{c.usedBy.length > 2 && <span className="text-[11px] text-muted">+{c.usedBy.length - 2} more</span>}</div> : <span className="text-xs text-faint">unused</span>,
    },
  ];

  const columns = allColumns.filter((c) => pro || ['name', 'status', 'expires', 'used'].includes(c.id));
  return (
    <div className="space-y-3">
      {attention.length > 0 && (
        <Hint tone="warning">
          <b>{attention.length} certificate{attention.length > 1 ? 's need' : ' needs'} attention:</b>{' '}
          {attention.map((c) => `${c.name} (${c.status === 'failed' ? 'issuance failed' : c.status === 'expired' ? 'expired' : `expires in ${c.daysLeft}d`}${c.issuer === 'custom' && c.status !== 'failed' ? ', upload a replacement' : ''})`).join(' · ')}
        </Hint>
      )}
      <DataTable
        rows={rows}
        loading={isLoading}
        columns={columns}
        searchText={(c) => `${c.name} ${c.domains.join(' ')} ${c.issuer} ${c.status}`}
        searchPlaceholder="Search name or domain…"
        defaultSort={{ id: 'expires', dir: 'asc' }}
        onRowClick={(c) => setDetail(c)}
        toolbar={<>
          {pro && <FilterChips value={status} onChange={setStatus} options={[
            { value: 'all', label: 'All', count: certs.length },
            ...(attention.length ? [{ value: 'attention' as const, label: 'Needs attention', count: attention.length }] : []),
            { value: 'letsencrypt', label: "Let's Encrypt", count: certs.filter((c) => c.issuer === 'letsencrypt').length },
            { value: 'custom', label: 'Uploaded', count: certs.filter((c) => c.issuer === 'custom').length },
          ]} />}
          <Button size="sm" variant="primary" icon={Plus} onClick={() => setIssueOpen(true)}>Add certificate</Button>
        </>}
        rowActions={(c) => (
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />} items={[
            { label: c.issuer === 'custom' ? 'Upload replacement' : 'Renew now', icon: c.issuer === 'custom' ? Upload : RefreshCw, disabled: c.status === 'pending' || c.status === 'renewing', onClick: () => doRenew(c) },
            ...(c.issuer === 'letsencrypt' ? [{ label: c.autoRenew ? 'Disable auto-renew' : 'Enable auto-renew', icon: ShieldCheck, onClick: () => toggle.mutate({ c, v: !c.autoRenew }) }] : []),
            { divider: true, label: '' },
            { label: 'Delete', icon: Trash2, danger: true, hint: c.usedBy?.length ? 'in use' : undefined, onClick: () => remove(c) },
          ]} />
        )}
        empty={{ icon: BadgeCheck, title: 'No certificates', description: emptyHint ?? 'Issue a free Let\'s Encrypt certificate or upload your own to terminate HTTPS on load balancers.', action: <Button variant="primary" icon={Plus} onClick={() => setIssueOpen(true)}>Add certificate</Button> }}
      />
      <IssueCertificateModal open={issueOpen} onClose={() => setIssueOpen(false)} defaultProjectId={projectId} />
      <RenewCustomModal cert={renewCustom} onClose={() => setRenewCustom(null)} />
      <CertificateDrawer cert={detail ? items.find((c) => c.id === detail.id) ?? detail : null} onClose={() => setDetail(null)} onRenew={doRenew} onDelete={remove} />
    </div>
  );
}

const SAMPLE_PEM = '-----BEGIN CERTIFICATE-----\nMIIF...\n-----END CERTIFICATE-----';

export function IssueCertificateModal({ open, onClose, defaultProjectId, onCreated }: { open: boolean; onClose: () => void; defaultProjectId?: string; onCreated?: (c: Certificate) => void }) {
  const [issuer, setIssuer] = useState<'letsencrypt' | 'custom'>('letsencrypt');
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState(defaultProjectId ?? '');
  const [domainsText, setDomainsText] = useState('');
  const [challenge, setChallenge] = useState<'http-01' | 'dns-01'>('http-01');
  const [keyType, setKeyType] = useState('ECDSA P-256');
  const [autoRenew, setAutoRenew] = useState(true);
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { items: zones } = useList<DnsZone>('dnsZones');
  const pro = usePro();
  useDefaultProject(projectId, setProjectId);

  const domains = domainsText.split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
  const wildcard = domains.some((d) => d.startsWith('*.'));
  const effChallenge = wildcard ? 'dns-01' : challenge;
  const publicZones = zones.filter((z) => z.kind === 'public' && z.projectId === projectId);
  const unmanaged = domains.filter((d) => { const b = d.replace(/^\*\./, ''); return !publicZones.some((z) => b === z.name || b.endsWith(`.${z.name}`)) });

  const reset = () => { setName(''); setDomainsText(''); setCertPem(''); setKeyPem(''); setExpiresAt(''); setErrors({}); setIssuer('letsencrypt'); setChallenge('http-01') };
  const create = useApiMutation(() => api.create<Certificate>('certificates', {
    name, projectId, issuer, domains,
    ...(issuer === 'letsencrypt' ? { challenge: effChallenge, keyType, autoRenew } : { certificatePem: certPem, privateKeyPem: keyPem, expiresAt: expiresAt || undefined, keyType }),
  }), {
    success: (c) => (c.issuer === 'letsencrypt' ? `Requesting certificate ${c.name} from Let's Encrypt` : `Uploaded ${c.name}`),
    onSuccess: (c) => { onCreated?.(c); reset(); onClose() },
    onError: (e: ApiClientError) => setErrors(fieldErrors(e)),
  });

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Add TLS certificate" description={pro ? 'Certificates terminate HTTPS on L7 load balancer listeners and renew without downtime.' : 'Free certificates renew automatically.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={issuer === 'letsencrypt' ? BadgeCheck : Upload} loading={create.isPending} disabled={!name || !domains.length || !projectId} onClick={() => create.mutate()}>{issuer === 'letsencrypt' ? 'Issue certificate' : 'Upload'}</Button></>}>
      <div className="space-y-4">
        <Segmented value={issuer} onChange={setIssuer} options={[{ value: 'letsencrypt', label: "Let's Encrypt (free)", icon: <BadgeCheck className="size-3.5" /> }, { value: 'custom', label: 'Upload PEM', icon: <Upload className="size-3.5" /> }]} />
        {pro ? (
          <div className="grid gap-4 @min-[36rem]:grid-cols-2">
            <Field label="Name" required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="example-com" invalid={!!errors.name} /></Field>
            <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />
          </div>
        ) : <Field label="Name" required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="example-com" invalid={!!errors.name} /></Field>}
        <Field label="Domains" required error={errors.domains} hint={pro ? 'Separate with spaces, commas or new lines. The first name becomes the subject; all names are SANs.' : 'Separate with commas, e.g. regiocom-energie.de, www.regiocom-energie.de'}>
          <Textarea rows={2} mono value={domainsText} onChange={(e) => setDomainsText(e.target.value)} placeholder="regiocom-energie.de, www.regiocom-energie.de" invalid={!!errors.domains} />
        </Field>
        {domains.length > 0 && <div className="flex flex-wrap gap-1">{domains.map((d) => <Badge key={d} tone={d.startsWith('*.') ? 'violet' : 'neutral'}>{d}</Badge>)}</div>}

        {issuer === 'letsencrypt' ? (
          <SimpleAdvanced description="Project, validation method, key type, auto-renew">
            {!pro && <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />}
            <Field label="Domain validation (ACME challenge)">
              <OptionCards cols={2} value={effChallenge} onChange={(v) => setChallenge(v)} options={[
                { value: 'http-01', title: 'HTTP-01', icon: <Globe2 className="size-4 text-brand-500" />, disabled: wildcard, description: 'Let\'s Encrypt fetches a token from http://<domain>/.well-known/acme-challenge/ — your load balancers answer automatically. The domain must already point at an Autark LB. No wildcards.' },
                { value: 'dns-01', title: 'DNS-01', icon: <AtSign className="size-4 text-cyan-500" />, description: 'Autark writes a _acme-challenge TXT record into your managed DNS zone. Works before traffic is pointed here and supports wildcards (*.regiocom-energie.de).' },
              ]} />
            </Field>
            {wildcard && <Hint>Wildcard names can only be validated with <b>DNS-01</b>.</Hint>}
            {effChallenge === 'dns-01' && domains.length > 0 && unmanaged.length > 0 && (
              <Hint tone="warning">No Autark-managed public zone covers {unmanaged.join(', ')} in this project — validation will fail. Create the zone under Networking → DNS first{wildcard ? '' : ', or use HTTP-01'}.</Hint>
            )}
            <div className="grid gap-4 @min-[36rem]:grid-cols-2">
              <Field label="Key type"><Select value={keyType} onChange={(e) => setKeyType(e.target.value)} options={[{ value: 'ECDSA P-256', label: 'ECDSA P-256 (recommended)' }, { value: 'RSA 2048', label: 'RSA 2048 (legacy clients)' }, { value: 'RSA 4096', label: 'RSA 4096' }]} /></Field>
              <div className="pt-6"><Switch checked={autoRenew} onChange={setAutoRenew} label="Auto-renew" description="Renews 30 days before the 90-day expiry." /></div>
            </div>
          </SimpleAdvanced>
        ) : (
          <>
            {!pro && <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />}
            <Field label="Certificate (PEM, incl. intermediate chain)" required error={errors.certificatePem}><Textarea rows={4} mono value={certPem} onChange={(e) => setCertPem(e.target.value)} placeholder={SAMPLE_PEM} invalid={!!errors.certificatePem} /></Field>
            <Field label="Private key (PEM, unencrypted)" required error={errors.privateKeyPem} hint={<span className="inline-flex items-center gap-1"><Lock className="size-3" /> Sealed with the platform KMS; never shown again.</span>}>
              <Textarea rows={3} mono value={keyPem} onChange={(e) => setKeyPem(e.target.value)} placeholder={'-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'} invalid={!!errors.privateKeyPem} />
            </Field>
            <Field label="Expires on" optional error={errors.expiresAt} hint="Defaults to one year from today. You'll be warned 30 days ahead."><Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></Field>
          </>
        )}
      </div>
    </Modal>
  );
}

function RenewCustomModal({ cert, onClose }: { cert: Certificate | null; onClose: () => void }) {
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useApiMutation(() => api.action('certificates', cert!.id, 'renew', { certificatePem: certPem, privateKeyPem: keyPem, expiresAt: expiresAt || undefined }), {
    success: 'Certificate replaced', onSuccess: () => { setCertPem(''); setKeyPem(''); setExpiresAt(''); setErrors({}); onClose() }, onError: (e) => setErrors(fieldErrors(e)),
  });
  return (
    <Modal open={!!cert} onClose={onClose} size="lg" title={`Replace ${cert?.name ?? ''}`} description={`Upload the renewed certificate for ${cert?.domains.join(', ')}. Listeners pick it up without a restart.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Upload} loading={m.isPending} onClick={() => m.mutate()}>Replace</Button></>}>
      <div className="space-y-4">
        <Field label="Certificate (PEM)" required error={errors.certificatePem}><Textarea rows={4} mono value={certPem} onChange={(e) => setCertPem(e.target.value)} placeholder={SAMPLE_PEM} /></Field>
        <Field label="Private key (PEM)" required error={errors.privateKeyPem}><Textarea rows={3} mono value={keyPem} onChange={(e) => setKeyPem(e.target.value)} placeholder={'-----BEGIN PRIVATE KEY-----\n...'} /></Field>
        <Field label="Expires on" optional error={errors.expiresAt}><Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function CertificateDrawer({ cert, onClose, onRenew, onDelete }: { cert: Certificate | null; onClose: () => void; onRenew: (c: Certificate) => void; onDelete: (c: Certificate) => void }) {
  const { items: ops } = useOperationsFor(cert?.id);
  const latest = ops[0];
  if (!cert) return null;
  return (
    <Drawer open onClose={onClose} title={cert.name} description={cert.domains.join(', ')}
      footer={<>
        <Button variant="outline-danger" icon={Trash2} onClick={() => onDelete(cert)}>Delete</Button>
        <Button icon={cert.issuer === 'custom' ? Upload : RefreshCw} disabled={cert.status === 'pending' || cert.status === 'renewing'} onClick={() => onRenew(cert)}>{cert.issuer === 'custom' ? 'Upload replacement' : 'Renew now'}</Button>
      </>}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2"><StatusPill status={cert.status} /><IssuerBadge cert={cert} />{cert.autoRenew && <Badge tone="brand">auto-renew</Badge>}</div>
        {cert.failureReason && cert.status === 'failed' && <Hint tone="danger"><span className="inline-flex items-start gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{cert.failureReason}</span></Hint>}
        <ExpiryMeter cert={cert} className="w-full" />
        <KeyValue items={[
          ['Issued', cert.issuedAt ? dateTime(cert.issuedAt) : '—'],
          ['Expires', dateTime(cert.expiresAt)],
          ['Key type', cert.keyType],
          ['Validation', cert.challenge?.toUpperCase() ?? 'n/a (uploaded)'],
          ['Serial', cert.serial ? <Mono copy>{cert.serial}</Mono> : '—'],
          ['Fingerprint', cert.fingerprint ? <Mono copy={cert.fingerprint}>{cert.fingerprint.slice(0, 26)}…</Mono> : '—'],
        ]} />
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">Subject alternative names</div>
          <div className="flex flex-wrap gap-1">{cert.domains.map((d) => <Badge key={d} tone={d.startsWith('*.') ? 'violet' : 'neutral'}>{d}</Badge>)}</div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">Used by</div>
          {cert.usedBy?.length ? <ul className="space-y-1">{cert.usedBy.map((u) => <li key={u.listenerId} className="flex items-center gap-2"><ResourceLink type="lb" id={u.lbId} name={u.lbName} /><span className="text-xs text-muted">HTTPS :{u.port}</span></li>)}</ul> : <p className="text-sm text-faint">Not attached to any listener.</p>}
        </div>
        {latest && <div><div className="mb-1.5 text-xs font-medium text-muted">Latest issuance</div><OperationRunner op={latest} compact /></div>}
      </div>
    </Drawer>
  );
}
