import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest } from '../src/manifest.ts';
import { readPackage } from '../src/package.ts';
import { zip } from '../../calc/src/zip.ts';

const manifest = { id: 'org.example', name: 'Example', version: '1.0.0', api: '1.0', publisher: 'Example', main: 'main.js', functions: [{ name: 'Example', min: 0 }] };
test('ordinary plug-in manifest is valid', () => assert.equal(parseManifest(manifest).ok, true));
for (const bad of ['con.example', 'nul.plugin', 'com1.example']) {
  test(`plug-in id refuses device name ${bad}`, () => assert.equal(parseManifest({ ...manifest, id: bad }).ok, false));
}
for (const bad of ['NUL.js', 'main:stream.js', 'CON.mjs']) {
  test(`plug-in entry refuses device/stream name ${bad}`, () => assert.equal(parseManifest({ ...manifest, main: bad }).ok, false));
}
test('plug-in package refuses case-only duplicate files before installation', () => {
  const bytes = zip([
    { name: 'plugin.json', data: Buffer.from(JSON.stringify(manifest)) },
    { name: 'main.js', data: Buffer.from('') },
    { name: 'README', data: Buffer.from('a') },
    { name: 'readme', data: Buffer.from('b') },
  ]);
  assert.throws(() => readPackage(bytes), /twice|case/i);
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPluginSecrets, writePluginSecret } from '../src/secrets.ts';
test('plug-in secrets use the injectable Windows mode policy and preserve values', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-plugin-key-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const value = ['synthetic', 'value'].join('-');
  writePluginSecret(dir, 'org.example', 'VALUE', value, 'win32');
  assert.deepEqual(readPluginSecrets(dir, 'org.example', 'win32'), { VALUE: value });
  writePluginSecret(dir, 'org.example', 'VALUE', undefined, 'win32');
  assert.deepEqual(readPluginSecrets(dir, 'org.example', 'win32'), {});
});
