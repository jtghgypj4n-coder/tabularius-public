import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';

function withStore(fn: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-components-'));
  try {
    createStore(join(dir, 'f.sqlite'));
    const store = new Store(join(dir, 'f.sqlite'), 'Shop');
    try {
      fn(store);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const groups = (objects: LayoutObject[]) => objects.filter((o) => o.component);
const texts = (o: LayoutObject | undefined) => (o?.children ?? []).map((c) => c.text);

test('components: made from objects on a layout, placed on another, edited once, detached', () => withStore((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Total' }] },
  ] as never);
  const [customers, orders] = store.designs().layouts;
  // The two header labels on Customers become the "Brand bar" component.
  const header = customers.objects.filter((o) => o.kind === 'text' && o.bounds.top < 60);
  assert.ok(header.length >= 1);
  const ids = header.map((o) => o.id);
  const { applied } = store.applyDesign([{ op: 'createComponent', name: 'Brand bar', layout: customers.id, objectIds: ids }] as never);
  assert.deepEqual(applied.map((a) => a.op), ['createComponent', 'updateLayout'], 'the layout change is logged for its versions');
  const component = store.designs().components![0];
  assert.equal(component.name, 'Brand bar');
  assert.ok(component.objects.every((o) => o.bounds.left >= 0 && o.bounds.top >= 0));
  let c1 = store.designs().layouts.find((d) => d.id === customers.id)!;
  const copy1 = groups(c1.objects)[0];
  assert.equal(copy1.component!.id, component.id);
  assert.deepEqual(copy1.children!.map((c) => c.id).sort(), [...ids].sort(), 'the objects keep their ids inside the copy');

  // Place it on Orders: a group marked with the component; its children come from the component.
  const at = { top: 200, left: 30 };
  const placedGroup = { id: 900, kind: 'group', type: 8, bounds: { ...at, bottom: at.top, right: at.left }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, component: { id: component.id } };
  store.applyDesign([{ op: 'updateLayout', layout: orders.id, design: { objects: [...orders.objects, placedGroup] } }] as never);
  let o1 = store.designs().layouts.find((d) => d.id === orders.id)!;
  const copy2 = groups(o1.objects)[0];
  assert.deepEqual(texts(copy2), texts(copy1));
  assert.equal(copy2.bounds.right - copy2.bounds.left, component.width);
  assert.ok(copy2.children!.every((c) => c.bounds.top >= 200));
  const allIds = (os: LayoutObject[]): number[] => os.flatMap((o) => [o.id, ...allIds(o.children ?? [])]);
  assert.equal(new Set(allIds(o1.objects)).size, allIds(o1.objects).length, 'ids stay unique on the layout');

  // Edit it once: both copies change, and both layouts log the change.
  const edited = component.objects.map((o, i) => (i === 0 ? { ...o, text: 'Acme Ltd' } : o));
  const r = store.applyDesign([{ op: 'updateComponent', component: 'Brand bar', objects: edited }] as never);
  assert.deepEqual(r.applied.map((a) => [a.op, (a as { layout?: number }).layout]).sort(), [['updateComponent', undefined], ['updateLayout', customers.id], ['updateLayout', orders.id]].sort());
  c1 = store.designs().layouts.find((d) => d.id === customers.id)!;
  o1 = store.designs().layouts.find((d) => d.id === orders.id)!;
  assert.equal(texts(groups(c1.objects)[0])[0], 'Acme Ltd');
  assert.equal(texts(groups(o1.objects)[0])[0], 'Acme Ltd');
  assert.ok(groups(o1.objects)[0].children!.every((c) => c.bounds.top >= 200), 'each copy stays where it was placed');

  // Detach the Orders copy: a plain group that no longer follows.
  const detached = o1.objects.map((o) => (o.component ? (({ component: _c, ...rest }) => rest)(o) : o));
  store.applyDesign([{ op: 'updateLayout', layout: orders.id, design: { objects: detached } }] as never);
  store.applyDesign([{ op: 'updateComponent', component: 'Brand bar', objects: component.objects }] as never);
  o1 = store.designs().layouts.find((d) => d.id === orders.id)!;
  assert.equal(groups(o1.objects).length, 0);
  assert.ok(o1.objects.some((o) => o.kind === 'group' && o.children?.[0]?.text === 'Acme Ltd'), 'the detached copy keeps what it had');

  // Deleting the component leaves its copies as plain groups.
  store.applyDesign([{ op: 'deleteComponent', component: 'Brand bar' }] as never);
  c1 = store.designs().layouts.find((d) => d.id === customers.id)!;
  assert.equal(groups(c1.objects).length, 0);
  assert.ok(c1.objects.some((o) => o.kind === 'group' && o.children?.length));
}));

test('components: names are unique, and a component cannot hold a placed component', () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'A' }] }] as never);
  const t = store.designs().layouts[0];
  const one = t.objects[0];
  store.applyDesign([{ op: 'createComponent', name: 'Bar', objects: [one] }] as never);
  assert.throws(() => store.applyDesign([{ op: 'createComponent', name: 'bar', objects: [one] }] as never), /already exists/);
  const placedCopy = { ...one, id: 77, kind: 'group', component: { id: 1 }, children: [] };
  assert.throws(() => store.applyDesign([{ op: 'updateComponent', component: 'Bar', objects: [placedCopy] }] as never), /inside another component/);
}));

test('components: a component holds no copies nested in groups, but may say "component" in its text', () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'A' }] }] as never);
  const t = store.designs().layouts[0];
  const one = t.objects[0];
  store.applyDesign([{ op: 'createComponent', name: 'Bar', objects: [{ ...one, text: 'component', tooltip: 'component' }] }] as never);
  const copy = { ...one, id: 77, kind: 'group', component: { id: 1 }, children: [] };
  const wrapped = { ...one, id: 78, kind: 'group', children: [copy] };
  assert.throws(() => store.applyDesign([{ op: 'createComponent', name: 'Nest', objects: [wrapped] }] as never), /inside another component/);
  assert.throws(() => store.applyDesign([{ op: 'updateComponent', component: 'Bar', objects: [wrapped] }] as never), /inside another component/);
  store.applyDesign([{ op: 'updateComponent', component: 'Bar', objects: [{ ...one, text: 'component' }] }] as never);
  // A group on a layout holding a copy can't become a component either.
  store.applyDesign([{ op: 'updateLayout', layout: t.id, design: { objects: [...t.objects, wrapped] } }] as never);
  assert.throws(() => store.applyDesign([{ op: 'createComponent', name: 'Nest', layout: t.id, objectIds: [78] }] as never), /inside another component/);
}));

test('components: renames and deletes reach the component, so the next save keeps them', () => withStore((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }, { name: 'City' }] },
    { op: 'createScript', name: 'Greet', text: 'Beep' },
  ] as never);
  const customers = store.designs().layouts[0];
  const field = customers.objects.find((o) => o.field?.field === 'Name')!;
  const label = { ...field, id: 500, kind: 'text', type: 2, field: undefined, text: '<<Customers::Name>>', hide: { formula: 'IsEmpty ( Name )', inFind: false } } as LayoutObject;
  const btn = { ...field, id: 501, kind: 'button', type: 10, field: undefined, text: 'Hi', action: { text: 'Perform Script [ "Greet" ]' } } as unknown as LayoutObject;
  store.applyDesign([{ op: 'updateLayout', layout: customers.id, design: { objects: [...customers.objects, label, btn] } }] as never);
  store.applyDesign([{ op: 'createComponent', name: 'Card', layout: customers.id, objectIds: [field.id, 500, 501] }] as never);
  store.applyDesign([
    { op: 'updateField', table: 'Customers', field: 'Name', name: 'FullName' },
    { op: 'updateScript', script: 'Greet', name: 'Say hello' },
  ] as never);
  const check = (why: string) => {
    for (const objects of [store.designs().components![0].objects, groups(store.designs().layouts[0].objects)[0].children!]) {
      assert.ok(objects.some((o) => o.field?.field === 'FullName'), `${why}: the field`);
      assert.ok(objects.some((o) => o.text === '<<Customers::FullName>>'), `${why}: the merge field`);
      assert.ok(objects.some((o) => o.hide?.formula === 'IsEmpty ( FullName )'), `${why}: the hide formula`);
      assert.ok(objects.some((o) => o.action?.script === 'Say hello'), `${why}: the button's script`);
    }
  };
  check('after the renames');
  // An unrelated save of the layout rebuilds its copy from the component: the renames stay.
  const d = store.designs().layouts[0];
  store.applyDesign([{ op: 'updateLayout', layout: d.id, design: { objects: d.objects.map((o) => (o.component ? o : { ...o, bounds: { ...o.bounds, left: o.bounds.left + 1, right: o.bounds.right + 1 } })) } }] as never);
  check('after an unrelated save');
  // A deleted field shows as missing in the component too.
  store.applyDesign([{ op: 'deleteField', table: 'Customers', field: 'FullName' }] as never);
  assert.ok(store.designs().components![0].objects.some((o) => o.field?.field === '<Field Missing>'));
}));

test('components: button steps in a component are parsed, and bad ones refused', () => withStore((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'A' }] },
    { op: 'createScript', name: 'Go', text: 'Beep' },
  ] as never);
  const one = store.designs().layouts[0].objects[0];
  const btn = (text: string) => ({ ...one, id: 9, kind: 'button', type: 10, text: 'Go', action: { text } });
  assert.throws(() => store.applyDesign([{ op: 'createComponent', name: 'Bar', objects: [btn('This is not a step [')] }] as never));
  store.applyDesign([{ op: 'createComponent', name: 'Bar', objects: [btn('Perform Script [ "Go" ]')] }] as never);
  const action = store.designs().components![0].objects[0].action!;
  assert.equal(action.stepId, 1);
  assert.equal(action.script, 'Go');
  assert.ok(action.scriptId !== undefined, 'matched to the script');
  assert.throws(() => store.applyDesign([{ op: 'updateComponent', component: 'Bar', objects: [btn('This is not a step [')] }] as never));
  assert.throws(() => store.applyDesign([{ op: 'updateComponent', component: 'Bar', objects: [{ ...one, id: 9, kind: 'chart', chart: { type: 'nope' } }] }] as never), /isn't a chart type/);
}));
