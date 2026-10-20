import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixLayout, lintLayout } from '../src/index.ts';
import type { LayoutDesign, LayoutObject, Schema } from '../../fmp12/src/index.ts';

const schema = {
  tables: [{ id: 1, name: 'Customers', fields: [{ id: 1, name: 'Name' }, { id: 2, name: 'City' }, { id: 3, name: 'Phone' }] }],
  tableOccurrences: [{ id: 1, name: 'Customers', baseTableId: 1 }],
  relationships: [],
} as unknown as Schema;

let next = 1;
function obj(kind: string, b: [number, number, number, number], more: Partial<LayoutObject> = {}): LayoutObject {
  return { id: next++, kind, type: 0, bounds: { left: b[0], top: b[1], right: b[2], bottom: b[3] }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, ...more } as LayoutObject;
}
const f = (field: number, b: [number, number, number, number]) =>
  obj('field', b, { field: { tableOccurrenceId: 1, fieldId: field, display: 'edit', repetitions: 1 } as LayoutObject['field'] });
const go = { stepId: 1, step: 'Perform Script' } as LayoutObject['action'];
function layout(objects: LayoutObject[], more: Partial<LayoutDesign> = {}): LayoutDesign {
  return { id: 1, name: 'Card', tableOccurrenceId: 1, width: 400, style: {}, parts: [{ kind: 'body', kindId: 2, top: 0, height: 300, style: {} }], objects, ...more } as LayoutDesign;
}

test('nearly lined-up labels are flagged and lined up on the edge most of them share', () => {
  const a = obj('text', [10, 10, 80, 30], { text: 'Name' });
  const b = obj('text', [11, 40, 81, 60], { text: 'City' });
  const c = obj('text', [10, 70, 80, 90], { text: 'Phone' });
  const far = obj('text', [20, 100, 80, 120], { text: 'Notes' });
  const d = layout([a, b, c, far]);
  const issues = lintLayout(d, schema);
  assert.deepEqual(issues.map((i) => [i.rule, i.objectIds, i.fixable]), [['misaligned', [a.id, c.id, b.id], true]]);
  const { design, fixed } = fixLayout(d, schema);
  assert.equal(fixed.length, 1);
  assert.deepEqual(design.objects.map((o) => o.bounds.left), [10, 10, 10, 20]);
  assert.equal(design.objects[1].bounds.right, 80, 'the whole object moves, keeping its width');
  assert.equal(d.objects[1].bounds.left, 11, 'the design passed in is unchanged');
  assert.deepEqual(lintLayout(design, schema), []);
});

test('side-by-side objects with nearly equal left edges are not a column', () => {
  assert.deepEqual(lintLayout(layout([obj('text', [10, 10, 80, 30]), obj('text', [12, 10, 80, 30])]), schema).filter((i) => i.rule === 'misaligned'), []);
});

test('an object on top of another moves below it, past anything else it would land on', () => {
  const a = obj('button', [10, 10, 110, 40], { action: go });
  const b = obj('button', [20, 15, 120, 45], { action: go });
  const c = obj('button', [10, 44, 110, 70], { action: go });
  const { design, fixed } = fixLayout(layout([a, b, c]), schema);
  assert.deepEqual(fixed.map((i) => i.rule), ['overlap']);
  assert.deepEqual(design.objects[1].bounds, { left: 20, right: 120, top: 74, bottom: 104 });
  assert.deepEqual(lintLayout(design, schema).filter((i) => i.rule === 'overlap'), []);
});

test('objects partly off the layout move inside; wholly outside ones are left for a person', () => {
  const partly = f(1, [300, 100, 450, 120]);
  const group = obj('group', [-20, 10, 60, 50], { children: [f(2, [-20, 10, 60, 30])] });
  const off = f(3, [500, 10, 600, 30]);
  const d = layout([partly, group, off]);
  assert.deepEqual(lintLayout(d, schema).filter((i) => i.rule === 'outside').map((i) => [i.objectIds[0], i.fixable ?? false]), [[off.id, false], [partly.id, true], [group.id, true]]);
  // (A 400-wide layout counts as a phone layout, so Fix all would also make its fields taller to tap.)
  const { design } = fixLayout(d, schema, [], lintLayout(d, schema).filter((i) => i.rule === 'outside'));
  assert.deepEqual(design.objects[0].bounds, { left: 250, right: 400, top: 100, bottom: 120 });
  assert.equal(design.objects[1].bounds.left, 0);
  assert.equal(design.objects[1].children![0].bounds.left, 0, 'what is inside moves with it');
  assert.equal(design.objects[2].bounds.left, 500);
});

test('the tab order gains skipped fields in reading order and loses objects that are gone', () => {
  const name = f(1, [10, 10, 200, 30]);
  const city = f(2, [10, 40, 200, 60]);
  const phone = f(3, [10, 70, 200, 90]);
  const d = layout([name, city, phone], { tabOrder: [name.id, 999, phone.id], width: 600 });
  const { design, fixed } = fixLayout(d, schema);
  assert.equal(fixed.length, 2);
  assert.deepEqual(design.tabOrder, [name.id, city.id, phone.id]);
});

test('only: just the findings asked for', () => {
  const a = obj('button', [10, 10, 110, 40], { action: go });
  const b = obj('button', [20, 15, 120, 45], { action: go });
  const partly = f(1, [300, 100, 450, 120]);
  const { design, fixed } = fixLayout(layout([a, b, partly]), schema, [], [{ rule: 'outside', objectIds: [partly.id] }]);
  assert.deepEqual(fixed.map((i) => i.rule), ['outside']);
  assert.equal(design.objects[1].bounds.top, 15);
});

test('a right-aligned column of labels is lined up on purpose', () => {
  const issues = lintLayout(layout([obj('text', [10, 10, 80, 30]), obj('text', [11, 40, 80, 60]), obj('text', [12, 70, 80, 90])]), schema);
  assert.deepEqual(issues.filter((i) => i.rule === 'misaligned'), []);
});

const named = (id: number, name: string, b: [number, number, number, number]) =>
  obj('field', b, { field: { tableOccurrenceId: 1, tableOccurrence: 'Customers', fieldId: id, field: name, display: 'edit', repetitions: 1 } as LayoutObject['field'] });

test('a field with no label gets one with its name, styled as the layout\'s labels, beside it or above it', () => {
  const label = obj('text', [10, 10, 100, 30], { text: 'Name', style: { element: 70, rules: [{ part: 1, state: 1, css: { color: '#334155' } }] } as LayoutObject['style'] });
  const name = named(1, 'Name', [110, 10, 300, 30]);
  const city = named(2, 'City', [110, 50, 300, 70]);
  const phone = named(3, 'Phone', [10, 100, 200, 120]);
  const d = layout([label, name, city, phone], { width: 600 });
  const issues = lintLayout(d, schema).filter((i) => i.rule === 'unlabeled');
  assert.deepEqual(issues.map((i) => [i.objectIds[0], i.fixable]), [[city.id, true], [phone.id, true]]);
  const { design, fixed } = fixLayout(d, schema);
  assert.equal(fixed.filter((i) => i.rule === 'unlabeled').length, 2);
  const added = design.objects.filter((o) => o.kind === 'text' && o.id > phone.id);
  const cityLabel = added.find((o) => o.text === 'City')!;
  assert.ok(cityLabel.bounds.right <= city.bounds.left && cityLabel.bounds.top >= city.bounds.top - 1, 'to the left of City');
  assert.deepEqual([cityLabel.bounds.left, cityLabel.bounds.right], [10, 100], 'in line with the Name label above it');
  assert.deepEqual(cityLabel.style, label.style, 'styled as the layout\'s labels');
  const phoneLabel = added.find((o) => o.text === 'Phone')!;
  assert.ok(phoneLabel.bounds.bottom <= phone.bounds.top, 'no room on the left: above Phone');
  assert.deepEqual(lintLayout(design, schema).filter((i) => i.rule === 'unlabeled'), []);
  assert.equal(new Set(design.objects.map((o) => o.id)).size, design.objects.length, 'ids stay unique');
});

test('an icon-only button gets a tooltip naming its script; one that only says Perform Script is left for a person', () => {
  const named = obj('button', [10, 10, 60, 40], { action: { stepId: 1, step: 'Perform Script', scriptId: 4, script: 'New "Invoice"' } as LayoutObject['action'] });
  const bare = obj('button', [100, 10, 150, 40], { action: go });
  const d = layout([named, bare], { width: 600 });
  assert.deepEqual(lintLayout(d, schema).filter((i) => i.rule === 'unlabeled').map((i) => i.fixable ?? false), [true, false]);
  const { design } = fixLayout(d, schema);
  assert.equal(design.objects[0].tooltip, '"New \\"Invoice\\""', 'a calculation: the script name as quoted text');
  assert.equal(design.objects[1].tooltip, undefined);
});

test('on a phone layout, fields and buttons too small to tap grow, then move off what they grew onto', () => {
  const a = obj('button', [10, 10, 30, 30], { action: { stepId: 6, step: 'Go to Record/Request/Page' } as LayoutObject['action'] });
  const b = obj('button', [10, 50, 100, 70], { action: { stepId: 6, step: 'Go to Record/Request/Page' } as LayoutObject['action'] });
  const d = layout([a, b], { width: 390 });
  assert.ok(lintLayout(d, schema).some((i) => i.rule === 'small-target' && i.fixable));
  const { design } = fixLayout(d, schema);
  assert.deepEqual(design.objects[0].bounds, { left: 10, top: 10, right: 54, bottom: 54 });
  assert.equal(design.objects[1].bounds.bottom - design.objects[1].bounds.top, 44);
  assert.deepEqual(lintLayout(design, schema).filter((i) => i.rule === 'small-target' || i.rule === 'overlap'), []);
});

test('a portal sorted on a field with indexing off gets automatic indexing back; an unstored sort is left for a person', () => {
  const s2 = structuredClone(schema) as Schema;
  s2.tables[0].fields.push({ id: 4, name: 'Rank', type: 'number', kind: 'normal', options: { noAutoIndex: true } } as never, { id: 5, name: 'Score', type: 'number', kind: 'calculation', options: { unstored: true } } as never);
  const portal = (field: number) => obj('portal', [10, 10, 300, 200], { portal: { tableOccurrenceId: 1, rows: 5, initialRow: 1, sort: [{ field: { tableOccurrenceId: 1, fieldId: field } }] } as LayoutObject['portal'] });
  const slow = portal(4);
  const unstored = portal(5);
  unstored.bounds = { left: 10, top: 210, right: 300, bottom: 290 };
  const d = layout([slow, unstored], { width: 600 });
  const issues = lintLayout(d, s2).filter((i) => i.rule === 'slow-sort');
  assert.deepEqual(issues.map((i) => [i.objectIds[0], i.fixable ?? false]), [[slow.id, true], [unstored.id, false]]);
  assert.match(issues[1].message, /an unstored calculation, which can't be indexed/);
  const { fixed, changes } = fixLayout(d, s2);
  assert.deepEqual(fixed.map((i) => i.rule), ['slow-sort']);
  assert.deepEqual(changes, [{ op: 'updateField', table: 1, field: 4, options: { noAutoIndex: null } }]);
});

test('a label goes only where it covers nothing; with no room, the field is left for a person', () => {
  const left = obj('rectangle', [10, 50, 100, 70]);
  const over = obj('rectangle', [110, 28, 300, 48]);
  const crowded = named(2, 'City', [110, 50, 300, 70]);
  const d = layout([left, over, crowded], { width: 600 });
  assert.ok(lintLayout(d, schema).some((i) => i.rule === 'unlabeled' && i.objectIds[0] === crowded.id));
  const { fixed } = fixLayout(d, schema, [], [{ rule: 'unlabeled', objectIds: [crowded.id] }]);
  assert.deepEqual(fixed, []);
});

test('objects inside a group, button bar or portal aren\'t grown or labelled: their container decides their size', () => {
  const inGroup = obj('button', [10, 10, 30, 30], { action: { stepId: 6, step: 'Go to Record/Request/Page' } as LayoutObject['action'] });
  const group = obj('group', [10, 10, 30, 30], { children: [inGroup] });
  const segment = obj('button', [100, 10, 120, 30], { action: { stepId: 6, step: 'Go to Record/Request/Page' } as LayoutObject['action'] });
  const bar = obj('button-bar', [100, 10, 140, 30], { children: [segment] });
  const field = named(2, 'City', [200, 10, 300, 30]);
  const fieldGroup = obj('group', [200, 10, 300, 30], { children: [field] });
  const d = layout([group, bar, fieldGroup], { width: 390 });
  const issues = lintLayout(d, schema).filter((i) => i.rule === 'small-target' || i.rule === 'unlabeled');
  assert.ok(issues.some((i) => i.objectIds[0] === segment.id), 'still reported');
  assert.ok(issues.every((i) => !i.fixable), 'but left for a person');
  const { fixed, design } = fixLayout(d, schema);
  assert.deepEqual(fixed, []);
  assert.deepEqual(design, d);
});

test('a label doesn\'t land on objects elsewhere on the layout, in another part, or outside the panel holding the field', () => {
  // Something on a tab panel sits where the label would go beside a top-level field.
  const onPanel = obj('rectangle', [10, 50, 100, 70]);
  const panel = obj('tab-panel', [0, 40, 105, 100], { children: [onPanel] });
  const city = named(2, 'City', [110, 50, 300, 70]);
  // A field at the top of the body, with the header above it.
  const phone = named(3, 'Phone', [10, 62, 60, 80]);
  const parts = [{ kind: 'header', kindId: 1, top: 0, height: 60, style: {} }, { kind: 'body', kindId: 2, top: 60, height: 240, style: {} }] as LayoutDesign['parts'];
  let d = layout([panel, city], { width: 600 });
  assert.deepEqual(fixLayout(d, schema, [], [{ rule: 'unlabeled', objectIds: [city.id] }]).design.objects.filter((o) => o.kind === 'text' && !inside(o, 0, 40, 105, 100)).length, 1, 'goes above instead');
  d = layout([phone], { width: 600, parts });
  assert.deepEqual(fixLayout(d, schema).fixed.filter((i) => i.rule === 'unlabeled'), [], 'no room beside, and above is the header');
  // A field on a tab panel: its label stays on the panel.
  const name = named(1, 'Name', [180, 140, 290, 160]);
  const tab = obj('tab-panel', [60, 100, 300, 200], { children: [name] });
  d = layout([tab], { width: 600 });
  const fixedTab = fixLayout(d, schema);
  const added = fixedTab.design.objects[0].children!.find((o) => o.kind === 'text')!;
  assert.ok(added && inside(added, 60, 100, 300, 200), 'inside the panel');
});

test('fixing only a small target also moves it off what it grew onto', () => {
  const a = obj('button', [10, 10, 30, 30], { action: { stepId: 6, step: 'Go to Record/Request/Page' } as LayoutObject['action'] });
  const b = obj('button', [10, 34, 100, 78], { action: { stepId: 6, step: 'Go to Record/Request/Page' } as LayoutObject['action'] });
  const d = layout([a, b], { width: 390 });
  const { design } = fixLayout(d, schema, [], [{ rule: 'small-target', objectIds: [a.id] }]);
  assert.deepEqual(lintLayout(design, schema).filter((i) => i.rule === 'overlap'), []);
});

test('a button\'s tooltip is a FileMaker text literal: backslashes, quotes and pilcrows escaped, returns dropped', () => {
  const b = obj('button', [10, 10, 60, 40], { action: { stepId: 1, step: 'Perform Script', scriptId: 4, script: 'Copy C:\\ "a"¶b\nc' } as LayoutObject['action'] });
  const { design } = fixLayout(layout([b], { width: 600 }), schema);
  assert.equal(design.objects[0].tooltip, '"Copy C:\\\\ \\"a\\"\\¶bc"');
});

function inside(o: LayoutObject, left: number, top: number, right: number, bottom: number): boolean {
  return o.bounds.left >= left && o.bounds.top >= top && o.bounds.right <= right && o.bounds.bottom <= bottom;
}

test('conditional formatting that only changes colour is flagged, and Fix makes it bold too', () => {
  const red = { formula: 'Amount < 0', rules: [{ part: 1, state: 1, css: { color: '#c00' } }] };
  const fill = { formula: 'Late', rules: [{ part: 2, state: 1, css: { 'background-color': '#fee' } }] };
  const bold = { formula: 'Big', rules: [{ part: 1, state: 1, css: { color: '#0a0', 'font-weight': 'bold' } }] };
  const a = obj('text', [10, 10, 100, 30], { text: 'Total', conditions: [red] } as Partial<LayoutObject>);
  const b = obj('text', [10, 40, 100, 60], { text: 'Due', conditions: [fill] } as Partial<LayoutObject>);
  const c = obj('text', [10, 70, 100, 90], { text: 'Size', conditions: [bold] } as Partial<LayoutObject>);
  const d = layout([a, b, c], { width: 600 });
  assert.deepEqual(lintLayout(d, schema).filter((i) => i.rule === 'color-only').map((i) => [i.objectIds[0], i.fixable]), [[a.id, true], [b.id, true]]);
  const { design } = fixLayout(d, schema);
  assert.deepEqual(design.objects[0].conditions![0].rules, [{ part: 1, state: 1, css: { color: '#c00', 'font-weight': 'bold' } }]);
  assert.deepEqual(design.objects[1].conditions![0].rules, [{ part: 2, state: 1, css: { 'background-color': '#fee' } }, { part: 1, state: 1, css: { 'font-weight': 'bold' } }]);
  assert.deepEqual(design.objects[2].conditions, c.conditions);
  assert.deepEqual(lintLayout(design, schema).filter((i) => i.rule === 'color-only'), []);
});

test('charts and web viewers with nothing to call them are flagged; a chart gets its value axis title as a tooltip', () => {
  const chart = obj('chart', [10, 10, 300, 200], { chart: { type: 'column', source: 'found-set', yTitle: '"Sales"', series: [{ data: 'Amount' }] } } as Partial<LayoutObject>);
  const titled = obj('chart', [10, 210, 300, 400], { chart: { type: 'column', source: 'found-set', title: '"Sales"', series: [{ data: 'Amount' }] } } as Partial<LayoutObject>);
  const bare = obj('chart', [310, 10, 500, 200], { chart: { type: 'pie', source: 'found-set', series: [{ data: 'Amount' }] } } as Partial<LayoutObject>);
  const web = obj('web-viewer', [310, 210, 500, 400], { webUrl: '"https://example.com"' });
  const d = layout([chart, titled, bare, web], { width: 600, parts: [{ kind: 'body', kindId: 2, top: 0, height: 500, style: {} }] as LayoutDesign['parts'] });
  assert.deepEqual(lintLayout(d, schema).filter((i) => i.rule === 'unlabeled').map((i) => [i.objectIds[0], i.fixable ?? false]), [[chart.id, true], [bare.id, false], [web.id, false]]);
  const { design } = fixLayout(d, schema);
  assert.equal(design.objects[0].tooltip, '"Sales"', 'the same formula as the axis title');
  assert.equal(design.objects[2].tooltip, undefined);
});

test('colour-only conditions on icon-only buttons are left for a person; see-through colours (hiding) aren\'t flagged', () => {
  const icon = obj('button', [10, 10, 40, 40], { action: go, icon: { imageId: 1, size: 16, display: 'icon-only' } as never, conditions: [{ formula: 'Here', rules: [{ part: 4, state: 1, css: { '--fm-icon-color': 'rgb(0 0 200)' } }] }] } as Partial<LayoutObject>);
  const hidden = obj('text', [10, 50, 100, 70], { text: 'Note', conditions: [{ formula: 'IsEmpty ( Note )', rules: [{ part: 1, state: 1, css: { color: 'rgb(0 0 0 / 0)' } }] }] } as Partial<LayoutObject>);
  const issues = lintLayout(layout([icon, hidden], { width: 600 }), schema).filter((i) => i.rule === 'color-only');
  assert.deepEqual(issues.map((i) => [i.objectIds[0], i.fixable ?? false]), [[icon.id, false]]);
  assert.match(issues[0].message, /such as the icon/);
});

test('bold marks one state only: always-true conditions don\'t count, two colour states and empty text aren\'t fixed', () => {
  const white = { formula: 'True', rules: [{ part: 1, state: 1, css: { color: '#fff' } }] };
  const error = { formula: 'EvaluationError ( Evaluate ( Self ) )', rules: [{ part: 1, state: 1, css: { color: '#c00' } }] };
  const one = obj('text', [10, 10, 100, 30], { text: 'Rate', conditions: [white, error] } as Partial<LayoutObject>);
  const red = { formula: 'Amount < 0', rules: [{ part: 1, state: 1, css: { color: '#c00' } }] };
  const green = { formula: 'Amount > 0', rules: [{ part: 1, state: 1, css: { color: '#0a0' } }] };
  const two = obj('text', [10, 40, 100, 60], { text: 'Total', conditions: [red, green] } as Partial<LayoutObject>);
  const empty = obj('text', [10, 70, 100, 90], { conditions: [error] } as Partial<LayoutObject>);
  const icon = obj('button', [10, 100, 100, 130], { text: 'Send', action: go, conditions: [{ formula: 'Sent', rules: [{ part: 4, state: 1, css: { '--fm-icon-color': '#999' } }] }] } as Partial<LayoutObject>);
  const d = layout([one, two, empty, icon], { width: 600 });
  assert.deepEqual(lintLayout(d, schema).filter((i) => i.rule === 'color-only').map((i) => [i.objectIds[0], i.fixable ?? false]), [[one.id, true], [two.id, false], [icon.id, false]]);
  const { design } = fixLayout(d, schema);
  assert.deepEqual(design.objects[0].conditions!.map((c) => c.rules[0].css['font-weight']), [undefined, 'bold'], 'only the error state goes bold');
  assert.deepEqual(design.objects[1].conditions, two.conditions);
  assert.deepEqual(design.objects[3].conditions, icon.conditions);
});
