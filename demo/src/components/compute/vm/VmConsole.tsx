import { createPortal } from 'react-dom';
import { overlayRoot } from '@/lib/overlay';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Maximize2, Minimize2, Eraser, Power, TerminalSquare, Keyboard } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { parseCidr } from '@/lib/cidr';
import { defaultUser, osInfo, macFor, uptimeMs, fmtUptime, VM_TRANSITIONAL } from './util';
import type { VM, Image, Volume, SshKey, Network } from '@/types';

/* A simulated serial console (ttyS0) with a tiny fake shell that reflects the VM's real data. */

type Kind = 'out' | 'err' | 'sys' | 'cmd' | 'ok' | 'dim' | 'warn';
interface Line { k: Kind; t: string; prompt?: string }

export interface ConsoleProps {
  vm: VM;
  image?: Image | null;
  volumes: Volume[];
  publicIps: string[];
  network?: Network | null;
  hostName?: string | null;
  sshKeys: SshKey[];
  cpu?: number;
  ram?: number;
  onPower: (action: 'start' | 'stop' | 'reboot') => void;
}

const COMMANDS = ['help', 'uname', 'hostname', 'whoami', 'id', 'pwd', 'date', 'uptime', 'nproc', 'free', 'df', 'lsblk', 'ip', 'cat', 'ls', 'cd', 'echo', 'history', 'clear',
  'systemctl', 'top', 'ps', 'ping', 'curl', 'nvidia-smi', 'docker', 'apt', 'dnf', 'sudo', 'reboot', 'poweroff', 'exit', 'logout', 'neofetch', 'journalctl'];

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);
const fmtG = (gbv: number) => (gbv >= 1024 ? `${(gbv / 1024).toFixed(1)}T` : gbv >= 10 ? `${Math.round(gbv)}G` : `${gbv.toFixed(1)}G`);
const nowStr = () => new Date().toUTCString().replace('GMT', 'UTC');

export function VmConsole(p: ConsoleProps) {
  const { vm, image } = p;
  const isWin = image?.os === 'windows';
  const user = isWin ? 'Administrator' : defaultUser(image);
  const os = osInfo(image);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [cwd, setCwd] = useState('~');
  const [loggedOut, setLoggedOut] = useState(false);
  const [full, setFull] = useState(false);
  const [focused, setFocused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevStatus = useRef<VM['status'] | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const running = vm.status === 'running';
  const transitional = VM_TRANSITIONAL.includes(vm.status);
  const prompt = isWin ? 'SAC>' : `${user}@${vm.name}:${cwd}$`;

  const services = useMemo(() => {
    const s = new Set(['ssh', 'qemu-guest-agent', 'cloud-init', 'systemd-journald', 'cron']);
    if (/nginx/.test(vm.initScript) || /web/.test(vm.name) || /nginx/.test(image?.description ?? '')) s.add('nginx');
    if (/docker/.test(vm.initScript)) s.add('docker');
    if (/k3s/.test(vm.initScript)) s.add('k3s');
    if (/monitoring|prometheus/.test(vm.name)) { s.add('prometheus'); s.add('grafana-server') }
    if (/gitlab-runner/.test(vm.name)) s.add('gitlab-runner');
    if (/vpn/.test(vm.name)) s.add('wg-quick@wg0');
    if (/hana/.test(vm.name)) s.add('sapinit');
    else if (/db|postgres/.test(vm.name)) s.add('postgresql');
    if (/^(isu|s4)-(app|ascs|webdispatcher)/.test(vm.name)) s.add('sapinit');
    if (/^compass-app/.test(vm.name)) s.add('compass-app');
    if (/^compass-billing/.test(vm.name)) s.add('compass-batch');
    if (/jupyter/.test(vm.name)) s.add('jupyterhub');
    if (vm.gpu) s.add('nvidia-persistenced');
    return s;
  }, [vm.initScript, vm.name, vm.gpu, image?.description]);

  const push = useCallback((ls: Line[]) => setLines((x) => [...x, ...ls].slice(-600)), []);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] };

  const banner = useCallback((): Line[] => {
    if (isWin) {
      return [
        { k: 'sys', t: `Connected to serial console of ${vm.name} (COM1). Escape sequence: Ctrl+]` },
        { k: 'out', t: '' },
        { k: 'out', t: 'Computer is booting, SAC started and initialized.' },
        { k: 'out', t: 'Use the "ch -?" command for information about using channels.' },
        { k: 'out', t: 'Use the "?" command for general help.' },
        { k: 'out', t: '' },
      ];
    }
    const up = uptimeMs(vm);
    return [
      { k: 'sys', t: `Connected to serial console of ${vm.name} (ttyS0, 115200 8N1). Escape sequence: Ctrl+]` },
      { k: 'out', t: '' },
      { k: 'out', t: `${os.pretty} ${vm.name} ttyS0` },
      { k: 'out', t: '' },
      { k: 'out', t: `${vm.name} login: ${user} (authenticated via console token)` },
      { k: 'dim', t: `Last login: ${new Date(Date.now() - Math.min(up || 3600_000, 86_400_000) * 0.4).toUTCString().replace('GMT', 'UTC')} from 192.0.2.44` },
      ...(os.id === 'ubuntu' ? [
        { k: 'out' as Kind, t: `Welcome to ${os.pretty} (GNU/Linux ${os.kernel} x86_64)` },
        { k: 'out' as Kind, t: '' },
        { k: 'dim' as Kind, t: `  System load:  ${(p.cpu ?? 20) / 100 * vm.size.vcpus > 0 ? ((p.cpu ?? 20) / 100 * vm.size.vcpus).toFixed(2) : '0.08'}      Processes:     ${120 + services.size * 6}` },
        { k: 'dim' as Kind, t: `  Memory usage: ${Math.round(p.ram ?? 40)}%       IPv4 address for eth0: ${vm.privateIp}` },
        { k: 'dim' as Kind, t: `  Usage of /:   ${Math.round(28 + (vm.id.charCodeAt(vm.id.length - 1) % 7) * 6)}% of ${vm.size.systemDiskGB}GB   Users logged in: 1` },
      ] : []),
      { k: 'out', t: '' },
      { k: 'dim', t: 'Type "help" for the commands this console supports.' },
    ];
  }, [isWin, vm, os.pretty, os.id, os.kernel, user, p.cpu, p.ram, services.size]);

  const bootLog = useCallback((kind: 'boot' | 'shutdown') => {
    clearTimers();
    const seq: Line[] = kind === 'shutdown'
      ? [
        { k: 'sys', t: `[  OK  ] Stopped target graphical.target.` },
        ...[...services].slice(0, 5).map((s) => ({ k: 'out' as Kind, t: `         Stopping ${s}.service…` })),
        { k: 'ok', t: '[  OK  ] Stopped ssh.service - OpenBSD Secure Shell server.' },
        { k: 'ok', t: '[  OK  ] Unmounted /boot/efi.' },
        { k: 'ok', t: '[  OK  ] Reached target shutdown.target.' },
        { k: 'out', t: `[${(uptimeMs(vm) / 1000).toFixed(6).padStart(12)}] reboot: Power down` },
      ]
      : isWin
        ? [{ k: 'out', t: 'Starting Windows…' }, { k: 'out', t: 'EMS: Emergency Management Services enabled on COM1' }, { k: 'out', t: 'Applying computer settings…' }]
        : [
          { k: 'dim', t: 'SeaBIOS (version 1.16.3) · Booting from Hard Disk…' },
          { k: 'out', t: `[    0.000000] Linux version ${os.kernel} (buildd@lcy02) (gcc 13.2.0) #48 SMP PREEMPT_DYNAMIC` },
          { k: 'out', t: `[    0.000000] Command line: BOOT_IMAGE=/vmlinuz root=LABEL=cloudimg-rootfs ro console=ttyS0,115200` },
          { k: 'out', t: `[    0.012411] KVM setup pv remote TLB flush · smpboot: Allowing ${vm.size.vcpus} CPUs` },
          { k: 'out', t: `[    0.118204] Memory: ${vm.size.ramGB * 1024 * 1024 - 210_412}K/${vm.size.ramGB * 1024 * 1024}K available` },
          { k: 'out', t: `[    0.902117] virtio_blk virtio2: [vda] ${vm.size.systemDiskGB * 2_097_152} 512-byte logical blocks (${vm.size.systemDiskGB} GB)` },
          ...p.volumes.map((v, i) => ({ k: 'out' as Kind, t: `[    0.9${String(31 + i * 7).padStart(5, '0')}] virtio_blk virtio${3 + i}: [${v.attachedTo?.device.replace('/dev/', '') ?? 'vdb'}] (${v.sizeGB} GB)` })),
          { k: 'out', t: `[    1.204551] virtio_net virtio1 eth0: renamed from ens3` },
          ...(vm.gpu ? [{ k: 'out' as Kind, t: `[    1.511020] nvidia: loading out-of-tree module · ${vm.gpu.count}× ${vm.gpu.model} via VFIO` }] : []),
          { k: 'ok', t: '[  OK  ] Started systemd-journald.service - Journal Service.' },
          { k: 'ok', t: '[  OK  ] Reached target network-online.target.' },
          { k: 'out', t: `cloud-init[612]: Cloud-init v. 24.3 running 'modules:config'` },
          ...[...services].filter((s) => !['cloud-init', 'systemd-journald'].includes(s)).map((s) => ({ k: 'ok' as Kind, t: `[  OK  ] Started ${s}.service.` })),
          { k: 'ok', t: '[  OK  ] Reached target multi-user.target - Multi-User System.' },
        ];
    seq.forEach((l, i) => timers.current.push(setTimeout(() => push([l]), 140 * i)));
  }, [services, vm, os.kernel, isWin, p.volumes, push]);

  // react to power state changes
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = vm.status;
    if (vm.status === 'running' && prev !== 'running') {
      clearTimers();
      setLoggedOut(false); setCwd('~');
      if (prev && prev !== 'stopped') { timers.current.push(setTimeout(() => push([{ k: 'out', t: '' }, ...banner()]), 300)) }
      else setLines(banner());
    } else if ((vm.status === 'starting' || vm.status === 'rebooting' || vm.status === 'provisioning' || vm.status === 'restoring') && prev !== vm.status) {
      if (vm.status === 'rebooting' || prev === 'running') bootLog('shutdown');
      timers.current.push(setTimeout(() => bootLog('boot'), vm.status === 'rebooting' ? 1300 : 0));
      if (prev !== 'running') setLines([{ k: 'sys', t: `Connected to serial console of ${vm.name} — waiting for boot…` }]);
    } else if (vm.status === 'stopping' && prev === 'running') {
      bootLog('shutdown');
    }
  }, [vm.status]); // eslint-disable-line
  useEffect(() => () => clearTimers(), []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) }, [lines, input]);

  /* ------------------------------------------------------------ commands */
  const exec = (raw: string): Line[] | 'clear' => {
    let cmdline = raw.trim();
    if (!cmdline) return [];
    if (isWin) return execSac(cmdline);
    let grep: string | null = null;
    let head: number | null = null;
    const pipe = cmdline.split('|').map((x) => x.trim());
    cmdline = pipe[0];
    for (const pp of pipe.slice(1)) {
      const g = /^grep\s+(?:-i\s+)?["']?([^"']+)["']?$/.exec(pp); if (g) grep = g[1];
      const h = /^head(?:\s+-n?\s*(\d+))?$/.exec(pp); if (h) head = Number(h[1] ?? 10);
    }
    let sudo = false;
    if (cmdline.startsWith('sudo ')) { sudo = true; cmdline = cmdline.slice(5).trim() }
    const [cmd, ...args] = cmdline.split(/\s+/);
    const arg = args.join(' ');
    const o = (t: string, k: Kind = 'out'): Line => ({ k, t });
    let out: Line[] | 'clear';
    const disk = Math.round(28 + (vm.id.charCodeAt(vm.id.length - 1) % 7) * 6) / 100;
    const ramUsedPct = (p.ram ?? 40) / 100;
    const subnet = p.network?.subnets.find((s) => s.id === vm.subnetId);
    const prefix = subnet ? parseCidr(subnet.cidr)?.prefix ?? 24 : 24;
    const up = uptimeMs(vm);
    const load = ((p.cpu ?? 20) / 100) * vm.size.vcpus;
    const loadStr = `${load.toFixed(2)}, ${(load * 0.92).toFixed(2)}, ${(load * 0.85).toFixed(2)}`;
    switch (cmd) {
      case 'help': out = [
        o('Supported commands (simulated):', 'ok'),
        o('  uname -a · hostname · whoami · id · date · uptime · nproc · free -h · df -h · lsblk'),
        o('  ip a · ip r · ping <host> · curl ifconfig.me · cat <file> · ls · cd · echo · history · clear'),
        o('  systemctl status <unit> · journalctl -u <unit> · top · ps aux · neofetch'),
        o(`  ${vm.gpu ? 'nvidia-smi · ' : ''}${services.has('docker') ? 'docker ps · ' : ''}${os.pkg !== 'none' ? `sudo ${os.pkg} update · ` : ''}sudo reboot · sudo poweroff · exit`),
        o('  pipes: … | grep <text> · … | head -n <N>', 'dim'),
        o('Try: cat /etc/os-release, df -h, systemctl status nginx', 'dim'),
      ]; break;
      case 'uname': out = [o(args.includes('-a') ? `Linux ${vm.name} ${os.kernel} #48-${os.id === 'ubuntu' ? 'Ubuntu' : os.id} SMP PREEMPT_DYNAMIC ${new Date(Date.now() - 40 * 86_400_000).toDateString()} x86_64 x86_64 x86_64 GNU/Linux` : args.includes('-r') ? os.kernel : args.includes('-n') ? vm.name : 'Linux')]; break;
      case 'hostname': out = [o(args.includes('-I') ? `${vm.privateIp} ${vm.ipv6 ? '2a01:4f8:c0c:' + vm.id.slice(-4) + '::1' : ''}`.trim() : vm.name)]; break;
      case 'whoami': out = [o(sudo ? 'root' : user)]; break;
      case 'id': out = [o(sudo ? 'uid=0(root) gid=0(root) groups=0(root)' : `uid=1000(${user}) gid=1000(${user}) groups=1000(${user}),4(adm),27(sudo)${services.has('docker') ? ',999(docker)' : ''}`)]; break;
      case 'pwd': out = [o(cwd === '~' ? `/home/${user}` : cwd.replace('~', `/home/${user}`))]; break;
      case 'date': out = [o(nowStr())]; break;
      case 'nproc': out = [o(String(vm.size.vcpus))]; break;
      case 'uptime': out = [o(` ${new Date().toTimeString().slice(0, 8)} up ${fmtUptime(up)},  1 user,  load average: ${loadStr}`)]; break;
      case 'free': {
        const tot = vm.size.ramGB * 1024, used = Math.round(tot * ramUsedPct), cache = Math.round(tot * 0.22), free = Math.max(0, tot - used - cache);
        const f = (mb: number) => (args.includes('-h') ? (mb >= 1024 ? `${(mb / 1024).toFixed(1)}Gi` : `${mb}Mi`) : String(mb * 1024));
        out = [o(`${pad('', 7)}${lpad('total', 12)}${lpad('used', 12)}${lpad('free', 12)}${lpad('shared', 12)}${lpad('buff/cache', 12)}${lpad('available', 12)}`),
          o(`${pad('Mem:', 7)}${lpad(f(tot), 12)}${lpad(f(used), 12)}${lpad(f(free), 12)}${lpad(f(Math.round(tot * 0.01)), 12)}${lpad(f(cache), 12)}${lpad(f(tot - used), 12)}`),
          o(`${pad('Swap:', 7)}${lpad(f(0), 12)}${lpad(f(0), 12)}${lpad(f(0), 12)}`)];
        break;
      }
      case 'df': {
        const rows: [string, number, number, string][] = [
          ['/dev/vda1', vm.size.systemDiskGB - 1, (vm.size.systemDiskGB - 1) * disk, '/'],
          ['/dev/vda15', 0.1, 0.006, '/boot/efi'],
          ...p.volumes.filter((v) => v.filesystem !== 'none').map((v) => [v.attachedTo?.device ?? '/dev/vdb', v.sizeGB, v.usedGB, `/mnt/${v.name}`] as [string, number, number, string]),
        ];
        out = [o(`${pad('Filesystem', 16)}${lpad('Size', 6)}${lpad('Used', 6)}${lpad('Avail', 7)}${lpad('Use%', 6)} Mounted on`),
          o(`${pad('tmpfs', 16)}${lpad(fmtG(vm.size.ramGB / 10), 6)}${lpad('1.2M', 6)}${lpad(fmtG(vm.size.ramGB / 10), 7)}${lpad('1%', 6)} /run`),
          ...rows.map(([fs, size, used, mnt]) => o(`${pad(fs, 16)}${lpad(fmtG(size), 6)}${lpad(fmtG(used), 6)}${lpad(fmtG(Math.max(0, size - used)), 7)}${lpad(`${Math.round((used / size) * 100)}%`, 6)} ${mnt}`))];
        break;
      }
      case 'lsblk': out = [o(`${pad('NAME', 9)}${pad('MAJ:MIN', 8)}${lpad('SIZE', 6)} ${pad('TYPE', 5)}MOUNTPOINTS`),
        o(`${pad('vda', 9)}${pad('253:0', 8)}${lpad(fmtG(vm.size.systemDiskGB), 6)} ${pad('disk', 5)}`),
        o(`${pad('├─vda1', 9)}${pad('253:1', 8)}${lpad(fmtG(vm.size.systemDiskGB - 1), 6)} ${pad('part', 5)}/`),
        o(`${pad('└─vda15', 9)}${pad('253:15', 8)}${lpad('106M', 6)} ${pad('part', 5)}/boot/efi`),
        ...p.volumes.map((v, i) => o(`${pad(v.attachedTo?.device.replace('/dev/', '') ?? `vd${String.fromCharCode(98 + i)}`, 9)}${pad(`253:${16 * (i + 1)}`, 8)}${lpad(fmtG(v.sizeGB), 6)} ${pad('disk', 5)}${v.filesystem === 'none' ? '' : `/mnt/${v.name}`}`))];
        break;
      case 'ip': {
        if (/^(r|route)/.test(arg)) {
          out = [o(`default via ${subnet?.gateway ?? vm.privateIp.replace(/\.\d+$/, '.1')} dev eth0 proto dhcp src ${vm.privateIp} metric 100`), o(`${subnet?.cidr ?? '10.0.0.0/24'} dev eth0 proto kernel scope link src ${vm.privateIp} metric 100`)];
        } else if (!arg || /^(a|addr|address)/.test(arg)) {
          out = [
            o('1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000'),
            o('    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00', 'dim'),
            o('    inet 127.0.0.1/8 scope host lo'),
            o(`2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu ${p.network?.mtu ?? 1450} qdisc mq state UP group default qlen 1000`),
            o(`    link/ether ${macFor(vm.id)} brd ff:ff:ff:ff:ff:ff`, 'dim'),
            o(`    inet ${vm.privateIp}/${prefix} metric 100 brd ${subnet ? subnet.cidr.replace(/\.\d+\/\d+$/, '.255') : ''} scope global dynamic eth0`),
            o('       valid_lft 86077sec preferred_lft 86077sec', 'dim'),
            ...(vm.ipv6 ? [o(`    inet6 2a01:4f8:c0c:${vm.id.slice(-4)}::1/64 scope global dynamic mngtmpaddr`)] : []),
            o(`    inet6 fe80::5054:ff:${macFor(vm.id).slice(9, 14).replace(':', '')}/64 scope link`),
            ...(p.publicIps.length ? [o(`# public ${p.publicIps.join(', ')} is 1:1 NATed by the Autark edge — not visible inside the guest`, 'dim')] : []),
          ];
        } else out = [o(`Object "${args[0]}" is unknown, try "ip help".`, 'err')];
        break;
      }
      case 'ping': {
        const target = args.find((x) => !x.startsWith('-')) ?? '';
        if (!target) { out = [o('ping: usage error: Destination address required', 'err')]; break }
        const local = /^10\.|^192\.168\.|\.internal$/.test(target);
        const ip = /^\d+\.\d+\.\d+\.\d+$/.test(target) ? target : local ? '10.0.0.53' : target === 'localhost' ? '127.0.0.1' : `93.184.${(target.length * 7) % 255}.${(target.length * 13) % 255}`;
        const base = target === 'localhost' ? 0.03 : local ? 0.3 : 9 + (target.length % 7);
        out = [o(`PING ${target} (${ip}) 56(84) bytes of data.`), ...[0, 1, 2, 3].map((i) => o(`64 bytes from ${ip}: icmp_seq=${i + 1} ttl=${local ? 64 : 57} time=${(base * (0.9 + ((i * 37) % 10) / 40)).toFixed(local ? 3 : 1)} ms`)),
          o(''), o(`--- ${target} ping statistics ---`), o(`4 packets transmitted, 4 received, 0% packet loss, time 3004ms`)];
        break;
      }
      case 'curl': {
        if (/ifconfig\.me|icanhazip|ipinfo\.io\/ip|api\.ipify/.test(arg)) out = [o(p.publicIps[0] ?? `${vm.privateIp.replace(/^10\.\d+/, '198.51')} (egress via NAT gateway)`)];
        else if (/localhost|127\.0\.0\.1/.test(arg)) out = services.has('nginx') ? [o('<!DOCTYPE html><html><head><title>Welcome to nginx!</title>…')] : [o('curl: (7) Failed to connect to localhost port 80 after 0 ms: Couldn\'t connect to server', 'err')];
        else if (!arg) out = [o("curl: try 'curl --help' for more information", 'err')];
        else out = [o(`curl: (6) Could not resolve host: ${args.at(-1)} (outbound HTTP is simulated in this console)`, 'warn')];
        break;
      }
      case 'cat': {
        const f = args[0] ?? '';
        if (f === '/etc/os-release') out = [o(`PRETTY_NAME="${os.pretty}"`), o(`NAME="${os.pretty.split(' ')[0]}"`), o(`VERSION_ID="${os.versionId}"`), ...(os.codename ? [o(`VERSION_CODENAME=${os.codename}`)] : []), o(`ID=${os.id}`), ...(os.idLike ? [o(`ID_LIKE="${os.idLike}"`)] : []), o('HOME_URL="https://autark.regiocom-energie.de/images"')];
        else if (f === '/etc/hostname') out = [o(vm.name)];
        else if (f === '/etc/hosts') out = [o('127.0.0.1 localhost'), o(`${vm.privateIp} ${vm.name}.${vm.projectId}.internal ${vm.name}`), o('::1 ip6-localhost ip6-loopback')];
        else if (f === '/proc/loadavg') out = [o(`${loadStr.replace(/,/g, '')} 2/${180 + services.size * 6} ${4000 + (up / 1000) % 9000 | 0}`)];
        else if (f === '/proc/cpuinfo') out = Array.from({ length: Math.min(vm.size.vcpus, 4) }).flatMap((_, i) => [o(`processor\t: ${i}`), o(`model name\t: ${p.hostName ? 'Intel Xeon Processor (Cascadelake)' : 'AMD EPYC-Milan Processor'}`), o('flags\t\t: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr hypervisor avx2 aes'), o('')]).concat(vm.size.vcpus > 4 ? [o(`… ${vm.size.vcpus - 4} more`, 'dim')] : []);
        else if (/authorized_keys/.test(f)) out = p.sshKeys.length ? p.sshKeys.map((k) => o(k.publicKey)) : [o('# no keys injected', 'dim')];
        else if (/user-data/.test(f)) out = vm.initScript ? vm.initScript.trimEnd().split('\n').map((l) => o(l)) : [o('# no cloud-init user data', 'dim')];
        else if (!f) out = [];
        else out = [o(`cat: ${f}: ${f.startsWith('/etc/shadow') && !sudo ? 'Permission denied' : 'No such file or directory'}`, 'err')];
        break;
      }
      case 'ls': {
        const target = (args.find((x) => !x.startsWith('-')) ?? cwd).replace(/\/$/, '') || '/';
        const long = args.some((x) => x.startsWith('-l'));
        const dirs: Record<string, string[]> = {
          '~': ['.bashrc', '.profile', '.ssh', ...(services.has('docker') ? ['docker-compose.yml'] : []), ...(vm.gpu ? ['train.py', 'checkpoints'] : [])],
          '/': ['bin', 'boot', 'dev', 'etc', 'home', 'lib', 'mnt', 'opt', 'proc', 'root', 'run', 'srv', 'sys', 'tmp', 'usr', 'var'],
          '/mnt': p.volumes.filter((v) => v.filesystem !== 'none').map((v) => v.name),
          '~/.ssh': ['authorized_keys'],
          '/etc': ['hostname', 'hosts', 'os-release', 'ssh', 'systemd', ...(services.has('nginx') ? ['nginx'] : [])],
        };
        const key = target === `/home/${user}` ? '~' : target;
        const vol = p.volumes.find((v) => `/mnt/${v.name}` === key);
        const items = vol ? ['lost+found', 'data'] : dirs[key];
        if (!items) { out = [o(`ls: cannot access '${target}': No such file or directory`, 'err')]; break }
        out = items.length === 0 ? [] : long ? [o(`total ${items.length * 4}`), ...items.map((n) => o(`${n.includes('.') && !n.startsWith('.ssh') ? '-rw-r--r--' : 'drwxr-xr-x'} 1 ${user} ${user} ${lpad(4096, 6)} ${new Date().toDateString().slice(4, 10)} ${n}`))] : [o(items.join('  '))];
        break;
      }
      case 'cd': {
        const t = args[0] ?? '~';
        const next = t === '..' ? (cwd.includes('/') && cwd !== '/' ? cwd.replace(/\/[^/]+$/, '') || '/' : '/') : t.startsWith('/') || t.startsWith('~') ? t.replace(/\/$/, '') || '/' : `${cwd === '/' ? '' : cwd}/${t}`;
        const valid = ['~', '/', '/mnt', '/etc', '~/.ssh', '/home', '/tmp', '/var', '/var/log', ...p.volumes.map((v) => `/mnt/${v.name}`)];
        if (valid.includes(next)) { setCwd(next); out = [] } else out = [o(`-bash: cd: ${t}: No such file or directory`, 'err')];
        break;
      }
      case 'echo': out = [o(arg.replace(/\$HOSTNAME/g, vm.name).replace(/\$USER/g, user).replace(/\$HOME/g, `/home/${user}`).replace(/^["']|["']$/g, ''))]; break;
      case 'history': out = [...history, raw].map((h, i) => o(`${lpad(i + 1, 5)}  ${h}`)); break;
      case 'clear': out = 'clear'; break;
      case 'systemctl': {
        const unit = (args.find((x) => !x.startsWith('-') && x !== 'status' && x !== 'restart' && x !== 'start' && x !== 'stop') ?? '').replace(/\.service$/, '');
        const sub = args[0];
        if (sub === '--failed' || (sub === 'list-units' && args.includes('--failed'))) { out = [o('  UNIT LOAD ACTIVE SUB DESCRIPTION'), o('0 loaded units listed.')]; break }
        if (['restart', 'start', 'stop'].includes(sub ?? '')) { out = sudo ? (services.has(unit) ? [] : [o(`Failed to ${sub} ${unit}.service: Unit ${unit}.service not found.`, 'err')]) : [o(`Failed to ${sub} ${unit}.service: Interactive authentication required.`, 'err')]; break }
        if (sub !== 'status' || !unit) { out = [o('Usage: systemctl status <unit> (other subcommands are not simulated)', 'dim')]; break }
        const u = unit === 'sshd' ? 'ssh' : unit;
        if (!services.has(u)) { out = [o(`Unit ${unit}.service could not be found.`, 'err')]; break }
        const since = new Date(Date.parse(vm.lastStartedAt ?? vm.createdAt) + 8000);
        const desc: Record<string, string> = { nginx: 'A high performance web server and a reverse proxy server', ssh: 'OpenBSD Secure Shell server', docker: 'Docker Application Container Engine', 'qemu-guest-agent': 'QEMU Guest Agent', prometheus: 'Prometheus monitoring system', postgresql: 'PostgreSQL RDBMS', 'wg-quick@wg0': 'WireGuard via wg-quick(8) for wg0', 'gitlab-runner': 'GitLab Runner', k3s: 'Lightweight Kubernetes', jupyterhub: 'JupyterHub', sapinit: 'SAP startup framework (sapstartsrv)', 'compass-app': 'Compass ERP application server', 'compass-batch': 'Compass billing batch worker', cron: 'Regular background program processing daemon' };
        const pid = 900 + (u.length * 37) % 400;
        out = [
          { k: 'ok', t: `● ${u}.service - ${desc[u] ?? u}` },
          o(`     Loaded: loaded (/usr/lib/systemd/system/${u}.service; enabled; preset: enabled)`),
          { k: 'ok', t: `     Active: active (running) since ${since.toUTCString().replace('GMT', 'UTC')}; ${fmtUptime(Date.now() - since.getTime())} ago` },
          o(`   Main PID: ${pid} (${u.split('@')[0]})`),
          o(`      Tasks: ${u === 'nginx' ? vm.size.vcpus + 1 : 3 + (u.length % 9)} (limit: ${Math.round(vm.size.ramGB * 1170)})`),
          o(`     Memory: ${(3 + (u.length * 1.7) % 40).toFixed(1)}M`),
          o(`        CPU: ${((up / 1000) * 0.0004 * (u.length % 5 + 1)).toFixed(3)}s`),
          o(`     CGroup: /system.slice/${u}.service`),
          ...(u === 'nginx' ? [o(`             ├─${pid} "nginx: master process /usr/sbin/nginx -g daemon on; master_process on;"`), ...Array.from({ length: Math.min(vm.size.vcpus, 4) }).map((_, i) => o(`             ${i === Math.min(vm.size.vcpus, 4) - 1 ? '└' : '├'}─${pid + i + 1} "nginx: worker process"`))] : [o(`             └─${pid} /usr/sbin/${u.split('@')[0]}`)]),
        ];
        break;
      }
      case 'journalctl': {
        const unit = (args[args.indexOf('-u') + 1] ?? 'systemd').replace(/\.service$/, '');
        const t0 = Date.now() - 120_000;
        out = [0, 1, 2, 3, 4].map((i) => o(`${new Date(t0 + i * 24_000).toUTCString().slice(5, 25)} ${vm.name} ${unit}[${900 + i}]: ${['Started', 'Listening on 0.0.0.0', 'health check ok', 'reloaded configuration', 'connection from 10.10.1.5 accepted'][i]}`));
        break;
      }
      case 'top':
      case 'ps': {
        const procs: [string, string, number, number][] = [
          ...(services.has('nginx') ? [['www-data', 'nginx', 3.1, 0.4] as [string, string, number, number]] : []),
          ...(services.has('docker') ? [['root', 'dockerd', 2.2, 1.6] as [string, string, number, number]] : []),
          ...(services.has('prometheus') ? [['prometh+', 'prometheus', 11.4, 18.2] as [string, string, number, number]] : []),
          ...(services.has('postgresql') ? [['postgres', 'postgres', 8.4, 22.0] as [string, string, number, number]] : []),
          ...(services.has('gitlab-runner') ? [['gitlab-+', 'gitlab-runner', 4.0, 1.2] as [string, string, number, number]] : []),
          ...(services.has('sapinit') ? (/hana/.test(vm.name) ? [['ip1adm', 'hdbindexserver', 24.6, 71.3], ['ip1adm', 'hdbnameserver', 1.8, 2.1]] as [string, string, number, number][] : [['ip1adm', 'disp+work', 6.2, 9.8], ['ip1adm', 'sapstartsrv', 0.3, 0.2]] as [string, string, number, number][]) : []),
          ...(services.has('compass-app') ? [['compass', 'java -jar compass-app.jar', 14.2, 38.5] as [string, string, number, number]] : []),
          ...(services.has('compass-batch') ? [['compass', 'java -jar compass-billing.jar --run=turnus', 71.0, 54.2] as [string, string, number, number]] : []),
          ...(vm.gpu ? [[user, 'python3 train.py', 86.0, 31.5] as [string, string, number, number]] : []),
          ...(services.has('jupyterhub') ? [['jupyter', 'jupyterhub', 2.6, 3.4] as [string, string, number, number]] : []),
          ['root', 'qemu-ga', 0.3, 0.1], ['root', 'systemd-journald', 0.2, 0.3], ['root', 'sshd', 0.0, 0.1], ['root', 'cron', 0.0, 0.0], [user, '-bash', 0.0, 0.0],
        ];
        if (cmd === 'ps') { out = [o(`${pad('USER', 10)}${lpad('PID', 7)} ${lpad('%CPU', 5)} ${lpad('%MEM', 5)} COMMAND`), ...procs.map(([u, c, cpu, mem], i) => o(`${pad(u, 10)}${lpad(900 + i * 41, 7)} ${lpad(cpu.toFixed(1), 5)} ${lpad(mem.toFixed(1), 5)} ${c}`))]; break }
        const cpu = p.cpu ?? 20, tot = vm.size.ramGB * 1024, used = tot * ramUsedPct;
        out = [
          o(`top - ${new Date().toTimeString().slice(0, 8)} up ${fmtUptime(up)},  1 user,  load average: ${loadStr}`),
          o(`Tasks: ${120 + services.size * 6} total,   1 running, ${119 + services.size * 6} sleeping,   0 stopped,   0 zombie`),
          o(`%Cpu(s): ${(cpu * 0.7).toFixed(1)} us,  ${(cpu * 0.2).toFixed(1)} sy,  0.0 ni, ${(100 - cpu).toFixed(1)} id,  ${(cpu * 0.05).toFixed(1)} wa,  0.0 hi,  0.1 si,  ${(cpu * 0.05).toFixed(1)} st`),
          o(`MiB Mem : ${lpad(tot.toFixed(1), 9)} total, ${lpad((tot - used - tot * 0.22).toFixed(1), 9)} free, ${lpad(used.toFixed(1), 9)} used, ${lpad((tot * 0.22).toFixed(1), 9)} buff/cache`),
          o(`MiB Swap:       0.0 total,       0.0 free,       0.0 used. ${lpad((tot - used).toFixed(1), 9)} avail Mem`),
          o(''),
          { k: 'cmd', t: `${lpad('PID', 7)} ${pad('USER', 9)} ${lpad('%CPU', 5)} ${lpad('%MEM', 5)}     TIME+ COMMAND` },
          ...procs.map(([u, c, pc, mem], i) => o(`${lpad(900 + i * 41, 7)} ${pad(u, 9)} ${lpad(pc.toFixed(1), 5)} ${lpad(mem.toFixed(1), 5)} ${lpad(`${Math.floor((up / 60000) * pc / 100)}:${String(i * 7 % 60).padStart(2, '0')}.${i}1`, 9)} ${c}`)),
          o('(snapshot — interactive top is not simulated; press ↑ + Enter to refresh)', 'dim'),
        ];
        break;
      }
      case 'nvidia-smi': {
        if (!vm.gpu) { out = [o('NVIDIA-SMI has failed because it couldn\'t communicate with the NVIDIA driver. Make sure that the latest NVIDIA driver is installed and running.', 'err')]; break }
        const mem = { A6000: 49140, L40S: 46068, H100: 81559, H200: 143771 }[vm.gpu.model];
        out = [
          o(`+-----------------------------------------------------------------------------------------+`),
          o(`| NVIDIA-SMI 560.35.03              Driver Version: 560.35.03      CUDA Version: 12.6     |`),
          o(`|-----------------------------------------+------------------------+----------------------+`),
          o(`| GPU  Name                 Persistence-M | Bus-Id          Disp.A | Volatile Uncorr. ECC |`),
          o(`| Fan  Temp   Perf          Pwr:Usage/Cap |           Memory-Usage | GPU-Util  Compute M. |`),
          ...Array.from({ length: vm.gpu.count }).flatMap((_, i) => [
            o(`|   ${i}  NVIDIA ${pad(vm.gpu!.model, 15)}      On  |   00000000:0${i + 5}:00.0 Off |                  Off |`),
            o(`| ${lpad(30 + i * 4, 2)}%   ${66 + i * 3}C    P2   ${lpad(210 + i * 17, 3)}W / 300W |  ${lpad(Math.round(mem * 0.64), 5)}MiB / ${mem}MiB |     ${lpad(Math.round(p.cpu ? 60 + (p.cpu % 30) : 82), 3)}%      Default |`),
          ]),
          o(`+-----------------------------------------------------------------------------------------+`),
        ];
        break;
      }
      case 'docker': out = !services.has('docker') ? [o(`Command 'docker' not found, but can be installed with: sudo ${os.pkg} install docker.io`, 'err')] : !sudo && !args.length ? [o('Usage:  docker [OPTIONS] COMMAND')] : [o('CONTAINER ID   IMAGE          COMMAND                  STATUS        PORTS                NAMES'), o('3f2a9c1be0d4   nginx:1.27     "/docker-entrypoint.…"   Up 3 days     0.0.0.0:80->80/tcp   web'), o('a81c03dd52e7   redis:7        "docker-entrypoint.s…"   Up 3 days     6379/tcp             cache')]; break;
      case 'apt': case 'apt-get': case 'dnf': case 'yum': case 'zypper': {
        if (!sudo) { out = [o(cmd.startsWith('apt') ? 'E: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)' : 'Error: This command has to be run with superuser privileges (under the root user on most systems).', 'err')]; break }
        out = cmd.startsWith('apt') && os.pkg === 'apt'
          ? [o(`Hit:1 http://mirror.autark.internal/${os.id} ${os.codename} InRelease`), o(`Get:2 http://mirror.autark.internal/${os.id} ${os.codename}-updates InRelease [126 kB]`), o(`Get:3 http://mirror.autark.internal/${os.id} ${os.codename}-security InRelease [126 kB]`), o('Fetched 252 kB in 1s (310 kB/s)'), o('Reading package lists... Done'), o(`${(vm.id.charCodeAt(5) % 9) + 2} packages can be upgraded. Run 'apt list --upgradable' to see them.`, 'ok')]
          : os.pkg === 'dnf' && (cmd === 'dnf' || cmd === 'yum') ? [o(`${os.pretty.split(' (')[0]} - BaseOS    3.1 MB/s | 2.4 MB     00:00`), o('Dependencies resolved.'), o('Nothing to do.'), o('Complete!', 'ok')]
            : [o(`sudo: ${cmd}: command not found`, 'err')];
        break;
      }
      case 'neofetch': out = [
        { k: 'ok', t: `${user}@${vm.name}` }, o('-'.repeat(user.length + vm.name.length + 1)),
        o(`OS: ${os.pretty} x86_64`), o(`Host: KVM/QEMU (Autark ${vm.hostId ? p.hostName ?? 'hypervisor' : 'cloud burst'})`), o(`Kernel: ${os.kernel}`), o(`Uptime: ${fmtUptime(up)}`),
        o(`CPU: ${vm.size.vcpus} vCPU`), ...(vm.gpu ? [o(`GPU: ${vm.gpu.count}× NVIDIA ${vm.gpu.model}`)] : []), o(`Memory: ${Math.round(vm.size.ramGB * 1024 * ramUsedPct)}MiB / ${vm.size.ramGB * 1024}MiB`), o(`Disk (/): ${Math.round(vm.size.systemDiskGB * disk)}G / ${vm.size.systemDiskGB}G`),
      ]; break;
      case 'reboot': case 'poweroff': case 'shutdown': case 'halt': {
        if (!sudo) { out = [o(`Call to ${cmd === 'reboot' ? 'Reboot' : 'PowerOff'} failed: Interactive authentication required.`, 'err')]; break }
        const action = cmd === 'reboot' || args.includes('-r') ? 'reboot' : 'stop';
        out = [o(''), { k: 'warn', t: `Broadcast message from root@${vm.name} on pts/0 (${nowStr()}):` }, o(''), { k: 'warn', t: `The system will ${action === 'reboot' ? 'reboot' : 'power off'} now!` }];
        setTimeout(() => p.onPower(action), 400);
        break;
      }
      case 'exit': case 'logout':
        setLoggedOut(true);
        out = [o('logout'), o(''), { k: 'sys', t: 'Session closed. Press Enter to log in again.' }];
        break;
      default: out = [o(`${cmd}: command not found`, 'err')];
    }
    if (out !== 'clear' && (grep || head)) {
      let filtered = out;
      if (grep) filtered = filtered.filter((l) => l.t.toLowerCase().includes(grep!.toLowerCase()));
      if (head) filtered = filtered.slice(0, head);
      return filtered;
    }
    return out;
  };

  const execSac = (cmdline: string): Line[] | 'clear' => {
    const o = (t: string, k: Kind = 'out'): Line => ({ k, t });
    const c = cmdline.toLowerCase();
    if (c === '?' || c === 'help') return ['ch       Channel management commands. Use ch -? for more help.', 'cmd      Create a Command Prompt channel.', 'd        Dump the current kernel log.', 'f        Toggle detailed or abbreviated tlist info.', 'i        List all IP network numbers and their IP addresses.', 'id       Display the computer identification information.', 'restart  Restart the system immediately.', 'shutdown Shutdown the system immediately.', 't        Tlist.', 'cls      Clear the screen.'].map((t) => o(t));
    if (c === 'cls' || c === 'clear') return 'clear';
    if (c === 'i') return [o(`Net: 10, Ip=${vm.privateIp}  Subnet=255.255.255.0  Gateway=${vm.privateIp.replace(/\.\d+$/, '.1')}`)];
    if (c === 'id') return [o(`Computer Name: ${vm.name.toUpperCase().slice(0, 15)}`), o('Computer GUID: ' + vm.id), o('Processor Architecture: x64'), o('Build Number: 20348'), o('Product: Windows Server 2022 Datacenter'), o(`Running Time: ${fmtUptime(uptimeMs(vm))}`)];
    if (c === 't') return [o('   4      0 System'), o(' 412    512 smss.exe'), o(' 620   2048 csrss.exe'), o(' 712   4096 wininit.exe'), o(' 828   8192 services.exe'), o('1204  16384 svchost.exe'), o('2210  32768 sqlservr.exe')];
    if (c === 'restart') { setTimeout(() => p.onPower('reboot'), 300); return [o('The system is restarting…', 'warn')] }
    if (c === 'shutdown') { setTimeout(() => p.onPower('stop'), 300); return [o('The system is shutting down…', 'warn')] }
    if (c === 'cmd') return [o('The Command Prompt session was successfully launched.'), o('SAC>'), o('EVENT:   A new channel has been created.  Use "ch -?" for channel help.'), o('Channel: Cmd0001', 'dim'), o('(Interactive cmd.exe channels are not simulated in this demo)', 'dim')];
    return [o('Unrecognized command.  Try "help".', 'err')];
  };

  const submit = () => {
    if (loggedOut) { setLoggedOut(false); setCwd('~'); setLines((l) => [...l, ...banner()]); setInput(''); return }
    const raw = input;
    const res = exec(raw);
    setHistIdx(null);
    if (raw.trim()) setHistory((h) => [...h, raw].slice(-100));
    setInput('');
    if (res === 'clear') { setLines([]); return }
    push([{ k: 'cmd', t: raw, prompt }, ...res]);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); submit() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (!history.length) return; const i = histIdx == null ? history.length - 1 : Math.max(0, histIdx - 1); setHistIdx(i); setInput(history[i]) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (histIdx == null) return; const i = histIdx + 1; if (i >= history.length) { setHistIdx(null); setInput('') } else { setHistIdx(i); setInput(history[i]) } }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const parts = input.split(' ');
      if (parts.length === 1) { const m = COMMANDS.filter((c) => c.startsWith(parts[0])); if (m.length === 1) setInput(m[0] + ' '); else if (m.length > 1) push([{ k: 'cmd', t: input, prompt }, { k: 'out', t: m.join('  ') }]) }
      else if (parts[0] === 'cat' || parts[parts.length - 2] === 'cat') { const files = ['/etc/os-release', '/etc/hostname', '/etc/hosts', '/proc/loadavg', '/proc/cpuinfo', '~/.ssh/authorized_keys', '/var/lib/cloud/instance/user-data.txt']; const last = parts[parts.length - 1]; const m = files.filter((f) => f.startsWith(last)); if (m.length === 1) setInput([...parts.slice(0, -1), m[0]].join(' ')) }
      else if (parts[0] === 'systemctl' && parts.length >= 3) { const last = parts[parts.length - 1]; const m = [...services].filter((s) => s.startsWith(last)); if (m.length === 1) setInput([...parts.slice(0, -1), m[0]].join(' ')) }
    }
    else if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); setLines([]) }
    else if (e.ctrlKey && e.key.toLowerCase() === 'c') { e.preventDefault(); push([{ k: 'cmd', t: input + '^C', prompt }]); setInput('') }
  };

  const canType = running && !transitional;
  const colors: Record<Kind, string> = { out: 'text-slate-200', err: 'text-rose-400', sys: 'text-sky-300', cmd: 'text-slate-100', ok: 'text-emerald-400', dim: 'text-slate-500', warn: 'text-amber-300' };

  const tree = (
    <div className={cn(full && 'fixed inset-0 z-[75] flex flex-col bg-black/60 p-2 backdrop-blur-sm @min-[36rem]:p-6')}>
      <div className={cn('overflow-hidden rounded-xl border border-white/10 bg-[#0b0d14] shadow-pop', full && 'flex min-h-0 flex-1 flex-col')}>
        <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-2">
          <div className="flex gap-1.5"><span className="size-2.5 rounded-full bg-rose-500/80" /><span className="size-2.5 rounded-full bg-amber-500/80" /><span className="size-2.5 rounded-full bg-emerald-500/80" /></div>
          <TerminalSquare className="ml-1 size-3.5 text-slate-400" />
          <span className="min-w-0 truncate font-mono text-[11.5px] text-slate-300">{vm.name} — {isWin ? 'EMS/SAC (COM1)' : 'serial console (ttyS0)'}</span>
          <span className={cn('ml-1 hidden items-center gap-1 rounded px-1.5 text-[10px] font-medium @min-[36rem]:inline-flex', canType ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/5 text-slate-400')}>
            <span className={cn('size-1.5 rounded-full', canType ? 'bg-emerald-400' : transitional ? 'animate-pulse-soft bg-sky-400' : 'bg-slate-500')} />{canType ? 'connected' : transitional ? vm.status : 'offline'}
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            <button onClick={() => setLines([])} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white" title="Clear (Ctrl+L)" aria-label="Clear"><Eraser className="size-3.5" /></button>
            {canType && <button onClick={() => p.onPower('reboot')} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white" title="Send Ctrl+Alt+Del (reboot)" aria-label="Send Ctrl+Alt+Del"><Power className="size-3.5" /></button>}
            <button onClick={() => setFull((f) => !f)} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white" title={full ? 'Exit full screen' : 'Full screen'} aria-label="Toggle full screen">{full ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}</button>
          </div>
        </div>
        <div className="relative">
          <div ref={scrollRef} onClick={() => inputRef.current?.focus()} className={cn('cursor-text overflow-y-auto px-3 py-2.5 font-mono text-[12px] leading-[1.55] @min-[36rem]:text-[12.5px]', full ? 'h-[calc(100vh-7rem)]' : 'h-[440px]')}>
            {lines.map((l, i) => (
              <div key={i} className={cn('whitespace-pre-wrap break-all', colors[l.k])}>
                {l.k === 'cmd' && l.prompt ? <><PromptText prompt={l.prompt} isWin={isWin} /> {l.t}</> : l.t || ' '}
              </div>
            ))}
            {canType && (
              <div className="whitespace-pre-wrap break-all text-slate-100">
                {!loggedOut && <><PromptText prompt={prompt} isWin={isWin} /> </>}
                {input}
                <span className={cn('inline-block h-[1.1em] w-[0.6em] translate-y-[2px] bg-slate-200', focused ? 'animate-[blink_1s_steps(1)_infinite]' : 'opacity-40')} />
              </div>
            )}
            <input
              ref={inputRef}
              value={input}
              disabled={!canType}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              className="pointer-events-none absolute -left-[9999px] size-px opacity-0"
              autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false}
              aria-label="Console input"
            />
          </div>
          {!canType && !transitional && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0b0d14]/85 text-center backdrop-blur-[1px]">
              <Power className="size-8 text-slate-500" />
              <div className="text-sm font-medium text-slate-200">{vm.status === 'error' ? 'VM is in an error state' : 'VM is powered off'}</div>
              <div className="max-w-xs text-xs text-slate-400">The serial console is available while the VM is running. Start it to watch the boot log live.</div>
              {(vm.status === 'stopped' || vm.status === 'error') && <Button size="sm" variant="primary" icon={Play} onClick={() => p.onPower('start')}>Start VM</Button>}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/10 px-3 py-1.5 text-[10.5px] text-slate-500">
          <span className="flex items-center gap-1"><Keyboard className="size-3" /> click to type</span>
          <span>↑/↓ history</span><span>Tab complete</span><span>Ctrl+L clear</span><span>Ctrl+C cancel</span>
          <span className="ml-auto hidden @min-[36rem]:inline">simulated shell · reflects live VM data</span>
        </div>
      </div>
      <style>{'@keyframes blink { 50% { opacity: 0 } }'}</style>
    </div>
  );
  // fullscreen must escape the content container (container queries create a containing block)
  return full ? createPortal(tree, overlayRoot()) : tree;
}

function PromptText({ prompt, isWin }: { prompt: string; isWin: boolean }) {
  if (isWin) return <span className="text-sky-300">{prompt}</span>;
  const [userHost, path] = prompt.split(':');
  return <span><span className="text-emerald-400">{userHost}</span><span className="text-slate-400">:</span><span className="text-sky-400">{path.replace(/\$$/, '')}</span><span className="text-slate-400">$</span></span>;
}
