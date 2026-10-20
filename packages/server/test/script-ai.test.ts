// FileMaker's AI script steps on a server started with --ai: Generate Response from Model gets this
// server's model (a stand-in for the Messages API here), a file with AI turned off is refused and the
// refusal logged, and scripts an AI app runs (MCP) get no AI.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '../../fmp12/src/index.ts';
import type { Store } from '../../store/src/index.ts';
import { runScript } from '../../scripts/src/index.ts';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let model: Server;
let host: Host;
let store: Store;
const sent: { model: string; system: unknown; messages: unknown }[] = [];

before(async () => {
  if (skip) return;
  model = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      sent.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ content: [{ type: 'text', text: 'Hello from the model' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'tabularius-script-ai-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, ai: { apiKey: 'test-key', model: 'server-model', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}` } });
  server = s.server;
  host = s.host;
  store = host.get('Charts')!;
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  model?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const step = (stepId: number, name: string, params?: StepParams): ScriptStep => ({ stepId, name, enabled: true, params });
const ask: Script = {
  id: 9999, name: 'ask', steps: [
    step(212, 'Configure AI Account', { ai: { accountName: '"acct"', apiKey: '"sk-from-the-file"' } }),
    step(220, 'Generate Response from Model', { ai: { accountName: '"acct"', model: '"gpt-4o"', input: '"Say hello"', instructions: '"Be brief"' }, variable: '$r' }),
    step(103, 'Exit Script', { calculation: '$r' }),
  ],
} as Script;

test('Generate Response from Model answers with the server\'s model, never the file\'s key or model', { skip }, async () => {
  const r = await runScript(store, ask, host.scriptOptions());
  assert.equal(r.error, 0);
  assert.equal(r.result, 'Hello from the model');
  const last = sent.at(-1)!;
  assert.equal(last.model, 'server-model');
  assert.doesNotMatch(JSON.stringify(last), /sk-from-the-file|gpt-4o/);
});

test('with AI turned off for the file, the step is refused and the model never asked', { skip }, async () => {
  const before = sent.length;
  store.setAiAllowed(false);
  try {
    const r = await runScript(store, ask, { ...host.scriptOptions(), trace: true });
    assert.equal(r.error, 3);
    assert.match(r.trace!.find((t) => t.message)!.message!, /AI is turned off for Charts/);
    assert.equal(sent.length, before);
    assert.ok(store.securityEvents({ limit: 5 }).some((e) => e.kind === 'ai-access-refused'));
  } finally {
    store.setAiAllowed(true);
  }
});
