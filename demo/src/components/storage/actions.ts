import { api } from '@/api/client';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { num, bytes } from '@/lib/format';
import type { Bucket } from '@/types';

/** Confirm + delete a bucket (offers force-delete for non-empty buckets). Resolves true when deletion started. */
export async function deleteBucketFlow(b: Bucket): Promise<boolean> {
  const empty = b.objectCount === 0;
  const res = await confirm({
    title: `Delete bucket ${b.name}?`,
    message: empty ? 'The bucket is empty. Its name is released and can be taken by anyone.' : `The bucket holds ${num(b.objectCount)} objects (${bytes(b.bytesUsed)}). Deleting it requires removing every object${b.versioning ? ' and all versions' : ''}.`,
    confirmLabel: 'Delete bucket', danger: true, typeToConfirm: b.name,
    options: empty ? undefined : [{ id: 'force', label: `Delete all ${num(b.objectCount)} objects too`, description: 'Required for non-empty buckets. This cannot be undone.' }],
  });
  if (!res) return false;
  try {
    const r = await api.remove('buckets', b.id, res.force ? { force: 'true' } : undefined);
    toast.success(r.async ? `Deleting ${b.name}` : `Deleted ${b.name}`, r.async ? 'Objects are being removed in the background.' : undefined);
    return true;
  } catch (e) { toast.error('Cannot delete bucket', (e as Error).message); return false }
}


/** Toggle public/private access with an explicit warning before going public. */
export async function toggleBucketAccess(b: Bucket): Promise<boolean> {
  if (b.access === 'private') {
    const ok = await confirm({
      title: `Make ${b.name} public?`,
      message: `Every object (${num(b.objectCount)}) becomes readable by anyone on the internet without authentication, and new uploads are public immediately. Only do this for static assets meant to be public.`,
      confirmLabel: 'Make public', danger: true, typeToConfirm: b.name,
    });
    if (!ok) return false;
  }
  try {
    await api.action('buckets', b.id, 'setAccess', { access: b.access === 'private' ? 'public-read' : 'private', acknowledgePublic: true });
    toast.success(b.access === 'private' ? `${b.name} is now public` : `${b.name} is now private`, b.access === 'private' ? 'Anonymous GetObject is allowed.' : 'Anonymous access is blocked.');
    return true;
  } catch (e) { toast.error('Could not change access', (e as Error).message); return false }
}
