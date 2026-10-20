import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, REST, WEB, ODATA, SQL, XML, ACCOUNT, openMatrix, request, check, xmlCode, expected, snapshot } from './privilege-matrix.ts';

for (const row of SHAPES) test(`API-token matrix: ${row.name}`, async (t) => {
  const m = await openMatrix(row);
  try {
    const e = row.expected;
    const invalid = e.account === 'expired' || e.account === 'inactive';
    const auth = `Bearer ${m.apiToken}`;
    const before = snapshot(m.store);
    for (const [name, path, method, body, want] of [
      ['REST', REST + '/layouts/Items/records', 'GET', undefined, invalid ? 952 : !e.rest ? 9 : expected(e, 'read')],
      // API tokens use Data API authority even on web routes.
      ['web', WEB + '/layouts/Items/records', 'POST', { ids: [m.own, m.other] }, invalid ? 952 : !e.rest ? 9 : expected(e, 'read')],
      ['OData', ODATA + '/Items', 'GET', undefined, invalid ? 212 : !e.odata ? 9 : !e.view ? 102 : 0],
      ['SQL', SQL + '?q=SELECT%20Name%20FROM%20Items', 'GET', undefined, invalid ? 212 : !e.sql || !e.view || e.field === 'none' || e.limited ? 9 : 0],
      ['Admin', '/fmi/admin/api/v2/databases', 'GET', undefined, 9],
    ] as const) await t.test(name, async () => {
      const reply = await request(m, path, method, body, auth);
      check(reply, want, name);
      if (!want && name === 'SQL') assert.deepEqual(reply.body.rows, [['visible'], ['secret-other-row']]);
      if (!want && name !== 'SQL') {
        if (e.limited) assert.ok(!reply.text.includes('secret-other-row'));
        if (e.field === 'none') assert.ok(!reply.text.includes('visible'));
        if (!e.limited && e.field !== 'none') assert.ok(reply.text.includes('secret-other-row'));
      }
      assert.deepEqual(snapshot(m.store), before);
    });
    await t.test('XML', async () => {
      const reply = await request(m, XML + '&-findall', 'GET', undefined, auth);
      const want = invalid ? 212 : !row.definition.extendedPrivileges?.includes('fmxml') ? 9 : expected(e, 'read');
      assert.equal(xmlCode(reply), want, reply.text);
      if (!want && e.field !== 'none') assert.ok(reply.text.includes('visible'));
      if (!want && e.limited) assert.ok(!reply.text.includes('secret-other-row'));
      assert.deepEqual(snapshot(m.store), before);
    });
    await t.test('MCP', async () => {
      const reply = await request(m, '/mcp', 'POST', {
        jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'find_records', arguments: { database: 'Matrix', layout: 'Items' } },
      }, auth, { accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' });
      if (invalid) {
        assert.equal(reply.status, 401, reply.text);
        assert.equal(reply.body.error, 'invalid_token');
      } else {
        assert.equal(reply.status, 200, reply.text);
        const result = reply.body.result;
        const text = result.content[0].text;
        const want = !e.mcp ? 9 : expected(e, 'read');
        assert.equal(!!result.isError, want !== 0, text);
        if (want) assert.equal(JSON.parse(text).code, want, text);
        else {
          if (e.limited) assert.ok(!text.includes('secret-other-row'));
          if (e.field === 'none') assert.ok(!text.includes('visible'));
          else assert.ok(text.includes('visible'));
        }
      }
      assert.deepEqual(snapshot(m.store), before);
    });
  } finally { await m.close(); }
});

test('API-token expiry follows edits to password policy, password date and must-change state', async (t) => {
  const m = await openMatrix(SHAPES[0]);
  try {
    const auth = `Bearer ${m.apiToken}`;
    const before = snapshot(m.store);
    for (const [name, change, invalid] of [
      ['issued token', () => {}, false],
      ['old password without policy', () => m.store.sql.prepare('UPDATE _fm_accounts SET password_changed = ? WHERE name = ?').run('2000-01-01T00:00:00.000Z', ACCOUNT), false],
      ['expiry policy added', () => m.store.setPasswordPolicy({ maxAgeDays: 1 }), true],
      ['expiry policy removed', () => m.store.setPasswordPolicy({}), false],
      ['expiry policy restored', () => m.store.setPasswordPolicy({ maxAgeDays: 1 }), true],
      ['fresh password date', () => m.store.setPassword(ACCOUNT, 'matrix-password', 'Matrix', { mustChange: false }), false],
      ['password change required', () => m.store.setMustChangePassword(ACCOUNT, true), true],
      ['password change cleared', () => m.store.setMustChangePassword(ACCOUNT, false), false],
    ] as const) {
      change();
      await t.test(name, async (t) => {
        const used = m.store.apiTokens()[0].lastUsed;
        await t.test('shared token resolver', () => {
          assert.equal(m.store.apiToken(m.apiToken)?.account, invalid ? undefined : ACCOUNT);
          if (invalid) assert.equal(m.store.apiTokens()[0].lastUsed, used, 'refused tokens are not marked used');
        });
        for (const path of [REST + '/layouts/Items/records', WEB + '/layouts/Items/records', ODATA + '/Items', SQL + '?q=SELECT%20Name%20FROM%20Items', XML + '&-findall', '/mcp']) await t.test(path.split('?')[0], async () => {
          const mcp = path === '/mcp';
          const web = path.startsWith(WEB);
          const reply = await request(m, path, mcp || web ? 'POST' : 'GET', mcp ? {
            jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'find_records', arguments: { database: 'Matrix', layout: 'Items' } },
          } : web ? { ids: [m.own] } : undefined, auth, mcp ? { accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' } : {});
          if (mcp) {
            assert.equal(reply.status, invalid ? 401 : 200, reply.text);
            if (invalid) assert.equal(reply.body.error, 'invalid_token');
            else { assert.ok(!reply.body.result.isError, reply.text); assert.ok(reply.text.includes('visible')); }
          } else if (path.startsWith(XML)) assert.equal(xmlCode(reply), invalid ? 212 : 0, reply.text);
          else check(reply, invalid ? path.startsWith(REST) || web ? 952 : 212 : 0, name);
          assert.deepEqual(snapshot(m.store), before);
        });
      });
    }
  } finally { await m.close(); }
});
