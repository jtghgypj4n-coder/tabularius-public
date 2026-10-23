import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { faultLog, redactPaths } from '../src/fault-log.ts';

test('a logged fault hides the folders of a path and keeps the file name', () => {
  const lines: unknown[] = [];
  const log = faultLog((...args) => lines.push(...args), () => 0);
  log(new Error('ENOENT: no such file, open /var/lib/tabularius/data/Customers.fmp12'));
  const text = String(lines[0]);
  assert.match(text, /ENOENT: no such file, open \[path\]\/Customers\.fmp12/);
  assert.doesNotMatch(text, /\/var\/lib|\/tabularius\/data/);
});

test('the home folder is shown as [home], and a stack frame keeps its function, file name and line:column', () => {
  const home = homedir();
  const text = redactPaths(`failed ${home}/Library/tabularius/store.db\n    at run (file://${home}/work/server/src/admin.ts:12:3)\n    at async /opt/tabularius/server/src/index.ts:650:13`);
  assert.equal(text, 'failed [home]/store.db\n    at run ([home]/admin.ts:12:3)\n    at async [path]/index.ts:650:13');
});

test('a frame never shows the install folder', () => {
  const lines: unknown[] = [];
  const error = new Error('boom');
  error.stack = 'Error: boom\n    at check (file:///srv/tabularius/packages/server/src/admin.ts:8:2)';
  faultLog((...args) => lines.push(...args), () => 0)(error);
  assert.equal(String(lines[0]), 'Error: boom\n    at check ([path]/admin.ts:8:2)');
});

test('UNC paths, double-slash paths and C:/ paths lose their folders', () => {
  assert.equal(redactPaths('open \\\\fileserver\\share\\Data\\a.fmp12 failed'), 'open [path]\\a.fmp12 failed');
  assert.equal(redactPaths('open //srv/data/a.fmp12 failed'), 'open [path]/a.fmp12 failed');
  assert.equal(redactPaths('open C:/Program Files/App/a.fmp12 failed'), 'open [path]\\a.fmp12 failed');
  assert.equal(redactPaths('open C:\\Program Files\\My Data\\a.db'), 'open [path]\\a.db');
});

test('folder names with spaces are hidden, quoted or not', () => {
  assert.equal(redactPaths('cannot read /Users/sam/My Data/Reports/a.csv now'), 'cannot read [path]/a.csv now');
  assert.equal(redactPaths(`cannot read '/var/lib/my data/old copy/a b.csv' now`), `cannot read '[path]/a b.csv' now`);
  assert.equal(redactPaths('cannot read "C:\\Users\\sam\\my files\\a b.db" now'), 'cannot read "[path]\\a b.db" now');
});

test('the home folder matches whole names only', () => {
  const home = homedir();
  const longer = `${home}x/data/file.db`;
  assert.ok(!redactPaths(`open ${longer}`).includes('[home]'));
  assert.equal(redactPaths(`open ${longer}`), 'open [path]/file.db');
});

test('a Windows path loses its folders too', () => {
  assert.equal(redactPaths('cannot open C:\\Users\\sam\\Data\\file.fmp12 now'), 'cannot open [path]\\file.fmp12 now');
});

test('a URL, a single-folder name and plain text are left alone', () => {
  const text = 'GET https://example.test/a/b/c failed; the /tmp folder and a/b relative text stay, and 1/2/3 too';
  assert.equal(redactPaths(text), text);
});

test('a credential in the message is still hidden alongside the path', () => {
  const secret = ['sk', 'test', 'abc123'].join('-');
  const lines: unknown[] = [];
  faultLog((...args) => lines.push(...args), () => 0)(new Error(`open /srv/app/private/file.db api_key=${secret}`));
  const text = String(lines[0]);
  assert.doesNotMatch(text, new RegExp(secret));
  assert.doesNotMatch(text, /\/srv\/app/);
});
