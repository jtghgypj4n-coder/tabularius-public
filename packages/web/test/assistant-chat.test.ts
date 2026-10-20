// The chat panel's parts that stand apart from the panel: what a failure means, which changes ask first, a
// conversation's totals, and keeping a conversation to its sign-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argsText, chatUsage, classifyError, destructiveChanges, ownerOf, stepNeedsConfirmation } from '../src/assistant-chat.ts';
import { keptForTab } from '../src/assistant.ts';

test('failures are told apart: policy, budget, provider, network, session, off', () => {
  assert.equal(classifyError(undefined, 'Failed to fetch').kind, 'network');
  assert.equal(classifyError(429, 'Today\'s limit of 100,000 tokens is used up; the AI assistant is available again tomorrow (UTC)').kind, 'budget');
  assert.equal(classifyError(502, 'The AI model did not answer: overloaded').kind, 'provider');
  assert.equal(classifyError(502, 'Can\'t reach the AI provider').kind, 'provider');
  assert.equal(classifyError(403, 'AI is turned off for this file').kind, 'policy');
  assert.equal(classifyError(401, 'Insufficient privileges: the "Clerk" privilege set needs the fmmcp extended privilege (AI access)').kind, 'policy');
  assert.equal(classifyError(401, 'Invalid FileMaker Data API token (*) (the session ended or timed out)').kind, 'session');
  assert.equal(classifyError(503, 'The AI assistant is off on this server (start it with --ai and an API key)').kind, 'off');
  assert.equal(classifyError(400, 'Something odd').kind, 'other');
  for (const kind of ['network', 'provider'] as const) assert.equal(classifyError(kind === 'network' ? undefined : 502, 'x').retry, true);
  assert.equal(classifyError(429, 'x').retry, false);
  assert.equal(classifyError(403, 'policy').retry, false);
});

test('deleting things asks first; adding and changing do not', () => {
  assert.deepEqual(destructiveChanges([{ op: 'createTable', name: 'A' }, { op: 'updateField', table: 'A', field: 'B', name: 'C' }]), []);
  assert.deepEqual(destructiveChanges([{ op: 'deleteField', table: 'Orders', field: 'Notes' }, { op: 'deleteScript', script: 'Tidy' }, { op: 'deleteMenuSet', menuSet: 'Main' }]), [
    'Delete the field Orders::Notes and what is stored in it', 'Delete the script Tidy', 'Delete (deleteMenuSet)']);
  assert.equal(stepNeedsConfirmation('find', 'Find invoices'), undefined);
  assert.match(stepNeedsConfirmation('delete', 'Delete the records found')!, /^Delete records: /);
  assert.ok(stepNeedsConfirmation('script', 'Run Archive'));
});

test('a conversation\'s totals add the counters the server sent', () => {
  assert.equal(chatUsage([{}, {}]), undefined);
  assert.deepEqual(chatUsage([{ usage: { inputTokens: 10, cachedTokens: 5, outputTokens: 2, costUsd: 0.01 } }, {}, { usage: { inputTokens: 20, cachedTokens: 0, outputTokens: 3 } }]),
    { answers: 2, inputTokens: 30, cachedTokens: 5, outputTokens: 5, costUsd: 0.01 });
});

test('a tool call\'s arguments and results are not kept for the tab, only the line about it', () => {
  const kept = JSON.parse(keptForTab([{ role: 'assistant', content: 'x', tools: [{ label: 'Reading record 3', args: { recordId: 3 }, result: 'Name: Ann', resultLength: 9 }, { label: 'Checking', error: true, result: 'boom' }] }]));
  assert.deepEqual(kept[0].tools, [{ label: 'Reading record 3' }, { label: 'Checking', error: true }]);
});

test('a conversation belongs to the sign-in that had it', () => {
  assert.equal(ownerOf('abc'), ownerOf('abc'));
  assert.notEqual(ownerOf('abc'), ownerOf('abd'));
  assert.ok(!ownerOf('ohbt_secrettoken').includes('secret'));
  assert.equal(argsText(undefined), '');
  assert.equal(argsText({ a: 1 }), '{\n  "a": 1\n}');
});
