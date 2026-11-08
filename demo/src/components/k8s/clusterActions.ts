import { api } from '@/api/client';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import type { K8sCluster } from '@/types';

export async function downloadKubeconfig(c: Pick<K8sCluster, 'id' | 'name'>, mode: 'admin' | 'oidc' = 'admin') {
  try {
    const kc = await api.get_<{ yaml: string; filename: string }>(`/k8sClusters/${c.id}/kubeconfig?mode=${mode}&download=1`);
    const url = URL.createObjectURL(new Blob([kc.yaml], { type: 'application/yaml' }));
    const a = document.createElement('a');
    a.href = url; a.download = kc.filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`Downloaded ${kc.filename}`, `export KUBECONFIG=~/Downloads/${kc.filename}`);
  } catch (e) {
    toast.error('Could not get kubeconfig', (e as Error).message);
  }
}

export async function deleteCluster(c: K8sCluster): Promise<boolean> {
  if (c.deletionProtection) { toast.error('Deletion protection is on', 'Disable it in the cluster settings first.'); return false }
  const ok = await confirm({
    title: `Delete cluster ${c.name}?`,
    message: `All ${c.summary?.workloads ?? ''} workloads, ${c.summary?.nodes ?? ''} nodes, the control plane and etcd are destroyed. Persistent volumes with reclaimPolicy=Retain are kept.`,
    confirmLabel: 'Delete cluster', danger: true, typeToConfirm: c.name,
  });
  if (!ok) return false;
  try { await api.remove('k8sClusters', c.id); toast.success(`Deleting ${c.name}`); return true } catch (e) { toast.error('Delete failed', (e as Error).message); return false }
}

