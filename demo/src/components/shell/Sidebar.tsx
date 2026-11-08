import { NavLink, Link } from 'react-router';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { NAV } from '@/nav';
import { useUi } from '@/store/ui';
import { ProToggle, ProBadge } from '../ui/Pro';
import { cn } from '@/lib/cn';
import { Logo } from './Logo';

export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);
  const pro = useUi((s) => s.pro);
  const isCollapsed = collapsed && !mobileOpen;
  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={onClose} />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-line bg-surface transition-[width,transform] duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          isCollapsed ? 'w-[60px]' : 'w-[244px]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className={cn('flex h-14 shrink-0 items-center border-b border-line', isCollapsed ? 'justify-center px-2' : 'justify-between px-4')}>
          <Link to="/dashboard" className="flex items-center gap-2.5" onClick={onClose}>
            <Logo className="size-7" />
            {!isCollapsed && (
              <span className="leading-none">
                <span className="block text-[15px] font-semibold tracking-tight text-fg">Autark</span>
                <span className="block text-[10px] font-medium uppercase tracking-wider text-faint">sovereign cloud</span>
              </span>
            )}
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2.5">
          {NAV.map((g) => ({ ...g, items: g.items.filter((i) => pro || !i.pro) })).filter((g) => g.items.length).map((g) => (
            <div key={g.label} className="mb-3">
              {!isCollapsed ? <div className="mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{g.label}</div> : <div className="mx-auto mb-2 h-px w-6 bg-line" />}
              <ul className="space-y-0.5">
                {g.items.map((it) => (
                  <li key={it.path}>
                    <NavLink
                      to={it.path}
                      onClick={onClose}
                      title={isCollapsed ? it.label : undefined}
                      className={({ isActive }) => cn(
                        'group relative flex h-8 items-center gap-2.5 rounded-lg text-[13px] font-medium transition-colors',
                        isCollapsed ? 'justify-center px-0' : 'px-2.5',
                        isActive ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'text-fg-2 hover:bg-surface-2 hover:text-fg',
                      )}
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className="absolute -left-2 top-1.5 h-5 w-[3px] rounded-r-full bg-brand-500" />}
                          <it.icon className={cn('size-4 shrink-0', isActive ? 'text-brand-500' : 'text-muted group-hover:text-fg-2')} />
                          {!isCollapsed && <span className="flex-1 truncate">{it.label}</span>}
                          {!isCollapsed && it.pro && <ProBadge />}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className={cn('flex gap-1 border-t border-line p-2', isCollapsed && 'flex-col')}>
          <div className="min-w-0 flex-1"><ProToggle compact={isCollapsed} /></div>
          <button onClick={toggle} title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn('hidden size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg lg:flex', isCollapsed && 'w-full')}>
            {isCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>
      </aside>
    </>
  );
}
