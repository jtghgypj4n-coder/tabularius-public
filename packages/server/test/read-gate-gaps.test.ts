// Gaps the read-gate inventory (read-gate-typed.test.ts) found: places that read record data without the caller's
// privileges, each pinned here so it stays closed. Values and counts that must not appear are SENTINEL-* or named below.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStore, StoreError, type Privileges, type Store } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';
import { scanData, cleanupHistory, journalBatch } from '../src/cleanup.ts';

const KEYS = ['fmrest', 'fmodata', 'fmmcp', 'fmxdbc', 'fmapp', 'fmwebdirect', 'fmxml'];
let dir = '';
let host: Host;
let shop: Store, other: Store;
let clerk: Privileges, clerk2: Privileges;
let hiddenId = 0, visibleId = 0;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-gate-gaps-'));
  for (const n of ['Shop', 'Other', 'Big']) createStore(join(dir, `${n}.openhbam.sqlite`), { mode: 'native' });
  host = new Host(dir);
  shop = host.get('Shop')!;
  other = host.get('Other')!;
  shop.setAiPolicy(false);
  other.setAiPolicy(false);
  other.applyDesign([{ op: 'createTable', name: 'Src', fields: [{ name: 'Id' }, { name: 'Value' }] }] as never);
  other.create('Src', { Id: '1', Value: 'SENTINEL-OTHER-FILE' });
  shop.applyDesign([
    { op: 'createTable', name: 'Items', fields: [
      { name: 'Id' }, { name: 'Owner' }, { name: 'Secret' }, { name: 'N', type: 'number' },
      { name: 'Total', kind: 'calculation', calculation: 'Get ( TotalRecordCount )', options: { unstored: true } },
      { name: 'Found', kind: 'calculation', calculation: 'Get ( FoundCount )', options: { unstored: true } },
      { name: 'Number', kind: 'calculation', calculation: 'Get ( RecordNumber )', options: { unstored: true } },
      { name: 'Key', kind: 'calculation', calculation: 'If ( Get ( AccountName ) = "Clerk" ; N ; 0 - N )', options: { unstored: true } },
      { name: 'Ext', kind: 'calculation', calculation: 'External::Value', options: { unstored: true } },
      // Stored: its stored value ("k") shows nothing of the other file, but explaining it works the formula out again.
      { name: 'ExtStored', kind: 'calculation', calculation: 'Id & "|" & Left ( External::Value ; 0 )', options: {} },
      // Stored, and reads the other file through a function and not a field reference: the explanation still carries the limits.
      { name: 'ExtSql', kind: 'calculation', calculation: 'Id & "|" & Left ( ExecuteSQL ( "SELECT Value FROM External" ; "" ; "" ) ; 0 )', options: {} },
      { name: 'ExtCount', kind: 'calculation', calculation: 'Count ( External::Id ) & "|" & List ( External::Value )', options: { unstored: true } },
    ] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'ItemId' }, { name: 'Code' }] },
    { op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Email' }, { name: 'PersonId' }] },
    { op: 'createTable', name: 'Notes', fields: [{ name: 'PersonId' }, { name: 'Text' }] },
    { op: 'createDataSource', name: 'Other', paths: ['file:Other'] },
    { op: 'createOccurrence', name: 'External', file: 'Other', externalTable: other.schema.tables[0].id },
    { op: 'createLayout', name: 'External', occurrence: 'External' },
    { op: 'createRelationship', left: 'Items', right: 'External', predicates: [{ left: 'Id', right: other.schema.tables[0].fields.find((f) => f.name === 'Id')!.id }] },
    { op: 'createRelationship', left: 'Items', right: 'Orders', predicates: [{ left: 'Id', right: 'ItemId' }] },
    { op: 'createRelationship', left: 'People', right: 'Notes', predicates: [{ left: 'PersonId', right: 'PersonId' }] },
  ] as never);
  // Three records Clerk may view (ids 1..3), then twenty-one it may not.
  for (let i = 1; i <= 3; i++) shop.create('Items', { Id: i === 1 ? '1' : `m${i}`, Owner: 'Clerk', Secret: `SENTINEL-SECRET-${i}`, N: i });
  visibleId = 1;
  for (let i = 1; i <= 21; i++) {
    const r = shop.create('Items', { Id: `h${i}`, Owner: 'Boss', Secret: `SENTINEL-HIDDEN-${i}`, N: 100 + i });
    if (i === 1) hiddenId = r.recordId;
  }
  const KEYSET = { extendedPrivileges: KEYS, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'modifiable' } as const;
  shop.savePrivilegeSet({ name: 'Clerk', records: { view: 'Owner = Get ( AccountName )', edit: 'Owner = Get ( AccountName )', create: true, delete: false, fields: { Secret: 'none' } },
    tables: { Orders: { view: false, edit: false, create: false, delete: false }, Notes: { view: false, edit: false, create: false, delete: false } },
    ...KEYSET } as never);
  shop.setPassword('Clerk', 'pw', 'Clerk');
  shop.setPassword('Clerk2', 'pw', 'Clerk');
  shop.setPassword('Chief', 'pw', shop.privilegeSets().find((p) => p.id === 1)!.name);
  other.setPassword('Chief', 'pw', other.privilegeSets().find((p) => p.id === 1)!.name);
  other.savePrivilegeSet({ name: 'None', records: { view: false, edit: false, create: false, delete: false }, ...KEYSET } as never);
  other.setPassword('Clerk', 'pw', 'None');
  clerk = shop.privileges('Clerk');
  clerk2 = shop.privileges('Clerk2');
});
after(async () => {
  await host.close();
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

test('a formula cannot be worked out on a record the account may not view', () => {
  assert.throws(() => shop.evaluate('Items', 'Secret', hiddenId, { account: 'Clerk', privileges: clerk }), (e: unknown) => e instanceof StoreError && e.code === 101);
  assert.deepEqual(shop.evaluateEach('Items', ['Id', 'Owner'], hiddenId, { account: 'Clerk', privileges: clerk }), [undefined, undefined]);
  assert.deepEqual(shop.evaluateRows('Items', ['Id'], { recordId: hiddenId, related: 'Orders' }, { account: 'Clerk', privileges: clerk }), []);
  // A record it may view still works, and a caller with no privileges (the server's own) still reads any.
  assert.equal(shop.evaluate('Items', 'Owner', visibleId, { account: 'Clerk', privileges: clerk }).value, 'Clerk');
  assert.equal(shop.evaluate('Items', 'Owner', hiddenId, {}).value, 'Boss');
});

test('a layout calculation on a record being edited is judged on the saved record, not on the edit that is not saved yet', () => {
  const info = shop.layout('Items');
  const row = shop.previewRow(info, visibleId, { Owner: 'Boss' });
  assert.deepEqual(shop.evaluateEach(info, ['Id & "!"'], visibleId, { account: 'Clerk', privileges: clerk, row }), shop.evaluateEach(info, ['Id & "!"'], visibleId, { account: 'Clerk', privileges: clerk }));
  assert.equal(shop.evaluateEach(info, ['Id & "!"'], visibleId, { account: 'Clerk', privileges: clerk, row })[0] !== undefined, true);
  // The record Clerk may not view is still refused when an edit would have made it viewable.
  const mine = shop.previewRow(info, hiddenId, { Owner: 'Clerk' });
  assert.equal(shop.evaluateEach(info, ['Id & "!"'], hiddenId, { account: 'Clerk', privileges: clerk, row: mine })[0], undefined);
});

test('Get ( TotalRecordCount ), Get ( FoundCount ) and Get ( RecordNumber ) count the records the account may view', () => {
  const rec = shop.get('Items', visibleId, 'iso', undefined, clerk).fieldData;
  assert.equal(rec.Total, '3');
  assert.equal(rec.Found, '3');
  assert.equal(rec.Number, '1');
  assert.equal(shop.get('Items', visibleId, 'iso', undefined, shop.privileges('Chief')).fieldData.Total, '24');
});

test('the counts of a view rule that is never kept are worked out once for a page of records, not once for each', () => {
  // A rule that changes with every call (random) is not cached; the page must not rescan the table for each record's counts.
  shop.savePrivilegeSet({ name: 'Rolling', records: { view: 'Owner = "Boss" and Random >= 0', edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: KEYS } as never);
  shop.setPassword('Rolling', 'pw', 'Rolling');
  const rolling = shop.privileges('Rolling');
  const scans = (limit: number) => {
    const before = shop.allowedScans;
    const page = shop.find('Items', { limit, privileges: rolling });
    assert.equal(page.records.length, limit);
    assert.equal(page.records[limit - 1].fieldData.Found, '21');
    assert.equal(page.records[limit - 1].fieldData.Number, String(limit));
    return shop.allowedScans - before;
  };
  assert.equal(scans(21), scans(1), 'the number of scans does not grow with the records on the page');
});

test('a sorted found set kept for scrolling is not served to another account', () => {
  // Enough records for the order to be kept, with a sort key each account works out differently.
  const store = host.get('Big')!;
  store.setAiPolicy(false);
  store.applyDesign([{ op: 'createTable', name: 'Rows', fields: [{ name: 'N', type: 'number' }, { name: 'Key', kind: 'calculation', calculation: 'Right ( "0000" & If ( Get ( AccountName ) = "Clerk" ; N ; 5000 - N ) ; 4 )', options: { unstored: true } }] }] as never);
  for (let i = 1; i <= 2100; i++) store.create('Rows', { N: i });
  store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: KEYS } as never);
  store.setPassword('Clerk', 'pw', 'Reader');
  store.setPassword('Other', 'pw', 'Reader');
  const first = (who: string) => Number(store.find('Rows', { sort: [{ fieldName: 'Key' }], limit: 1, privileges: store.privileges(who) }).records[0].fieldData.N);
  assert.equal(first('Clerk'), 1);
  assert.equal(first('Other'), 2100, 'the order kept for one account is not the other account\'s');
  assert.equal(first('Clerk'), 1);
});

test('related fields are not written through a record the account may not view', () => {
  // An account that may edit every record but view only its own: the related record is reached through the hidden parent.
  shop.savePrivilegeSet({ name: 'Editor', records: { view: 'Owner = Get ( AccountName )', edit: true, create: true, delete: false }, tables: { Orders: { view: true, edit: true, create: true, delete: false } }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: KEYS } as never);
  shop.setPassword('Editor', 'pw', 'Editor');
  const editor = shop.privileges('Editor');
  shop.create('Orders', { ItemId: 'h1', Code: 'SENTINEL-ORDER' });
  assert.throws(() => shop.update('Items', hiddenId, { 'Orders::Code': 'changed' }, undefined, { privileges: editor }), (e: unknown) => e instanceof StoreError);
  assert.equal(shop.evaluate('Orders', 'Code', shop.findIds('Orders')[0], {}).value, 'SENTINEL-ORDER');
});

/** One MCP tool call on Shop, as the account named, answered as text. */
const run = async (who: object, tool: string, args: object) => {
  const server = createMcpServer(host, who as never);
  const client = new Client({ name: 'gaps', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  try {
    const r = await client.callTool({ name: tool, arguments: { database: 'Shop', ...args } });
    return JSON.stringify(r);
  } finally {
    await client.close();
    await server.close();
  }
};

// Formulas that reach another hosted file are worked out with the account's privileges there.
test('portal rows are not added through a parent record the account may not view', () => {
  shop.applyDesign([{ op: 'createLayout', name: 'ItemsPortal', occurrence: 'Items' }] as never);
  const layout = shop.design('ItemsPortal')!;
  const portal = { id: 900, kind: 'portal', type: 3, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {}, portal: { tableOccurrenceId: shop.schema.tableOccurrences.find((t) => t.name === 'Orders')!.id, tableOccurrence: 'Orders', rows: 3, initialRow: 1 }, children: [] };
  shop.applyDesign([{ op: 'updateLayout', layout: 'ItemsPortal', design: { objects: [...layout.objects, portal] } as never }]);
  shop.savePrivilegeSet({ name: 'PortalEditor', records: { view: 'Owner = Get ( AccountName )', edit: true, create: true, delete: false }, tables: { Orders: { view: true, edit: true, create: true, delete: false } }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: KEYS } as never);
  shop.setPassword('PortalEditor', 'pw', 'PortalEditor');
  const pe = shop.privileges('PortalEditor');
  const orders = () => shop.query('SELECT count(*) AS n FROM Orders')[0].n;
  const before = orders();
  assert.throws(() => shop.updatePortals('ItemsPortal', hiddenId, { Orders: [{ 'Orders::ItemId': 'h1', 'Orders::Code': 'SENTINEL-ADDED' }] }, [], { privileges: pe }), (e: unknown) => e instanceof StoreError);
  assert.equal(orders(), before, 'no row was added');
  // A file put in a container of a row of that portal is turned away for the same reason, though the related row itself may be edited.
  shop.applyDesign([{ op: 'createField', table: 'Orders', name: 'Pic', type: 'container' }] as never);
  const order = shop.create('Orders', { ItemId: 'h1', Code: 'SENTINEL-ORDER-2' }).recordId;
  const file = { filename: 'p.txt', mime: 'text/plain', data: new Uint8Array([1]) };
  assert.throws(() => shop.setPortalContainer('ItemsPortal', hiddenId, 'Orders', order, 'Pic', 1, file, { privileges: pe }), (e: unknown) => e instanceof StoreError);
  assert.throws(() => shop.checkPortalContainerWrite('ItemsPortal', hiddenId, 'Orders', order, 'Pic', 1, { privileges: pe }), (e: unknown) => e instanceof StoreError);
});

test('MCP formula tools do not read a file the account has no access to', async () => {
  const asChief = { account: 'Chief', password: 'pw' };
  // Clerk reads every record of Shop only through an account that does; give it that for these calls.
  shop.savePrivilegeSet({ name: 'Wide', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: KEYS } as never);
  shop.setPassword('Wide', 'pw', 'Wide');
  other.setPassword('Wide', 'pw', 'None');
  const asWide = { account: 'Wide', password: 'pw' };
  // A designer reads everything in Shop and may see its formulas, but has no access to Other.
  shop.savePrivilegeSet({ name: 'Designer', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'modifiable', extendedPrivileges: KEYS } as never);
  shop.setPassword('Designer', 'pw', 'Designer');
  other.setPassword('Designer', 'pw', 'None');
  const asDesigner = { account: 'Designer', password: 'pw' };
  for (const [who, tool, args] of [
    [asWide, 'evaluate_calculation', { layout: 'Items', formula: 'External::Value', recordId: visibleId }],
    [asWide, 'check_calculation', { layout: 'Items', formula: 'External::Value', sampleRecords: 3 }],
    [asWide, 'explain_related', { layout: 'Items', recordId: visibleId, field: 'External::Value' }],
    [asWide, 'describe_record', { layout: 'Items', recordId: visibleId }],
    [asDesigner, 'explain_value', { layout: 'Items', field: 'Ext', recordId: visibleId }],
    [asDesigner, 'explain_value', { layout: 'Items', field: 'ExtCount', recordId: visibleId }],
    [asDesigner, 'explain_value', { layout: 'Items', field: 'ExtStored', recordId: visibleId }],
    [asDesigner, 'explain_value', { layout: 'Items', field: 'ExtSql', recordId: visibleId }],
  ] as const) {
    assert.match(await run(asChief, tool, args), /SENTINEL-OTHER-FILE/, `control: ${tool} shows the other file to an account that may see it`);
    assert.doesNotMatch(await run(who, tool, args), /SENTINEL-OTHER-FILE/, tool);
  }
});

test('the cleanup scan counts only the related records the account may view', () => {
  for (const [name, email, id] of [['Ann Lee', 'ann@example.com', 'p1'], ['Ann Lee', 'ann@example.com', 'p2']]) shop.create('People', { Name: name, Email: email, PersonId: id });
  for (let i = 0; i < 4; i++) shop.create('Notes', { PersonId: 'p2', Text: i < 2 ? 'mine' : `SENTINEL-NOTE-${i}` });
  const viewer = (name: string, notes: object) => {
    shop.savePrivilegeSet({ name, records: { view: true, edit: false, create: false, delete: false }, tables: { Notes: notes }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: KEYS } as never);
    shop.setPassword(name, 'pw', name);
    return shop.privileges(name);
  };
  const seen = (pv?: Privileges) => scanData(shop, { layout: 'People', checks: ['duplicates'] }, pv).duplicates?.flatMap((g) => g.related.map((r) => `${r.table}:${r.records}`)) ?? [];
  assert.deepEqual(seen(), ['Notes:4'], 'control: with no limits the scan counts them');
  assert.deepEqual(seen(viewer('NoNotes', { view: false, edit: false, create: false, delete: false })), [], 'a table the account may not view is not counted');
  assert.deepEqual(seen(viewer('SomeNotes', { view: 'Text = "mine"', edit: false, create: false, delete: false })), ['Notes:2'], 'nor are the records of it the account may not view');
});

test('the cleanup history shows an account its own batches, and full access all', () => {
  journalBatch(shop, { account: 'Clerk', layout: 'Items', summary: 'SENTINEL-MINE', undo: [] });
  journalBatch(shop, { account: 'Boss', layout: 'Items', summary: 'SENTINEL-THEIRS', undo: [] });
  const summaries = (who?: { account?: string; privileges?: Privileges }) => cleanupHistory(shop, who).map((b) => b.summary).sort();
  assert.deepEqual(summaries({ account: 'Clerk', privileges: clerk }), ['SENTINEL-MINE']);
  assert.deepEqual(summaries({ account: 'Chief', privileges: shop.privileges('Chief') }), ['SENTINEL-MINE', 'SENTINEL-THEIRS']);
});

test('the cleanup history asked for through the MCP tool shows an account its own batches only', async () => {
  const history = async (who: object) => await run(who, 'undo_data_fix', {});
  const chief = await history({ account: 'Chief', password: 'pw' });
  assert.match(chief, /SENTINEL-THEIRS/, 'control: full access lists every batch');
  const mine = await history({ account: 'Clerk', password: 'pw' });
  assert.match(mine, /SENTINEL-MINE/);
  assert.doesNotMatch(mine, /SENTINEL-THEIRS/);
});
