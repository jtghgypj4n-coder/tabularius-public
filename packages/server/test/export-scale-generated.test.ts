// Generated records only: a large text export must arrive as a streamed response.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import { createStore, type DesignOp } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';

const RECORDS = 200_000;
const SMALL = 1200;
let dir: string;
let server: Server;
let base: string;
let token: string;
let hosted: Awaited<ReturnType<typeof serve>>;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-export-scale-'));
  const path = join(dir, 'Scale' + STORE_EXT);
  createStore(path);
  hosted = await serve({ dir, port: 0, hostname: '127.0.0.1', watch: false, log: () => {} });
  server = hosted.server;
  base = hosted.url;
  const store = hosted.host.get('Scale')!;
  store.applyDesign([
    { op: 'createTable', name: 'Rows', fields: [{ name: 'Id', type: 'number' }, { name: 'Label' }] },
    { op: 'createField', table: 'Rows', name: 'Total Id', kind: 'summary', summary: { type: 'total', field: 'Id' } },
    { op: 'createField', table: 'Rows', name: 'Running Id', kind: 'summary', summary: { type: 'total', field: 'Id', running: true } },
    { op: 'createField', table: 'Rows', name: 'Share Id', kind: 'summary', summary: { type: 'fractionOfTotal', field: 'Id' } },
    { op: 'createTable', name: 'Small', fields: [{ name: 'Id', type: 'number' }] },
    { op: 'createField', table: 'Small', name: 'Running Id', kind: 'summary', summary: { type: 'total', field: 'Id', running: true } },
    { op: 'createField', table: 'Small', name: 'Share Id', kind: 'summary', summary: { type: 'fractionOfTotal', field: 'Id' } },
  ] as DesignOp[]);
  store.setPassword('Admin', 'pw', '[Full Access]');
  const db = new DatabaseSync(path);
  try {
    db.exec('BEGIN');
    const insert = db.prepare('INSERT INTO Rows (Id, Label) VALUES (?, ?)');
    for (let i = 1; i <= RECORDS; i++) insert.run(i, `Row ${i}`);
    const small = db.prepare('INSERT INTO Small (Id) VALUES (?)');
    for (let i = 1; i <= SMALL; i++) small.run(i);
    db.exec('COMMIT');
  } finally { db.close(); }
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Scale/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  assert.equal(login.status, 200);
  token = (await login.json()).response.token;
});

after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('200k CSV rows stream completely in their found-set order', async () => {
  const res = await fetch(`${base}/tabularius/app/v1/databases/Scale/layouts/Rows/export`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'accept-encoding': 'identity' },
    body: JSON.stringify({ fields: ['Id', 'Label'], format: 'csv', fieldNames: true }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), null);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let chunks = 0;
  let lines = 0;
  let head = '';
  let tail = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks++;
    const text = decoder.decode(value, { stream: true });
    if (head.length < 100) head += text.slice(0, 100 - head.length);
    lines += text.split('\n').length - 1;
    tail = (tail + text).slice(-100);
  }
  assert.ok(head.startsWith('"Id","Label"\r\n"1","Row 1"\r\n'));
  assert.ok(chunks > 10, `the export arrived in ${chunks} pieces, not one`);
  assert.equal(lines, RECORDS + 1);
  assert.ok(tail.endsWith(`"${RECORDS}","Row ${RECORDS}"\r\n`));
});

test('a summary in a text export uses the whole selected found set', async () => {
  const res = await fetch(`${base}/tabularius/app/v1/databases/Scale/layouts/Rows/export`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: ['Id', 'Total Id'], format: 'csv', ids: [2, 1] }),
  });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '"2","3"\r\n"1","3"\r\n');
});

/** The rows of a CSV export as arrays of cells (every cell is quoted, none holds a comma or quote here). */
const rowsOf = (text: string) => text.trimEnd().split('\r\n').map((line) => line.slice(1, -1).split('","'));

test('running totals and fractions of the total differ from row to row past the first 500 rows', async () => {
  const ids = Array.from({ length: 1200 }, (_, i) => i + 1);
  const res = await fetch(`${base}/tabularius/app/v1/databases/Scale/layouts/Rows/export`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: ['Id', 'Total Id', 'Running Id', 'Share Id'], format: 'csv', ids }),
  });
  assert.equal(res.status, 200);
  const rows = rowsOf(await res.text());
  assert.equal(rows.length, 1200);
  const total = (1200 * 1201) / 2;
  for (const n of [1, 2, 499, 500, 501, 1000, 1200]) {
    const [id, all, running, share] = rows[n - 1];
    assert.equal(id, String(n));
    assert.equal(all, String(total));
    assert.equal(running, String((n * (n + 1)) / 2), `running total at row ${n}`);
    assert.ok(Math.abs(Number(share) - n / total) < 1e-9, `fraction of the total at row ${n}: ${share}`);
  }
});

test('a sort in the request orders the running total of a text export', async () => {
  const ids = Array.from({ length: 700 }, (_, i) => i + 1);
  const res = await fetch(`${base}/tabularius/app/v1/databases/Scale/layouts/Rows/export`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: ['Id', 'Running Id'], format: 'csv', ids, sort: [{ fieldName: 'Id', sortOrder: 'descend' }] }),
  });
  assert.equal(res.status, 200);
  const rows = rowsOf(await res.text());
  assert.equal(rows.length, 700);
  assert.deepEqual(rows[0], ['700', '700']);
  assert.deepEqual(rows[1], ['699', String(700 + 699)]);
  assert.deepEqual(rows[699], ['1', String((700 * 701) / 2)]);
});

test('a download the client cuts off is still logged as a read of the records already sent', async () => {
  const store = hosted.host.get('Scale')!;
  store.setAuditSettings({ logReads: true });
  const before = store.auditLog({ kind: 'read' }).length;
  const res = await fetch(`${base}/tabularius/app/v1/databases/Scale/layouts/Rows/export`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'accept-encoding': 'identity' },
    body: JSON.stringify({ fields: ['Id', 'Label'], format: 'csv' }),
  });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  await reader.read();
  await reader.cancel();
  const end = Date.now() + 10_000;
  while (store.auditLog({ kind: 'read' }).length === before) {
    if (Date.now() > end) assert.fail('the cut-off download was not logged');
    await new Promise((r) => setTimeout(r, 20));
  }
  const entry = store.auditLog({ kind: 'read' })[0];
  const records = Number(/"records":\s*(\d+)/.exec(JSON.stringify(entry))?.[1]);
  assert.ok(records > 100 && records <= RECORDS, `logged ${records} records of ${RECORDS}: ${JSON.stringify(entry)}`);
});

test('an export of all records with summary fields works them out in the found set\'s order, not a batch at a time', async () => {
  const res = await fetch(`${base}/tabularius/app/v1/databases/Scale/layouts/Small/export`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: ['Id', 'Running Id', 'Share Id'], format: 'csv' }),
  });
  assert.equal(res.status, 200);
  const rows = rowsOf(await res.text());
  assert.equal(rows.length, SMALL);
  const total = (SMALL * (SMALL + 1)) / 2;
  for (const n of [1, 500, 501, 1000, SMALL]) {
    assert.equal(rows[n - 1][1], String((n * (n + 1)) / 2), `running total at row ${n}`);
    assert.ok(Math.abs(Number(rows[n - 1][2]) - n / total) < 1e-9, `fraction of the total at row ${n}`);
  }
});

test('a client that accepts gzip gets an uncompressed stream, and other requests are served while it is written', async () => {
  let ticks = 0;
  let running = true;
  const tick = () => { ticks++; if (running) setImmediate(tick); };
  setImmediate(tick);
  const res = await fetch(`${base}/tabularius/app/v1/databases/Scale/layouts/Rows/export`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'accept-encoding': 'gzip, br' },
    body: JSON.stringify({ fields: ['Id', 'Label'], format: 'csv' }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-encoding'), null);
  assert.match(res.headers.get('cache-control') ?? '', /no-transform/);
  const size = (await res.arrayBuffer()).byteLength;
  running = false;
  assert.ok(size > RECORDS * 10, `the export is ${size} bytes`);
  // About 400 batches: the loop must have turned between them, not only after the last.
  assert.ok(ticks > 100, `the event loop turned ${ticks} times while the export was written`);
});
