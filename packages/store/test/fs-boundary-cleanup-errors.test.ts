import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupPath, withFilesystemHook } from '../src/fs-boundary.ts';

for (const code of ['EACCES', 'EBUSY', 'EPERM', 'EIO']) test(`cleanup reports ${code} without replacing the work error`, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cleanup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'partial');
  writeFileSync(path, 'partial');
  const failure = Object.assign(new Error(`cannot remove ${path}`), { code });
  const reported: unknown[] = [];
  const cleanup = cleanupPath(path, { onError: (error) => reported.push(error) });
  const original = new Error('work failed');
  assert.throws(() => withFilesystemHook((event) => {
    if (event.operation === 'remove') throw failure;
  }, () => { try { throw original; } finally { cleanup(); } }), (error) => error === original);
  assert.deepEqual(reported, [failure]);
  assert.equal(existsSync(path), true);
});

test('default cleanup warning omits paths and a broken reporter cannot throw', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cleanup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'partial');
  writeFileSync(path, 'partial');
  const failure = Object.assign(new Error(`cannot remove ${path}`), { code: 'EACCES' });
  const warnings = t.mock.method(console, 'warn', () => {});
  const cleanup = cleanupPath(path);
  withFilesystemHook(() => { throw failure; }, () => assert.doesNotThrow(cleanup));
  assert.equal(warnings.mock.calls.length, 1);
  assert.match(String(warnings.mock.calls[0].arguments[0]), /EACCES/);
  assert.ok(!JSON.stringify(warnings.mock.calls).includes(dir));
  const broken = cleanupPath(path, { onError: () => { throw new Error('report failed'); } });
  withFilesystemHook(() => { throw failure; }, () => assert.doesNotThrow(broken));
  t.mock.method(console, 'warn', () => { throw new Error('logging failed'); });
  withFilesystemHook(() => { throw failure; }, () => assert.doesNotThrow(cleanup));
});

test('strict cleanup retains its own error and never removes a replacement', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cleanup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'partial');
  writeFileSync(path, 'partial');
  const cleanup = cleanupPath(path), failure = Object.assign(new Error('removal failed'), { code: 'EACCES' });
  assert.throws(() => withFilesystemHook(() => { throw failure; }, () => cleanup({ throwOnError: true })), (e) => e === failure);
  renameSync(path, join(dir, 'held'));
  writeFileSync(path, 'replacement');
  cleanup({ throwOnError: true });
  assert.equal(existsSync(path), true);
});

for (const code of ['ENOENT', 'ESTALE', 'ENOTDIR']) test(`cleanup ignores expected ${code}`, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cleanup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'partial');
  writeFileSync(path, 'partial');
  const cleanup = cleanupPath(path, { onError: () => assert.fail('unexpected report') });
  withFilesystemHook(() => { throw Object.assign(new Error('expected'), { code }); }, () => cleanup({ throwOnError: true }));
});
