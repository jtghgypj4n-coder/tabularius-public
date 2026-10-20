import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, SQL, openMatrix, request, check, snapshot } from './privilege-matrix.ts';

for (const row of SHAPES) test(`SQL HTTP matrix: ${row.name}`, async (t) => {
  const m = await openMatrix(row);
  try {
    const e = row.expected;
    const gate = e.account !== 'active' ? 212 : !e.sql || !e.view || e.field === 'none' || e.limited ? 9 : 0;
    const before = snapshot(m.store);
    for (const [name, path, method, body, ownCode] of [
      ['tables', '/tables', 'GET', undefined, 0],
      ['GET query', '?q=SELECT%20Name%20FROM%20Items', 'GET', undefined, 0],
      ['POST query', '', 'POST', { sql: 'SELECT Name FROM Items' }, 0],
      ['GET CSV export', '?q=SELECT%20Name%20FROM%20Items&format=csv', 'GET', undefined, e.export ? 0 : 9],
      ['POST CSV export', '', 'POST', { sql: 'SELECT Name FROM Items', format: 'csv' }, e.export ? 0 : 9],
      ['write unsupported', '', 'POST', { sql: "UPDATE Items SET Name = 'changed'" }, 8310],
    ] as const) await t.test(name, async () => {
      const reply = await request(m, SQL + path, method, body);
      check(reply, gate || ownCode, name);
      if (!(gate || ownCode) && name.includes('query')) assert.deepEqual(reply.body.rows, [['visible'], ['secret-other-row']]);
      assert.deepEqual(snapshot(m.store), before);
    });
  } finally { await m.close(); }
});
