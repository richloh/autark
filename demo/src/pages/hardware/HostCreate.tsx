import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Cpu, PlugZap, ScanSearch, Settings2, ClipboardCheck, ArrowLeft, ArrowRight, Rocket, KeyRound, Network, HardDrive, Gpu, MemoryStick, Zap, CheckCircle2, AlertTriangle, Pencil, Sparkles, Server, ExternalLink, Plus } from 'lucide-react';
import { useList, useApiMutation, useItem, useOperationsFor } from '@/api/hooks';
import { api, ApiClientError } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, KeyValue } from '@/components/ui/Card';
import { Field, Input, Select, NumberInput, OptionCards, TagEditor, ListEditor, Hint } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { Segmented } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { IacTabs, toCli, toHcl, toCurl } from '@/components/ui/CodeBlock';
import { OperationRunner } from '@/components/resource/OperationRunner';
import { Advanced, Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import { RackElevation } from '@/components/hardware/RackElevation';
import { StepIndicator, flag, SpecPill } from '@/components/hardware/visuals';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { num } from '@/lib/format';
import type { BareMetalHost, HostProbe, Location, Tag } from '@/types';

const STEPS = [
  { label: 'Connect BMC', description: 'Redfish / IPMI credentials' },
  { label: 'Discover', description: 'Hardware inventory' },
  { label: 'Configure', description: 'Name, rack & network' },
  { label: 'Review', description: 'Enroll & watch it come up' },
];

interface ManualHw { vendor: string; model: string; cpuModel: string; sockets: number; cpuCores: number; ramGB: number; nicGbps: number; disks: { type: 'ssd' | 'nvme' | 'hdd'; sizeGB: number }[]; gpuModel: string; gpuCount: number }

const BMC_FIELDS = ['bmcIp', 'bmcUser', 'bmcPassword'];
const HW_PREFIX = 'hardware.';

export default function HostCreate() {
  const navigate = useNavigate();
  const pro = usePro();
  const [sp] = useSearchParams();
  const { items: hosts } = useList<BareMetalHost>('hosts');
  const { items: locations } = useList<Location>('locations');
  const selfHosted = locations.filter((l) => l.kind === 'selfHosted');

  const [step, setStep] = useState(0);
  const [bmc, setBmc] = useState({ bmcIp: '', bmcUser: 'root', bmcPassword: '', protocol: 'redfish' as 'redfish' | 'ipmi' });
  const [probe, setProbe] = useState<HostProbe | null>(null);
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [hw, setHw] = useState<ManualHw>({ vendor: 'Dell', model: 'PowerEdge R760', cpuModel: '2× Intel Xeon Gold 6430', sockets: 2, cpuCores: 64, ramGB: 512, nicGbps: 25, disks: [{ type: 'nvme', sizeGB: 3840 }, { type: 'nvme', sizeGB: 3840 }], gpuModel: 'none', gpuCount: 0 });
  const [locationId, setLocationId] = useState(sp.get('location') ?? 'dc1');
  const [name, setName] = useState('');
  const [rack, setRack] = useState('');
  const [newRack, setNewRack] = useState(false);
  const [rackUnit, setRackUnit] = useState<number | null>(null);
  const [sizeU, setSizeU] = useState(2);
  const [mgmtIp, setMgmtIp] = useState('');
  const [cpuOc, setCpuOc] = useState('4');
  const [ramOc, setRamOc] = useState('1');
  const [tags, setTags] = useState<Tag[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const locHosts = hosts.filter((h) => h.locationId === locationId);
  const racks = [...new Set(locHosts.map((h) => h.rack))].sort();
  const rackHosts = locHosts.filter((h) => h.rack.toLowerCase() === rack.toLowerCase());
  const loc = locations.find((l) => l.id === locationId);

  // sensible defaults per location
  useEffect(() => {
    if (!racks.includes(rack) && !newRack) setRack(racks[0] ?? 'R1');
    const prefix = `${locationId}-hv-`;
    const used = new Set(hosts.map((h) => h.name));
    let n = 1; while (used.has(`${prefix}${String(n).padStart(2, '0')}`)) n++;
    setName((cur) => (!cur || /-hv-\d+$/.test(cur) ? `${prefix}${String(n).padStart(2, '0')}` : cur));
    setMgmtIp((cur) => cur || suggestIp(locHosts.map((h) => h.mgmtIp), 10));
    if (!bmc.bmcIp) setBmc((b) => ({ ...b, bmcIp: suggestIp(locHosts.map((h) => h.bmcIp), 150) }));
  }, [locationId, hosts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (probe && mode === 'auto') setSizeU(probe.sizeU) }, [probe, mode]);
  // auto-pick the highest free slot when the rack/size changes
  useEffect(() => {
    if (rackUnit != null && fits(rackHosts, rackUnit, sizeU)) return;
    for (let u = 42 - sizeU + 1; u >= 1; u--) if (fits(rackHosts, u, sizeU)) { setRackUnit(u); return }
    setRackUnit(null);
  }, [rack, sizeU, locationId, hosts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const probeM = useApiMutation(() => api.post<HostProbe>('/hosts/probe', { bmcIp: bmc.bmcIp, bmcUser: bmc.bmcUser, bmcPassword: bmc.bmcPassword }), {
    silent: true,
    onSuccess: (p) => { setProbe(p); setMode('auto'); setErrors({}); setFormError(null); setStep(1); toast.success(`Connected to ${p.vendor} ${p.model}`, `Redfish ${p.redfishVersion} · S/N ${p.serial}`) },
    onError: (e) => { setErrors(fieldErrors(e)); setFormError(e.message) },
  });

  const inv = mode === 'auto' && probe ? probe : null;
  const threads = inv ? inv.threads : hw.cpuCores * 2;
  const ramGB = inv ? inv.ramGB : hw.ramGB;
  const gpus = inv ? inv.gpus : hw.gpuModel !== 'none' && hw.gpuCount > 0 ? [{ model: hw.gpuModel, count: hw.gpuCount }] : [];
  const gpuCount = gpus.reduce((a, g) => a + g.count, 0);
  const watts = inv ? inv.estimatedWatts : 180 + hw.cpuCores * 6 + gpuCount * 240 + hw.disks.length * 8;
  const capV = threads * Number(cpuOc);
  const capR = Math.floor(ramGB * Number(ramOc) * 0.92);
  const conflict = rackUnit == null || !fits(rackHosts, rackUnit, sizeU);

  const body = {
    name, locationId, rack: rack.toUpperCase(), rackUnit, sizeU, bmcIp: bmc.bmcIp, bmcUser: bmc.bmcUser, bmcPassword: bmc.bmcPassword ? '••••••••' : '', mgmtIp,
    discover: mode, cpuOvercommit: Number(cpuOc), ramOvercommit: Number(ramOc), tags,
    ...(mode === 'manual' ? { hardware: { vendor: hw.vendor, model: hw.model, cpuModel: hw.cpuModel, sockets: hw.sockets, cpuCores: hw.cpuCores, ramGB: hw.ramGB, nicGbps: hw.nicGbps, disks: hw.disks, gpus } } : {}),
  };

  const create = useApiMutation(() => api.create<BareMetalHost>('hosts', { ...body, bmcPassword: bmc.bmcPassword }), {
    silent: true,
    onSuccess: (h) => { setCreatedId(h.id); setStep(4); toast.success(`Enrolling ${h.name}`, 'Follow the provisioning live below.') },
    onError: (e: ApiClientError) => {
      const fe = fieldErrors(e);
      setErrors(fe); setFormError(e.message);
      const keys = Object.keys(fe);
      if (keys.some((k) => BMC_FIELDS.includes(k))) setStep(0);
      else if (keys.some((k) => k.startsWith(HW_PREFIX))) setStep(1);
      else if (keys.length) setStep(2);
    },
  });

  const nameErr = name && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name) ? 'Lowercase letters, digits and dashes' : hosts.some((h) => h.name === name) ? 'A host with this name exists' : undefined;
  const ipErr = (v: string) => (v && !/^(\d{1,3}\.){3}\d{1,3}$/.test(v) ? 'Invalid IPv4 address' : undefined);
  const canConnect = !!bmc.bmcIp && !ipErr(bmc.bmcIp) && !!bmc.bmcUser && !!bmc.bmcPassword;
  const canDiscover = mode === 'auto' ? !!probe : !!hw.cpuModel && hw.cpuCores > 0 && hw.ramGB > 0;
  const canConfigure = !!name && !nameErr && !!rack && !conflict && !!mgmtIp && !ipErr(mgmtIp) && mgmtIp !== bmc.bmcIp;

  if (step === 4 && createdId) return <Enrolling id={createdId} onAnother={() => { setCreatedId(null); setProbe(null); setStep(0); setBmc((b) => ({ ...b, bmcIp: '', bmcPassword: '' })); setName('') }} />;

  const rackFields = (
    <>
      <Field label="Rack" required error={errors.rack} action={<button type="button" className="text-xs font-medium text-brand-500 hover:underline" onClick={() => { setNewRack(!newRack); setRack(newRack ? racks[0] ?? '' : '') }}>{newRack ? 'Pick existing' : 'New rack'}</button>}>
        {newRack || !racks.length
          ? <Input mono value={rack} onChange={(e) => setRack(e.target.value.toUpperCase())} placeholder="R14" />
          : <Select value={rack} onChange={(e) => setRack(e.target.value)} options={racks.map((r) => { const used = locHosts.filter((h) => h.rack === r).reduce((a, h) => a + h.sizeU, 0); return { value: r, label: `${r} · ${used}/42U used` } })} />}
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Bottom unit" required error={errors.rackUnit ?? (conflict && rackUnit != null ? 'Overlaps another server' : rackUnit == null ? 'Rack is full' : undefined)} hint={rackUnit != null ? `Occupies U${rackUnit}${sizeU > 1 ? `–${rackUnit + sizeU - 1}` : ''}` : undefined}>
          <NumberInput value={rackUnit ?? 1} onChange={setRackUnit} min={1} max={43 - sizeU} unit="U" invalid={conflict} />
        </Field>
        <Field label="Height" error={errors.sizeU}><NumberInput value={sizeU} onChange={setSizeU} min={1} max={8} unit="U" /></Field>
      </div>
    </>
  );
  const ipFields = (
    <div className="grid grid-cols-1 gap-4 @min-[36rem]:grid-cols-2">
      <Field label="Management IP" required error={ipErr(mgmtIp) ?? errors.mgmtIp ?? (mgmtIp && mgmtIp === bmc.bmcIp ? 'Must differ from BMC IP' : undefined)} hint="Hypervisor OS address on the mgmt VLAN (PXE DHCP reservation)">
        <Input mono value={mgmtIp} onChange={(e) => setMgmtIp(e.target.value.trim())} />
      </Field>
      <Field label="BMC IP"><Input mono value={bmc.bmcIp} disabled /></Field>
    </div>
  );
  const ocFields = (
    <div className="grid gap-4 @min-[36rem]:grid-cols-2">
      <Field label="CPU overcommit" hint={`${threads} threads → ${capV} schedulable vCPU`} error={errors.cpuOvercommit}>
        <Segmented value={cpuOc} onChange={setCpuOc} options={['1', '2', '4', '8'].map((v) => ({ value: v, label: `${v}×` }))} />
      </Field>
      <Field label="RAM overcommit" hint={`${ramGB} GB → ${capR} GB schedulable (8% hypervisor reserve)`} error={errors.ramOvercommit}>
        <Segmented value={ramOc} onChange={setRamOc} options={['1', '1.25', '1.5'].map((v) => ({ value: v, label: `${v}×` }))} />
      </Field>
    </div>
  );
  const tagsField = <Field label="Tags" optional><TagEditor value={tags} onChange={setTags} suggestions={['role', 'ticket', 'owner', 'warranty']} /></Field>;
  const rackVisual = (
    <div>
      <div className="mb-1.5 text-[13px] font-medium text-fg-2">Rack position <span className="text-xs font-normal text-muted">· click a free slot</span></div>
      <div className="flex justify-center rounded-xl bg-surface-2 p-3">
        <RackElevation name={rack || '—'} className="w-[220px]" uHeight={11} hosts={rackHosts} pickSizeU={sizeU} onPickUnit={(u) => setRackUnit(u)}
          ghost={rackUnit != null ? { unit: rackUnit, sizeU, conflict, label: name || 'new host' } : null} subtitle={loc ? `${loc.name}` : undefined} />
      </div>
    </div>
  );

  return (
    <Page wide>
      <PageHeader
        title="Enroll bare metal host"
        description={pro ? "Connect to the server's BMC, let Autark discover the hardware, then pick its place in the rack. Provisioning is fully automatic." : 'Connect to the server, check what we found, name it. Autark does the rest.'}
        icon={Cpu}
        iconColor="#475569"
        crumbs={[{ label: 'Bare Metal Hosts', to: '/hardware/bare-metals' }, { label: 'Enroll' }]}
      />
      <StepIndicator steps={STEPS} current={step} onStep={setStep} className="mb-5" />
      {formError && <Hint tone="danger" className="mb-5">{formError}</Hint>}

      <div className="grid items-start gap-6 @min-[56rem]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {step === 0 && (
            <Card>
              <CardHeader icon={PlugZap} title={pro ? 'Connect to the BMC' : 'Connect to the server'} description={pro ? 'Out-of-band controller (iDRAC, iLO, XCC, IPMI). Credentials are stored encrypted in the vault and used only for power & provisioning.' : 'The management controller login (iDRAC, iLO, IPMI). Stored encrypted.'} />
              <div className="space-y-4 p-5">
                <Pro>
                  <Field label="Protocol">
                    <Segmented value={bmc.protocol} onChange={(p) => setBmc({ ...bmc, protocol: p })} options={[{ value: 'redfish', label: 'Redfish (recommended)' }, { value: 'ipmi', label: 'IPMI 2.0' }]} />
                  </Field>
                </Pro>
                <div className="grid gap-4 @min-[36rem]:grid-cols-3">
                  <Field label="BMC IP address" required error={ipErr(bmc.bmcIp) ?? errors.bmcIp}>
                    <Input mono value={bmc.bmcIp} onChange={(e) => setBmc({ ...bmc, bmcIp: e.target.value.trim() })} placeholder="10.0.0.150" invalid={!!(ipErr(bmc.bmcIp) ?? errors.bmcIp)} autoFocus />
                  </Field>
                  <Field label="Username" required error={errors.bmcUser}>
                    <Input value={bmc.bmcUser} onChange={(e) => setBmc({ ...bmc, bmcUser: e.target.value })} placeholder="root" />
                  </Field>
                  <Field label="Password" required error={errors.bmcPassword}>
                    <Input type="password" value={bmc.bmcPassword} onChange={(e) => setBmc({ ...bmc, bmcPassword: e.target.value })} placeholder="••••••••" invalid={!!errors.bmcPassword} onKeyDown={(e) => { if (e.key === 'Enter' && canConnect) probeM.mutate() }} />
                  </Field>
                </div>
                <Pro>
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
                    <KeyRound className="size-3.5" />
                    Demo tips: a password containing <code className="font-mono text-fg-2">invalid</code> fails authentication; an IP ending in <code className="font-mono text-fg-2">.254</code> is unreachable; a hostname containing <code className="font-mono text-fg-2">fail</code> fails burn-in.
                  </div>
                </Pro>
                {!pro && (
                  <Advanced title="Advanced" description="Protocol: Redfish (recommended)">
                    <Field label="Protocol">
                      <Segmented value={bmc.protocol} onChange={(p) => setBmc({ ...bmc, protocol: p })} options={[{ value: 'redfish', label: 'Redfish (recommended)' }, { value: 'ipmi', label: 'IPMI 2.0' }]} />
                    </Field>
                  </Advanced>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
                  <Button variant="ghost" icon={Pencil} onClick={() => { setMode('manual'); setProbe(null); setFormError(null); setStep(1) }} disabled={!canConnect}>{pro ? 'Skip discovery, enter manually' : 'Enter manually'}</Button>
                  <Button variant="primary" icon={ScanSearch} loading={probeM.isPending} disabled={!canConnect} onClick={() => probeM.mutate()}>Connect & discover</Button>
                </div>
              </div>
            </Card>
          )}

          {step === 1 && (
            <Card>
              <CardHeader icon={ScanSearch} title={pro ? 'Hardware inventory' : 'Discovered hardware'} description={probe ? (pro ? `Discovered via ${bmc.protocol === 'redfish' ? `Redfish ${probe.redfishVersion}` : 'IPMI'} at ${probe.bmcIp}` : 'Found automatically. Looks right? Continue.') : 'Describe the server. Autark verifies it during enrollment.'} />
              <div className="space-y-4 p-5">
                <OptionCards cols={2} value={mode} onChange={setMode} options={[
                  { value: 'auto', title: 'Use discovered inventory', description: probe ? `${probe.vendor} ${probe.model} · ${probe.cpuCores} cores · ${probe.ramGB} GB` : 'Connect to the BMC first', icon: <Sparkles className="size-4 text-brand-500" />, disabled: !probe, badge: probe ? <Badge tone="success">recommended</Badge> : undefined },
                  { value: 'manual', title: 'Enter hardware manually', description: 'For servers without Redfish or to override detected values.', icon: <Pencil className="size-4 text-muted" /> },
                ]} />
                {mode === 'auto' && probe ? <InventoryView p={probe} /> : (
                  <div className="space-y-4">
                    <div className="grid gap-4 @min-[36rem]:grid-cols-3">
                      <Field label="Vendor"><Input value={hw.vendor} onChange={(e) => setHw({ ...hw, vendor: e.target.value })} /></Field>
                      <Field label="Model"><Input value={hw.model} onChange={(e) => setHw({ ...hw, model: e.target.value })} /></Field>
                      <Field label="Height (U)"><NumberInput value={sizeU} onChange={setSizeU} min={1} max={8} unit="U" /></Field>
                    </div>
                    <div className="grid gap-4 @min-[36rem]:grid-cols-[2fr_1fr_1fr]">
                      <Field label="CPU model" required error={errors['hardware.cpuModel']}><Input value={hw.cpuModel} onChange={(e) => setHw({ ...hw, cpuModel: e.target.value })} /></Field>
                      <Field label="Sockets"><NumberInput value={hw.sockets} onChange={(v) => setHw({ ...hw, sockets: v })} min={1} max={8} /></Field>
                      <Field label="Physical cores" required error={errors['hardware.cpuCores']} hint={`${hw.cpuCores * 2} threads (SMT)`}><NumberInput value={hw.cpuCores} onChange={(v) => setHw({ ...hw, cpuCores: v })} min={1} max={512} /></Field>
                    </div>
                    <div className="grid gap-4 @min-[36rem]:grid-cols-3">
                      <Field label="Memory" required error={errors['hardware.ramGB']}><NumberInput value={hw.ramGB} onChange={(v) => setHw({ ...hw, ramGB: v })} min={8} max={16384} step={32} unit="GB" /></Field>
                      <Field label="NIC speed"><Select value={String(hw.nicGbps)} onChange={(e) => setHw({ ...hw, nicGbps: Number(e.target.value) })} options={[10, 25, 40, 100].map((g) => ({ value: String(g), label: `${g} GbE` }))} /></Field>
                      <Field label="GPU">
                        <div className="flex gap-2">
                          <Select value={hw.gpuModel} onChange={(e) => setHw({ ...hw, gpuModel: e.target.value, gpuCount: e.target.value === 'none' ? 0 : Math.max(1, hw.gpuCount) })} options={[{ value: 'none', label: 'None' }, { value: 'A6000', label: 'RTX A6000' }, { value: 'L40S', label: 'L40S' }, { value: 'H100', label: 'H100' }, { value: 'H200', label: 'H200' }]} />
                          {hw.gpuModel !== 'none' && <NumberInput className="w-28" value={hw.gpuCount} onChange={(v) => setHw({ ...hw, gpuCount: v })} min={1} max={8} />}
                        </div>
                      </Field>
                    </div>
                    <Field label="Disks">
                      <ListEditor items={hw.disks} onChange={(d) => setHw({ ...hw, disks: d })} addLabel="Add disk" create={() => ({ type: 'nvme' as const, sizeGB: 1920 })}
                        render={(d, update) => (
                          <div className="grid grid-cols-2 gap-2">
                            <Select value={d.type} onChange={(e) => update({ type: e.target.value as 'ssd' | 'nvme' | 'hdd' })} options={[{ value: 'nvme', label: 'NVMe' }, { value: 'ssd', label: 'SATA SSD' }, { value: 'hdd', label: 'HDD' }]} />
                            <NumberInput value={d.sizeGB} onChange={(v) => update({ sizeGB: v })} min={120} max={30000} step={120} unit="GB" />
                          </div>
                        )} />
                    </Field>
                  </div>
                )}
                <WizardNav onBack={() => setStep(0)} onNext={() => setStep(2)} nextDisabled={!canDiscover} />
              </div>
            </Card>
          )}

          {step === 2 && (
            <Card>
              <CardHeader icon={Settings2} title={pro ? 'Configure placement' : 'Name & location'} description={pro ? 'Where the server lives and how it is reached. Rack positions are validated so two servers never overlap.' : 'We picked a free rack slot and IP for you. Change them under Advanced.'} />
              <div className="space-y-5 p-5">
                <div className="grid gap-4 @min-[36rem]:grid-cols-2">
                  <Field label="Hostname" required error={nameErr ?? errors.name} hint="DNS-safe; convention: <location>-<role>-<nn>">
                    <Input mono value={name} onChange={(e) => setName(e.target.value.toLowerCase())} invalid={!!(nameErr ?? errors.name)} />
                  </Field>
                  <Field label="Location" required error={errors.locationId}>
                    <Select value={locationId} onChange={(e) => { setLocationId(e.target.value); setNewRack(false); setRack('') }} options={selfHosted.map((l) => ({ value: l.id, label: `${flag(l.country)} ${l.name} · ${l.city}` }))} />
                  </Field>
                </div>
                {pro ? (
                  <div className="grid gap-5 @min-[40rem]:grid-cols-[minmax(0,1fr)_250px]">
                    <div className="space-y-4">{rackFields}{ipFields}{ocFields}{tagsField}</div>
                    {rackVisual}
                  </div>
                ) : (
                  <>
                    <Advanced title="Advanced" description={`Rack ${rack.toUpperCase() || '—'} · U${rackUnit ?? '—'} · IP ${mgmtIp || '—'} · overcommit · tags`}>
                      <div className="grid gap-5 @min-[40rem]:grid-cols-[minmax(0,1fr)_250px]">
                        <div className="space-y-4">{rackFields}{ipFields}{ocFields}{tagsField}</div>
                        {rackVisual}
                      </div>
                    </Advanced>
                    {!canConfigure && !!name && !nameErr && <Hint tone="warning">Something in the advanced settings needs a look (rack slot or IP address).</Hint>}
                  </>
                )}
                <WizardNav onBack={() => setStep(1)} onNext={() => setStep(3)} nextDisabled={!canConfigure} />
              </div>
            </Card>
          )}

          {step === 3 && (
            <Card>
              <CardHeader icon={ClipboardCheck} title="Review & enroll" description={pro ? 'Autark will PXE-boot the server, install the hypervisor and agent, join it to the cluster network and run burn-in tests.' : 'Autark installs everything and tests the server. Takes a few minutes.'} />
              <div className="space-y-5 p-5">
                <KeyValue cols={3} items={!pro ? [
                  ['Hostname', <span className="font-mono">{name}</span>],
                  ['Location', `${flag(loc?.country)} ${loc?.name ?? locationId}`],
                  ['Hardware', inv ? `${inv.vendor} ${inv.model}` : `${hw.vendor} ${hw.model}`],
                  ['CPU', `${threads / 2} cores`],
                  ['Memory', `${ramGB} GB`],
                  ['GPUs', gpuCount ? gpus.map((g) => `${g.count}× ${g.model}`).join(', ') : 'none'],
                ] : [
                  ['Hostname', <span className="font-mono">{name}</span>],
                  ['Location', `${flag(loc?.country)} ${loc?.name ?? locationId}`],
                  ['Rack position', `${rack.toUpperCase()} · U${rackUnit}${sizeU > 1 ? `–${(rackUnit ?? 0) + sizeU - 1}` : ''} (${sizeU}U)`],
                  ['Hardware', inv ? `${inv.vendor} ${inv.model}` : `${hw.vendor} ${hw.model}`],
                  ['CPU', `${inv?.cpuModel ?? hw.cpuModel} · ${threads / 2} cores`],
                  ['Memory', `${ramGB} GB`],
                  ['GPUs', gpuCount ? gpus.map((g) => `${g.count}× ${g.model}`).join(', ') : 'none'],
                  ['Management IP', <span className="font-mono">{mgmtIp}</span>],
                  ['BMC', <span className="font-mono">{bmc.bmcUser}@{bmc.bmcIp}</span>],
                  ['Overcommit', `CPU ${cpuOc}× · RAM ${ramOc}×`],
                  ['Inventory', mode === 'auto' ? 'auto-discovered (re-verified during enrollment)' : 'manual'],
                  ['Tags', tags.length ? tags.map((t) => `${t.key}=${t.value}`).join(', ') : '—'],
                ]} />
                <IacTabs snippets={{ terraform: toHcl('bare_metal_host', name || 'host', { ...body, bmcPassword: 'var.bmc_password' }), cli: toCli('host enroll', { ...body, bmcPassword: '$BMC_PASSWORD' }), curl: toCurl('POST', '/hosts', { ...body, bmcPassword: '…' }) }} />
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
                  <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(2)}>Back</Button>
                  <Button variant="primary" size="lg" icon={Rocket} loading={create.isPending} onClick={() => create.mutate()}>Enroll host</Button>
                </div>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4 @min-[44rem]:sticky @min-[44rem]:top-20">
          <Card className="p-4">
            <div className="mb-3 text-sm font-semibold text-fg">Capacity this host adds</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[[capV || '—', 'vCPU', Cpu], [capR || '—', 'GB RAM', MemoryStick], [gpuCount, 'GPUs', Gpu]].map(([v, l, Icon]: any) => (
                <div key={l} className="rounded-lg bg-surface-2 py-2.5">
                  <Icon className="mx-auto mb-1 size-4 text-faint" />
                  <div className="text-lg font-semibold tabular text-fg">{typeof v === 'number' ? num(v) : v}</div>
                  <div className="text-[10px] text-muted">{l}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-1.5 border-t border-line pt-3 text-xs text-muted">
              <div className="flex justify-between"><span className="flex items-center gap-1"><Zap className="size-3" />Est. power</span><span className="tabular text-fg-2">{watts} W · ≈ €{Math.round((watts / 1000) * 730 * 1.35 * 0.24)}/mo</span></div>
              <div className="flex justify-between"><span className="flex items-center gap-1"><HardDrive className="size-3" />Local disks</span><span className="tabular text-fg-2">{(inv?.disks ?? hw.disks).length} · {num((inv?.disks ?? hw.disks).reduce((a, d) => a + d.sizeGB, 0))} GB</span></div>
              <div className="flex justify-between"><span>Equivalent cloud capacity</span><span className="tabular text-fg-2">≈ {Math.floor(capR / 8) || 0}× 2 vCPU/8 GB VMs</span></div>
            </div>
          </Card>
          <Pro>
          <Card className="p-4">
            <div className="mb-2 text-sm font-semibold text-fg">What happens next</div>
            <ol className="space-y-1.5 text-xs text-muted">
              {['Connect to BMC (Redfish)', 'Inventory discovery', 'Firmware compliance check', 'PXE boot installer', 'Install hypervisor OS & KVM', 'Install Autark agent', 'Join cluster networking (VXLAN/EVPN)', 'Burn-in tests', 'Ready for VMs'].map((s, i) => (
                <li key={s} className="flex items-center gap-2"><span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[9px] font-semibold tabular text-fg-2">{i + 1}</span>{s}</li>
              ))}
            </ol>
            <p className="mt-3 text-[11px] text-faint">Typically 15–25 minutes on real hardware; ~20 seconds in this demo.</p>
          </Card>
          </Pro>
        </div>
      </div>
    </Page>
  );
}

function WizardNav({ onBack, onNext, nextDisabled }: { onBack: () => void; onNext: () => void; nextDisabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>Back</Button>
      <Button variant="primary" iconRight={ArrowRight} disabled={nextDisabled} onClick={onNext}>Continue</Button>
    </div>
  );
}

function InventoryView({ p }: { p: HostProbe }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-2/60 px-4 py-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-zinc-800 text-zinc-100"><Server className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-fg">{p.vendor} {p.model}</div>
          <div className="text-xs text-muted">S/N <span className="font-mono">{p.serial}</span> · {p.sizeU}U · power {p.powerState}</div>
        </div>
        <Badge tone="success" dot>BMC reachable</Badge>
      </div>
      <div className="grid gap-px bg-line @min-[36rem]:grid-cols-2">
        <InvBlock icon={Cpu} title="Compute">
          <div className="text-sm text-fg">{p.cpuModel}</div>
          <div className="text-xs text-muted">{p.sockets} socket{p.sockets > 1 ? 's' : ''} · {p.cpuCores} cores · {p.threads} threads</div>
          <div className="mt-1 text-sm text-fg">{p.ramGB} GB DDR5 ECC</div>
        </InvBlock>
        <InvBlock icon={HardDrive} title={`Storage · ${p.disks.length} disks`}>
          <div className="flex flex-wrap gap-1">{p.disks.map((d) => <SpecPill key={d.slot}>{d.slot} · {d.sizeGB >= 1000 ? `${(d.sizeGB / 1000).toFixed(1)} TB` : `${d.sizeGB} GB`} {d.type.toUpperCase()}</SpecPill>)}</div>
        </InvBlock>
        <InvBlock icon={Network} title="Network">
          <div className="flex flex-wrap gap-1">{p.nics.map((n) => <SpecPill key={n.name}>{n.name} · {n.speedGbps}G{n.role === 'bmc' ? ' (BMC)' : ''}</SpecPill>)}</div>
        </InvBlock>
        <InvBlock icon={Gpu} title="Accelerators">
          {p.gpus.length ? p.gpus.map((g) => <div key={g.model} className="text-sm text-fg">{g.count}× NVIDIA {g.model}</div>) : <div className="text-sm text-muted">None detected</div>}
        </InvBlock>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-xs text-muted">
        <span>BIOS <span className="font-mono text-fg-2">{p.firmware.bios}</span></span>
        <span>BMC <span className="font-mono text-fg-2">{p.firmware.bmc}</span></span>
        {p.firmwareUpdateAvailable ? <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><AlertTriangle className="size-3" />BMC firmware update available (non-blocking)</span> : <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-3" />Firmware at baseline</span>}
        <span className="ml-auto flex items-center gap-1"><Zap className="size-3" />~{p.estimatedWatts} W</span>
      </div>
    </div>
  );
}

function InvBlock({ icon: Icon, title, children }: { icon: typeof Cpu; title: string; children: ReactNode }) {
  return (
    <div className="bg-surface p-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-faint"><Icon className="size-3.5" />{title}</div>
      {children}
    </div>
  );
}

function Enrolling({ id, onAnother }: { id: string; onAnother: () => void }) {
  const { data: host } = useItem<BareMetalHost>('hosts', id);
  const { items: ops } = useOperationsFor(id);
  const op = ops.find((o) => o.type === 'bareMetal.enroll');
  const done = op?.status === 'succeeded';
  const failed = op?.status === 'failed';
  return (
    <Page>
      <PageHeader title={`Enrolling ${host?.name ?? ''}`} icon={Cpu} iconColor="#475569" crumbs={[{ label: 'Bare Metal Hosts', to: '/hardware/bare-metals' }, { label: 'Enroll' }]}
        description="Sit back — Autark is turning this server into cloud capacity." />
      <StepIndicator steps={[...STEPS.slice(0, 3), { label: done ? 'Ready' : failed ? 'Failed' : 'Enrolling', description: op ? `${Math.round(op.progress * 100)}%` : '' }]} current={done ? 4 : 3} className="mb-5" />
      {done && (
        <Hint tone="success" className="mb-4">
          <b>{host?.name}</b> is ready and schedulable{host?.capacity ? ` — ${host.capacity.vcpus} vCPU / ${host.capacity.ramGB} GB added to ${host.locationId}` : ''}.
        </Hint>
      )}
      {failed && <Hint tone="danger" className="mb-4">{op?.error} You can fix the cause and retry from the host page.</Hint>}
      {op ? <OperationRunner op={op} /> : <Card className="p-8 text-center text-sm text-muted">Starting enrollment…</Card>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button icon={Plus} onClick={onAnother}>Enroll another</Button>
        <Button variant="primary" icon={ExternalLink} to={`/hardware/bare-metals/${id}`}>Open host</Button>
      </div>
    </Page>
  );
}

function fits(hosts: BareMetalHost[], unit: number, sizeU: number) {
  if (unit < 1 || unit + sizeU - 1 > 42) return false;
  return !hosts.some((h) => h.rackUnit <= unit + sizeU - 1 && h.rackUnit + h.sizeU - 1 >= unit);
}

function suggestIp(existing: string[], start: number): string {
  const base = existing[0]?.split('.').slice(0, 3).join('.') ?? '10.0.9';
  const used = new Set(existing);
  for (let n = start; n < 250; n++) { const ip = `${base}.${n}`; if (!used.has(ip)) return ip }
  return `${base}.${start}`;
}
