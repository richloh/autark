# Autark - Quick Start Guide

## Installation & Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Visit **http://localhost:4321** to see your Autark dashboard.

## What You'll See

### Dashboard (/)
The homepage redirects to `/dashboard` showing:
- Resource counts (VMs, DBs, K8s clusters)
- Total monthly cost estimate
- 7-day cost trend chart
- System health status
- Capacity utilization metrics
- Recent activity log

### Navigation

Use the left sidebar to explore:

**Infrastructure**
- Virtual Machines - 8 VMs with full detail pages
- Volumes - 8 block storage volumes
- Networks - 4 VPCs with subnets
- IP Addresses - 10 elastic IPs
- Firewalls - 8 firewall rule sets
- DNS - 2 DNS zones with records

**Managed Services**
- Databases - 3 managed DB instances (Postgres, MySQL, Redis)
- Kubernetes - 2 clusters with node pools
- Object Storage - 3 S3-compatible buckets
- Load Balancers - 2 L4/L7 load balancers

**Hardware**
- Bare Metal Hosts - 8 physical servers
- Cloud Providers - 2 external provider integrations

**IAM**
- Users - 5 user accounts
- Roles - 3 RBAC roles
- System Accounts - 2 service accounts
- Project Allowances - 3 project budgets/quotas

## Key Features to Try

### 1. Account & Project Filtering
- Use the top-bar dropdowns to switch accounts and projects
- Watch the resource lists filter automatically
- Selection persists in localStorage

### 2. Cost Calculations
- Every resource page shows calculated monthly costs
- Based on real pricing from `data.json`
- Dashboard shows aggregate totals

### 3. VM Detail Page
Navigate to any VM to see:
- Full specifications (vCPU, RAM, disk, GPUs)
- Performance metrics charts
- Attached storage volumes
- Network configuration
- Firewall rules
- Tags

Example: Click on **"web-1"** in the VMs list

### 4. Responsive Design
- Resize your browser window
- Tables scroll horizontally on mobile
- Sidebar collapses on small screens
- All content remains accessible

## Building for Production

```bash
# Build static site
npm run build

# Preview production build
npm run preview
```

The `dist/` folder contains your complete static site:
- 26 HTML pages
- Optimized CSS and JavaScript
- All assets ready for deployment

## Deploying

### Option 1: Netlify
```bash
# Drag and drop the `dist` folder to Netlify
# Or connect your git repo
```

### Option 2: Vercel
```bash
npm install -g vercel
vercel --prod
```

### Option 3: Static Host
Upload `dist/` contents to:
- GitHub Pages
- AWS S3 + CloudFront
- Any static file host

## Customizing Data

Edit `src/data/data.json` to:
- Add more VMs, databases, etc.
- Change pricing
- Modify accounts and projects
- Update theme colors

After editing, rebuild:
```bash
npm run build
```

## Adding New Pages

1. Create `.astro` file in `src/pages/`
2. Use `AutarkLayout` for consistent UI
3. Import data from `../data/data.json`
4. Page automatically appears in build

Example:
```astro
---
import AutarkLayout from '../layouts/AutarkLayout.astro';
import data from '../data/data.json';
---

<AutarkLayout title="New Page">
  <p>Your content here</p>
</AutarkLayout>
```

## Troubleshooting

### Build Errors
```bash
# Clear cache and rebuild
rm -rf .astro dist node_modules
npm install
npm run build
```

### Port Already in Use
```bash
# Use a different port
npm run dev -- --port 3000
```

### Styles Not Loading
- Ensure Tailwind integration is active
- Check `astro.config.mjs` includes `@astrojs/tailwind`
- Rebuild to regenerate CSS

## Project Structure

```
autark-astro/
├── src/
│   ├── pages/           # Routes (26 pages)
│   ├── layouts/         # Main layout
│   ├── components/      # Reusable UI
│   ├── lib/             # Utilities
│   └── data/            # data.json
├── public/              # Static assets
├── dist/                # Build output (gitignored)
└── package.json
```

## Learn More

- **README.md** - Full documentation
- **PROJECT_SUMMARY.md** - Implementation details
- **Astro Docs** - https://docs.astro.build
- **Tailwind Docs** - https://tailwindcss.com

## Next Steps

### Beginner
1. Explore all navigation sections
2. Click through VM detail pages
3. Try account/project filtering
4. Check responsive design on mobile

### Intermediate
1. Edit `data.json` to add a new VM
2. Customize theme colors in `tailwind.config.mjs`
3. Add a new status badge color
4. Create a custom component

### Advanced
1. Implement create/edit forms
2. Add Astro Islands for interactive features
3. Build provisioning step runner
4. Add real-time search/filter
5. Create modal dialogs

## Support

- **Issues**: Check the code comments in source files
- **Astro Questions**: https://astro.build/chat
- **Tailwind Questions**: https://tailwindcss.com/docs

---

**Enjoy building with Autark!** 🚀
