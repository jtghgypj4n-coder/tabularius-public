// The error-code and script-step pages are written by hand, so these checks
// fail when code and page stop agreeing: a code the engine returns that no row
// mentions, a row naming a code nothing defines, a step the engine cannot run
// that the page does not list as unavailable, or a step listed as doing
// nothing that has no handler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, errorMeaning, Store } from '@tabularius/store';
import { SCRIPT_STEP_NAMES, scriptStepId } from '../../fmp12/src/script-steps.ts';
import { ERROR, runScript } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const codesPage = read('docs/error-codes.md');
const stepsPage = read('docs/script-steps-support.md');
const engine = read('packages/scripts/src/engine.ts');

/** The cells of one markdown table row, or undefined for a line that is not a row (or is the rule under the header). */
const cells = (line: string): string[] | undefined => {
  if (!line.startsWith('|') || /^\|[-| ]+\|$/.test(line)) return undefined;
  return line.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
};

/** The numbers a cell names: `101`, `**212**`, `500-511` (both ends), `5000-5499`. */
const numbers = (cell: string): number[] => [...cell.replace(/\*\*/g, '').matchAll(/\b(\d{1,4})\b/g)].map((m) => Number(m[1]));

test('every code the script engine returns has a row in docs/error-codes.md', () => {
  const returned = new Set<number>(Object.values(ERROR));
  for (const file of readdirSync(join(root, 'packages/scripts/src')).filter((f) => f.endsWith('.ts'))) {
    for (const m of read(`packages/scripts/src/${file}`).matchAll(/new ScriptError\((\d{1,4})\b/g)) returned.add(Number(m[1]));
  }
  returned.delete(0);
  const rows = codesPage.split('\n').flatMap((line) => cells(line) ?? []);
  const mentioned = new Set(rows.flatMap(numbers));
  const inRange = (code: number) => rows.some((c) => [...c.matchAll(/\b(\d{1,4})-(\d{1,4})\b/g)].some((m) => code >= Number(m[1]) && code <= Number(m[2])));
  const missing = [...returned].filter((code) => !mentioned.has(code) && !inRange(code)).sort((a, b) => a - b);
  assert.deepEqual(missing, [], `codes the engine returns that docs/error-codes.md does not mention: add a row saying which step returns them`);
});

test('every code in a "now" column of docs/error-codes.md has a meaning in the catalog', () => {
  const unknown: string[] = [];
  let table: 'steps' | 'calc' | 'codes' | undefined;
  for (const line of codesPage.split('\n')) {
    const row = cells(line);
    if (!row) { if (line.startsWith('#') || line.trim() === '') table = undefined; continue; }
    if (/^Failing step$/i.test(row[0])) { table = 'steps'; continue; }
    if (/^Problem$/i.test(row[0])) { table = 'calc'; continue; }
    if (/^Code$/i.test(row[0])) { table = 'codes'; continue; }
    const cell = table === 'steps' ? row[2] : table === 'calc' ? row[2] : table === 'codes' ? row[0] : undefined;
    if (cell === undefined) continue;
    // "5000-5499" and "500-511" are ranges: each end must be a known code.
    for (const code of numbers(cell)) if (code > 0 && errorMeaning(code) === undefined) unknown.push(`${code} (${row[0].slice(0, 50)})`);
  }
  assert.deepEqual(unknown, [], 'codes the page gives that packages/store/src/error-codes.ts has no meaning for');
});

const stepId = (name: string) => scriptStepId(name)!;
const hasHandler = (name: string) => new RegExp(`\\bcase ${stepId(name)}:`).test(engine);
/** The step names in the first column of one section's table ("A; B (note)" is two steps). */
const sectionSteps = (heading: string): { names: string[]; text: string }[] => {
  const start = stepsPage.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `section ${heading}`);
  const end = stepsPage.indexOf('\n## ', start + 4);
  return stepsPage.slice(start, end < 0 ? undefined : end).split('\n').flatMap((line) => {
    const row = cells(line);
    if (!row || row[0] === 'Script step') return [];
    return [{ names: row[0].replace(/\([^)]*\)/g, '').split(';').map((n) => n.trim()).filter(Boolean), text: row[1] ?? '' }];
  });
};

test('every script step the engine has no handler for is listed under "Not supported" in docs/script-steps-support.md', () => {
  const listed = new Set(sectionSteps('Not supported (error 3)').flatMap((r) => r.names));
  // Step 89 is the comment line: it runs as nothing, by design.
  const unlisted = SCRIPT_STEP_NAMES.filter((n) => stepId(n) !== 89 && !hasHandler(n) && !listed.has(n));
  assert.deepEqual(unlisted, [], 'steps that reach the error 3 fallback but are not in the "Not supported" table');
});

test('the "Not supported", "Does nothing" and "No dispatch handler" rows name real steps and match the engine', () => {
  const real = new Set<string>(SCRIPT_STEP_NAMES);
  for (const heading of ['Not supported (error 3)', 'Does nothing']) {
    const unknown = sectionSteps(heading).flatMap((r) => r.names).filter((n) => !real.has(n));
    assert.deepEqual(unknown, [], `${heading}: names that are not script steps`);
  }
  const claimedMissing = sectionSteps('Not supported (error 3)').filter((r) => /No dispatch handlers?/.test(r.text)).flatMap((r) => r.names);
  assert.deepEqual(claimedMissing.filter(hasHandler), [], 'rows saying "No dispatch handler" for a step that has one');
  const inert = sectionSteps('Does nothing').flatMap((r) => r.names);
  assert.deepEqual(inert.filter((n) => !hasHandler(n)), [], 'steps listed as doing nothing that actually fall through to error 3');
});

test('a step with no handler really ends with error 3', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-docs-drift-'));
  createStore(join(dir, 'D.sqlite'));
  const store = new Store(join(dir, 'D.sqlite'), 'D');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); });
  const listed = sectionSteps('Not supported (error 3)').flatMap((r) => r.names).filter((n) => !hasHandler(n));
  for (const name of listed) {
    const r = await runScript(store, { id: 1, name: 'drift', steps: [{ stepId: stepId(name), name, enabled: true, params: {} }] } as never, {});
    assert.equal(r.error, 3, `${name} is listed as unavailable`);
  }
});
