import { Search, Menu as MenuIcon, Moon, Sun, Monitor, Terminal, LogOut, Settings, RotateCcw, User, BookOpen, Plus, ChevronDown, Sparkles, Sparkle, Info } from 'lucide-react';
import { KINDS } from '@/lib/kinds';
import type { ResourceKind } from '@/types';
import { useNavigate } from 'react-router';
import { useUi } from '@/store/ui';
import { useGet, queryClient } from '@/api/hooks';
import { api } from '@/api/client';
import { Menu } from '../ui/Menu';
import { Kbd } from '../ui/misc';
import { confirm } from '../ui/Modal';
import { toast } from '../ui/toast';
import { ScopeSwitcher } from './ScopeSwitcher';
import { NotificationsButton } from './Panels';
import { usePalette } from './CommandPalette';
import { showSplash } from './Splash';
import type { User as UserT } from '@/types';

const CREATE_ITEMS: [string, string, ResourceKind, string?][] = [
  ['Virtual machine', '/infrastructure/vms/new', 'vm'],
  ['Volume', '/infrastructure/volumes/new', 'volume'],
  ['Network', '/infrastructure/networks/new', 'network'],
  ['Firewall', '/infrastructure/firewalls/new', 'firewall'],
  ['Database', '/managed-services/db/new', 'db'],
  ['Kubernetes cluster', '/managed-services/kubernetes/new', 'k8s'],
  ['Bucket', '/managed-services/object-storage/new', 'bucket'],
  ['Load balancer', '/managed-services/load-balancers/new', 'lb'],
  ['Bare metal host', '/hardware/bare-metals/new', 'bareMetal'],
];

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { theme, setTheme, setInspector, pro, setPro } = useUi();
  const openPalette = usePalette((s) => s.set);
  const navigate = useNavigate();
  const { data } = useGet<{ user: UserT }>(['users', 'me'], '/me');
  const user = data?.user;
  const initials = user?.name.split(' ').map((p) => p[0]).join('').slice(0, 2) ?? 'A';
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <header className="sticky top-0 z-30 flex h-14 min-w-0 shrink-0 items-center gap-1.5 sm:gap-2 border-b border-line bg-surface/80 px-3 backdrop-blur-md sm:px-4">
      <button onClick={onMenu} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 lg:hidden" aria-label="Open menu"><MenuIcon className="size-5" /></button>
      <ScopeSwitcher />
      <button onClick={() => openPalette(true)} className="ml-1 hidden h-9 min-w-0 max-w-md flex-1 items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-3 text-left text-[13px] text-faint transition-colors hover:border-line-strong hover:bg-surface xl:flex">
        <Search className="size-4" />
        <span className="flex-1 truncate">Search or jump to…</span>
        <Kbd>⌘</Kbd><Kbd>K</Kbd>
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
        <Menu
          width="w-64"
          header={<div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">Create resource</div>}
          trigger={(open) => (
            <button className={`mr-1 hidden h-8 items-center gap-1.5 rounded-lg bg-brand-500 px-2.5 text-[13px] font-medium text-white shadow-sm shadow-brand-500/20 transition-colors hover:bg-brand-600 sm:inline-flex ${open ? 'bg-brand-600' : ''}`}>
              <Plus className="size-4" /> Create <ChevronDown className="size-3.5 opacity-80" />
            </button>
          )}
          items={CREATE_ITEMS.filter(([, , kind]) => pro || kind !== 'bareMetal').map(([label, to, kind, hint]) => ({ label, to, icon: KINDS[kind].icon, hint }))}
        />
        <button onClick={() => openPalette(true)} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 xl:hidden" aria-label="Search"><Search className="size-[18px]" /></button>
        {pro && <button onClick={() => setInspector(true)} className="hidden size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg sm:flex" title="API inspector" aria-label="API inspector"><Terminal className="size-[18px]" /></button>}

        <NotificationsButton />
        <button onClick={() => window.dispatchEvent(new Event('autark:toggle-ai'))} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" title="Autark Copilot" aria-label="Toggle Autark Copilot"><Sparkles className="size-[18px] text-brand-500" /></button>
        <Menu
          trigger={() => (
            <button className="ml-1 flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-indigo-500 text-xs font-semibold text-white ring-2 ring-surface" aria-label="User menu">{initials}</button>
          )}
          header={user && (
            <div className="mb-1 border-b border-line px-2.5 pb-2 pt-1.5">
              <div className="text-[13px] font-medium text-fg">{user.name}</div>
              <div className="text-xs text-muted">{user.email}</div>
            </div>
          )}
          items={[
            { label: 'Profile', icon: User, to: `/iam/users/${user?.id ?? 'user-001'}` },
            { label: 'Settings', icon: Settings, to: '/settings' },
            { label: pro ? 'Switch to simple mode' : 'Enable Pro mode', icon: Sparkle, onClick: () => { setPro(!pro); toast.info(pro ? 'Simple mode' : 'Pro mode enabled', pro ? 'Advanced pages and details are hidden.' : 'Topology, activity, IAM roles, metrics, IaC and advanced settings are now visible.') } },
            { label: `Theme: ${theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light'}`, icon: ThemeIcon, onClick: () => setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'), hint: 'cycle' },
            { label: 'About this demo', icon: Info, onClick: showSplash },
            { divider: true, label: '' },
            {
              label: 'Reset demo data', icon: RotateCcw, onClick: async () => {
                if (await confirm({ title: 'Reset demo data?', message: 'All resources you created or changed in this browser will be replaced with the original sample data.', confirmLabel: 'Reset', danger: true })) {
                  await api.post('/system/reset');
                  queryClient.invalidateQueries();
                  toast.success('Demo data reset');
                  navigate('/dashboard');
                }
              },
            },
            { label: 'Sign out', icon: LogOut, onClick: () => toast.info('This is a demo', 'Signing out is disabled.') },
          ]}
        />
      </div>
    </header>
  );
}
