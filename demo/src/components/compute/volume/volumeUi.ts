import type { Tone } from '@/components/ui/Badge';
import type { Volume, VolumeType } from '@/types';

export const TYPE_TONE: Record<VolumeType, Tone> = { ssd: 'brand', nvme: 'violet', hdd: 'neutral' };
export const TYPE_COLOR: Record<VolumeType, string> = { ssd: '#5b67f8', nvme: '#a855f7', hdd: '#64748b' };
export const VOLUME_TRANSITIONAL: Volume['status'][] = ['creating', 'attaching', 'detaching', 'resizing', 'updating', 'restoring', 'deleting'];
