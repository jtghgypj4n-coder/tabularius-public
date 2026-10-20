import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, XML, openMatrix, request, xmlCode, expected, snapshot } from './privilege-matrix.ts';

for (const row of SHAPES) test(`XML matrix: ${row.name}`, async (t) => {
  const m = await openMatrix(row);
  try {
    const e = row.expected;
    const gate = e.account !== 'active' ? 212 : !row.definition.extendedPrivileges?.includes('fmxml') ? 9 : 0;
    const before = snapshot(m.store);
    for (const [query, want] of [
      ['-findall', gate || expected(e, 'read')],
      ['-find&Name=visible', gate || expected(e, 'find')],
      ['-view', gate || expected(e, 'metadata')],
      ...['-script=Read', '-script.prefind=Read', '-script.presort=Read'].map((script) => [`-findall&${script}`, gate || (!e.script ? 9 : 960)] as const),
    ] as const) await t.test(query, async () => {
      const reply = await request(m, XML + '&' + query);
      assert.equal(xmlCode(reply), want, reply.text);
      if (!want && query === '-findall') {
        assert.equal(reply.text.includes('visible'), e.field !== 'none');
        assert.equal(reply.text.includes('secret-other-row'), !e.limited && e.field !== 'none');
      }
      assert.deepEqual(snapshot(m.store), before, 'XML never runs a script or changes a record');
    });
  } finally { await m.close(); }
});
