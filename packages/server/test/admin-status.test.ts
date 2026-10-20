// The admin console's refresh() reads server.ai.state (and .model) on every
// load, so the /v1/status payload must always carry server.ai — even when no AI
// key is set. It once did not, and the whole console page threw on load. This
// guards the shape the page depends on. (The browser-level backstop is the
// opt-in `npm run smoke:web`.)
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

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-status-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} }); // loopback: the console's own calls are open
  server = s.server;
  base = s.url;
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

test('status always reports server.ai, defaulting to no-key when the assistant is off', { skip }, async () => {
  const s = await fetch(`${base}/tabularius/admin/v1/status`).then((r) => r.json());
  assert.ok(s.server, 'status has a server block');
  assert.ok(s.server.ai, 'server.ai is present even with no AI key');
  // The page indexes a label table by this state and reads .model when connected.
  const states = ['connected', 'checking', 'no-key', 'credit-low', 'needs-workspace', 'bad-key', 'unreachable'];
  assert.ok(states.includes(s.server.ai.state), `server.ai.state is a known state (got ${s.server.ai.state})`);
  assert.equal(s.server.ai.state, 'no-key', 'no key configured in this fixture, so the assistant is off');
});

test('the console blocks new users and lets them in again; status says which', { skip }, async () => {
  const post = (on: unknown) => fetch(`${base}/tabularius/admin/v1/block-new-users`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify({ on }) });
  const status = () => fetch(`${base}/tabularius/admin/v1/status`).then((r) => r.json());
  assert.equal((await status()).server.blockNewUsers, false);
  assert.equal((await post('yes')).status, 400);
  assert.deepEqual(await (await post(true)).json(), { blockNewUsers: true });
  assert.equal((await status()).server.blockNewUsers, true);
  assert.deepEqual(await (await post(false)).json(), { blockNewUsers: false });
  assert.equal((await status()).server.blockNewUsers, false);
});
