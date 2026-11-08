import { Link } from 'react-router';
import { cn } from '@/lib/cn';
import { HOST_STATUS_HEX, hostUtil, utilColor, utilText, Led } from './visuals';
import type { BareMetalHost, Location } from '@/types';

/* Capacity heatmap: one row per host, one cell per resource (vCPU / RAM / GPU / local disk).
 * Cell color encodes allocation ratio; hosts are grouped by location. */

const COLS = [
  { id: 'cpu', label: 'vCPU' },
  { id: 'ram', label: 'RAM' },
  { id: 'gpu', label: 'GPU' },
  { id: 'disk', label: 'Disk' },
] as const;

export function CapacityHeatmap({ hosts, locations, className }: { hosts: BareMetalHost[]; locations: Map<string, Location>; className?: string }) {
  const groups = [...new Set(hosts.map((h) => h.locationId))];
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full min-w-[520px] border-separate border-spacing-[3px] text-xs">
        <thead>
          <tr>
            <th className="px-2 pb-1 text-left text-[11px] font-medium text-muted">Host</th>
            {COLS.map((c) => <th key={c.id} className="w-[17%] pb-1 text-center text-[11px] font-medium text-muted">{c.label}</th>)}
            <th className="w-14 pb-1 text-center text-[11px] font-medium text-muted">VMs</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRows key={g} title={locations.get(g)?.name ?? g} hosts={hosts.filter((h) => h.locationId === g)} />
          ))}
        </tbody>
      </table>
      <Legend />
    </div>
  );
}

function GroupRows({ title, hosts }: { title: string; hosts: BareMetalHost[] }) {
  return (
    <>
      <tr><td colSpan={6} className="px-2 pb-0.5 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-faint">{title}</td></tr>
      {hosts.map((h) => {
        const u = hostUtil(h);
        const values: Record<string, { r: number | null; detail: string }> = {
          cpu: { r: u.cpu, detail: `${u.a.vcpus}/${u.cap.vcpus}` },
          ram: { r: u.ram, detail: `${u.a.ramGB}/${u.cap.ramGB} GB` },
          gpu: { r: u.gpu, detail: u.cap.gpus ? `${u.a.gpus}/${u.cap.gpus}` : '—' },
          disk: { r: u.cap.diskGB ? u.disk : null, detail: `${u.a.diskGB}/${u.cap.diskGB} GB` },
        };
        const dim = h.status !== 'ready';
        return (
          <tr key={h.id} className="group">
            <td className="rounded-md px-2 py-1.5 group-hover:bg-surface-2">
              <Link to={`/hardware/bare-metals/${h.id}`} className="flex min-w-0 items-center gap-2">
                <Led color={HOST_STATUS_HEX[h.status] ?? '#94a3b8'} />
                <span className="truncate font-mono text-[12px] text-fg hover:text-brand-500">{h.name}</span>
                {dim && <span className="hidden text-[10px] text-muted @min-[36rem]:inline">{h.status}</span>}
              </Link>
            </td>
            {COLS.map((c) => {
              const v = values[c.id];
              return (
                <td key={c.id} title={`${h.name} ${c.label}: ${v.detail}`} className={cn('h-9 rounded-md text-center align-middle tabular transition-transform hover:scale-[1.04]', v.r == null && 'bg-[repeating-linear-gradient(135deg,var(--surface-2)_0,var(--surface-2)_4px,transparent_4px,transparent_8px)]', dim && 'opacity-60')}
                  style={v.r == null ? undefined : { background: utilColor(v.r) }}>
                  {v.r == null ? <span className="text-[10px] text-faint">n/a</span> : (
                    <div className={cn('leading-tight', utilText(v.r))}>
                      <div className="text-[12px] font-semibold">{Math.round(v.r * 100)}%</div>
                      <div className="hidden text-[9.5px] opacity-80 @min-[40rem]:block">{v.detail}</div>
                    </div>
                  )}
                </td>
              );
            })}
            <td className="text-center font-medium tabular text-fg-2">{u.a.vms}</td>
          </tr>
        );
      })}
    </>
  );
}

function Legend() {
  const steps = [0, 0.2, 0.4, 0.6, 0.79, 0.85, 0.97];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 px-2 text-[11px] text-muted">
      <span>Allocated</span>
      <div className="flex overflow-hidden rounded">
        {steps.map((s) => <span key={s} className="h-3 w-6" style={{ background: utilColor(s) }} />)}
      </div>
      <span className="tabular">0% → 80% → 95%+</span>
      <span className="ml-auto flex items-center gap-1.5"><span className="size-3 rounded bg-[repeating-linear-gradient(135deg,var(--surface-3)_0,var(--surface-3)_2px,transparent_2px,transparent_4px)]" /> not present</span>
    </div>
  );
}
