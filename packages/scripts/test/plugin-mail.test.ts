// A plug-in that asks for mail sends real messages only where the operator switched sending on (the host sends each one
// and runs the step again), through the host's own mailer, and never from a heldFile employer's file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { stopJavaScript } from '../../store/src/javascript.ts';
import { PluginRegistry, readPlugin } from '../../plugins/src/index.ts';
import { runScript, setCaptureOnlyDefaults } from '../src/index.ts';

setCaptureOnlyDefaults(['Held']);

let dir: string;
let store: Store;
let heldFile: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-plugin-mail-'));
  createStore(join(dir, 'Shop.sqlite'));
  store = new Store(join(dir, 'Shop.sqlite'), 'Shop');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] }]);
  const d = join(dir, 'mailer');
  mkdirSync(d);
  writeFileSync(join(d, 'plugin.json'), JSON.stringify({
    id: 'org.example.mailer', name: 'Mailer', version: '1.0.0', api: '^1.0', publisher: 'Example', main: 'main.js',
    permissions: { mail: true }, functions: [{ name: 'Mail_Send', min: 2, max: 2 }],
  }));
  writeFileSync(join(d, 'main.js'), `const functions = {
    Mail_Send: (to, subject) => tabularius.mail.send({ from: 'Ann <ann@shop.example>', to, subject, body: 'Hi' }) ? 'sent' : 'no',
  };`);
  const reg = new PluginRegistry();
  const { manifest, calls } = readPlugin(d);
  reg.install(manifest, calls);
  reg.enable('Shop', manifest.id);
  store.plugin = reg.lookup('Shop');
  store.pluginsUseMail = () => reg.usesMail('Shop');
  // A heldFile employer's file (named capture-only) with the same plug-in on.
  createStore(join(dir, 'Held_Test.sqlite'));
  heldFile = new Store(join(dir, 'Held_Test.sqlite'), 'Held_Test');
  heldFile.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] }]);
  reg.enable('Held_Test', 'org.example.mailer');
  heldFile.plugin = reg.lookup('Held_Test');
  heldFile.pluginsUseMail = () => reg.usesMail('Held_Test');
});
after(async () => {
  await stopJavaScript();
  store?.close();
  heldFile?.close();
  rmSync(dir, { recursive: true });
});

function script(text: string): Script {
  const steps = parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
    .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }));
  return { id: 9999, name: 'test', steps } as Script;
}

import type { OutgoingMail } from '../src/index.ts';
const run = async (formula: string, opts: Record<string, unknown>) =>
  (await runScript(store, script(`Exit Script [ Text Result: ${formula} ]`), { layout: 'Items', ...opts })).result;
const mailer = (fail?: string) => {
  const sent: OutgoingMail[] = [];
  return { sent, mail: async (m: OutgoingMail) => { if (fail) throw new Error(fail); sent.push(m); } };
};

test('a plug-in sends its message once, through the host, and the operator\'s account decides who it is from', async () => {
  const m = mailer();
  assert.equal(await run('Mail_Send ( "bob@client.example" ; "Hello" ) & Mail_Send ( "bob@client.example" ; "Hello" )', { mail: m.mail }), 'sentsent');
  assert.equal(m.sent.length, 1);
  assert.deepEqual([m.sent[0].to, m.sent[0].subject, m.sent[0].text, m.sent[0].fromName, m.sent[0].replyTo], [['bob@client.example'], 'Hello', 'Hi', 'Ann', 'ann@shop.example']);
  // A later step sends afresh.
  assert.equal(await run('Mail_Send ( "bob@client.example" ; "Hello" )', { mail: m.mail }), 'sent');
  assert.equal(m.sent.length, 2);
});

test('a message the host refuses or can\'t send gives "?"', async () => {
  assert.equal(await run('Mail_Send ( "bob@client.example" ; "x" )', { mail: mailer('connection refused').mail }), '?');
  assert.equal(await run('Mail_Send ( "bob@client.example" ; "x" )', { mail: async () => 'nothing is sent while a held file is here' }), '?');
});

test('without sending switched on, or in outbound test mode, nothing is sent', async () => {
  const m = mailer();
  assert.equal(await run('Mail_Send ( "bob@client.example" ; "x" )', {}), '?');
  const outbox: unknown[] = [];
  assert.equal(await run('Mail_Send ( "bob@client.example" ; "x" )', { mail: m.mail, outbound: { allowHosts: [], record: (e: unknown) => { outbox.push(e); } } }), 'sent');
  assert.equal(m.sent.length, 0);
  assert.equal(outbox.length, 1);
});

test('a heldFile employer\'s file never sends mail through a plug-in', async () => {
  const m = mailer();
  const r = await runScript(heldFile, script('Exit Script [ Text Result: Mail_Send ( "bob@client.example" ; "x" ) ]'), { layout: 'Items', mail: m.mail });
  assert.equal(r.result, '?');
  assert.equal(m.sent.length, 0);
});
