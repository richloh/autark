import { ArrowRight, Server, Lock, Check, Boxes } from 'lucide-react';
import { NumberInput, Select, Switch } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { StatusDot } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import type { Certificate, LbProtocol, VM } from '@/types';
import { defaultHealthCheck, newListener, protocolsFor, type LbType, type ListenerDraft, type TgDraft } from './forms';

/* Simple-mode editor for the most common load balancer setup: ONE listener forwarding to ONE pool
 * of servers — "forward HTTPS 443 → port 80 on these servers". It edits the same listener/target
 * group drafts as the full editors (which stay available under Advanced). */

export function SimpleForwarding({ type, listeners, setListeners, tgs, setTgs, vms, certificates, onIssueCert, errors = {} }: {
  type: LbType;
  listeners: ListenerDraft[];
  setListeners: (l: ListenerDraft[]) => void;
  tgs: TgDraft[];
  setTgs: (t: TgDraft[]) => void;
  vms: VM[];
  certificates: Certificate[];
  onIssueCert: () => void;
  errors?: Record<string, string>;
}) {
  const main = listeners.find((l) => !l.redirectToHttps) ?? listeners[0];
  const tg = tgs.find((t) => t.id === main?.defaultTargetGroupId) ?? tgs[0];
  if (!main || !tg) return null;
  const mainIdx = listeners.indexOf(main);
  const tgIdx = tgs.indexOf(tg);
  const redirect = listeners.find((l) => l.redirectToHttps);
  const usable = certificates.filter((c) => c.status !== 'failed' && c.status !== 'expired');

  const setMain = (patch: Partial<ListenerDraft>, dropRedirect = false) =>
    setListeners(listeners.filter((l) => !(dropRedirect && l.redirectToHttps)).map((l) => (l.id === main.id ? { ...l, ...patch } : l)));
  const setTg = (patch: Partial<TgDraft>) => setTgs(tgs.map((t) => (t.id === tg.id ? { ...t, ...patch } : t)));

  const setProtocol = (protocol: LbProtocol) => {
    if (type === 'L7') {
      const https = protocol === 'HTTPS';
      setMain({ protocol, port: https ? 443 : 80, certificateId: https ? main.certificateId ?? usable[0]?.id ?? null : null }, !https);
    } else {
      setMain({ protocol });
      setTg({ protocol, healthCheck: defaultHealthCheck(protocol) });
    }
  };
  const toggleRedirect = (on: boolean) => {
    if (on) setListeners([...listeners, { ...newListener('L7', tg.id, false), port: 80, protocol: 'HTTP', redirectToHttps: true }]);
    else setListeners(listeners.filter((l) => !l.redirectToHttps));
  };
  const selected = (id: string) => tg.targets.some((t) => t.ref.type === 'vm' && t.ref.id === id);
  const toggleVm = (id: string) => setTg({ targets: selected(id) ? tg.targets.filter((t) => !(t.ref.type === 'vm' && t.ref.id === id)) : [...tg.targets, { ref: { type: 'vm', id }, weight: 100 }] });
  const k8sTargets = tg.targets.filter((t) => t.ref.type === 'k8s').length;
  const e = (k: string) => errors[k];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface-2/40 p-3.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 text-[13px] text-fg-2">
          <span className="font-medium text-fg">Forward</span>
          <Segmented size="sm" value={main.protocol} onChange={setProtocol} options={protocolsFor(type).map((p) => ({ value: p, label: p, icon: p === 'HTTPS' ? <Lock className="size-3" /> : undefined }))} />
          <span>port</span>
          <NumberInput className="w-28" value={main.port} onChange={(n) => setMain({ port: n })} min={1} max={65535} />
          <ArrowRight className="size-4 text-faint" />
          <span>port</span>
          <NumberInput className="w-28" value={tg.port} onChange={(n) => setTg({ port: n })} min={1} max={65535} />
          <span>on these servers</span>
        </div>
        {(e(`listeners.${mainIdx}.port`) || e(`targetGroups.${tgIdx}.port`)) && <p className="mt-2 text-xs text-rose-500">{e(`listeners.${mainIdx}.port`) || e(`targetGroups.${tgIdx}.port`)}</p>}
        {main.protocol === 'HTTPS' && (
          <div className="mt-3 space-y-3 border-t border-line pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-fg-2"><Lock className="size-3.5" /> Certificate</span>
              <Select className="min-w-0 flex-1 basis-56" value={main.certificateId ?? ''} onChange={(ev) => setMain({ certificateId: ev.target.value || null })}
                placeholder={usable.length ? 'Choose certificate' : 'No certificate yet'}
                options={usable.map((c) => ({ value: c.id, label: `${c.domains.join(', ')}${c.status === 'pending' ? ' (issuing…)' : ''}` }))} />
              <button type="button" onClick={onIssueCert} className="text-xs font-medium text-brand-500 hover:underline">Get a free certificate</button>
            </div>
            {e(`listeners.${mainIdx}.certificateId`) && <p className="text-xs text-rose-500">{e(`listeners.${mainIdx}.certificateId`)}</p>}
            <Switch size="sm" checked={!!redirect} onChange={toggleRedirect} label="Redirect HTTP to HTTPS" description="Visitors on http:// (port 80) are sent to https://." />
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-medium text-fg-2">Servers</span>
          <span className="text-xs text-muted">{tg.targets.length} selected</span>
        </div>
        {vms.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-muted">No servers in this location yet. You can add them later.</p>
        ) : (
          <div className="grid gap-2 @min-[36rem]:grid-cols-2">
            {vms.map((v) => {
              const on = selected(v.id);
              return (
                <button key={v.id} type="button" onClick={() => toggleVm(v.id)} aria-pressed={on}
                  className={cn('flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors', on ? 'border-brand-500 bg-brand-500/[0.04]' : 'border-line hover:border-line-strong')}>
                  <span className={cn('flex size-4.5 shrink-0 items-center justify-center rounded border', on ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong')}>{on && <Check className="size-3" />}</span>
                  <Server className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-fg">{v.name}</span>
                    <span className="block truncate font-mono text-[11px] text-muted">{v.privateIp}</span>
                  </span>
                  <StatusDot status={v.status} />
                </button>
              );
            })}
          </div>
        )}
        {k8sTargets > 0 && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Boxes className="size-3.5" /> + {k8sTargets} Kubernetes cluster target{k8sTargets > 1 ? 's' : ''} (see Advanced)</p>}
        {e(`targetGroups.${tgIdx}.targets`) && <p className="mt-1 text-xs text-rose-500">{e(`targetGroups.${tgIdx}.targets`)}</p>}
      </div>
    </div>
  );
}
