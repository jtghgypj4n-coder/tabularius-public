// The admin console's script test runner: every saved case of a file, run offline on a throwaway copy, pass or
// fail per script; the hosted file never changes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-tests-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const admin = (path: string, body?: unknown) => fetch(`${base}/tabularius/admin/v1/${path}`, body === undefined ? {} : {
  method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

test('the admin console runs every saved script test of a file on a copy and shows pass or fail per script', { skip }, async () => {
  assert.deepEqual((await admin('script-tests')).body.files, []);
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Done', type: 'text' }] },
    { op: 'createScript', name: 'Finish', text: 'Exit Script [ Text Result: "done" ]' },
    { op: 'createScript', name: 'Mark', text: 'New Record/Request\nSet Field [ Items::Done ; 1 ]\nExit Script [ Text Result: "marked" ]' },
  ] as never);
  const id = (n: string) => store.schema.scripts.find((s) => s.name === n)!.id;
  store.saveScriptTest({ script: id('Finish'), name: 'finishes', expect: { result: 'done' } });
  store.saveScriptTest({ script: id('Finish'), name: 'wrong on purpose', expect: { result: 'nope' } });
  store.saveScriptTest({ script: id('Mark'), name: 'marks', given: { layout: undefined }, expect: { result: 'marked' } });

  const listed = (await admin('script-tests')).body.files;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].database, 'Charts');
  assert.equal(listed[0].tests, 3);
  assert.deepEqual(listed[0].scripts.map((s: { script: string; tests: number }) => [s.script, s.tests]).sort(), [['Finish', 2], ['Mark', 1]]);

  const records = () => (store.query('SELECT COUNT(*) AS n FROM Items')[0] as { n: number }).n;
  const before = records();
  const ran = await admin('script-tests/run', { database: 'Charts' });
  assert.equal(ran.status, 200, JSON.stringify(ran.body));
  assert.equal(ran.body.ran, 3);
  assert.equal(ran.body.failed, 1);
  const finish = ran.body.scripts.find((s: { script: string }) => s.script === 'Finish');
  assert.deepEqual([finish.passed, finish.failed], [1, 1]);
  const miss = finish.cases.find((c: { name: string }) => c.name === 'wrong on purpose');
  assert.deepEqual(miss.failures[0], { what: 'result', expected: 'nope', actual: 'done' });
  const mark = ran.body.scripts.find((s: { script: string }) => s.script === 'Mark');
  assert.equal(mark.failed, 0, JSON.stringify(mark));
  // Run on a copy: the hosted file has no new record.
  assert.equal(records(), before);

  assert.equal((await admin('script-tests/run', { database: 'Nope' })).status, 404);
  // Changes need the console's header, as every other one does.
  const plain = await fetch(`${base}/tabularius/admin/v1/script-tests/run`, { method: 'POST', body: '{"database":"Charts"}' });
  assert.notEqual(plain.status, 200);
});
