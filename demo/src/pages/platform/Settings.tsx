import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  Settings as SettingsIcon, User as UserIcon, Palette, Server, Building2, Keyboard, RotateCcw, Sun, Moon, Monitor, Zap, Bug, Gauge, Save, ShieldCheck, Rows3, Rows4, AlertTriangle, Check,
  Sparkle, LayoutGrid, LineChart, Code2, SlidersHorizontal,
} from 'lucide-react';
import { useGet, useList, useApiMutation } from '@/api/hooks';
import { api, type ApiClientError } from '@/api/client';
import { useUi, usePro, type Theme } from '@/store/ui';
import { getSettings, setSettings, type MockSettings } from '@/mock/server';
import { Page, PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Field, Input, Switch, Slider } from '@/components/ui/form';
import { Kbd } from '@/components/ui/misc';
import { confirm } from '@/components/ui/Modal';
import { fieldErrors } from '@/components/ui/FormLayout';
import { toast } from '@/components/ui/toast';
import { Avatar } from '@/components/iam/Avatar';
import { RoleChips } from '@/components/iam/RoleChips';
import { cn } from '@/lib/cn';
import type { User, Role, Account, Project } from '@/types';

const SECTIONS = [
  { id: 'interface', label: 'Interface', icon: Sparkle },
  { id: 'profile', label: 'Profile', icon: UserIcon },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'control-plane', label: 'Control plane', icon: Server, pro: true },
  { id: 'organization', label: 'Organization', icon: Building2 },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard },
  { id: 'reset', label: 'Demo data', icon: RotateCcw },
];

export default function Settings() {
  const pro = usePro();
  const sections = SECTIONS.filter((s) => pro || !('pro' in s && s.pro));
  const [active, setActive] = useState('interface');
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.id);
    }, { rootMargin: '-80px 0px -60% 0px' });
    els.forEach((e) => obs.observe(e));
    return () => obs.disconnect();
  }, [pro]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page>
      <PageHeader title="Settings" icon={SettingsIcon} iconColor="#64748b" description={pro ? "Your profile and preferences, plus controls for this demo's in-browser control plane." : 'Your profile and preferences.'} />
      <div className="grid [&>*]:min-w-0 gap-6 @min-[44rem]:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="hidden @min-[44rem]:block">
          <ul className="sticky top-20 space-y-0.5">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setActive(s.id) }}
                  className={cn('flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors', active === s.id ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg')}>
                  <s.icon className="size-4" />{s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-6">
          <InterfaceSection />
          <ProfileSection />
          <AppearanceSection />
          {pro && <ControlPlaneSection />}
          <OrganizationSection />
          <ShortcutsSection />
          <ResetSection />
        </div>
      </div>
    </Page>
  );
}

function SectionCard({ id, icon, title, description, children, actions }: { id: string; icon: typeof UserIcon; title: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader icon={icon} title={title} description={description} actions={actions} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ profile */

/* ------------------------------------------------------------------ interface (pro mode) */

const PRO_REVEALS: { icon: typeof UserIcon; title: string; text: string }[] = [
  { icon: LayoutGrid, title: 'More pages', text: 'Topology, Activity, Images & Snapshots, Roles, System accounts, Projects & Budgets, API & IaC.' },
  { icon: LineChart, title: 'Deeper detail', text: 'Fleet statistics, extra charts, sensors, audit trails and raw configuration on every resource.' },
  { icon: Code2, title: 'Equivalent code', text: 'Terraform, CLI and REST snippets next to forms and actions.' },
  { icon: SlidersHorizontal, title: 'All options up front', text: 'Advanced sections in create forms start expanded; bulk actions and filters in tables.' },
];

function InterfaceSection() {
  const pro = useUi((s) => s.pro);
  const setPro = useUi((s) => s.setPro);
  return (
    <Card id="interface" className={cn('scroll-mt-20 transition-colors', pro && 'border-violet-500/40')}>
      <CardHeader icon={Sparkle} title="Interface" description="Choose how much of the console you want to see." />
      <CardBody className="space-y-4">
        <div className={cn('rounded-xl border p-4', pro ? 'border-violet-500/30 bg-violet-500/[0.04]' : 'border-line')}>
          <Switch checked={pro} onChange={(v) => { setPro(v); toast.success(v ? 'Pro mode on' : 'Simple mode on', v ? 'All advanced features are now visible.' : 'Showing only the essentials.') }}
            label={<span className="inline-flex items-center gap-2 text-[15px]"><Sparkle className={cn('size-4', pro ? 'text-violet-500' : 'text-muted')} />Pro mode{pro && <Badge tone="violet">on</Badge>}</span>}
            description={pro ? 'Everything is visible. Turn off to go back to the calm, simple console.' : 'Off: you see only what most people need. Turn on to reveal every advanced feature.'} />
        </div>
        <div>
          <div className="mb-2 text-[13px] font-medium text-fg-2">Pro mode adds</div>
          <ul className="grid [&>*]:min-w-0 gap-3 @min-[40rem]:grid-cols-2">
            {PRO_REVEALS.map((r) => (
              <li key={r.title} className="flex items-start gap-2.5 text-[13px]">
                <r.icon className="mt-0.5 size-4 shrink-0 text-muted" />
                <span><span className="block font-medium text-fg">{r.title}</span><span className="text-muted">{r.text}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted">Nothing is lost in simple mode: advanced options stay one click away under “Advanced”. You can also toggle from the sidebar or the command palette.</p>
      </CardBody>
    </Card>
  );
}

function ProfileSection() {
  const pro = usePro();
  const { data } = useGet<{ user: User; roles: Role[] }>(['users', 'me'], '/me');
  const me = data?.user;
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (me) { setName(me.name); setTitle(me.title ?? '') } }, [me?.name, me?.title]); // eslint-disable-line
  const dirty = !!me && (name !== me.name || title !== (me.title ?? ''));
  const save = useApiMutation(() => api.update('users', me!.id, { name, title }), {
    silent: true, onSuccess: () => { toast.success('Profile saved'); setErrors({}) },
    onError: (e: ApiClientError) => { setErrors(fieldErrors(e)); toast.error('Could not save profile', e.message) },
  });
  const roleMap = new Map((data?.roles ?? []).map((r) => [r.id, r]));
  return (
    <SectionCard id="profile" icon={UserIcon} title="Profile" description="How you appear in audit logs and to your teammates.">
      {!me ? <div className="h-24 animate-pulse rounded-lg bg-surface-2" /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar name={name || me.name} seed={me.email} size={56} status={me.status} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-fg">{me.name}</div>
              <div className="text-sm text-muted">{me.email}</div>
              <div className="mt-1.5"><RoleChips roleIds={me.roleIds} roles={roleMap} /></div>
            </div>
            <Button size="sm" icon={ShieldCheck} to={`/iam/users/${me.id}?tab=security`}>{pro ? 'Security, sessions & tokens' : 'Security & sessions'}</Button>
          </div>
          <div className="grid [&>*]:min-w-0 gap-4 @min-[36rem]:grid-cols-2">
            <Field label="Full name" required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} /></Field>
            <Field label="Job title" optional><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Email" hint={me.sso ? 'Managed by your identity provider (SSO).' : 'Contact an administrator to change your email.'}><Input value={me.email} disabled /></Field>
            <Field label="Multi-factor authentication">
              <div className="flex h-9 items-center gap-2 text-sm">{me.mfa ? <><Check className="size-4 text-emerald-500" /><span className="text-fg">{me.mfaMethod === 'webauthn' ? 'Security key' : 'Authenticator app'}</span></> : <><AlertTriangle className="size-4 text-amber-500" /><span className="text-amber-700 dark:text-amber-400">Not enrolled</span></>}</div>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={!dirty} onClick={() => { setName(me.name); setTitle(me.title ?? '') }}>Reset</Button>
            <Button variant="primary" icon={Save} disabled={!dirty || !name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save profile</Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ appearance */

function AppearanceSection() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const density = useUi((s) => s.density);
  const setDensity = useUi((s) => s.setDensity);
  const themes: { id: Theme; label: string; icon: typeof Sun }[] = [{ id: 'light', label: 'Light', icon: Sun }, { id: 'dark', label: 'Dark', icon: Moon }, { id: 'system', label: 'System', icon: Monitor }];
  return (
    <SectionCard id="appearance" icon={Palette} title="Appearance" description="Saved in this browser.">
      <div className="space-y-6">
        <div>
          <div className="mb-2 text-[13px] font-medium text-fg-2">Theme</div>
          <div className="grid [&>*]:min-w-0 grid-cols-3 gap-3">
            {themes.map((t) => (
              <button key={t.id} type="button" onClick={() => setTheme(t.id)} aria-pressed={theme === t.id}
                className={cn('overflow-hidden rounded-xl border text-left transition-all', theme === t.id ? 'border-brand-500 ring-3 ring-brand-500/15' : 'border-line hover:border-line-strong')}>
                <ThemePreview kind={t.id} />
                <div className="flex items-center gap-1.5 border-t border-line px-3 py-2 text-[13px] font-medium text-fg"><t.icon className="size-3.5" />{t.label}{theme === t.id && <Check className="ml-auto size-3.5 text-brand-500" />}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[13px] font-medium text-fg-2">Density</div>
          <div className="grid [&>*]:min-w-0 gap-3 @min-[36rem]:grid-cols-2">
            {([['comfortable', 'Comfortable', 'More breathing room in tables', Rows3], ['compact', 'Compact', 'See more rows at once', Rows4]] as const).map(([id, label, desc, Icon]) => (
              <button key={id} type="button" onClick={() => setDensity(id)} aria-pressed={density === id}
                className={cn('flex items-start gap-3 rounded-xl border p-3 text-left transition-all', density === id ? 'border-brand-500 bg-brand-500/[0.05] ring-3 ring-brand-500/15' : 'border-line hover:border-line-strong')}>
                <Icon className="mt-0.5 size-5 text-muted" />
                <span><span className="block text-sm font-medium text-fg">{label}</span><span className="block text-xs text-muted">{desc}</span></span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function ThemePreview({ kind }: { kind: Theme }) {
  const pane = (dark: boolean) => (
    <div className={cn('flex h-full flex-1 gap-1.5 p-2', dark ? 'bg-[#0a0b12]' : 'bg-[#f6f7fb]')}>
      <div className={cn('w-1/4 rounded', dark ? 'bg-[#161927]' : 'bg-white')} />
      <div className="flex flex-1 flex-col gap-1.5">
        <div className={cn('h-2 w-2/3 rounded', dark ? 'bg-[#30364d]' : 'bg-[#d3d7e2]')} />
        <div className={cn('flex-1 rounded', dark ? 'bg-[#161927]' : 'bg-white')}><div className="m-1.5 h-1.5 w-1/2 rounded bg-brand-500" /></div>
      </div>
    </div>
  );
  return <div className="flex h-20">{kind === 'system' ? <>{pane(false)}{pane(true)}</> : pane(kind === 'dark')}</div>;
}

/* ------------------------------------------------------------------ control plane */

const SPEEDS = [0.25, 0.5, 1, 2, 4];

function ControlPlaneSection() {
  const [s, setS] = useState<MockSettings>(getSettings());
  const update = (patch: Partial<MockSettings>) => { setSettings(patch); setS(getSettings()); toast.success('Control-plane setting applied') };
  const speedIdx = Math.max(0, SPEEDS.indexOf(s.opSpeed) === -1 ? 2 : SPEEDS.indexOf(s.opSpeed));
  return (
    <SectionCard id="control-plane" icon={Server} title="Mock control plane" description="This demo runs a real API in your browser. Tune how it behaves to explore loading, failure and progress states.">
      <div className="space-y-4">
        <div className="rounded-xl border border-line p-3">
          <Switch checked={s.latency} onChange={(v) => update({ latency: v })} label={<span className="inline-flex items-center gap-1.5"><Zap className="size-4 text-brand-500" />Simulated network latency</span>} description="Adds 60–400 ms per request so loading states and optimistic UI are visible." />
        </div>
        <div className={cn('rounded-xl border p-3', s.chaos ? 'border-rose-500/40 bg-rose-500/[0.04]' : 'border-line')}>
          <Switch checked={s.chaos} onChange={(v) => update({ chaos: v })} label={<span className="inline-flex items-center gap-1.5"><Bug className="size-4 text-rose-500" />Chaos mode{s.chaos && <Badge tone="danger">on</Badge>}</span>} description="15% of write requests fail with 503 — test how the console handles errors and retries." />
        </div>
        <div className="rounded-xl border border-line p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-fg"><Gauge className="size-4 text-amber-500" />Operation speed</span>
            <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs tabular text-fg">{SPEEDS[speedIdx]}×</span>
          </div>
          <p className="mb-2 text-xs text-muted">How fast provisioning, resizing and other long-running operations progress.</p>
          <Slider value={speedIdx} min={0} max={SPEEDS.length - 1} step={1} marks={SPEEDS.map((_, i) => i)} format={(i) => `${SPEEDS[i]}×`} onChange={(i) => update({ opSpeed: SPEEDS[i] })} />
        </div>
        <p className="text-xs text-muted">Inspect every request in the <span className="font-medium text-fg-2">API inspector</span> (command palette → “Open API inspector”) or browse endpoints on the <Link to="/developer" className="text-brand-500 hover:underline">Developer</Link> page.</p>
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ organization */

function OrganizationSection() {
  const { items: accounts } = useList<Account>('accounts');
  const { items: projects } = useList<Project>('projects');
  const { items: users } = useList<User>('users');
  const accountId = useUi((s) => s.accountId);
  const setScope = useUi((s) => s.setScope);
  return (
    <SectionCard id="organization" icon={Building2} title="Organization" description="Accounts separate billing and resources; projects live inside accounts. Users are shared across accounts.">
      <div className="grid [&>*]:min-w-0 gap-3 @min-[40rem]:grid-cols-2">
        {accounts.map((a) => {
          const ps = projects.filter((p) => p.accountId === a.id);
          const current = a.id === accountId;
          return (
            <div key={a.id} className={cn('rounded-xl border p-4', current ? 'border-brand-500/60 bg-brand-500/[0.03]' : 'border-line')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-fg">{a.name}</div>
                  <div className="font-mono text-[11.5px] text-muted">{a.id}</div>
                </div>
                <Badge tone={a.plan === 'enterprise' ? 'violet' : 'neutral'}>{a.plan}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {ps.map((p) => <span key={p.id} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11.5px] text-fg-2"><span className="size-1.5 rounded-full" style={{ background: p.color }} />{p.name}</span>)}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted">
                <span>{ps.length} project{ps.length === 1 ? '' : 's'}</span>
                {current ? <span className="font-medium text-brand-600 dark:text-brand-300">Current account</span> : <button className="font-medium text-brand-500 hover:underline" onClick={() => { setScope(a.id, ''); toast.success(`Switched to ${a.name}`) }}>Switch</button>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-muted">
        <span><b className="text-fg">{users.filter((u) => u.status === 'active').length}</b> active users</span>
        <span><b className="text-fg">{projects.length}</b> projects</span>
        <Link to="/iam/users" className="text-brand-500 hover:underline">Manage team</Link>
        <Link to="/iam/project-allowances" className="text-brand-500 hover:underline">Projects & budgets</Link>
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ shortcuts */

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function ShortcutsSection() {
  const mod = isMac ? '⌘' : 'Ctrl';
  const rows: [ReactNode, string][] = [
    [<><Kbd>{mod}</Kbd><Kbd>K</Kbd></>, 'Open the command palette (search resources, navigate, create)'],
    [<Kbd>/</Kbd>, 'Open the command palette from anywhere outside a text field'],
    [<><Kbd>{mod}</Kbd><Kbd>J</Kbd></>, 'Show or hide the Autark Copilot pane'],
    [<><Kbd>↑</Kbd><Kbd>↓</Kbd></>, 'Move through palette results'],
    [<Kbd>↵</Kbd>, 'Open the selected result'],
    [<Kbd>esc</Kbd>, 'Close dialogs, drawers, menus and the palette'],
    [<><Kbd>{mod}</Kbd><span className="text-xs text-muted">+ click</span></>, 'Open a table row in a new tab'],
  ];
  return (
    <SectionCard id="shortcuts" icon={Keyboard} title="Keyboard shortcuts">
      <ul className="divide-y divide-line">
        {rows.map(([keys, desc], i) => (
          <li key={i} className="flex items-center justify-between gap-4 py-2.5 text-[13px]">
            <span className="text-fg-2">{desc}</span>
            <span className="flex shrink-0 items-center gap-1">{keys}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ reset */

function ResetSection() {
  const reset = useApiMutation(() => api.post('/system/reset'), {
    silent: true,
    onSuccess: () => toast.success('Demo data reset', 'Everything is back to the initial seed state.'),
    onError: (e) => toast.error('Reset failed', e.message),
  });
  return (
    <Card id="reset" className="scroll-mt-20 border-rose-500/30">
      <CardHeader icon={RotateCcw} title="Reset demo data" description="Restores every resource, user, operation and audit event to the original seed. Your appearance and control-plane settings are kept." />
      <CardBody className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">All changes you made in this browser will be lost.</p>
        <Button variant="danger" icon={RotateCcw} loading={reset.isPending} onClick={async () => {
          if (await confirm({ title: 'Reset all demo data?', message: 'Every VM, network, user, budget and audit event returns to the initial state. This cannot be undone.', confirmLabel: 'Reset demo', danger: true, typeToConfirm: 'reset' })) reset.mutate();
        }}>Reset demo data</Button>
      </CardBody>
    </Card>
  );
}
