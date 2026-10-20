// Installing a plug-in package: a trusted publisher is recorded only once the install worked, the swap leaves no
// staging folder behind, the plug-in API range is checked, and a torn config file is named and does not hide the list.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stopJavaScript } from '../../store/src/javascript.ts';
import { apiSatisfied, parseManifest, HOST_API } from '../src/manifest.ts';
import { generateKey, installPackage, packPlugin, pluginStatus, trustedPublishers } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-install-robust-'));
after(async () => {
  await stopJavaScript();
  rmSync(dir, { recursive: true });
});

let n = 0;
function source(version = '1.0.0', api = '^1.0'): string {
  const d = join(dir, `src${n++}`);
  mkdirSync(d);
  writeFileSync(join(d, 'plugin.json'), JSON.stringify({ id: 'org.example.shout', name: 'Shout', version, api, publisher: 'Example Co', main: 'main.js', functions: [{ name: 'Pk_Shout', min: 1, max: 1 }] }));
  writeFileSync(join(d, 'main.js'), 'const functions = { Pk_Shout: (s) => s.toUpperCase() };');
  return d;
}
const fresh = () => mkdtempSync(join(dir, 'data-'));

test('an install that stops for another reason does not trust the publisher', () => {
  const key = generateKey();
  const { bytes } = packPlugin(source(), key.privatePem);
  const data = fresh();
  // A folder put there by hand: installing over it needs --replace.
  mkdirSync(join(data, 'plugins', 'org.example.shout'), { recursive: true });
  writeFileSync(join(data, 'plugins', 'org.example.shout', 'plugin.json'), '{}');
  assert.throws(() => installPackage(data, bytes, { trust: key.fingerprint }), /--replace/);
  assert.deepEqual(trustedPublishers(data), {}, 'nobody was trusted');
  const done = installPackage(data, bytes, { trust: key.fingerprint, replace: true });
  assert.equal(done.replaced, 'unpackaged');
  assert.deepEqual(trustedPublishers(data), { [key.fingerprint]: 'Example Co' });
});

test('a replaced plug-in leaves no staging or aside folder', () => {
  const key = generateKey();
  const data = fresh();
  installPackage(data, packPlugin(source('1.0.0'), key.privatePem).bytes, { trust: key.fingerprint });
  installPackage(data, packPlugin(source('1.1.0'), key.privatePem).bytes);
  assert.deepEqual(readdirSync(join(data, 'plugins')).filter((f) => f.startsWith('.')), []);
  assert.equal(pluginStatus(data).installed[0].version, '1.1.0');
});

test('a plug-in written for an API this Tabularius does not offer is refused', () => {
  assert.equal(HOST_API, '1.0');
  for (const [range, ok] of [['^1.0', true], ['^1.1', false], ['^9.0', false], ['~1.0', true], ['~1.1', false], ['>=1.0', true], ['>=2.0', false], ['1.x', true], ['1.0', true], ['1.0.0', true], ['2.x', false], ['*', true], ['latest', false], ['', false]] as const) {
    assert.equal(apiSatisfied(range), ok, range);
  }
  const key = generateKey();
  assert.throws(() => packPlugin(source('1.0.0', '^9.0'), key.privatePem), /needs plug-in API \^9\.0, and this Tabularius offers 1\.0/);
  const parsed = parseManifest({ id: 'org.example.x', name: 'X', version: '1.0.0', api: '^9.0', publisher: 'p', main: 'main.js', functions: [{ name: 'X_A', min: 0 }] });
  assert.equal(parsed.ok, false);
  assert.match(parsed.ok ? '' : parsed.errors.join('; '), /api: needs plug-in API/);
});

test('a torn config file is named, and the plug-in list still shows', () => {
  const key = generateKey();
  const data = fresh();
  installPackage(data, packPlugin(source(), key.privatePem).bytes, { trust: key.fingerprint });
  for (const file of ['enabled.json', 'builtin-off.json']) writeFileSync(join(data, 'plugins', file), '{ "Invoices": [');
  const st = pluginStatus(data);
  assert.deepEqual(st.installed.map((m) => m.id), ['org.example.shout']);
  assert.ok(st.problems.some((p) => p.includes(join(data, 'plugins', 'enabled.json')) && /not valid JSON/.test(p)), st.problems.join('\n'));
  assert.ok(st.problems.some((p) => p.includes('builtin-off.json')), st.problems.join('\n'));
  // The trusted-publishers file blocks an install and says which file it is.
  writeFileSync(join(data, 'plugins', 'trusted-publishers.json'), 'nope');
  const other = generateKey();
  assert.throws(() => installPackage(data, packPlugin(source('2.0.0'), other.privatePem).bytes, { trust: other.fingerprint }), (e: Error) => e.message.includes('trusted-publishers.json') && /not valid JSON/.test(e.message));
  // A torn install record is a problem, not a crash.
  writeFileSync(join(data, 'plugins', 'org.example.shout', 'install.json'), '{');
  assert.ok(pluginStatus(data).problems.some((p) => p.includes('install.json')));
  assert.ok(existsSync(join(data, 'plugins', 'org.example.shout', 'plugin.json')));
});
