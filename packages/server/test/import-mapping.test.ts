// Importing a spreadsheet with matching: columns matched to fields by name or by the assistant (a stand-in for the
// Messages API here), fixes for each column's format, a preview with the rows already in the file, and the import
// as one step that can be undone; from the web client and from MCP clients.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { applyImport, convert, hasHeaderRow, importHistory, matchColumns, nameParts, phone, placeParts, planImport, replan, suggestFixes, undoImport, type ImportField } from '../src/import-mapping.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let model: Server;
let base: string;
let store: Store;
const asked: { system: string; content: string }[] = [];

const CSV = [
  ['E-mail Address', 'Full Name', 'Joined', 'Pts', 'Member?', 'state', 'Password'],
  ['ann@example.com', 'Ann Lee', '25/12/2025', '$1,200.50', 'yes', 'active', 'hunter2-secret'],
  ['bob@example.com', '  Bob   Ray ', '03/01/2026', '15', 'no', 'Prospect', 'x'],
  ['old@example.com', 'Old Timer', '01/02/2024', '7', 'yes', 'inactive', 'x'],
  ['ann@example.com', 'Ann Again', '31/12/2025', '3', 'maybe', 'active', 'x'],
  ['cat@example.com', 'Cat', '31/02/2026', 'n/a', 'no', 'Bogus', 'x'],
];
const csvText = CSV.map((r) => r.map((v) => `"${v}"`).join(',')).join('\r\n');

before(async () => {
  if (skip) return;
  model = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      const system = Array.isArray(body.system) ? body.system.map((b: { text: string }) => b.text).join('\n') : body.system;
      const last = body.messages.at(-1).content;
      asked.push({ system, content: typeof last === 'string' ? last : last.map((b: { text?: string }) => b.text ?? '').join('') });
      const mapping = { columns: [
        { column: 0, field: 'Email', transforms: ['trim'], why: 'email addresses' },
        { column: 1, field: 'Name', transforms: ['trim'], why: 'person\'s name' },
        { column: 2, field: 'Since', transforms: ['date-dmy'], why: 'day-first dates' },
        { column: 3, field: 'Score', transforms: ['number', 'made-up-fix'], why: 'points' },
        { column: 4, field: 'Member', transforms: ['yes-no'], why: 'yes or no' },
        { column: 5, field: 'Status', transforms: ['value-list'], why: 'status' },
        { column: 6, field: 'Nope', why: 'not a field' },
      ], keys: ['Email'] };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        content: [{ type: 'text', text: 'Here you go:\n' + JSON.stringify(mapping) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 },
      }));
    });
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'tabularius-import-mapping-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, ai: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}` } });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.applyDesign([
    { op: 'createValueList', name: 'Statuses', values: ['Active', 'Inactive', 'Prospect'] },
    { op: 'createTable', name: 'Members', fields: [{ name: 'Email', type: 'text' }, { name: 'Name', type: 'text' }, { name: 'Since', type: 'date' }, { name: 'Score', type: 'number' }, { name: 'Member', type: 'number' }, { name: 'Status', type: 'text' }] },
  ] as never);
  store.applyDesign([{ op: 'updateField', table: 'Members', field: 'Status', options: { validation: { valueList: 'Statuses' } } }] as never);
  store.create('Members', { Email: 'OLD@example.com', Name: 'Old Timer', Status: 'Inactive' });
  const set = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...set, extendedPrivileges: [...set.extendedPrivileges, 'fmrest'] });
  store.setPassword('Admin', 'Admin-pw-123456');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  model?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const date: ImportField = { name: 'Since', type: 'date' };
const num: ImportField = { name: 'Score', type: 'number' };

test('each column\'s fixes: date order, numbers people write, yes/no, value list spellings, and what can\'t be fixed', () => {
  assert.deepEqual(suggestFixes(['25/12/2025', '03/01/2026'], date), ['date-dmy']);
  assert.deepEqual(suggestFixes(['12/25/2025', '03/01/2026'], date), ['date-mdy']);
  assert.deepEqual(suggestFixes(['2025-12-25'], date), []);
  assert.deepEqual(suggestFixes([46016], date), ['excel-date']);
  assert.deepEqual(suggestFixes(['$1,200.50', '15'], num), ['number']);
  assert.deepEqual(suggestFixes(['yes', 'No'], num), ['yes-no']);
  assert.deepEqual(convert('25/12/2025', date, ['date-dmy']), { value: '2025-12-25' });
  assert.deepEqual(convert('12/25/25', date, ['date-mdy']), { value: '2025-12-25' });
  assert.match(convert('31/02/2026', date, ['date-dmy']).issue!, /isn't a real date/);
  assert.deepEqual(convert('$1,200.50', num, ['number']), { value: 1200.5 });
  assert.deepEqual(convert('1.234,56 €', num, ['number']), { value: 1234.56 });
  assert.deepEqual(convert('(42)', num, ['number']), { value: -42 });
  assert.deepEqual(convert('Yes', num, ['yes-no']), { value: 1 });
  assert.match(convert('maybe', num, ['yes-no']).issue!, /isn't yes or no/);
  const status: ImportField = { name: 'Status', type: 'text', valueList: 'Statuses', values: ['Active', 'Inactive'] };
  assert.deepEqual(convert('ACTIVE', status, ['value-list']), { value: 'Active' });
  assert.match(convert('Bogus', status, ['value-list']).issue!, /isn't in the Statuses value list/);
  assert.deepEqual(convert('  Bob   Ray ', { name: 'Name', type: 'text' }, ['trim']), { value: 'Bob Ray' });
  assert.equal(hasHeaderRow([['Name', 'Score'], ['Ann', 3]], [{ name: 'X', type: 'text' }]), true);
  assert.equal(hasHeaderRow([['Ann', 3], ['Bob', 4]], [{ name: 'Name', type: 'text' }]), false);
});

test('matched by name without the assistant, with the rows already in the file or repeated', { skip }, async () => {
  const plan = await planImport(store, 'Members', CSV);
  assert.equal(plan.headerRow, true);
  const into = Object.fromEntries(plan.columns.map((c) => [c.header, c.field]));
  assert.equal(into['E-mail Address'], 'Email');
  assert.equal(into['Full Name'], 'Name');
  assert.equal(into.state, 'Status');
  assert.equal(into.Joined, null, 'nothing called Joined');
  assert.deepEqual(plan.keys, ['Email']);
  assert.equal(plan.summary.duplicatesExisting, 1, 'old@example.com, whatever its case');
  assert.equal(plan.summary.duplicatesInFile, 1);
  const again = plan.preview.find((r) => r.row === 5)!;
  assert.deepEqual(again.duplicate, { of: 'file', row: 2 });
  assert.equal(plan.preview.find((r) => r.row === 4)!.duplicate?.of, 'existing');
  assert.equal(plan.ai, undefined);
});

test('the assistant\'s matching: the fields and fixes it picks, kept to real fields and fixes, never a secret', { skip }, async () => {
  const before = asked.length;
  const res = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:Admin-pw-123456') }, body: '{}',
  });
  const token = (await res.json()).response.token as string;
  const upload = () => {
    const form = new FormData();
    form.append('upload', new Blob([csvText], { type: 'text/csv' }), 'members.csv');
    return form;
  };
  const call = async (query: string) => (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Members/import?${query}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: upload(),
  })).json();
  const plan = await call('plan=1&ai=1');
  assert.equal(asked.length, before + 1);
  assert.match(asked.at(-1)!.system, /match the columns of a spreadsheet/);
  assert.ok(!asked.at(-1)!.content.includes('hunter2-secret'), 'a password column\'s values are never sent');
  assert.deepEqual(plan.ai, { used: true });
  const by = Object.fromEntries(plan.columns.map((c: { header: string }) => [c.header, c]));
  assert.equal(by.Joined.field, 'Since');
  assert.deepEqual(by.Joined.transforms, ['date-dmy']);
  assert.deepEqual(by.Pts.transforms, ['number'], 'made-up fixes are dropped');
  assert.equal(by.Password.field, null, 'not a field');
  assert.equal(by.Pts.why, 'points');
  const ann = plan.preview.find((r: { row: number }) => r.row === 2);
  assert.deepEqual(ann.values, { Email: 'ann@example.com', Name: 'Ann Lee', Since: '2025-12-25', Score: 1200.5, Member: 1, Status: 'Active' });
  const cat = plan.preview.find((r: { row: number }) => r.row === 6);
  assert.deepEqual(cat.issues.map((i: string) => i.replace(/:.*/, '')), ['Since', 'Score', 'Status']);

  // With AI off for the file, matching is by name and nothing goes to the model.
  store.setAiAllowed(false);
  const offPlan = await call('plan=1&ai=1');
  store.setAiAllowed(true);
  assert.equal(asked.length, before + 1);
  assert.deepEqual(offPlan.ai, { used: false, note: 'AI is turned off for Charts; matched by name' });

  // The person's changes give a new preview; then the import, leaving out duplicates and rows with problems.
  const choice = { headerRow: true, columns: plan.columns.map((c: { column: number; field: string | null; transforms: string[] }) => ({ column: c.column, field: c.field, transforms: c.transforms })), keys: ['Email'] };
  const changed = await call(`plan=1&columns=${encodeURIComponent(JSON.stringify({ ...choice, keys: [] }))}`);
  assert.equal(changed.summary.duplicatesExisting, 0, 'no keys, no duplicates');
  const done = await call(`columns=${encodeURIComponent(JSON.stringify(choice))}&skipDuplicates=1&skipIssues=1`);
  assert.equal(done.imported, 2, JSON.stringify(done));
  assert.deepEqual(done.skipped.map((s: { row: number }) => s.row), [4, 5, 6]);
  assert.equal(store.get('Members', done.foundSet[0], 'iso').fieldData.Since, '2025-12-25');

  // Undo takes the whole import back.
  const undo = await (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Members/undo-import`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: done.id }),
  })).json();
  assert.deepEqual(undo, { deleted: 2, kept: [] });
  assert.equal(importHistory(store).find((record) => record.id === done.id)?.undone !== undefined, true);
});

test('undo leaves records changed since the import, and an import is undone once', { skip }, () => {
  const plan = replan(store, 'Members', CSV, { headerRow: true, columns: [{ column: 0, field: 'Email', transforms: ['trim'] }, { column: 1, field: 'Name', transforms: ['trim'] }] }, undefined);
  assert.equal(plan.columns[0].by, 'person');
  const r = applyImport(store, 'Members', CSV, { headerRow: true, columns: plan.columns, keys: [] }, { account: 'Admin' });
  assert.equal(r.imported, 5);
  store.update('Members', r.foundSet[1], { Name: 'Bob Changed' });
  const u = undoImport(store, r.id, {});
  assert.equal(u.deleted, 4);
  assert.deepEqual(u.kept, [{ recordId: r.foundSet[1], why: 'changed since it was imported' }]);
  assert.throws(() => undoImport(store, r.id, {}), /Already undone/);
  store.delete('Members', r.foundSet[1]);
});

test('MCP clients plan, import and undo', { skip }, async () => {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const res = await (await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    })).json();
    assert.ok(!res.result.isError, res.result.content[0].text);
    return JSON.parse(res.result.content[0].text);
  };
  const plan = await rpc('plan_import', { database: 'Charts', layout: 'Members', data: csvText });
  assert.equal(plan.columns[0].field, 'Email');
  const columns = plan.columns.map((c: { column: number; field: string | null; transforms: string[] }) => ({ column: c.column, field: c.field, transforms: c.transforms }));
  const done = await rpc('import_records', { database: 'Charts', layout: 'Members', data: csvText, headerRow: true, columns, keys: ['Email'], skipDuplicates: true });
  assert.equal(done.imported, 2);
  assert.deepEqual(done.skipped.map((x: { row: number }) => x.row), [4, 5, 6], 'two duplicates, and a status the field\'s validation refuses');
  const history = await rpc('undo_import', { database: 'Charts' });
  assert.equal(history[0].id, done.id);
  assert.equal(history[0].file, 'MCP import');
  assert.equal((await rpc('undo_import', { database: 'Charts', id: done.id })).deleted, 2);
});

test('plan_import reads semicolon and pipe files, by name or from the first line, and reports a quote never closed', { skip }, async () => {
  const rpc = async (args: Record<string, unknown>) => {
    const res = await (await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'plan_import', arguments: { database: 'Charts', layout: 'Members', ...args } } }),
    })).json();
    assert.ok(!res.result.isError, res.result.content[0].text);
    return JSON.parse(res.result.content[0].text);
  };
  const fieldsOf = (plan: { columns: { field: string | null }[] }) => plan.columns.map((c) => c.field);
  const reference = fieldsOf(await rpc({ data: csvText }));
  for (const [sep, format] of [[';', 'semicolon'], ['|', 'pipe']] as const) {
    const text = csvText.split('\n').map((line) => line.replace(/,/g, sep)).join('\n');
    assert.deepEqual(fieldsOf(await rpc({ data: text, format })), reference, `${format} by name`);
    assert.deepEqual(fieldsOf(await rpc({ data: text })), reference, `${format} sniffed`);
  }
  assert.equal((await rpc({ data: csvText })).notices, undefined);
  const open = await rpc({ data: 'Email,Name\nA@x.org,"abc\nB@x.org,Bob' });
  assert.deepEqual(open.notices, ['A quote opened on row 2 is never closed, so everything after it was read as part of that value']);
});

// FileMaker's other import actions: Update matching records and Replace data, both in the found set only.
const PEOPLE = [
  ['Email', 'Name', 'Score'],
  ['ann@example.com', 'Ann First', '10'],
  ['bob@example.com', '', '30'],
  ['ann@example.com', 'Ann Last', '20'],
  ['dan@example.com', 'Dan New', '40'],
  ['', 'Nobody', '50'],
  ['eve@example.com', 'Eve', '60'],
];
const peopleColumns = [{ column: 0, field: 'Email' }, { column: 1, field: 'Name' }, { column: 2, field: 'Score', transforms: ['number'] }];
const person = (id: number) => {
  const d = store.get('People', id).fieldData;
  return [d.Name, d.Score];
};
let people: Record<string, number>;

test('Update matching records: only the found set, every matching record, the last row winning, blanks overwriting, and Undo', { skip }, () => {
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Email', type: 'text' }, { name: 'Name', type: 'text' }, { name: 'Score', type: 'number' }] }] as never);
  people = {
    ann: store.create('People', { Email: 'ann@example.com', Name: 'Ann', Score: 1 }).recordId,
    twin: store.create('People', { Email: 'ANN@example.com ', Name: 'Ann twin', Score: 2 }).recordId,
    bob: store.create('People', { Email: 'bob@example.com', Name: 'Bob', Score: 3 }).recordId,
    dan: store.create('People', { Email: 'dan@example.com', Name: 'Dan', Score: 4 }).recordId,
    blank: store.create('People', { Name: 'No email', Score: 5 }).recordId,
  };
  const { ann, twin, bob, dan, blank } = people;
  const found = [bob, ann, twin, blank]; // Dan isn't in the found set
  assert.throws(() => applyImport(store, 'People', PEOPLE, { headerRow: true, columns: peopleColumns }, { action: 'update', target: found }), /match records on/);

  const r = applyImport(store, 'People', PEOPLE, { headerRow: true, columns: peopleColumns }, { account: 'Admin', action: 'update', match: ['Email'], target: found, file: 'people.csv' });
  assert.equal(r.updated, 3);
  assert.equal(r.imported, 0);
  assert.deepEqual(r.foundSet, [bob, ann, twin], 'the records updated, in the found set\'s order');
  assert.deepEqual(r.skipped.map((s) => [s.row, s.why]), [[5, 'matches no record in the found set'], [6, 'matches no record in the found set'], [7, 'matches no record in the found set']]);
  assert.deepEqual(person(ann), ['Ann Last', 20], 'the last matching row wins');
  assert.deepEqual(person(twin), ['Ann Last', 20], 'every matching record is updated');
  assert.deepEqual(person(bob), ['', 30], 'a blank in the file overwrites');
  assert.deepEqual(person(dan), ['Dan', 4], 'not in the found set');
  assert.deepEqual(person(blank), ['No email', 5], 'empty match fields never match');

  // Beyond FileMaker: Undo puts back what the fields held, leaving a value changed since.
  store.update('People', twin, { Score: 99 });
  const u = undoImport(store, r.id, { account: 'Admin' });
  assert.equal(u.deleted, 0);
  assert.equal(u.restored, 5);
  assert.deepEqual(u.kept.map((k) => k.recordId), [twin]);
  assert.deepEqual(person(ann), ['Ann', 1]);
  assert.deepEqual(person(bob), ['Bob', 3]);
  assert.deepEqual(person(twin), ['Ann twin', 99]);
  assert.throws(() => undoImport(store, r.id, {}), /Already undone/);

  // Add remaining data as new records: rows matching nothing in the found set become new records, Dan's too.
  const more = applyImport(store, 'People', PEOPLE, { headerRow: true, columns: peopleColumns }, { action: 'update', match: ['Email'], target: [ann], addRemaining: true });
  assert.equal(more.updated, 1);
  assert.equal(more.imported, 4);
  assert.equal(more.foundSet[0], ann);
  assert.deepEqual(more.foundSet.slice(1).map((id) => person(id)[0]), ['', 'Dan New', 'Nobody', 'Eve']);
  const back = undoImport(store, more.id, {});
  assert.deepEqual([back.deleted, back.restored], [4, 2]);
  assert.deepEqual(person(ann), ['Ann', 1]);
});

test('Replace data in the found set: its records in order, one row each, the rest added only when asked', { skip }, () => {
  const { ann, bob, dan } = people;
  const rows = PEOPLE.slice(0, 4);
  const r = applyImport(store, 'People', rows, { headerRow: true, columns: peopleColumns.slice(1) }, { action: 'replace', target: [bob, ann] });
  assert.deepEqual([r.updated, r.imported], [2, 0]);
  assert.deepEqual(person(bob), ['Ann First', 10]);
  assert.deepEqual(person(ann), ['', 30]);
  assert.equal(store.get('People', ann).fieldData.Email, 'ann@example.com', 'a field not imported is left');
  assert.deepEqual(r.skipped, [{ row: 4, why: 'more rows than records in the found set' }]);
  undoImport(store, r.id, {});
  assert.deepEqual(person(bob), ['Bob', 3]);

  const all = applyImport(store, 'People', rows, { headerRow: true, columns: peopleColumns.slice(1) }, { action: 'replace', target: [dan], addRemaining: true });
  assert.deepEqual([all.updated, all.imported, all.foundSet[0]], [1, 2, dan]);
  undoImport(store, all.id, {});
  assert.deepEqual(person(dan), ['Dan', 4]);
});

test('the web client\'s Update: the found set it sends, of records the account can see, and its preview', { skip }, async () => {
  const { ann, bob, dan } = people;
  const res = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:Admin-pw-123456') }, body: '{}',
  });
  const token = (await res.json()).response.token as string;
  const csv = PEOPLE.map((r) => r.join(',')).join('\n');
  const call = async (query: string, found?: unknown) => {
    const form = new FormData();
    form.append('upload', new Blob([csv], { type: 'text/csv' }), 'people.csv');
    if (found !== undefined) form.append('found', JSON.stringify(found));
    return (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/People/import?${query}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form })).json();
  };
  const choice = encodeURIComponent(JSON.stringify({ headerRow: true, columns: peopleColumns, keys: ['Email'] }));
  const plan = await call(`plan=1&columns=${choice}&action=update`, { ids: [ann, bob] });
  assert.equal(plan.summary.duplicatesExisting, 3, 'rows matching Ann and Bob, not Dan, who is outside the found set');
  assert.match(JSON.stringify(await call(`columns=${choice}&action=update`)), /found set to update is missing/);
  const bad = await call(`columns=${choice}&action=update&match=${encodeURIComponent('{}')}`, { ids: [ann] });
  assert.match(JSON.stringify(bad), /match records on/, 'a match that isn\'t a list is refused, not a server error');
  const done = await call(`columns=${choice}&action=update&match=${encodeURIComponent('["Email"]')}&addRemaining=0`, { ids: [ann, bob, 999999] });
  assert.equal(done.updated, 2, JSON.stringify(done));
  assert.deepEqual(done.foundSet, [ann, bob]);
  assert.deepEqual(person(dan), ['Dan', 4]);
  const undo = await (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/People/undo-import`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: done.id }),
  })).json();
  assert.deepEqual(undo, { deleted: 0, kept: [], restored: 4 });
  assert.deepEqual(person(ann), ['Ann', 1]);
});

test('Replace keeps each row in its place: a row left out for an issue leaves its record, a blank row blanks its record', { skip }, () => {
  const ids = [1, 2, 3].map((n) => store.create('People', { Email: `r${n}@example.com`, Name: `R${n}`, Score: n }).recordId);
  const rows = [['Name', 'Score', 'Other'], ['New 1', '11', ''], ['New 2', 'n/a', ''], ['New 3', '33', '']];
  const cols = [{ column: 0, field: 'Name' }, { column: 1, field: 'Score', transforms: ['number'] }];
  const r = applyImport(store, 'People', rows, { headerRow: true, columns: cols }, { action: 'replace', target: ids, skipIssues: true });
  assert.deepEqual(ids.map(person), [['New 1', 11], ['R2', 2], ['New 3', 33]], 'row 3 goes to the third record, not the second');
  assert.deepEqual(r.skipped.map((s) => s.row), [3]);
  undoImport(store, r.id, {});

  const blank = [['Name', 'Score', 'Other'], ['New 1', '11', ''], ['', '', 'not imported'], ['New 3', '33', ''], ['', '', '']];
  const b = applyImport(store, 'People', blank, { headerRow: true, columns: cols }, { action: 'replace', target: ids, addRemaining: true });
  assert.deepEqual(ids.map(person), [['New 1', 11], ['', ''], ['New 3', 33]]);
  assert.equal(b.imported, 0, 'a blank row past the end adds no record');
  undoImport(store, b.id, {});
  assert.deepEqual(ids.map(person), [['R1', 1], ['R2', 2], ['R3', 3]]);
  for (const id of ids) store.delete('People', id);
});

test('Update matches values as the fields store them, and undo lists a record left alone once', { skip }, () => {
  const id = store.create('People', { Email: 'num@example.com', Name: 'Num', Score: 10.5 }).recordId;
  const rows = [['Score', 'Name'], ['10.50', 'Matched']];
  const r = applyImport(store, 'People', rows, { headerRow: true, columns: [{ column: 0, field: 'Score' }, { column: 1, field: 'Name' }] }, { action: 'update', match: ['Score'], target: [id], addRemaining: true });
  assert.deepEqual([r.updated, r.imported], [1, 0], '"10.50" is the stored 10.5, not a new record');
  assert.equal(person(id)[0], 'Matched');
  const two = applyImport(store, 'People', [['Score', 'Name', 'Email'], ['10.5', 'Again', 'x@example.com']], { headerRow: true, columns: [{ column: 0, field: 'Score' }, { column: 1, field: 'Name' }, { column: 2, field: 'Email' }] }, { action: 'update', match: ['Score'], target: [id] });
  store.update('People', id, { Name: 'Mine', Email: 'mine@example.com' });
  assert.deepEqual(undoImport(store, two.id, {}).kept.map((k) => k.recordId), [id], 'one entry for the record, not one per field');
  store.delete('People', id);
});

test('phone numbers written one way, and a full name or "City, ST 12345" in parts', () => {
  assert.equal(phone('555.123.4567'), '(555) 123-4567');
  assert.equal(phone('+1 (555) 123-4567 ext. 89'), '(555) 123-4567 x89');
  assert.equal(phone('1-555-123-4567'), '(555) 123-4567');
  assert.equal(phone('123 4567'), '123-4567');
  assert.equal(phone('+44 20  7946 0958'), '+44 20 7946 0958', 'another country, kept as written');
  assert.equal(phone('12345'), undefined);
  assert.equal(phone('call me'), undefined);
  const tel: ImportField = { name: 'Phone', type: 'text' };
  assert.deepEqual(suggestFixes(['555.123.4567', '(555) 222-3333'], tel), ['phone']);
  assert.deepEqual(suggestFixes(['(555) 123-4567', '(555) 222-3333'], tel), [], 'already one way');
  assert.deepEqual(suggestFixes(['555.123.4567', '(555) 222-3333'], { name: 'Notes', type: 'text' }), [], 'not a phone field');
  assert.match(convert('n/a', tel, ['phone']).issue!, /isn't a phone number/);
  // A cell with a line break (two numbers, or a note) is not a phone number, and doesn't stop the preview.
  assert.equal(phone('555.123.4567\n555.222.3333'), undefined);
  assert.equal(phone('(555) 123-4567\r\nwork'), undefined);
  assert.deepEqual(suggestFixes(['555.123.4567', '555.222.3333\nhome', '(555) 222-3333', '555-444-5555', '555 666 7777'], tel), ['phone']);
  assert.match(convert('555.123.4567\n555.222.3333', tel, ['phone']).issue!, /isn't a phone number/);

  assert.deepEqual(nameParts('Ann Lee'), { first: 'Ann', middle: '', last: 'Lee' });
  assert.deepEqual(nameParts('Dr. Mary Ann Smith Jr.'), { first: 'Mary', middle: 'Ann', last: 'Smith Jr.' });
  assert.deepEqual(nameParts('Smith, John A.'), { first: 'John', middle: 'A.', last: 'Smith' });
  assert.deepEqual(nameParts('Ludwig van Beethoven'), { first: 'Ludwig', middle: '', last: 'van Beethoven' });
  assert.deepEqual(nameParts('Cher'), { first: 'Cher', middle: '', last: '' });
  assert.deepEqual(nameParts('John Smith, Jr.'), { first: 'John', middle: '', last: 'Smith Jr.' });
  assert.deepEqual(placeParts('Springfield, IL 62704'), { city: 'Springfield', state: 'IL', postcode: '62704' });
  assert.deepEqual(placeParts('New York, NY, 10001-1234, USA'), { city: 'New York', state: 'NY', postcode: '10001-1234' });
  assert.deepEqual(placeParts('Toronto, ON m5v 2t6'), { city: 'Toronto', state: 'ON', postcode: 'M5V 2T6' });
  assert.deepEqual(placeParts('Lyon, Rhône'), { city: 'Lyon', state: 'Rhône', postcode: '' });
  assert.equal(placeParts('Lyon'), undefined);
  const text: ImportField = { name: 'City', type: 'text' };
  assert.deepEqual(convert('  Springfield, IL 62704 ', text, ['trim', 'city']), { value: 'Springfield' });
  assert.deepEqual(convert('Springfield, IL 62704', { name: 'Zip', type: 'number' }, ['postcode']), { value: '62704' });
  assert.match(convert('Lyon', text, ['city']).issue!, /can't find the city in "Lyon"/);
  assert.deepEqual(convert('Cher', { name: 'Last', type: 'text' }, ['name-last']), { value: '' }, 'no last name: left blank');
});

test('a column split across fields: matched by its name and values, changed by the person or the assistant, and imported', { skip }, async () => {
  store.applyDesign([{ op: 'createTable', name: 'Contacts', fields: ['First Name', 'Last Name', 'City', 'State', 'Zip', 'Phone', 'Name Notes'].map((name) => ({ name, type: 'text' })) }] as never);
  const rows = [
    ['Full Name', 'City/State/Zip', 'Tel'],
    ['Ann Lee', 'Springfield, IL 62704', '555.123.4567'],
    ['Lee, Bob', 'Portland, OR 97201', '(555) 222-3333'],
    ['Dr. Cat de la Cruz', 'Austin, TX 73301', '+1 555 999 0000'],
  ];
  const plan = await planImport(store, 'Contacts', rows);
  const got = plan.columns.map((c) => [c.column, c.field, c.transforms.join(' ')]);
  assert.deepEqual(got, [
    [0, 'First Name', 'name-first'], [0, 'Last Name', 'name-last'],
    [1, 'City', 'city'], [1, 'State', 'state'], [1, 'Zip', 'postcode'],
    [2, 'Phone', 'phone'],
  ]);
  assert.equal(plan.columns[0].why, 'full names, split');
  assert.deepEqual(plan.preview.map((r) => r.values), [
    { 'First Name': 'Ann', 'Last Name': 'Lee', City: 'Springfield', State: 'IL', Zip: '62704', Phone: '(555) 123-4567' },
    { 'First Name': 'Bob', 'Last Name': 'Lee', City: 'Portland', State: 'OR', Zip: '97201', Phone: '(555) 222-3333' },
    { 'First Name': 'Cat', 'Last Name': 'de la Cruz', City: 'Austin', State: 'TX', Zip: '73301', Phone: '(555) 999-0000' },
  ]);

  // A Name field of its own takes the column whole: nothing to split.
  const whole = matchColumns(rows, [{ name: 'Full Name', type: 'text' }, { name: 'First Name', type: 'text' }, { name: 'Last Name', type: 'text' }], true);
  assert.deepEqual(whole.filter((c) => c.column === 0).map((c) => [c.field, c.transforms]), [['Full Name', []]]);

  // The person keeps the last name only; the rest of the columns stay as they are.
  const mine = replan(store, 'Contacts', rows, { headerRow: true, columns: [{ column: 0, field: 'Last Name', transforms: ['name-last', 'name-first', 'upper'] }, { column: 2, field: 'Phone', transforms: [] }] });
  assert.deepEqual(mine.columns.map((c) => [c.column, c.field, c.transforms.join(' ')]), [[0, 'Last Name', 'name-last upper'], [1, null, ''], [2, 'Phone', '']], 'one part per entry');
  assert.deepEqual(mine.preview[0].values, { 'Last Name': 'LEE', Phone: '555.123.4567' });

  // The assistant splits the name too: its entries replace the ones by name; an entry repeating a part, or with no
  // part, for a column it splits is dropped; a field it gives twice is taken once.
  const mapper = async () => ({ columns: [
    { column: 0, field: 'First Name', transforms: ['name-first'], why: 'first names' },
    { column: 0, field: 'Name Notes', transforms: ['name-first'], why: 'again' },
    { column: 0, field: 'Name Notes', transforms: [], why: 'whole' },
    { column: 0, field: 'Last Name', transforms: ['name-last'], why: 'last names' },
    { column: 2, field: 'Last Name', transforms: [], why: 'taken' },
  ] });
  const ai = await planImport(store, 'Contacts', rows, { mapper });
  assert.deepEqual(ai.columns.map((c) => [c.column, c.field, c.transforms.join(' '), c.by]), [
    [0, 'First Name', 'name-first', 'ai'], [0, 'Last Name', 'name-last', 'ai'],
    [1, 'City', 'city', 'values'], [1, 'State', 'state', 'values'], [1, 'Zip', 'postcode', 'values'],
    [2, null, '', 'ai'],
  ]);

  // Imported as planned.
  const done = applyImport(store, 'Contacts', rows, plan, { account: 'Admin' });
  assert.equal(done.imported, 3);
  assert.deepEqual(store.get('Contacts', done.foundSet[2]).fieldData, { 'First Name': 'Cat', 'Last Name': 'de la Cruz', City: 'Austin', State: 'TX', Zip: '73301', Phone: '(555) 999-0000', 'Name Notes': '' });
});

test('second-opinion findings: long cells, data rows, credentials, one field per entry, columns the assistant answered twice', { skip }, async () => {
  // A long run of spaces can't stall the server.
  const started = performance.now();
  assert.equal(placeParts('a, b' + ' '.repeat(5000) + '!,'), undefined);
  matchColumns([['Note'], ['a, b' + ' '.repeat(300) + '!,'], ['x, y' + ' '.repeat(300) + '!,']], [{ name: 'City', type: 'text' }, { name: 'State', type: 'text' }], true);
  assert.ok(performance.now() - started < 200, `${Math.round(performance.now() - started)} ms`);

  // A first row of data isn't taken for column names.
  const phoneField: ImportField[] = [{ name: 'Name', type: 'text' }, { name: 'Kind', type: 'text' }, { name: 'Phone', type: 'text' }];
  assert.equal(hasHeaderRow([['Ann Lee', 'Cell', '555-123-4567'], ['Bo Li', 'Home', '555-222-3333']], phoneField), false);
  assert.equal(hasHeaderRow([['Bo Li', 'No', 'Paid'], ['Ann Lee', 'Yes', 'Due']], [{ name: 'Code', type: 'text' }, { name: 'Amount', type: 'text' }]), false);
  assert.equal(hasHeaderRow([['Full Name', 'Tel'], ['Ann Lee', '555-123-4567']], phoneField), true);

  // Letters after a name stay with the last name; a title with one name gives the last name.
  assert.deepEqual(nameParts('John Smith, M.D.'), { first: 'John', middle: '', last: 'Smith M.D.' });
  assert.deepEqual(nameParts('Jane Doe, RN'), { first: 'Jane', middle: '', last: 'Doe RN' });
  assert.deepEqual(nameParts('John Smith, Jr., Esq.'), { first: 'John', middle: '', last: 'Smith Jr. Esq.' });
  assert.deepEqual(nameParts('Dr. Smith'), { first: '', middle: '', last: 'Smith' });

  // Phone numbers dialled from abroad, written without spaces, or kept as numbers by a spreadsheet.
  assert.equal(phone('001 555 123 4567'), '(555) 123-4567');
  assert.equal(phone('+15551234567'), '(555) 123-4567');
  assert.deepEqual(convert(5551234567, { name: 'Phone', type: 'text' }, ['phone']), { value: '(555) 123-4567' });

  // A "Location" column of things that aren't places isn't split.
  const loc = matchColumns([['Location'], ['Warehouse A'], ['Shelf 3']], [{ name: 'City', type: 'text' }, { name: 'State', type: 'text' }], true);
  assert.deepEqual(loc.map((c) => c.field), [null]);

  // Two entries into one field: the first is imported, the other not.
  const rows = [['Full Name', 'Tel'], ['Ann Lee', '555.123.4567']];
  const twice = replan(store, 'Contacts', rows, { headerRow: true, columns: [{ column: 0, field: 'First Name', transforms: ['name-first'] }, { column: 0, field: 'First Name', transforms: ['name-last'] }] });
  assert.deepEqual(twice.preview[0].values, { 'First Name': 'Ann' });
  const done = applyImport(store, 'Contacts', rows, { headerRow: true, columns: [{ column: 0, field: 'Last Name', transforms: ['name-last'] }, { column: 1, field: 'Last Name', transforms: [] }] }, {});
  assert.equal(store.get('Contacts', done.foundSet[0]).fieldData['Last Name'], 'Lee');

  // The assistant answering a column twice with no parts: its first answer, not the column dropped.
  const ai = await planImport(store, 'Contacts', rows, { mapper: async () => ({ columns: [{ column: 1, field: 'Phone', transforms: ['phone'] }, { column: 1, field: 'Name Notes', transforms: [] }] }) });
  assert.deepEqual(ai.columns.filter((c) => c.column === 1).map((c) => [c.field, c.transforms]), [['Phone', ['phone']]], JSON.stringify(ai.columns));
});
