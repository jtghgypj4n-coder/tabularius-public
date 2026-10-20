// The design as a folder of text files for git: the same design always gives
// the same text, data changes leave it alone, and nothing secret is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { designText, importFmp12, stableJson, Store, writeDesignText, DESIGN_MANIFEST } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

function hosted(t: { after: (fn: () => void) => void }): Store {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-design-text-'));
  t.after(() => rmSync(dir, { recursive: true }));
  const path = join(dir, 'Charts.tabularius');
  importFmp12(fixture, path);
  const store = new Store(path);
  t.after(() => store.close());
  return store;
}
const source = (s: Store) => ({ schema: s.schema, layouts: s.designs().layouts, accounts: s.accounts(), privilegeSets: s.privilegeSets() });

test('stable JSON sorts keys and leaves out undefined', () => {
  assert.equal(stableJson({ b: 1, a: { d: [1, { z: 1, y: undefined }], c: 'x' } }), stableJson({ a: { c: 'x', d: [1, { z: 1 }] }, b: 1 }));
  assert.equal(stableJson({}), '{}');
  assert.equal(stableJson([]), '[]');
});

test('one file per object, the same text every time, and no password or verifier', { skip }, (t) => {
  const store = hosted(t);
  store.setPassword('clerk1', 'Clerk-pw-123456', '[Full Access]');
  const files = designText(source(store));
  assert.deepEqual([...designText(source(store))], [...files]);
  for (const tbl of store.schema.tables) assert.ok([...files.keys()].some((p) => p.startsWith('tables/') && p.includes(tbl.name)), tbl.name);
  assert.equal([...files.keys()].filter((p) => p.startsWith('layouts/')).length, store.schema.layouts.length);
  assert.ok(files.has('relationships.txt') && files.has('accounts.txt') && files.has('file.json'));
  for (const [p, text] of files) {
    assert.ok(text.endsWith('\n'), p);
    assert.doesNotMatch(text, /passwordVerifier|scrypt\$|Clerk-pw/, p);
  }
  assert.match(files.get('accounts.txt')!, /^clerk1\t\[Full Access\]\tPassword$/m);
});

test("a serial number's next value is left out, so new records change nothing", { skip }, (t) => {
  const store = hosted(t);
  const schema = structuredClone(store.schema);
  const field = schema.tables[0].fields[0];
  field.options = { global: false, unstored: false, repetitions: 1, autoEnter: { serial: { next: '41', increment: 1 } } };
  const one = designText({ ...source(store), schema }).get(`tables/${schema.tables[0].name}.txt`)!;
  field.options.autoEnter!.serial!.next = '42';
  const two = designText({ ...source(store), schema }).get(`tables/${schema.tables[0].name}.txt`)!;
  assert.equal(one, two);
  assert.match(one, /"increment": 1/);
  assert.doesNotMatch(one, /"next"|"global"|"repetitions"/);
});

test('names that clash or hold path characters get their own safe files', { skip }, (t) => {
  const store = hosted(t);
  const schema = structuredClone(store.schema);
  const base = schema.scripts[0] ?? { id: 1, name: 'x', steps: [] };
  schema.scripts = [
    { ...base, id: 9001, name: '../../etc/passwd' },
    { ...base, id: 9002, name: 'Report' },
    { ...base, id: 9003, name: 'REPORT' },
    { ...base, id: 9004, name: 'CON' },
  ];
  schema.scriptOrder = [];
  const paths = [...designText({ ...source(store), schema }).keys()].filter((p) => p.startsWith('scripts/')).sort();
  assert.deepEqual(paths, ['scripts/.._.._etc_passwd.txt', 'scripts/REPORT (id 9003).txt', 'scripts/Report.txt', 'scripts/_CON.txt']);
});

test('writing again updates changed files, removes ones for deleted objects, and leaves other files alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-design-out-'));
  try {
    writeFileSync(join(dir, 'README.md'), 'mine\n');
    const first = writeDesignText(dir, new Map([['tables/A.txt', 'a\n'], ['scripts/Old/One.txt', 'one\n']]));
    assert.deepEqual(first.written.sort(), ['scripts/Old/One.txt', 'tables/A.txt']);
    const again = writeDesignText(dir, new Map([['tables/A.txt', 'a\n'], ['scripts/Old/One.txt', 'one\n']]));
    assert.deepEqual(again, { written: [], unchanged: 2, removed: [] });
    const next = writeDesignText(dir, new Map([['tables/A.txt', 'a2\n'], ['scripts/New.txt', 'new\n']]));
    assert.deepEqual(next.written.sort(), ['scripts/New.txt', 'tables/A.txt']);
    assert.deepEqual(next.removed, ['scripts/Old/One.txt']);
    assert.equal(existsSync(join(dir, 'scripts', 'Old')), false, 'the emptied folder goes too');
    assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), 'mine\n');
    assert.equal(readFileSync(join(dir, DESIGN_MANIFEST), 'utf8'), 'scripts/New.txt\ntables/A.txt\n');
    assert.throws(() => writeDesignText(dir, new Map([['../outside.txt', 'x']])), /inside the folder/);
    // A manifest naming a path outside the folder never deletes it.
    writeFileSync(join(dir, DESIGN_MANIFEST), '../../keep-me\n');
    assert.deepEqual(writeDesignText(dir, new Map()).removed, []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
