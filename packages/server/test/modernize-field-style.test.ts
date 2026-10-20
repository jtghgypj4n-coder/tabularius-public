// A modern page made from a layout follows how the layout draws its fields: the label beside each, view-only fields,
// and checkbox sets and radio buttons over a value list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type DesignOp } from '../../store/src/index.ts';
import { modernPage } from '../../web/src/page-source.ts';
import { interfacePage, planFromLayout } from '../../web/src/modernize.ts';
import { draftLayoutChange } from '../src/design-preview.ts';
import { modernizeChange } from '../src/modernize.ts';

test('modernize: fromLayouts carries the layout\'s labels, view-only fields and checkbox and radio sets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-modernize-style-'));
  try {
    createStore(join(dir, 'f.sqlite'));
    const store = new Store(join(dir, 'f.sqlite'), 'Shop');
    try {
      store.applyDesign([
        { op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }, { name: 'Interests' }, { name: 'Tier' }, { name: 'Notes' }, { name: 'City' }] },
        { op: 'createValueList', name: 'Topics', values: ['Books', 'Music'] },
      ] as DesignOp[], { account: 'Admin' });
      store.applyDesign(draftLayoutChange(store, { name: 'Customer card', occurrence: 'Customers', view: 'form', fields: ['Name', 'Interests', 'Tier', 'Notes', 'City'] }).changes, { account: 'Admin' });
      const design = store.design('Customer card')!;
      const topics = store.schema.valueLists.find((v) => v.name === 'Topics')!;
      const objects = design.objects.map((o) => {
        if (!o.field) return o.kind === 'text' && o.text === 'Name' ? { ...o, text: 'Full name:' } : o;
        if (o.field.field === 'Interests') return { ...o, field: { ...o.field, display: 'checkbox' as const, valueListId: topics.id, valueList: 'Topics' } };
        if (o.field.field === 'Tier') return { ...o, field: { ...o.field, display: 'radio' as const, valueListId: topics.id, valueList: 'Topics' } };
        if (o.field.field === 'Notes') return { ...o, field: { ...o.field, behavior: { browse: 'view' as const } } };
        return o;
      });
      store.applyDesign([{ op: 'updateLayout', layout: 'Customer card', design: { objects } }] as DesignOp[], { account: 'Admin' });

      const r = modernizeChange(store, { styles: [], fromLayouts: true });
      const create = (r.changes.filter((c) => c.op === 'createLayout') as unknown as { name: string; design: { objects: never[] } }[]).find((c) => c.name === 'Customer card - Modern')!;
      const page = modernPage(create.design.objects)!.html;
      assert.match(page, /\{"name":"Name","label":"Full name","control":"text"\}/);
      assert.match(page, /\{"name":"Interests","label":"Interests","control":"checkbox","options":\["Books","Music"\],"list":"Topics"\}/);
      assert.match(page, /\{"name":"Tier","label":"Tier","control":"radio","options":\["Books","Music"\],"list":"Topics"\}/);
      assert.match(page, /\{"name":"Notes","label":"Notes","control":"readonly"\}/);
      assert.match(page, /\{"name":"City","label":"City","control":"text"\}/);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('modernize: a checkbox set is a group whose value is the ticked choices, one to a line', () => {
  const table = { name: 'T', fields: [{ name: 'A', type: 'text', kind: 'normal' }, { name: 'B', type: 'text', kind: 'normal' }] };
  const plan = planFromLayout(table, [{ name: 'A', display: 'checkbox', valueList: 'L', values: ['x', 'y'] }, { name: 'B' }], 'T');
  assert.equal(plan.fields[0].control, 'checkbox');
  // Without a value list there is nothing to choose from: the field stays as it was.
  assert.equal(planFromLayout(table, [{ name: 'A', display: 'checkbox' }], 'T').fields[0].control, 'text');
  const page = interfacePage('T', plan, 'detail');
  const script = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /role: kind === 'radio' \? 'radiogroup' : 'group'/);
  assert.match(script, /Object\.defineProperty\(c, 'value', \{ get: function \(\) \{ return \[\]\.filter\.call\(c\.querySelectorAll\('input'\)[^]*join\('\\n'\)/);
  assert.match(script, /if \(c\.classList\.contains\('ro'\)\) return;/, 'the save reads a group like any other control');
});
