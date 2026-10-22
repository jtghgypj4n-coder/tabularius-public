import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mutations, applyMutation, rawTemplate, syntaxSource, imports, importingTests, waitForLoad, command } from '../../../scripts/mutate.ts';

// Subprocess tests may launch Node only; accidental operational commands fail closed.
const stubPath = mkdtempSync(join(tmpdir(), 'mutation-command-stubs-'));
const marker = join(stubPath, 'called');
const previousPath = process.env.PATH;
before(() => {
  for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(stubPath, name), '#!/bin/sh\n: > "' + marker + '"\nexit 99\n', { mode: 0o755 });
  }
  process.env.PATH = stubPath;
});
after(() => {
  if (previousPath === undefined) delete process.env.PATH;
  else process.env.PATH = previousPath;
  const called = existsSync(marker);
  rmSync(stubPath, { recursive: true, force: true });
  assert.equal(called, false, 'no service, install, upgrade or network command ran');
});

test('mutations preserve surrounding source and cover all five transformations', () => {
  const source = `// if (a === b) return false;\nexport function guard<T>(a: T, b: T, yes: boolean): boolean {\n if (a === b && !yes) throw new Error('no');\n return yes;\n}\n`;
  const ms = mutations(source);
  assert.deepEqual(new Set(ms.map((m) => m.kind)), new Set(['operator', 'boolean', 'branch', 'throw', 'return']));
  for (const m of ms) {
    assert.equal(source.slice(m.start, m.end), m.before);
    const changed = applyMutation(source, m);
    assert.equal(changed.slice(0, m.start), source.slice(0, m.start));
    assert.equal(changed.slice(m.start + m.after.length), source.slice(m.end));
    assert.equal(changed.slice(0, m.start) + m.before + changed.slice(m.start + m.after.length), source);
    assert.ok(m.line > 1, 'comments are opaque');
  }
  assert.equal(ms.filter((m) => m.kind === 'operator').length, 2, 'type parameters are not comparisons');
});

test('literals, regexes, comments, and type assertions do not become mutants', () => {
  const source = `const a = "if (x === y) return false;"; const b = /a!=b/; const c = \`x && y\`;\n// x < y\n/* x > y */\nexport const f = (x?: boolean) => x!;`;
  assert.deepEqual(mutations(source), []);
  assert.deepEqual(mutations('class Guard { constructor() {} } const x = Object.prototype.toString;'), [], 'prototype property names are not operators');
  assert.deepEqual(mutations('function f() { return value\n sideEffect(); }'), [], 'ASI-separated side effects cannot be swallowed by a return mutation');
  assert.deepEqual(mutations('const nested = `x ${yes ? `y ${no ? "a" : "b"}` : "z"} && end`;'), []);
  assert.deepEqual(imports(`import type { A } from './a.ts'; export { b } from './b.ts'; import './c.ts'; const d = import('./d.ts'); const e = require('./e.ts'); // import './no.ts'`), ['./a.ts', './b.ts', './c.ts', './d.ts', './e.ts']);
});

test('bit shifts are not split into comparison operators', () => {
  assert.deepEqual(mutations('let bits = (1 << 8) | (256 >> 8) | (-1 >>> 0); bits <<= 1; bits >>= 1; bits >>>= 1;'), []);
  const source = 'const allowed = (bits >> shift) === (network >> shift);';
  const ms = mutations(source);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].before, '===');
  assert.equal(applyMutation(source, ms[0]), source.replace('===', '!=='));
});

test('dependency selection follows barrels and cycles, excludes unrelated tests', () => {
  const root = mkdtempSync(join(tmpdir(), 'mutator-graph-'));
  try {
    const dir = join(root, 'packages', 'demo'); mkdirSync(join(dir, 'src'), { recursive: true }); mkdirSync(join(dir, 'test'));
    writeFileSync(join(dir, 'src', 'guard.ts'), 'export const guard = true;');
    writeFileSync(join(dir, 'src', 'index.ts'), "export { guard } from './guard.ts'; export * from './cycle.ts';");
    writeFileSync(join(dir, 'src', 'cycle.ts'), "export * from './index.ts';");
    writeFileSync(join(dir, 'test', 'guard.test.ts'), "import { guard } from '@openhbam/demo';");
    writeFileSync(join(dir, 'test', 'renamed.test.ts'), "import { guard } from '@tabularius/demo';");
    writeFileSync(join(dir, 'test', 'other.test.ts'), 'export {};');
    assert.deepEqual(importingTests(root, join(dir, 'src', 'guard.ts')), [join(dir, 'test', 'guard.test.ts'), join(dir, 'test', 'renamed.test.ts')]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('load guard waits above 90, admits exactly 90, and stops after twenty minutes', async () => {
  let now = 0, polls = 0;
  await waitForLoad(() => ++polls < 3 ? 91 : 90, async (ms) => { now += ms; }, () => now, () => {});
  assert.equal(now, 60_000);
  now = 0;
  await assert.rejects(waitForLoad(() => 91, async (ms) => { now += ms; }, () => now, () => {}), /20 minutes/);
  assert.equal(now, 1_200_000);
  await assert.rejects(waitForLoad(() => { throw new Error('sysctl unavailable'); }), /sysctl unavailable/);
});

test('test subprocess failures and hard deadlines are distinct', async () => {
  assert.equal((await command(['-e', 'process.exit(0)'], 10000)).status, 'passed');
  assert.equal((await command(['-e', 'process.exit(1)'], 10000)).status, 'failed');
  assert.equal((await command(['-e', 'setInterval(() => {}, 1000)'], 500)).status, 'timeout');
});

// The sandbox's child and worker programs are raw templates; these mutations must
// reach the generated program without changing its quoting or parameterised calls.
test('explicit raw JavaScript templates round-trip parameterised programs', () => {
  for (const parameters of ['', 'value', 'value, limit = 3']) {
    const program = `function guard(${parameters}) { if (value >= limit) throw new Error("no"); return value; }`;
    const source = 'const CHILD = String.raw`' + program + '`;';
    const ms = mutations(source, ['CHILD']);
    assert.ok(ms.some((m) => m.kind === 'raw-CHILD-throw'));
    assert.deepEqual(mutations(source), []);
    for (const m of ms) {
      const changed = applyMutation(source, m);
      assert.equal(rawTemplate(changed, 'CHILD').source, program.slice(0, m.start - rawTemplate(source, 'CHILD').start) + m.after + program.slice(m.end - rawTemplate(source, 'CHILD').start));
      assert.equal(changed.slice(0, m.start) + m.before + changed.slice(m.start + m.after.length), source);
    }
  }
  assert.throws(() => mutations('const CHILD = String.raw`x ${value}`;', ['CHILD']), /Interpolated/);
  assert.throws(() => mutations('const x = 1;', ['CHILD']), /Missing/);
});


test('invalid TypeScript and invalid embedded programs cannot count as test kills', () => {
  assert.throws(() => syntaxSource('class Guard { function Object() { [native code] } }'));
  assert.throws(() => syntaxSource('const CHILD = String.raw`const broken = ;`;', ['CHILD']));
  assert.match(syntaxSource('export const value: number = 1;'), /export const value\s*= 1;/);
});
