import type { VM, Image, Location, BareMetalHost, Network, IpAddress, Firewall, Volume, Snapshot, SshKey, Project, VmPreset } from '@/types';

/** Everything the VM detail tabs need, resolved once by the page. */
export interface VmCtx {
  vm: VM;
  image?: Image;
  location?: Location;
  host?: BareMetalHost;
  network?: Network;
  project?: Project;
  preset?: VmPreset;
  ips: IpAddress[];
  firewalls: Firewall[];
  allFirewalls: Firewall[];
  volumes: Volume[];
  snapshots: Snapshot[];
  sshKeys: SshKey[];
  allSshKeys: SshKey[];
}

export type VmModal = 'resize' | 'migrate' | 'rebuild' | 'clone' | 'rename' | 'snapshot' | 'newVolume' | null;
