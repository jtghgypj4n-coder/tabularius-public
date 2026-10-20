import test from 'node:test';
import assert from 'node:assert/strict';
import { importFileRows } from '../../scripts/src/index.ts';

const enc = (s: string) => new TextEncoder().encode(s);

test('comma-separated import turns vertical tabs back into line breaks', () => {
  assert.deepEqual(importFileRows('a.csv', enc('"Name","Note"\r\n"Ada","one\vtwo"\r\n')), [['Name', 'Note'], ['Ada', 'one\ntwo']]);
});

test('tab-separated import keeps a lone quote as text and does not swallow the next record', () => {
  const rows = importFileRows('a.tab', enc('a\t"\r\nb\tc\r\nd\t"e\r\nf\tg\r\n'));
  assert.deepEqual(rows, [['a', '"'], ['b', 'c'], ['d', '"e'], ['f', 'g']]);
});

test('tab-separated import still reads a properly quoted value', () => {
  assert.deepEqual(importFileRows('a.tab', enc('"x\ty"\tz\r\n')), [['x\ty', 'z']]);
});
