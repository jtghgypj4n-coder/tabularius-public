// Send Mail via SMTP with sending switched on (serve --send-mail): the message goes to the recipients the
// script names, through the operator's account and from its address; never from a capture-only file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as tcpServer, type Server as TcpServer } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, setCaptureOnlyDefaults, type OutboundTest, type OutboxEntry, type OutgoingMail, type RunOptions } from '../../scripts/src/index.ts';
import { mailTransport, MAIL_RECIPIENT_LIMIT } from '../src/smtp.ts';
import { Host } from '../src/host.ts';
import { PluginRegistry, readPlugin } from '../../plugins/src/index.ts';
import { stopJavaScript } from '../../store/src/javascript.ts';

// No file is capture-only by default; this test names the ones it holds back.
setCaptureOnlyDefaults(['Held']);

let dir: string;
let docs: string;
let store: Store;

// A local SMTP server that records every conversation (no STARTTLS: allowed only for this machine).
interface Conversation { lines: string[]; rcpt: string[]; data: string }
let smtp: TcpServer;
let smtpPort: number;
const conversations: Conversation[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-send-mail-'));
  docs = join(dir, 'Documents');
  mkdirSync(docs);
  writeFileSync(join(docs, 'invoice.pdf'), '%PDF-1.4 test');
  createStore(join(dir, 'M.sqlite'));
  store = new Store(join(dir, 'M.sqlite'), 'M');
  store.applyDesign([{ op: 'createTable', name: 'Clients', fields: [{ name: 'Name', type: 'text' }, { name: 'Email', type: 'text' }] }]);
  store.create('Clients', { Name: 'Real Client', Email: 'Real Client <client@customer.example>' });

  smtp = tcpServer((socket) => {
    const c: Conversation = { lines: [], rcpt: [], data: '' };
    conversations.push(c);
    let inData = false;
    let buffer = '';
    socket.write('220 test ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          c.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          socket.write('250 queued\r\n');
          continue;
        }
        const nl = buffer.indexOf('\r\n');
        if (nl < 0) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        c.lines.push(line);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') socket.write('250-test\r\n250 AUTH PLAIN\r\n');
        else if (cmd === 'AUTH') socket.write('235 ok\r\n');
        else if (cmd === 'MAIL') socket.write('250 ok\r\n');
        else if (cmd === 'RCPT') {
          c.rcpt.push(/<([^>]*)>/.exec(line)?.[1] ?? line);
          socket.write('250 ok\r\n');
        } else if (cmd === 'DATA') {
          inData = true;
          socket.write('354 go\r\n');
        } else if (cmd === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('500 what\r\n');
      }
    });
  });
  await new Promise<void>((ok) => smtp.listen(0, '127.0.0.1', ok));
  smtpPort = (smtp.address() as { port: number }).port;
});
after(() => {
  store?.close();
  smtp?.close();
  rmSync(dir, { recursive: true });
});

const account = () => ({ url: `smtp://sender%40test.example:pw@127.0.0.1:${smtpPort}` });

function script(text: string, s = store): Script {
  const steps = parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), s.schema)
    .map((x) => ({ stepId: x.stepId!, name: x.name!, enabled: x.enabled !== false, params: x.params }));
  return { id: 9999, name: 'test', steps } as Script;
}
const run = (text: string, opts: RunOptions = {}, s = store) =>
  runScript(s, script(text, s), { layout: 'Clients', foundSet: s.findIds('Clients'), documents: docs, ...opts });

const SEND = `
  Set Variable [ $to ; Value: Clients::Email & "; second@customer.example" ]
  Set Variable [ $file ; Value: "invoice.pdf" ]
  Send Mail [ Send via SMTP Server ; With dialog: Off ; To: $to ; CC: "cc@customer.example" ; BCC: "audit@customer.example" ; Subject: "Your invoice" ; Message: "Dear " & Clients::Name ; From name: "Accounts" ; From: "accounts@business.example" ; Attachment: $file ]
  Exit Script [ Text Result: Get ( LastError ) ]`;

const body = (data: string) =>
  Buffer.from(data.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString('utf8');

test('with sending on, Send Mail via SMTP sends to the recipients the script names, from the operator\'s address', async () => {
  conversations.length = 0;
  const r = await run(SEND, { mail: mailTransport(account(), 'sender@test.example') });
  assert.equal(r.result, '0');
  assert.equal(conversations.length, 1);
  const c = conversations[0];
  assert.deepEqual(c.rcpt, ['client@customer.example', 'second@customer.example', 'cc@customer.example', 'audit@customer.example']);
  assert.ok(c.lines.includes('MAIL FROM:<sender@test.example>'));
  const headers = c.data.split('\r\n\r\n')[0];
  assert.match(headers, /^From: "Accounts" <sender@test\.example>$/m);
  assert.match(headers, /^To: client@customer\.example, second@customer\.example$/m);
  assert.match(headers, /^Cc: cc@customer\.example$/m);
  assert.match(headers, /^Reply-To: accounts@business\.example$/m);
  assert.match(headers, /^Subject: Your invoice$/m);
  // BCC is in the envelope only.
  assert.doesNotMatch(headers, /audit@|^Bcc:/im);
  assert.equal(body(c.data), 'Dear Real Client');
  assert.match(c.data, /filename="invoice\.pdf"/);
});

test('without sending switched on, Send Mail via SMTP is error 3; outbound test mode still only captures', async () => {
  conversations.length = 0;
  assert.equal((await run(SEND)).result, '3');
  const entries: OutboxEntry[] = [];
  const mode: OutboundTest = { allowHosts: [], record: (e) => entries.push(e) };
  // Host.scriptOptions never gives both, but test mode wins if it gets them.
  const r = await run(SEND, { outbound: mode, mail: mailTransport(account(), 'sender@test.example') });
  assert.equal(r.result, '0');
  assert.equal(entries.length, 1);
  assert.equal(conversations.length, 0);
});

test('a missing attachment, a bad address or too many recipients sends nothing (error 1506)', async () => {
  conversations.length = 0;
  const mail = mailTransport(account(), 'sender@test.example');
  const missing = await run(SEND.replace('"invoice.pdf"', '"nope.pdf"'), { mail });
  assert.equal(missing.result, '1506');
  const bad = await run('Send Mail [ Send via SMTP Server ; With dialog: Off ; To: "not an address" ; Subject: "x" ; Message: "x" ]\nExit Script [ Text Result: Get ( LastError ) ]', { mail });
  assert.equal(bad.result, '1506');
  const none = await run('Send Mail [ Send via SMTP Server ; With dialog: Off ; To: "" ; Subject: "x" ; Message: "x" ]\nExit Script [ Text Result: Get ( LastError ) ]', { mail });
  assert.equal(none.result, '1506');
  const many = Array.from({ length: MAIL_RECIPIENT_LIMIT + 1 }, (_, i) => `p${i}@customer.example`).join(';');
  const tooMany = await run(`Send Mail [ Send via SMTP Server ; With dialog: Off ; To: "${many}" ; Subject: "x" ; Message: "x" ]\nExit Script [ Text Result: Get ( LastError ) ]`, { mail });
  assert.equal(tooMany.result, '1506');
  assert.equal(conversations.length, 0);
});

test('the script\'s From name and subject can\'t add headers', async () => {
  conversations.length = 0;
  const send = mailTransport(account(), 'sender@test.example');
  await send({ to: ['a@customer.example'], cc: [], bcc: [], subject: 'Hi\r\nBcc: evil@else.example', text: 't', fromName: 'X\r\nBcc: evil@else.example', replyTo: 'r@x.example\r\nBcc: evil@else.example', attachments: [], files: ['M'] });
  const c = conversations[0];
  assert.deepEqual(c.rcpt, ['a@customer.example']);
  assert.doesNotMatch(c.data.split('\r\n\r\n')[0], /^Bcc:|^Reply-To:/im);
  await send({ to: ['a@customer.example'], cc: [], bcc: [], subject: 's', text: 't', fromName: 'Zoë', attachments: [], files: ['M'] });
  assert.match(conversations[1].data, new RegExp(`^From: =\\?UTF-8\\?B\\?${Buffer.from('Zoë').toString('base64')}\\?= <sender@test\\.example>$`, 'm'));
  assert.throws(() => mailTransport(account(), 'Someone <a@b.example>'), /not one email address/);
  assert.throws(() => mailTransport({ url: 'http://x' }, 'a@b.example'), /smtp/);
});

test('a capture-only file never sends, from the engine or the Host, whichever file\'s script sends', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-send-mail-held-'));
  createStore(join(folder, 'Held_Publishing.sqlite'));
  const held = new Store(join(folder, 'Held_Publishing.sqlite'), 'Held_Publishing');
  conversations.length = 0;
  try {
    held.applyDesign([{ op: 'createTable', name: 'Clients', fields: [{ name: 'Email', type: 'text' }] }]);
    held.create('Clients', { Email: 'client@customer.example' });
    const sent: OutgoingMail[] = [];
    const r = await run('Send Mail [ Send via SMTP Server ; With dialog: Off ; To: Clients::Email ; Subject: "Hi" ; Message: "x" ]\nExit Script [ Text Result: Get ( LastError ) ]',
      { mail: async (m) => void sent.push(m) }, held);
    assert.equal(r.result, '3');
    assert.equal(sent.length, 0);
    // The Host refuses too, while the file is in its folder, even for another file's message.
    const host = new Host(folder);
    try {
      host.sendMail({ smtp: account(), from: 'sender@test.example' });
      assert.match(String(await host.mail!({ to: ['a@customer.example'], cc: [], bcc: [], subject: 's', text: 't', fromName: '', attachments: [], files: ['Other_Sample'] })), /capture-only/);
      // Through the engine, the refusal is error 3.
      assert.equal((await run(SEND, { mail: host.mail })).result, '3');
      assert.equal(conversations.length, 0);
      // Outbound test mode replaces sending in the options scripts get.
      assert.ok(host.scriptOptions().mail);
      host.testOutbound({});
      assert.equal(host.scriptOptions().mail, undefined);
    } finally {
      host.close();
    }
  } finally {
    held.close();
    rmSync(folder, { recursive: true });
  }
});

test('the Host sends when no capture-only file is there; extra capture-only names count', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-send-mail-host-'));
  conversations.length = 0;
  const host = new Host(folder);
  try {
    host.sendMail({ smtp: account(), from: 'sender@test.example', captureOnly: ['other'] });
    assert.equal(await host.mail!({ to: ['a@customer.example'], cc: [], bcc: [], subject: 's', text: 't', fromName: '', attachments: [], files: ['Invoices'] }), undefined);
    assert.equal(conversations.length, 1);
    assert.match(String(await host.mail!({ to: ['a@customer.example'], cc: [], bcc: [], subject: 's', text: 't', fromName: '', attachments: [], files: ['Other_Tester'] })), /capture-only/);
    assert.equal(conversations.length, 1);
  } finally {
    host.close();
    rmSync(folder, { recursive: true });
  }
});

test('a plug-in that asks for mail sends through the same account, with the operator\'s address as sender', async () => {
  conversations.length = 0;
  const d = join(dir, 'mailer');
  mkdirSync(d);
  writeFileSync(join(d, 'plugin.json'), JSON.stringify({
    id: 'org.example.mailer', name: 'Mailer', version: '1.0.0', api: '^1.0', publisher: 'Example', main: 'main.js',
    permissions: { mail: true, files: ['documents:read'] }, functions: [{ name: 'Mail_Send', min: 2, max: 2 }],
  }));
  writeFileSync(join(d, 'main.js'), `const functions = { Mail_Send: (to, subject) => tabularius.mail.send({ from: 'Ann <ann@shop.example>', to, subject, body: 'Hi there' }) };`);
  const reg = new PluginRegistry();
  const { manifest, calls } = readPlugin(d);
  reg.install(manifest, calls);
  reg.enable('M', manifest.id);
  store.plugin = reg.lookup('M');
  store.pluginsUseMail = () => reg.usesMail('M');
  const mail = mailTransport(account(), 'sender@test.example');
  const r = await run('Exit Script [ Text Result: Mail_Send ( "bob@client.example" ; "From a plug-in" ) ]', { mail });
  assert.equal(r.result, '1');
  assert.equal(conversations.length, 1);
  const c = conversations[0];
  assert.deepEqual(c.rcpt, ['bob@client.example']);
  assert.ok(c.lines.includes('MAIL FROM:<sender@test.example>'));
  assert.match(c.data.split('\r\n\r\n')[0], /^From: "Ann" <sender@test\.example>$/m);
  assert.equal(body(c.data), 'Hi there');
  // Sending isn't switched on: nothing more goes out.
  assert.equal((await run('Exit Script [ Text Result: Mail_Send ( "bob@client.example" ; "x" ) ]', {})).result, '?');
  assert.equal(conversations.length, 1);
  await stopJavaScript();
});
