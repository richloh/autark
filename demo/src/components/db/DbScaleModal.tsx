import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Cpu, MemoryStick, Scaling } from 'lucide-react';
import { api, ApiClientError } from '@/api/client';
import { useApiMutation, useList } from '@/api/hooks';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, NumberInput, Select, Slider, Switch, Hint } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { fieldErrors } from '@/components/ui/FormLayout';
import { toast } from '@/components/ui/toast';
import { dbCost } from '@/lib/pricing';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Pro } from '@/components/ui/Pro';
import type { DbInstance, DbPreset } from '@/types';

const backupGB = (d: DbInstance) => (d.backups.enabled ? Math.round(d.storageUsedGB * 0.4 * d.backups.retention / 7) : 0);

/** Scale size / storage / HA / replicas with a before→after cost diff. */
export function DbScaleModal({ d, open, onClose }: { d: DbInstance; open: boolean; onClose: () => void }) {
  const { items: presets } = useList<DbPreset>('dbPresets');
  const choices = presets.filter((p) => p.engine === d.engine || p.engine === 'any');
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [presetId, setPresetId] = useState('');
  const [custom, setCustom] = useState({ vcpus: d.size.vcpus, ramGB: d.size.ramGB });
  const [storageGB, setStorageGB] = useState(d.storageGB);
  const [ha, setHa] = useState(d.ha);
  const [replicas, setReplicas] = useState(d.readReplicas);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const p = d.size.presetId && presets.some((x) => x.id === d.size.presetId);
    setMode(p ? 'preset' : 'custom'); setPresetId(d.size.presetId ?? choices[0]?.id ?? '');
    setCustom({ vcpus: d.size.vcpus, ramGB: d.size.ramGB }); setStorageGB(d.storageGB); setHa(d.ha); setReplicas(d.readReplicas); setErrors({});
  }, [open]); // eslint-disable-line

  const preset = choices.find((p) => p.id === presetId);
  const size = mode === 'preset' && preset ? { vcpus: preset.vcpus, ramGB: preset.ramGB } : custom;
  const before = useMemo(() => dbCost({ vcpus: d.size.vcpus, ramGB: d.size.ramGB, storageGB: d.storageGB, ha: d.ha, readReplicas: d.readReplicas, backupGB: backupGB(d) }), [d]);
  const after = dbCost({ vcpus: size.vcpus, ramGB: size.ramGB, storageGB, ha, readReplicas: replicas, backupGB: backupGB(d) });
  const diff = after.total - before.total;
  const sizeChanged = size.vcpus !== d.size.vcpus || size.ramGB !== d.size.ramGB;
  const changed = sizeChanged || storageGB !== d.storageGB || ha !== d.ha || replicas !== d.readReplicas;
  const maxStorage = Math.max(2000, d.storageGB * 4);

  const submit = useApiMutation(() => api.action('dbInstances', d.id, 'scale', {
    ...(sizeChanged ? (mode === 'preset' && preset ? { presetId } : { vcpus: custom.vcpus, ramGB: custom.ramGB }) : {}),
    storageGB, ha, readReplicas: replicas,
  }), {
    silent: true,
    onSuccess: () => { onClose(); toast.success(`Scaling ${d.name}`, 'Follow progress on the overview.') },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); toast.error('Scale failed', e.message) },
  });

  return (
    <Modal open={open} onClose={onClose} size="lg" title={`Scale ${d.name}`} description="Storage grows online. Compute changes restart the database (with HA: a rolling resize and ~4s failover)."
      icon={<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-brand-500"><Scaling className="size-[18px]" /></div>}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={submit.isPending} disabled={!changed} onClick={() => submit.mutate()}>Apply changes</Button></>}>
      <div className="space-y-5">
        <Field label="Compute" action={<Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'preset', label: 'Preset' }, { value: 'custom', label: 'Custom' }]} />} error={errors.vcpus ?? errors.ramGB ?? errors.presetId}>
          {mode === 'preset' ? (
            <Select value={presetId} onChange={(e) => setPresetId(e.target.value)} options={choices.map((p) => ({ value: p.id, label: `${p.name} — ${p.vcpus} vCPU · ${p.ramGB} GB · ${p.description}` }))} />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <NumberInput value={custom.vcpus} onChange={(v) => setCustom({ ...custom, vcpus: v })} min={1} max={64} unit="vCPU" />
              <NumberInput value={custom.ramGB} onChange={(v) => setCustom({ ...custom, ramGB: v })} min={1} max={512} unit="GB RAM" />
            </div>
          )}
        </Field>
        <Field label={`Storage · ${storageGB} GB`} error={errors.storageGB} hint={`Can only grow (currently ${d.storageGB} GB, ${d.storageUsedGB} GB used).`}>
          <Slider value={storageGB} onChange={(v) => setStorageGB(Math.max(d.storageGB, v))} min={d.storageGB} max={maxStorage} step={10} marks={[d.storageGB, Math.round(maxStorage / 2 / 10) * 10, maxStorage]} />
        </Field>
        <div className="grid gap-4 @min-[36rem]:grid-cols-2">
          <Switch checked={ha} onChange={setHa} disabled={d.status === 'stopped'} label="High availability" description="Synchronous standby on another host, automatic failover (×1.7 cost)." />
          <Pro><Field label="Read replicas" error={errors.readReplicas}><NumberInput value={replicas} onChange={setReplicas} min={0} max={5} disabled={d.status === 'stopped'} /></Field></Pro>
        </div>
        {d.ha && !ha && <Hint tone="warning">Disabling HA removes the standby — failures will cause downtime until the primary is rebuilt.</Hint>}

        <div className="rounded-xl border border-line bg-surface-2/50 p-4">
          <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
            <div><div className="text-xs text-muted">Current</div><div className="text-lg font-semibold tabular text-fg">{money(before.total)}<span className="text-xs font-normal text-muted">/mo</span></div></div>
            <ArrowRight className="size-4 text-faint" />
            <div><div className="text-xs text-muted">New</div><div className="text-lg font-semibold tabular text-fg">{money(after.total)}<span className="text-xs font-normal text-muted">/mo</span></div></div>
          </div>
          <div className={cn('text-center text-sm font-medium tabular', diff > 0 ? 'text-amber-600 dark:text-amber-400' : diff < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted')}>
            {diff === 0 ? 'No cost change' : `${diff > 0 ? '+' : '−'}${money(Math.abs(diff), { decimals: true })} / month`}
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-3 text-xs text-muted">
            <span className="flex items-center gap-1"><Cpu className="size-3" />{d.size.vcpus} → {size.vcpus} vCPU</span>
            <span className="flex items-center gap-1"><MemoryStick className="size-3" />{d.size.ramGB} → {size.ramGB} GB</span>
            <span>{d.storageGB} → {storageGB} GB disk</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
