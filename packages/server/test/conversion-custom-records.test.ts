// The conversion report names what came across from a custom-record-access set, and what was
// imported with no access, so nothing is silently lost or silently widened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/index.ts';
import { conversionReport } from '../src/conversion.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('the report lists hidden and unverified fields of a custom per-table set', { skip }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-conv-custom-'));
  t.after(() => rmSync(dir, { recursive: true }));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const host = new Host(dir, () => {});
  t.after(() => host.close());
  const store = host.get('Charts')!;
  const congress = store.schema.tables.find((x) => x.name === 'Congress')!;
  const field = (n: string) => congress.fields.find((f) => f.name === n)!.id;
  store.schema.privilegeSets.push({
    id: 7, name: 'Mapped', records: { view: false, create: false, edit: false, delete: false }, customRecordAccess: true,
    tableRecords: [{ tableId: congress.id, records: { view: true, create: false, edit: true, delete: false }, fields: [
      { fieldId: field('Name'), access: 0x03, view: true, edit: true },
      { fieldId: field('Party'), access: 0x01, view: true, edit: false },
    ] }, { tableId: 9999, records: { view: true, create: false, edit: false, delete: false } }],
    layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [],
  } as never);
  const report = conversionReport(store, [store.name]);
  const c = report.privileges.customRecords.find((x) => x.set === 'Mapped')!;
  assert.equal(c.tables, 1);
  assert.ok(c.unverifiedFields.includes('Congress::Party'));
  assert.ok(c.hiddenFields.includes('Congress::ACLU'), 'a field the set does not list is named as hidden');
  assert.ok(!c.hiddenFields.includes('Congress::Name'));
  assert.equal(c.unresolvedTables, 1);
  assert.match(report.summary, /Mapped: per-table record access imported/);
  assert.match(report.summary, /Treat as read-only \(unverified mapping\)/);
  assert.match(report.summary, /couldn't be matched/);
  // The built-in sets are not custom.
  assert.ok(!report.privileges.customRecords.some((x) => x.set.startsWith('[')));
});
