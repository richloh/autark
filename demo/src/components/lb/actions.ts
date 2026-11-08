import { api } from '@/api/client';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import type { LoadBalancer } from '@/types';

export async function deleteLoadBalancers(list: LoadBalancer[]) {
  const res = await confirm({
    title: `Delete ${list.length === 1 ? list[0].name : `${list.length} load balancers`}?`,
    message: 'Listeners stop accepting connections, in-flight requests are drained and the proxies are removed. Targets are not affected.',
    confirmLabel: 'Delete', danger: true, typeToConfirm: list.length === 1 ? list[0].name : undefined,
    options: [{ id: 'releaseIps', label: 'Release public IPs', description: 'Otherwise the VIPs stay allocated to the project for reuse (and keep their DNS).' }],
  });
  if (!res) return false;
  const results = await Promise.allSettled(list.map((l) => api.remove('loadBalancers', l.id, { releaseIps: String(!!res.releaseIps) })));
  const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  if (failed.length) toast.error(`${failed.length} deletion(s) failed`, failed[0].reason?.message);
  else toast.success(`Deleting ${list.length} load balancer${list.length > 1 ? 's' : ''}`);
  return !failed.length;
}
