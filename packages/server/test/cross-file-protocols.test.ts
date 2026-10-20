import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp.ts';
import { PgClient } from './pg-client.ts';
import { openIsolation, variants, basic, rest, type Isolation } from './cross-file-matrix.ts';

let m: Isolation;
before(async () => { m = await openIsolation(); });
after(async () => { await m?.close(); });

// Generate required inputs from the published tool schemas, so new file tools join the matrix.
function sample(s: any, key = ''): any {
  if (s.const !== undefined) return s.const;
  if (s.default !== undefined) return s.default;
  if (s.enum) return s.enum[0];
  if (s.anyOf || s.oneOf) return sample((s.anyOf ?? s.oneOf)[0], key);
  if (s.type === 'object') return Object.fromEntries((s.required ?? []).map((k: string) => [k, sample(s.properties?.[k] ?? {}, k)]));
  if (s.type === 'array') return Array.from({ length: s.minItems ?? 0 }, () => sample(s.items ?? {}, key));
  if (s.type === 'boolean') return false;
  if (s.type === 'number' || s.type === 'integer') return s.minimum ?? 1;
  if (s.type === 'null') return null;
  return ({ mime: 'image/png', layout: 'Items', table: 'Items', script: 'Read', field: 'Value', sql: 'SELECT Value FROM Items', formula: 'Items::Value' } as Record<string, string>)[key] ?? 'probe';
}

for (const from of [0, 1]) test(`MCP tool/resource matrix ${from} → ${1 - from}`, async (t) => {
  const server = createMcpServer(m.host, { database: m.stores[from].name, account: 'Shared' });
  const client = new Client({ name: 'cross-file-matrix', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const listed = await client.listTools();
    let checked = 0;
    for (const tool of listed.tools) {
      const schema = tool.inputSchema as any;
      const fileKeys = ['database', 'from', 'to'].filter((key) => schema.properties?.[key]?.type === 'string');
      if (!fileKeys.length) continue;
      for (const name of variants(m.stores[1 - from].name)) {
        const args = sample(schema);
        for (const key of fileKeys) args[key] = name;
        const r = await client.callTool({ name: tool.name, arguments: args });
        const text = JSON.stringify(r);
        assert.equal(r.isError, true, `${tool.name}: ${text}`);
        assert.doesNotMatch(text, /SENTINEL_|CONTAINER_/);
        // An input-validation failure does not establish the authorization invariant.
        assert.doesNotMatch(text, /Input validation error|Invalid arguments/, `${tool.name}: generator needs a valid input`);
        checked++;
      }
    }
    assert.ok(checked > 100, 'covers the registered file-tool inventory');
    t.diagnostic(`${checked} generated file-tool refusals`);
    const resources = (await client.listResources()).resources;
    assert.ok(resources.length > 0);
    assert.ok(resources.every((r) => r.uri.startsWith(`tabularius://${encodeURIComponent(m.stores[from].name)}/`)));
    for (const template of (await client.listResourceTemplates()).resourceTemplates) {
      for (const name of variants(m.stores[1 - from].name)) {
        const uri = template.uriTemplate.replace('{database}', encodeURIComponent(name)).replace('{layout}', 'Items').replace('{script}', 'Read');
        await assert.rejects(client.readResource({ uri }), /privilege|hosted|missing|access/i, uri);
      }
    }
    for (const [i, store] of m.stores.entries()) assert.equal(store.get('Items', 1).fieldData.Value, `SENTINEL_${i}`);
  } finally { await client.close(); await server.close(); }
});

for (const from of [0, 1]) test(`SQL wire ${from}: database credentials, external reads, and read-only writes`, async () => {
  const own = m.stores[from], other = m.stores[1 - from];
  const c = await PgClient.open({ port: m.sqlPort, database: own.name, user: 'Shared', password: `password-${from}` });
  try {
    for (const extended of [false, true]) {
      const query = (sql: string) => extended ? c.extended(sql) : c.simple(sql);
      assert.deepEqual((await query('SELECT Value FROM Items')).rows, [[`SENTINEL_${from}`]]);
      const external = await query('SELECT Value FROM ExternalItems');
      if (from === 0) assert.deepEqual(external.rows, [['SENTINEL_1']]);
      else assert.ok(external.error, 'B has no external occurrence');
      assert.ok((await query("UPDATE Items SET Value = 'changed'")).error);
      for (const name of variants(other.name)) assert.ok((await query(`SELECT Value FROM "${name}".Items`)).error, 'a database qualifier cannot bypass the occurrence graph');
    }
  } finally { c.close(); }
  // Distinct credentials behind the same account name; warm A must not authenticate B.
  await assert.rejects(PgClient.open({ port: m.sqlPort, database: other.name, user: 'Shared', password: `password-${from}` }), /28P01/);
  for (const path of [`/fmi/odata/v4/${encodeURIComponent(other.name)}/Items`, `/tabularius/sql/v1/databases/${encodeURIComponent(other.name)}/tables`]) {
    const warm = await m.request(path.replace(encodeURIComponent(other.name), encodeURIComponent(own.name)), basic('Shared', `password-${from}`));
    assert.equal(warm.status, 200, warm.text);
    const r = await m.request(path, basic('Shared', `password-${from}`));
    assert.equal(r.status, 401, r.text);
  }
});

test('external Data API reads use B privileges and require a corresponding B account', async () => {
  const path = rest(encodeURIComponent(m.stores[0].name)) + '/layouts/External/records';
  const good = await m.request(path, m.sessions[0]);
  assert.equal(good.status, 200, good.text);
  assert.equal(good.data.response.data.length, 1);
  assert.equal(good.data.response.data[0].fieldData.Value, 'SENTINEL_1');
  const onlyA = await m.login(0, 'Only0', 'only-0');
  const denied = await m.request(path, onlyA);
  assert.equal(denied.data.messages[0].code, '200', denied.text);
  const write = await m.request(path + '/1', m.sessions[0], 'PATCH', { fieldData: { Value: 'changed' } });
  assert.equal(write.data.messages[0].code, '200', write.text);
  assert.equal(m.stores[1].get('Items', 1).fieldData.Value, 'SENTINEL_1');
});
