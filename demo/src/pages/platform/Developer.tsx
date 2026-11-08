import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Code2, Send, KeyRound, Globe, Layers, Timer, AlertCircle, Search, ChevronDown, Play, Download, Bot, Terminal, Boxes, ShieldCheck, History, Trash2, ArrowRight, Eye, PencilLine, Flame,
} from 'lucide-react';
import { request, ApiClientError } from '@/api/client';
import { useList } from '@/api/hooks';
import { describeApi, getRequestLog } from '@/mock/server';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Tabs, useTabParam, Segmented } from '@/components/ui/Tabs';
import { Input, Select, Textarea, Hint } from '@/components/ui/form';
import { CodeBlock, toCurl } from '@/components/ui/CodeBlock';
import { CopyButton, Kbd, EmptyState } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { downloadFile } from '@/components/overview/shared';
import { KINDS } from '@/lib/kinds';
import { cn } from '@/lib/cn';
import { useUi } from '@/store/ui';

/** Collections that share a resource kind need their own labels. */
const COLLECTION_LABEL: Record<string, [string, string]> = {
  accounts: ['Accounts', 'account'], auditLog: ['Audit log', 'audit event'], notifications: ['Notifications', 'notification'],
  bucketObjects: ['Bucket objects', 'object'], dbPresets: ['Database presets', 'database preset'], vmPresets: ['VM presets', 'VM preset'],
  volumePresets: ['Volume presets', 'volume preset'], locations: ['Locations', 'location'], ipPools: ['IP pools', 'IP pool'],
};
const labelOf = (c: { name: string; kind: string }) => COLLECTION_LABEL[c.name]?.[0] ?? KINDS[c.kind as ResourceKind]?.plural ?? c.name;
const thingOf = (c: { name: string; kind: string }) => COLLECTION_LABEL[c.name]?.[1] ?? KINDS[c.kind as ResourceKind]?.label?.toLowerCase() ?? c.kind;
import type { SystemAccount, ResourceKind } from '@/types';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
interface Endpoint { method: Method; path: string; summary: string; collection?: string }
interface Group { id: string; label: string; kind?: ResourceKind; endpoints: Endpoint[] }

const METHOD_TONE: Record<string, string> = {
  GET: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', POST: 'bg-brand-500/10 text-brand-600 dark:text-brand-300',
  PATCH: 'bg-amber-500/10 text-amber-700 dark:text-amber-400', DELETE: 'bg-rose-500/10 text-rose-700 dark:text-rose-400', PUT: 'bg-amber-500/10 text-amber-700',
};

function MethodBadge({ m, className }: { m: string; className?: string }) {
  return <span className={cn('inline-flex w-14 shrink-0 justify-center rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold', METHOD_TONE[m] ?? 'bg-surface-3', className)}>{m}</span>;
}

/** Turns describeApi() into endpoint groups: one per collection (+ its custom routes) and one per remaining custom prefix. */
function useApiGroups(): Group[] {
  return useMemo(() => {
    const api = describeApi();
    const groups: Group[] = [];
    const used = new Set<string>();
    const strip = (p: string) => p.replace(/^\/api\/v1/, '');
    for (const c of [...api.generic].sort((a, b) => a.name.localeCompare(b.name))) {
      const label = labelOf(c);
      const thing = thingOf(c);
      const eps: Endpoint[] = [
        { method: 'GET', path: `/${c.name}`, summary: `List ${c.name} (?q=, ?field=value, ?limit=)`, collection: c.name },
        { method: 'GET', path: `/${c.name}/{id}`, summary: `Get one ${thing}`, collection: c.name },
      ];
      if (c.creatable && !c.readonly) eps.push({ method: 'POST', path: `/${c.name}`, summary: `Create a ${thing}`, collection: c.name });
      if (!c.readonly) {
        eps.push({ method: 'PATCH', path: `/${c.name}/{id}`, summary: `Update a ${thing}`, collection: c.name });
        if (c.creatable) eps.push({ method: 'DELETE', path: `/${c.name}/{id}`, summary: `Delete a ${thing}`, collection: c.name });
      }
      for (const a of c.actions) eps.push({ method: 'POST', path: `/${c.name}/{id}/actions/${a}`, summary: `Action: ${a}`, collection: c.name });
      api.custom.forEach((r, i) => {
        const p = strip(r.path);
        if (p === `/${c.name}` || p.startsWith(`/${c.name}/`)) { used.add(String(i)); eps.push({ method: r.method as Method, path: p.replace(/:([a-zA-Z]+)/g, '{$1}'), summary: r.summary ?? '', collection: c.name }) }
      });
      groups.push({ id: c.name, label, kind: c.kind as ResourceKind, endpoints: eps });
    }
    const rest = new Map<string, Endpoint[]>();
    api.custom.forEach((r, i) => {
      if (used.has(String(i))) return;
      const p = strip(r.path);
      const seg = p.split('/')[1] ?? '';
      const list = rest.get(seg) ?? [];
      list.push({ method: r.method as Method, path: p.replace(/:([a-zA-Z]+)/g, '{$1}'), summary: r.summary ?? '' });
      rest.set(seg, list);
    });
    for (const [seg, eps] of [...rest].sort((a, b) => a[0].localeCompare(b[0]))) groups.push({ id: `custom-${seg}`, label: `/${seg}`, endpoints: eps });
    return groups;
  }, []);
}

interface Req { method: Method; path: string; body: string }
interface Res { status: number; ms: number; body: unknown; ok: boolean; at: number; req: Req }

const PRESETS: { label: string; req: Req }[] = [
  { label: 'List running VMs', req: { method: 'GET', path: '/vms?status=running', body: '' } },
  { label: 'Cost summary', req: { method: 'GET', path: '/costs/summary', body: '' } },
  { label: 'Search “web”', req: { method: 'GET', path: '/search?q=web', body: '' } },
  { label: 'Who am I', req: { method: 'GET', path: '/me', body: '' } },
  { label: 'Running operations', req: { method: 'GET', path: '/operations?status=running', body: '' } },
  { label: 'Validation error', req: { method: 'POST', path: '/networks', body: '{\n  "name": "Invalid Name!",\n  "cidr": "10.0.0.0/33"\n}' } },
];

export default function Developer() {
  const [tab, setTab] = useTabParam('api');
  const groups = useApiGroups();
  const [req, setReq] = useState<Req>(PRESETS[0].req);
  const endpointCount = groups.reduce((a, g) => a + g.endpoints.length, 0);

  const openApi = () => {
    const paths: Record<string, Record<string, unknown>> = {};
    for (const g of groups) for (const e of g.endpoints) {
      const p = e.path.split('?')[0];
      paths[p] ??= {};
      paths[p][e.method.toLowerCase()] = {
        summary: e.summary, tags: [g.label],
        parameters: [...p.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } })),
        ...(e.method === 'POST' || e.method === 'PATCH' ? { requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } } : {}),
        responses: { 200: { description: 'OK' }, 202: { description: 'Accepted (async operation started)' }, 404: { description: 'Not found' }, 422: { description: 'Validation failed' } },
      };
    }
    const spec = {
      openapi: '3.1.0', info: { title: 'Autark API', version: 'v1', description: 'Sovereign cloud control plane API' },
      servers: [{ url: 'https://autark.example.com/api/v1' }],
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }, security: [{ bearer: [] }], paths,
    };
    downloadFile('autark-openapi.json', JSON.stringify(spec, null, 2), 'application/json');
    toast.success('OpenAPI spec downloaded');
  };

  return (
    <Page wide>
      <PageHeader title="API & IaC" icon={Code2} iconColor="#5b67f8"
        description="Everything in this console is a call to the same REST API — automate it with curl, Terraform, the CLI or AI agents via MCP."
        actions={<>
          <Button icon={Download} onClick={openApi}>OpenAPI spec</Button>
          <Button variant="primary" icon={KeyRound} to="/iam/system-accounts">API tokens</Button>
        </>} />

      <div className="mb-5 grid grid-cols-1 gap-3 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
        <Fact icon={Globe} title="Base URL" body={<span className="flex items-center gap-1"><code className="font-mono text-[12.5px] text-fg">https://autark.example.com/api/v1</code><CopyButton value="https://autark.example.com/api/v1" /></span>} />
        <Fact icon={KeyRound} title="Authentication" body={<>Bearer token of a <Link to="/iam/system-accounts" className="text-brand-500 hover:underline">system account</Link>, scoped by roles, projects, IP allowlist and tag conditions.</>} />
        <Fact icon={Layers} title="Scope" body={<>Headers <code className="font-mono text-[12px]">x-autark-account</code> and optional <code className="font-mono text-[12px]">x-autark-project</code> select the tenant.</>} />
        <Fact icon={Timer} title="Async by design" body={<>Long-running writes return immediately and start an <Link to="/activity" className="text-brand-500 hover:underline">operation</Link> you can poll or cancel.</>} />
      </div>

      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { id: 'api', label: 'REST API', count: endpointCount, icon: <Code2 className="size-4" /> },
        { id: 'terraform', label: 'Terraform', icon: <Boxes className="size-4" /> },
        { id: 'cli', label: 'CLI', icon: <Terminal className="size-4" /> },
        { id: 'mcp', label: 'MCP for AI agents', icon: <Bot className="size-4" /> },
      ]} />

      {tab === 'api' && (
        <div className="grid gap-4 @min-[60rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <EndpointList groups={groups} onTry={(r) => { setReq(r); document.getElementById('try-it')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} />
          <div id="try-it" className="min-w-0 scroll-mt-4 @min-[60rem]:sticky @min-[60rem]:top-4 @min-[60rem]:self-start"><Runner req={req} setReq={setReq} /></div>
        </div>
      )}
      {tab === 'terraform' && <TerraformTab />}
      {tab === 'cli' && <CliTab />}
      {tab === 'mcp' && <McpTab />}
    </Page>
  );
}

function Fact({ icon: Icon, title, body }: { icon: typeof Globe; title: string; body: React.ReactNode }) {
  return (
    <Card className="p-3.5">
      <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-fg"><Icon className="size-4 text-brand-500" />{title}</div>
      <div className="text-[13px] leading-snug text-muted">{body}</div>
    </Card>
  );
}

/* ================================================================ endpoint reference */

function EndpointList({ groups, onTry }: { groups: Group[]; onTry: (r: Req) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set(['vms', 'custom-costs']));
  const filtered = useMemo(() => {
    const t = q.toLowerCase().trim();
    if (!t) return groups;
    return groups.map((g) => ({ ...g, endpoints: g.endpoints.filter((e) => `${e.method} ${e.path} ${e.summary} ${g.label}`.toLowerCase().includes(t)) })).filter((g) => g.endpoints.length);
  }, [groups, q]);

  const tryIt = async (e: Endpoint) => {
    let path = e.path;
    if (path.includes('{id}') && e.collection) {
      try {
        const res = await request<{ items: { id: string }[] }>('GET', `/${e.collection}?limit=1`);
        if (res.items[0]) path = path.replace('{id}', res.items[0].id);
      } catch { /* keep placeholder */ }
    }
    if (path.includes('{collection}')) path = path.replace('{collection}', 'vms');
    const body = e.method === 'POST' && !path.includes('/actions/') ? '{\n  "name": "my-resource"\n}' : e.method === 'PATCH' ? '{\n  "tags": [{ "key": "env", "value": "dev" }]\n}' : e.method === 'POST' ? '{}' : '';
    onTry({ method: e.method, path, body });
  };

  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line p-2.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter endpoints, e.g. “snapshot” or “POST vms”"
            className="h-8 w-full rounded-lg border border-line bg-surface-2/60 pl-8 pr-2 text-[13px] outline-none placeholder:text-faint focus:border-brand-500 focus:bg-surface" />
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen(open.size ? new Set() : new Set(groups.map((g) => g.id)))}>{open.size ? 'Collapse' : 'Expand'} all</Button>
      </div>
      <div className="divide-y divide-line">
        {filtered.map((g) => {
          const isOpen = !!q || open.has(g.id);
          const Icon = g.kind ? KINDS[g.kind]?.icon : Code2;
          return (
            <div key={g.id}>
              <button type="button" onClick={() => { const n = new Set(open); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); setOpen(n) }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-2/50">
                {Icon && <Icon className="size-4 shrink-0" style={{ color: g.kind ? KINDS[g.kind]?.color : undefined }} />}
                <span className="text-[13px] font-medium text-fg">{g.label}</span>
                <code className="font-mono text-[11px] text-faint">{g.id.startsWith('custom-') ? '' : `/${g.id}`}</code>
                <span className="ml-auto rounded-full bg-surface-3 px-1.5 text-[11px] tabular text-muted">{g.endpoints.length}</span>
                <ChevronDown className={cn('size-4 text-faint transition-transform', isOpen && 'rotate-180')} />
              </button>
              {isOpen && (
                <ul className="pb-2">
                  {g.endpoints.map((e) => (
                    <li key={`${e.method} ${e.path}`} className="group flex items-center gap-2 px-3 py-1 hover:bg-surface-2/40">
                      <MethodBadge m={e.method} />
                      <div className="min-w-0 flex-1">
                        <code className="block truncate font-mono text-[12px] text-fg">{e.path}</code>
                        {e.summary && <span className="block truncate text-[11px] text-muted">{e.summary}</span>}
                      </div>
                      <Button size="xs" variant="ghost" icon={Play} className="opacity-60 group-hover:opacity-100" onClick={() => tryIt(e)}>Try</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {!filtered.length && <EmptyState icon={Search} title="No endpoints match" />}
      </div>
    </Card>
  );
}

/* ================================================================ request runner */

function Runner({ req, setReq }: { req: Req; setReq: (r: Req) => void }) {
  const [res, setRes] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Res[]>([]);
  const [view, setView] = useState<'response' | 'curl'>('response');
  const projectId = useUi((s) => s.projectId);
  const hasBody = req.method === 'POST' || req.method === 'PATCH';
  let bodyError: string | null = null;
  let parsed: unknown = undefined;
  if (hasBody && req.body.trim()) { try { parsed = JSON.parse(req.body) } catch (e) { bodyError = (e as Error).message } }

  const send = async () => {
    if (bodyError) return;
    const raw = req.path.trim().replace(/^\/?api\/v1/, '');
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    setBusy(true);
    const t0 = performance.now();
    let out: Res;
    try {
      const body = await request(req.method, path, hasBody ? parsed ?? {} : undefined);
      const log = getRequestLog().find((l) => l.method === req.method && l.path.endsWith(path));
      out = { status: log?.status ?? (req.method === 'POST' ? 201 : 200), ms: log?.durationMs ?? Math.round(performance.now() - t0), body, ok: true, at: Date.now(), req: { ...req, path } };
    } catch (e) {
      const err = e as ApiClientError;
      out = { status: err.status ?? 0, ms: Math.round(performance.now() - t0), body: { error: { code: err.code, message: err.message, details: err.details } }, ok: false, at: Date.now(), req: { ...req, path } };
    }
    setRes(out);
    setView('response');
    setHistory((h) => [out, ...h].slice(0, 8));
    setBusy(false);
  };

  return (
    <Card className="min-w-0">
      <CardHeader icon={Send} title="Try it" description="Requests run against this demo's live control plane in your current scope — writes are real and audited (via: console)." />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => <button key={p.label} onClick={() => setReq(p.req)} className="rounded-md border border-line px-2 py-0.5 text-[11px] text-muted hover:border-line-strong hover:text-fg">{p.label}</button>)}
        </div>
        <form className="flex flex-col gap-2 @min-[36rem]:flex-row" onSubmit={(e) => { e.preventDefault(); send() }}>
          <Select className="@min-[36rem]:w-28" value={req.method} onChange={(e) => setReq({ ...req, method: e.target.value as Method })} options={['GET', 'POST', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }))} />
          <Input className="flex-1" mono prefix="/api/v1" value={req.path} onChange={(e) => setReq({ ...req, path: e.target.value })} placeholder="/vms" />
          <Button type="submit" variant="primary" icon={Send} loading={busy} disabled={!!bodyError}>Send</Button>
        </form>
        {hasBody && (
          <div>
            <Textarea mono rows={6} value={req.body} onChange={(e) => setReq({ ...req, body: e.target.value })} invalid={!!bodyError}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }} placeholder='{ "name": "…" }' />
            <div className="mt-1 flex justify-between text-[11px]">
              <span className={bodyError ? 'text-rose-500' : 'text-faint'}>{bodyError ? `Invalid JSON: ${bodyError}` : 'JSON request body'}</span>
              <span className="text-faint"><Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> to send</span>
            </div>
          </div>
        )}
        <div className="text-[11px] text-faint">Scope headers: <code className="font-mono">x-autark-account</code>{projectId && <> + <code className="font-mono">x-autark-project: {projectId}</code></>} are added automatically.</div>

        {res ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={res.ok ? 'success' : res.status >= 500 ? 'danger' : 'warning'} dot>{res.status} {res.ok ? 'OK' : 'Error'}</Badge>
              <span className="text-xs tabular text-muted">{res.ms} ms</span>
              <code className="truncate font-mono text-[11px] text-faint">{res.req.method} /api/v1{res.req.path}</code>
              <Segmented className="ml-auto" size="sm" value={view} onChange={setView} options={[{ value: 'response', label: 'Response' }, { value: 'curl', label: 'curl' }]} />
            </div>
            {view === 'response'
              ? <CodeBlock language="json" maxHeight="max-h-[420px]" code={JSON.stringify(res.body, null, 2) ?? 'null'} />
              : <CodeBlock language="bash" code={toCurl(res.req.method, res.req.path, res.req.method === 'POST' || res.req.method === 'PATCH' ? (() => { try { return JSON.parse(res.req.body || '{}') } catch { return undefined } })() : undefined)} />}
            {!res.ok && (res.body as any)?.error?.details && (
              <Hint tone="warning">Field errors are returned in <code className="font-mono">error.details</code> so forms (and agents) can map them to inputs.</Hint>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-6 text-[13px] text-muted"><AlertCircle className="size-4 text-faint" />Send a request to see the response.</div>
        )}

        {history.length > 1 && (
          <div>
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted">
              <span className="flex items-center gap-1.5"><History className="size-3.5" />History</span>
              <button onClick={() => setHistory([])} className="flex items-center gap-1 text-faint hover:text-fg"><Trash2 className="size-3" />Clear</button>
            </div>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {history.map((h) => (
                <li key={h.at}>
                  <button onClick={() => { setReq(h.req); setRes(h) }} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-2/50">
                    <MethodBadge m={h.req.method} />
                    <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg-2">{h.req.path}</code>
                    <span className={cn('text-[11px] font-medium tabular', h.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>{h.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ================================================================ terraform */

const TF_PROVIDER = `terraform {
  required_providers {
    autark = {
      source  = "autark-cloud/autark"
      version = "~> 0.9"
    }
  }
}

provider "autark" {
  endpoint = "https://autark.example.com"
  # token is read from AUTARK_TOKEN (system account token)
  account  = "acc-myco-a"
  project  = "proj-app1"
}`;

const TF_STACK = `resource "autark_network" "prod" {
  name        = "prod-vpc"
  location_id = "dc1"
  cidr        = "10.10.0.0/16"
  nat_gateway = true
  subnet {
    name   = "app"
    cidr   = "10.10.1.0/24"
    public = false
  }
}

resource "autark_vm" "web" {
  count       = 3
  name        = "web-\${count.index + 1}"
  location_id = "dc1"
  preset      = "general-4"
  image_id    = "img-ubuntu-2404"
  network_id  = autark_network.prod.id
  subnet_id   = autark_network.prod.subnet[0].id
  backups     = true
  tags = {
    env  = "prod"
    team = "web"
  }
}

resource "autark_database" "main" {
  name        = "pg-main"
  engine      = "postgres"
  version     = "17"
  location_id = "dc1"
  vcpus       = 4
  ram_gb      = 16
  storage_gb  = 200
  ha          = true
  network_id  = autark_network.prod.id
}

resource "autark_kubernetes_cluster" "apps" {
  name        = "apps"
  version     = "1.31"
  location_id = "dc1"
  ha          = true
  node_pool {
    name  = "default"
    vcpus = 4
    ram_gb = 16
    count = 3
    autoscale = { min = 3, max = 6 }
  }
}

output "db_host" { value = autark_database.main.host }`;

function TerraformTab() {
  return (
    <div className="grid gap-4 @min-[60rem]:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <Card><CardHeader title="1 · Configure the provider" description="terraform-provider-autark talks to the same REST API; resources map 1:1 to collections." /><CardBody><CodeBlock language="hcl" code={TF_PROVIDER} /></CardBody></Card>
        <Card><CardHeader title="2 · Describe your stack" description="Networks, VMs, databases and clusters — on your own hardware or burst cloud, same syntax." /><CardBody><CodeBlock language="hcl" maxHeight="max-h-[520px]" code={TF_STACK} /></CardBody></Card>
        <Card><CardHeader title="3 · Plan & apply" /><CardBody><CodeBlock language="bash" code={`export AUTARK_TOKEN=atk_live_…   # from IAM → System accounts\nterraform init\nterraform plan -out tf.plan\nterraform apply tf.plan\n\n# adopt resources created in the console\nterraform import autark_vm.legacy vm-001`} /></CardBody></Card>
      </div>
      <div className="space-y-4">
        <Card className="p-4">
          <div className="mb-2 text-[13px] font-semibold text-fg">Tips</div>
          <ul className="space-y-2 text-[13px] text-muted">
            <li>Every create form in the console has an <b className="text-fg-2">Equivalent code</b> panel that produces the matching HCL.</li>
            <li>Apply runs show up in <Link to="/activity?tab=audit" className="text-brand-500 hover:underline">Activity</Link> with <code className="font-mono text-[12px]">via: terraform</code>.</li>
            <li>Quotas, tag policies and allowed locations from <Link to="/iam/project-allowances" className="text-brand-500 hover:underline">project allowances</Link> are enforced at plan time (422 errors).</li>
            <li>Only portable primitives are used for cloud burst — no provider lock-in in your state.</li>
          </ul>
        </Card>
        <TokensCard />
      </div>
    </div>
  );
}

/* ================================================================ CLI */

function CliTab() {
  return (
    <div className="grid gap-4 @min-[60rem]:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <Card><CardHeader title="Install & log in" /><CardBody><CodeBlock language="bash" code={`# macOS / Linux\nbrew install autark-cloud/tap/autark\n# or: go install github.com/autark-cloud/autark-cli@latest\n\nautark login https://autark.example.com      # SSO in the browser\nautark login --token $AUTARK_TOKEN           # CI / headless\nautark context use acc-myco-a --project proj-app1`} /></CardBody></Card>
        <Card><CardHeader title="Everyday commands" /><CardBody><CodeBlock language="bash" maxHeight="max-h-[520px]" code={`autark vm list --status running -o table
autark vm create web-4 --location dc1 --preset general-4 --image img-ubuntu-2404 \\
  --network net-001 --tag env=prod --wait
autark vm ssh web-4
autark vm resize web-4 --vcpus 8 --ram-gb 32

autark db create pg-main --engine postgres --version 17 --ha --storage-gb 200
autark k8s kubeconfig apps > ~/.kube/autark-apps

autark ops list --running                 # long-running operations
autark ops watch op-3f9a2c                # stream steps & logs
autark ops cancel op-3f9a2c

autark costs summary -o json | jq '.byService'
autark audit --since 24h --actor svc:terraform`} /></CardBody></Card>
      </div>
      <div className="space-y-4">
        <Card className="p-4">
          <div className="mb-2 text-[13px] font-semibold text-fg">Output formats</div>
          <p className="text-[13px] text-muted">All commands support <code className="font-mono text-[12px]">-o table|json|yaml</code>. JSON output is exactly the REST response, so scripts can switch between CLI and API freely.</p>
        </Card>
        <TokensCard />
      </div>
    </div>
  );
}

/* ================================================================ MCP */

interface Tool { name: string; description: string; mode: 'read' | 'write' | 'destructive'; group: string }

function McpTab() {
  const [filter, setFilter] = useState<'all' | 'read' | 'write'>('all');
  const [q, setQ] = useState('');
  const tools: Tool[] = useMemo(() => {
    const api = describeApi();
    const out: Tool[] = [];
    for (const c of api.generic) {
      const meta = KINDS[c.kind as ResourceKind];
      const thing = thingOf(c);
      const slug = c.name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
      const one = slug.replace(/ies$/, 'y').replace(/s$/, '');
      const group = labelOf(c);
      out.push({ name: `list_${slug}`, description: `List ${group.toLowerCase()} with optional filters`, mode: 'read', group });
      out.push({ name: `get_${one}`, description: `Get a ${thing} by id`, mode: 'read', group });
      if (c.creatable && !c.readonly) out.push({ name: `create_${one}`, description: `Create a ${thing} (validated against quotas & policies)`, mode: 'write', group });
      if (!c.readonly) out.push({ name: `update_${one}`, description: `Update fields of a ${thing}`, mode: 'write', group });
      if (!c.readonly && c.creatable) out.push({ name: `delete_${one}`, description: `Delete a ${thing}`, mode: 'destructive', group });
      for (const a of c.actions) out.push({ name: `${one}_${a.replace(/-/g, '_')}`, description: `Run “${a}” on a ${thing}`, mode: /delete|destroy|reset|decommission|revoke|wipe/.test(a) ? 'destructive' : 'write', group });
    }
    for (const r of api.custom.filter((r) => r.method === 'GET')) {
      const p = r.path.replace(/^\/api\/v1\//, '').replace(/\/:[a-zA-Z]+/g, '').replace(/[/-]/g, '_');
      out.push({ name: `get_${p}`, description: r.summary ?? r.path, mode: 'read', group: 'Insights' });
    }
    const seen = new Set<string>();
    return out.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)));
  }, []);
  const shown = tools.filter((t) => (filter === 'all' || (filter === 'read' ? t.mode === 'read' : t.mode !== 'read')) && (!q || `${t.name} ${t.description}`.toLowerCase().includes(q.toLowerCase())));
  const byGroup = new Map<string, Tool[]>();
  for (const t of shown) byGroup.set(t.group, [...(byGroup.get(t.group) ?? []), t]);
  const counts = { read: tools.filter((t) => t.mode === 'read').length, write: tools.filter((t) => t.mode === 'write').length, destructive: tools.filter((t) => t.mode === 'destructive').length };

  const config = `{
  "mcpServers": {
    "autark": {
      "command": "autark",
      "args": ["mcp", "serve", "--read-only"],
      "env": {
        "AUTARK_URL": "https://autark.example.com",
        "AUTARK_TOKEN": "atk_live_…"
      }
    }
  }
}`;
  const remote = `{
  "mcpServers": {
    "autark": {
      "type": "http",
      "url": "https://autark.example.com/mcp",
      "headers": { "Authorization": "Bearer atk_live_…" }
    }
  }
}`;

  return (
    <div className="grid gap-4 @min-[60rem]:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="min-w-0 overflow-hidden">
        <CardHeader icon={Bot} title={`${tools.length} tools, generated from the API`} description="Every collection and action becomes a typed MCP tool. Agents get the same validation, quotas and audit trail as humans." />
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter tools…" className="h-8 w-full rounded-lg border border-line bg-surface-2/60 pl-8 pr-2 text-[13px] outline-none placeholder:text-faint focus:border-brand-500 focus:bg-surface" />
          </div>
          <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: 'all', label: `All ${tools.length}` }, { value: 'read', label: `Read ${counts.read}` }, { value: 'write', label: `Mutating ${counts.write + counts.destructive}` }]} />
        </div>
        <div className="max-h-[640px] divide-y divide-line overflow-y-auto">
          {[...byGroup].map(([g, list]) => (
            <div key={g} className="px-3 py-2.5">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{g}</div>
              <ul className="grid gap-1 @min-[40rem]:grid-cols-2">
                {list.map((t) => (
                  <li key={t.name} className="flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2/50">
                    {t.mode === 'read' ? <Eye className="mt-0.5 size-3.5 shrink-0 text-emerald-500" /> : t.mode === 'write' ? <PencilLine className="mt-0.5 size-3.5 shrink-0 text-amber-500" /> : <Flame className="mt-0.5 size-3.5 shrink-0 text-rose-500" />}
                    <div className="min-w-0">
                      <code className="block truncate font-mono text-[12px] text-fg">{t.name}</code>
                      <span className="block truncate text-[11px] text-muted">{t.description}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {!shown.length && <EmptyState icon={Search} title="No tools match" />}
        </div>
        <div className="flex flex-wrap gap-3 border-t border-line px-3 py-2 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1"><Eye className="size-3 text-emerald-500" />read-only ({counts.read})</span>
          <span className="inline-flex items-center gap-1"><PencilLine className="size-3 text-amber-500" />mutating ({counts.write})</span>
          <span className="inline-flex items-center gap-1"><Flame className="size-3 text-rose-500" />destructive, needs confirmation ({counts.destructive})</span>
        </div>
      </Card>
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader title="Connect an agent" description="Local stdio server via the CLI (Claude Desktop, Claude Code, IDEs)…" />
          <CardBody className="space-y-3">
            <CodeBlock language="json" title="mcp.json · local" code={config} />
            <p className="text-xs text-muted">…or the hosted endpoint of your control plane:</p>
            <CodeBlock language="json" title="mcp.json · remote" code={remote} />
          </CardBody>
        </Card>
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-fg"><ShieldCheck className="size-4 text-emerald-500" />Guardrails for AI</div>
          <ul className="space-y-1.5 text-[13px] text-muted">
            <li>Give each agent its own <Link to="/iam/system-accounts" className="text-brand-500 hover:underline">system account</Link> — least-privilege roles, project scope, IP allowlist and tag conditions.</li>
            <li><code className="font-mono text-[12px]">--read-only</code> exposes only read tools; destructive tools require explicit confirmation.</li>
            <li>Quotas, budgets and location policies apply exactly as for humans.</li>
            <li>Every tool call lands in the <Link to="/activity?tab=audit" className="text-brand-500 hover:underline">audit log</Link> with the agent's identity.</li>
          </ul>
        </Card>
        <TokensCard />
      </div>
    </div>
  );
}

/* ================================================================ tokens pointer */

function TokensCard() {
  const { items } = useList<SystemAccount>('systemAccounts');
  const active = items.reduce((a, s) => a + (s.tokens ?? []).filter((t) => t.status === 'active').length, 0);
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500"><KeyRound className="size-[18px]" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-fg">API tokens</div>
          <p className="mt-0.5 text-[13px] text-muted">Tokens belong to system accounts. {items.length ? `${items.length} accounts · ${active} active tokens.` : ''}</p>
          <ul className="mt-2 space-y-1">
            {items.slice(0, 4).map((s) => (
              <li key={s.id}><Link to={`/iam/system-accounts/${s.id}`} className="flex items-center justify-between gap-2 text-xs hover:text-brand-500"><span className="truncate text-fg-2">{s.name}</span><span className="shrink-0 text-faint">{(s.tokens ?? []).filter((t) => t.status === 'active').length} active</span></Link></li>
            ))}
          </ul>
          <Button size="sm" className="mt-3" iconRight={ArrowRight} to="/iam/system-accounts">Manage system accounts</Button>
        </div>
      </div>
    </Card>
  );
}
