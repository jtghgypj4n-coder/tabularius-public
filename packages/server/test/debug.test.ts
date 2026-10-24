import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let host: Awaited<ReturnType<typeof serve>>['host'];

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-debug-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
  const store = s.host.get('Charts')!;
  for (const set of store.privilegeSets().filter((p) => p.id === 1 || p.name === '[Read-Only Access]')) {
    store.savePrivilegeSet({ ...set, extendedPrivileges: [...set.extendedPrivileges, 'fmrest'] });
  }
  store.setPassword('Admin', 'pw');
  store.setPassword('Reader', 'pw', '[Read-Only Access]');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

async function login(account: string): Promise<Record<string, string>> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`) } });
  return { authorization: `Bearer ${(await r.json()).response.token}`, 'content-type': 'application/json' };
}

const url = (path: string) => `${base}/tabularius/debug/v1/databases/Charts/${path}`;
const call = (auth: Record<string, string>, method: string, path: string, body?: unknown) =>
  fetch(url(path), { method, headers: auth, ...(body ? { body: JSON.stringify(body) } : {}) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('script debugger: step, breakpoints and the data viewer, for full access only', { skip }, async () => {
  const admin = await login('Admin');
  const scripts = (await call(admin, 'GET', 'scripts')).body.scripts as { name: string; steps: { line: string }[] }[];
  const next = scripts.find((s) => s.name === '[btn] Go to next layout')!;
  const setVar = next.steps.findIndex((s) => s.line.startsWith('Set Variable'));
  const ifStep = next.steps.findIndex((s) => s.line.startsWith('If'));
  assert.ok(setVar >= 0 && ifStep > setVar);

  // Pause at a breakpoint on the If, after $destinationLayout is set.
  let r = await call(admin, 'POST', 'runs', { script: next.name, layout: 'Congress', pauseAtStart: false, breakpoints: [{ script: next.name, index: ifStep }] });
  assert.equal(r.status, 201);
  const id = r.body.id as string;
  assert.equal(r.body.paused.index, ifStep);
  assert.equal(r.body.paused.layout, 'Congress');
  assert.ok('$destinationLayout' in r.body.paused.variables.locals);
  const ev = await call(admin, 'POST', `runs/${id}/evaluate`, { formula: 'Get ( LayoutName ) & "/" & Get ( ScriptName )' });
  assert.deepEqual(ev.body, { value: `Congress/${next.name}` });
  r = await call(admin, 'POST', `runs/${id}/into`);
  assert.ok(r.body.paused.index > ifStep);
  r = await call(admin, 'POST', `runs/${id}/continue`);
  assert.equal(r.body.paused, undefined);
  assert.equal(r.body.done.halted, false);

  // Another session can't drive this run; a read-only account can't debug at all.
  const reader = await login('Reader');
  assert.equal((await call(reader, 'GET', 'scripts')).status, 403);
  const other = await login('Admin');
  assert.equal((await call(other, 'GET', `runs/${id}`)).status, 404);

  // Halt from the first step.
  r = await call(admin, 'POST', 'runs', { script: next.name, layout: 'Congress' });
  assert.equal(r.body.paused.index, setVar); // comments are skipped
  r = await call(admin, 'POST', `runs/${r.body.id}/halt`);
  assert.equal(r.body.done.halted, true);
  assert.equal((await call(admin, 'POST', 'runs', { script: 'No such script' })).body.error.code, 104);
});

test('data viewer without a script: formulas and current values on the web client\'s record', { skip }, async () => {
  const admin = await login('Admin');
  const list = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records?_limit=2`, { headers: admin }).then((r) => r.json());
  const [first, second] = list.response.data as { recordId: string; fieldData: Record<string, unknown> }[];
  const field = Object.keys(first.fieldData).find((k) => !k.includes('::'))!;

  // Each formula on the record the window shows, with the window's Get ( ) values; errors per formula.
  let r = await call(admin, 'POST', 'evaluate', {
    layout: 'Congress', recordId: Number(first.recordId), window: { foundCount: 7, number: 3 },
    formulas: ['Get ( RecordID )', 'Get ( FoundCount ) & "/" & Get ( RecordNumber ) & "/" & Get ( LayoutName )', `GetField ( "${field}" )`, 'Nonsense ( 1 )', 'Let ( $$seen = 42 ; $$seen )'],
  });
  assert.equal(r.status, 200);
  const [rid, win, value, bad, set] = r.body.results;
  assert.equal(rid.value, first.recordId);
  assert.equal(win.value, '7/3/Congress');
  assert.equal(value.value, String(first.fieldData[field]));
  assert.ok(bad.error > 0);
  assert.equal(set.value, '42');
  r = await call(admin, 'POST', 'evaluate', { layout: 'Congress', recordId: Number(second.recordId), formulas: ['Get ( RecordID )', '$$seen'] });
  assert.deepEqual(r.body.results.map((x: { value: string }) => x.value), [second.recordId, '42']);

  // Current: the record's fields and the session's $$variables.
  r = await call(admin, 'GET', `current?layout=Congress&recordId=${first.recordId}`);
  assert.equal(r.status, 200);
  assert.equal(String(r.body.fields[field]), String(first.fieldData[field]));
  assert.equal(r.body.variables.$$seen, '42');
  // Another session has its own globals; a missing record or layout is an error; read-only can't look.
  const other = await login('Admin');
  assert.deepEqual((await call(other, 'GET', 'current?layout=Congress')).body.variables, {});
  assert.equal((await call(admin, 'POST', 'evaluate', { layout: 'Congress', recordId: 999999, formulas: ['1'] })).body.error.code, 101);
  assert.equal((await call(admin, 'POST', 'evaluate', { layout: 'Nope', formulas: ['1'] })).body.error.code, 105);
  assert.equal((await call(await login('Reader'), 'POST', 'evaluate', { layout: 'Congress', formulas: ['1'] })).status, 403);
});

test('script debugger: set next step, pause on error, and this session\'s runs', { skip }, async () => {
  const admin = await login('Admin');
  const scripts = (await call(admin, 'GET', 'scripts')).body.scripts as { name: string; steps: { line: string }[] }[];
  const next = scripts.find((s) => s.name === '[btn] Go to next layout')!;
  const started = await call(admin, 'POST', 'runs', { script: next.name, layout: 'Congress', pauseOnError: true });
  assert.equal(started.status, 201);
  assert.equal(started.body.pauseOnError, true);
  const id = started.body.id as string;
  const listed = await call(admin, 'GET', 'runs');
  assert.deepEqual(listed.body.runs.map((r: { id: string }) => r.id), [id]);
  const first = started.body.paused.index as number;
  assert.equal(listed.body.runs[0].paused.index, first);
  const later = next.steps.findIndex((s, i) => i > first && s.line.startsWith('If'));
  const moved = await call(admin, 'POST', `runs/${id}/next`, { index: later });
  assert.equal(moved.body.paused.index, later);
  assert.equal((await call(admin, 'POST', `runs/${id}/next`, { index: 999 })).status, 400);
  const off = await call(admin, 'PUT', `runs/${id}/options`, { pauseOnError: false });
  assert.equal(off.body.pauseOnError, false);
  await call(admin, 'POST', `runs/${id}/halt`);
  // Another session sees none of them.
  const other = await login('Admin');
  assert.deepEqual((await call(other, 'GET', 'runs')).body.runs, []);
});

test('script debugger: runs on a scratch copy by default, on the hosted file only when asked', { skip }, async () => {
  const store = host.get('Charts')!;
  const table = store.layout('Congress').table;
  store.applyDesign([{ op: 'createScript', name: 'Debug adds a record', text: 'New Record/Request\nCommit Records/Requests [ With dialog: Off ]' }] as never);
  const before = store.recordCount(table);
  const admin = await login('Admin');

  let r = await call(admin, 'POST', 'runs', { script: 'Debug adds a record', layout: 'Congress', pauseAtStart: false });
  assert.equal(r.status, 201);
  assert.equal(r.body.scratch, true);
  assert.equal(r.body.done.error, 0);
  assert.equal(store.recordCount(table), before, 'the hosted file is untouched');
  // Each run says where its time went, step by step.
  assert.equal(r.body.profile.steps, 2);
  assert.deepEqual(r.body.profile.scripts.map((x: { script: string; calls: number }) => [x.script, x.calls]), [['Debug adds a record', 1]]);
  assert.equal(r.body.profile.slowest.length, 2);

  r = await call(admin, 'POST', 'runs', { script: 'Debug adds a record', layout: 'Congress', pauseAtStart: false, scratch: false });
  assert.equal(r.body.scratch, false);
  assert.equal(store.recordCount(table), before + 1);
});

test('a session has at most 3 debugger runs at a time; a finished run makes room, and nothing is left behind', { skip }, async () => {
  const admin = await login('Admin');
  const scripts = (await call(admin, 'GET', 'scripts')).body.scripts as { name: string }[];
  const next = scripts.find((s) => s.name === '[btn] Go to next layout')!;
  const ids: string[] = [];
  // Paused at the start, so all three are still running.
  for (let i = 0; i < 3; i++) {
    const r = await call(admin, 'POST', 'runs', { script: next.name, layout: 'Congress' });
    assert.equal(r.status, 201);
    ids.push(r.body.id);
  }
  const refused = await call(admin, 'POST', 'runs', { script: next.name, layout: 'Congress' });
  assert.equal(refused.status, 503);
  assert.equal(refused.body.error.code, 812);
  assert.match(refused.body.error.message, /3 debugger runs/);
  assert.match(refused.body.error.message, /Stop one/);
  // A recording shares the allowance.
  assert.equal((await call(admin, 'POST', 'recordings', { script: next.name, layout: 'Congress' })).status, 503);
  // Another session has its own.
  const other = await login('Admin');
  const mine = await call(other, 'POST', 'runs', { script: next.name, layout: 'Congress' });
  assert.equal(mine.status, 201);
  await call(other, 'POST', `runs/${mine.body.id}/halt`);
  // Stopping one makes room.
  await call(admin, 'POST', `runs/${ids[0]}/halt`);
  const again = await call(admin, 'POST', 'runs', { script: next.name, layout: 'Congress' });
  assert.equal(again.status, 201);
  for (const id of [...ids.slice(1), again.body.id]) await call(admin, 'POST', `runs/${id}/halt`);
});

test('simultaneous debugger starts cannot pass the limit of 3 (the place is taken before the copy)', { skip }, async () => {
  const admin = await login('Admin');
  const scripts = (await call(admin, 'GET', 'scripts')).body.scripts as { name: string }[];
  const next = scripts.find((s) => s.name === '[btn] Go to next layout')!;
  const results = await Promise.all(Array.from({ length: 8 }, () => call(admin, 'POST', 'runs', { script: next.name, layout: 'Congress' })));
  const started = results.filter((r) => r.status === 201);
  assert.equal(started.length, 3);
  assert.equal(results.filter((r) => r.status === 503).length, 5);
  for (const r of started) await call(admin, 'POST', `runs/${r.body.id}/halt`);
});
