import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeExistingPath, safeWritePath } from '../src/safe-path.ts';
import { sanitize } from '../src/fmexport.ts';

for (const name of ['CON', 'nul.txt', 'COM1.csv', 'LPT²', '..', '.', 'trailing.', 'trailing ']) {
  test(`export names are portable: ${name}`, () => {
    const result = sanitize(name);
    assert.doesNotMatch(result, /^(?:CON|NUL|COM1|LPT2)(?:\.|$)/i);
    assert.doesNotMatch(result, /[. ]$/);
    assert.ok(result.length > 0);
  });
}

test('stored paths accept either separator and refuse Windows special paths before creating folders', { skip: process.platform !== 'win32' && 'Windows path rules apply only on Windows' }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-path-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'nested'));
  writeFileSync(join(root, 'nested', 'file.txt'), 'synthetic');
  assert.equal(safeExistingPath(root, 'nested\\file.txt'), safeExistingPath(root, 'nested/file.txt'));
  for (const rel of ['C:escape', 'C:\\escape', '\\\\host\\share\\escape', '\\rooted', 'nested/../NUL.txt', 'dir/CON', 'file:stream', 'tail.']) {
    const newRoot = join(root, 'uncreated');
    assert.equal(safeWritePath(newRoot, rel), undefined, rel);
    assert.equal(existsSync(newRoot), false, rel);
  }
});

test('stored paths on other systems keep names that are only special on Windows', (t) => {
  if (process.platform === 'win32') return t.skip('POSIX file names');
  const root = mkdtempSync(join(tmpdir(), 'tabularius-path-posix-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(safeExistingPath(root, '.', undefined), safeExistingPath(root, './', undefined));
  assert.ok(safeExistingPath(root, '.'));
  for (const name of ['Q1?.pdf', 'a"b.pdf', 'aux.txt', 'trailing ', 'back\\slash']) {
    const file = safeWritePath(root, name);
    assert.ok(file, name);
    writeFileSync(file, 'synthetic');
    assert.equal(safeExistingPath(root, name), file, name);
  }
});

import path from 'node:path';
import { commonParent, withinPath, checkPathLength, storageRelative } from '../src/portable-path.ts';
import { writeDurable, type DurableFs } from '../src/durable.ts';

test('relative storage validation on Windows rejects drives, devices, streams and escapes', () => {
  const paths = path.win32;
  assert.equal(storageRelative('one\\two/file', paths), 'one\\two\\file');
  assert.equal(storageRelative('.', paths), '.');
  assert.equal(storageRelative('./one', paths), 'one');
  for (const value of ['..\\escape', '../escape', 'C:relative', 'C:\\abs', '//host/share', 'file:ads', 'NUL.txt', 'trailing ', 'a//b'])
    assert.equal(storageRelative(value, paths), undefined, value);
});
test('relative storage validation elsewhere keeps names that are only special on Windows', () => {
  const paths = path.posix;
  assert.equal(storageRelative('.', paths), '.');
  assert.equal(storageRelative('one/file', paths), 'one/file');
  for (const value of ['Q1?.pdf', 'a"b.pdf', 'aux.txt', 'trailing ', 'back\\slash', 'file:ads'])
    assert.equal(storageRelative(value, paths), value, value);
  for (const value of ['', '/etc/passwd']) assert.equal(storageRelative(value, paths), undefined, value);
});
test('Windows containment respects drive, UNC share and case boundaries', () => {
  assert.equal(withinPath('C:\\Data', 'c:\\data\\file', path.win32), true);
  assert.equal(withinPath('C:\\Data', 'C:\\Database\\file', path.win32), false);
  assert.equal(withinPath('C:\\Data', 'D:\\Data\\file', path.win32), false);
  assert.equal(withinPath('\\\\server\\share', '\\\\server\\other\\file', path.win32), false);
  assert.equal(commonParent(['C:\\Data', 'D:\\Data'], path.win32), undefined);
  assert.equal(commonParent(['\\\\server\\share\\a', '\\\\server\\other\\b'], path.win32), undefined);
});
test('Windows path limit includes staging suffixes and gives an actionable error', () => {
  const file = 'C:\\' + 'a'.repeat(246);
  assert.doesNotThrow(() => checkPathLength(file, 10, 'win32', path.win32));
  assert.throws(() => checkPathLength(file, 11, 'win32', path.win32), /shorter.*folder/);
  assert.doesNotThrow(() => checkPathLength(file, 100, 'linux', path.posix));
});
for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
  test(`atomic publication retries ${code} without removing the destination`, () => {
    let tries = 0;
    const calls: string[] = [];
    const fs: DurableFs = {
      statSync: (p) => ({ isDirectory: () => p === '/data' }),
      openSync: (p) => { calls.push(p); return 1; }, fsyncSync() {}, closeSync() {},
      renameSync: () => { if (++tries < 3) throw Object.assign(new Error('locked'), { code }); },
    };
    writeDurable('/data/staged', '/data/live', fs, 'win32', () => {});
    assert.equal(tries, 3);
    assert.deepEqual(calls, ['/data/staged']);
    tries = 0;
    fs.renameSync = () => { tries++; throw Object.assign(new Error('locked'), { code }); };
    assert.throws(() => writeDurable('/data/staged', '/data/live', fs, 'win32', () => {}), { code });
    assert.equal(tries, 4);
    tries = 0;
    assert.throws(() => writeDurable('/data/staged', '/data/live', fs, 'linux', () => {}), { code });
    assert.equal(tries, 1);
  });
}

import { createStore, Store, fmExport, exportSql } from '../src/index.ts';
import { readJsonStateSync } from '../src/durable.ts';

test('exports retain distinct portable paths for colliding and reserved table names', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-export-path-'));
  createStore(join(dir, 'store.sqlite'));
  const store = new Store(join(dir, 'store.sqlite'), 'Generated');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  for (const name of ['CON', '_CON', 'A B', 'A_B']) {
    store.applyDesign([{ op: 'createTable', name, fields: [{ name: 'Doc', type: 'container' }] }]);
    const row = store.create(name, {});
    store.setContainer(name, Number(row.recordId), 'Doc', 1, { filename: 'NUL.txt', mime: 'text/plain', data: Buffer.from(name) });
  }
  const exported = fmExport(store).files;
  assert.equal(new Set(exported.map((file) => file.path.toLowerCase())).size, exported.length);
  for (const file of exported) assert.ok(storageRelative(file.path, path.win32), file.path);
  const paths: string[] = [];
  exportSql(store, { write() {}, file(file) { paths.push(file); } });
  assert.equal(paths.length, 4);
  assert.equal(new Set(paths.map((p) => p.toLowerCase())).size, paths.length);
  for (const p of paths) assert.ok(storageRelative(p, path.win32), p);
});
test('JSON state accepts CRLF and the UTF-8 BOM written by Windows editors', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-json-crlf-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.json');
  writeFileSync(file, '\uFEFF{\r\n "value": 1\r\n}\r\n');
  assert.deepEqual(readJsonStateSync(file, { platform: 'win32' }), { value: 1 });
});

import { checkSqlExportPath } from '../src/portable-path.ts';
test('SQL export checks output and worst-case sidecar paths before opening a file', () => {
  assert.doesNotThrow(() => checkSqlExportPath('C:\\Exports\\test.sql', 'win32'));
  assert.throws(() => checkSqlExportPath('C:\\Exports\\CON.sql', 'win32'), /portable/);
  assert.throws(() => checkSqlExportPath('C:\\' + 'a'.repeat(140) + '\\test.sql', 'win32'), /shorter.*folder/);
});

import { renameFile } from '../src/file-ops.ts';
for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
  test(`asynchronous log rotation retries ${code} without discarding the destination`, async () => {
    let calls = 0;
    const delays: number[] = [];
    const move = async () => { if (++calls < 4) throw Object.assign(new Error('locked'), { code }); };
    await renameFile('current', 'previous', 'win32', move, async (ms) => { delays.push(ms); });
    assert.equal(calls, 4);
    assert.deepEqual(delays, [25, 50, 75]);
    calls = 0;
    await assert.rejects(renameFile('current', 'previous', 'win32', async () => {
      calls++; throw Object.assign(new Error('still locked'), { code });
    }, async () => {}), { code });
    assert.equal(calls, 4);
  });
}

import { parseDelimited } from '../src/delimited.ts';
import { parseScriptText } from '../src/script-text.ts';
test('CSV and parameterised script text already accept CRLF without losing quoted line breaks', (t) => {
  assert.deepEqual(parseDelimited('\uFEFFname,value\r\n"one\r\ntwo",3\r\n', ',', true), [['name', 'value'], ['one\r\ntwo', '3']]);
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-script-crlf-'));
  createStore(join(dir, 'store.sqlite'));
  const store = new Store(join(dir, 'store.sqlite'), 'Generated');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const script = 'Set Variable [ $n ; Value: 1 ]\nExit Script [ Text Result: $n ]';
  assert.deepEqual(parseScriptText(script.replaceAll('\n', '\r\n'), store.schema), parseScriptText(script, store.schema));
});
