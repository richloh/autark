import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { CopyButton } from './misc';
import { Segmented } from './Tabs';
import { usePro } from '@/store/ui';

/** Monospace code with copy button. Minimal syntax tinting for comments/strings/keys. */
export function CodeBlock({ code, language, className, maxHeight = 'max-h-96', title, wrap }: { code: string; language?: string; className?: string; maxHeight?: string; title?: ReactNode; wrap?: boolean }) {
  return (
    <div className={cn('group relative overflow-hidden rounded-xl border border-line bg-[#0d0f18] text-[12.5px] text-slate-200', className)}>
      {(title || language) && (
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-[11px] text-slate-400">
          <span>{title ?? language}</span>
        </div>
      )}
      <CopyButton value={code} className="absolute right-2 top-1.5 text-slate-400 hover:bg-white/10 hover:text-white" />
      <pre className={cn('overflow-auto p-3.5 font-mono leading-relaxed', maxHeight, wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre')}>
        <code dangerouslySetInnerHTML={{ __html: tint(code, language) }} />
      </pre>
    </div>
  );
}

function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

function tint(code: string, lang?: string) {
  return code.split('\n').map((line) => {
    let l = esc(line);
    if (/^\s*(#|\/\/)/.test(line)) return `<span style="color:#6b7394">${l}</span>`;
    l = l.replace(/(&quot;|")([^"]*?)(")/g, '<span style="color:#a5d6a7">"$2"</span>');
    if (lang === 'hcl' || lang === 'terraform') l = l.replace(/^(\s*)([a-z_]+)(\s*=)/, '$1<span style="color:#9fb4ff">$2</span>$3').replace(/^(resource|provider|terraform|variable|output|data)\b/, '<span style="color:#f0a6ff">$1</span>');
    if (lang === 'bash' || lang === 'shell') l = l.replace(/^(\s*)(autark|curl|kubectl|ssh|terraform|psql|aws|mysql|redis-cli)\b/, '$1<span style="color:#9fb4ff">$2</span>').replace(/(\s)(--?[a-z][a-z-]*)/g, '$1<span style="color:#ffcf8b">$2</span>');
    if (lang === 'yaml') l = l.replace(/^(\s*-?\s*)([a-zA-Z_][\w.-]*)(:)/, '$1<span style="color:#9fb4ff">$2</span>$3');
    if (lang === 'json') l = l.replace(/<span style="color:#a5d6a7">"([^"]*)"<\/span>(\s*:)/g, '<span style="color:#9fb4ff">"$1"</span>$2');
    return l;
  }).join('\n');
}

export interface IacSnippets { cli?: string; terraform?: string; curl?: string; pulumi?: string; yaml?: string }

/** Switch between equivalent CLI / Terraform / API representations of an action. */
export function IacTabs({ snippets, className, title = 'Equivalent code', always }: { snippets: IacSnippets; className?: string; title?: string; always?: boolean }) {
  const pro = usePro();
  const opts = (Object.keys(snippets) as (keyof IacSnippets)[]).filter((k) => snippets[k]);
  const [tab, setTab] = useState<keyof IacSnippets>(opts[0] ?? 'cli');
  const labels: Record<string, string> = { cli: 'CLI', terraform: 'Terraform', curl: 'REST API', pulumi: 'Pulumi', yaml: 'YAML' };
  const lang: Record<string, string> = { cli: 'bash', terraform: 'hcl', curl: 'bash', pulumi: 'ts', yaml: 'yaml' };
  if (!pro && !always) return null; // IaC snippets are a Pro-mode feature
  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">{title}</span>
        <Segmented size="sm" options={opts.map((o) => ({ value: o, label: labels[o] }))} value={tab} onChange={setTab} />
      </div>
      <CodeBlock code={snippets[tab] ?? ''} language={lang[tab]} maxHeight="max-h-80" />
    </div>
  );
}

/** Helpers to build IaC snippets from a request body. */
export function toHcl(resource: string, name: string, body: Record<string, unknown>): string {
  const lines = [`resource "autark_${resource}" "${name.replace(/[^a-z0-9_]/gi, '_')}" {`];
  const fmt = (v: unknown, indent: string): string => {
    if (Array.isArray(v)) {
      if (v.every((x) => typeof x !== 'object')) return `[${v.map((x) => JSON.stringify(x)).join(', ')}]`;
      return `[\n${v.map((x) => `${indent}  ${fmt(x, indent + '  ')}`).join(',\n')}\n${indent}]`;
    }
    if (v && typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined && x !== null && x !== '');
      return `{\n${entries.map(([k, x]) => `${indent}  ${k} = ${fmt(x, indent + '  ')}`).join('\n')}\n${indent}}`;
    }
    return JSON.stringify(v);
  };
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    if (k === 'tags' && Array.isArray(v)) {
      lines.push(`  tags = {`);
      for (const t of v as { key: string; value: string }[]) lines.push(`    ${JSON.stringify(t.key)} = ${JSON.stringify(t.value)}`);
      lines.push('  }');
      continue;
    }
    lines.push(`  ${snake(k)} = ${fmt(v, '  ')}`);
  }
  lines.push('}');
  return lines.join('\n');
}

export function toCli(cmd: string, body: Record<string, unknown>): string {
  const parts = [`autark ${cmd}`];
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0)) continue;
    const flag = `--${kebab(k)}`;
    if (v === true) parts.push(flag);
    else if (k === 'tags' && Array.isArray(v)) (v as { key: string; value: string }[]).forEach((t) => parts.push(`--tag ${t.key}=${t.value}`));
    else if (Array.isArray(v)) parts.push(`${flag} ${v.map((x) => (typeof x === 'object' ? `'${JSON.stringify(x)}'` : x)).join(',')}`);
    else if (typeof v === 'object') parts.push(`${flag} '${JSON.stringify(v)}'`);
    else parts.push(`${flag} ${String(v).includes(' ') || String(v).includes('\n') ? JSON.stringify(v) : v}`);
  }
  return parts.join(' \\\n  ');
}

export function toCurl(method: string, path: string, body?: unknown): string {
  return [
    `curl -X ${method} https://autark.example.com/api/v1${path} \\`,
    `  -H "Authorization: Bearer $AUTARK_TOKEN" \\`,
    `  -H "Content-Type: application/json"${body ? ' \\' : ''}`,
    ...(body ? [`  -d '${JSON.stringify(body, null, 2).split('\n').join('\n  ')}'`] : []),
  ].join('\n');
}

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
