// tabularius corpus-scan: counts what a collection of .fmp12 files uses, with
// nothing from inside them beyond counts and masked formula shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeCalc, observeCalcs } from '../../fmp12/src/index.ts';
import { buildReport, callShapes, dedupe, errorClass, reportMarkdown, scanFile, scanInChild, selectOnly, type FileScan } from '../src/corpus-scan.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');

// A stored literal: 13, length, text XOR 0x5A, 00.
const lit = (t: string) => [0x13, t.length, ...[...t].map((c) => c.charCodeAt(0) ^ 0x5a), 0];

test('decoding reports plug-in calls by id and a shape with strings and fields masked', () => {
  // ⟨Troi:7⟩ ( "secret value" ; field ) & MBS ( "Text.ReplaceAll" )
  const field = [0x16, 0x00, 0x02, 0x01, 0x05, 0x00, 0x01];
  const plugin = (owner: string, index: number) => [0x1d, 0, 0, 0x15, ...[...owner].map((c) => c.charCodeAt(0)), index >> 8, index & 0xff];
  const b = Uint8Array.from([...plugin('Troi', 7), 0x04, ...lit('secret value'), 0x03, ...field, 0x05, 0x50, ...plugin('MBSP', 1), 0x04, ...lit('Text.ReplaceAll'), 0x05]);
  const tokens: string[] = [];
  const formulas: { text: string; shape: string }[] = [];
  const text = observeCalcs({ token: (k, id, name) => tokens.push(`${k}:${id}${name ? '=' + name : ''}`), formula: (text, shape) => formulas.push({ text, shape }) }, () => decodeCalc(b).text);
  assert.ok(text.includes('secret value'));
  assert.deepEqual(tokens, ['plugin:Troi:7', 'plugin:MBSP:1=MBS']);
  assert.equal(formulas.length, 1);
  assert.equal(formulas[0].shape, '⟨Troi:7⟩("…";«field»)&MBS("…")');
  assert.ok(!formulas[0].shape.includes('secret'));
  // Outside observeCalcs nothing is reported.
  decodeCalc(b);
  assert.equal(formulas.length, 1);
});

test('callShapes keeps the call and a little before it', () => {
  assert.deepEqual(callShapes('If ( ⟨fn:f911⟩ ( «field» ; "…" ) ; 1 )', '⟨fn:f911⟩'), ['If ( ⟨fn:f911⟩ ( «field» ; "…" )']);
  assert.deepEqual(callShapes('Get ( ⟨get:79⟩ ) > 1', '⟨get:79⟩'), ['Get ( ⟨get:79⟩ ) > 1']);
});

test('errorClass keeps no quoted text, paths or numbers', () => {
  const e = new Error('no table "Clients 2019" at /Users/x/Secret.fmp12 block 1234');
  const c = errorClass(e);
  assert.ok(!/Clients|Secret|1234|Users/.test(c), c);
  assert.equal(c, 'Error');
});

test('buildReport ranks by how many files use a thing, and names known plug-in makers', () => {
  const a: FileScan = { status: 'ok', plugins: { 'GyBE:152': 3, 'Troi:7': 1 }, functions: { If: 5 }, shapes: { 'plugin:Troi:7': ['⟨Troi:7⟩ ( "…" )'] } };
  const b: FileScan = { status: 'ok', plugins: { 'Troi:7': 2 }, functions: { If: 1, Let: 9 } };
  const r = buildReport(3, 100, [{ id: 'a', sizeMB: 0, copies: 2, scan: a }, { id: 'b', sizeMB: 0, copies: 1, scan: b }, { id: 'c', sizeMB: 0, copies: 1, scan: { status: 'encrypted' } }]);
  assert.deepEqual(r.files, { found: 3, unique: 3, duplicates: 0, bytes: 100 });
  assert.deepEqual(r.status, { ok: 2, encrypted: 1 });
  assert.deepEqual(r.plugins.map((p) => [p.name, p.files, p.uses, p.vendor]), [['Troi:7', 2, 3, undefined], ['GyBE:152', 1, 3, 'BaseElements']]);
  assert.deepEqual(r.plugins[0].shapes, ['⟨Troi:7⟩ ( "…" )']);
  assert.deepEqual(r.pluginOwners.map((o) => [o.name, o.files]), [['Troi', 2], ['GyBE', 1]]);
  assert.deepEqual(r.functions.map((f) => f.name), ['If', 'Let']);
  assert.ok(!('shapes' in r.perFile[0]));
});

test('a killed scan retains its last anonymous progress and stage times', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-timeout-'));
  try {
    const entry = join(dir, 'child.mjs');
    writeFileSync(entry, `process.stderr.write('tabularius-scan-progress ' + JSON.stringify({stage:'records',bytesRead:8192,tablesConverted:2,recordsConverted:30,peakHeapBytes:4096,stageMs:{schema:12,tables:4,records:3}}) + '\\n'); setInterval(() => {}, 1000);`);
    const scan = await scanInChild(entry, join(dir, 'nothing.fmp12'), false, 250);
    assert.equal(scan.status, 'timeout');
    assert.equal(scan.progress?.stage, 'records');
    assert.equal(scan.progress?.bytesRead, 8192);
    assert.equal(scan.progress?.tablesConverted, 2);
    assert.equal(scan.progress?.recordsConverted, 30);
    assert.equal(scan.progress?.peakHeapBytes, 4096);
    assert.equal(scan.progress?.stageMs.schema, 12);
    assert.ok((scan.progress?.stageMs.records ?? 0) >= 3);
    const md = reportMarkdown(buildReport(1, 1, [{ id: 'abc123', sizeMB: 0, copies: 1, scan }]));
    assert.match(md, /\| records \|/);
    assert.match(md, /\| schema \| 12 \|/);
    assert.doesNotMatch(md, /nothing\.fmp12|corpus-timeout/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a child killed before its first snapshot still reports zeroed anonymous aggregates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-early-timeout-'));
  try {
    const entry = join(dir, 'child.mjs');
    writeFileSync(entry, 'setInterval(() => {}, 1000)');
    const scan = await scanInChild(entry, join(dir, 'nothing.fmp12'), false, 250);
    assert.equal(scan.status, 'timeout');
    assert.equal(scan.progress?.stage, 'read blocks');
    assert.equal(scan.progress?.bytesRead, 0);
    assert.equal(scan.progress?.tablesConverted, 0);
    assert.equal(scan.progress?.recordsConverted, 0);
    assert.equal(scan.progress?.peakHeapBytes, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--only selects one anonymous id and rejects missing or ambiguous prefixes', () => {
  const entries: [string, { path: string; size: number; copies: number }][] = [['abc123456789', { path: '/private/a.fmp12', size: 1, copies: 1 }], ['def123456789', { path: '/private/b.fmp12', size: 2, copies: 1 }]];
  assert.deepEqual(selectOnly([...entries], 'abc123456789').map(([id]) => id), ['abc123456789']);
  assert.throws(() => selectOnly([...entries], 'missing'), /anonymous id/);
  assert.throws(() => selectOnly([...entries], 'abc'), /12 hexadecimal/);
});

test('generated invalid input reports anonymous bytes read without file contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-invalid-'));
  try {
    const path = join(dir, 'private-name.fmp12');
    writeFileSync(path, Buffer.alloc(8192, 0x41));
    const scan = scanFile(path);
    assert.equal(scan.status, 'failed');
    assert.equal(scan.progress?.stage, 'read blocks');
    assert.ok((scan.progress?.bytesRead ?? 0) >= 8192);
    assert.ok((scan.progress?.peakHeapBytes ?? 0) > 0);
    assert.ok(!JSON.stringify(scan).includes('private-name'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI --only scans just the selected generated id and --timeout validates seconds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-only-'));
  try {
    const one = join(dir, 'one.fmp12'), two = join(dir, 'two.fmp12');
    writeFileSync(one, Buffer.alloc(8192, 0x41));
    writeFileSync(two, Buffer.alloc(8192, 0x42));
    const ids = [...(await dedupe([one, two])).groups.keys()];
    const out = join(dir, 'out');
    const run = spawnSync(process.execPath, ['--no-warnings', main, 'corpus-scan', dir, '--out', out, '--only', ids[0].slice(0, 12), '--jobs', '1', '--timeout', '2'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(readFileSync(join(out, 'corpus-report.json'), 'utf8'));
    assert.equal(report.files.unique, 1);
    assert.equal(report.files.found, 1);
    assert.equal(report.perFile[0].id, ids[0].slice(0, 12));
    const invalid = spawnSync(process.execPath, ['--no-warnings', main, 'corpus-scan', dir, '--out', out, '--jobs', '1', '--timeout', '0'], { encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /--timeout needs a positive number/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('corpus-scan dedupes by content and writes counts only', { skip: !existsSync(join(fixtures, 'Flicks.fmp12')) && 'fixtures missing: run npm run fixtures' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-test-'));
  try {
    const src = join(dir, 'in', 'nested');
    mkdirSync(src, { recursive: true });
    copyFileSync(join(fixtures, 'Flicks.fmp12'), join(src, 'Flicks.fmp12'));
    copyFileSync(join(fixtures, 'Flicks.fmp12'), join(dir, 'in', 'copy of Flicks.FMP12'));
    copyFileSync(join(fixtures, 'Charts.fmp12'), join(dir, 'in', 'Charts.fmp12'));
    // The scan's converted copies go to its temp folder: give it one of its own, so a scan running elsewhere at the same time can't be mistaken for a leftover.
    const scratch = join(dir, 'tmp');
    mkdirSync(scratch);
    const r = spawnSync(process.execPath, ['--no-warnings', main, 'corpus-scan', join(dir, 'in'), '--out', join(dir, 'out'), '--convert', '--jobs', '2'], { encoding: 'utf8', env: { ...process.env, TMPDIR: scratch } });
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(readFileSync(join(dir, 'out', 'corpus-report.json'), 'utf8'));
    assert.deepEqual(report.files.found, 3);
    assert.deepEqual(report.files.unique, 2);
    assert.deepEqual(report.status, { ok: 2 });
    assert.deepEqual(report.conversion, { ok: 2, failed: 0, errors: {} });
    assert.ok(report.steps.length && report.functions.length && report.layoutObjects.length);
    const all = readFileSync(join(dir, 'out', 'corpus-report.json'), 'utf8') + readFileSync(join(dir, 'out', 'corpus-report.md'), 'utf8');
    // No file names, table, layout or script names.
    for (const name of ['Flicks', 'Charts', 'nested', 'Movies']) assert.ok(!all.includes(name), name);
    // The converted copies are gone.
    assert.deepEqual(readdirSync(scratch), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dedupe compares only same-size files, by their start and then whole', async () => {
  const { dedupe } = await import('../src/corpus-scan.ts');
  const { writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'corpus-dedupe-'));
  try {
    const big = Buffer.alloc((1 << 20) + 10, 7);
    const other = Buffer.from(big);
    other[other.length - 1] = 8; // same size and first megabyte, different end
    writeFileSync(join(dir, 'a'), big);
    writeFileSync(join(dir, 'b'), big);
    writeFileSync(join(dir, 'c'), other);
    writeFileSync(join(dir, 'd'), 'small');
    const groups = [...(await dedupe(['a', 'b', 'c', 'd'].map((n) => join(dir, n)))).groups.values()];
    assert.deepEqual(groups.map((g) => g.copies).sort(), [1, 1, 2]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('findFiles skips folders it may not read and counts them', { skip: process.getuid?.() === 0 && 'root reads everything' }, async () => {
  const { findFiles } = await import('../src/corpus-scan.ts');
  const { chmodSync, writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'corpus-find-'));
  try {
    mkdirSync(join(dir, 'open'));
    mkdirSync(join(dir, 'closed'));
    writeFileSync(join(dir, 'open', 'a.fmp12'), 'x');
    writeFileSync(join(dir, 'closed', 'b.fmp12'), 'x');
    chmodSync(join(dir, 'closed'), 0);
    const r = findFiles(dir);
    assert.deepEqual(r.paths, [join(dir, 'open', 'a.fmp12')]);
    assert.equal(r.unreadable, 1);
  } finally {
    chmodSync(join(dir, 'closed'), 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('corpus-scan --list scans the listed files, each once, across folders', { skip: !existsSync(join(fixtures, 'Flicks.fmp12')) && 'fixtures missing: run npm run fixtures' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-test-'));
  try {
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'b'));
    copyFileSync(join(fixtures, 'Flicks.fmp12'), join(dir, 'a', 'Flicks.fmp12'));
    copyFileSync(join(fixtures, 'Flicks.fmp12'), join(dir, 'b', 'Flicks copy.fmp12'));
    copyFileSync(join(fixtures, 'Charts.fmp12'), join(dir, 'b', 'Charts.fmp12'));
    copyFileSync(join(fixtures, 'Charts.fmp12'), join(dir, 'b', 'not listed.fmp12'));
    const list = [join(dir, 'a', 'Flicks.fmp12'), join(dir, 'b', 'Flicks copy.fmp12'), join(dir, 'b', 'Charts.fmp12'), join(dir, 'a', '..', 'a', 'Flicks.fmp12'), join(dir, 'gone.fmp12'), join(dir, 'b')];
    writeFileSync(join(dir, 'list.txt'), list.join('\n') + '\n');
    const r = spawnSync(process.execPath, ['--no-warnings', main, 'corpus-scan', '--list', join(dir, 'list.txt'), '--out', join(dir, 'out'), '--jobs', '2'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(readFileSync(join(dir, 'out', 'corpus-report.json'), 'utf8'));
    assert.equal(report.files.found, 3);
    assert.equal(report.files.unique, 2);
    assert.match(r.stderr, /1 folders or files couldn't be read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('what a scan child leaves in its temporary folder is removed with it, killed at the timeout or crashed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-leftovers-'));
  const kept = process.env.TMPDIR;
  try {
    // Every temporary folder the parent and the child make lands in `scratch`.
    const scratch = join(dir, 'scratch');
    mkdirSync(scratch);
    process.env.TMPDIR = scratch;
    const entry = join(dir, 'child.mjs');
    // Plays a conversion: a copy of the records in a temporary folder, then a long wait (timeout) or a crash.
    writeFileSync(entry, `import { mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
      writeFileSync(join(mkdtempSync(join(tmpdir(), 'tabularius-corpus-')), 'converted.sqlite'), 'records');
      if (process.env.CRASH) process.exit(9); else setInterval(() => {}, 1000);`);
    assert.equal((await scanInChild(entry, join(dir, 'nothing.fmp12'), true, 400)).status, 'timeout');
    assert.deepEqual(readdirSync(scratch), []);
    process.env.CRASH = '1';
    assert.equal((await scanInChild(entry, join(dir, 'nothing.fmp12'), true, 5000)).status, 'failed');
    assert.deepEqual(readdirSync(scratch), []);
  } finally {
    delete process.env.CRASH;
    if (kept === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = kept;
    rmSync(dir, { recursive: true, force: true });
  }
});
