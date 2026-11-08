import { useMemo } from 'react';
import { Network as NetIcon } from 'lucide-react';
import { useLookup, useMetrics } from '@/api/hooks';
import { Card, CardHeader } from '@/components/ui/Card';
import { ENGINE_META } from './engine';
import type { BareMetalHost, DbInstance } from '@/types';

interface NodeBox { id: string; role: string; title: string; sub: string; x: number; y: number; w: number; h: number; color: string; lag?: number; mode?: 'sync' | 'async'; up: boolean }

/** Live topology: clients → pooler → primary → standby (sync) / read replicas (async), edges animated with live lag. */
export function DbTopology({ d }: { d: DbInstance }) {
  const { map: hosts } = useLookup<BareMetalHost>('hosts');
  const metricIds = [...(d.ha ? ['standbyLag'] : []), ...Array.from({ length: d.readReplicas }, (_, i) => `replicaLag${i + 1}`)];
  const { data } = useMetrics('dbInstances', metricIds.length ? d.id : undefined, metricIds.length ? metricIds : ['cpu'], '15m');
  const last = (m: string) => data?.series?.[m]?.points.at(-1)?.v;
  const up = !['stopped', 'error', 'provisioning', 'deleting'].includes(d.status);
  const meta = ENGINE_META[d.engine];
  const pooler = d.engine === 'postgres' ? 'PgBouncer' : d.engine === 'mysql' ? 'ProxySQL' : d.engine === 'mariadb' ? 'MaxScale' : null;
  const hostName = (id?: string | null) => (id ? hosts.get(id)?.name ?? id : 'provider node');

  const { nodes, width, height, primary, client } = useMemo(() => {
    const right: NodeBox[] = [];
    const rowH = 62, gap = 12, colX = 430, w = 190, h = 50;
    if (d.ha) right.push({ id: 'standby', role: 'Standby', title: `${d.name}-standby`, sub: hostName(d.standbyHostId), x: colX, y: 0, w, h, color: '#10b981', lag: last('standbyLag'), mode: 'sync', up });
    for (let i = 0; i < d.readReplicas; i++) right.push({ id: `r${i + 1}`, role: `Read replica ${i + 1}`, title: `${d.name}-replica-${i + 1}`, sub: `async · read-only`, x: colX, y: 0, w, h, color: '#06b6d4', lag: last(`replicaLag${i + 1}`), mode: 'async', up });
    right.forEach((n, i) => { n.y = 10 + i * (rowH + gap) });
    const totalH = Math.max(110, right.length ? 10 + right.length * (rowH + gap) - gap + 10 : 110);
    const primary: NodeBox = { id: 'primary', role: 'Primary', title: d.name, sub: hostName(d.primaryHostId), x: 215, y: totalH / 2 - 30, w: 170, h: 60, color: meta.color, up };
    const client: NodeBox = { id: 'clients', role: pooler ? 'Pooler' : 'Clients', title: pooler ?? 'Applications', sub: `${d.host.split('.')[0]}:${d.port}`, x: 10, y: totalH / 2 - 25, w: 160, h: 50, color: '#64748b', up };
    return { nodes: right, width: colX + w + 10, height: totalH, primary, client };
  }, [d, data, hosts]); // eslint-disable-line

  const edge = (a: NodeBox, b: NodeBox) => {
    const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
    return { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, mx, my: (y1 + y2) / 2 };
  };
  const lagText = (v?: number) => (v == null ? '…' : v < 1 ? '<1 ms' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v.toFixed(v < 10 ? 1 : 0)} ms`);
  const lagColor = (v?: number) => (v == null ? 'var(--muted)' : v > 200 ? '#f43f5e' : v > 60 ? '#f59e0b' : '#10b981');

  const Box = ({ n, big }: { n: NodeBox; big?: boolean }) => (
    <g opacity={n.up ? 1 : 0.55}>
      <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={10} fill="var(--surface)" stroke={big ? n.color : 'var(--line-strong)'} strokeWidth={big ? 1.5 : 1} />
      <rect x={n.x} y={n.y + 8} width={3} height={n.h - 16} rx={1.5} fill={n.color} />
      <text x={n.x + 12} y={n.y + 16} fontSize={9.5} fill="var(--muted)" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{n.role}</text>
      <text x={n.x + 12} y={n.y + (big ? 34 : 31)} fontSize={big ? 13 : 12} fontWeight={600} fill="var(--fg)">{n.title.length > 24 ? n.title.slice(0, 23) + '…' : n.title}</text>
      <text x={n.x + 12} y={n.y + (big ? 50 : 44)} fontSize={10} fill="var(--muted)" fontFamily="ui-monospace, monospace">{n.sub}</text>
      <circle cx={n.x + n.w - 12} cy={n.y + 12} r={3.5} fill={n.up ? '#10b981' : '#94a3b8'}>
        {n.up && <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />}
      </circle>
    </g>
  );

  const ce = edge(client, primary);
  return (
    <Card>
      <CardHeader icon={NetIcon} title="Topology" description={d.ha ? 'Synchronous standby for automatic failover' + (d.readReplicas ? ', async replicas for reads' : '') : d.readReplicas ? 'Async read replicas — no automatic failover' : 'Single node — enable HA for automatic failover'} />
      <div className="overflow-x-auto p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full min-w-[520px]" style={{ maxHeight: 360 }}>
          <path d={ce.d} fill="none" stroke="var(--line-strong)" strokeWidth={2} />
          {up && <path d={ce.d} fill="none" stroke="#5b67f8" strokeWidth={2} strokeDasharray="4 8" className="animate-flow" />}
          {nodes.map((n) => {
            const e = edge(primary, n);
            return (
              <g key={n.id}>
                <path d={e.d} fill="none" stroke="var(--line-strong)" strokeWidth={n.mode === 'sync' ? 2.5 : 1.5} strokeDasharray={n.mode === 'async' ? '2 3' : undefined} />
                {up && <path d={e.d} fill="none" stroke={n.color} strokeWidth={n.mode === 'sync' ? 2.5 : 1.75} strokeDasharray="5 9" className="animate-flow" style={{ animationDuration: n.mode === 'sync' ? '0.9s' : '1.6s' }} />}
                <g transform={`translate(${e.mx}, ${n.y + n.h / 2})`}>
                  <rect x={-38} y={-10} width={76} height={20} rx={10} fill="var(--surface-2)" stroke="var(--line)" />
                  <text textAnchor="middle" y={3.5} fontSize={10} fontWeight={600} fill={up ? lagColor(n.lag) : 'var(--muted)'}>{up ? lagText(n.lag) : 'paused'}</text>
                </g>
                <text x={e.mx} y={n.y + n.h / 2 + 22} textAnchor="middle" fontSize={9} fill="var(--faint)">{n.mode === 'sync' ? 'synchronous' : 'asynchronous'}</text>
              </g>
            );
          })}
          <Box n={client} />
          <Box n={primary} big />
          {nodes.map((n) => <Box key={n.id} n={n} />)}
          {!nodes.length && (
            <g>
              <rect x={430} y={height / 2 - 25} width={190} height={50} rx={10} fill="none" stroke="var(--line-strong)" strokeDasharray="4 4" />
              <text x={525} y={height / 2 - 2} textAnchor="middle" fontSize={11} fill="var(--muted)">No standby</text>
              <text x={525} y={height / 2 + 13} textAnchor="middle" fontSize={10} fill="var(--faint)">Settings → Scale to add</text>
            </g>
          )}
        </svg>
      </div>
    </Card>
  );
}
