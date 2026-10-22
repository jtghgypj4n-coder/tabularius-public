import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordForModel } from '../src/ai-output.ts';

test('selected MCP portal fields retain native record identity', () => {
  const record = recordForModel({ id: 'parent', recordId: 1, modId: 0, fieldData: { Name: 'A' },
    portalData: { Children: [{ id: 'child', recordId: '2', modId: '0', 'Children::Name': 'B' }] } }, ['Children::Name']);
  assert.equal(record.id, 'parent');
  assert.deepEqual(record.portalData.Children[0], { id: 'child', recordId: '2', modId: '0', 'Children::Name': 'B' });
});
