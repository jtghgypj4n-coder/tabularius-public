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

test('the home folder is shown as [home], and the frames of a stack are left whole', () => {
  const home = homedir();
  const frame = `    at run (file://${home}/work/server/src/admin.ts:12:3)`;
  const text = redactPaths(`failed ${home}/Library/tabularius/store.db\n${frame}`);
  assert.match(text, /^failed \[home\]\/store\.db\n/);
  assert.ok(text.endsWith(frame));
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
