import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { changeImpact, crossFileImpact } from '../src/change-impact.ts';
import { resolveTargets } from '../src/insight.ts';

// Renaming or deleting something another hosted file reaches into: the warning
// before it is done. Cross-file references are by id, so a rename follows and a
// delete breaks. A file with AI turned off is counted for an AI client, never
// named.
test('change impact across hosted files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-xfi-'));
  const stores: Store[] = [];
  try {
    const byName = new Map<string, Store>();
    const open = (name: string) => {
      createStore(join(dir, `${name}.sqlite`));
      const s = new Store(join(dir, `${name}.sqlite`), name);
      stores.push(s);
      byName.set(name.toLowerCase(), s);
      s.resolveFile = (n) => byName.get(n.toLowerCase());
      return s;
    };

    // Data holds the tables, a script and a value list.
    const data = open('Data');
    data.applyDesign([
      { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'text' }, { name: 'Name', type: 'text' }] },
      { op: 'createTable', name: 'Orders', fields: [{ name: 'CustId', type: 'text' }] },
      { op: 'createScript', name: 'Recalc', text: 'Beep' },
      { op: 'createValueList', name: 'States', values: ['NY', 'CA'] },
    ]);
    const customers = data.schema.tables.find((t) => t.name === 'Customers')!;
    const orders = data.schema.tables.find((t) => t.name === 'Orders')!;
    const idField = customers.fields.find((f) => f.name === 'Id')!;
    const nameField = customers.fields.find((f) => f.name === 'Name')!;
    const recalc = data.schema.scripts.find((s) => s.name === 'Recalc')!;
    const states = data.schema.valueLists.find((v) => v.name === 'States')!;

    // UI reaches into Data several ways: an occurrence, a relationship match field, a field shown on a
    // layout (through the external occurrence), an external script call and an external value list.
    const ui = open('UI');
    ui.applyDesign([
      { op: 'createDataSource', name: 'Data', paths: ['file:Data'] },
      { op: 'createOccurrence', name: 'Cust_ext', file: 'Data', externalTable: customers.id },
      { op: 'createOccurrence', name: 'Ord_ext', file: 'Data', externalTable: orders.id },
      { op: 'createRelationship', left: 'Cust_ext', right: 'Ord_ext', predicates: [{ left: idField.id, right: orders.fields.find((f) => f.name === 'CustId')!.id }] },
    ]);
    const custExt = ui.schema.tableOccurrences.find((t) => t.name === 'Cust_ext')!;
    // A layout in UI that shows Data's Customers::Name through the external occurrence — not a match field,
    // the case that the earlier match-field-only check missed.
    ui.applyDesign([
      { op: 'createLayout', name: 'CustCard', occurrence: custExt.id, design: { objects: [
        { id: 1, kind: 'field', type: 1, bounds: { top: 10, left: 10, bottom: 32, right: 200 },
          anchors: { left: true, top: true, right: false, bottom: false }, style: {},
          field: { tableOccurrenceId: custExt.id, fieldId: nameField.id, tableOccurrence: 'Cust_ext', field: 'Name', display: 'edit', repetitions: 1 } },
      ] } },
    ]);
    const uiDs = ui.schema.dataSources.find((d) => d.name === 'Data')!.id;
    // An external script call and an external value list — not yet authorable through the
    // writer, so these mirror how an imported file holds them.
    ui.schema.scripts.push({ id: 90, name: 'CallData', steps: [{ stepId: 1, name: 'Perform Script', enabled: true, params: { script: { id: recalc.id, name: 'Recalc', file: { id: uiDs, name: 'Data' } } } }] });
    ui.schema.valueLists.push({ id: 50, name: 'FromData', external: { dataSourceId: uiDs, valueListId: states.id } });

    // Archive uses Data too, but has AI turned off.
    const archive = open('Archive');
    archive.applyDesign([
      { op: 'createDataSource', name: 'Data', paths: ['file:Data'] },
      { op: 'createOccurrence', name: 'Cust_ext', file: 'Data', externalTable: customers.id },
    ]);
    archive.setAiAllowed(false, { account: 'test' });

    const others = [ui, archive];
    const target = (kind: Parameters<typeof resolveTargets>[2], name: string) => resolveTargets(data, name, kind)[0];

    // Deleting the Customers table breaks UI's and Archive's occurrences.
    const delTable = crossFileImpact(data, others, target('table', 'Customers'), 'delete');
    assert.deepEqual(delTable.map((u) => `${u.file}:${u.where}`).sort(), ['Archive:table occurrence "Cust_ext"', 'UI:table occurrence "Cust_ext"']);
    assert.ok(delTable.every((u) => u.breaks));
    // Renaming it: the occurrences follow (by id), nothing breaks.
    assert.ok(crossFileImpact(data, others, target('table', 'Customers'), 'rename').every((u) => !u.breaks));

    // The Id field is a match field in UI's relationship (surfaces as the relationship that uses it).
    assert.ok(crossFileImpact(data, others, target('field', 'Customers::Id'), 'delete').some((u) => u.file === 'UI' && /relationship/i.test(u.where)));
    // The Name field is shown on UI's CustCard layout, through the external occurrence — not a match field.
    // This is the case the match-field-only check missed; it must be reported now.
    const delName = crossFileImpact(data, others, target('field', 'Customers::Name'), 'delete');
    assert.ok(delName.some((u) => u.file === 'UI' && /CustCard/.test(u.where)), 'a cross-file field shown on a layout is reported');
    assert.ok(delName.every((u) => u.breaks));
    // Renaming it: the layout follows the field by id, nothing breaks.
    assert.ok(crossFileImpact(data, others, target('field', 'Customers::Name'), 'rename').every((u) => !u.breaks));
    // The script and value list are reached from UI.
    assert.ok(crossFileImpact(data, [ui], target('script', 'Recalc'), 'delete').some((u) => u.file === 'UI' && u.where.includes('performs it')));
    assert.ok(crossFileImpact(data, [ui], target('valueList', 'States'), 'delete').some((u) => u.file === 'UI' && u.where.includes('"FromData"')));

    // changeImpact: UI is named; Archive (AI off) is only counted, with a summary line.
    const impact = await changeImpact(data, undefined, 'table', 'Customers', 'delete', { others: [ui], hiddenOthers: [archive] });
    assert.deepEqual(impact.crossFile.map((c) => c.file), ['UI']);
    assert.equal(impact.crossFileHidden, 1);
    assert.ok(impact.summary.some((l) => l.includes('UI') && l.includes('break')));
    assert.ok(impact.summary.some((l) => l.includes('AI turned off')));
    assert.ok(!JSON.stringify(impact.crossFile).includes('Archive'), 'the AI-off file is not named');
  } finally {
    for (const s of stores) s.close();
    rmSync(dir, { recursive: true });
  }
});
