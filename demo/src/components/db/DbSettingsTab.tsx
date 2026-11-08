import { useEffect, useState } from 'react';
import { HardDrive, Save, Scaling, Shield, Tag as TagIcon, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation } from '@/api/hooks';
import { Card, CardHeader, KeyValue } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Switch, TagEditor } from '@/components/ui/form';
import { Meter } from '@/components/ui/misc';
import { money } from '@/lib/format';
import { DbScaleModal } from './DbScaleModal';
import { topologyLabel } from './engine';
import { Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import type { DbInstance, Tag } from '@/types';

export function DbSettingsTab({ d, onDelete }: { d: DbInstance; onDelete: () => void }) {
  const [scaleOpen, setScaleOpen] = useState(false);
  const pro = usePro();
  const [tags, setTags] = useState<Tag[]>(d.tags);
  useEffect(() => setTags(d.tags), [JSON.stringify(d.tags)]); // eslint-disable-line
  const patch = useApiMutation((body: Partial<DbInstance>) => api.update('dbInstances', d.id, body), { success: 'Settings saved' });
  const tagsDirty = JSON.stringify(tags) !== JSON.stringify(d.tags);
  const canScale = ['available', 'stopped'].includes(d.status);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader icon={Scaling} title={pro ? 'Size & topology' : 'Size'} description={pro ? 'Resize compute, grow storage, add a standby or read replicas.' : 'Make your database bigger or turn on high availability.'} actions={<Button size="sm" variant="primary" icon={Scaling} disabled={!canScale} onClick={() => setScaleOpen(true)}>Scale…</Button>} />
        <div className="p-4">
          <KeyValue cols={4} items={[
            ['Compute', `${d.size.vcpus} vCPU · ${d.size.ramGB} GB`],
            ['Storage', `${d.storageGB} GB`],
            [pro ? 'Topology' : 'Availability', pro ? topologyLabel(d) : d.ha ? 'High availability' : 'Single node'],
            ['Monthly cost', money(d.monthlyCost)],
          ]} />
          <Meter className="mt-4" value={d.storageUsedGB} max={d.storageGB} label={`Storage used: ${d.storageUsedGB} / ${d.storageGB} GB`} showLabel />
        </div>
      </Card>

      <Card>
        <CardHeader icon={HardDrive} title={pro ? 'Storage & protection' : 'Protection'} />
        <div className="space-y-4 p-4">
          <Switch checked={d.storageAutoscale} onChange={(v) => patch.mutate({ storageAutoscale: v })} label="Storage autoscaling" description="Grow storage by 20% automatically when usage exceeds 90% (never shrinks)." />
          <Switch checked={!!d.deletionProtection} onChange={(v) => patch.mutate({ deletionProtection: v })} label={<span className="flex items-center gap-1.5"><Shield className="size-3.5" /> Deletion protection</span>} description="Blocks deletion via console, CLI and Terraform until disabled." />
        </div>
      </Card>

      <Pro>
      <Card>
        <CardHeader icon={TagIcon} title="Tags" actions={<Button size="sm" variant="primary" icon={Save} disabled={!tagsDirty} loading={patch.isPending} onClick={() => patch.mutate({ tags })}>Save</Button>} />
        <div className="p-4"><TagEditor value={tags} onChange={setTags} /></div>
      </Card>
      </Pro>

      <Card className="border-rose-500/30">
        <CardHeader icon={Trash2} title={<span className="text-rose-600 dark:text-rose-400">Danger zone</span>} />
        <div className="flex flex-col gap-3 p-4 @min-[36rem]:flex-row @min-[36rem]:items-center @min-[36rem]:justify-between">
          <div className="text-sm text-fg-2">
            Delete <b>{d.name}</b>, its standby, replicas and automated backups. Manual backups are kept; you can take a final backup.
            {d.deletionProtection && <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">Deletion protection is on — disable it above first.</div>}
          </div>
          <Button variant="outline-danger" icon={Trash2} disabled={!!d.deletionProtection || d.status === 'deleting'} onClick={onDelete}>Delete database</Button>
        </div>
      </Card>

      <DbScaleModal d={d} open={scaleOpen} onClose={() => setScaleOpen(false)} />
    </div>
  );
}
