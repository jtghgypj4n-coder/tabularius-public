import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { allowlistErrors, collectDangerousApis, validateAllowlist, type DangerousFinding } from '../../../scripts/dangerous-apis.ts';

function fixture(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'dangerous-apis-'));
  mkdirSync(join(root, 'packages/server/src'), { recursive: true });
  writeFileSync(join(root, 'packages/server/src/probe.ts'), source);
  return root;
}

test('finds dynamic execution, shell child processes and bare caught error logging', () => {
  const root = fixture(`import { spawn } from 'node:child_process';
function dynamic(input: string) { eval(input); return Function(input); }
function shell() { spawn('tool', [], { shell: true }); }
function logged() { try { work(); } catch (err) { console.error(err); } }
`);
  try {
    const found = collectDangerousApis(root);
    assert.deepEqual(found.map((f) => f.kind).sort(), ['dynamic-code', 'dynamic-code', 'shell-child-process', 'uncaught-error-log']);
    assert.deepEqual([...new Set(found.map((f) => f.fn))].sort(), ['dynamic', 'logged', 'shell']);
    assert.deepEqual(validateAllowlist(found, []), { missing: found, stale: [], withoutReason: [] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ignores words in comments and strings', () => {
  const root = fixture(`// eval(x); spawn('x', { shell: true }); console.error(err)
const text = "eval(x); new Function(x); execSync('x', {shell:true}); console.error(error)";
`);
  try { assert.deepEqual(collectDangerousApis(root), []); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test('allowed findings pass, new findings fail, stale entries and blank reasons fail', () => {
  const finding: DangerousFinding = { file: 'packages/server/src/probe.ts', line: 2, fn: 'run', kind: 'dynamic-code', hash: 'abc' };
  const allowed = [{ file: finding.file, fn: finding.fn, kind: finding.kind, hash: finding.hash, reason: 'Reviewed test allowance' }];
  assert.deepEqual(validateAllowlist([finding], allowed), { missing: [], stale: [], withoutReason: [] });
  assert.deepEqual(validateAllowlist([finding], []), { missing: [finding], stale: [], withoutReason: [] });
  assert.match(allowlistErrors([finding], [])[0], /packages\/server\/src\/probe\.ts:2: dynamic-code in run/);
  assert.equal(validateAllowlist([], allowed).stale.length, 1);
  assert.equal(validateAllowlist([finding], [{ ...allowed[0], reason: '' }]).withoutReason.length, 1);
});
