import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createStore } from '../../store/src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { serve } from '../src/index.ts';

// The admin console's first-run checklist is worked out from real server state, not remembered.

let dir: string;
let server: Server;
let base: string;
let service = false;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-setup-'));
  createStore(join(dir, 'Tasks' + STORE_EXT));
  const s = await serve({ dir, port: 0, log: () => {}, serviceInstalled: () => service });
  server = s.server;
  base = s.url;
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const status = async () => (await (await fetch(`${base}/tabularius/admin/v1/status`, { headers: { 'x-tabularius-admin': '1' } })).json()).setup;

test('first-run checklist: each step follows the server\'s real state', async () => {
  const first = await status();
  assert.equal(first.passwordSet, false);
  assert.equal(first.backupMade, false);
  assert.equal(first.aiConnected, false);
  assert.equal(first.service, false);
  // A file with no account carried over from FileMaker has no blank-password account to fix.
  assert.equal(first.accountsSecured, true);

  const r = await fetch(`${base}/tabularius/admin/v1/backup`, { method: 'POST', headers: { 'x-tabularius-admin': '1' } });
  assert.equal(r.status, 200);
  service = true;
  const next = await status();
  assert.equal(next.backupMade, true);
  assert.equal(next.service, true);
});
