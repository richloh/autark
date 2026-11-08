import { useState } from 'react';
import { Plus, Trash2, Terminal, Globe, Lock, Activity, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/form';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { cn } from '@/lib/cn';
import type { FirewallRule } from '@/types';
import { newRule } from './RuleEditor';
import { normalizeSource, PROTOCOL_OPTIONS } from './util';

/* Simple-mode firewall editor (Hetzner style): one list of inbound "allow" rules, common presets
 * first, priorities assigned automatically. Outbound rules and ordering stay untouched and are
 * editable in pro mode. */

export const QUICK_RULES: { id: string; label: string; hint: string; patch: Partial<FirewallRule> }[] = [
  { id: 'ssh', label: 'SSH', hint: 'TCP 22', patch: { protocol: 'tcp', ports: '22', description: 'SSH' } },
  { id: 'http', label: 'HTTP', hint: 'TCP 80', patch: { protocol: 'tcp', ports: '80', description: 'HTTP' } },
  { id: 'https', label: 'HTTPS', hint: 'TCP 443', patch: { protocol: 'tcp', ports: '443', description: 'HTTPS' } },
  { id: 'web', label: 'HTTP + HTTPS', hint: 'TCP 80, 443', patch: { protocol: 'tcp', ports: '80,443', description: 'Web' } },
  { id: 'icmp', label: 'Ping', hint: 'ICMP', patch: { protocol: 'icmp', ports: '*', description: 'Ping' } },
];

const ICONS: Record<string, typeof Terminal> = { ssh: Terminal, http: Globe, https: Lock, web: Globe, icmp: Activity };

/** Menu button "Add rule" with the common presets first, then "Custom". */
export function AddRuleMenu({ rules, onChange, onAdded, size = 'sm', variant = 'secondary' }: {
  rules: FirewallRule[]; onChange: (r: FirewallRule[]) => void; onAdded?: (id: string) => void; size?: 'xs' | 'sm' | 'md'; variant?: 'primary' | 'secondary';
}) {
  const add = (patch: Partial<FirewallRule>) => {
    const r = newRule('inbound', rules, { source: '0.0.0.0/0', ...patch });
    onChange([...rules, r]);
    onAdded?.(r.id);
  };
  const items: MenuItem[] = [
    ...QUICK_RULES.map((q) => ({ label: q.label, hint: q.hint, icon: ICONS[q.id], onClick: () => add(q.patch) })),
    { divider: true, label: '' },
    { label: 'Custom rule', icon: SlidersHorizontal, onClick: () => add({ protocol: 'tcp', ports: '', description: '' }) },
  ];
  return <Menu width="w-56" trigger={() => <Button size={size} variant={variant} icon={Plus}>Add rule</Button>} items={items} />;
}

export function SimpleRuleList({ rules, onChange, errors = {}, vpcCidr, highlightId, defaultInbound = 'deny', readOnly }: {
  rules: FirewallRule[];
  onChange: (rules: FirewallRule[]) => void;
  errors?: Record<string, string>;
  vpcCidr?: string;
  highlightId?: string | null;
  defaultInbound?: 'allow' | 'deny';
  readOnly?: boolean;
}) {
  const [custom, setCustom] = useState<Set<string>>(new Set());
  const [fresh, setFresh] = useState<string | null>(null);
  const inbound = rules.filter((r) => r.direction === 'inbound').sort((a, b) => a.priority - b.priority);
  const outbound = rules.filter((r) => r.direction === 'outbound').length;
  const update = (id: string, patch: Partial<FirewallRule>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => onChange(rules.filter((r) => r.id !== id));

  const modeOf = (r: FirewallRule) => {
    if (custom.has(r.id)) return 'custom';
    const s = normalizeSource(r.source);
    if (s === '0.0.0.0/0') return 'any';
    if (vpcCidr && s === vpcCidr) return 'vpc';
    return 'custom';
  };
  const setMode = (r: FirewallRule, m: string) => {
    const next = new Set(custom);
    if (m === 'custom') { next.add(r.id); update(r.id, { source: modeOf(r) === 'custom' ? r.source : '' }) }
    else { next.delete(r.id); update(r.id, { source: m === 'vpc' && vpcCidr ? vpcCidr : '0.0.0.0/0' }) }
    setCustom(next);
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-line">
        <div className="hidden grid-cols-[96px_110px_minmax(0,1.3fr)_minmax(0,1fr)_32px] gap-2 border-b border-line bg-surface-2/50 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted @min-[40rem]:grid">
          <span>Protocol</span><span>Port</span><span>Allow from</span><span>Description</span><span />
        </div>
        {inbound.length === 0 && (
          <div className="px-4 py-8 text-center text-[13px] text-muted">
            No inbound rules — {defaultInbound === 'deny' ? 'all incoming traffic is blocked.' : 'the default policy allows everything.'}
          </div>
        )}
        <ul className="divide-y divide-line">
          {inbound.map((r) => {
            const idx = rules.indexOf(r);
            const err = (f: string) => errors[`rules.${idx}.${f}`];
            const msg = err('ports') || err('source') || err('protocol') || err('priority') || err('action');
            const mode = modeOf(r);
            return (
              <li key={r.id} className={cn('px-3 py-2.5 transition-colors', highlightId === r.id && 'bg-brand-500/[0.06]', fresh === r.id && 'animate-pop', !r.enabled && 'opacity-60')}>
                <div className="grid grid-cols-2 items-start gap-2 @min-[40rem]:grid-cols-[96px_110px_minmax(0,1.3fr)_minmax(0,1fr)_32px]">
                  <Select aria-label="Protocol" value={r.protocol} disabled={readOnly} options={PROTOCOL_OPTIONS}
                    onChange={(e) => { const protocol = e.target.value as FirewallRule['protocol']; update(r.id, { protocol, ports: protocol === 'icmp' || protocol === 'any' ? '*' : r.ports === '*' ? '' : r.ports }) }} />
                  <Input aria-label="Port" mono placeholder="e.g. 443" value={r.protocol === 'icmp' || (r.protocol === 'any' && r.ports === '*') ? 'all' : r.ports} disabled={readOnly || r.protocol === 'icmp' || r.protocol === 'any'} invalid={!!err('ports')}
                    onChange={(e) => update(r.id, { ports: e.target.value })} />
                  <div className="col-span-2 flex min-w-0 gap-1.5 @min-[40rem]:col-span-1">
                    <Select aria-label="Allow from" className={mode === 'custom' ? 'w-28 shrink-0' : 'w-full'} value={mode} disabled={readOnly} onChange={(e) => setMode(r, e.target.value)}
                      options={[{ value: 'any', label: 'Anywhere' }, ...(vpcCidr ? [{ value: 'vpc', label: 'Private network' }] : []), { value: 'custom', label: 'Specific IPs' }]} />
                    {mode === 'custom' && <Input aria-label="Source IP or CIDR" mono className="min-w-0 flex-1" placeholder="203.0.113.0/24" value={r.source} disabled={readOnly} invalid={!!err('source')} onChange={(e) => update(r.id, { source: e.target.value })} />}
                  </div>
                  <Input aria-label="Description" className="col-span-2 @min-[40rem]:col-span-1" placeholder="Description" value={r.description} disabled={readOnly} onChange={(e) => update(r.id, { description: e.target.value })} />
                  {!readOnly && (
                    <button type="button" onClick={() => remove(r.id)} className="col-span-2 flex h-9 items-center justify-center rounded-md text-faint hover:bg-rose-500/10 hover:text-rose-500 @min-[40rem]:col-span-1" aria-label="Delete rule">
                      <Trash2 className="size-4" /><span className="ml-1.5 text-xs @min-[40rem]:hidden">Remove rule</span>
                    </button>
                  )}
                </div>
                {(r.action === 'deny' || !r.enabled) && (
                  <div className="mt-1.5 flex gap-2 text-[11px]">
                    {r.action === 'deny' && <span className="rounded bg-rose-500/10 px-1.5 font-semibold uppercase text-rose-600 dark:text-rose-400">deny</span>}
                    {!r.enabled && <span className="text-muted">disabled</span>}
                  </div>
                )}
                {msg && <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{msg}</p>}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!readOnly && <AddRuleMenu rules={rules} onChange={onChange} onAdded={(id) => { setFresh(id); setTimeout(() => setFresh(null), 800) }} />}
        <p className="text-xs text-muted">
          {defaultInbound === 'deny' ? 'Everything else is blocked.' : 'Everything else is allowed.'}
          {outbound > 0 && ` · ${outbound} outbound rule${outbound > 1 ? 's' : ''} (Pro mode)`}
        </p>
      </div>
    </div>
  );
}
