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
let dir: string;
let server: Server;
let base: string;
let token: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'openhbam-export-scale-'));
  const path = join(dir, 'Scale' + STORE_EXT);
  createStore(path);
  const hosted = await serve({ dir, port: 0, hostname: '127.0.0.1', watch: false, log: () => {} });
  server = hosted.server;
  base = hosted.url;
  const store = hosted.host.get('Scale')!;
  store.applyDesign([
    { op: 'createTable', name: 'Rows', fields: [{ name: 'Id', type: 'number' }, { name: 'Label' }] },
    { op: 'createField', table: 'Rows', name: 'Total Id', kind: 'summary', summary: { type: 'total', field: 'Id' } },
  ] as DesignOp[]);
  store.setPassword('Admin', 'pw', '[Full Access]');
  const db = new DatabaseSync(path);
  try {
    db.exec('BEGIN');
    const insert = db.prepare('INSERT INTO Rows (Id, Label) VALUES (?, ?)');
    for (let i = 1; i <= RECORDS; i++) insert.run(i, `Row ${i}`);
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
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: ['Id', 'Label'], format: 'csv', fieldNames: true }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), null);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let lines = 0;
  let head = '';
  let tail = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (head.length < 100) head += text.slice(0, 100 - head.length);
    lines += text.split('\n').length - 1;
    tail = (tail + text).slice(-100);
  }
  assert.ok(head.startsWith('"Id","Label"\r\n"1","Row 1"\r\n'));
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
