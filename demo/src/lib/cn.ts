import clsx, { type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge about our semantic color tokens so e.g. `text-muted` vs `text-sm` don't collide.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: ['bg', 'surface', 'surface-2', 'surface-3', 'line', 'line-strong', 'fg', 'fg-2', 'muted', 'faint'],
    },
  },
});

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
