import { useEffect, useState } from 'react';
import { Users, Gauge as GaugeIcon, Ruler, ShieldCheck, Save, Undo2, DoorOpen, HardDrive } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation } from '@/api/hooks';
import { usePro } from '@/store/ui';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, NumberInput, Slider, Switch, OptionCards, MultiSelect, Hint } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { IacTabs, toCurl } from '@/components/ui/CodeBlock';
import { toast } from '@/components/ui/toast';
import { AccessPicker, usePolicyNames } from '@/components/hardware/policy';
import { normaliseAccess } from '@/lib/hostPolicy';
import type { SpaceQuota, HostAccess } from '@/types';
import { CapacityBar, capacityOf, n1, type PlatformClusterView } from './shared';

const STORAGE_CLASSES = ['autark-nvme', 'autark-ssd', 'autark-hdd', 'ceph-rbd', 'ceph-fs'];
const QUOTA_FIELDS: { key: keyof SpaceQuota; label: string; unit: string; step: number; max: number }[] = [
  { key: 'cpuCores', label: 'CPU', unit: 'cores', step: 1, max: 64 },
  { key: 'memoryGi', label: 'Memory', unit: 'GiB', step: 4, max: 256 },
  { key: 'storageGi', label: 'Storage', unit: 'GiB', step: 50, max: 4000 },
  { key: 'pods', label: 'Pods', unit: '', step: 10, max: 500 },
  { key: 'loadBalancers', label: 'Load balancers', unit: '', step: 1, max: 10 },
];

/** Platform cluster → Policy: who may place spaces, overcommit, limits per space, pod security. */
export function PcPolicy({ pc }: { pc: PlatformClusterView }) {
  const pro = usePro();
  const { accounts, projects } = usePolicyNames();
  const init = () => ({
    access: { mode: pc.access.mode, accountIds: [...pc.access.accountIds], projectIds: [...pc.access.projectIds] } as HostAccess,
    overcommit: { ...pc.overcommit }, maxTenantQuota: { ...pc.maxTenantQuota }, podSecurity: pc.podSecurity, storageClasses: [...pc.storageClasses], acceptingTenants: pc.acceptingTenants,
  });
  const [form, setForm] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const key = JSON.stringify(init());
  useEffect(() => { setForm(init()); setErrors({}) }, [pc.id, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(form) !== key;
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const body = { ...form, access: normaliseAccess(form.access) };
  const save = useApiMutation(() => api.action<{ warnings: string[] }>('platformClusters', pc.id, 'updatePolicy', body), {
    silent: true,
    onSuccess: (r) => { setErrors({}); toast.success('Policy saved', r.warnings?.length ? r.warnings.slice(0, 2).join(' ') : 'New spaces follow the updated policy.') },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error('Policy not saved', e.message) },
  });

  const cap = capacityOf(pc);
  const prom = pc.promised ?? { cpuCores: 0, memoryGi: 0, spaces: 0 };
  const used = pc.used ?? { cpuCores: 0, memoryGi: 0, pods: 0 };
  const cpuTooLow = prom.cpuCores > cap.cpuCores * form.overcommit.cpu;
  const memTooLow = prom.memoryGi > cap.memoryGi * form.overcommit.memory;

  return (
    <div className="grid [&>*]:min-w-0 gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        <Card>
          <CardHeader title="New spaces" icon={DoorOpen} />
          <CardBody>
            <Switch checked={form.acceptingTenants} onChange={(v) => set('acceptingTenants', v)} label="Accept new spaces"
              description={form.acceptingTenants ? 'Customers can place new spaces here.' : 'Closed (cordoned): existing spaces keep running and can resize within capacity; new spaces go to other clusters.'} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Availability" icon={Users} description={pro ? 'Same rules as host availability: a space may land here if its account OR its project is selected.' : 'Who may create spaces on this cluster.'} />
          <CardBody>
            <AccessPicker value={form.access} onChange={(v) => set('access', v)} accounts={accounts} projects={projects} error={errors.access ?? errors['access.accountIds'] ?? errors['access.projectIds']} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Overcommit" icon={GaugeIcon} description="How much quota you may promise per unit of allocatable capacity. Higher means more tenants per node — and more risk of contention." />
          <CardBody className="space-y-6">
            <div>
              <div className="mb-1 flex items-baseline justify-between"><span className="text-[13px] font-medium text-fg">CPU</span><span className="text-sm font-semibold tabular text-fg">×{form.overcommit.cpu.toFixed(2).replace(/0$/, '')}</span></div>
              <Slider value={form.overcommit.cpu} min={1} max={3} step={0.05} marks={[1, 1.5, 2, 2.5, 3]} format={(v) => `×${v}`} onChange={(v) => set('overcommit', { ...form.overcommit, cpu: Math.round(v * 100) / 100 })} />
              <CapacityBar className="mt-4" unit="cores" capacity={cap.cpuCores} overcommit={form.overcommit.cpu} promised={prom.cpuCores} used={used.cpuCores} size="sm" />
              <div className={cpuTooLow ? 'mt-1.5 text-xs text-rose-600 dark:text-rose-400' : 'mt-1.5 text-xs text-muted'}>
                {cpuTooLow ? `Too low: ${n1(prom.cpuCores)} cores are already promised.` : `Promisable: ${n1(Math.round(cap.cpuCores * form.overcommit.cpu * 10) / 10)} cores (${n1(Math.round((cap.cpuCores * form.overcommit.cpu - prom.cpuCores) * 10) / 10)} still free).`}
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-baseline justify-between"><span className="text-[13px] font-medium text-fg">Memory</span><span className="text-sm font-semibold tabular text-fg">×{form.overcommit.memory.toFixed(2).replace(/0$/, '')}</span></div>
              <Slider value={form.overcommit.memory} min={1} max={1.5} step={0.05} marks={[1, 1.1, 1.2, 1.3, 1.4, 1.5]} format={(v) => `×${v}`} onChange={(v) => set('overcommit', { ...form.overcommit, memory: Math.round(v * 100) / 100 })} />
              <CapacityBar className="mt-4" unit="GiB" capacity={cap.memoryGi} overcommit={form.overcommit.memory} promised={prom.memoryGi} used={used.memoryGi} size="sm" />
              <div className={memTooLow ? 'mt-1.5 text-xs text-rose-600 dark:text-rose-400' : 'mt-1.5 text-xs text-muted'}>
                {memTooLow ? `Too low: ${n1(prom.memoryGi)} GiB are already promised.` : `Promisable: ${n1(Math.round(cap.memoryGi * form.overcommit.memory))} GiB. Memory can't be throttled — keep this close to 1.`}
              </div>
            </div>
            {(errors['overcommit.cpu'] || errors['overcommit.memory']) && <Hint tone="danger">{errors['overcommit.cpu'] ?? errors['overcommit.memory']}</Hint>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Max quota per space" icon={Ruler} description="The largest space a customer can create or resize to on this cluster." />
          <CardBody>
            <div className="grid [&>*]:min-w-0 grid-cols-1 gap-4 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-3">
              {QUOTA_FIELDS.filter((f) => pro || f.key === 'cpuCores' || f.key === 'memoryGi' || f.key === 'storageGi').map((f) => (
                <Field key={f.key} label={f.label} error={errors[`maxTenantQuota.${f.key}`]}>
                  <NumberInput value={form.maxTenantQuota[f.key]} min={f.key === 'loadBalancers' || f.key === 'storageGi' ? 0 : 1} max={f.max} step={f.step} unit={f.unit} onChange={(v) => set('maxTenantQuota', { ...form.maxTenantQuota, [f.key]: v })} />
                </Field>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Security & storage" icon={ShieldCheck} />
          <CardBody className="space-y-5">
            <Field label="Pod security standard" error={errors.podSecurity}>
              <OptionCards cols={2} value={form.podSecurity} onChange={(v) => set('podSecurity', v)} options={[
                { value: 'restricted', title: 'Restricted', description: 'Non-root, no privilege escalation, seccomp. Recommended for multi-tenant clusters.' },
                { value: 'baseline', title: 'Baseline', description: 'Blocks known privilege escalations; allows most images unchanged.' },
              ]} />
            </Field>
            <Field label={<span className="flex items-center gap-1.5"><HardDrive className="size-3.5 text-muted" />Storage classes offered to tenants</span>} error={errors.storageClasses}>
              <MultiSelect value={form.storageClasses} onChange={(v) => set('storageClasses', v)} options={[...new Set([...STORAGE_CLASSES, ...pc.storageClasses])].map((c) => ({ value: c, label: c }))} />
            </Field>
          </CardBody>
        </Card>
      </div>

      <div className="space-y-4 @min-[60rem]:sticky @min-[60rem]:top-20 @min-[60rem]:self-start">
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold text-fg">{dirty ? 'Unsaved changes' : 'Policy is up to date'}</div>
          <p className="text-[13px] text-muted">{dirty ? 'Running spaces are never evicted by a policy change; it applies to new spaces and resizes.' : 'Changes apply to new spaces and resizes. Running spaces keep working.'}</p>
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-line pt-3">
            {dirty && <Button variant="ghost" icon={Undo2} onClick={() => { setForm(init()); setErrors({}) }}>Reset</Button>}
            <Button variant="primary" icon={Save} disabled={!dirty || cpuTooLow || memTooLow || (form.access.mode === 'restricted' && !form.access.accountIds.length && !form.access.projectIds.length)} loading={save.isPending} onClick={() => save.mutate()}>Save policy</Button>
          </div>
        </Card>
        <IacTabs snippets={{ curl: toCurl('POST', `/platformClusters/${pc.id}/actions/updatePolicy`, body) }} />
      </div>
    </div>
  );
}
