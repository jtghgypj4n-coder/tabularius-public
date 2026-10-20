// #1567: exercise only generated entries, never treeEntries/auditTree or git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audit, globToRegExp, isProgramFile, loadAllowList, type Entry } from '../../../scripts/release-audit.ts';

const entry = (path: string, mode = 0o644): Entry => {
  const data = Buffer.from('{}\n');
  return { path, data, size: data.length, mode };
};

// These exact path/mode decisions are project policy; see KNOWN K1 in the report.
test('font allowance does not waive executable or symlink checks', () => {
  for (const kind of ['pack', 'tree'] as const) {
    const scope = loadAllowList()[kind];
    const font = entry('packages/scripts/fonts/Generated Font.ttf');
    assert.deepEqual(audit([font], { kind, scope }), []);
    assert.equal(isProgramFile(font.path), true);
    assert.deepEqual(audit([{ ...font, mode: 0o755 }], { kind, scope }).map((f) => f.rule), ['executable']);
    assert.deepEqual(audit([{ ...font, link: '../outside' }], { kind, scope }).map((f) => f.rule), ['symlink']);
    const allowed = (path: string) => scope.allow.some(({ glob }) => globToRegExp(glob).test(path));
    // The tree already allows packages/**; only the pack restricts this directory.
    assert.equal(allowed('packages/scripts/fonts/nested/font.ttf'), kind === 'tree');
    assert.equal(allowed('packages/scripts/fonts-extra/font.ttf'), kind === 'tree');
  }
});

test('audit measurements are allowed in the tree but excluded from the release pack', () => {
  const measurement = entry('notes/audits/generated-review.json');
  const list = loadAllowList();
  assert.deepEqual(audit([measurement], { kind: 'tree', scope: list.tree }), []);
  assert.deepEqual(audit([measurement], { kind: 'pack', scope: list.pack }).map((f) => f.rule), ['unlisted-file']);
  assert.equal(isProgramFile(measurement.path), false);
  assert.deepEqual(audit([entry('notes/audits/nested/generated-review.json')], { kind: 'tree', scope: list.tree }).map((f) => f.rule), ['unlisted-file']);
});
