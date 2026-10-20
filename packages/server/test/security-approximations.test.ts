// Who-can-see-what answers must not overstate access that was only approximated when the file was
// imported: get_security (securityOf) lists those sets, as the conversion report does, and the
// conversion report lists every account, [Guest] included, so neither reads more certain than it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host, securityOf } from '../src/index.ts';
import { conversionReport } from '../src/conversion.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('get_security names the imported sets whose access only approximates FileMaker, and how', { skip }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sec-approx-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const host = new Host(dir, () => {});
  t.after(() => host.close());
  const store = host.get('Charts')!;
  const congress = store.schema.tables.find((x) => x.name === 'Congress')!;
  const field = (n: string) => congress.fields.find((f) => f.name === n)!.id;
  // A custom set as the reader imports one: per-table record access, one table the file doesn't have.
  store.schema.privilegeSets.push({
    id: 7, name: 'Mapped', records: { view: false, create: false, edit: false, delete: false }, customRecordAccess: true,
    tableRecords: [{ tableId: congress.id, records: { view: true, create: false, edit: true, delete: false }, fields: [
      { fieldId: field('Name'), access: 0x03, view: true, edit: true },
    ] }, { tableId: 9999, records: { view: true, create: false, edit: false, delete: false } }],
    layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: [],
  } as never);
  // And a plain one, which still has its layout, value-list and script access flattened.
  store.schema.privilegeSets.push({
    id: 8, name: 'Plain', records: { view: true, create: false, edit: false, delete: false },
    layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: [],
  } as never);

  const { importApproximations } = securityOf(store);
  const by = new Map(importApproximations.map((a) => [a.set, a.notes.join(' ')]));
  assert.ok(![...by.keys()].some((n) => n.startsWith('[')), 'the built-in sets lose nothing');
  assert.match(by.get('Plain') ?? '', /one overall setting.*more or less here/);
  assert.doesNotMatch(by.get('Plain') ?? '', /per table/);
  const mapped = by.get('Mapped') ?? '';
  assert.match(mapped, /one overall setting/);
  assert.match(mapped, /limits by a calculation can't be told apart yet, so such a table may come across as fully granted \(more\) or as no access \(less\)/);
  assert.match(mapped, /\d+ fields came across with no access/);
  assert.match(mapped, /1 listed table couldn't be matched/);
  assert.equal(importApproximations.find((a) => a.set === 'Mapped')!.editedSince, undefined);

  // Once the set is changed here, the notes are marked as describing the imported set.
  store.savePrivilegeSet({ ...store.privilegeSets().find((p) => p.name === 'Plain')!, extendedPrivileges: ['fmapp'] });
  assert.equal(securityOf(store).importApproximations.find((a) => a.set === 'Plain')!.editedSince, true);
});

test('the conversion report lists [Guest] with the other accounts, as built in', { skip }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-conv-guest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const host = new Host(dir, () => {});
  t.after(() => host.close());
  const store = host.get('Charts')!;
  const guest = store.accounts().find((a) => a.name === '[Guest]');
  assert.ok(guest, 'Charts has the built-in [Guest] account');
  const listed = conversionReport(store, [store.name]).privileges.assignments.find((a) => a.account === '[Guest]');
  // builtIn: FileMaker's own on/off for it isn't imported, so this doesn't claim guest access is on.
  assert.deepEqual(listed, { account: '[Guest]', privilegeSet: guest!.privilegeSet ?? null, builtIn: true, ...(guest!.inactive ? { inactive: true } : {}) });
});
