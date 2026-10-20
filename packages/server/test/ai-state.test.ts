// The AI status the admin console shows, found by asking the provider: connected, no key, needs a workspace,
// credit too low. The key and workspace can be saved in files and are read again when they change. Never the key.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Assistant, type AiState } from '../src/assistant.ts';

const dir = mkdtempSync(join(tmpdir(), 'ai-state-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const host = { dir } as never;
const posix = process.platform === 'win32' ? { skip: 'file modes' } : {};
let credentialNow = Date.now();
const clock = () => credentialNow;

/** A stand-in provider that wants a workspace header from keys named "sk-person…". */
async function provider(creditLeft = true) {
  const seen: { path: string; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      seen.push({ path: req.url!, headers: req.headers });
      const reply = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      const key = String(req.headers['x-api-key']);
      if (key.startsWith('sk-bad')) return reply(401, { error: { message: 'invalid x-api-key' } });
      if (key.startsWith('sk-person') && !req.headers['anthropic-workspace-id']) {
        return reply(400, { error: { message: 'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header' } });
      }
      if (req.url!.startsWith('/v1/models')) return reply(200, { data: [] });
      if (!creditLeft) return reply(400, { error: { message: 'Your credit balance is too low to access the Anthropic API.' } });
      reply(200, { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { seen, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close() };
}

/** The state once the first check has finished. */
async function settled(a: Assistant): Promise<AiState> {
  for (let i = 0; i < 100; i++) {
    const s = a.state;
    if (s.state !== 'checking') return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('still checking');
}

test('no key', () => {
  assert.equal(new Assistant(host, {} as never, {}).state.state, 'no-key');
});

test('an embedding model alone shows in the state, with the host only (no path, no credentials)', () => {
  const a = new Assistant(host, {} as never, { embedUrl: 'http://user:secret@localhost:11434/v1', embedModel: 'nomic-embed-text' });
  assert.deepEqual(a.state.embeddings, { model: 'nomic-embed-text', host: 'localhost:11434' });
  assert.equal(a.state.state, 'no-key');
  assert.doesNotMatch(JSON.stringify(a.state), /secret|\/v1/);
  assert.equal(new Assistant(host, {} as never, {}).state.embeddings, undefined);
});

test('connected: checked with a request that costs nothing; the key is never in the state', async () => {
  const p = await provider();
  try {
    const a = new Assistant(host, {} as never, { apiKey: 'sk-test-secret', keySource: 'file', model: 'm', baseUrl: p.baseUrl });
    assert.equal(a.state.state, 'checking');
    const s = await settled(a);
    assert.deepEqual([s.state, s.model, s.keySource], ['connected', 'm', 'file']);
    assert.ok(!JSON.stringify(s).includes('sk-test-secret'));
    assert.ok(p.seen.every((r) => r.path.startsWith('/v1/models')));
  } finally {
    p.close();
  }
});

test('a key without a workspace is reported as needing one, and works once the workspace is given', async () => {
  const p = await provider();
  try {
    const without = await settled(new Assistant(host, {} as never, { apiKey: 'sk-person-1', baseUrl: p.baseUrl }));
    assert.equal(without.state, 'needs-workspace');
    assert.match(without.message ?? '', /workspace/);
    const a = new Assistant(host, {} as never, { apiKey: 'sk-person-1', workspaceId: 'wrkspc_01AbC', baseUrl: p.baseUrl });
    assert.equal((await settled(a)).state, 'connected');
    assert.equal(p.seen.at(-1)!.headers['anthropic-workspace-id'], 'wrkspc_01AbC');
  } finally {
    p.close();
  }
});

test('a key the provider refuses', async () => {
  const p = await provider();
  try {
    assert.equal((await settled(new Assistant(host, {} as never, { apiKey: 'sk-bad', baseUrl: p.baseUrl }))).state, 'bad-key');
  } finally {
    p.close();
  }
});

test('credit too low is found by a real question', async () => {
  const p = await provider(false);
  try {
    const a = new Assistant(host, {} as never, { apiKey: 'sk-test', baseUrl: p.baseUrl });
    assert.equal((await settled(a)).state, 'connected');
    await assert.rejects((a as unknown as { call: (...x: unknown[]) => Promise<unknown> }).call('s', [], [{ role: 'user', content: 'hi' }]), /credit balance/);
    assert.equal(a.state.state, 'credit-low');
  } finally {
    p.close();
  }
});

test('saving a new key or workspace id is picked up without a restart', posix, async () => {
  const p = await provider();
  const keyFile = join(dir, 'anthropic-key');
  const workspaceFile = join(dir, 'anthropic-workspace-id');
  try {
    writeFileSync(keyFile, 'sk-bad-old\n');
    chmodSync(keyFile, 0o600);
    const a = new Assistant(host, {} as never, { apiKey: 'sk-bad-old', keyFile, workspaceFile, baseUrl: p.baseUrl, now: clock });
    assert.equal((await settled(a)).state, 'bad-key');
    // Re-saved with a good key made outside a workspace.
    writeFileSync(keyFile, 'sk-person-2\n');
    utimesSync(keyFile, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    credentialNow += 1100;
    assert.equal((await settled(a)).state, 'needs-workspace');
    writeFileSync(workspaceFile, 'wrkspc_01Zed\n');
    utimesSync(workspaceFile, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    credentialNow += 1100;
    assert.equal((await settled(a)).state, 'connected');
    assert.equal(p.seen.at(-1)!.headers['x-api-key'], 'sk-person-2');
    assert.equal(p.seen.at(-1)!.headers['anthropic-workspace-id'], 'wrkspc_01Zed');
  } finally {
    p.close();
  }
});

test('a key file other users can read is not used, and the old key stays', posix, async () => {
  const keyFile = join(dir, 'open-key');
  writeFileSync(keyFile, 'sk-first');
  chmodSync(keyFile, 0o600);
  const a = new Assistant(host, {} as never, { apiKey: 'sk-first', keyFile, now: clock });
  assert.equal(a.available, true);
  writeFileSync(keyFile, 'sk-leaky');
  chmodSync(keyFile, 0o644);
  utimesSync(keyFile, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
  credentialNow += 1100;
  assert.match(a.state.message ?? '', /can be read by other users/);
  assert.ok(!JSON.stringify(a.state).includes('sk-leaky'));
});
