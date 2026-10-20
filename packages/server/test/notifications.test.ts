// Email notifications for server events: the console sets an address, errors reach it as a digest, and nothing is
// sent when mail is off. The mail is captured here; nothing leaves the machine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';
import type { OutgoingMail } from '../../scripts/src/index.ts';
import { Notifier } from '../src/notifications.ts';

let dir: string;
let server: Server;
let base: string;
let host: Host;
const sent: OutgoingMail[] = [];
// Host.mail is a getter (the operator's flag or an email connection); here a fake takes its place on this one host.
const setMail = (fn: ((m: OutgoingMail) => Promise<void | string>) | undefined) => {
  if (fn) Object.defineProperty(host, 'mail', { get: () => fn, configurable: true });
  else delete (host as { mail?: unknown }).mail;
};

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-notify-'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
});
after(async () => {
  await host.notifier.stop();
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, body: unknown) => fetch(`${base}/tabularius/admin/v1/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify(body),
});
const status = () => fetch(`${base}/tabularius/admin/v1/status`).then((r) => r.json() as Promise<{ server: { notifications: { to?: string; level?: string; canSend: boolean } } }>);

test('the console sets, shows and clears the address, and refuses anything that is not one address', async () => {
  assert.deepEqual((await status()).server.notifications, { canSend: false });
  for (const bad of ['nobody', 'a@b', 'a@b.com, c@d.com', 'a b@c.com', 5]) assert.equal((await post('notifications', { to: bad })).status, 400, `refuses ${String(bad)}`);
  assert.equal((await post('notifications', { to: 'ops@example.com', level: 'Loud' })).status, 400);
  assert.deepEqual(await (await post('notifications', { to: 'ops@example.com', level: 'Warning' })).json(), { to: 'ops@example.com', level: 'Warning', canSend: false });
  assert.deepEqual((await post('notifications/test', {}).then((r) => r.json())) as object, { sent: false, message: 'Mail sending is off on this server (the operator starts it with sending switched on), so nothing was sent.' });
  assert.deepEqual(await (await post('notifications', { to: '' })).json(), { canSend: false });
});

test('errors are collected into one digest; warnings only when asked; mail-off sends nothing; the notifier ignores its own lines', async () => {
  setMail(async (m) => { sent.push(m); });
  const n = new Notifier(host, { every: 20 });
  host.config.setNotifications({ to: 'ops@example.com', level: 'Error' });
  n.note('Information', 'server', 'started');
  n.note('Warning', 'server', 'disk is getting full');
  n.note('Error', 'server', 'backup failed: disk full');
  n.note('Error', 'server', 'file Invoices could not be opened');
  n.note('Error', 'notifications', 'a notification could not be sent');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['ops@example.com']);
  assert.match(sent[0].subject, /2 events/);
  assert.match(sent[0].text, /backup failed: disk full/);
  assert.match(sent[0].text, /could not be opened/);
  assert.doesNotMatch(sent[0].text, /getting full|started|could not be sent/);

  host.config.setNotifications({ to: 'ops@example.com', level: 'Warning' });
  n.note('Warning', 'server', 'disk is getting full');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /getting full/);

  // Off: nothing waits, nothing is sent.
  host.config.setNotifications(undefined);
  n.note('Error', 'server', 'an error nobody asked to hear about');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(sent.length, 2);

  // A refusal (a capture-only file is hosted) is reported, not thrown.
  host.config.setNotifications({ to: 'ops@example.com', level: 'Error' });
  setMail(async () => 'a file is capture-only');
  assert.deepEqual(await n.test(), { sent: false, message: 'a file is capture-only' });
  await n.stop();
  setMail(undefined);
});

test('a line the server logs reaches the notifier', async () => {
  setMail(async (m) => { sent.push(m); });
  host.config.setNotifications({ to: 'ops@example.com', level: 'Error' });
  const before = sent.length;
  host.logs!.event('Error', 'schedule "Nightly" failed: out of space', 'server');
  await host.notifier.send();
  assert.equal(sent.length, before + 1);
  assert.match(sent[before].text, /Nightly/);
  host.config.setNotifications(undefined);
  setMail(undefined);
});

test('text a stranger typed is one short plain line in the mail, the queue is capped, and test messages are throttled', async () => {
  setMail(async (m) => { sent.push(m); });
  host.config.setNotifications({ to: 'ops@example.com', level: 'Warning' });
  const n = new Notifier(host, { every: 60_000 });
  const before = sent.length;
  n.note('Warning', 'server', 'x\n\nURGENT: re-enter your admin password at http://evil\r\n' + 'y'.repeat(5000));
  for (let i = 0; i < 700; i++) n.note('Warning', 'server', `sign-in ${i}`);
  await n.send();
  assert.equal(sent.length, before + 1);
  const text = sent[before].text;
  assert.match(sent[before].subject, /701 events/);
  assert.ok(text.split('\n').filter(Boolean).every((l) => l.length <= 300 || /^\(and \d+ more/.test(l)), 'no line is long');
  assert.match(text, /URGENT: re-enter your admin password at http:\/\/evil/, 'the words stay');
  assert.doesNotMatch(text, /x\n\nURGENT/, 'but not as a line of their own');
  assert.ok(text.length < 20_000, 'a bounded mail');
  assert.match(text, /\(and 651 more/);

  const first = await n.test();
  assert.equal(first.sent, true);
  assert.equal((await n.test()).sent, false, 'a second test at once is refused');
  host.config.setNotifications(undefined);
  setMail(undefined);
});

test('a cluster follower passes its errors and warnings to the leader, which mails them marked with the worker', async () => {
  const { forwardLogs, logFromFollower } = await import('../src/cluster.ts');
  const told: unknown[] = [];
  const logs: { onEntry?: (type: 'Information' | 'Warning' | 'Error', source: string, message: string) => void } = {};
  let clock = 0;
  forwardLogs(logs, (n) => told.push(n), 2, () => clock);
  logs.onEntry!('Information', 'x', 'started');
  logs.onEntry!('Error', 'backup', 'disk full');
  logs.onEntry!('Warning', 'sync', 'slow');
  assert.deepEqual(told, [{ k: 'log', from: 2, type: 'Error', source: 'backup', message: 'disk full' }, { k: 'log', from: 2, type: 'Warning', source: 'sync', message: 'slow' }]);

  // A flood is capped for the minute, then passes again.
  told.length = 0;
  for (let i = 0; i < 500; i++) logs.onEntry!('Error', 'loop', `line ${i}`);
  assert.equal(told.length, 118);
  clock = 61_000;
  logs.onEntry!('Error', 'loop', 'later');
  assert.equal(told.length, 119);

  // The leader hands the line to its notifier.
  const heard: string[] = [];
  logFromFollower({ note: (type, source, message) => heard.push(`${type} ${source}: ${message}`) }, told[0] as never);
  assert.deepEqual(heard, ['Error loop: [worker 2] line 0']);
});

test('a digest that failed to send is kept for the next one, newest lines after it, and the queue stays capped', async () => {
  let fail = true;
  setMail(async (m) => { if (fail) throw new Error('connection refused'); sent.push(m); });
  host.config.setNotifications({ to: 'ops@example.com', level: 'Error' });
  const n = new Notifier(host, { every: 20 });
  const before = sent.length;
  n.note('Error', 'backup', 'first failure');
  n.note('Error', 'backup', 'second failure');
  await n.send();
  assert.equal(sent.length, before, 'nothing went out');
  fail = false;
  n.note('Error', 'backup', 'third failure');
  await n.send();
  assert.equal(sent.length, before + 1);
  assert.match(sent[before].subject, /3 events/);
  assert.deepEqual(sent[before].text.split('\n').filter((l) => /failure/.test(l)).map((l) => l.replace(/^Error backup: /, '')), ['first failure', 'second failure', 'third failure']);

  // The failed digest comes back by itself on the timer, with no new line to start one.
  fail = true;
  n.note('Error', 'backup', 'fourth failure');
  await n.send();
  fail = false;
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(sent.length, before + 2);
  assert.match(sent[before + 1].text, /fourth failure/);

  // Failing for a long while keeps no more than the queue holds; the rest are counted.
  fail = true;
  for (let i = 0; i < 600; i++) n.note('Error', 'backup', `line ${i}`);
  await n.send();
  n.note('Error', 'backup', 'late line');
  fail = false;
  await n.send();
  assert.equal(sent.length, before + 3);
  assert.match(sent[before + 2].subject, /601 events/);
  assert.match(sent[before + 2].text, /\(and 551 more/);
  await n.stop();
  host.config.setNotifications(undefined);
  setMail(undefined);
});

test('stopping the server waits for the last digest to go out', async () => {
  const d = mkdtempSync(join(tmpdir(), 'tabularius-notify-stop-'));
  const s = await serve({ dir: d, port: 0, watch: false, log: () => {} });
  try {
    let delivered = false;
    const fn = async (m: OutgoingMail) => { await new Promise((r) => setTimeout(r, 150)); sent.push(m); delivered = true; };
    Object.defineProperty(s.host, 'mail', { get: () => fn, configurable: true });
    s.host.config.setNotifications({ to: 'ops@example.com', level: 'Error' });
    s.host.logs!.event('Error', 'the last words before shutdown', 'server');
    await new Promise<void>((r) => s.server.close(() => r()));
    assert.equal(delivered, true, 'close finished only after the mail went out');
    assert.match(sent[sent.length - 1].text, /the last words before shutdown/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
