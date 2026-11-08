import { useMemo } from 'react';
import { api } from '@/api/client';
import { useGet } from '@/api/hooks';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { hashString } from '@/lib/random';
import { spaceCost } from '@/lib/pricing';
import { useUi } from '@/store/ui';
import type { K8sPod, K8sSpace, K8sWorkload, PlatformCluster, SpaceQuota } from '@/types';

/* Shared helpers for the shared-Kubernetes ("spaces") customer UI. */

export const SPACE_COLOR = '#0ea5e9';

/** Space as returned by the API (decorated with a few platform-cluster facts). */
export type SpaceView = K8sSpace & { platformClusterName?: string; endpoint?: string; version?: string; podSecurity?: string; workloads?: number; credentialGeneration?: number; credentialsRotatedAt?: string | null };

/** Namespaces and hostnames are derived from the account (e.g. acc-regiocom → regiocom). */
export const accountSlug = (accountId: string) => accountId.replace(/^acc-/, '');

export interface SpaceUsage { quota: SpaceQuota; used: SpaceQuota; pods: { used: number; max: number } }
export interface SpaceKubeconfig { yaml: string; server: string; namespace: string; user: string; filename?: string; issuedAt?: string }

export type SizeId = 's' | 'm' | 'l' | 'custom';
export const SPACE_SIZES: { id: Exclude<SizeId, 'custom'>; name: string; description: string; quota: SpaceQuota }[] = [
  { id: 's', name: 'Small', description: 'A website, an API, a bot', quota: { cpuCores: 2, memoryGi: 4, storageGi: 20, pods: 30, loadBalancers: 0 } },
  { id: 'm', name: 'Medium', description: 'A few services with a database', quota: { cpuCores: 4, memoryGi: 8, storageGi: 50, pods: 60, loadBalancers: 1 } },
  { id: 'l', name: 'Large', description: 'A busy app or a whole team', quota: { cpuCores: 8, memoryGi: 16, storageGi: 100, pods: 120, loadBalancers: 2 } },
];
export const CUSTOM_LIMITS: Record<keyof SpaceQuota, { min: number; max: number; step: number; unit: string; label: string }> = {
  cpuCores: { min: 0.5, max: 64, step: 0.5, unit: 'cores', label: 'CPU' },
  memoryGi: { min: 1, max: 256, step: 1, unit: 'GiB', label: 'Memory' },
  storageGi: { min: 0, max: 2000, step: 10, unit: 'GiB', label: 'Storage' },
  pods: { min: 5, max: 500, step: 5, unit: 'pods', label: 'Pods' },
  loadBalancers: { min: 0, max: 10, step: 1, unit: '', label: 'Load balancers' },
};
export const QUOTA_KEYS: (keyof SpaceQuota)[] = ['cpuCores', 'memoryGi', 'storageGi', 'pods', 'loadBalancers'];

export function sizeOf(q: SpaceQuota): SizeId {
  return SPACE_SIZES.find((s) => QUOTA_KEYS.every((k) => s.quota[k] === q[k]))?.id ?? 'custom';
}
export function quotaLine(q: SpaceQuota, opts: { lb?: boolean } = {}): string {
  return `${num1(q.cpuCores)} CPU · ${num1(q.memoryGi)} GiB · ${q.storageGi} GiB disk · ${q.pods} pods${opts.lb && q.loadBalancers ? ` · ${q.loadBalancers} LB` : ''}`;
}
export function num1(n: number): string { return n % 1 === 0 ? String(n) : n.toFixed(1) }

export const SHARED_FROM = spaceCost(SPACE_SIZES[0].quota).total;

export const EMPTY_QUOTA: SpaceQuota = { cpuCores: 0, memoryGi: 0, storageGi: 0, pods: 0, loadBalancers: 0 };

/** Requests of a space's workloads (fallback when the server has not decorated `used`). */
export function usedFromWorkloads(ws: K8sWorkload[]): SpaceQuota {
  return ws.reduce<SpaceQuota>((a, w) => {
    const n = w.kind === 'CronJob' ? 0 : w.replicas;
    return {
      cpuCores: a.cpuCores + (w.cpuRequestM * n) / 1000,
      memoryGi: a.memoryGi + (w.memRequestMi * n) / 1024,
      storageGi: a.storageGi,
      pods: a.pods + n,
      loadBalancers: a.loadBalancers + (w.expose === 'LoadBalancer' ? 1 : 0),
    };
  }, { ...EMPTY_QUOTA });
}

/** Usage of a space: `/usage` endpoint first, then the decorated `used`, then nothing. */
export function useSpaceUsage(space: K8sSpace | undefined, fast = false) {
  const q = useGet<SpaceUsage>(['k8sSpaces', 'usage', space?.id], space && space.status !== 'provisioning' ? `/k8sSpaces/${space.id}/usage` : null, { refetchInterval: fast ? 2000 : 8000 });
  const used: SpaceQuota | undefined = q.data?.used ?? space?.used;
  return { ...q, used, usage: q.data };
}

/** Platform clusters a project may place spaces on. */
export function canUse(pc: PlatformCluster, accountId: string, projectId: string): boolean {
  if (!pc.acceptingTenants) return false;
  if (pc.access.mode === 'all') return true;
  return pc.access.accountIds.includes(accountId) || (!!projectId && pc.access.projectIds.includes(projectId));
}
export function useUsablePlatformClusters(items: PlatformCluster[], projectId: string) {
  const accountId = useUi((s) => s.accountId);
  return useMemo(() => items.filter((pc) => canUse(pc, accountId, projectId)), [items, accountId, projectId]);
}

export function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'project';
}

export const SPACE_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$/;

/** Synthesized pod list for a space workload (spaces have no node-level topology view). */
export function synthPods(w: K8sWorkload): K8sPod[] {
  if (w.kind === 'CronJob') return [];
  const n = w.replicas;
  const h = hashString(`${w.id}:${w.revision ?? 1}`).toString(36).slice(0, 9).padEnd(9, 'x');
  return Array.from({ length: n }, (_, i) => {
    const ready = i < w.readyReplicas;
    const pendingQuota = !ready && w.status === 'Pending';
    return {
      name: `${w.name}-${h}-${hashString(`${w.id}${i}`).toString(36).slice(0, 5)}`,
      namespace: w.namespace, workloadId: w.id, workloadName: w.name, kind: w.kind,
      node: ready ? `shared-worker-${(hashString(w.id) + i) % 6 + 1}` : null,
      status: w.status === 'Terminating' ? 'Terminating' : ready ? 'Running' : pendingQuota ? 'Pending' : 'ContainerCreating',
      reason: pendingQuota ? 'exceeded quota' : undefined,
      cpuM: w.cpuRequestM, memMi: w.memRequestMi, gpu: 0, restarts: 0,
      ip: ready ? `10.244.${hashString(w.namespace) % 250}.${(hashString(w.id) + i * 7) % 250 + 2}` : null,
      startedAt: ready ? w.restartedAt ?? w.createdAt : null, image: w.image,
    } satisfies K8sPod;
  });
}

export async function downloadSpaceKubeconfig(s: Pick<K8sSpace, 'id' | 'name'>) {
  try {
    const kc = await api.get_<SpaceKubeconfig>(`/k8sSpaces/${s.id}/kubeconfig?download=1`);
    const file = kc.filename ?? `${s.name}-kubeconfig.yaml`;
    saveText(file, kc.yaml);
    toast.success(`Downloaded ${file}`, `kubectl --kubeconfig ~/Downloads/${file} get pods`);
  } catch (e) {
    toast.error('Could not get kubeconfig', (e as Error).message);
  }
}

export function saveText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/yaml' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function deleteSpace(s: K8sSpace, workloads?: number): Promise<boolean> {
  const ok = await confirm({
    title: `Delete space ${s.name}?`,
    message: `The namespace ${s.namespace}${workloads ? `, its ${workloads} workload${workloads === 1 ? '' : 's'}` : ''} and all persistent volumes in it are deleted. kubectl access stops immediately.`,
    confirmLabel: 'Delete space', danger: true, typeToConfirm: s.name,
  });
  if (!ok) return false;
  try { await api.remove('k8sSpaces', s.id); toast.success(`Deleting ${s.name}`); return true } catch (e) { toast.error('Delete failed', (e as Error).message); return false }
}

/** Compact used-vs-quota bar. */
export function UsageBar({ used, max, className, label, value }: { used: number; max: number; className?: string; label?: string; value?: string }) {
  const r = max > 0 ? Math.min(1, used / max) : 0;
  return (
    <div className={cn('flex items-center gap-2 text-[11px] text-muted', className)}>
      {label && <span className="w-7 shrink-0">{label}</span>}
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
        <div className={cn('h-full rounded-full transition-all duration-500', r > 0.9 ? 'bg-rose-500' : r > 0.75 ? 'bg-amber-500' : 'bg-sky-500')} style={{ width: `${r * 100}%` }} />
      </div>
      {value && <span className="whitespace-nowrap tabular">{value}</span>}
    </div>
  );
}
