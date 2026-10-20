import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../../scripts/src/index.ts';
import { text, type Value } from '../../calc/src/index.ts';
import { parseManifest, PluginRegistry } from '../src/index.ts';

let dir: string;
let store: Store;
let id: number;
const reg = new PluginRegistry();

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-plugin-hosting-'));
  createStore(join(dir, 'P.sqlite'));
  store = new Store(join(dir, 'P.sqlite'), 'P');
  store.plugin = reg.lookup(store.name);
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] }]);
  store.applyDesign([{ op: 'createField', table: 'Items', name: 'Shout', kind: 'calculation', calculation: 'Ex_Upper ( Name )', options: { unstored: true } }] as never);
  id = store.create('Items', { Name: 'one' }).recordId;
  const r = parseManifest({ id: 'org.example.upper', name: 'Upper', version: '1.0.0', api: '^1.0', publisher: 'Example', main: 'main.js',
    functions: [{ name: 'Ex_Upper', min: 1, max: 1, pure: true }] });
  if (!r.ok) throw new Error(r.errors.join('; '));
  reg.install(r.manifest, { Ex_Upper: (a: Value[]) => text(String(a[0].value).toUpperCase()) });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

function script(t: string): Script {
  const steps = parseScriptText(t, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }));
  return { id: 9999, name: 'test', steps } as Script;
}

test('scripts and field calculations of a hosted file use the plug-ins enabled for it', async () => {
  const run = async () => (await runScript(store, script('Exit Script [ Text Result: Ex_Upper ( "hi" ) ]'), { layout: 'Items' })).result;
  const shout = () => store.get('Items', id).fieldData.Shout;
  assert.equal(await run(), '?');
  assert.equal(shout(), '?');
  reg.enable('P', 'org.example.upper');
  assert.equal(await run(), 'HI');
  assert.equal(shout(), 'ONE');
  reg.disable('P', 'org.example.upper');
  assert.equal(await run(), '?');
  assert.equal(shout(), '?');
});

test('a sandboxed plug-in with documents access writes files a script can read back, in the documents folder only', async () => {
  const { mkdirSync, writeFileSync, readFileSync, existsSync } = await import('node:fs');
  const { readPlugin } = await import('../src/index.ts');
  const { stopJavaScript } = await import('../../store/src/javascript.ts');
  const p = join(dir, 'logger');
  mkdirSync(p);
  writeFileSync(join(p, 'plugin.json'), JSON.stringify({ id: 'org.example.logger', name: 'Logger', version: '1.0.0', api: '^1.0', publisher: 'Example', main: 'main.js',
    permissions: { files: ['documents:read', 'documents:write'] }, functions: [{ name: 'Log_Line', min: 2, max: 2 }] }));
  writeFileSync(join(p, 'main.js'), 'const functions = { Log_Line: (path, line) => tabularius.files.write(path, line + "\\n", true) ? "ok" : "no" };');
  const { manifest, calls } = readPlugin(p);
  reg.install(manifest, calls);
  reg.enable('P', manifest.id);
  const docs = join(dir, 'Documents');
  mkdirSync(docs);
  const run = async (f: string) => (await runScript(store, script(`Exit Script [ Text Result: ${f} ]`), { layout: 'Items', documents: docs })).result;
  assert.equal(await run('Log_Line ( Get ( DocumentsPath ) & "log.txt" ; "a" ) & Log_Line ( "log.txt" ; "b" )'), 'okok');
  assert.equal(readFileSync(join(docs, 'log.txt'), 'utf8'), 'a\nb\n');
  // Outside the documents folder a path counts only by its name, as for file steps.
  assert.equal(await run('Log_Line ( "/etc/x.txt" ; "c" )'), 'ok');
  assert.equal(existsSync('/etc/x.txt'), false);
  assert.equal(await run('Log_Line ( Get ( TemporaryPath ) & "t.txt" ; "c" )'), '?');
  reg.disable('P', manifest.id);
  await stopJavaScript();
});
