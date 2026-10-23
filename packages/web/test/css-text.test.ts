import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cssText, parseCss } from '../src/design/css-text.ts';

test('editing a different line preserves a data URL in the CSS box', () => {
  const original = { 'background-image': 'url("data:image/png;base64,iVBORw0KGgo=")', color: '#123456' };
  assert.deepEqual(parseCss(cssText(original).replace('#123456', '#654321')), { ...original, color: '#654321' });
});

test('semicolons split only outside quoted strings and parentheses', () => {
  assert.deepEqual(parseCss('a: 1; b: 2'), { a: '1', b: '2' });
  assert.deepEqual(parseCss('a: \'one;two\'; b: "three;four"; c: url(data:x;y); content: ";"'), {
    a: "'one;two'", b: '"three;four"', c: 'url(data:x;y)', content: '";"',
  });
  assert.deepEqual(parseCss('content: "a\\";b"; color: red'), { content: '"a\\";b"', color: 'red' });
});

test('unclosed quotes finish at the end; invalid lines are skipped and keys lower-cased', () => {
  assert.deepEqual(parseCss('COLOR: red\nno colon\ncontent: "open;still open'), { color: 'red', content: '"open;still open' });
});
