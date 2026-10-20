// test-scripts never runs scripts with credentials written into them, and
// --skip is a glob that must match something.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { embeddedCredential, skipMatcher, testScripts, unmatchedSkips } from '../src/index.ts';

let dir: string;
let store: Store;
// Built from parts so no credential-shaped literal sits in this file.
const AWS = 'AKIA' + 'Z'.repeat(16);

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-skip-creds-'));
  createStore(join(dir, 'C.sqlite'));
  store = new Store(join(dir, 'C.sqlite'), 'C');
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Notes', type: 'text' }] }]);
  store.applyDesign([
    { op: 'createScript', name: 'Orders - Upload to Amazon', text: `Set Variable [ $key ; Value: "${AWS}" ]\nSet Field [ T::Notes ; "uploaded" ]` },
    { op: 'createScript', name: 'Send Email via SMTP', text: 'Set Variable [ $SenderUserName ; Value: "someone" ]\nSet Variable [ $Password ; Value: "hunter22" ]\nExit Script [ Text Result: "sent" ]' },
    { op: 'createScript', name: 'Basic auth', text: 'Insert from URL [ $r ; "https://user:pw123@api.example.com/x" ]' },
    { op: 'createScript', name: 'Calls it', text: 'Perform Script [ “Orders - Upload to Amazon” ]\nExit Script [ Text Result: Get ( LastError ) ]' },
    { op: 'createScript', name: 'Asks for a password', text: 'Set Variable [ $Password ; Value: T::Notes ]\nSet Variable [ $prompt ; Value: "Enter your password" ]\nExit Script [ Text Result: "fine" ]' },
    { op: 'createScript', name: 'Upload to Amazon', text: 'Exit Script [ Text Result: "x" ]' },
  ]);
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

test('scripts with credentials in their steps are found, without the secret in the answer', () => {
  const by = (name: string) => embeddedCredential(store.schema.scripts.find((s) => s.name === name)!);
  assert.equal(by('Orders - Upload to Amazon'), 'an AWS access key');
  assert.equal(by('Send Email via SMTP'), 'a password or key set to a value written into the script');
  assert.equal(by('Basic auth'), 'a user name and password in a web address');
  // A password read from a field, or the word in a prompt, is not a credential.
  assert.equal(by('Asks for a password'), undefined);
  assert.equal(by('Calls it'), undefined);
});

test('test-scripts lists them as skipped and never runs them, even when called or named', async () => {
  const notes = () => store.findIds('T').length;
  const before = notes();
  const results = await testScripts(store, { scripts: ['Orders - Upload to Amazon', 'Send Email via SMTP', 'Basic auth', 'Calls it', 'Asks for a password'] });
  const by = Object.fromEntries(results.map((r) => [r.script, r]));
  for (const name of ['Orders - Upload to Amazon', 'Send Email via SMTP', 'Basic auth']) {
    assert.equal(by[name].outcome, 'skipped');
    assert.match(by[name].message ?? '', /^contains embedded credentials \(.+\); not run$/);
    assert.equal(by[name].steps, 0);
  }
  assert.doesNotMatch(JSON.stringify(results), new RegExp(`${AWS}|hunter22|pw123`));
  // Called from another script it's still not run.
  assert.deepEqual(by['Calls it'].skipped, ['Orders - Upload to Amazon']);
  assert.equal(by['Asks for a password'].outcome, 'ok');
  assert.equal(notes(), before);
});

test('--skip is a glob: * anywhere, any case', () => {
  const m = skipMatcher(['*upload to amazon*']);
  assert.equal(m('Orders - Upload to Amazon'), true);
  assert.equal(m('Upload to Amazon (Invoice)'), true);
  assert.equal(m('Download from Amazon'), false);
  assert.equal(skipMatcher(['Upload to Amazon*'])('Orders - Upload to Amazon'), false);
  assert.equal(skipMatcher(['a.b (c)'])('a.b (c)'), true);
  assert.equal(skipMatcher(['a.b (c)'])('aXb (c)'), false);
  assert.equal(skipMatcher(['exact'])('Exact'), true);
});

test('a --skip pattern that matches no script is reported', () => {
  const names = store.schema.scripts.map((s) => s.name);
  assert.deepEqual(unmatchedSkips(names, ['*Upload to Amazon*', 'Upload to Amzon*', 'Calls it']), ['Upload to Amzon*']);
});
