import { useGet } from '@/api/hooks';
import { cn } from '@/lib/cn';
import type { DbEngine, DbEngineSpec, DbInstance } from '@/types';

/** Display metadata per managed database engine (brand-ish colors, short monogram). */
export const ENGINE_META: Record<DbEngine, { label: string; short: string; color: string; port: number; cli: string; scheme: string }> = {
  postgres: { label: 'PostgreSQL', short: 'Pg', color: '#336791', port: 5432, cli: 'psql', scheme: 'postgresql' },
  mysql: { label: 'MySQL', short: 'My', color: '#00758f', port: 3306, cli: 'mysql', scheme: 'mysql' },
  mariadb: { label: 'MariaDB', short: 'Ma', color: '#c0765a', port: 3306, cli: 'mariadb', scheme: 'mariadb' },
  redis: { label: 'Redis', short: 'Rd', color: '#dc382d', port: 6379, cli: 'redis-cli', scheme: 'rediss' },
};

/** Colored engine "logo" tile. */
export function EngineLogo({ engine, size = 28, className }: { engine: DbEngine; size?: number; className?: string }) {
  const m = ENGINE_META[engine];
  return (
    <span
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-lg font-bold text-white shadow-sm', className)}
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${m.color}, ${m.color}cc)`, fontSize: Math.round(size * 0.4) }}
      title={m.label}
    >
      {m.short}
    </span>
  );
}

/** Inline engine + version pill. */
export function EngineBadge({ engine, version, className }: { engine: DbEngine; version?: string; className?: string }) {
  const m = ENGINE_META[engine];
  return (
    <span className={cn('inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium ring-1 ring-inset', className)}
      style={{ background: `${m.color}14`, color: m.color, boxShadow: `inset 0 0 0 1px ${m.color}33` }}>
      <span className="size-1.5 rounded-full" style={{ background: m.color }} />
      {m.label}{version ? ` ${version}` : ''}
    </span>
  );
}

/** Engine catalog (versions, parameters) from GET /db/engines. */
export function useDbEngines() {
  const q = useGet<{ engines: DbEngineSpec[] }>(['dbEngines'], '/db/engines');
  const engines = q.data?.engines ?? [];
  return { ...q, engines, byId: (id: string) => engines.find((e) => e.id === id) };
}

export const DB_TRANSITIONAL: DbInstance['status'][] = ['provisioning', 'backing-up', 'restoring', 'scaling', 'failing-over', 'maintenance', 'upgrading', 'deleting', 'starting', 'stopping', 'rebooting'];

/** Topology label, e.g. "Primary + standby + 2 replicas" */
export function topologyLabel(d: Pick<DbInstance, 'ha' | 'readReplicas'>) {
  const parts = ['Primary'];
  if (d.ha) parts.push('standby');
  if (d.readReplicas) parts.push(`${d.readReplicas} replica${d.readReplicas > 1 ? 's' : ''}`);
  return parts.join(' + ');
}

export const DAYS = [
  { value: 'mon', label: 'Monday' }, { value: 'tue', label: 'Tuesday' }, { value: 'wed', label: 'Wednesday' }, { value: 'thu', label: 'Thursday' },
  { value: 'fri', label: 'Friday' }, { value: 'sat', label: 'Saturday' }, { value: 'sun', label: 'Sunday' },
] as const;
