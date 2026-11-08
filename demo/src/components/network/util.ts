import { isValidCidr, isValidIp, isValidPortSpec, parseCidr, cidrOverlaps, cidrContains, portMatches } from '@/lib/cidr';
import type { FirewallRule } from '@/types';

/** Distinct colors for subnets / blocks (work on light & dark backgrounds). */
export const SUBNET_COLORS = ['#5b67f8', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16', '#f97316', '#14b8a6', '#a855f7', '#0ea5e9'];
export const subnetColor = (i: number) => SUBNET_COLORS[i % SUBNET_COLORS.length];

export const RFC1918 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

/** Client-side mirror of the API's VPC CIDR validation (for instant feedback). */
export function vpcCidrProblem(cidr: string, others: { name: string; cidr: string }[]): string | null {
  if (!cidr.trim()) return 'CIDR is required';
  const p = parseCidr(cidr);
  if (!p) return 'Not a valid IPv4 CIDR (e.g. 10.0.0.0/16)';
  if (!isValidCidr(cidr)) return `Not aligned — did you mean ${p.base}/${p.prefix}?`;
  if (p.prefix < 16 || p.prefix > 24) return 'VPC prefix must be between /16 and /24';
  if (!RFC1918.some((r) => cidrContains(r, cidr))) return 'Use a private RFC 1918 range (10/8, 172.16/12, 192.168/16)';
  const clash = others.find((o) => cidrOverlaps(o.cidr, cidr));
  if (clash) return `Overlaps ${clash.name} (${clash.cidr})`;
  return null;
}

export function subnetCidrProblem(vpc: string, cidr: string, others: { name: string; cidr: string }[]): string | null {
  if (!cidr.trim()) return 'CIDR is required';
  const p = parseCidr(cidr);
  if (!p) return 'Not a valid CIDR';
  if (!isValidCidr(cidr)) return `Not aligned — use ${p.base}/${p.prefix}`;
  if (p.prefix > 29) return 'Must be /29 or larger';
  if (parseCidr(vpc) && !cidrContains(vpc, cidr)) return `Outside VPC ${vpc}`;
  const clash = others.find((o) => cidrOverlaps(o.cidr, cidr));
  if (clash) return `Overlaps ${clash.name}`;
  return null;
}

/** Suggest a VPC CIDR (10.N.0.0/16) not overlapping any of the given ranges. */
export function suggestVpcCidr(taken: string[], prefix = 16): string {
  for (let n = 0; n < 256; n++) {
    const c = `10.${n}.0.0/${prefix}`;
    if (!taken.some((t) => cidrOverlaps(t, c))) return c;
  }
  return '172.16.0.0/16';
}

/* ------------------------------------------------------------------ firewall rule helpers */

export function normalizeSource(s: string): string {
  const v = s.trim();
  if (!v || v === 'any' || v === '*') return '0.0.0.0/0';
  if (isValidIp(v)) return `${v}/32`;
  return v;
}

/** Client-side validation keyed like the API: rules.{i}.{field} */
export function ruleProblems(rules: FirewallRule[]): Record<string, string> {
  const errs: Record<string, string> = {};
  rules.forEach((r, i) => {
    if (r.protocol !== 'icmp' && !(r.protocol === 'any' && (r.ports === '*' || !r.ports)) && !isValidPortSpec(r.ports.replace(/\s+/g, ''))) errs[`rules.${i}.ports`] = 'Use 22, 80,443, 8000-9000 or *';
    const src = normalizeSource(r.source);
    if (src !== '0.0.0.0/0' && !isValidCidr(src)) {
      const p = parseCidr(src);
      errs[`rules.${i}.source`] = p ? `Not aligned — ${p.base}/${p.prefix}?` : 'Invalid IP or CIDR';
    }
    if (!Number.isInteger(r.priority) || r.priority < 1 || r.priority > 9999) errs[`rules.${i}.priority`] = '1–9999';
    else if (rules.some((o, j) => j < i && o.direction === r.direction && o.priority === r.priority)) errs[`rules.${i}.priority`] = 'Duplicate priority';
  });
  return errs;
}

const SENSITIVE: Record<number, string> = {
  22: 'SSH', 23: 'Telnet', 3389: 'RDP', 5432: 'PostgreSQL', 3306: 'MySQL', 6379: 'Redis', 27017: 'MongoDB', 9200: 'Elasticsearch', 2375: 'Docker API', 2379: 'etcd',
  10250: 'Kubelet', 11211: 'Memcached', 5900: 'VNC', 8888: 'Jupyter', 9090: 'Prometheus', 3000: 'Grafana', 25: 'SMTP', 445: 'SMB', 1433: 'MSSQL',
};
const WEB = new Set([80, 443, 8080, 8443]);

export interface Exposure { ruleId: string; level: 'critical' | 'warning' | 'info'; title: string; detail: string }

/** Which inbound ports are reachable from 0.0.0.0/0 — with severity. */
export function exposureOf(rules: FirewallRule[], defaultInbound: 'allow' | 'deny'): Exposure[] {
  const out: Exposure[] = [];
  if (defaultInbound === 'allow') out.push({ ruleId: '', level: 'critical', title: 'Default inbound policy is ALLOW', detail: 'Every port not explicitly denied is reachable. Set the default to deny and allow only what you need.' });
  const inbound = rules.filter((r) => r.enabled && r.direction === 'inbound').sort((a, b) => a.priority - b.priority);
  for (const r of inbound) {
    if (r.action !== 'allow' || normalizeSource(r.source) !== '0.0.0.0/0') continue;
    // shadowed by an earlier deny for the whole world?
    const proto = r.protocol === 'any' ? 'all protocols' : r.protocol.toUpperCase();
    if (r.ports === '*' || r.protocol === 'any' && (!r.ports || r.ports === '*')) {
      out.push({ ruleId: r.id, level: r.protocol === 'icmp' ? 'info' : 'critical', title: r.protocol === 'icmp' ? 'ICMP (ping) open to the internet' : `All ${proto} ports open to the internet`, detail: r.protocol === 'icmp' ? 'Usually fine; disable if you want hosts to be less discoverable.' : 'Restrict to the ports your service needs.' });
      continue;
    }
    const sens = Object.entries(SENSITIVE).filter(([p]) => portMatches(r.ports, Number(p))).map(([p, n]) => `${n} (${p})`);
    if (sens.length) out.push({ ruleId: r.id, level: 'critical', title: `${sens.slice(0, 3).join(', ')} reachable from anywhere`, detail: `${proto} ${r.ports} from 0.0.0.0/0. Limit the source to your office/VPN range or put it behind a bastion.` });
    else {
      const ports = r.ports.split(',').map((x) => x.trim());
      const allWeb = ports.every((p) => !p.includes('-') && WEB.has(Number(p)));
      out.push({ ruleId: r.id, level: allWeb ? 'info' : 'warning', title: `${proto} ${r.ports} open to the internet`, detail: allWeb ? 'Public web traffic — expected for web servers and load balancers.' : 'Make sure this service is meant to be public.' });
    }
  }
  return out;
}

export interface RulePreset { id: string; label: string; description: string; rules: Omit<FirewallRule, 'id' | 'priority' | 'enabled'>[] }

export function rulePresets(vpcCidr = '10.0.0.0/16', officeCidr = '198.51.100.0/24'): RulePreset[] {
  const inb = (protocol: FirewallRule['protocol'], ports: string, source: string, description: string, action: 'allow' | 'deny' = 'allow') => ({ direction: 'inbound' as const, protocol, ports, source, action, description });
  return [
    { id: 'ssh-office', label: 'SSH from office', description: `TCP 22 from ${officeCidr}`, rules: [inb('tcp', '22', officeCidr, 'SSH from office')] },
    { id: 'web', label: 'HTTP / HTTPS', description: 'TCP 80, 443 + QUIC from anywhere', rules: [inb('tcp', '80,443', '0.0.0.0/0', 'HTTP/HTTPS'), inb('udp', '443', '0.0.0.0/0', 'HTTP/3 QUIC')] },
    { id: 'pg-vpc', label: 'PostgreSQL from VPC', description: `TCP 5432 from ${vpcCidr}`, rules: [inb('tcp', '5432', vpcCidr, 'PostgreSQL from VPC')] },
    { id: 'mysql-vpc', label: 'MySQL from VPC', description: `TCP 3306 from ${vpcCidr}`, rules: [inb('tcp', '3306', vpcCidr, 'MySQL from VPC')] },
    { id: 'redis-vpc', label: 'Redis from VPC', description: `TCP 6379 from ${vpcCidr}`, rules: [inb('tcp', '6379', vpcCidr, 'Redis from VPC')] },
    { id: 'icmp', label: 'Ping (ICMP)', description: 'Echo from anywhere', rules: [inb('icmp', '*', '0.0.0.0/0', 'Ping')] },
    { id: 'k8s-nodeports', label: 'Kubernetes NodePorts', description: `TCP 30000-32767 from ${vpcCidr}`, rules: [inb('tcp', '30000-32767', vpcCidr, 'NodePorts from VPC')] },
    { id: 'wireguard', label: 'WireGuard VPN', description: 'UDP 51820 from anywhere', rules: [inb('udp', '51820', '0.0.0.0/0', 'WireGuard')] },
    { id: 'monitoring', label: 'Prometheus scrape', description: `TCP 9100 from ${vpcCidr}`, rules: [inb('tcp', '9100', vpcCidr, 'node_exporter scrape')] },
    { id: 'no-smtp', label: 'Block outbound SMTP', description: 'Deny TCP 25 to anywhere', rules: [{ direction: 'outbound', protocol: 'tcp', ports: '25', source: '0.0.0.0/0', action: 'deny', description: 'No direct SMTP' }] },
  ];
}

export const PROTOCOL_OPTIONS = [{ value: 'tcp', label: 'TCP' }, { value: 'udp', label: 'UDP' }, { value: 'icmp', label: 'ICMP' }, { value: 'any', label: 'Any' }];

export function downloadText(filename: string, text: string, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Pretty "203.0.113.0 – 203.0.113.255 (256 addresses)" */
export function cidrRange(cidr: string): string {
  const p = parseCidr(cidr);
  if (!p) return cidr;
  const ip = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  return `${ip(p.first)} – ${ip(p.last)}`;
}

export function cidrSize(cidr: string): number { return parseCidr(cidr)?.size ?? 0 }
