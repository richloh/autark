import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { MoreHorizontal, RotateCcw, HardDrive, Disc3, Trash2, Pencil } from 'lucide-react';
import { api, ApiClientError } from '@/api/client';
import { useApiMutation } from '@/api/hooks';
import { Modal, confirm } from '@/components/ui/Modal';
import { Menu } from '@/components/ui/Menu';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select, NumberInput, Textarea, Hint } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { toast } from '@/components/ui/toast';
import { money } from '@/lib/format';
import { volumeCost } from '@/lib/pricing';
import { VOLUME_LIMITS, type Snapshot, type VolumeType } from '@/types';

/** Restore a snapshot onto its source (with confirmation). */
export async function restoreSnapshot(s: Snapshot): Promise<boolean> {
  const ok = await confirm({
    title: `Restore ${s.sourceName} from ${s.name}?`,
    message: s.kind === 'vm'
      ? `The VM will be stopped, its system disk rolled back to ${new Date(s.createdAt).toLocaleString()}, and started again if it was running. Changes made since then are lost.`
      : `The volume is rolled back to ${new Date(s.createdAt).toLocaleString()}. A safety snapshot is kept for 24h. The attached VM must be stopped.`,
    confirmLabel: 'Restore', danger: true,
  });
  if (!ok) return false;
  try {
    await api.action('snapshots', s.id, 'restore');
    toast.success(`Restoring ${s.sourceName}`, 'Follow progress in the operations tray.');
    return true;
  } catch (e) {
    toast.error('Restore failed', (e as Error).message);
    return false;
  }
}

export async function deleteSnapshot(s: Snapshot): Promise<boolean> {
  const ok = await confirm({ title: `Delete snapshot ${s.name}?`, message: `${s.sizeGB} GB of snapshot storage will be freed. This cannot be undone.`, confirmLabel: 'Delete', danger: true });
  if (!ok) return false;
  try { await api.remove('snapshots', s.id); toast.success(`Deleting ${s.name}`); return true } catch (e) { toast.error('Delete failed', (e as Error).message); return false }
}

/** Modal: create a new volume hydrated from a snapshot. */
export function CreateVolumeFromSnapshotModal({ snapshot, open, onClose, attachToVmId }: { snapshot: Snapshot | null; open: boolean; onClose: () => void; attachToVmId?: string }) {
  const navigate = useNavigate();
  const minGB = snapshot ? snapshot.sourceSizeGB ?? Math.ceil(snapshot.sizeGB) : 10;
  const [name, setName] = useState('');
  const [type, setType] = useState<VolumeType>('ssd');
  const [sizeGB, setSizeGB] = useState(minGB);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!snapshot) return;
    setName(`${snapshot.sourceName}-restore`.slice(0, 63));
    setType(snapshot.volumeType ?? 'ssd');
    setSizeGB(Math.max(VOLUME_LIMITS[snapshot.volumeType ?? 'ssd'].minGB, minGB));
    setErrors({});
  }, [snapshot?.id, open]); // eslint-disable-line
  const m = useApiMutation(() => api.action<{ id: string }>('snapshots', snapshot!.id, 'createVolume', { name, type, sizeGB, attachToVmId }), {
    success: `Creating volume ${name}`,
    onSuccess: (v) => { onClose(); navigate(`/infrastructure/volumes/${v.id}`) },
    onError: (e: ApiClientError) => setErrors(fieldErrors(e)),
  });
  const cost = volumeCost({ type, sizeGB, iops: VOLUME_LIMITS[type].minIops, throughputMBps: VOLUME_LIMITS[type].minTp });
  return (
    <Modal open={open && !!snapshot} onClose={onClose} title="Create volume from snapshot" description={snapshot ? `Data from ${snapshot.name} (${snapshot.sizeGB} GB) in ${snapshot.locationId}` : undefined}
      footer={<><span className="mr-auto text-xs text-muted">{money(cost.total)}/mo</span><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={HardDrive} loading={m.isPending} onClick={() => m.mutate()}>Create volume</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} invalid={!!errors.name} /></Field>
        <div className="grid gap-4 @min-[36rem]:grid-cols-2">
          <Field label="Type" error={errors.type}>
            <Select value={type} onChange={(e) => setType(e.target.value as VolumeType)} options={(Object.keys(VOLUME_LIMITS) as VolumeType[]).map((t) => ({ value: t, label: `${VOLUME_LIMITS[t].label} · ${VOLUME_LIMITS[t].description}` }))} />
          </Field>
          <Field label="Size" error={errors.sizeGB ?? errors.sourceSnapshotId} hint={`At least ${minGB} GB (source disk size)`}>
            <NumberInput value={sizeGB} onChange={setSizeGB} min={minGB} max={VOLUME_LIMITS[type].maxGB} step={10} unit="GB" />
          </Field>
        </div>
        {snapshot?.kind === 'vm' && <Hint>This is a VM system-disk snapshot. The volume can be attached to another VM to inspect or recover files.</Hint>}
      </div>
    </Modal>
  );
}

/** Modal: build a bootable custom image from a VM snapshot. */
export function CreateImageFromSnapshotModal({ snapshot, open, onClose, onCreated }: { snapshot: Snapshot | null; open: boolean; onClose: () => void; onCreated?: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [minDiskGB, setMinDiskGB] = useState(20);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!snapshot) return;
    setName(`${snapshot.sourceName}-image-${new Date().toISOString().slice(0, 10)}`.slice(0, 63));
    setDescription(snapshot.description ? `${snapshot.description} (from ${snapshot.name})` : `From snapshot ${snapshot.name}`);
    setMinDiskGB(Math.max(10, Math.ceil(snapshot.sizeGB * 2)));
    setErrors({});
  }, [snapshot?.id, open]); // eslint-disable-line
  const m = useApiMutation(() => api.action('snapshots', snapshot!.id, 'createImage', { name, description, minDiskGB }), {
    success: `Building image ${name}`,
    onSuccess: () => { onClose(); onCreated?.() },
    onError: (e: ApiClientError) => setErrors(fieldErrors(e)),
  });
  return (
    <Modal open={open && !!snapshot} onClose={onClose} title="Create image from snapshot" description="The disk is generalized (cloud-init reset, host keys removed) and replicated to all locations so new VMs can boot from it."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Disc3} loading={m.isPending} onClick={() => m.mutate()}>Build image</Button></>}>
      <div className="space-y-4">
        <Field label="Image name" required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} invalid={!!errors.name} /></Field>
        <Field label="Description" optional><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Minimum disk" error={errors.minDiskGB ?? errors.sourceSnapshotId} hint="VMs created from this image need at least this system disk size.">
          <NumberInput value={minDiskGB} onChange={setMinDiskGB} min={1} max={4096} step={5} unit="GB" />
        </Field>
      </div>
    </Modal>
  );
}

/** Modal: rename / describe a snapshot. */
function EditSnapshotModal({ snapshot, open, onClose }: { snapshot: Snapshot; open: boolean; onClose: () => void }) {
  const [name, setName] = useState(snapshot.name);
  const [description, setDescription] = useState(snapshot.description ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setName(snapshot.name); setDescription(snapshot.description ?? ''); setErrors({}) }, [open, snapshot]);
  const m = useApiMutation(() => api.update('snapshots', snapshot.id, { name, description }), { success: 'Snapshot updated', onSuccess: onClose, onError: (e: ApiClientError) => setErrors(fieldErrors(e)) });
  return (
    <Modal open={open} onClose={onClose} title="Edit snapshot" size="sm" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name" error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} /></Field>
        <Field label="Description" optional><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/** "…" menu for a snapshot row with restore / create volume / create image / edit / delete. Self-contained (owns its modals). */
export function SnapshotMenu({ snapshot: s, sourceExists = true, size = 'sm' }: { snapshot: Snapshot; sourceExists?: boolean; size?: 'xs' | 'sm' }) {
  const [modal, setModal] = useState<'volume' | 'image' | 'edit' | null>(null);
  const busy = s.status !== 'available';
  return (
    <>
      <Menu
        trigger={() => <IconButton icon={MoreHorizontal} label="Snapshot actions" size={size} />}
        width="w-60"
        items={[
          { label: s.kind === 'vm' ? 'Restore VM to this point' : 'Restore volume to this point', icon: RotateCcw, disabled: busy || !sourceExists, hint: !sourceExists ? 'source gone' : undefined, onClick: () => restoreSnapshot(s) },
          { label: 'Create volume from snapshot', icon: HardDrive, disabled: busy, onClick: () => setModal('volume') },
          ...(s.kind === 'vm' ? [{ label: 'Create image from snapshot', icon: Disc3, disabled: busy, onClick: () => setModal('image') }] : []),
          { label: 'Rename / describe', icon: Pencil, onClick: () => setModal('edit') },
          { divider: true, label: '' },
          { label: 'Delete snapshot', icon: Trash2, danger: true, disabled: busy, onClick: () => deleteSnapshot(s) },
        ]}
      />
      <CreateVolumeFromSnapshotModal snapshot={s} open={modal === 'volume'} onClose={() => setModal(null)} />
      <CreateImageFromSnapshotModal snapshot={s} open={modal === 'image'} onClose={() => setModal(null)} />
      <EditSnapshotModal snapshot={s} open={modal === 'edit'} onClose={() => setModal(null)} />
    </>
  );
}
