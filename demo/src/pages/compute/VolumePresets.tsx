import { useState } from 'react';
import { SlidersHorizontal, Plus, Lock, Copy, Pencil, Trash2, MoreHorizontal, Gauge, HardDrive, Zap, Plus as PlusIcon } from 'lucide-react';
import { useList } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Pro } from '@/components/ui/Pro';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { VolumePresetModal, type PresetMode } from '@/components/compute/catalog/PresetModals';
import { money, gb, compact } from '@/lib/format';
import { VOLUME_LIMITS, type VolumePreset, type VolumeType } from '@/types';

type Filter = 'all' | VolumeType | 'custom';
const TYPE_TONE = { ssd: 'brand', nvme: 'violet', hdd: 'neutral' } as const;

function PerfBars({ p, maxIops, maxTp }: { p: VolumePreset; maxIops: number; maxTp: number }) {
  // log scale so HDD vs NVMe differences stay readable
  const w = (v: number, max: number) => `${Math.max(4, (Math.log10(v + 1) / Math.log10(max + 1)) * 100)}%`;
  return (
    <div className="w-28 space-y-1" title={`${p.iops.toLocaleString()} IOPS · ${p.throughputMBps} MB/s (log scale)`}>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-sky-500" style={{ width: w(p.iops, maxIops) }} /></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-emerald-500" style={{ width: w(p.throughputMBps, maxTp) }} /></div>
    </div>
  );
}

export default function VolumePresets() {
  const { items: presets, isLoading } = useList<VolumePreset>('volumePresets');
  const [filter, setFilter] = useState<Filter>('all');
  const [modal, setModal] = useState<{ mode: PresetMode; preset?: VolumePreset | null } | null>(null);

  const rows = presets.filter((p) => filter === 'all' || (filter === 'custom' ? !p.builtIn : p.type === filter));
  const maxIops = Math.max(1, ...presets.map((p) => p.iops));
  const maxTp = Math.max(1, ...presets.map((p) => p.throughputMBps));
  const custom = presets.filter((p) => !p.builtIn);

  const remove = async (p: VolumePreset) => {
    const ok = await confirm({ title: `Delete preset ${p.name}?`, message: 'Existing volumes are not affected. The preset disappears from the create form.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try { await api.remove('volumePresets', p.id); toast.success(`Deleted ${p.name}`) } catch (e) { toast.error('Delete failed', (e as Error).message) }
  };

  const columns: Column<VolumePreset>[] = [
    {
      id: 'name', header: 'Preset', sort: (p) => p.name,
      cell: (p) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-fg">{p.name}</span>
            {p.builtIn ? <Badge><Lock className="size-3" />built-in</Badge> : <Badge tone="brand">custom</Badge>}
          </div>
          <div className="truncate text-[11px] text-muted">{p.description || '—'}{!p.builtIn && p.createdBy ? ` · by ${p.createdBy}` : ''}</div>
        </div>
      ),
    },
    { id: 'type', header: 'Type', sort: (p) => p.type, cell: (p) => <Badge tone={TYPE_TONE[p.type]}>{VOLUME_LIMITS[p.type].label}</Badge> },
    { id: 'size', header: 'Size', align: 'right', sort: (p) => p.sizeGB, cell: (p) => <span className="tabular text-fg">{gb(p.sizeGB)}</span> },
    {
      id: 'perf', header: 'Performance', sort: (p) => p.iops,
      cell: (p) => (
        <div className="flex items-center gap-3">
          <div className="whitespace-nowrap text-[12.5px] tabular">
            <span className="inline-flex items-center gap-1 text-fg"><Zap className="size-3 text-sky-500" />{compact(p.iops)} IOPS</span>
            <span className="ml-2.5 inline-flex items-center gap-1 text-fg-2"><Gauge className="size-3 text-emerald-500" />{p.throughputMBps} MB/s</span>
          </div>
          <span className="hidden @min-[44rem]:block"><PerfBars p={p} maxIops={maxIops} maxTp={maxTp} /></span>
        </div>
      ),
    },
    { id: 'latency', header: 'Latency', align: 'right', hideBelow: 'xl', sort: (p) => VOLUME_LIMITS[p.type].latencyMs, cell: (p) => <span className="tabular text-muted">~{VOLUME_LIMITS[p.type].latencyMs} ms</span> },
    { id: 'used', header: 'Matching volumes', align: 'right', hideBelow: 'md', sort: (p) => p.usedBy ?? 0, cell: (p) => <span className={p.usedBy ? 'tabular text-fg' : 'tabular text-faint'}>{p.usedBy ?? 0}</span> },
    { id: 'perGB', header: '€ / GB', align: 'right', hideBelow: 'lg', sort: (p) => (p.monthlyCost ?? 0) / p.sizeGB, cell: (p) => <span className="tabular text-muted">€{((p.monthlyCost ?? 0) / p.sizeGB).toFixed(3)}</span> },
    { id: 'price', header: 'Monthly', align: 'right', sort: (p) => p.monthlyCost ?? 0, cell: (p) => <span className="font-medium tabular text-fg">{money(p.monthlyCost)}</span> },
  ];

  return (
    <Page wide>
      <PageHeader
        title="Volume presets"
        description="Bundles of type, size and provisioned performance offered when creating volumes."
        icon={SlidersHorizontal}
        iconColor="#0ea5e9"
        crumbs={[{ label: 'Volumes', to: '/infrastructure/volumes' }, { label: 'Presets' }]}
        actions={<>
          <Button icon={HardDrive} to="/infrastructure/volumes/new">Create volume</Button>
          <Button variant="primary" icon={Plus} onClick={() => setModal({ mode: 'create' })}>New preset</Button>
        </>}
      />
      <Pro><div className="mb-5 grid grid-cols-1 gap-3 @min-[36rem]:grid-cols-3">
        {(Object.keys(VOLUME_LIMITS) as VolumeType[]).map((t) => {
          const l = VOLUME_LIMITS[t];
          return (
            <div key={t} className="rounded-xl border border-line bg-surface p-4 shadow-card">
              <div className="flex items-center justify-between">
                <Badge tone={TYPE_TONE[t]}>{l.label}</Badge>
                <span className="text-xs text-muted">{presets.filter((p) => p.type === t).length} presets</span>
              </div>
              <p className="mt-2 text-[13px] text-fg-2">{l.description}</p>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="rounded-lg bg-surface-2 py-1.5"><dd className="text-sm font-semibold tabular text-fg">{compact(l.maxIops)}</dd><dt className="text-muted">max IOPS</dt></div>
                <div className="rounded-lg bg-surface-2 py-1.5"><dd className="text-sm font-semibold tabular text-fg">{compact(l.maxTp)}</dd><dt className="text-muted">MB/s</dt></div>
                <div className="rounded-lg bg-surface-2 py-1.5"><dd className="text-sm font-semibold tabular text-fg">{l.latencyMs}</dd><dt className="text-muted">ms</dt></div>
              </dl>
            </div>
          );
        })}
      </div></Pro>
      <DataTable
        rows={rows}
        loading={isLoading}
        columns={columns}
        searchText={(p) => `${p.name} ${p.type} ${p.description} ${p.sizeGB}gb`}
        searchPlaceholder="Search presets…"
        toolbar={<FilterChips value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All', count: presets.length },
          ...(Object.keys(VOLUME_LIMITS) as VolumeType[]).map((t) => ({ value: t, label: VOLUME_LIMITS[t].label, count: presets.filter((p) => p.type === t).length })),
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
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove(p) },
          ]} />
        )}
        onRowClick={(p) => setModal({ mode: p.builtIn ? 'duplicate' : 'edit', preset: p })}
        empty={{ icon: HardDrive, title: 'No presets match', action: <Button variant="primary" icon={PlusIcon} onClick={() => setModal({ mode: 'create' })}>New preset</Button> }}
      />
      <VolumePresetModal open={!!modal} mode={modal?.mode ?? 'create'} preset={modal?.preset} onClose={() => setModal(null)} />
    </Page>
  );
}
