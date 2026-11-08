import { db } from '../db';
import { defineCollection, route, ApiError, validate, nameError, uniqueNameError, scopeFor, newId, nowIso, getOr404, detachEverywhere, notify, audit, type Ctx } from '../framework';
import { startOperation, onOperationComplete, transition, type StepSpec } from '../operations';
import { registerMetrics } from '../metrics';
import { vmCost } from '@/lib/pricing';
import {
  pickHost, checkHostFits, rankHosts, locationOrThrow, checkQuota, checkRequiredTags, checkLocationAllowed, allocateIp, defaultPool, assignIp, unassignIp,
  setFirewalls, attachVolume, detachVolume, nextPrivateIp, hostAllocation, hostCapacity,
} from './shared';
import type { VM, VmPreset, Image, Network, Volume, IpAddress, BareMetalHost, Snapshot, Location, PlacementCandidate } from '@/types';

/* Virtual machines — the reference implementation for a fully featured resource. */

const ms = (n: number) => n * 1000;

export function vmMonthlyCost(vm: VM): number {
  const loc = db.get<Location>('locations', vm.locationId);
  const vols = vm.volumeIds.map((id) => db.get<Volume>('volumes', id)).filter(Boolean) as Volume[];
  // Stopped VMs keep paying for storage & IPs only
  if (vm.status === 'stopped') {
    return vmCost({ vcpus: 0, ramGB: 0, systemDiskGB: vm.size.systemDiskGB, publicIpv4: vm.ipIds.length, volumes: vols }).total;
  }
  return vmCost({
    vcpus: vm.size.vcpus, ramGB: vm.size.ramGB, systemDiskGB: vm.size.systemDiskGB, gpu: vm.gpu, publicIpv4: vm.ipIds.length,
    backups: vm.backups.enabled, cloud: loc?.kind === 'cloud', volumes: vols,
  }).total;
}

function resolveSize(body: any): { presetId: string | null; vcpus: number; ramGB: number; systemDiskGB: number; gpu: VM['gpu'] } {
  if (body.presetId) {
    const p = db.get<VmPreset>('vmPresets', body.presetId);
    if (!p) throw new ApiError(422, 'Unknown size preset', 'validation_failed', { presetId: 'Unknown preset' });
    return { presetId: p.id, vcpus: p.vcpus, ramGB: p.ramGB, systemDiskGB: Math.max(p.systemDiskGB, body.systemDiskGB ?? 0), gpu: body.gpu === undefined ? p.gpu ?? null : body.gpu };
  }
  const { vcpus, ramGB, systemDiskGB } = body;
  validate({
    vcpus: !(Number.isInteger(vcpus) && vcpus >= 1 && vcpus <= 128) && 'vCPUs must be between 1 and 128',
    ramGB: !(Number.isFinite(ramGB) && ramGB >= 1 && ramGB <= 1024) && 'RAM must be between 1 and 1024 GB',
    systemDiskGB: !(Number.isFinite(systemDiskGB) && systemDiskGB >= 10 && systemDiskGB <= 4096) && 'System disk must be 10–4096 GB',
  });
  return { presetId: null, vcpus, ramGB, systemDiskGB, gpu: body.gpu ?? null };
}

function provisionSteps(vm: VM, host: BareMetalHost | null, loc: Location, newVolumes: number, ip: string | null): StepSpec[] {
  const img = db.get<Image>('images', vm.imageId);
  const steps: StepSpec[] = [
    { name: 'Validate request & reserve quota', ms: ms(0.8), logs: [`project ${vm.projectId}: quota ok`, `policy checks passed (tags, location)`] },
  ];
  if (host) {
    steps.push({ name: `Schedule on ${host.name}`, ms: ms(1.2), logs: [`scoring ${db.filter<BareMetalHost>('hosts', (h) => h.locationId === loc.id && h.status === 'ready').length} candidate hosts`, `selected ${host.name} (most free memory)`, `reserving ${vm.size.vcpus} vCPU / ${vm.size.ramGB} GiB${vm.gpu ? ` / ${vm.gpu.count}× ${vm.gpu.model} (VFIO passthrough)` : ''}`] });
  } else {
    steps.push({ name: `Request capacity from ${loc.name}`, ms: ms(2.2), logs: [`POST provider API /servers (region ${loc.region})`, 'server accepted, waiting for allocation…', 'server allocated'] });
  }
  steps.push(
    { name: `Clone image ${img?.name ?? vm.imageId}`, ms: ms(1.6), logs: [`fetching ${img?.sizeGB ?? 2} GB image from local cache`, `copy-on-write clone → system disk ${vm.size.systemDiskGB} GB`, 'resizing filesystem'] },
  );
  if (vm.volumeIds.length) steps.push({ name: `Attach ${vm.volumeIds.length} volume${vm.volumeIds.length > 1 ? 's' : ''}`, ms: ms(1), logs: [newVolumes ? `creating ${newVolumes} new volume(s) on ceph pool` : 'volumes ready', ...vm.volumeIds.map((v, i) => `attached ${v} as /dev/vd${String.fromCharCode(98 + i)}`)] });
  steps.push(
    { name: 'Configure network', ms: ms(1.2), logs: [`VXLAN segment for ${vm.networkId}`, `DHCP lease ${vm.privateIp}`, ...(ip ? [`NAT 1:1 ${ip} → ${vm.privateIp}`] : []), ...(vm.ipv6 ? ['IPv6 SLAAC enabled'] : [])] },
    { name: 'Apply firewall rules', ms: ms(0.6), logs: [`${vm.firewallIds.length} firewall(s) compiled to nftables`, 'default inbound: deny'] },
    { name: 'Boot & run cloud-init', ms: ms(2.4), logs: ['virtio boot, UEFI', 'kernel up', 'cloud-init: writing ssh keys', vm.initScript ? 'cloud-init: running user-data' : 'cloud-init: no user-data', 'cloud-init finished'] },
    { name: 'Health check', ms: ms(0.8), logs: ['qemu-guest-agent responding', 'ssh port open', 'VM is running'] },
  );
  return steps;
}

export function createVm(ctx: Ctx, body: any): VM {
  const sc = scopeFor(ctx, body);
  const size = resolveSize(body);
  const loc = locationOrThrow(body.locationId);
  const image = db.get<Image>('images', body.imageId);
  const net = db.get<Network>('networks', body.networkId);
  validate({
    name: nameError(body.name) || uniqueNameError('vms', body.name, sc),
    imageId: !image ? 'Choose an image' : image.status === 'deprecated' && !body.allowDeprecated ? `${image.name} is deprecated` : image.minDiskGB > size.systemDiskGB && `Image needs at least ${image.minDiskGB} GB disk`,
    networkId: !net ? 'Choose a network' : net.projectId !== sc.projectId ? 'Network belongs to another project' : net.locationId !== loc.id && `Network ${net.name} is in ${net.locationId}; pick a network in ${loc.id}`,
    subnetId: net && !net.subnets.some((s) => s.id === body.subnetId) && 'Choose a subnet',
    sshKeyIds: image?.os !== 'windows' && !(body.sshKeyIds?.length) && 'Add at least one SSH key',
  });
  checkLocationAllowed(sc.projectId, loc.id);
  if (loc.kind === 'cloud' && loc.providerId) {
    const prov = db.get<any>('providers', loc.providerId);
    if (prov && prov.status !== 'connected') throw new ApiError(409, `${prov.name} is ${prov.status === 'error' ? 'failing' : prov.status}${prov.lastError ? ` (${prov.lastError})` : ''}. Fix the provider connection or choose another location.`, 'provider_unavailable', { locationId: `${prov.name} is ${prov.status}` });
    if (prov?.quotas) {
      const used = db.filter<VM>('vms', (v) => db.get<Location>('locations', v.locationId)?.providerId === prov.id);
      if (used.length + 1 > prov.quotas.vms || used.reduce((a, v) => a + v.size.vcpus, 0) + size.vcpus > prov.quotas.vcpus) {
        throw new ApiError(409, `Provider quota exceeded at ${prov.name} (${used.length}/${prov.quotas.vms} VMs). Raise the quota under Cloud Providers.`, 'provider_quota');
      }
    }
  }
  checkRequiredTags(sc.projectId, body.tags);
  const newVols: any[] = body.volumes ?? [];
  checkQuota(sc.projectId, { vcpus: size.vcpus, ramGB: size.ramGB, vms: 1, publicIps: body.publicIp === 'new' ? 1 : 0, volumesGB: newVols.reduce((a, v) => a + (v.sizeGB ?? 0), 0) });

  let host: BareMetalHost | null = null;
  if (loc.kind === 'selfHosted') {
    const need = { vcpus: size.vcpus, ramGB: size.ramGB, gpus: size.gpu?.count ?? 0, gpuModel: size.gpu?.model };
    host = body.hostId ? checkHostFits(body.hostId, loc.id, need) : pickHost(loc.id, need);
  }

  const id = newId('vm');
  const vm: VM = {
    id, name: body.name, ...sc, status: 'provisioning', size: { presetId: size.presetId, vcpus: size.vcpus, ramGB: size.ramGB, systemDiskGB: size.systemDiskGB }, gpu: size.gpu,
    imageId: image!.id, locationId: loc.id, hostId: host?.id ?? null, networkId: net!.id, subnetId: body.subnetId, privateIp: nextPrivateIp(net!.id, body.subnetId),
    ipIds: [], ipv6: !!body.ipv6, sshKeyIds: body.sshKeyIds ?? [], volumeIds: [], firewallIds: [],
    backups: { enabled: !!body.backups?.enabled, schedule: body.backups?.schedule ?? 'daily', retention: body.backups?.retention ?? 7, window: body.backups?.window ?? '02:00-04:00' },
    initScript: body.initScript ?? '', deletionProtection: !!body.deletionProtection, createdAt: nowIso(), tags: body.tags ?? [],
  };
  return vm;
}

function afterCreateVm(ctx: Ctx, vm: VM, body: any) {
  const loc = db.get<Location>('locations', vm.locationId)!;
  const host = vm.hostId ? db.get<BareMetalHost>('hosts', vm.hostId) ?? null : null;
  // public IP
  let ipAddr: string | null = null;
  if (body.publicIp === 'new') {
    const pool = defaultPool(vm.locationId, 4);
    if (pool) { const ip = allocateIp(pool.id, { accountId: vm.accountId, projectId: vm.projectId }, null, `${vm.name}-ip`); assignIp(ip.id, { type: 'vm', id: vm.id }); ipAddr = ip.address }
  } else if (body.publicIp && body.publicIp !== 'none') {
    assignIp(body.publicIp, { type: 'vm', id: vm.id });
    ipAddr = db.get<IpAddress>('ips', body.publicIp)?.address ?? null;
  }
  // volumes
  const newVols: any[] = body.volumes ?? [];
  newVols.forEach((v, i) => {
    const vol: Volume = {
      id: newId('vol'), name: v.name || `${vm.name}-data${i ? `-${i + 1}` : ''}`, accountId: vm.accountId, projectId: vm.projectId, type: v.type ?? 'ssd', sizeGB: v.sizeGB ?? 100, usedGB: 0,
      iops: v.iops ?? 3000, throughputMBps: v.throughputMBps ?? 125, locationId: vm.locationId, status: 'attaching', attachedTo: null, filesystem: 'ext4', encrypted: true,
      backupPolicy: { enabled: false, schedule: 'daily', retention: 7 }, createdAt: nowIso(), tags: vm.tags,
    };
    db.insert('volumes', vol as any);
    attachVolume(vol.id, vm.id);
  });
  for (const volId of body.attachVolumeIds ?? []) attachVolume(volId, vm.id);
  if (body.firewallIds?.length) setFirewalls({ type: 'vm', id: vm.id }, body.firewallIds);

  const fresh = db.get<VM>('vms', vm.id)!;
  startOperation({
    type: 'vm.create', title: `Provision VM ${vm.name}`, target: { type: 'vm', id: vm.id, name: vm.name },
    steps: provisionSteps(fresh, host, loc, newVols.length, ipAddr), scope: { accountId: vm.accountId, projectId: vm.projectId }, actor: ctx.actor,
    onComplete: 'vm.provisioned', onFail: 'vm.provisionFailed', payload: { id: vm.id },
    ...(vm.name.includes('fail') ? { failAtStep: 1, failMessage: 'Hypervisor rejected allocation: NUMA node out of hugepages' } : {}),
  });
}

onOperationComplete('vm.provisioned', (_op, p: { id: string }) => {
  const vm = db.get<VM>('vms', p.id);
  if (!vm) return;
  db.update('vms', p.id, { status: 'running', lastStartedAt: nowIso() } as any);
  for (const v of vm.volumeIds) if (db.get('volumes', v)) db.update('volumes', v, { status: 'in-use' } as any);
});
onOperationComplete('vm.provisionFailed', (_op, p: { id: string }) => {
  if (db.get('vms', p.id)) db.update('vms', p.id, { status: 'error' } as any);
});
onOperationComplete('vm.state', (_op, p: { id: string; status: VM['status']; patch?: Partial<VM> }) => {
  if (db.get('vms', p.id)) db.update('vms', p.id, { status: p.status, ...(p.status === 'running' ? { lastStartedAt: nowIso() } : {}), ...(p.patch ?? {}) } as any);
});
onOperationComplete('vm.deleted', (_op, p: { id: string; deleteVolumes: boolean; releaseIps: boolean }) => {
  const vm = db.get<VM>('vms', p.id);
  if (!vm) return;
  for (const volId of vm.volumeIds) {
    if (p.deleteVolumes) db.remove('volumes', volId);
    else detachVolume(volId);
  }
  for (const ipId of vm.ipIds) {
    if (p.releaseIps) db.remove('ips', ipId);
    else unassignIp(ipId);
  }
  detachEverywhere('vm', vm.id);
  for (const s of db.filter<Snapshot>('snapshots', (s) => s.sourceId === vm.id)) db.update('snapshots', s.id, { description: `Source VM ${vm.name} was deleted` } as any);
  db.remove('vms', vm.id);
});
onOperationComplete('snapshot.ready', (_op, p: { id: string }) => {
  if (db.get('snapshots', p.id)) db.update('snapshots', p.id, { status: 'available' } as any);
});

function vmOp(ctx: Ctx, vm: VM, type: string, title: string, during: VM['status'], steps: StepSpec[], final: VM['status'], patch?: Partial<VM>) {
  return transition({
    collection: 'vms', id: vm.id, kind: 'vm', name: vm.name, type, title, during: { status: during }, steps,
    onComplete: 'vm.state', payload: { id: vm.id, status: final, patch }, scope: { accountId: vm.accountId, projectId: vm.projectId }, actor: ctx.actor,
  });
}

function requireStatus(vm: VM, allowed: VM['status'][], verb: string) {
  if (!allowed.includes(vm.status)) throw new ApiError(409, `Cannot ${verb} a VM that is ${vm.status}`, 'invalid_state');
}

/** Dry-run placement: which host would the scheduler pick, and how would it look afterwards? */
function placementPreview(q: URLSearchParams) {
  const locationId = q.get('locationId') ?? '';
  const loc = db.get<Location>('locations', locationId);
  if (!loc) throw new ApiError(422, 'Unknown location', 'validation_failed');
  const need = { vcpus: Number(q.get('vcpus') ?? 1), ramGB: Number(q.get('ramGB') ?? 1), gpus: Number(q.get('gpus') ?? 0), gpuModel: q.get('gpuModel') || undefined };
  if (loc.kind === 'cloud') {
    const prov = loc.providerId ? db.get<any>('providers', loc.providerId) : null;
    return { kind: 'cloud', location: { id: loc.id, name: loc.name, city: loc.city, country: loc.country }, provider: prov ? { id: prov.id, name: prov.name, status: prov.status } : null, need };
  }
  const ranked = rankHosts(loc.id, need);
  const pinned = q.get('hostId');
  const chosen = pinned ? ranked.find((c) => c.host.id === pinned) : ranked.find((c) => c.fits);
  const view = (c: (typeof ranked)[number]) => ({
    id: c.host.id, name: c.host.name, rack: c.host.rack, rackUnit: c.host.rackUnit, model: `${c.host.vendor} ${c.host.model}`, status: c.host.status,
    gpus: c.host.gpus, fits: c.fits, reason: c.reason, capacity: c.cap, used: c.used,
    free: { vcpus: c.cap.vcpus - c.used.vcpus, ramGB: c.cap.ramGB - c.used.ramGB, gpus: c.cap.gpus - c.used.gpus },
  });
  const why = !chosen ? null : pinned ? 'Pinned by you'
    : need.gpus > 0 ? `Has ${chosen.cap.gpus - chosen.used.gpus} free GPU${chosen.cap.gpus - chosen.used.gpus === 1 ? '' : 's'} and the most free memory`
    : chosen.cap.gpus === 0 && ranked.some((c) => c.fits && c.cap.gpus > 0) ? 'Most free memory (GPU hosts are kept free for GPU workloads)'
    : 'Most free memory among hosts that fit';
  return { kind: 'selfHosted', location: { id: loc.id, name: loc.name, city: loc.city, country: loc.country }, need, mode: pinned ? 'manual' : 'auto', chosen: chosen ? view(chosen) : null, why, candidates: ranked.map(view) };
}

export function registerVms() {
  route('GET', '/vms/placement-preview', (ctx) => placementPreview(ctx.query), 'Dry-run scheduler: which host a VM of a given size would be placed on (?locationId&vcpus&ramGB&gpus&gpuModel&hostId)');

  defineCollection<VM>({
    name: 'vms', kind: 'vm', idPrefix: 'vm',
    searchText: (v) => {
      const ips = v.ipIds.map((id) => db.get<IpAddress>('ips', id)?.address ?? '').join(' ');
      return `${v.id} ${v.name} ${v.privateIp} ${ips} ${v.tags.map((t) => `${t.key}:${t.value}`).join(' ')} ${v.status}`;
    },
    subtitle: (v) => `VM · ${v.size.vcpus} vCPU / ${v.size.ramGB} GB · ${v.status}`,
    decorate: (v) => ({ ...v, monthlyCost: vmMonthlyCost(v) }),
    create: createVm,
    afterCreate: (ctx, vm) => afterCreateVm(ctx, vm, ctx.body),
    update: (_ctx, vm, patch) => {
      const allowed: (keyof VM)[] = ['name', 'tags', 'deletionProtection', 'backups', 'sshKeyIds', 'initScript', 'ipv6'];
      const next: any = { ...vm };
      for (const k of allowed) if (k in patch) next[k] = patch[k];
      if ('name' in patch) validate({ name: nameError(patch.name) || uniqueNameError('vms', patch.name, vm, vm.id) });
      if ('tags' in patch) checkRequiredTags(vm.projectId, patch.tags);
      return next;
    },
    remove: (ctx, vm) => {
      if (vm.deletionProtection) throw new ApiError(409, 'Deletion protection is enabled for this VM. Disable it in Settings first.', 'protected');
      if (vm.status === 'deleting') throw new ApiError(409, 'VM is already being deleted', 'invalid_state');
      const deleteVolumes = ctx.query.get('deleteVolumes') === 'true';
      const releaseIps = ctx.query.get('releaseIps') === 'true';
      transition({
        collection: 'vms', id: vm.id, kind: 'vm', name: vm.name, type: 'vm.delete', title: `Delete VM ${vm.name}`, during: { status: 'deleting' },
        steps: [
          { name: 'Graceful shutdown', ms: ms(1.2), logs: ['ACPI shutdown sent', 'guest powered off'] },
          { name: deleteVolumes ? 'Delete volumes' : 'Detach volumes', ms: ms(0.8), logs: vm.volumeIds.map((v) => `${deleteVolumes ? 'deleted' : 'detached'} ${v}`) },
          { name: releaseIps ? 'Release public IPs' : 'Unassign public IPs', ms: ms(0.5) },
          { name: 'Free hypervisor resources', ms: ms(0.8), logs: vm.hostId ? [`released capacity on ${vm.hostId}`] : ['provider server deleted'] },
        ],
        onComplete: 'vm.deleted', payload: { id: vm.id, deleteVolumes, releaseIps }, scope: { accountId: vm.accountId, projectId: vm.projectId }, actor: ctx.actor, silent: false,
      });
      return 'async';
    },
    actions: {
      start: (ctx, vm) => {
        requireStatus(vm, ['stopped', 'error'], 'start');
        vmOp(ctx, vm, 'vm.start', `Start ${vm.name}`, 'starting', [{ name: 'Power on', ms: ms(1), logs: ['qemu process started'] }, { name: 'Boot OS', ms: ms(2), logs: ['kernel up', 'systemd reached multi-user.target'] }, { name: 'Guest agent check', ms: ms(0.6) }], 'running');
      },
      stop: (ctx, vm) => {
        requireStatus(vm, ['running'], 'stop');
        vmOp(ctx, vm, 'vm.stop', `Stop ${vm.name}`, 'stopping', [{ name: 'ACPI shutdown', ms: ms(1.5), logs: ['sent ACPI power button event', 'services stopping'] }, { name: 'Power off', ms: ms(0.8), logs: ['guest powered off'] }], 'stopped');
      },
      forceStop: (ctx, vm) => {
        requireStatus(vm, ['running', 'starting', 'stopping', 'rebooting', 'error'], 'force-stop');
        vmOp(ctx, vm, 'vm.forceStop', `Force stop ${vm.name}`, 'stopping', [{ name: 'Kill qemu process', ms: ms(0.5), logs: ['SIGKILL sent'] }], 'stopped');
      },
      reboot: (ctx, vm) => {
        requireStatus(vm, ['running'], 'reboot');
        vmOp(ctx, vm, 'vm.reboot', `Reboot ${vm.name}`, 'rebooting', [{ name: 'Soft reboot', ms: ms(1.2) }, { name: 'Boot OS', ms: ms(2) }, { name: 'Guest agent check', ms: ms(0.5) }], 'running');
      },
      resize: (ctx, vm, body) => {
        requireStatus(vm, ['running', 'stopped'], 'resize');
        const size = resolveSize({ ...body, systemDiskGB: body.systemDiskGB ?? vm.size.systemDiskGB });
        // "CPU and RAM only": keep the current disk so the VM can be downgraded again later
        if (body.keepDisk) size.systemDiskGB = vm.size.systemDiskGB;
        if (size.systemDiskGB < vm.size.systemDiskGB) throw new ApiError(422, 'System disk can only grow', 'validation_failed', { systemDiskGB: 'Cannot shrink disk' });
        checkQuota(vm.projectId, { vcpus: size.vcpus - vm.size.vcpus, ramGB: size.ramGB - vm.size.ramGB });
        if (vm.hostId) {
          const host = db.get<BareMetalHost>('hosts', vm.hostId)!;
          const cap = hostCapacity(host); const used = hostAllocation(host.id);
          if (used.ramGB - vm.size.ramGB + size.ramGB > cap.ramGB || used.vcpus - vm.size.vcpus + size.vcpus > cap.vcpus) {
            throw new ApiError(409, `${host.name} lacks capacity for this size. Migrate the VM to another host first.`, 'insufficient_capacity');
          }
        }
        if (size.vcpus === vm.size.vcpus && size.ramGB === vm.size.ramGB && size.systemDiskGB === vm.size.systemDiskGB && size.presetId === vm.size.presetId && JSON.stringify(size.gpu ?? null) === JSON.stringify(vm.gpu ?? null)) {
          throw new ApiError(422, 'The VM already has this size', 'validation_failed');
        }
        const wasRunning = vm.status === 'running';
        vmOp(ctx, vm, 'vm.resize', `Resize ${vm.name} to ${size.vcpus} vCPU / ${size.ramGB} GB`, 'resizing', [
          ...(wasRunning ? [{ name: 'Shutdown', ms: ms(1.2) }] : []),
          { name: 'Update domain definition', ms: ms(0.8), logs: [`vcpus ${vm.size.vcpus} → ${size.vcpus}`, `memory ${vm.size.ramGB} → ${size.ramGB} GiB`, ...(JSON.stringify(size.gpu ?? null) !== JSON.stringify(vm.gpu ?? null) ? [`gpu ${vm.gpu ? `${vm.gpu.count}× ${vm.gpu.model}` : 'none'} → ${size.gpu ? `${size.gpu.count}× ${size.gpu.model} (VFIO)` : 'none'}`] : [])] },
          ...(size.systemDiskGB > vm.size.systemDiskGB ? [{ name: `Grow disk to ${size.systemDiskGB} GB`, ms: ms(1) }] : []),
          ...(wasRunning ? [{ name: 'Boot', ms: ms(1.8) }] : []),
        ], wasRunning ? 'running' : 'stopped', { size: { presetId: size.presetId, vcpus: size.vcpus, ramGB: size.ramGB, systemDiskGB: size.systemDiskGB }, gpu: size.gpu ?? null });
      },
      migrate: (ctx, vm, body) => {
        requireStatus(vm, ['running', 'stopped'], 'migrate');
        if (!vm.hostId) throw new ApiError(409, 'Only VMs on self-hosted hardware can be migrated', 'invalid_state');
        const target = body.hostId ? getOr404<BareMetalHost>('hosts', body.hostId, 'Host') : pickHost(vm.locationId, { vcpus: vm.size.vcpus, ramGB: vm.size.ramGB, gpus: vm.gpu?.count ?? 0, gpuModel: vm.gpu?.model }, vm.hostId);
        if (target.id === vm.hostId) throw new ApiError(422, 'VM already runs on that host', 'validation_failed');
        if (target.locationId !== vm.locationId) throw new ApiError(422, 'Live migration is only possible within a location', 'validation_failed');
        const live = vm.status === 'running';
        const from = db.get<BareMetalHost>('hosts', vm.hostId)?.name ?? vm.hostId;
        vmOp(ctx, vm, 'vm.migrate', `${live ? 'Live-migrate' : 'Migrate'} ${vm.name} → ${target.name}`, 'migrating', [
          { name: 'Pre-flight checks', ms: ms(0.8), logs: [`source ${from}`, `target ${target.name}`, 'CPU flags compatible'] },
          ...(live ? [
            { name: 'Pre-copy memory', ms: ms(2.4), logs: [`copying ${vm.size.ramGB} GiB over 25 GbE`, 'iteration 1: 100% dirty', 'iteration 2: 6% dirty', 'iteration 3: 0.4% dirty'] },
            { name: 'Switch-over (pause < 50ms)', ms: ms(0.6), logs: ['vCPU paused', 'final dirty pages sent', 'resumed on target — downtime 31ms'] },
          ] : [{ name: 'Move domain definition', ms: ms(0.8) }]),
          { name: 'Update network & cleanup', ms: ms(0.6), logs: ['gratuitous ARP sent', 'source resources released'] },
        ], vm.status, { hostId: target.id });
        return { ok: true, hostId: target.id };
      },
      snapshot: (ctx, vm, body) => {
        requireStatus(vm, ['running', 'stopped'], 'snapshot');
        if (body.name) validate({ name: nameError(body.name) || uniqueNameError('snapshots', body.name, vm) });
        const snap: Snapshot = {
          id: newId('snap'), name: body.name || `${vm.name}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`, kind: 'vm', sourceId: vm.id, sourceName: vm.name,
          sizeGB: Math.max(2, Math.round(vm.size.systemDiskGB * 0.12)), status: 'creating', trigger: 'manual', locationId: vm.locationId, accountId: vm.accountId, projectId: vm.projectId,
          createdAt: nowIso(), tags: [], description: body.description, sourceSizeGB: vm.size.systemDiskGB,
        };
        db.insert('snapshots', snap as any);
        startOperation({
          type: 'snapshot.create', title: `Snapshot ${vm.name}`, target: { type: 'vm', id: vm.id, name: vm.name }, scope: { accountId: vm.accountId, projectId: vm.projectId }, actor: ctx.actor, silent: true,
          steps: [{ name: 'Freeze filesystem (guest agent)', ms: ms(0.6) }, { name: 'Create RBD snapshot', ms: ms(1.2) }, { name: 'Thaw & export', ms: ms(1.4) }],
          onComplete: 'snapshot.ready', payload: { id: snap.id },
        });
        return snap;
      },
      restore: (ctx, vm, body) => {
        requireStatus(vm, ['running', 'stopped', 'error'], 'restore');
        const snap = getOr404<Snapshot>('snapshots', body.snapshotId, 'Snapshot');
        if (snap.sourceId !== vm.id || snap.kind !== 'vm') throw new ApiError(422, 'Snapshot does not belong to this VM', 'validation_failed');
        if (snap.status !== 'available') throw new ApiError(409, `Snapshot is ${snap.status}`, 'invalid_state');
        const was = vm.status === 'running' ? 'running' : 'stopped';
        vmOp(ctx, vm, 'vm.restore', `Restore ${vm.name} from ${snap.name}`, 'restoring', [
          { name: 'Stop VM', ms: ms(1) }, { name: `Roll back disk to ${snap.name}`, ms: ms(2), logs: [`restoring ${snap.sizeGB} GB`] }, ...(was === 'running' ? [{ name: 'Boot', ms: ms(1.6) }] : []),
        ], was);
      },
      rebuild: (ctx, vm, body) => {
        requireStatus(vm, ['running', 'stopped', 'error'], 'rebuild');
        const img = getOr404<Image>('images', body.imageId, 'Image');
        if (img.status === 'creating') throw new ApiError(409, `${img.name} is still being built`, 'invalid_state');
        if (img.minDiskGB > vm.size.systemDiskGB) throw new ApiError(422, `${img.name} needs a ${img.minDiskGB} GB system disk (VM has ${vm.size.systemDiskGB} GB). Resize first.`, 'validation_failed', { imageId: 'Disk too small' });
        if (img.accountId && img.accountId !== vm.accountId) throw new ApiError(404, 'Image not found', 'not_found');
        if (body.sshKeyIds) db.update('vms', vm.id, { sshKeyIds: body.sshKeyIds } as any);
        vmOp(ctx, vm, 'vm.rebuild', `Rebuild ${vm.name} with ${img.name}`, 'provisioning', [
          { name: 'Stop VM', ms: ms(1) }, { name: `Re-image system disk`, ms: ms(2), logs: [`writing ${img.name}`] }, { name: 'Boot & cloud-init', ms: ms(2) },
        ], 'running', { imageId: img.id });
      },
      clone: (ctx, vm, body) => {
        const clone = createVm(ctx, {
          name: body.name, projectId: vm.projectId, presetId: vm.size.presetId, vcpus: vm.size.vcpus, ramGB: vm.size.ramGB, systemDiskGB: vm.size.systemDiskGB, gpu: vm.gpu,
          imageId: vm.imageId, locationId: vm.locationId, networkId: vm.networkId, subnetId: vm.subnetId, sshKeyIds: vm.sshKeyIds, tags: vm.tags, initScript: vm.initScript, backups: vm.backups,
        });
        db.insert('vms', clone as any);
        audit(ctx, 'vm.create', { type: 'vm', id: clone.id, name: clone.name }, { accountId: clone.accountId, projectId: clone.projectId, details: `clone of ${vm.name}` });
        afterCreateVm(ctx, clone, { firewallIds: vm.firewallIds, publicIp: body.publicIp ?? 'none' });
        return db.get('vms', clone.id);
      },
      attachVolume: (_ctx, vm, body) => { attachVolume(body.volumeId, vm.id) },
      detachVolume: (_ctx, vm, body) => {
        const vol = getOr404<Volume>('volumes', body.volumeId, 'Volume');
        if (vol.attachedTo?.vmId !== vm.id) throw new ApiError(409, 'Volume is not attached to this VM', 'conflict');
        detachVolume(vol.id);
      },
      assignIp: (_ctx, vm, body) => {
        if (body.ipId === 'new') {
          const pool = defaultPool(vm.locationId, body.version ?? 4);
          if (!pool) throw new ApiError(409, `No IPv${body.version ?? 4} pool in ${vm.locationId}`, 'conflict');
          checkQuota(vm.projectId, { publicIps: 1 });
          const ip = allocateIp(pool.id, { accountId: vm.accountId, projectId: vm.projectId }, null, `${vm.name}-ip`);
          assignIp(ip.id, { type: 'vm', id: vm.id });
          return ip;
        }
        assignIp(body.ipId, { type: 'vm', id: vm.id });
      },
      unassignIp: (_ctx, vm, body) => {
        if (!vm.ipIds.includes(body.ipId)) throw new ApiError(409, 'IP is not assigned to this VM', 'conflict');
        unassignIp(body.ipId);
      },
      setFirewalls: (_ctx, vm, body) => { setFirewalls({ type: 'vm', id: vm.id }, body.firewallIds ?? []) },
    },
  });

  /** Candidate hosts for (re)placement of a VM, with capacity and fit. */
  route('GET', '/vms/:id/placement', (ctx) => {
    const vm = getOr404<VM>('vms', ctx.params.id, 'VM');
    if (vm.accountId !== ctx.scope.accountId) throw new ApiError(404, 'VM not found', 'not_found');
    const hosts = db.filter<BareMetalHost>('hosts', (h) => h.locationId === vm.locationId && h.hypervisor === 'KVM');
    const items: PlacementCandidate[] = hosts.map((h) => {
      const cap = hostCapacity(h); const used = hostAllocation(h.id);
      const current = h.id === vm.hostId;
      const needCpu = current ? 0 : vm.size.vcpus, needRam = current ? 0 : vm.size.ramGB, needGpu = current ? 0 : vm.gpu?.count ?? 0;
      let reason: string | undefined;
      if (h.status !== 'ready') reason = `Host is ${h.status}`;
      else if (cap.vcpus - used.vcpus < needCpu) reason = `Only ${cap.vcpus - used.vcpus} vCPU free`;
      else if (cap.ramGB - used.ramGB < needRam) reason = `Only ${cap.ramGB - used.ramGB} GB RAM free`;
      else if (needGpu && (cap.gpus - used.gpus < needGpu || !h.gpus.some((g) => g.model === vm.gpu?.model))) reason = `No free ${vm.gpu?.model} GPU`;
      return {
        id: h.id, name: h.name, locationId: h.locationId, rack: h.rack, status: h.status, cpuModel: h.cpuModel,
        capacity: { vcpus: cap.vcpus, ramGB: cap.ramGB, gpus: cap.gpus }, allocated: { vcpus: used.vcpus, ramGB: used.ramGB, gpus: used.gpus, vms: used.vms },
        current, fits: !current && !reason, reason: current ? 'Current host' : reason,
      };
    }).sort((a, b) => Number(b.current) - Number(a.current) || Number(b.fits) - Number(a.fits) || (b.capacity.ramGB - b.allocated.ramGB) - (a.capacity.ramGB - a.allocated.ramGB));
    return { items, vm: { id: vm.id, vcpus: vm.size.vcpus, ramGB: vm.size.ramGB, gpus: vm.gpu?.count ?? 0 } };
  }, 'Placement candidates (hosts) for a VM');

  registerMetrics('vm', (vm: VM, metric) => {
    const off = vm.status !== 'running';
    const seedBias = (vm.id.charCodeAt(vm.id.length - 1) % 7) * 4;
    switch (metric) {
      case 'cpu': return { unit: '%', base: 22 + seedBias + (vm.gpu ? 25 : 0), amp: 18, max: 100, diurnal: 0.25, spikiness: 0.4, off };
      case 'ram': return { unit: '%', base: 48 + seedBias, amp: 6, max: 100, off };
      case 'diskRead': return { unit: 'MB/s', base: 12 + seedBias, amp: 10, spikiness: 0.5, off };
      case 'diskWrite': return { unit: 'MB/s', base: 8 + seedBias / 2, amp: 7, spikiness: 0.5, off };
      case 'netIn': return { unit: 'Mbit/s', base: 40 + seedBias * 5, amp: 30, diurnal: 0.4, off };
      case 'netOut': return { unit: 'Mbit/s', base: 70 + seedBias * 6, amp: 45, diurnal: 0.4, off };
      case 'gpu': return vm.gpu ? { unit: '%', base: 71, amp: 22, max: 100, off } : null;
      case 'gpuMem': return vm.gpu ? { unit: '%', base: 64, amp: 12, max: 100, off } : null;
      case 'gpuTemp': return vm.gpu ? { unit: '°C', base: off ? 0 : 68, amp: 8, max: 95, off } : null;
      case 'load': return { unit: '', base: vm.size.vcpus * (0.2 + seedBias / 60), amp: vm.size.vcpus * 0.15, spikiness: 0.4, diurnal: 0.25, off };
      case 'diskUsed': return { unit: '%', base: 26 + seedBias * 1.5, amp: 0.4, trend: 2.5, max: 100, off: false };
      case 'diskIops': return { unit: 'IOPS', base: 300 + seedBias * 40, amp: 240, spikiness: 0.5, off };
      default: return null;
    }
  });
}
void notify;
