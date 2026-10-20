import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request } from 'node:http';
import { Store, writer } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';
import { DataApi } from '../src/dataapi.ts';

async function setup(t: { after(fn: () => Promise<void>): void }) {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycle-requests-'));
  const host = new Host(dir);
  const store = host.create('A');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Value' }, { name: 'Pic', type: 'container' }] }]);
  store.create('Items', { Value: 'acknowledged' });
  const api = new DataApi(host);
  const token = api.open(store, 'Admin', 'web');
  let bodyStarted: (() => void) | undefined;
  const server = createServer((req, res) => {
    // Observe the consumer attaching without putting the stream into flowing mode.
    req.on('newListener', (event) => {
      if (event === 'data' || event === 'readable') queueMicrotask(() => bodyStarted?.());
    });
    void writer.run({}, () => api.handle(req, res, new URL(req.url!, 'http://localhost')));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/fmi/data/vLatest/databases/A`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });
  async function held(path: string, method: string, body: string, contentType = 'application/json') {
    const started = new Promise<void>((r) => { bodyStarted = r; });
    let finish!: () => void;
    const response = new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': contentType, 'content-length': Buffer.byteLength(body) } }, (res) => {
        let text = '';
        res.setEncoding('utf8').on('data', (chunk) => { text += chunk; });
        res.on('end', () => { try { resolve({ status: res.statusCode!, body: JSON.parse(text) }); } catch (e) { reject(e); } });
      });
      req.on('error', reject);
      req.write(body.slice(0, 1));
      finish = () => req.end(body.slice(1));
    });
    await started;
    return { finish, response };
  }
  return { dir, host, store, api, token, base, held, server };
}

for (const change of ['close', 'close-reopen', 'pause', 'pause-resume', 'schema', 'logout'] as const) {
  test(`a write waiting for its body is refused after ${change}, and its slot is released`, { timeout: 10_000 }, async (t) => {
    const { host, store, api, token, base, held } = await setup(t);
    const pending = await held('/layouts/Items/records/1', 'PATCH', JSON.stringify({ fieldData: { Value: 'late write' } }));
    if (change === 'close' || change === 'close-reopen') host.closeFile('A');
    if (change === 'close-reopen') host.openFile('A');
    if (change === 'pause' || change === 'pause-resume') host.pauseFile('A');
    if (change === 'pause-resume') host.openFile('A');
    if (change === 'schema') store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Value', name: 'Renamed' }]);
    if (change === 'logout') api.end(token);
    pending.finish();
    const result = await pending.response;
    assert.ok(result.status >= 400 && result.status < 500, JSON.stringify(result));
    assert.notEqual(result.body.messages[0].code, '-1', 'no closed-connection crash');
    assert.equal((api as unknown as { inFlightWrites: Map<string, unknown> }).inFlightWrites.size, 0);
    host.openFile('A');
    const current = host.get('A')!;
    const field = change === 'schema' ? 'Renamed' : 'Value';
    assert.equal(current.find('Items').records[0].fieldData[field], 'acknowledged');
    const fresh = change === 'pause' || change === 'pause-resume' || change === 'schema' ? token : api.open(current, 'Admin', 'web');
    const retry = await fetch(base + '/layouts/Items/records/1', {
      method: 'PATCH', headers: { authorization: `Bearer ${fresh}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fieldData: { [field]: 'retry' } }), signal: AbortSignal.timeout(3000),
    });
    assert.equal(retry.status, 200, await retry.text());
    assert.equal(current.find('Items').records[0].fieldData[field], 'retry');
  });
}

test('a container upload cannot write through a paused store', { timeout: 10_000 }, async (t) => {
  const { host, store, held } = await setup(t);
  const body = '--boundary\r\nContent-Disposition: form-data; name="upload"; filename="p.txt"\r\nContent-Type: text/plain\r\n\r\nlate\r\n--boundary--\r\n';
  const pending = await held('/layouts/Items/records/1/containers/Pic', 'POST', body, 'multipart/form-data; boundary=boundary');
  host.pauseFile('A');
  pending.finish();
  const result = await pending.response;
  assert.ok(result.status >= 400 && result.status < 500, JSON.stringify(result));
  assert.equal(store.sql.prepare('SELECT count(*) AS n FROM _fm_containers').get()!.n, 0);
  host.openFile('A');
});

test('queued writes cannot inherit a session ended while peers are closing the file', { timeout: 10_000 }, async (t) => {
  const { host, store, api, token, base, held, server } = await setup(t);
  const pending = await held('/layouts/Items/records/1', 'PATCH', JSON.stringify({ fieldData: { Value: 'held' } }));
  let entered!: () => void, release!: () => void;
  const closingPeers = new Promise<void>((r) => { entered = r; });
  const gate = new Promise<void>((r) => { release = r; });
  host.peers = { sync: async () => { entered(); await gate; } };
  const closing = host.closeFileEverywhere('A');
  await closingPeers;
  // This session signs in after the close command started, before the local close.
  const late = api.open(store, 'Admin', 'web');
  const received = new Promise<void>((r) => server.once('request', () => queueMicrotask(r)));
  const queued = fetch(base + '/layouts/Items/records/1', { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ fieldData: { Value: 'queued' } }) });
  await received;
  assert.equal((api as unknown as { inFlightWrites: Map<string, { waiting: unknown[] }> }).inFlightWrites.get(token)!.waiting.length, 1);
  release();
  assert.equal(await closing, true);
  assert.equal(api.alive(late), false);
  host.openFile('A');
  pending.finish();
  assert.equal((await pending.response).status, 409);
  const result = await queued;
  assert.equal(result.status, 401, await result.text());
  assert.equal((api as unknown as { inFlightWrites: Map<string, unknown> }).inFlightWrites.size, 0);
  assert.equal(host.get('A')!.find('Items').records[0].fieldData.Value, 'acknowledged');
});

test('a sign-in checking its password cannot reopen a closed client session', { timeout: 10_000 }, async (t) => {
  const { host, store, api, base } = await setup(t);
  store.setPassword('Admin', 'pw');
  let entered!: () => void;
  const checking = new Promise<void>((r) => { entered = r; });
  const verify = store.verifyAsync.bind(store);
  t.mock.method(store, 'verifyAsync', (...args: Parameters<typeof verify>) => {
    const pending = verify(...args);
    entered();
    return pending;
  });
  const login = fetch(base + '/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' }, body: '{}' });
  await checking;
  host.closeFile('A');
  host.openFile('A');
  const result = await login;
  assert.equal(result.status, 409, await result.text());
  assert.equal(api.sessionCount, 0);
});

for (const change of ['close-reopen', 'pause-resume', 'schema'] as const) test(`an awaiting script with a record lock stops after ${change}`, { timeout: 10_000 }, async (t) => {
  const { host, store, api, token, base } = await setup(t);
  store.applyDesign([{ op: 'createScript', name: 'Waiting', text: [
    'Go to Record/Request/Page [ First ]',
    'Set Field [ Items::Value ; "uncommitted" ]',
    'Send Mail [ Send via SMTP Server ; With dialog: Off ; To: "nobody@example.invalid" ; Subject: "test" ; Message: "test" ]',
    'Commit Records/Requests [ With dialog: Off ]',
  ].join('\n') }]);
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>((r) => { entered = r; });
  const gate = new Promise<void>((r) => { release = r; });
  const options = host.scriptOptions();
  t.mock.method(host, 'scriptOptions', () => ({ ...options, mail: async () => { entered(); await gate; } }));
  t.after(async () => { release(); });
  const pending = fetch(base + '/layouts/Items/script/Waiting', { headers: { authorization: `Bearer ${token}` } });
  await waiting;
  assert.equal(store.locks.holder('Items', 1)?.owner, token);
  if (change === 'schema') store.applyDesign([{ op: 'createField', table: 'Items', name: 'Added' }]);
  else {
    if (change === 'close-reopen') host.closeFile('A'); else host.pauseFile('A');
    host.openFile('A');
  }
  release();
  const result = await pending;
  assert.equal(result.status, 409, await result.text());
  const current = host.get('A')!;
  assert.equal(current.find('Items').records[0].fieldData.Value, 'acknowledged');
  assert.equal(store.locks.holder('Items', 1), undefined);
  assert.equal(current.locks.holder('Items', 1), undefined);
  const fresh = change === 'close-reopen' ? api.open(current, 'Admin', 'web') : token;
  const retry = await fetch(base + '/layouts/Items/records/1', { method: 'PATCH', headers: { authorization: `Bearer ${fresh}`, 'content-type': 'application/json' }, body: JSON.stringify({ fieldData: { Value: 'retry' } }) });
  assert.equal(retry.status, 200, await retry.text());
});

test('online backup leaves connected writers usable and keeps acknowledged data', { timeout: 10_000 }, async (t) => {
  const { dir, store, held } = await setup(t);
  const pending = await held('/layouts/Items/records', 'POST', JSON.stringify({ fieldData: { Value: 'during backup' } }));
  const copy = join(dir, 'copy.sqlite');
  const backup = store.backup(copy);
  pending.finish();
  assert.equal((await pending.response).status, 200);
  await backup;
  const saved = new Store(copy, 'copy');
  try {
    assert.equal(saved.find('Items').records[0].fieldData.Value, 'acknowledged');
    assert.equal(saved.sql.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
  } finally { saved.close(); }
  assert.deepEqual(store.find('Items').records.map((r) => r.fieldData.Value), ['acknowledged', 'during backup']);
});
