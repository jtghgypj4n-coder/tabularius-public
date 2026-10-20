import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isLocalAdmin, openLocalAccess, LOCAL_FILE } from '../src/local-admin.ts';
import { MailLimit, MAIL_LIMIT_FILE } from '../src/mail-limit.ts';

test('unchanged local bearer files are cached; repeated checks do not reread the secret', (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mutation-local-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  openLocalAccess(dir, 'http://localhost:8080');
  const path = join(dir, LOCAL_FILE);
  const token = JSON.parse(fs.readFileSync(path, 'utf8')).token as string;
  const read = fs.readFileSync;
  let reads = 0;
  const mock = t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof read>) => {
    if (args[0] === path) reads++;
    return Reflect.apply(read, fs, args);
  });
  syncBuiltinESMExports();
  try {
    assert.equal(isLocalAdmin(dir, token), true);
    const initial = reads;
    assert.ok(initial > 0);
    for (let i = 0; i < 10; i++) assert.equal(isLocalAdmin(dir, token), true);
    assert.equal(reads, initial, 'unchanged credentials must not cause a disk read per request');
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
});

test('mail counts reject nonfinite persisted numbers and normalize absent file maps', (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mutation-mail-data-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, MAIL_LIMIT_FILE), problems: string[] = [];
  const limit = new MailLimit(path, (message) => problems.push(message));
  limit.clock = () => 1000; limit.perHour = 1; limit.perFile = 1;
  // JSON numbers can overflow to Infinity even though JSON.stringify never emits Infinity.
  fs.writeFileSync(path, '{"all":[1e400],"files":{"a":[1e400]}}');
  assert.equal(limit.take(['A']), undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(path, 'utf8')), { all: [1000], files: { a: [1000] } });
  fs.writeFileSync(path, '{"all":[],"files":null}');
  assert.equal(limit.take(['A']), undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(path, 'utf8')), { all: [1000], files: { a: [1000] } });
  assert.deepEqual(problems, []);
});

test('mail write failures preserve the previous count instead of treating it as corrupt JSON', (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mutation-mail-write-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, MAIL_LIMIT_FILE), problems: string[] = [];
  const limit = new MailLimit(path, (message) => problems.push(message));
  assert.equal(limit.take(['A']), undefined);
  const before = fs.readFileSync(path, 'utf8');
  const rename = fs.renameSync;
  const mock = t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
    if (to === path) throw Object.assign(new Error('simulated disk failure'), { code: 'EIO' });
    return rename(from, to);
  });
  syncBuiltinESMExports();
  try { limit.take(['A']); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(fs.readFileSync(path, 'utf8'), before, 'a failed publish cannot delete the last complete state');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /could not be saved/);
});

test('mail lock contention refuses the send without granting or persisting another allowance', (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mutation-mail-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, MAIL_LIMIT_FILE), limit = new MailLimit(path);
  assert.equal(limit.take(['A']), undefined);
  const before = fs.readFileSync(path, 'utf8');
  const exec = DatabaseSync.prototype.exec;
  const mock = t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
    if (sql === 'BEGIN EXCLUSIVE') throw Object.assign(new Error('database is locked'), { errcode: 5 });
    return exec.call(this, sql);
  });
  try { assert.equal(limit.take(['A']), 'mail count is busy; nothing was sent'); }
  finally { mock.mock.restore(); }
  assert.equal(fs.readFileSync(path, 'utf8'), before);
});
