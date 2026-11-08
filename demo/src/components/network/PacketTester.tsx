import { useState } from 'react';
import { Send, CheckCircle2, XCircle, ArrowRight, ShieldQuestion } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation } from '@/api/hooks';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { fieldErrors } from '@/components/ui/FormLayout';
import { cn } from '@/lib/cn';
import type { Firewall, FirewallEvaluation, FirewallRule } from '@/types';

const SAMPLES = [
  { label: 'Internet', ip: '8.8.8.8' },
  { label: 'Office', ip: '198.51.100.7' },
  { label: 'Bastion', ip: '10.10.1.5' },
  { label: 'VPC host', ip: '10.10.2.40' },
];
const PORTS = [{ p: '22', l: 'SSH' }, { p: '443', l: 'HTTPS' }, { p: '5432', l: 'Postgres' }, { p: '3389', l: 'RDP' }];

/**
 * Packet tester: asks the API to evaluate a hypothetical packet against the firewall (optionally
 * against unsaved draft rules) and shows the verdict + per-rule trace.
 */
export function PacketTester({ firewall, draftRules, onResult, className, vpcSample }: {
  firewall: Firewall;
  draftRules?: FirewallRule[];
  onResult?: (res: FirewallEvaluation | null) => void;
  className?: string;
  vpcSample?: string;
}) {
  const [direction, setDirection] = useState<'inbound' | 'outbound'>('inbound');
  const [protocol, setProtocol] = useState<'tcp' | 'udp' | 'icmp'>('tcp');
  const [port, setPort] = useState('22');
  const [ip, setIp] = useState('8.8.8.8');
  const [res, setRes] = useState<FirewallEvaluation | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const samples = vpcSample ? [...SAMPLES.slice(0, 2), { label: 'VPC host', ip: vpcSample }] : SAMPLES;

  const test = useApiMutation(() => api.action<FirewallEvaluation>('firewalls', firewall.id, 'evaluate', { direction, protocol, port: Number(port), ip, defaultInbound: firewall.defaultInbound, defaultOutbound: firewall.defaultOutbound, ...(draftRules ? { rules: draftRules } : {}) }), {
    silent: true,
    onSuccess: (r) => { setErrors({}); setRes(r); onResult?.(r) },
    onError: (e) => { setErrors(fieldErrors(e)); setRes(null); onResult?.(null); if (!Object.keys(fieldErrors(e)).length) setErrors({ ip: e.message }) },
  });

  const rulesById = new Map((draftRules ?? firewall.rules).map((r) => [r.id, r]));
  const matched = res?.matchedRuleId ? rulesById.get(res.matchedRuleId) : null;

  return (
    <div className={cn('space-y-4', className)}>
      <div className="grid gap-3 @min-[36rem]:grid-cols-2">
        <Field label="Direction">
          <Segmented value={direction} onChange={(v) => { setDirection(v); setRes(null); onResult?.(null) }} options={[{ value: 'inbound', label: 'Inbound' }, { value: 'outbound', label: 'Outbound' }]} />
        </Field>
        <Field label="Protocol">
          <Segmented value={protocol} onChange={setProtocol} options={[{ value: 'tcp', label: 'TCP' }, { value: 'udp', label: 'UDP' }, { value: 'icmp', label: 'ICMP' }]} />
        </Field>
        <Field label={direction === 'inbound' ? 'Source IP' : 'Destination IP'} error={errors.ip}>
          <Input mono value={ip} onChange={(e) => setIp(e.target.value.trim())} invalid={!!errors.ip} placeholder="203.0.113.7" />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {samples.map((s) => (
              <button key={s.label} type="button" onClick={() => setIp(s.ip)} className={cn('rounded-md border px-1.5 py-0.5 text-[11px]', ip === s.ip ? 'border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-300' : 'border-line text-muted hover:text-fg')}>
                {s.label} <span className="font-mono">{s.ip}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Destination port" error={errors.port}>
          <Input mono value={protocol === 'icmp' ? '—' : port} disabled={protocol === 'icmp'} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} invalid={!!errors.port} />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {PORTS.map((p) => (
              <button key={p.p} type="button" disabled={protocol === 'icmp'} onClick={() => setPort(p.p)} className={cn('rounded-md border px-1.5 py-0.5 text-[11px] disabled:opacity-40', port === p.p ? 'border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-300' : 'border-line text-muted hover:text-fg')}>
                {p.l} <span className="font-mono">{p.p}</span>
              </button>
            ))}
          </div>
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="primary" icon={Send} loading={test.isPending} onClick={() => test.mutate()}>Test packet</Button>
        {draftRules && <span className="text-xs text-muted">Evaluates your unsaved rules</span>}
      </div>

      {res ? (
        <div className={cn('animate-in overflow-hidden rounded-xl border', res.verdict === 'allow' ? 'border-emerald-500/30' : 'border-rose-500/30')}>
          <div className={cn('flex items-center gap-3 px-4 py-3', res.verdict === 'allow' ? 'bg-emerald-500/10' : 'bg-rose-500/10')}>
            {res.verdict === 'allow' ? <CheckCircle2 className="size-7 text-emerald-500" /> : <XCircle className="size-7 text-rose-500" />}
            <div className="min-w-0">
              <div className={cn('text-lg font-semibold tracking-tight', res.verdict === 'allow' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')}>{res.verdict === 'allow' ? 'ALLOWED' : 'DENIED'}</div>
              <div className="text-[13px] text-fg-2">{res.reason}</div>
            </div>
          </div>
          {/* packet path */}
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5 text-xs text-muted">
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-fg-2">{direction === 'inbound' ? ip : firewall.name}</span>
            <ArrowRight className="size-3.5" />
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-fg-2">{protocol.toUpperCase()}{protocol !== 'icmp' ? `:${port}` : ''}</span>
            <ArrowRight className="size-3.5" />
            <span className={cn('rounded-md px-1.5 py-0.5 font-medium', matched ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300' : 'bg-surface-3 text-fg-2')}>{matched ? `rule #${matched.priority}` : `default ${direction}`}</span>
            <ArrowRight className="size-3.5" />
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-fg-2">{direction === 'inbound' ? firewall.name : ip}</span>
          </div>
          <ol className="divide-y divide-line border-t border-line">
            {res.trace.map((t) => {
              const r = rulesById.get(t.ruleId);
              return (
                <li key={t.ruleId} className={cn('flex items-center gap-2.5 px-4 py-1.5 text-xs', t.matched && 'bg-brand-500/5')}>
                  <span className={cn('w-10 shrink-0 font-mono tabular', t.matched ? 'font-semibold text-brand-600 dark:text-brand-300' : 'text-faint')}>#{t.priority}</span>
                  <span className={cn('w-12 shrink-0 font-semibold uppercase', r?.action === 'allow' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>{r?.action}</span>
                  <span className="min-w-0 flex-1 truncate text-fg-2">{r?.description || `${r?.protocol}/${r?.ports} ${r?.source}`}</span>
                  <span className={cn('shrink-0', t.matched ? 'font-medium text-brand-600 dark:text-brand-300' : 'text-muted')}>{t.matched ? '✓ match' : t.reason}</span>
                </li>
              );
            })}
            {res.matchedBy === 'default' && (
              <li className="flex items-center gap-2.5 bg-surface-2/60 px-4 py-1.5 text-xs">
                <span className="w-10 shrink-0 font-mono text-faint">∞</span>
                <span className={cn('w-12 shrink-0 font-semibold uppercase', res.verdict === 'allow' ? 'text-emerald-600' : 'text-rose-600')}>{res.verdict}</span>
                <span className="flex-1 text-fg-2">Default {direction} policy</span>
                <span className="font-medium text-fg-2">✓ applied</span>
              </li>
            )}
          </ol>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-line p-4 text-[13px] text-muted">
          <ShieldQuestion className="size-5 text-faint" /> Describe a packet and press <b className="font-medium text-fg-2">Test packet</b> to see which rule decides its fate.
        </div>
      )}
    </div>
  );
}
