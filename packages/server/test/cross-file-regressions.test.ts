import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { openIsolation, rest, basic, type Isolation } from './cross-file-matrix.ts';
import { runScript } from '../../scripts/src/index.ts';

let m: Isolation;
before(async () => { m = await openIsolation(); });
after(async () => { await m?.close(); });

test('by-name Perform Script requires a declared external data source in both directions', async () => {
  const [a, b] = m.stores;
  const call = (from: number, target: string) => runScript(m.stores[from], 'Call', { layout: 'Items', parameter: target, account: 'Shared', privileges: m.stores[from].privileges('Shared') });
  assert.equal((await call(0, 'Destination::Read')).result, 'SENTINEL_1');
  assert.equal((await call(0, `${b.name}::Read`)).result, 'SENTINEL_1', 'a declared source can be addressed by its hosted file name');
  assert.equal((await call(1, `${a.name}::Read`)).result, '100', 'no reverse declaration');
  assert.equal((await call(1, `${a.name.toLowerCase()}::Write`)).result, '100');
  assert.equal(a.get('Items', 1).fieldData.Value, 'SENTINEL_0');
  assert.equal((await call(0, 'Destination::Write')).result, '200', 'B owns the write privilege even though A is full access');
  assert.equal(b.get('Items', 1).fieldData.Value, 'SENTINEL_1');
});

test('fmDataSource binds the authenticated destination account generation', async (t) => {
  const [a, b] = m.stores;
  b.setPassword('Replacement', 'original-password', 'Reader');
  const login = () => m.login(0, 'Only0', 'only-0', { fmDataSource: [{ database: b.name, username: 'Replacement', password: 'original-password' }] });
  const token = await login();
  const path = rest(encodeURIComponent(a.name)) + '/layouts/External/records';
  assert.equal((await m.request(path, token)).status, 200);
  assert.equal(b.deleteAccount('Replacement'), true);
  b.setPassword('Replacement', 'new-password', '[Full Access]');
  const stale = await m.request(path, token);
  assert.equal(stale.status, 401, stale.text);
  assert.equal(stale.data.messages[0].code, '952');
  assert.doesNotMatch(stale.text, /SENTINEL_1/);
  const fresh = await m.login(0, 'Only0', 'only-0', { fmDataSource: [{ database: b.name, username: 'Replacement', password: 'new-password' }] });
  assert.equal((await m.request(path, fresh)).status, 200, 'new credentials establish a new binding');
  const verify = b.verifyAsync.bind(b);
  t.mock.method(b, 'verifyAsync', async (...args: Parameters<typeof b.verifyAsync>) => {
    const result = await verify(...args);
    b.deleteAccount('Replacement');
    b.setPassword('Replacement', 'third-password', '[Full Access]');
    return result;
  });
  const racing = await m.request(rest(encodeURIComponent(a.name)) + '/sessions', basic('Only0', 'only-0'), 'POST', { fmDataSource: [{ database: b.name, username: 'Replacement', password: 'new-password' }] });
  assert.equal(racing.status, 401, 'a replacement during password verification is not the authenticated account');
});

test('MCP never promotes unsupported file session credentials to loopback administrator', async () => {
  for (const from of [0, 1]) for (const auth of [m.tokens[from], m.sessions[from], 'Bearer unsupported-credential']) {
    for (const [method, params] of [
      ['tools/call', { name: 'get_record', arguments: { database: m.stores[1 - from].name, layout: 'Items', recordId: 1 } }],
      ['resources/read', { uri: `tabularius://${encodeURIComponent(m.stores[1 - from].name)}/schema` }],
    ]) {
      const res = await fetch(m.url + '/mcp', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(5000) });
      const body = await res.json();
      if (auth !== m.tokens[from]) assert.equal(res.status, 401, 'unsupported credentials are refused at authentication');
      assert.ok(body.error || body.result?.isError, JSON.stringify(body));
      assert.doesNotMatch(JSON.stringify(body), /SENTINEL_|CONTAINER_/);
    }
  }
  const local = await fetch(m.url + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_record', arguments: { database: m.stores[1].name, layout: 'Items', recordId: 1 } } }), signal: AbortSignal.timeout(5000) });
  assert.equal(local.status, 200);
  assert.match(await local.text(), /SENTINEL_1/, 'credential-free local administration remains explicit server authority');
});

test('logout cannot end another file session through the wrong database path', async () => {
  for (const from of [0, 1]) {
    const other = 1 - from;
    const auth = await m.login(other);
    const token = auth.slice('Bearer '.length);
    for (const name of [m.stores[from].name, m.stores[from].name.toLowerCase()]) {
      const r = await m.request(rest(encodeURIComponent(name)) + `/sessions/${token}`, m.sessions[from], 'DELETE');
      assert.equal(r.status, 401, r.text);
      assert.equal(r.data.messages[0].code, '952');
      assert.equal((await m.request(rest(encodeURIComponent(m.stores[other].name)) + '/layouts/Items/records', auth)).status, 200);
    }
    const ownPath = rest(encodeURIComponent(m.stores[other].name.toLowerCase())) + `/sessions/${token}`;
    assert.equal((await m.request(ownPath, auth, 'DELETE')).status, 200);
    assert.equal((await m.request(ownPath, auth, 'DELETE')).status, 200, 'logout remains idempotent');
    assert.equal((await m.request(rest(encodeURIComponent(m.stores[other].name)) + '/layouts/Items/records', auth)).status, 401);
  }
});
