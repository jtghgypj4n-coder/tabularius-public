import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCRIPT_STEP_NAMES } from '../../fmp12/src/index.ts';
import { groupSteps, STEP_GROUPS } from '../src/design/step-groups.ts';

test('the Steps pane groups every step once, in FileMaker\'s groups; steps it doesn\'t name go under Miscellaneous', () => {
  const names = [...new Set(SCRIPT_STEP_NAMES)];
  const groups = groupSteps(names);
  const placed = groups.flatMap(([, s]) => s);
  assert.equal(placed.length, names.length);
  assert.deepEqual(new Set(placed), new Set(names));
  assert.deepEqual(groups.map(([g]) => g), STEP_GROUPS.map(([g]) => g));
  const of = (step: string) => groups.find(([, s]) => s.includes(step))?.[0];
  assert.equal(of('If'), 'Control');
  assert.equal(of('Go to Layout'), 'Navigation');
  assert.equal(of('Set Field'), 'Fields');
  assert.equal(of('Generate Response from Model'), 'Artificial Intelligence');
  // A step a newer FileMaker adds still shows.
  assert.deepEqual(groupSteps(['If', 'Brand New Step']).map(([g, s]) => [g, s]), [['Control', ['If']], ['Miscellaneous', ['Brand New Step']]]);
});
