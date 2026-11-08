import { useState } from 'react';
import { useNavigate } from 'react-router';
import { FolderPlus, Check } from 'lucide-react';
import { useApiMutation, useList } from '@/api/hooks';
import { api, type ApiClientError } from '@/api/client';
import { useUi } from '@/store/ui';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea, Select, NumberInput } from '@/components/ui/form';
import { fieldErrors } from '@/components/ui/FormLayout';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import type { Account, Project } from '@/types';

const COLORS = ['#5b67f8', '#06b6d4', '#a855f7', '#f59e0b', '#10b981', '#ec4899', '#ef4444', '#64748b'];

export function NewProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const scopeAccount = useUi((s) => s.accountId);
  const setScope = useUi((s) => s.setScope);
  const { items: accounts } = useList<Account>('accounts');
  const { items: projects } = useList<Project>('projects');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [budget, setBudget] = useState(500);
  const [accountId, setAccountId] = useState(scopeAccount);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dup = projects.some((p) => p.accountId === accountId && p.name.toLowerCase() === name.trim().toLowerCase());

  const close = () => { setName(''); setDescription(''); setColor(COLORS[0]); setBudget(500); setErrors({}); onClose() };
  const create = useApiMutation(() => api.create<Project>('projects', { name: name.trim(), description, color, budgetMonthly: budget, accountId }), {
    silent: true,
    onSuccess: (p) => {
      toast.success(`Project ${p.name} created`, 'Default quotas applied — review them below.', { label: 'Switch to project', onClick: () => setScope(p.accountId, p.id) });
      close();
      if (p.accountId !== scopeAccount) setScope(p.accountId, '');
      navigate(`/iam/project-allowances/allow-${p.id}`);
    },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); if (!Object.keys(fieldErrors(e)).length) toast.error('Could not create project', e.message) },
  });

  return (
    <Modal open={open} onClose={close} title="New project" description="Projects group resources, people and budgets. Quotas and policies start from sensible defaults."
      icon={<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-brand-500"><FolderPlus className="size-[18px]" /></div>}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" disabled={!name.trim() || dup} loading={create.isPending} onClick={() => create.mutate()}>Create project</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim() && !dup) create.mutate() }}>
        <Field label="Name" required error={errors.name || (dup ? 'A project with this name already exists in the account' : undefined)}>
          <Input value={name} onChange={(e) => { setName(e.target.value); setErrors({}) }} placeholder="Data Warehouse" invalid={!!errors.name || dup} />
        </Field>
        <Field label="Description" optional><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What lives here?" /></Field>
        <div className="grid [&>*]:min-w-0 gap-4 @min-[36rem]:grid-cols-2">
          <Field label="Account"><Select value={accountId} onChange={(e) => setAccountId(e.target.value)} options={accounts.map((a) => ({ value: a.id, label: a.name }))} /></Field>
          <Field label="Monthly budget" hint="Alerts at 80% and 100%"><NumberInput value={budget} onChange={setBudget} min={0} max={1_000_000} step={100} unit="EUR" /></Field>
        </div>
        <Field label="Color">
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} className={cn('flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition', color === c && 'ring-2')} style={{ background: c, ['--tw-ring-color' as string]: c }}>
                {color === c && <Check className="size-3.5 text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </Field>
      </form>
    </Modal>
  );
}
