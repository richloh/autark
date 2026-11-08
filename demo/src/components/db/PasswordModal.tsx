import { useState } from 'react';
import { Eye, EyeOff, KeyRound, ShieldAlert } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/misc';
import { Hint } from '@/components/ui/form';

/** Shows a freshly generated password exactly once. */
export function PasswordModal({ creds, onClose, title = 'Save this password' }: { creds: { username: string; password: string } | null; onClose: () => void; title?: string }) {
  const [shown, setShown] = useState(false);
  if (!creds) return null;
  return (
    <Modal
      open
      onClose={() => { setShown(false); onClose() }}
      title={title}
      icon={<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-500"><KeyRound className="size-[18px]" /></div>}
      description="This is the only time the password is shown. Autark does not store it in readable form."
      footer={<Button variant="primary" onClick={() => { setShown(false); onClose() }}>I have saved it</Button>}
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-line bg-surface-2/60 p-3">
          <div className="text-xs text-muted">Username</div>
          <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-sm text-fg">{creds.username}<CopyButton value={creds.username} /></div>
          <div className="mt-3 text-xs text-muted">Password</div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <code className="min-w-0 break-all font-mono text-sm text-fg">{shown ? creds.password : '•'.repeat(creds.password.length)}</code>
            <div className="flex shrink-0 items-center">
              <button type="button" onClick={() => setShown((s) => !s)} className="inline-flex size-6 items-center justify-center rounded-md text-faint hover:bg-surface-3 hover:text-fg" aria-label={shown ? 'Hide' : 'Show'}>
                {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
              <CopyButton value={creds.password} />
            </div>
          </div>
        </div>
        <Hint tone="warning"><span className="flex items-center gap-1.5 font-medium"><ShieldAlert className="size-3.5" /> Store it in your secret manager now.</span>If you lose it, reset the password from the Databases &amp; users tab.</Hint>
      </div>
    </Modal>
  );
}
