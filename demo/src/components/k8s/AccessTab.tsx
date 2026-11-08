import { useEffect, useState } from 'react';
import { Download, KeyRound, RefreshCw, ShieldCheck, Lock, Users, Shield } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation, useGet } from '@/api/hooks';
import { Card, CardHeader, KeyValue } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Segmented } from '@/components/ui/Tabs';
import { Field, Input, Switch, Hint, TagEditor } from '@/components/ui/form';
import { confirm } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/misc';
import { dateTime, timeAgo } from '@/lib/format';
import { downloadKubeconfig } from './clusterActions';
import { usePro } from '@/store/ui';
import type { K8sCluster, OidcConfig } from '@/types';

interface Kubeconfig { yaml: string; filename: string; issuedAt: string; expiresAt: string | null; generation: number; user: string }

export function AccessTab({ cluster: c, busy }: { cluster: K8sCluster; busy: boolean }) {
  const [mode, setMode] = useState<'admin' | 'oidc'>('admin');
  const [reveal, setReveal] = useState(false);
  const ready = c.status !== 'provisioning';
  const { data: kc, isLoading } = useGet<Kubeconfig>(['k8sClusters', 'kubeconfig', c.id, c.credentialGeneration], ready && (mode === 'admin' || c.oidc) ? `/k8sClusters/${c.id}/kubeconfig?mode=${mode}` : null);
  const [oidc, setOidc] = useState<OidcConfig>(c.oidcConfig ?? { issuerUrl: 'https://', clientId: 'kubernetes', usernameClaim: 'email', groupsClaim: 'groups' });
  const [oidcOn, setOidcOn] = useState(c.oidc);
  const [allowlist, setAllowlist] = useState((c.apiAllowlist ?? []).join(', '));
  const [tags, setTags] = useState(c.tags);
  useEffect(() => { setOidcOn(c.oidc); if (c.oidcConfig) setOidc(c.oidcConfig) }, [c.oidc, c.oidcConfig?.issuerUrl]); // eslint-disable-line
  useEffect(() => { if (!c.oidc && mode === 'oidc') setMode('admin') }, [c.oidc, mode]);

  const patch = useApiMutation((body: Partial<K8sCluster>) => api.update('k8sClusters', c.id, body), { success: 'Settings saved' });
  const rotate = useApiMutation(() => api.action('k8sClusters', c.id, 'rotateCredentials'), { success: 'Rotating credentials' });
  const onRotate = async () => {
    const ok = await confirm({ title: 'Rotate cluster credentials?', message: 'A new CA and admin certificate are issued and the current admin kubeconfig stops working. Service-account tokens get a grace period. OIDC users are not affected.', confirmLabel: 'Rotate', danger: true });
    if (ok) rotate.mutate();
  };
  const masked = kc && !reveal ? kc.yaml.replace(/(-data: )(\S{12})\S+/g, '$1$2••••••••••••••••••••') : kc?.yaml;
  const ctx = c.name;
  const pro = usePro();

  if (!pro) {
    return (
      <div className="max-w-3xl space-y-5">
        <Card>
          <CardHeader title="Connect with kubectl" icon={KeyRound} description="Download the kubeconfig file and point kubectl at it." />
          <div className="space-y-4 p-4">
            {!ready ? <Hint>The kubeconfig is ready when the cluster finishes provisioning.</Hint> : (
              <>
                <Button variant="primary" icon={Download} onClick={() => downloadKubeconfig(c, 'admin')}>Download kubeconfig</Button>
                <CodeBlock language="bash" code={[
                  `export KUBECONFIG=~/Downloads/${c.name}-kubeconfig.yaml`,
                  `kubectl get nodes`,
                ].join('\n')} />
                <p className="text-xs text-muted">Keep this file secret: it gives full admin access to the cluster.{kc?.expiresAt ? ` Valid until ${dateTime(kc.expiresAt)}.` : ''}</p>
              </>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Credentials" icon={ShieldCheck} description={c.credentialsRotatedAt ? `Last rotated ${timeAgo(c.credentialsRotatedAt)}` : 'Never rotated'}
            actions={<Button size="sm" icon={RefreshCw} loading={rotate.isPending} disabled={busy || !ready} onClick={onRotate}>Rotate</Button>} />
          <p className="px-4 pb-4 text-xs text-muted">Rotate if a kubeconfig may have leaked. The old file stops working.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid items-start gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-5">
        <Card>
          <CardHeader title="kubeconfig" icon={KeyRound} description="Credentials for kubectl, Helm, Lens, k9s and CI pipelines."
            actions={<Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'admin', label: 'Admin cert' }, ...(c.oidc ? [{ value: 'oidc' as const, label: 'OIDC (SSO)' }] : [])]} />} />
          <div className="space-y-3 p-4">
            {!ready ? <Hint>The kubeconfig is generated when the cluster finishes provisioning.</Hint> : isLoading || !kc ? <Skeleton className="h-64" /> : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" icon={Download} onClick={() => downloadKubeconfig(c, mode)}>Download {kc.filename}</Button>
                  <Button variant="ghost" size="sm" onClick={() => setReveal(!reveal)}>{reveal ? 'Hide' : 'Reveal'} secrets</Button>
                  <span className="ml-auto text-xs text-muted">{mode === 'admin' ? <>user <span className="font-mono">{kc.user}</span> · expires {dateTime(kc.expiresAt)}</> : 'short-lived tokens via your IdP'}</span>
                </div>
                <CodeBlock code={masked ?? ''} language="yaml" maxHeight="max-h-80" />
              </>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Quick start" />
          <div className="p-4">
            <CodeBlock language="bash" code={[
              `# save the kubeconfig and use it`,
              `mv ~/Downloads/${c.name}-kubeconfig.yaml ~/.kube/${c.name}.yaml`,
              `export KUBECONFIG=~/.kube/${c.name}.yaml`,
              `kubectl get nodes -o wide`,
              ``,
              `# or with the Autark CLI (merges into ~/.kube/config)`,
              `autark k8s kubeconfig ${c.name} --merge${mode === 'oidc' ? ' --oidc' : ''}`,
              `kubectl config use-context ${ctx}`,
              ...(c.oidc ? ['', '# OIDC login needs the kubelogin plugin', 'kubectl krew install oidc-login'] : []),
            ].join('\n')} />
          </div>
        </Card>
        {c.oidc && (
          <Card>
            <CardHeader title="Map SSO groups to RBAC" icon={Users} />
            <div className="p-4">
              <CodeBlock language="bash" code={[
                `kubectl create clusterrolebinding platform-admins \\`,
                `  --clusterrole=cluster-admin --group=${c.oidcConfig?.groupsPrefix ?? ''}platform-admins`,
                `kubectl create rolebinding devs-edit -n default \\`,
                `  --clusterrole=edit --group=${c.oidcConfig?.groupsPrefix ?? ''}developers`,
              ].join('\n')} />
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Credentials" icon={ShieldCheck} />
          <div className="space-y-3 p-4">
            <KeyValue cols={2} items={[
              ['Generation', <Badge>#{c.credentialGeneration ?? 1}</Badge>],
              ['Last rotated', c.credentialsRotatedAt ? timeAgo(c.credentialsRotatedAt) : 'never'],
              ['Issued', kc ? dateTime(kc.issuedAt) : '—'],
              ['Cert expiry', kc?.expiresAt ? dateTime(kc.expiresAt) : '—'],
            ]} />
            <Button className="w-full" icon={RefreshCw} loading={rotate.isPending} disabled={busy || !ready} onClick={onRotate}>Rotate credentials</Button>
            <p className="text-[11px] text-muted">Rotate when a kubeconfig may have leaked or a team member left. Takes ~1 minute.</p>
          </div>
        </Card>
        <Card>
          <CardHeader title="OIDC single sign-on" icon={Users} />
          <div className="space-y-3 p-4">
            <Switch checked={oidcOn} onChange={setOidcOn} label="Enable OIDC" description="kubectl authenticates through your identity provider." />
            {oidcOn && (
              <>
                <Field label="Issuer URL"><Input value={oidc.issuerUrl} onChange={(e) => setOidc({ ...oidc, issuerUrl: e.target.value })} mono /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Client ID"><Input value={oidc.clientId} onChange={(e) => setOidc({ ...oidc, clientId: e.target.value })} mono /></Field>
                  <Field label="Groups prefix" optional><Input value={oidc.groupsPrefix ?? ''} onChange={(e) => setOidc({ ...oidc, groupsPrefix: e.target.value })} mono placeholder="oidc:" /></Field>
                  <Field label="Username claim"><Input value={oidc.usernameClaim} onChange={(e) => setOidc({ ...oidc, usernameClaim: e.target.value })} mono /></Field>
                  <Field label="Groups claim"><Input value={oidc.groupsClaim} onChange={(e) => setOidc({ ...oidc, groupsClaim: e.target.value })} mono /></Field>
                </div>
              </>
            )}
            <Button className="w-full" variant="primary" loading={patch.isPending} disabled={oidcOn === c.oidc && JSON.stringify(oidc) === JSON.stringify(c.oidcConfig ?? null)} onClick={() => patch.mutate({ oidc: oidcOn, oidcConfig: oidcOn ? oidc : c.oidcConfig ?? null })}>Save OIDC</Button>
          </div>
        </Card>
        <Card>
          <CardHeader title="API access" icon={Lock} />
          <div className="space-y-3 p-4">
            <Switch checked={!!c.privateEndpoint} onChange={(v) => patch.mutate({ privateEndpoint: v })} label="Private endpoint only" description="Reachable from the VPC / VPN only." />
            <Field label="Allowed CIDRs" hint="Who may reach the public API endpoint">
              <Input value={allowlist} onChange={(e) => setAllowlist(e.target.value)} mono disabled={!!c.privateEndpoint} />
            </Field>
            {allowlist.includes('0.0.0.0/0') && !c.privateEndpoint && <Hint tone="warning">The API is reachable from the whole internet (still requires credentials).</Hint>}
            <Button size="sm" className="w-full" disabled={allowlist === (c.apiAllowlist ?? []).join(', ')} onClick={() => patch.mutate({ apiAllowlist: allowlist.split(/[,\s]+/).filter(Boolean) })}>Save allowlist</Button>
          </div>
        </Card>
        <Card>
          <CardHeader title="Tags" icon={Shield} />
          <div className="space-y-3 p-4">
            <Field label="Tags"><TagEditor value={tags} onChange={setTags} /></Field>
            <Button size="sm" className="w-full" disabled={JSON.stringify(tags) === JSON.stringify(c.tags)} onClick={() => patch.mutate({ tags })}>Save tags</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
