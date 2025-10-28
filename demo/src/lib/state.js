const STORAGE_KEY = 'autark.state';

export function getState() {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    console.error('Failed to load state:', e);
    return {};
  }
}

export function setState(updates) {
  if (typeof window === 'undefined') return;

  try {
    const current = getState();
    const newState = { ...current, ...updates };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));

    window.dispatchEvent(new CustomEvent('statechange', { detail: newState }));
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

export function mergeData(serverData) {
  if (typeof window === 'undefined') return serverData;

  const clientState = getState();

  return {
    ...serverData,
    data: {
      ...serverData.data,
      vms: mergeArray(serverData.data.vms, clientState.vms),
      volumes: mergeArray(serverData.data.volumes, clientState.volumes),
      networks: mergeArray(serverData.data.networks, clientState.networks),
      ips: mergeArray(serverData.data.ips, clientState.ips),
      firewalls: mergeArray(serverData.data.firewalls, clientState.firewalls),
      dnsZones: mergeArray(serverData.data.dnsZones, clientState.dnsZones),
      dbInstances: mergeArray(serverData.data.dbInstances, clientState.dbInstances),
      kubernetes: mergeArray(serverData.data.kubernetes, clientState.kubernetes),
      buckets: mergeArray(serverData.data.buckets, clientState.buckets),
      loadBalancers: mergeArray(serverData.data.loadBalancers, clientState.loadBalancers),
      bareMetals: mergeArray(serverData.data.bareMetals, clientState.bareMetals),
      providers: mergeArray(serverData.data.providers, clientState.providers),
      users: mergeArray(serverData.data.users, clientState.users),
      roles: mergeArray(serverData.data.roles, clientState.roles),
      systemAccounts: mergeArray(serverData.data.systemAccounts, clientState.systemAccounts),
      projectAllowances: mergeArray(serverData.data.projectAllowances, clientState.projectAllowances),
    },
    presets: {
      ...serverData.presets,
      vm: mergeArray(serverData.presets.vm, clientState.vmPresets),
      volume: mergeArray(serverData.presets.volume, clientState.volumePresets),
      db: mergeArray(serverData.presets.db, clientState.dbPresets),
      k8sNode: mergeArray(serverData.presets.k8sNode, clientState.k8sNodePresets),
    }
  };
}

function mergeArray(serverArray = [], clientArray = []) {
  if (!clientArray || clientArray.length === 0) return serverArray;

  const serverMap = new Map(serverArray.map(item => [item.id, item]));

  clientArray.forEach(item => {
    serverMap.set(item.id, item);
  });

  return Array.from(serverMap.values());
}

export function saveResource(type, resource) {
  const state = getState();
  const key = type === 'vm' || type === 'volume' || type === 'db' ? `${type}s` : type;
  const items = state[key] || [];

  const existingIndex = items.findIndex(item => item.id === resource.id);

  if (existingIndex >= 0) {
    items[existingIndex] = resource;
  } else {
    items.push(resource);
  }

  setState({ [key]: items });
}

export function deleteResource(type, id) {
  const state = getState();
  const key = type === 'vm' || type === 'volume' || type === 'db' ? `${type}s` : type;
  const items = state[key] || [];

  setState({ [key]: items.filter(item => item.id !== id) });
}
