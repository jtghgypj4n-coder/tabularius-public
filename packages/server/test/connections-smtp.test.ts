// An email (SMTP) connection: the mail account's settings live in the console, its user name and password are sealed on
// the server, and Send Mail via SMTP steps use it when it is marked for them and the operator gave no mail flag.
// Tested against a local stand-in mail server; nothing here sends mail anywhere.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OutgoingMail } from '../../scripts/src/index.ts';
import { setCaptureOnlyDefaults } from '../../scripts/src/index.ts';
import { Connections, Host } from '../src/index.ts';

// The process names its capture-only files; here, every file that starts with Held.
setCaptureOnlyDefaults(['Held']);

const USER = 'mailer-account';
const PASSWORD = 'correct horse battery staple';
let dir: string;
let smtp: Server;
let port: number;
let host: Host;
let connections: Connections;
const talks: { lines: string[]; rcpt: string[]; from: string; sentData: boolean }[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-connections-smtp-'));
  smtp = createServer((socket) => {
    const t = { lines: [] as string[], rcpt: [] as string[], from: '', sentData: false };
    talks.push(t);
    let inData = false;
    let buffer = '';
    socket.write('220 test ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          buffer = buffer.slice(end + 5);
          inData = false;
          t.sentData = true;
          socket.write('250 queued\r\n');
          continue;
        }
        const nl = buffer.indexOf('\r\n');
        if (nl < 0) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        t.lines.push(line.startsWith('AUTH') ? 'AUTH …' : line);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') socket.write('250-test\r\n250 AUTH PLAIN\r\n');
        else if (cmd === 'AUTH') {
          const given = Buffer.from(line.split(' ')[2] ?? '', 'base64').toString().split('\0');
          if (given[1] === USER && given[2] === PASSWORD) socket.write('235 ok\r\n');
          else socket.write(`535 5.7.8 bad credentials for ${given[1]} with ${given[2]}\r\n`);
        } else if (cmd === 'MAIL') {
          t.from = /<([^>]*)>/.exec(line)?.[1] ?? '';
          socket.write('250 ok\r\n');
        } else if (cmd === 'RCPT') {
          t.rcpt.push(/<([^>]*)>/.exec(line)?.[1] ?? line);
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
  port = (smtp.address() as { port: number }).port;
  host = new Host(dir);
  connections = new Connections(dir);
  host.connections = connections;
});
after(() => {
  host?.close();
  smtp?.close();
  rmSync(dir, { recursive: true, force: true });
});

const message = (files: string[]): OutgoingMail => ({ to: ['client@customer.example'], cc: [], bcc: ['audit@customer.example'], subject: 'Your invoice', text: 'Hello', fromName: 'Accounts', attachments: [], files });

test('the settings are checked, and a mail server can\'t be the cloud metadata address', () => {
  const ok = { host: 'smtp.example.com', from: 'invoices@example.com' };
  const bad: [Record<string, string>, RegExp][] = [
    [{ ...ok, host: 'smtp example.com' }, /a name like/],
    [{ ...ok, host: '169.254.169.254' }, /link-local/],
    [{ ...ok, host: 'metadata.google.internal' }, /link-local/],
    // The same address in the spellings the URL parser reads as 169.254.169.254.
    ...['2852039166', '0xa9fea9fe', '0251.0376.0251.0376', '169.254.43518', '169.254.0xa9fe', '0:0:0:0:0:ffff:a9fe:a9fe', '0:0:0:0:0:ffff:169.254.169.254', '64:ff9b::a9fe:a9fe', '[::ffff:169.254.169.254]']
      .map((h): [Record<string, string>, RegExp] => [{ ...ok, host: h }, /link-local|a name like/]),
    [{ ...ok, host: 'smtp.example.com', port: '22' }, /port 25, 465, 587 or 2525/],
    [{ ...ok, port: '99999' }, /1 to 65535/],
    [{ ...ok, security: 'plain' }, /starttls or tls/],
    ...['0', '101', '-1', 'many', '2.5', '1e1'].map((recipients): [Record<string, string>, RegExp] => [{ ...ok, recipients }, /Most recipients in one message is a number from 1 to 100/]),
    [{ ...ok, from: 'Accounts <invoices@example.com>' }, /one email address/],
    [{ ...ok, from: 'a@example.com, b@example.com' }, /one email address/],
    [{ ...ok, mail: 'maybe' }, /yes or no/],
  ];
  for (const [config, why] of bad) assert.throws(() => connections.create({ name: 'bad', type: 'smtp', config }), why, JSON.stringify(config));
  // A machine of your own may use any port, and an address is kept in its plain form.
  const own = connections.create({ name: 'own', type: 'smtp', config: { host: '0x7f000001', port: '2500', from: 'a@example.com' } });
  assert.equal(own.config.host, '127.0.0.1');
  assert.equal(connections.remove('own'), true);
  const made = connections.create({ name: 'tmp', type: 'smtp', config: ok });
  assert.deepEqual(made.config, { host: 'smtp.example.com', security: 'starttls', from: 'invoices@example.com', mail: 'no' });
  assert.deepEqual(connections.get('tmp').secrets.map((x) => x.name), ['username', 'password']);
  assert.equal(connections.remove('tmp'), true);
});

test('a draft or a connection not marked for mail sends nothing, and nothing reaches the server before it is approved', async () => {
  const made = connections.create({ name: 'office-mail', type: 'smtp', config: { host: '127.0.0.1', port: String(port), from: 'invoices@example.com', mail: 'yes' } }, 'ai');
  assert.equal(made.config.mail, 'no', 'an AI draft never starts marked for mail');
  assert.equal(host.mail, undefined);
  connections.setSecret('office-mail', 'username', USER);
  connections.setSecret('office-mail', 'password', PASSWORD);
  assert.equal(host.mail, undefined, 'a draft is not used');
  connections.approve('office-mail');
  assert.equal(host.mail, undefined, 'approved, but not marked for Send Mail steps');
  connections.update('office-mail', { config: { host: '127.0.0.1', port: String(port), from: 'invoices@example.com', mail: 'yes' } });
  connections.update('office-mail', { enabled: false });
  assert.equal(host.mail, undefined, 'turned off');
  connections.update('office-mail', { enabled: true });
  assert.ok(host.mail);
  assert.equal(made.createdBy, 'ai');
  // A secret cleared on a working connection stops mail rather than signing in as "undefined".
  connections.setSecret('office-mail', 'password', undefined);
  assert.equal(host.mail, undefined);
  connections.setSecret('office-mail', 'password', PASSWORD);
  assert.ok(host.mail);
});

test('Test signs in and says goodbye without sending anything; a wrong password is explained without being repeated', async () => {
  talks.length = 0;
  const result = await connections.test('office-mail');
  assert.equal(result.ok, true, result.message);
  assert.match(result.message, /Nothing was sent/);
  assert.equal(talks.length, 1);
  assert.equal(talks[0].from, '');
  assert.equal(talks[0].sentData, false);

  connections.setSecret('office-mail', 'password', 'a different password');
  const wrong = await connections.test('office-mail');
  assert.equal(wrong.ok, false);
  assert.match(wrong.message, /refused the sign-in/);
  assert.ok(!wrong.message.includes('a different password'));
  assert.ok(!wrong.message.includes(USER), wrong.message);
  assert.ok(!JSON.stringify(connections.get('office-mail')).includes('a different password'));
  connections.setSecret('office-mail', 'password', PASSWORD);
});

test('Send Mail goes through the connection, from its address, to the recipients the script named', async () => {
  talks.length = 0;
  assert.equal(await host.mail!(message(['Invoices'])), undefined);
  assert.equal(talks.length, 1);
  assert.equal(talks[0].from, 'invoices@example.com');
  assert.deepEqual(talks[0].rcpt, ['client@customer.example', 'audit@customer.example']);
  assert.ok(talks[0].sentData);
  // The console's status names where mail comes from, never the password.
  assert.equal(host.mailFrom, 'invoices@example.com');
  assert.equal(host.mailConnection, 'office-mail');
  assert.ok(!JSON.stringify({ from: host.mailFrom, c: connections.list() }).includes(PASSWORD));
});

test('a capture-only file never sends, and a connection set up for some files refuses the others', async () => {
  talks.length = 0;
  assert.match(String(await host.mail!(message(['Held_Sample']))), /capture-only/);
  assert.equal(talks.length, 0);

  connections.update('office-mail', { files: ['Invoices'] });
  assert.equal(await host.mail!(message(['Invoices'])), undefined);
  assert.equal(talks.length, 1);
  assert.match(String(await host.mail!(message(['Orders']))), /no email connection is turned on for this file/);
  assert.equal(talks.length, 1);
  connections.update('office-mail', { files: [] });
});

test('the operator\'s mail flag wins, outbound test mode still keeps mail in its outbox, and Insert from URL can\'t use a mail connection', async () => {
  const flagged = new Host(mkdtempSync(join(tmpdir(), 'tabularius-connections-smtp-flag-')));
  try {
    flagged.connections = connections;
    flagged.sendMail({ smtp: { url: `smtp://${USER}:${encodeURIComponent(PASSWORD)}@127.0.0.1:${port}` }, from: 'flag@example.com' });
    assert.equal(flagged.mailFrom, 'flag@example.com');
    assert.equal(flagged.mailConnection, undefined);
    flagged.testOutbound({});
    assert.equal(flagged.scriptOptions().mail, undefined);
  } finally {
    flagged.close();
    rmSync(flagged.dir, { recursive: true, force: true });
  }
  host.testOutbound({});
  assert.equal(host.scriptOptions().mail, undefined);
  await assert.rejects(async () => {
    const { connection, secrets, io } = connections.use('office-mail', ['Invoices']);
    const { CONNECTION_TYPES } = await import('../src/connections.ts');
    await CONNECTION_TYPES.find((t) => t.id === 'smtp')!.send(connection, secrets, io, { method: 'GET', path: '/', query: '', headers: {} });
  }, /Send Mail steps, not by Insert from URL/);
});

test('a failed send tells the script the server\'s answer about the message, never what it echoed of the sign-in', async () => {
  connections.setSecret('office-mail', 'password', 'bad password');
  try {
    await assert.rejects(host.mail!(message(['Invoices'])), (e: Error) => {
      assert.equal(e.message, 'the mail server refused the sign-in (535)');
      return true;
    });
  } finally {
    connections.setSecret('office-mail', 'password', PASSWORD);
  }
  // A short user name is masked too, in any case.
  const { maskSecrets } = await import('../src/connections.ts');
  assert.equal(maskSecrets('failed for BOB with Ym9i and pw', ['bob', 'pw']), 'failed for *** with *** and ***');
  // Trouble reaching the server says only that.
  connections.update('office-mail', { config: { host: '127.0.0.1', port: '1', from: 'invoices@example.com', mail: 'yes' } });
  connections.setSecret('office-mail', 'username', USER);
  connections.setSecret('office-mail', 'password', PASSWORD);
  connections.approve('office-mail');
  await assert.rejects(host.mail!(message(['Invoices'])), { message: 'the mail server could not be reached' });
  connections.update('office-mail', { config: { host: '127.0.0.1', port: String(port), from: 'invoices@example.com', mail: 'yes' } });
  connections.setSecret('office-mail', 'username', USER);
  connections.setSecret('office-mail', 'password', PASSWORD);
  connections.approve('office-mail');
});

test('moving a connection to another server clears its secrets and asks for approval again', () => {
  const c = connections.get('office-mail');
  assert.equal(c.status, 'active');
  connections.update('office-mail', { config: { host: 'localhost', port: String(port), from: 'invoices@example.com', mail: 'yes' } });
  const moved = connections.get('office-mail');
  assert.equal(moved.status, 'draft');
  assert.ok(moved.secrets.every((x) => !x.set));
  assert.equal(host.mail, undefined);
  connections.setSecret('office-mail', 'username', USER);
  connections.setSecret('office-mail', 'password', PASSWORD);
  connections.approve('office-mail');
  assert.ok(host.mail);
});

test('Send Mail uses the oldest connection the file may use, not just the oldest', async () => {
  connections.update('office-mail', { files: ['Invoices'] });
  connections.create({ name: 'general-mail', type: 'smtp', config: { host: '127.0.0.1', port: String(port), from: 'general@example.com' } });
  connections.update('general-mail', { config: { host: '127.0.0.1', port: String(port), from: 'general@example.com', mail: 'yes' } });
  connections.setSecret('general-mail', 'username', USER);
  connections.setSecret('general-mail', 'password', PASSWORD);
  connections.approve('general-mail');
  talks.length = 0;
  assert.equal(await host.mail!(message(['Invoices'])), undefined);
  assert.equal(talks[0].from, 'invoices@example.com');
  assert.equal(await host.mail!(message(['Orders'])), undefined);
  assert.equal(talks[1].from, 'general@example.com');
  connections.remove('general-mail');
  connections.update('office-mail', { files: [] });
});

test('mail through a connection is limited per hour: a loop stops, and the limit frees up as the hour passes', async () => {
  connections.update('office-mail', { files: [] });
  const limit = host.mailLimit;
  limit.reset();
  limit.perHour = 2;
  let now = Date.now();
  limit.clock = () => now;
  talks.length = 0;
  assert.equal(await host.mail!(message(['Invoices'])), undefined);
  assert.equal(await host.mail!(message(['Invoices'])), undefined);
  assert.match(String(await host.mail!(message(['Invoices']))), /limited to 2 messages an hour; nothing was sent/);
  assert.equal(talks.length, 2);
  // An hour later the first two have aged out.
  now += 3_700_000;
  assert.equal(await host.mail!(message(['Invoices'])), undefined);
  assert.equal(talks.length, 3);
  limit.perHour = 100;
  limit.clock = Date.now;
  limit.reset();
});

test('each file has its own allowance, so one file cannot use up the server\'s', async () => {
  connections.update('office-mail', { files: [] });
  const limit = host.mailLimit;
  limit.reset();
  limit.perFile = 2;
  talks.length = 0;
  assert.equal(await host.mail!(message(['Invoices'])), undefined);
  assert.equal(await host.mail!(message(['Invoices'])), undefined);
  assert.match(String(await host.mail!(message(['Invoices']))), /mail from Invoices through connections is limited to 2 messages an hour; nothing was sent/);
  // Another file is not held up by it; a message that involves both is, because one of them is used up.
  assert.equal(await host.mail!(message(['Orders'])), undefined);
  assert.match(String(await host.mail!(message(['Orders', 'invoices']))), /from invoices through connections is limited to 2/);
  assert.equal(talks.length, 3);
  // A refused message is not counted against the others it involved.
  assert.equal(await host.mail!(message(['Orders'])), undefined);
  assert.match(String(await host.mail!(message(['Orders']))), /from Orders/);
  limit.perFile = 50;
  limit.reset();
});

const crowd = (n: number, files: string[] = ['Invoices']): OutgoingMail => ({ ...message(files), to: Array.from({ length: n }, (_, i) => `p${i}@customer.example`), bcc: [] });

test('one message names at most 20 recipients unless the connection says more, and a refused message is not counted', async () => {
  connections.update('office-mail', { files: [] });
  const limit = host.mailLimit;
  limit.reset();
  talks.length = 0;
  assert.equal(await host.mail!(crowd(20)), undefined);
  assert.equal(talks[0].rcpt.length, 20);
  await assert.rejects(host.mail!(crowd(21)), { message: 'the message names 21 recipients, more than 20' });
  assert.equal(talks.length, 1, 'nothing reached the mail server');
  // To, CC and BCC together.
  await assert.rejects(host.mail!({ ...crowd(10), cc: crowd(10).to, bcc: ['x@customer.example'] }), /names 21 recipients/);
  // The two refusals above did not use up the allowance: 100 messages are left of the hour, 49 of the file's 50.
  limit.perFile = 2;
  assert.equal(await host.mail!(crowd(1)), undefined, 'one counted so far, so one more fits');
  assert.match(String(await host.mail!(crowd(1))), /limited to 2 messages an hour/);
  limit.perFile = 50;
  limit.reset();

  // The setting raises or lowers it, and an AI draft cannot raise it.
  const cfg = (recipients: string) => ({ ...connections.get('office-mail').config, recipients });
  connections.update('office-mail', { config: cfg('3') });
  assert.equal(connections.get('office-mail').status, 'active', 'the same server, so no new approval');
  assert.equal(connections.get('office-mail').config.recipients, '3');
  await assert.rejects(host.mail!(crowd(4)), /names 4 recipients, more than 3/);
  assert.equal(await host.mail!(crowd(3)), undefined);
  connections.update('office-mail', { config: cfg('100') });
  assert.equal(await host.mail!(crowd(100)), undefined);
  await assert.rejects(host.mail!(crowd(101)), /names 101 recipients, more than 100/);
  const draft = connections.create({ name: 'ai-mail', type: 'smtp', config: { host: '127.0.0.1', port: String(port), from: 'ai@example.com', recipients: '100' } }, 'ai');
  assert.equal(draft.config.recipients, '20');
  assert.equal(connections.remove('ai-mail'), true);
  connections.update('office-mail', { config: cfg('') });
  limit.reset();
});
