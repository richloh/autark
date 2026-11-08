import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Boxes, Plus, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation, useList } from '@/api/hooks';
import { Modal } from '@/components/ui/Modal';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select, NumberInput, Switch, Hint } from '@/components/ui/form';
import { Advanced } from '@/components/ui/Pro';
import { fieldErrors } from '@/components/ui/FormLayout';
import { flag } from '@/components/hardware/visuals';
import { K8S_VERSIONS, type Location } from '@/types';
import { n1, SYSTEM_RESERVE, type PlatformClusterView } from './shared';

interface PoolDraft { name: string; vcpus: number; ramGB: number; count: number }
const SIZES = [
  { value: '8x32', label: '8 vCPU · 32 GB', vcpus: 8, ramGB: 32 },
  { value: '16x64', label: '16 vCPU · 64 GB', vcpus: 16, ramGB: 64 },
  { value: '32x128', label: '32 vCPU · 128 GB', vcpus: 32, ramGB: 128 },
  { value: '16x128', label: '16 vCPU · 128 GB (memory)', vcpus: 16, ramGB: 128 },
];

/** Admin: create a multi-tenant platform cluster on the bare-metal fleet (starts a provisioning op). */
export function CreatePlatformClusterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { items: locations } = useList<Location>('locations');
  const own = locations.filter((l) => l.kind === 'selfHosted');
  const [name, setName] = useState('');
  const [locationId, setLocationId] = useState('dc1');
  const [version, setVersion] = useState(K8S_VERSIONS[0].version);
  const [ha, setHa] = useState(true);
  const [pools, setPools] = useState<PoolDraft[]>([{ name: 'general', vcpus: 16, ramGB: 64, count: 3 }]);
  const [ocCpu, setOcCpu] = useState(1.5);
  const [ocMem, setOcMem] = useState(1.2);
  const [podSecurity, setPodSecurity] = useState<'restricted' | 'baseline'>('restricted');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setName(''); setPools([{ name: 'general', vcpus: 16, ramGB: 64, count: 3 }]);
  }, [open]);

  const cpu = pools.reduce((a, p) => a + p.vcpus * p.count, 0) * (1 - SYSTEM_RESERVE);
  const mem = pools.reduce((a, p) => a + p.ramGB * p.count, 0) * (1 - SYSTEM_RESERVE);
  const body = useMemo(() => ({
    name, locationId, version, controlPlane: { ha, size: ha ? 'medium' : 'small' }, nodePools: pools, overcommit: { cpu: ocCpu, memory: ocMem }, podSecurity,
  }), [name, locationId, version, ha, pools, ocCpu, ocMem, podSecurity]);
  const create = useApiMutation(() => api.create<PlatformClusterView>('platformClusters', body), {
    success: (r) => `Provisioning ${r.name}`,
    onSuccess: (r) => { onClose(); navigate(`/hardware/platform-clusters/${r.id}`) },
    onError: (e) => setErrors(fieldErrors(e)),
  });
  const setPool = (i: number, patch: Partial<PoolDraft>) => setPools((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <Modal open={open} onClose={onClose} size="lg" icon={<Boxes className="mt-0.5 size-5 shrink-0 text-[#326ce5]" />} title="Create platform cluster" description="A shared Kubernetes cluster on your own hosts. Customers create spaces on it."
      footer={<>
        <span className="mr-auto text-xs tabular text-muted">{n1(Math.round(cpu * 10) / 10)} cores · {n1(Math.round(mem))} GiB allocatable · up to {n1(Math.round(cpu * ocCpu * 10) / 10)} cores promisable</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={create.isPending} disabled={!name || !pools.length} onClick={() => create.mutate()}>Create cluster</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid [&>*]:min-w-0 gap-4 @min-[36rem]:grid-cols-2">
          <Field label="Name" required error={errors.name} hint="e.g. shared-mdg-2">
            <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="shared-mdg-2" invalid={!!errors.name} autoFocus />
          </Field>
          <Field label="Location" error={errors.locationId}>
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} options={own.map((l) => ({ value: l.id, label: `${flag(l.country)} ${l.name}` }))} />
          </Field>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-fg-2">Worker pools</span>
            <Button size="xs" variant="ghost" icon={Plus} disabled={pools.length >= 4} onClick={() => setPools((ps) => [...ps, { name: `pool-${ps.length + 1}`, vcpus: 8, ramGB: 32, count: 2 }])}>Add pool</Button>
          </div>
          <div className="space-y-2">
            {pools.map((p, i) => (
              <div key={i} className="grid [&>*]:min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2 rounded-xl border border-line p-3 @min-[36rem]:grid-cols-[8rem_minmax(0,1fr)_8.5rem_auto]">
                <Field label="Pool" error={errors[`nodePools.${i}.name`]} className="col-span-2 @min-[36rem]:col-span-1">
                  <Input value={p.name} onChange={(e) => setPool(i, { name: e.target.value.toLowerCase() })} />
                </Field>
                <Field label="Node size" className="col-span-2 @min-[36rem]:col-span-1">
                  <Select value={`${p.vcpus}x${p.ramGB}`} onChange={(e) => { const s = SIZES.find((x) => x.value === e.target.value)!; setPool(i, { vcpus: s.vcpus, ramGB: s.ramGB }) }} options={SIZES} />
                </Field>
                <Field label="Nodes" error={errors[`nodePools.${i}.count`]}>
                  <NumberInput value={p.count} min={1} max={50} onChange={(v) => setPool(i, { count: v })} />
                </Field>
                <IconButton icon={Trash2} label="Remove pool" disabled={pools.length === 1} onClick={() => setPools((ps) => ps.filter((_, j) => j !== i))} />
              </div>
            ))}
          </div>
          {errors.nodePools && <p className="mt-1.5 text-xs text-rose-500">{errors.nodePools}</p>}
        </div>

        <Advanced title="Advanced" description="Version, control plane, overcommit and pod security">
          <div className="grid [&>*]:min-w-0 gap-4 @min-[36rem]:grid-cols-2">
            <Field label="Kubernetes version">
              <Select value={version} onChange={(e) => setVersion(e.target.value)} options={K8S_VERSIONS.filter((v) => v.status !== 'deprecated').map((v) => ({ value: v.version, label: `${v.version} (${v.status})` }))} />
            </Field>
            <Field label="Pod security">
              <Select value={podSecurity} onChange={(e) => setPodSecurity(e.target.value as 'restricted' | 'baseline')} options={[{ value: 'restricted', label: 'restricted (recommended)' }, { value: 'baseline', label: 'baseline' }]} />
            </Field>
            <Field label="CPU overcommit" hint="Quota you may promise per allocatable core" error={errors['overcommit.cpu']}>
              <NumberInput value={ocCpu} min={1} max={4} step={0.25} unit="×" onChange={setOcCpu} />
            </Field>
            <Field label="Memory overcommit" error={errors['overcommit.memory']}>
              <NumberInput value={ocMem} min={1} max={2} step={0.05} unit="×" onChange={(v) => setOcMem(Math.round(v * 100) / 100)} />
            </Field>
            <div className="@min-[36rem]:col-span-2">
              <Switch checked={ha} onChange={setHa} label="Highly available control plane" description="3 control-plane nodes with etcd quorum, spread over hosts." />
            </div>
          </div>
        </Advanced>
        <Hint>Nodes are placed on ready hosts in this location that have the Kubernetes worker / control-plane role and are open to all accounts. New clusters accept spaces once provisioning finishes.</Hint>
      </div>
    </Modal>
  );
}
