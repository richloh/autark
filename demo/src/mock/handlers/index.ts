import { registerCore } from './core';
import { registerVms } from './vms';
import { registerCompute } from './compute';
import { registerNetwork } from './network';
import { registerDatabases } from './databases';
import { registerLoadBalancers } from './loadbalancers';
import { registerK8s } from './k8s';
import { registerK8sShared } from './k8sShared';
import { registerStorage } from './storage';
import { registerHardware } from './hardware';
import { registerIam } from './iam';
import { registerBilling } from './billing';
import { registerOverview } from './overview';

let done = false;
export function registerAllHandlers() {
  if (done) return;
  done = true;
  registerCore();
  registerVms();
  registerCompute();
  registerNetwork();
  registerDatabases();
  registerLoadBalancers();
  registerK8s();
  registerK8sShared();
  registerStorage();
  registerHardware();
  registerIam();
  registerBilling();
  registerOverview();
}
