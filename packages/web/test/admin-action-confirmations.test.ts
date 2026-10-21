import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmAutomationRemoval } from '../src/automation-view.ts';

test('an assistant automation card requires target-specific confirmation before deletion', () => {
  const asked: string[] = [];
  assert.equal(confirmAutomationRemoval('Nightly close', (message) => { asked.push(message); return false; }), false);
  assert.deepEqual(asked, ['Delete the automation "Nightly close"? Its script stays.']);
  assert.equal(confirmAutomationRemoval('Nightly close', () => true), true);
});
