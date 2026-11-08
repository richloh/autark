import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/form';
import { isValidCidr, isValidIp, parseCidr, intToIp } from '@/lib/cidr';
import { num } from '@/lib/format';

export function cidrProblem(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const c = s.includes('/') ? s : isValidIp(s) ? `${s}/32` : s;
  if (isValidCidr(c)) return c === '0.0.0.0/0' ? '0.0.0.0/0 allows everything — leave the list empty instead' : null;
  const p = parseCidr(c);
  return p ? `Host bits set — did you mean ${intToIp(p.network)}/${p.prefix}?` : 'Not a valid IPv4 address or CIDR';
}

const size = (c: string) => parseCidr(c.includes('/') ? c : `${c}/32`)?.size ?? 0;

/** Editable list of CIDRs with inline validation and address counts. */
export function CidrListEditor({ value, onChange, error, placeholder = '203.0.113.0/24' }: { value: string[]; onChange: (v: string[]) => void; error?: string; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const problem = cidrProblem(draft);
  const add = () => {
    const s = draft.trim();
    if (!s || problem) return;
    const c = s.includes('/') ? s : `${s}/32`;
    if (!value.includes(c)) onChange([...value, c]);
    setDraft('');
  };
  const total = value.reduce((a, c) => a + size(c), 0);
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {value.map((c) => (
            <li key={c} className="flex items-center gap-3 px-3 py-2">
              <code className="flex-1 font-mono text-[13px] text-fg">{c}</code>
              <span className="text-xs text-muted tabular">{size(c) === 1 ? 'single host' : `${num(size(c))} addresses`}</span>
              <button type="button" onClick={() => onChange(value.filter((x) => x !== c))} className="rounded-md p-1 text-faint hover:bg-rose-500/10 hover:text-rose-500" aria-label={`Remove ${c}`}><X className="size-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input mono value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} invalid={!!problem}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} className="flex-1" />
        <button type="button" onClick={add} disabled={!draft.trim() || !!problem} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-50"><Plus className="size-4" />Add</button>
      </div>
      {problem ? <p className="text-xs text-rose-600 dark:text-rose-400">{problem}</p>
        : error ? <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
        : <p className="text-xs text-muted">{value.length ? `Requests are accepted from ${num(total)} address${total === 1 ? '' : 'es'} only.` : 'Empty list = requests accepted from any address.'}</p>}
    </div>
  );
}
