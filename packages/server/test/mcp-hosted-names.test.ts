// When an AI app names a database that isn't hosted, the reply lists the hosted files. It lists only the ones the
// signed-in identity could open, so a limited account can't learn what else the server holds.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-hosted-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  copyFileSync(fixture, join(dir, 'Secret.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.savePrivilegeSet({ name: 'Clerk', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp'] });
  store.setPassword('Clerk', 'pw', 'Clerk');
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

async function text(auth?: string, name = 'find_records', arguments_: Record<string, unknown> = { database: 'Nope', layout: 'Congress' }): Promise<string> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
      ...(auth ? { authorization: 'Basic ' + btoa(auth) } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: arguments_ } }),
  });
  return (await res.json()).result.content[0].text as string;
}

test('the hosted list names only the files the signed-in account can open', { skip }, async () => {
  const clerk = await text('Clerk:pw');
  assert.match(clerk, /Hosted: Charts/);
  assert.doesNotMatch(clerk, /Secret/);
  const admin = await text();
  assert.match(admin, /Charts/);
  assert.match(admin, /Secret/);
});

test('a right account name with a wrong password learns no file names', { skip }, async () => {
  const text1 = await text('Clerk:wrong');
  assert.doesNotMatch(text1, /Charts|Secret/);
});

test('optimization tools list only files the signed-in account can open', { skip }, async () => {
  for (const [name, args] of [
    ['optimization_fix', { database: 'Nope' }],
    ['optimization_move_containers', { database: 'Nope' }],
  ] as const) {
    const result = await text('Clerk:pw', name, args);
    assert.match(result, /Hosted: Charts/);
    assert.doesNotMatch(result, /Secret/);
  }
});
