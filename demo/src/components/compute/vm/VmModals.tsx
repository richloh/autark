import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Cpu, MemoryStick, HardDrive, ArrowRight, Scaling, MoveRight, RefreshCcw, Copy, Camera, Pencil, Server, Zap, Wand2 } from 'lucide-react';
import { api, ApiClientError } from '@/api/client';
import { useApiMutation, useGet, useList } from '@/api/hooks';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Slider, Textarea, MultiSelect, Hint, OptionCards } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { fieldErrors } from '@/components/ui/FormLayout';
import { StackBar, Skeleton } from '@/components/ui/misc';
import { Badge } from '@/components/ui/Badge';
import { OsBadge } from '@/lib/images';
import { vmCost } from '@/lib/pricing';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { VM, VmPreset, Image, SshKey, Location, PlacementCandidate } from '@/types';

type Family = VmPreset['family'] | 'custom';

/* ------------------------------------------------------------------ resize */

export function ResizeVmModal({ vm, open, onClose, isCloud, extras }: { vm: VM; open: boolean; onClose: () => void; isCloud: boolean; extras: { publicIpv4: number } }) {
  const { items: presets } = useList<VmPreset>('vmPresets');
  const current = presets.find((p) => p.id === vm.size.presetId);
  const [family, setFamily] = useState<Family>('general');
  const [presetId, setPresetId] = useState<string>('');
  const [custom, setCustom] = useState({ vcpus: vm.size.vcpus, ramGB: vm.size.ramGB });
  const [disk, setDisk] = useState(vm.size.systemDiskGB);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setFamily(current ? current.family : vm.size.presetId === null ? 'custom' : 'general');
    setPresetId(vm.size.presetId ?? '');
    setCustom({ vcpus: vm.size.vcpus, ramGB: vm.size.ramGB });
    setDisk(vm.size.systemDiskGB);
    setError(null);
  }, [open]); // eslint-disable-line

  const target = family === 'custom' ? { vcpus: custom.vcpus, ramGB: custom.ramGB, gpu: vm.gpu, presetId: null } : (() => {
    const p = presets.find((x) => x.id === presetId);
    return p ? { vcpus: p.vcpus, ramGB: p.ramGB, gpu: p.gpu ?? null, presetId: p.id } : null;
  })();
  const effDisk = Math.max(disk, family !== 'custom' ? presets.find((x) => x.id === presetId)?.systemDiskGB ?? 0 : 0);
  const base = { publicIpv4: extras.publicIpv4, backups: vm.backups.enabled, cloud: isCloud };
  const curCost = vmCost({ vcpus: vm.size.vcpus, ramGB: vm.size.ramGB, systemDiskGB: vm.size.systemDiskGB, gpu: vm.gpu, ...base }).total;
  const newCost = target ? vmCost({ vcpus: target.vcpus, ramGB: target.ramGB, systemDiskGB: effDisk, gpu: target.gpu, ...base }).total : curCost;
  const diff = newCost - curCost;
  const unchanged = !!target && target.vcpus === vm.size.vcpus && target.ramGB === vm.size.ramGB && effDisk === vm.size.systemDiskGB && JSON.stringify(target.gpu ?? null) === JSON.stringify(vm.gpu ?? null);

  const m = useApiMutation(() => api.action('vms', vm.id, 'resize', target!.presetId ? { presetId: target!.presetId, systemDiskGB: effDisk } : { vcpus: custom.vcpus, ramGB: custom.ramGB, systemDiskGB: effDisk, gpu: vm.gpu }), {
    success: `Resizing ${vm.name}`, onSuccess: onClose, onError: (e) => setError(e.message), silent: false,
  });

  const familyPresets = presets.filter((p) => p.family === family);
  return (
    <Modal open={open} onClose={onClose} size="xl" title={`Resize ${vm.name}`} icon={<span className="flex size-9 items-center justify-center rounded-full bg-brand-500/10 text-brand-500"><Scaling className="size-[18px]" /></span>}
      description={vm.status === 'running' ? 'The VM is shut down, resized and booted again (typically 20–40 s of downtime).' : 'The VM is stopped — the new size applies on next start.'}
      footer={<>
        <div className="mr-auto hidden text-xs text-muted @min-[36rem]:block">{unchanged ? 'Pick a different size' : <>New run-rate <b className="text-fg">{money(newCost)}/mo</b></>}</div>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={Scaling} disabled={!target || unchanged} loading={m.isPending} onClick={() => m.mutate()}>{vm.status === 'running' ? 'Resize & restart' : 'Resize'}</Button>
      </>}>
      <div className="space-y-4">
        {error && <Hint tone="danger">{error}</Hint>}
        <div className="grid items-stretch gap-3 @min-[36rem]:grid-cols-[1fr_auto_1fr]">
          <SizeBox title="Current" vcpus={vm.size.vcpus} ram={vm.size.ramGB} disk={vm.size.systemDiskGB} gpu={vm.gpu} cost={curCost} label={current?.name ?? 'custom'} />
          <div className="flex items-center justify-center text-faint"><ArrowRight className="size-5 rotate-90 @min-[36rem]:rotate-0" /></div>
          <SizeBox title="New" vcpus={target?.vcpus ?? 0} ram={target?.ramGB ?? 0} disk={effDisk} gpu={target?.gpu ?? null} cost={newCost} label={target?.presetId ? presets.find((p) => p.id === target.presetId)?.name : 'custom'} highlight
            diff={diff} prev={{ vcpus: vm.size.vcpus, ram: vm.size.ramGB, disk: vm.size.systemDiskGB }} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented value={family} onChange={(f) => { setFamily(f); const first = presets.find((p) => p.family === f); if (f !== 'custom' && first) setPresetId(first.id) }}
            options={[{ value: 'general', label: 'General' }, { value: 'compute', label: 'Compute' }, { value: 'memory', label: 'Memory' }, { value: 'gpu', label: 'GPU' }, { value: 'custom', label: 'Custom' }]} />
          {vm.gpu && family !== 'gpu' && family !== 'custom' && <span className="text-xs text-amber-600 dark:text-amber-400">Non-GPU presets remove the GPU</span>}
        </div>
        {family === 'custom' ? (
          <div className="grid gap-5 @min-[36rem]:grid-cols-2">
            <Field label={`vCPUs · ${custom.vcpus}`}><Slider value={custom.vcpus} onChange={(v) => setCustom({ ...custom, vcpus: v })} min={1} max={64} marks={[1, 8, 16, 32, 64]} /></Field>
            <Field label={`Memory · ${custom.ramGB} GB`}><Slider value={custom.ramGB} onChange={(v) => setCustom({ ...custom, ramGB: v })} min={1} max={512} marks={[1, 64, 128, 256, 512]} /></Field>
          </div>
        ) : (
          <OptionCards cols={4} value={presetId} onChange={setPresetId} options={familyPresets.map((p) => {
            const c = vmCost({ vcpus: p.vcpus, ramGB: p.ramGB, systemDiskGB: Math.max(p.systemDiskGB, vm.size.systemDiskGB), gpu: p.gpu, ...base }).total;
            const d = c - curCost;
            return {
              value: p.id, title: p.name, description: p.description,
              badge: p.id === vm.size.presetId ? <Badge tone="brand">current</Badge> : !p.builtIn ? <Badge>custom</Badge> : undefined,
              meta: (
                <div className="flex items-center justify-between text-xs">
                  <span className="flex gap-2 text-fg-2"><span className="flex items-center gap-0.5"><Cpu className="size-3" />{p.vcpus}</span><span className="flex items-center gap-0.5"><MemoryStick className="size-3" />{p.ramGB}G</span>{p.gpu && <span className="text-violet-500">{p.gpu.count}×{p.gpu.model}</span>}</span>
                  <span className={cn('font-medium tabular', d > 0.005 ? 'text-amber-600 dark:text-amber-400' : d < -0.005 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted')}>{Math.abs(d) < 0.005 ? '±0' : `${d > 0 ? '+' : '−'}${money(Math.abs(d))}`}</span>
                </div>
              ),
            };
          })} />
        )}
        <Field label={`System disk · ${effDisk} GB`} hint="Disks can only grow. The filesystem is expanded automatically on boot.">
          <Slider value={disk} onChange={(v) => setDisk(Math.max(vm.size.systemDiskGB, v))} min={vm.size.systemDiskGB} max={Math.max(1000, vm.size.systemDiskGB * 2)} step={10} marks={[vm.size.systemDiskGB, Math.max(1000, vm.size.systemDiskGB * 2)]} />
        </Field>
      </div>
    </Modal>
  );
}

function SizeBox({ title, vcpus, ram, disk, gpu, cost, label, highlight, diff, prev }: { title: string; vcpus: number; ram: number; disk: number; gpu: VM['gpu']; cost: number; label?: string; highlight?: boolean; diff?: number; prev?: { vcpus: number; ram: number; disk: number } }) {
  const delta = (n: number, p?: number) => (p == null || n === p ? null : <span className={cn('ml-1 text-[10px]', n > p ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>{n > p ? '▲' : '▼'}</span>);
  return (
    <div className={cn('rounded-xl border p-3', highlight ? 'border-brand-500/40 bg-brand-500/[0.04]' : 'border-line bg-surface-2/50')}>
      <div className="flex items-center justify-between text-xs"><span className="font-medium text-muted">{title}</span><span className="text-fg-2">{label}</span></div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div><div className="text-base font-semibold tabular text-fg">{vcpus}{delta(vcpus, prev?.vcpus)}</div><div className="text-[10px] text-muted">vCPU</div></div>
        <div><div className="text-base font-semibold tabular text-fg">{ram}{delta(ram, prev?.ram)}</div><div className="text-[10px] text-muted">GB RAM</div></div>
        <div><div className="text-base font-semibold tabular text-fg">{disk}{delta(disk, prev?.disk)}</div><div className="text-[10px] text-muted">GB disk</div></div>
      </div>
      {gpu && <div className="mt-1.5 text-center text-[11px] text-violet-600 dark:text-violet-400">{gpu.count}× {gpu.model}</div>}
      <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
        <span className="text-sm font-semibold tabular text-fg">{money(cost)}<span className="text-xs font-normal text-muted">/mo</span></span>
        {diff != null && Math.abs(diff) >= 0.005 && <span className={cn('text-xs font-medium tabular', diff > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>{diff > 0 ? '+' : '−'}{money(Math.abs(diff))}/mo</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ migrate */

export function MigrateVmModal({ vm, open, onClose }: { vm: VM; open: boolean; onClose: () => void }) {
  const { data, isLoading } = useGet<{ items: PlacementCandidate[] }>(['vms', 'placement', vm.id], open ? `/vms/${vm.id}/placement` : null);
  const [hostId, setHostId] = useState<string>('auto');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setHostId('auto'); setError(null) } }, [open]);
  const items = data?.items ?? [];
  const live = vm.status === 'running';
  const m = useApiMutation(() => api.action<{ hostId: string }>('vms', vm.id, 'migrate', hostId === 'auto' ? {} : { hostId }), {
    success: (r) => `${live ? 'Live-migrating' : 'Migrating'} ${vm.name} → ${items.find((h) => h.id === r.hostId)?.name ?? r.hostId}`, onSuccess: onClose, onError: (e) => setError(e.message),
  });
  const fits = items.filter((h) => h.fits);
  return (
    <Modal open={open} onClose={onClose} size="lg" title={`Migrate ${vm.name}`} icon={<span className="flex size-9 items-center justify-center rounded-full bg-brand-500/10 text-brand-500"><MoveRight className="size-[18px]" /></span>}
      description={live ? 'Live migration: memory is pre-copied to the target, then the VM switches over with < 50 ms pause. No reboot.' : 'Cold migration: the stopped VM definition moves to another host.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={MoveRight} disabled={!fits.length} loading={m.isPending} onClick={() => m.mutate()}>{live ? 'Live-migrate' : 'Migrate'}</Button></>}>
      <div className="space-y-3">
        {error && <Hint tone="danger">{error}</Hint>}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>This VM needs <b className="text-fg">{vm.size.vcpus} vCPU</b> · <b className="text-fg">{vm.size.ramGB} GB</b>{vm.gpu && <> · <b className="text-fg">{vm.gpu.count}× {vm.gpu.model}</b></>}</span>
          <span className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-slate-400/70" />allocated</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-brand-500" />this VM</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-surface-3 ring-1 ring-line" />free</span>
          </span>
        </div>
        <button type="button" onClick={() => setHostId('auto')} className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors', hostId === 'auto' ? 'border-brand-500 bg-brand-500/[0.06] ring-3 ring-brand-500/15' : 'border-line hover:bg-surface-2/60')}>
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand-500/10 text-brand-500"><Wand2 className="size-4" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-fg">Let the scheduler choose</span><span className="block text-xs text-muted">Picks the host with the most free memory{fits[0] ? ` — currently ${fits[0].name}` : ''}</span></span>
          <Radio on={hostId === 'auto'} />
        </button>
        {isLoading && <Skeleton className="h-40" />}
        <div className="space-y-2">
          {items.map((h) => {
            const add = h.current ? 0 : vm.size.vcpus, addR = h.current ? 0 : vm.size.ramGB;
            const selectable = h.fits;
            return (
              <button key={h.id} type="button" disabled={!selectable} onClick={() => setHostId(h.id)}
                className={cn('w-full rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed', hostId === h.id ? 'border-brand-500 bg-brand-500/[0.06] ring-3 ring-brand-500/15' : 'border-line', selectable && hostId !== h.id && 'hover:bg-surface-2/60', !selectable && !h.current && 'opacity-60')}>
                <div className="flex items-center gap-2">
                  <Server className={cn('size-4', h.current ? 'text-brand-500' : 'text-muted')} />
                  <span className="text-sm font-medium text-fg">{h.name}</span>
                  <span className="text-[11px] text-faint">rack {h.rack} · {h.allocated.vms} VMs</span>
                  <span className="ml-auto flex items-center gap-2">
                    {h.current ? <Badge tone="brand">current</Badge> : h.fits ? <Badge tone="success" dot>fits</Badge> : <Badge tone="warning">{h.reason}</Badge>}
                    {selectable && <Radio on={hostId === h.id} />}
                  </span>
                </div>
                <div className="mt-2.5 grid gap-2 @min-[36rem]:grid-cols-2">
                  <CapBar label="vCPU" used={h.allocated.vcpus} add={add} total={h.capacity.vcpus} current={h.current} self={vm.size.vcpus} />
                  <CapBar label="RAM GB" used={h.allocated.ramGB} add={addR} total={h.capacity.ramGB} current={h.current} self={vm.size.ramGB} />
                </div>
              </button>
            );
          })}
        </div>
        {!isLoading && !fits.length && <Hint tone="warning">No other host in {vm.locationId} can take this VM right now. Free up capacity or add hardware.</Hint>}
      </div>
    </Modal>
  );
}

function Radio({ on }: { on: boolean }) {
  return <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-brand-500 bg-brand-500' : 'border-line-strong')}>{on && <span className="size-1.5 rounded-full bg-white" />}</span>;
}

function CapBar({ label, used, add, total, current, self }: { label: string; used: number; add: number; total: number; current: boolean; self: number }) {
  // on the current host, "this VM" is part of `used`
  const others = current ? used - self : used;
  const mine = current ? self : add;
  const after = others + mine;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px]"><span className="text-muted">{label}</span><span className={cn('tabular', after > total ? 'text-rose-500' : 'text-fg-2')}>{after} / {total}</span></div>
      <StackBar total={Math.max(total, after)} height="h-2" segments={[{ value: others, color: 'rgb(148 163 184 / 0.7)', label: 'allocated' }, { value: mine, color: after > total ? '#f43f5e' : '#5b67f8', label: 'this VM' }]} />
    </div>
  );
}

/* ------------------------------------------------------------------ rebuild */

export function RebuildVmModal({ vm, open, onClose }: { vm: VM; open: boolean; onClose: () => void }) {
  const { items: images } = useList<Image>('images');
  const { items: keys } = useList<SshKey>('sshKeys');
  const [imageId, setImageId] = useState(vm.imageId);
  const [tab, setTab] = useState<'public' | 'custom'>('public');
  const [sshKeyIds, setSshKeyIds] = useState<string[]>(vm.sshKeyIds);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setImageId(vm.imageId); setSshKeyIds(vm.sshKeyIds); setTyped(''); setError(null); setTab(images.find((i) => i.id === vm.imageId)?.kind === 'custom' ? 'custom' : 'public') } }, [open]); // eslint-disable-line
  const list = images.filter((i) => i.kind === tab && i.status === 'available');
  const img = images.find((i) => i.id === imageId);
  const tooSmall = !!img && img.minDiskGB > vm.size.systemDiskGB;
  const m = useApiMutation(() => api.action('vms', vm.id, 'rebuild', { imageId, sshKeyIds }), { success: `Rebuilding ${vm.name}`, onSuccess: onClose, onError: (e) => setError(e.message) });
  return (
    <Modal open={open} onClose={onClose} size="lg" title={`Rebuild ${vm.name}`} icon={<span className="flex size-9 items-center justify-center rounded-full bg-rose-500/10 text-rose-500"><RefreshCcw className="size-[18px]" /></span>}
      description="Re-images the system disk. All data on the system disk is erased; attached volumes, IPs and firewalls are kept."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" icon={RefreshCcw} disabled={typed !== vm.name || tooSmall} loading={m.isPending} onClick={() => m.mutate()}>Rebuild</Button></>}>
      <div className="space-y-4">
        {error && <Hint tone="danger">{error}</Hint>}
        <div className="flex items-center justify-between"><span className="text-[13px] font-medium text-fg-2">Image</span><Segmented size="sm" value={tab} onChange={setTab} options={[{ value: 'public', label: 'Public' }, { value: 'custom', label: 'Custom' }]} /></div>
        <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto @min-[36rem]:grid-cols-2">
          {list.map((i) => (
            <button key={i.id} type="button" onClick={() => setImageId(i.id)} className={cn('flex items-center gap-2.5 rounded-xl border p-2.5 text-left', imageId === i.id ? 'border-brand-500 bg-brand-500/[0.06] ring-3 ring-brand-500/15' : 'border-line hover:bg-surface-2/60')}>
              <OsBadge os={i.os} size={26} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-fg">{i.name}</span><span className="block truncate text-[11px] text-muted">{i.minDiskGB > vm.size.systemDiskGB ? `needs ${i.minDiskGB} GB disk` : i.description}</span></span>
              {i.id === vm.imageId && <Badge tone="brand">current</Badge>}
            </button>
          ))}
          {!list.length && <p className="col-span-full py-6 text-center text-sm text-muted">No {tab} images available.</p>}
        </div>
        {tooSmall && <Hint tone="warning">{img!.name} needs a {img!.minDiskGB} GB system disk; this VM has {vm.size.systemDiskGB} GB. Resize first.</Hint>}
        {img?.os !== 'windows' && <Field label="SSH keys to inject"><MultiSelect options={keys.map((k) => ({ value: k.id, label: k.name, description: k.fingerprint }))} value={sshKeyIds} onChange={setSshKeyIds} /></Field>}
        <div>
          <p className="mb-1.5 text-[13px] text-muted">Type <code className="rounded bg-surface-3 px-1 font-mono text-fg">{vm.name}</code> to confirm</p>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={vm.name} />
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ clone */

export function CloneVmModal({ vm, open, onClose }: { vm: VM; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [publicIp, setPublicIp] = useState<'none' | 'new'>('none');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setName(`${vm.name}-clone`.slice(0, 63)); setPublicIp('none'); setErrors({}); setError(null) } }, [open]); // eslint-disable-line
  const m = useApiMutation(() => api.action<VM>('vms', vm.id, 'clone', { name, publicIp }), {
    success: `Cloning ${vm.name} → ${name}`, onSuccess: (c) => { onClose(); navigate(`/infrastructure/vms/${c.id}`) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); setError(e.message) },
  });
  return (
    <Modal open={open} onClose={onClose} title={`Clone ${vm.name}`} icon={<span className="flex size-9 items-center justify-center rounded-full bg-brand-500/10 text-brand-500"><Copy className="size-[18px]" /></span>}
      description="Creates a new VM with the same size, image, network, firewalls, SSH keys, tags and cloud-init. Data volumes are not copied."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Copy} loading={m.isPending} onClick={() => m.mutate()}>Clone VM</Button></>}>
      <div className="space-y-4">
        {error && !errors.name && <Hint tone="danger">{error}</Hint>}
        <Field label="Name" required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} invalid={!!errors.name} /></Field>
        <Field label="Public IPv4"><Segmented value={publicIp} onChange={setPublicIp} options={[{ value: 'none', label: 'Private only' }, { value: 'new', label: 'Allocate new (+€2/mo)' }]} /></Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ rename */

export function RenameModal({ title, current, open, onClose, onSave }: { title: string; current: string; open: boolean; onClose: () => void; onSave: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(current); setError(null) } }, [open, current]);
  const save = async () => {
    setBusy(true);
    try { await onSave(name); onClose() } catch (e) { setError((e as ApiClientError).details?.name ?? (e as Error).message) } finally { setBusy(false) }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title={title} icon={<span className="flex size-9 items-center justify-center rounded-full bg-brand-500/10 text-brand-500"><Pencil className="size-[18px]" /></span>}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name || name === current} onClick={save}>Rename</Button></>}>
      <Field label="Name" error={error} hint="Lowercase letters, digits and dashes. Also updates the guest hostname on next boot.">
        <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} onKeyDown={(e) => e.key === 'Enter' && save()} invalid={!!error} />
      </Field>
    </Modal>
  );
}

/* ------------------------------------------------------------------ snapshot */

export function SnapshotVmModal({ vm, open, onClose }: { vm: VM; open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setName(`${vm.name}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`); setDescription(''); setErrors({}) } }, [open]); // eslint-disable-line
  const m = useApiMutation(() => api.action('vms', vm.id, 'snapshot', { name, description }), { success: `Snapshot of ${vm.name} started`, onSuccess: onClose, onError: (e: ApiClientError) => setErrors(fieldErrors(e)) });
  const est = Math.max(2, Math.round(vm.size.systemDiskGB * 0.12));
  return (
    <Modal open={open} onClose={onClose} title={`Snapshot ${vm.name}`} icon={<span className="flex size-9 items-center justify-center rounded-full bg-brand-500/10 text-brand-500"><Camera className="size-[18px]" /></span>}
      description={vm.status === 'running' ? 'The filesystem is frozen for a moment via the guest agent for a consistent snapshot — no downtime.' : 'Point-in-time copy of the system disk.'}
      footer={<><span className="mr-auto text-xs text-muted">~{est} GB · {money(est * 0.02)}/mo</span><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Camera} loading={m.isPending} onClick={() => m.mutate()}>Take snapshot</Button></>}>
      <div className="space-y-4">
        <Field label="Name" error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} /></Field>
        <Field label="Description" optional><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. before upgrading nginx" /></Field>
        {vm.volumeIds.length > 0 && <p className="text-xs text-muted">Only the system disk is captured. Snapshot attached volumes from the Storage tab.</p>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ create & attach volume */

export function NewVolumeModal({ vm, open, onClose, location }: { vm: VM; open: boolean; onClose: () => void; location?: Location }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'ssd' | 'nvme' | 'hdd'>('ssd');
  const [sizeGB, setSizeGB] = useState(100);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setName(`${vm.name}-data-${vm.volumeIds.length + 1}`); setType('ssd'); setSizeGB(100); setErrors({}); setError(null) } }, [open]); // eslint-disable-line
  const iops = type === 'nvme' ? 10000 : type === 'hdd' ? 500 : 3000;
  const tp = type === 'nvme' ? 500 : type === 'hdd' ? 125 : 125;
  const cost = useMemo(() => vmCost({ vcpus: 0, ramGB: 0, systemDiskGB: 0, volumes: [{ type, sizeGB, iops, throughputMBps: tp }] }).total, [type, sizeGB, iops, tp]);
  const m = useApiMutation(() => api.create('volumes', { name, type, sizeGB: type === 'hdd' ? Math.max(100, sizeGB) : sizeGB, iops, throughputMBps: tp, projectId: vm.projectId, locationId: vm.locationId, attachToVmId: vm.id, tags: vm.tags, encrypted: true }), {
    success: `Creating ${name} and attaching to ${vm.name}`, onSuccess: onClose, onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); setError(e.message) },
  });
  return (
    <Modal open={open} onClose={onClose} title="Create & attach volume" description={`New encrypted block volume in ${location?.name ?? vm.locationId}, hot-plugged into ${vm.name}.`}
      footer={<><span className="mr-auto text-xs text-muted">{money(cost)}/mo</span><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={HardDrive} loading={m.isPending} onClick={() => m.mutate()}>Create & attach</Button></>}>
      <div className="space-y-4">
        {error && !Object.keys(errors).length && <Hint tone="danger">{error}</Hint>}
        <Field label="Name" error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} /></Field>
        <OptionCards cols={3} value={type} onChange={(t) => setType(t)} options={[
          { value: 'ssd', title: 'SSD', description: '3,000 IOPS', icon: <HardDrive className="size-4 text-sky-500" /> },
          { value: 'nvme', title: 'NVMe', description: '10,000 IOPS', icon: <Zap className="size-4 text-violet-500" /> },
          { value: 'hdd', title: 'HDD', description: 'cheap capacity', icon: <HardDrive className="size-4 text-slate-500" /> },
        ]} />
        <Field label={`Size · ${sizeGB} GB`} error={errors.sizeGB}><Slider value={sizeGB} onChange={setSizeGB} min={type === 'hdd' ? 100 : 10} max={4000} step={10} marks={[type === 'hdd' ? 100 : 10, 1000, 2000, 4000]} /></Field>
        <p className="text-xs text-muted">Need custom IOPS, throughput or a snapshot source? Use the <Link className="text-brand-500 hover:underline" to={`/infrastructure/volumes/new?vm=${vm.id}`} onClick={onClose}>full volume form</Link>.</p>
      </div>
    </Modal>
  );
}
