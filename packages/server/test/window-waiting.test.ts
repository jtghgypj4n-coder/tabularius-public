import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebClient } from '../src/webclient.ts';
import { host } from '../../web/e2e/harness.ts';

for (const step of ['Pause', 'Sort', 'Index', 'Dialog']) test(`${step} waiting responses retain the script's current window and display state`, () => {
  const client = Object.create(WebClient.prototype);
  client.paused = new Map();
  const run = { script: 'Select B', sent: 0, answer: () => undefined };
  const state = { window: { id: 'B', name: 'B', style: 'document' }, layout: 'Notes', recordId: 2,
    foundSet: [1, 2], mode: 'browse', active: null, syncVersion: 1 };
  const asked = { state, actions: [{ step: 'Freeze Window', script: 'Select B', windowId: 'A' }],
    title: 'A', message: 'Layout is missing (error 105)', buttons: ['Continue', 'Cancel'], inputs: [], sort: [], field: 'Title', values: ['one', 'two'] };
  try {
    const r = client.outcome(run, { [step.toLowerCase()]: asked });
    assert.equal(r.waiting.step, step);
    assert.deepEqual(r.window, state.window);
    assert.equal(r.recordId, 2);
    assert.deepEqual(r.foundSet, [1, 2]);
    assert.equal(r.active, null);
    assert.deepEqual(r.actions, asked.actions);
  } finally { clearTimeout((run as typeof run & { timer?: NodeJS.Timeout }).timer); }
});

test('the dialog over a selected background window uses its query or ids and current record', async () => {
  const hosted = await host({ stores: ['Windows'] });
  try {
    const store = hosted.store('Windows');
    store.applyDesign([
      { op: 'createTable', name: 'Notes', fields: [{ name: 'Title' }] },
      { op: 'createScript', name: 'Run', text: 'Set Error Capture [ Off ]\nFreeze Window\nSelect Window [ Name: "B" ]\nGo to Record/Request/Page [ Next ]\nGo to Layout [ Layout Name: "Nowhere" ]' },
    ]);
    const ids = ['record one', 'record two', 'excluded'].map((Title) => Number(store.create('Notes', { Title }).recordId));
    store.setPassword('Admin', 'pw');
    const login = await fetch(hosted.url + '/fmi/data/vLatest/databases/Windows/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
    assert.equal(login.status, 200);
    const headers = { authorization: 'Bearer ' + (await login.json()).response.token, 'content-type': 'application/json' };
    const app = hosted.url + '/tabularius/app/v1/databases/Windows';
    const script = store.schema.scripts.find((s) => s.name === 'Run')!;
    for (const found of [{ query: [{ Title: 'record*' }] }, { ids: [ids[1], ids[0]] }]) {
      const order = found.ids ?? ids.slice(0, 2);
      const response = await fetch(app + '/layouts/Notes/button', { method: 'POST', headers, body: JSON.stringify({
        scriptId: script.id, ids, recordId: ids[0], mode: 'browse', window: { id: 'A', name: 'A' },
        windows: [{ id: 'B', name: 'B', layout: 'Notes', recordId: order[0], ...found }, { id: 'A', name: 'A' }],
      }) });
      let r = await response.json();
      assert.equal(response.status, 200, JSON.stringify(r));
      const actions = [...r.actions];
      while (r.waiting?.step === 'Checkpoint') {
        const next = await fetch(app + `/runs/${r.waiting.run}/file`, { method: 'POST', headers, body: '{}' });
        assert.equal(next.status, 200);
        r = await next.json();
        actions.push(...r.actions);
      }
      assert.equal(r.waiting.step, 'Dialog');
      assert.match(r.waiting.message, /error 105/);
      assert.equal(r.window.id, 'B');
      assert.equal(r.recordId, order[1]);
      assert.deepEqual(r.foundSet, order);
      assert.deepEqual(actions.filter((a: { step: string }) => a.step === 'Freeze Window').map((a: { windowId: string }) => a.windowId), ['A']);
      const answer = await fetch(app + `/runs/${r.waiting.run}/file`, { method: 'POST', headers, body: JSON.stringify({ button: 1 }) });
      assert.equal(answer.status, 200);
      assert.equal((await answer.json()).waiting, undefined, 'the error dialog is delivered once');
    }
  } finally { await hosted.close(); }
});

test('a removed background layout cannot block front-window scripts or the card Cancel script', async () => {
  const hosted = await host({ stores: ['StaleWindows'] });
  try {
    const store = hosted.store('StaleWindows');
    store.applyDesign([
      { op: 'createTable', name: 'Notes', fields: [{ name: 'Title' }] },
      { op: 'createLayout', name: 'Removed', occurrence: 'Notes' },
      { op: 'createScript', name: 'Run', text: 'Exit Script [ Text Result: "started" ]' },
      { op: 'createScript', name: 'Cancel', text: 'Close Window [ Current Window ]' },
      { op: 'createScript', name: 'Use Stale', text: 'Set Error Capture [ On ]\nSelect Window [ Name: "A" ]\nGo to Layout [ Layout Name: "Removed" ]' },
    ]);
    const id = Number(store.create('Notes', { Title: 'record one' }).recordId);
    store.setPassword('Admin', 'pw');
    const login = await fetch(hosted.url + '/fmi/data/vLatest/databases/StaleWindows/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
    assert.equal(login.status, 200);
    const headers = { authorization: 'Bearer ' + (await login.json()).response.token, 'content-type': 'application/json' };
    store.applyDesign([{ op: 'deleteLayout', layout: 'Removed' }]);
    for (const found of [{ query: [{ Title: 'record*' }] }, { ids: [id] }]) {
      for (const name of ['Run', 'Cancel', 'Use Stale']) {
        const response = await fetch(hosted.url + '/tabularius/app/v1/databases/StaleWindows/layouts/Notes/button', {
          method: 'POST', headers, body: JSON.stringify({
            scriptId: store.schema.scripts.find((s) => s.name === name)!.id, ids: [id], recordId: id, mode: 'browse',
            window: { id: 'C', name: 'Card', style: 'card' },
            windows: [{ id: 'A', name: 'A', layout: 'Removed', recordId: id, ...found }, { id: 'C', name: 'Card', layout: 'Notes', ids: [id], recordId: id }],
          }),
        });
        const r = await response.json();
        assert.equal(response.status, 200, JSON.stringify(r));
        assert.equal(r.waiting, undefined);
        assert.equal(r.error, name === 'Use Stale' ? 105 : 0, 'a stale layout fails only when the script uses it');
        if (name === 'Run') { assert.equal(r.result, 'started'); assert.equal(r.window.id, 'C'); }
        if (name === 'Cancel') { assert.deepEqual(r.closed, ['C']); assert.equal(r.window.id, 'A'); }
      }
    }
  } finally { await hosted.close(); }
});
