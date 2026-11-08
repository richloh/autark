/** Deterministic pseudo random helpers (seeded) so mock data and metrics are stable. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0;
}

export function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in [0,1] for a given key and continuous x. */
export function noise(key: string, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = mulberry32(hashString(key) + i)();
  const b = mulberry32(hashString(key) + i + 1)();
  const u = f * f * (3 - 2 * f);
  return a * (1 - u) + b * u;
}

export function pick<T>(arr: T[], r: number): T { return arr[Math.floor(r * arr.length) % arr.length] }

export function randomHex(len: number): string {
  let s = '';
  const chars = '0123456789abcdef';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

export function randomToken(len: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
