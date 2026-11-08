import type { Image } from '@/types';

/** Brand-ish colors for OS images (no external assets). */
export const OS_STYLE: Record<string, { color: string; label: string }> = {
  ubuntu: { color: '#E95420', label: 'Ubuntu' },
  debian: { color: '#A80030', label: 'Debian' },
  fedora: { color: '#3C6EB4', label: 'Fedora' },
  rocky: { color: '#10B981', label: 'Rocky' },
  alma: { color: '#0F4266', label: 'Alma' },
  suse: { color: '#30BA78', label: 'openSUSE' },
  windows: { color: '#0078D4', label: 'Windows' },
  flatcar: { color: '#09BAC8', label: 'Flatcar' },
  custom: { color: '#8b5cf6', label: 'Custom' },
};

export function OsBadge({ os, size = 28 }: { os: Image['os'] | string; size?: number }) {
  const s = OS_STYLE[os] ?? OS_STYLE.custom;
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-lg font-bold text-white shadow-sm" style={{ width: size, height: size, background: `linear-gradient(135deg, ${s.color}, ${s.color}cc)`, fontSize: size * 0.42 }}>
      {s.label.slice(0, 1)}
    </span>
  );
}
