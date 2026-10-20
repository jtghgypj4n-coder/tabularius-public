// The debugger's profile of one run: where the time went, by step and by script, with time paused in the debugger left out.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { RunProfile, runScript } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-run-profile-'));
  createStore(join(dir, 'P.sqlite'));
  store = new Store(join(dir, 'P.sqlite'), 'P');
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'X', type: 'text' }] },
    { op: 'createScript', name: 'Slow part', text: 'Set Variable [ $s ; Value: While ( [ i = 0 ; s = 0 ] ; i < 20000 ; [ s = s + i ; i = i + 1 ] ; s ) ]\nExit Script [ Text Result: $s ]' },
    { op: 'createScript', name: 'Main', text: 'Loop\n\tSet Variable [ $i ; Value: $i + 1 ]\n\tPerform Script [ “Slow part” ]\n\tExit Loop If [ $i ≥ 20 ]\nEnd Loop' },
  ] as never);
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const main = () => store.schema.scripts.find((s) => s.name === 'Main')!;

test('a run\'s profile adds each step\'s own time, by script with the scripts it calls, and says where most of it went', async () => {
  const profile = new RunProfile();
  await runScript(store, main(), { layout: 'T', profile });
  const r = profile.report();
  assert.equal(r.steps, 20 * 3 + 20 * 2 + 20, 'every step run counted (End Loop included)');
  const [top, sub] = [r.scripts.find((s) => s.script === 'Main')!, r.scripts.find((s) => s.script === 'Slow part')!];
  assert.equal(top.calls, 1);
  assert.equal(sub.calls, 20);
  assert.ok(Math.abs(top.totalMs - r.totalMs) < 0.05, 'the run\'s own script holds all the time');
  assert.ok(sub.totalMs <= top.totalMs && Math.abs(sub.totalMs - sub.ownMs) < 0.05);
  assert.ok(Math.abs(top.ownMs + sub.ownMs - r.totalMs) < 0.05, 'own times add up to the total');
  assert.equal(r.slowest[0].script, 'Slow part');
  assert.equal(r.slowest[0].index, 0);
  assert.equal(r.slowest[0].count, 20);
  assert.match(r.summary[0], /^\d+% of the time is line 1 of "Slow part": Set Variable .*, run 20 times at .* each\.$/);
});

test('time paused in the debugger, in the script or a subscript it calls, is not counted', async () => {
  const profile = new RunProfile();
  let clockMs = 0;
  let pausedMs = 0;
  const clock = {
    now: () => clockMs,
    advance: (ms: number) => { clockMs += ms; },
    advanceStep: () => { clockMs++; },
  };
  const began = clock.now();
  await runScript(store, main(), {
    layout: 'T', profile, profileClock: clock,
    // Hold the run 30 ms at each step of the subscript, as a person stepping through it would.
    debug: async (at) => {
      if (at.script !== 'Slow part') return;
      const paused = clock.now();
      clock.advance(30);
      pausedMs += clock.now() - paused;
    },
  });
  const wallMs = clock.now() - began;
  const r = profile.report();
  assert.equal(r.totalMs, wallMs - pausedMs, 'profiled time equals the run\'s non-paused virtual time');
  const perform = r.slowest.find((s) => s.script === 'Main' && /^Perform Script/.test(s.line));
  assert.ok(perform && perform.maxMs === 1 && perform.ms === perform.count, 'Perform Script steps contribute only their own 1 ms, not their subscript\'s pauses');
});
