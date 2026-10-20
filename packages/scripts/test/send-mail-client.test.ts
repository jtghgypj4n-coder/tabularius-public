// Send Mail via the e-mail client: in the web client the person's own mail app opens with the message (a mailto:
// link), as WebDirect does. With no one's browser to open it in, and via SMTP, it stays error 3.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mail-'));
  createStore(join(dir, 'M.sqlite'));
  store = new Store(join(dir, 'M.sqlite'), 'M');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Email' }, { name: 'Name' }] }] as never);
  store.create('People', { Email: 'ann@example.com', Name: 'Ann & co' });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

const script = (text: string) => ({
  id: 1, name: 'mail',
  steps: parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params })),
} as Script);

const step = 'Send Mail [ Send via E-mail Client ; With dialog: On ; To: People::Email & "¶b@example.com" ; CC: "c@example.com" ; Subject: "Hi " & People::Name ; Message: "Line 1¶Line 2" ; Attachment: "$file" ]';

test('Send Mail via the e-mail client opens the person\'s mail app with the message', async () => {
  const r = await runScript(store, script(`${step}\nExit Script [ Text Result: Get ( LastError ) ]`), { layout: 'People', downloads: true });
  assert.equal(r.result, '0');
  assert.deepEqual(r.actions.filter((a) => a.step === 'Open URL').map((a) => a.url),
    ['mailto:ann%40example.com,b%40example.com?cc=c%40example.com&subject=Hi%20Ann%20%26%20co&body=Line%201%0D%0ALine%202']);
});

test('Send Mail with no browser to open, or via SMTP, is error 3', async () => {
  const none = await runScript(store, script(`${step}\nExit Script [ Text Result: Get ( LastError ) ]`), { layout: 'People' });
  assert.equal(none.result, '3');
  const smtp = await runScript(store, script('Send Mail [ Send via SMTP Server ; With dialog: Off ; To: "a@example.com" ]\nExit Script [ Text Result: Get ( LastError ) ]'), { layout: 'People', downloads: true });
  assert.equal(smtp.result, '3');
  assert.equal(smtp.actions.filter((a) => a.step === 'Open URL').length, 0);
});
