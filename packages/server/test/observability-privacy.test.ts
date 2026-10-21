import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { redactPath } from '../src/server-logs.ts';

const marker = 'SYNTHETIC_PRIVATE_VALUE';

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-observability-'));
  const served = await serve({ dir, port: 0, watch: false, log: () => {} });
  const store = served.host.create('Local');
  store.setPassword('Admin', 'login', '[Full Access]');
  store.applyDesign([{ op: 'createTable', name: 'Records', fields: [{ name: 'Name' }, { name: 'Key' }] }]);
  const recordId = store.create('Records', { Name: marker, Key: 'A' }).recordId;
  const login = await fetch(served.url + '/fmi/data/vLatest/databases/Local/sessions', {
    method: 'POST', headers: { authorization: 'Basic ' + Buffer.from('Admin:login').toString('base64') }, body: '{}',
  });
  const token = (await login.json()).response.token;
  assert.ok(token);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(served.url + '/tabularius/debug/v1/databases/Local/' + path, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { ...served, store, recordId, dir, headers, call, close: async () => {
    await new Promise<void>((resolve) => served.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  } };
}

for (const route of ['runs', 'recordings']) test(`AR-server-observability-01 ${route}`, async () => {
  const f = await setup();
  try {
    f.store.setAiAllowed(true);
    f.store.applyDesign([{ op: 'createScript', name: 'Model', text: [
      'Configure AI Account [ Account Name: "acct" ]',
      'Generate Response from Model [ Account Name: "acct" ; Model: "test" ; User Prompt: Records::Name ; Response: $answer ]',
    ].join('\n') }]);
    let calls = 0;
    f.host.scriptAi = { refusal: () => undefined, generate: async () => { calls++; return 'answer'; } };
    let hostOptions = 0;
    const options = f.host.scriptOptions.bind(f.host);
    f.host.scriptOptions = () => { hostOptions++; return options(); };
    const input = { script: 'Model', layout: 'Records', recordId: f.recordId, pauseAtStart: false };
    const offline = await f.call('POST', route, input);
    assert.equal(offline.status, route === 'runs' ? 201 : 200, JSON.stringify(offline.body));
    assert.equal(calls, 0);
    assert.equal(hostOptions, 0);
    assert.equal(offline.body.done.error, 3);
    const live = await f.call('POST', 'runs', { ...input, scratch: false });
    assert.equal(live.status, 201);
    assert.equal(live.body.done.error, 0);
    assert.equal(calls, 1);
    assert.equal(hostOptions, 1);
  } finally { await f.close(); }
});

for (const formula of ['Other::Name', 'GetField ( "Other::Name" )', 'List ( Other::Name )']) test(`AR-server-observability-08 ${formula}`, async () => {
  const f = await setup();
  try {
    f.store.applyDesign([
      { op: 'createTable', name: 'Other', fields: [{ name: 'Name' }, { name: 'Key' }] },
      { op: 'createRelationship', left: 'Records', right: 'Other', predicates: [{ left: 'Key', right: 'Key' }] },
    ]);
    const otherId = f.store.create('Other', { Name: marker, Key: 'A' }).recordId;
    f.store.setAuditSettings({ logReads: true });
    const response = await f.call('POST', 'evaluate', { layout: 'Records', recordId: f.recordId, formulas: [formula, formula] });
    assert.equal(response.status, 200);
    assert.equal(response.body.results[0].value, marker);
    const reads = f.store.auditLog({ kind: 'read' });
    assert.equal(reads.filter((r) => r.table === 'Other').length, 1);
    const read = reads.find((r) => r.table === 'Other')!;
    assert.deepEqual([read.account, read.surface, read.recordId, read.changes], ['Admin', 'debug', otherId, { records: 1 }]);
    assert.ok(!JSON.stringify(reads).includes(marker));
  } finally { await f.close(); }
});

test('AR-server-observability-08 query results', async () => {
  const f = await setup();
  try {
    f.store.setAuditSettings({ logReads: true });
    const formulas = ['ExecuteSQL ( "SELECT Name FROM Records" ; "" ; "" )'];
    for (let n = 1; n <= 2; n++) {
      const response = await f.call('POST', 'evaluate', { layout: 'Records', formulas });
      assert.equal(response.status, 200);
      assert.equal(response.body.results[0].value, marker);
      const reads = f.store.auditLog({ kind: 'read' });
      assert.equal(reads.length, n);
      const read = reads.at(-1)!;
      assert.deepEqual([read.account, read.surface, read.table, read.changes], ['Admin', 'debug', 'Records', { query: true, rows: 1 }]);
      assert.ok(!JSON.stringify(reads).includes(marker));
    }
  } finally { await f.close(); }
});

test('AR-server-observability-08 summary results', async () => {
  const f = await setup();
  try {
    f.store.applyDesign([{ op: 'createField', table: 'Records', name: 'CountNames', type: 'number', kind: 'summary', summary: { type: 'count', field: 'Name' } }]);
    const second = f.store.create('Records', { Name: 'another', Key: 'B' }).recordId;
    assert.equal(f.store.evaluate('Records', 'CountNames', f.recordId).value, '2');
    f.store.setAuditSettings({ logReads: true });
    for (let n = 1; n <= 2; n++) {
      const response = await f.call('POST', 'evaluate', { layout: 'Records', recordId: f.recordId, formulas: ['CountNames'] });
      assert.equal(response.status, 200);
      assert.equal(response.body.results[0].value, '2');
      const reads = f.store.auditLog({ kind: 'read' });
      assert.equal(reads.length, n);
      assert.deepEqual(reads.at(-1)!.changes, { records: 2, ids: [f.recordId, second] });
    }
  } finally { await f.close(); }
});

for (const route of ['current', 'evaluate']) test(`AR-server-observability-08 external ${route}`, async () => {
  const f = await setup();
  try {
    const other = f.host.create('Other');
    other.setPassword('Admin', 'login', '[Full Access]');
    other.applyDesign([{ op: 'createTable', name: 'Remote', fields: [{ name: 'Name' }] }]);
    const id = other.create('Remote', { Name: marker }).recordId;
    f.store.applyDesign([
      { op: 'createDataSource', name: 'Other', paths: ['file:Other'] },
      { op: 'createOccurrence', name: 'RemoteRecords', file: 'Other', externalTable: other.schema.tables[0].id },
      { op: 'createLayout', name: 'RemoteRecords', occurrence: 'RemoteRecords' },
    ]);
    other.setAuditSettings({ logReads: true });
    const response = route === 'current'
      ? await f.call('GET', `current?layout=RemoteRecords&recordId=${id}`)
      : await f.call('POST', 'evaluate', { layout: 'RemoteRecords', recordId: id, formulas: ['Name'] });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(route === 'current' ? response.body.fields.Name : response.body.results[0].value, marker);
    assert.equal(f.store.auditLog({ kind: 'read' }).length, 0);
    const reads = other.auditLog({ kind: 'read' });
    assert.equal(reads.length, 1);
    assert.deepEqual([reads[0].account, reads[0].surface, reads[0].table, reads[0].recordId, reads[0].changes],
      ['Admin', 'debug', 'Remote', id, { records: 1 }]);
    assert.ok(!JSON.stringify(reads).includes(marker));
  } finally { await f.close(); }
});

test('AR-server-observability-08 empty and denied', async () => {
  const f = await setup();
  try {
    f.store.setAuditSettings({ logReads: true });
    assert.equal((await f.call('GET', 'current?layout=Records')).status, 200);
    assert.equal((await f.call('POST', 'evaluate', { layout: 'Records', formulas: ['1 + 1'] })).status, 200);
    f.store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false },
      layouts: 'viewOnly', scripts: 'none', valueLists: 'viewOnly', extendedPrivileges: ['fmrest'] });
    f.store.setPassword('Reader', 'login', 'Reader');
    const login = await fetch(`${f.url}/fmi/data/vLatest/databases/Local/sessions`, {
      method: 'POST', headers: { authorization: 'Basic ' + Buffer.from('Reader:login').toString('base64') }, body: '{}',
    });
    assert.equal(login.status, 200);
    const token = (await login.json()).response.token;
    for (const [path, method, body] of [
      [`current?layout=Records&recordId=${f.recordId}`, 'GET', undefined],
      ['evaluate', 'POST', { layout: 'Records', recordId: f.recordId, formulas: ['Name'] }],
    ] as const) {
      const denied = await fetch(`${f.url}/tabularius/debug/v1/databases/Local/${path}`, {
        method, headers: { ...f.headers, authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(denied.status, 403);
      await denied.json();
    }
    assert.equal(f.store.auditLog({ kind: 'read' }).length, 0);
  } finally { await f.close(); }
});

for (const query of [
  `script.param=${marker}`, `script.prerequest.param=${marker}`, `script.presort.param=${marker}`,
  `script%2eparam=${marker}`, `script.param=first&script.param=${marker}`, `unknown=${marker}`,
  `${marker}`, `script.param=${encodeURIComponent('private / value')}`,
]) test(`AR-server-observability-03 ${query.split('=')[0]}`, () => {
  const path = '/fmi/data/vLatest/databases/Local/layouts/Records/script/Test';
  assert.equal(redactPath(`${path}?${query}`), path);
  assert.equal(redactPath(`/fmi/data/vLatest/databases/Local/sessions/token?${query}`), '/fmi/data/vLatest/databases/Local/sessions/…');
});

test('AR-server-observability-03 persisted requests', async () => {
  const f = await setup();
  try {
    f.store.applyDesign([{ op: 'createScript', name: 'Test', text: 'Exit Script [ Text Result: Get ( ScriptParameter ) ]' }]);
    for (const param of ['script.param', 'script.prerequest.param', 'script.presort.param']) {
      const response = await fetch(`${f.url}/fmi/data/vLatest/databases/Local/layouts/Records/script/Test?${param}=${marker}`, { headers: f.headers });
      assert.equal(response.status, 200);
      await response.json();
    }
    await f.host.logs!.flush();
    const log = readFileSync(join(f.dir, 'Logs', 'fmdapi.log'), 'utf8');
    assert.match(log, /GET \/fmi\/data\/vLatest\/databases\/Local\/layouts\/Records\/script\/Test/);
    assert.ok(!log.includes(marker));
  } finally { await f.close(); }
});

for (const route of ['current', 'evaluate']) test(`AR-server-observability-08 ${route}`, async () => {
  const f = await setup();
  try {
    const request = () => route === 'current'
      ? f.call('GET', `current?layout=Records&recordId=${f.recordId}`)
      : f.call('POST', 'evaluate', { layout: 'Records', recordId: f.recordId, formulas: ['Name', 'GetField ( "Name" )'] });
    assert.equal((await request()).status, 200);
    assert.equal(f.store.auditLog({ kind: 'read' }).length, 0);
    f.store.setAuditSettings({ logReads: true });
    const response = await request();
    assert.equal(response.status, 200);
    assert.equal(route === 'current' ? response.body.fields.Name : response.body.results[0].value, marker);
    const reads = f.store.auditLog({ kind: 'read' });
    assert.equal(reads.length, 1);
    assert.deepEqual([reads[0].account, reads[0].surface, reads[0].table, reads[0].recordId, reads[0].changes],
      ['Admin', 'debug', 'Records', f.recordId, { records: 1 }]);
    assert.ok(!JSON.stringify(reads).includes(marker));
    assert.equal(f.store.verifyRecordAudit().status, 'consistent');
    const bad = await f.call('GET', 'current?layout=Records&recordId=99999');
    assert.equal(bad.status, 400);
    assert.equal(f.store.auditLog({ kind: 'read' }).length, 1);
    f.store.setAuditSettings({ logReads: false });
    await request();
    assert.equal(f.store.auditLog({ kind: 'read' }).length, 1);
  } finally { await f.close(); }
});
