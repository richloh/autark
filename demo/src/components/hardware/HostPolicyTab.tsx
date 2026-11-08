import { useEffect, useState } from 'react';
import { Save, Undo2, Scale, Users } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation } from '@/api/hooks';
import { usePro } from '@/store/ui';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Hint } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { IacTabs, toCli, toCurl } from '@/components/ui/CodeBlock';
import { toast } from '@/components/ui/toast';
import { hostRoles, hostAccess, normaliseAccess } from '@/lib/hostPolicy';
import type { BareMetalHost, HostAccess, HostRole } from '@/types';
import { RoleToggleCards, AccessPicker, PolicyImpactList, usePolicyNames, usePolicyPreview, type PolicyImpactResult } from './policy';

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((r) => b.includes(r));
const sameAccess = (a: HostAccess, b: HostAccess) => a.mode === b.mode && (a.mode === 'all' || (same(a.accountIds, b.accountIds) && same(a.projectIds, b.projectIds)));

/** Host detail → Policy: workload roles + availability, with a live impact preview before saving. */
export function HostPolicyTab({ h }: { h: BareMetalHost }) {
  const pro = usePro();
  const { names, accounts, projects } = usePolicyNames();
  const [roles, setRoles] = useState<HostRole[]>(hostRoles(h));
  const [access, setAccess] = useState<HostAccess>(hostAccess(h));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [last, setLast] = useState<PolicyImpactResult | null>(null);
  const key = JSON.stringify([hostRoles(h), hostAccess(h)]);
  useEffect(() => { setRoles(hostRoles(h)); setAccess(hostAccess(h)) }, [h.id, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !same(roles, hostRoles(h)) || !sameAccess(normaliseAccess(access), hostAccess(h));
  const valid = roles.length > 0 && (access.mode === 'all' || access.accountIds.length + access.projectIds.length > 0);
  const preview = usePolicyPreview(h.id, roles, access, dirty && valid);
  const body = { roles, access: normaliseAccess(access) };
  const save = useApiMutation(() => api.action<PolicyImpactResult>('hosts', h.id, 'updatePolicy', body), {
    silent: true,
    onSuccess: (r) => {
      setErrors({}); setLast(r);
      toast.success('Policy saved', r.violations.length ? `${r.violations.length} running workload(s) conflict and keep running. New placements follow the policy.` : 'New placements follow the updated policy.');
    },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error('Policy not saved', e.message) },
  });

  return (
    <div className="grid gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        <Card>
          <CardHeader title="Workload roles" icon={Scale} description={pro ? 'Which workloads the scheduler may place on this host. Hosts with Storage form the Ceph pool of the location.' : 'What Autark may run on this server.'} />
          <CardBody><RoleToggleCards value={roles} onChange={setRoles} error={errors.roles} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Availability" icon={Users} description={pro ? 'Restrict the host to accounts or projects. A workload may use it if its account OR its project is selected.' : 'Who may use this server.'} />
          <CardBody><AccessPicker value={access} onChange={setAccess} accounts={accounts} projects={projects} error={errors.access ?? errors['access.accountIds'] ?? errors['access.projectIds']} /></CardBody>
        </Card>
      </div>

      <div className="space-y-4 @min-[60rem]:sticky @min-[60rem]:top-20 @min-[60rem]:self-start">
        <Card className="p-4">
          <div className="mb-3 text-sm font-semibold text-fg">{dirty ? 'Impact of your changes' : 'Current policy'}</div>
          {dirty ? (
            valid ? <PolicyImpactList impact={preview.data} loading={preview.isFetching && !preview.data} names={names} />
              : <Hint tone="warning">{!roles.length ? 'Enable at least one role.' : 'Select at least one account or project.'}</Hint>
          ) : last ? (
            <PolicyImpactList impact={last} names={names} />
          ) : (
            <p className="text-[13px] text-muted">Change roles or availability to see which running workloads would be affected before you save.</p>
          )}
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-line pt-3">
            {dirty && <Button variant="ghost" icon={Undo2} onClick={() => { setRoles(hostRoles(h)); setAccess(hostAccess(h)); setErrors({}) }}>Reset</Button>}
            <Button variant="primary" icon={Save} disabled={!dirty || !valid} loading={save.isPending} onClick={() => save.mutate()}>Save policy</Button>
          </div>
        </Card>
        <IacTabs snippets={{
          cli: toCli('host set-policy', { id: h.id, roles: roles.join(','), ...(access.mode === 'restricted' ? { accounts: access.accountIds.join(',') || undefined, projects: access.projectIds.join(',') || undefined } : { access: 'all' }) }),
          curl: toCurl('POST', `/hosts/${h.id}/actions/updatePolicy`, body),
        }} />
      </div>
    </div>
  );
}
