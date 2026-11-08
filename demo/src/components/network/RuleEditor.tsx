import { useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, ChevronUp, ChevronDown, Plus, Trash2, Wand2, AlertTriangle, ShieldAlert, ShieldCheck, Info, Globe2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/form';
import { Popover } from '@/components/ui/Menu';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import type { FirewallRule } from '@/types';
import { PROTOCOL_OPTIONS, rulePresets, normalizeSource, type Exposure } from './util';

let tmp = 0;
const tmpId = () => `r-new-${Date.now().toString(36)}-${++tmp}`;

export function newRule(direction: FirewallRule['direction'], existing: FirewallRule[], patch: Partial<FirewallRule> = {}): FirewallRule {
  const lane = existing.filter((r) => r.direction === direction);
  const max = lane.reduce((a, r) => Math.max(a, r.priority), 0);
  return { id: tmpId(), direction, protocol: 'tcp', ports: '', source: '0.0.0.0/0', action: 'allow', priority: max ? Math.min(9999, Math.ceil((max + 1) / 10) * 10) : 100, description: '', enabled: true, ...patch };
}

/** Two-lane (inbound / outbound) firewall rule editor with priority ordering, presets and inline validation. */
export function RuleEditor({ rules, onChange, errors = {}, vpcCidr, highlightId, readOnly, lanes = ['inbound', 'outbound'] }: {
  rules: FirewallRule[];
  onChange: (rules: FirewallRule[]) => void;
  errors?: Record<string, string>;
  vpcCidr?: string;
  highlightId?: string | null;
  readOnly?: boolean;
  lanes?: FirewallRule['direction'][];
}) {
  const [flash, setFlash] = useState<string[]>([]);
  const update = (id: string, patch: Partial<FirewallRule>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => onChange(rules.filter((r) => r.id !== id));
  const add = (direction: FirewallRule['direction'], patch?: Partial<FirewallRule>) => {
    const r = newRule(direction, rules, patch);
    onChange([...rules, r]);
    setFlash([r.id]);
  };
  const applyPreset = (presetRules: Omit<FirewallRule, 'id' | 'priority' | 'enabled'>[]) => {
    let next = [...rules];
    const ids: string[] = [];
    for (const p of presetRules) { const r = newRule(p.direction, next, { ...p }); next = [...next, r]; ids.push(r.id) }
    onChange(next);
    setFlash(ids);
  };
  const move = (r: FirewallRule, dir: -1 | 1) => {
    const lane = rules.filter((x) => x.direction === r.direction).sort((a, b) => a.priority - b.priority);
    const i = lane.findIndex((x) => x.id === r.id);
    const other = lane[i + dir];
    if (!other) return;
    if (other.priority === r.priority) { update(r.id, { priority: r.priority + dir }); return }
    onChange(rules.map((x) => (x.id === r.id ? { ...x, priority: other.priority } : x.id === other.id ? { ...x, priority: r.priority } : x)));
  };
  const presets = useMemo(() => rulePresets(vpcCidr), [vpcCidr]);

  return (
    <div className={cn('grid gap-4', lanes.length > 1 && '@min-[76rem]:grid-cols-2')}>
      {lanes.map((direction) => {
        const lane = rules.filter((r) => r.direction === direction).sort((a, b) => a.priority - b.priority);
        const Icon = direction === 'inbound' ? ArrowDownToLine : ArrowUpFromLine;
        return (
          <div key={direction} className="min-w-0 rounded-xl border border-line bg-surface-2/40">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-fg">
                <Icon className={cn('size-4', direction === 'inbound' ? 'text-sky-500' : 'text-violet-500')} />
                {direction === 'inbound' ? 'Inbound' : 'Outbound'} rules
                <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-medium tabular text-muted">{lane.length}</span>
              </div>
              {!readOnly && (
                <div className="flex items-center gap-1.5">
                  <Popover align="end" className="w-72 p-1.5" trigger={() => <Button size="xs" variant="ghost" icon={Wand2}>Presets</Button>}>
                    {(close) => (
                      <div className="max-h-80 overflow-y-auto">
                        {presets.filter((p) => p.rules.some((r) => r.direction === direction)).map((p) => (
                          <button key={p.id} type="button" onClick={() => { applyPreset(p.rules); close() }} className="flex w-full flex-col items-start rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2">
                            <span className="text-[13px] font-medium text-fg">{p.label}</span>
                            <span className="text-[11px] text-muted">{p.description}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </Popover>
                  <Button size="xs" variant="secondary" icon={Plus} onClick={() => add(direction)}>Add rule</Button>
                </div>
              )}
            </div>
            <div className="space-y-2 p-2.5">
              {lane.length === 0 && (
                <div className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-xs text-muted">
                  No {direction} rules — the default {direction} policy applies to all traffic.
                </div>
              )}
              {lane.map((r, li) => {
                const idx = rules.indexOf(r);
                const err = (f: string) => errors[`rules.${idx}.${f}`];
                const world = normalizeSource(r.source) === '0.0.0.0/0';
                const hl = highlightId === r.id;
                return (
                  <div key={r.id} className={cn(
                    'rounded-lg border bg-surface p-2 transition-all',
                    hl ? 'border-brand-500 ring-3 ring-brand-500/20' : 'border-line',
                    !r.enabled && 'opacity-60',
                    flash.includes(r.id) && 'animate-pop',
                  )}>
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="flex shrink-0 items-center gap-0.5">
                        {!readOnly && (
                          <div className="flex flex-col">
                            <button type="button" aria-label="Move up" disabled={li === 0} onClick={() => move(r, -1)} className="rounded p-0.5 text-faint hover:bg-surface-2 hover:text-fg disabled:opacity-30"><ChevronUp className="size-3.5" /></button>
                            <button type="button" aria-label="Move down" disabled={li === lane.length - 1} onClick={() => move(r, 1)} className="rounded p-0.5 text-faint hover:bg-surface-2 hover:text-fg disabled:opacity-30"><ChevronDown className="size-3.5" /></button>
                          </div>
                        )}
                        <div className="w-16" title="Priority — lower is evaluated first">
                          <Input aria-label="Priority" value={String(r.priority)} disabled={readOnly} invalid={!!err('priority')} className="h-8 px-2 text-center font-mono text-[12px]"
                            onChange={(e) => update(r.id, { priority: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
                        </div>
                      </div>
                      <button type="button" disabled={readOnly} onClick={() => update(r.id, { action: r.action === 'allow' ? 'deny' : 'allow' })}
                        className={cn('h-8 shrink-0 rounded-lg px-2.5 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset transition-colors',
                          r.action === 'allow' ? 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-400')}
                        title="Toggle allow / deny">
                        {r.action}
                      </button>
                      <Select aria-label="Protocol" className="w-[84px] shrink-0" value={r.protocol} disabled={readOnly} options={PROTOCOL_OPTIONS}
                        onChange={(e) => { const protocol = e.target.value as FirewallRule['protocol']; update(r.id, { protocol, ports: protocol === 'icmp' || protocol === 'any' ? '*' : r.ports === '*' ? '' : r.ports }) }} />
                      <div className="w-28 min-w-[96px] flex-1">
                        <Input aria-label="Ports" mono placeholder="22 or 80,443" value={r.ports} disabled={readOnly || r.protocol === 'icmp'} invalid={!!err('ports')} className="h-8"
                          onChange={(e) => update(r.id, { ports: e.target.value })} />
                      </div>
                      <div className="w-40 min-w-[140px] flex-[2]">
                        <Input aria-label={direction === 'inbound' ? 'Source' : 'Destination'} mono placeholder={direction === 'inbound' ? 'source CIDR' : 'destination CIDR'} value={r.source} disabled={readOnly} invalid={!!err('source')} className={cn('h-8', world && 'text-amber-600 dark:text-amber-400')}
                          onChange={(e) => update(r.id, { source: e.target.value })} />
                      </div>
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted" title={r.enabled ? 'Enabled' : 'Disabled'}>
                          <input type="checkbox" className="accent-brand-500" checked={r.enabled} disabled={readOnly} onChange={(e) => update(r.id, { enabled: e.target.checked })} />
                          on
                        </label>
                        {!readOnly && <button type="button" onClick={() => remove(r.id)} className="rounded-md p-1.5 text-faint hover:bg-rose-500/10 hover:text-rose-500" aria-label="Delete rule"><Trash2 className="size-3.5" /></button>}
                      </div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-0 @min-[36rem]:pl-[86px]">
                      <input aria-label="Description" value={r.description} disabled={readOnly} placeholder="Description (e.g. SSH from office)"
                        onChange={(e) => update(r.id, { description: e.target.value })}
                        className="min-w-0 flex-1 bg-transparent text-xs text-fg-2 outline-none placeholder:text-faint" />
                      {world && r.action === 'allow' && direction === 'inbound' && r.enabled && <Badge tone="warning"><Globe2 className="size-3" /> internet</Badge>}
                      {hl && <Badge tone="brand">matched</Badge>}
                    </div>
                    {(err('priority') || err('ports') || err('source') || err('protocol') || err('action')) && (
                      <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{err('priority') || err('ports') || err('source') || err('protocol') || err('action')}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Exposure summary: which ports are open to 0.0.0.0/0, with severity. */
export function ExposureSummary({ items, onFocus, className }: { items: Exposure[]; onFocus?: (ruleId: string) => void; className?: string }) {
  if (!items.length) {
    return (
      <div className={cn('flex items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-[13px] text-emerald-800 dark:text-emerald-300', className)}>
        <ShieldCheck className="size-4 shrink-0" /> Nothing is exposed to the internet. All inbound access is limited to specific sources.
      </div>
    );
  }
  const crit = items.filter((i) => i.level === 'critical').length;
  return (
    <div className={cn('space-y-1.5', className)}>
      {items.map((x, i) => {
        const Icon = x.level === 'critical' ? ShieldAlert : x.level === 'warning' ? AlertTriangle : Info;
        return (
          <button key={i} type="button" onClick={() => x.ruleId && onFocus?.(x.ruleId)}
            className={cn('flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left text-[13px] transition-colors',
              x.level === 'critical' ? 'border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10' : x.level === 'warning' ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10' : 'border-line bg-surface-2/50 hover:bg-surface-2')}>
            <Icon className={cn('mt-0.5 size-4 shrink-0', x.level === 'critical' ? 'text-rose-500' : x.level === 'warning' ? 'text-amber-500' : 'text-sky-500')} />
            <span className="min-w-0">
              <span className="block font-medium text-fg">{x.title}</span>
              <span className="block text-xs text-muted">{x.detail}</span>
            </span>
          </button>
        );
      })}
      {crit > 0 && <p className="px-1 text-[11px] text-muted">{crit} critical finding{crit > 1 ? 's' : ''} — click one to jump to the rule.</p>}
    </div>
  );
}
