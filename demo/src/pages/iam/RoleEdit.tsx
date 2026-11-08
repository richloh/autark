import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Users, Save } from 'lucide-react';
import { useList, useApiMutation } from '@/api/hooks';
import { api, type ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea, Select, Hint } from '@/components/ui/form';
import { FormSection, CreateLayout, fieldErrors } from '@/components/ui/FormLayout';
import { IacTabs, toCli, toCurl } from '@/components/ui/CodeBlock';
import { toast } from '@/components/ui/toast';
import { RoleMatrixEditor, RoleSummary } from '@/components/iam/RoleDesigner';
import { normalize, countPermissions, expand, type Perms } from '@/components/iam/permissions';
import type { Role } from '@/types';

function hcl(name: string, description: string, perms: Perms) {
  const e = expand(perms);
  const lines = [`resource "autark_role" "${name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'custom'}" {`, `  name        = ${JSON.stringify(name || 'Custom role')}`, `  description = ${JSON.stringify(description)}`, ''];
  for (const [s, acts] of Object.entries(e)) lines.push(`  permission {`, `    service = "${s}"`, `    actions = [${acts!.map((a) => `"${a}"`).join(', ')}]`, `  }`);
  lines.push('}');
  return lines.join('\n');
}

export default function RoleEdit() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const { items: roles } = useList<Role>('roles');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [perms, setPerms] = useState<Perms>({ compute: ['read'], storage: ['read'], network: ['read'] });
  const [from, setFrom] = useState(sp.get('from') ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const src = roles.find((r) => r.id === from);
    if (src) { setPerms(structuredClone(src.permissions)); if (!name) setName(`${src.name} (custom)`); if (!description) setDescription(src.description) }
  }, [from, roles.length]); // eslint-disable-line

  const body = { name: name.trim(), description: description.trim(), permissions: normalize(perms), ...(from ? { clonedFrom: from } : {}) };
  const create = useApiMutation(() => api.create<Role>('roles', body), {
    silent: true,
    onSuccess: (r) => { toast.success(`Role ${r.name} created`, 'Assign it to users or system accounts.'); navigate(`/iam/roles/${r.id}`) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); setFormError(e.message); window.scrollTo({ top: 0, behavior: 'smooth' }) },
  });
  const dupName = roles.some((r) => r.name.toLowerCase() === name.trim().toLowerCase());
  const canSubmit = !!name.trim() && !dupName && countPermissions(perms) > 0;

  return (
    <Page wide>
      <PageHeader title="Create role" icon={Users} iconColor="#8b5cf6" crumbs={[{ label: 'Roles', to: '/iam/roles' }, { label: 'Create' }]}
        description="Pick exactly what holders may do. You'll see a plain-language summary and the blast radius as you go." />
      <CreateLayout aside={<>
        <RoleSummary perms={perms} />
        <div className="flex gap-2">
          <Button variant="ghost" to="/iam/roles">Cancel</Button>
          <Button variant="primary" icon={Save} className="flex-1" disabled={!canSubmit} loading={create.isPending} onClick={() => create.mutate()}>Create role</Button>
        </div>
      </>}>
        {formError && <Hint tone="danger">{formError}</Hint>}
        <FormSection step={1} title="Basics">
          <div className="grid [&>*]:min-w-0 gap-4 @min-[36rem]:grid-cols-2">
            <Field label="Name" required error={errors.name || (dupName ? 'A role with this name already exists' : undefined)}>
              <Input value={name} onChange={(e) => { setName(e.target.value); setErrors({}) }} placeholder="e.g. Database operator" invalid={!!errors.name || dupName} autoFocus />
            </Field>
            <Field label="Start from" optional hint="Copy permissions of an existing role">
              <Select value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Blank" options={roles.map((r) => ({ value: r.id, label: `${r.name}${r.system ? ' (system)' : ''}` }))} />
            </Field>
          </div>
          <Field label="Description" optional error={errors.description}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Who should get this role and why?" />
          </Field>
        </FormSection>
        <FormSection step={2} title="Permissions" description="Rows are services, columns are actions. Granting anything implies Read.">
          <RoleMatrixEditor perms={perms} onChange={(p) => { setPerms(p); setErrors({}) }} error={errors.permissions} />
        </FormSection>
        <FormSection step={3} title="Equivalent code">
          <IacTabs title="" snippets={{
            terraform: hcl(body.name, body.description, perms),
            cli: toCli('iam role create', { name: body.name || 'custom-role', description: body.description, permissions: Object.entries(expand(perms)).map(([s, a]) => `${s}:${a!.join('+')}`).join(',') }),
            curl: toCurl('POST', '/roles', body),
          }} />
        </FormSection>
      </CreateLayout>
    </Page>
  );
}
