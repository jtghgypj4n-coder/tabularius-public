import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '@tabularius/fmp12';
import { importFmp12, Store } from '@tabularius/store';
import { ScriptDebugger } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let store: Store;

const step = (stepId: number, name: string, params?: StepParams): ScriptStep => ({ stepId, name, enabled: true, params, line: `${name} ${params?.variable ?? ''}`.trim() });
const SetVar = (variable: string, value: string) => step(141, 'Set Variable', { variable, value });
// A subscript, as it would be in the file, and a script that performs it.
const sub: Script = { id: 99001, name: 'debug sub', steps: [SetVar('$x', '"in sub"'), SetVar('$$g', 'Get ( ScriptParameter ) * 2')] } as Script;
const main: Script = {
  id: 99002, name: 'debug main', steps: [
    SetVar('$a', '1'),
    step(1, 'Perform Script', { script: { id: 99001, name: 'debug sub' }, parameter: '$a + 20' }),
    SetVar('$b', '$$g + 1'),
    step(103, 'Exit Script', { calculation: '$b' }),
  ],
} as Script;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-dbg-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  store = new Store(join(dir, 'Charts.sqlite'));
  store.schema.scripts.push(sub, main);
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const at = (s: { paused?: { script: string; index: number } }) => s.paused && `${s.paused.script}#${s.paused.index}`;

test('step into, over and out; variables and the data viewer', { skip }, async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const d = new ScriptDebugger({ pauseAtStart: true });
  let s = await d.start(store, main, { layout: 'Congress', timeoutMs: 1000 });
  assert.equal(at(s), 'debug main#0');
  s = await d.resume('into');
  assert.equal(at(s), 'debug main#1');
  assert.deepEqual(s.paused!.variables.locals, { $a: '1' });
  assert.equal(d.evaluate('$a + 41').value, '42');
  assert.equal(d.evaluate('Left ( ').error !== undefined, true);
  s = await d.resume('into');
  assert.equal(at(s), 'debug sub#0');
  assert.deepEqual(s.paused!.stack.map((x) => `${x.script}#${x.index}`), ['debug main#1', 'debug sub#0']);
  assert.equal(d.evaluate('Get ( ScriptParameter )').value, '21');
  s = await d.resume('out');
  assert.equal(at(s), 'debug main#2');
  assert.equal(s.paused!.variables.globals.$$g, '42');
  // Waiting doesn't count toward the time limit.
  t.mock.timers.tick(1100);
  s = await d.resume('continue');
  assert.equal(s.done?.result, '43');
  assert.equal(s.done?.halted, false);
  assert.equal(d.running, false);
});

test('breakpoints, step over a subscript, halt', { skip }, async () => {
  const d = new ScriptDebugger({ breakpoints: [{ script: 'debug main', index: 1 }] });
  let s = await d.start(store, main, { layout: 'Congress' });
  assert.equal(at(s), 'debug main#1');
  s = await d.resume('over');
  assert.equal(at(s), 'debug main#2');
  s = await d.resume('halt');
  assert.equal(s.done?.halted, true);

  // A breakpoint inside the subscript; no breakpoints runs straight through.
  const e = new ScriptDebugger();
  e.setBreakpoints([{ script: 'debug sub', index: 1 }]);
  s = await e.start(store, main, { layout: 'Congress' });
  assert.equal(at(s), 'debug sub#1');
  e.setBreakpoints([]);
  s = await e.resume('continue');
  assert.equal(s.done?.result, '43');
  assert.equal((await new ScriptDebugger().start(store, main, { layout: 'Congress' })).done?.result, '43');
});

test('pause on error stops after the step that set one', { skip }, async () => {
  const failing: Script = {
    id: 99003, name: 'debug errors', steps: [
      SetVar('$a', '1'),
      step(6, 'Go to Layout', { layoutDestination: 'name', layoutCalculation: '"No such layout"' }),
      SetVar('$b', '2'),
      step(103, 'Exit Script', { calculation: '$b' }),
    ],
  } as Script;
  const d = new ScriptDebugger({ pauseOnError: true });
  const s = await d.start(store, failing, { layout: 'Congress' });
  assert.equal(at(s), 'debug errors#2');
  assert.equal(s.paused!.previousError?.code, 105);
  assert.equal(s.paused!.previousError?.index, 1);
  const done = await d.resume('continue');
  assert.equal(done.done?.result, '2');
});

test('set next step skips or repeats steps of the paused script', { skip }, async () => {
  const d = new ScriptDebugger({ pauseAtStart: true });
  let s = await d.start(store, main, { layout: 'Congress' });
  assert.equal(at(s), 'debug main#0');
  // Skip setting $a and performing the subscript.
  s = await d.setNextStep(2);
  assert.equal(at(s), 'debug main#2');
  assert.deepEqual(s.paused!.variables.locals, {});
  s = await d.resume('over');
  // Back to the first step: it runs again.
  s = await d.setNextStep(0);
  assert.equal(at(s), 'debug main#0');
  await assert.rejects(async () => d.setNextStep(9), /not in the script/);
  s = await d.resume('continue');
  assert.equal(s.done?.result, '43');
});
