import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, placeComponent, portableObjects, Store } from '../src/index.ts';
import type { LayoutComponent, LayoutObject } from '../../fmp12/src/index.ts';

function withStore(fn: (store: Store) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  createStore(join(dir, 'f.sqlite'));
  const store = new Store(join(dir, 'f.sqlite'), 'Lib');
  try {
    fn(store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const base = { anchors: { left: true, top: true, right: false, bottom: false }, style: {} } as const;

test('a component travels with names as the file has them now, and a step\'s script line', () => withStore((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'Things', fields: [{ name: 'Status' }] },
    { op: 'createValueList', name: 'Status', values: ['Open', 'Closed'] },
  ] as never);
  const s = store.schema;
  const to = s.tableOccurrences.find((t) => t.name === 'Things')!;
  const f = s.tables.find((t) => t.name === 'Things')!.fields.find((x) => x.name === 'Status')!;
  const list = s.valueLists.find((v) => v.name === 'Status')!;
  // The field remembers the list as "Status"; the list has since been renamed and a new "Status" made.
  store.applyDesign([{ op: 'updateValueList', valueList: list.id, name: 'States' }, { op: 'createValueList', name: 'Status', values: ['x'] }] as never);
  const objects = [
    { ...base, id: 1, kind: 'field', type: 0, bounds: { top: 0, left: 0, bottom: 20, right: 100 },
      field: { tableOccurrenceId: to.id, fieldId: f.id, display: 'popup', repetitions: 1, valueListId: list.id, valueList: 'Status' } },
    { ...base, id: 2, kind: 'button', type: 10, bounds: { top: 0, left: 110, bottom: 20, right: 180 }, text: 'Next',
      action: { stepId: 16, step: 'Go to Record/Request/Page', params: { which: 'next' } } },
  ] as unknown as LayoutObject[];
  const out = portableObjects(objects, store.schema, (id) => store.calc.occurrenceTable(id)?.table.fields);
  assert.equal(out[0].field!.valueList, 'States');
  assert.equal(out[0].field!.field, 'Status');
  assert.match(out[1].action!.line!, /^Go to Record\/Request\/Page/);
}));

test('a placed copy keeps a tab control pointing at its own first panel', () => {
  const panel = (id: number): LayoutObject => ({ ...base, id, kind: 'tab-panel', type: 0, bounds: { top: 0, left: 0, bottom: 50, right: 100 }, text: `T${id}` } as unknown as LayoutObject);
  const component: LayoutComponent = { id: 1, name: 'Tabs', width: 100, height: 50, objects: [
    { ...base, id: 10, kind: 'tab-control', type: 0, bounds: { top: 0, left: 0, bottom: 50, right: 100 }, target: 12, children: [panel(11), panel(12)] } as unknown as LayoutObject,
  ] };
  const copy = placeComponent(component, { top: 100, left: 0 }, new Set([1, 2, 3, 10, 11, 12]));
  const control = copy.children![0];
  assert.equal(control.target, control.children![1].id);
  assert.notEqual(control.target, 12);
});
