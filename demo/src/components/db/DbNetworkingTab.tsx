import { useEffect, useState } from 'react';
import { Globe2, Network as NetIcon, Plus, Save, Shield } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation, useItem, useList } from '@/api/hooks';
import { Card, CardHeader, KeyValue } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { confirm } from '@/components/ui/Modal';
import { Field, MultiSelect, Switch, Hint } from '@/components/ui/form';
import { Mono } from '@/components/ui/misc';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { useFirewallOptions } from '@/components/resource/pickers';
import type { DbInstance, Firewall, Network } from '@/types';

export function DbNetworkingTab({ d }: { d: DbInstance }) {
  const { data: net } = useItem<Network>('networks', d.networkId);
  const subnet = net?.subnets.find((s) => s.id === d.subnetId);
  const options = useFirewallOptions(d.projectId);
  const { items: firewalls } = useList<Firewall>('firewalls');
  const [fwIds, setFwIds] = useState(d.firewallIds);
  useEffect(() => setFwIds(d.firewallIds), [d.firewallIds.join()]); // eslint-disable-line
  const dirty = fwIds.join() !== d.firewallIds.join();

  const saveFw = useApiMutation(() => api.action('dbInstances', d.id, 'setFirewalls', { firewallIds: fwIds }), { success: 'Firewalls updated' });
  const setPublic = useApiMutation((enabled: boolean) => api.action('dbInstances', d.id, 'setPublicAccess', { enabled }), { success: (_r, en) => (en ? 'Public endpoint enabled' : 'Public endpoint disabled') });

  const togglePublic = async (v: boolean) => {
    if (v && !(await confirm({ title: 'Expose this database publicly?', message: 'A public endpoint is created. Only sources allowed by the attached firewalls can connect, and TLS is enforced. Prefer private networking or a VPN where possible.', confirmLabel: 'Enable public access' }))) return;
    setPublic.mutate(v);
  };

  const attached = firewalls.filter((f) => d.firewallIds.includes(f.id));
  const port = String(d.port);
  const portRules = attached.flatMap((f) => f.rules.filter((r) => r.enabled && r.direction === 'inbound' && r.action === 'allow' && (r.ports === '*' || r.ports.split(',').some((p) => p.trim() === port || (p.includes('-') && Number(p.split('-')[0]) <= d.port && Number(p.split('-')[1]) >= d.port)))).map((r) => ({ fw: f.name, r })));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader icon={NetIcon} title="Network" description="Instances live in your VPC; clients in the same (or peered) network connect over the private address." />
        <div className="p-4">
          <KeyValue cols={3} items={[
            ['Network', <ResourceLink type="network" id={d.networkId} name={net ? `${net.name} · ${net.cidr}` : d.networkId} />],
            ['Subnet', subnet ? `${subnet.name} · ${subnet.cidr}` : d.subnetId],
            ['Private IP', d.privateIp ? <Mono copy>{d.privateIp}</Mono> : null],
            ['Private hostname', <Mono copy>{d.host}</Mono>],
            ['Port', <Mono>{port}</Mono>],
            ['Public hostname', d.publicHost ? <Mono copy>{d.publicHost}</Mono> : <span className="text-faint">disabled</span>],
            ...(d.readReplicas ? [['Read-only endpoint', <Mono copy>{d.host.replace(`${d.name}.`, `${d.name}-ro.`)}</Mono>]] as [string, React.ReactNode][] : []),
            ...(net?.dnsZoneId ? [['Private DNS', <Mono>{`${d.name}.db (zone)`}</Mono>]] as [string, React.ReactNode][] : []),
          ]} />
        </div>
      </Card>

      <Card>
        <CardHeader icon={Shield} title="Firewalls" description="Rules from all attached firewalls are merged. Default inbound policy is deny."
          actions={<>
            <Button size="sm" variant="ghost" icon={Plus} to="/infrastructure/firewalls/new">New</Button>
            <Button size="sm" variant="primary" icon={Save} disabled={!dirty} loading={saveFw.isPending} onClick={() => saveFw.mutate()}>Save</Button>
          </>} />
        <div className="space-y-4 p-4">
          <Field label="Attached firewalls">
            <MultiSelect options={options} value={fwIds} onChange={setFwIds} placeholder="No firewall (only same-VPC traffic allowed by default)" emptyText="No firewalls in this project" />
          </Field>
          <div>
            <div className="mb-2 text-xs font-medium text-muted">Effective inbound rules for port {port}</div>
            {portRules.length === 0 ? (
              <Hint tone="warning">No attached rule allows port {port}. Clients outside the database subnet cannot connect.</Hint>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {portRules.map(({ fw, r }) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                    <Badge tone="success">allow</Badge>
                    <span className="font-mono text-fg">{r.protocol}/{r.ports}</span>
                    <span className="text-muted">from</span>
                    <span className="font-mono text-fg">{r.source}</span>
                    <span className="ml-auto text-xs text-faint">{fw}{r.description ? ` · ${r.description}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader icon={Globe2} title="Public access" />
        <div className="space-y-3 p-4">
          <Switch checked={d.publicAccess} disabled={setPublic.isPending || (!d.publicAccess && !d.firewallIds.length)} onChange={togglePublic}
            label="Public endpoint" description={d.publicAccess ? `Reachable at ${d.publicHost}:${d.port} for sources allowed by the firewalls.` : 'Expose a TLS-only endpoint on the internet, restricted by firewall rules.'} />
          {!d.publicAccess && !d.firewallIds.length && <Hint tone="info">Attach a firewall that restricts sources before enabling public access.</Hint>}
        </div>
      </Card>
    </div>
  );
}
