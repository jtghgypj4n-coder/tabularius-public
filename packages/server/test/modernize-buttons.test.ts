// A modern page made from a layout keeps the layout's script buttons: those with no parameter or a fixed one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type DesignOp } from '../../store/src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import { modernPage } from '../../web/src/page-source.ts';
import { interfacePage, planFromLayout } from '../../web/src/modernize.ts';
import { draftLayoutChange } from '../src/design-preview.ts';
import { modernizeChange } from '../src/modernize.ts';

test('modernize: fromLayouts carries script buttons whose parameter is fixed, and says which it left out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-modernize-buttons-'));
  try {
    createStore(join(dir, 'f.sqlite'));
    const store = new Store(join(dir, 'f.sqlite'), 'Shop');
    try {
      store.applyDesign([
        { op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }, { name: 'City' }, { name: 'Notes' }] },
        { op: 'createScript', name: 'Send reminder', text: 'Exit Script' },
        { op: 'createScript', name: 'Archive', text: 'Exit Script' },
      ] as DesignOp[], { account: 'Admin' });
      store.applyDesign(draftLayoutChange(store, { name: 'Customer card', occurrence: 'Customers', view: 'form', fields: ['Name', 'City', 'Notes'] }).changes, { account: 'Admin' });
      const id = (name: string) => store.schema.scripts.find((s) => s.name === name)!.id;
      const button = (n: number, left: number, text: string, script: string, parameter?: string): LayoutObject => ({
        id: 500 + n, kind: 'button', type: 6, text, bounds: { left, top: 400, right: left + 100, bottom: 430 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {},
        action: { stepId: 1, step: 'Perform Script', scriptId: id(script), script, ...(parameter ? { parameter } : {}) },
      } as LayoutObject);
      const design = store.design('Customer card')!;
      store.applyDesign([{ op: 'updateLayout', layout: 'Customer card', design: { objects: [...design.objects,
        button(3, 300, 'Archive', 'Archive', '"old \\"files\\""'),
        button(1, 20, 'Remind  them', 'Send reminder'),
        button(2, 160, 'Counted', 'Send reminder', 'Get ( RecordID )'),
        button(4, 440, '<<Customers::Name>>', 'Archive', '12'),
      ] } }] as DesignOp[], { account: 'Admin' });

      const r = modernizeChange(store, { styles: [], fromLayouts: true });
      const made = r.layouts.find((l) => l.name === 'Customer card - Modern')!;
      const create = (r.changes.filter((c) => c.op === 'createLayout') as unknown as { name: string; design: { objects: never[] } }[]).find((c) => c.name === 'Customer card - Modern')!;
      const page = modernPage(create.design.objects)!.html;
      assert.match(page, /"buttons":\[\{"label":"Remind them","script":"Send reminder"\},\{"label":"Archive","script":"Archive","parameter":"old \\"files\\""\},\{"label":"Archive","script":"Archive","parameter":"12"\}\]/);
      assert.ok(made.notes.some((n) => /Buttons from the layout that perform a script: Remind them, Archive, Archive\./.test(n)), made.notes.join('|'));
      assert.ok(made.notes.some((n) => /1 script button left out because the parameter is worked out by a formula/.test(n)));
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('modernize: script buttons are drawn above a saved record\'s form and call the page bridge', () => {
  const table = { name: 'T', fields: [{ name: 'A', type: 'text', kind: 'normal' }, { name: 'B', type: 'text', kind: 'normal' }] };
  const page = interfacePage('T', planFromLayout(table, ['A', 'B'], 'T', [], [{ label: 'Go', script: 'Do it', parameter: 'x' }]), 'split');
  const script = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(script));
  assert.match(page, /"buttons":\[\{"label":"Go","script":"Do it","parameter":"x"\}\]/);
  assert.match(script, /if \(!isNew\) \(P\.buttons \|\| \[\]\)\.forEach[^]*tabularius\.performScript\(b\.script, b\.parameter \|\| ''\)/);
  // Without buttons the plan carries none.
  assert.ok(!interfacePage('T', planFromLayout(table, ['A', 'B'], 'T'), 'split').includes('"buttons"'));
});
