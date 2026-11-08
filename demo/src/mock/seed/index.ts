import type { Row } from '../db';
import { seedCore } from './core';
import { seedCompute } from './compute';
import { seedNetwork } from './network';
import { seedManaged } from './managed';
import { seedK8s } from './k8s';
import { seedStorage } from './storage';
import { seedHardware } from './hardware';

/** Build a fresh dataset. Timestamps are relative to "now" so the demo always looks current. */
export function buildSeed(): Record<string, Row[]> {
  const all = {
    ...seedCore(),
    ...seedCompute(),
    ...seedNetwork(),
    ...seedManaged(),
    ...seedK8s(),
    ...seedStorage(),
    ...seedHardware(),
  };
  return all as unknown as Record<string, Row[]>;
}
