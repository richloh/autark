import { Bot } from 'lucide-react';
import { cn } from '@/lib/cn';
import { hashString } from '@/lib/random';

const COLORS = ['#5b67f8', '#06b6d4', '#a855f7', '#f59e0b', '#10b981', '#ec4899', '#ef4444', '#0ea5e9', '#84cc16', '#f97316'];

export function avatarColor(seed: string) { return COLORS[hashString(seed) % COLORS.length] }

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Round avatar with initials and a deterministic color; optional status dot. */
export function Avatar({ name, seed, size = 32, status, className, muted }: { name: string; seed?: string; size?: number; status?: 'active' | 'invited' | 'disabled'; className?: string; muted?: boolean }) {
  const color = avatarColor(seed ?? name);
  return (
    <span className={cn('relative inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold', muted && 'grayscale opacity-60', className)}
      style={{ width: size, height: size, background: `${color}22`, color, fontSize: Math.max(10, size * 0.38), boxShadow: `inset 0 0 0 1px ${color}40` }}>
      {initials(name)}
      {status && (
        <span className={cn('absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-surface', status === 'active' ? 'bg-emerald-500' : status === 'invited' ? 'bg-sky-500' : 'bg-faint')}
          style={{ width: Math.max(8, size * 0.3), height: Math.max(8, size * 0.3) }} title={status} />
      )}
    </span>
  );
}

export function BotAvatar({ size = 32, className, disabled }: { size?: number; className?: string; disabled?: boolean }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 ring-1 ring-inset ring-violet-500/25 dark:text-violet-300', disabled && 'opacity-50 grayscale', className)} style={{ width: size, height: size }}>
      <Bot style={{ width: size * 0.55, height: size * 0.55 }} />
    </span>
  );
}
