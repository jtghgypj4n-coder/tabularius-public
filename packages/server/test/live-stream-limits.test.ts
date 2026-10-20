// Live-update streams: one session may hold only so many open (the oldest closes), and a reader that stops taking data is cut off
// rather than having its events held without end.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server, ServerResponse } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { serve } from '../src/index.ts';
import { MAX_STREAMS_PER_SESSION, MAX_STREAM_BUFFER, putStream } from '../src/live.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-live-limits-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, watch: false });
  server = s.server;
  base = s.url;
  const store = s.host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  store.setPassword('Ann', 'pw', full.name);
  store.setPassword('Bob', 'pw', full.name);
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const login = async (who: string) => (await (await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${who}:pw`) } })).json()).response.token as string;
const open = (token: string, signal?: AbortSignal) => fetch(`${base}/tabularius/live/v1/databases/Charts/events`, { headers: { authorization: `Bearer ${token}` }, signal });

test('a session may hold only so many streams open; one more closes its oldest, and another session is not affected', { skip }, async () => {
  const ann = await login('Ann');
  const bob = await login('Bob');
  const aborts: AbortController[] = [];
  const ended: boolean[] = [];
  try {
    for (let i = 0; i < MAX_STREAMS_PER_SESSION; i++) {
      const a = new AbortController();
      aborts.push(a);
      const r = await open(ann, a.signal);
      assert.equal(r.status, 200, `stream ${i + 1}`);
      ended.push(false);
      void (async () => {
        try {
          const reader = r.body!.getReader();
          for (;;) if ((await reader.read()).done) break;
        } catch { /* cut off */ }
        ended[i] = true;
      })();
    }
    await sleep(50);
    assert.deepEqual(ended, ended.map(() => false), 'all ten are open');
    // The eleventh is served and the first one is closed.
    const a = new AbortController();
    aborts.push(a);
    assert.equal((await open(ann, a.signal)).status, 200);
    for (let i = 0; i < 100 && !ended[0]; i++) await sleep(20);
    assert.equal(ended[0], true, 'the oldest was closed');
    assert.deepEqual(ended.slice(1), ended.slice(1).map(() => false), 'the others stay open');
    // Someone else is not touched by it.
    const other = new AbortController();
    aborts.push(other);
    assert.equal((await open(bob, other.signal)).status, 200);
    await sleep(50);
    assert.deepEqual(ended.slice(1), ended.slice(1).map(() => false));
  } finally {
    for (const a of aborts) a.abort();
  }
});

test('a stream whose reader stopped taking data is cut off; others get their events', () => {
  const calls: string[] = [];
  const fake = (waiting: number, ended = false) => {
    const state = { destroyed: false };
    const res = {
      writableEnded: ended, writableLength: waiting,
      get destroyed() { return state.destroyed; },
      write(chunk: string) { calls.push(chunk); return true; },
      destroy() { state.destroyed = true; },
    };
    return res as unknown as ServerResponse;
  };
  const keeping = fake(1000);
  assert.equal(putStream(keeping, 'a'), true);
  const stalled = fake(MAX_STREAM_BUFFER + 1);
  assert.equal(putStream(stalled, 'b'), false);
  assert.equal(stalled.destroyed, true, 'cut off');
  assert.equal(putStream(fake(0, true), 'c'), false, 'an ended stream is not written to');
  assert.deepEqual(calls, ['a']);
});
