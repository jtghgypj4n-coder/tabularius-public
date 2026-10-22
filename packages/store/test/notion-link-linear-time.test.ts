// A Notion CSV cell that links a row ends in `Name (https://...)`. The pattern for it tried every start in a long cell.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripNotionLink } from '../src/import-tables.ts';

test('a long cell with a stray bracket or blanks is read in one pass', () => {
  for (const cell of [`a${' '.repeat(50_000)}x`, `${'(http://a '.repeat(10_000)})`, `${'(http://'.repeat(10_000)}`, `(http://${'a'.repeat(50_000)} )`, `${' '.repeat(50_000)}`]) {
    const t = performance.now();
    stripNotionLink(cell);
    assert.ok(performance.now() - t < 500, `took ${Math.round(performance.now() - t)} ms`);
  }
  assert.equal(stripNotionLink('Acme Ltd (https://www.notion.so/Acme-1a2b)'), 'Acme Ltd');
  assert.equal(stripNotionLink('Acme (http://x/a(b) '), 'Acme');
});

const old = (s: string) => s.replace(/\s*\(https?:\/\/[^)\s]*\)\s*$/, '');

test('the scan removes what the pattern removed, from every short text', () => {
  const alphabet = ['(', ')', 'h', 't', 'p', 's', ':', '/', ' ', '\t', 'a', 'H'];
  const parts = ['(http://', '(https://', 'http://', ')', ' ', 'a', '(', '\n'];
  let checked = 0;
  const walk = (prefix: string, left: number, set: string[]): void => {
    assert.equal(stripNotionLink(prefix), old(prefix), JSON.stringify(prefix));
    checked++;
    if (left) for (const c of set) walk(prefix + c, left - 1, set);
  };
  walk('', 5, parts);
  walk('', 6, alphabet);
  assert.ok(checked > 100_000);
});
