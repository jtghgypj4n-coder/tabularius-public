import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { host, type Hosted } from '../../web/e2e/harness.ts';
import { refreshFixture } from './refresh-fixture.ts';
import { mergeObjectRecord } from '../../web/src/refresh.ts';

let hosted: Hosted;
let app: string;
let auth: Record<string, string>;
before(async () => {
  hosted = await host({ stores: ['Refresh'] });
  const store = hosted.store('Refresh');
  refreshFixture(store);
  store.setPassword('Admin', 'pw');
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  app = hosted.url + '/tabularius/app/v1/databases/Refresh';
  auth = await login('Admin');
});
after(async () => { await hosted?.close(); });

async function login(account: string) {
  const r = await fetch(hosted.url + '/fmi/data/vLatest/databases/Refresh/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa(account + ':pw') } });
  assert.equal(r.status, 200);
  return { authorization: 'Bearer ' + (await r.json()).response.token, 'content-type': 'application/json' };
}
async function post(path: string, body: object, headers = auth) {
  const r = await fetch(app + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await r.json();
  assert.equal(r.status, 200, JSON.stringify(data));
  return data;
}
const run = (name: string, headers = auth, display: Record<string, unknown> = {}) => {
  const id = hosted.store('Refresh').design('Items')!.objects.find((o) => o.name === name)!.id;
  return post('/layouts/Items/button', { objectId: id, recordId: 1, ids: [1, 2], mode: 'browse', view: 'form', layoutId: 1,
    displayRecords: [1], ...display, window: { id: 'window', name: 'Window', style: 'document' } }, headers);
};
const answer = (r: { waiting: { run: string } }, headers = auth, display: Record<string, unknown> = {}) => post(`/runs/${r.waiting.run}/file`, display, headers);

test('refresh preserves display selection and caps distinct rows with a large found set', async () => {
  const store = hosted.store('Refresh');
  store.applyDesign([{ op: 'createTable', name: 'Selection', fields: [{ name: 'Name' }] }]);
  const records = Array.from({ length: 205 }, (_, i) => store.create('Selection', { Name: String(i) }).recordId);
  const legacy = (ids: number[], displayRecords: unknown[], current: number) => {
    const shown = displayRecords.map(Number).filter((id) => ids.includes(id));
    const at = Math.max(0, ids.indexOf(current));
    return [...new Set([...shown, ...(!shown.length ? ids.slice(at - at % 50, at - at % 50 + 50) : []), ...(ids.includes(current) ? [current] : [])])].slice(0, 200);
  };
  const check = async (ids: number[], displayRecords: unknown[], current: number, expected: number[]) => {
    const r = await post('/layouts/Selection/refresh', { ids, displayRecords, recordId: current });
    assert.deepEqual(r.records.map((r: { recordId: string }) => Number(r.recordId)), expected);
  };
  for (const [display, current] of [
    [[], records[73]],
    [['invalid', -1], -1],
    [[String(records[2]), records[2], -1, records[0]], records[4]],
    [[records[2], records[0]], -1],
    [records.slice(0, 199), records[204]],
    [records.slice(0, 200), records[204]],
  ] as [unknown[], number][]) await check(records, display, current, legacy(records, display, current));

  const ids = [...Array.from({ length: 200_000 - records.length }, (_, i) => i + 1_000_000), ...records];
  const current = records[204];
  const prefix = [...Array(250).fill(-1), ...Array(250).fill(String(records[203])), ...records.slice(0, 204).reverse()];
  const expected = legacy(ids, prefix, current);
  assert.equal(expected.length, 200);
  // Once the prefix fills the limit, later display entries cannot change the legacy result.
  const display = [...prefix, ...Array(200_000).fill(-1), current];
  const baselineStart = performance.now();
  await check(ids, prefix, current, expected);
  const baseline = performance.now() - baselineStart;
  const start = performance.now();
  await check(ids, display, current, expected);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < Math.max(15_000, baseline * 6 + 2_000),
    `refresh with 200k extra display IDs took ${elapsed.toFixed(0)}ms; the same found set without them took ${baseline.toFixed(0)}ms`);
});

test('checkpoint snapshots reevaluate global-dependent values and hidden conditions without a later final refresh', async () => {
  let r = await run('Object');
  assert.equal(r.waiting.step, 'Checkpoint');
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].objectId, 10);
  assert.equal(r.actions[0].windowId, 'window');
  assert.equal(r.actions[0].refresh.records[0].fieldData.Value, 2);
  assert.equal(r.actions[0].refresh.states['1'].hidden.includes(12), false);
  assert.deepEqual(r.actions[0].refresh.states['1'].styles['10'], [0]);
  r = await answer(r);
  assert.equal(r.waiting.step, 'Checkpoint');
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].objectId, 12);
  const checkpoint = r;
  r = await answer(r);
  assert.equal(r.waiting, undefined);
  assert.deepEqual(r.actions, []);
  assert.equal(r.syncVersion, checkpoint.syncVersion);
  const duplicate = await fetch(app + `/runs/${checkpoint.waiting.run}/file`, { method: 'POST', headers: auth, body: '{}' });
  assert.equal(duplicate.status, 404);
});

test('Refresh Portal recomputes filters/order and portal-row formulas, including viewer URLs and repeating values', async () => {
  const r = await run('Portal');
  const refresh = r.actions[0].refresh;
  const rows = refresh.records[0].portalData.rows;
  assert.deepEqual(rows.map((r: Record<string, unknown>) => r['Rows::Value']), ['3:row 3', '3:row 2', '3:row 1']);
  assert.deepEqual(rows.map((r: Record<string, unknown>) => [r['Rows::Repeated'], r['Rows::Repeated(2)'], r['Rows::Repeated(3)']]), Array(3).fill(['one', 'two', 'three']));
  for (const row of rows) assert.match(refresh.states['1'].rows.rows[row.recordId].web['33'], /^data:text\/html,/);
  assert.deepEqual(refresh.foundRows, {}); // The related portal does not refresh an unrelated found-set portal.
  assert.equal((await answer(r)).waiting, undefined);
});

test('found-set portal refresh reads its paging path with stable found-set membership and order', async () => {
  const r = await run('Found');
  assert.deepEqual(r.foundSet, [1, 2]);
  assert.deepEqual(r.actions[0].refresh.foundRows.found.rows.map((row: Record<string, unknown>) => row['Items::Name']), ['first', 'second']);
  await answer(r);
});

test('viewer and JavaScript checkpoints arrive once in script order and carry the step window', async () => {
  let r = await run('Ordered');
  const steps: string[] = [];
  while (r.waiting) {
    assert.equal(r.waiting.step, 'Checkpoint');
    assert.equal(r.layout, 'Items');
    assert.equal(r.window.id, 'window');
    assert.equal(r.actions.length, 1);
    steps.push(r.actions[0].step);
    r = await answer(r);
  }
  assert.deepEqual(steps, ['Perform JavaScript in Web Viewer', 'Set Web Viewer', 'Perform JavaScript in Web Viewer']);
  assert.deepEqual(r.actions, []);
});

test('refresh reads uncommitted edits in an open transaction without committing before acknowledgement', async () => {
  const store = hosted.store('Refresh');
  store.applyDesign([{ op: 'createScript', name: 'Transaction', text: 'Open Transaction\nSet Field [ Items::Name ; "pending" ]\nRefresh Window\nRevert Transaction' }]);
  const script = store.schema.scripts.find((s) => s.name === 'Transaction')!;
  const design = store.design('Items')!;
  const source = design.objects.find((o) => o.name === 'Window')!;
  store.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { objects: [...design.objects, { ...source, id: 800, name: 'Transaction', action: { stepId: 1, step: 'Perform Script', scriptId: script.id, script: script.name } }] } }]);
  const r = await run('Transaction');
  assert.equal(r.actions[0].refresh.records[0].fieldData.Name, 'pending');
  assert.equal(store.row(store.layout('Items'), 1).Name, 'first');
  await answer(r);
  assert.equal(store.get('Items', 1).fieldData.Name, 'first');
});

test('refresh snapshots retain viewing-account masking and record limits even in a full-access script', async () => {
  const store = hosted.store('Refresh');
  store.savePrivilegeSet({ name: 'Viewer', records: { view: true, edit: false, create: false, delete: false },
    tables: { Items: { view: 'Id = 1', edit: false, create: false, delete: false, fields: { Name: 'none' } } },
    layouts: 'viewOnly', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: ['fmrest', 'fmapp'] } as never);
  store.schema.scripts.find((s) => s.name === 'Window')!.fullAccess = true;
  store.setPassword('Viewer', 'pw', 'Viewer');
  const viewer = await login('Viewer');
  const r = await run('Window', viewer);
  const records = r.actions[0].refresh.records;
  assert.deepEqual(records.map((r: { recordId: string }) => r.recordId), ['1']);
  assert.equal(records[0].fieldData.Name, undefined);
  await answer(r, viewer);
});


test('object refresh fetches displayed related children excluded by a shrinking filter and noncurrent found-set children', async () => {
  const portal = await run('Portal');
  await answer(portal);
  const r = await run('Shrink', auth, { displayPortals: { 1: { rows: [3, 2, 1] } } });
  const children = r.actions[0].refresh.records[0].portalData.rows;
  assert.deepEqual(children.map((r: Record<string, unknown>) => [r.recordId, r['Rows::Value']]), [['3', '1:row 3'], ['2', '1:row 2'], ['1', '1:row 1']]);
  assert.equal(r.actions[0].refresh.states['1'].rows.rows['3'].web['33'].startsWith('data:text/html,'), true);
  await answer(r);
  const found = await run('FoundChild', auth, { displayPortals: { 1: { found: [1, 2] } }, foundPortalRanges: { found: { offset: 1, limit: 2 } } });
  assert.deepEqual(found.actions[0].refresh.foundRows.found.rows.map((r: Record<string, unknown>) => [r.recordId, r['Items::Value']]), [['1', 8], ['2', 8]]);
  await answer(found);
});

test('checkpoint acknowledgements supply newly visible child identities to the next object refresh', async () => {
  addScript('ExpandShrink', 'Set Field [ Items::gLimit ; 3 ]\nRefresh Portal [ Object Name: "rows" ]\nSet Field [ Items::gLimit ; 1 ]\nRefresh Object [ Object Name: "child" ]');
  let r = await run('ExpandShrink');
  assert.equal(r.actions[0].refresh.records[0].portalData.rows.length, 3);
  r = await answer(r, auth, { displayPortals: { 1: { rows: [3, 2, 1] } } });
  assert.deepEqual(r.actions[0].refresh.records[0].portalData.rows.map((r: Record<string, unknown>) => r['Rows::Value']), ['1:row 3', '1:row 2', '1:row 1']);
  await answer(r);
});

test('related-portal object refresh carries requested identities even when visible rows are deleted or denied', async () => {
  const store = hosted.store('Refresh');
  const ids = [21, 22, 23, 24].map((rank) => store.create('Rows', { Parent: 1, Name: `scroll ${rank}`, Rank: rank }).recordId);
  store.savePrivilegeSet({ name: 'ScrollReader', records: { view: true, edit: false, create: false, delete: false },
    tables: { Rows: { view: 'Rank < 90', edit: false, create: false, delete: false } },
    layouts: 'viewOnly', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: ['fmrest', 'fmapp'] } as never);
  store.setPassword('ScrollReader', 'pw', 'ScrollReader');
  const reader = await login('ScrollReader');
  const refresh = (shown: number[]) => post('/layouts/Items/refresh', { ids: [1, 2], recordId: 1, displayRecords: [1],
    step: 'Refresh Object', objectId: 31, displayPortals: { 1: { rows: shown } } }, reader);
  try {
    const cached = (await refresh(ids)).records[0];
    assert.equal(cached.portalData.rows.length, 4);
    const before = structuredClone(cached.portalData.rows);
    const [visible, offscreen, deleted, denied] = ids;
    store.update('Rows', visible, { Name: 'fresh visible' });
    store.update('Rows', offscreen, { Name: 'not requested' });
    store.delete('Rows', deleted);
    store.update('Rows', denied, { Rank: 99 });
    const got = await refresh([visible, deleted, denied]);
    assert.deepEqual(got.requestedPortals['1'].rows, [visible, deleted, denied]);
    assert.deepEqual(got.records[0].portalData.rows.map((r: { recordId: string }) => r.recordId), [String(visible)]);
    mergeObjectRecord(cached, got.records[0], 'Rows::Value', undefined, 'rows', got.requestedPortals['1'].rows);
    assert.match(cached.portalData.rows[0]['Rows::Value'], /:fresh visible$/);
    assert.deepEqual(cached.portalData.rows[1], before[1], 'offscreen cache survives the partial response');
    for (const i of [2, 3]) {
      assert.equal(cached.portalData.rows[i]['Rows::Value'], undefined, 'requested deleted/denied values clear');
      assert.equal(cached.portalData.rows[i]['Rows::Repeated'], before[i]['Rows::Repeated'], 'sibling fields survive');
    }
    const scrolled = await refresh([offscreen]);
    mergeObjectRecord(cached, scrolled.records[0], 'Rows::Value', undefined, 'rows', scrolled.requestedPortals['1'].rows);
    assert.match(cached.portalData.rows[1]['Rows::Value'], /:not requested$/);
    assert.match(cached.portalData.rows[0]['Rows::Value'], /:fresh visible$/);
  } finally {
    for (const id of ids) if (store.findIds('Rows').includes(id)) store.delete('Rows', id);
  }
});

function addScript(name: string, text: string) {
  const store = hosted.store('Refresh');
  store.applyDesign([{ op: 'createScript', name, text }]);
  const script = store.schema.scripts.find((s) => s.name === name)!;
  const design = store.design('Items')!;
  const button = design.objects.find((o) => o.name === 'Window')!;
  store.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { objects: [...design.objects,
    { ...button, id: 900 + script.id, name, action: { stepId: 1, step: 'Perform Script', scriptId: script.id, script: name } }] } }]);
}

test('Refresh Window charts see pending record and found-set values before commit, and persisted values after rollback', async () => {
  const store = hosted.store('Refresh');
  store.applyDesign([{ op: 'createField', table: 'Items', name: 'SumId', type: 'number', kind: 'summary', summary: { type: 'total', field: 'Id' } }]);
  const design = store.design('Items')!;
  const source = design.objects.find((o) => o.name === 'value')!;
  const objects = [...design.objects, ...(['record', 'found-set', 'found-set'] as const).map((kind, i) => ({ ...source, id: 60 + i, kind: 'chart', field: undefined,
    chart: { type: 'column', source: kind, grouped: i === 2, categories: i === 2 ? '"all"' : 'Name', title: '$title', series: [{ data: i === 2 ? 'SumId' : 'Id' }] } }))];
  store.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { objects } } as never]);
  addScript('ChartPreview', 'Open Transaction\nSet Variable [ $title ; Value: "pending chart" ]\nSet Field [ Items::Id ; 9 ]\nRefresh Window\nRevert Transaction');
  const r = await run('ChartPreview');
  const charts = r.actions[0].refresh.states['1'].charts;
  assert.equal(charts['60'].title, 'pending chart');
  assert.deepEqual(charts['60'].series[0].values, [9]);
  assert.deepEqual(charts['61'].series[0].values, [9, 2]);
  assert.deepEqual(charts['62'].series[0].values, [11]);
  assert.equal(store.get('Items', 1).fieldData.Id, 1);
  await answer(r);
  const fresh = await post('/layouts/Items/refresh', { ids: [1, 2], recordId: 1, displayRecords: [1], step: 'Refresh Window' });
  assert.deepEqual(fresh.states['1'].charts['60'].series[0].values, [1]);
  assert.deepEqual(fresh.states['1'].charts['61'].series[0].values, [1, 2]);
  assert.deepEqual(fresh.states['1'].charts['62'].series[0].values, [3]);
});

test('Refresh Portal preserves the full count and fetches the displayed found-set page beyond row 1000', async () => {
  const store = hosted.store('Refresh');
  const ids = [1, 2];
  for (let i = 3; i <= 1100; i++) ids.push(store.create('Items', { Id: i, Name: String(i) }).recordId);
  const r = await run('Found', auth, { ids, foundPortalRanges: { found: { offset: 1051, limit: 5 } } });
  const page = r.actions[0].refresh.foundRows.found;
  assert.equal(page.count, 1100);
  assert.equal(page.offset, 1051);
  assert.deepEqual(page.rows.map((row: Record<string, unknown>) => row['Items::Name']), ['1051', '1052', '1053', '1054', '1055']);
  await answer(r);
  for (const id of ids.slice(2)) store.delete('Items', id);
});

test('a full-access script preview redacts actual masked repetitions and restricted related rows for the viewing account', async () => {
  const store = hosted.store('Refresh');
  store.savePrivilegeSet({ name: 'MaskedViewer', records: { view: true, edit: false, create: false, delete: false },
    tables: { Items: { view: 'Id = 1', edit: false, create: false, delete: false, fields: { Name: 'none', Repeated: 'masked' }, masks: { Repeated: { kind: 'last4' } } },
      Rows: { view: 'Rank = 1', edit: false, create: false, delete: false, fields: { Repeated: 'masked' }, masks: { Repeated: { kind: 'placeholder', text: 'on file' } } } },
    layouts: 'viewOnly', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: ['fmrest', 'fmapp'] } as never);
  store.setPassword('MaskedViewer', 'pw', 'MaskedViewer');
  addScript('MaskedPreview', 'Open Transaction\nSet Field [ Items::Name ; "privileged preview" ]\nSet Field [ Items::Repeated ; "secret1111" ]\nSet Field [ Items::Repeated[2] ; "secret2222" ]\nSet Field [ Items::Repeated[3] ; "secret3333" ]\nRefresh Window\nRevert Transaction');
  store.schema.scripts.find((s) => s.name === 'MaskedPreview')!.fullAccess = true;
  const viewer = await login('MaskedViewer');
  const r = await run('MaskedPreview', viewer);
  assert.equal(r.waiting.step, 'Checkpoint');
  const record = r.actions[0].refresh.records[0];
  assert.equal(record.fieldData.Name, undefined);
  for (const [key, tail] of [['Repeated', '1111'], ['Repeated(2)', '2222'], ['Repeated(3)', '3333']]) {
    assert.match(record.fieldData[key], new RegExp(tail + '$'));
    assert.doesNotMatch(record.fieldData[key], /secret/);
  }
  assert.deepEqual(record.portalData.rows.map((row: Record<string, unknown>) => row.recordId), ['1']);
  assert.deepEqual(['Rows::Repeated', 'Rows::Repeated(2)', 'Rows::Repeated(3)'].map((key) => record.portalData.rows[0][key]), ['on file', 'on file', 'on file']);
  assert.doesNotMatch(JSON.stringify(r.actions[0].refresh), /privileged preview|secret1111|secret2222|secret3333/);
  const done = await answer(r, viewer);
  assert.equal(done.error, 0, 'the script used full access for a field this viewer cannot edit');
  assert.equal(store.get('Items', 1).fieldData.Name, 'first');
});

test('web-client script responses expose imported-option warnings even when a later step succeeds', async () => {
  addScript('ImportedOptions', 'Refresh Window\nSet Variable [ $done ; Value: 1 ]');
  const store = hosted.store('Refresh');
  store.schema.scripts.find((s) => s.name === 'ImportedOptions')!.steps[0].params = { unsupportedOptions: ['binary Refresh Window flush flags'] };
  const r = await run('ImportedOptions');
  assert.equal(r.error, 0);
  assert.equal(r.waiting, undefined);
  assert.deepEqual(r.warnings, ['Unsupported imported options: binary Refresh Window flush flags']);
  assert.deepEqual(r.actions, []);
});
