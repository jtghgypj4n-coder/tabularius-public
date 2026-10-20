import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, basic, openMatrix, request, expected, snapshot, restore, assertMutation, type Operation } from './privilege-matrix.ts';

for (const row of SHAPES) test(`MCP matrix: ${row.name}`, async (t) => {
  const m = await openMatrix(row);
  try {
    const e = row.expected;
    const gate = e.account !== 'active' ? 212 : !e.mcp ? 9 : 0;
    const common = { database: 'Matrix', layout: 'Items' };
    const operations: { name: string; op: Operation | 'raw'; args?: object }[] = [
      { name: 'describe_database', op: 'metadata' },
      { name: 'describe_layout', op: 'read', args: { sample: true } },
      { name: 'get_script', op: 'metadata', args: { script: 'Read' } },
      { name: 'get_container', op: 'raw', args: { container: m.store.containerId('Items', m.own, 'Blob') } },
      { name: 'find_records', op: 'read' },
      { name: 'search_records', op: 'read', args: { text: 'visible secret', tables: ['Items'] } },
      { name: 'search_records', op: 'read', args: { text: 'visible secret' } },
      { name: 'summarize_records', op: 'read' },
      { name: 'get_record', op: 'read', args: { recordId: m.own } },
      { name: 'get_record', op: 'other', args: { recordId: m.other } },
      { name: 'find_records', op: 'find', args: { query: [{ Name: 'visible' }] } },
      { name: 'run_script', op: 'script', args: { script: 'Read', recordId: m.own } },
      { name: 'create_record', op: 'create', args: { fieldData: { Name: 'created', Owner: 'Caller' } } },
      { name: 'update_record', op: 'edit', args: { recordId: m.own, fieldData: { Name: 'changed' } } },
      { name: 'update_records', op: 'edit', args: { query: [{ Owner: 'Caller' }], fieldData: { Name: 'changed' } } },
      { name: 'upload_container', op: 'upload', args: { recordId: m.own, field: 'Blob', filename: 'matrix.txt', mime: 'text/plain', data: 'dXBsb2Fk' } },
      { name: 'delete_record', op: 'delete', args: { recordId: m.own } },
      { name: 'sql_query', op: 'raw', args: { sql: 'SELECT Name FROM Items' } },
      { name: 'evaluate_calculation', op: 'raw', args: { formula: 'Items::Name' } },
    ];
    for (const operation of [...operations]) {
      if (!['edit', 'delete', 'upload'].includes(operation.op)) continue;
      if (!operation.args || !('recordId' in operation.args)) continue;
      operations.push({ ...operation, args: { ...operation.args, recordId: m.other } });
    }
    for (const operation of operations) await t.test(`${operation.name} (${operation.op})`, async () => {
      const before = snapshot(m.store);
      try {
        const reply = await request(m, '/mcp', 'POST', {
          jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: operation.name, arguments: { ...common, ...operation.args } },
        }, basic, { accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' });
        const result = reply.body?.result;
        assert.ok(result, reply.text);
        const text = result.content?.[0]?.text ?? '';
        let data: any;
        try { data = JSON.parse(text); } catch { data = undefined; }
        const other = operation.args && 'recordId' in operation.args && operation.args.recordId === m.other;
        let want = gate;
        if (!want) {
          if (other && e.limited) want = 200;
          else if (operation.name === 'describe_database') want = 0;
          else if (operation.name === 'describe_layout') want = e.layout === 'noRecords' ? 200 : expected(e, 'metadata');
          else if (operation.name === 'get_script') want = !e.script ? 104 : !e.scriptSource ? 9 : 0;
          else if (operation.name === 'search_records') want = !e.view || !operation.args || !('tables' in operation.args) ? 0
            : e.layout === 'none' ? 105 : e.layout === 'noRecords' ? 200 : 0;
          else if (operation.op === 'raw') {
            want = !e.view || e.field === 'none' || e.limited ? 9 : operation.name === 'evaluate_calculation' ? expected(e, 'read') : 0;
          } else if (operation.op === 'script') want = expected(e, 'script') || expected(e, 'read');
          else want = expected(e, operation.op);
        }
        assert.equal(!!result.isError, want !== 0, text);
        if (want) {
          assert.equal(data?.code ?? Number(/^Error (\d+):/.exec(text)?.[1]), want, text);
          assert.deepEqual(snapshot(m.store), before);
        } else if (['find_records', 'get_record'].includes(operation.name)) {
          if (e.limited) assert.ok(!text.includes('secret-other-row'));
          if (e.field === 'none') assert.ok(!text.includes('visible'));
        }
        if (!want && operation.name === 'describe_layout') {
          assert.equal(data.records, !e.view ? 0 : e.limited ? 1 : 2);
          if (e.field === 'none') assert.ok(!data.fields.some((f: any) => f.name === 'Name'));
          if (e.limited) assert.ok(!text.includes('secret-other-row'));
        }
        if (!want && operation.name === 'search_records') {
          const visible = e.view && e.field !== 'none' && !['none', 'noRecords'].includes(e.layout);
          assert.deepEqual(data.hits.map((h: any) => h.recordId).sort((a: number, b: number) => a - b), visible ? e.limited ? [m.own] : [m.own, m.other] : []);
          for (const hit of data.hits) assert.equal(hit.layout, 'Items');
          if (e.limited) assert.ok(!text.includes('secret-other-row'));
        }
        if (!want) assertMutation(m, before, operation.op, other ? m.other : m.own);
      } finally { restore(m.store, before); }
    });
  } finally { await m.close(); }
});

test('MCP search uses a readable alternative layout and respects token layout scope', async () => {
  const row = SHAPES.find((row) => row.name === 'layout-records-none')!;
  const m = await openMatrix(row);
  try {
    m.store.applyDesign([{ op: 'createLayout', name: 'Readable Items', occurrence: 'Items' }]);
    const restricted = `Bearer ${m.store.createApiToken('Caller', { layouts: ['Items'] })}`;
    for (const auth of [basic, `Bearer ${m.apiToken}`, restricted]) for (const tables of [['Items'], undefined]) {
      const reply = await request(m, '/mcp', 'POST', {
        jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_records', arguments: { database: 'Matrix', text: 'visible', tables } },
      }, auth, { accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' });
      const result = reply.body.result;
      const data = JSON.parse(result.content[0].text);
      if (auth === restricted && tables) {
        assert.equal(result.isError, true);
        assert.equal(data.code, 200);
      } else {
        assert.ok(!result.isError, reply.text);
        assert.deepEqual(data.hits.map((h: any) => [h.recordId, h.layout]), auth === restricted ? [] : [[m.own, 'Readable Items']]);
      }
    }
  } finally { await m.close(); }
});
