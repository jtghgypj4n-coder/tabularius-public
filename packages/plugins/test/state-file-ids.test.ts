import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zip } from '../../calc/src/zip.ts';
import { stopJavaScript } from '../../store/src/javascript.ts';
import { installPackage, loadPlugins, parseManifest, PluginRegistry, pluginStatus, setPluginEnabled } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-plugin-state-'));
after(async () => {
  await stopJavaScript();
  rmSync(dir, { recursive: true, force: true });
});

const manifest = (id: string) => ({
  id, name: 'Shout', version: '1.0.0', api: '^1.0', publisher: 'Example', main: 'main.js',
  functions: [{ name: 'Pk_Shout', min: 1, max: 1 }],
});
const packageBytes = (id: string) => zip([
  { name: 'plugin.json', data: Buffer.from(JSON.stringify(manifest(id))) },
  { name: 'main.js', data: Buffer.from('const functions = { Pk_Shout: (s) => s.toUpperCase() };') },
]);
const fresh = () => mkdtempSync(join(dir, 'data-'));

// Ids with a "json" part are refused by the id check (main's JSON_SEGMENT); "secrets" has no dot or hyphen, so the id pattern refuses it.
const JSON_PART = /"json" part/;
for (const [id, why] of [
  ['enabled.json', JSON_PART], ['builtin-off.json', JSON_PART], ['trusted-publishers.json', JSON_PART], ['org.example.json', JSON_PART],
  ['enabled.json.lock.db', JSON_PART], ['secrets', /id/i],
] as const) {
  test(`${id} cannot be a plug-in package id`, () => {
    const parsed = parseManifest(manifest(id));
    assert.equal(parsed.ok, false);
    assert.match(parsed.ok ? '' : parsed.errors.join('; '), why);
    const data = fresh();
    assert.throws(() => installPackage(data, packageBytes(id), { allowUnsigned: true, replace: true }), why);
    assert.equal(existsSync(join(data, 'plugins')), false);
  });
}

test('refused package cannot replace enabled.json, while a normal id installs', () => {
  const data = fresh();
  mkdirSync(join(data, 'plugins'));
  const enabled = Buffer.from('{"Invoices.fmp12":["org.example.shout"]}\n');
  writeFileSync(join(data, 'plugins', 'enabled.json'), enabled);
  assert.throws(() => installPackage(data, packageBytes('enabled.json'), { allowUnsigned: true, replace: true }), JSON_PART);
  assert.deepEqual(readFileSync(join(data, 'plugins', 'enabled.json')), enabled);
  assert.equal(installPackage(data, packageBytes('org.example.shout'), { allowUnsigned: true }).manifest.id, 'org.example.shout');
  assert.deepEqual(readFileSync(join(data, 'plugins', 'enabled.json')), enabled);
});

test('unknown built-in pack id is reported with its file name', () => {
  const data = fresh();
  mkdirSync(join(data, 'plugins'));
  writeFileSync(join(data, 'plugins', 'builtin-off.json'), JSON.stringify({ 'Invoices.fmp12': ['com.example.missing'] }));
  const status = pluginStatus(data);
  assert.ok(status.problems.some((p) => p.includes('Invoices.fmp12') && p.includes('com.example.missing')), status.problems.join('\n'));
  assert.ok(status.builtins.every((p) => p.offFor.length === 0));
});

for (const file of ['enabled.json', 'builtin-off.json']) {
  for (const value of ['null', '5', '[]', '"not a map"']) {
    test(`${file} containing ${value} is reported without crashing`, () => {
      const data = fresh();
      mkdirSync(join(data, 'plugins'));
      const path = join(data, 'plugins', file);
      writeFileSync(path, value);
      const status = pluginStatus(data);
      assert.ok(status.problems.some((p) => p.includes(`plugins/${file} is not a list of file names to plug-in ids`)), status.problems.join('\n'));
      assert.deepEqual(status.enabled, {});
      assert.ok(status.builtins.every((p) => p.offFor.length === 0));
      const logs: string[] = [];
      assert.doesNotThrow(() => loadPlugins(new PluginRegistry(), data, (message) => logs.push(message)));
      assert.ok(logs.some((p) => p.includes(`plugins/${file} is not a list of file names to plug-in ids`)), logs.join('\n'));
      if (file === 'enabled.json') assert.throws(() => setPluginEnabled(data, 'Invoices.fmp12', 'org.example.shout', false), /plugins\/enabled\.json is not a list/);
      else assert.throws(() => setPluginEnabled(data, 'Invoices.fmp12', 'com.openhbam.baseelements', false), /plugins\/builtin-off\.json is not a list/);
      assert.equal(readFileSync(path, 'utf8'), value);
    });
  }
}

test('owner and function index cannot be provided twice with different case', () => {
  const parsed = parseManifest({
    ...manifest('org.example.owners'), owners: ['ABCD', 'abcd'],
    functions: [{ name: 'One', owner: 'ABCD', index: 1, min: 0 }, { name: 'Two', owner: 'abcd', index: 1, min: 0 }],
  });
  assert.equal(parsed.ok, false);
  assert.match(parsed.ok ? '' : parsed.errors.join('; '), /abcd:1 is provided twice/i);
  const unique = parseManifest({
    ...manifest('org.example.unique'), owners: ['ABCD'],
    functions: [{ name: 'One', owner: 'ABCD', index: 1, min: 0 }],
  });
  assert.equal(unique.ok, true);
  if (unique.ok) assert.equal(unique.manifest.functions[0].owner, 'ABCD');
});
