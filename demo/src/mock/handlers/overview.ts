import { db } from '../db';
import { route } from '../framework';
import { hostAllocation, hostCapacity } from './shared';
import type { BareMetalHost } from '@/types';

/* Read-only aggregates for the dashboard. Capacity is fleet-wide (hosts are shared by all accounts),
 * so it is computed from every placed VM rather than only the caller's scope. */

export function registerOverview() {
  route('GET', '/overview/capacity', () => {
    const byLoc = new Map<string, any>();
    for (const h of db.list<BareMetalHost>('hosts')) {
      const l = byLoc.get(h.locationId) ?? {
        locationId: h.locationId,
        hosts: { total: 0, ready: 0, maintenance: 0, offline: 0, other: 0 },
        capacity: { vcpus: 0, ramGB: 0, gpus: 0 },
        allocated: { vcpus: 0, ramGB: 0, gpus: 0, vms: 0 },
      };
      l.hosts.total++;
      if (h.status === 'ready') l.hosts.ready++;
      else if (h.status === 'maintenance' || h.status === 'draining') l.hosts.maintenance++;
      else if (h.status === 'offline' || h.status === 'error') l.hosts.offline++;
      else l.hosts.other++;
      if (h.status === 'ready' || h.status === 'draining' || h.status === 'maintenance') {
        const c = hostCapacity(h);
        l.capacity.vcpus += c.vcpus; l.capacity.ramGB += c.ramGB; l.capacity.gpus += c.gpus;
      }
      const a = hostAllocation(h.id);
      l.allocated.vcpus += a.vcpus; l.allocated.ramGB += a.ramGB; l.allocated.gpus += a.gpus; l.allocated.vms += a.vms;
      byLoc.set(h.locationId, l);
    }
    return { locations: [...byLoc.values()] };
  }, 'Fleet capacity per self-hosted location (allocated vs. schedulable vCPU/RAM/GPU)');
}
