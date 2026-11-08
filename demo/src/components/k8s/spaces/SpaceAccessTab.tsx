import { useState } from 'react';
import { Download, KeyRound, RefreshCw, ShieldCheck, Users, Trash2, UserPlus, Terminal } from 'lucide-react';
import { api } from '@/api/client';
import { useApiMutation, useGet, useList } from '@/api/hooks';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Select, Hint } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { confirm } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/misc';
import { usePro } from '@/store/ui';
import { timeAgo } from '@/lib/format';
import type { K8sSpace, User } from '@/types';
import { downloadSpaceKubeconfig, type SpaceKubeconfig, type SpaceView } from './spaceUi';

type Role = 'edit' | 'view';

export function SpaceAccessTab({ space: s }: { space: SpaceView }) {
  const pro = usePro();
  const ready = s.status !== 'provisioning' && s.status !== 'deleting';
  const [reveal, setReveal] = useState(false);
  const { data: kc, isLoading, error } = useGet<SpaceKubeconfig>(['k8sSpaces', 'kubeconfig', s.id, s.credentialGeneration], ready ? `/k8sSpaces/${s.id}/kubeconfig` : null);
  const { items: users } = useList<User>('users');
  const [addUser, setAddUser] = useState('');
  const [addRole, setAddRole] = useState<Role>('edit');

  const rotate = useApiMutation(() => api.action('k8sSpaces', s.id, 'rotateCredentials'), { success: 'Credentials rotated — download the new kubeconfig' });
  const patchTeam = useApiMutation((team: K8sSpace['team']) => api.update('k8sSpaces', s.id, { team }), { success: 'Team access updated' });

  const onRotate = async () => {
    const ok = await confirm({ title: 'Rotate credentials?', message: `A new token is issued for ${s.serviceAccount}. The current kubeconfig (and any CI pipeline using it) stops working.`, confirmLabel: 'Rotate', danger: true });
    if (ok) rotate.mutate();
  };
  const file = kc?.filename ?? `${s.name}-kubeconfig.yaml`;
  const download = () => downloadSpaceKubeconfig(s);
  const masked = kc && !reveal ? kc.yaml.replace(/((?:token|client-key-data|client-certificate-data|certificate-authority-data): )(\S{10})\S+/g, '$1$2••••••••••••••••') : kc?.yaml;

  // flatten team bindings to member rows
  const members = s.team.flatMap((b) => b.userIds.map((id) => ({ id, role: b.role })));
  const setMembers = (list: { id: string; role: Role }[]) => {
    const team: K8sSpace['team'] = (['edit', 'view'] as Role[]).map((role) => ({ role, userIds: list.filter((m) => m.role === role).map((m) => m.id) })).filter((b) => b.userIds.length);
    patchTeam.mutate(team);
  };
  const userName = (id: string) => users.find((u) => u.id === id);
  const addable = users.filter((u) => u.status !== 'disabled' && !members.some((m) => m.id === u.id) && (u.projectIds === '*' || u.projectIds.includes(s.projectId)));

  return (
    <div className="grid items-start gap-5 @min-[60rem]:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-5">
        <Card>
          <CardHeader title="kubeconfig" icon={KeyRound} description={pro ? `Namespaced credentials for ${s.serviceAccount} — works with kubectl, Helm, k9s and CI.` : 'The file kubectl needs to reach your space.'} />
          <div className="space-y-3 p-4">
            {!ready ? <Hint>The kubeconfig is ready as soon as the space is created.</Hint>
              : error ? <Hint tone="warning">Could not load the kubeconfig: {(error as Error).message}</Hint>
              : isLoading || !kc ? <Skeleton className="h-48" /> : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="primary" icon={Download} onClick={download}>Download {file}</Button>
                    <Button variant="ghost" size="sm" onClick={() => setReveal(!reveal)}>{reveal ? 'Hide' : 'Reveal'} secrets</Button>
                    {pro && <span className="ml-auto text-xs text-muted">user <span className="font-mono">{kc.user}</span></span>}
                  </div>
                  <CodeBlock code={masked ?? ''} language="yaml" maxHeight={pro ? 'max-h-80' : 'max-h-56'} />
                  <p className="text-xs text-muted">Keep this file secret: anyone with it can deploy to {s.namespace}.</p>
                </>
              )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Quick start" icon={Terminal} />
          <div className="p-4">
            <CodeBlock language="bash" code={[
              `# use the downloaded file directly`,
              `kubectl --kubeconfig ~/Downloads/${file} get pods -n ${s.namespace}`,
              ``,
              `# or make it your default`,
              `mv ~/Downloads/${file} ~/.kube/${s.name}.yaml`,
              `export KUBECONFIG=~/.kube/${s.name}.yaml`,
              `kubectl create deployment web --image=nginx:1.27-alpine --replicas=2`,
              `kubectl expose deployment web --port=80`,
              `kubectl create ingress web --rule="${s.ingressHost.replace(/^\*\./, 'web.')}/*=web:80"`,
              ...(pro ? ['', '# with the Autark CLI', `autark k8s space kubeconfig ${s.name} --merge`] : []),
            ].join('\n')} />
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Credentials" icon={ShieldCheck}
            actions={<Button size="sm" icon={RefreshCw} loading={rotate.isPending} disabled={!ready} onClick={onRotate}>Rotate</Button>} />
          <p className="px-4 pb-4 text-xs text-muted">{s.credentialsRotatedAt ? `Last rotated ${timeAgo(s.credentialsRotatedAt)}. ` : ''}Rotate if the kubeconfig may have leaked. The old file stops working immediately.</p>
        </Card>
        <Card>
          <CardHeader title="Team access" icon={Users} description={pro ? 'RoleBindings in the namespace; people sign in with SSO.' : 'People who can use this space with their own login.'} />
          <ul className="divide-y divide-line border-t border-line">
            {members.map((m) => {
              const u = userName(m.id);
              return (
                <li key={`${m.id}-${m.role}`} className="flex items-center gap-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-fg">{u?.name ?? m.id}</div>
                    {u && <div className="truncate text-[11px] text-muted">{u.email}</div>}
                  </div>
                  <Segmented size="sm" value={m.role} onChange={(role) => setMembers(members.map((x) => (x.id === m.id ? { ...x, role } : x)))} options={[{ value: 'edit', label: 'Edit' }, { value: 'view', label: 'View' }]} />
                  <IconButton icon={Trash2} label="Remove" size="sm" onClick={() => setMembers(members.filter((x) => x.id !== m.id))} />
                </li>
              );
            })}
            {members.length === 0 && <li className="px-4 py-4 text-center text-xs text-muted">Only the kubeconfig has access.</li>}
          </ul>
          <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
            <Select className="min-w-0 flex-1" value={addUser} onChange={(e) => setAddUser(e.target.value)} placeholder="Add a person…" options={addable.map((u) => ({ value: u.id, label: u.name }))} />
            <Select className="w-24" value={addRole} onChange={(e) => setAddRole(e.target.value as Role)} options={[{ value: 'edit', label: 'Edit' }, { value: 'view', label: 'View' }]} />
            <Button size="sm" icon={UserPlus} disabled={!addUser} loading={patchTeam.isPending} onClick={() => { setMembers([...members, { id: addUser, role: addRole }]); setAddUser('') }}>Add</Button>
          </div>
          <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-3 text-[11px] text-muted">
            <Badge>edit</Badge> deploy, scale, read secrets <Badge className="ml-2">view</Badge> read only
          </div>
        </Card>
      </div>
    </div>
  );
}
