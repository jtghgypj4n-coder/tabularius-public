import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintLayout as lintAll, type PrivilegeDefinition } from '../src/index.ts';
import type { LayoutDesign, LayoutObject, Schema } from '../../fmp12/src/index.ts';

const schema = {
  tables: [
    { id: 1, name: 'Customers', fields: [{ id: 1, name: 'Name' }, { id: 2, name: 'Salary' }, { id: 3, name: 'gToday', options: { global: true } }] },
    { id: 2, name: 'Orders', fields: [{ id: 1, name: 'Total' }] },
  ],
  tableOccurrences: [{ id: 1, name: 'Customers', baseTableId: 1 }, { id: 2, name: 'Orders', baseTableId: 2 }, { id: 3, name: 'Lonely', baseTableId: 1 }],
  relationships: [{ id: 1, leftTableOccurrenceId: 1, rightTableOccurrenceId: 2, predicates: [], sorted: false }],
} as unknown as Schema;

// The layout rules; the accessibility ones have their own tests below.
const lintLayout: typeof lintAll = (...args) => lintAll(...args).filter((i) => i.rule !== 'unlabeled' && i.rule !== 'small-target');
const lintA11y = lintAll;

let next = 1;
function obj(kind: string, b: [number, number, number, number], more: Partial<LayoutObject> = {}): LayoutObject {
  return { id: next++, kind, type: 0, bounds: { left: b[0], top: b[1], right: b[2], bottom: b[3] }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, ...more } as LayoutObject;
}
const f = (to: number, field: number, b: [number, number, number, number], more: Partial<LayoutObject> = {}) =>
  obj('field', b, { field: { tableOccurrenceId: to, fieldId: field, display: 'edit', repetitions: 1 } as LayoutObject['field'], ...more });

function layout(objects: LayoutObject[], more: Partial<LayoutDesign> = {}): LayoutDesign {
  return { id: 1, name: 'Card', tableOccurrenceId: 1, width: 400, style: {}, parts: [{ kind: 'body', kindId: 2, top: 0, height: 300, style: {} }], objects, ...more } as LayoutDesign;
}

test('a clean layout has no issues', () => {
  const d = layout([f(1, 1, [10, 10, 200, 30]), f(2, 1, [10, 40, 200, 60]), obj('button', [10, 70, 100, 90], { action: { stepId: 1, step: 'Perform Script' } })]);
  assert.deepEqual(lintLayout(d, schema), []);
});

test('missing and unrelated fields', () => {
  const gone = f(1, 99, [10, 10, 200, 30]);
  const noTo = f(42, 1, [10, 40, 200, 60]);
  const unrelated = f(3, 1, [10, 70, 200, 90]);
  const global = f(3, 3, [10, 100, 200, 120]);
  const issues = lintLayout(layout([gone, noTo, unrelated, global]), schema);
  assert.deepEqual(issues.map((i) => [i.rule, i.severity, i.objectIds]), [
    ['missing-field', 'error', [gone.id]], ['missing-field', 'error', [noTo.id]], ['unrelated', 'warning', [unrelated.id]],
  ]);
  assert.match(issues[2].message, /Lonely isn't related to Customers/);
});

test('objects outside the layout, overlapping, and buttons with no action', () => {
  const off = f(1, 1, [500, 10, 600, 30]);
  const partly = f(1, 1, [300, 280, 450, 320]);
  const a = obj('button', [10, 10, 110, 40], { action: { stepId: 1, step: 'Perform Script' } });
  const b = obj('button', [20, 15, 120, 45]);
  const touching = obj('button', [110, 10, 200, 40], { action: { stepId: 1, step: 'Perform Script' } });
  const issues = lintLayout(layout([off, partly, a, b, touching]), schema);
  const by = (rule: string) => issues.filter((i) => i.rule === rule);
  assert.deepEqual(by('outside').map((i) => [i.severity, i.objectIds]), [['warning', [off.id]], ['info', [partly.id]]]);
  assert.deepEqual(by('overlap').map((i) => i.objectIds), [[b.id, a.id]]);
  assert.deepEqual(by('no-action').map((i) => i.objectIds), [[b.id]]);
});

test('tab panels share their space; popovers are left alone', () => {
  const p1 = obj('tab-panel', [0, 0, 300, 200], { children: [f(1, 1, [10, 10, 200, 30])] });
  const p2 = obj('tab-panel', [0, 0, 300, 200], { children: [f(1, 2, [10, 10, 200, 30])] });
  const tabs = obj('tab-control', [0, 0, 300, 200], { children: [p1, p2] });
  const pop = obj('popover', [600, 0, 800, 100], { children: [f(1, 1, [610, 10, 790, 30])] });
  assert.deepEqual(lintLayout(layout([tabs, pop]), schema), []);
});

test('tab order and privilege sets', () => {
  const name = f(1, 1, [10, 10, 200, 30]);
  const salary = f(1, 2, [10, 40, 200, 60]);
  const viewOnly = f(1, 1, [10, 70, 200, 90], { field: { ...name.field!, behavior: { browse: 'view' } } });
  const sets: PrivilegeDefinition[] = [
    { name: '[Full Access]', id: 1, records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: [] },
    { name: 'Staff', records: { view: true, edit: true, create: true, delete: true }, tables: { Customers: { view: true, edit: true, create: true, delete: false, fields: { Salary: 'none' } } }, layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: [] },
    { name: 'Guests', records: { view: true, edit: false, create: false, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [] },
  ];
  const issues = lintLayout(layout([name, salary, viewOnly], { tabOrder: [name.id, 999] }), schema, sets);
  assert.deepEqual(issues.map((i) => [i.rule, i.objectIds]), [['tab-order', [salary.id]], ['tab-order', []], ['no-access', [salary.id]]]);
  assert.match(issues[2].message, /the Staff privilege set see <No Access> in Customers::Salary/);
});

test('accessibility: fields and buttons with nothing saying what they are', () => {
  const label = obj('text', [10, 10, 60, 30], { text: 'Name' });
  const named = f(1, 1, [70, 10, 200, 30]);
  const heading = obj('text', [10, 50, 200, 66], { text: 'Salary' });
  const below = f(1, 2, [10, 70, 200, 90]);
  const bare = f(1, 1, [10, 200, 200, 220]);
  const hint = f(1, 1, [210, 200, 390, 220], { placeholder: '"Search"' });
  const viewOnly = f(1, 1, [10, 240, 200, 260], { field: { tableOccurrenceId: 1, fieldId: 1, display: 'edit', repetitions: 1, behavior: { browse: 'view' } } as LayoutObject['field'] });
  const icon = obj('button', [300, 10, 320, 30], { action: { stepId: 1, step: 'Perform Script' }, icon: { imageId: 1, size: 16, display: 'icon' } });
  const tip = obj('button', [330, 10, 350, 30], { action: { stepId: 1, step: 'Perform Script' }, tooltip: '"Delete"' });
  const issues = lintA11y(layout([label, named, heading, below, bare, hint, viewOnly, icon, tip]), schema).filter((i) => i.rule === 'unlabeled');
  assert.deepEqual(issues.map((i) => i.objectIds), [[bare.id], [icon.id]]);
  assert.match(issues[1].message, /icon-only button/);
});

test('a list layout\'s column headings in the header label the fields in the body', () => {
  const parts = [{ kind: 'header', kindId: 1, top: 0, height: 60, style: {} }, { kind: 'body', kindId: 2, top: 60, height: 30, style: {} }];
  const d = layout([obj('text', [10, 30, 120, 50], { text: 'Name' }), f(1, 1, [10, 65, 120, 85])], { parts } as Partial<LayoutDesign>);
  assert.deepEqual(lintA11y(d, schema).filter((i) => i.rule === 'unlabeled'), []);
});

test('accessibility: small targets only on phone layouts', () => {
  const tiny = obj('button', [10, 10, 30, 26], { text: 'x', action: { stepId: 1, step: 'Perform Script' } });
  const ok = obj('button', [10, 40, 100, 84], { text: 'Save', action: { stepId: 1, step: 'Perform Script' } });
  assert.deepEqual(lintA11y(layout([tiny, ok], { width: 1000 }), schema).filter((i) => i.rule === 'small-target'), []);
  const phone = lintA11y(layout([tiny, ok], { width: 390 }), schema).filter((i) => i.rule === 'small-target');
  assert.deepEqual(phone.map((i) => i.objectIds), [[tiny.id]]);
  assert.match(phone[0].message, /20 × 16 pt/);
});
