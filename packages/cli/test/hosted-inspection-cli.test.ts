import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { STORE_EXT } from '../../server/src/index.ts';
import { runCli } from './cli-run.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const fixtureSkip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const cli = (args: string[], env: NodeJS.ProcessEnv = {}) => runCli(main, args, { env: { ...process.env, ...env }, timeout: 90_000 });

async function folder(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-inspection-'));
  const created = await cli(['new', dir, 'Test']);
  assert.equal(created.status, 0, created.stderr);
  return dir;
}

describe('hosted inspection CLI', { concurrency: 4 }, () => {
test('sync-log prints an empty JSON array for a new store', async () => {
  const dir = await folder();
  try {
    const r = await cli(['sync-log', dir, 'Test', '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), []);
    assert.equal(r.stderr, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('encrypt and decrypt round-trip a hosted store', async () => {
  const dir = await folder();
  const key = 'test encryption passphrase';
  try {
    // encrypt opens the store first, which adds Tabularius's own tables, so check that nothing that was there is lost
    const tables = (file: string) => {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        assert.equal((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
        return db.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all().map((r) => `${r.type} ${r.name}`);
      } finally { db.close(); }
    };
    const before = tables(join(dir, 'Test' + STORE_EXT));
    const encrypted = await cli(['encrypt', dir], { TABULARIUS_ENCRYPTION_KEY: key });
    assert.equal(encrypted.status, 0, encrypted.stderr);
    assert.ok(readdirSync(dir).includes('Test' + STORE_EXT + '.enc'));
    assert.equal(readdirSync(dir).includes('Test' + STORE_EXT), false);
    const decrypted = await cli(['decrypt', dir], { TABULARIUS_ENCRYPTION_KEY: key });
    assert.equal(decrypted.status, 0, decrypted.stderr);
    const after = tables(join(dir, 'Test' + STORE_EXT));
    assert.deepEqual(before.filter((t) => !after.includes(t)), []);
    assert.equal(readdirSync(dir).includes('Test' + STORE_EXT + '.enc'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('style-census reads a public .fmp12 and emits text and JSON shapes', { skip: fixtureSkip }, async () => {
  const plain = await cli(['style-census', fixture]);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /^Charts\.fmp12: \d+ themes?\n/);
  assert.equal(plain.stderr, '');
  const json = await cli(['style-census', fixture, '--json']);
  assert.equal(json.status, 0, json.stderr);
  const census = JSON.parse(json.stdout);
  assert.equal(typeof census.themes, 'number');
  assert.ok(Array.isArray(census.properties));
  assert.ok(Array.isArray(census.rules));
});

test('dump reads a public .fmp12 and rejects missing and non-.fmp12 paths', { skip: fixtureSkip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-dump-'));
  try {
    const dumped = await cli(['dump', fixture, '--text']);
    assert.equal(dumped.status, 0, dumped.stderr);
    assert.match(dumped.stdout, /^\d+(?:\.\d+)*\t(?:k|K|seg|d)=/m);
    assert.match(dumped.stdout, /\t.*"/);
    const missing = await cli(['dump', join(dir, 'absent-tabularius-test.fmp12')]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /does not exist|no such file|ENOENT/i);
    const notFmp = join(dir, 'not-tabularius-test.txt');
    writeFileSync(notFmp, 'not a database');
    const wrongType = await cli(['dump', notFmp]);
    assert.notEqual(wrongType.status, 0);
    assert.match(wrongType.stderr, /\.fmp12|FileMaker|invalid|unsupported/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verify-backup exits 1 and explains a damaged backup file', async () => {
  const dir = await folder();
  const backup = join(dir, 'backups');
  try {
    const made = await cli(['backup', dir, '--to', backup]);
    assert.equal(made.status, 0, made.stderr);
    const set = readdirSync(backup)[0]!;
    const copy = join(backup, set, 'Test' + STORE_EXT);
    const bytes = readFileSync(copy);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    writeFileSync(copy, bytes);
    const checked = await cli(['verify-backup', dir, '--from', backup]);
    assert.equal(checked.status, 1, checked.stdout);
    assert.match(checked.stdout, /failed its check:.*changed on disk since it was taken/);
    assert.equal(checked.stderr, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fidelity emits its JSON report for a new store', async () => {
  const dir = await folder();
  try {
    const r = await cli(['fidelity', dir, 'Test', '--json']);
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(typeof report.fields, 'number');
    assert.ok(report.total && typeof report.total.values === 'number');
    assert.ok(report.skipped && typeof report.skipped.volatile === 'number');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('layout-census emits its JSON census for a new store', async () => {
  const dir = await folder();
  try {
    const r = await cli(['layout-census', dir, 'Test', '--json']);
    assert.equal(r.status, 0, r.stderr);
    const census = JSON.parse(r.stdout);
    assert.equal(typeof census.layouts, 'number');
    assert.ok(census.objects && typeof census.objects === 'object');
    assert.ok(census.parts && typeof census.parts === 'object');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

});
