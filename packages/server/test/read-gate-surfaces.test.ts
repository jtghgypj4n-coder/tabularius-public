import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { SHAPES, openMatrix, request, session } from './privilege-matrix.ts';
import { Dashboards, computeDashboard } from '../src/dashboards.ts';
import { Digests, DigestRunner } from '../src/digests.ts';
import { layoutProfile } from '../src/insight.ts';

async function setup(t: TestContext) {
  const row = SHAPES.find((s) => s.name === 'record-calculation')!;
  const m = await openMatrix(row);
  t.after(() => m.close());
  m.store.applyDesign([
    { op: 'createField', table: 'Items', name: 'Secret' },
    { op: 'createField', table: 'Items', name: 'Date', type: 'date' },
    { op: 'createTable', name: 'Hidden', fields: [{ name: 'Value' }] },
  ]);
  const design = m.store.design('Items')!;
  const cell = design.objects.find((o) => o.field)!;
  const date = m.store.schema.tables.find((t) => t.name === 'Items')!.fields.find((f) => f.name === 'Date')!;
  m.store.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { objects: [...design.objects, { ...cell, id: 999, field: { ...cell.field!, field: 'Date', fieldId: date.id } }] } }]);
  m.store.update('Items', m.own, { Secret: 'HIDDEN_FIELD', Date: '2026-10-18' });
  m.store.update('Items', m.other, { Secret: 'HIDDEN_FIELD_OTHER', Date: '2026-10-18' });
  m.store.create('Hidden', { Value: 'HIDDEN_TABLE' });
  m.store.savePrivilegeSet({ ...row.definition,
    records: { ...row.definition.records, fields: { Secret: 'none' } },
    tables: { Hidden: { view: false, edit: false, create: false, delete: false } },
  });
  return { m, auth: (await session(m, true))!, p: m.store.privileges('Caller') };
}
const safe = (v: unknown) => assert.doesNotMatch(JSON.stringify(v), /HIDDEN_FIELD|HIDDEN_TABLE|secret-other-row/);
const live = '/tabularius/live/v1/databases/Matrix';

test('live locks and viewers exclude record-rule denials', async (t) => {
  const { m, auth } = await setup(t);
  for (const id of [m.own, m.other]) {
    m.store.locks.acquire('Items', id, 'synthetic-owner', 'other');
    m.store.locks.view('Items', id, 'synthetic-owner', 'other');
  }
  const presence = await request(m, `${live}/layouts/Items/records/${m.other}/view`, 'POST', {}, auth);
  assert.ok(presence.status >= 400, 'hidden record cannot acquire presence');
  for (const resource of ['locks', 'viewers']) {
    const r = await request(m, `${live}/${resource}`, 'GET', undefined, auth);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body[resource].map((x: { recordId: number }) => x.recordId), [m.own]);
  }
});

test('live stream filters individual and bulk ids with a visible event as a fence', async (t) => {
  const { m, auth } = await setup(t);
  const abort = new AbortController();
  const response = await fetch(m.url + live + '/events', { headers: { authorization: auth }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]) });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  try {
    await reader.read();
    m.store.notify('update', 'Items', m.other, 998);
    m.store.notify('update', 'Items', undefined, undefined, undefined, undefined, [m.other, m.own]);
    m.store.notify('update', 'Items', m.own, 999);
    let text = '';
    while (!text.includes('"modId":999')) {
      const chunk = await reader.read(); assert.equal(chunk.done, false);
      text += new TextDecoder().decode(chunk.value);
    }
    const changes = text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
    assert.ok(!changes.some((c) => c.recordId === m.other));
    assert.deepEqual(changes.find((c) => c.ids)?.ids, [m.own]);
  } finally { abort.abort(); await reader.cancel().catch(() => {}); }
});

test('calendar, dashboards and insight profiles read only visible records and fields', async (t) => {
  const { m, auth, p } = await setup(t);
  const calendar = await request(m, '/tabularius/calendar/v1/databases/Matrix/layouts/Items/calendar.ics?start=Date&title=Name', 'GET', undefined, auth);
  assert.equal(calendar.status, 200, calendar.text);
  assert.equal(calendar.headers.get('x-tabularius-events'), '1'); safe(calendar.text);
  const hidden = await request(m, '/tabularius/calendar/v1/databases/Matrix/layouts/Items/calendar.ics?start=Date&title=Secret', 'GET', undefined, auth);
  assert.ok(hidden.status >= 400); safe(hidden.text);
  const widgets = [{ kind: 'number' as const, title: 'Visible count', layout: 'Items' }];
  assert.equal(computeDashboard(m.store, widgets, p)[0].value, 1);
  const profile = layoutProfile(m.store, 'Items', { sample: true, privileges: p });
  assert.equal(profile.records, 1); safe(profile);
  assert.ok(!profile.fields.some((f) => f.name === 'Secret'));
});

test('saved digest payloads cannot survive a restriction of their owner account', async (t) => {
  const { m, auth } = await setup(t);
  const boards = new Dashboards(m.store);
  const board = boards.create({ name: 'Counts', widgets: [{ title: 'Count', kind: 'number', layout: 'Items' }] }, 'Caller');
  const digests = new Digests(m.store);
  const digest = digests.create({ name: 'History', dashboard: board.id, days: [1], at: '09:00', enabled: false, account: 'Caller' });
  const restricted = m.store.privilegeSet('Matrix')!;
  m.store.savePrivilegeSet(SHAPES[0].definition);
  digests.addRun({ id: 'old', digest: digest.id, at: new Date().toISOString(), outcome: 'ok', summary: 'HIDDEN_FIELD', highlights: ['secret-other-row'], data: [{ title: 'secret-other-row', kind: 'number', layout: 'Items', value: 2, find: [], grouping: '' }], ms: 1 });
  m.store.savePrivilegeSet(restricted);
  const revoked = await request(m, '/tabularius/digests/v1/databases/Matrix', 'GET', undefined, auth);
  assert.equal(revoked.status, 401, 'changing authority invalidates the previous session');
  safe(revoked.body);
  const current = (await session(m, true))!;
  for (const path of ['', `/${digest.id}`, `/${digest.id}/runs`]) {
    const reply = await request(m, '/tabularius/digests/v1/databases/Matrix' + path, 'GET', undefined, current);
    assert.equal(reply.status, 200, reply.text); safe(reply.body);
  }
});

test('digest rechecks record visibility after an asynchronous summary before webhook delivery', async (t) => {
  const { m } = await setup(t);
  const board = new Dashboards(m.store).create({ name: 'Count', widgets: [{ title: 'Count', kind: 'number', layout: 'Items' }] }, 'Caller');
  const digest = new Digests(m.store).create({ name: 'Async', dashboard: board.id, days: [1], at: '09:00', enabled: false, account: 'Caller', webhook: 'synthetic' });
  const restricted = m.store.privilegeSet('Matrix')!;
  m.store.savePrivilegeSet(SHAPES[0].definition);
  const posted: unknown[] = [];
  const runner = new DigestRunner(m.host);
  runner.writer = { summarize: async () => {
    m.store.savePrivilegeSet(restricted);
    m.store.update('Items', m.own, { Owner: 'other' });
    return { summary: 'HIDDEN_FIELD' };
  } };
  runner.poster = { allowed: true, post: async (_id, _db, payload) => { posted.push(payload); } };
  const result = await runner.run(m.store, digest);
  safe(result); safe(posted);
  assert.ok(result.data.length === 0 || result.data[0].value === 0);
});

test('RAG spaces containing copied record data require unrestricted reads on every call', async (t) => {
  const { m } = await setup(t);
  const { Assistant } = await import('../src/assistant.ts');
  const { DataApi } = await import('../src/dataapi.ts');
  m.store.setPassword('Full', 'synthetic-password', '[Full Access]');
  const assistant = new Assistant(m.host, new DataApi(m.host), { embedUrl: 'http://127.0.0.1:1', embedModel: 'synthetic' });
  const rag = assistant.scriptAi()!.rag!;
  const id = rag.add({ file: 'Matrix', account: 'Full', space: 'private', chunks: ['HIDDEN_FIELD'], vectors: [[1, 0]] });
  assert.ok(rag.info({ file: 'Matrix', account: 'Full', space: 'private' }));
  for (const read of [
    () => rag.spaces({ file: 'Matrix', account: 'Caller' }),
    () => rag.info({ file: 'Matrix', account: 'Caller', space: 'private' }),
    () => rag.search({ file: 'Matrix', account: 'Caller', space: 'private', vector: [1, 0], top: 1, threshold: 0 }),
  ]) assert.throws(read, /privileges|access/i);
  rag.remove({ file: 'Matrix', account: 'Full', space: 'private', ids: [id] });
});

test('RAG script reads cannot bypass record restrictions or a token ceiling through a custom backend', async (t) => {
  const { m, p } = await setup(t);
  const { runScript } = await import('../../scripts/src/index.ts');
  m.store.setPassword('Full', 'synthetic-password', '[Full Access]');
  const full = m.store.privileges('Full');
  let reads = 0;
  const ai = { refusal: () => undefined, generate: async () => '', rag: {
    add: () => 'id', search: () => [], remove: () => { reads++; return 2; },
    spaces: () => { reads++; return [{ space: 'private', model: 'synthetic' }]; }, info: () => undefined,
  } };
  const configure = { stepId: 227, name: 'Configure RAG Account', enabled: true, params: { ai: { ragAccountName: '"rag"' } } };
  for (const privileges of [p, full.withCeiling((value) => value)]) {
    const opts = { account: privileges.account, privileges, layout: 'Items', ai };
    const result = await runScript(m.store, { id: 990, name: 'ReadGate', steps: [configure,
      { stepId: 219, name: 'Perform RAG Action', enabled: true, params: { ai: { ragAccountName: '"rag"', spaceId: '"private"', ragAction: 'remove data' } } },
    ] }, opts);
    assert.equal(result.error, 9);
    const info = await runScript(m.store, { id: 991, name: 'ReadGateInfo', steps: [configure,
      { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'GetRAGSpaceInfo ( "rag" )' } },
    ] }, opts);
    assert.equal(info.result, '?');
  }
  assert.equal(reads, 0);
});

test('the combined restricted solution stays filtered across HTTP readers and exports', async (t) => {
  const { m, auth } = await setup(t);
  for (const [name, path, method, body, token] of [
    ['REST', '/fmi/data/vLatest/databases/Matrix/layouts/Items/records', 'GET', undefined, auth],
    ['web records', '/tabularius/app/v1/databases/Matrix/layouts/Items/records', 'POST', { ids: [m.other, m.own] }, auth],
    ['CSV export', '/tabularius/app/v1/databases/Matrix/layouts/Items/export', 'POST', { fields: ['Name'], format: 'csv' }, auth],
    ['OData', '/fmi/odata/v4/Matrix/Items?$count=true', 'GET', undefined, undefined],
    ['OData aggregate', '/fmi/odata/v4/Matrix/Items?$apply=aggregate(%24count%20as%20N)', 'GET', undefined, undefined],
    ['XML', '/fmi/xml/fmresultset.xml?-db=Matrix&-lay=Items&-findall', 'GET', undefined, undefined],
    ['dashboard', '/tabularius/dashboards/v1/databases/Matrix?preview=1', 'POST', { name: 'Count', widgets: [{ title: 'Count', kind: 'number', layout: 'Items' }] }, auth],
  ] as const) await t.test(name, async () => {
    const reply = await request(m, path, method, body, token);
    assert.equal(reply.status, 200, reply.text); safe(reply.text);
    if (name === 'REST') assert.equal(reply.body.response.dataInfo.foundCount, 1);
    if (name === 'OData') { assert.equal(reply.body.value.length, 1); assert.equal(reply.body['@odata.count'], 1); }
    if (name === 'OData aggregate') assert.equal(reply.body.value[0].N, 1);
    if (name === 'dashboard') assert.equal(reply.body.data[0].value, 1);
  });
  for (const path of ['/fmi/odata/v4/Matrix/Hidden', '/tabularius/sql/v1/databases/Matrix?q=SELECT%20count(*)%20FROM%20Items']) {
    const reply = await request(m, path);
    assert.ok(reply.status >= 400, reply.text); safe(reply.text);
  }
});

test('MCP readers are filtered or explicitly refused on the combined restricted solution', async (t) => {
  const { m } = await setup(t);
  for (const [name, denied, args] of [
    ['find_records', false, {}], ['get_record', false, { recordId: m.own }],
    ['describe_layout', false, { sample: true }], ['summarize_records', false, {}],
    ['search_records', false, { text: 'visible secret', tables: ['Items'] }],
    ['get_record', true, { recordId: m.other }],
    ['sql_query', true, { sql: 'SELECT count(*) FROM Items' }],
    ['evaluate_calculation', true, { formula: 'Items::Secret' }],
    ['check_calculation', true, { formula: 'Items::Secret', sampleRecords: 1 }],
    ['explain_solution', true, {}],
    ['explain_record_history', true, { recordId: m.own }],
  ] as const) await t.test(`${name} ${denied ? 'denied' : 'filtered'}`, async () => {
    const reply = await request(m, '/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name, arguments: { database: 'Matrix', layout: 'Items', ...args },
    } }, undefined, { accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' });
    assert.ok(reply.body?.result, reply.text);
    assert.equal(!!reply.body.result.isError, denied, reply.text);
    safe(reply.text);
  });
});
