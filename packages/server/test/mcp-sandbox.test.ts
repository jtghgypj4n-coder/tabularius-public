// Scripts an AI runs stay offline, even when the server lets people's scripts use the network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { runScript } from '../../scripts/src/index.ts';
import type { Host } from '../src/host.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let host: Host;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-sandbox-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, scriptNetwork: true, testOutbound: { allowHosts: ['127.0.0.1'] } });
  server = s.server;
  base = s.url;
  host = s.host;
  // Nothing listens on port 9 here, so even a run that did go out would reach nothing.
  host.get('Charts')!.applyDesign([{ op: 'createScript', name: 'Fetch', text: 'Insert from URL [ $r ; "http://127.0.0.1:9/" ]\nExit Script [ Get ( LastError ) ]' }]);
  host.get('Charts')!.applyDesign([{ op: 'createScript', name: 'Mail', text: 'Send Mail [ Send via SMTP Server ; With dialog: Off ; To: "someone@example.com" ; Subject: "Hi" ; Message: "x" ]' }]);
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

test('run_script from AI never reaches the network', { skip }, async () => {
  assert.equal(host.scriptOptions().network, true);
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_script', arguments: { database: 'Charts', script: 'Fetch', trace: true } } }),
  });
  const text: string = (await res.json()).result.content[0].text;
  assert.match(text, /Network access is off/);
  // The same script run by the server's own options would try the network (and fail to connect).
  const direct = await runScript(host.get('Charts')!, 'Fetch', { ...host.scriptOptions(), trace: true });
  assert.doesNotMatch(JSON.stringify(direct), /Network access is off/);
});

test('run_script from AI never uses outbound test mode: Send Mail is refused, nothing reaches the outbox', { skip }, async () => {
  assert.ok(host.scriptOptions().outbound);
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'run_script', arguments: { database: 'Charts', script: 'Mail', trace: true } } }),
  });
  const text: string = (await res.json()).result.content[0].text;
  assert.match(text, /never sends email/);
  assert.equal(host.outbox!.list().filter((e) => e.kind === 'mail').length, 0);
});

test('run_script maxSeconds stops a script that never ends, saying which loop', { skip }, async () => {
  host.get('Charts')!.applyDesign([{ op: 'createScript', name: 'Forever', text: 'Loop\n\tSet Variable [ $n ; $n + 1 ]\nEnd Loop' }]);
  const t0 = Date.now();
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'run_script', arguments: { database: 'Charts', script: 'Forever', maxSeconds: 1 } } }),
  });
  const run = JSON.parse((await res.json()).result.content[0].text);
  assert.ok(Date.now() - t0 < 10_000, 'ended long before the default 60 seconds');
  assert.equal(run.halted, true);
  assert.match(JSON.stringify(run.actions), /time limit reached.*in the loop at line 1/);
  // More than the server's limit is refused by the tool's own schema.
  const over = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'run_script', arguments: { database: 'Charts', script: 'Forever', maxSeconds: 600 } } }),
  });
  assert.match(JSON.stringify(await over.json()), /maxSeconds|too_big|less than or equal/i);
});
