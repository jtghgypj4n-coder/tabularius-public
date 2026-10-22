import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALLOWED_IMPORTS, committedProblems, DEV_LICENCES, KNOWN_LEAKS, layeringProblems, licenceAllowed, packageImports, licenceProblems, lockedPackages, RUNTIME_LICENCES } from '../../../scripts/dependency-gate.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');

test('the lock file has only licences we can ship', () => {
  const packages = lockedPackages(JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')));
  assert.ok(packages.some((p) => !p.dev), 'the lock file lists runtime packages');
  assert.deepEqual(licenceProblems(packages), []);
});

test('nothing is committed that must stay out of the repository', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\0').filter(Boolean);
  assert.deepEqual(committedProblems(files), []);
});

test('licence rules: copyleft and unknown are refused, an alternative we can take is accepted', () => {
  assert.ok(licenceAllowed('MIT', RUNTIME_LICENCES));
  assert.ok(licenceAllowed('(MIT OR GPL-3.0)', RUNTIME_LICENCES));
  assert.ok(!licenceAllowed('(MIT AND GPL-3.0)', RUNTIME_LICENCES));
  assert.ok(!licenceAllowed('GPL-3.0-only', RUNTIME_LICENCES));
  assert.ok(!licenceAllowed('AGPL-3.0', DEV_LICENCES));
  assert.ok(!licenceAllowed('UNKNOWN', DEV_LICENCES));
  assert.ok(!licenceAllowed('MPL-2.0', RUNTIME_LICENCES), 'a weak copyleft licence is fine for dev tools only');
  assert.ok(licenceAllowed('MPL-2.0', DEV_LICENCES));
});

test('licence rules read nested expressions: AND binds both sides, and unreadable text is refused', () => {
  assert.ok(!licenceAllowed('(MIT OR Apache-2.0) AND AGPL-3.0-only', RUNTIME_LICENCES));
  assert.ok(licenceAllowed('(GPL-2.0-only OR MIT) AND (ISC OR AGPL-3.0-only)', RUNTIME_LICENCES));
  assert.ok(licenceAllowed('MIT AND ISC', RUNTIME_LICENCES));
  assert.ok(!licenceAllowed('(MIT', RUNTIME_LICENCES));
  assert.ok(!licenceAllowed('MIT OR', RUNTIME_LICENCES));
  assert.ok(!licenceAllowed('', RUNTIME_LICENCES));
});

test('licenceProblems names a runtime package with a bad licence, and skips this repository\'s own packages', () => {
  const packages = lockedPackages({
    packages: {
      '': { version: '0.1.0' },
      'node_modules/@tabularius/calc': { link: true },
      'node_modules/left-pad': { version: '1.0.0', license: 'GPL-3.0' },
      'node_modules/a/node_modules/nested': { version: '2.0.0', license: 'MIT' },
      'node_modules/axe-core': { version: '4.0.0', license: 'MPL-2.0', dev: true },
      'node_modules/mystery': { version: '1.0.0' },
    },
  });
  assert.deepEqual(packages.map((p) => p.name), ['axe-core', 'left-pad', 'mystery', 'nested']);
  assert.deepEqual(licenceProblems(packages), [
    'left-pad@1.0.0 is GPL-3.0, which is not allowed in what ships',
    'mystery@1.0.0 is UNKNOWN, which is not allowed in what ships',
  ]);
});

test('committedProblems refuses sample files and FileMaker files anywhere', () => {
  assert.deepEqual(committedProblems(['packages/calc/src/a.ts', 'fixtures/README.md', 'docs/x/Sample.FMP12']), [
    'fixtures/README.md is committed, but fixtures/ is downloaded by npm run fixtures and never committed',
    'docs/x/Sample.FMP12 is committed, but FileMaker files are never committed',
  ]);
});

test('packages import only downward: no new upward import, and a fixed leak leaves KNOWN_LEAKS', () => {
  assert.deepEqual(layeringProblems(packageImports(ROOT)), []);
});

test('the layering gate names an upward import, ignores tests, and asks for a fixed leak to be removed', () => {
  const root = mkdtempSync(join(tmpdir(), 'layers-'));
  const write = (path: string, text: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text); };
  write('packages/calc/src/a.ts', "import { x } from '../../store/src/y.ts';\nimport { z } from '../../fmp12/src/z.ts';\nimport { l } from './local.ts';\n");
  write('packages/calc/test/a.test.ts', "import { x } from '../../store/src/y.ts';\n");
  write('packages/web/src/b.ts', "export type T = import('../../fmp12/src/t.ts').T;\n");
  write('packages/server/src/c.ts', "import { s } from '../../store/src/index.ts';\n");
  const found = packageImports(root, ALLOWED_IMPORTS);
  assert.deepEqual(found, ['packages/calc/src/a.ts -> store', 'packages/web/src/b.ts -> fmp12']);
  assert.match(layeringProblems(found, [])[0], /^packages\/calc\/src\/a\.ts -> store: a package may not import from a higher one/);
  assert.deepEqual(layeringProblems(found, found), []);
  assert.deepEqual(layeringProblems([], ['packages/x/src/q.ts -> web']), ['packages/x/src/q.ts -> web is fixed: delete it from KNOWN_LEAKS in scripts/dependency-gate.ts']);
  assert.ok(KNOWN_LEAKS.every((k) => /^packages\/[a-z0-9-]+\/.* -> [a-z0-9]+$/.test(k)));
});
