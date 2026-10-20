// Design patches (store/src/patch.ts): what a change did, undone later only where nothing has changed since; and the
// name rules in store/src/security-names.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atPath, diffDesign, undoPatch } from '../src/patch.ts';
import { validAccountImportName, validPrivilegeSetName } from '../src/security-names.ts';

const design = () => ({
  name: 'Shop',
  tables: [
    { id: 1, name: 'Customers', fields: [{ id: 10, name: 'Name', comment: 'who' }, { id: 11, name: 'City' }] },
    { id: 2, name: 'Orders', fields: [{ id: 20, name: 'Total' }] },
  ],
  tags: ['a', 'b'],
});

test('diffDesign: equal designs have an empty patch; changed values are leaves addressed by id', () => {
  assert.deepEqual(diffDesign(design(), design()), { leaves: [], removed: [] });
  const after = design();
  after.tables[0].fields[0].name = 'Full name';
  const patch = diffDesign(design(), after);
  assert.deepEqual(patch.removed, []);
  assert.deepEqual(patch.leaves, [{ path: ['tables', { id: 1 }, 'fields', { id: 10 }, 'name'], before: 'Name', after: 'Full name' }]);
});

test('diffDesign: removed list elements keep their index and value; added and removed keys show as one-sided leaves', () => {
  const after = design() as Record<string, unknown> & ReturnType<typeof design>;
  after.tables[0].fields.splice(0, 1);
  delete (after.tables[0].fields[0] as { name?: string }).name;
  (after as Record<string, unknown>).extra = 5;
  const patch = diffDesign(design(), after);
  assert.equal(patch.removed.length, 1);
  assert.equal(patch.removed[0].index, 0);
  assert.deepEqual(patch.removed[0].path, ['tables', { id: 1 }, 'fields']);
  assert.equal(patch.removed[0].value.id, 10);
  const city = patch.leaves.find((l) => l.path.at(-1) === 'name')!;
  assert.deepEqual([city.before, 'after' in city], ['City', false]);
  assert.deepEqual(patch.leaves.find((l) => l.path[0] === 'extra'), { path: ['extra'], after: 5 });
});

test('undoPatch puts back what the change removed, at its place, and what it replaced', () => {
  const before = design();
  const after = design();
  after.tables[0].fields.splice(0, 1);
  after.tables[1].name = 'Sales';
  const patch = diffDesign(before, after);
  undoPatch(after, patch);
  assert.deepEqual(after, before);
});

test('undoPatch leaves alone a value changed since, and does not duplicate an element that came back', () => {
  const before = design();
  const after = design();
  after.tables[1].name = 'Sales';
  after.tables[0].fields.splice(1, 1);
  const patch = diffDesign(before, after);
  const later = structuredClone(after);
  later.tables[1].name = 'Revenue';
  later.tables[0].fields.push({ id: 11, name: 'Town' });
  undoPatch(later, patch);
  assert.equal(later.tables[1].name, 'Revenue', 'a later rename is kept');
  assert.equal(later.tables[0].fields.filter((f) => f.id === 11).length, 1);
  assert.equal(later.tables[0].fields.find((f) => f.id === 11)!.name, 'Town');
});

test('undoPatch still finds elements by id after the list was reordered', () => {
  const before = design();
  const after = design();
  after.tables[0].fields[1].name = 'Town';
  const patch = diffDesign(before, after);
  const later = structuredClone(after);
  later.tables[0].fields.reverse();
  undoPatch(later, patch);
  assert.equal(later.tables[0].fields.find((f) => f.id === 11)!.name, 'City');
});

test('undoPatch removes a key the change added, and restores copies, not shared objects', () => {
  const before = design() as ReturnType<typeof design> & { extra?: number };
  const after = { ...structuredClone(before), extra: 5 };
  const patch = diffDesign(before, after);
  undoPatch(after, patch);
  assert.equal('extra' in after, false);
  const gone = design();
  const removed = diffDesign(gone, { ...gone, tables: gone.tables.slice(1) });
  const target = { ...structuredClone(gone), tables: gone.tables.slice(1) };
  undoPatch(target, removed);
  target.tables[0].name = 'Changed';
  assert.equal(removed.removed[0].value.name, 'Customers', 'the patch keeps its own copy');
});

test('atPath follows names, positions and ids, and gives undefined for a missing step', () => {
  const d = design();
  assert.equal(atPath(d, ['tables', { id: 2 }, 'fields', { id: 20 }, 'name']), 'Total');
  assert.equal(atPath(d, ['tags', 1]), 'b');
  assert.equal(atPath(d, ['tables', { id: 9 }, 'name']), undefined);
  assert.equal(atPath(d, ['nope', 'deeper']), undefined);
  assert.equal(atPath(null, ['x']), undefined);
});

test('privilege set and account import names: plain text, trimmed, bounded, not starting like a formula', () => {
  for (const ok of ['Sales', 'Data Entry', 'Zoë', 'a'.repeat(256)]) {
    assert.ok(validPrivilegeSetName(ok), ok);
    assert.ok(validAccountImportName(ok), ok);
  }
  for (const bad of ['', ' Sales', 'Sales ', 'a'.repeat(257), 'a\u0000b', 'a\nb', 'a\u007fb', 'a\u0085b', '=SUM(A1)', '+1', '-1', '@cmd', '\ud800']) {
    assert.equal(validPrivilegeSetName(bad), false, JSON.stringify(bad));
    assert.equal(validAccountImportName(bad), false, JSON.stringify(bad));
  }
  assert.equal(validPrivilegeSetName(5), false);
  assert.equal(validPrivilegeSetName(undefined), false);
});
