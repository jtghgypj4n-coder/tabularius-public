import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, censusText, layoutCensus, Store, type DesignOp } from '../src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';

const A = { account: 'Admin' };

test('layout census: counts each kind and what of it can\'t be drawn or worked out, and prints nothing from the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-census-'));
  try {
    createStore(join(dir, 'f.sqlite'));
    const store = new Store(join(dir, 'f.sqlite'), 'Shop');
    try {
      store.applyDesign([{ op: 'createTable', name: 'Secret Clients', fields: [{ name: 'Confidential Name' }] }] as DesignOp[], A);
      const d = store.design('Secret Clients')!;
      const to = d.tableOccurrenceId!;
      const base = { anchors: { left: true, top: true, right: false, bottom: false }, style: {} };
      const at = (n: number) => ({ top: 200 + n * 30, left: 10, bottom: 220 + n * 30, right: 200 });
      const extra: LayoutObject[] = [
        { ...base, id: 900, kind: 'field', type: 1, bounds: at(0), field: { tableOccurrenceId: to, fieldId: 999, display: 'edit', repetitions: 1 } },
        { ...base, id: 901, kind: 'graphic', type: 3, bounds: at(1), imageId: 42 },
        { ...base, id: 902, kind: 'popover-button', type: 14, bounds: at(2), target: 77 },
        { ...base, id: 903, kind: 'text', type: 2, bounds: at(3), text: 'Hello <<Nowhere::Nothing>> and <<ƒ:Get ( FoundCount ) & " found">>' },
        { ...base, id: 904, kind: 'text', type: 2, bounds: at(4), text: 'Hidden', hide: { formula: 'NotAFunction ( 1 )', inFind: false } },
        { ...base, id: 905, kind: 'chart', type: 13, bounds: at(5) },
        { ...base, id: 906, kind: 'unknown', type: 99, bounds: at(6) },
        { ...base, id: 907, kind: 'button', type: 10, bounds: at(7), action: { stepId: 555, step: 'Some step' } },
      ] as LayoutObject[];
      store.applyDesign([{ op: 'updateLayout', layout: d.id, design: { objects: [...d.objects, ...extra] } }] as DesignOp[], A);
      const c = layoutCensus(store, { steps: new Set([1, 6]) });
      assert.equal(c.layouts, 1);
      assert.equal(c.objects.field.issues['its field is gone (<Field Missing>)'], 1);
      assert.equal(c.objects.graphic.issues['its picture is not in the image library'], 1);
      assert.equal(c.objects['popover-button'].issues['no popover'], 1);
      assert.equal(c.objects.text.issues['merge field names nothing'], 1);
      assert.equal(c.objects.chart.issues['chart setup not read'], 1);
      assert.equal(c.objects.unknown.issues['object type 99'], 1);
      assert.equal(c.objects.button.issues['runs a script step Tabularius lacks'], 1);
      assert.deepEqual(c.formulas['calculated text'], { count: 1, failing: {} });
      assert.deepEqual(c.formulas.hide, { count: 1, failing: { 'calls a function Tabularius lacks': 1 } });
      assert.deepEqual(c.unknownFunctions, { NotAFunction: 1 });
      // The generated fields themselves are fine.
      assert.equal(c.objects.field.count, d.objects.filter((o) => o.kind === 'field').length + 1);
      const text = censusText(c, 'Shop') + JSON.stringify(c);
      for (const secret of ['Secret Clients', 'Confidential', 'Nowhere', 'Hello', 'found']) assert.ok(!text.includes(secret), `"${secret}" leaked: ${text}`);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
