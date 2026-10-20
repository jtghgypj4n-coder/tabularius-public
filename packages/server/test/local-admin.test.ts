import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCAL_FILE, isLocalAdmin, localAccess, localUrl, openLocalAccess } from '../src/local-admin.ts';

// The password-free admin channel for commands run on the server machine: a random token in a file only the
// server's user can read, accepted in x-tabularius-local.

function folder(): { dir: string; file: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-local-admin-'));
  return { dir, file: join(dir, LOCAL_FILE), done: () => rmSync(dir, { recursive: true, force: true }) };
}
const tokenOf = (file: string) => (JSON.parse(readFileSync(file, 'utf8')) as { token: string }).token;

test('the token in the file is accepted, and only that exact token', () => {
  const f = folder();
  try {
    openLocalAccess(f.dir, 'http://127.0.0.1:8080');
    const t = tokenOf(f.file);
    assert.equal(t.length, 64);
    assert.match(t, /^[0-9a-f]{64}$/);
    assert.equal(isLocalAdmin(f.dir, t), true);
    assert.equal(isLocalAdmin(f.dir, t.slice(0, 63) + (t.endsWith('0') ? '1' : '0')), false);
    assert.equal(isLocalAdmin(f.dir, t.toUpperCase() === t ? t.toLowerCase() : t.toUpperCase()), false);
  } finally { f.done(); }
});

test('a header that is missing, repeated, not text, or not 64 characters is refused', () => {
  const f = folder();
  try {
    openLocalAccess(f.dir, 'http://127.0.0.1:8080');
    const t = tokenOf(f.file);
    assert.equal(isLocalAdmin(f.dir, undefined), false);
    assert.equal(isLocalAdmin(f.dir, [t]), false);
    assert.equal(isLocalAdmin(f.dir, [t, t]), false);
    assert.equal(isLocalAdmin(f.dir, ''), false);
    assert.equal(isLocalAdmin(f.dir, t.slice(1)), false);
    assert.equal(isLocalAdmin(f.dir, t + '0'), false);
    assert.equal(isLocalAdmin(f.dir, (5 as unknown) as string), false);
  } finally { f.done(); }
});

test('a 64-character header with characters past ASCII is refused, not an error', () => {
  const f = folder();
  try {
    openLocalAccess(f.dir, 'http://127.0.0.1:8080');
    // Node hands header values over as latin1, so é (one character) is two bytes once encoded as UTF-8.
    assert.equal(isLocalAdmin(f.dir, 'é'.repeat(64)), false);
    assert.equal(isLocalAdmin(f.dir, '0'.repeat(63) + 'é'), false);
  } finally { f.done(); }
});

test('no file, a file that is not JSON, and a file with no usable token let nobody in', () => {
  const f = folder();
  try {
    const guess = 'a'.repeat(64);
    assert.equal(isLocalAdmin(f.dir, guess), false);
    writeFileSync(f.file, '{ half');
    assert.equal(isLocalAdmin(f.dir, guess), false);
    for (const body of ['null', '[]', '{}', '{"token":null}', '{"token":5}', `{"token":["${'a'.repeat(64)}"]}`, `{"token":[${Array(64).fill(97).join(',')}]}`, '{"token":"short"}']) {
      writeFileSync(f.file, body);
      // A new mtime each time, so the cache never answers for an earlier body.
      utimesSync(f.file, new Date(), new Date(Date.now() + Math.floor(Math.random() * 1e6) + 1000));
      assert.equal(isLocalAdmin(f.dir, guess), false, body);
    }
  } finally { f.done(); }
});

test('a file replaced while the cache is warm is read again: the old token stops working and the new one works', () => {
  const f = folder();
  try {
    const stop = openLocalAccess(f.dir, 'http://127.0.0.1:8080');
    const first = tokenOf(f.file);
    assert.equal(isLocalAdmin(f.dir, first), true);
    // A restarted server writes a new file; even with the old modification time put back (a filesystem that keeps
    // it to the second) the file is read again, because its inode or size differs.
    const when = statSync(f.file).mtime;
    stop();
    writeFileSync(join(f.dir, 'other'), 'x');
    openLocalAccess(f.dir, 'http://127.0.0.1:8080');
    utimesSync(f.file, when, when);
    const second = tokenOf(f.file);
    assert.notEqual(second, first);
    assert.equal(isLocalAdmin(f.dir, first), false);
    assert.equal(isLocalAdmin(f.dir, second), true);
    // And removed: nothing is accepted, though the token was cached.
    rmSync(f.file);
    assert.equal(isLocalAdmin(f.dir, second), false);
  } finally { f.done(); }
});

test('the file is private (mode 0600) even where an older, wider one was', { skip: process.platform === 'win32' }, () => {
  const f = folder();
  try {
    writeFileSync(f.file, 'old', { mode: 0o644 });
    openLocalAccess(f.dir, 'http://127.0.0.1:8080');
    assert.equal(statSync(f.file).mode & 0o777, 0o600);
  } finally { f.done(); }
});

test('the file names the process, the address and the token, and localAccess reads it back', () => {
  const f = folder();
  try {
    assert.equal(localAccess(f.dir), undefined);
    openLocalAccess(f.dir, 'https://127.0.0.1:8443');
    const access = localAccess(f.dir)!;
    assert.equal(access.pid, process.pid);
    assert.equal(access.url, 'https://127.0.0.1:8443');
    assert.equal(access.token, tokenOf(f.file));
    writeFileSync(f.file, '{ half');
    assert.equal(localAccess(f.dir), undefined);
  } finally { f.done(); }
});

test('removing the file removes only the token that server wrote', () => {
  const f = folder();
  try {
    const stopFirst = openLocalAccess(f.dir, 'http://127.0.0.1:1');
    const firstToken = tokenOf(f.file);
    // A second server on the same folder wrote its own file over it.
    const stopSecond = openLocalAccess(f.dir, 'http://127.0.0.1:2');
    const secondToken = tokenOf(f.file);
    assert.notEqual(firstToken, secondToken);
    stopFirst();
    assert.equal(tokenOf(f.file), secondToken, 'the first server leaves the second\'s file');
    stopSecond();
    assert.throws(() => statSync(f.file), /ENOENT/);
    // Removing again, or removing a file that was never there, is not an error.
    stopSecond();
    stopFirst();
    writeFileSync(f.file, '{ half');
    stopSecond();
    assert.equal(readFileSync(f.file, 'utf8'), '{ half');
  } finally { f.done(); }
});

test('localUrl: any-address listeners are reached on 127.0.0.1, IPv6 addresses are bracketed, TLS is https', () => {
  assert.equal(localUrl(undefined, 8080, false), 'http://127.0.0.1:8080');
  assert.equal(localUrl('0.0.0.0', 8080, false), 'http://127.0.0.1:8080');
  assert.equal(localUrl('::', 8080, true), 'https://127.0.0.1:8080');
  assert.equal(localUrl('[::]', 8080, true), 'https://127.0.0.1:8080');
  assert.equal(localUrl('192.168.1.5', 9, false), 'http://192.168.1.5:9');
  assert.equal(localUrl('::1', 9, false), 'http://[::1]:9');
  assert.equal(localUrl('[::1]', 9, false), 'http://[::1]:9');
  assert.equal(localUrl('files.example.com', 443, true), 'https://files.example.com:443');
});
