import { db } from '../db';
import { route } from '../framework';
import { noise } from '@/lib/random';
import { allCostItems, SERVICE_LABEL, type Service, type CostItem } from './costs';
import type { Project, ProjectAllowance } from '@/types';

/* Showback / chargeback endpoints. History is synthesised from today's run-rate with gentle,
 * deterministic variation so charts look plausible and stay stable between reloads. */

const DAY = 86_400_000;

function scoped(ctx: { scope: { accountId: string; projectId: string | null } }): CostItem[] {
  return allCostItems().filter((i) => i.accountId === ctx.scope.accountId && (!ctx.scope.projectId || i.projectId === ctx.scope.projectId));
}

function group<K extends string>(items: CostItem[], key: (i: CostItem) => K) {
  const m = new Map<K, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + i.monthly);
  return m;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Daily cost for a group key `days` ago, derived from monthly run-rate. Growth: older = cheaper. */
function dailyAt(key: string, monthly: number, daysAgo: number) {
  const growth = 1 - Math.min(0.35, daysAgo * 0.0035);
  const wobble = 0.9 + noise(key, daysAgo / 3) * 0.2;
  return (monthly / 30) * growth * wobble;
}

export function registerBilling() {
  route('GET', '/costs/summary', (ctx) => {
    const items = scoped(ctx);
    const total = r2(items.reduce((a, i) => a + i.monthly, 0));
    const byService = [...group(items, (i) => i.service)].map(([service, monthly]) => ({ service, label: SERVICE_LABEL[service as Service], monthly: r2(monthly) })).sort((a, b) => b.monthly - a.monthly);
    const projects = db.filter<Project>('projects', (p) => p.accountId === ctx.scope.accountId && (!ctx.scope.projectId || p.id === ctx.scope.projectId));
    const byProjectMap = group(items, (i) => i.projectId);
    const byProject = projects.map((p) => {
      const a = db.find<ProjectAllowance>('allowances', (x) => x.projectId === p.id);
      return { projectId: p.id, name: p.name, color: p.color, monthly: r2(byProjectMap.get(p.id) ?? 0), budget: a?.budgetMonthly ?? 0, allowanceId: a?.id };
    }).sort((a, b) => b.monthly - a.monthly);
    const byLocation = [...group(items, (i) => i.locationId ?? 'global')].map(([locationId, monthly]) => ({ locationId, monthly: r2(monthly) })).sort((a, b) => b.monthly - a.monthly);
    const top = [...items].sort((a, b) => b.monthly - a.monthly).slice(0, 12);
    // month-to-date & forecast
    const now = new Date();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const mtd = r2(Array.from({ length: dayOfMonth }, (_, d) => byService.reduce((a, s) => a + dailyAt(s.service, s.monthly, dayOfMonth - 1 - d), 0)).reduce((a, b) => a + b, 0));
    const forecast = r2(mtd + (total / 30) * (daysInMonth - dayOfMonth));
    const lastMonth = r2(byService.reduce((a, s) => a + Array.from({ length: 30 }, (_, d) => dailyAt(s.service, s.monthly, dayOfMonth + d)).reduce((x, y) => x + y, 0), 0));
    const budget = byProject.reduce((a, p) => a + p.budget, 0);
    return { currency: 'EUR', total, mtd, forecast, lastMonth, budget, byService, byProject, byLocation, top, dayOfMonth, daysInMonth };
  }, 'Cost summary for the current scope (run-rate, MTD, forecast, breakdowns)');

  route('GET', '/costs/history', (ctx) => {
    const days = Math.min(180, Number(ctx.query.get('days') ?? 30));
    const by = (ctx.query.get('groupBy') ?? 'service') as 'service' | 'project';
    const items = scoped(ctx);
    const groups = by === 'service' ? group(items, (i) => i.service) : group(items, (i) => i.projectId);
    const labels = by === 'service'
      ? Object.fromEntries([...groups.keys()].map((k) => [k, SERVICE_LABEL[k as Service]]))
      : Object.fromEntries(db.list<Project>('projects').map((p) => [p.id, p.name]));
    const today = Math.floor(Date.now() / DAY) * DAY;
    const series = [...groups].map(([key, monthly]) => ({
      key, label: labels[key] ?? key,
      points: Array.from({ length: days }, (_, i) => { const daysAgo = days - 1 - i; return { t: today - daysAgo * DAY, v: r2(dailyAt(key, monthly, daysAgo)) } }),
    }));
    const forecastDays = Number(ctx.query.get('forecast') ?? 0);
    const forecast = forecastDays ? [...groups].map(([key, monthly]) => ({ key, points: Array.from({ length: forecastDays }, (_, i) => ({ t: today + (i + 1) * DAY, v: r2((monthly / 30) * (1 + (i + 1) * 0.002)) })) })) : [];
    return { groupBy: by, days, series, forecast };
  }, 'Daily cost history grouped by service or project (?days=&groupBy=&forecast=)');

  route('GET', '/costs/items', (ctx) => {
    const items = scoped(ctx).sort((a, b) => b.monthly - a.monthly);
    return { items, total: items.length };
  }, 'Every billable line item in scope');
}
