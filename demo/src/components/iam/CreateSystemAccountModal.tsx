import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Bot, Code2 } from 'lucide-react';
import { useApiMutation } from '@/api/hooks';
import { api, type ApiClientError } from '@/api/client';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Switch, TagEditor, Hint } from '@/components/ui/form';
import { IacTabs, toCli, toCurl, toHcl } from '@/components/ui/CodeBlock';
import { fieldErrors } from '@/components/ui/FormLayout';
import { toast } from '@/components/ui/toast';
import { RolePicker, ProjectScopePicker } from './AccessEditor';
import { CidrListEditor } from './CidrListEditor';
import { TokenRevealModal } from './Tokens';
import type { SystemAccount, TokenSecret } from '@/types';

const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function CreateSystemAccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[] | '*'>([]);
  const [ipAllowlist, setIpAllowlist] = useState<string[]>([]);
  const [tagConditions, setTagConditions] = useState<{ key: string; value: string }[]>([]);
  const [withToken, setWithToken] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [code, setCode] = useState(false);
  const [created, setCreated] = useState<{ svc: SystemAccount; secret: TokenSecret } | null>(null);

  const body = { name, description, roleIds, projectIds, ipAllowlist, tagConditions };
  const reset = () => { setName(''); setDescription(''); setRoleIds([]); setProjectIds([]); setIpAllowlist([]); setTagConditions([]); setWithToken(true); setErrors({}); setCode(false); setCreated(null) };
  const close = () => { reset(); onClose() };

  const create = useApiMutation(async () => {
    setErrors({});
    const svc = await api.create<SystemAccount>('systemAccounts', body);
    let secret: TokenSecret | null = null;
    if (withToken) {
      try { secret = await api.action<TokenSecret>('systemAccounts', svc.id, 'createToken', { name: 'default', expiresInDays: 90 }) }
      catch (e) { toast.warning('Account created, but the token could not be issued', `${(e as Error).message} — create one from the Tokens tab.`) }
    }
    return { svc, secret };
  }, {
    silent: true,
    onSuccess: ({ svc, secret }) => {
      toast.success(`System account ${svc.name} created`);
      if (secret) setCreated({ svc, secret });
      else { close(); navigate(`/iam/system-accounts/${svc.id}`) }
    },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); if (!Object.keys(fieldErrors(e)).length) toast.error('Could not create system account', e.message) },
  });

  if (created) {
    return <TokenRevealModal open onClose={() => { const id = created.svc.id; close(); navigate(`/iam/system-accounts/${id}`) }} secret={created.secret} subject={created.svc.name} kind="systemAccount" />;
  }

  const nameErr = name && !NAME_RE.test(name) ? 'Lowercase letters, digits and dashes' : undefined;
  const canSubmit = !!name && !nameErr && roleIds.length > 0 && (projectIds === '*' || projectIds.length > 0);

  return (
    <Modal open={open} onClose={close} size="xl" title="Create system account" description="A non-human identity for CI/CD, Terraform, monitoring and other automation. Authenticates with API tokens."
      icon={<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-500"><Bot className="size-[18px]" /></div>}
      footer={<>
        <Button variant="ghost" icon={Code2} className="mr-auto" onClick={() => setCode(!code)}>{code ? 'Hide' : 'Show'} code</Button>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!canSubmit} loading={create.isPending} onClick={() => create.mutate()}>Create</Button>
      </>}>
      <div className="space-y-5">
        <div className="grid [&>*]:min-w-0 gap-4 @min-[36rem]:grid-cols-2">
          <Field label="Name" required error={errors.name || nameErr} hint="Shown in audit logs as svc:name">
            <Input value={name} onChange={(e) => { setName(e.target.value); setErrors({}) }} placeholder="github-actions" mono invalid={!!errors.name || !!nameErr} />
          </Field>
          <Field label="Description" optional error={errors.description}>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Deploys the web shop from GitHub" />
          </Field>
        </div>
        <Field label="Roles" required hint="Grant the least privilege the automation needs."><RolePicker value={roleIds} onChange={setRoleIds} error={errors.roleIds} compact /></Field>
        <Field label="Project access" required><ProjectScopePicker value={projectIds} onChange={setProjectIds} error={errors.projectIds} /></Field>
        <div className="grid [&>*]:min-w-0 gap-5 @min-[40rem]:grid-cols-2">
          <Field label="IP allowlist" optional hint="Tokens are rejected from other source addresses."><CidrListEditor value={ipAllowlist} onChange={setIpAllowlist} error={errors.ipAllowlist} /></Field>
          <Field label="Tag conditions" optional error={errors.tagConditions} hint="Can only act on resources carrying all of these tags (ABAC).">
            <TagEditor value={tagConditions} onChange={setTagConditions} suggestions={['managed-by', 'env', 'app']} />
          </Field>
        </div>
        <div className="rounded-xl border border-line p-3"><Switch checked={withToken} onChange={setWithToken} label="Create a first API token" description="90-day token named “default”. The secret is shown once after creation." /></div>
        {roleIds.includes('role-admin') && <Hint tone="danger">Giving automation the Administrator role means a leaked token can change IAM and delete hardware. Prefer a narrower custom role.</Hint>}
        {code && <IacTabs snippets={{ terraform: toHcl('system_account', name || 'automation', body), cli: toCli('iam system-account create', body), curl: toCurl('POST', '/systemAccounts', body) }} />}
      </div>
    </Modal>
  );
}
