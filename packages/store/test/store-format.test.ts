// A store says which file format it is in. A build opens its own and older ones (bringing them up to date) and
// refuses a newer one without touching it. See docs/upgrading.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDamageError, needsDesigns, reconvertCheck, Store, StoreFormatError, STORE_FORMAT, storedFormat, upgradeDesigns } from '../src/index.ts';
import { buildSampleStore } from './snapshots/sample-store.ts';

function inFolder(run: (dir: string, path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-format-'));
  try {
    run(dir, join(dir, 'Sample.sqlite'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function setFormat(path: string, value: number | undefined): void {
  const sql = new DatabaseSync(path);
  try {
    if (value === undefined) sql.exec("DELETE FROM _fm_meta WHERE key = 'storeFormat'");
    else sql.prepare("INSERT INTO _fm_meta VALUES ('storeFormat', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json").run(JSON.stringify(value));
  } finally {
    sql.close();
  }
}

function formatOf(path: string): number | 'unreadable' {
  const sql = new DatabaseSync(path, { readOnly: true });
  try {
    return storedFormat(sql);
  } finally {
    sql.close();
  }
}

test('a store this build makes carries the format it was written in', () => inFolder((_, path) => {
  buildSampleStore(path);
  assert.equal(formatOf(path), STORE_FORMAT);
}));

test('a store from before the number was kept opens and is marked', () => inFolder((_, path) => {
  buildSampleStore(path);
  setFormat(path, undefined);
  assert.equal(formatOf(path), 0);
  new Store(path, 'Sample').close();
  assert.equal(formatOf(path), STORE_FORMAT);
}));

test('a store from a newer Tabularius is refused, with a message that says what to do, and left as it was', () => inFolder((dir, path) => {
  buildSampleStore(path);
  setFormat(path, STORE_FORMAT + 1);
  const before = readFileSync(path);
  const filesBefore = readdirSync(dir).sort();
  let error: unknown;
  try { new Store(path, 'Sample'); } catch (e) { error = e; }
  assert.ok(error instanceof StoreFormatError, `got ${String(error)}`);
  assert.equal(error.found, STORE_FORMAT + 1);
  assert.match(error.message, /^Sample was written by a newer Tabularius \(file format \d+; this version reads up to format \d+\)/);
  assert.match(error.message, /Update Tabularius to open it, or put back a backup made before the newer version first opened it$/);
  assert.equal(isDamageError(error), false, 'a newer file is not a damaged one');
  assert.ok(readFileSync(path).equals(before), 'the file is byte for byte as it was');
  assert.deepEqual(readdirSync(dir).sort(), filesBefore, 'no log or lock file is added beside it');
  assert.equal(formatOf(path), STORE_FORMAT + 1, 'the newer number is not lowered');
}));

test('a refused store can be opened again once the number allows it', () => inFolder((_, path) => {
  buildSampleStore(path);
  setFormat(path, STORE_FORMAT + 5);
  assert.throws(() => new Store(path, 'Sample'), StoreFormatError);
  setFormat(path, STORE_FORMAT);
  const store = new Store(path, 'Sample');
  assert.ok(store.find('Clients', { limit: 5 }).records.length >= 2);
  store.close();
}));

test('a number that is not a whole number is refused like a newer one, not read as old and written over', () => inFolder((dir, path) => {
  buildSampleStore(path);
  for (const junk of ['"two"', 'null', '-3', '1.5', '{not json']) {
    const sql = new DatabaseSync(path);
    sql.prepare("UPDATE _fm_meta SET json = ? WHERE key = 'storeFormat'").run(junk);
    sql.close();
    const before = readFileSync(path);
    assert.throws(() => new Store(path, 'Sample'), (e: unknown) => e instanceof StoreFormatError && e.found === 'unreadable' && /a file format number this version cannot read/.test(e.message), junk);
    assert.ok(readFileSync(path).equals(before), `the file is as it was after ${junk}`);
  }
  assert.deepEqual(readdirSync(dir), ['Sample.sqlite']);
}));

test('the other ways in (converting again, reading layouts) leave a newer store alone too', () => inFolder((dir, path) => {
  buildSampleStore(path);
  setFormat(path, STORE_FORMAT + 1);
  const before = readFileSync(path);
  assert.equal(needsDesigns(path), false, 'a newer store is never due designs');
  assert.throws(() => reconvertCheck(path, join(dir, 'Sample.fmp12')), StoreFormatError);
  assert.throws(() => upgradeDesigns(path, join(dir, 'Sample.fmp12')), StoreFormatError);
  assert.ok(readFileSync(path).equals(before), 'the file is as it was');
}));

test('docs/upgrading.md names the format this build reads, and the file the upgrade command reads it from', () => {
  const doc = readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', 'upgrading.md'), 'utf8');
  assert.match(doc, new RegExp(`^Current store format: \\*\\*${STORE_FORMAT}\\*\\*$`, 'm'), 'raising STORE_FORMAT means updating docs/upgrading.md and running npm run store:snapshot');
  // `tabularius upgrade` reads this line out of the incoming copy's source to refuse a version that cannot open the folder.
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'store-format.ts'), 'utf8');
  assert.match(source, new RegExp(`^export const STORE_FORMAT = ${STORE_FORMAT};$`, 'm'));
});
