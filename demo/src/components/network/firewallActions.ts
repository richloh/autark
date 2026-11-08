import { api } from '@/api/client';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import type { Firewall } from '@/types';

export async function deleteFirewalls(list: Firewall[]): Promise<boolean> {
  const attached = list.reduce((a, f) => a + f.attachedTo.length, 0);
  const res = await confirm({
    title: `Delete ${list.length === 1 ? list[0].name : `${list.length} firewalls`}?`,
    message: attached ? `Attached to ${attached} resource(s). Their remaining firewalls keep applying; if none remain, all inbound traffic is blocked.` : 'Rules are removed permanently.',
    confirmLabel: 'Delete', danger: true,
    typeToConfirm: list.length === 1 && attached ? list[0].name : undefined,
    options: attached ? [{ id: 'force', label: `Detach from ${attached} resource${attached > 1 ? 's' : ''} and delete`, default: true }] : undefined,
  });
  if (!res) return false;
  const results = await Promise.allSettled(list.map((f) => api.remove('firewalls', f.id, res.force ? { force: 'true' } : undefined)));
  const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  if (failed.length) { toast.error(`${failed.length} deletion(s) failed`, failed[0].reason?.message); return false }
  toast.success(`Deleted ${list.length} firewall${list.length > 1 ? 's' : ''}`);
  return true;
}

