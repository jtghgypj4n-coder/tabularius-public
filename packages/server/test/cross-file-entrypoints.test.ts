import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { openIsolation, denied, rest, variants, basic, type Isolation } from './cross-file-matrix.ts';

let m: Isolation;
before(async () => { m = await openIsolation(); });
after(async () => { await m?.close(); });

const routes = (db: string) => [
  ['Data API read', rest(db) + '/layouts/Items/records', 'GET'],
  ['Data API write', rest(db) + '/layouts/Items/records/1', 'PATCH', { fieldData: { Value: 'changed' } }],
  ['Data API script', rest(db) + '/layouts/Items/script/Write', 'GET'],
  ['OData read', `/fmi/odata/v4/${db}/Items`, 'GET'],
  ['OData write', `/fmi/odata/v4/${db}/Items(1)`, 'PATCH', { Value: 'changed' }],
  ['OData script', `/fmi/odata/v4/${db}/Script.Write`, 'POST', {}],
  ['SQL HTTP', `/tabularius/sql/v1/databases/${db}`, 'POST', { sql: 'SELECT Value FROM Items' }],
  ['web layout', `/tabularius/app/v1/databases/${db}/layouts/Items`, 'GET'],
  ['web records', `/tabularius/app/v1/databases/${db}/layouts/Items/records`, 'POST', { ids: [1] }],
  ['audit', `/tabularius/design/v1/databases/${db}/audit`, 'GET'],
  ['security', `/tabularius/security/v1/databases/${db}`, 'GET'],
  ['live events', `/tabularius/live/v1/databases/${db}/events`, 'GET'],
  ['live clients', `/tabularius/live/v1/databases/${db}/clients`, 'GET'],
  ['changes', `/tabularius/changes/v1/databases/${db}`, 'GET'],
  ['AI assistant', `/tabularius/assistant/v1/databases/${db}`, 'POST', { messages: [{ role: 'user', content: 'Read Items' }] }],
  ['automations', `/tabularius/automations/v1/databases/${db}`, 'GET'],
  ['digests', `/tabularius/digests/v1/databases/${db}`, 'GET'],
  ['debug scripts', `/tabularius/debug/v1/databases/${db}/scripts`, 'GET'],
] as const;

for (const from of [0, 1]) test(`entry matrix ${from} → ${1 - from}: session and API tokens never transfer files`, async () => {
  const target = m.stores[1 - from];
  for (const auth of [m.sessions[from], m.tokens[from]]) {
    // Positive control warms the identity and file caches before crossing.
    const own = await m.request(rest(encodeURIComponent(m.stores[from].name)) + '/layouts/Items/records', auth);
    assert.equal(own.status, 200, own.text);
    assert.match(own.text, new RegExp(`SENTINEL_${from}`));
    for (const name of variants(target.name)) {
      for (const [label, path, method, body] of routes(encodeURIComponent(name))) {
        denied(await m.request(path, auth, method, body), `${label}, ${name}`);
      }
    }
    const stillAlive = await m.request(rest(encodeURIComponent(m.stores[from].name)) + '/layouts/Items/records', auth);
    assert.equal(stillAlive.status, 200, 'wrong-file requests must not destroy the source session');
  }
  assert.equal(target.get('Items', 1).fieldData.Value, `SENTINEL_${1 - from}`);
});

for (const from of [0, 1]) test(`server authority matrix ${from}: backup, restore, schedules, sessions, metrics, plugins`, async () => {
  const routes = [
    ['/backups', 'GET'], ['/backup', 'POST'], ['/restore', 'GET'], ['/restore', 'POST'],
    ['/sessions', 'GET'], ['/sessions/end', 'POST'], ['/metrics', 'GET'], ['/plugins', 'GET'],
  ] as const;
  for (const auth of [m.tokens[from], m.sessions[from]]) {
    for (const [path, method] of routes) denied(await m.request('/tabularius/admin/v1' + path, auth, method, method === 'POST' ? { database: m.stores[1 - from].name } : undefined), path);
    for (const path of ['/schedules', '/clients', '/databases']) denied(await m.request('/fmi/admin/api/v2' + path, auth), path);
    denied(await m.request('/fmi/admin/api/v2/schedules', auth, 'POST', { name: 'cross-file', database: m.stores[1 - from].name, script: 'Write' }), 'create schedule');
  }
  denied(await m.request('/fmi/admin/api/v2/user/auth', basic('Shared', `password-${from}`), 'POST', {}), 'file password cannot mint server authority');
  for (const [i, store] of m.stores.entries()) assert.equal(store.get('Items', 1).fieldData.Value, `SENTINEL_${i}`);
});

test('signed container matrix: equal ids cannot transfer signatures or warm bytes between files', async () => {
  for (const from of [0, 1]) {
    const own = await m.request(rest(encodeURIComponent(m.stores[from].name)) + '/layouts/Items/records/1', m.tokens[from]);
    assert.equal(own.status, 200, own.text);
    const url = new URL(own.data.response.data[0].fieldData.Blob);
    const valid = await m.request(url.pathname + url.search, '');
    assert.equal(valid.status, 200);
    assert.equal(valid.text, `CONTAINER_${from}`);
    for (const name of variants(m.stores[1 - from].name)) {
      const path = url.pathname.split('/'); path[3] = encodeURIComponent(name);
      denied(await m.request(path.join('/') + url.search, m.tokens[from]), 'foreign signed URL');
    }
    denied(await m.request(url.pathname, m.tokens[from]), 'a file token alone is not a signed URL');
  }
});
