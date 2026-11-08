import { useEffect, useState } from 'react';
import { ArrowRight, Wrench, Play, Ban, RotateCw, HeartPulse, Download, Power, PowerOff, Trash2, RefreshCcw, Cpu as CpuIcon, AlertTriangle, CheckCircle2, MoveRight, Scale } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation, useGet } from '@/api/hooks';
import { Modal, confirm } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Hint } from '@/components/ui/form';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import type { MenuItem } from '@/components/ui/Menu';
import { cn } from '@/lib/cn';
import { utilColor } from './visuals';
import type { BareMetalHost, EvacuationPlan } from '@/types';

/* Lifecycle actions for hosts, shared by the list and the detail page. */

export function useHostActions() {
  const [maint, setMaint] = useState<BareMetalHost | null>(null);
  const run = useApiMutation(({ id, action, body }: { id: string; action: string; body?: unknown }) => api.action('hosts', id, action, body), { silent: true });

  const act = async (h: BareMetalHost, action: string, success: string, body?: unknown) => {
    try {
      await run.mutateAsync({ id: h.id, action, body });
      toast.success(success);
      return true;
    } catch (e: any) {
      toast.error(`Could not ${action.replace(/([A-Z])/g, ' $1').toLowerCase()} ${h.name}`, e?.message);
      return false;
    }
  };

  const reboot = async (h: BareMetalHost) => {
    const running = h.vms?.filter((v) => v.status === 'running').length ?? 0;
    const ok = await confirm({
      title: `Reboot ${h.name}?`,
      message: running
        ? `${running} running VM${running > 1 ? 's' : ''} will be paused (suspended to RAM) for about a minute and resumed afterwards. To avoid any pause, enter maintenance first — VMs are then live-migrated.`
        : 'The host is power-cycled via its BMC and rejoins the cluster automatically.',
      confirmLabel: 'Reboot',
      danger: running > 0,
    });
    if (ok) act(h, 'reboot', `Rebooting ${h.name}`);
  };
  const powerOff = async (h: BareMetalHost) => {
    const ok = await confirm({ title: `Power off ${h.name}?`, message: 'The host shuts down gracefully via the BMC and stays offline until powered on again. Running VMs block this — evacuate them first.', confirmLabel: 'Power off', danger: true });
    if (ok) act(h, 'powerOff', `Powering off ${h.name}`);
  };
  const decommission = async (h: BareMetalHost) => {
    const ok = await confirm({
      title: `Decommission ${h.name}?`,
      message: 'The host leaves the cluster, its agent identity is revoked and all disks are cryptographically erased. This cannot be undone. Hosts with VMs cannot be decommissioned.',
      confirmLabel: 'Decommission', danger: true, typeToConfirm: h.name,
    });
    if (ok) act(h, 'decommission', `Decommissioning ${h.name}`);
  };

  const items = (h: BareMetalHost): MenuItem[] => {
    const st = h.status;
    const list: MenuItem[] = [];
    if (st === 'maintenance') list.push({ label: 'Exit maintenance', icon: Play, onClick: () => act(h, 'exitMaintenance', `Returning ${h.name} to service`) });
    else list.push({ label: 'Enter maintenance…', icon: Wrench, disabled: !['ready', 'draining', 'error'].includes(st), onClick: () => setMaint(h), hint: h.allocated?.vms ? `${h.allocated.vms} VMs` : undefined });
    list.push({ label: 'Roles & availability…', icon: Scale, to: `/hardware/bare-metals/${h.id}?tab=policy` });
    if (st === 'draining') list.push({ label: 'Uncordon', icon: Play, onClick: () => act(h, 'exitMaintenance', `${h.name} accepts new VMs again`) });
    else list.push({ label: 'Cordon (no new VMs)', icon: Ban, disabled: st !== 'ready', onClick: () => act(h, 'drain', `${h.name} cordoned — no new VMs will be scheduled`) });
    list.push(
      { divider: true, label: '' },
      { label: 'Reboot…', icon: RotateCw, disabled: !['ready', 'maintenance', 'draining', 'error'].includes(st), onClick: () => reboot(h) },
      { label: 'Run health check', icon: HeartPulse, disabled: !['ready', 'maintenance', 'draining', 'error'].includes(st), onClick: () => act(h, 'runHealthCheck', `Health check started on ${h.name}`) },
      { label: h.agentUpdateAvailable ? `Update agent → ${h.latestAgentVersion}` : 'Agent up to date', icon: Download, disabled: !h.agentUpdateAvailable || !['ready', 'maintenance', 'draining'].includes(st), onClick: () => act(h, 'updateAgent', `Updating agent on ${h.name}`) },
    );
    if (h.firmwareUpdateAvailable) list.push({ label: 'Update BMC firmware', icon: CpuIcon, disabled: st !== 'maintenance', hint: st !== 'maintenance' ? 'needs maintenance' : undefined, onClick: () => act(h, 'updateFirmware', `Flashing firmware on ${h.name}`) });
    if (st === 'provisioning' || st === 'error') list.push({ label: 'Retry enrollment', icon: RefreshCcw, onClick: () => act(h, 'retryEnrollment', `Retrying enrollment of ${h.name}`) });
    list.push(st === 'offline'
      ? { label: 'Power on', icon: Power, onClick: () => act(h, 'powerOn', `Powering on ${h.name}`) }
      : { label: 'Power off…', icon: PowerOff, disabled: !['ready', 'maintenance', 'draining', 'error'].includes(st), onClick: () => powerOff(h) });
    list.push({ divider: true, label: '' }, { label: 'Decommission…', icon: Trash2, danger: true, disabled: st === 'decommissioning', onClick: () => decommission(h) });
    return list;
  };

  return {
    items, act, reboot, powerOff, decommission, openMaintenance: setMaint, pending: run.isPending,
    modal: <MaintenanceModal host={maint} onClose={() => setMaint(null)} onConfirm={async (reason) => { if (maint && await act(maint, 'enterMaintenance', `Evacuating ${maint.name}`, { reason })) setMaint(null) }} />,
  };
}

/** Evacuation plan preview: where every VM goes before the host enters maintenance. */
export function MaintenanceModal({ host, onClose, onConfirm }: { host: BareMetalHost | null; onClose: () => void; onConfirm: (reason: string) => void | Promise<void> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(host?.maintenanceReason ?? '') }, [host?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: plan, isLoading, error } = useGet<EvacuationPlan>(['hosts', 'plan', host?.id], host ? `/hosts/${host.id}/evacuation-plan` : null);
  const receiving = plan?.targets.filter((t) => plan.moves.some((m) => m.targetHostId === t.id)) ?? [];
  return (
    <Modal
      open={!!host}
      onClose={onClose}
      size="lg"
      title={`Enter maintenance · ${host?.name ?? ''}`}
      description="Autark cordons the host, live-migrates running VMs to other ready hosts in the same location and then marks it safe for hands-on work."
      icon={<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-500"><Wrench className="size-[18px]" /></div>}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={Wrench} loading={busy} disabled={!plan?.feasible} onClick={async () => { setBusy(true); try { await onConfirm(reason) } finally { setBusy(false) } }}>
          {plan?.moves.length ? `Evacuate ${plan.moves.length} VM${plan.moves.length > 1 ? 's' : ''} & enter maintenance` : 'Enter maintenance'}
        </Button>
      </>}
    >
      {isLoading || !plan ? (error ? <Hint tone="danger">{(error as Error).message}</Hint> : <div className="space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>) : (
        <div className="space-y-4">
          <Hint tone={plan.feasible ? (plan.moves.length ? 'info' : 'success') : 'danger'}>{plan.message}</Hint>

          {plan.moves.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">Evacuation plan</div>
              <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                {plan.moves.map((m, i) => (
                  <li key={m.vmId} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 @min-[36rem]:flex-nowrap', !m.targetHostId && 'bg-rose-500/5')}>
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[10px] font-semibold tabular text-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1 @min-[36rem]:w-[38%] @min-[36rem]:flex-none">
                      <div className="truncate text-sm font-medium text-fg">{m.vmName}</div>
                      <div className="text-[11px] tabular text-muted">{m.vcpus} vCPU · {m.ramGB} GB{m.gpus ? ` · ${m.gpus}× GPU` : ''}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge tone={m.live ? 'brand' : 'neutral'}>{m.live ? 'live' : 'cold'}</Badge>
                      <MoveRight className={cn('size-4', m.targetHostId ? 'text-brand-500' : 'text-rose-500')} />
                    </div>
                    <div className="min-w-0 flex-1">
                      {m.targetHostId ? (
                        <span className="flex items-center gap-1.5 font-mono text-[13px] text-fg"><CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />{m.targetHostName}</span>
                      ) : (
                        <span className="flex items-start gap-1.5 text-[12.5px] text-rose-600 dark:text-rose-400"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{m.reason}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {receiving.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">Impact on receiving hosts</div>
              <div className="grid gap-2 @min-[36rem]:grid-cols-2">
                {receiving.map((t) => (
                  <div key={t.id} className="rounded-xl border border-line p-3">
                    <div className="mb-2 font-mono text-[13px] font-medium text-fg">{t.name}</div>
                    <ImpactBar label="vCPU" before={t.before.vcpus} after={t.after.vcpus} cap={t.capacity.vcpus} />
                    <ImpactBar label="RAM" unit="GB" before={t.before.ramGB} after={t.after.ramGB} cap={t.capacity.ramGB} className="mt-2" />
                  </div>
                ))}
              </div>
            </div>
          )}

          <Field label="Reason" optional hint="Shown on the host and in the audit log, e.g. a ticket number.">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Replace PSU 2 · OPS-1234" />
          </Field>
        </div>
      )}
    </Modal>
  );
}

function ImpactBar({ label, before, after, cap, unit = '', className }: { label: string; before: number; after: number; cap: number; unit?: string; className?: string }) {
  const r0 = cap ? before / cap : 0, r1 = cap ? after / cap : 0;
  return (
    <div className={className}>
      <div className="mb-1 flex justify-between text-[11px]"><span className="text-muted">{label}</span><span className="tabular text-fg-2">{before} <ArrowRight className="inline size-3" /> <b className="font-semibold text-fg">{after}</b> / {cap} {unit}</span></div>
      <div className="relative h-2 overflow-hidden rounded-full bg-surface-3">
        <div className="absolute inset-y-0 left-0 rounded-full opacity-40" style={{ width: `${Math.min(100, r1 * 100)}%`, background: utilColor(r1) }} />
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, r0 * 100)}%`, background: utilColor(r1) }} />
        <div className="absolute inset-y-0 rounded-r-full bg-[repeating-linear-gradient(135deg,transparent_0,transparent_3px,rgba(255,255,255,.45)_3px,rgba(255,255,255,.45)_5px)]" style={{ left: `${Math.min(100, r0 * 100)}%`, width: `${Math.max(0, Math.min(100, r1 * 100) - Math.min(100, r0 * 100))}%`, background: utilColor(r1) }} />
      </div>
    </div>
  );
}
