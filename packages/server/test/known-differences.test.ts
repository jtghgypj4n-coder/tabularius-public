import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REGISTER, ROOT, render, scan } from '../../../scripts/known-differences-lib.ts';

// docs/known-differences.md is built from the <!-- known-difference: ... --> markers beside each statement in the docs that
// says what differs from FileMaker or what is not settled (npm run docs:known-differences).

test('every statement of what differs or is not settled has a marker', () => {
  const { problems, statements } = scan();
  assert.ok(statements > 40, 'the scan finds the statements in the docs');
  assert.deepEqual(problems.map((p) => `${p.file}:${p.line}: ${p.why} (${p.text})`), []);
});

test('the register is up to date with the markers', () => {
  const { entries } = scan();
  assert.equal(readFileSync(REGISTER, 'utf8'), render(entries), 'run npm run docs:known-differences');
});

test('source comments are omitted before excerpts are shortened', () => {
  const { entries } = pages({ 'a.md': '# A\n\n| This is unverified <!-- engine.ts writeField --> and documented here | shows | settles | <!-- known-difference: Scripts ;; behavior ;; shows ;; settles -->\n' });
  assert.equal(entries.length, 1);
  assert.doesNotMatch(entries[0].excerpt, /<!--|-->/);
  assert.match(render(entries), /This is unverified and documented here/);
});

test('the README and the moving guide link to the register', () => {
  for (const file of ['README.md', 'docs/moving-a-solution.md']) {
    assert.match(readFileSync(join(ROOT, file), 'utf8'), /\(\.?\.?\/?(?:docs\/)?known-differences\.md\)/, `${file} links known-differences.md`);
  }
});

function pages(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-known-diff-'));
  const paths = Object.entries(files).map(([name, text]) => { const p = join(dir, name); writeFileSync(p, text); return p; });
  try { return scan(paths, dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('the scan flags a statement with no marker, and accepts each way of marking one', () => {
  const marker = '<!-- known-difference: Area ;; what ;; shows ;; settles -->';
  const flagged = pages({ 'a.md': '# A\n\nThis is inferred from one sample.\n\nNot yet: a thing.\n' });
  assert.equal(flagged.problems.length, 2);
  assert.equal(flagged.entries.length, 0);

  const prose = pages({ 'a.md': `# A\n\nThis is inferred from one sample,\nand the next line carries it. ${marker}\n` });
  assert.deepEqual(prose.problems, []);
  assert.equal(prose.entries.length, 1);
  assert.deepEqual([prose.entries[0].area, prose.entries[0].what, prose.entries[0].shows, prose.entries[0].settles], ['Area', 'what', 'shows', 'settles']);

  const row = pages({ 'a.md': `| a | b |\n| - | - |\n| inferred | x | ${marker}\n| unverified | y |\n` });
  assert.equal(row.problems.length, 1, 'a table row needs its own marker: the one on the row above does not cover it');
  assert.match(row.problems[0].text, /unverified/);

  const wide = pages({ 'a.md': `# A\n\n<!-- known-difference-file: Area ;; what ;; shows ;; settles -->\n\nEverything here is inferred. Not yet decoded: x.\n` });
  assert.deepEqual(wide.problems, []);
  assert.equal(wide.entries.length, 1);

  const ok = pages({ 'a.md': '# A\n\nNot yet swept. <!-- known-difference-ok: a different sense -->\n\nAlso inferred <!-- known-difference-ok:  -->\n' });
  assert.equal(ok.problems.length, 1, 'an ok marker needs a reason');
});

test('a marker needs all four parts, and only a table row or paragraph it sits in', () => {
  const short = pages({ 'a.md': 'Not yet built. <!-- known-difference: Area ;; what ;; shows -->\n' });
  assert.equal(short.problems.length, 1);
  assert.match(short.problems[0].why, /four parts/);
  const far = pages({ 'a.md': 'Not yet built.\n\n<!-- known-difference: Area ;; what ;; shows ;; settles -->\n' });
  assert.equal(far.problems.length, 1, 'a marker in another paragraph does not cover the statement');
});
