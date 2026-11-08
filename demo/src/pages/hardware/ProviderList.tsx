import { Link } from 'react-router';
import { Cloud, Plus, RefreshCw, AlertTriangle, Server, MapPin, Wallet, PlugZap, ArrowRight, KeyRound } from 'lucide-react';
import { useList, useApiMutation } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';
import { Stat } from '@/components/ui/Stat';
import { Meter, Skeleton, EmptyState } from '@/components/ui/misc';
import { OperationInline } from '@/components/resource/OperationRunner';
import { Pro } from '@/components/ui/Pro';
import { usePro } from '@/store/ui';
import { ProviderLogo, RegionMap, PROVIDER_STYLE } from '@/components/hardware/providers';
import { flag } from '@/components/hardware/visuals';
import { money, timeAgo, num } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { CloudProvider, Location, Operation } from '@/types';

export default function ProviderList() {
  const pro = usePro();
  const { items: providers, isLoading } = useList<CloudProvider>('providers');
  const { items: locations } = useList<Location>('locations');
  const { items: ops } = useList<Operation>('operations', { status: 'running' });
  const opBy = new Map(ops.filter((o) => o.target.type === 'provider').map((o) => [o.target.id, o]));
  const sync = useApiMutation((id: string) => api.action('providers', id, 'sync'), { success: 'Sync started' });

  const connected = providers.filter((p) => p.status === 'connected').length;
  const broken = providers.filter((p) => p.status === 'error');
  const regions = providers.reduce((a, p) => a + p.regions.length, 0);
  const vms = providers.reduce((a, p) => a + (p.usage?.vms ?? 0), 0);
  const vcpus = providers.reduce((a, p) => a + (p.usage?.vcpus ?? 0), 0);
  const cost = providers.reduce((a, p) => a + (p.usage?.monthlyCost ?? 0), 0);
  const own = locations.filter((l) => l.kind === 'selfHosted');

  const mapRegions = providers.flatMap((p) => p.availableRegions.filter((r) => p.regions.includes(r.code)).map((r) => ({ ...r, code: `${PROVIDER_STYLE[p.kind]?.label ?? p.kind} ${r.code}`, selected: true })));

  return (
    <Page wide>
      <PageHeader
        title="Cloud Providers"
        description={pro ? 'Burst capacity from public clouds, exposed as extra locations. Autark only uses portable primitives — VMs, volumes, networks and IPs — so you can leave any time.' : 'Extra capacity from public clouds. Each region shows up as a location.'}
        icon={Cloud}
        iconColor="#0ea5e9"
        actions={<Button variant="primary" icon={Plus} to="/hardware/cloud-providers/new">Connect provider</Button>}
      />

      <Pro>
      <div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Connected" value={`${connected} / ${providers.length}`} icon={PlugZap} sub={broken.length ? <span className="text-rose-500">{broken.length} need attention</span> : 'all healthy'} />
        <Stat label="Burst regions" value={num(regions)} icon={MapPin} sub={`next to ${own.length} own data centers`} />
        <Stat label="VMs in the cloud" value={num(vms)} icon={Server} sub={`${num(vcpus)} vCPU allocated`} />
        <Stat label="Cloud run-rate" value={money(cost)} icon={Wallet} sub="compute in provider regions" accent="#0ea5e9" />
      </div>
      </Pro>

      {broken.map((p) => (
        <div key={p.id} className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-900 dark:text-rose-200">
          <AlertTriangle className="size-4 shrink-0" />
          <div className="min-w-0 flex-1"><b className="font-semibold">{p.name}</b> — {p.lastError ?? 'connection error'}.{pro ? ' VMs already running there are unaffected, but new placements and syncs fail.' : ' Running VMs are not affected.'}</div>
          <Button size="sm" icon={KeyRound} to={`/hardware/cloud-providers/${p.id}?tab=credentials`}>Rotate credentials</Button>
        </div>
      ))}

      {isLoading ? <Skeleton className="h-72 rounded-xl" /> : providers.length === 0 ? (
        <Card><EmptyState icon={Cloud} title="No cloud providers connected" description="Connect Hetzner, AWS, OVHcloud, Scaleway, IONOS or any OpenStack cloud to burst beyond your own hardware." action={<Button variant="primary" icon={Plus} to="/hardware/cloud-providers/new">Connect provider</Button>} /></Card>
      ) : (
        <>
          {pro && <Card className="mb-5">
            <CardHeader title="Footprint" icon={MapPin} description="Your data centers (squares) and enabled burst regions (dots)." />
            <div className="p-3">
              <RegionMap height={260} regions={mapRegions} color="#0ea5e9" extra={own.map((l) => ({ id: l.id, label: l.name, lat: l.lat, lon: l.lon, color: '#10b981' }))} />
            </div>
          </Card>}

          <div className="grid gap-4 @min-[40rem]:grid-cols-2 @min-[60rem]:grid-cols-3">
            {providers.map((p) => {
              const op = opBy.get(p.id);
              const u = p.usage ?? { vcpus: 0, ramGB: 0, vms: 0, ips: 0, monthlyCost: 0 };
              return (
                <Link key={p.id} to={`/hardware/cloud-providers/${p.id}`} className={cn('group relative flex flex-col overflow-hidden rounded-xl border bg-surface shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop', p.status === 'error' ? 'border-rose-500/40' : 'border-line')}>
                  <div className="absolute inset-x-0 top-0 h-1" style={{ background: PROVIDER_STYLE[p.kind]?.bg }} />
                  <div className="flex items-start gap-3 p-4 pb-3">
                    <ProviderLogo kind={p.kind} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-fg group-hover:text-brand-500">{p.name}</span>
                        <StatusPill status={p.status} />
                      </div>
                      <div className="mt-0.5 text-xs text-muted">{pro ? `${p.credentials.label} · ${p.allowedServices.join(', ')}` : `${p.regions.length} region${p.regions.length === 1 ? '' : 's'} · ${u.vms} VM${u.vms === 1 ? '' : 's'}`}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 px-4">
                    {p.regions.map((code) => {
                      const r = p.availableRegions.find((x) => x.code === code);
                      const n = p.locations?.find((l) => l.region === code)?.vms ?? 0;
                      return <span key={code} className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-2">{flag(r?.country)} {code}{n > 0 && <span className="rounded bg-brand-500/10 px-1 text-[10px] font-semibold text-brand-600 dark:text-brand-300">{n}</span>}</span>;
                    })}
                    {pro && <span className="inline-flex items-center px-1 text-[11px] text-faint">+{p.availableRegions.length - p.regions.length} available</span>}
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 px-4">
                    {([['vCPU', u.vcpus, p.quotas.vcpus], ['RAM GB', u.ramGB, p.quotas.ramGB], ['VMs', u.vms, p.quotas.vms]] as const).map(([l, v, q]) => (
                      <div key={l}>
                        <div className="mb-1 flex justify-between text-[10.5px]"><span className="text-muted">{l}</span><span className="tabular text-fg-2">{v}/{q}</span></div>
                        <Meter value={v} max={q || 1} size="sm" />
                      </div>
                    ))}
                  </div>
                  {p.status === 'error' && p.lastError && <div className="mx-4 mt-3 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11.5px] text-rose-700 dark:text-rose-300">{p.lastError}</div>}
                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 pt-2.5 text-xs text-muted" style={{ marginTop: 16 }}>
                    {op ? <OperationInline op={op} className="flex-1" /> : (
                      <>
                        <span>{pro && <>{p.lastSyncAt ? `Synced ${timeAgo(p.lastSyncAt)}` : 'Never synced'} · </>}<span className="tabular text-fg-2">{money(u.monthlyCost)}/mo</span></span>
                        {pro && <Button size="xs" variant="ghost" icon={RefreshCw} disabled={p.status === 'disabled'} onClick={(e) => { e.preventDefault(); e.stopPropagation(); sync.mutate(p.id) }}>Sync</Button>}
                      </>
                    )}
                  </div>
                </Link>
              );
            })}
            <Link to="/hardware/cloud-providers/new" className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong text-muted transition-colors hover:border-brand-500 hover:text-brand-500">
              <Plus className="size-6" />
              <span className="text-sm font-medium">Connect another provider</span>
              <span className="flex items-center gap-1 text-xs">Hetzner, AWS, OVH, Scaleway, IONOS, OpenStack <ArrowRight className="size-3" /></span>
            </Link>
          </div>
        </>
      )}
    </Page>
  );
}
