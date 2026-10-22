import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { callJavaScript, callJavaScriptModule, JavaScriptContext, stopJavaScript } from '../src/javascript.ts';
import { num, text } from '../../calc/src/index.ts';
import { body, calls, grep, owner, parse, source } from '../../scripts/test/sandbox-support.ts';

after(async () => { await stopJavaScript(); });
let id = 0;
const custom = (code: string, timeout = 1000) => callJavaScript({ name: `Probe${++id}`, parameters: [], source: code }, [], timeout);
const plugin = (code: string, timeout = 1000) => callJavaScriptModule({ key: `probe-${++id}`, name: 'Probe', source: `const functions = { Probe() { ${code} } };` }, 'Probe', [], timeout);

test('both JS entry points expose no host objects, modules, network or scheduling APIs', () => {
  const names = ['process', 'require', 'module', 'Buffer', 'global', 'fetch', 'WebSocket', 'EventSource', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask'];
  for (const run of [custom, plugin]) {
    assert.deepEqual(run(`return [${names.map((n) => `typeof ${n}`).join(',')}].join(',')`), text(names.map(() => 'undefined').join(',')));
    assert.throws(() => run('return require("node:fs")'), /require is not defined/);
    assert.throws(() => run('import fs from "node:fs"; return fs'), /syntax error|import statement/);
    for (const code of ['return ({}).constructor.constructor("return process")()', 'return globalThis.constructor.constructor("return process")()',
      'return eval("1 + 1")', 'return new Function("return 1")()']) {
      assert.throws(() => run(code), /Code generation from strings disallowed/, code);
    }
    assert.throws(() => run('return Promise.resolve(42)'), /not a promise/);
    assert.deepEqual(run('return 6 * 7'), num(42), 'a refusal must leave the sandbox usable');
  }
  // Arguments and plug-in host shims are constructed inside the realm, not borrowed host objects.
  assert.throws(() => callJavaScript({ name: 'Argument', parameters: ['value'], source: 'return value.constructor.constructor("return process")()' }, [text('x')]), /Code generation/);
  assert.throws(() => plugin('return tabularius.files.read.constructor("return process")()'), /Code generation/);
});

test('dynamic imports are refused and timers cannot run after a plug-in call returns', async () => {
  const mod = { key: 'async-probe', name: 'Async probe', source: `
    let imported = 'pending', timers = 0;
    const functions = {
      Start() {
        import('node:fs').then(() => { imported = 'escaped'; }, e => { imported = String(e); });
        for (const name of ['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask']) {
          try { globalThis[name](() => timers++, 1); } catch {}
        }
        return 'started';
      },
      Read() { return JSON.stringify({ imported, timers }); }
    };` };
  assert.deepEqual(callJavaScriptModule(mod, 'Start', []), text('started'));
  await delay(100); // 100× the attempted timer delay; no short upper timing assertion.
  callJavaScriptModule(mod, 'Read', []); // drain any rejection microtasks in the realm
  const state = JSON.parse(String(callJavaScriptModule(mod, 'Read', []).value));
  assert.match(state.imported, /dynamic import|import callback/i);
  assert.equal(state.timers, 0);
  // Promise callbacks run under the call's budget, rather than escaping it after the answer.
  for (const run of [custom, plugin]) {
    const began = performance.now();
    assert.throws(() => run('Promise.resolve().then(() => { for (;;) {} }); return 1', 100), /longer than 100 ms/);
    assert.ok(performance.now() - began < 5000, '50× timeout headroom, including process startup');
    assert.deepEqual(run('return 42'), num(42));
  }
});

test('persistent JavaScript contexts share the restricted realm without host capabilities', async () => {
  const context = new JavaScriptContext();
  try {
    assert.deepEqual(context.call({ op: 'string', source: '[typeof process, typeof require, typeof fetch, typeof tabularius, typeof setTimeout].join(",")' }),
      text('undefined,undefined,undefined,undefined,undefined'));
    for (const source of ['({}).constructor.constructor("return process")()', 'eval("1 + 1")', 'new Function("return 1")()']) {
      assert.throws(() => context.call({ op: 'string', source }), /Code generation from strings disallowed|syntax error or threw/);
    }
    assert.throws(() => context.call({ op: 'string', source: 'import("node:fs")' }), /Modules are not available/);
    assert.deepEqual(context.call({ op: 'string', source: '6 * 7' }), text('42'));
  } finally {
    await context.close();
  }
});

test('source grep inventories JS execution entry points and requires realm, host and time guards', (t) => {
  const entries = grep('packages/calc/src', /export function callJavaScript(?:Module)?\(/g);
  t.diagnostic(JSON.stringify(entries));
  assert.deepEqual(entries.map((e) => e.match), ['export function callJavaScript(', 'export function callJavaScriptModule(']);
  // The sandbox moved from store to calc; the rest of calc/src (regex-guard.ts) is not part of this inventory.
  const execution = ['packages/calc/src', 'packages/store/src', 'packages/plugins/src'].flatMap((dir) =>
    grep(dir, /\b(?:createContext|compileFunction|runInContext|runInNewContext|runInThisContext)\s*\(/g)
      .filter((e) => dir !== 'packages/calc/src' || e.file === 'packages/calc/src/javascript.ts'));
  t.diagnostic(JSON.stringify(execution));
  assert.deepEqual(execution, [
    { file: 'packages/calc/src/javascript.ts', match: 'createContext(' },
    { file: 'packages/calc/src/javascript.ts', match: 'runInContext(' },
    // errors.ts runs the constant text 'gc' (never anything a person wrote) to reach the garbage collector for the memory guard.
    { file: 'packages/store/src/errors.ts', match: 'runInNewContext(' },
  ], 'new VM entry points need guard coverage');
  const src = source('packages/calc/src/javascript.ts');
  const host = parse(src);
  for (const name of ['callJavaScript', 'callJavaScriptModule']) assert.equal(calls(body(host, name), /^sandboxCall$/).length, 1, name);
  const child = parse(src.split('const CHILD = String.raw`')[1].split('\n`;')[0]);
  assert.deepEqual(calls(child, /^vm\./).map((c) => c.expression.getText()), ['vm.createContext', 'vm.runInContext'], 'new VM execution entry points need guard coverage');
  assert.deepEqual(calls(child, /^vm\.createContext$/).map(owner), ['newRealm']);
  assert.deepEqual(calls(child, /^newRealm$/).map(owner), ['moduleCall', 'contextCall', 'call']);
  assert.deepEqual(calls(child, /^vm\.runInContext$/).map(owner), ['run']);
  assert.deepEqual(calls(child, /^run$/).map(owner), ['moduleCall', 'moduleCall', 'contextCall', 'call']);
  assert.equal(calls(child, /^lockDownHost$/).length, 1);
  const realm = body(child, 'newRealm').getText();
  assert.match(realm, /DONT_CONTEXTIFY/);
  assert.match(realm, /strings: false, wasm: false/);
  assert.match(realm, /microtaskMode: 'afterEvaluate'/);
  assert.match(body(child, 'run').getText(), /timeout: req\.timeout/);
  const locked = body(child, 'lockDownHost').getText();
  assert.match(locked, /Module\._load = .*throw new Error\('Modules are not available here'\)/);
  assert.match(locked, /net\.Socket\.prototype\.connect = refuse/);
  assert.match(body(host, 'sandbox').getText(), /'--permission'/);
  assert.match(body(host, 'sandbox').getText(), /'--disallow-code-generation-from-strings'/);
});
