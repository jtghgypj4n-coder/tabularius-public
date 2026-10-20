import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, WEB, openMatrix, request, session, check, expected, snapshot, restore, assertMutation, type Operation } from './privilege-matrix.ts';

for (const row of SHAPES) test(`Web client matrix: ${row.name}`, async (t) => {
  const m = await openMatrix(row);
  try {
    const auth = await session(m, true);
    const e = row.expected;
    const gate = !auth ? 952 : e.account === 'expired' ? 212 : 0;
    const operations: { name: string; op: Operation; path?: string; body?: object; result?: boolean }[] = [
      { name: 'menu', op: 'metadata', path: '/layouts' },
      { name: 'layout', op: 'metadata', path: '/layouts/Items' },
      { name: 'view', op: 'read', body: { mode: 'browse', records: [{ id: m.own }, { id: m.other }] } },
      { name: 'records', op: 'read', body: { ids: [m.own, m.other] } },
      { name: 'refresh', op: 'read', body: { recordId: m.own, ids: [m.own, m.other] } },
      { name: 'position', op: 'read', body: { recordId: m.own } },
      { name: 'index', op: 'find', body: { field: 'Name' } },
      { name: 'history', op: 'read', body: { recordId: m.own } },
      { name: 'export', op: 'export', body: { fields: ['Name'], format: 'csv' } },
      { name: 'edit command', op: 'edit', path: '/layouts/Items/button', body: { command: 'Replace Field Contents', field: 'Name', value: 'changed', ids: [m.own], recordId: m.own }, result: true },
      { name: 'duplicate command', op: 'duplicate', path: '/layouts/Items/button', body: { command: 'Duplicate Record', ids: [m.own], recordId: m.own }, result: true },
      { name: 'delete command', op: 'delete', path: '/layouts/Items/button', body: { command: 'Delete Record', ids: [m.own], recordId: m.own }, result: true },
      { name: 'print script', op: 'print', path: '/layouts/Items/button', body: { urlScript: true, script: 'Print', ids: [m.own], recordId: m.own }, result: true },
      { name: 'script', op: 'script', path: '/layouts/Items/button', body: { urlScript: true, script: 'Read', ids: [m.own], recordId: m.own }, result: true },
    ];
    for (const operation of operations) await t.test(operation.name, async () => {
      const before = snapshot(m.store);
      try {
        const reply = await request(m, WEB + (operation.path ?? `/layouts/Items/${operation.name}`), operation.body ? 'POST' : 'GET', operation.body, auth ?? 'Bearer unavailable');
        const want = gate || (operation.name === 'menu' ? 0 : operation.name === 'view' ? expected(e, 'metadata')
          : operation.name === 'index' && e.layout !== 'none' && e.layout !== 'noRecords' ? 0
          : operation.op === 'script' ? expected(e, 'script') || expected(e, 'read')
            : operation.op === 'print' ? expected(e, 'script') || expected(e, 'read') || expected(e, 'print')
              : operation.result ? expected(e, 'read') || expected(e, operation.op) : expected(e, operation.op));
        if (operation.result && typeof reply.body?.error === 'number') {
          assert.equal(reply.body.error, want, reply.text);
        } else check(reply, want, operation.name);
        if (want) assert.deepEqual(snapshot(m.store), before, 'denied operation leaves records unchanged');
        if (!want && operation.name === 'index' && e.field === 'none') assert.deepEqual(reply.body.values, []);
        if (!want && ['records', 'refresh', 'view', 'export'].includes(operation.name)) {
          if (e.limited) assert.ok(!reply.text.includes('secret-other-row'), 'hidden record cannot leak');
          if (e.field === 'none') assert.ok(!reply.text.includes('visible'), 'hidden field cannot leak');
        }
        if (!want) assertMutation(m, before, operation.op);
      } finally { restore(m.store, before); }
    });
  } finally { await m.close(); }
});
