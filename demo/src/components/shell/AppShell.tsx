import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from './CommandPalette';
import { OperationsTray } from './Panels';
import { ApiInspector } from './ApiInspector';
import { AiPane } from '../ai/AiPane';
import { useRealtimeInvalidation } from '@/api/hooks';
import { useUi, applyTheme } from '@/store/ui';
import { ConfirmHost } from '../ui/Modal';
import { Toaster } from '../ui/toast';

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const theme = useUi((s) => s.theme);
  const location = useLocation();
  useRealtimeInvalidation();
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const h = () => applyTheme('system');
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [theme]);
  useEffect(() => { setMobileOpen(false); document.getElementById('main')?.scrollTo({ top: 0 }) }, [location.pathname]);
  return (
    <div className="flex min-h-screen">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main id="main" className="@container min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
      <AiPane />
      <CommandPalette />
      <OperationsTray />
      <ApiInspector />
      <ConfirmHost />
      <Toaster />
    </div>
  );
}
