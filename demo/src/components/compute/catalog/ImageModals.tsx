import { useEffect, useMemo, useState } from 'react';
import { Disc3, Camera, Server, Link2, Archive } from 'lucide-react';
import { api, ApiClientError } from '@/api/client';
import { useApiMutation, useList } from '@/api/hooks';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, NumberInput, Textarea, Hint } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { fieldErrors } from '@/components/ui/FormLayout';
import { IacTabs, toCli, toCurl, toHcl } from '@/components/ui/CodeBlock';
import { ProjectField } from '@/components/resource/pickers';
import { timeAgo } from '@/lib/format';
import type { Image, Snapshot, VM } from '@/types';

type Source = 'snapshot' | 'vm' | 'url';

/** Create a custom image from a VM snapshot, an existing VM or an import URL. */
export function CreateImageModal({ open, onClose, initialSnapshotId }: { open: boolean; onClose: () => void; initialSnapshotId?: string }) {
  const { items: snapshots } = useList<Snapshot>('snapshots', undefined, { enabled: open });
  const { items: vms } = useList<VM>('vms', undefined, { enabled: open });
  const [source, setSource] = useState<Source>('snapshot');
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [snapshotId, setSnapshotId] = useState('');
  const [vmId, setVmId] = useState('');
  const [url, setUrl] = useState('');
  const [arch, setArch] = useState<'x86_64' | 'arm64'>('x86_64');
  const [minDiskGB, setMinDiskGB] = useState(20);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const vmSnaps = useMemo(() => snapshots.filter((s) => s.kind === 'vm' && s.status === 'available' && (!projectId || s.projectId === projectId)), [snapshots, projectId]);
  const capVms = useMemo(() => vms.filter((v) => ['running', 'stopped'].includes(v.status) && (!projectId || v.projectId === projectId)), [vms, projectId]);

  useEffect(() => {
    if (!open) return;
    setErrors({}); setName(''); setDescription(''); setUrl('');
    if (initialSnapshotId) { setSource('snapshot'); setSnapshotId(initialSnapshotId) }
  }, [open, initialSnapshotId]);
  useEffect(() => { if (source === 'snapshot' && !vmSnaps.some((s) => s.id === snapshotId)) setSnapshotId(vmSnaps[0]?.id ?? '') }, [vmSnaps, source]); // eslint-disable-line
  useEffect(() => { if (source === 'vm' && !capVms.some((v) => v.id === vmId)) setVmId(capVms[0]?.id ?? '') }, [capVms, source]); // eslint-disable-line

  const snap = vmSnaps.find((s) => s.id === snapshotId);
  const vm = capVms.find((v) => v.id === vmId);
  useEffect(() => {
    const base = source === 'snapshot' ? snap?.sizeGB : source === 'vm' ? vm && Math.max(2, Math.round(vm.size.systemDiskGB * 0.12)) : undefined;
    if (base) setMinDiskGB(Math.max(10, Math.ceil(base * 2)));
    if (!name) {
      const stem = source === 'snapshot' ? snap?.sourceName : source === 'vm' ? vm?.name : undefined;
      if (stem) setName(`${stem}-golden-${new Date().toISOString().slice(0, 7)}`);
    }
  }, [snapshotId, vmId, source]); // eslint-disable-line

  const body = {
    name, description: description || undefined, projectId, minDiskGB, arch,
    ...(source === 'snapshot' ? { sourceSnapshotId: snapshotId } : source === 'vm' ? { sourceVmId: vmId } : { url }),
  };
  const m = useApiMutation(() => api.create<Image>('images', body), {
    success: (img) => `Building image ${img.name}`,
    onSuccess: onClose,
    onError: (e: ApiClientError) => setErrors(fieldErrors(e)),
  });

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Create custom image" icon={<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-500"><Disc3 className="size-[18px]" /></div>}
      description="Custom images are generalized (cloud-init reset, host keys removed), replicated to every location and shared across the account."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Disc3} loading={m.isPending} onClick={() => m.mutate()}>Build image</Button></>}>
      <div className="space-y-4">
        <Field label="Source" error={errors.source}>
          <Segmented value={source} onChange={(v) => { setSource(v); setName('') }} options={[
            { value: 'snapshot', label: 'VM snapshot', icon: <Camera className="size-3.5" /> },
            { value: 'vm', label: 'Running VM', icon: <Server className="size-3.5" /> },
            { value: 'url', label: 'Import URL', icon: <Link2 className="size-3.5" /> },
          ]} />
        </Field>
        <div className="grid gap-4 @min-[36rem]:grid-cols-2">
          <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />
          {source === 'snapshot' && (
            <Field label="Snapshot" required error={errors.sourceSnapshotId} hint={!vmSnaps.length ? 'No VM snapshots in this project' : snap ? `${snap.sizeGB} GB · ${timeAgo(snap.createdAt)}` : undefined}>
              <Select value={snapshotId} onChange={(e) => setSnapshotId(e.target.value)} options={vmSnaps.map((s) => ({ value: s.id, label: `${s.name} (${s.sourceName})` }))} placeholder={vmSnaps.length ? undefined : 'None available'} />
            </Field>
          )}
          {source === 'vm' && (
            <Field label="VM" required error={errors.sourceVmId} hint={vm?.status === 'running' ? 'The filesystem is frozen briefly while the disk is captured.' : undefined}>
              <Select value={vmId} onChange={(e) => setVmId(e.target.value)} options={capVms.map((v) => ({ value: v.id, label: `${v.name} · ${v.status}` }))} placeholder={capVms.length ? undefined : 'No VMs'} />
            </Field>
          )}
          {source === 'url' && (
            <Field label="Image URL" required error={errors.url} hint=".qcow2, .img, .raw, .vmdk or .iso over HTTP(S)">
              <Input mono value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img" invalid={!!errors.url} />
            </Field>
          )}
        </div>
        <div className="grid gap-4 @min-[36rem]:grid-cols-[1fr_150px_150px]">
          <Field label="Image name" required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} invalid={!!errors.name} placeholder="web-golden-2026-11" /></Field>
          <Field label="Architecture" error={errors.arch}><Select value={arch} onChange={(e) => setArch(e.target.value as 'x86_64')} options={[{ value: 'x86_64', label: 'x86_64' }, { value: 'arm64', label: 'arm64' }]} /></Field>
          <Field label="Min disk" error={errors.minDiskGB}><NumberInput value={minDiskGB} onChange={setMinDiskGB} min={1} max={4096} step={5} unit="GB" /></Field>
        </div>
        <Field label="Description" optional><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Hardened base with nginx, node 22 and monitoring agent" /></Field>
        {source === 'url' && <Hint><span className="flex items-center gap-1.5"><Archive className="size-3.5" />Imported images are converted to raw and sparsified. Make sure the image contains cloud-init to receive SSH keys.</span></Hint>}
        <details className="rounded-xl border border-line p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted">Equivalent code</summary>
          <IacTabs className="mt-3" snippets={{ terraform: toHcl('image', name || 'my_image', body), cli: toCli('image create', body), curl: toCurl('POST', '/images', body) }} />
        </details>
      </div>
    </Modal>
  );
}

/** Edit name / description / min disk of a custom image. */
export function EditImageModal({ image, onClose }: { image: Image | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [minDiskGB, setMinDiskGB] = useState(10);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (image) { setName(image.name); setDescription(image.description); setMinDiskGB(image.minDiskGB); setErrors({}) } }, [image]);
  const m = useApiMutation(() => api.update('images', image!.id, { name, description, minDiskGB }), { success: 'Image updated', onSuccess: onClose, onError: (e: ApiClientError) => setErrors(fieldErrors(e)) });
  return (
    <Modal open={!!image} onClose={onClose} title={`Edit ${image?.name ?? 'image'}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name" error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} invalid={!!errors.name} /></Field>
        <Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Minimum disk" error={errors.minDiskGB} hint={image ? `At least ${Math.ceil(image.sizeGB)} GB (image size)` : undefined}><NumberInput value={minDiskGB} onChange={setMinDiskGB} min={1} max={4096} step={5} unit="GB" /></Field>
      </div>
    </Modal>
  );
}

/** Deprecate an image with an optional replacement. */
export function DeprecateImageModal({ image, images, onClose }: { image: Image | null; images: Image[]; onClose: () => void }) {
  const [replacementId, setReplacementId] = useState('');
  useEffect(() => setReplacementId(''), [image]);
  const m = useApiMutation(() => api.action('images', image!.id, 'deprecate', { replacementId: replacementId || undefined }), { success: `${image?.name} deprecated`, onSuccess: onClose });
  const candidates = images.filter((i) => i.id !== image?.id && i.status === 'available');
  return (
    <Modal open={!!image} onClose={onClose} title={`Deprecate ${image?.name ?? ''}?`} description="Deprecated images stay bootable for existing VMs, but are hidden from the create form and flagged with a warning."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Deprecate</Button></>}>
      <Field label="Recommended replacement" optional hint="Shown to users next to the deprecation notice.">
        <Select value={replacementId} onChange={(e) => setReplacementId(e.target.value)} placeholder="No replacement" options={candidates.map((i) => ({ value: i.id, label: `${i.name}${i.kind === 'public' ? ' (public)' : ''}` }))} />
      </Field>
      {!!image?.usedBy && <Hint tone="warning" className="mt-3">{image.usedBy} VM{image.usedBy > 1 ? 's' : ''} currently run this image. They keep working; rebuild them to move to the replacement.</Hint>}
    </Modal>
  );
}
