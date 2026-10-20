import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, ODATA, openMatrix, request, check, expected, snapshot, restore, assertMutation, type Operation } from './privilege-matrix.ts';

for (const row of SHAPES) test(`OData matrix: ${row.name}`, async (t) => {
  const m = await openMatrix(row);
  try {
    const e = row.expected;
    const gate = e.account !== 'active' ? 212 : !e.odata ? 9 : 0;
    const operations: { name: string; op: Operation; path: string; method?: string; body?: unknown; verify?: (reply: Awaited<ReturnType<typeof request>>) => void }[] = [
      { name: 'service', op: 'metadata', path: '', verify: (r) => assert.equal(r.body.value.some((s: any) => s.name === 'Items'), e.view) },
      { name: '$metadata', op: 'metadata', path: '/$metadata', verify: (r) => {
        assert.equal(r.text.includes('<EntityType Name="Items">'), e.view);
        assert.equal(r.text.includes('<Property Name="Name"'), e.field !== 'none');
      } },
      { name: 'list', op: 'read', path: '/Items', verify: (r) => {
        assert.equal(r.body.value.length, e.limited ? 1 : 2);
        if (e.limited) assert.deepEqual(r.body.value.map((r: any) => r.ROWID), [m.own]);
        for (const value of r.body.value) assert.equal(Object.hasOwn(value, 'Name'), e.field !== 'none');
      } },
      { name: 'get', op: 'read', path: `/Items(${m.own})` },
      { name: 'other record', op: 'other', path: `/Items(${m.other})` },
      { name: '$count', op: 'read', path: '/Items/$count', verify: (r) => assert.equal(Number(r.text), e.limited ? 1 : 2) },
      { name: '$filter', op: 'find', path: "/Items?$filter=Name%20eq%20'visible'" },
      { name: 'property', op: 'find', path: `/Items(${m.own})/Name` },
      { name: 'container read', op: 'find', path: `/Items(${m.own})/Blob/$value` },
      { name: 'script', op: 'script', path: '/Script.Read', method: 'POST', body: {} },
      { name: 'create', op: 'create', path: '/Items', method: 'POST', body: { Name: 'created', Owner: 'Caller' } },
      { name: 'edit', op: 'edit', path: `/Items(${m.own})`, method: 'PATCH', body: { Name: 'changed' } },
      { name: 'replace', op: 'edit', path: `/Items(${m.own})`, method: 'PUT', body: { Name: 'changed' } },
      { name: 'container write', op: 'upload', path: `/Items(${m.own})`, method: 'PATCH', body: { Blob: Buffer.from('upload').toString('base64'), 'Blob@com.filemaker.odata.Filename': 'matrix.txt', 'Blob@com.filemaker.odata.ContentType': 'text/plain' } },
      { name: 'clear container', op: 'upload', path: `/Items(${m.own})`, method: 'PATCH', body: { Blob: null } },
      { name: 'delete', op: 'delete', path: `/Items(${m.own})`, method: 'DELETE' },
    ];
    for (const operation of [...operations]) {
      if (!['edit', 'delete', 'upload'].includes(operation.op)) continue;
      operations.push({ ...operation, name: operation.name + ' other', path: operation.path.replace('(' + m.own + ')', '(' + m.other + ')') });
    }
    for (const operation of operations) await t.test(operation.name, async () => {
      const before = snapshot(m.store);
      try {
        const reply = await request(m, ODATA + operation.path, operation.method, operation.body);
        // OData conceals an inaccessible table/field as an unknown entity set/property.
        let want = gate || (operation.name.endsWith(' other') && row.expected.limited ? 200 : 0) || (operation.op === 'script' ? expected(e, 'script') || expected(e, 'read') : operation.op !== 'metadata' && !e.view ? 102 : expected(e, operation.op, false));
        // A filtered-out entity is indistinguishable from a missing entity in OData.
        if (!gate && operation.op === 'other' && e.limited) want = 101;
        if (!gate && e.view && e.field === 'none' && ['create', 'edit', 'upload'].includes(operation.op)) want = 102;
        if (operation.op === 'script' && reply.body?.scriptResult) assert.equal(reply.body.scriptResult.code, want, reply.text);
        else check(reply, want, operation.name);
        if (want) assert.deepEqual(snapshot(m.store), before, 'denied write is atomic');
        else operation.verify?.(reply);
        if (!want) {
          const id = operation.name.endsWith(' other') ? m.other : m.own;
          if (operation.name.startsWith('clear container')) assert.equal(m.store.containerId('Items', id, 'Blob'), undefined);
          else assertMutation(m, before, operation.op, id);
        }
      } finally { restore(m.store, before); }
    });
  } finally { await m.close(); }
});
