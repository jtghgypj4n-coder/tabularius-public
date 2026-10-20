// tabularius plugins: lists the server folder's plug-ins and turns them on or off per file in plugins/enabled.json.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './cli-run.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const run = (dir: string, ...args: string[]) => runCli(main, ['plugins', dir, ...args]);

function plugin(dir: string, folder: string, id: string, fn: string): void {
  const d = join(dir, 'plugins', folder);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'plugin.json'), JSON.stringify({ id, name: folder, version: '1.0.0', api: '^1.0', publisher: 'Example', main: 'main.js', functions: [{ name: fn, min: 1, max: 1 }] }));
  writeFileSync(join(d, 'main.js'), `const functions = { ${fn}: (s) => s };`);
}

describe('plugins CLI', { concurrency: 4 }, () => {
test('plugins lists, enables and disables, refusing what the server would refuse', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-plugins-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const initial = (await run(dir)).stdout;
  assert.match(initial, /No plug-ins in/);
  assert.match(initial, /BaseElements \(com\.openhbam\.baseelements\) built in: on for every file/);
  assert.equal((await run(dir, 'disable', 'Invoices', 'com.openhbam.baseelements')).status, 0);
  assert.match((await run(dir)).stdout, /built in: off for Invoices/);
  assert.equal((await run(dir, 'enable', 'Invoices', 'com.openhbam.baseelements')).status, 0);
  plugin(dir, 'Shout', 'org.example.shout', 'Ex_Shout');
  plugin(dir, 'Echo', 'org.example.echo', 'Ex_Shout');
  assert.match((await run(dir, 'list')).stdout, /Shout 1\.0\.0 \(org\.example\.shout\) by Example: 1 function, not on for any file/);
  const on = (await run(dir, 'enable', 'Invoices.fmp12', 'org.example.shout'));
  assert.equal(on.status, 0, on.stderr);
  assert.match(on.stdout, /on for Invoices\.fmp12 when the server next starts/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'plugins', 'enabled.json'), 'utf8')), { Invoices: ['org.example.shout'] });
  assert.match((await run(dir)).stdout, /on for Invoices/);
  // Two plug-ins can't give one file the same function, and one that isn't there can't be turned on.
  assert.match((await run(dir, 'enable', 'invoices', 'org.example.echo')).stderr, /clashes/);
  assert.match((await run(dir, 'enable', 'Invoices', 'org.example.nope')).stderr, /isn't installed/);
  assert.equal((await run(dir, 'disable', 'invoices', 'org.example.shout')).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'plugins', 'enabled.json'), 'utf8')), {});
});

test('plugins secret sets a plug-in\'s secret from standard input and list shows which are set, never the value', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-plugins-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const d = join(dir, 'plugins', 'Keyed');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'plugin.json'), JSON.stringify({ id: 'org.example.keyed', name: 'Keyed', version: '1.0.0', api: '^1.0', publisher: 'Example',
    main: 'main.js', permissions: { secrets: ['API_KEY'] }, functions: [{ name: 'Ky_Get', min: 0 }] }));
  writeFileSync(join(d, 'main.js'), 'const functions = { Ky_Get: () => tabularius.secrets.get("API_KEY") };');
  assert.match((await run(dir)).stdout, /secrets: API_KEY not set/);
  const set = spawnSync(process.execPath, ['--no-warnings', main, 'plugins', dir, 'secret', 'org.example.keyed', 'API_KEY'], { input: 'sk-secret\n', encoding: 'utf8' });
  assert.equal(set.status, 0, set.stderr);
  assert.doesNotMatch(set.stdout, /sk-secret/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'plugins', 'secrets', 'org.example.keyed.json'), 'utf8')), { API_KEY: 'sk-secret' });
  const listed = (await run(dir)).stdout;
  assert.match(listed, /secrets: API_KEY set/);
  assert.doesNotMatch(listed, /sk-secret/);
  assert.match((await run(dir, 'secret', 'org.example.keyed', 'OTHER')).stderr, /doesn't ask for a secret called OTHER/);
  assert.equal((await run(dir, 'secret', 'org.example.keyed', 'API_KEY', '--clear')).status, 0);
  assert.match((await run(dir)).stdout, /secrets: API_KEY not set/);
});

test('plugins keygen, pack and install: a signed package is trusted by its fingerprint once', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-plugins-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const src = join(dir, 'src-pack');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'plugin.json'), JSON.stringify({ id: 'org.example.packed', name: 'Packed', version: '1.0.0', api: '^1.0', publisher: 'Example',
    main: 'main.js', permissions: { network: ['api.example.com'] }, functions: [{ name: 'Pk_Id', min: 1, max: 1 }] }));
  writeFileSync(join(src, 'main.js'), 'const functions = { Pk_Id: (s) => s };');
  const keyFile = join(dir, 'publisher.pem');
  const gen = (await run(dir, 'keygen', keyFile));
  assert.equal(gen.status, 0, gen.stderr);
  const fp = /fingerprint: ([0-9a-f:]+)/.exec(gen.stdout)![1];
  assert.doesNotMatch(gen.stdout, /PRIVATE/);
  const pkg = join(dir, 'packed.ohplugin');
  const pack = (await run(dir, 'pack', src, '--key', keyFile, '-o', pkg));
  assert.equal(pack.status, 0, pack.stderr);
  assert.match(pack.stdout, new RegExp(`signed by ${fp}`));
  // The permissions are shown before anything is installed, and an untrusted publisher is refused.
  const refused = (await run(dir, 'install', pkg));
  assert.match(refused.stdout, /asks for web: api\.example\.com/);
  assert.match(refused.stderr, /--trust /);
  const ok = (await run(dir, 'install', pkg, '--trust', fp));
  assert.equal(ok.status, 0, ok.stderr);
  assert.match((await run(dir)).stdout, new RegExp(`Packed 1\\.0\\.0 \\(org\\.example\\.packed\\).*\\n  installed from a package signed by ${fp}`));
  assert.equal((await run(dir, 'enable', 'Invoices', 'org.example.packed')).status, 0);
  assert.match((await run(dir, 'uninstall', 'org.example.packed')).stderr, /enabled for Invoices/);
  assert.equal((await run(dir, 'disable', 'Invoices', 'org.example.packed')).status, 0);
  assert.equal((await run(dir, 'uninstall', 'org.example.packed')).status, 0);
});

test('pack and install options that need a value say so, and never take the next option as it', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-plugins-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // These invalid options are read-only, so their CLI checks can run together.
  const [key, next, trust, out] = await Promise.all([
    runCli(main, ['plugins', dir, 'pack', dir, '--key']),
    runCli(main, ['plugins', dir, 'pack', dir, '--key', '-o', join(dir, 'out.ohplugin')]),
    runCli(main, ['plugins', dir, 'install', 'whatever.ohplugin', '--trust']),
    runCli(main, ['plugins', dir, 'pack', dir, '-o']),
  ]);
  assert.equal(key.status, 1);
  assert.match(key.stderr, /--key needs a file/);
  assert.equal(next.status, 1);
  assert.match(next.stderr, /--key needs a file/);
  assert.equal(existsSync(join(dir, 'out.ohplugin')), false);
  assert.equal(trust.status, 1);
  assert.match(trust.stderr, /--trust needs a publisher fingerprint/);
  assert.match(out.stderr, /-o needs a file name/);
});

});
