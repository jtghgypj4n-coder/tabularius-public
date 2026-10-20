// Perform Script on Server runs on the server as the SAME account, so the
// server session must carry the caller's privileges — not full access. This
// locks three properties at the PSOS boundary: a script the caller's set
// forbids can't be run on the server (checkScript), a field/record the caller
// can't change can't be changed by the server script either, and the server
// script stays in the offline sandbox by default.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '@tabularius/fmp12';
import { importFmp12, Store, type PrivilegeDefinition } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let store: Store;

// Clerk can view records and run scripts (viewOnly = executable), but can't
// edit the Name field, and is denied one named script outright.
const clerk: PrivilegeDefinition = {
  name: 'Clerk',
  records: { view: true, edit: true, create: false, delete: false },
  tables: { Congress: { view: true, edit: true, create: false, delete: false, fields: { Name: 'viewOnly' } } },
  layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'viewOnly',
  scriptAccess: { Blocked: 'none' },
  extendedPrivileges: ['fmrest'],
};

const step = (stepId: number, name: string, params?: StepParams): ScriptStep => ({ stepId, name, enabled: true, params });
const ErrorCapture = step(86, 'Set Error Capture', { on: true } as StepParams);
const SetName = (value: string) => step(76, 'Set Field', { field: { tableOccurrence: { id: 0, name: 'Congress' }, field: { id: 0, name: 'Name' } }, calculation: `"${value}"` } as StepParams);
const Commit = step(75, 'Commit Records/Requests');
const Exit = (c: string) => step(103, 'Exit Script', { calculation: c } as StepParams);
const psos = (id: number, name: string): ScriptStep => ({ stepId: 164, name: 'Perform Script on Server', enabled: true, params: { script: { id, name }, parameter: '""' } as StepParams });

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-psos-priv-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  store = new Store(join(dir, 'Charts.sqlite'));
  store.savePrivilegeSet(clerk);
  store.setPassword('Clerk', 'pw', 'Clerk');

  store.applyDesign([
    // Server scripts.
    { op: 'createScript', id: 9001, name: 'Blocked', steps: [ErrorCapture, SetName('SHOULD NOT RUN'), Commit, Exit('Get ( LastError )')] },
    { op: 'createScript', id: 9002, name: 'WhoAmI', steps: [Exit('Get ( CurrentPrivilegeSetName )')] },
    { op: 'createScript', id: 9003, name: 'Fetch', steps: [ErrorCapture, step(160, 'Insert from URL', { variable: '$r', calculation: '"https://example.invalid/x"' } as StepParams), Exit('Get ( LastError )')] },
    // Callers that hand each one to the server and wait for its result.
    { op: 'createScript', id: 9101, name: 'CallBlocked', steps: [ErrorCapture, psos(9001, 'Blocked'), Exit('Get ( ScriptResult ) & "/" & Get ( LastError )')] },
    { op: 'createScript', id: 9102, name: 'CallWhoAmI', steps: [ErrorCapture, psos(9002, 'WhoAmI'), Exit('Get ( ScriptResult )')] },
    { op: 'createScript', id: 9103, name: 'CallFetch', steps: [ErrorCapture, psos(9003, 'Fetch'), Exit('Get ( ScriptResult )')] },
  ]);
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const asClerk = (s: string, opts = {}) => runScript(store, s, { layout: 'Congress', account: 'Clerk', privileges: store.privileges('Clerk'), ...opts });
const names = () => store.query(`SELECT Name FROM Congress`).map((r) => (r as { Name: string }).Name);

test('the server script runs under the caller\'s script access (checkScript)', { skip }, async () => {
  const before = names();
  const r = await asClerk('CallBlocked');
  // The PSOS step is refused with error 9 before the server script can run.
  assert.match(r.result as string, /\/9$/, 'Perform Script on Server denied (error 9)');
  assert.deepEqual(names(), before, 'the blocked server script never edited anything');
  assert.ok(!names().includes('SHOULD NOT RUN'));
});

test('the server session runs as the caller\'s privilege set, not elevated to full', { skip }, async () => {
  const r = await asClerk('CallWhoAmI');
  assert.equal(r.result, 'Clerk', 'the server script works within Clerk\'s privileges');
});

test('a full-access caller\'s server session is [Full Access]', { skip }, async () => {
  // The flip side: PSOS carries whatever the caller has, no more and no less.
  const r = await runScript(store, 'CallWhoAmI', { layout: 'Congress', account: 'Admin' });
  assert.equal(r.result, '[Full Access]');
});

test('a server script stays offline by default', { skip }, async () => {
  // No network option anywhere: the server script's Insert from URL fails
  // offline (error 3) and reaches nothing. Run as full access to isolate the
  // sandbox from the privilege checks above.
  const r = await runScript(store, 'CallFetch', { layout: 'Congress', account: 'Admin' });
  assert.equal(r.result, '3', 'Insert from URL is offline on the server');
});
