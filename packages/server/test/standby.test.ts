import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

test('notes from before pending work was recorded, left at a size of -1, take what is in the folder for the standby\'s own', async () => {
  // Older notes carry only a size of -1 for a copy or a batch of changes that was not finished, so a file in either
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
      const lines: string[] = [];
      standby = new Standby({ folder: root, primary, token: TOKEN, log: (m) => void lines.push(m), wait: 0 });
      fakePrimary(standby, source, seen);
      standby.start();
      await until(`the file is copied again (${left})`, () => existsSync(file) && tinyValue(file) === 'primary copy', 5000);
      assert.equal(existsSync(file + '-wal'), false, 'the log left by the crash is gone');
      assert.ok(lines.some((m) => /Local: its notes say a copy or a change did not finish; copying it again \(notes from an older version.*local writes to it are lost\)/.test(m)), lines.join('\n'));
    } finally {
      await standby?.stop();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

const sha = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

test('what a crash in the middle of a copy or a change leaves is the standby\'s own, and only that', async () => {
  // The notes say, before the file is touched, the states it may be in and the log the standby leaves beside it.
  const log = 'the changes being applied';
  type Seen = { size: number; mtimeMs: number } | null;
  const cases: { what: string; refused: boolean; arrange: (file: string, pre: Seen) => { states: (Seen | null)[]; log?: string } }[] = [
    { what: 'a change that crashed before it was applied: the file as it was, and the log the standby wrote', refused: false, arrange: (file, pre) => { writeFileSync(file + '-wal', log); return { states: [pre], log: sha(log) }; } },
    { what: 'the same, with the log changed by someone', refused: true, arrange: (file, pre) => { writeFileSync(file + '-wal', log + ' and a local write'); return { states: [pre], log: sha(log) }; } },
    { what: 'the same, with a write made here after the crash', refused: true, arrange: (file, pre) => { const db = new DatabaseSync(file); try { db.exec("UPDATE rows SET value = 'local edit'"); } finally { db.close(); } return { states: [pre], log: sha(log) }; } },
    { what: 'a copy that crashed before the new file appeared', refused: false, arrange: (_file, pre) => ({ states: [pre, { size: 1, mtimeMs: 1 }] }) },
    { what: 'a copy that crashed before the new file appeared, then a write made here', refused: true, arrange: (file, pre) => { const db = new DatabaseSync(file); try { db.exec("UPDATE rows SET value = 'local edit'"); } finally { db.close(); } return { states: [pre, { size: 1, mtimeMs: 1 }] }; } },
    { what: 'a copy that crashed after the new file appeared', refused: false, arrange: (file) => ({ states: [{ size: 1, mtimeMs: 1 }, (() => { const s = statSync(file); return { size: s.size, mtimeMs: s.mtimeMs }; })()] }) },
    { what: 'a copy that crashed when there had been no file', refused: false, arrange: (file) => { rmSync(file); return { states: [null, { size: 1, mtimeMs: 1 }] }; } },
    { what: 'a copy that crashed when there had been no file, then a local log', refused: true, arrange: (file) => { rmSync(file); writeFileSync(file + '-wal', 'a local write'); return { states: [null, { size: 1, mtimeMs: 1 }] }; } },
  ];
  for (const c of cases) {
    const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-pending-'));
    const file = join(root, 'Local' + STORE_EXT);
    const source = join(root, 'source.sqlite');
    const primary = 'http://primary.invalid';
    const seen = { copies: 0, changes: 0 };
    let standby: Standby | undefined;
    try {
      tinyDb(source, 'primary copy');
      tinyDb(file, 'replicated');
      const s = statSync(file);
      const pending = c.arrange(file, { size: s.size, mtimeMs: s.mtimeMs });
      writeFileSync(join(root, STANDBY_STATE), JSON.stringify({ primary, files: {
        Local: { run: 'old-run', seq: 1, wholeAfter: 2, size: -1, mtimeMs: -1, at: 0, pending },
      } }));
      const lines: string[] = [];
      standby = new Standby({ folder: root, primary, token: TOKEN, log: (m) => void lines.push(m), wait: 0 });
      fakePrimary(standby, source, seen);
      if (c.refused) {
        assert.throws(() => standby!.start(), /changed here since it was last updated: use --overwrite/, c.what);
        assert.equal(seen.copies, 0, c.what);
        if (existsSync(file)) assert.equal(tinyValue(file), c.what.includes('write made here') ? 'local edit' : 'replicated', c.what);
      } else {
        standby.start();
        await until(`the file is copied again (${c.what})`, () => existsSync(file) && tinyValue(file) === 'primary copy', 5000);
        assert.equal(existsSync(file + '-wal'), false, c.what);
        assert.ok(lines.some((m) => m === 'Local: its notes say a copy or a change did not finish; copying it again'), `${c.what}: ${lines.join('\n')}`);
      }
    } finally {
      await standby?.stop();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('a change that failed to apply, or could not be, leaves the file as the standby\'s own for as long as the main server is away, and no longer', async () => {
  for (const how of ['a gap in the changes', 'a change that fails to apply']) {
    const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-failed-'));
    const file = join(root, 'Local' + STORE_EXT);
    const source = join(root, 'source.sqlite');
    const primary = 'http://primary.invalid';
    const seen = { copies: 0, changes: 0 };
    let standby: Standby | undefined;
    let down = false;
    try {
      tinyDb(source, 'primary copy');
      tinyDb(file, 'replicated');
      savedTinyState(root, primary);
      standby = new Standby({ folder: root, primary, token: TOKEN, log: () => {}, wait: 0 });
      fakePrimary(standby, source, seen, async () => {
        down = true;
        // A directory where the log goes makes applying fail, after the standby has checked the file.
        if (how === 'a change that fails to apply') mkdirSync(file + '-wal', { recursive: true });
        // Change 2 would follow the 1 the notes have; 3 leaves a gap.
        return new Response(new Uint8Array(encodeRecord({ at: 1, seq: how === 'a gap in the changes' ? 3 : 2, data: Buffer.from('changes') })));
      });
      const reach = (standby as unknown as { get: (path: string) => Promise<Response> }).get;
      Object.assign(standby, { get: async (path: string) => {
        if (down && !path.includes('/changes?')) throw new Error('the main server is away');
        return reach.call(standby, path);
      } });
      standby.start();
      await until('the change fails', () => down && !!standby!.problem?.includes('following Local'), 5000);
      await standby.stop();
      standby = undefined;
      rmSync(file + '-wal', { recursive: true, force: true });

      // Someone writes to the replica while the main server is away; the standby, started again, must not copy over it.
      const db = new DatabaseSync(file);
      try { db.exec("UPDATE rows SET value = 'local edit'"); } finally { db.close(); }
      seen.copies = 0;
      standby = new Standby({ folder: root, primary, token: TOKEN, log: () => {}, wait: 0 });
      fakePrimary(standby, source, seen);
      assert.throws(() => standby!.start(), /changed here since it was last updated: use --overwrite/, how);
      assert.equal(tinyValue(file), 'local edit', how);
      assert.equal(seen.copies, 0, how);
    } finally {
      await standby?.stop();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('a copy is noted before the file appears, with the states the file is in before and after', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-noted-'));
  const file = join(root, 'Local' + STORE_EXT);
  const source = join(root, 'source.sqlite');
  const primary = 'http://primary.invalid';
  const seen = { copies: 0, changes: 0 };
  let noted: { files: { Local: { size: number; pending?: { states: ({ size: number; mtimeMs: number } | null)[] } } } } | undefined;
  let standby: Standby | undefined;
  try {
    tinyDb(source, 'primary copy');
    tinyDb(file, 'replicated');
    const before = statSync(file);
    savedTinyState(root, primary);
    // Out of date, so that the file is copied again.
    writeFileSync(join(root, STANDBY_STATE), JSON.stringify({ primary, files: { Local: { run: 'old-run', seq: 1, wholeAfter: 1, size: before.size, mtimeMs: before.mtimeMs, at: 0, pending: { states: [{ size: before.size, mtimeMs: before.mtimeMs }] } } } }));
    standby = new Standby({ folder: root, primary, token: TOKEN, wait: 0, log: (m) => {
      // The notes on disk at the moment the copy is done, before the save that follows it.
      if (m === 'copied Local') noted = JSON.parse(readFileSync(join(root, STANDBY_STATE), 'utf8'));
    } });
    fakePrimary(standby, source, seen);
    standby.start();
    await until('the copy is done', () => !!noted, 5000);
    const after = statSync(file);
    assert.equal(noted!.files.Local.size, -1);
    assert.deepEqual(noted!.files.Local.pending!.states, [{ size: before.size, mtimeMs: before.mtimeMs }, { size: after.size, mtimeMs: after.mtimeMs }]);
  } finally {
    await standby?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('each change is noted before it is applied, with the file as it is and the hash of the log it leaves', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-ahead-'));
  const file = join(root, 'Local' + STORE_EXT);
  const source = join(root, 'source.sqlite');
  const primary = 'http://primary.invalid';
  const seen = { copies: 0, changes: 0 };
  const noted: { size: number; pending?: { states: ({ size: number; mtimeMs: number } | null)[]; log?: string }; file: { size: number; mtimeMs: number }; wal: boolean }[] = [];
  let standby: Standby | undefined;
  try {
    tinyDb(source, 'primary copy');
    tinyDb(file, 'replicated');
    savedTinyState(root, primary);
    standby = new Standby({ folder: root, primary, token: TOKEN, log: () => {}, wait: 0 });
    fakePrimary(standby, source, seen, async () => {
      if (seen.changes === 1) return new Response(new Uint8Array(Buffer.concat([encodeRecord({ at: 1, seq: 2, data: Buffer.from('one') }), encodeRecord({ at: 1, seq: 3, data: Buffer.from('two') })])));
      await sleep(100);
      return new Response(new Uint8Array());
    });
    // The notes as they are saved, and the file at that moment.
    const save = (standby as unknown as { save: (wait?: number) => void }).save;
    Object.assign(standby, { save: function (this: Standby, wait?: number) {
      const f = this.state.files.Local;
      const s = statSync(file);
      noted.push({ size: f.size, pending: f.pending && JSON.parse(JSON.stringify(f.pending)), file: { size: s.size, mtimeMs: s.mtimeMs }, wal: existsSync(file + '-wal') });
      return save.call(this, wait);
    } });
    standby.start();
    await until('both changes are applied', () => standby!.state.files.Local.seq === 3 && !standby!.state.files.Local.pending, 5000);
    const ahead = noted.filter((n) => n.pending?.log);
    assert.deepEqual(ahead.map((n) => n.pending!.log), [sha('one'), sha('two')]);
    for (const n of ahead) {
      assert.equal(n.size, -1);
      assert.deepEqual(n.pending!.states, [n.file], 'the file as it was when the note was saved');
    }
    assert.equal(ahead[0].wal, false, 'saved before the log is written');
  } finally {
    await standby?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a batch that fails half done is noted as it was left, and what is written after that is a change made here', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-settled-'));
  const file = join(root, 'Local' + STORE_EXT);
  const primary = 'http://primary.invalid';
  try {
    tinyDb(file, 'replicated');
    const before = statSync(file);
    writeFileSync(join(root, STANDBY_STATE), JSON.stringify({ primary, files: {
      Local: { run: 'old-run', seq: 1, wholeAfter: 2, size: -1, mtimeMs: -1, at: 0, pending: { states: [{ size: before.size, mtimeMs: before.mtimeMs }], log: sha('a change') } },
    } }));
    const standby = new Standby({ folder: root, primary, token: TOKEN, log: () => {} });
    // Part of the batch got in before it failed: the file is no longer as it was, and the log left is the one being applied.
    const db = new DatabaseSync(file);
    try { db.exec("UPDATE rows SET value = 'half applied'"); } finally { db.close(); }
    writeFileSync(file + '-wal', 'a change');
    (standby as unknown as { settle: (name: string) => void }).settle('Local');

    // A start takes the file for its own, and a write made after that is not.
    const changedHere = (): boolean => (new Standby({ folder: root, primary, token: TOKEN, log: () => {} }) as unknown as { changedHere: (name: string) => boolean }).changedHere('Local');
    assert.equal(changedHere(), false);
    const edit = new DatabaseSync(file);
    try { edit.exec("UPDATE rows SET value = 'local edit'"); } finally { edit.close(); }
    assert.equal(changedHere(), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a batch with a change missing is not applied at all, and leaves no note of work in progress', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-gap-'));
  const file = join(root, 'Local' + STORE_EXT);
  const source = join(root, 'source.sqlite');
  const primary = 'http://primary.invalid';
  const seen = { copies: 0, changes: 0 };
  let standby: Standby | undefined;
  try {
    tinyDb(source, 'primary copy');
    tinyDb(file, 'replicated');
    savedTinyState(root, primary);
    const before = statSync(file);
    standby = new Standby({ folder: root, primary, token: TOKEN, log: () => {}, wait: 0 });
    // Changes 2 and 4 after the 1 in the notes: 2 would apply, 4 leaves a gap.
    fakePrimary(standby, source, seen, async () => {
      if (seen.changes === 1) return new Response(new Uint8Array(Buffer.concat([encodeRecord({ at: 1, seq: 2, data: Buffer.from('two') }), encodeRecord({ at: 1, seq: 4, data: Buffer.from('four') })])));
      await sleep(100);
      return new Response(new Uint8Array());
    });
    standby.start();
    await until('the gap is reported', () => !!standby!.problem?.includes('change 3 is missing'), 5000);
    const noted = standby.state.files.Local;
    assert.equal(noted.pending, undefined);
    assert.equal(noted.seq, 1);
    assert.equal(existsSync(file + '-wal'), false, 'change 2 was not applied: no log was written');
    assert.equal(statSync(file).mtimeMs, before.mtimeMs);
    assert.equal(seen.copies, 0);
    // The change may never come: the file is copied again.
    await until('the file is copied again', () => seen.copies === 1 && tinyValue(file) === 'primary copy', 10_000);
  } finally {
    await standby?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('files named like the properties of an object are followed, noted and found again after a restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-protos-'));
  const source = join(root, 'source.sqlite');
  const folder = join(root, 'spare');
  mkdirSync(folder);
  const primary = 'http://primary.invalid';
  const seen = { copies: 0, changes: 0 };
  const names = ['__proto__', 'toString', 'constructor'];
  let standby: Standby | undefined;
  const start = (lines: string[]): Standby => {
    const s = new Standby({ folder, primary, token: TOKEN, log: (m) => void lines.push(m), wait: 0 });
    fakePrimary(s, source, seen);
    const reach = (s as unknown as { get: (path: string) => Promise<Response> }).get;
    Object.assign(s, { get: async (path: string) => path.endsWith('/files') ? Response.json({ files: names.map((name) => ({ name })) }) : reach.call(s, path) });
    s.start();
    return s;
  };
  try {
    tinyDb(source, 'primary copy');
    const lines: string[] = [];
    standby = start(lines);
    await until('all are copied', () => names.every((n) => lines.includes(`copied ${n}`)), 5000);
    await until('their notes are complete', () => names.every((n) => { const f = standby!.state.files[n]; return !!f && f.size >= 0 && !f.pending; }), 5000);
    await standby.stop();
    standby = undefined;
    const saved = JSON.parse(readFileSync(join(folder, STANDBY_STATE), 'utf8')) as { files: Record<string, unknown> };
    assert.deepEqual(Object.keys(saved.files).sort(), [...names].sort());
    assert.deepEqual(readdirSync(folder).filter((f) => f.endsWith(STORE_EXT)).sort(), names.map((n) => n + STORE_EXT).sort());

    // Started again, each is a file the standby made, none is taken for someone else's.
    standby = start([]);
    await until('they are followed', () => seen.changes >= 6, 5000);
  } finally {
    await standby?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

/** A standby that is told by the main server which files it has, whatever their names, and copies each from the same source. */
function standbyOfNames(folder: string, source: string, names: string[], lines: string[], seen: { copies: number; changes: number }, primary = 'http://primary.invalid'): Standby {
  const s = new Standby({ folder, primary, token: TOKEN, log: (m) => void lines.push(m), wait: 0 });
  fakePrimary(s, source, seen);
  const reach = (s as unknown as { get: (path: string) => Promise<Response> }).get;
  Object.assign(s, { get: async (path: string) => path.endsWith('/files') ? Response.json({ files: names.map((name) => ({ name })) }) : reach.call(s, path) });
  return s;
}

test('a file name is taken by its bytes, not its characters, and 200 bytes is allowed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-limit-'));
  const folder = join(root, 'spare');
  mkdirSync(folder);
  const source = join(root, 'source.sqlite');
  const seen = { copies: 0, changes: 0 };
  const lines: string[] = [];
  const fits = ['é'.repeat(100), 'x'.repeat(200)];
  const too = ['é'.repeat(101), 'x'.repeat(201)];
  let standby: Standby | undefined;
  try {
    tinyDb(source, 'primary copy');
    standby = standbyOfNames(folder, source, [...too, ...fits], lines, seen);
    standby.start();
    await until('the names that fit are copied', () => fits.every((n) => lines.includes(`copied ${n}`)), 5000);
    assert.deepEqual(readdirSync(folder).filter((f) => f.endsWith(STORE_EXT)).sort(), fits.map((n) => n + STORE_EXT).sort());
    assert.equal(lines.filter((m) => m.includes('not a file name')).length, 2, lines.join('\n'));
  } finally {
    await standby?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('names that would fill the log or break a line of it are shortened, escaped, and said once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-log-'));
  const folder = join(root, 'spare');
  mkdirSync(folder);
  const source = join(root, 'source.sqlite');
  const seen = { copies: 0, changes: 0 };
  const lines: string[] = [];
  const odd = ['evil\nforged: copied Local', 'tab\tand\u2028separator', 'esc\u001b[31m'];
  let standby: Standby | undefined;
  try {
    tinyDb(source, 'primary copy');
    standby = standbyOfNames(folder, source, odd, lines, seen);
    standby.start();
    await until('they are copied', () => lines.filter((m) => m.startsWith('copied ')).length === odd.length, 5000);
    for (const m of lines) assert.doesNotMatch(m, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/, `a line of the log holds a raw control character: ${JSON.stringify(m)}`);
    assert.ok(lines.includes('copied "evil\\nforged: copied Local"'), lines.join(' | '));
    await standby.stop();
    standby = undefined;

    // Names that are not file names: a huge one is cut, and each is said once however often the list is read.
    const flood = new Standby({ folder, primary: 'http://primary.invalid', token: TOKEN, log: (m) => void lines.push(m) });
    lines.length = 0;
    const refuse = (name: unknown): void => (flood as unknown as { refuseName: (n: unknown) => void }).refuseName(name);
    const huge = `a/${'b'.repeat(100_000)}`;
    for (let i = 0; i < 4; i++) { refuse(huge); refuse('../x'); refuse({ not: 'a string' }); }
    assert.equal(lines.length, 3, lines.join('\n'));
    assert.ok(lines.every((m) => m.length < 200), 'each is cut short');
  } finally {
    await standby?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('notes of unfinished work are said once for a file until it is copied, and again when new ones appear', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-warned-'));
  const file = join(root, 'Local' + STORE_EXT);
  const source = join(root, 'source.sqlite');
  const primary = 'http://primary.invalid';
  const seen = { copies: 0, changes: 0 };
  const lines: string[] = [];
  const said = () => lines.filter((m) => m.includes('its notes say a copy or a change did not finish')).length;
  let standby: Standby | undefined;
  try {
    tinyDb(source, 'primary copy');
    tinyDb(file, 'replicated');
    writeFileSync(join(root, STANDBY_STATE), JSON.stringify({ primary, files: { Local: { run: 'old-run', seq: 1, wholeAfter: 2, size: -1, mtimeMs: -1, at: 0 } } }));
    standby = new Standby({ folder: root, primary, token: TOKEN, log: (m) => void lines.push(m), wait: 0 });
    fakePrimary(standby, source, seen);
    // The first copy fails and is tried again: the notes are still unfinished, and are said once.
    const reach = (standby as unknown as { get: (path: string) => Promise<Response> }).get;
    let failed = false;
    Object.assign(standby, { get: async (path: string) => {
      if (path.endsWith('/copy') && !failed) { failed = true; return new Response('no', { status: 500 }); }
      return reach.call(standby, path);
    } });
    standby.start();
    await until('the file is copied', () => lines.includes('copied Local'), 10_000);
    assert.equal(failed, true);
    assert.equal(said(), 1, lines.join('\n'));

    // Notes of unfinished work appear again (as after a failed apply): the file is copied again, and it is said again.
    const now = statSync(file);
    Object.assign(standby.state.files.Local, { size: -1, mtimeMs: -1, pending: { states: [{ size: now.size, mtimeMs: now.mtimeMs }] } });
    await until('the file is copied a second time', () => lines.filter((m) => m === 'copied Local').length === 2, 10_000);
    assert.equal(said(), 2, lines.join('\n'));
  } finally {
    await standby?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a name from the main server that is not a file name is never followed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-names-'));
  const folder = join(root, 'spare');
  mkdirSync(folder);
  const source = join(root, 'source.sqlite');
  const primary = 'http://primary.invalid';
  const seen = { copies: 0, changes: 0 };
  const lines: string[] = [];
  let standby: Standby | undefined;
  try {
    tinyDb(source, 'primary copy');
    standby = new Standby({ folder, primary, token: TOKEN, log: (m) => void lines.push(m), wait: 0 });
    fakePrimary(standby, source, seen);
    const reach = (standby as unknown as { get: (path: string) => Promise<Response> }).get;
    Object.assign(standby, { get: async (path: string) => {
      if (path.endsWith('/files')) return Response.json({ files: ['../escape', 'a/b', 'a\\b', '..', '', 'x'.repeat(300), 'Local'].map((name) => ({ name })) });
      if (!path.includes('/Local/') && !path.includes('/files')) throw new Error(`asked for a file that is not Local: ${path}`);
      return reach.call(standby, path);
    } });
    standby.start();
    await until('Local is copied', () => lines.includes('copied Local'), 5000);
    assert.ok(lines.some((m) => m.includes('not a file name')), lines.join('\n'));
    const long = lines.find((m) => m.includes('not a file name') && m.includes('x'.repeat(80)));
    assert.ok(long && !long.includes('x'.repeat(81)) && long.length < 200, `a name too long for a file name is reported, cut short: ${long}`);
    assert.deepEqual(readdirSync(folder).filter((f) => f.endsWith(STORE_EXT)), ['Local' + STORE_EXT]);
    assert.equal(existsSync(join(root, 'escape' + STORE_EXT)), false);
  } finally {
    await standby?.stop();
    rmSync(root, { recursive: true, force: true });
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
    const lines: string[] = [];
    standby = new Standby({ folder: root, primary, token: TOKEN, log: (m) => void lines.push(m), overwrite: true, wait: 0 });
    fakePrimary(standby, source, seen);
    standby.start();
    await until('the copy replaces the file', () => lines.includes('copied Local'), 5000);
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
      const theirs = (await files()).find((f) => f.name === 'Charts');
      const mine = standby!.state.files.Charts;
      // Changes are numbered within a run, and a restarted main server starts a new run from zero: the same number in another run
      // is not the same state (a standby still on the old run can read as caught up for as long as it takes to notice).
      return theirs !== undefined && !!mine && mine.run === theirs.run && mine.seq === theirs.seq && mine.seq >= mine.wholeAfter;
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
