import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyRound, Upload, CheckCircle2, XCircle, Sparkles, ShieldCheck } from 'lucide-react';
import { api, ApiClientError } from '@/api/client';
import { useApiMutation } from '@/api/hooks';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { CodeBlock, IacTabs, toCli, toCurl, toHcl } from '@/components/ui/CodeBlock';
import { Badge } from '@/components/ui/Badge';
import { parsePublicKey, fingerprintOf } from '@/mock/handlers/compute';
import { cn } from '@/lib/cn';
import type { SshKey } from '@/types';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function exampleKey() {
  let s = '';
  for (let i = 0; i < 43; i++) s += B64[Math.floor(Math.random() * 64)];
  return `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${s} you@workstation`;
}

/** Add an SSH public key with live validation and fingerprint preview. */
export function AddSshKeyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [publicKey, setPublicKey] = useState('');
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setName(''); setNameTouched(false); setPublicKey(''); setErrors({}) } }, [open]);

  const parsed = useMemo(() => (publicKey.trim() ? parsePublicKey(publicKey) : null), [publicKey]);
  const fp = parsed?.ok ? fingerprintOf(parsed.body) : null;
  useEffect(() => {
    if (!nameTouched && parsed?.ok && parsed.comment) setName(parsed.comment.replace(/[^a-z0-9-]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '').slice(0, 63));
  }, [parsed, nameTouched]);

  const readFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 16_384) { setErrors({ publicKey: 'File is too large to be a public key' }); return }
    f.text().then((t) => setPublicKey(t.trim()));
  };

  const body = { name, publicKey: publicKey.trim() };
  const m = useApiMutation(() => api.create<SshKey>('sshKeys', body), {
    success: (k) => `SSH key ${k.name} added`,
    onSuccess: onClose,
    onError: (e: ApiClientError) => setErrors(fieldErrors(e)),
  });
  const err = errors.publicKey ?? (parsed && !parsed.ok ? parsed.error : undefined);

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Add SSH key" icon={<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-brand-500"><KeyRound className="size-[18px]" /></div>}
      description="Public keys are injected into new VMs via cloud-init. Only the public half ever leaves your machine."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={KeyRound} loading={m.isPending} disabled={!parsed?.ok} onClick={() => m.mutate()}>Add key</Button></>}>
      <div className="space-y-4">
        <Field label="Public key" required error={err}
          action={<div className="flex gap-1">
            <Button size="xs" variant="ghost" icon={Upload} onClick={() => fileRef.current?.click()}>Load .pub</Button>
            <Button size="xs" variant="ghost" icon={Sparkles} onClick={() => setPublicKey(exampleKey())}>Example</Button>
          </div>}>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); readFile(e.dataTransfer.files[0]) }}
            className={cn('relative rounded-lg', dragging && 'ring-3 ring-brand-500/30')}
          >
            <Textarea mono rows={4} value={publicKey} onChange={(e) => { setPublicKey(e.target.value); setErrors((x) => ({ ...x, publicKey: '' })) }} invalid={!!err}
              placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA… you@host   (paste, or drop your id_ed25519.pub here)" className="break-all" />
            {dragging && <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-brand-500/10 text-sm font-medium text-brand-600 dark:text-brand-300">Drop .pub file</div>}
          </div>
          <input ref={fileRef} type="file" accept=".pub,text/plain" className="hidden" onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = '' }} />
        </Field>

        {parsed && (
          <div className={cn('flex items-start gap-2.5 rounded-xl border p-3 text-[13px]', parsed.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5')}>
            {parsed.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />}
            {parsed.ok ? (
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-fg">Valid {parsed.type} key</span>
                  <Badge tone={parsed.type === 'rsa' ? 'neutral' : 'success'}>{parsed.bits} bit</Badge>
                  {parsed.type === 'ed25519' && <Badge tone="success"><ShieldCheck className="size-3" />recommended</Badge>}
                  {parsed.comment && <span className="text-xs text-muted">· {parsed.comment}</span>}
                </div>
                <div className="break-all font-mono text-[11.5px] text-fg-2">{fp}</div>
              </div>
            ) : <span className="text-rose-700 dark:text-rose-300">{parsed.error}</span>}
          </div>
        )}

        <Field label="Name" required error={errors.name} hint="Defaults to the key comment. Lowercase, digits and dashes.">
          <Input value={name} onChange={(e) => { setName(e.target.value.toLowerCase()); setNameTouched(true) }} placeholder="dennis-laptop" invalid={!!errors.name} />
        </Field>

        <details className="group rounded-xl border border-line p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted">Don't have a key yet?</summary>
          <div className="mt-3 space-y-2 text-[13px] text-fg-2">
            <p>Generate an ed25519 key pair and copy the public half:</p>
            <CodeBlock language="bash" code={'ssh-keygen -t ed25519 -C "you@host"\ncat ~/.ssh/id_ed25519.pub'} />
            <p className="text-xs text-muted">On Windows use PowerShell (OpenSSH is built in) — the same commands work.</p>
          </div>
        </details>
        <details className="rounded-xl border border-line p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted">Equivalent code</summary>
          <IacTabs className="mt-3" snippets={{
            terraform: toHcl('ssh_key', name || 'my_key', { name, publicKey: 'file("~/.ssh/id_ed25519.pub")' }).replace('"file(\\"~/.ssh/id_ed25519.pub\\")"', 'file("~/.ssh/id_ed25519.pub")'),
            cli: toCli('ssh-key add', { name, publicKeyFile: '~/.ssh/id_ed25519.pub' }),
            curl: toCurl('POST', '/sshKeys', { name, publicKey: publicKey.trim() ? publicKey.trim().slice(0, 48) + '…' : 'ssh-ed25519 AAAA…' }),
          }} />
        </details>
      </div>
    </Modal>
  );
}

/** Rename an SSH key. */
export function RenameSshKeyModal({ sshKey, onClose }: { sshKey: SshKey | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (sshKey) { setName(sshKey.name); setErrors({}) } }, [sshKey]);
  const m = useApiMutation(() => api.update('sshKeys', sshKey!.id, { name }), { success: 'Key renamed', onSuccess: onClose, onError: (e: ApiClientError) => setErrors(fieldErrors(e)) });
  return (
    <Modal open={!!sshKey} onClose={onClose} size="sm" title="Rename SSH key" description={sshKey?.fingerprint}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <Field label="Name" error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} invalid={!!errors.name} onKeyDown={(e) => e.key === 'Enter' && m.mutate()} /></Field>
    </Modal>
  );
}
