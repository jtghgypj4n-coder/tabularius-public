// Outbound test mode: scripts' mail is captured and never reaches the people
// it names; a copy goes only to the redirect address, through the operator's
// own SMTP account; web requests reach only allowlisted hosts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as tcpServer, type Server as TcpServer } from 'node:net';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, setCaptureOnlyDefaults, redactUrl, hostAllowed, testScripts, type OutboundTest, type OutboxEntry, type RedirectedMessage, type RunOptions } from '../../scripts/src/index.ts';
import { redirectTransport } from '../src/smtp.ts';
import { Outbox } from '../src/outbox.ts';
import { serve } from '../src/index.ts';

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

// A local web server: /ok answers, /away redirects to a host that isn't allowed.
let web: Server;
let webPort: number;
const webHits: string[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-outbound-'));
  docs = join(dir, 'Documents');
  mkdirSync(docs);
  writeFileSync(join(docs, 'invoice.pdf'), '%PDF-1.4 test');
  createStore(join(dir, 'M.sqlite'));
  store = new Store(join(dir, 'M.sqlite'), 'M');
  store.applyDesign([{ op: 'createTable', name: 'Clients', fields: [{ name: 'Name', type: 'text' }, { name: 'Email', type: 'text' }] }]);
  store.create('Clients', { Name: 'Real Client', Email: 'client@customer.example' });

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

  web = createServer((req, res) => {
    webHits.push(`${req.method} ${req.headers.host} ${req.url}`);
    if (req.url === '/away') res.writeHead(302, { location: `http://localhost:${webPort}/ok` }).end();
    else res.writeHead(200, { 'content-type': 'text/plain' }).end('hello');
  });
  await new Promise<void>((ok) => web.listen(0, '127.0.0.1', ok));
  webPort = (web.address() as { port: number }).port;
});
after(() => {
  store?.close();
  smtp?.close();
  web?.close();
  rmSync(dir, { recursive: true });
});

function script(text: string, name = 'test'): Script {
  const steps = parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
    .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }));
  return { id: 9999, name, steps } as Script;
}
const run = (text: string, opts: RunOptions = {}) =>
  runScript(store, script(text), { layout: 'Clients', foundSet: store.findIds('Clients'), documents: docs, ...opts });

function testMode(extra: Partial<OutboundTest> = {}): { mode: OutboundTest; entries: OutboxEntry[] } {
  const entries: OutboxEntry[] = [];
  return { entries, mode: { allowHosts: [], record: (e) => entries.push(e), ...extra } };
}

const SEND = `
  Set Variable [ $to ; Value: Clients::Email & "; second@customer.example" ]
  Set Variable [ $file ; Value: "invoice.pdf" ]
  Send Mail [ Send via SMTP Server ; With dialog: Off ; To: $to ; CC: "cc@customer.example" ; BCC: "audit@customer.example" ; Subject: "Your invoice" ; Message: "Dear " & Clients::Name ; From name: "Accounts" ; From: "accounts@sender-org.example" ; Attachment: $file ]
  Exit Script [ Text Result: Get ( LastError ) ]`;

test('without test mode Send Mail still fails with error 3 and records nothing', async () => {
  const r = await run(SEND);
  assert.equal(r.result, '3');
  const r2 = await run(SEND, { network: true });
  assert.equal(r2.result, '3');
});

test('Send Mail is captured with its recipients, and the copy carries none of them', async () => {
  const sent: RedirectedMessage[] = [];
  const { mode, entries } = testMode({ redirectTo: 'tester@test.example', deliver: async (m) => void sent.push(m) });
  const r = await run(SEND, { outbound: mode });
  assert.equal(r.result, '0');
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.kind, 'mail');
  if (e.kind !== 'mail') return;
  assert.deepEqual(e.to, ['client@customer.example', 'second@customer.example']);
  assert.deepEqual(e.cc, ['cc@customer.example']);
  assert.deepEqual(e.bcc, ['audit@customer.example']);
  assert.equal(e.subject, 'Your invoice');
  assert.equal(e.body, 'Dear Real Client');
  assert.equal(e.from, 'Accounts <accounts@sender-org.example>');
  assert.deepEqual(e.attachments.map((a) => [a.name, a.size]), [['invoice.pdf', 13]]);
  assert.equal(e.deliveredTo, 'tester@test.example');
  // The message handed to the transport has no recipient fields at all: only text saying who it was meant for.
  assert.equal(sent.length, 1);
  // signal only lets a cancelled run stop the delivery; it carries no message data.
  assert.deepEqual(Object.keys(sent[0]).filter((k) => k !== 'signal').sort(), ['attachments', 'files', 'subject', 'text']);
  assert.ok(sent[0].signal === undefined || sent[0].signal instanceof AbortSignal);
  assert.equal(sent[0].subject, '[tabularius test] Your invoice');
  assert.match(sent[0].text, /^Captured from a Tabularius test run of M\. Not sent to anyone\.\n/);
  // The script's message is quoted, so the copy never reads as if its author sent it.
  assert.match(sent[0].text, /\n> Dear Real Client\n/);
  // The copy names no address and no sender: those stay in the local outbox.
  assert.doesNotMatch(sent[0].text, /customer\.example|sender-org|Accounts/);
  assert.match(sent[0].text, /Nobody else received it: not the 2 recipients, 1 CC and 1 BCC the script named/);
});

test('without a delivery, mail is only captured', async () => {
  const { mode, entries } = testMode();
  const r = await run(SEND, { outbound: mode });
  assert.equal(r.result, '0');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind === 'mail' && entries[0].deliveredTo, undefined);
});

test('the SMTP copy goes to the redirect address and nowhere else', async () => {
  conversations.length = 0;
  const transport = redirectTransport({ url: `smtp://me%40test.example:pw@127.0.0.1:${smtpPort}` }, 'tester@test.example');
  const { mode, entries } = testMode({ redirectTo: 'tester@test.example', deliver: transport });
  const r = await run(SEND, { outbound: mode });
  assert.equal(r.result, '0', JSON.stringify(entries));
  assert.equal(conversations.length, 1);
  const c = conversations[0];
  // One recipient: the redirect address. No address the script named is ever given to the server.
  assert.deepEqual(c.rcpt, ['tester@test.example']);
  const rcptLines = c.lines.filter((l) => /^RCPT/i.test(l));
  assert.deepEqual(rcptLines, ['RCPT TO:<tester@test.example>']);
  // From the redirect address itself, whatever account sends it and whoever the script said it was from.
  assert.ok(c.lines.includes('MAIL FROM:<tester@test.example>'));
  const headers = c.data.split('\r\n\r\n')[0];
  assert.match(headers, /^To: tester@test\.example$/m);
  assert.match(headers, /^From: tester@test\.example$/m);
  assert.match(headers, /^Subject: \[tabularius test\] Your invoice$/m);
  assert.doesNotMatch(headers, /customer\.example|sender-org|Accounts/);
  assert.doesNotMatch(headers, /^(Cc|Bcc|Reply-To|Sender):/im);
  // Nor does the body name them.
  const body = Buffer.from(c.data.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.doesNotMatch(body, /customer\.example|sender-org/);
  assert.match(body, /^> Dear Real Client$/m);
  assert.match(c.data, /filename="invoice\.pdf"/);
});

test('mail from a capture-only file (named by prefix) is only ever captured, never delivered', async () => {
  const { captureOnly } = await import('../../scripts/src/index.ts');
  assert.equal(captureOnly('Held_Publishing'), true);
  assert.equal(captureOnly('held_interface'), true);
  assert.equal(captureOnly('Other_Sample'), false);
  assert.equal(captureOnly('Other_Sample', ['other*']), true);
  // A file named Held_Publishing, with a delivery set up: nothing is handed to the transport.
  createStore(join(dir, 'Held_Publishing.sqlite'));
  const held = new Store(join(dir, 'Held_Publishing.sqlite'), 'Held_Publishing');
  try {
    held.applyDesign([{ op: 'createTable', name: 'Clients', fields: [{ name: 'Email', type: 'text' }] }]);
    held.create('Clients', { Email: 'client@customer.example' });
    const sent: RedirectedMessage[] = [];
    const { mode, entries } = testMode({ redirectTo: 'tester@test.example', deliver: async (m) => void sent.push(m) });
    const steps = parseScriptText('Send Mail [ Send via SMTP Server ; With dialog: Off ; To: Clients::Email ; Subject: "Hi" ; Message: "x" ]', held.schema)
      .map((x) => ({ stepId: x.stepId!, name: x.name!, enabled: true, params: x.params }));
    const r = await runScript(held, { id: 1, name: 'Notify client', steps } as Script, { layout: 'Clients', outbound: mode });
    assert.equal(r.error, 0);
    assert.equal(sent.length, 0);
    assert.ok(entries[0].kind === 'mail' && !entries[0].deliveredTo && /capture-only/.test(entries[0].notCopied ?? ''));
    // Only with the explicit opt-in does a copy go, and then only to the redirect address.
    const opted = testMode({ redirectTo: 'tester@test.example', deliver: async (m) => void sent.push(m), copyHeld: true });
    await runScript(held, { id: 1, name: 'Notify client', steps } as Script, { layout: 'Clients', outbound: opted.mode });
    assert.equal(sent.length, 1);
    assert.ok(opted.entries[0].kind === 'mail' && opted.entries[0].deliveredTo === 'tester@test.example');
    assert.match(sent[0].text, /^Captured from a Tabularius test run\. Not sent to anyone\.\n/);
    assert.doesNotMatch(sent[0].subject + sent[0].text, /customer\.example|Held_Publishing/);
    sent.length = 0;
    // End to end on the SMTP server: a message the script writes as a staff member, to a client.
    conversations.length = 0;
    const staff = parseScriptText('Send Mail [ Send via SMTP Server ; With dialog: Off ; To: Clients::Email ; CC: "cc@customer.example" ; BCC: "audit@sender-org.example" ; Subject: "Your renewal" ; Message: "Dear client" ; From name: "Office" ; From: "office@sender-org.example" ]', held.schema)
      .map((x) => ({ stepId: x.stepId!, name: x.name!, enabled: true, params: x.params }));
    const smtp = testMode({ redirectTo: 'tester@test.example', deliver: redirectTransport({ url: `smtp://u:p@127.0.0.1:${smtpPort}` }, 'tester@test.example'), copyHeld: true });
    const s2 = await runScript(held, { id: 2, name: 'Renewal', steps: staff } as Script, { layout: 'Clients', outbound: smtp.mode });
    assert.equal(s2.error, 0, JSON.stringify(smtp.entries));
    assert.equal(conversations.length, 1);
    const c = conversations[0];
    assert.deepEqual(c.rcpt, ['tester@test.example']);
    assert.deepEqual(c.lines.filter((l) => /^(MAIL|RCPT)/i.test(l)), ['MAIL FROM:<tester@test.example>', 'RCPT TO:<tester@test.example>']);
    const headers = c.data.split('\r\n\r\n')[0];
    assert.match(headers, /^From: tester@test\.example$/m);
    assert.match(headers, /^To: tester@test\.example$/m);
    assert.match(headers, /^Subject: \[tabularius test\] Your renewal$/m);
    assert.doesNotMatch(headers, /^(Cc|Bcc|Reply-To|Sender):/im);
    assert.doesNotMatch(headers, /sender-org|customer\.example|Held|Office/i);
    const body = Buffer.from(c.data.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString('utf8');
    assert.match(body, /^Captured from a Tabularius test run\. Not sent to anyone\.\n/);
    assert.match(body, /^> Dear client$/m);
    assert.match(body, /1 recipient, 1 CC and 1 BCC/);
    assert.doesNotMatch(body, /sender-org|customer\.example|Held_Publishing|Office/);
    sent.length = 0;
    // Files the operator names are held the same way.
    const named = testMode({ redirectTo: 'tester@test.example', deliver: async (m) => void sent.push(m), captureOnly: ['M'] });
    await run(SEND, { outbound: named.mode });
    assert.equal(sent.length, 0);
  } finally {
    held.close();
  }
});

test('nothing is delivered while a capture-only file is hosted, whichever file sends (Host)', async () => {
  const { Host } = await import('../src/host.ts');
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-outbound-held-'));
  createStore(join(folder, 'Held_Publishing.sqlite'));
  conversations.length = 0;
  const host = new Host(folder);
  try {
    host.testOutbound({ redirectTo: 'tester@test.example', smtp: { url: `smtp://u:p@127.0.0.1:${smtpPort}` } });
    // Even a message the engine would let through (from a file that isn't capture-only) is refused.
    const why = await host.outbound!.deliver!({ subject: 's', text: 't', attachments: [], files: ['Other_Sample'] });
    assert.match(String(why), /capture-only/);
    assert.equal(conversations.length, 0);
    // With the opt-in, the copy goes: to the redirect address only, from it, with nothing else in the envelope.
    host.testOutbound({ redirectTo: 'tester@test.example', smtp: { url: `smtp://u:p@127.0.0.1:${smtpPort}` }, copyHeld: true });
    assert.equal(await host.outbound!.deliver!({ subject: '[tabularius test] Hi', text: 't', attachments: [], files: ['Held_Publishing'] }), true);
    assert.equal(conversations.length, 1);
    assert.deepEqual(conversations[0].rcpt, ['tester@test.example']);
    assert.ok(conversations[0].lines.includes('MAIL FROM:<tester@test.example>'));
  } finally {
    host.close();
    rmSync(folder, { recursive: true });
  }
});

test('redirectTransport takes exactly one address and refuses plain SMTP to other machines', async () => {
  assert.throws(() => redirectTransport({ url: 'smtp://u:p@127.0.0.1:25' }, 'a@x.example, b@y.example'), /not one email address/);
  assert.throws(() => redirectTransport({ url: 'smtp://u:p@127.0.0.1:25' }, 'a@x.example;b@y.example'), /not one email address/);
  assert.throws(() => redirectTransport({ url: 'http://x' }, 'a@x.example'), /smtp/);
  // A server elsewhere that offers no STARTTLS never gets the password.
  const plain = tcpServer((s) => {
    s.write('220 hi\r\n');
    s.on('data', () => s.write('250 test\r\n'));
  });
  await new Promise<void>((ok) => plain.listen(0, '0.0.0.0', ok));
  const port = (plain.address() as { port: number }).port;
  try {
    // This machine by its network address isn't "localhost", so TLS is required.
    // (macOS answers only 127.0.0.1 of 127.0.0.0/8, so 127.0.0.2 is the fallback, not the first choice.)
    const lan = Object.values(networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address ?? '127.0.0.2';
    const send = redirectTransport({ url: `smtp://u:p@${lan}:${port}` }, 'a@x.example');
    await assert.rejects(send({ subject: 's', text: 't', attachments: [], files: [] }), /STARTTLS|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/);
  } finally {
    plain.close();
  }
});

test('a copy that fails is recorded and the step fails, but nothing else is tried', async () => {
  const { mode, entries } = testMode({ redirectTo: 'tester@test.example', deliver: async () => { throw new Error('refused'); } });
  const r = await run(SEND, { outbound: mode });
  assert.notEqual(r.result, '0');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind === 'mail' && entries[0].error, 'refused');
});

test('copies past the limit are kept without being sent (Host.testOutbound)', async () => {
  const { Host } = await import('../src/host.ts');
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-outbound-host-'));
  conversations.length = 0;
  const host = new Host(folder);
  try {
    host.testOutbound({ redirectTo: 'tester@test.example', smtp: { url: `smtp://u:p@127.0.0.1:${smtpPort}` }, maxCopies: 1 });
    for (let i = 0; i < 3; i++) assert.equal((await run(SEND, { outbound: host.outbound, documents: docs })).result, '0');
    assert.equal(conversations.length, 1);
    const list = host.outbox!.list();
    assert.equal(list.length, 3);
    assert.deepEqual(list.map((e) => e.kind === 'mail' && (e.deliveredTo ?? e.notCopied)).reverse(),
      ['tester@test.example', 'the limit on test copies was reached', 'the limit on test copies was reached']);
    // The outbox lists attachments without their contents; one entry has them.
    assert.equal(list[0].kind === 'mail' && list[0].attachments[0].data, undefined);
    const full = host.outbox!.get(list[0].id)!;
    assert.equal(full.kind === 'mail' && Buffer.from(full.attachments[0].data!, 'base64').toString(), '%PDF-1.4 test');
  } finally {
    host.close();
    rmSync(folder, { recursive: true });
  }
});

test('Insert from URL reaches only allowlisted hosts; others get an empty answer', async () => {
  webHits.length = 0;
  const { mode, entries } = testMode({ allowHosts: ['127.0.0.1'] });
  const r = await run(`
    Insert from URL [ $ok ; "http://127.0.0.1:${webPort}/ok" ]
    Insert from URL [ $stub ; "https://api.mailservice.example/v3/send?api_key=AKIA${''}ABCDEFGHIJKLMNOP&to=client@customer.example" ]
    Exit Script [ Text Result: $ok & "|" & $stub & "|" & Get ( LastError ) ]`, { outbound: mode });
  assert.equal(r.result, 'hello||0');
  assert.deepEqual(webHits, [`GET 127.0.0.1:${webPort} /ok`]);
  assert.equal(entries.length, 2);
  const [ok, stub] = entries;
  assert.ok(ok.kind === 'http' && ok.allowed && ok.status === 200 && ok.responseBytes === 5);
  assert.ok(stub.kind === 'http' && !stub.allowed && stub.host === 'api.mailservice.example');
  // The key never reaches the outbox.
  assert.doesNotMatch(JSON.stringify(entries), /AKIA/);
});

test('Insert from URL test mode works even with the network off, and redirects stay on allowed hosts', async () => {
  webHits.length = 0;
  const { mode, entries } = testMode({ allowHosts: ['127.0.0.1'] });
  const r = await run(`
    Insert from URL [ $r ; "http://127.0.0.1:${webPort}/away" ]
    Exit Script [ Text Result: Get ( LastError ) ]`, { outbound: mode, network: false });
  assert.notEqual(r.result, '0');
  // The redirect to localhost (not on the list) was not followed.
  assert.deepEqual(webHits, [`GET 127.0.0.1:${webPort} /away`]);
  assert.match(entries[0].kind === 'http' ? entries[0].error ?? '' : '', /not allowed/);
});

test('Open URL in test mode: mailto and other hosts are recorded, not opened', async () => {
  const { mode, entries } = testMode({ allowHosts: ['tester.example'] });
  const r = await run(`
    Open URL [ With dialog: Off ; "mailto:client@customer.example?subject=Hi" ]
    Open URL [ With dialog: Off ; "https://www.tester.example/page" ]
    Open URL [ With dialog: Off ; "https://hooks.slack.example/T000/B000/xyz?token=abc" ]`, { outbound: mode });
  assert.deepEqual(r.actions.map((a) => (a as { url?: string }).url), ['https://www.tester.example/page']);
  assert.deepEqual(entries.map((e) => e.kind === 'http' && e.allowed), [false, true, false]);
  assert.doesNotMatch(JSON.stringify(entries), /token=abc/);
});

test('BaseElements mail and web calls are captured in test mode, refused without it', async () => {
  const formula = `BE_HTTP_POST ( "https://api.example.com/x?secret=s3" ; "a=1" ) & "|" & BE_SMTP_Server ( "smtp.sender-org.example" ; 465 ; "u" ; "pw" ) & "|" & BE_SMTP_AddAttachment ( "invoice.pdf" ) & "|" & BE_SMTP_Send ( "a@sender-org.example" ; "client@customer.example" ; "Hi" ; "Body" )`;
  const off = await run(`Exit Script [ Text Result: ${formula} ]`);
  assert.equal(off.result, '?|?|?|?');
  const { mode, entries } = testMode();
  const on = await run(`Exit Script [ Text Result: ${formula} ]`, { outbound: mode });
  assert.equal(on.result, '|||');
  assert.equal(entries.length, 2);
  const [req, mail] = entries;
  assert.ok(req.kind === 'http' && req.method === 'POST' && !req.allowed && req.url.includes('secret=%5Bremoved%5D'));
  assert.ok(mail.kind === 'mail' && mail.to[0] === 'client@customer.example' && mail.attachments[0]?.name === 'invoice.pdf');
  assert.doesNotMatch(JSON.stringify(entries), /pw|smtp\.sender-org/);
});

test('redactUrl and hostAllowed', () => {
  assert.equal(redactUrl('https://u:p@s3.amazonaws.com/b/k?X-Amz-Credential=AKIA1&X-Amz-Signature=abc&name=x'),
    'https://s3.amazonaws.com/b/k?X-Amz-Credential=%5Bremoved%5D&X-Amz-Signature=%5Bremoved%5D&name=x');
  assert.equal(redactUrl('https://x.example/?access_token=1&apikey=2&q=3'), 'https://x.example/?access_token=%5Bremoved%5D&apikey=%5Bremoved%5D&q=3');
  assert.equal(hostAllowed('https://api.tester.example/x', ['tester.example']), true);
  assert.equal(hostAllowed('https://tester.example.evil.example/x', ['tester.example']), false);
  assert.equal(hostAllowed('https://nottester.example/x', ['tester.example']), false);
  assert.equal(hostAllowed('not a url', ['tester.example']), false);
  // Amazon Web Services is never reached in test mode, even when listed: solutions often hold live keys.
  assert.equal(hostAllowed('https://mybucket.s3.amazonaws.com/x', ['amazonaws.com', 's3.amazonaws.com']), false);
  assert.equal(hostAllowed('https://s3.amazonaws.com./x', ['amazonaws.com']), false);
  assert.equal(hostAllowed('https://console.aws.amazon.com/', ['aws.amazon.com']), false);
});

test('Amazon Web Services hosts can never be put on the allowlist', async () => {
  const { Host } = await import('../src/host.ts');
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-outbound-aws-'));
  const host = new Host(folder);
  try {
    assert.throws(() => host.testOutbound({ allowHosts: ['tester.example', '*.amazonaws.com'] }), /can never be allowed/);
    assert.equal(host.outbound, undefined);
  } finally {
    host.close();
    rmSync(folder, { recursive: true });
  }
  // Insert from URL to S3 with S3 listed is still answered empty and recorded as not allowed.
  webHits.length = 0;
  const { mode, entries } = testMode({ allowHosts: ['amazonaws.com'] });
  const r = await run('Insert from URL [ $r ; "https://bucket.s3.amazonaws.com/key?X-Amz-Credential=abc" ]\nExit Script [ Text Result: Get ( LastError ) & "|" & $r ]', { outbound: mode });
  assert.equal(r.result, '0|');
  assert.ok(entries[0].kind === 'http' && !entries[0].allowed);
  assert.doesNotMatch(JSON.stringify(entries), /abc/);
});

test('test-scripts captures mail instead of failing when given test mode', async () => {
  const { mode, entries } = testMode();
  store.applyDesign([{ op: 'createScript', name: 'Email client', text: SEND.trim().split('\n').map((l) => l.trim()).join('\n') }]);
  const results = await testScripts(store, { scripts: ['Email client'], outbound: mode });
  assert.equal(results[0].outcome, 'ok', JSON.stringify(results[0]));
  assert.equal(entries.length, 1);
});

test('the admin console lists, shows and empties the outbox; AI runs never use test mode', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-outbound-serve-'));
  const s = await serve({ dir: folder, port: 0, log: () => {}, testOutbound: { allowHosts: ['127.0.0.1'] } });
  try {
    const status = await (await fetch(`${s.url}/tabularius/admin/v1/status`)).json();
    assert.deepEqual(status.server.outbound, { on: true, redirectTo: null, copies: false, allowHosts: ['127.0.0.1'] });
    s.host.outbox!.record({ kind: 'mail', at: new Date().toISOString(), script: 'x', via: 'Send Mail', from: '', to: ['a@b.example'], cc: [], bcc: [], subject: 's', body: 'b', attachments: [{ name: 'f.txt', size: 1, data: 'eA==' }] });
    const list = await (await fetch(`${s.url}/tabularius/admin/v1/outbox`)).json();
    assert.equal(list.on, true);
    assert.equal(list.entries.length, 1);
    assert.equal(list.entries[0].attachments[0].data, undefined);
    const one = await (await fetch(`${s.url}/tabularius/admin/v1/outbox/${list.entries[0].id}`)).json();
    assert.equal(one.attachments[0].data, 'eA==');
    assert.equal((await fetch(`${s.url}/tabularius/admin/v1/outbox`, { method: 'DELETE' })).status, 403);
    assert.equal((await fetch(`${s.url}/tabularius/admin/v1/outbox`, { method: 'DELETE', headers: { 'x-tabularius-admin': '1' } })).status, 200);
    assert.equal((await (await fetch(`${s.url}/tabularius/admin/v1/outbox`)).json()).entries.length, 0);
    assert.ok(s.host.scriptOptions().outbound);
  } finally {
    s.server.close();
    rmSync(folder, { recursive: true });
  }
});

test('BaseElements curl settings and response readers: "" in test mode (nothing is sent), "?" without it; machine name and system drive run', async () => {
  const formula = 'BE_HTTP_SetCustomHeader ( "Content-Type" ; "application/json" ) & "|" & BE_HTTP_SetProxy ( "proxy.example" ; 8080 ) & "|" & BE_HTTP_ResponseCode & "|" & BE_HTTP_ResponseHeaders ( "Server" )';
  const off = await run(`Exit Script [ Text Result: ${formula} ]`);
  assert.equal(off.result, '?|?|?|?');
  const { mode } = testMode();
  const on = await run(`Exit Script [ Text Result: ${formula} ]`, { outbound: mode });
  assert.equal(on.result, '|||');
  const local = await run('Exit Script [ Text Result: BE_GetMachineName & "|" & BE_GetSystemDrive ]');
  assert.equal(local.result, `${hostname()}|/`);
});
