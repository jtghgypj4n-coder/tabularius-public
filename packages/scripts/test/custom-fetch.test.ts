import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import * as scripts from '../src/index.ts';
import { runScript, ScriptEngine, type RunOptions } from '../src/index.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../src/test-only.ts';

for (const context of [undefined, 'child-v8']) test(`production refuses custom fetch with NODE_TEST_CONTEXT ${context ?? 'unset'}`, () => {
  const env = { ...process.env };
  if (context === undefined) delete env.NODE_TEST_CONTEXT;
  else env.NODE_TEST_CONTEXT = context;
  // A real non-test process: outbound test mode is an operator feature, not permission to bypass guards.
  const output = execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
    import { mkdtempSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { createStore, Store } from '@tabularius/store';
    import { runScript, ScriptEngine } from '@tabularius/scripts';
    import { text } from '@tabularius/calc';
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-custom-fetch-'));
    createStore(join(dir, 'Local.sqlite'));
    const store = new Store(join(dir, 'Local.sqlite'), 'Local');
    let calls = 0;
    const custom = async () => { calls++; return new Response('unsafe'); };
    const results = [];
    const runners = [runScript, (store, script, opts) => new ScriptEngine(opts).run(store, script)];
    const options = [
      { network: custom },
      { outbound: { allowHosts: ['169.254.169.254'], fetch: custom, record() {} } },
    ];
    try {
      store.applyDesign([{ op: 'createScript', name: 'Request', text: 'Insert from URL [ $r ; "http://169.254.169.254/latest/meta-data/" ]' }]);
      for (const run of runners) for (const opts of options) {
        try { const result = await run(store, 'Request', opts); results.push({ error: result.error }); }
        catch (error) { results.push({ error: error.code, message: error.message }); }
      }
      store.applyDesign([{ op: 'createScript', name: 'Curl', text: [
        'Set Variable [ $h ; Value: MBS("CURL.New") ]',
        'Set Variable [ $u ; Value: MBS("CURL.SetOptionURL"; $h; "http://169.254.169.254/latest/meta-data/") ]',
        'Exit Script [ Result: MBS("CURL.Perform"; $h) ]',
      ].join('\\n') }]);
      for (const run of runners) {
        try { const result = await run(store, 'Curl', { network: custom }); results.push({ error: result.error }); }
        catch (error) { results.push({ error: error.code, message: error.message }); }
      }
      store.pluginsUseNetwork = () => true;
      store.plugin = (name) => name.toLowerCase() === 'test_request' ? { min: 0, max: 0, call(_args, env) {
        return text(env.ctx.network.fetch('Test_Request', { method: 'GET', url: 'http://169.254.169.254/', headers: {}, body: '', allows: () => true }).body);
      } } : undefined;
      store.applyDesign([{ op: 'createScript', name: 'Plugin', text: 'Exit Script [ Result: Test_Request ( ) ]' }]);
      for (const run of runners) {
        try { const result = await run(store, 'Plugin', { network: custom }); results.push({ error: result.error }); }
        catch (error) { results.push({ error: error.code, message: error.message }); }
      }
      const productionCalls = calls;
      const { TEST_ONLY_CUSTOM_FETCH } = await import('./packages/scripts/src/test-only.ts');
      const injected = await runScript(store, 'Request', { network: custom, [TEST_ONLY_CUSTOM_FETCH]: true });
      console.log(JSON.stringify({ productionCalls, results, injectedError: injected.error, injectedCalls: calls - productionCalls }));
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  `], { cwd: resolve(import.meta.dirname, '../../..'), env, encoding: 'utf8', timeout: 30000 });
  const { productionCalls, results, injectedError, injectedCalls } = JSON.parse(output);
  assert.equal(productionCalls, 0, 'a production callback must never see the metadata request');
  assert.equal(results.length, 8);
  for (const result of results) assert.equal(result.error, 3, JSON.stringify(result));
  assert.equal(injectedError, 0, 'explicit test injection works regardless of the environment');
  assert.equal(injectedCalls, 1);
});

test('explicit test injection is per run, survives server sub-scripts and still enforces outbound host checks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-custom-fetch-test-'));
  createStore(join(dir, 'Local.sqlite'));
  const store = new Store(join(dir, 'Local.sqlite'), 'Local');
  try {
    store.applyDesign([{ op: 'createScript', name: 'Request', text: 'Insert from URL [ $r ; "https://example.test/" ]\nExit Script [ Result: $r ]' }]);
    store.applyDesign([{ op: 'createScript', name: 'On server', text: 'Perform Script on Server [ "Request" ; Wait for completion: On ]\nExit Script [ Result: Get ( ScriptResult ) ]' }]);
    let calls = 0;
    const custom: typeof fetch = async () => { calls++; return new Response('mock result'); };
    const options: RunOptions[] = [
      { network: custom },
      { outbound: { allowHosts: ['example.test'], fetch: custom, record() {} } },
    ];
    for (const opts of options) {
      // beforeFile makes the constructor copy its options; server scripts copy them again.
      const injected: RunOptions = { ...opts, [TEST_ONLY_CUSTOM_FETCH]: true, beforeFile() {} };
      assert.equal((await new ScriptEngine(injected).run(store, 'Request')).result, 'mock result');
      assert.equal((await runScript(store, 'On server', injected)).result, 'mock result');
      assert.equal((await runScript(store, 'Request', opts)).error, 3, 'permission never leaks into another run');
    }
    assert.equal(calls, 4);
    const refused = await runScript(store, 'Request', { [TEST_ONLY_CUSTOM_FETCH]: true, outbound: { allowHosts: [], fetch: custom, record() {} } });
    assert.equal(refused.result, '');
    assert.equal(calls, 4, 'a test mock does not bypass the host allowlist');
    const forged: RunOptions = { network: custom, [Symbol('test-only custom fetch')]: true };
    assert.equal((await runScript(store, 'Request', forged)).error, 3, 'a matching symbol description grants no permission');
    assert.equal(calls, 4);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('production callers never opt into custom fetch and the package index does not export the capability', () => {
  assert.equal(Object.hasOwn(scripts, 'TEST_ONLY_CUSTOM_FETCH'), false);
  const root = resolve(import.meta.dirname, '../../..');
  const packages = join(root, 'packages');
  const roots = readdirSync(packages, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .map((entry) => join(packages, entry.name, 'src')).filter((dir) => existsSync(dir));
  roots.push(join(root, 'scripts'));
  const uses = roots.flatMap((dir) => readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(?:[cm]?[jt]s|tsx)$/.test(file))
    .map((file) => join(dir, file)))
    .filter((file) => /TEST_ONLY_CUSTOM_FETCH|test-only\.ts/.test(readFileSync(file, 'utf8')))
    .map((file) => relative(root, file)).sort();
  assert.deepEqual(uses, [join('packages', 'scripts', 'src', 'engine.ts'), join('packages', 'scripts', 'src', 'test-only.ts')]);
});
