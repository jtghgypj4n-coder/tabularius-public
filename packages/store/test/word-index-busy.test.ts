// A text find whose word index another process is building (holding the file
// for writing) doesn't wait on it: it reads every record instead, at once,
// for every criterion, and finds the same records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('a text find while another process holds the file for writing reads every record, without waiting', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-words-busy-'));
  const path = join(dir, 'S.openhbam.sqlite');
  createStore(path);
  const a = new Store(path, 'S');
  let b: Store | undefined;
  try {
    a.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Name', type: 'text' }, { name: 'City', type: 'text' }] }] as never);
    for (let i = 0; i < 20; i++) a.create('T', { Name: `hello ${i}`, City: i % 2 ? 'york' : 'leeds' });
    b = new Store(path, 'S');
    b.find('T', { limit: 1 });
    (a as unknown as { sql: { exec(s: string): void } }).sql.exec('BEGIN IMMEDIATE');
    const t0 = Date.now();
    let r;
    try {
      r = b.find('T', { query: [{ Name: 'hello', City: 'york' }], limit: 50 });
    } finally {
      (a as unknown as { sql: { exec(s: string): void } }).sql.exec('COMMIT');
    }
    const ms = Date.now() - t0;
    assert.equal(r.foundCount, 10);
    // It waits 100 ms once (a second where SQLite's busy wait sleeps in whole seconds, as on macOS), not 5 s per criterion.
    assert.ok(ms < 3000, `waited ${ms} ms`);
    // Once the file is free, the index is built and gives the same records.
    assert.equal(b.find('T', { query: [{ Name: 'hello', City: 'york' }], limit: 50 }).foundCount, 10);
  } finally {
    a.close();
    b?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
