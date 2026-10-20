import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeStepParams, type ParamContext } from '../src/script-params.ts';
import { Node } from '../src/tree.ts';

test('unverified binary refresh flags/action codes and slots remain undecoded, independent of unknown bytes', () => {
  const p = new Node();
  const name = new Node();
  const other = new Node();
  const first = new Node();
  const second = new Node();
  first.children.set(5, name);
  second.children.set(5, other);
  p.children.set(128, first);
  p.children.set(129, second);
  const context: ParamContext = { formula: (n) => n === name ? '"viewer"' : n === other ? '1 - 1' : undefined,
    layoutName: () => undefined, scriptName: () => undefined, tableOccurrenceName: () => undefined,
    fieldName: () => undefined, dataSourceName: () => undefined };
  for (const fill of [0, 255]) {
    const rec = new Uint8Array(32).fill(fill);
    for (const id of [80, 180]) {
      const decoded = decodeStepParams(id, rec, p, context);
      assert.equal(decoded?.viewerAction, undefined);
      assert.deepEqual(decoded, { slots: { 128: '"viewer"', 129: '1 - 1' }, unsupportedOptions: [id === 80 ? 'binary Refresh Window flush flags' : 'binary Refresh Portal object name'] });

    }
    assert.deepEqual(decodeStepParams(146, rec, p, context), { objectName: '"viewer"', viewerUrl: '1 - 1', unsupportedOptions: ['binary Set Web Viewer action'] });
    assert.deepEqual(decodeStepParams(167, rec, p, context), { objectName: '"viewer"', slots: { 129: '1 - 1' }, unsupportedOptions: ['binary Refresh Object repetition'] });
  }
});
