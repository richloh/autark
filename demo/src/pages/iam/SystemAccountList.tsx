import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Bot, Plus, MoreHorizontal, KeyRound, Ban, CheckCircle2, Trash2, Clock, ShieldAlert, Network, Eye } from 'lucide-react';
import { useList, useLookup, useApiMutation, useNow } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusPill, Badge } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Stat } from '@/components/ui/Stat';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { BotAvatar } from '@/components/iam/Avatar';
import { RoleChips, ProjectScope } from '@/components/iam/RoleChips';
import { CreateSystemAccountModal } from '@/components/iam/CreateSystemAccountModal';
import { timeAgo, dateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { SystemAccount, Role, Project } from '@/types';

const DAY = 86_400_000;

export default function SystemAccountList() {
  const [sp, setSp] = useSearchParams();
  const now = useNow(60_000);
  const { items: svcs, isLoading } = useList<SystemAccount>('systemAccounts');
  const { map: roles } = useLookup<Role>('roles');
  const { map: projects } = useLookup<Project>('projects');
  const creating = sp.get('new') === '1';
  const setCreating = (v: boolean) => { const n = new URLSearchParams(sp); if (v) n.set('new', '1'); else n.delete('new'); setSp(n, { replace: true }) };

  const stats = useMemo(() => {
    const tokens = svcs.flatMap((s) => s.tokens.filter((t) => t.status === 'active').map((t) => ({ ...t, svc: s })));
    return {
      active: tokens.length,
      expiring: tokens.filter((t) => t.expiresAt && Date.parse(t.expiresAt) - now < 14 * DAY),
      noExpiry: tokens.filter((t) => !t.expiresAt),
      open: svcs.filter((s) => !s.ipAllowlist.length),
    };
  }, [svcs, now]);

  const act = useApiMutation(({ id, a }: { id: string; a: string }) => api.action('systemAccounts', id, a), { success: (_r, v) => (v.a === 'disable' ? 'System account disabled' : 'System account enabled') });
  const remove = async (list: SystemAccount[]) => {
    const tokens = list.reduce((a, s) => a + s.tokens.filter((t) => t.status === 'active').length, 0);
    if (!(await confirm({
      title: list.length === 1 ? `Delete ${list[0].name}?` : `Delete ${list.length} system accounts?`,
      message: `${tokens} active token${tokens === 1 ? '' : 's'} will stop working immediately. Pipelines using them will fail.`,
      confirmLabel: 'Delete', danger: true, typeToConfirm: list.length === 1 ? list[0].name : undefined,
    }))) return;
    const res = await Promise.allSettled(list.map((s) => api.remove('systemAccounts', s.id)));
    const failed = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) toast.error(`${failed.length} deletion(s) failed`, failed[0].reason?.message);
    else toast.success(`Deleted ${list.length} system account${list.length > 1 ? 's' : ''}`);
  };

  const columns: Column<SystemAccount>[] = [
    {
      id: 'name', header: 'System account', sort: (s) => s.name,
      cell: (s) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <BotAvatar size={30} disabled={s.status === 'disabled'} />
          <div className="min-w-0">
            <Link to={`/iam/system-accounts/${s.id}`} className="block truncate font-mono text-[13px] font-medium text-fg hover:text-brand-500">{s.name}</Link>
            <div className="max-w-xs truncate text-[11.5px] text-muted">{s.description || s.id}</div>
          </div>
        </div>
      ),
    },
    { id: 'roles', header: 'Roles', cell: (s) => <RoleChips roleIds={s.roleIds} roles={roles} max={2} /> },
    { id: 'projects', header: 'Projects', hideBelow: 'xl', cell: (s) => <ProjectScope projectIds={s.projectIds} projects={projects} /> },
    {
      id: 'tokens', header: 'Tokens', sort: (s) => s.tokens.filter((t) => t.status === 'active').length,
      cell: (s) => {
        const act = s.tokens.filter((t) => t.status === 'active');
        const next = act.filter((t) => t.expiresAt).sort((a, b) => a.expiresAt!.localeCompare(b.expiresAt!))[0];
        const soon = next && Date.parse(next.expiresAt!) - now < 14 * DAY;
        return (
          <div className="leading-tight">
            <div className="flex items-center gap-1.5 text-fg"><KeyRound className="size-3.5 text-faint" /><span className="tabular">{act.length}</span><span className="text-muted">active</span></div>
            {next ? <div className={cn('mt-0.5 flex items-center gap-1 text-[11px]', soon ? 'text-amber-600 dark:text-amber-400' : 'text-muted')} title={dateTime(next.expiresAt)}>{soon && <Clock className="size-3" />}next expires {timeAgo(next.expiresAt)}</div>
              : act.length ? <div className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">no expiry</div> : null}
          </div>
        );
      },
    },
    {
      id: 'ip', header: 'Network', hideBelow: 'lg', sort: (s) => s.ipAllowlist.length,
      cell: (s) => s.ipAllowlist.length
        ? <span className="inline-flex items-center gap-1 text-fg-2" title={s.ipAllowlist.join(', ')}><Network className="size-3.5 text-emerald-500" /><span className="font-mono text-xs">{s.ipAllowlist[0]}</span>{s.ipAllowlist.length > 1 && <span className="text-[11px] text-muted">+{s.ipAllowlist.length - 1}</span>}</span>
        : <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><ShieldAlert className="size-3.5" />any IP</span>,
    },
    { id: 'tagc', header: 'Conditions', hideBelow: 'xl', cell: (s) => s.tagConditions.length ? <Badge tone="violet">{s.tagConditions.map((t) => `${t.key}=${t.value}`).join(', ')}</Badge> : <span className="text-faint">—</span> },
    { id: 'used', header: 'Last used', hideBelow: 'md', sort: (s) => s.lastUsed ?? '', cell: (s) => <span className="text-fg-2" title={dateTime(s.lastUsed)}>{s.lastUsed ? timeAgo(s.lastUsed) : <span className="text-faint">never</span>}</span> },
    { id: 'status', header: 'Status', sort: (s) => s.status ?? 'active', cell: (s) => <StatusPill status={s.status ?? 'active'} /> },
  ];

  return (
    <Page wide>
      <PageHeader title="System Accounts" icon={Bot} iconColor="#8b5cf6"
        description="Machine identities for CI/CD pipelines, Terraform, exporters and other automation — scoped by roles, projects, source IP and resource tags."
        actions={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Create system account</Button>} />

      <div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="System accounts" value={svcs.length} icon={Bot} sub={`${svcs.filter((s) => s.status === 'disabled').length} disabled`} />
        <Stat label="Active tokens" value={stats.active} icon={KeyRound} sub="across all accounts" />
        <Stat label="Expiring ≤ 14 days" value={stats.expiring.length} icon={Clock} sub={stats.expiring.length ? <span className="text-amber-600 dark:text-amber-400">{stats.expiring.map((t) => t.svc.name).slice(0, 2).join(', ')} — rotate soon</span> : 'nothing urgent'} />
        <Stat label="Hygiene" value={stats.noExpiry.length + stats.open.length} icon={ShieldAlert} sub={`${stats.noExpiry.length} non-expiring · ${stats.open.length} without IP allowlist`} />
      </div>

      <DataTable rows={svcs} loading={isLoading} columns={columns}
        searchText={(s) => `${s.name} ${s.description} ${s.tokens.map((t) => `${t.name} ${t.prefix}`).join(' ')} ${s.roleIds.map((r) => roles.get(r)?.name).join(' ')}`}
        searchPlaceholder="Search name, token prefix, role…"
        rowLink={(s) => `/iam/system-accounts/${s.id}`}
        defaultSort={{ id: 'name', dir: 'asc' }}
        rowClassName={(s) => (s.status === 'disabled' ? 'opacity-70' : undefined)}
        rowActions={(s) => (
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="sm" />} items={[
            { label: 'View', icon: Eye, to: `/iam/system-accounts/${s.id}` },
            { label: 'Manage tokens', icon: KeyRound, to: `/iam/system-accounts/${s.id}?tab=tokens` },
            { divider: true, label: '' },
            s.status === 'disabled' ? { label: 'Enable', icon: CheckCircle2, onClick: () => act.mutate({ id: s.id, a: 'enable' }) } : { label: 'Disable', icon: Ban, onClick: () => act.mutate({ id: s.id, a: 'disable' }) },
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove([s]) },
          ]} />
        )}
        bulkActions={[{ label: 'Delete', icon: Trash2, danger: true, onClick: remove }]}
        empty={{ icon: Bot, title: 'No system accounts', description: 'Create one for your CI/CD pipeline or Terraform.', action: <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Create system account</Button> }}
      />
      <CreateSystemAccountModal open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}
