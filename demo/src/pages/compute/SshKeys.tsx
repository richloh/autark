import { useState } from 'react';
import { KeyRound, Plus, MoreHorizontal, Pencil, Trash2, Copy, Server, ShieldCheck, ShieldAlert, Clock } from 'lucide-react';
import { useList, useLookup } from '@/api/hooks';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, FilterChips, type Column } from '@/components/ui/DataTable';
import { Badge, StatusDot } from '@/components/ui/Badge';
import { Menu, Popover } from '@/components/ui/Menu';
import { Stat } from '@/components/ui/Stat';
import { Mono } from '@/components/ui/misc';
import { confirm } from '@/components/ui/Modal';
import { toast } from '@/components/ui/toast';
import { ResourceLink } from '@/components/resource/ResourceLink';
import { AddSshKeyModal, RenameSshKeyModal } from '@/components/compute/catalog/SshKeyModals';
import { timeAgo, dateTime, plural } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { SshKey, VM } from '@/types';

import { usePro } from '@/store/ui';

type Filter = 'all' | 'used' | 'unused' | 'rsa';

export default function SshKeys() {
  const { items: keys, isLoading } = useList<SshKey>('sshKeys');
  const { map: vms } = useLookup<VM>('vms');
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<SshKey | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const pro = usePro();

  const used = keys.filter((k) => k.usedBy?.length);
  const stale = keys.filter((k) => !k.lastUsedAt || Date.now() - Date.parse(k.lastUsedAt) > 90 * 86_400_000);
  const rows = keys.filter((k) => filter === 'all' || (filter === 'used' ? k.usedBy?.length : filter === 'unused' ? !k.usedBy?.length : k.keyType === 'rsa'));

  const remove = async (list: SshKey[]) => {
    const affected = [...new Set(list.flatMap((k) => k.usedBy ?? []))];
    const ok = await confirm({
      title: list.length === 1 ? `Delete SSH key ${list[0].name}?` : `Delete ${list.length} SSH keys?`,
      message: affected.length ? (
        <span>
          Used by {plural(affected.length, 'VM')}: <span className="font-medium text-fg">{affected.slice(0, 5).map((id) => vms.get(id)?.name ?? id).join(', ')}{affected.length > 5 ? ', …' : ''}</span>.
          {' '}The key stays in their <code className="rounded bg-surface-3 px-1 font-mono text-[12px]">authorized_keys</code> until you remove it there, but it will no longer be injected on rebuilds or new VMs.
        </span>
      ) : 'The key is not used by any VM. This cannot be undone.',
      confirmLabel: 'Delete', danger: true, typeToConfirm: affected.length && list.length === 1 ? list[0].name : undefined,
    });
    if (!ok) return;
    const res = await Promise.allSettled(list.map((k) => api.remove('sshKeys', k.id)));
    const failed = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) toast.error(`${failed.length} could not be deleted`, failed[0].reason?.message);
    else toast.success(list.length === 1 ? `Deleted ${list[0].name}` : `Deleted ${list.length} keys`);
  };

  const columns: Column<SshKey>[] = [
    {
      id: 'name', header: 'Name', sort: (k) => k.name,
      cell: (k) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', k.keyType === 'rsa' ? 'bg-amber-500/10 text-amber-500' : 'bg-brand-500/10 text-brand-500')}><KeyRound className="size-4" /></span>
          <div className="min-w-0">
            <div className="truncate font-medium text-fg">{k.name}</div>
            {(pro || k.comment) && <div className="truncate text-[11px] text-muted">{k.comment || k.id}</div>}
          </div>
        </div>
      ),
    },
    {
      id: 'type', header: 'Type', sort: (k) => `${k.keyType}${k.bits}`, hideBelow: 'sm',
      cell: (k) => k.keyType === 'rsa'
        ? <Badge tone="warning" title="RSA still works, but ed25519 is faster and safer"><ShieldAlert className="size-3" />RSA {k.bits}</Badge>
        : <Badge tone="success"><ShieldCheck className="size-3" />{k.keyType ?? 'key'}{k.keyType === 'ecdsa' ? ` ${k.bits}` : ''}</Badge>,
    },
    { id: 'fp', header: 'Fingerprint', hideBelow: 'md', cell: (k) => <Mono copy={k.fingerprint} className="max-w-[260px] text-[11.5px]">{k.fingerprint}</Mono> },
    {
      id: 'used', header: 'Used by', sort: (k) => k.usedBy?.length ?? 0,
      cell: (k) => {
        const ids = k.usedBy ?? [];
        if (!ids.length) return <span className="text-faint">not in use</span>;
        return (
          <Popover align="start" className="w-64" trigger={(open) => (
            <button className={cn('inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[13px] text-fg hover:bg-surface-2', open && 'bg-surface-2')}>
              <Server className="size-3.5 text-muted" />{plural(ids.length, 'VM')}
            </button>
          )}>
            {() => (
              <div className="p-2">
                <div className="px-1.5 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Configured on</div>
                <ul className="space-y-0.5">
                  {ids.map((id) => {
                    const vm = vms.get(id);
                    return (
                      <li key={id} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2">
                        {vm && <StatusDot status={vm.status} />}
                        <ResourceLink type="vm" id={id} name={vm?.name ?? id} showIcon={!vm} />
                        {!vm && <span className="ml-auto text-[11px] text-faint">other project</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Popover>
        );
      },
    },
    {
      id: 'lastUsed', header: 'Last used', hideBelow: 'lg', sort: (k) => k.lastUsedAt ?? '',
      cell: (k) => <span className={cn('inline-flex items-center gap-1', !k.lastUsedAt ? 'text-faint' : 'text-fg-2')} title={k.lastUsedAt ? dateTime(k.lastUsedAt) : 'No SSH login recorded'}>{k.lastUsedAt && <Clock className="size-3 text-faint" />}{k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'never'}</span>,
    },
    {
      id: 'created', header: 'Added', hideBelow: 'xl', sort: (k) => k.createdAt,
      cell: (k) => <div className="leading-tight"><div className="text-fg-2" title={dateTime(k.createdAt)}>{timeAgo(k.createdAt)}</div>{k.createdBy && <div className="text-[11px] text-muted">{k.createdBy}</div>}</div>,
    },
  ];
  const visibleColumns = pro ? columns : columns.filter((c) => !['type', 'lastUsed'].includes(c.id)).map((c) => (c.id === 'created' ? { ...c, hideBelow: 'lg' as const } : c));

  return (
    <Page wide>
      <PageHeader
        title="SSH Keys"
        description={pro ? 'Public keys injected into Linux VMs on first boot and rebuild. Keys are shared across all projects of the account.' : 'Log in to your servers without a password.'}
        icon={KeyRound}
        iconColor="#64748b"
        actions={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add SSH key</Button>}
      />
      {pro && <div className="mb-5 grid grid-cols-2 gap-3 @min-[44rem]:grid-cols-4">
        <Stat label="Keys" value={keys.length} icon={KeyRound} sub="in this account" />
        <Stat label="In use" value={used.length} icon={Server} sub={`on ${new Set(keys.flatMap((k) => k.usedBy ?? [])).size} VMs`} />
        <Stat label="Legacy RSA" value={keys.filter((k) => k.keyType === 'rsa').length} icon={ShieldAlert} sub="consider ed25519" />
        <Stat label="Unused > 90 days" value={stale.length} icon={Clock} sub={stale.length ? 'review & rotate' : 'all active'} />
      </div>}
      <DataTable
        rows={rows}
        loading={isLoading}
        columns={visibleColumns}
        searchText={(k) => `${k.name} ${k.fingerprint} ${k.comment ?? ''} ${k.keyType ?? ''} ${k.createdBy ?? ''}`}
        searchPlaceholder="Search name, fingerprint, comment…"
        defaultSort={{ id: 'name', dir: 'asc' }}
        toolbar={pro && <FilterChips value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All', count: keys.length },
          { value: 'used', label: 'In use', count: used.length },
          { value: 'unused', label: 'Unused', count: keys.length - used.length },
          { value: 'rsa', label: 'RSA', count: keys.filter((k) => k.keyType === 'rsa').length },
        ]} />}
        rowActions={(k) => (
          <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Key actions" size="sm" />} items={[
            { label: 'Copy public key', icon: Copy, onClick: () => { navigator.clipboard?.writeText(k.publicKey).catch(() => {}); toast.success('Public key copied') } },
            { label: 'Rename', icon: Pencil, onClick: () => setRenaming(k) },
            { divider: true, label: '' },
            { label: 'Delete', icon: Trash2, danger: true, hint: k.usedBy?.length ? `${k.usedBy.length} VMs` : undefined, onClick: () => remove([k]) },
          ]} />
        )}
        bulkActions={[{ label: 'Delete', icon: Trash2, danger: true, onClick: remove }]}
        empty={{ icon: KeyRound, title: 'No SSH keys yet', description: 'Add a public key so you can log in to your Linux VMs.', action: <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add SSH key</Button> }}
      />
      <AddSshKeyModal open={adding} onClose={() => setAdding(false)} />
      <RenameSshKeyModal sshKey={renaming} onClose={() => setRenaming(null)} />
    </Page>
  );
}
