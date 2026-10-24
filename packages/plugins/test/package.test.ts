import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zip, unzip } from '../../calc/src/zip.ts';
import { stopJavaScript } from '../../store/src/javascript.ts';
import { generateKey, installPackage, packPlugin, pluginStatus, readPackage, trustedPublishers, uninstallPlugin } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-package-'));
after(async () => {
  await stopJavaScript();
  rmSync(dir, { recursive: true });
});

let n = 0;
function source(version = '1.0.0', code = 'const functions = { Pk_Shout: (s) => s.toUpperCase() };'): string {
  const d = join(dir, `src${n++}`);
  mkdirSync(d);
  writeFileSync(join(d, 'plugin.json'), JSON.stringify({ id: 'org.example.shout', name: 'Shout', version, api: '^1.0', publisher: 'Example Co', main: 'main.js', functions: [{ name: 'Pk_Shout', min: 1, max: 1 }] }));
  writeFileSync(join(d, 'main.js'), code);
  writeFileSync(join(d, 'README.md'), '# Shout');
  writeFileSync(join(d, 'notes.txt'), 'not packed');
  return d;
}
const fresh = () => {
  const d = mkdtempSync(join(dir, 'data-'));
  return d;
};

test('a signed package installs once its publisher is trusted, and the plug-in then loads', () => {
  const key = generateKey();
  const { bytes, name, fingerprint } = packPlugin(source(), key.privatePem);
  assert.equal(name, 'org.example.shout-1.0.0.ohplugin');
  assert.equal(fingerprint, key.fingerprint);
  // Only the plug-in's files are packed.
  assert.deepEqual(unzip(bytes).map((e) => e.name).sort(), ['README.md', 'main.js', 'plugin.json', 'signature.json']);
  const data = fresh();
  // Not trusted yet: the admin has to type the fingerprint they checked.
  assert.throws(() => installPackage(data, bytes), new RegExp(`--trust ${key.fingerprint}`));
  assert.throws(() => installPackage(data, bytes, { trust: '00000000:00000000:00000000:00000000' }), /haven't trusted/);
  const done = installPackage(data, bytes, { trust: key.fingerprint });
  assert.equal(done.signer, key.fingerprint);
  assert.deepEqual(trustedPublishers(data), { [key.fingerprint]: 'Example Co' });
  const st = pluginStatus(data);
  assert.deepEqual(st.installed.map((m) => m.id), ['org.example.shout']);
  assert.equal(st.installs['org.example.shout'].signer, key.fingerprint);
  assert.deepEqual(st.problems, []);
  // A trusted publisher's next version installs without asking, replacing the first.
  const next = installPackage(data, packPlugin(source('1.1.0'), key.privatePem).bytes);
  assert.equal(next.replaced, '1.0.0');
  assert.equal(pluginStatus(data).installed[0].version, '1.1.0');
});

test('a package changed after it was signed, or signed by someone else, is refused', () => {
  const key = generateKey();
  const { bytes } = packPlugin(source(), key.privatePem);
  const files = unzip(bytes).map((e) => (e.name === 'main.js' ? { name: e.name, data: Buffer.from('const functions = { Pk_Shout: () => process.env.HOME };') } : e));
  assert.throws(() => readPackage(zip(files)), /signature does not match/);
  // Another publisher's package for the same plug-in doesn't replace it without --replace.
  const data = fresh();
  installPackage(data, bytes, { trust: key.fingerprint });
  const other = generateKey();
  const impostor = packPlugin(source('2.0.0'), other.privatePem).bytes;
  assert.throws(() => installPackage(data, impostor, { trust: other.fingerprint }), /Install again with --replace/);
  assert.equal(pluginStatus(data).installed[0].version, '1.0.0');
  // The refused attempt trusted nobody, so the replacement has to name the publisher again.
  assert.deepEqual(Object.keys(trustedPublishers(data)), [key.fingerprint]);
  assert.throws(() => installPackage(data, impostor, { replace: true }), /haven't trusted/);
  assert.equal(installPackage(data, impostor, { replace: true, trust: other.fingerprint }).replaced, '1.0.0');
});

test('an unsigned package needs --allow-unsigned, and strange packages are refused', () => {
  const { bytes } = packPlugin(source());
  const data = fresh();
  assert.throws(() => installPackage(data, bytes), /not signed.*--allow-unsigned/);
  assert.equal(installPackage(data, bytes, { allowUnsigned: true }).signer, undefined);
  assert.throws(() => readPackage(new Uint8Array([1, 2, 3])), /not a plug-in package/);
  const entries = unzip(bytes);
  assert.throws(() => readPackage(zip([...entries, { name: '../evil.js', data: Buffer.from('x') }])), /top of the package only/);
  assert.throws(() => readPackage(zip([...entries, { name: 'extra.js', data: Buffer.from('x') }])), /extra\.js, which a plug-in package doesn't/);
  assert.throws(() => readPackage(zip(entries.filter((e) => e.name !== 'main.js'))), /no main\.js/);
  for (const signature of ['null', '1', '"x"']) {
    const unsigned = entries.filter((e) => e.name !== 'signature.json');
    assert.throws(() => readPackage(zip([...unsigned, { name: 'signature.json', data: Buffer.from(signature) }])), /signature\.json needs publisherKey and sig/);
  }
});

test('a file changed by hand after install is not loaded, and uninstall waits until the plug-in is off', () => {
  const data = fresh();
  installPackage(data, packPlugin(source()).bytes, { allowUnsigned: true });
  writeFileSync(join(data, 'plugins', 'org.example.shout', 'main.js'), 'const functions = { Pk_Shout: () => "tampered" };');
  const st = pluginStatus(data);
  assert.deepEqual(st.installed, []);
  assert.match(st.problems.join('\n'), /main\.js has changed since org\.example\.shout was installed/);
  assert.throws(() => uninstallPlugin(data, 'org.example.shout', ['Shop']), /enabled for Shop/);
  uninstallPlugin(data, 'org.example.shout', []);
  assert.equal(existsSync(join(data, 'plugins', 'org.example.shout')), false);
  assert.throws(() => uninstallPlugin(data, 'org.example.shout', []), /isn't installed/);
  assert.equal(readFileSync(join(dir, 'src0', 'notes.txt'), 'utf8'), 'not packed');
});

test('packages reject a compressed multi-entry bomb before any inflation', () => {
  const bytes = zip(['plugin.json', 'main.js', 'README.md'].map((name) => ({ name, data: Buffer.alloc(8 * 1024 * 1024) })));
  assert.ok(bytes.length < 30_000);
  // An invalid first stream proves the total-size rejection happens before decompression.
  const firstPayload = 30 + 'plugin.json'.length;
  bytes.fill(0xff, firstPayload, firstPayload + 4);
  assert.throws(() => readPackage(bytes), /over 20971520 bytes unpacked/);
  const data = fresh();
  assert.throws(() => installPackage(data, bytes, { allowUnsigned: true }), /over 20971520 bytes unpacked/);
  assert.equal(existsSync(join(data, 'plugins')), false);
});

test('packages with more than 4096 entries, or an entry that unpacks to over 1000 times its size, are refused in plain words', () => {
  const many = zip(Array.from({ length: 4097 }, (_, i) => ({ name: `f${i}`, data: Buffer.from('x') })));
  assert.throws(() => readPackage(many), /not a plug-in package: the archive holds 4097 entries; more than 4096 are not read/);
  const bomb = zip([{ name: 'plugin.json', data: Buffer.from('{}') }, { name: 'main.js', data: Buffer.alloc(4 * 1024 * 1024) }]);
  assert.throws(() => readPackage(bomb), /not a plug-in package: main\.js unpacks to 4194304 bytes from \d+, more than 1000 times its size/);
});
