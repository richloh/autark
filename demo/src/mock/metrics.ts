import { noise, hashString } from '@/lib/random';
import type { MetricSeries } from '@/types';

/* ------------------------------------------------------------------------------------------------
 * Deterministic, time-based metric generator. Values are a function of (resource, metric, time),
 * so consecutive polls line up and charts appear "live".
 * ---------------------------------------------------------------------------------------------- */

export interface MetricProfile {
  unit: string; // "%", "MB/s", "req/s", "ms", "°C", "W", "GB"
  base: number; // typical value
  amp: number; // +/- variation
  max?: number; // clamp + chart max
  min?: number;
  diurnal?: number; // amplitude of a daily wave (0..1 of base)
  spikiness?: number; // chance-ish of spikes (0..1)
  /** when true value is 0 (resource stopped) */
  off?: boolean;
  /** monotonically growing (e.g. storage used): value = base + growth * fraction-of-range */
  trend?: number;
}

export const RANGES: Record<string, { points: number; stepMs: number }> = {
  '15m': { points: 60, stepMs: 15_000 },
  '1h': { points: 60, stepMs: 60_000 },
  '6h': { points: 72, stepMs: 5 * 60_000 },
  '24h': { points: 96, stepMs: 15 * 60_000 },
  '7d': { points: 84, stepMs: 2 * 3_600_000 },
  '30d': { points: 90, stepMs: 8 * 3_600_000 },
};

export function generateSeries(key: string, metric: string, profile: MetricProfile, range = '1h'): MetricSeries {
  const r = RANGES[range] ?? RANGES['1h'];
  const end = Math.floor(Date.now() / r.stepMs) * r.stepMs;
  const points = [];
  const seed = `${key}:${metric}`;
  const phase = (hashString(seed) % 1000) / 1000;
  for (let i = r.points - 1; i >= 0; i--) {
    const t = end - i * r.stepMs;
    points.push({ t, v: valueAt(seed, profile, t, phase, i / r.points) });
  }
  return { metric, unit: profile.unit, points, max: profile.max };
}

export function valueAt(seed: string, p: MetricProfile, t: number, phase = 0, frac = 0): number {
  if (p.off) return 0;
  const slow = noise(seed, t / 1_800_000) - 0.5; // 30 min wavelength
  const fast = noise(seed + 'f', t / 120_000) - 0.5; // 2 min
  const day = Math.sin(((t / 86_400_000) + phase) * Math.PI * 2);
  let v = p.base + p.amp * (slow * 1.4 + fast * 0.6) + (p.diurnal ?? 0) * p.base * day;
  if (p.spikiness) {
    const s = noise(seed + 's', t / 300_000);
    if (s > 1 - p.spikiness * 0.3) v += p.amp * 2.2 * (s - (1 - p.spikiness * 0.3)) / (p.spikiness * 0.3);
  }
  if (p.trend) v += p.trend * (1 - frac);
  const min = p.min ?? 0;
  if (p.max != null) v = Math.min(p.max, v);
  return Math.round(Math.max(min, v) * 100) / 100;
}

/** Profiles per resource kind; registered by domain handlers. */
type ProfileFn = (item: any, metric: string) => MetricProfile | null;
const profileFns = new Map<string, ProfileFn>();
export function registerMetrics(kind: string, fn: ProfileFn) { profileFns.set(kind, fn) }
export function profileFor(kind: string, item: any, metric: string): MetricProfile | null {
  return profileFns.get(kind)?.(item, metric) ?? null;
}
