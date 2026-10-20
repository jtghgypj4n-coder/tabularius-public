// The example Rust plug-in (examples/plugins/rust-text-tools, built to main.wasm by its build.sh) loads and works,
// so the template in docs/writing-a-plugin.md is known to run. Rebuilding it needs Rust; the built file is kept in the repo.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { evaluate, evaluateText } from '../../calc/src/index.ts';
import { stopJavaScript } from '../../store/src/javascript.ts';
import { PluginRegistry, readPlugin } from '../src/index.ts';

after(() => stopJavaScript());

const dir = join(import.meta.dirname, '..', '..', '..', 'examples', 'plugins', 'rust-text-tools');

function context() {
  const reg = new PluginRegistry();
  const { manifest, calls } = readPlugin(dir);
  reg.install(manifest, calls);
  reg.enable('Shop', manifest.id);
  return { plugin: reg.lookup('Shop') };
}

test('the example Rust plug-in\'s functions work in calculations', () => {
  const ctx = context();
  assert.equal(evaluateText('Ex_Slug ( "Hello, World!" )', ctx), 'hello-world');
  assert.equal(evaluateText('Ex_Slug ( "  --A  \\"quoted\\" \\\\ title--  " )', ctx), 'a-quoted-title');
  assert.equal(evaluateText('Ex_WordCount ( "one two  three" )', ctx), '3');
  assert.equal(evaluateText('Ex_WordCount ( "" )', ctx), '0');
  assert.equal(evaluateText('Ex_Add ( 2 ; 3.5 )', ctx), '5.5');
  // Text with accents, quotes and line breaks makes the trip in and out.
  assert.equal(evaluateText('Ex_WordCount ( "café über" & Char ( 10 ) & "x" )', ctx), '3');
});

test('the example does not keep anything between calls, and bad calls give "?"', () => {
  const ctx = context();
  for (let i = 0; i < 200; i++) assert.equal(evaluateText(`Ex_Add ( ${i} ; 1 )`, ctx), String(i + 1));
  // Wrong kinds of argument: the plug-in answers nothing, which is an error.
  assert.throws(() => evaluate('Ex_Add ( "a" ; "b" )', ctx), /plug-in|answered|WebAssembly/i);
});
