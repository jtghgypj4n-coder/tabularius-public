import { renameFileSync as renameSync, removeFileSync as rmSync } from '../../store/src/file-ops.ts';
// Running the server as a service, and upgrading it in place.
//
//   tabularius service install <folder> [--port 8080] [--host 127.0.0.1] [--system] [-- serve options]
//   tabularius service print <folder> ...         the service file, without installing it
//   tabularius service uninstall                  stop it and remove it (hosted files stay)
//   tabularius upgrade [--no-backup]              new version, same data
//   tabularius upgrade --from <bundle|tarball|folder>   ...from a copy, without GitHub
//
// Each system's own service manager, nothing to install:
//
//   macOS     a LaunchAgent (while you're logged in), or with --system a
//             LaunchDaemon that runs as you at boot (asks for sudo)
//   Linux     a systemd user service (kept running after logout), or with
//             --system a system unit that runs as you at boot and may use
//             ports below 1024 (asks for sudo)
//   Windows   a Task Scheduler task that starts at logon, or with --system at
//             boot as the system account (from an administrator prompt),
//             started again a minute after it stops unexpectedly. Node can't
//             answer Windows' service manager on its own, so this is the
//             built-in way to keep it running without a wrapper program.
//
// The service runs this checkout with the Node running this command. What
// was installed is remembered in ~/.openhbam/service.json, so `upgrade` knows
// what to back up, restart and check.
//
// Upgrading: pulls the new version into this checkout (refusing when it has
// local changes), or takes it from a git bundle, a tarball or a folder
// (--from), so a server needs no GitHub sign-in for a private repository, installs its dependencies, backs up the hosted folder
// (online, as backups always are), restarts the service, and waits for it to
// answer its health check. If it doesn't, the previous version is put back
// and started again. The hosted files are never touched: each is brought up
// to date by the new version when it opens it.

import { validatePublicUrl, urlHostname } from '../../server/src/public-origin.ts';
import { plainHttpRefusal } from './loopback.ts';
import { crashPoint } from '../../store/src/crash-point.ts';
import { spawnSync } from 'node:child_process';
import { closeSync, cpSync, existsSync, fchmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { cleanupPath, openSync, writeFileSync } from '../../store/src/fs-boundary.ts';
import { homedir, networkInterfaces, tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { isSea } from 'node:sea';
import { readJsonStateSync, updateJsonStateSync } from '../../store/src/durable.ts';
import { nodeSupports } from './node-version.cjs';
import { closedBy, refusalFor } from './newer-files.ts';
import { readSecretFile } from './secret-file.ts';
import { requestStop } from './stop-request.ts';

export type Platform = 'darwin' | 'linux' | 'win32';

export interface ServiceOptions {
  platform: Platform;
  folder: string;
  port: number;
  host: string;
  system: boolean;
  /** More `tabularius serve` options. */
  extra: string[];
  /** The Node and the command line program the service runs. */
  node: string;
  main: string;
  /** The distributed single-file program handles CLI arguments itself. */
  singleFile?: boolean;
  user: string;
  /** Where the service's own files (macOS console output, service.json) go. */
  home: string;
}

/**
 * How long `service stop` waits for the server to finish before ending it (TABULARIUS_STOP_GRACE_MS, 30 s by default).
 * Each service manager's own stop timeout is this plus a margin, so it never ends the server before the CLI would.
 */
const STOP_GRACE_SECONDS = 30;

// The service keeps its old name (openhbam) so services installed before the rename are still found, stopped and restarted.
const LABEL = 'org.openhbam.server';
const TASK = 'openhbam';

export function defaults(platform: Platform = process.platform as Platform): Pick<ServiceOptions, 'platform' | 'node' | 'main' | 'singleFile' | 'user' | 'home'> {
  return {
    platform,
    node: process.execPath,
    main: resolve(import.meta.dirname, 'main.ts'),
    singleFile: isSea(),
    user: platform === 'win32' && process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${userInfo().username}` : userInfo().username,
    home: process.env.TABULARIUS_HOME ?? join(homedir(), '.openhbam'),
  };
}

// Kept in the service definition itself: this entry still runs when app/ was
// renamed away. It needs only Node builtins, then loads the restored CLI in
// this process so service-manager signals still reach the server directly.
const serviceEntry = [
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  "const main = process.argv[1];",
  "const app = path.resolve(path.dirname(main), '../../..');",
  "if (!fs.existsSync(app) && fs.existsSync(app + '.previous')) fs.renameSync(app + '.previous', app);",
  "process.argv = [process.argv[0], main, ...process.argv.slice(2)];",
  "process.execArgv.splice(process.execArgv.indexOf('--eval'), 2);",
  "import(require('node:url').pathToFileURL(main).href);",
].join(' ');

/** The service's command line, as arguments. */
function command(o: ServiceOptions): string[] {
  if (o.singleFile) return [o.node, '--no-warnings', 'serve', o.folder, '--port', String(o.port), '--host', o.host, ...o.extra];
  return [o.node, '--no-warnings', '--eval', serviceEntry, o.main, 'serve', o.folder, '--port', String(o.port), '--host', o.host, ...o.extra];
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A systemd argument: quoted, with quotes and backslashes escaped; % and $ doubled, or systemd would expand them. */
const unitArg = (s: string) => `"${s.replace(/["\\]/g, '\\$&').replace(/[%$]/g, '$&$&')}"`;
/** A path in a systemd directive: % doubled (specifiers are expanded there too), quoted when it holds a space. */
const unitPath = (s: string) => { const t = s.replace(/%/g, '%%'); return /[\s"'\\]/.test(t) ? `"${t.replace(/["\\]/g, '\\$&')}"` : t; };
/** A Windows argument, quoted the way programs split their command line. */
export function winArg(s: string): string {
  if (s && !/[\s"]/.test(s)) return s;
  return `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

/** Preflight the same flag-over-environment choice that `serve` uses. */
export function validateServicePublicUrl(extra: readonly string[]): void {
  const i = extra.indexOf('--public-url');
  validatePublicUrl(i >= 0 ? extra[i + 1] ?? '' : process.env.TABULARIUS_PUBLIC_URL);
}

function servicePath(o: Pick<ServiceOptions, 'platform' | 'system' | 'home'>): string {
  if (o.platform === 'darwin') return o.system ? `/Library/LaunchDaemons/${LABEL}.plist` : join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  if (o.platform === 'linux') return o.system ? '/etc/systemd/system/openhbam.service' : join(homedir(), '.config', 'systemd', 'user', 'openhbam.service');
  return join(o.home, 'openhbam-task.xml');
}

// Control characters end a line (in a unit file, injecting a directive) or are not allowed at all in XML 1.0 (a plist or task file that no manager will read).
const CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;
const ACCOUNT_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,63}$/;

/** Refuses what cannot be written into a service file safely, with the name of the field. */
export function refuseUnsafe(o: ServiceOptions, preview = false): void {
  const fields: Array<[string, string]> = [['folder', o.folder], ['node', o.node], ['main', o.main], ['user', o.user], ['host', o.host], ['home', o.home], ...o.extra.map((a, i): [string, string] => [`serve option ${i + 1}`, a])];
  for (const [what, value] of fields) {
    if (CONTROL.test(value)) throw new Error(`service: the ${what} holds a line break or another control character, which a service file cannot carry`);
  }
  if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new Error(`service: the port must be a whole number from 1 to 65535, not ${o.port}`);
  if (!o.host || /\s/.test(o.host)) throw new Error(`service: the address to listen on is empty or holds a space: ${JSON.stringify(o.host)}`);
  if (o.platform !== 'win32') {
    for (const [what, value] of [['folder', o.folder], ['node', o.node], ['main', o.main]] as const) {
      if (!preview && !value.startsWith('/')) throw new Error(`service: the ${what} must be a full path, not ${JSON.stringify(value)}: a service manager does not start in your current folder`);
    }
    // In a unit file a line that ends in a backslash continues on the next one (swallowing the setting after it), and systemd drops trailing white space.
    if (o.platform === 'linux') for (const [what, value] of [['folder', o.folder], ['node', o.node], ['main', o.main]] as const) {
      if (/\\$|^\s|\s$/.test(value)) throw new Error(`service: the ${what} ${JSON.stringify(value)} starts or ends with a space or ends with a backslash, which a systemd unit cannot carry`);
    }
    if (!ACCOUNT_NAME.test(o.user)) throw new Error(`service: ${JSON.stringify(o.user)} is not an account name a service manager accepts`);
  } else if (!o.user || /[<>"/|?*]/.test(o.user)) throw new Error(`service: ${JSON.stringify(o.user)} is not a Windows account name`);
}

/** Where the service file goes, and what it says. */
export function serviceFile(o: ServiceOptions, preview = false): { path: string; text: string } {
  validateServicePublicUrl(o.extra);
  refuseUnsafe(o, preview);
  if (o.platform === 'darwin') {
    const args = command(o).map((a) => `<string>${xml(a)}</string>`).join('');
    const log = join(o.home, 'logs', 'server.log');
    return {
      path: servicePath(o),
      text: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>${args}</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ExitTimeOut</key><integer>${STOP_GRACE_SECONDS + 10}</integer>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>Umask</key><integer>63</integer>
  <key>SoftResourceLimits</key><dict><key>NumberOfFiles</key><integer>4096</integer></dict>${o.system ? `
  <key>UserName</key><string>${xml(o.user)}</string>` : ''}
  <key>WorkingDirectory</key><string>${xml(o.folder)}</string>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`,
    };
  }
  if (o.platform === 'linux') {
    return {
      path: servicePath(o),
      text: `[Unit]
Description=tabularius server
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${command(o).map(unitArg).join(' ')}
WorkingDirectory=${o.folder.replace(/%/g, '%%')}
# Start again after a crash, waiting longer each time (systemd 254 and later; older ones ignore the two steps).
Restart=on-failure
RestartSec=5
RestartSteps=5
RestartMaxDelaySec=60
# Finish saving and backing up on stop: the grace the stop command gives it, and as long again.
TimeoutStopSec=${STOP_GRACE_SECONDS * 2}
# Files it makes are for its own account.
UMask=0077
# Many files and connections at once (the default soft limit is 1024).
LimitNOFILE=65536
NoNewPrivileges=true
PrivateTmp=true
# /usr, /boot and /etc are read-only to it; the folders it writes stay writable even if they sit under those.
ProtectSystem=full
ReadWritePaths=${[o.folder, o.home, resolve(dirname(o.main), '../../../..')].map((p) => `-${unitPath(p)}`).join(' ')}
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictRealtime=true
LockPersonality=true${o.system ? `
User=${o.user}
# Ports below 1024 (443 and 80 for --https) without running as root.
AmbientCapabilities=CAP_NET_BIND_SERVICE` : ''}

[Install]
WantedBy=${o.system ? 'multi-user.target' : 'default.target'}
`,
    };
  }
  const [node, ...args] = command(o);
  return {
    path: servicePath(o),
    text: `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>tabularius server: hosts ${xml(o.folder)}</Description></RegistrationInfo>
  <Triggers>
    ${o.system ? '<BootTrigger><Enabled>true</Enabled></BootTrigger>' : `<LogonTrigger><Enabled>true</Enabled><UserId>${xml(o.user)}</UserId></LogonTrigger>`}
  </Triggers>
  <Principals>
    <Principal id="Author">
      ${o.system ? '<UserId>S-1-5-18</UserId>\n      <RunLevel>HighestAvailable</RunLevel>' : `<UserId>${xml(o.user)}</UserId>\n      <LogonType>InteractiveToken</LogonType>\n      <RunLevel>LeastPrivilege</RunLevel>`}
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure><Interval>PT1M</Interval><Count>255</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml(node)}</Command>
      <Arguments>${xml(args.map(winArg).join(' '))}</Arguments>
      <WorkingDirectory>${xml(o.folder)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`,
  };
}

/** Runs a command where the person can see it (and answer sudo); throws when it fails. */
function run(cmd: string, args: string[], opts: { ok?: boolean; cwd?: string } = {}): boolean {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: opts.cwd });
  if (r.status !== 0 && !opts.ok) throw new Error(`${cmd} ${args.join(' ')} failed${r.error ? `: ${r.error.message}` : ''}`);
  return r.status === 0;
}

const say = (m: string) => process.stderr.write(`==> ${m}\n`);

/** Writes a file, with sudo when it belongs to the system. */
export function placeServiceFile(path: string, text: string, system: boolean, owner?: string): void {
  if (!system) {
    mkdirSync(dirname(path), { recursive: true });
    const fd = openSync(path, 'w', 0o600);
    try {
      fchmodSync(fd, 0o600);
      writeFileSync(fd, text);
    } finally { closeSync(fd); }
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-service-'));
  const tmp = join(dir, 'service');
  const cleanup = cleanupPath(dir, { recursive: true, force: true });
  let failed = false;
  try {
    writeFileSync(tmp, text, { flag: 'wx', mode: 0o600 });
    run('sudo', ['install', '-m', '600', ...(owner ? ['-o', owner.split(':')[0], '-g', owner.split(':')[1]] : []), tmp, path]);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    cleanup({ throwOnError: !failed });
  }
}

export interface Installed {
  platform: Platform;
  folder: string;
  port: number;
  host: string;
  system: boolean;
  extra: string[];
}

const record = (home: string) => join(home, 'service.json');

export function installed(home = defaults().home): Installed | undefined {
  try { return readJsonStateSync<Installed>(record(home)); }
  catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? ((e as Error).cause as NodeJS.ErrnoException | undefined)?.code;
    if (['ENOENT', 'EACCES'].includes(code ?? ''))
      return undefined;
    throw e;
  }
}

export function installService(o: ServiceOptions): void {
  o = { ...o, extra: normalizedSecretFiles(o.extra) };
  const f = serviceFile(o);
  mkdirSync(o.folder, { recursive: true });
  // Switching between a personal and a system service: the other one goes.
  const was = installed(o.home);
  if (was && was.system !== o.system) uninstallService(o, was);
  if (o.platform === 'darwin') {
    mkdirSync(join(o.home, 'logs'), { recursive: true });
    const sudo = o.system ? ['sudo'] : [];
    placeServiceFile(f.path, f.text, o.system, 'root:wheel');
    const [cmd, ...pre] = [...sudo, 'launchctl'];
    run(cmd, [...pre, 'unload', f.path], { ok: true });
    run(cmd, [...pre, 'load', '-w', f.path]);
    say(o.system ? `Running at boot, as ${o.user}, whether or not anyone is logged in (console output: ${join(o.home, 'logs', 'server.log')})` : 'Running while you are logged in. Add --system to run at boot without logging in.');
  } else if (o.platform === 'linux') {
    placeServiceFile(f.path, f.text, o.system);
    const ctl = o.system ? ['sudo', 'systemctl'] : ['systemctl', '--user'];
    const [cmd, ...pre] = ctl;
    run(cmd, [...pre, 'daemon-reload']);
    run(cmd, [...pre, 'enable', '--now', 'openhbam.service']);
    run(cmd, [...pre, 'restart', 'openhbam.service']);
    if (!o.system && !run('loginctl', ['enable-linger', o.user], { ok: true })) say(`Run 'sudo loginctl enable-linger ${o.user}' to keep it running after you log out`);
    say(o.system ? 'Running at boot (logs: journalctl -u Tabularius)' : 'Running as a systemd user service (logs: journalctl --user -u Tabularius)');
  } else {
    mkdirSync(dirname(f.path), { recursive: true });
    // Task Scheduler reads its XML as UTF-16.
    writeFileSync(f.path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(f.text, 'utf16le')]));
    stopOwnServer(was?.folder ?? o.folder, o.platform);
    run('schtasks', ['/End', '/TN', TASK], { ok: true });
    if (!run('schtasks', ['/Create', '/TN', TASK, '/XML', f.path, '/F'], { ok: true })) {
      throw new Error(o.system ? 'could not create the task: run this from an administrator prompt for --system' : 'could not create the task');
    }
    run('schtasks', ['/Run', '/TN', TASK]);
    say(o.system ? 'Running at boot as the system account' : 'Running whenever you are signed in to Windows. Add --system (as administrator) to run at boot.');
  }
  mkdirSync(o.home, { recursive: true });
  const kept: Installed = { platform: o.platform, folder: o.folder, port: o.port, host: o.host, system: o.system, extra: o.extra };
  // Installing the service replaces its one complete configuration; no independent records live in this file.
  updateJsonStateSync(record(o.home), kept, () => kept, { mode: 0o600 });
  for (const line of serviceSummary(o)) say(line);
}

/** Resolve file options before any service record or manager file is written. */
function normalizedSecretFiles(extra: readonly string[]): string[] {
  const result = [...extra];
  for (const [inline, file] of [['--mcp-token', '--mcp-token-file'], ['--replication-token', '--replication-token-file']]) {
    if (result.some((a) => a.startsWith(`${file}=`))) throw new Error(`serve: ${file}=value is not read; write ${file} and its path as two words`);
    const i = result.indexOf(file);
    if (i < 0) continue;
    if (result.indexOf(file, i + 1) >= 0) throw new Error(`serve: ${file} was given more than once`);
    if (result.includes(inline)) throw new Error(`serve: give either ${inline} or ${file}, not both`);
    const path = result[i + 1];
    if (!path || path.startsWith('--')) throw new Error(`serve: ${file} needs a file path`);
    const fullPath = resolve(path);
    const value = readSecretFile(fullPath, file);
    if (file === '--replication-token-file' && value.length < 16) throw new Error('serve: --replication-token must be at least 16 characters');
    result[i + 1] = fullPath;
  }
  return result;
}

/** The value of a serve option in `extra` (`--name value` or `--name=value`). */
function serveOption(extra: string[], name: string): string | undefined {
  const i = extra.indexOf(name);
  return i >= 0 ? extra[i + 1] : extra.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
}

/**
 * The address a service listens on when `--host` is not given: this computer only, except with `--https <domain>` (a certificate
 * from Let's Encrypt), where `serve` listens on every address so the certificate authority can reach it.
 */
export function defaultServiceHost(extra: string[]): string {
  const https = serveOption(extra, '--https');
  return https && https !== 'local' && https !== 'lan' ? '0.0.0.0' : '127.0.0.1';
}

/**
 * Why a service may not run on this address as given (plain HTTP beyond this computer), or undefined. Only the spellings `serve`
 * itself reads count (`--https name`, not `--https=name`), so what install accepts is what the service will start with.
 */
export function servicePlainRefusal(o: Pick<ServiceOptions, 'host' | 'extra'>): string | undefined {
  const secure = o.extra.includes('--https') && !!o.extra[o.extra.indexOf('--https') + 1] || o.extra.includes('--tls-cert');
  const why = plainHttpRefusal({ host: o.host, secure, allowed: o.extra.includes('--allow-plain-http') });
  return why && `${why} Options for serve go after "--", for example: tabularius service install <folder> --host ${o.host} -- --https local`;
}

/**
 * Where the installed service can be reached: http or https as its serve
 * options say, on this machine and, when it listens on every address, on the
 * local network; with --https local, the page each device trusts it from.
 */
export function serviceSummary(o: Pick<ServiceOptions, 'folder' | 'port' | 'host' | 'extra'> & { platform?: Platform }, lan: string[] = lanAddresses()): string[] {
  const opt = (name: string) => serveOption(o.extra, name);
  const https = opt('--https');
  const local = https === 'local' || https === 'lan';
  const secure = !!https || o.extra.includes('--tls-cert') || o.extra.some((a) => a.startsWith('--tls-cert='));
  const scheme = secure ? 'https' : 'http';
  const at = (host: string) => `${scheme}://${urlHostname(host)}:${o.port}/`;
  const lines = [`Hosting ${o.folder} at ${at('localhost')} (backups daily in ${join(o.folder, 'Backups')})`];
  if (https && !local) for (const name of https.split(',').map((n) => n.trim()).filter(Boolean)) lines.push(`  and at https://${urlHostname(name)}${o.port === 443 ? '' : `:${o.port}`}/`);
  const everywhere = o.host === '0.0.0.0' || o.host === '::';
  if (everywhere) for (const ip of lan) lines.push(`  on the network: ${at(ip)}`);
  // The same warning `serve` prints to the log, where the person installing will see it.
  if (!secure && !/^https:/i.test(opt('--public-url') ?? '') && !['127.0.0.1', 'localhost', '::1'].includes(o.host)) {
    lines.push(`  Warning: it listens on ${o.host} over plain HTTP, so passwords and sign-in tokens cross the network unencrypted. Add --https <your domain> (or --https local) after the folder, or set --host 127.0.0.1 and put a proxy that does HTTPS in front.`);
  }
  const inline = ['--mcp-token', '--replication-token'].filter((n) => opt(n) !== undefined);
  const files = ['--mcp-token-file', '--replication-token-file'].filter((n) => opt(n) !== undefined);
  if (inline.length) lines.push(`  Note: ${inline.join(' and ')} ${inline.length > 1 ? 'are' : 'is'} written into the service file${(o.platform ?? process.platform) === 'win32' ? '. Restrict its Windows ACL and the task permissions; chmod does not make it private.' : ', which only your account can read.'} A key file (--ai-key-file, --tls-key) is named by its path, not copied.`);
  if (files.length) lines.push(`  Note: ${files.join(' and ')} ${files.length > 1 ? 'are' : 'is'} named by path in the service file; the contents are not copied.`);
  if (local) lines.push(`  each device trusts it once from ${at(everywhere && lan[0] ? lan[0] : 'localhost')}tabularius/tls/`);
  return lines;
}

/** This machine's addresses on its local networks (IPv4, private ranges). */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces()).flat()
    .filter((a): a is NonNullable<typeof a> => !!a && a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address))
    .map((a) => a.address);
}

export function uninstallService(o: Pick<ServiceOptions, 'platform' | 'home' | 'user'>, which = installed(o.home)): void {
  const both = which ? [which.system] : [false, true];
  for (const system of both) {
    const f = { path: servicePath({ ...o, system }) };
    if (o.platform === 'darwin') {
      if (!existsSync(f.path)) continue;
      const pre = system ? ['sudo'] : [];
      const [cmd, ...rest] = [...pre, 'launchctl'];
      run(cmd, [...rest, 'unload', '-w', f.path], { ok: true });
      if (system) run('sudo', ['rm', '-f', f.path]);
      else rmSync(f.path, { force: true });
    } else if (o.platform === 'linux') {
      if (!existsSync(f.path)) continue;
      const [cmd, ...pre] = system ? ['sudo', 'systemctl'] : ['systemctl', '--user'];
      run(cmd, [...pre, 'disable', '--now', 'openhbam.service'], { ok: true });
      if (system) run('sudo', ['rm', '-f', f.path]);
      else rmSync(f.path, { force: true });
      run(cmd, [...pre, 'daemon-reload'], { ok: true });
    } else {
      if (which) stopOwnServer(which.folder, o.platform);
      run('schtasks', ['/End', '/TN', TASK], { ok: true });
      run('schtasks', ['/Delete', '/TN', TASK, '/F'], { ok: true });
      rmSync(f.path, { force: true });
      break;
    }
    say(`Removed ${f.path}`);
  }
  rmSync(record(o.home), { force: true });
  say('The service is gone; hosted files and backups are where they were.');
}

/**
 * Asks the server hosting `folder` to stop, when it runs as this user: its
 * process id is in the folder (.openhbam.pid). False when there is none to ask.
 */
export function stopOwnServer(folder: string, platform: NodeJS.Platform = process.platform, control = { kill: process.kill.bind(process), exited: exitsWithin, request: requestStop }): boolean {
  let pid: number;
  try {
    pid = Number(readFileSync(join(folder, '.openhbam.pid'), 'utf8'));
  } catch {
    return false;
  }
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    if (platform === 'win32') {
      control.kill(pid, 0);
      control.request(folder, pid);
    } else control.kill(pid, 'SIGTERM'); // finishes saving, then exits on POSIX
  } catch (e) {
    if (platform === 'win32' && (e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
    return false; // gone, or another user's
  }
  // A server busy in one long request can't hear the signal: after a grace
  // period it is stopped outright. Saved edits are safe (each is committed to
  // the database's log as it is made); only the request in progress is lost.
  if (!control.exited(pid, Number(process.env.TABULARIUS_STOP_GRACE_MS) || 30_000)) {
    if (platform === 'win32') throw new Error('The Windows server did not stop gracefully; stop it with Ctrl-C and retry. The task was not forcibly ended.');
    try {
      control.kill(pid, 'SIGKILL');
    } catch {
      // It exited just now.
    }
  }
  return true;
}

/** Whether process `pid` has exited within `ms`, checking every quarter second. */
export function exitsWithin(pid: number, ms: number): boolean {
  const end = Date.now() + ms;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      process.kill(pid, 0);
      // Exited, but not yet collected by its parent (Linux shows it as a zombie).
      if (/\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))) return true;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'ENOENT') return true;
    }
    if (Date.now() >= end) return false;
    Atomics.wait(pause, 0, 0, 250);
  }
}

/** Stops the service and starts it again. */
export function restartService(s: Installed): void {
  if (s.platform === 'darwin') {
    const target = s.system ? `system/${LABEL}` : `gui/${userInfo().uid}/${LABEL}`;
    // The LaunchDaemon runs as the user who installed it and is kept alive
    // (KeepAlive), so stopping its server starts it again, with no sudo: an
    // upgrade run without a terminal can't answer sudo's password prompt.
    if (s.system && stopOwnServer(s.folder)) return;
    // No server running: launchd's KeepAlive starts one by itself. Without a
    // terminal, sudo can't ask for a password, so leave it to launchd.
    if (s.system && !process.stdin.isTTY) return;
    if (s.system) run('sudo', ['launchctl', 'kickstart', '-k', target]);
    else run('launchctl', ['kickstart', '-k', target]);
  } else if (s.platform === 'linux') {
    if (s.system) run('sudo', ['systemctl', 'restart', 'openhbam.service']);
    else run('systemctl', ['--user', 'restart', 'openhbam.service']);
  } else {
    stopOwnServer(s.folder, s.platform);
    run('schtasks', ['/End', '/TN', TASK], { ok: true });
    run('schtasks', ['/Run', '/TN', TASK]);
  }
}

/** Whether a port can be listened on at an address: false when another program holds it. */
export function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((done) => {
    const probe = createNetServer();
    probe.once('error', (e: NodeJS.ErrnoException) => done(e.code !== 'EADDRINUSE'));
    probe.listen({ port, host, exclusive: true }, () => probe.close(() => done(true)));
  });
}

/**
 * Refuses to install a service on a port another program holds: the service
 * manager would start it again and again, each time failing. The installed
 * tabularius service itself may hold it (installing again replaces it).
 */
export async function checkPort(o: Pick<ServiceOptions, 'port' | 'host' | 'home' | 'folder'> & { extra?: string[]; platform?: Platform }): Promise<void> {
  // The service's own address, and this machine's, where a program listening on one address blocks the other.
  // On macOS a program listening on every address doesn't stop another binding
  // one address, though it holds the port there too, so ask for every address as well.
  const v6 = o.host.includes(':');
  const hosts = [...new Set([o.host, v6 ? '::1' : '127.0.0.1', ...((o.platform ?? process.platform) === 'darwin' ? [v6 ? '::' : '0.0.0.0'] : [])])];
  const free = async (port: number) => {
    // One at a time: two probes of one port at once would find each other.
    for (const h of hosts) if (!await portFree(port, h)) return false;
    return true;
  };
  if (await free(o.port)) return;
  const was = installed(o.home);
  if (was && was.port === o.port && await checkHealth(healthUrl(was))) return;
  let next: number | undefined;
  for (let p = o.port + 1; p < o.port + 50 && p < 65536; p++) {
    if (await free(p)) {
      next = p;
      break;
    }
  }
  throw new Error(`port ${o.port} is in use by another program (\`lsof -nP -iTCP:${o.port} -sTCP:LISTEN\` shows which).${next ? ` Port ${next} is free: install with --port ${next}` : ' Choose a free port with --port'}`);
}

/** The service's health check address. */
export function healthUrl(s: Pick<Installed, 'port' | 'host' | 'extra'>): string {
  const tls = s.extra.some((a) => a === '--https' || a === '--tls-cert');
  const host = s.host === '0.0.0.0' || s.host === '' ? '127.0.0.1' : s.host === '::' ? '[::1]' : urlHostname(s.host);
  return `${tls ? 'https' : 'http'}://${host}:${s.port}/tabularius/health`;
}

/** The health check's answer, or undefined when nothing answers. Its own certificate is fine: it's this machine. */
export function checkHealth(url: string): Promise<{ status: string; uptimeSeconds: number } | undefined> {
  // A fresh connection each time (agent: false): a kept-alive one to a server that has since restarted fails.
  const request = url.startsWith('http:') ? httpRequest : httpsRequest;
  return new Promise((done) => {
    const req = request(url, { rejectUnauthorized: false, timeout: 3000, agent: false }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          done(res.statusCode === 200 ? JSON.parse(body) : undefined);
        } catch {
          done(undefined);
        }
      });
    });
    req.on('error', () => done(undefined));
    req.on('timeout', () => req.destroy());
    req.end();
  });
}

/** The process id of the server hosting `folder` (.openhbam.pid), when it is running. */
function livePid(folder: string): number | undefined {
  try {
    const pid = Number(readFileSync(join(folder, '.openhbam.pid'), 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM' ? Number(readFileSync(join(folder, '.openhbam.pid'), 'utf8')) : undefined;
  }
}

/**
 * Waits for a server that started after `since` (epoch ms) to answer; false
 * when none does in time. With the hosted folder, it gives up early when the
 * new version clearly isn't coming up: no server process for `deadMs`, or the
 * service manager starting it again and again (a crash loop).
 */
export async function waitForRestart(url: string, since: number, ms = 90_000, watch?: { folder: string; deadMs?: number }): Promise<boolean> {
  const end = Date.now() + ms;
  const deadMs = watch?.deadMs ?? 20_000;
  const first = watch && livePid(watch.folder);
  const started = new Set<number>();
  let deadSince: number | undefined;
  while (Date.now() < end) {
    const h = await checkHealth(url);
    // Still the old one until its uptime is shorter than the time since the restart.
    if (h?.status === 'ok' && Date.now() - h.uptimeSeconds * 1000 >= since - 1000) return true;
    if (watch) {
      const pid = livePid(watch.folder);
      if (pid === undefined) deadSince ??= Date.now();
      else {
        deadSince = undefined;
        if (pid !== first) started.add(pid);
      }
      if (deadSince !== undefined && Date.now() - deadSince >= deadMs) return false;
      if (started.size >= 3) return false;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

const git = (app: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', app, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.error?.message || '').trim()}`);
  return r.stdout.trim();
};

function installDependencies(app: string, platform: NodeJS.Platform = process.platform): void {
  const local = join(dirname(process.execPath), platform === 'win32' ? 'npm.cmd' : 'npm');
  const npm = existsSync(local) ? local : platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: app, stdio: ['ignore', 'ignore', 'inherit'], shell: platform === 'win32', env: { ...process.env, PATH: `${dirname(process.execPath)}${platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` } });
  if (r.status !== 0) throw new Error(`installing the dependencies failed (npm ci stopped${r.error ? `: ${r.error.message}` : r.status === null ? ' before it finished' : ` with exit code ${r.status}`}); its output is above`);
}

/** What an upgrade put in place, and how to put the previous version back. */
interface Fetched {
  /** A tarball or folder: always put in place, its version number may not have changed. */
  files?: boolean;
  old: string;
  now: string;
  rollback: () => void;
}

/** Fails when a checkout has changes of its own, which an upgrade would lose. */
function refuseLocalChanges(app: string): void {
  let changed = git(app, 'status', '--porcelain', '--untracked-files=no');
  if (changed && spawnSync('git', ['-C', app, 'diff', '--quiet', '--ignore-cr-at-eol'], { stdio: 'ignore' }).status === 0) {
    // Only line endings differ (Git for Windows' autocrlf): nothing of the user's to lose.
    git(app, 'checkout', '--', '.');
    changed = git(app, 'status', '--porcelain', '--untracked-files=no');
  }
  if (changed) throw new Error(`${app} has local changes: commit or discard them first (${changed.split('\n').slice(0, 5).map((l) => l.trim()).join(', ')})`);
}

/** The new version from the checkout's own remote (git pull). */
function fromRemote(app: string): Fetched {
  if (!existsSync(join(app, '.git'))) throw new Error(`${app} is not a git checkout: upgrade it from a copy of the new version with --from <bundle, tarball or folder>`);
  refuseLocalChanges(app);
  const old = git(app, 'rev-parse', 'HEAD');
  say(`Fetching the new version into ${app}`);
  git(app, 'pull', '--ff-only');
  return { old: old.slice(0, 7), now: git(app, 'rev-parse', 'HEAD').slice(0, 7), rollback: () => git(app, 'reset', '--hard', old) };
}

/** The new version from a git bundle: no network and no GitHub sign-in needed. */
function fromBundle(app: string, bundle: string): Fetched {
  if (!existsSync(join(app, '.git'))) throw new Error(`${app} is not a git checkout: a bundle can only upgrade one; use a tarball or folder instead`);
  refuseLocalChanges(app);
  const heads = git(app, 'bundle', 'list-heads', bundle).split('\n').map((l) => l.split(' ')[1]).filter(Boolean);
  const ref = ['HEAD', 'refs/heads/main'].find((h) => heads.includes(h)) ?? heads[0];
  if (!ref) throw new Error(`${bundle} holds no branches`);
  const old = git(app, 'rev-parse', 'HEAD');
  say(`Reading the new version from ${bundle} (${ref})`);
  git(app, 'fetch', '-q', bundle, ref);
  git(app, 'reset', '-q', '--hard', 'FETCH_HEAD');
  return { old: old.slice(0, 7), now: git(app, 'rev-parse', 'HEAD').slice(0, 7), rollback: () => git(app, 'reset', '-q', '--hard', old) };
}

const versionOf = (app: string) => {
  try {
    return String((JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')) as { version?: string }).version ?? '?');
  } catch {
    return '?';
  }
};

/**
 * The new version from a tarball (.tar.gz, .tgz, .tar, such as a release
 * asset) or a folder of its files: unpacked beside the app and swapped in,
 * the previous version kept beside it until the new one answers.
 */
function releaseRoot(folder: string): string {
  const top = readdirSync(folder);
  return top.length === 1 && statSync(join(folder, top[0])).isDirectory() ? join(folder, top[0]) : folder;
}

function validateRelease(root: string, source: string): void {
  if (!existsSync(join(root, 'packages', 'cli', 'src', 'main.ts'))) {
    throw new Error(`${source} doesn't hold Tabularius (no packages/cli/src/main.ts in it)`);
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { engines?: { node?: unknown } };
  const range = pkg?.engines?.node;
  if (range === undefined) throw new Error(`${source} is missing engines.node; expected a single minimum such as >=22.18.0`);
  if (typeof range !== 'string') throw new Error(`${source} has non-string engines.node ${JSON.stringify(range)}; expected a single minimum such as >=22.18.0`);
  let supported: boolean;
  try {
    supported = nodeSupports(process.versions.node, range);
  } catch (e) {
    throw new Error(`${source} has ${(e as Error).message}`);
  }
  if (!supported) throw new Error(`${source} needs Node ${range}; running Node ${process.versions.node}. Install a compatible Node before upgrading.`);
}

/** Recover a process exit between either pair of upgrade/rollback renames. */
export function recoverUpgrade(app: string): void {
  // A present app is a complete old or new directory. Never replace it with
  // the previous release; it may already have passed its health check.
  if (!existsSync(app) && existsSync(`${app}.previous`)) renameSync(`${app}.previous`, app);
}

/** Preserve the working app when a Windows sharing violation prevents the second rename. */
export function publishUpgrade(app: string, staged: string, move = renameSync): void {
  move(app, `${app}.previous`);
  crashPoint('upgrade:after-save');
  try { move(staged, app); }
  catch (error) {
    try { move(`${app}.previous`, app); }
    catch (rollback) { throw new AggregateError([error, rollback], 'Upgrade failed and rollback is incomplete; retain the .previous directory and retry while the service is stopped'); }
    throw error;
  }
  crashPoint('upgrade:after-publish');
}

function fromFiles(app: string, source: string): Fetched {
  const incoming = `${app}.incoming`;
  const previous = `${app}.previous`;
  const folder = statSync(source).isDirectory();
  // A folder can be checked before staging writes anything beside the installed app.
  if (folder) validateRelease(releaseRoot(source), source);
  say(`Unpacking the new version from ${source}`);
  let root: string;
  try {
    rmSync(incoming, { recursive: true, force: true });
    mkdirSync(incoming, { recursive: true });
    if (folder) cpSync(source, incoming, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git)$/.test(p) });
    else {
      const r = spawnSync('tar', ['-xf', source, '-C', incoming], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`could not unpack ${source}: ${(r.stderr || r.error?.message || '').trim()}`);
    }
    // A release tarball may hold one folder (tabularius-1.2.0/...) with the files in it.
    root = releaseRoot(incoming);
    if (!folder) validateRelease(root, source);
  } catch (e) {
    rmSync(incoming, { recursive: true, force: true });
    throw e;
  }
  crashPoint('upgrade:after-stage');
  const old = versionOf(app);
  rmSync(previous, { recursive: true, force: true });
  publishUpgrade(app, root);
  rmSync(incoming, { recursive: true, force: true });
  crashPoint('upgrade:after-cleanup');
  return {
    files: true,
    old,
    now: versionOf(app),
    rollback: () => {
      rmSync(`${app}.failed`, { recursive: true, force: true });
      renameSync(app, `${app}.failed`);
      crashPoint('upgrade:after-failed-save');
      renameSync(previous, app);
      crashPoint('upgrade:after-rollback');
    },
  };
}

/**
 * Brings this checkout up to date (from its git remote, or from a bundle,
 * tarball or folder with `from`) and, when a service runs it, restarts the
 * service on the new version, going back to the old one if it doesn't come up.
 */
export async function upgrade(opts: { backup?: (folder: string, extra: string[]) => Promise<string>; app?: string; home?: string; restart?: (s: Installed) => void; waitMs?: number; deadMs?: number; from?: string; install?: (app: string) => void }): Promise<void> {
  const installDeps = opts.install ?? installDependencies;
  const s = installed(opts.home);
  // Refuse before fetching files, backing up or stopping the running service.
  if (s) {
    try { validateServicePublicUrl(s.extra); }
    catch (e) { throw new Error(`upgrade refused; the existing service was not restarted: ${(e as Error).message}`); }
    // A service installed before plain HTTP beyond this computer was refused would not start on the new version.
    const plain = servicePlainRefusal(s);
    if (plain) throw new Error(`upgrade refused; the existing service was not restarted, because the new version would not start it: ${plain.replace(/ Options for serve go after .*$/s, '')} Install the service again with that change: tabularius service install ${s.folder} --host ${s.host} -- <serve options>`);
  }
  const restart = opts.restart ?? restartService;
  const app = opts.app ?? resolve(import.meta.dirname, '..', '..', '..');
  recoverUpgrade(app);
  let fetched: Fetched;
  if (opts.from) {
    const from = resolve(opts.from);
    if (!existsSync(from)) throw new Error(`${from} isn't there`);
    const bundle = !statSync(from).isDirectory() && spawnSync('git', ['bundle', 'list-heads', from], { stdio: 'ignore' }).status === 0;
    fetched = bundle ? fromBundle(app, from) : fromFiles(app, from);
  } else fetched = fromRemote(app);
  const { old, now } = fetched;
  if (now === old && !fetched.files) {
    say('Already up to date');
    return;
  }
  // A version that reads an older file format would leave the folder's newer files closed: the service would answer its
  // health check and look upgraded. Refused before anything restarts, with the old files put back.
  const refusal = s ? refusalFor(app, s.folder) : undefined;
  if (refusal) {
    fetched.rollback();
    throw new Error(`upgrade refused, so ${old} stays and the service was not restarted: ${refusal}`);
  }
  say(`${old} -> ${now}: installing its dependencies`);
  try {
    installDeps(app);
  } catch (e) {
    fetched.rollback();
    throw new Error(`${(e as Error).message}, so ${old} was put back`);
  }
  if (!s) {
    say('Upgraded. Restart the server to run the new version (no service was installed with `tabularius service install`).');
    return;
  }
  let backedUpTo: string | undefined;
  if (opts.backup) {
    say(`Backing up ${s.folder} first`);
    try {
      backedUpTo = await opts.backup(s.folder, s.extra);
    } catch (e) {
      // The backup failure is what the person needs to read first; a failed reinstall of the old dependencies is added to it.
      fetched.rollback();
      try {
        installDeps(app);
      } catch (again) {
        throw new Error(`${(e as Error).message}; and reinstalling the dependencies of ${old} after putting it back also failed: ${(again as Error).message}`, { cause: e });
      }
      throw e;
    }
    say(`Backed up to ${backedUpTo}`);
  }
  const url = healthUrl(s);
  let since = Date.now();
  say('Restarting the service on the new version');
  try {
    restart(s);
  } catch (e) {
    // The old version is still running: put its files back so the install matches it.
    fetched.rollback();
    installDeps(app);
    throw new Error(`restarting the service failed (${(e as Error).message}), so ${old} was put back; the server is still running ${old}`);
  }
  const watch = { folder: s.folder, deadMs: opts.deadMs };
  if (await waitForRestart(url, since, opts.waitMs, watch)) {
    say(`Upgraded: the server is back (${url})`);
    return;
  }
  say(`The new version did not answer at ${url}: going back to ${old}`);
  fetched.rollback();
  installDeps(app);
  since = Date.now();
  restart(s);
  const back = await waitForRestart(url, since, opts.waitMs, watch);
  // The new version may have opened some files and recorded a higher format number in them before it failed; the old
  // version refuses those, so putting it back is not enough.
  const closed = closedBy(app, s.folder, backedUpTo);
  throw new Error(`the upgrade to ${now} did not start, so ${old} was put back${back ? ' and is running' : ', but it isn\'t answering either: check the service\'s logs'}${closed}`);
}
