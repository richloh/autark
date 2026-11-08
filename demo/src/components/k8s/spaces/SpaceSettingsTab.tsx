import { useEffect, useState } from 'react';
import { Scaling, Trash2, Save, ArrowRight } from 'lucide-react';
import { api, ApiClientError } from '@/api/client';
import { useApiMutation } from '@/api/hooks';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input, TagEditor, Hint } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { money } from '@/lib/format';
import { spaceCost } from '@/lib/pricing';
import { cn } from '@/lib/cn';
import type { K8sSpace, PlatformCluster, SpaceQuota } from '@/types';
import { QuotaEditor, quotaErrors } from './QuotaEditor';
import { QUOTA_KEYS, SPACE_NAME_RE, num1, sizeOf, type SizeId } from './spaceUi';

export function SpaceSettingsTab({ space: s, used, platformCluster: pc, onDelete }: { space: K8sSpace; used?: SpaceQuota; platformCluster?: PlatformCluster; onDelete: () => void }) {
  const [size, setSize] = useState<SizeId>(sizeOf(s.quota));
  const [quota, setQuota] = useState<SpaceQuota>({ ...s.quota });
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [resizeError, setResizeError] = useState<string | null>(null);
  const [name, setName] = useState(s.name);
  const [tags, setTags] = useState(s.tags);
  const quotaKey = JSON.stringify(s.quota);
  useEffect(() => { setQuota({ ...s.quota }); setSize(sizeOf(s.quota)) }, [quotaKey]); // eslint-disable-line
  useEffect(() => { setName(s.name); setTags(s.tags) }, [s.name, JSON.stringify(s.tags)]); // eslint-disable-line

  const min: SpaceQuota | null = used ? { ...used, storageGi: used.storageGi, cpuCores: +used.cpuCores.toFixed(2), memoryGi: +used.memoryGi.toFixed(2) } : null;
  const errs = quotaErrors(quota, { max: pc?.maxTenantQuota, min });
  const changed = QUOTA_KEYS.some((k) => quota[k] !== s.quota[k]);
  const before = spaceCost(s.quota).total;
  const after = spaceCost(quota).total;
  const diff = after - before;
  const busy = s.status !== 'active';

  const resize = useApiMutation(() => api.action('k8sSpaces', s.id, 'resize', { quota }), {
    success: 'Resizing quota',
    onSuccess: () => { setServerErrors({}); setResizeError(null) },
    onError: (e: ApiClientError) => { setServerErrors(fieldErrors(e)); setResizeError(e.message); if (size !== 'custom') setSize('custom') },
  });
  const patch = useApiMutation((body: Partial<K8sSpace>) => api.update('k8sSpaces', s.id, body), { success: 'Saved' });
  const nameErr = name && !SPACE_NAME_RE.test(name) ? 'Lowercase letters, digits and dashes (max 30)' : undefined;
  const firstErr = Object.values(errs)[0];

  return (
    <div className="max-w-4xl space-y-5">
      <Card>
        <CardHeader title="Resize quota" icon={Scaling} description="Changes apply in seconds without restarting your pods." />
        <div className="space-y-4 p-4">
          {resizeError && <Hint tone="danger">{resizeError}</Hint>}
          <QuotaEditor size={size} onSize={setSize} value={quota} onChange={setQuota} errors={errs} serverErrors={serverErrors} />
          {size !== 'custom' && firstErr && <Hint tone="warning">{firstErr} — {firstErr.includes('in use') ? 'scale your workloads down first, or pick a larger size.' : 'pick a smaller size.'}</Hint>}
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2/60 px-3 py-2.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-sm">
              <span className="tabular text-muted">{money(before)}</span>
              <ArrowRight className="size-3.5 self-center text-faint" />
              <span className="text-lg font-semibold tabular text-fg">{money(after)}</span>
              <span className="text-xs text-muted">/ mo</span>
              {changed && Math.abs(diff) >= 0.01 && <span className={cn('text-xs font-medium tabular', diff > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>{diff > 0 ? '+' : '−'}{money(Math.abs(diff), { decimals: true })}</span>}
            </div>
            <Button variant="primary" icon={Scaling} loading={resize.isPending} disabled={!changed || busy || Object.keys(errs).length > 0} onClick={() => resize.mutate()}>Resize</Button>
          </div>
          {used && <p className="text-[11px] text-muted">Currently in use: {num1(+used.cpuCores.toFixed(2))} CPU · {num1(+used.memoryGi.toFixed(1))} GiB · {used.pods} pods{used.loadBalancers ? ` · ${used.loadBalancers} LB` : ''}. You can't shrink below that.</p>}
          {busy && <p className="text-[11px] text-muted">Available when the space is active.</p>}
        </div>
      </Card>

      <Card>
        <CardHeader title="General" />
        <div className="space-y-4 p-4">
          <Field label="Name" error={nameErr} hint="Renaming does not change the namespace or the address.">
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} invalid={!!nameErr} className="max-w-xs" />
              <Button icon={Save} disabled={!name || !!nameErr || name === s.name} loading={patch.isPending} onClick={() => patch.mutate({ name })}>Save</Button>
            </div>
          </Field>
          <Field label="Tags">
            <TagEditor value={tags} onChange={setTags} />
          </Field>
          <Button size="sm" icon={Save} disabled={JSON.stringify(tags) === JSON.stringify(s.tags)} onClick={() => patch.mutate({ tags })}>Save tags</Button>
        </div>
      </Card>

      <Card className="border-rose-500/30">
        <CardHeader title="Delete space" icon={Trash2} description={`Deletes the namespace ${s.namespace}, all workloads and persistent volumes in it. This cannot be undone.`}
          actions={<Button variant="outline-danger" icon={Trash2} disabled={s.status === 'deleting'} onClick={onDelete}>Delete</Button>} />
      </Card>
    </div>
  );
}
