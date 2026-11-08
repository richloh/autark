import { useMemo, useState } from 'react';
import { UserPlus, Code2 } from 'lucide-react';
import { useApiMutation } from '@/api/hooks';
import { api, type ApiClientError } from '@/api/client';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea, Switch, Hint, Select } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { Advanced } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import { IacTabs, toCli, toCurl, toHcl } from '@/components/ui/CodeBlock';
import { fieldErrors } from '@/components/ui/FormLayout';
import { toast } from '@/components/ui/toast';
import { RolePicker, ProjectScopePicker } from './AccessEditor';
import type { User } from '@/types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** The four roles most teams need — offered as a plain dropdown in simple mode. */
const SIMPLE_ROLES = [
  { value: 'role-admin', label: 'Admin — full access, incl. team & billing' },
  { value: 'role-ops', label: 'Operations — run all infrastructure' },
  { value: 'role-developer', label: 'Developer — build in their projects' },
  { value: 'role-viewer', label: 'Viewer — read-only' },
];

/** Invite one or many people (comma / newline separated) with roles and project access. */
export function InviteUserModal({ open, onClose, onInvited }: { open: boolean; onClose: () => void; onInvited?: (users: User[]) => void }) {
  const pro = usePro();
  const [emails, setEmails] = useState('');
  const [name, setName] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>(['role-developer']);
  const [projectIds, setProjectIds] = useState<string[] | '*'>(pro ? [] : '*');
  const [mfaRequired, setMfaRequired] = useState(true);
  const [sso, setSso] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showCode, setShowCode] = useState(false);

  const list = useMemo(() => [...new Set(emails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))], [emails]);
  const invalid = list.filter((e) => !EMAIL_RE.test(e));
  const single = list.length <= 1;
  const body = { email: list[0] ?? 'jane@example.com', ...(single && name ? { name } : {}), roleIds, projectIds, mfaRequired, sso };

  const reset = () => { setEmails(''); setName(''); setRoleIds(['role-developer']); setProjectIds(pro ? [] : '*'); setMfaRequired(true); setSso(false); setErrors({}); setShowCode(false) };
  const close = () => { reset(); onClose() };

  const invite = useApiMutation(async () => {
    setErrors({});
    const ok: User[] = []; const failed: { email: string; msg: string; e: ApiClientError }[] = [];
    for (const email of list) {
      try { ok.push(await api.create<User>('users', { ...body, email, name: single ? name : undefined })) }
      catch (e) { failed.push({ email, msg: (e as ApiClientError).message, e: e as ApiClientError }) }
    }
    return { ok, failed };
  }, {
    silent: true,
    onSuccess: ({ ok, failed }) => {
      if (ok.length) toast.success(ok.length === 1 ? `Invitation sent to ${ok[0].email}` : `${ok.length} invitations sent`, 'They will receive an email with a sign-up link valid for 7 days.');
      if (failed.length) {
        const fe = fieldErrors(failed[0].e);
        setErrors({ ...fe, ...(fe.email || list.length > 1 ? { email: failed.map((f) => `${f.email}: ${f.msg}`).join(' · ') } : {}) });
        if (!Object.keys(fe).length && list.length === 1) toast.error('Invitation failed', failed[0].msg);
        setEmails(failed.map((f) => f.email).join(', '));
      } else { onInvited?.(ok); close() }
    },
  });

  const simpleRole = roleIds.length === 1 && SIMPLE_ROLES.some((r) => r.value === roleIds[0]) ? roleIds[0] : null;
  const canSubmit = list.length > 0 && !invalid.length && roleIds.length > 0 && (projectIds === '*' || projectIds.length > 0);

  return (
    <Modal open={open} onClose={close} size={pro ? 'xl' : 'lg'} title={pro ? 'Invite people' : 'Invite to team'} description={pro ? 'Invitees get an email to set up their account (or sign in via SSO). Access is granted as soon as they accept.' : 'They get an email with a link to join.'}
      icon={<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-brand-500"><UserPlus className="size-[18px]" /></div>}
      footer={<>
        {pro ? <Button variant="ghost" icon={Code2} className="mr-auto" onClick={() => setShowCode(!showCode)}>{showCode ? 'Hide' : 'Show'} code</Button> : <span className="mr-auto" />}
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" loading={invite.isPending} disabled={!canSubmit} onClick={() => invite.mutate()}>{list.length > 1 ? `Send ${list.length} invitations` : 'Send invitation'}</Button>
      </>}>
      {!pro ? (
      <div className="space-y-5">
        <Field label="Email" required error={errors.email || (invalid.length ? `Invalid: ${invalid.join(', ')}` : undefined)} hint="Add several, separated by commas.">
          <Textarea value={emails} onChange={(e) => { setEmails(e.target.value); setErrors({}) }} placeholder="jane@example.com" className="min-h-[38px]" rows={list.length > 1 ? 3 : 1} invalid={!!errors.email || invalid.length > 0} autoFocus />
        </Field>
        <Field label="Role" required error={errors.roleIds}>
          <Select value={simpleRole ?? 'custom'} onChange={(e) => { if (e.target.value !== 'custom') setRoleIds([e.target.value]) }}
            options={[...SIMPLE_ROLES, ...(simpleRole ? [] : [{ value: 'custom', label: `Custom: ${roleIds.length} role${roleIds.length === 1 ? '' : 's'} (see Advanced)` }])]} />
        </Field>
        <Field label="Projects" required>
          <Segmented value={projectIds === '*' ? 'all' : 'some'} onChange={(v) => setProjectIds(v === 'all' ? '*' : [])} options={[{ value: 'all', label: 'All projects' }, { value: 'some', label: 'Choose projects' }]} />
        </Field>
        {projectIds !== '*' && <ProjectScopePicker value={projectIds} onChange={setProjectIds} error={errors.projectIds} hideAllSwitch />}
        <Advanced title="Advanced" description={`Name · ${mfaRequired ? 'MFA required' : 'MFA optional'}${sso ? ' · SSO' : ''} · custom roles`}>
          <Field label="Full name" optional hint={single ? 'Defaults to the email name' : 'Only for single invites'}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" disabled={!single} />
          </Field>
          <div className="grid [&>*]:min-w-0 gap-3 @min-[36rem]:grid-cols-2">
            <div className="rounded-xl border border-line p-3"><Switch checked={mfaRequired} onChange={setMfaRequired} label="Require MFA" description="Must enroll TOTP or a security key at first sign-in." /></div>
            <div className="rounded-xl border border-line p-3"><Switch checked={sso} onChange={setSso} label="Single sign-on" description="Authenticate via your identity provider (OIDC)." /></div>
          </div>
          <Field label="Roles (combine several)" hint="Effective permissions are the union of all assigned roles.">
            <RolePicker value={roleIds} onChange={setRoleIds} compact />
          </Field>
        </Advanced>
        {roleIds.includes('role-admin') && <Hint tone="warning">Administrators have full control over every service, IAM and billing. Grant this sparingly.</Hint>}
      </div>
      ) : (
      <div className="space-y-5">
        <div className="grid [&>*]:min-w-0 gap-4 @min-[36rem]:grid-cols-[minmax(0,1fr)_220px]">
          <Field label="Email addresses" required error={errors.email || (invalid.length ? `Invalid: ${invalid.join(', ')}` : undefined)} hint="Separate several addresses with commas or new lines.">
            <Textarea value={emails} onChange={(e) => { setEmails(e.target.value); setErrors({}) }} placeholder="jane@example.com, joe@example.com" className="min-h-[38px]" rows={list.length > 1 ? 3 : 1} invalid={!!errors.email || invalid.length > 0} />
          </Field>
          <Field label="Full name" optional hint={single ? 'Defaults to the email name' : 'Only for single invites'}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" disabled={!single} />
          </Field>
        </div>
        <Field label="Roles" required hint="Effective permissions are the union of all assigned roles.">
          <RolePicker value={roleIds} onChange={setRoleIds} error={errors.roleIds} compact />
        </Field>
        <Field label="Project access" required>
          <ProjectScopePicker value={projectIds} onChange={setProjectIds} error={errors.projectIds} />
        </Field>
        <div className="grid [&>*]:min-w-0 gap-3 @min-[36rem]:grid-cols-2">
          <div className="rounded-xl border border-line p-3"><Switch checked={mfaRequired} onChange={setMfaRequired} label="Require MFA" description="Must enroll TOTP or a security key at first sign-in." /></div>
          <div className="rounded-xl border border-line p-3"><Switch checked={sso} onChange={setSso} label="Single sign-on" description="Authenticate via your identity provider (OIDC)." /></div>
        </div>
        {roleIds.includes('role-admin') && <Hint tone="warning">Administrators have full control over every service, IAM and billing. Grant this sparingly.</Hint>}
        {showCode && (
          <IacTabs snippets={{
            cli: toCli('iam user invite', { email: body.email, role: roleIds.join(','), project: projectIds === '*' ? '*' : projectIds.join(','), requireMfa: mfaRequired, sso }),
            terraform: toHcl('user', body.email.split('@')[0], { email: body.email, roleIds, projectIds: projectIds === '*' ? ['*'] : projectIds, mfaRequired, sso }),
            curl: toCurl('POST', '/users', body),
          }} />
        )}
      </div>
      )}
    </Modal>
  );
}
