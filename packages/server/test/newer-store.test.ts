// A folder holds a file written by a newer Tabularius: this build leaves it out, says why in the log and in the file list,
// does not call it damaged, and keeps serving the rest. The file is not changed. See docs/upgrading.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store, STORE_FORMAT } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { backupFolder } from '../src/backup.ts';
import { testRestore } from '../src/backup-verify.ts';

const EXT = '.openhbam.sqlite';

function make(path: string, name: string): void {
  createStore(path);
  const s = new Store(path, name);
  s.applyDesign([{ op: 'createTable', name: 'Clients', fields: [{ name: 'Name' }] }]);
  s.create('Clients', { Name: 'Ann' });
  s.setPassword('boss', 'pw', '[Full Access]');
  s.checkpoint();
  s.close();
}

function setFormat(path: string, value: number): void {
  const sql = new DatabaseSync(path);
  sql.prepare("INSERT INTO _fm_meta VALUES ('storeFormat', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json").run(JSON.stringify(value));
  sql.close();
}

test('a file from a newer Tabularius is left out and named, the others are served, and nothing is written to it', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-newer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  make(join(dir, 'Good' + EXT), 'Good');
  make(join(dir, 'Later' + EXT), 'Later');
  setFormat(join(dir, 'Later' + EXT), STORE_FORMAT + 1);
  const before = readFileSync(join(dir, 'Later' + EXT));

  const logs: string[] = [];
  const running = await serve({ dir, port: 0, log: (l: string) => logs.push(l), checkFiles: false, watch: false });
  t.after(async () => { await new Promise<void>((resolve) => running.server.close(() => resolve())); await running.host.close(); });
  assert.deepEqual(running.host.names(), ['Good']);
  const listed = running.host.files().find((f) => f.name === 'Later');
  assert.equal(listed?.status, 'closed');
  assert.match(listed?.damaged ?? '', /^Later was written by a newer Tabularius \(file format \d+; this version reads up to format \d+\)/);
  assert.doesNotMatch(listed?.damaged ?? '', /damaged/);
  assert.ok(logs.some((l) => /can't open Later\.openhbam\.sqlite, so it is not hosted: Later was written by a newer Tabularius/.test(l)));

  // The check made at start is about pages; a newer file's pages are sound, and it is not taken for a damaged one.
  await running.host.scanIntegrity();
  assert.match(running.host.files().find((f) => f.name === 'Later')?.damaged ?? '', /newer Tabularius/);

  const signIn = await fetch(`${running.url}/fmi/data/vLatest/databases/Good/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('boss:pw'), 'content-type': 'application/json' }, body: '{}' });
  assert.equal(signIn.status, 200);
  assert.ok(readFileSync(join(dir, 'Later' + EXT)).equals(before), 'the newer file is as it was');
});

test('a test restore of a backup of a newer file says it is newer, not that it is damaged', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-newer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  make(join(dir, 'Later' + EXT), 'Later');
  setFormat(join(dir, 'Later' + EXT), STORE_FORMAT + 1);
  const result = await backupFolder(dir, join(dir, 'backups'));
  const restore = await testRestore(result.dir);
  assert.match(restore.files['Later' + EXT] as string, /^Later was written by a newer Tabularius/);
});

test('a file another process raises to a newer format while it is open is taken offline, not written to further', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-newer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  make(join(dir, 'Shop' + EXT), 'Shop');
  make(join(dir, 'Other' + EXT), 'Other');
  const logs: string[] = [];
  const running = await serve({ dir, port: 0, log: (l: string) => logs.push(l), checkFiles: false, watch: false });
  t.after(async () => { await new Promise<void>((resolve) => running.server.close(() => resolve())); await running.host.close(); });
  assert.deepEqual(running.host.names().sort(), ['Other', 'Shop']);
  running.host.checkFormats();
  assert.deepEqual(running.host.names().sort(), ['Other', 'Shop'], 'a file in this build\'s format is left alone');

  // A newer version, running beside this one on the folder, opens the file and records its number.
  setFormat(join(dir, 'Shop' + EXT), STORE_FORMAT + 1);
  running.host.checkFormats();
  assert.deepEqual(running.host.names(), ['Other']);
  const listed = running.host.files().find((f) => f.name === 'Shop');
  assert.equal(listed?.status, 'closed');
  assert.match(listed?.damaged ?? '', /^Shop was written by a newer Tabularius \(file format \d+; this version reads up to format \d+\)/);
  assert.ok(logs.some((l) => /Shop was written by a newer Tabularius .* while it was open, so it is no longer served here/.test(l)));
  // Opening it again is refused while it is newer, and it stays listed with the reason.
  assert.throws(() => running.host.openFile('Shop'), /newer Tabularius/);
  assert.match(running.host.files().find((f) => f.name === 'Shop')?.damaged ?? '', /newer Tabularius/);
});
