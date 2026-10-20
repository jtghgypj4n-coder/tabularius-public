// The admin console can send a message to connected web clients, as FileMaker
// Server's "Send Message to Clients" does: it reaches them over the live
// (Server-Sent Events) channel as a `message` event the web client shows.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: import('../../store/src/index.ts').Store;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-msg-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  store.setPassword('Admin', 'pw', full.name);
  store.setPassword('Web', 'pw', full.name);
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

async function webLogin(account = 'Admin'): Promise<string> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`), 'x-tabularius-client': 'web' }, body: '{}',
  });
  return (await r.json()).response.token;
}

const admin = (path: string, body?: unknown) =>
  fetch(`${base}/tabularius/admin/v1${path}`, { method: 'POST', headers: { 'x-tabularius-admin': '1', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

/** Opens a live event stream and resolves with the first admin message it receives (or rejects on timeout). */
function waitForMessage(token: string): { done: Promise<string>; stop: () => void } {
  const abort = new AbortController();
  const done = (async () => {
    const res = await fetch(`${base}/tabularius/live/v1/databases/Charts/events`, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended before a message arrived');
      buf += value;
      let end: number;
      while ((end = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, end);
        buf = buf.slice(end + 2);
        if (/^event: message$/m.test(block)) return (JSON.parse(/^data: (.*)$/m.exec(block)![1]) as { text: string }).text;
      }
    }
  })();
  return { done, stop: () => abort.abort() };
}

/** Waits until the client's stream is registered, then returns its admin-console id. */
async function clientId(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const status = await (await fetch(`${base}/tabularius/admin/v1/status`)).json();
    if (status.clients.length) return status.clients[0].id;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('no client connected');
}

test('a message to one client reaches its live stream', { skip }, async () => {
  const token = await webLogin();
  const stream = waitForMessage(token);
  try {
    const id = await clientId();
    const sent = await admin(`/clients/${id}/message`, { text: 'Please save and log out in 5 minutes.' });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.delivered, 1, 'one stream received it');
    assert.equal(await stream.done, 'Please save and log out in 5 minutes.');
  } finally {
    stream.stop();
  }
});

test('a broadcast reaches every connected client', { skip }, async () => {
  const token = await webLogin();
  const stream = waitForMessage(token);
  try {
    await clientId();
    const sent = await admin('/message', { text: 'Server maintenance tonight.' });
    assert.equal(sent.status, 200);
    assert.ok(sent.body.delivered >= 1, 'at least this client received it');
    assert.equal(await stream.done, 'Server maintenance tonight.');
  } finally {
    stream.stop();
  }
});

test('an open live stream expires when its account is deactivated before a queued flush', { skip }, async () => {
  const token = await webLogin('Web');
  const abort = new AbortController();
  const res = await fetch(`${base}/tabularius/live/v1/databases/Charts/events`, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal });
  assert.equal(res.status, 200);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  try {
    await reader.read(); // retry event confirms the stream is established
    // Queue a flush, then revoke the identity before its microtask runs.
    store.update('Congress', 1, { Name: 'Queued event' });
    store.setAccountActive('Web', false);
    let text = '';
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      text += next.value;
      if (text.includes('event: expired')) break;
    }
    assert.match(text, /event: expired\ndata: \{\}/);
    assert.doesNotMatch(text, /event: change/);
  } finally {
    abort.abort();
    store.setAccountActive('Web', true);
  }
});

test('logging out closes its live stream and drops a queued change event', { skip }, async () => {
  const token = await webLogin('Web');
  const abort = new AbortController();
  const res = await fetch(`${base}/tabularius/live/v1/databases/Charts/events`, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  try {
    const initial = await reader.read();
    let text = initial.value ?? '';
    const queued: VoidFunction[] = [];
    const queue = globalThis.queueMicrotask;
    globalThis.queueMicrotask = (callback) => { queued.push(callback); };
    try { store.update('Congress', 1, { Name: 'Queued before logout' }); }
    finally { globalThis.queueMicrotask = queue; }
    await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions/${token}`, { method: 'DELETE' });
    for (const flush of queued) flush();
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      text += next.value;
    }
    assert.match(text, /event: expired/);
    assert.doesNotMatch(text, /event: change/);
  } finally { abort.abort(); }
});

test('an empty message is rejected, and an unknown client is a 404', { skip }, async () => {
  const empty = await admin('/message', { text: '   ' });
  assert.equal(empty.status, 400);
  const gone = await admin('/clients/deadbeef00/message', { text: 'hello?' });
  assert.equal(gone.status, 404);
});
