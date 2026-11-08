import { useEffect, useState } from 'react';
import { MoreHorizontal, ExternalLink, ArrowRightLeft, Pause, Play, Users, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/api/client';
import { useGet, useApiMutation, useList } from '@/api/hooks';
import { usePro } from '@/store/ui';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusPill, Badge } from '@/components/ui/Badge';
import { IconButton, Button } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import { Modal, confirm } from '@/components/ui/Modal';
import { Mono } from '@/components/ui/misc';
import { Hint } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';
import type { PlatformClusterCandidate } from '@/types';
import { QuotaMini, n1, type PlatformClusterView, type TenantRow } from './shared';

export function PcTenants({ pc }: { pc: PlatformClusterView }) {
  const pro = usePro();
  const { data, isLoading } = useGet<{ items: TenantRow[] }>(['k8sSpaces', 'tenants', pc.id], `/platformClusters/${pc.id}/tenants`, { refetchInterval: 4000 });
  const rows = data?.items ?? [];
  const [moving, setMoving] = useState<TenantRow | null>(null);
  const run = useApiMutation(({ t, action }: { t: TenantRow; action: 'suspend' | 'resume' }) => api.post(`/platformClusters/${pc.id}/tenants/${t.id}/${action}`), {
    success: (_r, v) => (v.action === 'suspend' ? `${v.t.name} suspended — workloads scaled to 0` : `Resuming ${v.t.name}`),
  });
  const suspend = async (t: TenantRow) => {
    const ok = await confirm({ title: `Suspend ${t.name}?`, message: `All workloads of ${t.accountName} in ${t.namespace} are scaled to 0. Data and configuration stay; the tenant is notified. Billing drops to storage only.`, danger: true, confirmLabel: 'Suspend space' });
    if (ok) run.mutate({ t, action: 'suspend' });
  };

  const columns: Column<TenantRow>[] = [
    { id: 'name', header: 'Space', sort: (t) => t.name, cell: (t) => (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-medium text-fg">{t.name}{t.incoming && <Badge tone="info">moving here</Badge>}</div>
        <Mono className="text-[11px] text-muted">{t.namespace}</Mono>
      </div>
    ) },
    { id: 'account', header: 'Account', sort: (t) => t.accountName, cell: (t) => (
      <div className="min-w-0">
        <div className="truncate text-[13px] text-fg">{t.accountName}</div>
        <div className="flex items-center gap-1.5 truncate text-[11px] text-muted"><span className="size-1.5 rounded-full" style={{ background: t.projectColor ?? '#64748b' }} />{t.projectName}</div>
      </div>
    ) },
    { id: 'cpu', header: 'CPU', sort: (t) => t.quota.cpuCores, cell: (t) => <QuotaMini used={t.used.cpuCores} quota={t.quota.cpuCores} unit="cores" /> },
    { id: 'mem', header: 'Memory', sort: (t) => t.quota.memoryGi, hideBelow: 'sm', cell: (t) => <QuotaMini used={t.used.memoryGi} quota={t.quota.memoryGi} unit="GiB" /> },
    ...(pro ? [
      { id: 'pods', header: 'Pods', hideBelow: 'lg', align: 'right', sort: (t) => t.used.pods, cell: (t) => <span className="text-xs tabular text-fg-2">{t.used.pods} / {t.quota.pods}</span> } as Column<TenantRow>,
      { id: 'cost', header: 'Billed', hideBelow: 'xl', align: 'right', sort: (t) => t.monthlyCost, cell: (t) => <span className="text-xs tabular text-fg-2">{money(t.monthlyCost)}/mo</span> } as Column<TenantRow>,
    ] : []),
    { id: 'status', header: 'Status', sort: (t) => t.status, cell: (t) => <StatusPill status={t.status === 'provisioning' && t.incoming ? 'migrating' : t.status} /> },
  ];

  const promised = rows.reduce((a, t) => a + t.quota.cpuCores, 0);
  const used = rows.reduce((a, t) => a + t.used.cpuCores, 0);

  return (
    <div className="space-y-3">
      {pro && rows.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          <span><b className="font-semibold text-fg">{rows.length}</b> spaces of <b className="font-semibold text-fg">{new Set(rows.map((r) => r.accountId)).size}</b> accounts</span>
          <span><b className="font-semibold text-fg">{n1(used)}</b> of <b className="font-semibold text-fg">{n1(promised)}</b> promised cores in use ({promised ? Math.round((used / promised) * 100) : 0}%)</span>
          <span>{money(rows.reduce((a, t) => a + t.monthlyCost, 0))}/mo billed</span>
        </div>
      )}
      <DataTable
        rows={rows}
        loading={isLoading}
        columns={columns}
        searchText={(t) => `${t.name} ${t.namespace} ${t.accountName} ${t.projectName}`}
        searchPlaceholder="Search spaces, accounts…"
        rowLink={(t) => `/managed-services/kubernetes/spaces/${t.id}`}
        defaultSort={{ id: 'account', dir: 'asc' }}
        empty={{ icon: Users, title: 'No tenants yet', description: 'Customers create spaces under Kubernetes → Spaces; they land on the best-fitting platform cluster.' }}
        rowActions={(t) => (
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />} items={[
            { label: 'Open space', icon: ExternalLink, to: `/managed-services/kubernetes/spaces/${t.id}` },
            { label: 'Move to other cluster…', icon: ArrowRightLeft, disabled: t.status !== 'active' && t.status !== 'suspended', onClick: () => setMoving(t) },
            t.status === 'suspended'
              ? { label: 'Resume', icon: Play, onClick: () => run.mutate({ t, action: 'resume' }) }
              : { label: 'Suspend…', icon: Pause, danger: true, disabled: t.status !== 'active', onClick: () => suspend(t) },
          ]} />
        )}
      />
      <MoveModal pc={pc} tenant={moving} onClose={() => setMoving(null)} />
    </div>
  );
}

function MoveModal({ pc, tenant, onClose }: { pc: PlatformClusterView; tenant: TenantRow | null; onClose: () => void }) {
  const { items: clusters } = useList<PlatformClusterView>('platformClusters');
  const [target, setTarget] = useState('');
  const path = tenant ? `/k8sSpaces/placement-preview?cpuCores=${tenant.quota.cpuCores}&memoryGi=${tenant.quota.memoryGi}&storageGi=${tenant.quota.storageGi}&projectId=${tenant.projectId}` : null;
  const { data } = useGet<{ candidates: PlatformClusterCandidate[] }>(['platformClusters', 'move-preview', tenant?.id], path);
  const options = (data?.candidates ?? []).filter((c) => c.id !== pc.id);
  useEffect(() => { setTarget(options.find((c) => c.fits)?.id ?? '') }, [tenant?.id, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = useApiMutation(() => api.post(`/platformClusters/${pc.id}/tenants/${tenant!.id}/move`, { platformClusterId: target }), {
    success: () => `Moving ${tenant?.name} to ${clusters.find((c) => c.id === target)?.name ?? target}`, onSuccess: onClose,
  });
  return (
    <Modal open={!!tenant} onClose={onClose} title={`Move ${tenant?.name ?? ''}`} description={tenant ? `${tenant.accountName} · ${tenant.projectName} · ${n1(tenant.quota.cpuCores)} cores / ${n1(tenant.quota.memoryGi)} GiB reserved` : undefined}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={ArrowRightLeft} disabled={!target} loading={move.isPending} onClick={() => move.mutate()}>Move space</Button></>}>
      <div className="space-y-3">
        {options.length ? (
          <div className="space-y-2" role="radiogroup">
            {options.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={target === c.id} disabled={!c.fits} onClick={() => setTarget(c.id)}
                className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-60', target === c.id ? 'border-brand-500 bg-brand-500/[0.06] ring-3 ring-brand-500/15' : 'border-line hover:border-line-strong')}>
                {c.fits ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" /> : <XCircle className="size-4 shrink-0 text-rose-500" />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-fg">{c.name} <span className="text-xs font-normal text-muted">· {c.locationId} · v{c.version} · {c.tenants} tenants</span></div>
                  <div className="text-xs text-muted">{c.fits ? `${n1(c.free.cpuCores)} cores / ${n1(c.free.memoryGi)} GiB free to promise` : c.reason}</div>
                </div>
              </button>
            ))}
          </div>
        ) : <Hint tone="warning">No other platform cluster may host this space.</Hint>}
        <Hint>The namespace, quota and policies are recreated on the target, volumes are copied with Velero, workloads restart once and ingress DNS is switched. The tenant is notified; their kubeconfig server URL changes.</Hint>
      </div>
    </Modal>
  );
}
