// Send Mail via SMTP with sending switched on (serve --send-mail): the message goes to the recipients the
// script names, through the operator's account and from its address; never from a capture-only file.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as tcpServer, type Server as TcpServer } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, setCaptureOnlyDefaults, type OutboundTest, type OutboxEntry, type OutgoingMail, type RunOptions } from '../../scripts/src/index.ts';
import { mailTransport, redirectTransport, MAIL_RECIPIENT_LIMIT, MAIL_CONTENT_LIMIT } from '../src/smtp.ts';
import { Host } from '../src/host.ts';
import { PluginRegistry, readPlugin } from '../../plugins/src/index.ts';
import { stopJavaScript } from '../../store/src/javascript.ts';

// No file is capture-only by default; this test names the ones it holds back.
setCaptureOnlyDefaults(['Held']);

let dir: string;
let docs: string;
let store: Store;

// A local SMTP server that records every conversation (no STARTTLS: allowed only for this machine).
interface Conversation { lines: string[]; rcpt: string[]; data: string; validationError?: string }
let smtp: TcpServer;
let smtpPort: number;
const conversations: Conversation[] = [];
let smtpBehavior: 'ok' | 'smtp-utf8' | 'data-4xx' | 'data-5xx' | 'data-close' | 'hang-ehlo' | 'auth-5xx' = 'ok';

/** Strict test-only MIME validator: validates headers, line limits, multipart boundaries and transfer encodings recursively. */
function validateMime(message: string): void {
  assert.ok(!/(?<!\r)\n|\r(?!\n)/.test(message), 'MIME uses CRLF line endings');
  assert.ok(!message.endsWith('\r\n'), 'DATA body has no trailing CRLF before SMTP terminator');
  const lines = message.split('\r\n');
  for (const line of lines) assert.ok(Buffer.byteLength(line, 'utf8') <= 998, `line exceeds RFC 5322 limit (${Buffer.byteLength(line, 'utf8')})`);
  const split = message.indexOf('\r\n\r\n');
  assert.ok(split > 0, 'header/body separator exists');
  const headerLines = message.slice(0, split).split('\r\n');
  const headers: Record<string, string> = {};
  let current = '';
  for (const line of headerLines) {
    if (/^[ \t]/.test(line)) {
      assert.ok(current, 'continuation follows a header field');
      headers[current] += ` ${line.trim()}`;
    } else {
      const match = /^([A-Za-z0-9-]+):[ \t]*(.*)$/.exec(line);
      assert.ok(match, `valid header field: ${line}`);
      current = match![1]!.toLowerCase();
      assert.equal(headers[current], undefined, `header ${current} appears once`);
      headers[current] = match![2]!;
    }
  }
  assert.equal(headers['mime-version'], '1.0');
  assert.ok(headers.date && !Number.isNaN(Date.parse(headers.date)), 'valid Date header');
  assert.match(headers['message-id'] ?? '', /^<[^<>\s]+@[^<>\s]+>$/);
  const body = message.slice(split + 4);
  const type = headers['content-type'] ?? 'text/plain';
  const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1];
  if (/^multipart\//i.test(type)) {
    assert.ok(boundary, 'multipart boundary declared');
    const pieces = body.split(`--${boundary}`);
    assert.ok(pieces.length >= 3 && pieces.at(-1)?.trim() === '--', `multipart ${boundary} closes`);
    for (const raw of pieces.slice(1, -1)) {
      const part = raw.replace(/^\r\n/, '').replace(/\r\n$/, '');
      validateMimePart(part);
    }
  } else {
    validateMimePartBody(headers['content-transfer-encoding'] ?? '7bit', body);
  }
}

function validateMimePart(part: string): void {
  const split = part.indexOf('\r\n\r\n');
  assert.ok(split > 0, 'MIME part has headers and body');
  const hs = part.slice(0, split).split('\r\n');
  let prev = '';
  const headers: Record<string, string> = {};
  for (const line of hs) {
    if (/^[ \t]/.test(line)) { assert.ok(prev); headers[prev] += ` ${line.trim()}`; continue; }
    const m = /^([A-Za-z0-9-]+):[ \t]*(.*)$/.exec(line);
    assert.ok(m, `valid MIME part header: ${line}`);
    prev = m![1]!.toLowerCase();
    assert.equal(headers[prev], undefined, `part header ${prev} appears once`);
    headers[prev] = m![2]!;
  }
  const body = part.slice(split + 4);
  const type = headers['content-type'] ?? 'text/plain';
  if (/^multipart\//i.test(type)) {
    const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1];
    assert.ok(boundary);
    const pieces = body.split(`--${boundary}`);
    assert.ok(pieces.length >= 3 && pieces.at(-1)?.trim() === '--', `nested multipart ${boundary} closes`);
    for (const raw of pieces.slice(1, -1)) validateMimePart(raw.replace(/^\r\n/, '').replace(/\r\n$/, ''));
  } else validateMimePartBody(headers['content-transfer-encoding'] ?? '7bit', body);
}

function validateMimePartBody(encoding: string, body: string): void {
  if (encoding.toLowerCase() === 'base64') {
    assert.match(body.replace(/\r\n/g, ''), /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
    for (const line of body.split('\r\n')) assert.ok(line.length <= 76, 'base64 line <= 76 chars');
  } else if (encoding.toLowerCase() === 'quoted-printable') {
    const remaining = body.replace(/=[0-9A-F]{2}/gi, '').replace(/=\r\n/g, '');
    assert.ok(!remaining.includes('='), 'quoted-printable escape is complete');
    assert.ok(!/[ \t](?:\r\n|$)/.test(body), 'quoted-printable has no trailing whitespace');
    for (const line of body.split('\r\n')) assert.ok(line.length <= 76, 'quoted-printable line <= 76 chars');
  } else {
    assert.ok(['7bit', '8bit', 'binary'].includes(encoding.toLowerCase()), `supported transfer encoding ${encoding}`);
    assert.ok(!body.includes('\0'), 'text body has no NUL');
  }
}

afterEach(() => {
  for (const c of conversations) assert.equal(c.validationError, undefined, c.validationError);
  smtpBehavior = 'ok';
});

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-send-mail-'));
  docs = join(dir, 'Documents');
  mkdirSync(docs);
  writeFileSync(join(docs, 'invoice.pdf'), '%PDF-1.4 test');
  createStore(join(dir, 'M.sqlite'));
  store = new Store(join(dir, 'M.sqlite'), 'M');
  store.applyDesign([{ op: 'createTable', name: 'Clients', fields: [{ name: 'Name', type: 'text' }, { name: 'Email', type: 'text' }] }]);
  store.create('Clients', { Name: 'Real Client', Email: '"Doe, Jane" <client@customer.example>' });

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
          if (end < 0) {
            if (smtpBehavior === 'data-close' && buffer.length) socket.destroy();
            return;
          }
          c.data = buffer.slice(0, end);
          try { validateMime(c.data); } catch (e) { c.validationError = e instanceof Error ? e.message : String(e); }
          buffer = buffer.slice(end + 5);
          inData = false;
          if (smtpBehavior === 'data-close') { socket.destroy(); continue; }
          if (smtpBehavior === 'data-4xx') socket.write('451 try again\r\n');
          else if (smtpBehavior === 'data-5xx') socket.write('550 refused\r\n');
          else socket.write('250 queued\r\n');
          continue;
        }
        const nl = buffer.indexOf('\r\n');
        if (nl < 0) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        c.lines.push(line);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' && smtpBehavior === 'hang-ehlo') continue;
        if (cmd === 'EHLO' && smtpBehavior === 'smtp-utf8') socket.write('250-test\r\n250-SMTPUTF8\r\n250 AUTH PLAIN\r\n');
        else if (cmd === 'EHLO') socket.write('250-test\r\n250 AUTH PLAIN\r\n');
        else if (cmd === 'AUTH' && smtpBehavior === 'auth-5xx') socket.write('535 bad credentials\r\n');
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
  assert.match(headers, /^To: "Doe, Jane" <client@customer\.example>, second@customer\.example$/m);
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
  await assert.rejects(send({ to: ['a@customer.example'], cc: [], bcc: [], subject: 'Hi\r\nBcc: evil@else.example', text: 't', fromName: 'X\r\nBcc: evil@else.example', replyTo: 'r@x.example\r\nBcc: evil@else.example', attachments: [], files: ['M'] }), /line break/);
  await send({ to: ['a@customer.example'], cc: [], bcc: [], subject: 's', text: 't', fromName: 'Zoë', attachments: [], files: ['M'] });
  assert.match(conversations[0]!.data, new RegExp(`^From: =\\?UTF-8\\?B\\?${Buffer.from('Zoë').toString('base64')}\\?= <sender@test\\.example>$`, 'm'));
  assert.throws(() => mailTransport(account(), 'Someone <a@b.example>'), /not one email address/);
  assert.throws(() => mailTransport(account(), '<a@b.example>'), /not one email address/);
  assert.throws(() => redirectTransport(account(), '<a@b.example>'), /plain email address/);
  assert.throws(() => mailTransport({ url: 'http://x' }, 'a@b.example'), /smtp/);
});

test('plain attachment names keep their full text and extension, however long', async () => {
  conversations.length = 0;
  const mail = mailTransport(account(), 'sender@test.example');
  const long = 'quarterly-financial-report-2026-Q3.pdf';
  const longer = `${'a'.repeat(70)}.csv`;
  await mail({
    to: ['jane@customer.example'], cc: [], bcc: [], subject: 'Names', text: 'x', fromName: 'Billing',
    attachments: [
      { name: long, data: new Uint8Array([1]) },
      { name: 'say "hi"\\.txt', data: new Uint8Array([1]) },
      { name: longer, data: new Uint8Array([1]) },
    ], files: ['Synthetic'],
  });
  const c = conversations[0]!;
  assert.match(c.data, new RegExp(`filename="${long.replace('.', '\\.')}"`));
  assert.match(c.data, /filename="say \\"hi\\"\\\\\.txt"/);
  assert.match(c.data, /filename="a{28}\.csv";\s+filename\*0\*=UTF-8''a+/, 'a long name keeps its extension in the fallback and is complete in RFC 2231 form');
});

test('mailbox syntax, long encoded subjects, HTML alternatives, inline images and RFC 2231 filenames serialize as strict MIME', async () => {
  conversations.length = 0;
  const mail = mailTransport(account(), 'sender@test.example');
  const subject = `Quarterly résumé — ${'long subject '.repeat(12)}`;
  await mail({
    to: ['"Doe, Jane" <jane@bücher.example>', '"O\"Neil, Pat" <pat@[IPv6:2001:db8::1]>'], cc: ['Zoë <zoe@customer.example>'], bcc: [],
    subject, text: 'Plain text body', fromName: 'Société "Billing"',
    html: '<p>Rich ✓</p><img src="cid:brand@tabularius">',
    attachments: [
      { name: 'résumé "final".pdf', data: new Uint8Array([37, 80, 68, 70]), mime: 'application/pdf' },
      { name: 'brand image.png', data: new Uint8Array([137, 80, 78, 71]), mime: 'image/png', contentId: 'brand@tabularius' },
    ], files: ['Synthetic'],
  });
  const c = conversations[0]!;
  assert.deepEqual(c.rcpt, ['jane@xn--bcher-kva.example', 'pat@[IPv6:2001:db8::1]', 'zoe@customer.example']);
  assert.match(c.data, /Subject: =\?UTF-8\?B\?/);
  assert.match(c.data, /filename\*0\*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22\.pdf/);
  assert.match(c.data, /Content-Disposition: inline; filename="brand image\.png"/);
  assert.match(c.data, /Content-ID: <brand@tabularius>/);
  assert.match(c.data, /multipart\/alternative/);
  assert.match(c.data, /multipart\/related/);
  const idnSender = mailTransport(account(), 'sender@bücher.example');
  await idnSender({ to: ['a@example.test'], cc: [], bcc: [], subject: 'x', text: 't', fromName: '', attachments: [], files: ['Synthetic'] });
  assert.match(conversations[1]!.data, /^From: sender@xn--bcher-kva\.example$/m);
});

test('SMTPUTF8 is required and negotiated for Unicode local parts', async () => {
  conversations.length = 0;
  const message: OutgoingMail = { to: ['josé@example.test'], cc: [], bcc: [], subject: 'x', text: 'body', fromName: '', attachments: [], files: ['Synthetic'] };
  await assert.rejects(mailTransport(account(), 'sender@test.example')(message), /does not support SMTPUTF8/);
  assert.equal(conversations.length, 1);
  assert.ok(!conversations[0]!.lines.some((line) => line.startsWith('MAIL FROM:')));
  smtpBehavior = 'smtp-utf8';
  await mailTransport(account(), 'sender@test.example')(message);
  assert.ok(conversations[1]!.lines.includes('MAIL FROM:<sender@test.example> SMTPUTF8'));
  assert.deepEqual(conversations[1]!.rcpt, ['josé@example.test']);
});

test('a recipient with a very long run of spaces is refused at once, not after seconds of matching', async () => {
  conversations.length = 0;
  const mail = mailTransport(account(), 'sender@test.example');
  for (const recipient of ['a' + ' '.repeat(60_000) + 'b@c<', 'a' + ' '.repeat(60_000) + 'b@c.com', ' '.repeat(60_000) + '<a@b.example>']) {
    const started = Date.now();
    await assert.rejects(mail({ to: [recipient], cc: [], bcc: [], subject: 'x', text: 't', fromName: '', attachments: [], files: ['Synthetic'] }), /not an email address|too/);
    assert.ok(Date.now() - started < 500, `refused in ${Date.now() - started} ms`);
  }
  assert.equal(conversations.length, 0);
});

test('a Unicode Reply-To address needs SMTPUTF8 like the sender and recipients', async () => {
  conversations.length = 0;
  smtpBehavior = 'ok';
  const message: OutgoingMail = { to: ['a@example.test'], cc: [], bcc: [], subject: 'x', text: 'body', replyTo: 'josé@example.test', fromName: '', attachments: [], files: ['Synthetic'] };
  await assert.rejects(mailTransport(account(), 'sender@test.example')(message), /does not support SMTPUTF8/);
  assert.ok(!conversations[0]!.lines.some((line) => line.startsWith('MAIL FROM:')));
  smtpBehavior = 'smtp-utf8';
  await mailTransport(account(), 'sender@test.example')(message);
  assert.ok(conversations[1]!.lines.includes('MAIL FROM:<sender@test.example> SMTPUTF8'));
  assert.match(conversations[1]!.data, /^Reply-To: josé@example\.test$/m);
});

test('CR/LF in every caller-controlled header field is rejected before opening SMTP', async () => {
  conversations.length = 0;
  const send = mailTransport(account(), 'sender@test.example');
  const base: OutgoingMail = { to: ['a@customer.example'], cc: [], bcc: [], subject: 's', text: 'body', fromName: '', attachments: [], files: ['Synthetic'] };
  for (const bad of [
    { ...base, to: ['a@customer.example\r\nBcc: evil@example.test'] },
    { ...base, cc: ['a@customer.example\nBcc: evil@example.test'] },
    { ...base, bcc: ['a@customer.example\rBcc: evil@example.test'] },
    { ...base, subject: 's\r\nBcc: evil@example.test' },
    { ...base, fromName: 'Billing\nBcc: evil@example.test' },
    { ...base, replyTo: 'a@example.test\r\nBcc: evil@example.test' },
    { ...base, subject: 'bad\x01subject' },
    { ...base, attachments: [{ name: 'x.pdf\r\nX-Evil: yes', data: new Uint8Array() }] },
    { ...base, attachments: [{ name: 'x.png', mime: 'image/png; x=\x01', data: new Uint8Array() }] },
    { ...base, attachments: [{ name: 'x.png', contentId: 'bad\x01id', data: new Uint8Array() }] },
  ]) await assert.rejects(send(bad), /line break/);
  assert.equal(conversations.length, 0);
  await assert.rejects(send({ ...base, attachments: [{ name: 'large.bin', data: new Uint8Array(MAIL_CONTENT_LIMIT + 1) }] }), /exceeds/);
  await assert.rejects(redirectTransport(account(), 'sink@example.test')({ subject: 'x', text: '', files: ['Synthetic'], attachments: [{ name: 'large.bin', data: new Uint8Array(MAIL_CONTENT_LIMIT + 1) }] }), /exceeds/);
  await assert.rejects(send({ ...base, replyTo: 'not-an-address' }), /Reply-To email address/);
  await assert.rejects(send({ ...base, attachments: [{ name: 'x.png', contentId: 'café@tabularius', data: new Uint8Array() }] }), /Content-ID|content ID/i);
  await assert.rejects(send({ ...base, attachments: [{ name: 'x'.repeat(4097), data: new Uint8Array() }] }), /filename is too long/);
  await assert.rejects(send({ ...base, attachments: [{ name: 'x.bin', mime: `application/octet-stream; ${'x'.repeat(300)}`, data: new Uint8Array() }] }), /content type is too long/);
  await assert.rejects(send({ ...base, attachments: Array.from({ length: 101 }, (_, i) => ({ name: `x${i}`, data: new Uint8Array() })) }), /more than 100 attachments/);
  for (const bad of ['a@b@example.test', '.a@example.test', 'a..b@example.test', 'a@[999.1.1.1]']) {
    await assert.rejects(send({ ...base, to: [bad] }), /not an email address/);
  }
  const splitReply = await run('Send Mail [ Send via SMTP Server ; With dialog: Off ; To: "a@customer.example" ; From: "reply@example.test" & "¶" & "evil@example.test" ; Subject: "x" ; Message: "x" ]\nExit Script [ Text Result: Get ( LastError ) ]', { mail: send });
  assert.equal(splitReply.result, '1506');
});

test('long folded headers stay under 998 octets and attachment body uses 76-column base64', async () => {
  conversations.length = 0;
  const to = Array.from({ length: 20 }, (_, i) => `person${i}@example.test`);
  await mailTransport(account(), 'sender@test.example')({
    to, cc: [], bcc: [], subject: `${'Quarterly report '.repeat(20)}Zoë`, text: 'line', fromName: '', files: ['Synthetic'],
    attachments: [
      { name: 'report.pdf', mime: 'application/pdf', data: new Uint8Array(128).fill(7) },
      { name: `${'résumé_'.repeat(180)}.pdf`, mime: 'application/pdf', data: new Uint8Array([1, 2, 3]) },
    ],
  });
  const message = conversations[0]!.data;
  for (const line of message.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 998);
  assert.match(message, /Content-Type: application\/pdf/);
  assert.match(message, /filename\*0\*=UTF-8''/);
  const encoded = message.split('Content-Transfer-Encoding: base64\r\n\r\n')[2]?.split('\r\n--')[0] ?? message.split('Content-Transfer-Encoding: base64\r\n\r\n')[1]?.split('\r\n--')[0];
  assert.ok(encoded);
  for (const line of encoded.split('\r\n')) assert.ok(line.length <= 76);
});

test('strict transfer-encoding validator accepts 8bit, quoted-printable and base64 and rejects malformed payloads', () => {
  validateMimePartBody('8bit', 'café');
  validateMimePartBody('quoted-printable', 'caf=C3=A9=0D=0Aline');
  validateMimePartBody('base64', 'Y2Fmw6k=');
  assert.throws(() => validateMimePartBody('base64', 'Y2Fj!'));
  assert.throws(() => validateMimePartBody('quoted-printable', 'bad=XY'), /quoted-printable/);
});

test('SMTP 4xx/5xx refusals, authentication failure, mid-DATA disconnect and silence fail closed', async () => {
  const config = account();
  const send = mailTransport(config, 'sender@test.example');
  const message: OutgoingMail = { to: ['a@customer.example'], cc: [], bcc: [], subject: 'x', text: 'body', fromName: '', attachments: [], files: ['Synthetic'] };
  smtpBehavior = 'data-4xx';
  await assert.rejects(send(message), /SMTP: 451/);
  smtpBehavior = 'data-5xx';
  await assert.rejects(send(message), /SMTP: 550/);
  smtpBehavior = 'auth-5xx';
  await assert.rejects(send(message), /SMTP: 535/);
  smtpBehavior = 'data-close';
  await assert.rejects(send(message), /closed|write/i);
  smtpBehavior = 'hang-ehlo';
  await assert.rejects(mailTransport({ ...config, timeoutMs: 80 }, 'sender@test.example')(message), /stopped answering/);
  smtpBehavior = 'data-4xx';
  const failedStep = await run(SEND, { mail: send });
  assert.equal(failedStep.result, '1506');
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
