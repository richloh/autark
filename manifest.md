# Autark

An open‑source, self‑sovereign alternative to cloud hyperscalers for the IaC and AI era.

## The reality today

Most organizations run IT workloads on AWS, Azure, or Google Cloud. The 2010s cloud wave delivered scale, elasticity, and a rich catalog of services. Developers loved it, as it abstracted hardware nicely. Managers enjoyed the benefit of only paying what you needed. But now, over a decade later, the trade‑offs are clearer:

- Cost premiums: Depending on use case, you pay roughly between 15x more (Kubernetes), 8x more (databases) or 4x more (compute) for equivalent capability compared to rented hardware with open tooling.
- Sovereignty and jurisdiction risk: Due to the 2018 CLOUD Act, U.S. authorities can compel U.S.-based cloud providers to disclose customer data—even if stored outside the U.S.—through legal process. If your data and operations live on a hyperscaler, they are within reach of U.S. jurisdiction. Pricing and taxation changes can also be imposed unilaterally through Executice Orders. For organizations with sovereignty requirements, this is a material, actionable risk.
- Complexity and lock‑in: Vast service menus and deep integration patterns make switching hard. AWS alone exposes 13,000+ permissions—misconfiguration is common and has led to breaches (e.g., Capital One, 2019).

## The problem: Limited alternatives

Outside hyperscalers, practical choices are scarce:

- Heavyweight stacks: Powerful options like OpenStack are operationally complex and require specialist teams many organizations don’t have.
- Hardware isn’t a cloud: Colocation and bare‑metal providers deliver machines, not a unified control plane—you must assemble virtualization, storage, networking, monitoring, and security yourself.
- Automation and governance gaps: Few alternatives offer mature, consistent APIs and first‑class IaC/AI support with multi‑tenant RBAC, auditing, and compliance baked in.

That’s especially unfortunate because the landscape has changed. Large language models and AI copilots make planning, provisioning, and troubleshooting more accessible than ever. Docker and containers turn deployment into a repeatable, minutes‑long task on your own hardware. And lightweight, easy‑to‑run abstractions—Docker Compose, Kamal, Score, and simple VM orchestration—let teams operate modern apps without adopting heavyweight cloud stacks.


## Proposed solution

We propose Autark: a free, open, and sovereign alternative to hyperscalers. It rests on five pillars:

1) Self‑hosted and open source  
   Run it on your own servers or colocation with no license fees. You control the code and data. No one can shut it down or access it.

2) You’re in control  
   Bring your own hardware and optionally connect burst capacity from hyperscalers. Selfcloud treats public clouds as interchangeable VM pools—only portable primitives (VMs, volumes, networks) are used—minimizing lock‑in and keeping data portable.

3) Similar functionality, familiar experience  
   A cloud‑like control plane that abstracts hardware cleanly. Click “Add server” to enroll a machine and have it ready in seconds. Start with core infrastructure: virtual machines, block volumes, networks, images, and snapshots. Grow into managed services (Kubernetes, relational databases, DNS, load balancers, and more) with consistent APIs and UX.

4) End‑user focus, opinionated by design  
   Convention over configuration. Users state what they need; the platform decides how to deliver reliably and securely. Defaults follow SRE best practices, with guardrails, RBAC, and least‑privilege patterns. The goal is to serve ~90% of common use cases well, not expose every knob.

5) Built for IaC and AI from day one  
   First‑class APIs and providers for Terraform, Pulumi, and others; GitOps‑friendly; OpenAPI schemas; and Model Context Protocol (MCP) tools so AI agents can operate Selfcloud safely. For AI, support for GPUs, suitable images and drivers, and data‑gravity‑aware workflows for training and inference.

## How to run the solution

1.) App setup  
Install via a docker‑compose file in minutes. For high availability, deploy to Kubernetes using a Helm chart. Integrate with SSO, TLS, and centralized logging/metrics.

2.) Add hardware
Enroll dedicated (bare‑metal) servers or connect supported cloud providers. On enrollment, Autark (with your approval) provisions a KVM hypervisor, monitoring, and a lightweight agent; the node becomes ready for workloads. Cloud providers are connected via API keys: Autark provisions and manages only generic VMs, volumes, and networks—no provider‑specific managed services—preserving portability.

3.) Request services  
Provision and operate infrastructure much like a hyperscaler:
- Launch VMs of various sizes from images or templates.
- Attach/detach block storage; snapshot and clone volumes.
- Stop, back up, and migrate VMs (cold or live where supported).
- Define networks, subnets, IPs, routes, and security groups/firewall rules.
- Later: managed Kubernetes, managed MySQL/PostgreSQL, DNS, load balancers, and object storage.

Autark supports multi‑tenant organizations, projects, and groups; quotas; showback/chargeback; detailed audit and event logs; encryption at rest; API tokens, CLI/SDKs, and SSO integration.

## Live demo for illustration purposes

A clickable live demo with sample mock data is provided here: [Demo](https://autark-demo.tmt-labs.de/). 

| [![Dashboard](https://autark-demo.tmt-labs.de/images/autark-dashboard.png)](https://autark-demo.tmt-labs.de/dashboard/) | [![VM Creation](https://autark-demo.tmt-labs.de/images/autark-vm-creation.png)](https://autark-demo.tmt-labs.de/infrastructure/vms/create/) | [![Bare metal machines](https://autark-demo.tmt-labs.de/images/autark-bare-metal-hosts.png)](https://autark-demo.tmt-labs.de/hardware/bare-metals/) |
|:---:|:---:|:---:|
| Dashboard View | Creating a VM | Bare metal machines |

It shows how the app should feel, what settings are possible, and how to navigate. Note this is subject to change.

## Next steps

### Gain support
Initially, we are trying to find supporters in one of these three areas:

1) Developers wanting to contribute
2) Companies interesting in using Autark and give guidance in what features are needed to replace existing hyperscaler setups
3) Contributors that are willing to provide financial controbutions

### Address open business-related questions
- What legal setup to use? E.g.
   - Like OpenAI: A non‑profit that owns the IP and governs the project, plus a for‑profit arm that does consulting, support, and managed hosting?
   - Like Mozilla: A non‑profit foundation that does everything?
   - Like Red Hat, N8N, Portainer: A for‑profit company that open sources everything but sells support and consulting?
- What license to use? GPL, AGPL, MIT, etc.?
- How to fund ongoing development and maintenance?

### Address open product-related questions
- What features are most critical to gain adoption?
- What are the most common workloads and architectures we should optimize for?