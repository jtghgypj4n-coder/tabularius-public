// Reset Account Password with "expire password" set must make the account
// change its password on next sign-in, as FileMaker's step does; without it,
// the reset leaves no requirement.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '@tabularius/fmp12';
import { importFmp12, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let store: Store;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-pwscript-'));
  importFmp12(fixture, join(dir, 'C.sqlite'));
  store = new Store(join(dir, 'C.sqlite'));
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.setPassword('Clerk', 'start-pass', full.name);
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const reset = (account: string, password: string, expire: boolean): Script =>
  ({ id: 9999, name: 'reset', steps: [{
    stepId: 136, name: 'Reset Account Password', enabled: true,
    params: { accountName: `"${account}"`, password: `"${password}"`, expirePassword: expire } as StepParams,
  } as ScriptStep] } as Script);
// A full-access run (no privileges passed) is the only kind allowed to manage accounts.
const run = (s: Script) => runScript(store, s, { layout: 'Congress', account: 'Admin' });

test('Reset Account Password [expire] requires a change on next sign-in', { skip }, async () => {
  const r = await run(reset('Clerk', 'reset-pass', true));
  assert.equal(r.error, 0);
  assert.equal(store.verify('Clerk', 'reset-pass'), true, 'the new password works');
  assert.equal(store.mustChangePassword('Clerk'), true, 'a change is now owed');
});

test('Reset Account Password without expire leaves no requirement', { skip }, async () => {
  const r = await run(reset('Clerk', 'plain-pass', false));
  assert.equal(r.error, 0);
  assert.equal(store.mustChangePassword('Clerk'), false, 'no change is owed');
});
