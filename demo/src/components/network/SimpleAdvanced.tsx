import type { ReactNode } from 'react';
import { usePro } from '@/store/ui';
import { Advanced } from '@/components/ui/Pro';

/** In pro mode renders children inline (as before); in simple mode tucks them into a collapsed
 *  "Advanced options" block. Handy inside cards and modals that already have their own chrome. */
export function SimpleAdvanced({ children, title, description, className = 'shadow-none' }: { children: ReactNode; title?: ReactNode; description?: ReactNode; className?: string }) {
  return usePro() ? <>{children}</> : <Advanced title={title} description={description} className={className}>{children}</Advanced>;
}
