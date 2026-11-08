import { useState } from 'react';
import { SlidersHorizontal, Plus, Lock, Copy, Pencil, Trash2, MoreHorizontal, Cpu, MemoryStick, Sparkles, Server, Rocket } from 'lucide-react';
import { useList } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Pro } from '@/components/ui/Pro';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Stat } from '@/components/ui/Stat';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { VmPresetModal, type PresetMode } from '@/components/compute/catalog/PresetModals';
import { money, plural } from '@/lib/format';
import type { VmPreset } from '@/types';

type Family = 'all' | VmPreset['family'] | 'custom';
const FAMILY_TONE = { general: 'brand', compute: 'info', memory: 'violet', gpu: 'warning' } as const;

/** Two thin bars comparing vCPU and RAM against the largest preset. */
function ShapeBars({ p, maxCpu, maxRam }: { p: VmPreset; maxCpu: number; maxRam: number }) {
  return (
    <div className="w-28 space-y-1" title={`${p.vcpus} vCPU · ${p.ramGB} GB`}>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(4, (p.vcpus / maxCpu) * 100)}%` }} /></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(4, (p.ramGB / maxRam) * 100)}%` }} /></div>
    </div>
  );
}

export default function VmPresets() {
  const { items: presets, isLoading } = useList<VmPreset>('vmPresets');
  const [family, setFamily] = useState<Family>('all');
  const [modal, setModal] = useState<{ mode: PresetMode; preset?: VmPreset | null } | null>(null);

  const rows = presets.filter((p) => family === 'all' || (family === 'custom' ? !p.builtIn : p.family === family));
  const maxCpu = Math.max(1, ...presets.map((p) => p.vcpus));
  const maxRam = Math.max(1, ...presets.map((p) => p.ramGB));
  const custom = presets.filter((p) => !p.builtIn);
  const cheapestPerCpu = Math.min(...presets.filter((p) => !p.gpu).map((p) => (p.monthlyCost ?? 0) / p.vcpus));

  const remove = async (p: VmPreset) => {
    const ok = await confirm({
      title: `Delete preset ${p.name}?`,
      message: p.usedBy ? `${plural(p.usedBy, 'VM')} were created from this preset. They keep their current size and simply no longer reference a preset.` : 'No VMs use this preset. It disappears from the create form immediately.',
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    try { await api.remove('vmPresets', p.id); toast.success(`Deleted ${p.name}`) } catch (e) { toast.error('Delete failed', (e as Error).message) }
  };

  const columns: Column<VmPreset>[] = [
    {
      id: 'name', header: 'Preset', sort: (p) => p.name,
      cell: (p) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-fg">{p.name}</span>
            {p.builtIn ? <Badge title="Built-in presets are managed by the platform"><Lock className="size-3" />built-in</Badge> : <Badge tone="brand">custom</Badge>}
          </div>
          <div className="truncate text-[11px] text-muted">{p.description || '—'}{!p.builtIn && p.createdBy ? ` · by ${p.createdBy}` : ''}</div>
        </div>
      ),
    },
    { id: 'family', header: 'Family', hideBelow: 'sm', sort: (p) => p.family, cell: (p) => <Badge tone={FAMILY_TONE[p.family]}>{p.family === 'gpu' && <Sparkles className="size-3" />}{p.family}</Badge> },
    {
      id: 'size', header: 'Size', sort: (p) => p.vcpus * 10000 + p.ramGB,
      cell: (p) => (
        <div className="flex items-center gap-3">
          <div className="whitespace-nowrap tabular">
            <span className="inline-flex items-center gap-1 text-fg"><Cpu className="size-3 text-brand-500" />{p.vcpus}</span>
            <span className="ml-2.5 inline-flex items-center gap-1 text-fg"><MemoryStick className="size-3 text-violet-500" />{p.ramGB} GB</span>
            {p.gpu && <span className="ml-2.5 text-amber-600 dark:text-amber-400">{p.gpu.count}× {p.gpu.model}</span>}
          </div>
          <span className="hidden @min-[44rem]:block"><ShapeBars p={p} maxCpu={maxCpu} maxRam={maxRam} /></span>
        </div>
      ),
    },
    { id: 'disk', header: 'System disk', align: 'right', hideBelow: 'md', sort: (p) => p.systemDiskGB, cell: (p) => <span className="tabular text-fg-2">{p.systemDiskGB} GB</span> },
    { id: 'ratio', header: 'GB / vCPU', align: 'right', hideBelow: 'xl', sort: (p) => p.ramGB / p.vcpus, cell: (p) => <span className="tabular text-muted">{(p.ramGB / p.vcpus).toFixed(1)}</span> },
    { id: 'used', header: 'VMs', align: 'right', hideBelow: 'md', sort: (p) => p.usedBy ?? 0, cell: (p) => <span className={p.usedBy ? 'tabular text-fg' : 'tabular text-faint'}>{p.usedBy ?? 0}</span> },
    {
      id: 'perCpu', header: '€ / vCPU', align: 'right', hideBelow: 'lg', sort: (p) => (p.monthlyCost ?? 0) / p.vcpus,
      cell: (p) => { const v = (p.monthlyCost ?? 0) / p.vcpus; return <span className={!p.gpu && Math.abs(v - cheapestPerCpu) < 0.005 ? 'tabular font-medium text-emerald-600 dark:text-emerald-400' : 'tabular text-muted'}>{money(v, { decimals: true })}</span> },
    },
    {
      id: 'price', header: 'Monthly', align: 'right', sort: (p) => p.monthlyCost ?? 0,
      cell: (p) => <div className="leading-tight"><div className="font-medium tabular text-fg">{money(p.monthlyCost)}</div><div className="text-[11px] tabular text-faint">{money((p.monthlyCost ?? 0) / 730, { decimals: true })}/h</div></div>,
    },
  ];

  return (
    <Page wide>
      <PageHeader
        title="VM size presets"
        description="Named sizes offered in the VM create form. Built-in presets cover common shapes; add your own for team-specific workloads."
        icon={SlidersHorizontal}
        iconColor="#5b67f8"
        crumbs={[{ label: 'Virtual Machines', to: '/infrastructure/vms' }, { label: 'Size presets' }]}
        actions={<>
          <Button icon={Rocket} to="/infrastructure/vms/new">Create VM</Button>
          <Button variant="primary" icon={Plus} onClick={() => setModal({ mode: 'create' })}>New preset</Button>
        </>}
      />
      <Pro><div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Presets" value={presets.length} icon={SlidersHorizontal} sub={`${presets.length - custom.length} built-in · ${custom.length} custom`} />
        <Stat label="Most used" value={[...presets].sort((a, b) => (b.usedBy ?? 0) - (a.usedBy ?? 0))[0]?.name ?? '—'} icon={Server} sub={`${[...presets].sort((a, b) => (b.usedBy ?? 0) - (a.usedBy ?? 0))[0]?.usedBy ?? 0} VMs`} />
        <Stat label="Price range" value={presets.length ? `${money(Math.min(...presets.map((p) => p.monthlyCost ?? 0)))}–${money(Math.max(...presets.map((p) => p.monthlyCost ?? 0)))}` : '—'} sub="per month, own hardware" />
        <Stat label="Best €/vCPU" value={Number.isFinite(cheapestPerCpu) ? money(cheapestPerCpu, { decimals: true }) : '—'} icon={Cpu} sub="non-GPU presets" accent="#5b67f8" />
      </div></Pro>
      <DataTable
        rows={rows}
        loading={isLoading}
        columns={columns}
        searchText={(p) => `${p.name} ${p.family} ${p.description} ${p.gpu?.model ?? ''} ${p.vcpus}vcpu ${p.ramGB}gb`}
        searchPlaceholder="Search presets…"
        toolbar={<FilterChips value={family} onChange={setFamily} options={[
          { value: 'all', label: 'All', count: presets.length },
          ...(['general', 'compute', 'memory', 'gpu'] as const).map((f) => ({ value: f, label: f[0].toUpperCase() + f.slice(1), count: presets.filter((p) => p.family === f).length })),
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
            { label: 'Delete', icon: Trash2, danger: true, hint: p.usedBy ? `${p.usedBy} VMs` : undefined, onClick: () => remove(p) },
          ]} />
        )}
        onRowClick={(p) => setModal({ mode: p.builtIn ? 'duplicate' : 'edit', preset: p })}
        empty={{ icon: SlidersHorizontal, title: 'No presets match', action: <Button variant="primary" icon={Plus} onClick={() => setModal({ mode: 'create' })}>New preset</Button> }}
      />
      <VmPresetModal open={!!modal} mode={modal?.mode ?? 'create'} preset={modal?.preset} onClose={() => setModal(null)} />
    </Page>
  );
}
