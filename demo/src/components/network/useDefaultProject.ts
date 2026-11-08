import { useEffect } from 'react';
import { useList } from '@/api/hooks';
import { useUi } from '@/store/ui';
import type { Project } from '@/types';

/** Picks the scoped (or first) project when none is set — so forms work in simple mode where the
 *  project field lives inside a collapsed "Advanced" section (and ProjectField isn't mounted). */
export function useDefaultProject(value: string, set: (v: string) => void) {
  const accountId = useUi((s) => s.accountId);
  const scoped = useUi((s) => s.projectId);
  const { items } = useList<Project>('projects');
  const projects = items.filter((p) => p.accountId === accountId);
  useEffect(() => {
    if (!value && projects.length) set(scoped || projects[0].id);
  }, [value, projects.length, scoped]); // eslint-disable-line
  return projects.find((p) => p.id === value);
}
