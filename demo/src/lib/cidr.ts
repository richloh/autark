/** IPv4 CIDR helpers used by networks, subnets, firewall packet tester, IP pools. */

export function ipToInt(ip: string): number {
  const p = ip.trim().split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return NaN;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

export function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function isValidIp(ip: string): boolean { return !Number.isNaN(ipToInt(ip)) }

export interface ParsedCidr { network: number; prefix: number; size: number; first: number; last: number; base: string }

export function parseCidr(cidr: string): ParsedCidr | null {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!m) return null;
  const ip = ipToInt(m[1]);
  const prefix = Number(m[2]);
  if (Number.isNaN(ip) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  const size = 2 ** (32 - prefix);
  return { network, prefix, size, first: network, last: network + size - 1, base: intToIp(network) };
}

export function isValidCidr(cidr: string): boolean {
  const p = parseCidr(cidr);
  return !!p && intToIp(p.network) === cidr.split('/')[0];
}

export function cidrContains(outer: string, inner: string): boolean {
  const a = parseCidr(outer);
  const b = parseCidr(inner);
  if (!a || !b) return false;
  return b.first >= a.first && b.last <= a.last;
}

export function cidrOverlaps(a: string, b: string): boolean {
  const x = parseCidr(a);
  const y = parseCidr(b);
  if (!x || !y) return false;
  return x.first <= y.last && y.first <= x.last;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  if (cidr === '0.0.0.0/0' || cidr === 'any' || cidr === '*') return true;
  const c = parseCidr(cidr.includes('/') ? cidr : `${cidr}/32`);
  const n = ipToInt(ip);
  if (!c || Number.isNaN(n)) return false;
  return n >= c.first && n <= c.last;
}

/** usable host count (minus network, broadcast, gateway for prefixes < 31) */
export function usableHosts(cidr: string): number {
  const p = parseCidr(cidr);
  if (!p) return 0;
  return p.prefix >= 31 ? p.size : p.size - 3;
}

/** Find the first free block of `prefix` size inside `parent` not overlapping `taken`. */
export function nextFreeSubnet(parent: string, taken: string[], prefix: number): string | null {
  const p = parseCidr(parent);
  if (!p || prefix < p.prefix) return null;
  const size = 2 ** (32 - prefix);
  for (let n = p.first; n + size - 1 <= p.last; n += size) {
    const cand = `${intToIp(n)}/${prefix}`;
    if (!taken.some((t) => cidrOverlaps(t, cand))) return cand;
  }
  return null;
}

export function nthHost(cidr: string, n: number): string {
  const p = parseCidr(cidr);
  if (!p) return '';
  return intToIp(p.first + n);
}

export function portMatches(spec: string, port: number): boolean {
  if (!spec || spec === '*' || spec === 'any') return true;
  return spec.split(',').some((part) => {
    const s = part.trim();
    if (s.includes('-')) {
      const [a, b] = s.split('-').map(Number);
      return port >= a && port <= b;
    }
    return Number(s) === port;
  });
}

export function isValidPortSpec(spec: string): boolean {
  if (spec === '*' || spec === 'any') return true;
  return spec.split(',').every((part) => {
    const s = part.trim();
    const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(s);
    if (!m) return false;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    return a >= 0 && b <= 65535 && a <= b;
  });
}
