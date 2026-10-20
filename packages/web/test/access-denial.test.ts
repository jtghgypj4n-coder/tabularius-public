import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptFailureMessage } from '../src/script-error.ts';
import { Api, ApiError } from '../src/api.ts';

test('browser errors preserve safe denials from web, Data API and login responses', async (t) => {
  const denial = { operation: 'edit', permission: 'view', explanation: 'The record-view rule did not allow the request.' };
  const api = new Api('Scratch', 'token');
  const responses = [
    { status: 400, body: { error: { code: 200, message: 'Record access is denied', denial } }, call: () => api.menu() },
    { status: 500, body: { response: {}, messages: [{ code: '200', message: 'Record access is denied' }], 'tabularius:denial': denial }, call: () => api.update('T', '1', {}) },
    { status: 401, body: { response: {}, messages: [{ code: '9', message: 'Missing fmapp' }], 'tabularius:denial': denial }, call: () => Api.login('Scratch', 'clerk', 'pw') },
  ];
  for (const { status, body, call } of responses) {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status }));
    await assert.rejects(call(), (e) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, status === 401 ? 9 : 200);
      assert.deepEqual(e.denial, denial);
      assert.equal(e.message, status === 401 ? 'Missing fmapp' : 'Record access is denied');
      return true;
    });
    t.mock.restoreAll();
  }
});

test('untagged browser errors keep their original message and have no denial', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { code: 102, message: 'Field "Absent" is missing' } }), { status: 400 }));
  await assert.rejects(new Api('Scratch', 'token').menu(), (e) => e instanceof ApiError && e.code === 102 && e.message === 'Field "Absent" is missing' && e.denial === undefined);
});


test('command and named-script failure toasts both include the safe explanation', () => {
  const run = { script: 'Remove', error: 200, message: 'Record access is denied',
    denial: { operation: 'delete', permission: 'delete', explanation: 'Your privilege set does not allow this request.' } };
  const toasts: string[] = [];
  for (const command of ['Delete Record', undefined]) {
    const message = scriptFailureMessage(run, command);
    if (message) toasts.push(message);
  }
  assert.deepEqual(toasts, [
    'Delete Record stopped with error 200: Record access is denied Your privilege set does not allow this request.',
    'Script "Remove" stopped with error 200: Record access is denied Your privilege set does not allow this request.',
  ]);
});

test('handled script and command success produces no failure toast even with stale optional explanation text', () => {
  const run = { script: 'Handled', error: 0, denial: { operation: 'delete', permission: 'delete', explanation: 'Previous refusal' } };
  const toasts: string[] = [];
  for (const command of ['Delete Record', undefined]) {
    const message = scriptFailureMessage(run, command);
    if (message) toasts.push(message);
  }
  assert.deepEqual(toasts, []);
  assert.equal(scriptFailureMessage({ script: 'Find', error: 401 }, 'Perform Find'), undefined);
  assert.equal(scriptFailureMessage({ script: 'Find', error: 401 }), 'Script "Find" stopped with error 401');
});
