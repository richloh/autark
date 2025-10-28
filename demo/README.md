# Autark - Static Mock Frontend

A static, file-routed mock frontend for an open-source AWS-like platform called "Autark," built with Astro and Tailwind CSS.

## Features

- **Static Site Generation**: Built with Astro for optimal performance and SEO
- **File-based Routing**: Clean URLs matching the infrastructure management patterns
- **Partial Hydration**: Minimal client-side JavaScript using Astro Islands
- **Tailwind CSS**: Utility-first styling with JIT compilation
- **Real-time Pricing**: Cost calculations based on pricing manifest
- **Responsive Design**: Mobile-friendly UI with collapsible navigation
- **Local State Management**: Client-side persistence with localStorage
- **Mock Data**: Comprehensive data.json with AWS-like resource structures

## Tech Stack

- **Framework**: Astro 5.x for static site generation
- **Styling**: Tailwind CSS 3.x with JIT mode
- **State**: Vanilla JavaScript with localStorage persistence
- **Data**: JSON manifest loaded at build time

## Project Structure

```
/
├── src/
│   ├── pages/              # File-based routes
│   │   ├── dashboard.astro
│   │   ├── infrastructure/
│   │   │   ├── vms/
│   │   │   │   ├── index.astro       # VM list
│   │   │   │   └── [id].astro        # VM detail
│   │   │   ├── volumes/
│   │   │   └── ...
│   │   ├── managed-services/
│   │   │   ├── db/
│   │   │   └── ...
│   │   ├── hardware/
│   │   └── iam/
│   ├── layouts/
│   │   └── AutarkLayout.astro    # Main layout with nav
│   ├── components/
│   │   ├── StatusBadge.astro
│   │   ├── TagBadge.astro
│   │   └── Card.astro
│   ├── lib/
│   │   ├── state.js                  # State management
│   │   ├── pricing.js                # Cost calculations
│   │   ├── uuid.js                   # ID generation
│   │   └── filters.js                # Search/sort/filter
│   └── data/
│       └── data.json                 # Application manifest
├── public/                           # Static assets
├── dist/                             # Build output
├── astro.config.mjs
├── tailwind.config.mjs
└── package.json
```

## Getting Started

### Prerequisites

- Node.js 18.20.8+ or 20.3.0+ or 22.0.0+
- npm 9.6.5+

### Installation

```bash
npm install
```

### Development

Start the development server:

```bash
npm run dev
```

The site will be available at `http://localhost:4321`

### Build

Build the static site:

```bash
npm run build
```

The static files will be generated in the `dist/` directory.

### Preview

Preview the production build:

```bash
npm run preview
```

## Features & Pages

### Dashboard (`/dashboard`)
- Resource counts and cost estimates
- Cost trend charts (last 7 days)
- System health status
- Capacity utilization bars
- Recent activity audit log
- Notifications panel

### Infrastructure

#### Virtual Machines (`/infrastructure/vms`)
- List view with filtering and search
- Detail pages with metrics, networking, storage, security tabs
- Cost estimation per VM
- Support for presets and custom configurations
- GPU support

#### Volumes (`/infrastructure/volumes`)
- Block storage management
- SSD, NVMe, HDD types
- IOPS and throughput configuration
- Attachment status

#### Networks (`/infrastructure/networks`)
- VPC management
- Subnet configuration
- NAT gateway support

#### IP Addresses (`/infrastructure/ips`)
- IPv4 and IPv6 pool management
- Assignment to resources

#### Firewalls (`/infrastructure/firewalls`)
- Rule-based firewall configuration
- Attachment to multiple resources

#### DNS (`/infrastructure/dns`)
- Zone management
- A, AAAA, CNAME, MX, TXT, SRV records

### Managed Services

#### Databases (`/managed-services/db`)
- Postgres, MySQL, Redis
- High availability configurations
- Backup policies
- Cost estimation with HA multiplier

#### Kubernetes (`/managed-services/kubernetes`)
- Cluster management
- Node pools
- Control plane HA

#### Object Storage (`/managed-services/object-storage`)
- S3-compatible buckets
- Storage class selection
- Versioning and encryption

#### Load Balancers (`/managed-services/load-balancers`)
- L4 and L7 load balancers
- Target groups
- Health checks

### Hardware

#### Bare Metal Hosts (`/hardware/bare-metals`)
- Physical server inventory
- CPU, RAM, storage, GPU specs
- Hypervisor management

#### Cloud Providers (`/hardware/cloud-providers`)
- External provider integration (Hetzner, AWS)
- Region and quota management

### IAM

#### Users (`/iam/users`)
- User management
- Role assignments
- MFA status

#### Roles (`/iam/roles`)
- RBAC permissions
- System and custom roles

#### System Accounts (`/iam/system-accounts`)
- Service identities
- API key management

#### Project Allowances (`/iam/project-allowances`)
- Budget limits
- Resource quotas
- Tag policies

## Data Schema

The application reads from `src/data/data.json` which contains:

- `app`: Application metadata (name, version, currency, theme)
- `accounts`: Account list
- `projects`: Project list with account relationships
- `pricing`: Comprehensive pricing for all resource types
- `presets`: Pre-configured VM, volume, DB, and K8s node sizes
- `hardwareProviders`: Self-hosted datacenters and cloud providers
- `ipPools`: IP address ranges
- `sshKeys`: SSH public keys
- `initScripts`: VM initialization scripts
- `data`: All resource instances (VMs, volumes, networks, etc.)
- `pages`: Page-specific configuration and metadata

## Pricing Calculations

The application calculates real-time costs using the pricing manifest:

- **VM**: vCPU + RAM + system disk + IPs + GPUs (hourly × 24 × 30)
- **Volume**: Storage (type-based) + IOPS + throughput + snapshots
- **DB**: vCPU + RAM + storage + backups, multiplied by HA factor
- **Kubernetes**: Control plane + HA addon + node pools (as VMs)
- **Object Storage**: Storage GB + requests + egress
- **Load Balancer**: Hourly rate × 24 × 30 + data processed
- **DNS**: Zone + records
- **IPs**: Allocated elastic IPs

## State Management

- **Build-time**: Data loaded from `data.json` and rendered into static HTML
- **Client-side**: State merged with `localStorage` for user-created resources
- **Scoping**: Resources filtered by selected `accountId` and `projectId`
- **Persistence**: Changes saved to `localStorage.autark.state`
- **Events**: `statechange` custom event dispatched on updates

## Customization

### Theme Colors

Edit `tailwind.config.mjs`:

```js
colors: {
  primary: '#0ea5e9',    // Blue
  accent: '#22c55e',     // Green
  warning: '#f59e0b',    // Amber
  danger: '#ef4444',     // Red
  muted: '#6b7280',      // Gray
}
```

### Adding New Resources

1. Add data to `src/data/data.json`
2. Create page in `src/pages/[section]/[resource]/`
3. Implement list and detail views
4. Add pricing calculation in `src/lib/pricing.js`
5. Update navigation in `src/layouts/AutarkLayout.astro`

## Deployment

The `dist/` folder contains a fully static site that can be deployed to:

- Netlify
- Vercel
- GitHub Pages
- AWS S3 + CloudFront
- Any static file host

Simply upload the contents of `dist/` to your hosting provider.

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- ES2020+ JavaScript
- CSS Grid and Flexbox

## License

ISC

## Credits

Built for Autark, an open-source AWS-like platform for self-hosted environments.
