// A passkey registration that cannot be honoured is the caller's to correct: 400, not a server error. Runs on a created file, no fixtures.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

let dir = '', base = '', token = '';
let s: Awaited<ReturnType<typeof serve>>;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-pk-refusals-'));
  createStore(join(dir, 'Shop.openhbam.sqlite'), { mode: 'native' });
  s = await serve({ dir, port: 0, watch: false, log: () => {} });
  base = s.url.replace(/\/$/, '');
  const store = s.host.get('Shop')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest'])] });
  store.setPassword('Chief', 'pw', full.name);
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Shop/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Chief:pw'), 'content-type': 'application/json' }, body: '{}' });
  token = ((await r.json()) as { response: { token: string } }).response.token;
});
after(async () => {
  await new Promise<void>((r) => (s ? s.server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const register = async (body: string) => {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Shop/passkey/register`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body });
  return { status: r.status, code: ((await r.json()) as { messages: { code: string }[] }).messages[0].code };
};

test('a registration with a malformed response is a bad request', async () => {
  for (const body of ['{}', '{"response":null}', '{"response":"x"}', '{"response":[]}', '{"response":{}}',
    '{"response":{"attestationObject":1,"clientDataJSON":"e30","challenge":"c"}}', '{"response":{"attestationObject":"o","clientDataJSON":{},"challenge":"c"}}', '{"response":{"attestationObject":"o","clientDataJSON":"e30","challenge":5}}']) {
    assert.equal((await register(body)).status, 400, body);
  }
});

test('a registration with a challenge that was never issued is a bad request, error 960', async () => {
  assert.deepEqual(await register(JSON.stringify({ response: { attestationObject: 'o', clientDataJSON: 'e30', challenge: 'never-issued' } })), { status: 400, code: '960' });
});
