// Figures the pages state that come from a limit in the code: the page must still say the number, and it must be the
// code's. (Tables built from the code are kept honest by their own generators; this is for figures in sentences.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCKOUT, CONTAINER_CHUNK } from '../../store/src/index.ts';
import { RECORD_STEPS } from '../../scripts/src/recorder.ts';
import { MAX_STREAMS_PER_SESSION, MAX_STREAM_BUFFER } from '../../server/src/live.ts';
import { DEFAULT_LOG_LIMIT } from '../../server/src/server-logs.ts';
import { maxRows } from '../../server/src/pgwire.ts';
import { root } from './docs-examples.ts';

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, fifteen: 15 };
const num = (s: string): number => WORDS[s.toLowerCase()] ?? Number(s.replace(/,/g, ''));
const read = (file: string): string => readFileSync(join(root, file), 'utf8').replace(/\s+/g, ' ');
const source = (file: string, pattern: RegExp): number => {
  const m = pattern.exec(readFileSync(join(root, file), 'utf8'));
  assert.ok(m, `${file} no longer matches ${pattern}`);
  return num(m[1]);
};
const MB = 1024 * 1024;

/** [page, the sentence with the figure in a capture group, the figure in the code]. */
const FIGURES: [string, RegExp, () => number][] = [
  ['README.md', /It records up to ([\d,]+) steps/, () => RECORD_STEPS],
  ['README.md', /A session may hold (\d+) event streams/, () => MAX_STREAMS_PER_SESSION],
  ['README.md', /with (\d+) KB waiting to be sent, is closed/, () => MAX_STREAM_BUFFER / 1024],
  ['README.md', /moved to `<name>-old.log` at (\d+) MB/, () => DEFAULT_LOG_LIMIT / MB],
  ['README.md', /After (\w+) wrong passwords in \d+ minutes from one address/, () => LOCKOUT.attempts],
  ['README.md', /After \w+ wrong passwords in (\d+) minutes from one address/, () => LOCKOUT.windowMs / 60_000],
  ['README.md', /can't\s+sign in to the account for (\d+) minutes/, () => LOCKOUT.lockMs / 60_000],
  ['README.md', /return at most \*\*([\d,]+) rows\*\* by default/, () => maxRows()],
  ['README.md', /files over a megabyte are stored in (\d+) MB pieces/, () => CONTAINER_CHUNK / MB],
  ['README.md', /once a day into\s+`<folder>\/Backups\/<date_time>\/`, keeping the last (\d+)/, () => source('packages/server/src/backup.ts', /const keep = opts\.keep \?\? (\d+);/)],
];

test('the figures the README states are the code\'s', () => {
  const wrong: string[] = [];
  for (const [file, pattern, actual] of FIGURES) {
    const text = read(file);
    const m = pattern.exec(text);
    if (!m) { wrong.push(`${file}: no sentence matches ${pattern}; the page changed, update this table`); continue; }
    if (num(m[1]) !== actual()) wrong.push(`${file}: says ${m[1]} where the code has ${actual()} (${pattern})`);
  }
  assert.deepEqual(wrong, []);
});

test('the SQL grammar page counts its entries as the data file does', () => {
  const grammar = JSON.parse(readFileSync(join(root, 'packages/server/test/data/sql-grammar.json'), 'utf8')) as { paths?: unknown[] }[];
  const open = grammar.filter((e) => e.paths?.length === 0).length;
  const m = /(\d+) entries, (\d+) with an expectation and (\d+) recorded as not verified/.exec(read('docs/sql-grammar-conformance.md'));
  assert.ok(m, 'the page no longer says how many entries it checked');
  assert.deepEqual([Number(m[1]), Number(m[2]), Number(m[3])], [grammar.length, grammar.length - open, open]);
});
