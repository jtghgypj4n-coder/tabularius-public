import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { STANDBY_STATE, STORE_EXT, Standby, serve } from '../src/index.ts';
import { decodeRecords, encodeRecord, logReader, logRecords, startLog, writeLog } from '../src/logs.ts';
import { Store } from '../../store/src/index.ts';

// A standby server keeps copies of another server's files and takes over when it fails.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const TOKEN = 'a-replication-token-for-tests';

async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting until ${what}`);
    await sleep(50);
  }
}

/** Every record's id and field data, to compare two copies of a file. */
function contents(path: string): string {
  const s = new Store(path, 'Charts');
  try {
    const fields = s.schema.tables.find((t) => t.name === 'Congress')!.fields.map((f) => f.name);
    const rows = s.find('Congress', { limit: 100_000 }).records.map((r) => JSON.stringify([r.recordId, r.fieldData]));
    return JSON.stringify(fields) + '\n' + rows.join('\n');
  } finally {
    s.close();
  }
}

function tinyDb(path: string, value: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE _fm_meta (key TEXT PRIMARY KEY, json TEXT); CREATE TABLE rows (value TEXT)');
    db.prepare('INSERT INTO rows VALUES (?)').run(value);
  } finally { db.close(); }
}

function tinyValue(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return (db.prepare('SELECT value FROM rows').get() as { value: string }).value; }
  finally { db.close(); }
}

function savedTinyState(root: string, primary: string): void {
  const saved = statSync(join(root, 'Local' + STORE_EXT));
  writeFileSync(join(root, STANDBY_STATE), JSON.stringify({ primary, files: {
    Local: { run: 'old-run', seq: 1, wholeAfter: 1, size: saved.size, mtimeMs: saved.mtimeMs, at: Date.now() },
  } }));
}

test('a file changed here since the last copy stops the standby at start', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-divergence-'));
  const file = join(root, 'Local' + STORE_EXT);
  const primary = 'http://127.0.0.1:1';
  let standby: Standby | undefined;
  try {
    tinyDb(file, 'replicated');
    savedTinyState(root, primary);

    const changed = new DatabaseSync(file);
    changed.exec("UPDATE rows SET value = 'local edit'");
    changed.close();
    standby = new Standby({ folder: root, primary, token: TOKEN, log: () => {} });
    assert.throws(() => standby!.start(), /Local.*changed|changed.*Local/);
    assert.equal(tinyValue(file), 'local edit');
  } finally {
    await standby?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a known file that is missing here, with a sidecar left, stops the standby at start', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-missing-'));
  const file = join(root, 'Local' + STORE_EXT);
  const primary = 'http://127.0.0.1:1';
  let standby: Standby | undefined;
  try {
    tinyDb(file, 'replicated');
    savedTinyState(root, primary);
    rmSync(file);
    writeFileSync(file + '-wal', 'local sidecar');
    standby = new Standby({ folder: root, primary, token: TOKEN, log: () => {} });
    assert.throws(() => standby!.start(), /Local.*changed|changed.*Local/);
    assert.equal(readFileSync(file + '-wal', 'utf8'), 'local sidecar');
  } finally {
    await standby?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('--overwrite replaces a file changed here with the primary copy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-overwrite-'));
  const file = join(root, 'Local' + STORE_EXT);
  const source = join(root, 'source.sqlite');
  const primary = 'http://primary.invalid';
  let standby: Standby | undefined;
  try {
    tinyDb(file, 'replicated');
    tinyDb(source, 'primary copy');
    savedTinyState(root, primary);
    const db = new DatabaseSync(file);
    try { db.exec("UPDATE rows SET value = 'local edit'"); }
    finally { db.close(); }
    standby = new Standby({ folder: root, primary, token: TOKEN, overwrite: true, wait: 0, log: () => {} });
    Object.assign(standby, { get: async (path: string): Promise<Response> => {
      if (path.endsWith('/files')) return Response.json({ files: [{ name: 'Local' }] });
      if (path.endsWith('/copy')) return new Response(new Uint8Array(readFileSync(source)), { headers: {
        'x-tabularius-run': 'new-run', 'x-tabularius-seq': '0', 'x-tabularius-whole-after': '0',
      } });
      if (path.includes('/changes?')) {
        await sleep(100);
        return new Response(new Uint8Array());
      }
      throw new Error(`unexpected request: ${path}`);
    } });
    standby.start();
    await until('the authorized copy', () => tinyValue(file) === 'primary copy', 5000);
  } finally {
    await standby?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a resync copy never replaces a file or sidecar changed here, unless it is untouched', async () => {
  for (const editDuringCopy of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-resync-'));
    const file = join(root, 'Local' + STORE_EXT);
    const source = join(root, 'source.sqlite');
    const primary = 'http://primary.invalid';
    const lines: string[] = [];
    let standby: Standby | undefined;
    let localDb: DatabaseSync | undefined;
    try {
      tinyDb(file, 'replicated');
      tinyDb(source, 'primary copy');
      savedTinyState(root, primary);
      standby = new Standby({ folder: root, primary, token: TOKEN, log: (m) => void lines.push(m), wait: 0 });
      let copyRequests = 0;
      Object.assign(standby, { get: async (path: string): Promise<Response> => {
        if (path.endsWith('/files')) return Response.json({ files: [{ name: 'Local' }] });
        if (path.includes('/changes?')) {
          if (path.includes('run=new-run')) {
            await sleep(100);
            return new Response(new Uint8Array());
          }
          return Response.json({ error: 'new run' }, { status: 409 });
        }
        if (path.endsWith('/copy')) {
          copyRequests++;
          if (editDuringCopy) {
            localDb = new DatabaseSync(file);
            localDb.exec('PRAGMA journal_mode=WAL');
            localDb.exec("UPDATE rows SET value = 'local edit'");
            assert.equal(existsSync(file + '-wal'), true);
          }
          return new Response(new Uint8Array(readFileSync(source)), { headers: {
            'x-tabularius-run': 'new-run', 'x-tabularius-seq': '0', 'x-tabularius-whole-after': '0',
          } });
        }
        throw new Error(`unexpected request: ${path}`);
      } });
      standby.start();
      await until('the resync attempt', () => editDuringCopy
        ? !!standby!.problem?.includes('changed here')
        : lines.some((line) => line === 'copied Local'), 5000);
      assert.equal(copyRequests, 1);
      assert.equal(tinyValue(file), editDuringCopy ? 'local edit' : 'primary copy');
      assert.equal(existsSync(file + '-wal'), editDuringCopy);
    } finally {
      await standby?.stop();
      localDb?.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

/** A main server that has one tiny file, as far as the standby can tell: it answers the three requests it makes. */
function fakePrimary(standby: Standby, source: string, seen: { copies: number; changes: number }, changes: (path: string) => Promise<Response> | Response = async () => {
  await sleep(100);
  return new Response(new Uint8Array());
}): void {
  Object.assign(standby, { get: async (path: string): Promise<Response> => {
    if (path.endsWith('/files')) return Response.json({ files: [{ name: 'Local' }] });
    if (path.endsWith('/copy')) {
      seen.copies++;
      return new Response(new Uint8Array(readFileSync(source)), { headers: { 'x-tabularius-run': 'new-run', 'x-tabularius-seq': '0', 'x-tabularius-whole-after': '0' } });
    }
    if (path.includes('/changes?')) {
      seen.changes++;
      return changes(path);
    }
    throw new Error(`unexpected request: ${path}`);
  } });
}

test('what a crash of the standby itself leaves is its own, and is copied again', async () => {
  // The notes carry a size of -1 from before a copy or a batch of changes is applied until it is done, so a file in either
  // state, with the log the standby itself left beside it, or no file at all, is not a change made here.
  for (const left of ['the old file', 'the old file and its log', 'no file']) {
    const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-crashed-'));
    const file = join(root, 'Local' + STORE_EXT);
    const source = join(root, 'source.sqlite');
    const primary = 'http://primary.invalid';
    const seen = { copies: 0, changes: 0 };
    let standby: Standby | undefined;
    try {
      tinyDb(source, 'primary copy');
      tinyDb(file, 'replicated');
      writeFileSync(join(root, STANDBY_STATE), JSON.stringify({ primary, files: {
        Local: { run: 'old-run', seq: 1, wholeAfter: 2, size: -1, mtimeMs: -1, at: 0 },
      } }));
      if (left === 'the old file and its log') writeFileSync(file + '-wal', 'half of a batch of changes');
      if (left === 'no file') rmSync(file);
      standby = new Standby({ folder: root, primary, token: TOKEN, log: () => {}, wait: 0 });
      fakePrimary(standby, source, seen);
      standby.start();
      await until(`the file is copied again (${left})`, () => existsSync(file) && tinyValue(file) === 'primary copy', 5000);
      assert.equal(existsSync(file + '-wal'), false, 'the log left by the crash is gone');
    } finally {
      await standby?.stop();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('opening a file read-only, or deleting it, is not a change that --overwrite would save', async () => {
  // A read-only open of a file in WAL mode leaves an empty log and a shared-memory index beside it; a file that is gone
  // has nothing in it to lose.
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-quiet-'));
  const file = join(root, 'Local' + STORE_EXT);
  const source = join(root, 'source.sqlite');
  const primary = 'http://primary.invalid';
  const seen = { copies: 0, changes: 0 };
  let standby: Standby | undefined;
  try {
    tinyDb(source, 'primary copy');
    tinyDb(file, 'replicated');
    savedTinyState(root, primary);
    writeFileSync(file + '-wal', '');
    writeFileSync(file + '-shm', '');
    standby = new Standby({ folder: root, primary, token: TOKEN, log: () => {}, wait: 0 });
    fakePrimary(standby, source, seen);
    standby.start();
    await until('the file is followed', () => seen.changes > 0, 5000);
    assert.equal(seen.copies, 0, 'a file that only has an empty log beside it is not copied again');
    assert.equal(tinyValue(file), 'replicated');
    await standby.stop();
    standby = undefined;

    rmSync(file);
    rmSync(file + '-wal');
    rmSync(file + '-shm');
    seen.copies = 0;
    standby = new Standby({ folder: root, primary, token: TOKEN, log: () => {}, wait: 0 });
    fakePrimary(standby, source, seen);
    standby.start();
    await until('the deleted file is copied again', () => existsSync(file) && tinyValue(file) === 'primary copy', 5000);
  } finally {
    await standby?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a rollback journal left beside a file is a change made here, and is never left to be rolled back into a new copy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-journal-'));
  const file = join(root, 'Local' + STORE_EXT);
  const source = join(root, 'source.sqlite');
  const primary = 'http://primary.invalid';
  const seen = { copies: 0, changes: 0 };
  let standby: Standby | undefined;
  try {
    tinyDb(source, 'primary copy');
    tinyDb(file, 'replicated');
    savedTinyState(root, primary);
    writeFileSync(file + '-journal', 'a write that did not finish');
    standby = new Standby({ folder: root, primary, token: TOKEN, log: () => {} });
    assert.throws(() => standby!.start(), /Local.*changed|changed.*Local/);
    assert.equal(readFileSync(file + '-journal', 'utf8'), 'a write that did not finish');

    // With --overwrite it is replaced with the file, and the journal and a shared-memory index go with it.
    writeFileSync(file + '-shm', 'index');
    standby = new Standby({ folder: root, primary, token: TOKEN, log: () => {}, overwrite: true, wait: 0 });
    fakePrimary(standby, source, seen);
    standby.start();
    await until('the copy replaces the file', () => seen.copies > 0 && standby!.state.files.Local.size >= 0, 5000);
    assert.equal(tinyValue(file), 'primary copy');
    assert.equal(existsSync(file + '-journal'), false);
    assert.equal(existsSync(file + '-shm'), false);
  } finally {
    await standby?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a main server restart does not copy over a file changed here, and the file is not copied twice', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-restart-'));
  const file = join(root, 'Local' + STORE_EXT);
  const source = join(root, 'source.sqlite');
  const primary = 'http://primary.invalid';
  const seen = { copies: 0, changes: 0 };
  let standby: Standby | undefined;
  try {
    tinyDb(source, 'primary copy');
    tinyDb(file, 'replicated');
    savedTinyState(root, primary);
    standby = new Standby({ folder: root, primary, token: TOKEN, log: () => {}, wait: 0 });
    // The first answer says the run has changed; then the file is edited here, after the standby has looked at it.
    fakePrimary(standby, source, seen, async () => {
      if (seen.changes === 1) {
        const db = new DatabaseSync(file);
        try { db.exec("UPDATE rows SET value = 'local edit'"); } finally { db.close(); }
        return Response.json({ error: 'new run' }, { status: 409 });
      }
      await sleep(100);
      return new Response(new Uint8Array());
    });
    standby.start();
    await until('the refusal is reported', () => !!standby!.problem?.includes('changed here'), 5000);
    assert.equal(seen.copies, 0, 'the main server was not asked for a copy');
    assert.equal(tinyValue(file), 'local edit');
  } finally {
    await standby?.stop();
    rmSync(root, { recursive: true, force: true });
  }

  // After a copy, a failure to follow the changes must not copy the file again.
  const root2 = mkdtempSync(join(tmpdir(), 'tabularius-standby-once-'));
  const file2 = join(root2, 'Local' + STORE_EXT);
  const source2 = join(root2, 'source.sqlite');
  const seen2 = { copies: 0, changes: 0 };
  let standby2: Standby | undefined;
  try {
    tinyDb(source2, 'primary copy');
    tinyDb(file2, 'replicated');
    savedTinyState(root2, primary);
    standby2 = new Standby({ folder: root2, primary, token: TOKEN, log: () => {}, wait: 0 });
    fakePrimary(standby2, source2, seen2, async () => {
      if (seen2.changes === 1) return Response.json({ error: 'new run' }, { status: 409 });
      if (seen2.changes === 2) return new Response('no', { status: 500 });
      await sleep(100);
      return new Response(new Uint8Array());
    });
    standby2.start();
    await until('the changes are asked for again after the failure', () => seen2.changes >= 3, 10_000);
    assert.equal(seen2.copies, 1);
    assert.equal(tinyValue(file2), 'primary copy');
  } finally {
    await standby2?.stop();
    rmSync(root2, { recursive: true, force: true });
  }
});

test('a standby follows the main server, survives restarts on both sides, and takes over', { skip }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-'));
  const main = join(root, 'main');
  const spare = join(root, 'spare');
  mkdirSync(main);
  mkdirSync(spare);
  const lines: string[] = [];
  const log = (m: string) => void lines.push(m);
  let standby: Standby | undefined;
  copyFileSync(fixture, join(main, 'Charts.fmp12'));
  let s = await serve({ dir: main, port: 0, watch: false, replicationToken: TOKEN, log: () => {} });
  try {
    const port = Number(new URL(s.url).port);
    const files = async () => {
      const r = await fetch(`${s.url}/tabularius/replication/v1/files`, { headers: { authorization: `Bearer ${TOKEN}` } });
      return ((await r.json()) as { files: { name: string; run: string; seq: number }[] }).files;
    };
    // Changes are only for those with the token.
    assert.equal((await fetch(`${s.url}/tabularius/replication/v1/files`)).status, 401);
    assert.equal((await fetch(`${s.url}/tabularius/replication/v1/files`, { headers: { authorization: 'Bearer wrong-token-of-same-size!!' } })).status, 401);

    const store = () => s.host.get('Charts')!;
    // Changes before the standby starts, and while it copies.
    store().update('Congress', 1, { Name: 'Before the standby' });
    const start = () => {
      standby = new Standby({ folder: spare, primary: `http://127.0.0.1:${port}`, token: TOKEN, wait: 1, log });
      standby.start();
    };
    start();
    for (let i = 0; i < 50; i++) store().create('Congress', { Name: `While copying ${i}` });
    const caughtUp = async () => {
      const seq = (await files()).find((f) => f.name === 'Charts')?.seq;
      const mine = standby!.state.files.Charts;
      return seq !== undefined && !!mine && mine.seq === seq && mine.seq >= mine.wholeAfter;
    };
    await until('the standby has caught up', caughtUp);
    // Design changes and many records come across too.
    store().applyDesign([{ op: 'createField', table: 'Congress', name: 'Nickname' }]);
    store().update('Congress', 2, { Nickname: 'Slim' });
    for (let i = 0; i < 300; i++) store().create('Congress', { Name: `Added ${i}` });
    store().delete('Congress', 3);
    await sleep(1200);
    await until('the standby has the changes', caughtUp);
    await standby!.stop();
    const copy = join(spare, 'Charts' + STORE_EXT);
    assert.equal(contents(copy), contents(join(main, 'Charts' + STORE_EXT)));
    assert.equal(lines.filter((l) => l.startsWith('copied')).length, 1);

    // The standby restarts: it carries on without copying again.
    store().update('Congress', 1, { Name: 'While the standby was stopped' });
    start();
    await sleep(1200);
    await until('the standby has caught up again', caughtUp);
    await standby!.stop();
    assert.equal(lines.filter((l) => l.startsWith('copied')).length, 1);
    assert.equal(contents(copy), contents(join(main, 'Charts' + STORE_EXT)));

    // The main server restarts: a new run, so the standby copies the file again.
    start();
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
    s = await serve({ dir: main, port, watch: false, replicationToken: TOKEN, log: () => {} });
    store().update('Congress', 1, { Name: 'After the main server restarted' });
    await sleep(1200);
    await until('the standby has followed the restart', caughtUp, 30_000);
    assert.equal(lines.filter((l) => l.startsWith('copied')).length, 2);
    await standby!.stop();
    assert.equal(contents(copy), contents(join(main, 'Charts' + STORE_EXT)));
    await new Promise<void>((resolve) => s.server.close(() => resolve()));

    // Takeover: the main server is gone; serve the standby's folder.
    const taken: string[] = [];
    const t = await serve({ dir: spare, port: 0, watch: false, log: (m) => void taken.push(m) });
    try {
      assert.ok(taken.some((m) => m.startsWith('taking over from http://127.0.0.1')), taken.join('\n'));
      assert.ok(!existsSync(join(spare, STANDBY_STATE)));
      assert.equal(t.host.get('Charts')!.get('Congress', 1).fieldData.Name, 'After the main server restarted');
      assert.equal(t.host.get('Charts')!.get('Congress', 2).fieldData.Nickname, 'Slim');
    } finally {
      await new Promise<void>((resolve) => t.server.close(() => resolve()));
    }
    // Once taken over, a standby won't overwrite it.
    assert.throws(() => new Standby({ folder: spare, primary: `http://127.0.0.1:${port}`, token: TOKEN }).start(), /didn't copy \(Charts/);
  } finally {
    await standby?.stop();
    if (s.server.listening) await new Promise<void>((resolve) => s.server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('log files read up to their last whole record, sealed or not', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-logs-'));
  try {
    const third = encodeRecord({ at: 3000, seq: 0, data: Buffer.from('third') });
    for (const passphrase of [undefined, 'a passphrase']) {
      const path = join(dir, `x${passphrase ? '.enc' : ''}.log`);
      const w = startLog(path, passphrase);
      writeLog(w, { at: 1000, seq: 0, data: Buffer.from('first') });
      writeLog(w, { at: 2000, seq: 0, data: Buffer.from('second') });
      // A crash part way through a third.
      writeFileSync(path, third.subarray(0, 20), { flag: 'a' });
      const records = logRecords(path);
      assert.deepEqual(records.map((r) => r.at), [1000, 2000]);
      const read = await logReader(path, passphrase);
      assert.deepEqual(records.map((r) => read(r).toString()), ['first', 'second']);
      if (passphrase) {
        const wrong = await logReader(path, 'wrong');
        assert.throws(() => wrong(records[0]), /wrong passphrase/);
        await assert.rejects(logReader(path), /encrypted/);
      }
    }
    const both = Buffer.concat([encodeRecord({ at: 1, seq: 7, data: Buffer.from('a') }), third.subarray(0, 18)]);
    assert.deepEqual(decodeRecords(both).map((r) => [r.seq, r.data.toString()]), [[7, 'a']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
