import { useState } from 'react';
import { KeyRound, Plus, RefreshCw, Ban, ShieldAlert, Eye, EyeOff, Clock } from 'lucide-react';
import { useApiMutation, useNow } from '@/api/hooks';
import { api, type ApiClientError } from '@/api/client';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal, confirm } from '@/components/ui/Modal';
import { Field, Input, Hint } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { StatusPill, Badge } from '@/components/ui/Badge';
import { CopyButton, EmptyState } from '@/components/ui/misc';
import { fieldErrors } from '@/components/ui/FormLayout';
import { toast } from '@/components/ui/toast';
import { timeAgo, dateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { ApiToken, TokenSecret } from '@/types';

const EXPIRY = [
  { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: '1 year' }, { value: '0', label: 'Never' },
];

/** Name + expiry form → calls `create` → shows the secret once. */
export function CreateTokenModal({ open, onClose, create, subject, kind }: {
  open: boolean; onClose: () => void; create: (body: { name: string; expiresInDays: number }) => Promise<TokenSecret>; subject: string; kind: 'user' | 'systemAccount';
}) {
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('90');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState<TokenSecret | null>(null);
  const m = useApiMutation(() => create({ name: name.trim(), expiresInDays: Number(expiry) }), {
    silent: true,
    onSuccess: (res) => { setSecret(res); toast.success('Token created', 'Copy it now — it will not be shown again.') },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); if (!Object.keys(fieldErrors(e)).length) toast.error('Could not create token', e.message) },
  });
  const close = () => { setName(''); setExpiry('90'); setErrors({}); setSecret(null); onClose() };
  if (secret) return <TokenRevealModal open={open} onClose={close} secret={secret} subject={subject} kind={kind} />;
  return (
    <Modal open={open} onClose={close} title="Create API token" description={`Tokens authenticate as ${subject} with exactly its roles and restrictions.`}
      icon={<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-brand-500"><KeyRound className="size-[18px]" /></div>}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!name.trim()} onClick={() => m.mutate()}>Create token</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) m.mutate() }}>
        <Field label="Name" required error={errors.name} hint="Where will this token be used? e.g. gitlab-prod, atlantis">
          <Input value={name} onChange={(e) => { setName(e.target.value); setErrors({}) }} placeholder="gitlab-prod" invalid={!!errors.name} autoFocus />
        </Field>
        <Field label="Expires" error={errors.expiresInDays}>
          <Segmented value={expiry} onChange={setExpiry} options={EXPIRY} />
        </Field>
        {expiry === '0' && <Hint tone="warning">Non-expiring tokens are a common source of leaks. Prefer an expiry and rotate regularly.</Hint>}
      </form>
    </Modal>
  );
}

/** Shows a freshly created secret exactly once, with copy and usage examples. */
export function TokenRevealModal({ open, onClose, secret, subject, kind, rotatedFrom }: { open: boolean; onClose: () => void; secret: TokenSecret; subject: string; kind: 'user' | 'systemAccount'; rotatedFrom?: ApiToken }) {
  const [show, setShow] = useState(false);
  const [tab, setTab] = useState<'curl' | 'terraform' | 'cli'>('curl');
  const [ack, setAck] = useState(false);
  const masked = secret.secret.slice(0, 14) + '•'.repeat(24) + secret.secret.slice(-4);
  const examples = {
    curl: `curl https://autark.regiocom-energie.de/api/v1/vms \\\n  -H "Authorization: Bearer ${secret.secret}"`,
    terraform: `terraform {\n  required_providers {\n    autark = {\n      source  = "autark-io/autark"\n      version = "~> 1.4"\n    }\n  }\n}\n\nprovider "autark" {\n  endpoint = "https://autark.regiocom-energie.de"\n  # export AUTARK_TOKEN=... instead of committing the secret\n  token    = var.autark_token\n}`,
    cli: `export AUTARK_TOKEN=${secret.secret}\nautark auth whoami\n# → ${kind === 'systemAccount' ? `svc:${subject}` : subject}\nautark vm list --project proj-compass`,
  };
  return (
    <Modal open={open} onClose={() => (ack ? onClose() : setAck(true))} size="lg" title={rotatedFrom ? `Token rotated — ${secret.token.name}` : `Token created — ${secret.token.name}`}
      description="This is the only time the secret is shown. Store it in your secret manager now."
      icon={<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500"><KeyRound className="size-[18px]" /></div>}
      footer={<>
        {ack && <span className="mr-auto text-xs text-amber-600 dark:text-amber-400">Closing hides the secret forever.</span>}
        <Button variant="primary" onClick={onClose}>I've stored it safely</Button>
      </>}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-2.5">
          <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg">{show ? secret.secret : masked}</code>
          <IconButton size="sm" icon={show ? EyeOff : Eye} label={show ? 'Hide' : 'Reveal'} onClick={() => setShow(!show)} />
          <CopyButton value={secret.secret} label="Copy token" className="size-8" />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span>Prefix <code className="font-mono text-fg-2">{secret.token.prefix}</code></span>
          <span>Expires {secret.token.expiresAt ? dateTime(secret.token.expiresAt) : 'never'}</span>
        </div>
        {rotatedFrom && (
          <Hint tone="warning">The previous token <code className="font-mono">{rotatedFrom.prefix}…</code> keeps working until <b>{dateTime(rotatedFrom.expiresAt)}</b> so you can roll out the new one without downtime.</Hint>
        )}
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted">Use it</span>
            <Segmented size="sm" value={tab} onChange={setTab} options={[{ value: 'curl', label: 'curl' }, { value: 'terraform', label: 'Terraform' }, { value: 'cli', label: 'CLI' }]} />
          </div>
          <CodeBlock code={examples[tab]} language={tab === 'terraform' ? 'hcl' : 'bash'} maxHeight="max-h-64" />
        </div>
      </div>
    </Modal>
  );
}

function expiryInfo(t: ApiToken, now: number) {
  if (!t.expiresAt) return { label: 'never', tone: t.status === 'active' ? 'warn' : 'none' } as const;
  const ms = Date.parse(t.expiresAt) - now;
  if (ms < 0) return { label: `expired ${timeAgo(t.expiresAt)}`, tone: 'none' } as const;
  return { label: timeAgo(t.expiresAt), tone: ms < 7 * 86_400_000 ? 'soon' : 'ok' } as const;
}

/** Token table with create / rotate / revoke. `collection` + `id` identify the owner. */
export function TokensTable({ tokens, collection, ownerId, ownerName, kind, canRotate = true, disabledReason }: {
  tokens: ApiToken[]; collection: 'users' | 'systemAccounts'; ownerId: string; ownerName: string; kind: 'user' | 'systemAccount'; canRotate?: boolean; disabledReason?: string;
}) {
  const now = useNow(30_000);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ secret: TokenSecret; from?: ApiToken } | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const rotate = useApiMutation((t: ApiToken) => api.action<TokenSecret>(collection, ownerId, 'rotateToken', { tokenId: t.id, overlapHours: 24 }).then((s) => ({ s, t })), {
    silent: true,
    onSuccess: ({ s, t }) => setRevealed({ secret: s, from: { ...t, expiresAt: new Date(Math.min(t.expiresAt ? Date.parse(t.expiresAt) : Infinity, Date.now() + 86_400_000)).toISOString() } }),
    onError: (e) => toast.error('Rotation failed', e.message),
  });
  const revoke = useApiMutation((t: ApiToken) => api.action(collection, ownerId, 'revokeToken', { tokenId: t.id }), { success: 'Token revoked' });

  const active = tokens.filter((t) => t.status === 'active');
  const inactive = tokens.filter((t) => t.status !== 'active');
  const rows = showInactive ? tokens : active;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="text-[13px] text-muted">{active.length} active{inactive.length > 0 && <> · <button className="text-brand-500 hover:underline" onClick={() => setShowInactive(!showInactive)}>{showInactive ? 'hide' : 'show'} {inactive.length} revoked/expired</button></>}</div>
        <Button size="sm" variant="primary" icon={Plus} disabled={!!disabledReason} title={disabledReason} onClick={() => setCreating(true)}>Create token</Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={KeyRound} title="No active tokens" description={kind === 'systemAccount' ? 'Create a token for your CI/CD pipeline, Terraform or monitoring.' : 'Personal tokens let you use the CLI and API as yourself.'} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-[13px]">
            <thead><tr className="border-b border-line bg-surface-2/50 text-xs text-muted">
              <th className="px-4 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Created</th><th className="px-3 py-2 font-medium">Last used</th><th className="px-3 py-2 font-medium">Expires</th><th className="w-20" />
            </tr></thead>
            <tbody>
              {rows.map((t) => {
                const exp = expiryInfo(t, now);
                const rotating = t.status === 'active' && !!t.rotatedTo;
                return (
                  <tr key={t.id} className={cn('border-b border-line last:border-0', t.status !== 'active' && 'opacity-60')}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-fg">{t.name}</div>
                      <code className="font-mono text-[11.5px] text-muted">{t.prefix}…</code>
                    </td>
                    <td className="px-3 py-2.5">{rotating ? <Badge tone="warning" dot pulse>rotating out</Badge> : <StatusPill status={t.status} />}</td>
                    <td className="px-3 py-2.5 text-fg-2" title={dateTime(t.createdAt)}>{timeAgo(t.createdAt)}</td>
                    <td className="px-3 py-2.5 text-fg-2" title={t.lastUsedIp ? `from ${t.lastUsedIp}` : undefined}>{t.lastUsed ? timeAgo(t.lastUsed) : <span className="text-faint">never</span>}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn('inline-flex items-center gap-1', exp.tone === 'soon' ? 'text-amber-600 dark:text-amber-400' : exp.tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-fg-2')} title={t.expiresAt ? dateTime(t.expiresAt) : 'No expiry'}>
                        {(exp.tone === 'soon' || rotating) && <Clock className="size-3" />}{exp.tone === 'warn' && <ShieldAlert className="size-3" />}{exp.label}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {t.status === 'active' && (
                        <div className="flex justify-end gap-0.5">
                          {canRotate && !rotating && <IconButton size="sm" icon={RefreshCw} label="Rotate (old token valid 24h)" onClick={async () => {
                            if (await confirm({ title: `Rotate ${t.name}?`, message: 'A new secret is issued now. The current one keeps working for 24 hours so you can update your pipelines without downtime.', confirmLabel: 'Rotate' })) rotate.mutate(t);
                          }} />}
                          <IconButton size="sm" icon={Ban} label="Revoke" className="hover:text-rose-500" onClick={async () => {
                            if (await confirm({ title: `Revoke ${t.name}?`, message: `Requests using ${t.prefix}… will fail immediately with 401. This cannot be undone.`, confirmLabel: 'Revoke', danger: true })) revoke.mutate(t);
                          }} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <CreateTokenModal open={creating} onClose={() => setCreating(false)} subject={ownerName} kind={kind}
        create={(body) => api.action<TokenSecret>(collection, ownerId, 'createToken', body)} />
      {revealed && <TokenRevealModal open onClose={() => setRevealed(null)} secret={revealed.secret} rotatedFrom={revealed.from} subject={ownerName} kind={kind} />}
    </div>
  );
}
