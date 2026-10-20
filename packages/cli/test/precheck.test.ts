import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { compareBaseline, markerPath, ROOT, runPrecheck, selectTouchedTests, testFailures, treeHash, writeMarker } from '../../../scripts/precheck.ts';

const gates = JSON.parse(readFileSync(join(ROOT, 'scripts/precheck-gates.json'), 'utf8')) as { file: string; reason: string }[];

test('source, test, unmatched source and scripts changes map to the intended tests', () => {
  const tests = ['packages/store/test/csv-export.test.ts', 'packages/store/test/clock.test.ts', 'packages/cli/test/precheck.test.ts'];
  const content: Record<string, string> = { [tests[0]]: "import '../src/csv-export.ts'", [tests[1]]: "import '../src/clock.ts'", [tests[2]]: "import '../../../scripts/precheck.ts'" };
  const readText = (file: string) => content[file];
  assert.deepEqual(selectTouchedTests(['packages/store/src/csv-export.ts'], tests, false, readText).tests, [tests[0]]);
  assert.deepEqual(selectTouchedTests(['packages/store/src/csv-export.ts'], tests, false, () => '').tests, [tests[0]]);
  assert.deepEqual(selectTouchedTests([tests[1]], tests, false, readText).tests, [tests[1]]);
  assert.deepEqual(selectTouchedTests(['packages/store/src/unmatched-precheck-target.ts'], tests, false, readText).tests, tests.slice(0, 2).sort());
  const scripts = selectTouchedTests(['scripts/precheck.ts'], tests, false, readText);
  assert.equal(scripts.wider, true);
  assert.deepEqual(scripts.tests, [tests[2]]);
  const manifest = selectTouchedTests(['package.json'], tests, false, readText);
  assert.equal(manifest.wider, true);
  assert.deepEqual(manifest.tests, []);
  assert.deepEqual(selectTouchedTests(['packages/store/src/csv-export.ts'], tests, true, readText).tests, tests.slice(0, 2).sort());
});

test('baseline accepts old errors but fails a new error in a touched file or a higher count', () => {
  const old = 'packages/web/e2e/a.ts(1,1): error TS2304: Cannot find name X.';
  const fresh = 'packages/store/src/clock.ts(2,1): error TS2304: Cannot find name Y.';
  assert.equal(compareBaseline(old, [old], []).ok, true);
  assert.equal(compareBaseline(`${old}\n${fresh}`, [old], ['packages/store/src/clock.ts']).ok, false);
  assert.equal(compareBaseline(fresh, [old], ['packages/store/src/clock.ts']).ok, false);
  const environmentErrors = Array.from({ length: 22 }, (_, i) => `packages/web/e2e/a.ts(${i + 1},1): error TS2304: Environment type missing.`);
  assert.equal(compareBaseline(environmentErrors.join('\n'), [], [], 22).ok, true);
  assert.equal(compareBaseline([...environmentErrors, fresh].join('\n'), [], [], 22).ok, false);
});

test('a failing gate produces exit 1; quick never starts touched-area tests', () => {
  const calls: string[][] = [];
  const output: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => output.push(args.join(' '));
  try {
    const status = runPrecheck({ quick: true, commandRunner: (command, args) => {
      calls.push([command, ...args]);
      return command === 'npm' ? { status: 0, output: '' } : { status: 1, output: '✖ gate failed\n  error: expected true' };
    } });
    assert.equal(status, 1);
    assert.equal(calls.filter(([command]) => command === process.execPath).length, 1);
    assert.match(output.join('\n'), /gate failed.*expected true/s);
    assert.match(output.at(-1) ?? '', /precheck: FAIL/);
  } finally { console.log = original; }
});

test('failure summary shows the first assertion line', () => {
  assert.deepEqual(testFailures('✖ gate name\n  error: |-\n    Expected true\n    Actual false'), ['✖ gate name — Expected true']);
});

test('marker includes the commit and a working-tree hash that changes with a file', () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-precheck-'));
  try {
    mkdirSync(join(root, '.git'));
    const file = join(root, 'untracked.txt');
    writeFileSync(file, 'first');
    const fake = join(root, 'git');
    writeFileSync(fake, '#!/bin/sh\ncase "$1" in\n  diff) exit 0;;\n  status) printf "?? untracked.txt\\0";;\nesac\n');
    chmodSync(fake, 0o755);
    const previous = process.env.PATH;
    process.env.PATH = `${root}:${previous}`;
    try {
      const first = treeHash(root, 'commit-a');
      writeMarker('commit-a', first, root);
      assert.equal(readFileSync(markerPath(root), 'utf8'), `commit-a ${first}\n`);
      writeFileSync(file, 'second');
      assert.notEqual(treeHash(root, 'commit-a'), first);
    } finally { process.env.PATH = previous; }
  } finally {
    rmSync(dirname(markerPath(root)), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('each configured gate exists and has a reason', () => {
  for (const gate of gates) {
    assert.ok(gate.reason, `${gate.file} has a reason`);
    assert.ok(existsSync(join(ROOT, gate.file)), `${gate.file} exists`);
  }
});
