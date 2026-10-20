// The assistant panel's starting questions, by where the person is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestions } from '../src/assistant.ts';

test('assistant suggestions follow the mode, the found set and the record', () => {
  const browse = suggestions({ mode: 'browse', layout: 'Invoices', recordId: 4, foundSet: { foundCount: 12 } });
  assert.ok(browse.includes('Summarize these 12 records'));
  assert.ok(browse.includes('Summarize this record and its related records'));
  // One record found, or none open: nothing to summarize or explain.
  const one = suggestions({ mode: 'browse', foundSet: { foundCount: 1 } });
  assert.ok(!one.some((q) => q.startsWith('Summarize')) && !one.includes('Summarize this record and its related records'));
  assert.ok(suggestions({ mode: 'design' }).some((q) => /won't work yet/.test(q)));
  assert.ok(suggestions({ mode: 'debug' }).some((q) => /fail/.test(q)));
  assert.ok(suggestions({ mode: 'find' }).every((q) => !/Summarize/.test(q)));
  assert.ok(suggestions({}).length > 0);
  assert.ok(suggestions({ mode: 'viewer' }).some((q) => /Draft an expression/.test(q)));
  assert.ok(suggestions({ mode: 'security' }).some((q) => /Review the security/.test(q)));
  assert.ok(!browse.some((q) => /Who changed/.test(q)));
  assert.ok(suggestions({ mode: 'browse', recordId: 4 }, true).some((q) => /What changed on this record, who changed it, and why/.test(q)));
  // The field the cursor is in comes first.
  assert.match(suggestions({ mode: 'browse', field: 'Invoices::Total' })[0], /^Explain the field Invoices::Total/);
});

test('the conversation kept for the tab drops dry runs\' record values but keeps proposals\' design changes', async () => {
  const { keptForTab } = await import('../src/assistant.ts');
  const kept = JSON.parse(keptForTab([{ role: 'assistant', content: 'Proposed.', proposals: [{ summary: 's', changes: [{ op: 'createScript', name: 'A' }],
    layouts: [{ id: 1 }], dryRuns: [{ script: 'A', run: { outcome: 'ok', changes: { records: [{ table: 'T', fields: [{ field: 'Salary', before: '1', after: '2' }] }] } } }] }] }]));
  const p = kept[0].proposals[0];
  assert.deepEqual(p.changes, [{ op: 'createScript', name: 'A' }]);
  assert.equal(p.layouts, undefined);
  assert.equal(p.dryRuns[0].run.outcome, 'ok');
  assert.equal(p.dryRuns[0].run.changes, undefined);
});
