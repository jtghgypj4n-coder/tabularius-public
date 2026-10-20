import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChart } from '../src/layouts.ts';
import { Node } from '../src/tree.ts';
import type { Schema } from '../src/schema.ts';

// HYPOTHESIS: synthetic bytes exercise the reader's existing map. They do not
// establish that FileMaker writes these offsets; public help has no byte map.
function synthetic(type = 0, source = 2, count = 2) {
  const object = new Node();
  const setup = new Node();
  const blob = new Uint8Array(1110);
  const view = new DataView(blob.buffer);
  view.setUint32(8, type);
  view.setUint32(117, source);
  view.setUint32(132, 13);
  view.setUint32(140, 12);
  view.setUint32(296, count);
  setup.kv.set(1, blob);
  const parent = new Node();
  parent.children.set(138, setup);
  object.children.set(139, parent);
  const formulas = new Map<Node, string>();
  const put = (slot: number, value: string) => {
    const entry = new Node();
    const calc = new Node();
    entry.children.set(5, calc);
    object.children.set(slot, entry);
    formulas.set(calc, value);
  };
  const read = (schema?: Schema) => readChart({ schema, formula: (n) => n && formulas.get(n) }, object);
  return { blob, put, read };
}

test('chart setup: seven requested chart families keep their type', () => {
  for (const [code, type] of [[0, 'column'], [1, 'bar'], [2, 'line'], [3, 'area'], [4, 'pie'], [9, 'scatter'], [8, 'bubble']] as const) {
    const item = synthetic(code);
    item.put(133, '1');
    assert.equal(item.read()?.type, type);
  }
});

test('chart setup: series count limits the decoded series', () => {
  const item = synthetic(0, 2, 2);
  item.put(133, '1'); item.put(135, '2'); item.put(137, 'leftover');
  assert.equal(item.read()?.series.length, 2);
});

test('chart setup: data source and relationship are carried', () => {
  assert.equal(synthetic(0, 1).read()?.source, 'record');
  const found = synthetic(0, 2);
  new DataView(found.blob.buffer).setUint32(113, 3);
  assert.deepEqual([found.read()?.source, found.read()?.grouped], ['found-set', true]);
  const related = synthetic(0, 3);
  related.blob.set([4, 2, 0x80, 0], 122);
  const schema = { tableOccurrences: [{ id: 128, name: 'Related' }] } as Schema;
  assert.deepEqual([related.read(schema)?.source, related.read(schema)?.occurrence], ['related', 'Related']);
});

test('chart setup: title and axis labels keep their formula slots', () => {
  const item = synthetic();
  item.put(128, '"Title"'); item.put(129, '"Horizontal"'); item.put(130, '"Vertical"'); item.put(131, 'Category');
  assert.deepEqual([item.read()?.title, item.read()?.xTitle, item.read()?.yTitle, item.read()?.categories], ['"Title"', '"Horizontal"', '"Vertical"', 'Category']);
});

test('chart setup: series names and values are retained for the legend', () => {
  const item = synthetic();
  item.put(133, '1'); item.put(134, '"One"'); item.put(135, '2'); item.put(136, '"Two"');
  assert.deepEqual(item.read()?.series, [{ data: '1', name: '"One"' }, { data: '2', name: '"Two"' }]);
});

test('chart setup: scatter and bubble auxiliary values keep their slots', () => {
  const scatter = synthetic(9, 2, 1);
  scatter.put(133, '2'); scatter.put(135, '1');
  assert.deepEqual(scatter.read()?.series, [{ data: '2', x: '1' }]);
  const bubble = synthetic(8, 2, 1);
  bubble.put(133, '2'); bubble.put(135, '1'); bubble.put(137, '3');
  assert.deepEqual(bubble.read()?.series, [{ data: '2', x: '1', sizes: '3' }]);
});

test('HYPOTHESIS: unidentified chart codes stop without exposing seeded content', () => {
  const seeded = [synthetic(255, 2), synthetic(0, 255), synthetic(0, 2, 0)];
  const secret = 'DistinctivePath/DistinctiveField/DistinctiveFormula';
  for (const item of seeded) item.put(128, secret);
  let printed = '';
  const previousLog = console.log;
  const previousWrite = process.stdout.write;
  console.log = (...values: unknown[]) => { printed += values.join(' '); };
  process.stdout.write = ((value: string | Uint8Array) => { printed += String(value); return true; }) as typeof process.stdout.write;
  try {
    for (const item of seeded) {
      assert.equal(item.read(), undefined);
      assert.equal(JSON.stringify(item.read()), undefined);
    }
  } finally {
    console.log = previousLog;
    process.stdout.write = previousWrite;
  }
  assert.equal(printed.includes(secret), false);
});
