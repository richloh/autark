import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Server, Rocket, Cpu, MemoryStick, HardDrive, Sparkles, Plus, Shield, KeyRound, FileCode2 } from 'lucide-react';
import { useList, useApiMutation } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Switch, OptionCards, Slider, NumberInput, TagEditor, MultiSelect, ListEditor, Textarea, Hint } from '@/components/ui/form';
import { FormSection, CreateLayout, fieldErrors } from '@/components/ui/FormLayout';
import { Segmented } from '@/components/ui/Tabs';
import { IacTabs, toCli, toHcl, toCurl } from '@/components/ui/CodeBlock';
import { CostPanel } from '@/components/resource/CostPanel';
import { PlacementPreview, usePlacement } from '@/components/compute/PlacementPreview';
import { ProjectField, LocationCards, NetworkSubnetFields, useFirewallOptions } from '@/components/resource/pickers';
import { OsBadge } from '@/lib/images';
import { vmCost } from '@/lib/pricing';
import { money } from '@/lib/format';
import { toast } from '@/components/ui/toast';
import { Advanced } from '@/components/ui/Pro';
import { useUi, usePro } from '@/store/ui';
import type { VmPreset, Image, SshKey, Location, IpAddress, Volume, ProjectAllowance, VolumeType, Network, Project } from '@/types';

const CLOUD_INIT_TEMPLATES: Record<string, string> = {
  none: '',
  nginx: '#cloud-config\npackage_update: true\npackages: [nginx]\nruncmd:\n  - systemctl enable --now nginx\n',
  docker: '#cloud-config\npackage_update: true\npackages: [docker.io, docker-compose-v2]\nruncmd:\n  - usermod -aG docker ubuntu\n  - systemctl enable --now docker\n',
  k3s: '#cloud-config\nruncmd:\n  - curl -sfL https://get.k3s.io | sh -\n',
  hardening: '#cloud-config\npackages: [fail2ban, unattended-upgrades]\nssh_pwauth: false\ndisable_root: true\n',
};

interface NewVol { name: string; type: VolumeType; sizeGB: number; iops: number }

export default function VmCreate() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const { items: presets } = useList<VmPreset>('vmPresets');
  const { items: images } = useList<Image>('images');
  const { items: sshKeys } = useList<SshKey>('sshKeys');
  const { items: locations } = useList<Location>('locations');
  const { items: ips } = useList<IpAddress>('ips');
  const { items: volumes } = useList<Volume>('volumes');
  const { items: networks, isLoading: netsLoading } = useList<Network>('networks');
  const { items: allProjects } = useList<Project>('projects');
  const { items: allowances } = useList<ProjectAllowance>('allowances');
  const accountId = useUi((s) => s.accountId);
  const scopedProject = useUi((s) => s.projectId);
  const pro = usePro();

  const [name, setName] = useState(sp.get('name') ?? '');
  const [count, setCount] = useState(1);
  const [projectId, setProjectId] = useState('');
  const [locationId, setLocationId] = useState(sp.get('location') ?? 'dc1');
  const [imageId, setImageId] = useState('img-ubuntu-2404');
  const [imageTab, setImageTab] = useState<'public' | 'custom'>('public');
  const [family, setFamily] = useState<'general' | 'compute' | 'memory' | 'gpu' | 'custom'>('general');
  const [presetId, setPresetId] = useState('vm-m4');
  const [custom, setCustom] = useState({ vcpus: 4, ramGB: 8 });
  const [placement, setPlacement] = useState<'auto' | 'manual'>('auto');
  const [hostId, setHostId] = useState('');
  const [advOpen, setAdvOpen] = useState(false);
  const [gpu, setGpu] = useState<{ model: string; count: number }>({ model: 'none', count: 0 });
  const [systemDiskGB, setSystemDiskGB] = useState(100);
  const [net, setNet] = useState({ networkId: sp.get('network') ?? '', subnetId: sp.get('subnet') ?? '' });
  const [publicIp, setPublicIp] = useState<'none' | 'new' | string>('new');
  const [ipv6, setIpv6] = useState(false);
  const [firewallIds, setFirewallIds] = useState<string[]>([]);
  const [sshKeyIds, setSshKeyIds] = useState<string[]>([]);
  const [initTemplate, setInitTemplate] = useState('none');
  const [initScript, setInitScript] = useState('');
  const [newVols, setNewVols] = useState<NewVol[]>([]);
  const [attachIds, setAttachIds] = useState<string[]>([]);
  const [backups, setBackups] = useState({ enabled: true, schedule: 'daily' as 'daily' | 'weekly', retention: 7 });
  const [protection, setProtection] = useState(false);
  const [tags, setTags] = useState<{ key: string; value: string }[]>([{ key: 'env', value: 'prod' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Implicit defaults (the pickers that normally set these may sit collapsed inside <Advanced>).
  // Declared before the deep-link effect so a ?network= link wins.
  const accountProjects = allProjects.filter((p) => p.accountId === accountId);
  useEffect(() => { if (!projectId && accountProjects.length) setProjectId(scopedProject || accountProjects[0].id) }, [projectId, accountProjects.length, scopedProject]); // eslint-disable-line
  const locNets = networks.filter((n) => n.projectId === projectId && n.locationId === locationId);
  useEffect(() => {
    if (netsLoading || !projectId) return;
    if (locNets.length && !locNets.some((n) => n.id === net.networkId)) setNet({ networkId: locNets[0].id, subnetId: locNets[0].subnets[0]?.id ?? '' });
    if (!locNets.length && net.networkId) setNet({ networkId: '', subnetId: '' });
  }, [locNets.map((n) => n.id).join(), net.networkId, netsLoading, projectId]); // eslint-disable-line
  // deep link from a network's "Attach resource": adopt that network's project & location
  const presetNet = sp.get('network');
  useEffect(() => {
    const n = networks.find((x) => x.id === presetNet);
    if (n) { setProjectId(n.projectId); setLocationId(n.locationId); setNet({ networkId: n.id, subnetId: sp.get('subnet') ?? '' }) }
  }, [presetNet, networks.length]); // eslint-disable-line
  const projectImplicit = !!scopedProject || accountProjects.length <= 1;

  const loc = locations.find((l) => l.id === locationId);
  const preset = presets.find((p) => p.id === presetId);
  const image = images.find((i) => i.id === imageId);
  const allowance = allowances.find((a) => a.projectId === projectId);
  const firewallOptions = useFirewallOptions(projectId);
  const projectKeys = sshKeys;

  // sensible defaults once data arrives
  useEffect(() => { if (!sshKeyIds.length && projectKeys.length) setSshKeyIds([projectKeys[0].id]) }, [projectKeys.length]); // eslint-disable-line
  useEffect(() => { if (preset && family !== 'custom') setSystemDiskGB((d) => Math.max(preset.systemDiskGB, image?.minDiskGB ?? 0, d === 100 ? preset.systemDiskGB : d)) }, [presetId]); // eslint-disable-line
  useEffect(() => { setFirewallIds([]); setPublicIp('new') }, [projectId]);
  useEffect(() => { setAttachIds([]) }, [locationId, projectId]);
  useEffect(() => { setHostId(''); setPlacement('auto') }, [locationId]);
  useEffect(() => { if (initTemplate !== 'custom') setInitScript(CLOUD_INIT_TEMPLATES[initTemplate] ?? '') }, [initTemplate]);

  const size = family === 'custom'
    ? { vcpus: custom.vcpus, ramGB: custom.ramGB, gpu: gpu.count > 0 && gpu.model !== 'none' ? gpu : null }
    : { vcpus: preset?.vcpus ?? 0, ramGB: preset?.ramGB ?? 0, gpu: preset?.gpu ?? null };

  const availableIps = ips.filter((i) => !i.assignedTo && i.projectId === projectId && i.version === 4);
  const attachable = volumes.filter((v) => v.status === 'available' && v.projectId === projectId && v.locationId === locationId);
  const familyPresets = presets.filter((p) => p.family === family);

  const cost = useMemo(() => vmCost({
    vcpus: size.vcpus, ramGB: size.ramGB, systemDiskGB, gpu: size.gpu, publicIpv4: publicIp === 'none' ? 0 : 1, backups: backups.enabled, cloud: loc?.kind === 'cloud',
    volumes: [...newVols.map((v) => ({ type: v.type, sizeGB: v.sizeGB, iops: v.iops })), ...attachable.filter((v) => attachIds.includes(v.id))],
  }), [size.vcpus, size.ramGB, systemDiskGB, size.gpu, publicIp, backups.enabled, loc?.kind, newVols, attachIds, attachable]);

  const body = {
    name, projectId, locationId, imageId,
    ...(family === 'custom' ? { vcpus: custom.vcpus, ramGB: custom.ramGB, gpu: size.gpu } : { presetId }),
    systemDiskGB, networkId: net.networkId, subnetId: net.subnetId, publicIp, ipv6, firewallIds, sshKeyIds,
    volumes: newVols, attachVolumeIds: attachIds, initScript, backups, deletionProtection: protection, tags,
    ...(placement === 'manual' && hostId && loc?.kind === 'selfHosted' ? { hostId } : {}),
  };

  const create = useApiMutation(async () => {
    setErrors({}); setFormError(null);
    const names = count === 1 ? [name] : Array.from({ length: count }, (_, i) => `${name}-${i + 1}`);
    const created = [];
    for (const n of names) created.push(await api.create<{ id: string }>('vms', { ...body, name: n, attachVolumeIds: n === names[0] ? attachIds : [], publicIp: n === names[0] || publicIp === 'new' || publicIp === 'none' ? publicIp : 'none' }));
    return created;
  }, {
    silent: true,
    onSuccess: (created) => {
      toast.success(created.length > 1 ? `Provisioning ${created.length} VMs` : `Provisioning ${name}`, 'Follow progress live on the detail page.');
      navigate(created.length > 1 ? '/infrastructure/vms' : `/infrastructure/vms/${created[0].id}`);
    },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); setFormError(e.message); window.scrollTo({ top: 0, behavior: 'smooth' }) },
  });

  const nameErr = name && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name) ? 'Lowercase letters, digits and dashes' : undefined;
  const { data: placementData } = usePlacement({ locationId, vcpus: size.vcpus, ramGB: size.ramGB, gpu: size.gpu, hostId: placement === 'manual' ? hostId : undefined });
  const placementBlocked = placementData?.kind === 'selfHosted' && (!placementData.chosen || !placementData.chosen.fits);
  const canSubmit = !!name && !nameErr && !!projectId && !!net.subnetId && (image?.os === 'windows' || sshKeyIds.length > 0) && !placementBlocked;

  const publicImages = images.filter((i) => i.kind === 'public' && i.status !== 'deprecated');
  const customImages = images.filter((i) => i.kind === 'custom');
  const quotaLeft = allowance ? allowance.quotas.vcpus : null;

  const requiredTags = allowance?.requiredTags ?? [];
  const isStandardFamily = family === 'general' || family === 'compute' || family === 'memory' || family === 'custom';
  const pickFamily = (f: typeof family) => { setFamily(f); const first = presets.find((p) => p.family === f); if (first) setPresetId(first.id) };
  const pickImage = (v: string) => { setImageId(v); const img = images.find((i) => i.id === v); if (img && systemDiskGB < img.minDiskGB) setSystemDiskGB(img.minDiskGB) };

  /* ------------------------------------------------------------ building blocks (shared by both modes) */

  const nameField = (
    <Field label="Name" required error={nameErr ?? errors.name} hint={count > 1 ? `Creates ${name || 'name'}-1 … ${name || 'name'}-${count}` : 'e.g. web-4, api-staging'}>
      <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="web-4" invalid={!!(nameErr ?? errors.name)} autoFocus={pro} />
    </Field>
  );
  const projectField = <ProjectField value={projectId} onChange={setProjectId} error={errors.projectId} />;
  const quantityField = <Field label="Quantity"><NumberInput value={count} onChange={setCount} min={1} max={10} /></Field>;
  const tagsField = (
    <Field label="Tags" error={errors.tags} hint={requiredTags.length ? `This project requires: ${requiredTags.join(', ')}` : undefined}>
      <TagEditor value={tags} onChange={setTags} required={allowance?.requiredTags} />
    </Field>
  );
  const sshField = (
    <Field label="SSH keys" required={image?.os !== 'windows'} error={errors.sshKeyIds} action={<Button size="xs" variant="ghost" icon={KeyRound} to="/infrastructure/ssh-keys">Manage</Button>}>
      <MultiSelect options={projectKeys.map((k) => ({ value: k.id, label: k.name, description: k.fingerprint }))} value={sshKeyIds} onChange={setSshKeyIds} placeholder="Select keys" />
    </Field>
  );
  const locationCards = (
    <>
      <LocationCards value={locationId} onChange={setLocationId} filter={(l) => !allowance || allowance.allowedLocations.includes(l.id) || l.id === locationId} />
      {errors.locationId && <p className="text-xs text-rose-500">{errors.locationId}</p>}
    </>
  );
  const imageCards = (
    <>
      <OptionCards cols={4} value={imageId} onChange={pickImage}
        options={(imageTab === 'public' ? publicImages : customImages).map((i) => ({ value: i.id, title: i.name, description: pro ? i.description : undefined, icon: <OsBadge os={i.os} size={24} /> }))} />
      {errors.imageId && <p className="text-xs text-rose-500">{errors.imageId}</p>}
    </>
  );
  const imageTabs = (pro || customImages.length > 0) && <Segmented size="sm" value={imageTab} onChange={setImageTab} options={[{ value: 'public', label: 'Public' }, { value: 'custom', label: `Custom (${customImages.length})` }]} />;
  const presetCards = (
    <OptionCards cols={4} value={presetId} onChange={setPresetId} options={familyPresets.map((p) => {
      const c = vmCost({ vcpus: p.vcpus, ramGB: p.ramGB, systemDiskGB: p.systemDiskGB, gpu: p.gpu, cloud: loc?.kind === 'cloud' }).total;
      return {
        value: p.id, title: p.name, description: pro ? p.description : `${p.systemDiskGB} GB disk`,
        meta: (
          <div className="flex items-center justify-between text-xs">
            <span className="flex gap-2 text-fg-2"><span className="flex items-center gap-0.5"><Cpu className="size-3" />{p.vcpus}</span><span className="flex items-center gap-0.5"><MemoryStick className="size-3" />{p.ramGB}G</span>{p.gpu && <span className="text-violet-500">{p.gpu.count}×{p.gpu.model}</span>}</span>
            <span className="font-medium tabular text-fg">{money(c)}</span>
          </div>
        ),
      };
    })} />
  );
  const coresAndMemory = (
    <div className="grid gap-5 @min-[36rem]:grid-cols-2">
      <Field label="vCPU cores" error={errors.vcpus} action={<NumberInput className="w-28" value={custom.vcpus} onChange={(v) => setCustom({ ...custom, vcpus: v })} min={1} max={64} />}>
        <Slider value={custom.vcpus} onChange={(v) => setCustom({ ...custom, vcpus: v })} min={1} max={64} marks={[1, 16, 32, 48, 64]} />
      </Field>
      <Field label="Memory (GB)" error={errors.ramGB} action={<NumberInput className="w-28" value={custom.ramGB} onChange={(v) => setCustom({ ...custom, ramGB: v })} min={1} max={512} />}>
        <Slider value={custom.ramGB} onChange={(v) => setCustom({ ...custom, ramGB: v })} min={1} max={512} step={1} marks={[1, 128, 256, 384, 512]} />
      </Field>
      <p className="text-xs text-muted @min-[36rem]:col-span-2">{(custom.ramGB / custom.vcpus).toFixed(custom.ramGB % custom.vcpus ? 1 : 0)} GB memory per core · {money(vmCost({ vcpus: custom.vcpus, ramGB: custom.ramGB, systemDiskGB, cloud: loc?.kind === 'cloud' }).total)}/mo incl. {systemDiskGB} GB disk</p>
    </div>
  );
  const customSize = (
    <div className="grid gap-5 @min-[36rem]:grid-cols-2">
      <div className="@min-[36rem]:col-span-2">{coresAndMemory}</div>
      <Field label="GPU" hint="Passed through via VFIO; requires a host with free GPUs.">
        <Select value={gpu.model} onChange={(e) => setGpu({ ...gpu, model: e.target.value, count: e.target.value === 'none' ? 0 : Math.max(1, gpu.count) })} options={[{ value: 'none', label: 'No GPU' }, { value: 'A6000', label: 'NVIDIA RTX A6000 (48 GB)' }, { value: 'L40S', label: 'NVIDIA L40S (48 GB)' }, { value: 'H100', label: 'NVIDIA H100 (80 GB)' }, { value: 'H200', label: 'NVIDIA H200 (141 GB)' }]} />
      </Field>
      {gpu.model !== 'none' && <Field label="GPU count"><NumberInput value={gpu.count} onChange={(v) => setGpu({ ...gpu, count: v })} min={1} max={8} /></Field>}
    </div>
  );
  const diskField = (
    <Field label={`System disk · ${systemDiskGB} GB`} error={errors.systemDiskGB} hint={image ? `${image.name} needs at least ${image.minDiskGB} GB` : undefined}>
      <Slider value={systemDiskGB} onChange={setSystemDiskGB} min={Math.max(10, image?.minDiskGB ?? 10)} max={1000} step={10} marks={[Math.max(10, image?.minDiskGB ?? 10), 250, 500, 1000]} format={(v) => `${v}`} />
    </Field>
  );
  const networking = (
    <>
      {projectId && <NetworkSubnetFields projectId={projectId} locationId={locationId} networkId={net.networkId} subnetId={net.subnetId} onChange={setNet} errors={errors} />}
      <Field label="Public IPv4">
        <Select value={publicIp} onChange={(e) => setPublicIp(e.target.value)} options={[
          { value: 'new', label: 'Allocate a new public IP (+€2/mo)' }, { value: 'none', label: 'No public IP (private only, egress via NAT)' },
          ...availableIps.map((i) => ({ value: i.id, label: `Use existing ${i.address}` })),
        ]} />
      </Field>
      <Switch checked={ipv6} onChange={setIpv6} label="Enable IPv6" description="Assign a /128 from the location's IPv6 pool (free)." />
      <Field label="Firewalls" hint="Rules from all selected firewalls are merged. Default inbound policy is deny." action={<Button size="xs" variant="ghost" icon={Plus} to="/infrastructure/firewalls/new">New</Button>}>
        <MultiSelect options={firewallOptions} value={firewallIds} onChange={setFirewallIds} placeholder="No firewall (all inbound blocked)" emptyText="No firewalls in this project" />
      </Field>
    </>
  );
  const storage = (
    <>
      <ListEditor
        items={newVols}
        onChange={setNewVols}
        addLabel="Add new volume"
        create={(): NewVol => ({ name: '', type: 'ssd', sizeGB: 100, iops: 3000 })}
        render={(v, update) => (
          <div className="grid gap-2 @min-[36rem]:grid-cols-[1fr_120px_140px_140px]">
            <Input value={v.name} onChange={(e) => update({ name: e.target.value })} placeholder={`${name || 'vm'}-data`} />
            <Select value={v.type} onChange={(e) => update({ type: e.target.value as VolumeType, iops: e.target.value === 'nvme' ? 10000 : e.target.value === 'hdd' ? 500 : 3000 })} options={[{ value: 'ssd', label: 'SSD' }, { value: 'nvme', label: 'NVMe' }, { value: 'hdd', label: 'HDD' }]} />
            <NumberInput value={v.sizeGB} onChange={(n) => update({ sizeGB: n })} min={10} max={16000} step={10} unit="GB" />
            <NumberInput value={v.iops} onChange={(n) => update({ iops: n })} min={100} max={50000} step={500} unit="IOPS" />
          </div>
        )}
      />
      {attachable.length > 0 && (
        <Field label="Attach existing volumes" hint="Only unattached volumes in the same project & location are listed.">
          <MultiSelect options={attachable.map((v) => ({ value: v.id, label: v.name, description: `${v.sizeGB} GB ${v.type.toUpperCase()}` }))} value={attachIds} onChange={setAttachIds} placeholder="None" />
        </Field>
      )}
      <div className="flex items-center gap-2 text-xs text-muted"><HardDrive className="size-3.5" /> Volumes are replicated 3× and encrypted at rest.</div>
    </>
  );
  const cloudInit = (
    <Field label="Cloud-init user data" optional action={
      <Select className="w-44" value={initTemplate} onChange={(e) => setInitTemplate(e.target.value)} options={[{ value: 'none', label: 'Template: none' }, { value: 'nginx', label: 'nginx web server' }, { value: 'docker', label: 'Docker engine' }, { value: 'k3s', label: 'k3s single node' }, { value: 'hardening', label: 'SSH hardening' }, { value: 'custom', label: 'Custom' }]} />
    }>
      <Textarea mono rows={6} value={initScript} onChange={(e) => { setInitScript(e.target.value); setInitTemplate('custom') }} placeholder={'#cloud-config\npackages: [htop]'} />
    </Field>
  );
  const backupsAndProtection = (
    <>
      <Switch checked={backups.enabled} onChange={(v) => setBackups({ ...backups, enabled: v })} label="Automated backups" description="Crash-consistent snapshots of all disks, kept off-host. Adds 20% to compute + disk cost." />
      {backups.enabled && (
        <div className="grid gap-4 @min-[36rem]:grid-cols-2">
          <Field label="Schedule"><Segmented value={backups.schedule} onChange={(v) => setBackups({ ...backups, schedule: v })} options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }]} /></Field>
          <Field label="Retention (copies)"><NumberInput value={backups.retention} onChange={(v) => setBackups({ ...backups, retention: v })} min={1} max={30} /></Field>
        </div>
      )}
      <Switch checked={protection} onChange={setProtection} label={<span className="flex items-center gap-1.5"><Shield className="size-3.5" /> Deletion protection</span>} description="Prevents accidental deletion via console, CLI or Terraform until disabled." />
    </>
  );

  const placementField = loc?.kind === 'selfHosted' ? (
    <PlacementOverride locationId={locationId} vcpus={size.vcpus} ramGB={size.ramGB} gpu={size.gpu} mode={placement} hostId={hostId}
      onMode={(m) => { setPlacement(m); if (m === 'auto') setHostId('') }} onHost={setHostId} />
  ) : <p className="text-[13px] text-muted">In cloud regions the provider picks the physical server.</p>;

  const submitHint = placementBlocked ? 'No host has room for this size' : !name ? 'Enter a name to continue' : nameErr ? 'Fix the name' : !net.subnetId ? (pro ? 'Pick a network & subnet' : 'No network in this location yet') : 'Add an SSH key';
  const advancedSummary = [
    placement === 'manual' && hostId ? 'pinned host' : null,
    `${publicIp === 'none' ? 'No public IP' : 'Public IPv4'}${ipv6 ? ' + IPv6' : ''}`,
    `${systemDiskGB} GB disk`,
    backups.enabled ? `${backups.schedule} backups` : 'no backups',
    firewallIds.length ? `${firewallIds.length} firewall${firewallIds.length > 1 ? 's' : ''}` : null,
    newVols.length + attachIds.length ? `${newVols.length + attachIds.length} volume(s)` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Page wide>
      <PageHeader
        title="Create virtual machine"
        description={pro ? 'Pick what you need — Autark places it on the best host, wires up networking and boots it.' : undefined}
        icon={Server}
        iconColor="#5b67f8"
        crumbs={[{ label: 'Virtual Machines', to: '/infrastructure/vms' }, { label: 'Create' }]}
      />
      {formError && <Hint tone="danger" className="mb-5">{formError}</Hint>}

      <CreateLayout aside={<>
        <CostPanel cost={cost} projectId={projectId} quantity={count} footer={
          <div className="space-y-2">
            <Button variant="primary" size="lg" className="w-full" icon={Rocket} loading={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()}>
              {count > 1 ? `Create ${count} VMs` : 'Create VM'}
            </Button>
            {!canSubmit && <p className="text-center text-[11px] text-muted">{submitHint}</p>}
          </div>
        }>
          <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs text-muted">
            <div className="flex justify-between gap-2"><span>Location</span><span className="truncate text-fg-2">{pro && loc?.kind === 'selfHosted' ? `${loc.name} · auto-scheduled` : loc?.name}</span></div>
            <div className="flex justify-between gap-2"><span>Image</span><span className="truncate text-fg-2">{image?.name}</span></div>
            <div className="flex justify-between gap-2"><span>Size</span><span className="truncate text-fg-2">{size.vcpus} vCPU · {size.ramGB} GB{size.gpu ? ` · ${size.gpu.count}× ${size.gpu.model}` : ''}</span></div>
          </div>
        </CostPanel>
        <PlacementPreview locationId={locationId} vcpus={size.vcpus} ramGB={size.ramGB} gpu={size.gpu} hostId={placement === 'manual' ? hostId : undefined}
          onChangeHost={() => { setPlacement('manual'); setAdvOpen(true); setTimeout(() => document.getElementById('placement-override')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80) }} />
        {pro && (
          <details className="group rounded-xl border border-line bg-surface p-4 shadow-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-fg"><FileCode2 className="size-4 text-muted" /> Infrastructure as code<span className="ml-auto text-xs text-muted group-open:hidden">show</span></summary>
            <IacTabs className="mt-3" snippets={{
              terraform: toHcl('vm', name || 'my_vm', body),
              cli: toCli('vm create', body),
              curl: toCurl('POST', '/vms', body),
            }} />
          </details>
        )}
      </>}>
        {pro ? (
          <>
            <FormSection step={1} title="Basics" description="Name, project and tags. Names are DNS-safe and unique per project.">
              <div className="grid gap-4 @min-[36rem]:grid-cols-[1fr_1fr_140px]">{nameField}{projectField}{quantityField}</div>
              {tagsField}
            </FormSection>
            <FormSection step={2} title="Location" description="Own data centers are cheapest. Cloud regions provide burst capacity at a markup." aside={allowance && <span className="text-xs text-muted">Allowed: {allowance.allowedLocations.join(', ')}</span>}>
              {locationCards}
              <div id="placement-override" className="border-t border-line pt-4"><h3 className="mb-3 text-[13px] font-semibold text-fg">Host placement</h3>{placementField}</div>
            </FormSection>
            <FormSection step={3} title="Image" description="Operating system for the system disk." aside={imageTabs}>{imageCards}</FormSection>
            <FormSection step={4} title="Size" description="Start from a preset or dial in exactly what you need." aside={quotaLeft != null && <span className="text-xs text-muted">Project quota: {quotaLeft} vCPU</span>}>
              <Segmented value={family} onChange={pickFamily} options={[
                { value: 'general', label: 'General' }, { value: 'compute', label: 'Compute' }, { value: 'memory', label: 'Memory' }, { value: 'gpu', label: 'GPU', icon: <Sparkles className="size-3.5" /> }, { value: 'custom', label: 'Custom' },
              ]} />
              {family !== 'custom' ? presetCards : customSize}
              {diskField}
            </FormSection>
            <FormSection step={5} title="Networking" description="Private network, public reachability and firewalls.">{networking}</FormSection>
            <FormSection step={6} title="Storage" description="Add data volumes now or attach existing ones. You can always change this later.">{storage}</FormSection>
            <FormSection step={7} title="Access & initialization" description="SSH keys are injected via cloud-init on first boot.">{sshField}{cloudInit}</FormSection>
            <FormSection step={8} title="Backups & protection">{backupsAndProtection}</FormSection>
          </>
        ) : (
          <>
            <FormSection step={1} title="Location">
              {locationCards}
              {!netsLoading && projectId && !locNets.length && (
                <Hint tone="warning">This location has no private network for your project yet. <Link to="/infrastructure/networks/new" className="font-medium underline">Create a network</Link> or pick another location.</Hint>
              )}
            </FormSection>
            <FormSection step={2} title="Image" aside={imageTabs}>{imageCards}</FormSection>
            <FormSection step={3} title="Size">
              {isStandardFamily ? (
                <>
                  <Segmented value={family} onChange={pickFamily} options={[{ value: 'general', label: 'General' }, { value: 'compute', label: 'CPU-optimized' }, { value: 'memory', label: 'Memory-optimized' }, { value: 'custom', label: 'Custom' }]} />
                  {family === 'custom' ? coresAndMemory : presetCards}
                </>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-3 text-sm">
                  <span className="text-fg-2">
                    {preset?.name}: <span className="font-medium text-fg">{size.vcpus} vCPU · {size.ramGB} GB{size.gpu ? ` · ${size.gpu.count}× ${size.gpu.model}` : ''}</span>
                    <span className="block text-xs text-muted">Set under Advanced options below.</span>
                  </span>
                  <Button size="sm" onClick={() => pickFamily('general')}>Use a standard size</Button>
                </div>
              )}
            </FormSection>
            <FormSection step={4} title="Name & access">
              <div className={projectImplicit ? '' : 'grid gap-4 @min-[36rem]:grid-cols-2'}>{nameField}{!projectImplicit && projectField}</div>
              {sshField}
              {requiredTags.length > 0 && tagsField}
            </FormSection>

            <Advanced description={advancedSummary} open={advOpen} onOpenChange={setAdvOpen}>
              <div className="grid gap-4 @min-[36rem]:grid-cols-[1fr_140px]">
                {projectImplicit ? projectField : <div />}
                {quantityField}
              </div>
              {requiredTags.length === 0 && tagsField}
              <AdvancedGroup title="GPU & system disk">
                <Segmented value={family === 'gpu' ? 'gpu' : family === 'custom' && size.gpu ? 'customGpu' : 'standard'} onChange={(f) => { if (f === 'standard') { pickFamily(family === 'gpu' ? 'general' : family); setGpu({ ...gpu, model: 'none', count: 0 }) } else if (f === 'gpu') pickFamily('gpu'); else { setFamily('custom'); setGpu({ model: 'A6000', count: 1 }) } }} options={[
                  { value: 'standard', label: 'No GPU' }, { value: 'gpu', label: 'GPU presets', icon: <Sparkles className="size-3.5" /> }, { value: 'customGpu', label: 'Custom + GPU' },
                ]} />
                {family === 'gpu' && presetCards}
                {family === 'custom' && size.gpu && customSize}
                {diskField}
              </AdvancedGroup>
              <div id="placement-override"><AdvancedGroup title="Placement">{placementField}</AdvancedGroup></div>
              <AdvancedGroup title="Networking">{networking}</AdvancedGroup>
              <AdvancedGroup title="Extra volumes">{storage}</AdvancedGroup>
              <AdvancedGroup title="Cloud-init">{cloudInit}</AdvancedGroup>
              <AdvancedGroup title="Backups & protection">{backupsAndProtection}</AdvancedGroup>
            </Advanced>
          </>
        )}
      </CreateLayout>
    </Page>
  );
}

function AdvancedGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-4 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
      {children}
    </div>
  );
}

/** Manual placement override: automatic scheduling or pin to a specific host (only hosts that fit are selectable). */
function PlacementOverride({ locationId, vcpus, ramGB, gpu, mode, hostId, onMode, onHost }: {
  locationId: string; vcpus: number; ramGB: number; gpu: { model: string; count: number } | null; mode: 'auto' | 'manual'; hostId: string;
  onMode: (m: 'auto' | 'manual') => void; onHost: (id: string) => void;
}) {
  const { data } = usePlacement({ locationId, vcpus, ramGB, gpu });
  const cands = data?.candidates ?? [];
  const auto = data?.chosen;
  useEffect(() => { if (mode === 'manual' && !hostId && auto) onHost(auto.id) }, [mode, hostId, auto?.id]); // eslint-disable-line
  return (
    <div className="space-y-3">
      <Segmented value={mode} onChange={onMode} options={[{ value: 'auto', label: 'Automatic (recommended)' }, { value: 'manual', label: 'Choose host' }]} />
      {mode === 'auto' ? (
        <p className="text-[13px] text-muted">Autark picks the host with the most free memory{auto ? <> — currently <span className="font-medium text-fg-2">{auto.name}</span></> : ''}. GPU hosts are kept free for GPU workloads.</p>
      ) : (
        <OptionCards cols={2} value={hostId} onChange={onHost} options={cands.map((c) => ({
          value: c.id, disabled: !c.fits,
          title: c.name,
          badge: c.id === auto?.id ? <span className="rounded bg-brand-500/10 px-1.5 text-[10px] font-medium text-brand-600 dark:text-brand-300">recommended</span> : undefined,
          description: c.fits ? `${c.free.vcpus} vCPU · ${c.free.ramGB} GB free${c.capacity.gpus ? ` · ${c.free.gpus}/${c.capacity.gpus} GPUs free` : ''}` : c.reason ?? 'Unavailable',
          meta: (
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-line-strong" style={{ width: `${Math.min(100, (c.used.ramGB / Math.max(1, c.capacity.ramGB)) * 100)}%` }} />
            </div>
          ),
        }))} />
      )}
    </div>
  );
}
