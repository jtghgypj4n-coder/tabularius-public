import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXmlDocument, XPathError } from '../src/xpath.ts';

test('XML depth is refused deliberately before stack exhaustion', () => {
  for (const depth of [10, 1000, 100_000]) {
    const input = '<a>'.repeat(depth) + '</a>'.repeat(depth);
    const start = performance.now();
    if (depth <= 256) assert.equal(parseXmlDocument(input).children.length, 1);
    else assert.throws(() => parseXmlDocument(input), (e: unknown) => e instanceof XPathError && /nested too deeply/.test(e.message));
    assert.ok(performance.now() - start < 3000, 'XML depth budget regression (3x headroom)');
  }
  assert.doesNotThrow(() => parseXmlDocument('<a>'.repeat(256) + '</a>'.repeat(256)));
  assert.throws(() => parseXmlDocument(' '.repeat(8_000_001)), /input is too large/);
});

test('XML attribute uniqueness uses linear lookup and still rejects duplicates', () => {
  for (const n of [10, 1000, 100_000]) {
    const input = '<a ' + Array.from({ length: n }, (_, i) => `a${i}="x"`).join(' ') + '/>';
    const start = performance.now();
    assert.equal(parseXmlDocument(input).children[0].attributes.length, n);
    assert.ok(performance.now() - start < 3000, 'XML attribute work budget regression (3x headroom)');
  }
  assert.throws(() => parseXmlDocument('<a first="x" second="y" first="z"/>'), /attribute first given twice/);
  assert.equal(parseXmlDocument('<a xmlns:p="urn:x" p:b="x" b="y"/>').children[0].attributes.length, 2);
});
