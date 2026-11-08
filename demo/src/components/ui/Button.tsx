import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Loader2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'outline-danger';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm shadow-brand-500/20 disabled:bg-brand-500/50',
  secondary: 'bg-surface text-fg border border-line hover:bg-surface-2 hover:border-line-strong shadow-card',
  ghost: 'text-fg-2 hover:bg-surface-2 hover:text-fg',
  subtle: 'bg-surface-2 text-fg hover:bg-surface-3',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm disabled:bg-rose-600/50',
  'outline-danger': 'border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10',
};
const SIZE: Record<ButtonSize, string> = {
  xs: 'h-7 px-2 text-xs gap-1 rounded-md',
  sm: 'h-8 px-2.5 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  to?: string; // render as router link
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, loading, className, children, to, disabled, ...rest },
  ref,
) {
  const cls = cn(
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-60',
    VARIANT[variant], SIZE[size], className,
  );
  const iconCls = size === 'xs' ? 'size-3.5' : 'size-4';
  const content = (
    <>
      {loading ? <Loader2 className={cn(iconCls, 'animate-spin')} /> : Icon ? <Icon className={iconCls} /> : null}
      {children}
      {IconRight && <IconRight className={iconCls} />}
    </>
  );
  if (to && !disabled) return <Link to={to} className={cls}>{content}</Link>;
  return <button ref={ref} className={cls} disabled={disabled || loading} {...rest}>{content}</button>;
});

export function IconButton({ icon: Icon, label, className, size = 'md', variant = 'ghost', ...rest }: Omit<ButtonProps, 'children'> & { icon: LucideIcon; label: string }) {
  const dim = size === 'xs' ? 'size-7' : size === 'sm' ? 'size-8' : 'size-9';
  return (
    <button
      aria-label={label}
      title={label}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-50', dim, VARIANT[variant], className)}
      {...rest}
    >
      <Icon className={size === 'xs' ? 'size-3.5' : 'size-4'} />
    </button>
  );
}
