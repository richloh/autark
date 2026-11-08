import { hashString } from '@/lib/random';
import type { Image, VM } from '@/types';

export const VM_TRANSITIONAL: VM['status'][] = ['provisioning', 'starting', 'stopping', 'rebooting', 'migrating', 'resizing', 'restoring', 'deleting'];

/** Default login user per OS family (cloud images convention). */
export function defaultUser(img?: Image | null): string {
  switch (img?.os) {
    case 'debian': return 'debian';
    case 'fedora': return 'fedora';
    case 'rocky': return 'rocky';
    case 'alma': return 'almalinux';
    case 'suse': return 'opensuse';
    case 'flatcar': return 'core';
    case 'windows': return 'Administrator';
    default: return 'ubuntu';
  }
}

export interface OsInfo { pretty: string; id: string; idLike?: string; versionId: string; codename?: string; kernel: string; pkg: 'apt' | 'dnf' | 'zypper' | 'none' }

/** Plausible /etc/os-release + kernel data for an image (custom images assume an Ubuntu base). */
export function osInfo(img?: Image | null): OsInfo {
  const v = img?.version ?? '24.04';
  switch (img?.os) {
    case 'debian': return v === '13'
      ? { pretty: 'Debian GNU/Linux 13 (trixie)', id: 'debian', versionId: '13', codename: 'trixie', kernel: '6.12.9-amd64', pkg: 'apt' }
      : { pretty: 'Debian GNU/Linux 12 (bookworm)', id: 'debian', versionId: '12', codename: 'bookworm', kernel: '6.1.0-26-amd64', pkg: 'apt' };
    case 'fedora': return { pretty: `Fedora Linux ${v} (Cloud Edition)`, id: 'fedora', versionId: v, kernel: `6.14.2-300.fc${v}.x86_64`, pkg: 'dnf' };
    case 'rocky': return { pretty: `Rocky Linux ${v} (Blue Onyx)`, id: 'rocky', idLike: 'rhel centos fedora', versionId: v, kernel: '5.14.0-503.14.1.el9_5.x86_64', pkg: 'dnf' };
    case 'alma': return { pretty: `AlmaLinux ${v} (Teal Serval)`, id: 'almalinux', idLike: 'rhel centos fedora', versionId: v, kernel: '5.14.0-503.14.1.el9_5.x86_64', pkg: 'dnf' };
    case 'suse': return { pretty: `openSUSE Leap ${v}`, id: 'opensuse-leap', idLike: 'suse opensuse', versionId: v, kernel: '6.4.0-150600.23.25-default', pkg: 'zypper' };
    case 'flatcar': return { pretty: 'Flatcar Container Linux by Kinvolk 4081.2.0 (Oklo)', id: 'flatcar', versionId: '4081.2.0', kernel: '6.6.60-flatcar', pkg: 'none' };
    case 'custom': {
      const base22 = /22\.04/.test(img?.description ?? '');
      return { pretty: `Ubuntu ${base22 ? '22.04.5' : '24.04.1'} LTS (${img?.name})`, id: 'ubuntu', idLike: 'debian', versionId: base22 ? '22.04' : '24.04', codename: base22 ? 'jammy' : 'noble', kernel: base22 ? '5.15.0-125-generic' : '6.8.0-48-generic', pkg: 'apt' };
    }
    default: {
      const map: Record<string, [string, string, string]> = { '24.04': ['24.04.1', 'noble', '6.8.0-48-generic'], '22.04': ['22.04.5', 'jammy', '5.15.0-125-generic'], '20.04': ['20.04.6', 'focal', '5.4.0-200-generic'] };
      const [full, code, kernel] = map[v] ?? map['24.04'];
      return { pretty: `Ubuntu ${full} LTS`, id: 'ubuntu', idLike: 'debian', versionId: v, codename: code, kernel, pkg: 'apt' };
    }
  }
}

/** Deterministic MAC address for a VM NIC. */
export function macFor(vmId: string, nic = 0): string {
  const h = hashString(`${vmId}:${nic}`);
  const b = [0x52, 0x54, 0x00, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff];
  return b.map((x) => x.toString(16).padStart(2, '0')).join(':');
}

export function uptimeMs(vm: VM): number {
  if (vm.status !== 'running' || !vm.lastStartedAt) return 0;
  return Math.max(0, Date.now() - Date.parse(vm.lastStartedAt));
}

export function fmtUptime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}d ${h}h ${mm}m` : h ? `${h}h ${mm}m` : `${mm} min`;
}

/** Deterministic global IPv6 (/128 from the location's pool) when IPv6 is enabled — matches the console's `ip addr`. */
export function ipv6For(vm: VM): string | null {
  return vm.ipv6 ? `2a01:4f8:c0c:${vm.id.slice(-4)}::1` : null;
}

export function flagEmoji(country: string | undefined): string {
  if (!country || country.length !== 2) return '';
  return String.fromCodePoint(...[...country.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export const COUNTRY: Record<string, string> = {
  DE: 'Germany', NL: 'Netherlands', FI: 'Finland', FR: 'France', IE: 'Ireland', US: 'United States', GB: 'United Kingdom', PL: 'Poland', AT: 'Austria',
  CH: 'Switzerland', SE: 'Sweden', ES: 'Spain', IT: 'Italy', BE: 'Belgium', DK: 'Denmark', NO: 'Norway', SG: 'Singapore', CA: 'Canada', LU: 'Luxembourg',
};

export function archLabel(img?: Image | null): string {
  return img?.arch === 'arm64' ? 'Arm64' : 'x86';
}

/* ---------------------------------------------------------------- month-to-date usage (Hetzner style) */

export const TRAFFIC_INCLUDED_TB = 20;

function monthStart(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}
function monthLengthMs(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() - monthStart(now);
}

/** Fraction of the current month this VM has existed (0..1). */
export function monthElapsedFraction(vm: VM, now = Date.now()): number {
  const start = Math.max(monthStart(now), Date.parse(vm.createdAt) || 0);
  return Math.max(0, Math.min(1, (now - start) / monthLengthMs(now)));
}

/** Approximate month-to-date charges: current run-rate × elapsed share of the month (capped at the monthly price). */
export function usageThisMonth(vm: VM, now = Date.now()): number {
  return (vm.monthlyCost ?? 0) * monthElapsedFraction(vm, now);
}

/** Deterministic outbound traffic estimate this month in bytes, derived from the netOut metric profile
 *  (same seed bias as the mock) with a ~10% average utilisation of the charted throughput. */
export function trafficOutThisMonth(vm: VM, now = Date.now()): number {
  const seedBias = (vm.id.charCodeAt(vm.id.length - 1) % 7) * 4;
  const avgMbps = (70 + seedBias * 6) * 0.1;
  const start = Math.max(monthStart(now), Date.parse(vm.createdAt) || 0);
  const seconds = Math.max(0, (now - start) / 1000);
  const duty = vm.status === 'running' ? 0.92 : 0.55; // stopped VMs were partly off this month
  return (avgMbps * 1e6 / 8) * seconds * duty;
}
