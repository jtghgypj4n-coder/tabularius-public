import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, evaluateText } from '../../calc/src/index.ts';
import { stopJavaScript } from '../../store/src/javascript.ts';
import { PluginRegistry, readPlugin } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-wasm-'));
after(async () => {
  await stopJavaScript();
  rmSync(dir, { recursive: true });
});

// A WebAssembly module assembled by hand (no toolchain needed): alloc, Echo (answers with its own arguments), Hello
// (answers "hi" from a data segment) and Spin (never returns).
const leb = (n: number) => { const o: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; };
const sleb = (n: bigint) => { const o: number[] = []; for (;;) { const b = Number(n & 0x7fn); n >>= 7n; if ((n === 0n && !(b & 0x40)) || (n === -1n && b & 0x40)) { o.push(b); return o; } o.push(b | 0x80); } };
const str = (s: string) => [...leb(s.length), ...Buffer.from(s)];
const section = (id: number, body: number[]) => [id, ...leb(body.length), ...body];
const vec = (items: number[][]) => [...leb(items.length), ...items.flat()];
const fn = (...code: number[]) => { const body = [0, ...code, 0x0b]; return [...leb(body.length), ...body]; };
const HEAD = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0];

function module(pages = 1, growPages?: number): Buffer {
  const types = [[0x60, 1, 0x7f, 1, 0x7f], [0x60, 2, 0x7f, 0x7f, 1, 0x7e]];
  // When asked to grow, trap if the runtime allowed it: these tests expect refusal.
  const grow = growPages === undefined ? [] : [0x41, ...sleb(BigInt(growPages)), 0x40, 0, 0x41, 0x7f, 0x47, 0x04, 0x40, 0x00, 0x0b];
  const hello = [...grow, 0x42, ...sleb((2048n << 32n) + 4n)];
  const echo = [0x20, 0, 0xad, 0x42, 32, 0x86, 0x20, 1, 0xad, 0x84];
  const spin = [0x03, 0x40, 0x0c, 0, 0x0b, 0x00];
  const bytes = [
    ...HEAD,
    ...section(1, vec(types)),
    ...section(3, vec([[0], [1], [1], [1]])),
    ...section(5, vec([[0, ...leb(pages)]])),
    ...section(7, vec([[...str('memory'), 2, 0], [...str('alloc'), 0, 0], [...str('Echo'), 0, 1], [...str('Hello'), 0, 2], [...str('Spin'), 0, 3]])),
    ...section(10, vec([fn(0x41, 16), fn(...echo), fn(...hello), fn(...spin)])),
    ...section(11, vec([[0, 0x41, ...leb(2048), 0x0b, 4, ...Buffer.from('"hi"')]])),
  ];
  return Buffer.from(bytes);
}

function install(name: string, wasm: Buffer, over: Record<string, unknown> = {}) {
  const d = join(dir, name);
  mkdirSync(d);
  writeFileSync(join(d, 'plugin.json'), JSON.stringify({
    id: `org.example.${name}`, name, version: '1.0.0', api: '^1.0', publisher: 'Example', runtime: 'wasm', main: 'main.wasm',
    functions: [{ name: 'W_Echo', min: 0 }, { name: 'W_Hello', min: 0 }, { name: 'W_Spin', min: 0 }], ...over,
  }));
  writeFileSync(join(d, 'main.wasm'), wasm);
  const reg = new PluginRegistry();
  const { manifest, calls } = readPlugin(d);
  // The manifest names each function as the module exports it.
  reg.install(manifest, Object.fromEntries(Object.entries(calls).map(([k, v]) => [k, v])));
  reg.enable('Shop', manifest.id);
  return { plugin: reg.lookup('Shop') };
}

test('a WebAssembly plug-in runs in the sandbox with JSON in and out', () => {
  const ctx = install('wasm-ok', module(), {
    functions: [{ name: 'Echo', min: 0 }, { name: 'Hello', min: 0, max: 0 }, { name: 'Spin', min: 0 }], permissions: { timeoutMs: 100 },
  });
  assert.equal(evaluateText('Hello', ctx), 'hi');
  assert.equal(evaluateText('Echo ( "a" ; 2 )', ctx), '["a",2]');
  assert.equal(evaluateText('Hello', ctx), 'hi');
  assert.throws(() => evaluate('Spin', ctx), /longer than 100 ms/);
});

test('a WebAssembly module that imports anything is refused', () => {
  const bytes = Buffer.from([...HEAD, ...section(1, vec([[0x60, 0, 0]])), ...section(2, vec([[...str('env'), ...str('f'), 0, 0]]))]);
  const ctx = install('wasm-imports', bytes, { functions: [{ name: 'Echo', min: 0 }] });
  assert.throws(() => evaluate('Echo', ctx), /imports something/);
});

test('a wasm plug-in needs a .wasm main and a js one may not have one', () => {
  const d = join(dir, 'mismatch');
  mkdirSync(d);
  const manifest = { id: 'org.example.mismatch', name: 'm', version: '1.0.0', api: '^1.0', publisher: 'E', functions: [{ name: 'M_A', min: 0 }] };
  writeFileSync(join(d, 'plugin.json'), JSON.stringify({ ...manifest, runtime: 'wasm', main: 'main.js' }));
  writeFileSync(join(d, 'main.js'), 'x');
  assert.throws(() => readPlugin(d), /\.wasm file/);
  writeFileSync(join(d, 'plugin.json'), JSON.stringify({ ...manifest, main: 'main.wasm' }));
  writeFileSync(join(d, 'main.wasm'), module());
  assert.throws(() => readPlugin(d), /needs "runtime": "wasm"/);
});

for (const memoryMb of [8, 64, 1024]) test(`wasm memory requests respect the ${memoryMb} MB request and host ceiling before allocation`, () => {
  const over = { functions: [{ name: 'Hello', min: 0 }], permissions: { memoryMb, timeoutMs: 5000 } };
  // A 200 MB initial allocation is refused, before any plug-in code runs.
  const initial = install(`wasm-big-${memoryMb}`, module(200 * 16), over);
  assert.throws(() => evaluate('Hello', initial), /could not be loaded/);
  // The runtime must also refuse growth beyond the effective budget.
  const growth = install(`wasm-grow-${memoryMb}`, module(1, Math.min(memoryMb, 64) * 16), over);
  assert.equal(evaluateText('Hello', growth), 'hi');
  const small = install(`wasm-small-${memoryMb}`, module(), over);
  assert.equal(evaluateText('Hello', small), 'hi');
});
