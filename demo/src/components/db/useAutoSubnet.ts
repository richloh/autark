import { useEffect } from 'react';
import { useList } from '@/api/hooks';
import type { Network } from '@/types';

/**
 * Picks the first matching network + subnet automatically (same rule as NetworkSubnetFields), so simple-mode
 * create forms work even while the network picker is tucked away in a collapsed "Advanced" section.
 */
export function useAutoSubnet(projectId: string, locationId: string | undefined, net: { networkId: string; subnetId: string }, onChange: (v: { networkId: string; subnetId: string }) => void) {
  const { items } = useList<Network>('networks');
  const nets = items.filter((n) => n.projectId === projectId && (!locationId || n.locationId === locationId));
  useEffect(() => {
    if (nets.length && !nets.some((n) => n.id === net.networkId)) onChange({ networkId: nets[0].id, subnetId: nets[0].subnets[0]?.id ?? '' });
    if (!nets.length && net.networkId) onChange({ networkId: '', subnetId: '' });
  }, [nets.map((n) => n.id).join(), net.networkId]); // eslint-disable-line
  return nets;
}
