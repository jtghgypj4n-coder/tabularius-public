import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
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
