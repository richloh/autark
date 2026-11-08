import { useEffect, useState } from 'react';
import { SlidersHorizontal, Plus, Lock, Copy, Pencil, Trash2, MoreHorizontal, Cpu, MemoryStick, HardDrive, Database, Rocket } from 'lucide-react';
import { useList, useApiMutation } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Stat } from '@/components/ui/Stat';
import { Modal, confirm } from '@/components/ui/Modal';
import { Field, Input, NumberInput, Slider, Hint } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { toast } from '@/components/ui/toast';
import { EngineLogo, ENGINE_META } from '@/components/db/engine';
import { dbCost } from '@/lib/pricing';
import { money, plural } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { DbPreset, DbEngine } from '@/types';

type EngineFilter = 'all' | DbEngine | 'any' | 'custom';
type Mode = 'create' | 'edit' | 'duplicate';
const ENGINES: (DbEngine | 'any')[] = ['postgres', 'mysql', 'mariadb', 'redis', 'any'];

export default function DbPresets() {
  const { items: presets, isLoading } = useList<DbPreset>('dbPresets');
  const [filter, setFilter] = useState<EngineFilter>('all');
  const [modal, setModal] = useState<{ mode: Mode; preset?: DbPreset } | null>(null);

  const rows = presets.filter((p) => filter === 'all' || (filter === 'custom' ? !p.builtIn : p.engine === filter));
  const custom = presets.filter((p) => !p.builtIn);
  const maxRam = Math.max(1, ...presets.map((p) => p.ramGB));
  const mostUsed = [...presets].sort((a, b) => (b.usedBy ?? 0) - (a.usedBy ?? 0))[0];

  const remove = async (p: DbPreset) => {
    const ok = await confirm({
      title: `Delete preset ${p.name}?`,
      message: p.usedBy ? `${plural(p.usedBy, 'database')} were created from this preset. They keep their size and will show as custom-sized.` : 'No databases use this preset. It disappears from the create form immediately.',
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    try { await api.remove('dbPresets', p.id); toast.success(`Deleted ${p.name}`) } catch (e) { toast.error('Delete failed', (e as Error).message) }
  };

  const columns: Column<DbPreset>[] = [
    {
      id: 'name', header: 'Preset', sort: (p) => p.name,
      cell: (p) => (
        <div className="flex min-w-0 items-center gap-2.5">
          {p.engine === 'any' ? <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-muted"><Database className="size-4" /></span> : <EngineLogo engine={p.engine} size={28} />}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-fg">{p.name}</span>
              {p.builtIn ? <Badge title="Built-in presets are managed by the platform"><Lock className="size-3" />built-in</Badge> : <Badge tone="brand">custom</Badge>}
            </div>
            <div className="truncate text-[11px] text-muted">{p.description || '—'}{p.createdBy ? ` · by ${p.createdBy}` : ''}</div>
          </div>
        </div>
      ),
    },
    { id: 'engine', header: 'Engine', hideBelow: 'sm', sort: (p) => p.engine, cell: (p) => <span className="text-fg-2">{p.engine === 'any' ? 'Any engine' : ENGINE_META[p.engine].label}</span> },
    {
      id: 'size', header: 'Size', sort: (p) => p.vcpus * 10000 + p.ramGB,
      cell: (p) => (
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap tabular">
            <span className="inline-flex items-center gap-1 text-fg"><Cpu className="size-3 text-brand-500" />{p.vcpus}</span>
            <span className="ml-2.5 inline-flex items-center gap-1 text-fg"><MemoryStick className="size-3 text-violet-500" />{p.ramGB} GB</span>
          </span>
          <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-surface-3 @min-[44rem]:block"><span className="block h-full rounded-full bg-violet-500" style={{ width: `${Math.max(4, (p.ramGB / maxRam) * 100)}%` }} /></span>
        </div>
      ),
    },
    { id: 'storage', header: 'Storage', align: 'right', hideBelow: 'md', sort: (p) => p.storageGB, cell: (p) => <span className="tabular text-fg-2">{p.storageGB} GB</span> },
    { id: 'used', header: 'Databases', align: 'right', hideBelow: 'md', sort: (p) => p.usedBy ?? 0, cell: (p) => <span className={p.usedBy ? 'tabular text-fg' : 'tabular text-faint'}>{p.usedBy ?? 0}</span> },
    {
      id: 'price', header: 'Monthly', align: 'right', sort: (p) => p.monthlyCost ?? 0,
      cell: (p) => <div className="leading-tight"><div className="font-medium tabular text-fg">{money(p.monthlyCost)}</div><div className="text-[11px] tabular text-faint">HA {money((p.monthlyCost ?? 0) * 1.7)}</div></div>,
    },
  ];

  return (
    <Page wide>
      <PageHeader
        title="Database size presets"
        description="Named instance sizes offered in the database create form, per engine or for any engine."
        icon={SlidersHorizontal}
        iconColor="#3b82f6"
        crumbs={[{ label: 'Databases', to: '/managed-services/db' }, { label: 'Size presets' }]}
        actions={<>
          <Button icon={Rocket} to="/managed-services/db/new">Create database</Button>
          <Button variant="primary" icon={Plus} onClick={() => setModal({ mode: 'create' })}>New preset</Button>
        </>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Presets" value={presets.length} icon={SlidersHorizontal} sub={`${presets.length - custom.length} built-in · ${custom.length} custom`} />
        <Stat label="Most used" value={mostUsed?.name ?? '—'} icon={Database} sub={`${mostUsed?.usedBy ?? 0} databases`} />
        <Stat label="Price range" value={presets.length ? `${money(Math.min(...presets.map((p) => p.monthlyCost ?? 0)))}–${money(Math.max(...presets.map((p) => p.monthlyCost ?? 0)))}` : '—'} sub="single node, per month" />
        <Stat label="Engines covered" value={new Set(presets.map((p) => p.engine)).size} icon={HardDrive} sub="incl. any-engine presets" accent="#3b82f6" />
      </div>
      <DataTable
        rows={rows}
        loading={isLoading}
        columns={columns}
        searchText={(p) => `${p.name} ${p.engine} ${p.description} ${p.vcpus}vcpu ${p.ramGB}gb`}
        searchPlaceholder="Search presets…"
        toolbar={<FilterChips value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All', count: presets.length },
          ...ENGINES.filter((e) => presets.some((p) => p.engine === e)).map((e) => ({ value: e, label: e === 'any' ? 'Any' : ENGINE_META[e].label, count: presets.filter((p) => p.engine === e).length })),
          { value: 'custom', label: 'Custom', count: custom.length },
        ]} />}
        rowActions={(p) => (
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Preset actions" size="sm" />} items={p.builtIn ? [
            { label: 'Duplicate as custom', icon: Copy, onClick: () => setModal({ mode: 'duplicate', preset: p }) },
            { label: 'Read-only (built-in)', icon: Lock, disabled: true },
          ] : [
            { label: 'Edit', icon: Pencil, onClick: () => setModal({ mode: 'edit', preset: p }) },
            { label: 'Duplicate', icon: Copy, onClick: () => setModal({ mode: 'duplicate', preset: p }) },
            { divider: true, label: '' },
            { label: 'Delete', icon: Trash2, danger: true, hint: p.usedBy ? `${p.usedBy} in use` : undefined, onClick: () => remove(p) },
          ]} />
        )}
        onRowClick={(p) => setModal({ mode: p.builtIn ? 'duplicate' : 'edit', preset: p })}
        empty={{ icon: SlidersHorizontal, title: 'No presets match', action: <Button variant="primary" icon={Plus} onClick={() => setModal({ mode: 'create' })}>New preset</Button> }}
      />
      <PresetModal open={!!modal} mode={modal?.mode ?? 'create'} preset={modal?.preset} onClose={() => setModal(null)} />
    </Page>
  );
}

function PresetModal({ open, mode, preset, onClose }: { open: boolean; mode: Mode; preset?: DbPreset; onClose: () => void }) {
  const blank = { name: '', engine: 'postgres' as DbEngine | 'any', vcpus: 2, ramGB: 8, storageGB: 100, description: '' };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(preset ? { name: mode === 'duplicate' ? `${preset.name}-custom` : preset.name, engine: preset.engine, vcpus: preset.vcpus, ramGB: preset.ramGB, storageGB: preset.storageGB, description: preset.description } : blank);
  }, [open, preset?.id, mode]); // eslint-disable-line

  const save = useApiMutation(() => (mode === 'edit' && preset ? api.update('dbPresets', preset.id, f) : api.create('dbPresets', f)), {
    success: mode === 'edit' ? `Saved ${f.name}` : `Created ${f.name}`,
    onSuccess: onClose,
    onError: (e: ApiClientError) => setErrors(fieldErrors(e)),
  });
  const redisWarn = f.engine === 'redis' && f.storageGB < f.ramGB;
  const cost = dbCost({ vcpus: f.vcpus, ramGB: f.ramGB, storageGB: f.storageGB, ha: false }).total;

  return (
    <Modal open={open} onClose={onClose} size="lg"
      title={mode === 'edit' ? `Edit ${preset?.name}` : mode === 'duplicate' ? `Duplicate ${preset?.name}` : 'New database preset'}
      description="Presets appear in the create form for the selected engine. Built-in presets stay read-only."
      footer={<>
        <span className="mr-auto text-sm text-muted">≈ <span className="font-semibold tabular text-fg">{money(cost)}</span>/mo single node</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || redisWarn} onClick={() => save.mutate()}>{mode === 'edit' ? 'Save' : 'Create preset'}</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid gap-4 @min-[36rem]:grid-cols-2">
          <Field label="Name" required error={errors.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="PG-XL" autoFocus /></Field>
          <Field label="Description" optional><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Analytics replicas" /></Field>
        </div>
        <Field label="Engine" error={errors.engine}>
          <div className="grid grid-cols-2 gap-2 @min-[36rem]:grid-cols-5">
            {ENGINES.map((e) => (
              <button key={e} type="button" onClick={() => setF({ ...f, engine: e })}
                className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[13px] font-medium transition-colors', f.engine === e ? 'border-brand-500 bg-brand-500/[0.06] text-fg' : 'border-line text-fg-2 hover:border-line-strong')}>
                {e === 'any' ? <Database className="size-4 text-muted" /> : <EngineLogo engine={e} size={20} className="rounded-md" />}
                {e === 'any' ? 'Any' : ENGINE_META[e].label}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid gap-5 @min-[36rem]:grid-cols-2">
          <Field label={`vCPUs · ${f.vcpus}`} error={errors.vcpus}><Slider value={f.vcpus} onChange={(v) => setF({ ...f, vcpus: v })} min={1} max={64} marks={[1, 16, 32, 64]} /></Field>
          <Field label={`Memory · ${f.ramGB} GB`} error={errors.ramGB}><Slider value={f.ramGB} onChange={(v) => setF({ ...f, ramGB: v })} min={1} max={512} marks={[1, 128, 256, 512]} /></Field>
        </div>
        <Field label="Default storage" error={errors.storageGB}><NumberInput value={f.storageGB} onChange={(v) => setF({ ...f, storageGB: v })} min={10} max={16384} step={10} unit="GB" /></Field>
        {redisWarn && <Hint tone="warning">Redis needs storage ≥ memory for persistence ({f.ramGB} GB).</Hint>}
      </div>
    </Modal>
  );
}
