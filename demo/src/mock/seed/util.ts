import type { Tag } from '@/types';
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
export const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();
export const tags = (o: Record<string, string>): Tag[] => Object.entries(o).map(([key, value]) => ({ key, value }));

/** Accounts */
export const R = 'acc-regiocom'; // Regiocom Energie (utility, the demo's main tenant)
export const E = 'acc-enneo'; // Enneo (AI customer-service platform operated for Regiocom)
export const KX = 'acc-kunde-x'; // empty account (no projects yet)

/** The logged-in demo user. */
export const ME = 'dennis@regiocom-energie.de';

export const projectAccount: Record<string, string> = {
  'proj-compass': R, 'proj-orchestrator': R, 'proj-isu': R, 'proj-s4': R, 'proj-website': R, 'proj-tools': R,
  'proj-enneo-regiocom': E, 'proj-enneo-intern': E,
};
export const scope = (projectId: string) => ({ accountId: projectAccount[projectId], projectId });

/** Kostenstellen (cost centers) per Regiocom project — required tag `kostenstelle`. */
export const KST: Record<string, string> = {
  'proj-compass': '4100', 'proj-orchestrator': '4200', 'proj-isu': '4300', 'proj-s4': '4310', 'proj-website': '5100', 'proj-tools': '9000',
};
/** Standard tags for a resource in a project (Regiocom projects require env + kostenstelle). */
export const ptags = (projectId: string, env: string, extra: Record<string, string> = {}): Tag[] =>
  tags({ env, ...(KST[projectId] ? { kostenstelle: KST[projectId] } : {}), ...extra });
