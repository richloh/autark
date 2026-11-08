import { api } from '@/api/client';
import { money } from '@/lib/format';
import { toHcl } from '@/components/ui/CodeBlock';
import { KINDS } from '@/lib/kinds';
import type { ResourceKind } from '@/types';

/* ------------------------------------------------------------------------------------------------
 * Simulated copilot. There is no LLM in this demo: prompts are matched to a few intents and answered
 * from LIVE data via the same REST API the console uses, so the conversation reflects your sandbox.
 * In production this would be an LLM calling the Autark MCP tools listed on the API & IaC page.
 * ---------------------------------------------------------------------------------------------- */

export type Part =
  | { type: 'tool'; name: string; summary: string; ms: number }
  | { type: 'text'; md: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'action'; title: string; lines: string[]; cta: string; to: string; risk?: 'low' | 'medium' | 'high' };

export interface PageContext {
  path: string;
  title: string;
  kind?: ResourceKind;
  collection?: string;
  id?: string;
  listKind?: ResourceKind;
}

const DETAIL_ROUTES: [RegExp, ResourceKind, string][] = [
  [/^\/infrastructure\/vms\/(vm-[\w-]+)/, 'vm', 'vms'],
  [/^\/infrastructure\/volumes\/(vol-[\w-]+)/, 'volume', 'volumes'],
  [/^\/infrastructure\/networks\/(net-[\w-]+)/, 'network', 'networks'],
  [/^\/infrastructure\/firewalls\/(fw-[\w-]+)/, 'firewall', 'firewalls'],
  [/^\/infrastructure\/dns\/(zone-[\w-]+)/, 'dnsZone', 'dnsZones'],
  [/^\/managed-services\/db\/(db-[\w-]+)/, 'db', 'dbInstances'],
  [/^\/managed-services\/kubernetes\/(k8s-[\w-]+)/, 'k8s', 'k8sClusters'],
  [/^\/managed-services\/object-storage\/(bkt-[\w-]+)/, 'bucket', 'buckets'],
  [/^\/managed-services\/load-balancers\/(lb-[\w-]+)/, 'lb', 'loadBalancers'],
  [/^\/hardware\/bare-metals\/(bm-[\w-]+)/, 'bareMetal', 'hosts'],
  [/^\/hardware\/cloud-providers\/(provider-[\w-]+)/, 'provider', 'providers'],
];
const LIST_ROUTES: [RegExp, ResourceKind][] = [
  [/^\/infrastructure\/vms$/, 'vm'], [/^\/infrastructure\/volumes$/, 'volume'], [/^\/infrastructure\/networks$/, 'network'], [/^\/infrastructure\/firewalls$/, 'firewall'],
  [/^\/managed-services\/db$/, 'db'], [/^\/managed-services\/kubernetes$/, 'k8s'], [/^\/managed-services\/object-storage$/, 'bucket'], [/^\/managed-services\/load-balancers$/, 'lb'],
  [/^\/hardware\/bare-metals$/, 'bareMetal'],
];

export function contextFor(path: string, title: string): PageContext {
  for (const [rx, kind, collection] of DETAIL_ROUTES) {
    const m = rx.exec(path);
    if (m && !m[1].endsWith('new')) return { path, title, kind, collection, id: m[1] };
  }
  for (const [rx, kind] of LIST_ROUTES) if (rx.test(path)) return { path, title, listKind: kind };
  return { path, title };
}

export function suggestionsFor(ctx: PageContext): string[] {
  if (ctx.kind) {
    const raw = KINDS[ctx.kind].label;
    const label = raw === raw.toUpperCase() ? raw : raw.toLowerCase();
    return [`Explain this ${label}`, `What does this ${label} cost me?`, `Generate Terraform for this ${label}`, 'Any issues I should look at?'];
  }
  if (ctx.listKind) {
    const p = KINDS[ctx.listKind].plural.toLowerCase();
    return [`Which ${p} need attention?`, `Summarize my ${p}`, 'Where is my money going?', 'Spin up a VM like compass-app-1'];
  }
  if (ctx.path.startsWith('/billing')) return ['Where is my money going?', 'How do we compare to a hyperscaler?', 'Which projects are close to budget?'];
  return ['Any issues I should look at?', 'Where is my money going?', 'Summarize my infrastructure', 'Spin up a VM like compass-app-1'];
}

const t0 = () => performance.now();
async function tool<T>(name: string, path: string, summarize: (r: T) => string, parts: Part[]): Promise<T> {
  const s = t0();
  const r = await api.get_<T>(path);
  parts.push({ type: 'tool', name, summary: summarize(r), ms: Math.round(t0() - s) });
  return r;
}

const link = (kind: ResourceKind, id: string, name: string) => `[${name}](${KINDS[kind]?.link?.(id) ?? '#'})`;

/** Answer a prompt. Returns structured parts (tool calls, markdown text, code, action proposals). */
export async function respond(prompt: string, ctx: PageContext): Promise<Part[]> {
  const q = prompt.toLowerCase();
  const parts: Part[] = [];
  try {
    if (/(explain|what is this|tell me about|describe)/.test(q) && ctx.kind && ctx.id) return await explain(ctx, parts);
    if (/(terraform|iac|hcl|infrastructure as code)/.test(q)) return await terraform(ctx, parts);
    if (/(cost|money|spend|expensive|budget|bill|cheaper|save|hyperscaler)/.test(q)) {
      if (ctx.kind && ctx.id && /(this|cost me)/.test(q)) return await resourceCost(ctx, parts);
      return await costs(q, parts);
    }
    if (/(issue|problem|wrong|health|attention|broken|alert|degraded|error)/.test(q)) return await issues(parts);
    if (/(create|spin up|launch|provision|new vm|vm like)/.test(q)) return await createLike(q, parts);
    if (/(summar|overview|what do i have|inventory)/.test(q)) return await summary(ctx, parts);
  } catch (e) {
    parts.push({ type: 'text', md: `I couldn't reach the control plane: ${(e as Error).message}` });
    return parts;
  }
  parts.push({
    type: 'text',
    md: `This copilot is a **UI preview** — in the full product an LLM running on your own GPUs answers using the Autark MCP tools (list, inspect, plan and apply changes with your approval).\n\nTry one of these for a live, data-backed answer:\n- *Any issues I should look at?*\n- *Where is my money going?*\n- *Explain this* (on any resource page)\n- *Generate Terraform*`,
  });
  return parts;
}

async function issues(parts: Part[]): Promise<Part[]> {
  const [vms, lbs, hosts, certs, providers] = await Promise.all([
    tool<{ items: any[] }>('list_vms', '/vms?status=error', (r) => `${r.items.length} in error`, parts),
    tool<{ items: any[] }>('list_load_balancers', '/loadBalancers', (r) => `${r.items.filter((l) => l.status !== 'active').length} not active`, parts),
    tool<{ items: any[] }>('list_hosts', '/hosts', (r) => `${r.items.filter((h) => h.status !== 'ready').length} not ready`, parts),
    tool<{ items: any[] }>('list_certificates', '/certificates', (r) => `${r.items.filter((c) => c.status !== 'issued').length} need attention`, parts),
    tool<{ items: any[] }>('list_providers', '/providers', (r) => `${r.items.filter((p) => p.status !== 'connected').length} unhealthy`, parts),
  ]);
  const lines: string[] = [];
  for (const v of vms.items) lines.push(`- **VM ${link('vm', v.id, v.name)}** is in *error* — check the last operation and retry or rebuild.`);
  for (const l of lbs.items.filter((x) => x.status === 'degraded')) {
    const bad = l.targetGroups.flatMap((tg: any) => tg.targets.filter((t: any) => t.health === 'unhealthy').map((t: any) => t.ref.id));
    lines.push(`- **Load balancer ${link('lb', l.id, l.name)}** is degraded: ${bad.length} unhealthy target(s) (\`${bad.join('`, `')}\`). A stopped VM still registered as a target is the usual cause.`);
  }
  for (const h of hosts.items.filter((x) => ['offline', 'error'].includes(x.status))) lines.push(`- **Host ${link('bareMetal', h.id, h.name)}** is *${h.status}*${h.tags?.find((t: any) => t.key === 'incident') ? ` (incident ${h.tags.find((t: any) => t.key === 'incident').value})` : ''}.`);
  for (const h of hosts.items.filter((x) => x.status === 'maintenance')) lines.push(`- Host ${link('bareMetal', h.id, h.name)} is in maintenance — remember to exit when done.`);
  for (const c of certs.items.filter((x) => x.status === 'expiring')) lines.push(`- **Certificate ${c.domains.join(', ')}** expires soon and auto-renew is ${c.autoRenew ? 'on' : '**off**'}.`);
  for (const p of providers.items.filter((x) => x.status === 'error')) lines.push(`- **Provider ${link('provider', p.id, p.name)}**: ${p.lastError ?? 'connection failing'} → rotate credentials.`);
  parts.push({ type: 'text', md: lines.length ? `I found **${lines.length} thing${lines.length > 1 ? 's' : ''}** worth a look:\n\n${lines.join('\n')}` : 'Everything looks healthy in this scope. 🎉' });
  const lb = lbs.items.find((x) => x.status === 'degraded');
  if (lb) {
    parts.push({ type: 'action', title: `Fix ${lb.name}: drain unhealthy targets`, lines: ['Drain targets that are failing health checks', 'Traffic shifts to healthy targets immediately', 'Reversible — targets can be re-enabled'], cta: 'Review in load balancer', to: `/managed-services/load-balancers/${lb.id}?tab=targets`, risk: 'low' });
  }
  return parts;
}

async function costs(q: string, parts: Part[]): Promise<Part[]> {
  const s = await tool<any>('get_cost_summary', '/costs/summary', (r) => `run-rate ${money(r.total)}/mo`, parts);
  const top = s.top.slice(0, 5).map((i: any) => `- ${link(i.type, i.id, i.name)} — **${money(i.monthly)}**/mo (${i.service})`).join('\n');
  const services = s.byService.slice(0, 3).map((x: any) => `${x.label} ${money(x.monthly)}`).join(' · ');
  const budgets = s.byProject.filter((p: any) => p.budget).map((p: any) => `- ${p.name}: ${money(p.monthly)} of ${money(p.budget)} (${Math.round((p.monthly / p.budget) * 100)}%)`).join('\n');
  let md = `Your monthly run-rate is **${money(s.total)}** (forecast this month ${money(s.forecast)}). Biggest services: ${services}.\n\n**Top resources**\n${top}`;
  if (budgets) md += `\n\n**Budgets**\n${budgets}`;
  if (/hyperscaler|compare|cheaper/.test(q)) md += `\n\nRunning the same footprint on a hyperscaler would cost roughly **${money(s.total * 5.8)}**/mo on-demand — see the [Cost Explorer](/billing/cost-explorer) for the breakdown.`;
  else md += `\n\n💡 Stopped VMs still pay for disks and IPs, and idle GPU nodes are your most expensive line items. Open the [Cost Explorer](/billing/cost-explorer) to dig deeper.`;
  parts.push({ type: 'text', md });
  return parts;
}

async function summary(ctx: PageContext, parts: Part[]): Promise<Part[]> {
  const cols: [string, ResourceKind][] = [['vms', 'vm'], ['volumes', 'volume'], ['networks', 'network'], ['dbInstances', 'db'], ['k8sClusters', 'k8s'], ['buckets', 'bucket'], ['loadBalancers', 'lb']];
  const only = ctx.listKind ? cols.filter(([, k]) => k === ctx.listKind) : cols;
  const res = await Promise.all(only.map(([c, k]) => tool<{ items: any[] }>(`list_${c}`, `/${c}`, (r) => `${r.items.length} items`, parts).then((r) => [k, r.items] as const)));
  const lines = res.map(([k, items]) => {
    const byStatus: Record<string, number> = {};
    for (const i of items) byStatus[i.status ?? 'ok'] = (byStatus[i.status ?? 'ok'] ?? 0) + 1;
    const cost = items.reduce((a, i) => a + (i.monthlyCost ?? 0), 0);
    return `- **${items.length} ${KINDS[k].plural.toLowerCase()}** — ${Object.entries(byStatus).map(([s, n]) => `${n} ${s}`).join(', ') || 'none'}${cost ? ` · ${money(cost)}/mo` : ''}`;
  });
  parts.push({ type: 'text', md: `Here's what's running in this scope:\n\n${lines.join('\n')}` });
  return parts;
}

async function createLike(q: string, parts: Part[]): Promise<Part[]> {
  const want = q.match(/like ([a-z0-9][\w-]*)/i)?.[1]?.toLowerCase() ?? 'compass-app-1';
  const vms = await tool<{ items: any[] }>('list_vms', `/vms?name=${encodeURIComponent(want)}`, (r) => `${r.items.length} match`, parts);
  const ref = vms.items[0];
  const all = await tool<{ items: any[] }>('list_vms', '/vms', (r) => `${r.items.length} VMs`, parts);
  const base = (ref?.name ?? 'app').replace(/-\d+$/, '');
  let n = 1;
  while (all.items.some((v) => v.name === `${base}-${n}`) || (ref && `${base}-${n}` === ref.name)) n++;
  const name = `${base}-${n}`;
  parts.push({ type: 'text', md: ref ? `I'll clone the shape of ${link('vm', ref.id, ref.name)}: **${ref.size.vcpus} vCPU · ${ref.size.ramGB} GB**, same image, network and firewalls, placed on the least-loaded host in **${ref.locationId}**. Estimated **${money(ref.monthlyCost)}**/mo.` : `I couldn't find **${want}** in this scope, so I'll prepare a general-purpose VM (4 vCPU · 8 GB) in dc1.` });
  parts.push({ type: 'action', title: `Create VM ${name}`, lines: [`+ vm ${name} (${ref?.size.vcpus ?? 4} vCPU / ${ref?.size.ramGB ?? 8} GB)`, ref?.ipIds?.length ? `+ public IPv4 from ${ref.locationId} pool` : `+ private IP in the same subnet as ${ref?.name ?? 'the default network'}`, `~ firewalls: same as ${ref?.name ?? 'project default'}`], cta: 'Open prefilled form', to: `/infrastructure/vms/new?name=${name}&location=${ref?.locationId ?? 'dc1'}`, risk: 'low' });
  return parts;
}

async function explain(ctx: PageContext, parts: Part[]): Promise<Part[]> {
  const r = await tool<any>(`get_${ctx.collection}`, `/${ctx.collection}/${ctx.id}`, (x) => `${x.name ?? x.id} · ${x.status ?? 'ok'}`, parts);
  const k = ctx.kind!;
  let md = '';
  if (k === 'vm') {
    const ops = await tool<{ items: any[] }>('list_operations', `/operations?target.id=${r.id}&limit=3`, (x) => `${x.items.length} recent`, parts);
    md = `**${r.name}** is a ${r.status} VM with **${r.size.vcpus} vCPU / ${r.size.ramGB} GB**${r.gpu ? ` and ${r.gpu.count}× ${r.gpu.model}` : ''}, private IP \`${r.privateIp}\`${r.hostId ? `, running on host ${link('bareMetal', r.hostId, r.hostId)}` : ` in ${r.locationId}`}. It costs about **${money(r.monthlyCost)}**/mo.\n\n- Firewalls: ${r.firewallIds.length ? r.firewallIds.map((f: string) => `\`${f}\``).join(', ') : '**none** — all inbound traffic is blocked'}\n- Backups: ${r.backups.enabled ? `${r.backups.schedule}, keep ${r.backups.retention}` : '**disabled**'}\n- Deletion protection: ${r.deletionProtection ? 'on' : 'off'}${ops.items[0] ? `\n- Last operation: *${ops.items[0].title}* (${ops.items[0].status})` : ''}`;
    if (!r.backups.enabled) parts.push({ type: 'text', md }), parts.push({ type: 'action', title: `Enable daily backups for ${r.name}`, lines: ['~ backups.enabled: false → true', '~ schedule: daily, retention 7', `+ ~${money((r.monthlyCost ?? 0) * 0.2)}/mo`], cta: 'Open settings', to: `/infrastructure/vms/${r.id}?tab=settings`, risk: 'low' });
    else parts.push({ type: 'text', md });
    return parts;
  }
  if (k === 'lb') {
    const tgs = r.targetGroups.map((tg: any) => `- **${tg.name}** (${tg.protocol}:${tg.port}): ${tg.targets.map((t: any) => `${t.ref.id} *${t.health}*`).join(', ')}`).join('\n');
    md = `**${r.name}** is a ${r.type} load balancer (${r.algorithm.replace('_', ' ')}) and is **${r.status}**.\n\n${r.listeners.map((l: any) => `- Listener ${l.protocol} :${l.port}${l.redirectToHttps ? ' → redirect to HTTPS' : ''}`).join('\n')}\n\n**Target groups**\n${tgs}${r.status === 'degraded' ? '\n\nIt is degraded because at least one target fails its health check. Drain or fix that target to restore full capacity.' : ''}`;
  } else if (k === 'db') {
    md = `**${r.name}** runs **${r.engine} ${r.version}** (${r.size.vcpus} vCPU / ${r.size.ramGB} GB, ${r.storageUsedGB}/${r.storageGB} GB used) and is ${r.status}. ${r.ha ? 'It has a synchronous standby for automatic failover' : '**No HA standby** — a host failure means downtime'}${r.readReplicas ? ` and ${r.readReplicas} read replica(s)` : ''}. Backups: ${r.backups.schedule}${r.backups.pitr ? ' with point-in-time recovery' : ''}. Cost ≈ **${money(r.monthlyCost)}**/mo.`;
  } else if (k === 'k8s') {
    const nodes = r.nodePools.reduce((a: number, p: any) => a + p.count, 0);
    md = `**${r.name}** is Kubernetes **${r.version}** with ${nodes} nodes in ${r.nodePools.length} pool(s) (${r.nodePools.map((p: any) => `${p.name}×${p.count}`).join(', ')}), CNI ${r.cni}, ${r.controlPlane.ha ? 'HA control plane' : 'single control-plane replica'}. Cost ≈ **${money(r.monthlyCost)}**/mo.${r.version < '1.31' ? `\n\nAn upgrade to the next minor version is available — surge upgrades keep workloads running.` : ''}`;
  } else if (k === 'bareMetal') {
    md = `**${r.name}** is a ${r.vendor} ${r.model} (${r.cpuCores} cores, ${r.ramGB} GB${r.gpus?.length ? `, ${r.gpus.map((g: any) => `${g.count}× ${g.model}`).join(', ')}` : ''}) in rack ${r.rack}, status **${r.status}**. Allocated: ${r.allocated?.vcpus ?? 0} vCPU / ${r.allocated?.ramGB ?? 0} GB across ${r.allocated?.vms ?? 0} VMs.`;
  } else {
    md = `**${r.name ?? r.id}** (${KINDS[k].label}) is ${r.status ?? 'active'}${r.monthlyCost ? ` and costs about **${money(r.monthlyCost)}**/mo` : ''}.`;
  }
  parts.push({ type: 'text', md });
  return parts;
}

async function resourceCost(ctx: PageContext, parts: Part[]): Promise<Part[]> {
  const items = await tool<{ items: any[] }>('list_cost_items', '/costs/items', (r) => `${r.items.length} line items`, parts);
  const mine = items.items.filter((i) => i.id === ctx.id);
  const r = await tool<any>(`get_${ctx.collection}`, `/${ctx.collection}/${ctx.id}`, (x) => x.name ?? x.id, parts);
  const total = r.monthlyCost ?? mine.reduce((a, i) => a + i.monthly, 0);
  parts.push({ type: 'text', md: `**${r.name}** costs about **${money(total)}** per month (≈ ${money(total / 730, { decimals: true })}/h).${ctx.kind === 'vm' && r.status === 'stopped' ? '\n\nIt is stopped, so you only pay for its disks and IPs.' : ''}\n\nOn a hyperscaler the equivalent would be roughly **${money(total * 4)}**/mo.` });
  return parts;
}

async function terraform(ctx: PageContext, parts: Part[]): Promise<Part[]> {
  if (ctx.kind && ctx.id) {
    const r = await tool<any>(`get_${ctx.collection}`, `/${ctx.collection}/${ctx.id}`, (x) => x.name ?? x.id, parts);
    const { id, accountId, createdAt, updatedAt, status, monthlyCost, ...rest } = r;
    const body = Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'object' || Array.isArray(v)).slice(0, 14));
    parts.push({ type: 'text', md: `Here's **${r.name}** as Terraform. Import the existing resource with \`terraform import autark_${ctx.kind}.${(r.name ?? id).replace(/-/g, '_')} ${id}\`.` });
    parts.push({ type: 'code', language: 'hcl', code: toHcl(ctx.kind!, r.name ?? id, body) });
    return parts;
  }
  const vms = await tool<{ items: any[] }>('list_vms', '/vms', (r) => `${r.items.length} VMs`, parts);
  const code = vms.items.slice(0, 3).map((v) => toHcl('vm', v.name, { name: v.name, preset: v.size.presetId ?? undefined, vcpus: v.size.presetId ? undefined : v.size.vcpus, image: v.imageId, location: v.locationId, network_id: v.networkId, tags: v.tags })).join('\n\n');
  parts.push({ type: 'text', md: `Here are your first ${Math.min(3, vms.items.length)} VMs as Terraform. Open a resource page and ask again to export that specific resource.` });
  parts.push({ type: 'code', language: 'hcl', code });
  return parts;
}
