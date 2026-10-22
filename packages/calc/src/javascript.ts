// Custom functions written in JavaScript, run in a locked-down sandbox.
//
// FileMaker's custom functions are written in its calculation language; these are written in JavaScript and are
// called from calculations the same way. Their code runs in a separate Node process started with the permission
// model on (no files, no child processes, no workers, no native add-ons), with the network modules and fetch taken
// away, no environment variables, a small heap, and code generation from strings turned off. Inside that process
// each custom-function call gets a fresh realm with nothing of the host in it, a time limit, and a cap on what it
// returns. MBS JS.* uses this transport with a separate process/realm per persistent handle and no host bridge.
//
// Calculations are synchronous and the sandbox is another process, so a call blocks on a worker thread that talks to
// the process: the worker puts the answer in shared memory and wakes the caller.

import { Worker } from 'node:worker_threads';
import { Script } from 'node:vm';
import { isSea } from 'node:sea';
import { CalcError, ERR, EMPTY, num, text, isoDate, isoTime, isoTimestamp, type Value } from './values.ts';
import type { CustomFunctionDef } from './evaluate.ts';
import type { CustomFunction } from '../../fmp12/src/index.ts';

/** How long one call may run, in milliseconds. */
export const JS_TIME_LIMIT_MS = 1000;
/** The sandbox process's heap, in megabytes: a function that allocates past it stops that process (it restarts). */
export const JS_MEMORY_MB = 64;
/** Fixed allowance for the Node runtime, young generation and response serialization. */
export const JS_MEMORY_HEADROOM_MB = 64;
/** Active keys keep their processes; only a full minute without a call releases a sandbox. */
export const JS_SANDBOX_IDLE_MS = 60_000;
/** The longest result a function may return, in characters. */
export const JS_RESULT_LIMIT = 1_000_000;

/** Parameter names a JavaScript function can bind: plain identifiers. */
export const JS_PARAMETER = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
const RESERVED = new Set(('break case catch class const continue debugger default delete do else enum export extends false finally for function if ' +
  'implements import in instanceof interface let new null package private protected public return static super switch this throw true try ' +
  'typeof var void while with yield await arguments eval undefined NaN Infinity').split(' '));

/** Why a JavaScript function's parameters or code can't be saved, or undefined when they can. */
export function checkJavaScript(parameters: string[], source: string): string | undefined {
  for (const p of parameters) {
    if (!JS_PARAMETER.test(p) || RESERVED.has(p)) return `"${p}" can't be a JavaScript parameter name: use one word of letters, digits and _`;
  }
  if (new Set(parameters).size !== parameters.length) return 'Each parameter needs its own name';
  try {
    // Compiling only checks the syntax: nothing runs here. The sandbox compiles it again in its own realm.
    new Script(`(function (${parameters.join(', ')}) {\n${source}\n})`);
  } catch (e) {
    if (e instanceof SyntaxError) return `JavaScript syntax error: ${e.message}`;
    throw e;
  }
  return undefined;
}

/** A calculation value as JavaScript sees it: text and dates as strings (ISO dates), numbers as numbers. */
export function toJavaScript(v: Value): string | number {
  switch (v.type) {
    case 'number': return v.value;
    case 'date': return isoDate(v.value);
    case 'time': return isoTime(v.value);
    case 'timestamp': return isoTimestamp(v.value);
    default: return v.value;
  }
}

/** What a function returned, as the sandbox reports it: [typeof, value]. */
type Out = ['number', number | string] | ['string', string] | ['boolean', boolean] | ['empty', null] | ['json', string];

function fromJavaScript(name: string, out: Out): Value {
  switch (out[0]) {
    case 'number':
      // NaN and Infinity have no FileMaker number: "?" as FileMaker shows for a division by zero.
      if (typeof out[1] !== 'number') throw new CalcError(ERR.calculation, `${name} returned ${out[1]}`);
      return num(out[1]);
    case 'string': return text(out[1]);
    case 'boolean': return num(out[1] ? 1 : 0);
    case 'empty': return EMPTY;
    case 'json': return text(out[1]);
  }
}

// ---------------------------------------------------------------- the sandbox process

// Executed inside a persistent realm before any guest code. Captured intrinsics and the private result slot
// cannot be replaced by a later call. Only put() is called outside vm's deadline: it just assigns a reference,
// never reads the guest value. All coercion, getters, setters and JSON hooks run inside the timed realm.
const CONTEXT_PRELUDE = String.raw`
const __tabulariusContext = (() => {
  const stringify = JSON.stringify, parse = JSON.parse, string = String;
  const set = Reflect.set, apply = Reflect.apply, hasInstance = Function.prototype[Symbol.hasInstance];
  const promise = Promise, finite = Number.isFinite, root = globalThis;
  let result;
  const fail = 'Tabularius sandbox: JavaScript result has no supported conversion';
  const envelope = s => '["string",' + stringify(s) + ']';
  const json = r => {
    if (r !== null && typeof r === 'object' && apply(hasInstance, promise, [r])) throw fail;
    const s = stringify(r);
    if (typeof s !== 'string') throw fail;
    return envelope(s);
  };
  // Backing stores are outside V8's heap cap. Refuse these APIs instead of letting a guest bypass the cap.
  // FinalizationRegistry callbacks are also excluded: they could run after the call's deadline.
  for (const name of ['ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array',
    'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float16Array',
    'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'WebAssembly', 'Atomics',
    'WeakRef', 'FinalizationRegistry', 'console']) delete root[name];
  return Object.freeze({
    put(r) { result = r; },
    convert(mode) {
      const r = result;
      result = undefined;
      if (mode === 'string') return envelope(string(r));
      return json(r);
    },
    get(name, raw) {
      const r = root[name];
      if (raw && typeof r === 'string') return envelope(r);
      if (raw && typeof r === 'number') {
        if (!finite(r)) throw fail;
        return '["number",' + stringify(r) + ']';
      }
      return json(r);
    },
    set(name, value, decode) {
      if (decode) { try { value = parse(value); } catch { /* MBS 11.3: invalid JSON is plain text. */ } }
      if (!set(root, name, value)) throw 'Tabularius sandbox: property cannot be set';
      return '["string","OK"]';
    }
  });
})();
__tabulariusContext.put;
`;

/** The sandbox process's program. It takes what it needs, then locks its own realm down before reading any code. */
const CHILD = String.raw`
'use strict';
const vm = require('node:vm');
const Module = require('node:module');
const { StringDecoder } = require('node:string_decoder');
const out = process.stdout;
const input = process.stdin;
const exit = process.exit.bind(process);
const LIMIT = Number(process.argv[process.argv.length - 1]);
const CONTEXT_PRELUDE = ${JSON.stringify(CONTEXT_PRELUDE)};
const MEMORY_MB = Number(process.argv[process.argv.length - 2]);
const MEMORY_LIMIT = (MEMORY_MB + ${JS_MEMORY_HEADROOM_MB}) * 1024 * 1024;
const memoryUsage = process.memoryUsage.bind(process);
function checkMemory() {
  const usage = memoryUsage();
  if (usage.rss > MEMORY_LIMIT || usage.arrayBuffers > MEMORY_LIMIT) exit(3);
}
// This catches retained allocations between calls. Synchronous code blocks this timer;
// the parent worker also samples RSS while a call is running.
setInterval(checkMemory, 50).unref();
const MEMORY = MEMORY_MB * 1024 * 1024;
// WebAssembly stays out of every JavaScript realm; only wasm plug-ins (wasmCall, below) use this one, with no imports.
const WASM = globalThis.WebAssembly;
require('node:v8').setFlagsFromString('--wasm-max-mem-pages=' + (MEMORY_MB * 16));

// Nothing reachable from here makes a connection or loads a module (the permission model already stops files,
// processes, workers and add-ons; it doesn't stop sockets).
function lockDownHost() {
  for (const k of ['fetch', 'WebSocket', 'EventSource', 'Request', 'Response', 'Headers', 'FormData', 'navigator', 'WebAssembly']) {
    try { delete globalThis[k]; } catch {}
  }
  // A promise a function left rejected must not end the process.
  process.on('unhandledRejection', () => {});
  process.on('uncaughtException', () => {});
  // Should code ever get from a function's realm into this one, the network modules (which import() would still hand
  // over: it doesn't go through Module._load) refuse to connect, listen or look up names.
  {
    const refuse = () => { throw new Error('The network is not available here'); };
    const net = require('node:net');
    const tls = require('node:tls');
    const dgram = require('node:dgram');
    const dns = require('node:dns');
    const http2 = require('node:http2');
    net.Socket.prototype.connect = refuse;
    net.Server.prototype.listen = refuse;
    net.connect = net.createConnection = refuse;
    tls.connect = refuse;
    dgram.createSocket = refuse;
    dgram.Socket.prototype.bind = dgram.Socket.prototype.send = dgram.Socket.prototype.connect = refuse;
    http2.connect = refuse;
    for (const o of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
      for (const k of Object.getOwnPropertyNames(o)) if (typeof o[k] === 'function' && k !== 'constructor') o[k] = refuse;
    }
  }
  Module._load = () => { throw new Error('Modules are not available here'); };
  try { process.getBuiltinModule = undefined; } catch {}
  try { process.binding = undefined; process._linkedBinding = undefined; process.dlopen = undefined; } catch {}
}
lockDownHost();

const PRELUDE = '"use strict"; const __tabulariusStringify = JSON.stringify; const __tabulariusOut = (r) => { ' +
  'if (r === undefined || r === null) return __tabulariusStringify(["empty", null]); ' +
  'switch (typeof r) { ' +
  'case "number": return __tabulariusStringify(["number", Number.isFinite(r) ? r : String(r)]); ' +
  'case "string": return __tabulariusStringify(["string", r]); ' +
  'case "boolean": return __tabulariusStringify(["boolean", r]); ' +
  'case "bigint": return __tabulariusStringify(["string", String(r)]); ' +
  'case "object": { if (r instanceof Promise) throw new Error("A JavaScript function returns its answer, not a promise");  const j = __tabulariusStringify(r); return __tabulariusStringify(j === undefined ? ["empty", null] : ["json", j]); } ' +
  'default: return __tabulariusStringify(["empty", null]); } };\n';

function newRealm() {
  return vm.createContext(vm.constants.DONT_CONTEXTIFY, { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
}

// Plug-ins: each one's code is loaded once into a realm of its own, kept for its later calls (so it can keep state
// between them, as a FileMaker plug-in can). A realm a call ran out of time in is dropped, and the oldest go first.
const modules = new Map();
const MODULES = 50;

function run(code, context, req) {
  const began = performance.now();
  try {
    return { r: vm.runInContext(code, context, { timeout: req.timeout, filename: req.name, breakOnSigint: false }) };
  } catch (e) {
    // The time limit, a syntax error, or something thrown that couldn't be turned into text. What was thrown may be
    // the function's own object, so it isn't looked at here (outside the time limit): only how long the call took.
    // (The time limit's own clock can end it a little before this one counts the full time.)
    if (performance.now() - began >= req.timeout * 0.9 - 5) return { res: { error: 'timeout' } };
    return { res: { error: 'threw', message: 'The function has a syntax error or threw something that is not an error' } };
  }
}

// A plug-in realm's host object. What it asks the host for (a file read, say) is answered from the answers the
// call brought; a question without an answer is noted and the call ends, the host answers it, and the call runs
// again with it, until every question it asks has its answer.
const HOST = '"use strict"; let __tabulariusAnswers = {}; let __tabulariusAsked = []; const __tabulariusNeed = {}; ' +
  'const __tabulariusHas = Object.prototype.hasOwnProperty; ' +
  'const __tabulariusAsk = (...q) => { const k = __tabulariusStringify(q); if (__tabulariusHas.call(__tabulariusAnswers, k)) return __tabulariusAnswers[k]; __tabulariusAsked.push(k); throw __tabulariusNeed; }; ' +
  'const tabularius = Object.freeze({ files: Object.freeze({ ' +
  'read: (path) => __tabulariusAsk("read", String(path)), ' +
  'readBase64: (path) => __tabulariusAsk("readBase64", String(path)), ' +
  'write: (path, text, append) => __tabulariusAsk("write", String(path), String(text), !!append), ' +
  'size: (path) => __tabulariusAsk("size", String(path)) }), ' +
  'http: Object.freeze({ request: (r) => __tabulariusAsk("request", String(r?.method ?? "GET").toUpperCase(), String(r?.url ?? ""), r?.body === undefined ? "" : String(r.body), ' +
  'Object.fromEntries(Object.entries(r?.headers ?? {}).map(([k, v]) => [String(k).toLowerCase(), String(v)]))) }), ' +
  'mail: Object.freeze({ send: (m) => __tabulariusAsk("mail", { from: String(m?.from ?? ""), to: String(m?.to ?? ""), cc: String(m?.cc ?? ""), ' +
  'bcc: String(m?.bcc ?? ""), subject: String(m?.subject ?? ""), body: String(m?.body ?? ""), ' +
  'attachments: Array.isArray(m?.attachments) ? m.attachments.map(String) : [] }) }), ' +
  'secrets: Object.freeze({ get: (name) => __tabulariusAsk("secret", String(name)) }) });\n' +
  // Plug-ins written when the product was called openhbam use that name.
  'const openhbam = tabularius;\n';

// WebAssembly plug-ins: instantiated once with no imports (so nothing but memory and arithmetic), kept for later calls.
// ABI: exports memory, alloc ( length ) -> pointer, and each function ( pointer, length ) -> i64 that is
// pointer * 2^32 + length of its answer: the arguments go in as a JSON array of text and numbers, the answer comes out as JSON.
const instances = new Map();
function wasmCall(req) {
  let inst = instances.get(req.module);
  if (inst) {
    instances.delete(req.module);
  } else if (req.source === undefined) {
    return { error: 'unloaded' };
  } else {
    try {
      const mod = new WASM.Module(Buffer.from(req.source, 'base64'));
      if (WASM.Module.imports(mod).length) return { error: 'threw', message: 'The plug-in\'s WebAssembly imports something; it may not' };
      inst = new WASM.Instance(mod, {}).exports;
    } catch (e) {
      return { error: 'threw', message: 'The plug-in\'s WebAssembly could not be loaded' };
    }
    if (!(inst.memory instanceof WASM.Memory) || typeof inst.alloc !== 'function') return { error: 'threw', message: 'The plug-in\'s WebAssembly needs to export memory and alloc' };
    if (instances.size >= MODULES) instances.delete(instances.keys().next().value);
  }
  try {
    if (typeof inst[req.fn] !== 'function') return { error: 'threw', message: 'the plug-in has no ' + req.fn };
    const input = Buffer.from(JSON.stringify(req.args));
    const at = inst.alloc(input.length) >>> 0;
    if (at + input.length > inst.memory.buffer.byteLength) return { error: 'threw', message: 'alloc gave a pointer outside memory' };
    new Uint8Array(inst.memory.buffer, at, input.length).set(input);
    const packed = BigInt.asUintN(64, BigInt(inst[req.fn](at, input.length)));
    const ptr = Number(packed >> 32n);
    const len = Number(packed & 0xffffffffn);
    if (ptr + len > inst.memory.buffer.byteLength || len > LIMIT * 6) return { error: 'threw', message: 'The answer is outside the plug-in\'s memory' };
    const text = Buffer.from(inst.memory.buffer, ptr, len).toString('utf8');
    instances.set(req.module, inst);
    return finish(JSON.stringify(wasmOut(JSON.parse(text))));
  } catch (e) {
    return { error: 'threw', message: 'The plug-in\'s WebAssembly trapped or answered something that is not JSON' };
  }
}
function wasmOut(r) {
  if (r === null || r === undefined) return ['empty', null];
  if (typeof r === 'number') return ['number', r];
  if (typeof r === 'string') return ['string', r];
  if (typeof r === 'boolean') return ['boolean', r];
  return ['json', JSON.stringify(r)];
}

function moduleCall(req) {
  if (req.wasm) return wasmCall(req);
  let context = modules.get(req.module);
  if (context) {
    modules.delete(req.module);
  } else if (req.source === undefined) {
    // Sent without its code, to save sending it on every call: ask for it.
    return { error: 'unloaded' };
  } else {
    context = newRealm();
    const loaded = run(PRELUDE + HOST + req.source + '\n;"loaded"', context, req);
    if (loaded.res) return loaded.res.error === 'timeout' ? loaded.res : { error: 'threw', message: 'The plug-in\'s code has a syntax error or threw while loading' };
    if (modules.size >= MODULES) modules.delete(modules.keys().next().value);
  }
  const fn = 'functions[' + JSON.stringify(req.fn) + ']';
  const fail = '__tabulariusStringify(["error", String(e !== null && typeof e === "object" && "message" in e ? e.message : e)])';
  const need = 'if (__tabulariusAsked.length) return __tabulariusStringify(["need", __tabulariusAsked]); ';
  const code = '__tabulariusAnswers = ' + JSON.stringify(req.answers ?? {}) + '; __tabulariusAsked = []; (() => { let r; ' +
    'try { if (typeof functions !== "object" || functions === null || typeof ' + fn + ' !== "function") ' +
    'return __tabulariusStringify(["error", ' + JSON.stringify('the plug-in has no ' + req.fn + ' in functions') + ']); ' +
    'r = ' + fn + '.apply(undefined, ' + JSON.stringify(req.args) + '); } catch (e) { ' + need + 'return ' + fail + '; } ' +
    need + 'try { return __tabulariusOut(r); } catch (e) { return ' + fail + '; } })()';
  const { r, res } = run(code, context, req);
  if (res) return res;
  modules.set(req.module, context);
  return finish(r);
}

// A JS.* handle has a dedicated child process and exactly one realm. It is never loaded into the plug-in
// module cache (which has host APIs and can evict/reload modules). A stopped handle is never restarted.
let persistent;
let putResult;
function contextCall(req) {
  const deadline = performance.now() + req.timeout;
  const timed = code => {
    const remaining = Math.floor(deadline - performance.now());
    return remaining <= 0 ? { res: { error: 'timeout' } } : run(code, persistent, { ...req, timeout: remaining });
  };
  if (!persistent) {
    persistent = newRealm();
    const loaded = timed(CONTEXT_PRELUDE);
    if (loaded.res) return loaded.res;
    putResult = loaded.r;
  }
  let code;
  if (req.op === 'json' || req.op === 'string') {
    // No import callback is installed. Also reject the import keyword before compilation: Node's missing
    // loader error can otherwise enter the realm through a rejected import promise. Conservatively includes
    // occurrences in comments/strings; modules are outside this sandbox's supported subset.
    if (/\bimport\b/.test(req.source)) return { error: 'threw', message: 'Modules are not available here' };
    const evaluated = timed(req.source);
    if (evaluated.res) return evaluated.res;
    putResult(evaluated.r);
    code = '__tabulariusContext.convert(' + JSON.stringify(req.op) + ')';
  } else if (req.op === 'get' || req.op === 'getValue') {
    code = '__tabulariusContext.get(' + JSON.stringify(req.property) + ',' + (req.op === 'getValue') + ')';
  } else if (req.op === 'set' || req.op === 'setValue') {
    code = '__tabulariusContext.set(' + JSON.stringify(req.property) + ',' + JSON.stringify(req.value) + ',' + (req.op === 'set') + ')';
  } else return { error: 'threw', message: 'Unknown context operation' };
  const result = timed(code);
  // A single allocation can cross the old-space limit before V8 next collects. Retire that handle too.
  const used = memoryUsage();
  if (used.heapUsed + used.external > MEMORY) return { error: 'crashed' };
  return result.res ?? finish(result.r);
}

function call(req) {
  if (req.context) return contextCall(req);
  if (req.module) return moduleCall(req);
  // A new realm for every call, made without any object of this one in it, so nothing leads back here and nothing
  // one call leaves behind is seen by the next.
  const context = newRealm();
  // What the function throws is turned into text inside its realm, under the time limit.
  const code = PRELUDE + 'try { __tabulariusOut((function (' + req.parameters.join(', ') + ') {\n' + req.source + '\n}).apply(undefined, ' +
    JSON.stringify(req.args) + ')); } catch (e) { __tabulariusStringify(["error", String(e !== null && typeof e === "object" && "message" in e ? e.message : e)]); }';
  const { r, res } = run(code, context, req);
  return res ?? finish(r);
}

function finish(r) {
  if (typeof r !== 'string') return { error: 'threw', message: 'The function returned nothing usable' };
  // (JSON escaping can make the envelope up to six times the value: the limit is on the value.)
  if (r.length > LIMIT * 6 + 64) return { error: 'big' };
  try {
    const o = JSON.parse(r);
    if (!Array.isArray(o) || typeof o[0] !== 'string') throw new Error();
    if (typeof o[1] === 'string' && o[1].length > LIMIT) return { error: 'big' };
    if (o[0] === 'error') return { error: 'threw', message: String(o[1]).slice(0, 500) };
    // A plug-in asking the host for something (only plug-in realms can): the questions, as text.
    if (o[0] === 'need') return Array.isArray(o[1]) && o[1].length && o[1].every((k) => typeof k === 'string') ? { need: o[1].slice(0, 20) } : { error: 'threw', message: 'The function returned nothing usable' };
    return { out: o };
  } catch {
    return { error: 'threw', message: 'The function returned nothing usable' };
  }
}

const decoder = new StringDecoder('utf8');
let pending = '';
input.on('data', (chunk) => {
  pending += decoder.write(chunk);
  let at;
  while ((at = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, at);
    pending = pending.slice(at + 1);
    let req;
    try { req = JSON.parse(line); } catch { exit(2); }
    checkMemory();
    const res = call(req);
    // Check before publishing even a successful answer, including zero-filled buffers
    // whose backing storage may not yet contribute to resident memory.
    checkMemory();
    res.id = req.id;
    out.write(JSON.stringify(res) + '\n');
  }
});
input.on('end', () => exit(0));
`;

/** The worker thread that owns the sandbox process and answers through shared memory. */
const WORKER = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { spawn, execFile } = require('node:child_process');
const { readFile } = require('node:fs');
const { state, bytes, execPath, args, sea, child: CHILD, grace, limit, headroom } = workerData;
let proc;
let started = false;
let memoryMb;
let current;
let buffered = '';
let timer;
let memoryTimer;

function answer(res) {
  if (!current || res.id !== current.id) return;
  clearTimeout(timer);
  clearInterval(memoryTimer);
  const body = Buffer.from(JSON.stringify(res));
  const fits = body.length <= bytes.length;
  const data = fits ? body : Buffer.from(JSON.stringify({ id: res.id, error: 'big' }));
  data.copy(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length));
  Atomics.store(state, 1, data.length);
  Atomics.store(state, 2, res.id);
  Atomics.store(state, 0, 1);
  Atomics.notify(state, 0);
  current = undefined;
}

function watchMemory(req) {
  const mine = proc;
  let sampling = false;
  memoryTimer = setInterval(() => {
    if (sampling || proc !== mine || current?.id !== req.id) return;
    sampling = true;
    const sampled = (rss) => {
      sampling = false;
      if (proc !== mine || current?.id !== req.id || rss <= (memoryMb + headroom) * 1024 * 1024) return;
      proc = undefined;
      mine.kill('SIGKILL');
      Atomics.store(state, 3, 0);
      answer({ id: req.id, error: 'memory' });
    };
    // No shell and no sandbox-supplied arguments. Sampling happens in this worker,
    // so an infinite loop or a blocked event loop in the child cannot prevent it.
    try {
      if (process.platform === 'linux') {
        readFile('/proc/' + mine.pid + '/status', 'utf8', (err, data) => {
          sampled(err ? 0 : Number(/^VmRSS:\s+(\d+)/m.exec(data)?.[1] ?? 0) * 1024);
        });
      } else if (process.platform === 'win32') {
        execFile('tasklist.exe', ['/FI', 'PID eq ' + mine.pid, '/FO', 'CSV', '/NH'], { timeout: 1000, windowsHide: true }, (err, data) => {
          sampled(err ? 0 : Number((data.trim().split('","')[4] ?? '').replace(/\D/g, '')) * 1024);
        });
      } else {
        execFile('/bin/ps', ['-o', 'rss=', '-p', String(mine.pid)], { timeout: 1000 }, (err, data) => {
          sampled(err ? 0 : (Number(data.trim()) || 0) * 1024);
        });
      }
    } catch {
      // Some service sandboxes forbid process inspection, including synchronous spawn
      // refusal. Keep the child's checks and deadline instead of crashing its worker.
      sampled(0);
    }
  }, 50);
}

function start(budget) {
  started = true;
  memoryMb = budget;
  const flags = [...args, '--max-old-space-size=' + memoryMb];
  // The release executable reads Node's flags from NODE_OPTIONS only, and runs the program after its own flag.
  proc = sea
    ? spawn(execPath, ['--tabularius-js-sandbox', CHILD, String(memoryMb), String(limit)], { stdio: ['pipe', 'pipe', 'ignore'], env: { NODE_OPTIONS: flags.join(' ') }, windowsHide: true })
    : spawn(execPath, [...flags, '-e', CHILD, String(memoryMb), String(limit)], { stdio: ['pipe', 'pipe', 'ignore'], env: {}, windowsHide: true });
  // The caller can stop the process itself if this thread ever stops answering.
  Atomics.store(state, 3, proc.pid ?? 0);
  const mine = proc;
  buffered = '';
  mine.stdout.setEncoding('utf8');
  mine.stdout.on('data', (s) => {
    if (mine !== proc) return;
    buffered += s;
    let at;
    while ((at = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, at);
      buffered = buffered.slice(at + 1);
      try { answer(JSON.parse(line)); } catch {}
    }
  });
  mine.stdin.on('error', () => {});
  mine.on('exit', (code, signal) => {
    if (mine !== proc) return;
    proc = undefined;
    Atomics.store(state, 3, 0);
    // Ran out of memory (or was stopped): the call it was on fails, and the next one starts a new process.
    if (current) answer({ id: current.id, error: 'crashed', message: signal ? 'stopped (' + signal + ')' : 'exited (' + code + ')' });
  });
}

parentPort.on('message', (req) => {
  if (req.stop) {
    // Stopped from outside (its process may already have been killed): end this thread only once the process has
    // exited and been reaped here. A thread that is terminated first leaves the process a zombie for as long as the
    // server runs, one per handle, because nothing else waits for it.
    clearTimeout(timer);
    const p = proc;
    proc = undefined;
    if (p && p.exitCode === null && p.signalCode === null) { p.once('exit', () => process.exit(0)); p.kill('SIGKILL'); } else process.exit(0);
    return;
  }
  current = { id: req.id };
  // Custom functions may restart after a crash. A persistent handle must fail, never lose its saved state
  // silently by starting a fresh context (including a child that died between requests).
  if (!proc && started && req.context) { answer({ id: req.id, error: 'crashed' }); return; }
  // This worker serves one module and one fixed budget for its lifetime.
  if (!proc) start(req.memoryMb);
  watchMemory(req);
  clearTimeout(timer);
  // A call the sandbox doesn't answer in time (its own time limit failed, or it is stuck collecting garbage) stops it.
  timer = setTimeout(() => {
    const p = proc;
    proc = undefined;
    Atomics.store(state, 3, 0);
    p?.kill('SIGKILL');
    Atomics.store(state, 3, 0);
    answer({ id: req.id, error: 'timeout' });
  }, req.timeout + grace);
  proc.stdin.write(JSON.stringify(req) + '\n');
});
`;

const GRACE_MS = 2000;
/** Allowance for starting the worker and the sandbox process on a first call. */
const START_MS = 3000;
/**
 * After a function runs out of time or memory, calls to it give "?" at once for this long, without running it:
 * calculations wait for it, so a list of 100 records calling a function stuck in a loop would otherwise hold up
 * everyone on this server process for 100 seconds.
 */
export const JS_COOL_DOWN_MS = 30_000;
const cooling = new Map<string, number>();
const coolKey = (fn: JavaScriptFunction) => `${fn.name}\0${fn.parameters.join(',')}\0${fn.source}`;
// A value at the limit, every character escaped (\\u0000) in the answer's JSON.
const SLOT_BYTES = JS_RESULT_LIMIT * 6 + 1024;

interface SandboxReply { error?: string; message?: string; out?: Out; need?: string[] }

interface Sandbox {
  worker: Worker;
  state: Int32Array;
  bytes: Uint8Array;
  lastUsed: number;
}
// Reclaim idle processes, never evict an active key merely to serve another key.
// A fixed-size LRU churns on every call when a record rotates over more keys than slots.
const sandboxes = new Map<string, Sandbox>();
const reapIdle = () => {
  const cutoff = Date.now() - JS_SANDBOX_IDLE_MS;
  for (const slot of sandboxes.values()) if (slot.lastUsed <= cutoff) void stopSandbox(slot);
};
setInterval(reapIdle, JS_SANDBOX_IDLE_MS).unref();
let lastSandbox: Sandbox | undefined;
let nextId = 1;

function stopSandbox(slot: Sandbox): Promise<number> {
  for (const [key, value] of sandboxes) if (value === slot) sandboxes.delete(key);
  if (lastSandbox === slot) lastSandbox = undefined;
  // Stopping a worker thread doesn't stop the process it started.
  const pid = Atomics.exchange(slot.state, 3, 0);
  if (pid) try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  return slot.worker.terminate();
}

function sandbox(key: string): Sandbox {
  reapIdle();
  let slot = sandboxes.get(key);
  if (slot) {
    slot.lastUsed = Date.now();
    lastSandbox = slot;
    return slot;
  }
  const shared = new SharedArrayBuffer(16 + SLOT_BYTES);
  const state = new Int32Array(shared, 0, 4);
  const bytes = new Uint8Array(shared, 16);
  const args = ['--permission', '--disallow-code-generation-from-strings', '--no-warnings'];
  const worker = new Worker(WORKER, { eval: true, workerData: { state, bytes, execPath: process.execPath, args, sea: isSea(), child: CHILD, grace: GRACE_MS, limit: JS_RESULT_LIMIT, headroom: JS_MEMORY_HEADROOM_MB }, env: {} });
  slot = { worker, state, bytes, lastUsed: Date.now() };
  sandboxes.set(key, slot);
  lastSandbox = slot;
  worker.unref();
  const mine = slot;
  const cleanup = () => { if (sandboxes.get(key) === mine) void stopSandbox(mine); };
  worker.on('error', cleanup);
  worker.on('exit', cleanup);
  return slot;
}

/** One isolated process for a persistent JS.* handle. It is never restarted: a handle that loses its process stays invalid. */
class ContextSandbox {
  private worker?: Worker;
  private started = false;
  private state = new Int32Array(new SharedArrayBuffer(16));
  private bytes?: Uint8Array;
  private nextId = 1;

  get pid(): number | undefined { return this.worker ? Atomics.load(this.state, 3) || undefined : undefined; }

  request(req: Record<string, unknown>, timeoutMs: number): SandboxReply {
    if (!this.worker) {
      if (this.started) return { error: 'crashed' };
      this.started = true;
      const state = this.state;
      const bytes = this.bytes = new Uint8Array(new SharedArrayBuffer(SLOT_BYTES));
      const args = ['--permission', '--max-semi-space-size=2', '--disallow-code-generation-from-strings', '--no-warnings'];
      const w = this.worker = new Worker(WORKER, { eval: true, workerData: { state, bytes, execPath: process.execPath, args, sea: isSea(), child: CHILD, grace: GRACE_MS, limit: JS_RESULT_LIMIT, headroom: JS_MEMORY_HEADROOM_MB }, env: {} });
      w.unref();
      const stopped = () => { if (this.worker === w) void this.stop(); };
      w.on('error', stopped);
      w.on('exit', stopped);
    }
    const id = this.nextId = this.nextId >= 0x7fffffff ? 1 : this.nextId + 1;
    const state = this.state;
    Atomics.store(state, 0, 0);
    this.worker.postMessage({ ...req, id, timeout: timeoutMs, memoryMb: JS_MEMORY_MB });
    // This outer deadline also covers startup, compilation and a child stuck in garbage collection.
    if (Atomics.wait(state, 0, 0, timeoutMs + GRACE_MS + START_MS) === 'timed-out' || Atomics.load(state, 2) !== id) {
      void this.stop();
      return { error: 'timeout' };
    }
    const length = Atomics.load(state, 1);
    return JSON.parse(new TextDecoder().decode(this.bytes!.subarray(0, length))) as SandboxReply;
  }

  stop(): Promise<number> | undefined {
    const w = this.worker;
    const pid = this.pid;
    this.worker = undefined;
    this.bytes = undefined;
    this.state = new Int32Array(new SharedArrayBuffer(16));
    // Terminating a thread alone doesn't stop its child process.
    if (pid) try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    if (!w) return;
    // Ask the thread to finish: it waits for (reaps) the process. Terminating it outright would leave a zombie.
    const exited = new Promise<number>(resolve => w.once('exit', resolve));
    w.ref(); // (workers are unreferenced; keep the process alive for the few milliseconds this takes)
    try { w.postMessage({ stop: true }); } catch { /* already gone */ }
    const fallback = setTimeout(() => { void w.terminate(); }, 2000);
    fallback.unref();
    return exited.finally(() => clearTimeout(fallback));
  }
}

/** The most recently used sandbox process's id, while there is one. */
export function javaScriptProcess(): number | undefined {
  return lastSandbox ? Atomics.load(lastSandbox.state, 3) || undefined : undefined;
}

/** Stops every sandbox. Custom functions and plug-ins restart on their next call; persistent handles stay invalid. */
export async function stopJavaScript(): Promise<void> {
  await Promise.all([...[...sandboxes.values()].map(stopSandbox), ...[...contexts].map(context => context.close())]);
}

/** A server-wide bound as well as the smaller per-account and registry per-session bounds. Allocation is lazy. */
export const JS_CONTEXT_LIMIT = 32;
/**
 * The account key is [store.path, account], not a person across files: one person with accounts on four files
 * can still fill the server pool. Sessions of the same account within one file share this smaller cap.
 */
export const JS_CONTEXT_ACCOUNT_LIMIT = 8;
/** Persistent handles expire after one minute without a call, including handles never evaluated. */
export const JS_CONTEXT_IDLE_MS = 60_000;
const contexts = new Set<JavaScriptContext>();
export type JavaScriptContextRequest =
  | { op: 'json' | 'string'; source: string }
  | { op: 'get' | 'getValue'; property: string }
  | { op: 'set' | 'setValue'; property: string; value: string | number };

/** A timed-out or crashed realm: callers must back off before starting more work for its owner. */
export class JavaScriptResourceError extends CalcError {}

/** One persistent realm in its own restricted process. No host bridge, modules or automatic restart. */
export class JavaScriptContext {
  private sandbox = new ContextSandbox();
  private isClosed = false;
  private expiresAt = 0;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private readonly account?: string;

  get closed(): boolean {
    this.expireIfIdle();
    return this.isClosed;
  }

  /** For lifecycle diagnostics, as javaScriptProcess() is for the shared sandbox. */
  get processId(): number | undefined { return this.sandbox.pid; }

  constructor(account?: string) {
    this.account = account;
    // Calculations block the event loop: reclaim overdue timers before refusing another session capacity.
    for (const context of contexts) context.expireIfIdle();
    // Count only live contexts, so every close path (including idle expiry and crashes) releases account capacity.
    // The existing server cap bounds this scan and avoids a second registry of accounts or leases.
    if (account !== undefined && [...contexts].filter(context => context.account === account).length >= JS_CONTEXT_ACCOUNT_LIMIT) {
      throw new CalcError(ERR.calculation, `JavaScript context limit reached for this account (${JS_CONTEXT_ACCOUNT_LIMIT})`);
    }
    if (contexts.size >= JS_CONTEXT_LIMIT) throw new CalcError(ERR.calculation, `JavaScript context limit reached for this server (${JS_CONTEXT_LIMIT})`);
    this.renewIdle();
    contexts.add(this);
  }

  private expireIfIdle(): void {
    if (!this.isClosed && performance.now() >= this.expiresAt) void this.close();
  }

  private renewIdle(): void {
    if (this.isClosed) return;
    clearTimeout(this.idleTimer);
    // Elapsed time, so changing the system clock cannot extend or shorten a handle's life.
    this.expiresAt = performance.now() + JS_CONTEXT_IDLE_MS;
    this.idleTimer = setTimeout(() => { void this.close(); }, JS_CONTEXT_IDLE_MS);
    this.idleTimer.unref();
  }

  call(req: JavaScriptContextRequest): Value {
    if (this.closed) throw new CalcError(ERR.calculation, 'JavaScript context is closed');
    for (const value of Object.values(req)) {
      if (typeof value === 'string' && value.length > JS_RESULT_LIMIT) throw new CalcError(ERR.calculation, 'JavaScript input is too large');
    }
    let res: SandboxReply;
    try {
      res = this.sandbox.request({ context: true, name: 'MBS.js', ...req }, JS_TIME_LIMIT_MS);
    } finally {
      this.renewIdle();
    }
    if (res.error) {
      const exhausted = res.error === 'timeout' || res.error === 'crashed';
      if (exhausted) void this.close();
      const message = res.error === 'timeout' ? `JavaScript took longer than ${JS_TIME_LIMIT_MS} ms; context closed`
        : res.error === 'crashed' ? `JavaScript exceeded ${JS_MEMORY_MB} MB or stopped; context closed`
        : res.error === 'big' ? `JavaScript result exceeds ${JS_RESULT_LIMIT} characters`
        : res.message ?? 'JavaScript evaluation failed';
      throw exhausted ? new JavaScriptResourceError(ERR.calculation, message) : new CalcError(ERR.calculation, message);
    }
    if (!res.out) throw new CalcError(ERR.calculation, 'JavaScript returned no supported value');
    return fromJavaScript('MBS JS', res.out);
  }

  close(): Promise<number> | undefined {
    if (this.isClosed) return;
    this.isClosed = true;
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    contexts.delete(this);
    return this.sandbox.stop();
  }
}

// Workers are unreferenced so an unused handle doesn't keep Node alive. Stop their children at shutdown too.
process.once('exit', () => {
  for (const slot of sandboxes.values()) void stopSandbox(slot);
  for (const context of contexts) void context.close();
});

export interface JavaScriptFunction {
  name: string;
  parameters: string[];
  source: string;
}

/** Runs a JavaScript custom function on calculation values and gives its result as one (or throws a CalcError: "?"). */
export function callJavaScript(fn: JavaScriptFunction, args: Value[], timeoutMs = JS_TIME_LIMIT_MS): Value {
  const parameters = fn.parameters.map((p) => p.trim());
  const problem = checkParameters(parameters);
  if (problem) throw new CalcError(ERR.calculation, `${fn.name}: ${problem}`);
  const r = sandboxCall(fn.name, coolKey(fn), { name: `${fn.name}.js`, parameters, source: fn.source }, args, timeoutMs);
  if (!('value' in r)) throw new CalcError(ERR.calculation, `${fn.name}: the function returned nothing usable`);
  return r.value;
}

export interface JavaScriptModule {
  /** Names the loaded code: a new key loads it again. */
  key: string;
  /** For messages and stack traces. */
  name: string;
  /** Defines `const functions = { Name ( a, b ) { ... } }`; for a WebAssembly module, its bytes in base64. */
  source: string;
  /** A WebAssembly module (see wasmCall in the sandbox for the interface it must have). */
  wasm?: boolean;
}

/**
 * Calls one of a plug-in's functions. Its code is loaded once into a realm of its own in the sandbox and kept there
 * for later calls (a realm a call ran out of time in is loaded afresh). Each module key and budget has
 * its own process, reclaimed after JS_SANDBOX_IDLE_MS without a call. Its requested old-space heap and wasm
 * linear memory limit is capped at JS_MEMORY_MB. RSS and ArrayBuffers are checked against that budget plus
 * JS_MEMORY_HEADROOM_MB; these sampled checks can overshoot temporarily, unlike an OS memory quota.
 */
export function callJavaScriptModule(mod: JavaScriptModule, fn: string, args: Value[], timeoutMs = JS_TIME_LIMIT_MS, host?: PluginHost, memoryMb = JS_MEMORY_MB): Value {
  // Manifests may request more for forward compatibility; this host never grants over its ceiling.
  memoryMb = Number.isFinite(memoryMb) ? Math.max(8, Math.min(JS_MEMORY_MB, Math.floor(memoryMb))) : JS_MEMORY_MB;
  const name = `${mod.name}/${fn}`;
  const key = `${mod.key}\0${fn}\0${memoryMb}`;
  const answers: Record<string, unknown> = {};
  let source = false;
  // The code goes only when the sandbox doesn't have it yet (a first call, or after the sandbox restarted). A call
  // that asks the host for something runs again with the answer, up to a limit.
  for (let round = 0; round < MAX_HOST_ROUNDS; round++) {
    const r = sandboxCall(name, key, { name: `${mod.name}.js`, module: mod.key, fn, answers, ...(mod.wasm ? { wasm: true } : {}), ...(source ? { source: mod.source } : {}) }, args, timeoutMs, memoryMb);
    if ('value' in r) return r.value;
    if ('unloaded' in r) {
      if (source) throw new CalcError(ERR.calculation, `${name}: the sandbox didn't load the plug-in`);
      source = true;
      round--;
      continue;
    }
    for (const k of r.need) {
      let q: unknown;
      try { q = JSON.parse(k); } catch { /* not a question */ }
      if (!Array.isArray(q) || typeof q[0] !== 'string') throw new CalcError(ERR.calculation, `${name} asked the host something it can't answer`);
      if (!host) throw new CalcError(ERR.calculation, `${name} can't use files, network, mail or secrets here`);
      answers[k] = host(q[0], q.slice(1));
    }
  }
  throw new CalcError(ERR.calculation, `${name} asked the host for more than ${MAX_HOST_ROUNDS} things in one call`);
}

/**
 * Answers what a plug-in asks the host for: tabularius.files.read ( path ) is ask ( "read", [ path ] ). The answer must
 * be JSON (text, numbers, true or false, null). Throws a CalcError for anything the plug-in may not do.
 */
export type PluginHost = (op: string, args: unknown[]) => unknown;
/** How many times one call can ask the host for something before it gives "?". */
export const MAX_HOST_ROUNDS = 50;

type SandboxResult = { value: Value } | { unloaded: true } | { need: string[] };

/** unloaded: the sandbox has no code loaded for a plug-in call sent without it; need: what the plug-in asked for. */
function sandboxCall(label: string, key: string, req: Record<string, unknown>, args: Value[], timeoutMs: number, memoryMb = JS_MEMORY_MB): SandboxResult {
  const until = cooling.get(key);
  if (until !== undefined) {
    if (performance.now() < until) throw new CalcError(ERR.calculation, `${label} ran out of time or memory recently, so it isn't run again yet`);
    cooling.delete(key);
  }
  // Module keys include the plug-in id, version and source hash. Custom functions use a separate process.
  const slot = sandbox(JSON.stringify([req.module ?? null, memoryMb]));
  const { worker: w, state, bytes } = slot;
  const id = nextId = nextId >= 0x7fffffff ? 1 : nextId + 1;
  Atomics.store(state, 0, 0);
  w.postMessage({ ...req, id, args: args.map(toJavaScript), timeout: timeoutMs, memoryMb });
  // The worker always answers within the time limit plus its grace (it stops the process when it must); the extra
  // allows for starting the worker and process on the first call.
  const deadline = performance.now() + timeoutMs + GRACE_MS + START_MS;
  // (A worker given up on is stopped and its memory dropped, so no late answer can land here.)
  if (Atomics.wait(state, 0, 0, deadline - performance.now()) === 'timed-out' || Atomics.load(state, 2) !== id) {
    void stopSandbox(slot);
    cool(key);
    throw new CalcError(ERR.calculation, `${label} took longer than ${timeoutMs} ms`);
  }
  const length = Atomics.load(state, 1);
  slot.lastUsed = Date.now();
  const res = JSON.parse(new TextDecoder().decode(bytes.slice(0, length))) as { error?: string; message?: string; out?: Out; need?: string[] };
  if (res.need) return { need: res.need };
  switch (res.error) {
    case undefined: break;
    case 'unloaded': return { unloaded: true };
    case 'timeout': cool(key); throw new CalcError(ERR.calculation, `${label} took longer than ${timeoutMs} ms`);
    case 'big': throw new CalcError(ERR.calculation, `${label} returned more than ${JS_RESULT_LIMIT.toLocaleString('en-US')} characters`);
    case 'memory': case 'crashed': cool(key); throw new CalcError(ERR.calculation, `${label} used more than ${memoryMb} MB of memory or stopped`);
    default: throw new CalcError(ERR.calculation, `${label}: ${res.message ?? 'error'}`);
  }
  return { value: fromJavaScript(label, res.out!) };
}

function cool(key: string): void {
  if (cooling.size > 1000) cooling.clear();
  cooling.set(key, performance.now() + JS_COOL_DOWN_MS);
}

function checkParameters(parameters: string[]): string | undefined {
  for (const p of parameters) if (!JS_PARAMETER.test(p) || RESERVED.has(p)) return `"${p}" can't be a JavaScript parameter name`;
  return undefined;
}

/** A file's custom function as calculations call it: a JavaScript one runs in the sandbox. */
export function customFunctionDef(cf: CustomFunction | undefined, formula: (text: string) => string = (t) => t): CustomFunctionDef | undefined {
  if (cf?.formula === undefined) return undefined;
  if (cf.language !== 'javascript') return { parameters: cf.parameters, formula: formula(cf.formula) };
  const fn = { name: cf.name, parameters: cf.parameters, source: cf.formula };
  return { parameters: cf.parameters, formula: cf.formula, call: (args) => callJavaScript(fn, args) };
}
