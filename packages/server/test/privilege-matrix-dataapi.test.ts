import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, REST, WEB, ODATA, SQL, ACCOUNT, openMatrix, request, session, check, code, expected, snapshot, restore, assertMutation, assertVisible, type Operation } from './privilege-matrix.ts';

for (const row of SHAPES) test(`Data API matrix: ${row.name}`, async (t) => {
  const m = await openMatrix(row);
  try {
    const auth = await session(m);
    const gate = !auth ? 952 : row.expected.account === 'expired' ? 212 : 0;
    const records = REST + '/layouts/Items/records';
    const operations: { name: string; op: Operation; path: string; method?: string; body?: unknown; verify?: (body: any) => void }[] = [
      { name: 'layouts', op: 'metadata', path: REST + '/layouts', verify: (body) => assert.equal(body.response.layouts.some((l: any) => l.name === 'Items'), row.expected.layout !== 'none') },
      { name: 'layout metadata', op: 'metadata', path: REST + '/layouts/Items', verify: (body) => assert.equal(body.response.fieldMetaData.some((f: any) => f.name === 'Name'), row.expected.field !== 'none') },
      { name: 'scripts', op: 'metadata', path: REST + '/scripts', verify: (body) => assert.equal(body.response.scripts.some((s: any) => s.name === 'Read'), row.expected.script) },
      { name: 'list', op: 'read', path: records, verify: (body) => assertVisible(body.response.data, m) },
      { name: 'get', op: 'read', path: records + '/' + m.own },
      { name: 'other record', op: 'other', path: records + '/' + m.other },
      { name: 'find', op: 'find', path: REST + '/layouts/Items/_find', method: 'POST', body: { query: [{ Name: 'visible' }] } },
      { name: 'script', op: 'script', path: REST + '/layouts/Items/script/Read' },
      { name: 'create', op: 'create', path: records, method: 'POST', body: { fieldData: { Name: 'created', Owner: 'Caller' } } },
      { name: 'empty create', op: 'emptyCreate', path: records, method: 'POST', body: { fieldData: {} } },
      { name: 'duplicate', op: 'duplicate', path: records + '/' + m.own, method: 'POST', body: {} },
      { name: 'edit', op: 'edit', path: records + '/' + m.own, method: 'PATCH', body: { fieldData: { Name: 'changed' } } },
      { name: 'upload', op: 'upload', path: records + '/' + m.own + '/containers/Blob/1', method: 'POST' },
      { name: 'clear container', op: 'upload', path: records + '/' + m.own + '/containers/Blob/1', method: 'DELETE' },
      { name: 'delete', op: 'delete', path: records + '/' + m.own, method: 'DELETE' },
    ];
    for (const operation of [...operations]) {
      if (!['edit', 'delete', 'upload'].includes(operation.op)) continue;
      operations.push({ ...operation, name: operation.name + ' other', path: operation.path.replace('/' + m.own, '/' + m.other) });
    }
    for (const operation of operations) await t.test(operation.name, async () => {
      const before = snapshot(m.store);
      try {
        const body = operation.name.startsWith('upload') ? new FormData() : operation.body;
        if (body instanceof FormData) body.set('upload', new Blob(['matrix-upload']), 'matrix.txt');
        const reply = await request(m, operation.path, operation.method, body, auth ?? 'Bearer unavailable');
        const want = gate || (operation.name.endsWith(' other') && row.expected.limited ? 200 : 0) || (['layouts', 'scripts'].includes(operation.name) ? 0 : operation.name === 'script'
          ? expected(row.expected, 'script') || expected(row.expected, 'read') : expected(row.expected, operation.op));
        if (operation.name === 'script' && !gate && code(reply) === 0) {
          assert.equal(Number(reply.body.response.scriptError), want, reply.text);
          if (!row.expected.view || row.expected.field === 'none') assert.ok(!reply.text.includes('visible'));
        } else check(reply, want, operation.name);
        if (want) assert.deepEqual(snapshot(m.store), before, 'refusal must not change records or container references');
        else operation.verify?.(reply.body);
        // Every operation starts with the same two records, including all metadata and modIds.
        if (!want) {
          const id = operation.name.endsWith(' other') ? m.other : m.own;
          if (operation.name.startsWith('clear container')) assert.equal(m.store.containerId('Items', id, 'Blob'), undefined);
          else assertMutation(m, before, operation.op, id);
        }
      } finally { restore(m.store, before); }
    });
  } finally { await m.close(); }
});

test('password-age policy edits gate open REST/web sessions and bearer SQL/OData, while password repair stays reachable', async () => {
  const m = await openMatrix(SHAPES[0]);
  try {
    const tokens = [await session(m), await session(m, true)];
    const paths = [REST + '/layouts/Items/records', WEB + '/layouts/Items/records', ODATA + '/Items', SQL + '?q=SELECT%20Name%20FROM%20Items'];
    m.store.sql.prepare('UPDATE _fm_accounts SET password_changed = ? WHERE name = ?').run('2000-01-01T00:00:00.000Z', ACCOUNT);
    for (const age of [1, undefined, 1]) {
      m.store.setPasswordPolicy(age ? { maxAgeDays: age } : {});
      for (const token of tokens) for (const path of paths) {
        check(await request(m, path, path.startsWith(WEB) ? 'POST' : 'GET', path.startsWith(WEB) ? { ids: [m.own] } : undefined, token), age ? 212 : 0, 'live expiry policy');
      }
    }
    check(await request(m, REST + '/sessions', 'PATCH', { oldPassword: 'matrix-password', newPassword: 'matrix-password-repaired' }, tokens[0]), 0, 'password repair');
    check(await request(m, paths[0], 'GET', undefined, tokens[0]), 0, 'repaired session');
  } finally { await m.close(); }
});

test('revoking extended privileges also gates already-issued REST and web tokens', async () => {
  const m = await openMatrix(SHAPES[0]);
  try {
    const rest = await session(m);
    const web = await session(m, true);
    m.store.savePrivilegeSet({ ...SHAPES[0].definition, extendedPrivileges: [] });
    for (const [path, token, method, body] of [
      [REST + '/layouts/Items/records', rest, 'GET', undefined],
      [REST + '/layouts/Items/records/' + m.own, rest, 'PATCH', { fieldData: { Name: 'changed' } }],
      [WEB + '/layouts/Items/records', web, 'POST', { ids: [m.own] }],
      [WEB + '/layouts/Items/button', web, 'POST', { script: 'Edit', urlScript: true, ids: [m.own] }],
    ] as const) check(await request(m, path, method, body, token), 9, 'live extended-privilege revocation');
    assert.equal(m.store.get('Items', m.own).fieldData.Name, 'visible');
  } finally { await m.close(); }
});
