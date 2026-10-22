import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSecretFile } from '../src/secret-file.ts';

const posix = process.platform === 'win32' ? { skip: 'file modes' } : {};

test('a private token file is trimmed, including a trailing newline', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-secret-file-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'token');
  writeFileSync(file, '  correct-horse-battery  \n', { mode: 0o600 });
  assert.equal(readSecretFile(file, '--mcp-token-file'), 'correct-horse-battery');
});

test('a file readable by others is refused without revealing its contents', posix, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-secret-file-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'token');
  const secret = 'correct-horse-battery';
  writeFileSync(file, secret);
  chmodSync(file, 0o644);
  assert.throws(() => readSecretFile(file, '--mcp-token-file'), (e: Error) => e.message.includes(`chmod 600 ${file}`) && !e.message.includes(secret));
});

test('missing, empty, whitespace-only, directory, and multiline token files are refused', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-secret-file-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'token');
  assert.throws(() => readSecretFile(file, '--mcp-token-file'), (e: Error) => e.message === `serve: --mcp-token-file ${file} does not exist`);
  writeFileSync(file, '', { mode: 0o600 });
  assert.throws(() => readSecretFile(file, '--mcp-token-file'), /is empty/);
  writeFileSync(file, '  \n\t  ');
  assert.throws(() => readSecretFile(file, '--mcp-token-file'), /is empty/);
  const folder = join(dir, 'folder');
  mkdirSync(folder);
  assert.throws(() => readSecretFile(folder, '--mcp-token-file'), /regular file/);
  const secret = 'correct-horse-battery';
  writeFileSync(file, `${secret}\nsecond-line`);
  assert.throws(() => readSecretFile(file, '--mcp-token-file'), (e: Error) => /one line/.test(e.message) && !e.message.includes(secret) && !e.message.includes('second-line'));
});

test('a symlink to a private regular file is followed, as the AI key reader does', { skip: process.platform === 'win32' ? 'creating symlinks requires Windows privileges' : false }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-secret-file-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const target = join(dir, 'target');
  const link = join(dir, 'link');
  writeFileSync(target, 'correct-horse-battery\n', { mode: 0o600 });
  symlinkSync(target, link);
  assert.equal(readSecretFile(link, '--token-file'), 'correct-horse-battery');
});
