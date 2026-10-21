import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The one-command install's service files (scripts/install.sh --print shows them without installing).
const script = join(import.meta.dirname, '..', '..', '..', 'scripts', 'install.sh');
const print = (os: string, ...args: string[]) =>
  execFileSync('sh', [script, '--service', '/srv/Databases', '--print', ...args], { env: { ...process.env, TABULARIUS_OS: os }, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const sh = spawnSync('sh', ['-c', 'true']).status === 0 ? false : 'no sh';

test('the service listens on this computer only unless a certificate for a domain asks otherwise', { skip: sh }, () => {
  assert.match(print('Linux'), /"--host" "127\.0\.0\.1"/);
  assert.match(print('Linux', '--', '--https', 'local'), /"--host" "127\.0\.0\.1"/);
  assert.match(print('Linux', '--', '--https', 'files.example.com'), /"--host" "0\.0\.0\.0"/);
  assert.match(print('Linux', '--host', '127.0.0.1', '--', '--https', 'files.example.com'), /"--host" "127\.0\.0\.1"/);
});

test('systemd: a user service, or a system one that starts at boot and may use port 443', { skip: sh }, () => {
  const user = print('Linux', '--', '--sql-port', '5432', '--https', 'files.example.com');
  // The service starts through a short --eval entry that puts the previous release back if an upgrade stopped between its renames.
  assert.match(user, /^ExecStart=".+node" "--no-warnings" "--eval" ".+" ".+main\.ts" "serve" "\/srv\/Databases" "--port" "8080" "--host" "0\.0\.0\.0" "--sql-port" "5432" "--https" "files\.example\.com"$/m);
  assert.match(user, /^WantedBy=default\.target$/m);
  assert.doesNotMatch(user, /^User=/m);

  const system = print('Linux', '--system', '--port', '443', '--', '--name', 'Sales "East" 100%');
  assert.match(system, /^WantedBy=multi-user\.target$/m);
  assert.match(system, /^User=\S+$/m);
  assert.match(system, /^AmbientCapabilities=CAP_NET_BIND_SERVICE$/m);
  // Quotes escaped, % doubled, as systemd reads them.
  assert.match(system, / "--name" "Sales \\"East\\" 100%%"$/m);

  // systemd itself agrees, where it is installed.
  if (spawnSync('systemd-analyze', ['--version']).status === 0) {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-unit-'));
    try {
      for (const [name, text] of [['user', user], ['system', system]]) {
        const f = join(dir, `tabularius-${name}.service`);
        writeFileSync(f, text);
        const r = spawnSync('systemd-analyze', ['verify', f]);
        assert.equal(r.status, 0, r.stderr.toString());
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('launchd: a LaunchAgent, or a LaunchDaemon that runs as you at boot', { skip: sh }, () => {
  const agent = print('Darwin', '--', '--https', 'a&b.example.com');
  assert.match(agent, /<key>Label<\/key><string>org\.openhbam\.server<\/string>/);
  assert.match(agent, /<string>serve<\/string><string>\/srv\/Databases<\/string>/);
  assert.match(agent, /<string>--https<\/string><string>a&amp;b\.example\.com<\/string><\/array>/);
  assert.doesNotMatch(agent, /UserName/);
  const daemon = print('Darwin', '--system');
  assert.match(daemon, /<key>UserName<\/key><string>[^<]+<\/string>/);
  assert.match(daemon, /<key>KeepAlive<\/key><true\/>/);
});
