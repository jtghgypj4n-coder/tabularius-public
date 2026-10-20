// PR #1311 adversarial follow-up. Only generated files and in-process doubles;
// neither git nor an installer/service is executed. Sources: audit-review-round3.md.
import { after, before, test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, win32, posix } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { audit, isDependencyDebris, isProgramFile, treeEntries, type Scope } from '../../../scripts/release-audit.ts';

const scope: Scope = { allow: [{ glob: '**', why: 'synthetic audit input' }], executable: [], maxBytes: 1024, larger: [], exceptions: [], emails: [] };
const root = join(import.meta.dirname, '../../..');
const guard = mkdtempSync(join(tmpdir(), 'tabularius-r28-12-guard-'));
const marker = join(guard, 'unexpected-command');
const previousPath = process.env.PATH;
const previousMarker = process.env.TABULARIUS_TEST_COMMAND_MARKER;
before(() => {
  for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(guard, name), '#!/bin/sh\n: > "$TABULARIUS_TEST_COMMAND_MARKER"\nexit 99\n', { mode: 0o755 });
    writeFileSync(join(guard, `${name}.cmd`), '@echo off\r\necho blocked>"%TABULARIUS_TEST_COMMAND_MARKER%"\r\nexit /b 99\r\n');
  }
  process.env.PATH = guard;
  process.env.TABULARIUS_TEST_COMMAND_MARKER = marker;
});
after(() => {
  try { assert.equal(existsSync(marker), false, 'no external command may run'); }
  finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousMarker === undefined) delete process.env.TABULARIUS_TEST_COMMAND_MARKER;
    else process.env.TABULARIUS_TEST_COMMAND_MARKER = previousMarker;
    rmSync(guard, { recursive: true, force: true });
  }
});

function syntheticTree(t: TestContext, paths: string[], mode = '100644'): string {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-r28-12-tree-'));
  const tree = join(dir, 'tree');
  mkdirSync(tree);
  const index = paths.map((path) => `${mode} ${'0'.repeat(40)} 0\t${path}\0`).join('');
  // Replace the imported builtin before calling treeEntries; this returns only
  // our synthetic index and cannot fall through to a subprocess.
  const mocked = t.mock.method(childProcess, 'execFileSync', (command: unknown, args: unknown) => {
    assert.equal(command, 'git');
    assert.deepEqual(args, ['-C', tree, 'ls-files', '-s', '-z']);
    return index;
  });
  syncBuiltinESMExports();
  t.after(() => {
    mocked.mock.restore();
    syncBuiltinESMExports();
    rmSync(dir, { recursive: true, force: true });
  });
  return tree;
}

for (const targetKind of ['relative', 'absolute', 'dangling'] as const) {
  test(`tree audit refuses ${targetKind} symlinks replacing indexed regular files`, (t) => {
    const tree = syntheticTree(t, ['guide.md']);
    const outside = join(dirname(tree), 'generated.txt');
    writeFileSync(outside, 'SYNTHETIC OUTSIDE CONTENT\n');
    const target = targetKind === 'absolute' ? outside : targetKind === 'relative' ? '../generated.txt' : '../absent.txt';
    symlinkSync(target, join(tree, 'guide.md'));
    const entries = treeEntries(tree);
    assert.equal(entries[0].link, target);
    assert.equal(entries[0].data.length, 0, 'do not read the symlink target');
    assert.deepEqual(audit(entries, { kind: 'tree', scope }).map((f) => f.rule), ['symlink']);
  });
}

test('tree audit refuses an ancestor symlink before reading an indexed descendant', (t) => {
  const tree = syntheticTree(t, ['docs/nested/guide.md']);
  const outside = join(dirname(tree), 'generated');
  mkdirSync(join(outside, 'nested'), { recursive: true });
  writeFileSync(join(outside, 'nested/guide.md'), 'SYNTHETIC OUTSIDE CONTENT\n');
  symlinkSync('../generated', join(tree, 'docs'), 'dir');
  const entries = treeEntries(tree);
  assert.equal(entries[0].link, '../generated');
  assert.equal(entries[0].data.length, 0);
  assert.deepEqual(audit(entries, { kind: 'tree', scope }).map((f) => f.rule), ['symlink']);
});

test('tree audit still reads regular Unicode paths containing a tab', (t) => {
  const tree = syntheticTree(t, ['docs/café\tguide.md']);
  mkdirSync(join(tree, 'docs'));
  writeFileSync(join(tree, 'docs/café\tguide.md'), 'Generated documentation.\n');
  assert.equal(treeEntries(tree)[0].data.toString(), 'Generated documentation.\n');
  assert.deepEqual(audit(treeEntries(tree), { kind: 'tree', scope }), []);
});

test('committed symlinks remain findings without reading their targets', (t) => {
  const tree = syntheticTree(t, ['guide.md'], '120000');
  symlinkSync('absent.md', join(tree, 'guide.md'));
  const entries = treeEntries(tree);
  assert.equal(entries[0].link, 'absent.md');
  assert.equal(entries[0].data.length, 0);
  assert.deepEqual(audit(entries, { kind: 'tree', scope }).map((f) => f.rule), ['symlink']);
});

test('release selection keeps lookalike runtime names and excludes nested tooling', () => {
  for (const name of ['test', 'e2e', 'evals', 'bench']) {
    assert.equal(isProgramFile(`packages/a/src/deep/${name}/generated.ts`), false);
    assert.equal(isProgramFile(`packages/a/src/${name}-adapter.ts`), true);
  }
  for (const file of ['node_modules/@demo/a/node_modules/b/dist/nested.js.map', 'node_modules/@demo/a/.prettierrc.json']) {
    assert.equal(isDependencyDebris(file), true);
  }
  for (const file of ['packages/a/src/maps.js.map', 'node_modules/@demo/a/LICENSE.md', 'node_modules/@demo/a/dist/map-reader.js']) {
    assert.equal(isDependencyDebris(file), false);
  }
});

test('dependency installation suppresses scripts on all platform and npm-location branches', () => {
  const source = ts.createSourceFile('service.ts', readFileSync(join(root, 'packages/cli/src/service.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'installDependencies');
  assert.ok(fn);
  const javascript = ts.transpileModule(fn.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  for (const platform of ['linux', 'darwin', 'win32']) for (const local of [false, true]) for (const status of [0, 99, null]) {
    const paths = platform === 'win32' ? win32 : posix;
    const execPath = platform === 'win32' ? 'C:\\Program Files\\Synthetic\\node.exe' : '/synthetic runtime/node';
    let calls = 0;
    const invoke = () => runInNewContext(`${javascript}\ninstallDependencies('synthetic app');`, {
      join: paths.join, dirname: paths.dirname, existsSync: () => local,
      process: { platform, execPath, env: { PATH: guard, npm_config_ignore_scripts: 'false' } },
      spawnSync: (command: string, args: string[], options: { cwd: string; shell: boolean }) => {
        calls++;
        const npm = platform === 'win32' ? 'npm.cmd' : 'npm';
        assert.equal(command, local ? paths.join(paths.dirname(execPath), npm) : npm);
        assert.deepEqual(Array.from(args), ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
        assert.equal(options.cwd, 'synthetic app');
        assert.equal(options.shell, platform === 'win32');
        return { status };
      },
    });
    if (status === 0) assert.doesNotThrow(invoke);
    else assert.throws(invoke, /installing the dependencies failed/);
    assert.equal(calls, 1);
  }
});
