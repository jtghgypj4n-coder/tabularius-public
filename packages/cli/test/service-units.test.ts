// The files `tabularius service install` writes, checked with strict validators (service-validators.ts), as golden text for
// each platform, with awkward folder names, through install and uninstall on a fake home with stand-in service managers, and,
// where installed, by systemd's own checker and xmllint. Nothing here installs anything on this machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { refuseUnsafe, serviceFile, winArg, type Platform, type ServiceOptions } from '../src/service.ts';
import { parseUnit, readPlist, systemdWords, validatePlist, validateSystemdUnit, validateTaskXml, parseXml } from './service-validators.ts';

const GOLDEN = join(import.meta.dirname, 'golden', 'service');
const FIXED = { node: '/usr/local/bin/node', main: '/srv/tabularius/app/packages/cli/src/main.ts', user: 'tabularius', home: '/var/lib/tabularius/.openhbam' };
const winFixed = { node: 'C:\\Program Files\\nodejs\\node.exe', main: 'C:\\tabularius\\app\\packages\\cli\\src\\main.ts', user: 'WORKGROUP\\jo', home: 'C:\\Users\\jo\\.openhbam' };

function options(platform: Platform, system: boolean, over: Partial<ServiceOptions> = {}): ServiceOptions {
  const base = platform === 'win32' ? winFixed : FIXED;
  return { platform, system, folder: platform === 'win32' ? 'C:\\Data' : '/srv/data', port: 8080, host: '0.0.0.0', extra: [], ...base, ...over };
}

const SETS: Array<[string, (p: Platform) => Partial<ServiceOptions>]> = [
  ['defaults', () => ({})],
  ['https on 443', () => ({ port: 443, extra: ['--https', 'db.example.org'] })],
  ['loopback with workers', () => ({ host: '127.0.0.1', extra: ['--workers', 'auto'] })],
  ['an AI key file', (p) => ({ extra: ['--ai-key-file', p === 'win32' ? 'C:\\ProgramData\\tabularius\\ai.key' : '/etc/tabularius/ai.key'] })],
  ['a public URL behind a proxy', () => ({ host: '127.0.0.1', port: 9000, extra: ['--public-url', 'https://db.example.org', '--https', 'local'] })],
  ['an apostrophe and no space', (p) => ({ folder: p === 'win32' ? 'C:\\Bob\'s' : '/srv/Bob\'s' })],
  ['a folder with a space, a quote, $, %, &, <, an apostrophe and non-ASCII', (p) => ({ folder: p === 'win32' ? 'C:\\Users\\Jo Smith\\Data & Co\\100% <réel> \'q\'' : '/srv/My Data/$HOME/100%/it\'s "q" & <x> données 日本' })],
];

const problemsOf = (o: ServiceOptions): string[] => {
  const text = serviceFile(o).text;
  return o.platform === 'darwin' ? validatePlist(text, o.system) : o.platform === 'linux' ? validateSystemdUnit(text, o.system) : validateTaskXml(text, o.system);
};

// ---- Every generated file is valid ------------------------------------------------------------------------------------

for (const platform of ['darwin', 'linux', 'win32'] as const) {
  for (const system of [false, true]) {
    test(`${platform} ${system ? 'system' : 'user'} service file passes the strict validator for every option set`, () => {
      for (const [name, over] of SETS) assert.deepEqual(problemsOf(options(platform, system, over(platform))), [], name);
    });
  }
}

// ---- Golden text -------------------------------------------------------------------------------------------------------

for (const platform of ['darwin', 'linux', 'win32'] as const) {
  for (const system of [false, true]) {
    test(`golden: the ${platform} ${system ? 'system' : 'user'} service file`, () => {
      const o = options(platform, system, { port: 443, extra: ['--https', 'db.example.org', '--workers', 'auto', '--ai-key-file', platform === 'win32' ? 'C:\\ProgramData\\tabularius\\ai.key' : '/etc/tabularius/ai.key'] });
      const { path, text } = serviceFile(o);
      // The user's own folder is part of a user service file's path: keep the golden the same on every machine.
      const golden = `# ${path}\n${text}`.replaceAll(homedir(), '<HOME>');
      const file = join(GOLDEN, `${platform}-${system ? 'system' : 'user'}.txt`);
      if (process.env.UPDATE_GOLDEN === '1') { mkdirSync(GOLDEN, { recursive: true }); writeFileSync(file, golden); }
      assert.ok(existsSync(file), `${file} is missing: run with UPDATE_GOLDEN=1 once and review it`);
      // The golden is what a person reads in a review; a change to a directive shows here first.
      assert.equal(golden, readFileSync(file, 'utf8'), `the generated file changed: review it, then UPDATE_GOLDEN=1`);
    });
  }
}

// ---- What the validators catch --------------------------------------------------------------------------------------------

test('systemd validator: unknown directives, unescaped expansion, bad values, and settings that break Node', () => {
  const good = serviceFile(options('linux', true)).text;
  assert.deepEqual(validateSystemdUnit(good, true), []);
  const bad = (from: string, to: string, system = true) => validateSystemdUnit(good.replace(from, to), system);
  assert.match(bad('Restart=on-failure', 'Restart=sometimes').join('\n'), /not a Restart value/);
  assert.match(bad('NoNewPrivileges=true', 'NoNewPrivileges=maybe').join('\n'), /a boolean/);
  assert.match(bad('PrivateTmp=true', 'PrivateTmps=true').join('\n'), /PrivateTmps is not a directive/);
  assert.match(bad('UMask=0077', 'UMask=077').join('\n'), /octal mode of four digits/);
  assert.match(bad('TimeoutStopSec=60', 'TimeoutStopSec=infinity').join('\n'), /must be finite/);
  assert.match(bad('ProtectSystem=full', 'ProtectSystem=read-only').join('\n'), /yes, no, full or strict/);
  assert.match(bad('LockPersonality=true', 'LockPersonality=true\nMemoryDenyWriteExecute=true').join('\n'), /MemoryDenyWriteExecute/);
  assert.match(bad('WorkingDirectory=/srv/data', 'WorkingDirectory=/srv/%h').join('\n'), /would expand/);
  assert.match(bad('"--port"', '"--port" "$HOME" "%t"').join('\n'), /would expand/);
  assert.match(bad('ExecStart="/usr/local/bin/node"', 'ExecStart="node"').join('\n'), /full path/);
  assert.match(bad('User=tabularius\n', '').join('\n'), /names the user/);
  assert.match(bad('NoNewPrivileges=true', 'NoNewPrivileges=true\nNoNewPrivileges=true').join('\n'), /appears twice/);
  assert.match(bad('[Install]', '[Instal]').join('\n'), /not a section/);
  assert.match(bad('Restart=on-failure', 'Restart=on-failure\nthis is nothing').join('\n'), /neither a section/);
  assert.match(validateSystemdUnit(good, false).join('\n'), /User= is refused|cannot be given capabilities|default\.target/);
  // A line that ends in a backslash swallows the setting after it.
  assert.match(validateSystemdUnit(good.replace('WorkingDirectory=/srv/data', 'WorkingDirectory=/srv/data\\'), true).join('\n'), /ends in a backslash/);
  // A newline in a value would add a directive of the attacker's choosing.
  assert.match(validateSystemdUnit(good.replace('WorkingDirectory=/srv/data', 'WorkingDirectory=/srv/data\nExecStartPre=/bin/sh'), true).join('\n'), /ExecStartPre is not a directive/);
});

test('plist validator: the DTD rules and the launchd keys', () => {
  const good = serviceFile(options('darwin', false)).text;
  assert.deepEqual(validatePlist(good, false), []);
  const bad = (from: string, to: string, system = false) => validatePlist(good.replace(from, to), system);
  assert.match(bad('<key>Label</key>', '<key>Label</key><key>Extra</key>').join('\n'), /has no value|expected/);
  assert.match(bad('<true/>', '<yes/>').join('\n'), /not a property list value/);
  assert.match(bad('<integer>10</integer>', '<integer>ten</integer>').join('\n'), /not an integer/);
  assert.match(bad('<key>Umask</key>', '<key>Umsk</key>').join('\n'), /not a launchd.plist key/);
  assert.match(bad('<key>ThrottleInterval</key><integer>10</integer>', '<key>ThrottleInterval</key><string>10</string>').join('\n'), /ThrottleInterval is a positive integer/);
  assert.match(bad('<string>org.openhbam.server</string>', '<string>org.openhbam.server</string></dict>').join('\n'), /closes|not well-formed|never closed|exactly one root|dict/);
  assert.match(bad('<array><string>/usr/local/bin/node', '<array><string>node').join('\n'), /full path/);
  assert.match(bad('http://www.apple.com/DTDs/PropertyList-1.0.dtd', 'http://example.org/x.dtd').join('\n'), /Apple DOCTYPE/);
  assert.match(bad('<string>/srv/data</string>', '<string>/srv/da\u0001ta</string>').join('\n'), /does not allow/);
  assert.match(bad('<string>/srv/data</string>', '<string>/srv/a&b</string>').join('\n'), /entity/);
  assert.match(validatePlist(good, true).join('\n'), /UserName/);
  assert.match(bad('<key>RunAtLoad</key><true/>', '<key>RunAtLoad</key><false/>').join('\n'), /RunAtLoad must be true/);
});

test('Task Scheduler validator: the schema rules the generator relies on', () => {
  const good = serviceFile(options('win32', false)).text;
  assert.deepEqual(validateTaskXml(good, false), []);
  const bad = (from: string, to: string, system = false) => validateTaskXml(good.replace(from, to), system);
  assert.match(bad('<Count>255</Count>', '<Count>999</Count>').join('\n'), /1 to 255/);
  assert.match(bad('<Interval>PT1M</Interval>', '<Interval>PT30S</Interval>').join('\n'), /PT1M to P31D/);
  assert.match(bad('<Enabled>true</Enabled>\n    <Hidden>', '<Enabled>yes</Enabled>\n    <Hidden>').join('\n'), /not true or false/);
  assert.match(bad('<Priority>7</Priority>', '<Priority>11</Priority>').join('\n'), /0 to 10/);
  assert.match(bad('<LogonType>InteractiveToken</LogonType>', '<LogonType>Interactive</LogonType>').join('\n'), /LogonType/);
  assert.match(bad('<RunLevel>LeastPrivilege</RunLevel>', '<RunLevel>Highest</RunLevel>').join('\n'), /RunLevel/);
  assert.match(bad('<Hidden>false</Hidden>', '<Hidden>false</Hidden><Hidden>false</Hidden>').join('\n'), /more than once/);
  assert.match(bad('<Hidden>false</Hidden>', '<Hiden>false</Hiden>').join('\n'), /not an element it may hold/);
  assert.match(bad('xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"', 'xmlns="urn:x"').join('\n'), /xmlns/);
  assert.match(bad('<Command>', '<Command>node.exe</Command><Command>').join('\n'), /more than once|not well-formed|closes/);
  assert.match(bad('Context="Author"', 'Context="Nobody"').join('\n'), /names no Principal/);
  assert.match(bad('<Actions Context="Author">', '<Action>').join('\n'), /closes|Actions is required/);
  assert.match(validateTaskXml(good, true).join('\n'), /BootTrigger|S-1-5-18/);
  // The elements may come in any order (xs:all), so a reordered file is still valid.
  const p: string[] = [];
  const root = parseXml(good, p)!;
  assert.deepEqual(p, []);
  assert.equal(root.name, 'Task');
});

// ---- The values survive the quoting --------------------------------------------------------------------------------------

/** Splits a Windows command line the way CommandLineToArgvW and the C runtime do. */
function winSplit(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inArg = false;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') {
      let n = 0;
      while (line[i] === '\\') { n++; i++; }
      if (line[i] === '"') { cur += '\\'.repeat(Math.floor(n / 2)); if (n % 2) { cur += '"'; } else { quoted = !quoted; } inArg = true; }
      else { cur += '\\'.repeat(n); i--; inArg = true; }
    } else if (c === '"') { quoted = !quoted; inArg = true; }
    else if (/\s/.test(c) && !quoted) { if (inArg) { out.push(cur); cur = ''; inArg = false; } }
    else { cur += c; inArg = true; }
  }
  if (inArg) out.push(cur);
  return out;
}

test('every platform reads back exactly the arguments it was given, however awkward the folder', () => {
  for (const [name, over] of SETS) {
    const lin = options('linux', false, over('linux'));
    const wanted = [lin.node, '--no-warnings', '--eval', undefined, lin.main, 'serve', lin.folder, '--port', String(lin.port), '--host', lin.host, ...lin.extra];
    const unit = parseUnit(serviceFile(lin).text, []);
    const exec = systemdWords(unit.find(([, n]) => n === 'ExecStart')![2]).map((w) => w.replace(/\$\$/g, '$').replace(/%%/g, '%'));
    assert.deepEqual(exec.filter((_, i) => i !== 3), wanted.filter((w) => w !== undefined), `systemd: ${name}`);
    assert.equal(unit.find(([, n]) => n === 'WorkingDirectory')![2].replace(/%%/g, '%'), lin.folder, `systemd WorkingDirectory: ${name}`);
    assert.deepEqual(systemdWords(unit.find(([, n]) => n === 'ReadWritePaths')![2]).map((w) => w.replace(/^-/, '').replace(/%%/g, '%')), [lin.folder, lin.home, '/srv/tabularius'], `systemd ReadWritePaths: ${name}`);

    const mac = options('darwin', false, over('darwin'));
    const args = readPlist(serviceFile(mac).text).ProgramArguments as string[];
    assert.deepEqual(args.filter((_, i) => i !== 3), [mac.node, '--no-warnings', '--eval', mac.main, 'serve', mac.folder, '--port', String(mac.port), '--host', mac.host, ...mac.extra], `launchd: ${name}`);
    assert.equal(readPlist(serviceFile(mac).text).WorkingDirectory, mac.folder);

    const win = options('win32', false, over('win32'));
    const task = parseXml(serviceFile(win).text, [])!;
    const exec2 = task.children.find((c) => c.name === 'Actions')!.children[0];
    const argText = exec2.children.find((c) => c.name === 'Arguments')!.text.replace(/&(amp|lt|gt|quot|apos);/g, (_, n: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[n] as string));
    const split = winSplit(argText);
    assert.deepEqual(split.filter((_, i) => i !== 2), ['--no-warnings', '--eval', win.main, 'serve', win.folder, '--port', String(win.port), '--host', win.host, ...win.extra], `task: ${name}`);
  }
  assert.equal(winArg('a b'), '"a b"');
});

// ---- Unsafe input is refused before anything is written ----------------------------------------------------------------

test('refusing what a service file cannot carry', () => {
  const refused = (platform: Platform, over: Partial<ServiceOptions>, what: RegExp) => {
    const o = options(platform, false, over);
    assert.throws(() => serviceFile(o), what);
    assert.throws(() => refuseUnsafe(o), what);
  };
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    refused(platform, { folder: options(platform, false).folder + '\nExecStartPre=/bin/sh' }, /line break or another control character/);
    refused(platform, { extra: ['--name', 'a\u0000b'] }, /control character/);
    refused(platform, { extra: ['--name', 'x\u2028y'] }, /control character/);
    refused(platform, { host: '0.0.0.0 evil' }, /holds a space/);
    refused(platform, { port: 0 }, /port/);
    refused(platform, { port: 70000 }, /port/);
    refused(platform, { port: Number.NaN }, /port/);
  }
  refused('linux', { folder: 'relative/data' }, /full path/);
  refused('linux', { folder: '/srv/data\\' }, /backslash/);
  refused('linux', { folder: '/srv/data ' }, /space/);
  // Printing a file for another system (service print --platform) needs no full path from this one.
  assert.doesNotThrow(() => serviceFile(options('darwin', false, { folder: 'data' }), true));
  refused('darwin', { main: 'main.ts' }, /full path/);
  refused('linux', { user: 'jo smith' }, /account name/);
  refused('linux', { user: 'jo\nUser=root' }, /control character/);
  refused('darwin', { user: '<root>' }, /account name/);
  refused('win32', { user: 'a<b' }, /Windows account name/);
});

// ---- Install and uninstall on a fake home, with stand-in service managers -------------------------------------------------

function fakeHome() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-fake-root-'));
  const bin = join(dir, 'bin');
  const home = join(dir, 'home');
  const log = join(dir, 'calls.log');
  mkdirSync(bin);
  mkdirSync(home);
  writeFileSync(log, '');
  for (const cmd of ['systemctl', 'loginctl', 'launchctl', 'schtasks']) {
    writeFileSync(join(bin, cmd), `#!/bin/sh\necho "${cmd} $*" >> ${JSON.stringify(log)}\nexit 0\n`, { mode: 0o755 });
    chmodSync(join(bin, cmd), 0o755);
  }
  const drive = (code: string) => {
    const moduleUrl = new URL('../src/service.ts', import.meta.url).href;
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `import * as s from ${JSON.stringify(moduleUrl)}; ${code}`], { env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, TABULARIUS_HOME: join(home, '.openhbam') }, encoding: 'utf8' });
    return r;
  };
  const calls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean);
  const tree = (): string[] => {
    const out: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else out.push(p.slice(home.length + 1)); } };
    walk(home);
    return out.sort();
  };
  return { dir, home, drive, calls, tree, clear: () => writeFileSync(log, ''), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const optsJson = (platform: Platform, home: string, folder: string, extra: string[] = []) => JSON.stringify({ platform, folder, port: 8080, host: '127.0.0.1', system: false, extra, node: process.execPath, main: '/opt/tabularius/packages/cli/src/main.ts', user: platform === 'win32' ? 'WORKGROUP\\jo' : 'jo', home });

for (const [platform, rel] of [['linux', '.config/systemd/user/openhbam.service'], ['darwin', 'Library/LaunchAgents/org.openhbam.server.plist'], ['win32', '.openhbam/openhbam-task.xml']] as const) {
  test(`${platform}: install twice gives the same files and calls, uninstall twice leaves nothing, and the files are private`, { skip: process.platform === 'win32' }, () => {
    const fake = fakeHome();
    try {
      const o = optsJson(platform, join(fake.home, '.openhbam'), join(fake.dir, 'data'), ['--mcp-token', 'secret-token-value']);
      const install = () => fake.drive(`s.installService(${o});`);
      let r = install();
      assert.equal(r.status, 0, r.stderr);
      const first = fake.tree();
      const firstCalls = fake.calls();
      assert.ok(first.includes(rel), `${rel} is written: ${first.join(', ')}`);
      assert.ok(first.includes('.openhbam/service.json'));
      const file = join(fake.home, rel);
      const text = readFileSync(file);
      if (platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600, 'the service file holds the options, so only its owner reads it');
      assert.equal(statSync(join(fake.home, '.openhbam', 'service.json')).mode & 0o777, 0o600);
      assert.ok(firstCalls.length >= 2, 'the service manager was asked to load it');

      fake.clear();
      r = install();
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(fake.tree(), first, 'a second install adds no file');
      assert.deepEqual(readFileSync(file), text, 'and writes the same text');
      assert.deepEqual(fake.calls(), firstCalls, 'and asks the manager the same things');

      for (let i = 0; i < 2; i++) {
        r = fake.drive(`s.uninstallService({ platform: ${JSON.stringify(platform)}, home: ${JSON.stringify(join(fake.home, '.openhbam'))}, user: 'jo' });`);
        assert.equal(r.status, 0, `uninstall #${i + 1}: ${r.stderr}`);
      }
      assert.ok(!existsSync(file), 'the service file is gone');
      assert.ok(fake.calls().some((c) => /disable --now|unload|\/Delete/.test(c)), 'the manager was told to stop and forget it');
    } finally { fake.cleanup(); }
  });
}

test('install refuses unsafe input before it writes anything or asks a service manager', { skip: process.platform === 'win32' }, () => {
  const fake = fakeHome();
  try {
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      const o = optsJson(platform, join(fake.home, '.openhbam'), join(fake.dir, 'data\nExecStartPre=/bin/sh'));
      const r = fake.drive(`s.installService(${o});`);
      assert.notEqual(r.status, 0, platform);
      assert.match(r.stderr, /control character/, platform);
    }
    assert.deepEqual(fake.tree(), [], 'nothing was written');
    assert.deepEqual(fake.calls(), [], 'no service manager was asked anything');
    assert.ok(!existsSync(join(fake.dir, 'data')), 'the data folder was not made');
  } finally { fake.cleanup(); }
});

// ---- The vendors' own checkers, where installed ---------------------------------------------------------------------------

const have = (cmd: string, arg: string) => spawnSync(cmd, [arg], { encoding: 'utf8' }).error === undefined;

test('systemd-analyze verify accepts the unit (when systemd-analyze is installed)', { skip: have('systemd-analyze', '--version') ? false : 'systemd-analyze is not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-verify-'));
  try {
    const folder = join(dir, 'My Data');
    const apostrophe = join(dir, "Bob's");
    mkdirSync(folder);
    mkdirSync(apostrophe);
    const main = join(dir, 'app', 'packages', 'cli', 'src', 'main.ts');
    mkdirSync(join(dir, 'app', 'packages', 'cli', 'src'), { recursive: true });
    writeFileSync(main, '');
    for (const [system, folder] of [[true, apostrophe], [false, apostrophe], [true, join(dir, 'My Data')], [false, join(dir, 'My Data')]] as const) {
      const o = { ...options('linux', system, { folder, main, node: process.execPath, user: userInfo().username, home: join(dir, 'home'), extra: ['--https', 'db.example.org', '--workers', 'auto'] }) };
      const file = join(dir, `openhbam-${system ? 'system' : 'user'}-${folder.endsWith('Data') ? 'space' : 'quote'}.service`);
      writeFileSync(file, serviceFile(o).text);
      const r = spawnSync('systemd-analyze', ['verify', file], { encoding: 'utf8' });
      assert.equal(`${r.stdout}${r.stderr}`.trim(), '', `${system ? 'system' : 'user'} unit: ${r.stdout}${r.stderr}`);
      assert.equal(r.status, 0);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('xmllint finds the plist and the task well-formed (when xmllint is installed)', { skip: have('xmllint', '--version') ? false : 'xmllint is not installed' }, () => {
  for (const platform of ['darwin', 'win32'] as const) {
    for (const system of [false, true]) {
      for (const [name, over] of SETS) {
        const text = serviceFile(options(platform, system, over(platform))).text.replace('encoding="UTF-16"', 'encoding="UTF-8"');
        const r = spawnSync('xmllint', ['--noout', '--nonet', '-'], { input: text, encoding: 'utf8' });
        assert.equal(r.status, 0, `${platform} ${system ? 'system' : 'user'} ${name}: ${r.stderr}`);
      }
    }
  }
});

test('install says when an option puts a secret into the service file', async () => {
  const { serviceSummary } = await import('../src/service.ts');
  const lines = serviceSummary({ folder: '/srv/data', port: 8080, host: '127.0.0.1', extra: ['--mcp-token', 'x', '--ai-key-file', '/etc/ai.key'] }, []);
  assert.ok(lines.some((l) => /--mcp-token is written into the service file/.test(l)), lines.join('\n'));
  assert.ok(!serviceSummary({ folder: '/srv/data', port: 8080, host: '127.0.0.1', extra: ['--ai-key-file', '/etc/ai.key'] }, []).some((l) => /written into the service file/.test(l)));
});
