import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '@tabularius/fmp12';
import { importFmp12, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

// InterMediator_TestDB: person_layout has portals "Contact" (contact_to) and
// "History" (history_to), related by person id.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'InterMediator_TestDB.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let store: Store;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  importFmp12(fixture, join(dir, 'TestDB.sqlite'));
  store = new Store(join(dir, 'TestDB.sqlite'));
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const step = (stepId: number, name: string, params?: StepParams): ScriptStep => ({ stepId, name, enabled: true, params });
const script = (...steps: ScriptStep[]): Script => ({ id: 9999, name: 'test', steps } as Script);
const setVar = (variable: string, value: string) => step(141, 'Set Variable', { variable, value });
const goToObject = (name: string) => step(145, 'Go to Object', { objectName: `"${name}"` });
const portalRow = (location: StepParams['location'], extra: StepParams = {}) => step(99, 'Go to Portal Row', { location, ...extra });
const contacts = (person: number) => Number(store.query(`SELECT count(*) AS n FROM contact WHERE person_id = ${person}`)[0].n);

test('portal rows: Go to Object, Go to Portal Row, related fields and Delete Portal Row', { skip }, async () => {
  const before = contacts(1);
  const r = await runScript(store, script(
    goToObject('Contact'),
    portalRow('last'),
    setVar('$row', 'Get ( PortalRowNumber )'),
    setVar('$desc', 'contact_to::summary'),
    setVar('$object', 'Get ( ActiveLayoutObjectName )'),
    portalRow('first'),
    setVar('$first', 'Get ( PortalRowNumber )'),
    step(104, 'Delete Portal Row'),
    step(86, 'Set Error Capture', { on: true }),
    goToObject('No such object'),
    step(103, 'Exit Script', { calculation: 'List ( $row ; $desc ; $object ; $first ; Get ( LastError ) )' }),
  ), { layout: 'person_layout' });
  // The relationship allows creating contacts, so Last is the portal's empty row after them (List leaves out its empty summary).
  assert.deepEqual(r.result.split('\r'), [String(before + 1), 'Contact', '1', '116']);
  assert.equal(contacts(1), before - 1);
});

test('Go to Portal Row [Last] then Set Field adds a related record, as FileMaker\'s empty last row does', { skip }, async () => {
  const before = contacts(2);
  const field = (name: string) => ({ tableOccurrence: { id: 0, name: 'contact_to' }, field: { id: 0, name } });
  const r = await runScript(store, script(
    goToObject('Contact'),
    portalRow('last'),
    step(76, 'Set Field', { field: field('summary'), calculation: '"Added from a script"' }),
    step(75, 'Commit Records/Requests', {}),
    goToObject('Contact'),
    portalRow('last'),
    setVar('$row', 'Get ( PortalRowNumber )'),
    step(103, 'Exit Script', { calculation: '$row & "/" & Get ( LastError )' }),
  ), { layout: 'person_layout', foundSet: [2] });
  assert.equal(contacts(2), before + 1);
  assert.equal(store.query(`SELECT count(*) AS n FROM contact WHERE person_id = 2 AND summary = 'Added from a script'`)[0].n, 1);
  // The empty row is now after the new contact.
  assert.equal(r.result, `${before + 2}/0`);
});

test('Go to Portal Row [Next; Exit after last] walks every row in a loop', { skip }, async () => {
  const r = await runScript(store, script(
    goToObject('History'),
    goToObject('Contact'),
    portalRow('first'),
    step(71, 'Loop'),
    setVar('$seen', 'List ( $seen ; Get ( PortalRowNumber ) )'),
    portalRow('next', { exitAfterLast: true }),
    step(73, 'End Loop'),
    step(103, 'Exit Script', { calculation: '$seen' }),
  ), { layout: 'person_layout' });
  const n = contacts(Number(store.query(`SELECT id FROM person ORDER BY _fm_record_id LIMIT 1`)[0].id));
  assert.equal(r.result, Array.from({ length: n }, (_, i) => i + 1).join('\r'));
});

test('Set Field through a relationship that allows creation adds the related record', { skip }, async () => {
  const before = Number(store.query(`SELECT count(*) AS n FROM contact`)[0].n);
  const summary = { tableOccurrence: { id: 0, name: 'contact_to' }, field: { id: 0, name: 'summary' } };
  const r = await runScript(store, script(
    step(7, 'New Record/Request'),
    step(76, 'Set Field', { field: summary, calculation: '"First call"' }),
    step(75, 'Commit Records/Requests'),
    step(103, 'Exit Script', { calculation: 'person_to::id & "/" & Count ( contact_to::id ) & "/" & contact_to::summary' }),
  ), { layout: 'person_layout' });
  const id = r.result.split('/')[0];
  assert.equal(r.result, `${id}/1/First call`);
  assert.equal(Number(store.query(`SELECT count(*) AS n FROM contact`)[0].n), before + 1);
  assert.equal(store.query(`SELECT summary FROM contact WHERE person_id = ${Number(id)}`)[0].summary, 'First call');
});

test('finds on related fields match records with any matching related record', { skip }, async () => {
  const summary = { tableOccurrence: { id: 0, name: 'contact_to' }, field: { id: 0, name: 'summary' } };
  const name = { tableOccurrence: { id: 0, name: 'person_to' }, field: { id: 0, name: 'name' } };
  const want = store.query(`SELECT DISTINCT person_id AS id FROM contact WHERE summary LIKE 'Meeting%' ORDER BY person_id`).map((r) => String(r.id));
  assert.ok(want.length > 0);
  const r = await runScript(store, script(
    step(22, 'Enter Find Mode'),
    step(76, 'Set Field', { field: summary, calculation: '"Meeting"' }),
    step(28, 'Perform Find'),
    step(16, 'Go to Record/Request/Page', { location: 'first' }),
    step(71, 'Loop'),
    setVar('$ids', 'List ( $ids ; person_to::id )'),
    step(16, 'Go to Record/Request/Page', { location: 'next', exitAfterLast: true }),
    step(73, 'End Loop'),
    // A related criterion and one on the layout's own table, in one request.
    step(22, 'Enter Find Mode'),
    step(76, 'Set Field', { field: summary, calculation: '"Meeting"' }),
    step(76, 'Set Field', { field: name, calculation: '"No such name"' }),
    step(86, 'Set Error Capture', { on: true }),
    step(28, 'Perform Find'),
    step(103, 'Exit Script', { calculation: '$ids & "/" & Get ( LastError )' }),
  ), { layout: 'person_layout' });
  assert.equal(r.result, `${want.join('\r')}/401`);
});

test('Sort Records on a related field sorts by the first related record', { skip }, async () => {
  const summary = { tableOccurrence: { id: 0, name: 'contact_to' }, field: { id: 0, name: 'summary' } };
  // Each person's first contact (lowest record id), empty for people with none; empty sorts first.
  const rows = store.query(`SELECT p.id AS id, (SELECT c.summary FROM contact c WHERE c.person_id = p.id ORDER BY c._fm_record_id LIMIT 1) AS s FROM person p`);
  const want = rows.sort((a, b) => String(b.s ?? '').localeCompare(String(a.s ?? ''), undefined, { sensitivity: 'base' }) || Number(a.id) - Number(b.id)).map((r) => String(r.id));
  const r = await runScript(store, script(
    step(39, 'Sort Records', { sort: [{ field: summary, order: 'descending' }], noDialog: true }),
    step(16, 'Go to Record/Request/Page', { location: 'first' }),
    step(71, 'Loop'),
    setVar('$ids', 'List ( $ids ; person_to::id )'),
    step(16, 'Go to Record/Request/Page', { location: 'next', exitAfterLast: true }),
    step(73, 'End Loop'),
    step(103, 'Exit Script', { calculation: '$ids' }),
  ), { layout: 'person_layout' });
  assert.equal(r.result, want.join('\r'));
});

test("a field's trigger in a portal row starts on that row, as the client says", { skip }, async () => {
  // The summary field in the Contact portal; the person's last contact, so not the portal's first row.
  const field = store.design('person_layout')!.objects.find((o) => o.kind === 'portal' && o.portal?.tableOccurrence === 'contact_to')!
    .children!.find((o) => o.field?.field === 'summary')!;
  const rows = store.query('SELECT _fm_record_id AS r, id FROM contact WHERE person_id = 1 ORDER BY _fm_record_id');
  assert.ok(rows.length > 1);
  const last = rows.at(-1)!;
  const r = await runScript(store, script(
    step(103, 'Exit Script', { calculation: 'Get ( PortalRowNumber ) & "/" & contact_to::id & "/" & Get ( ActiveFieldName )' }),
  ), { layout: 'person_layout', foundSet: [1], activeObject: field.id, activeRow: Number(last.r) });
  const [row, id, active] = r.result.split('/');
  assert.equal(id, String(last.id));
  assert.ok(Number(row) > 1, r.result);
  assert.equal(active, 'summary');
});
