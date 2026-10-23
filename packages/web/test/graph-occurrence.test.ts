import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occurrenceChange } from '../src/design/graph.ts';

test('editing an occurrence with no base table omits the empty table selection', () => {
  assert.deepEqual(occurrenceChange({ id: 4, name: 'Old' }, 'Renamed', '', '#123456'), {
    op: 'updateOccurrence', occurrence: 4, name: 'Renamed', color: '#123456',
  });
});
