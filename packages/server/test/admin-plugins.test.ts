// The console's plug-ins page: what's installed and who made it, turning one on for a hosted file now, and setting
// the secrets it asked for without ever showing them again.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { stopJavaScript } from '../../store/src/javascript.ts';
import { generateKey, installPackage, packPlugin } from '../../plugins/src/index.ts';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let installed: () => string[];
let store: () => ReturnType<Awaited<ReturnType<typeof serve>>['host']['get']> & object;
const logs: string[] = [];
const key = generateKey();

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-plugins-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  // One plug-in installed from a signed package, one put in the folder by hand.
  const src = join(dir, 'src');
  mkdirSync(src);
  writeFileSync(join(src, 'plugin.json'), JSON.stringify({
    id: 'org.example.keyed', name: 'Keyed', version: '1.2.0', api: '^1.0', publisher: 'Example Co', main: 'main.js',
    permissions: { network: ['api.example.com'], secrets: ['API_KEY'] }, functions: [{ name: 'Ky_Get', min: 0, max: 0 }],
  }));
  writeFileSync(join(src, 'main.js'), 'const functions = { Ky_Get: () => tabularius.secrets.get("API_KEY") ?? "" };');
  installPackage(dir, packPlugin(src, key.privatePem).bytes, { trust: key.fingerprint });
  mkdirSync(join(dir, 'plugins', 'hand'), { recursive: true });
  writeFileSync(join(dir, 'plugins', 'hand', 'plugin.json'), JSON.stringify({ id: 'org.example.hand', name: 'Hand', version: '1.0.0', api: '^1.0', publisher: 'Me', main: 'main.js', functions: [{ name: 'Hd_Id', min: 1, max: 1 }] }));
  writeFileSync(join(dir, 'plugins', 'hand', 'main.js'), 'const functions = { Hd_Id: (s) => s };');
  const s = await serve({ dir, port: 0, log: (m: string) => logs.push(m) });
  server = s.server;
  base = s.url;
  store = () => s.host.get('Charts')!;
  // Built-in compatibility packs are always enabled unless turned off for a file;
  // this helper is about plug-ins installed by the test, not those bundled packs.
  installed = () => s.host.get('Charts')!.installedPlugins().filter((p) => p.state === 'Enabled' && p.version !== 'tabularius').map((p) => p.name);
});
after(async () => {
  await stopJavaScript();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const admin = (method: string, path: string, body?: unknown) =>
  fetch(`${base}/tabularius/admin/v1${path}`, { method, headers: { 'x-tabularius-admin': '1', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

test('the page lists plug-ins with who signed them and what they ask for', { skip }, async () => {
  const r = await admin('GET', '/plugins');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.files, ['Charts']);
  const keyed = r.body.plugins.find((p: { id: string }) => p.id === 'org.example.keyed');
  assert.equal(keyed.package.signer, key.fingerprint);
  assert.deepEqual(keyed.permissions.network, ['api.example.com']);
  assert.deepEqual(keyed.secrets, [{ name: 'API_KEY', set: false }]);
  assert.deepEqual(keyed.enabledFor, []);
  assert.equal(r.body.plugins.find((p: { id: string }) => p.id === 'org.example.hand').package, null);
});

test('turning a plug-in on takes effect now and is kept for the next start', { skip }, async () => {
  assert.deepEqual(installed(), []);
  const on = await admin('POST', '/plugins/org.example.keyed/enable', { file: 'charts' });
  assert.equal(on.status, 200);
  assert.deepEqual(installed(), ['Keyed']);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'plugins', 'enabled.json'), 'utf8')), { Charts: ['org.example.keyed'] });
  assert.equal((await admin('POST', '/plugins/org.example.keyed/enable', { file: 'Nope' })).status, 404);
  assert.equal((await admin('POST', '/plugins/org.example.nope/enable', { file: 'Charts' })).status, 404);
  assert.equal((await admin('POST', '/plugins/org.example.keyed/disable', { file: 'Charts' })).status, 200);
  assert.deepEqual(installed(), []);
});

test('a secret is set from the page, kept private, and never shown or logged', { skip }, async () => {
  const set = await admin('PUT', '/plugins/org.example.keyed/secrets/API_KEY', { value: 'sk-very-secret' });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.plugins.find((p: { id: string }) => p.id === 'org.example.keyed').secrets, [{ name: 'API_KEY', set: true }]);
  assert.equal(JSON.stringify(set.body).includes('sk-very-secret'), false);
  assert.equal(logs.join('\n').includes('sk-very-secret'), false);
  assert.match(logs.join('\n'), /secret API_KEY set from the console/);
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'plugins', 'secrets', 'org.example.keyed.json')).mode & 0o777, 0o600);
  // A name the plug-in didn't ask for, or an empty value, is refused.
  assert.equal((await admin('PUT', '/plugins/org.example.keyed/secrets/OTHER', { value: 'x' })).status, 400);
  assert.equal((await admin('PUT', '/plugins/org.example.keyed/secrets/API_KEY', { value: '' })).status, 400);
  const cleared = await admin('DELETE', '/plugins/org.example.keyed/secrets/API_KEY');
  assert.deepEqual(cleared.body.plugins.find((p: { id: string }) => p.id === 'org.example.keyed').secrets, [{ name: 'API_KEY', set: false }]);
});

test('BaseElements is built in: on for every file, and turned off for one from the page', { skip }, async () => {
  const r = await admin('GET', '/plugins');
  assert.deepEqual(r.body.builtins.map((b: { id: string; enabledFor: string[] }) => [b.id, b.enabledFor]), [
    ['com.openhbam.baseelements', ['Charts']],
    ['com.openhbam.troi-text', ['Charts']],
    ['com.openhbam.troi-dialog', ['Charts']],
  ]);
  const off = await admin('POST', '/plugins/com.openhbam.baseelements/disable', { file: 'charts' });
  assert.equal(off.status, 200);
  assert.deepEqual(off.body.builtins[0].enabledFor, []);
  assert.equal(JSON.stringify(JSON.parse(readFileSync(join(dir, 'plugins', 'builtin-off.json'), 'utf8'))), '{"Charts":["com.openhbam.baseelements"]}');
  assert.equal(store().builtinOff('BE_Zip'), true);
  assert.equal(store().installedPlugins().find((p) => p.name === 'BaseElements')?.state, 'Disabled');
  assert.equal((await admin('PUT', '/plugins/com.openhbam.baseelements/secrets/X', { value: 'x' })).status, 400);
  assert.equal((await admin('POST', '/plugins/com.openhbam.baseelements/enable', { file: 'Charts' })).status, 200);
  assert.equal(store().builtinOff('BE_Zip'), false);
});
