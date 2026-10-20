// Custom functions written in JavaScript: called from calculations like FileMaker's own, run in a sandbox with no
// files, network or modules, a time limit, a memory limit and a cap on what they return.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, designSnippet, Store, callJavaScript, checkJavaScript, stopJavaScript, javaScriptProcess } from '../src/index.ts';
import { CalcError, num, text, type Value } from '../../calc/src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-js-functions-'));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  store = new Store(path, 'Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Made', type: 'date' }] },
    { op: 'createCustomFunction', name: 'Slug', parameters: ['s'], formula: 'return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");', language: 'javascript' },
    { op: 'createCustomFunction', name: 'YearOf', parameters: ['d'], formula: 'return Number(d.slice(0, 4));', language: 'javascript' },
    { op: 'createCustomFunction', name: 'Twice', parameters: ['x'], formula: 'x * 2' },
    { op: 'createField', table: 'Items', name: 'Key', kind: 'calculation', type: 'text', calculation: 'Slug ( Name ) & "/" & Twice ( 21 )' },
  ]);
});
after(async () => {
  await stopJavaScript();
  store?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const js = (source: string, args: Value[] = [], parameters: string[] = [], timeoutMs?: number) =>
  callJavaScript({ name: 'Fn', parameters, source }, args, timeoutMs);
const fails = (source: string, pattern: RegExp, timeoutMs?: number) =>
  assert.throws(() => js(source, [], [], timeoutMs), (e: unknown) => e instanceof CalcError && pattern.test(e.message));

test('a calculation calls a JavaScript function like any custom function, and FileMaker ones alongside it', () => {
  const id = store.create('Items', { Name: '  Blue Widget, Large! ', Made: '10/12/2026' }).recordId;
  assert.equal(store.get('Items', id).fieldData.Key, 'blue-widget-large/42');
  // Dates come in as ISO text.
  assert.equal(store.evaluate('Items', 'YearOf ( Made ) + 1', id).value, '2027');
});

test('what a function returns becomes a calculation value', () => {
  assert.deepEqual(js('return 2 + 3'), num(5));
  assert.deepEqual(js('return "hi"'), text('hi'));
  assert.deepEqual(js('return true'), num(1));
  assert.deepEqual(js('return null'), text(''));
  assert.deepEqual(js('return { a: [1, "x"] }'), text('{"a":[1,"x"]}'));
  assert.deepEqual(js('return a + b', [num(1), text('2')], ['a', 'b']), text('12'));
  fails('return 1 / 0', /returned Infinity/);
  fails('throw new Error("nope")', /nope/);
  fails('return Promise.resolve(1)', /not a promise/);
});

test('the sandbox has nothing of the server in it: no process, modules, network, eval or way back out', async () => {
  assert.deepEqual(js('return [typeof process, typeof require, typeof fetch, typeof module, typeof globalThis.Buffer, typeof setTimeout].join()'),
    text('undefined,undefined,undefined,undefined,undefined,undefined'));
  // The classic escape: reach the host's Function through a constructor chain.
  fails('return this.constructor.constructor("return process")()', /undefined/);
  fails('return ({}).constructor.constructor("return process")()', /Code generation from strings disallowed/);
  fails('return eval("1")', /Code generation from strings disallowed/);
  fails('return new Function("return 1")()', /Code generation from strings disallowed/);
  fails('return WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))', /not a promise|WebAssembly/);

  // Nothing a function does reaches the network, even to this machine.
  let connections = 0;
  const server: Server = createServer((s) => { connections++; s.destroy(); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  try {
    for (const source of [
      `import("node:net").then((n) => n.connect(${port}, "127.0.0.1"));`,
      `fetch("http://127.0.0.1:${port}/");`,
      `new WebSocket("ws://127.0.0.1:${port}/");`,
    ]) {
      try { js(source); } catch { /* refused either way */ }
    }
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(connections, 0);
  } finally {
    server.close();
  }
});

test('each call starts clean: one call\'s globals and prototypes are gone in the next', () => {
  assert.deepEqual(js('globalThis.secret = "a"; Array.prototype.leak = 1; return 1'), num(1));
  assert.deepEqual(js('return typeof globalThis.secret + "," + typeof [].leak'), text('undefined,undefined'));
});

test('a function that runs too long, uses too much memory or returns too much gives "?", and the next call still works', () => {
  fails('for (;;) {}', /longer than 200 ms/, 200);
  fails('return new Promise(() => { for (;;) {} })', /longer than 200 ms/, 200);
  fails('Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); return 1', /longer than 200 ms/, 200);
  // Something thrown whose message is itself an endless loop is still under the time limit.
  fails('throw { get message() { for (;;) {} } }', /longer than 200 ms/, 200);
  fails('const a = []; for (;;) a.push(new Array(1e6).fill(1));', /more than 64 MB/);
  fails('return "x".repeat(2e6)', /more than 1,000,000 characters/);
  assert.deepEqual(js('return 7'), num(7));
});

test('the result limit is on the value: exactly a million characters comes back, even ones JSON escapes', () => {
  assert.equal((js('return "x".repeat(1000000)') as { value: string }).value.length, 1_000_000);
  assert.equal((js('return "\\"".repeat(1000000)') as { value: string }).value.length, 1_000_000);
  assert.equal((js('return "\\u0001".repeat(1000000)') as { value: string }).value.length, 1_000_000);
  fails('return "x".repeat(1000001)', /more than 1,000,000 characters/);
});

test('a function that ran out of time isn\'t run again for a while, so a list of records calling it doesn\'t hold up the server', () => {
  const stuck = 'let n = 0; for (;;) n++;';
  fails(stuck, /longer than 200 ms/, 200);
  const began = Date.now();
  for (let i = 0; i < 20; i++) fails(stuck, /isn't run again yet/, 200);
  assert.ok(Date.now() - began < 2000, `20 calls took ${Date.now() - began} ms`);
  // Others still run.
  assert.deepEqual(js('return 8'), num(8));
});

test('stopping the sandbox stops its process too', async () => {
  js('return 1');
  const pid = javaScriptProcess()!;
  assert.ok(pid > 0);
  process.kill(pid, 0);
  await stopJavaScript();
  // Gone, or (its parent thread stopped before collecting it) a zombie that runs nothing.
  const running = () => {
    try { process.kill(pid, 0); } catch { return false; }
    try { return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return process.platform === 'linux'; }
  };
  for (let i = 0; i < 100 && running(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(running(), false);
  assert.deepEqual(js('return 9'), num(9));
});

test('a JavaScript function is checked when it is saved, and nothing in it runs then', () => {
  assert.match(checkJavaScript(['a'], 'return a +') ?? '', /syntax error/);
  assert.match(checkJavaScript(['class'], 'return 1') ?? '', /can't be a JavaScript parameter name/);
  assert.match(checkJavaScript(['a b'], 'return 1') ?? '', /can't be a JavaScript parameter name/);
  assert.match(checkJavaScript(['a', 'a'], 'return 1') ?? '', /its own name/);
  // Saving compiles without running: an endless loop saves at once.
  assert.equal(checkJavaScript([], 'for (;;) {}'), undefined);
  assert.throws(() => store.applyDesign([{ op: 'createCustomFunction', name: 'Broken', parameters: ['x'], formula: 'return x +', language: 'javascript' }]), /syntax error/);
  assert.throws(() => store.applyDesign([{ op: 'createCustomFunction', name: 'Odd', parameters: ['x'], formula: '1', language: 'python' as 'javascript' }]), /"calculation" or "javascript"/);

  // Switched back to a calculation, the same function runs as FileMaker's again.
  store.applyDesign([{ op: 'createCustomFunction', name: 'Both', parameters: ['x'], formula: 'return x * 3', language: 'javascript' }]);
  const id = store.create('Items', { Name: 'x' }).recordId;
  assert.equal(store.evaluate('Items', 'Both ( 2 )', id).value, '6');
  // A change of language without the new body is refused: the old body would be wrong in the new language.
  assert.throws(() => store.applyDesign([{ op: 'updateCustomFunction', customFunction: 'Both', language: 'calculation' }]), /needs its new formula/);
  assert.throws(() => store.applyDesign([{ op: 'updateCustomFunction', customFunction: 'Twice', language: 'javascript' }]), /needs its new formula/);
  store.applyDesign([{ op: 'updateCustomFunction', customFunction: 'Both', formula: 'x * 4', language: 'calculation' }]);
  assert.equal(store.evaluate('Items', 'Both ( 2 )', id).value, '8');
  assert.equal(store.schema.customFunctions.find((c) => c.name === 'Both')!.language, undefined);
});

test('FileMaker can\'t paste a JavaScript function, so copying one for FileMaker leaves it out and says so', () => {
  const ids = store.schema.customFunctions.filter((c) => c.name === 'Slug' || c.name === 'Twice').map((c) => c.id);
  const out = designSnippet(store.schema, { customFunctions: ids });
  assert.match(out.xml, /name="Twice"/);
  assert.doesNotMatch(out.xml, /Slug/);
  assert.ok(out.notes.some((n) => /Slug is written in JavaScript/.test(n)));
});
