import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/host.ts';
import { generateKey, packPlugin } from '../../plugins/src/package.ts';
import { installPackage } from '../../plugins/src/package.ts';
import { runScript } from '../../scripts/src/index.ts';
import { createStore, Store } from '../../store/src/index.ts';

// Install Plug-In File: off until the administrator turns it on, then only signed packages from a trusted publisher.
function plugin(root: string, id: string, version: string, key?: string): string {
  const dir = join(root, `src-${id}-${version}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ id, name: id, version, publisher: 'Acme', api: '^1.0', main: 'main.js', functions: [{ name: 'Acme_Hello', min: 0, max: 0 }], permissions: {} }));
  writeFileSync(join(dir, 'main.js'), 'const functions = { Acme_Hello: () => "hi" };');
  return Buffer.from(packPlugin(dir, key).bytes).toString('base64');
}

test('Install Plug-In File: off by default, then signed packages from trusted publishers only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-script-install-'));
  try {
    const data = join(root, 'data');
    mkdirSync(join(data, 'Documents'), { recursive: true });
    createStore(join(data, 'Install.sqlite'));
    const store = new Store(join(data, 'Install.sqlite'), 'Install');
    store.applyDesign([{ op: 'createScript', name: 'Install', text: 'Install Plug-In File [ "pkg.ohplugin" ]\nExit Script [ Get ( LastError ) ]' }]);
    const host = new Host(data);
    const run = async () => String((await runScript(store, 'Install', { ...host.scriptOptions(), account: 'Admin' })).result);
    const key = generateKey();
    const trusted = generateKey();
    const put = (b64: string) => writeFileSync(join(data, 'Documents', 'pkg.ohplugin'), Buffer.from(b64, 'base64'));

    // Off: error 3 and nothing installed.
    put(plugin(root, 'org.acme.hello', '1.0.0', trusted.privatePem));
    assert.equal(await run(), '3');
    assert.equal(existsSync(join(data, 'plugins', 'org.acme.hello')), false);

    host.config.setScriptPluginInstall(true);
    // On, but the publisher isn't trusted yet.
    assert.equal(await run(), '3');
    assert.equal(existsSync(join(data, 'plugins', 'org.acme.hello')), false);

    // Trusted by the administrator (installing another of its packages with --trust), then the script may install.
    installPackage(data, Buffer.from(plugin(root, 'org.acme.first', '1.0.0', trusted.privatePem), 'base64'), { trust: trusted.fingerprint });
    assert.equal(await run(), '0');
    assert.equal(existsSync(join(data, 'plugins', 'org.acme.hello', 'plugin.json')), true);

    // Unsigned, and signed by a stranger: refused.
    put(plugin(root, 'org.acme.unsigned', '1.0.0'));
    assert.equal(await run(), '3');
    put(plugin(root, 'org.acme.stranger', '1.0.0', key.privatePem));
    assert.equal(await run(), '3');
    assert.equal(existsSync(join(data, 'plugins', 'org.acme.stranger')), false);

    // Not turned on for any file by installing.
    assert.equal(existsSync(join(data, 'plugins', 'enabled.json')), false);

    // Each outcome is in the security log.
    const kinds = store.securityEvents({}).map((e) => e.kind);
    assert.ok(kinds.includes('plugin-installed'));
    assert.equal(kinds.filter((k) => k === 'plugin-install-refused').length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
