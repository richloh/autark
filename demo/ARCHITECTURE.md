# Autark console — architecture

A React 19 + Vite + Tailwind v4 single-page app. All data comes from a REST API under `/api/v1`, which in
this demo is served **in the browser** by a mock control plane (`src/mock`) that intercepts `fetch`. The
mock keeps state in `localStorage` (`autark.mockdb.v3`), runs long-running operations with step-by-step
progress, emits realtime change events, writes audit events and notifications.

```
src/
  main.tsx             boot: installMockServer() then render router
  routes.tsx           all routes (lazy pages)
  nav.ts               sidebar / command palette navigation
  types/*.ts           domain types (the API contract)
  lib/                 pricing.ts (cost functions), format.ts, cidr.ts, kinds.tsx (icons/links per kind), images.tsx, random.ts, cn.ts
  api/
    client.ts          api.list/get/create/update/remove/action/get_/post  (adds scope headers)
    hooks.ts           useList, useItem, useGet, useMetrics, useApiMutation, useLookup, useNow, useOperationsFor, useActiveOperation
    realtime.ts        change events -> react-query invalidation (automatic, see AppShell)
  mock/
    db.ts              document store (collections of rows), persisted
    framework.ts       defineCollection, route, ApiError, validate, nameError, uniqueNameError, scopeFor, audit, notify, newId, getOr404, detachEverywhere
    operations.ts      startOperation, onOperationComplete, transition (async tasks with steps & logs)
    metrics.ts         registerMetrics(kind, fn) -> deterministic live time series
    server.ts          dispatcher + fetch interceptor + request log (API inspector)
    seed/*.ts          initial data per domain (timestamps relative to now)
    handlers/*.ts      one file per domain; shared.ts = cross-domain helpers; costs.ts = canonical monthly costs
  components/
    ui/                Button, Badge/StatusPill/Tags, Card/KeyValue/Section, DataTable/FilterChips, form controls,
                       Modal/Drawer/confirm(), Menu/Popover, Tabs/useTabParam/Segmented, PageHeader/Page, Stat,
                       CodeBlock/IacTabs/toHcl/toCli/toCurl, misc (Meter, StackBar, Ring, Mono, CopyButton, EmptyState, Skeleton), toast, FormLayout
    charts/            AreaChart, Sparkline, Donut, Treemap, BarChart, MetricsPanel
    resource/          ResourceLink/KindIcon, CostPanel, OperationRunner/OperationInline, ActivityFeed, pickers
    shell/             AppShell, Sidebar, Topbar, ScopeSwitcher, CommandPalette, Panels (notifications, ops tray), ApiInspector
  pages/<domain>/*.tsx one default-exported component per route
```

## The API

Generic REST for every collection registered with `defineCollection({ name, kind, idPrefix, ... })`:

| Method | Path | Handler |
|---|---|---|
| GET | `/api/v1/{name}?q=&field=value&a.b=value&limit=` | list (scoped to account + optional project via headers) |
| GET | `/api/v1/{name}/{id}` | get (+ `decorate`) |
| POST | `/api/v1/{name}` | `create(ctx, body)` returns the full row; framework inserts + audits; then `afterCreate` |
| PATCH | `/api/v1/{name}/{id}` | `update(ctx, row, patch)` returns next row (default: shallow merge) |
| DELETE | `/api/v1/{name}/{id}?opts` | `remove(ctx, row)`; return `'async'` if an operation deletes later |
| POST | `/api/v1/{name}/{id}/actions/{action}` | `actions[action](ctx, row, body)` → returns body or the fresh row |

Custom endpoints: `route('GET', '/costs/summary', handler, 'summary')` (matched first).
Errors: `throw new ApiError(status, message, code, fieldDetails)`; `validate({ field: cond && 'message' })`
throws 422 with field details which forms map to inputs via `fieldErrors(e)`.

Scoping: rows with `accountId` are filtered to the current account; rows with `projectId` to the current
project when one is selected. `scoped: false` for global collections, `accountScopedOnly: true` for rows
that belong to an account but not a project.

Long-running work: `startOperation({ type, title, target, steps: [{ name, ms, logs }], onComplete: 'handler.name', payload })`
and register `onOperationComplete('handler.name', (op, payload) => ...)` at module level. Set the resource
to a transitional status first (`provisioning`, `updating`, …) — `transition()` does both. The UI shows
operations in the ops tray, and pages render them with `<OperationRunner op={...} />` (use `useActiveOperation(id)`).

Relationships stored on both sides (VM.firewallIds ⇄ Firewall.attachedTo, VM.ipIds ⇄ IP.assignedTo,
VM.volumeIds ⇄ Volume.attachedTo) must be changed through `handlers/shared.ts` helpers (`setFirewalls`,
`assignIp`/`unassignIp`, `attachVolume`/`detachVolume`, `allocateIp`, `pickHost`, `checkQuota`, …).

Governance: `checkQuota(projectId, delta)`, `checkRequiredTags`, `checkLocationAllowed` enforce project allowances.

Metrics: `registerMetrics(kind, (row, metric) => profile | null)` then the UI calls
`useMetrics('vms', id, ['cpu','ram'], '1h')` or renders `<MetricsPanel collection="vms" id=... charts=[...] />`.

Costs: `handlers/costs.ts` has the canonical monthly cost per resource; use it in `decorate` to expose
`monthlyCost`. The UI uses `lib/pricing.ts` for live estimates in create forms (`<CostPanel cost=... />`).

## UI conventions

- Pages: `<Page>` + `<PageHeader icon title description actions crumbs status meta>`.
- Lists: `<DataTable rows columns searchText rowLink bulkActions toolbar empty />` + `<Stat>` tiles on top.
- Create pages: `<CreateLayout aside={<CostPanel .../>}>` with numbered `<FormSection>`s, `IacTabs` for Terraform/CLI/REST.
- Detail pages: header with lifecycle actions, `<Tabs>` synced to `?tab=` via `useTabParam`, an Overview with
  `KeyValue`, live charts, related resources as `ResourceLink`s, and an Activity tab (`<ActivityFeed targetId>`).
- Mutations: `useApiMutation(fn, { success: 'Message' })` (toasts errors automatically). Destructive actions:
  `await confirm({ title, danger: true, typeToConfirm })`.
- Colors: semantic tokens (`bg-surface`, `bg-surface-2`, `text-fg`, `text-fg-2`, `text-muted`, `text-faint`,
  `border-line`, `brand-500`) so light & dark mode work. Status colors via `<StatusPill status>`.
- Charts are hand-written SVG (no chart libs). d3-shape / d3-hierarchy are available for path/layout math.
- Realtime: lists refresh automatically on server change events; no manual polling needed except metrics.

## Notable behaviours

- Opening a link to a resource in another account the user belongs to returns `404 other_account`;
  the API client switches the scope automatically and retries (see `api/client.ts`).
- Host capacity (`handlers/shared.ts → hostAllocation`) counts VMs plus managed workloads (database
  primaries/standbys, Kubernetes worker nodes), so the scheduler, maintenance evacuation and dashboards agree.
- Realtime invalidation also refreshes derived views (`costs`, `overview`, `allowances`, and `hosts`/`providers` on VM changes).
- Failure demos: name a VM `…fail…` to see a failed provisioning step; use credentials containing
  `invalid` when connecting a cloud provider; enable *Chaos mode* in Settings for random 503s on writes.

## Layout: container queries & overlays

The console has a docked **AI copilot pane** on the right (`components/ai/AiPane.tsx`, expanded by default,
collapsible to a rail, a drawer below 1280px, toggle with ⌘J). Because the content width therefore varies
independently of the viewport, `<main>` is a CSS container and page content uses **container-query
variants** instead of viewport breakpoints:

| old | use in page content |
|---|---|
| `sm:` | `@min-[36rem]:` |
| `md:` | `@min-[40rem]:` |
| `lg:` | `@min-[44rem]:` |
| `xl:` | `@min-[60rem]:` |
| `2xl:` | `@min-[76rem]:` |

Kit components that appear in many contexts (`OptionCards`, `KeyValue`, `Stat`) are their own containers and
adapt to their own width. Shell components (sidebar, top bar) keep viewport breakpoints. Overlays (modals,
menus, tooltips, fullscreen views) must portal into `overlayRoot()` (`lib/overlay.ts`), a fixed viewport-sized
container — never into `document.body`, and never use `position: fixed` inside `<main>` (containers create a
containing block).

The copilot is a UI preview: `components/ai/brain.ts` matches prompts to a few intents and answers from
live data through the same REST API (showing tool calls and approve-style action cards).

## Simple mode & Pro mode

The console defaults to **simple mode**: a calm, classic hosting-console experience (essential nav,
tables without KPI tiles, create forms with ~4 decisions, few tabs). **Pro mode** (sidebar switch, user
menu, Settings, ⌘K) reveals advanced pages (Topology, Activity, Images, Roles, System accounts, Projects &
Budgets, API & IaC), metrics, IaC snippets, raw configuration and tuning. Use `usePro()`, `<Pro>`,
`<Simple>` and `<Advanced>` from `components/ui/Pro.tsx`; nav items carry `pro: true`. Hidden fields in
simple mode always get sensible defaults (e.g. project, network & subnet are auto-picked).
