export function calculateVMCost(vm, pricing, preset = null) {
  let vcpus, ramGB, systemDiskGB;

  if (preset) {
    vcpus = preset.vcpus;
    ramGB = preset.ramGB;
    systemDiskGB = preset.systemDiskGB;
  } else if (vm.custom) {
    vcpus = vm.custom.vcpus;
    ramGB = vm.custom.ramGB;
    systemDiskGB = vm.custom.systemDiskGB;
  } else {
    return 0;
  }

  let cost = vcpus * pricing.vm.vCPUPerMonth;
  cost += ramGB * pricing.vm.ramGBPerMonth;
  cost += systemDiskGB * pricing.vm.systemDiskGBPerMonth;

  if (vm.ips && vm.ips.length > 0) {
    cost += vm.ips.length * pricing.vm.publicIPv4PerMonth;
  }

  if (vm.gpus && vm.gpus.length > 0) {
    vm.gpus.forEach(gpu => {
      const gpuHourly = pricing.vm.gpuPerHour[gpu.model] || 0;
      cost += gpuHourly * 24 * 30 * gpu.count;
    });
  }

  return Math.round(cost * 100) / 100;
}

export function calculateVolumeCost(volume, pricing) {
  const typeKey = `${volume.type}GBPerMonth`;
  let cost = volume.sizeGB * (pricing.volume[typeKey] || 0);

  if (volume.iops) {
    cost += (volume.iops / 1000) * pricing.volume.iopsPer1000PerMonth;
  }

  if (volume.throughputMBps) {
    cost += volume.throughputMBps * pricing.volume.throughputMBpsPerMonth;
  }

  if (volume.snapshots && volume.snapshots.length > 0) {
    const totalSnapshotGB = volume.snapshots.reduce((sum, snap) => sum + snap.sizeGB, 0);
    cost += totalSnapshotGB * pricing.volume.snapshotGBPerMonth;
  }

  return Math.round(cost * 100) / 100;
}

export function calculateDBCost(db, pricing) {
  let cost = 0;

  if (db.vcpus) {
    cost += db.vcpus * pricing.db.vCPUPerMonth;
  }

  cost += db.ramGB * pricing.db.ramGBPerMonth;

  if (db.storageGB) {
    cost += db.storageGB * pricing.db.storageGBPerMonth;
  }

  if (db.ha) {
    cost *= pricing.db.haMultiplier;
  }

  return Math.round(cost * 100) / 100;
}

export function calculateK8sCost(cluster, pricing, presets) {
  let cost = pricing.k8s.controlPlaneSmallPerMonth;

  if (cluster.controlPlane && cluster.controlPlane.ha) {
    cost += pricing.k8s.controlPlaneHAAddOnPerMonth;
  }

  if (cluster.nodePools && cluster.nodePools.length > 0) {
    cluster.nodePools.forEach(pool => {
      const preset = presets.find(p => p.id === pool.presetId);
      if (preset) {
        const nodeVM = {
          custom: {
            vcpus: preset.vcpus,
            ramGB: preset.ramGB,
            systemDiskGB: preset.systemDiskGB,
          },
          ips: [],
          gpus: [],
        };
        const nodeCost = calculateVMCost(nodeVM, pricing);
        cost += nodeCost * pool.count;
      }
    });
  }

  return Math.round(cost * 100) / 100;
}

export function calculateObjectStorageCost(bucket, pricing) {
  const storageGB = bucket.bytesUsed / (1024 * 1024 * 1024);
  const storageClass = bucket.storageClass === 'STANDARD' ? 'standardGBPerMonth' : 'infrequentAccessGBPerMonth';

  let cost = storageGB * pricing.objectStorage[storageClass];
  cost += (bucket.requestsLast30d / 1000000) * pricing.objectStorage.requestsPerMillion;
  cost += bucket.egressGBLast30d * pricing.objectStorage.egressPerGB;

  return Math.round(cost * 100) / 100;
}

export function calculateLoadBalancerCost(lb, pricing) {
  const hourlyRate = lb.type === 'L7' ? pricing.loadBalancer.l7PerHour : pricing.loadBalancer.l4PerHour;
  let cost = hourlyRate * 24 * 30;

  return Math.round(cost * 100) / 100;
}

export function calculateTotalMonthlyCost(data, pricing, presets) {
  let total = 0;

  if (data.vms) {
    data.vms.forEach(vm => {
      const preset = vm.presetId ? presets.vm.find(p => p.id === vm.presetId) : null;
      total += calculateVMCost(vm, pricing, preset);
    });
  }

  if (data.volumes) {
    data.volumes.forEach(vol => {
      total += calculateVolumeCost(vol, pricing);
    });
  }

  if (data.dbInstances) {
    data.dbInstances.forEach(db => {
      total += calculateDBCost(db, pricing);
    });
  }

  if (data.kubernetes) {
    data.kubernetes.forEach(cluster => {
      total += calculateK8sCost(cluster, pricing, presets.k8sNode);
    });
  }

  if (data.buckets) {
    data.buckets.forEach(bucket => {
      total += calculateObjectStorageCost(bucket, pricing);
    });
  }

  if (data.loadBalancers) {
    data.loadBalancers.forEach(lb => {
      total += calculateLoadBalancerCost(lb, pricing);
    });
  }

  if (data.ips) {
    const allocatedIPv4 = data.ips.filter(ip => ip.version === 4 && ip.assignedTo).length;
    total += allocatedIPv4 * pricing.ip.elasticIPv4PerMonth;
  }

  if (data.dnsZones) {
    data.dnsZones.forEach(zone => {
      total += pricing.dns.zonePerMonth;
      if (zone.records) {
        total += zone.records.length * pricing.dns.recordPerMonth;
      }
    });
  }

  return Math.round(total * 100) / 100;
}
