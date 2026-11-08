import type { Row } from '../db';
import { seedCore } from './core';
import { seedCompute } from './compute';
import { seedNetwork } from './network';
import { seedManaged } from './managed';
import { seedK8s } from './k8s';
import { seedStorage } from './storage';
import { seedHardware } from './hardware';
import { seedK8sShared } from './k8sShared';

/** Build a fresh dataset. Timestamps are relative to "now" so the demo always looks current. */
export function buildSeed(): Record<string, Row[]> {
  const k8s = seedK8s();
  const shared = seedK8sShared();
  const all = {
    ...seedCore(),
    ...seedCompute(),
    ...seedNetwork(),
    ...seedManaged(),
    ...k8s,
    ...seedStorage(),
    ...seedHardware(),
    platformClusters: shared.platformClusters,
    k8sSpaces: shared.k8sSpaces,
    // dedicated-cluster workloads + workloads in shared spaces
    k8sWorkloads: [...k8s.k8sWorkloads, ...shared.k8sWorkloads],
  };
  return all as unknown as Record<string, Row[]>;
}
