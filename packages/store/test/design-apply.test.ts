// A design folder read back: the plan from a folder that is the file's own export is empty, an edited file
// becomes the change that makes the file match it, and applying the plan then exporting again gives the folder.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesignApplyError, designText, importFmp12, planDesignApply, readDesignFolder, Store, writeDesignText } from '../src/index.ts';

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const have = (name: string) => existsSync(join(fixtures, name + '.fmp12'));
const skip = have('Standards') && have('Flicks') ? false : 'fixtures missing: run npm run fixtures';
const templateDir = mkdtempSync(join(tmpdir(), 'tabularius-design-apply-templates-'));
const templates = new Map<string, string>();
after(() => rmSync(templateDir, { recursive: true, force: true }));

function hosted(t: { after: (fn: () => void) => void }, name: string): Store {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-design-apply-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, name + '.openhbam');
  let template = templates.get(name);
  if (!template) {
    template = join(templateDir, name + '.openhbam');
    importFmp12(join(fixtures, name + '.fmp12'), template);
    templates.set(name, template);
  }
  // Every case gets an independent store; converting the unchanged public source is shared.
  copyFileSync(template, path);
  const store = new Store(path);
  t.after(() => store.close());
  return store;
}
const source = (s: Store) => ({ schema: s.schema, layouts: s.designs().layouts, accounts: s.accounts(), privilegeSets: s.privilegeSets() });
const exported = (s: Store) => designText(source(s));
function folder(t: { after: (fn: () => void) => void }, s: Store): string {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-design-folder-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeDesignText(dir, exported(s));
  return dir;
}
const edit = (dir: string, path: string, change: (text: string) => string) => {
  const full = join(dir, path);
  writeFileSync(full, change(readFileSync(full, 'utf8')));
};
const plan = (dir: string, s: Store, opts?: { remove?: boolean }) => planDesignApply(readDesignFolder(dir), source(s), opts);
const apply = (s: Store, p: ReturnType<typeof plan>) => s.applyDesign(p.ops, { account: 'test' });

for (const name of ['Standards', 'Flicks', 'DEMO_drawers', 'FMburgh_2012_11_07_Database', 'Charts']) {
  test(`${name}: the folder a file exports is nothing to apply`, { skip: skip || !have(name) && 'fixture missing' }, (t) => {
    const s = hosted(t, name);
    const p = plan(folder(t, s), s);
    assert.deepEqual(p.ops, []);
    assert.deepEqual(p.skipped, []);
    assert.equal(p.unchanged, exported(s).size);
  });
}

test('an edited script changes the script, and exporting again gives the folder', { skip }, (t) => {
  const s = hosted(t, 'Standards');
  const dir = folder(t, s);
  const target = s.schema.scripts.find((x) => x.steps.length > 2)!;
  const path = [...readDesignFolder(dir).keys()].find((p) => p.startsWith('scripts/') && readFileSync(join(dir, p), 'utf8').includes(`(id ${target.id})`))!;
  edit(dir, path, (text) => text.replace(/\n$/, '') + '\n# Added in git\n');
  const p = plan(dir, s);
  assert.equal(p.ops.length, 1);
  assert.equal(p.ops[0].op, 'updateScript');
  assert.match(p.lines[0], /Change script/);
  assert.equal(p.unchanged, exported(s).size - 1);
  apply(s, p);
  assert.deepEqual([...exported(s)].filter(([k]) => k === path), [[path, readFileSync(join(dir, path), 'utf8')]]);
  // Everything else about the script survived: steps that weren't touched keep their decoded options.
  assert.equal(s.schema.scripts.find((x) => x.id === target.id)!.steps.length, target.steps.length + 1);
  assert.deepEqual(plan(dir, s).ops, [], 'nothing left to do');
});

test('a script renamed in its header is renamed, not added', { skip }, (t) => {
  const s = hosted(t, 'Standards');
  const dir = folder(t, s);
  const target = s.schema.scripts[0];
  const path = [...readDesignFolder(dir).keys()].find((p) => readFileSync(join(dir, p), 'utf8').startsWith(`# Script: ${target.name} (id ${target.id})`))!;
  edit(dir, path, (text) => text.replace(`# Script: ${target.name} (id`, '# Script: Renamed in git (id'));
  const p = plan(dir, s);
  assert.deepEqual(p.ops, [{ op: 'updateScript', script: target.id, name: 'Renamed in git' }]);
  apply(s, p);
  assert.equal(s.schema.scripts.find((x) => x.id === target.id)!.name, 'Renamed in git');
});

test('a new script file is added, and a file left out removes nothing unless asked', { skip }, (t) => {
  const s = hosted(t, 'Standards');
  const dir = folder(t, s);
  writeFileSync(join(dir, 'scripts', 'From git.txt'), '# Script: From git\n\n# Made in a text editor\nSet Variable [ $x ; Value: 1 ]\n');
  const gone = [...readDesignFolder(dir).keys()].find((p) => p.startsWith('scripts/') && p !== 'scripts/From git.txt')!;
  rmSync(join(dir, gone));
  const kept = plan(dir, s);
  assert.deepEqual(kept.ops.map((o) => o.op), ['createScript']);
  assert.ok(kept.skipped.some((x) => x.startsWith(gone) && /--remove/.test(x)), kept.skipped.join('\n'));
  const removing = plan(dir, s, { remove: true });
  assert.deepEqual(removing.ops.map((o) => o.op), ['createScript', 'deleteScript']);
  apply(s, removing);
  assert.ok(s.schema.scripts.some((x) => x.name === 'From git' && x.steps.length === 2));
  // Written out again, the folder is what the file now exports.
  writeDesignText(dir, exported(s));
  assert.deepEqual(plan(dir, s).ops, []);
});

test('custom functions: edit, add, JavaScript, and a bad file is named', { skip }, (t) => {
  const s = hosted(t, 'Standards');
  const dir = folder(t, s);
  const cf = s.schema.customFunctions.find((c) => c.parameters.length && c.formula)!;
  const path = [...readDesignFolder(dir).keys()].find((p) => p.startsWith('custom-functions/') && readFileSync(join(dir, p), 'utf8').startsWith(cf.name + ' ('))!;
  edit(dir, path, (text) => text.replace(/\n$/, '') + '\n/* edited */\n');
  writeFileSync(join(dir, 'custom-functions', 'Twice.txt'), 'Twice ( x )\n\nx * 2\n');
  writeFileSync(join(dir, 'custom-functions', 'Slug.txt'), 'Slug ( s )  [JavaScript]\n\nreturn s.toLowerCase();\n');
  const p = plan(dir, s);
  assert.deepEqual(p.ops.map((o) => o.op), ['updateCustomFunction', 'createCustomFunction', 'createCustomFunction']);
  apply(s, p);
  assert.equal(s.schema.customFunctions.find((c) => c.name === 'Twice')!.formula, 'x * 2');
  assert.equal(s.schema.customFunctions.find((c) => c.name === 'Slug')!.language, 'javascript');
  assert.ok(s.schema.customFunctions.find((c) => c.id === cf.id)!.formula!.endsWith('/* edited */'));
  writeDesignText(dir, exported(s));
  assert.deepEqual(plan(dir, s).ops, []);
  writeFileSync(join(dir, 'custom-functions', 'Bad.txt'), '\n\nnothing\n');
  assert.throws(() => plan(dir, s), (e: unknown) => e instanceof DesignApplyError && /Bad\.txt/.test(e.message));
});

test('value lists: custom values and a list from a field', { skip }, (t) => {
  const s = hosted(t, 'Flicks');
  const dir = folder(t, s);
  const custom = s.schema.valueLists.find((v) => v.values?.length)!;
  const path = [...readDesignFolder(dir).keys()].find((p) => p.startsWith('value-lists/') && readFileSync(join(dir, p), 'utf8').startsWith(`Value list: ${custom.name} (id ${custom.id})`))!;
  edit(dir, path, (text) => text.replace(/\n$/, '') + '\nAdded value\n');
  const p = plan(dir, s);
  assert.equal(p.ops.length, 1);
  assert.deepEqual(p.ops[0], { op: 'updateValueList', valueList: custom.id, values: [...custom.values!, 'Added value'] });
  apply(s, p);
  assert.deepEqual(s.schema.valueLists.find((v) => v.id === custom.id)!.values, [...custom.values!, 'Added value']);
  writeDesignText(dir, exported(s));
  assert.deepEqual(plan(dir, s).ops, []);
  // A list from a field is read back through its occurrence and field names.
  const byField = s.schema.valueLists.find((v) => v.field && !v.field.secondFieldId);
  if (byField) {
    const fp = [...readDesignFolder(dir).keys()].find((q) => readFileSync(join(dir, q), 'utf8').startsWith(`Value list: ${byField.name} (id ${byField.id})`))!;
    edit(dir, fp, (text) => text + 'Sorted by the second field\n');
    assert.deepEqual(plan(dir, s).ops.map((o) => o.op), ['updateValueList']);
  }
});

test('a layout file changes the layout, including its name', { skip }, (t) => {
  const s = hosted(t, 'Flicks');
  const dir = folder(t, s);
  const layout = s.schema.layouts[0];
  const path = [...readDesignFolder(dir).keys()].find((p) => p.startsWith('layouts/') && JSON.parse(readFileSync(join(dir, p), 'utf8')).id === layout.id)!;
  edit(dir, path, (text) => { const j = JSON.parse(text); j.name = 'Renamed layout'; return JSON.stringify(j, null, 2) + '\n'; });
  const p = plan(dir, s);
  assert.deepEqual(p.ops.map((o) => o.op), ['updateLayout']);
  apply(s, p);
  assert.equal(s.schema.layouts.find((l) => l.id === layout.id)!.name, 'Renamed layout');
  writeDesignText(dir, exported(s));
  assert.deepEqual(plan(dir, s).ops, []);
  writeFileSync(join(dir, path.replace(/[^/]+$/, 'Broken.json')), '{ not json');
  assert.throws(() => plan(dir, s), (e: unknown) => e instanceof DesignApplyError && /Broken\.json/.test(e.message));
});

test('what text cannot carry is named, not guessed', { skip }, (t) => {
  const s = hosted(t, 'Standards');
  const dir = folder(t, s);
  const table = 'file.json';
  edit(dir, table, (text) => text + ' ');
  edit(dir, 'accounts.txt', (text) => text + 'Nobody\t[Full Access]\tPassword\n');
  const full = s.schema.scripts.find((x) => !x.fullAccess)!;
  const sp = [...readDesignFolder(dir).keys()].find((p) => readFileSync(join(dir, p), 'utf8').startsWith(`# Script: ${full.name} (id ${full.id})`))!;
  edit(dir, sp, (text) => text.replace(/^(# Script: .*\n)/, '$1# Run script with full access privileges\n'));
  const p = plan(dir, s);
  assert.deepEqual(p.ops, []);
  assert.equal(p.skipped.length, 3, p.skipped.join('\n'));
  assert.ok(p.skipped.some((x) => x.startsWith(table)));
  assert.ok(p.skipped.some((x) => x.startsWith('accounts.txt')));
  assert.ok(p.skipped.some((x) => x.includes('full access')));
});

test('Windows line ends from git change nothing', { skip }, (t) => {
  const s = hosted(t, 'Standards');
  const dir = folder(t, s);
  for (const path of readDesignFolder(dir).keys()) edit(dir, path, (text) => text.replace(/\n/g, '\r\n'));
  assert.deepEqual(plan(dir, s).ops, []);
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'scripts.txt'), 'ignored');
  assert.deepEqual(plan(dir, s).ops, []);
});

test('a change that is refused stops the whole apply, with nothing half-applied', { skip }, (t) => {
  const s = hosted(t, 'Standards');
  const dir = folder(t, s);
  writeFileSync(join(dir, 'custom-functions', 'Twice.txt'), 'Twice ( x )\n\nx * 2\n');
  writeFileSync(join(dir, 'scripts', 'Bad.txt'), '# Script: Bad\n\nNot A Real Step [ nonsense ]\n');
  const p = plan(dir, s);
  assert.deepEqual(p.ops.map((o) => o.op), ['createCustomFunction', 'createScript']);
  const before = s.schema.customFunctions.length;
  assert.throws(() => apply(s, p));
  assert.equal(s.schema.customFunctions.length, before, 'the function added before the refused script is not kept');
  assert.ok(!s.schema.scripts.some((x) => x.name === 'Bad'));
});

test('review fixes: keyword-looking values, mixed lists, duplicate ids, --remove on an empty folder', { skip }, (t) => {
  const s = hosted(t, 'Flicks');
  const dir = folder(t, s);
  const files = readDesignFolder(dir);
  const custom = s.schema.valueLists.find((v) => v.values?.length)!;
  const path = [...files.keys()].find((p) => p.startsWith('value-lists/') && files.get(p)!.startsWith(`Value list: ${custom.name} (id ${custom.id})`))!;
  const head = `Value list: ${custom.name} (id ${custom.id})\n\n`;
  // Values with a field line in the middle are refused, not read as a field list that drops the values.
  const mixed = new Map(files).set(path, head + 'a\nFrom field: Foo::Bar\nb\n');
  assert.throws(() => planDesignApply(mixed, source(s)), (e) => e instanceof DesignApplyError && /ambiguous/.test(e.message));
  const both = new Map(files).set(path, head + 'a\nFrom field: Foo::Bar\n');
  assert.throws(() => planDesignApply(both, source(s)), /not both/);
  // A list whose typed value reads like a keyword is left alone when edited.
  const store = hosted(t, 'Flicks');
  store.applyDesign([{ op: 'updateValueList', valueList: custom.id, values: ['a', 'From field: Foo::Bar', 'b'] }], { account: 'test' });
  const dir2 = folder(t, store);
  edit(dir2, path, (text) => text.replace(/\n$/, '') + '\nc\n');
  const p2 = plan(dir2, store);
  assert.deepEqual(p2.ops, []);
  assert.ok(p2.skipped.some((n) => /reads like a "From field:" line/.test(n)));
  // A file that names another file's object is called out, and two files naming one object are refused.
  const scripts = [...files.keys()].filter((p) => p.startsWith('scripts/'));
  if (scripts.length >= 2) {
    const [a, b] = scripts;
    const dup = new Map(files).set(a, files.get(a)! + '# changed\n').set(b, files.get(a)! + '# other\n');
    assert.throws(() => planDesignApply(dup, source(s)), /same script/);
  }
  assert.throws(() => planDesignApply(new Map(), source(s), { remove: true }), /needs a design folder/);
});

test('tables: a new table, a renamed table, and new or changed fields', { skip }, (t) => {
  const s = hosted(t, 'Flicks');
  const dir = folder(t, s);
  const files = readDesignFolder(dir);
  const table = s.schema.tables.find((x) => x.fields.some((f) => f.kind === 'normal' && f.type === 'text' && !f.comment))!;
  const path = [...files.keys()].find((p) => p.startsWith('tables/') && files.get(p)!.startsWith(`Table: ${table.name} (id ${table.id})`))!;
  const field = table.fields.find((f) => f.kind === 'normal' && f.type === 'text' && !f.comment && !f.options?.autoEnter)!;
  edit(dir, path, (text) => text
    .replace(`Table: ${table.name} (id ${table.id})`, `Table: ${table.name} Renamed (id ${table.id})`)
    .replace(new RegExp(`^${field.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`, 'm'), `${field.name}\n  Comment: from text\n`)
    + '\nBrand new\n  Type: number, normal\n  Comment: added in a text editor\n');
  writeFileSync(join(dir, 'tables/Fresh table.txt'), 'Table: Fresh table\n\nName\n  Type: text, normal\n\nTotal\n  Type: number, calculation\n  Formula:\n    Count ( Name )\n');
  const p = plan(dir, s);
  assert.deepEqual(p.ops.map((o) => o.op).sort(), ['createField', 'createTable', 'renameTable', 'updateField']);
  apply(s, p);
  const after = s.schema.tables.find((x) => x.id === table.id)!;
  assert.equal(after.name, `${table.name} Renamed`);
  assert.equal(after.fields.find((f) => f.name === field.name)!.comment, 'from text');
  assert.equal(after.fields.find((f) => f.name === 'Brand new')!.type, 'number');
  const fresh = s.schema.tables.find((x) => x.name === 'Fresh table')!;
  assert.equal(fresh.fields.find((f) => f.name === 'Total')!.calculation, 'Count ( Name )');
  // Exported again, the edited files read back as they are written.
  const again = folder(t, s);
  assert.equal(readFileSync(join(again, path.replace(table.name, `${table.name} Renamed`)), 'utf8').includes('Brand new'), true);
  assert.deepEqual(plan(again, s).ops, []);
});

test('tables: a field or table missing from its file stays, with a note', { skip }, (t) => {
  const s = hosted(t, 'Flicks');
  const dir = folder(t, s);
  const files = readDesignFolder(dir);
  const table = s.schema.tables.find((x) => x.fields.length > 1)!;
  const path = [...files.keys()].find((p) => p.startsWith('tables/') && files.get(p)!.startsWith(`Table: ${table.name} (id ${table.id})`))!;
  const last = table.fields[table.fields.length - 1];
  edit(dir, path, (text) => text.slice(0, text.lastIndexOf(`\n${last.name}\n`)) + '\n');
  const p = plan(dir, s, { remove: true });
  assert.deepEqual(p.ops.filter((o) => /delete(Field|Table)/.test(o.op)), []);
  assert.ok(p.skipped.some((n) => n.includes(`field "${last.name}" is not in the file`)), p.skipped.join('\n'));
});

test('relationships: a new occurrence and relationship, a changed match and option, and what stays', { skip }, (t) => {
  const s = hosted(t, 'Flicks');
  const dir = folder(t, s);
  const rels = s.schema.relationships;
  const first = rels[0];
  const lname = first.leftTableOccurrence!;
  const rname = first.rightTableOccurrence!;
  const leftTable = s.schema.tables.find((x) => x.id === s.schema.tableOccurrences.find((o) => o.name === lname)!.baseTableId)!;
  const rightTable = s.schema.tables.find((x) => x.id === s.schema.tableOccurrences.find((o) => o.name === rname)!.baseTableId)!;
  const lf = leftTable.fields.find((f) => f.kind === 'normal')!.name;
  const rf = rightTable.fields.find((f) => f.kind === 'normal')!.name;
  edit(dir, 'relationships.txt', (text) => text.replace('\nRelationships\n', `${leftTable.name} copy → ${leftTable.name}\n\nRelationships\n`).replace(/\n$/, '') + `\n\n${lname} ↔ ${leftTable.name} copy\n  ${lname}::${lf} = ${leftTable.name} copy::${lf}\n  Options: create in ${leftTable.name} copy\n`);
  const p = plan(dir, s);
  assert.deepEqual(p.ops.map((o) => o.op), ['createOccurrence', 'createRelationship'], p.skipped.join('\n'));
  apply(s, p);
  const added = s.schema.relationships.find((r) => r.rightTableOccurrence === `${leftTable.name} copy`)!;
  assert.equal(added.rightCreate, true);
  assert.equal(added.predicates[0].leftField, lf);
  // Exported again, the file reads back as it was written.
  writeDesignText(dir, exported(s));
  assert.deepEqual(plan(dir, s).ops, []);
  // A match changed to another operator and the option dropped; a relationship dropped from the file stays without --remove.
  edit(dir, 'relationships.txt', (text) => text.replace(`${lname}::${lf} = ${leftTable.name} copy::${lf}`, `${lname}::${lf} ≠ ${leftTable.name} copy::${lf}`).replace(`\n  Options: create in ${leftTable.name} copy`, ''));
  const q = plan(dir, s);
  assert.deepEqual(q.ops.map((o) => o.op), ['updateRelationship']);
  assert.equal((q.ops[0] as { rightCreate?: boolean }).rightCreate, false);
  apply(s, q);
  assert.equal(s.schema.relationships.find((r) => r.id === added.id)!.predicates[0].operator, '≠');
  assert.equal(s.schema.relationships.find((r) => r.id === added.id)!.rightCreate, undefined);
  edit(dir, 'relationships.txt', (text) => text.replace(new RegExp(`\\n${lname} ↔ ${leftTable.name} copy\\n  [^\\n]*\\n`), '\n'));
  const keep = plan(dir, s);
  assert.deepEqual(keep.ops.filter((o) => o.op === 'deleteRelationship'), []);
  assert.ok(keep.skipped.some((n) => /is not in the file; left in the file/.test(n)), keep.skipped.join('\n'));
  const gone = plan(dir, s, { remove: true });
  assert.deepEqual(gone.ops.map((o) => o.op), ['deleteRelationship']);
  void rf;
});

test('relationships: a new table with its own occurrence, and a file that cannot be read', { skip }, (t) => {
  const s = hosted(t, 'Flicks');
  const dir = folder(t, s);
  writeFileSync(join(dir, 'tables/Fresh table.txt'), 'Table: Fresh table\n\nName\n  Type: text, normal\n');
  edit(dir, 'relationships.txt', (text) => text.replace('\nRelationships\n', 'Fresh table → Fresh table\n\nRelationships\n'));
  const p = plan(dir, s);
  assert.deepEqual(p.ops.map((o) => o.op), ['createTable'], 'the occurrence comes with the table');
  edit(dir, 'relationships.txt', (text) => text + '\nbroken line\n');
  assert.throws(() => plan(dir, s), (e: unknown) => e instanceof DesignApplyError && /relationships\.txt/.test(e.message));
});

/** A field's block in a table file, with its Options (everything from the "  Options: " line on) changed by `change`; null removes the line. */
function editOptions(text: string, name: string, change: (o: Record<string, unknown>) => Record<string, unknown> | null): string {
  const lines = text.split('\n');
  const at = lines.indexOf(name);
  let end = at + 1;
  while (end < lines.length && (lines[end].startsWith(' ') || lines[end] === '')) end++;
  const block = lines.slice(at, end);
  const o = block.findIndex((l) => l.startsWith('  Options: '));
  const cur = o < 0 ? {} : JSON.parse([block[o].slice('  Options: '.length), ...block.slice(o + 1)].join('\n'));
  const next = change(cur);
  const kept = o < 0 ? block.filter((l) => l !== '') : block.slice(0, o);
  const out = next ? [...kept, '  Options: ' + JSON.stringify(next, null, 2).replace(/\n/g, '\n  ')] : kept;
  return [...lines.slice(0, at), ...out, ...(end < lines.length ? [''] : []), ...lines.slice(end).filter((l, n) => !(n === 0 && l === ''))].join('\n');
}

test('a field\'s Options line is read back: set, changed and removed, and exporting again gives the file', { skip }, (t) => {
  const s = hosted(t, 'DEMO_drawers');
  const dir = folder(t, s);
  const files = readDesignFolder(dir);
  const table = s.schema.tables.find((x) => x.fields.some((f) => f.kind === 'normal' && f.type === 'text' && !f.comment && /^\w+$/.test(f.name)))!;
  const path = [...files.keys()].find((p) => p.startsWith('tables/') && files.get(p)!.startsWith(`Table: ${table.name} (id ${table.id})`))!;
  const field = table.fields.find((f) => f.kind === 'normal' && f.type === 'text' && !f.comment && /^\w+$/.test(f.name))!;
  // An Options line gains a global setting, a default value and a value index; a new field is born with options.
  edit(dir, path, (text) => editOptions(text, field.name, (o) => ({ ...o, global: true, autoEnter: { data: 'hello' }, index: { value: true } }))
    + '\nWith options\n  Type: number, normal\n  Options: {"validation": {"notEmpty": true}}\n');
  const p = plan(dir, s);
  assert.deepEqual(p.ops.map((o) => o.op).sort(), ['createField', 'updateField']);
  assert.deepEqual(p.skipped.filter((n) => /Options/.test(n)), []);
  apply(s, p);
  const after = s.schema.tables.find((x) => x.id === table.id)!;
  const changed = after.fields.find((f) => f.name === field.name)!;
  assert.equal(changed.options?.global, true);
  assert.equal(changed.options?.autoEnter?.data, 'hello');
  assert.deepEqual(changed.options?.index, { value: true });
  assert.equal(after.fields.find((f) => f.name === 'With options')!.options?.validation?.notEmpty, true);
  // Exported again, it reads back as written and is nothing to apply.
  const again = folder(t, s);
  assert.deepEqual(plan(again, s).ops, []);
  // Taking options out of the line clears them, and the defaults come back.
  edit(again, path, (text) => editOptions(text, field.name, (o) => { const { global: _g, autoEnter: _a, index: _i, ...rest } = o; return rest; }));
  const q = plan(again, s);
  assert.equal(q.ops.length, 1);
  apply(s, q);
  const cleared = s.schema.tables.find((x) => x.id === table.id)!.fields.find((f) => f.name === field.name)!;
  assert.equal(cleared.options?.global, false);
  assert.equal(cleared.options?.autoEnter, undefined);
  assert.equal(cleared.options?.index, undefined);
  assert.equal(cleared.options?.indexLanguage, field.options?.indexLanguage);
  assert.deepEqual(plan(folder(t, s), s).ops, []);
});

test('a field\'s Options line that is not valid is refused with the field named', { skip }, (t) => {
  const s = hosted(t, 'Flicks');
  const files = readDesignFolder(folder(t, s));
  const table = s.schema.tables.find((x) => x.fields.some((f) => f.kind === 'normal'))!;
  const path = [...files.keys()].find((p) => p.startsWith('tables/') && files.get(p)!.startsWith(`Table: ${table.name} (id ${table.id})`))!;
  const bad = (options: string, message: RegExp) => {
    const d = folder(t, s);
    edit(d, path, (text) => text.replace(/\n$/, '') + `\nBroken\n  Type: text, normal\n  Options: ${options}\n`);
    assert.throws(() => plan(d, s), message);
  };
  bad('{"global": ', /Options of "Broken" are not valid JSON/);
  bad('[1]', /Options of "Broken" should be a JSON object/);
  bad('{"colour": 1}', /Options of "Broken" have no "colour"/);
  bad('{"global": "yes"}', /"global" in the Options of "Broken" should be a boolean/);
  bad('{"repetitions": 0}', /"repetitions" in the Options of "Broken" should be a whole number/);
  bad('{"__proto__": {}}', /Options of "Broken" have no "__proto__"/);
  bad('{"repetitions": 1.5}', /"repetitions" in the Options of "Broken" should be a whole number/);
});

test('a serial number keeps its next value when its Options line is edited', { skip: skip || !have('FMburgh_2012_11_07_Database') && 'fixture missing' }, (t) => {
  const s = hosted(t, 'FMburgh_2012_11_07_Database');
  const table = s.schema.tables.find((x) => x.fields.some((f) => f.options?.autoEnter?.serial))!;
  const field = table.fields.find((f) => f.options?.autoEnter?.serial)!;
  const next = field.options!.autoEnter!.serial!.next;
  const dir = folder(t, s);
  const path = [...readDesignFolder(dir).keys()].find((p) => p.startsWith('tables/') && readFileSync(join(dir, p), 'utf8').startsWith(`Table: ${table.name} (id ${table.id})`))!;
  edit(dir, path, (text) => editOptions(text, field.name, (o) => ({ ...o, autoEnter: { ...(o.autoEnter as object), serial: { ...((o.autoEnter as { serial: object }).serial), increment: 5 } } })));
  const p = plan(dir, s);
  assert.equal(p.ops.length, 1);
  apply(s, p);
  const after = s.schema.tables.find((x) => x.id === table.id)!.fields.find((f) => f.id === field.id)!.options!.autoEnter!.serial!;
  assert.equal(after.increment, 5);
  assert.equal(after.next, next);
});

test('a new table file\'s Options are checked like a new field\'s on an existing table', { skip }, (t) => {
  const s = hosted(t, 'DEMO_drawers');
  const dir = folder(t, s);
  const table = (options: string) => `Table: T2\n\nCopy\n  Type: text, normal\n  Options: ${options}\n`;
  const tryApply = (options: string) => { writeFileSync(join(dir, 'tables/T2.txt'), table(options)); return apply(s, plan(dir, s)); };
  assert.throws(() => tryApply('{"validation": {"type": "bogus"}}'), /strict data type/);
  assert.throws(() => tryApply('{"autoEnter": {"lookup": {"occurrenceId": 3, "fieldId": 2}}}'), /lookup/i);
  assert.throws(() => tryApply('{"indexLanguage": "../x"}'), /index language/i);
  assert.equal(s.schema.tables.some((x) => x.name === 'T2'), false);
  tryApply('{"validation": {"notEmpty": true}}');
  assert.equal(s.schema.tables.find((x) => x.name === 'T2')!.fields[0].options?.validation?.notEmpty, true);
});
