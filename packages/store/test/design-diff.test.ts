// diffDesigns reads two designs written as text and says what changed in terms a reviewer uses: script steps,
// fields, layout objects, relationships. Identical designs say so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { designText, diffDesigns, importFmp12, lineDiff, Store } from '../src/index.ts';

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const skip = existsSync(join(fixtures, 'Flicks.fmp12')) ? false : 'fixtures missing: run npm run fixtures';

function design(t: { after: (fn: () => void) => void }): { store: Store; text: () => Map<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-design-diff-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Flicks.tabularius');
  importFmp12(join(fixtures, 'Flicks.fmp12'), path);
  const store = new Store(path);
  t.after(() => store.close());
  return { store, text: () => designText({ schema: store.schema, layouts: store.designs().layouts, accounts: store.accounts(), privilegeSets: store.privilegeSets() }) };
}

test('line differences: removed and added lines in order, with line numbers', () => {
  assert.deepEqual(lineDiff(['a', 'b', 'c'], ['a', 'x', 'c']), [{ op: '-', at: 2, line: 'b' }, { op: '+', at: 2, line: 'x' }]);
  assert.deepEqual(lineDiff(['a'], ['a']), []);
  assert.deepEqual(lineDiff([], ['a', 'b']).map((d) => d.op), ['+', '+']);
});

test('the same design has no differences', { skip }, (t) => {
  const { text } = design(t);
  assert.deepEqual(diffDesigns(text(), text()), { lines: ['No differences.'], changes: 0 });
});

test('a script change reads step by step, and a rename reads as a rename', { skip }, (t) => {
  const { store, text } = design(t);
  const before = text();
  const script = store.schema.scripts.find((s) => s.steps.length > 2)!;
  store.applyDesign([{ op: 'updateScript', script: script.id, name: `${script.name} v2`, text: `# changed\n${(before.get([...before.keys()].find((k) => k.startsWith('scripts/') && before.get(k)!.startsWith(`# Script: ${script.name} (id ${script.id})`))!)!).split('\n').slice(2).join('\n')}` }]);
  const d = diffDesigns(before, text());
  const out = d.lines.join('\n');
  assert.match(out, /^Scripts$/m);
  assert.match(out, new RegExp(`~ ${script.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} → ${script.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} v2`));
  assert.match(out, /\+\s+3\s+# changed/);
  assert.ok(d.changes >= 1, 'callers by name are reported too');
});

test('fields, relationships and layout objects are reported by name', { skip }, (t) => {
  const { store, text } = design(t);
  const before = text();
  const table = store.schema.tables[0];
  store.applyDesign([
    { op: 'createField', table: table.id, name: 'Reviewer note', type: 'text', comment: 'added for review' },
    { op: 'updateField', table: table.id, field: table.fields[0].id, comment: 'now commented' },
  ]);
  const layout = store.schema.layouts[0];
  const d0 = store.designs().layouts.find((l) => l.id === layout.id)!;
  void d0;
  const out = diffDesigns(before, text()).lines.join('\n');
  assert.match(out, /^Tables$/m);
  assert.match(out, /\+ field Reviewer note \(text, normal\)/);
  assert.match(out, new RegExp(`field ${table.fields[0].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}  ~ comment: .* → now commented`));
});

test('a layout object change reads by the object, not the JSON line', { skip }, (t) => {
  const { store, text } = design(t);
  const before = text();
  const path = [...before.keys()].find((k) => k.startsWith('layouts/') && /"objects": \[\s*\{/.test(before.get(k)!))!;
  const json = JSON.parse(before.get(path)!);
  const first = json.objects[0];
  const after = new Map(before).set(path, JSON.stringify({ ...json, objects: [{ ...first, bounds: { ...first.bounds, left: first.bounds.left + 5 } }, ...json.objects.slice(1)] }, null, 2) + '\n');
  const out = diffDesigns(before, after).lines.join('\n');
  assert.match(out, /^Layouts$/m);
  assert.match(out, new RegExp(`objects#${first.id}.*\\.bounds\\.left: ${first.bounds.left} → ${first.bounds.left + 5}`));
  void store;
});

test('relationships and occurrences are reported by name', { skip }, (t) => {
  const { text } = design(t);
  const before = text();
  const rel = before.get('relationships.txt')!;
  const after = new Map(before).set('relationships.txt', rel.replace('\nRelationships\n', 'Extra → MOVIE\n\nRelationships\n').replace(/\n$/, '') + '\n\nMOVIE ↔ Extra\n  MOVIE::ID = Extra::ID\n');
  const out = diffDesigns(before, after).lines.join('\n');
  assert.match(out, /^Relationships$/m);
  assert.match(out, /\+ occurrence Extra → MOVIE/);
  assert.match(out, /\+ relationship MOVIE ↔ Extra/);
});

test('removed and added objects are listed', { skip }, (t) => {
  const { text } = design(t);
  const before = text();
  const gone = [...before.keys()].find((k) => k.startsWith('value-lists/'))!;
  const after = new Map(before);
  after.delete(gone);
  after.set('value-lists/Brand new.txt', 'Value list: Brand new (id 9999)\n\none\ntwo\n');
  const out = diffDesigns(before, after).lines.join('\n');
  assert.match(out, /^  - .*\(value-lists\//m);
  assert.match(out, /^  \+ Brand new {2}\(value-lists\/Brand new\.txt\)/m);
});
