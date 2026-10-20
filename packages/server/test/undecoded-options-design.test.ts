import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';

test('Design supplies visible option diagnostics and pre-run Check findings after save/reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-options-design-'));
  const hosted = await serve({ dir, port: 0, log: () => {} });
  try {
    const store = hosted.host.create('Options');
    store.setPassword('Admin', 'option-check-secret');
    store.applyDesign([{ op: 'createScript', name: 'Imported', steps: [
      { name: 'Revert Transaction', params: { undecodedOptions: ['Condition'] }, line: 'Revert Transaction' },
      { name: 'Set Revert Transaction on Error', params: { undecodedOptions: ['On/Off'] }, line: 'Set Revert Transaction on Error [ Off ]' },
      { name: 'Import Records', params: { undecodedOptions: ['Import mode'] }, line: 'Import Records [ Add ]' },
    ] }]);
    const login = await fetch(hosted.url + '/fmi/data/vLatest/databases/Options/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:option-check-secret') } });
    const token = (await login.json()).response.token;
    const url = hosted.url + '/tabularius/design/v1/databases/Options';
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const read = async () => {
      const response = await fetch(url, { headers });
      assert.equal(response.status, 200);
      return (await response.json()).scripts[0] as { id: number; text: string };
    };
    const before = await read();
    assert.match(before.text, /Undecoded options: Condition/);
    assert.match(before.text, /Undecoded options: On\/Off/);
    assert.match(before.text, /Mode: Undecoded/);
    const check = async (script: { id: number; text: string }) => {
      const response = await fetch(url + '/scripts/lint', { method: 'POST', headers, body: JSON.stringify({ script: script.id, text: script.text }) });
      assert.equal(response.status, 200);
      return (await response.json()).issues as { rule: string; severity: string; line: number }[];
    };
    assert.deepEqual((await check(before)).map((i) => [i.rule, i.severity, i.line]), [['undecoded-options', 'error', 1], ['undecoded-options', 'error', 2], ['undecoded-options', 'error', 3]]);
    const save = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ changes: [{ op: 'updateScript', script: before.id, text: before.text + '\n# unrelated edit' }] }) });
    assert.equal(save.status, 200);
    const reopened = await read();
    assert.equal(reopened.text, before.text + '\n# unrelated edit');
    assert.equal((await check(reopened)).length, 3);
  } finally {
    hosted.server.closeAllConnections();
    await new Promise<void>((resolve) => hosted.server.close(() => resolve()));
    rmSync(dir, { recursive: true });
  }
});
