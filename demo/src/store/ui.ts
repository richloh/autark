import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';

interface UiState {
  theme: Theme;
  sidebarCollapsed: boolean;
  accountId: string;
  projectId: string; // '' = all projects in the account
  inspectorOpen: boolean;
  recent: { link: string; name: string; kind: string; at: number }[];
  density: 'comfortable' | 'compact';
  aiOpen: boolean;
  /** Pro mode reveals advanced pages, metrics, IaC snippets and configuration. Off = simple mode. */
  pro: boolean;
  setPro: (pro: boolean) => void;
  setAiOpen: (open: boolean) => void;
  setTheme: (t: Theme) => void;
  toggleSidebar: () => void;
  setScope: (accountId: string, projectId: string) => void;
  setInspector: (open: boolean) => void;
  pushRecent: (r: { link: string; name: string; kind: string }) => void;
  setDensity: (d: 'comfortable' | 'compact') => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      sidebarCollapsed: false,
      accountId: 'acc-regiocom',
      projectId: '',
      inspectorOpen: false,
      recent: [],
      density: 'comfortable',
      aiOpen: true,
      pro: false,
      setPro: (pro) => set({ pro }),
      setAiOpen: (aiOpen) => set({ aiOpen }),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setScope: (accountId, projectId) => set({ accountId, projectId }),
      setInspector: (inspectorOpen) => set({ inspectorOpen }),
      pushRecent: (r) => set((s) => ({ recent: [{ ...r, at: Date.now() }, ...s.recent.filter((x) => x.link !== r.link)].slice(0, 8) })),
      setDensity: (density) => set({ density }),
    }),
    { name: 'autark.ui', partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed, accountId: s.accountId, projectId: s.projectId, recent: s.recent, density: s.density, aiOpen: s.aiOpen, pro: s.pro }) },
  ),
);

export function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** Current scope, readable outside React (used by the API client). */
export function currentScope() {
  const s = useUi.getState();
  return { accountId: s.accountId, projectId: s.projectId };
}

/** true when the viewport is wide enough to dock side panels (>= 1280px). */
export function useWide(min = 1280) {
  const q = `(min-width: ${min}px)`;
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const h = () => setWide(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [q]);
  return wide;
}

/** Pro mode flag (simple mode when false). */
export function usePro() { return useUi((s) => s.pro) }
