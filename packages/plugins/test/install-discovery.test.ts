import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginRegistry, loadPlugins, readPlugin, uninstallPlugin } from '../src/index.ts';
import { checkInstalled } from '../src/package.ts';

test('AR-cli-plugins-tooling-07', (t) => {
  const data = mkdtempSync(join(tmpdir(), 'tabularius-plugin-discovery-'));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const plugins = join(data, 'plugins');
  for (const name of ['.installing-org.example.review', '.replaced-org.example.review']) {
    const folder = join(plugins, name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'plugin.json'), JSON.stringify({ id: 'org.example.review', name: 'Review', version: '1.0.0', api: '^1.0', publisher: 'Example', main: 'main.js', functions: [{ name: 'Review_Call', min: 0 }] }));
    writeFileSync(join(folder, 'main.js'), 'const functions = { Review_Call: () => 1 };');
  }
  writeFileSync(join(plugins, 'enabled.json'), JSON.stringify({ Shop: ['org.example.review'] }));
  const registry = new PluginRegistry();
  const logs: string[] = [];
  loadPlugins(registry, data, (message) => logs.push(message));
  assert.deepEqual(registry.manifests(), []);
  assert.deepEqual(registry.plugins('Shop'), []);
  assert.ok(logs.some((message) => /installing|replaced/.test(message)));
  assert.throws(() => readPlugin(join(plugins, '.installing-org.example.review') + '/'), /internal plug-in folder/);
  assert.throws(() => checkInstalled(join(plugins, '.replaced-org.example.review') + '/'), /internal plug-in folder/);
  assert.throws(() => uninstallPlugin(data, 'org.example.review', []), /isn't installed/);
  assert.ok(existsSync(join(plugins, '.installing-org.example.review')));
});
