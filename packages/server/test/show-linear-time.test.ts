// `SHOW` runs on query text from a network client; its pattern backtracked over every run of blanks (3 s on 50,000).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { showTarget } from '../src/pgwire.ts';

test('SHOW with a long run of blanks and a stray character is answered in milliseconds', () => {
  const t = performance.now();
  assert.equal(showTarget(`SHOW a${' '.repeat(50_000)}x`), `a${' '.repeat(50_000)}x`);
  assert.ok(performance.now() - t < 500, `took ${Math.round(performance.now() - t)} ms`);
});

test('showTarget finds what the pattern /^SHOW\\s+(.+?)\\s*$/ found, on every short statement', () => {
  const alphabet = ['S', 'H', 'O', 'W', 's', ' ', '\n', '\t', 'x', '.'];
  let n = 0;
  const walk = (prefix: string, left: number): void => {
    // The session trims the statement before it looks at it.
    const s = prefix.trim();
    const old = /^SHOW\s+(.+?)\s*$/i.exec(s)?.[1];
    assert.equal(showTarget(s), old, JSON.stringify(s));
    n++;
    if (left) for (const c of alphabet) walk(prefix + c, left - 1);
  };
  for (const head of ['SHOW', 'show ', 'ShoW\n', 'SHOW  ', 'SHOWx', '']) walk(head, 4);
  assert.ok(n > 5000);
});
