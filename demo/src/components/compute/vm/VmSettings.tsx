import { useEffect, useState } from 'react';
import { Settings2, Tags as TagsIcon, KeyRound, FileCode2, ShieldAlert, Check, RefreshCcw, Trash2, Shield, Pencil } from 'lucide-react';
import { api, ApiClientError } from '@/api/client';
import { useApiMutation, useList } from '@/api/hooks';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input, Switch, TagEditor, MultiSelect, Textarea, Hint } from '@/components/ui/form';
import { IacTabs, toHcl, toCli, toCurl } from '@/components/ui/CodeBlock';
import { usePro } from '@/store/ui';
import type { VmCtx } from './context';
import type { ProjectAllowance } from '@/types';

export function VmSettings({ c, onRebuild, onDelete }: { c: VmCtx; onRebuild: () => void; onDelete: () => void }) {
  const { vm, image, allSshKeys } = c;
  const { items: allowances } = useList<ProjectAllowance>('allowances');
  const required = allowances.find((a) => a.projectId === vm.projectId)?.requiredTags ?? [];
  const [name, setName] = useState(vm.name);
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [tags, setTags] = useState(vm.tags);
  const [tagErr, setTagErr] = useState<string | null>(null);
  const [keys, setKeys] = useState(vm.sshKeyIds);
  const [init, setInit] = useState(vm.initScript);
  useEffect(() => setName(vm.name), [vm.name]);
  useEffect(() => setTags(vm.tags), [JSON.stringify(vm.tags)]); // eslint-disable-line
  useEffect(() => setKeys(vm.sshKeyIds), [vm.sshKeyIds.join()]); // eslint-disable-line
  useEffect(() => setInit(vm.initScript), [vm.initScript]);

  const patch = useApiMutation((body: Record<string, unknown>) => api.update('vms', vm.id, body), {
    success: (_r, b) => `${Object.keys(b).map((k) => ({ name: 'Name', tags: 'Tags', sshKeyIds: 'SSH keys', initScript: 'User data', deletionProtection: 'Deletion protection' }[k] ?? k)).join(', ')} updated`,
    onError: (e: ApiClientError) => { if (e.details?.name) setNameErr(e.details.name); if (e.details?.tags) setTagErr(e.details.tags) },
  });
  const save = (body: Record<string, unknown>) => { setNameErr(null); setTagErr(null); patch.mutate(body) };
  const win = image?.os === 'windows';
  const pro = usePro();
  const iacBody = { name: vm.name, projectId: vm.projectId, locationId: vm.locationId, imageId: vm.imageId, ...(vm.size.presetId ? { presetId: vm.size.presetId } : { vcpus: vm.size.vcpus, ramGB: vm.size.ramGB }), systemDiskGB: vm.size.systemDiskGB, networkId: vm.networkId, subnetId: vm.subnetId, firewallIds: vm.firewallIds, sshKeyIds: vm.sshKeyIds, backups: vm.backups, deletionProtection: vm.deletionProtection, tags: vm.tags };

  return (
    <div className="grid gap-5 @min-[44rem]:grid-cols-2">
      <div className="space-y-5">
        <Card>
          <CardHeader title="General" icon={Settings2} />
          <div className="space-y-4 p-4">
            <Field label="Name" error={nameErr} hint={pro ? 'Changing the name updates the hostname and private DNS record on next boot.' : undefined}>
              <div className="flex gap-2">
                <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} invalid={!!nameErr} />
                <Button icon={Pencil} disabled={name === vm.name || !name} loading={patch.isPending && patch.variables && 'name' in patch.variables} onClick={() => save({ name })}>Rename</Button>
              </div>
            </Field>
            <div className="border-t border-line pt-4">
              <Switch checked={vm.deletionProtection} onChange={(v) => save({ deletionProtection: v })} disabled={patch.isPending}
                label={<span className="flex items-center gap-1.5"><Shield className="size-3.5" /> Deletion protection</span>} description="Blocks deletion via console, CLI, API and Terraform until disabled." />
            </div>
          </div>
        </Card>

        {(pro || required.length > 0) && <Card>
          <CardHeader title="Tags" icon={TagsIcon} description={required.length ? `Project policy requires: ${required.join(', ')}` : 'Used for cost allocation, search and policies'} actions={JSON.stringify(tags) !== JSON.stringify(vm.tags) && <Button size="xs" variant="primary" icon={Check} onClick={() => save({ tags })}>Save</Button>} />
          <div className="p-4">
            <TagEditor value={tags} onChange={setTags} required={required} />
            {tagErr && <p className="mt-2 text-xs text-rose-500">{tagErr}</p>}
          </div>
        </Card>}

        <Card>
          <CardHeader title="SSH keys" icon={KeyRound} description="Injected via cloud-init on first boot and on rebuild" actions={keys.join() !== vm.sshKeyIds.join() && <Button size="xs" variant="primary" icon={Check} onClick={() => save({ sshKeyIds: keys })}>Save</Button>} />
          <div className="space-y-3 p-4">
            {win ? <p className="text-sm text-muted">Windows VMs use the Administrator password (shown once in the console).</p> : (
              <>
                <MultiSelect options={allSshKeys.map((k) => ({ value: k.id, label: k.name, description: k.fingerprint }))} value={keys} onChange={setKeys} placeholder="No keys" />
                {pro ? <Hint>Changes apply on the next rebuild. To rotate keys on a running VM, update <code className="font-mono text-xs">~/.ssh/authorized_keys</code> in the guest.</Hint>
                  : <p className="text-xs text-muted">Changes apply on the next rebuild.</p>}
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="space-y-5">
        {pro && <Card>
          <CardHeader title="Cloud-init user data" icon={FileCode2} description="Runs on first boot. Edits take effect on rebuild." actions={init !== vm.initScript && <Button size="xs" variant="primary" icon={Check} onClick={() => save({ initScript: init })}>Save</Button>} />
          <div className="p-4"><Textarea mono rows={8} value={init} onChange={(e) => setInit(e.target.value)} placeholder={'#cloud-config\npackages: [htop]'} /></div>
        </Card>}

        {pro && <Card className="p-4">
          <IacTabs title="This VM as code" snippets={{ terraform: toHcl('vm', vm.name, iacBody), cli: toCli('vm create', iacBody), curl: toCurl('POST', '/vms', iacBody) }} />
        </Card>}

        <Card className="border-rose-500/30">
          <CardHeader title="Danger zone" icon={ShieldAlert} className="border-rose-500/20" />
          <div className="divide-y divide-line">
            <div className="flex items-center justify-between gap-4 p-4">
              <div><div className="text-sm font-medium text-fg">Rebuild</div><div className="text-xs text-muted">Re-image the system disk with a fresh OS. Volumes and IPs are kept.</div></div>
              <Button variant="outline-danger" size="sm" icon={RefreshCcw} onClick={onRebuild} disabled={!['running', 'stopped', 'error'].includes(vm.status)}>Rebuild</Button>
            </div>
            <div className="flex items-center justify-between gap-4 p-4">
              <div><div className="text-sm font-medium text-fg">Delete VM</div><div className="text-xs text-muted">{vm.deletionProtection ? 'Deletion protection is on — you will be asked to disable it.' : 'Shuts down and removes the VM. Optionally deletes volumes and releases IPs.'}</div></div>
              <Button variant="danger" size="sm" icon={Trash2} onClick={onDelete} disabled={vm.status === 'deleting'}>Delete</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
