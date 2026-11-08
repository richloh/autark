import { useEffect, useState } from 'react';
import { ArrowUpCircle, CalendarClock, Check, Bell, Save, Sparkles } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation, useGet } from '@/api/hooks';
import { usePro } from '@/store/ui';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Select, Hint } from '@/components/ui/form';
import { confirm } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { date } from '@/lib/format';
import { K8S_VERSIONS } from '@/types';
import { DAYS, type PlatformClusterView, type TenantRow } from './shared';

export function PcUpgrades({ pc, busy }: { pc: PlatformClusterView; busy: boolean }) {
  const pro = usePro();
  const { data: tenants } = useGet<{ items: TenantRow[] }>(['k8sSpaces', 'tenants', pc.id], `/platformClusters/${pc.id}/tenants`);
  const accounts = [...new Set((tenants?.items ?? []).map((t) => t.accountName))];
  const path = [...K8S_VERSIONS].reverse();
  const curIdx = path.findIndex((v) => v.version === pc.version);
  const next = pc.upgradeAvailable ? K8S_VERSIONS.find((v) => v.version === pc.upgradeAvailable) : null;
  const cur = K8S_VERSIONS.find((v) => v.version === pc.version);
  const eosDays = cur ? Math.round((Date.parse(cur.endOfSupport) - Date.now()) / 86_400_000) : null;
  const [mw, setMw] = useState(pc.maintenanceWindow);
  useEffect(() => { setMw(pc.maintenanceWindow) }, [pc.maintenanceWindow.day, pc.maintenanceWindow.hour]); // eslint-disable-line react-hooks/exhaustive-deps

  const upgrade = useApiMutation(() => api.action<{ notifiedAccounts: number }>('platformClusters', pc.id, 'upgrade', { version: next?.version }), {
    success: (r) => `Upgrade to ${next?.version} started — ${r.notifiedAccounts} tenant account${r.notifiedAccounts === 1 ? '' : 's'} notified`,
  });
  const saveMw = useApiMutation(() => api.update('platformClusters', pc.id, { maintenanceWindow: mw }), { success: 'Maintenance window saved' });
  const start = async () => {
    const ok = await confirm({
      title: `Upgrade ${pc.name} to ${next?.version}?`,
      message: `Control plane first, then every worker node is surge-replaced one by one. Tenant pods are rescheduled (PodDisruptionBudgets are respected). ${accounts.length} tenant account${accounts.length === 1 ? '' : 's'} (${accounts.join(', ') || 'none'}) will be notified now.`,
      confirmLabel: 'Start upgrade',
    });
    if (ok) upgrade.mutate();
  };

  return (
    <div className="grid [&>*]:min-w-0 gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <Card>
          <CardHeader title="Version" icon={ArrowUpCircle} description="Platform clusters upgrade one minor version at a time." />
          <CardBody className="space-y-5">
            <ol className="flex items-center overflow-x-auto pb-1">
              {path.map((v, i) => {
                const done = i < curIdx; const current = i === curIdx; const isNext = v.version === next?.version;
                return (
                  <li key={v.version} className="flex shrink-0 items-center">
                    {i > 0 && <span className={cn('h-0.5 w-8 @min-[36rem]:w-14', i <= curIdx ? 'bg-brand-500' : 'bg-line')} />}
                    <div className="flex flex-col items-center gap-1 px-1">
                      <span className={cn('flex size-9 items-center justify-center rounded-full border-2 text-xs font-semibold tabular',
                        current ? 'border-brand-500 bg-brand-500 text-white' : done ? 'border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-300' : isNext ? 'border-dashed border-brand-500 text-brand-600 dark:text-brand-300' : 'border-line text-faint')}>
                        {done ? <Check className="size-4" /> : v.version}
                      </span>
                      <span className={cn('text-[10.5px]', current ? 'font-medium text-fg' : 'text-muted')}>{current ? 'current' : isNext ? 'next' : v.status}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
            {pc.status === 'upgrading' ? (
              <Hint>Upgrade in progress — see the operation above. Nodes show their kubelet version under Nodes &amp; pools.</Hint>
            ) : next ? (
              <div className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-fg">Kubernetes {next.patch} <Badge tone="brand">{next.status}</Badge></div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted"><Bell className="size-3.5" />Upgrade notifies {accounts.length} tenant account{accounts.length === 1 ? '' : 's'}</div>
                  </div>
                  <Button variant="primary" icon={ArrowUpCircle} disabled={busy} loading={upgrade.isPending} onClick={start}>Upgrade to {next.version}</Button>
                </div>
                {pro && (
                  <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[13px] text-fg-2">
                    {next.highlights.map((h) => <li key={h} className="flex gap-2"><Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand-500" />{h}</li>)}
                  </ul>
                )}
              </div>
            ) : (
              <Hint tone="success">{pc.name} runs the latest supported version.</Hint>
            )}
            {cur && eosDays != null && (
              <p className={cn('text-xs', eosDays < 90 ? 'text-amber-600 dark:text-amber-400' : 'text-muted')}>
                {cur.version} is supported until {date(cur.endOfSupport)}{eosDays < 0 ? ' — end of support has passed, upgrade soon.' : eosDays < 90 ? ` — ${eosDays} days left.` : '.'}
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader title="Maintenance window" icon={CalendarClock} description="Platform upgrades and node replacements start in this window. Tenants see it on their spaces." />
          <CardBody className="space-y-3">
            <div className="grid [&>*]:min-w-0 grid-cols-2 gap-3">
              <Field label="Day"><Select value={mw.day} onChange={(e) => setMw({ ...mw, day: e.target.value })} options={Object.entries(DAYS).map(([value, label]) => ({ value, label }))} /></Field>
              <Field label="Start (UTC)"><Select value={String(mw.hour)} onChange={(e) => setMw({ ...mw, hour: Number(e.target.value) })} options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }))} /></Field>
            </div>
            <div className="flex justify-end">
              <Button size="sm" icon={Save} disabled={mw.day === pc.maintenanceWindow.day && mw.hour === pc.maintenanceWindow.hour} loading={saveMw.isPending} onClick={() => saveMw.mutate()}>Save</Button>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Affected tenants" icon={Bell} />
          <CardBody>
            {accounts.length ? (
              <ul className="space-y-1.5 text-[13px]">
                {accounts.map((a) => {
                  const n = (tenants?.items ?? []).filter((t) => t.accountName === a).length;
                  return <li key={a} className="flex justify-between gap-2"><span className="text-fg">{a}</span><span className="text-xs text-muted">{n} space{n === 1 ? '' : 's'}</span></li>;
                })}
              </ul>
            ) : <p className="text-xs text-muted">No tenants yet — upgrades affect nobody.</p>}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
