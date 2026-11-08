# Autark — console demo

A clickable, fully interactive demo of the **Autark** control plane — the open-source, sovereign
alternative to hyperscalers (see [`../manifest.md`](../manifest.md)).

Everything works end to end: create, change and delete VMs, volumes, networks, firewalls, DNS zones,
databases, Kubernetes clusters, buckets, load balancers, bare-metal hosts, cloud providers, users and
roles. A **mock control plane runs inside your browser**: it serves a REST API under `/api/v1`, runs
provisioning operations step by step (with logs), enforces quotas and policies, keeps an audit log,
sends notifications and stores its state in `localStorage`. Every visitor gets a private sandbox.
To start over, use *Reset demo data* in the user menu or in Settings.

## Highlights

- **Command palette** (`⌘K` or `/`): jump to any page, search any resource by name, IP or tag, start create flows, or ask the Copilot
- **Autark Copilot** (right-hand AI pane, `⌘J`): UI preview of an LLM assistant that answers from live data, shows its tool calls and proposes changes for approval
- **Simple by default, Pro when you need it**: a calm, essentials-first console; flip on *Pro mode* for topology, metrics, IaC, IAM details and advanced tuning
- **Live operations**: every async action shows step-by-step progress, logs and failures (try naming a VM `…fail…`)
- **Topology map** of networks, subnets, VMs, databases, load balancers and clusters
- **Cost transparency**: live estimates in every create form, budget impact, Cost Explorer with forecasts and a hyperscaler comparison
- **Governance**: project quotas, required tags, allowed locations and budgets are enforced by the API
- **IaC first**: every create form shows equivalent Terraform, CLI and REST snippets, and the *API & IaC* page has a request runner and MCP tool list
- **API inspector**: the terminal icon in the top bar shows every request the console makes
- Light/dark mode, responsive down to phone width

## Run it

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # typecheck + production build to dist/
npm run preview    # serve dist/ on :4321
```

Docker (nginx, SPA fallback): `docker build -t autark-demo . && docker run -p 4321:4321 autark-demo`.
`deploy/deploy.sh` builds the container, ships it over SSH and starts it at https://autark.lohwasser.de.

## Stack

React 19, React Router 7, TanStack Query, Zustand, Tailwind CSS 4, Vite 7, TypeScript. Charts and
diagrams are hand-written SVG (with `d3-shape` / `d3-hierarchy` for the maths). Icons: lucide.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for how the mock API, operations engine and UI kit fit together.
