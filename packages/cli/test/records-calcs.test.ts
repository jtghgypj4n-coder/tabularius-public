// `tabularius records` and `export` say which calculations and summaries the file keeps no value for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8' });

test('records: a calculation with no stored value is named on stderr, and the data stays clean', { skip }, () => {
  const csv = run('records', fixture, 'NW Customers', '--limit', '2', '--format', 'csv');
  assert.equal(csv.status, 0, csv.stderr);
  assert.equal(csv.stdout.split('\n')[0], 'recordId,Customer,Total Sales');
  assert.match(csv.stderr, /^note: Total Sales is a calculation or summary with no stored value in this file, so it is empty above\./);
  const jsonl = run('records', fixture, 'NW Customers', '--limit', '1');
  assert.ok(!jsonl.stdout.includes('Total Sales'));
  assert.match(jsonl.stderr, /note: Total Sales .* left out above/);
});

test('export: names the calculations and summaries that are empty in the copy', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-export-note-'));
  try {
    const out = run('export', fixture, join(dir, 'c.sqlite'));
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /note: NW Customers: Total Sales has no stored value in the file/);
    assert.match(out.stdout, /note: NW Salespeople: Count Customers, Sum Total Sales have no stored value/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
