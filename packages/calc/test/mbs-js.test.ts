// Generated inputs only. Every call goes through the calculation/MBS registry.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { readdirSync, readFileSync } from 'node:fs';
import { MBS_JS_HANDLES_PER_SESSION } from '../src/mbs-js.ts';
import { evaluate, evaluateText, text, num, type CalcContext, type Value } from '../src/index.ts';
import { JavaScriptContext, stopJavaScript, JS_CONTEXT_LIMIT, JS_COOL_DOWN_MS, JS_MEMORY_MB, JS_RESULT_LIMIT, JS_TIME_LIMIT_MS } from '../src/javascript.ts';

afterEach(async () => { await stopJavaScript(); });

function session(scope: object = {}) {
  const ctx: CalcContext = { pluginSession: scope };
  const call = (name: string, ...args: (string | number | Value)[]) => {
    const values = args.map(v => typeof v === 'string' ? text(v) : typeof v === 'number' ? num(v) : v);
    return evaluate(`MBS ( "${name}"${values.map((_, i) => ` ; $a${i}`).join('')} )`, {
      ...ctx, variable: name => values[Number(name.slice(2))],
    });
  };
  const mbs = (name: string, ...args: (string | number | Value)[]) => String(call(name, ...args).value);
  const make = () => {
    const h = mbs('JS.New');
    assert.match(h, /^\d+$/, 'JS.New must create a handle before testing its sandbox');
    return h;
  };
  return { call, mbs, make, scope };
}
const error = (value: string) => assert.match(value, /^\[MBS\] ERROR:/);

test('defensive: infinite loop stops within the per-handle time cap', () => {
  const s = session(), h = s.make();
  const start = performance.now();
  error(s.mbs('JS.Evaluate', h, 'for (;;) {}'));
  assert.ok(performance.now() - start < JS_TIME_LIMIT_MS * 3);
  error(s.mbs('JS.Evaluate', h, '1')); // A timed-out realm must never resume.
  assert.match(s.mbs('JS.New'), /recently/);
  const other = session();
  assert.equal(other.mbs('JS.Evaluate', other.make(), '7'), '7');
});

test('defensive: memory bomb closes its handle and cools the session without losing other handles', t => {
  let monotonic = 0;
  t.mock.method(performance, 'now', () => monotonic);
  const s = session(), healthy = s.make(), bomb = s.make();
  assert.equal(s.mbs('JS.Evaluate', healthy, 'var saved = 42; saved'), '42');
  // One bounded allocation exceeds JS_MEMORY_MB; no unbounded allocation loop.
  error(s.mbs('JS.Evaluate', bomb, `globalThis.bomb = new Array(${JS_MEMORY_MB * 1024 * 1024 / 4}).fill(1); 1`));
  error(s.mbs('JS.Evaluate', bomb, '1'));
  assert.match(s.mbs('JS.New'), /recently/);
  assert.match(s.mbs('JS.Evaluate', healthy, 'saved'), /recently/);
  monotonic += JS_COOL_DOWN_MS;
  assert.equal(s.mbs('JS.Evaluate', healthy, 'saved'), '42');
});

test('defensive: prototype pollution stays inside its handle', () => {
  const s = session(), a = s.make(), b = s.make();
  assert.equal(s.mbs('JS.Evaluate', a, 'Object.prototype.mbsPolluted = 123; Array.prototype.mbsPolluted = 456; 1'), '1');
  assert.equal(({} as Record<string, unknown>).mbsPolluted, undefined);
  assert.equal(([] as unknown as Record<string, unknown>).mbsPolluted, undefined);
  assert.equal(s.mbs('JS.EvaluateToString', b, 'typeof ({}).mbsPolluted'), 'undefined');
  assert.equal(s.mbs('JS.SetGlobalProperty', b, 'input', '{"__proto__":{"mbsPolluted":7}}'), 'OK');
  assert.equal(s.mbs('JS.EvaluateToString', b, 'typeof ({}).mbsPolluted'), 'undefined');
  assert.equal(s.mbs('JS.Evaluate', a, 'JSON.stringify = () => "forged"; Array.prototype.toJSON = () => "forged"; "real"'), '"real"');
});

test('defensive: process, globalThis host members and constructor escapes are unavailable', () => {
  const s = session(), h = s.make();
  const names = ['process', 'require', 'module', 'Buffer', 'global', 'fetch', 'WebSocket', 'XMLHttpRequest',
    'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'tabularius', 'WebAssembly', 'FinalizationRegistry', 'WeakRef'];
  assert.equal(s.mbs('JS.EvaluateToString', h, `[${names.map(n => `typeof globalThis.${n}`).join(',')}].join(',')`),
    names.map(() => 'undefined').join(','));
  for (const source of ['process.env', 'globalThis.process.mainModule',
    'globalThis.constructor.constructor("return process")()', '({}).constructor.constructor("return process")()',
    'eval("1")', 'new Function("return process")()',
    'try { eval("1") } catch (e) { e.constructor.constructor("return process")() }']) {
    error(s.mbs('JS.Evaluate', h, source));
  }
});

test('defensive: deep recursion returns an MBS error without affecting the host', () => {
  const s = session();
  error(s.mbs('JS.Evaluate', s.make(), '(function recurse() { return recurse(); })()'));
  assert.equal(s.mbs('JS.Evaluate', s.make(), '6 * 7'), '42');
});

test('defensive: huge strings and oversized input are refused', () => {
  const s = session();
  error(s.mbs('JS.EvaluateToString', s.make(), `"x".repeat(${JS_RESULT_LIMIT + 1})`));
  error(s.mbs('JS.Evaluate', s.make(), `"x".repeat(${JS_RESULT_LIMIT})`)); // JSON quotes count too.
  const h = s.make();
  error(s.mbs('JS.SetGlobalPropertyValue', h, 'large', 'x'.repeat(JS_RESULT_LIMIT + 1)));
  error(s.mbs('JS.Evaluate', h, ' '.repeat(JS_RESULT_LIMIT + 1)));
  assert.equal(s.mbs('JS.EvaluateToString', h, `"x".repeat(${JS_RESULT_LIMIT})`).length, JS_RESULT_LIMIT);
});

test('defensive: Free and Release invalidate a handle, including a second Free', () => {
  const s = session(), h = s.make();
  assert.equal(s.mbs('JS.Evaluate', h, '1'), '1');
  assert.equal(s.mbs('JS.Free', h), 'OK');
  for (const [name, ...args] of [
    ['JS.Evaluate', '1'], ['JS.EvaluateToString', '1'], ['JS.GetGlobalProperty', 'x'],
    ['JS.GetGlobalPropertyValue', 'x'], ['JS.SetGlobalProperty', 'x', '1'],
    ['JS.SetGlobalPropertyValue', 'x', '1'], ['JS.Free'], ['JS.Release'],
  ]) error(s.mbs(name, h, ...args));
  const next = s.make();
  assert.notEqual(next, h);
  assert.equal(s.mbs('JS.Release', next), 'OK');
});

test('defensive: a handle from another script session is refused', () => {
  const a = session(), b = session(), h = a.make();
  assert.equal(a.mbs('JS.SetGlobalPropertyValue', h, 'secret', 'local'), 'OK');
  error(b.mbs('JS.Evaluate', h, 'secret'));
  error(b.mbs('JS.Free', h));
  assert.equal(a.mbs('JS.GetGlobalPropertyValue', h, 'secret'), 'local');
  assert.equal(session(a.scope).mbs('JS.GetGlobalPropertyValue', h, 'secret'), 'local');
});

test('defensive: handle count is capped per session and Free restores capacity', () => {
  const s = session(), handles: string[] = [];
  let refused = '';
  for (let i = 0; i < 20; i++) {
    const h = s.mbs('JS.New');
    if (h.startsWith('[MBS]')) { refused = h; break; }
    handles.push(h);
  }
  error(refused);
  assert.equal(handles.length, MBS_JS_HANDLES_PER_SESSION);
  assert.equal(s.mbs('JS.Free', handles[0]), 'OK');
  s.make();
  const other = session();
  assert.equal(other.mbs('JS.Evaluate', other.make(), '42'), '42');
});

test('defensive: imports, network and timers cannot outlive a call', async () => {
  let connections = 0;
  const server = createServer(socket => { connections++; socket.destroy(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const s = session(), h = s.make();
    for (const source of [
      `require('node:net').connect(${port}, '127.0.0.1')`,
      `import('node:net').then(n => n.connect(${port}, '127.0.0.1')); 1`,
      `fetch('http://127.0.0.1:${port}/')`,
      `setTimeout(() => { globalThis.late = 1; }, 0)`,
      `setInterval(() => { globalThis.late = 1; }, 0)`,
    ]) error(s.mbs('JS.Evaluate', h, source));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(connections, 0);
    assert.equal(s.mbs('JS.EvaluateToString', h, 'typeof globalThis.late'), 'undefined');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('defensive: external memory allocators cannot bypass the heap cap', () => {
  const s = session(), h = s.make();
  for (const name of ['ArrayBuffer', 'SharedArrayBuffer', 'Uint8Array', 'Float64Array', 'DataView', 'WebAssembly']) {
    error(s.mbs('JS.Evaluate', h, `new ${name}(1024)`));
  }
});

test('defensive: result conversion and property access run under the time cap', () => {
  const conversion = session();
  error(conversion.mbs('JS.EvaluateToString', conversion.make(), '({ toString() { for (;;) {} } })'));
  const s = session();
  const h = s.make();
  assert.equal(s.mbs('JS.Evaluate', h, 'Object.defineProperty(globalThis, "slow", {get() { for (;;) {} }}); 1'), '1');
  error(s.mbs('JS.GetGlobalProperty', h, 'slow'));
});

test('defensive: promise microtasks cannot escape the call deadline', () => {
  const runaway = session(), h = runaway.make();
  error(runaway.mbs('JS.Evaluate', h, 'Promise.resolve().then(() => { for (;;) {} }); 1'));
  error(runaway.mbs('JS.Evaluate', h, '1'));
  const s = session();
  const next = s.make();
  assert.equal(s.mbs('JS.Evaluate', next, 'globalThis.done = 0; Promise.resolve().then(() => { done = 1; }); 42'), '42');
  assert.equal(s.mbs('JS.Evaluate', next, 'done'), '1');
  error(s.mbs('JS.Evaluate', next, 'Promise.resolve(1)'));
});

test('defensive: a dead child never silently recreates a persistent context', async () => {
  const context = new JavaScriptContext();
  assert.deepEqual(context.call({ op: 'json', source: 'var saved = 42; saved' }), text('42'));
  const pid = context.processId!;
  assert.ok(pid > 0);
  process.kill(pid, 'SIGKILL'); // Only the child this test just created.
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.throws(() => context.call({ op: 'json', source: 'typeof saved' }), /context closed/);
  assert.equal(context.closed, true);
});

test('defensive: stopping the sandboxes invalidates existing MBS handles', async () => {
  const s = session(), h = s.make();
  assert.equal(s.mbs('JS.Evaluate', h, '42'), '42');
  await stopJavaScript();
  error(s.mbs('JS.Evaluate', h, '1'));
  assert.equal(s.mbs('JS.Evaluate', s.make(), '7'), '7');
});

test('MBS JS: documented JSON and string conversions and persistent declarations', () => {
  const s = session(), h = s.make();
  for (const [source, json, string] of [
    ['4+5', '9', '9'], ['"hello"', '"hello"', 'hello'], ['true', 'true', 'true'],
    ['null', 'null', 'null'], ['[1,2,3]', '[1,2,3]', '1,2,3'], ['({a:1})', '{"a":1}', '[object Object]'],
  ]) {
    assert.deepEqual(s.call('JS.Evaluate', h, source), text(json));
    assert.deepEqual(s.call('JS.EvaluateToString', h, source), text(string));
  }
  assert.equal(s.mbs('JS.Evaluate', h, 'let count = 1; function next() { return ++count; } next()'), '2');
  assert.equal(s.mbs('JS.Evaluate', h, 'next()'), '3');
  assert.equal(s.mbs('JS.EvaluateToString', h, 'undefined'), 'undefined');
  for (const source of ['undefined', '(function(){})', '1n', 'const cycle = {}; cycle.self = cycle; cycle']) {
    error(s.mbs('JS.Evaluate', h, source));
  }
  error(s.mbs('JS.GetGlobalProperty', h, 'missing'));
});

test('MBS JS: setters parse JSON or preserve FileMaker value types per the docs', () => {
  const s = session(), h = s.make();
  assert.equal(s.mbs('JS.SetGlobalProperty', h, 'items', '[1,2,3]'), 'OK');
  assert.deepEqual(s.call('JS.GetGlobalProperty', h, 'items'), text('[1,2,3]'));
  assert.deepEqual(s.call('JS.GetGlobalPropertyValue', h, 'items'), text('[1,2,3]'));
  assert.equal(s.mbs('JS.SetGlobalProperty', h, 'word', 'not JSON'), 'OK');
  assert.equal(s.mbs('JS.GetGlobalProperty', h, 'word'), '"not JSON"');
  assert.equal(s.mbs('JS.SetGlobalPropertyValue', h, 'word', '"text"'), 'OK');
  assert.deepEqual(s.call('JS.GetGlobalPropertyValue', h, 'word'), text('"text"'));
  assert.equal(s.mbs('JS.SetGlobalPropertyValue', h, 'amount', 12.5), 'OK');
  assert.deepEqual(s.call('JS.GetGlobalPropertyValue', h, 'amount'), num(12.5));
  assert.deepEqual(s.call('JS.GetGlobalProperty', h, 'amount'), text('12.5'));
  // Data is not executable source, even as property names or text values.
  assert.equal(s.mbs('JS.SetGlobalPropertyValue', h, 'x\"]; process.exit(); //', '"; throw 1; //'), 'OK');
  assert.equal(s.mbs('JS.GetGlobalPropertyValue', h, 'x\"]; process.exit(); //'), '"; throw 1; //');
  const date: Value = { type: 'date', value: 739901 };
  const expectedDate = evaluateText('$date', { variable: () => date });
  assert.equal(s.mbs('JS.SetGlobalPropertyValue', h, 'date', date), 'OK');
  assert.deepEqual(s.call('JS.GetGlobalPropertyValue', h, 'date'), text(expectedDate));
});

test('MBS JS: names, arity, unsupported aliases and IsError', () => {
  const s = session();
  assert.equal(s.mbs('JS.New', 'named'), 'named');
  assert.equal(s.mbs('js.evaluatetostring', 'named', '1'), '1');
  error(s.mbs('JS.New', 'named')); // Duplicate-name semantics are not documented.
  for (const name of ['JS.Free', 'JS.Evaluate', 'JS.EvaluateToString', 'JS.GetGlobalProperty',
    'JS.GetGlobalPropertyValue', 'JS.SetGlobalProperty', 'JS.SetGlobalPropertyValue', 'JS.SetVariable', 'JS.GetVariable']) {
    error(s.mbs(name));
  }
  assert.equal(evaluateText('Let ( x = MBS ( "JS.Evaluate" ; "missing" ; "1" ) ; MBS ( "IsError" ) )'), '1');
  assert.equal(evaluateText('Let ( [ h = MBS ( "JS.New" ) ; x = MBS ( "JS.Free" ; h ) ] ; MBS ( "IsError" ) )', { pluginSession: {} }), '0');
  error(s.mbs('JS.Evaluate', 'missing', '1'));
  assert.equal(s.mbs('IsError'), '1');
  assert.equal(session().mbs('IsError'), '0');
  assert.equal(s.mbs('JS.Evaluate', 'named', '42'), '42');
  assert.equal(s.mbs('IsError'), '0');
});

test('defensive: a calculation without a script session cannot create handles or fill the server-wide cap', () => {
  // Stored calculations, MCP evaluate_calculation and formula previews have no pluginSession: nothing would end
  // their handles, so JS.New there would leak until idle expiry and let any caller exhaust JS_CONTEXT_LIMIT.
  for (let i = 0; i < JS_CONTEXT_LIMIT + 1; i++) error(evaluateText('MBS ( "JS.New" )', {}));
  error(evaluateText('MBS ( "JS.New" ; "named" )', {}));
  error(evaluateText('MBS ( "JS.Evaluate" ; "1" ; "1" )', {}));
  const s = session();
  assert.equal(s.mbs('JS.Evaluate', s.make(), '6 * 7'), '42');
});

/** Every child of this process, running or exited but never waited for (Linux only; undefined elsewhere). */
function childProcesses(): string[] | undefined {
  if (process.platform !== 'linux') return undefined;
  const found: string[] = [];
  for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    try {
      const [, ppid] = readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /s, '').split(' ');
      if (Number(ppid) === process.pid) found.push(pid);
    } catch { /* the process went away while listing */ }
  }
  return found;
}

test('defensive: stopping a handle reaps its sandbox process instead of leaving a zombie until the server exits', { skip: process.platform !== 'linux' }, async () => {
  const before = childProcesses()!;
  const contexts = Array.from({ length: 5 }, () => new JavaScriptContext());
  for (const context of contexts) assert.deepEqual(context.call({ op: 'json', source: '1' }), text('1'));
  // Release, idle expiry, session end, timeouts and crashes all stop a handle this way; one process each, over the server's life.
  await Promise.all(contexts.map(context => context.close()));
  const hung = new JavaScriptContext();
  assert.throws(() => hung.call({ op: 'json', source: 'for (;;) {}' }), /longer than/);
  await stopJavaScript();
  // (A timed-out handle is stopped in the background, so give its thread a moment to kill the process and wait for it.
  // A process that is still dying is not yet a zombie, so wait until none of the new ones is left, running or not.)
  const left = () => childProcesses()!.filter(pid => !before.includes(pid));
  for (let i = 0; i < 100 && left().length; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(left(), []);
});
