import { useMemo } from 'react';
import { useGet, useOperationsFor } from '@/api/hooks';
import { vmCost } from '@/lib/pricing';
import { hashString } from '@/lib/random';
import { K8S_NODE_PRESETS, type K8sTopology, type NodePool, type Operation } from '@/types';

/* Shared helpers for the Kubernetes UI. */

const NS_COLORS: Record<string, string> = {
  'kube-system': '#64748b',
  default: '#5b67f8',
  'ingress-nginx': '#14b8a6',
  'cert-manager': '#22c55e',
  monitoring: '#f97316',
  logging: '#eab308',
  argocd: '#ef7b4d',
  'gpu-operator': '#84cc16',
  'external-dns': '#06b6d4',
  velero: '#0ea5e9',
  kyverno: '#f43f5e',
};
const PALETTE = ['#5b67f8', '#a855f7', '#ec4899', '#06b6d4', '#f59e0b', '#10b981', '#8b5cf6', '#3b82f6', '#d946ef', '#0891b2', '#e11d48', '#65a30d'];

export function nsColor(ns: string): string {
  return NS_COLORS[ns] ?? PALETTE[hashString(ns) % PALETTE.length];
}

export function fmtCpu(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  const c = m / 1000;
  return `${c % 1 === 0 ? c : c.toFixed(1)} cores`;
}
export function fmtCpuShort(m: number): string { return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)}` }
export function fmtMem(mi: number): string {
  if (mi < 1024) return `${Math.round(mi)}Mi`;
  const g = mi / 1024;
  return `${g % 1 === 0 ? g : g.toFixed(1)}Gi`;
}

export function poolNodeCost(p: Pick<NodePool, 'vcpus' | 'ramGB' | 'diskGB' | 'gpu'>): number {
  return vmCost({ vcpus: p.vcpus, ramGB: p.ramGB, systemDiskGB: p.diskGB, gpu: p.gpu }).total;
}

export function presetLabel(p: Pick<NodePool, 'presetId' | 'vcpus' | 'ramGB' | 'gpu'>): string {
  const preset = K8S_NODE_PRESETS.find((x) => x.id === p.presetId);
  return `${preset ? preset.name + ' · ' : ''}${p.vcpus} vCPU / ${p.ramGB} GB${p.gpu ? ` · ${p.gpu.count}× ${p.gpu.model}` : ''}`;
}

/** Topology (nodes, pods, events) for a cluster; polls quickly while operations run. */
export function useTopology(clusterId: string | undefined, fast: boolean) {
  return useGet<K8sTopology>(['k8sClusters', 'topology', clusterId], clusterId ? `/k8sClusters/${clusterId}/topology` : null, { refetchInterval: fast ? 900 : 8000 });
}

/** Running operations targeting a cluster. */
export function useClusterOps(clusterId: string | undefined) {
  const { items } = useOperationsFor(clusterId);
  return useMemo(() => {
    const running = items.filter((o) => o.status === 'running');
    const primary = running.find((o) => !o.type.startsWith('k8s.workload')) ?? running[0];
    return { all: items, running, primary: primary as Operation | undefined };
  }, [items]);
}

export const DAYS = [
  { value: 'mon', label: 'Monday' }, { value: 'tue', label: 'Tuesday' }, { value: 'wed', label: 'Wednesday' }, { value: 'thu', label: 'Thursday' },
  { value: 'fri', label: 'Friday' }, { value: 'sat', label: 'Saturday' }, { value: 'sun', label: 'Sunday' },
];

export const CNI_INFO: Record<string, { label: string; description: string }> = {
  cilium: { label: 'Cilium', description: 'eBPF dataplane, kube-proxy replacement, network policies & Hubble observability' },
  calico: { label: 'Calico', description: 'Battle-tested BGP/iptables networking with rich network policies' },
  flannel: { label: 'Flannel', description: 'Minimal VXLAN overlay — simple, no network policies' },
};
