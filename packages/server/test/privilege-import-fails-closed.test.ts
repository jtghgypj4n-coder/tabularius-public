// A privilege set read from an .fmp12 file must never come across wider than the file meant. These tests build
// the file's privilege tree byte by byte (the reader's own Node type, no outside files), run it through the
// reader and the importer, and compare with what the documented bits allow:
//
// - every value of the record-access byte, the layout / value-list / script byte and the key-10 word;
// - trailing bytes, other lengths and bits no sample sets, none of which may add a permission;
// - an account's privilege-set id, which must not be read out of trailing bytes;
// - sets named like a built-in one, and an extended privilege Tabularius adds that a file cannot have;
// - random whole sets through the importer into the enforcement object, against an oracle written here.
//
// What FileMaker stores for "limited by calculation" record access, and for per-layout, per-value-list and
// per-script "Custom privileges", is not shown by any sample, so those forms are not decoded: they import as no
// access and the conversion report says so (see the last test).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { FmpDatabase, Node, privilegeOther, privilegeSets, readAccounts, type PrivilegeSet } from '../../fmp12/src/index.ts';
import { Privileges, fromFmp12, isFullAccess, validateDefinition, type PrivilegeDefinition } from '../../store/src/privileges.ts';
import { DESIGN_VERSION, type Store } from '../../store/src/index.ts';
import { conversionReport } from '../src/conversion.ts';
import { serve } from '../src/index.ts';

const bytes = (...b: number[]) => Uint8Array.from(b);
/** A name as the file stores it: ASCII is its own SCSU, then XORed with 0x5a. */
const stored = (name: string) => Uint8Array.from(Buffer.from(name, 'latin1'), (c) => c ^ 0x5a);

interface SetSpec {
  id: number;
  name: string;
  /** Key 2 (file-level record access); leave out for a "Custom privileges" set. */
  records?: Uint8Array;
  /** Key 10. */
  other?: Uint8Array;
  /** Child 9: keys 4 (layouts), 17 (scripts) and 33 (value lists). */
  layouts?: Uint8Array;
  scripts?: Uint8Array;
  valueLists?: Uint8Array;
  /** Per-table nodes for a custom set: table id -> key 2 and fields (field id -> access byte). */
  tables?: { id: number; records?: Uint8Array; fields?: [number, number][] }[];
}

const OK_DESIGN = bytes(0xdf);
const OK_VIEW = bytes(0xde);

function setNode(spec: SetSpec): Node {
  const n = new Node();
  n.kv.set(16, stored(spec.name));
  if (spec.records) n.kv.set(2, spec.records);
  if (spec.other) n.kv.set(10, spec.other);
  const c9 = new Node();
  if (spec.layouts) c9.kv.set(4, spec.layouts);
  if (spec.scripts) c9.kv.set(17, spec.scripts);
  if (spec.valueLists) c9.kv.set(33, spec.valueLists);
  n.children.set(9, c9);
  if (spec.tables) {
    const c5 = new Node();
    for (const t of spec.tables) {
      const tn = new Node();
      if (t.records) tn.kv.set(2, t.records);
      if (t.fields) {
        const fn = new Node();
        for (const [fid, access] of t.fields) fn.kv.set(fid, bytes(access));
        tn.children.set(5, fn);
      }
      c5.children.set(t.id, tn);
    }
    n.children.set(5, c5);
  }
  return n;
}

function setsNode(specs: SetSpec[]): Node {
  const root = new Node();
  for (const s of specs) root.children.set(s.id, setNode(s));
  return root;
}

/** Extended privilege catalog: keyword -> the privilege-set ids it is given to (as the file stores them, big-endian). */
function extendedNode(grants: Record<string, number[][]>): Node {
  const root = new Node();
  let id = 1;
  for (const [name, sets] of Object.entries(grants)) {
    const n = new Node();
    n.kv.set(16, stored(name));
    const c5 = new Node();
    for (const s of sets) c5.data.push(Uint8Array.from(s));
    n.children.set(5, c5);
    root.children.set(id++, n);
  }
  return root;
}

const decodeOne = (spec: SetSpec, ext?: Node): PrivilegeSet => privilegeSets(setsNode([spec]), ext)[0];
const plain = (over: Partial<SetSpec> = {}): SetSpec => ({ id: 7, name: 'Plain', records: bytes(0x10, 0x03), other: bytes(0x03, 0x04), layouts: OK_VIEW, scripts: bytes(0xd6), valueLists: bytes(0xd6), ...over });

// ---- record access byte -------------------------------------------------------------------------------------------

/** What the bits documented in schema.ts grant, before any pair or view rule: view 0x10, create 0x01, edit 0x04, delete 0x40. */
const documented = (b: number) => ({ view: !!(b & 0x10), create: !!(b & 0x01), edit: !!(b & 0x04), delete: !!(b & 0x40) });
const rank = (a: ReturnType<typeof documented>) => Object.values(a).filter(Boolean).length;
const allows = (got: ReturnType<typeof documented>, ceiling: ReturnType<typeof documented>) =>
  (Object.keys(got) as (keyof typeof got)[]).every((k) => !got[k] || ceiling[k]);

test('record access byte: only the bytes every sample holds are read in full; any other byte gives view at most, and is reported', () => {
  const full = { view: true, create: true, edit: true, delete: true };
  const viewOnly = { view: true, create: false, edit: false, delete: false };
  const none = { view: false, create: false, edit: false, delete: false };
  const known = new Map([[0x55, full], [0x10, viewOnly], [0x00, none]]);
  for (let b = 0; b < 256; b++) {
    const got = decodeOne(plain({ records: bytes(b, 0x03) }));
    const expected = known.get(b);
    if (expected) {
      assert.deepEqual(got.records, expected, `byte ${b.toString(16)}`);
      assert.equal(got.undecoded, undefined, `byte ${b.toString(16)} is one every sample holds`);
    } else {
      // The bit meanings other than view (0x10) are inferred, so nothing but view is granted for a byte no sample has.
      assert.deepEqual(got.records, { ...none, view: (b & 0x30) === 0x10 }, `byte ${b.toString(16)}`);
      assert.ok(got.undecoded?.some((u) => /file-level record access/.test(u)), `byte ${b.toString(16)} is reported`);
    }
    assert.ok(allows(got.records, documented(b)), `byte ${b.toString(16)} grants no more than the documented bits`);
    if (!got.records.view) assert.deepEqual([got.records.edit, got.records.delete], [false, false]);
  }
  // The second byte is 0x03 and the key two bytes long in every sample: any other form reads cautiously, even with a known first byte.
  for (const tail of [[], [0x00], [0xff], [0x03, 0x03], [0x03, 0xff, 0xff]]) {
    for (const b of [0x55, 0x10]) {
      const got = decodeOne(plain({ records: bytes(b, ...tail) }));
      assert.deepEqual(got.records, viewOnly, `${b.toString(16)} + ${tail}`);
      assert.ok(got.undecoded?.some((u) => /record access/.test(u)));
    }
  }
  // Unseen examples that are plausible in a real file: view and edit, create and delete without view.
  assert.deepEqual(decodeOne(plain({ records: bytes(0x14, 3) })).records, viewOnly);
  assert.deepEqual(decodeOne(plain({ records: bytes(0x05, 3) })).records, none);
  // An empty value is a form no sample shows. An absent key is a custom set, which has nothing at file level.
  assert.deepEqual(decodeOne(plain({ records: bytes() })).records, none);
  assert.ok(decodeOne(plain({ records: bytes() })).undecoded);
  assert.deepEqual(decodeOne(plain({ records: undefined })).records, none);
  assert.equal(decodeOne(plain({ records: undefined })).undecoded?.some((u) => /record access/.test(u)) ?? false, false);
  // A file-level value beside per-table entries: which wins is not known, so neither grants.
  const both = decodeOne(plain({ records: bytes(0x55, 3), tables: [{ id: 129, records: bytes(0x55) }] }));
  assert.deepEqual(both.records, none);
  assert.ok(both.undecoded?.some((u) => /together/.test(u)));
});

test('per-table record access uses the same reading', () => {
  for (let b = 0; b < 256; b++) {
    const got = decodeOne(plain({ records: undefined, tables: [{ id: 129, records: bytes(b, 0x03) }] }));
    const t = got.tableRecords![0];
    assert.ok(allows(t.records, documented(b)), `byte ${b.toString(16)}`);
    if (![0x55, 0x10, 0x00].includes(b)) {
      assert.deepEqual([t.records.create, t.records.edit, t.records.delete], [false, false, false], `byte ${b.toString(16)}`);
      assert.ok(got.undecoded?.some((u) => /table 129 record access/.test(u)));
    }
    if (!t.records.view) assert.deepEqual([t.records.edit, t.records.delete], [false, false]);
  }
  // The length of a per-table value is not known from any sample, so a lone known byte is read in full.
  assert.equal(decodeOne(plain({ records: undefined, tables: [{ id: 129, records: bytes(0x55) }] })).tableRecords![0].records.delete, true);
});

// ---- layouts, value lists, scripts --------------------------------------------------------------------------------

const LEVEL_RANK = { none: 0, viewOnly: 1, modifiable: 2 } as const;

test('layout, value-list and script bytes: only the four values every sample holds are read; anything else is no access and is reported', () => {
  // [modifiable, view only] as each key stores them in the samples: layouts df/de, value lists and scripts d7/d6.
  const seen = { layouts: [0xdf, 0xde], scripts: [0xd7, 0xd6], valueLists: [0xd7, 0xd6] } as const;
  const label = { layouts: 'layout', scripts: 'script', valueLists: 'value list' } as const;
  for (let b = 0; b < 256; b++) {
    for (const tail of [[], [0xdf], [0x00]]) {
      const got = decodeOne(plain({ layouts: bytes(b, ...tail), scripts: bytes(b, ...tail), valueLists: bytes(b, ...tail) }));
      for (const k of ['layouts', 'scripts', 'valueLists'] as const) {
        const [modify, view] = seen[k];
        const expected = tail.length ? 'none' : b === modify ? 'modifiable' : b === view ? 'viewOnly' : 'none';
        assert.equal(got[k], expected, `byte ${b.toString(16)} + ${tail} ${k}`);
        const understood = !tail.length && (b === modify || b === view);
        assert.equal(got.undecoded?.some((u) => u.startsWith(label[k] + ' access')) ?? false, !understood, `byte ${b.toString(16)} + ${tail} ${k} reported`);
        // Never wider than the reading before this check (bit 0 modifiable, else bit 1 view only).
        assert.ok(LEVEL_RANK[got[k]] <= (b & 1 ? 2 : b & 2 ? 1 : 0));
      }
    }
  }
  // Absent keys are not a form any sample has either.
  const absent = decodeOne({ id: 7, name: 'x', records: bytes(0x10, 3) });
  assert.deepEqual([absent.layouts, absent.scripts, absent.valueLists], ['none', 'none', 'none']);
  assert.equal(absent.undecoded?.filter((u) => /access \(not stored\)/.test(u)).length, 3);
  // A byte that would read as a grant in the other key (a layout byte on a script) is not understood there.
  assert.equal(decodeOne(plain({ layouts: bytes(0xd7), scripts: bytes(0xdf) })).layouts, 'none');
  assert.equal(decodeOne(plain({ layouts: bytes(0xd7), scripts: bytes(0xdf) })).scripts, 'none');
  // Child 9 with a key or child beyond the three: none of the three is trusted.
  const extra = privilegeSets(setsNode([plain({ id: 7, name: 'Extra', layouts: bytes(0xdf), scripts: bytes(0xd7), valueLists: bytes(0xd7) })]), undefined);
  const set7 = (extra as unknown as PrivilegeSet[])[0];
  assert.deepEqual([set7.layouts, set7.scripts, set7.valueLists], ['modifiable', 'modifiable', 'modifiable']);
  const root = setsNode([plain({ id: 7, name: 'Extra', layouts: bytes(0xdf), scripts: bytes(0xd7), valueLists: bytes(0xd7) })]);
  root.children.get(7)!.children.get(9)!.kv.set(5, bytes(1));
  const withKey = privilegeSets(root, undefined)[0];
  assert.deepEqual([withKey.layouts, withKey.scripts, withKey.valueLists], ['none', 'none', 'none']);
  assert.ok(withKey.undecoded?.some((u) => /child 9 holds more/.test(u)));
  const root2 = setsNode([plain({ id: 7, name: 'Extra', layouts: bytes(0xdf), scripts: bytes(0xd7), valueLists: bytes(0xd7) })]);
  root2.children.get(7)!.children.get(9)!.children.set(1, new Node());
  assert.deepEqual([privilegeSets(root2, undefined)[0].layouts], ['none']);
});

// ---- key 10 -------------------------------------------------------------------------------------------------------

test('key 10: all 65,536 two-byte words read as the documented bits; any other length is the restrictive default', () => {
  for (let w = 0; w < 65536; w++) {
    const got = privilegeOther(bytes(w >> 8, w & 255));
    assert.deepEqual(
      [got.printing, got.exporting, got.allowModifyPassword, got.idleDisconnect],
      [!!(w & 0x100), !!(w & 0x200), !!(w & 4), (w & 2) === 0], w.toString(16));
  }
  const restrictive = { printing: false, exporting: false, allowModifyPassword: false, idleDisconnect: true };
  for (const len of [0, 1, 3, 4, 6, 8, 9, 16]) {
    for (const fill of [0xff, 0x01, 0x03]) {
      const got = privilegeOther(new Uint8Array(len).fill(fill));
      assert.deepEqual({ printing: got.printing, exporting: got.exporting, allowModifyPassword: got.allowModifyPassword, idleDisconnect: got.idleDisconnect }, restrictive, `${len} bytes of ${fill}`);
      assert.equal(got.flags, undefined);
    }
  }
  assert.deepEqual(privilegeOther(undefined), { ...restrictive });
  const odd = decodeOne(plain({ other: new Uint8Array(8).fill(0xff) }));
  assert.equal(odd.printing, false);
  assert.ok(odd.undecoded?.some((u) => /other options/.test(u)));
  assert.equal(decodeOne(plain({ other: bytes(0x03, 0x04) })).undecoded, undefined);
});

// ---- extended privileges ------------------------------------------------------------------------------------------

test('extended privileges: each set gets its own, and fmmcp, which only Tabularius defines, is never imported', () => {
  const ext = extendedNode({ fmapp: [[7]], fmrest: [[7], [8], [0, 9]], FMMCP: [[7]], fmMcp: [[8]], custom_thing: [[8]] });
  const sets = privilegeSets(setsNode([plain({ id: 7, name: 'A' }), plain({ id: 8, name: 'B' }), plain({ id: 9, name: 'C' }), plain({ id: 10, name: 'D' })]), ext);
  const by = Object.fromEntries(sets.map((s) => [s.name, s]));
  assert.deepEqual(by.A.extendedPrivileges, ['fmapp', 'fmrest']);
  assert.deepEqual(by.B.extendedPrivileges, ['fmrest', 'custom_thing']);
  assert.deepEqual(by.C.extendedPrivileges, ['fmrest'], 'a leading zero byte is the same id');
  assert.deepEqual(by.D.extendedPrivileges, []);
  assert.ok(by.A.undecoded?.some((u) => /fmmcp/.test(u)) && by.B.undecoded?.some((u) => /fmmcp/.test(u)));
  assert.equal(by.D.undecoded, undefined);
  for (const s of sets) assert.ok(!s.extendedPrivileges.some((e) => e.toLowerCase() === 'fmmcp'));
  const imported = fromFmp12(by.A);
  assert.equal(new Privileges('a', imported, {}, () => { throw new Error('no other file'); }).has('fmmcp'), false);
});

// ---- names and accounts -------------------------------------------------------------------------------------------

test('a set named like a built-in one, but not that one, is not treated as it ([Full Access] has no checks)', () => {
  const sets = privilegeSets(setsNode([
    plain({ id: 1, name: '[Full Access]', records: bytes(0x55, 3), layouts: bytes(0xdf), scripts: bytes(0xd7), valueLists: bytes(0xd7) }),
    plain({ id: 2, name: '[Data Entry Only]' }),
    plain({ id: 3, name: '[Read-Only Access]' }),
    plain({ id: 5, name: '[Full Access]', records: bytes(0x10, 3) }),
    plain({ id: 6, name: '[full access]', records: bytes(0x10, 3) }),
    plain({ id: 7, name: '[Data Entry Only]' }),
  ]), undefined);
  assert.deepEqual(sets.slice(0, 3).map((s) => s.name), ['[Full Access]', '[Data Entry Only]', '[Read-Only Access]']);
  assert.equal(sets[0].undecoded, undefined);
  for (const s of sets.slice(3)) {
    assert.ok(!['[full access]', '[data entry only]', '[read-only access]'].includes(s.name.toLowerCase()), s.name);
    assert.ok(s.undecoded?.some((u) => /renamed/.test(u)));
    assert.equal(isFullAccess(fromFmp12(s)), false, s.name);
    assert.equal(fromFmp12(s).records.edit, false);
  }
  assert.equal(new Set(sets.map((s) => s.name.toLowerCase())).size, sets.length, 'names stay distinct, so accounts still resolve to the set they named by id');
  assert.equal(isFullAccess(fromFmp12(sets[0])), true);
});

function accountsNode(entries: { id: number; name: string; set?: Uint8Array }[]): Node {
  const root = new Node();
  for (const e of entries) {
    const n = new Node();
    n.kv.set(16, stored(e.name));
    if (e.set) n.kv.set(11, e.set);
    root.children.set(e.id, n);
  }
  return root;
}

test('an account\'s privilege-set id is the counted bytes and nothing else', () => {
  const idOf = (v: Uint8Array | undefined) => readAccounts(accountsNode([{ id: 2, name: 'a', set: v }]))[0].privilegeSetId;
  assert.equal(idOf(bytes(1, 1)), 1);
  assert.equal(idOf(bytes(1, 7)), 7);
  assert.equal(idOf(bytes(2, 0, 1)), 1);
  assert.equal(idOf(bytes(2, 1, 44)), 300);
  // Trailing bytes, a count that is too long or too short, and an id wider than any file has: no set.
  for (const bad of [bytes(1, 0, 1), bytes(1, 0, 0, 1), bytes(0, 1), bytes(2, 1), bytes(3, 1, 1), bytes(1), bytes(0), bytes(), bytes(5, 0, 0, 0, 0, 1), bytes(9, 0, 0, 0, 0, 0, 0, 0, 0, 1), bytes(255, 1)]) {
    assert.equal(idOf(bad), undefined, `[${[...bad]}]`);
  }
  assert.equal(idOf(undefined), undefined);
  // Property: a set id appears only when the count byte equals the number of bytes after it, at most four of them.
  let seed = 7;
  const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  for (let i = 0; i < 3000; i++) {
    const len = rnd(9);
    const v = Uint8Array.from({ length: len }, (_, k) => (k === 0 && rnd(3) ? len - 1 : rnd(256)));
    const id = idOf(v);
    const shapeOk = len >= 2 && v[0] === len - 1 && len <= 5;
    assert.equal(id !== undefined, shapeOk, `[${[...v]}]`);
    if (id !== undefined) assert.equal(id, [...v.subarray(1)].reduce((a, c) => a * 256 + c, 0));
  }
});

test('no two sets share a name, however it is cased, normalised or built, so an account cannot land on [Full Access] by name', () => {
  const fold = (n: string) => n.normalize('NFKC').toLowerCase();
  const sets = privilegeSets(setsNode([
    plain({ id: 1, name: 'Admins', records: bytes(0x55, 3), layouts: bytes(0xdf), scripts: bytes(0xd7), valueLists: bytes(0xd7) }),
    plain({ id: 2, name: '[Data Entry Only]' }),
    plain({ id: 3, name: '[Read-Only Access]' }),
    plain({ id: 9, name: 'admins' }),
    plain({ id: 10, name: 'ADMINS' }),
    plain({ id: 11, name: 'Admins (imported set 9)' }),
    plain({ id: 12, name: '\u00c9mile' }),
    plain({ id: 13, name: '\u00e9mile' }),
    plain({ id: 14, name: 'Admins (imported set 10)' }),
  ]), undefined);
  assert.equal(new Set(sets.map((s) => fold(s.name))).size, sets.length, sets.map((s) => s.name).join(' | '));
  const by = (id: number) => sets.find((s) => s.id === id)!;
  assert.equal(by(1).name, 'Admins', 'the built-in set keeps its name');
  assert.equal(by(1).undecoded, undefined);
  for (const id of [9, 10, 13]) assert.ok(by(id).undecoded?.some((u) => /renamed, access kept/.test(u)), `set ${id}`);
  // Looking an account's set up the way the store does (by id, then by name, first match, case-insensitively) lands on the set the account named.
  const store = (name: string) => sets.find((x) => x.name.toLowerCase() === name.toLowerCase());
  for (const s of sets) assert.equal(store(s.name)?.id, s.id, s.name);
  assert.equal(isFullAccess(fromFmp12(store(by(9).name)!)), false);
});

test('an account\'s malformed set id is reported, and the account has no set', () => {
  const [bad] = readAccounts(accountsNode([{ id: 2, name: 'Eve', set: bytes(1, 0, 1) }]));
  assert.equal(bad.privilegeSetId, undefined);
  assert.ok(bad.undecoded?.some((u) => /id stored as 010001/.test(u)));
  const [fine] = readAccounts(accountsNode([{ id: 2, name: 'Ann', set: bytes(1, 7) }]));
  assert.equal(fine.undecoded, undefined);
  const [none] = readAccounts(accountsNode([{ id: 2, name: 'Bob' }]));
  assert.equal(none.undecoded, undefined);
});

test('stores converted before this reading are refreshed: the design version moved', () => {
  assert.ok(DESIGN_VERSION >= 48);
});

// ---- the whole path: random sets into the enforcement object -----------------------------------------------------

const schema = {
  tables: [
    { id: 129, name: 'People', fields: [{ id: 1, name: 'Name' }, { id: 2, name: 'Salary' }, { id: 3, name: 'Notes' }] },
    { id: 130, name: 'Orders', fields: [{ id: 1, name: 'Total' }] },
  ],
} as unknown as Parameters<typeof fromFmp12>[1];

function lcg(seed: number) {
  let s = seed;
  return (n: number) => (s = (s * 1103515245 + 12345) & 0x7fffffff) % n;
}

test('random sets: the imported privileges are never wider than an oracle that reads only the documented bits', () => {
  const rnd = lcg(20261018);
  const pick = <T>(xs: T[]): T => xs[rnd(xs.length)];
  const rec = () => pick([bytes(0x55, 3), bytes(0x10, 3), bytes(0), bytes(rnd(256), 3), bytes(rnd(256)), bytes(rnd(256), rnd(256), rnd(256))]);
  const design = () => pick([bytes(0xdf), bytes(0xd7), bytes(0xde), bytes(0xd6), bytes(0xd4), bytes(rnd(256)), bytes(rnd(256), rnd(256)), bytes()]);
  const other = () => pick([bytes(0x03, 0x04), bytes(0x9f, 0xff), bytes(0x00, 0x01), bytes(rnd(256), rnd(256)), bytes(rnd(256), rnd(256), rnd(256))]);
  let checked = 0;
  for (let i = 0; i < 2000; i++) {
    const custom = rnd(2) === 0;
    const spec: SetSpec = {
      id: 7, name: 'Random', records: custom ? undefined : rec(), other: other(), layouts: design(), scripts: design(), valueLists: design(),
      tables: custom
        ? [129, 130, 131].slice(0, rnd(4)).map((id) => ({ id, records: rnd(5) ? rec() : undefined, fields: rnd(2) ? [[1, pick([3, 1, 0, 2, 0xff, rnd(256)])], [2, pick([3, 1, 0, 2])], [9, 3]] as [number, number][] : undefined }))
        : undefined,
    };
    const decoded = decodeOne(spec);
    const def = fromFmp12(decoded, schema);
    const p = new Privileges('r', def, {}, () => { throw new Error('no other file'); });

    // Oracle: what the documented bits allow, nothing else.
    const view = (b?: Uint8Array) => !!((b?.[0] ?? 0) & 0x10);
    const can = (b: Uint8Array | undefined, bit: number) => view(b) && !!((b?.[0] ?? 0) & bit);
    const level = (b?: Uint8Array) => (b && b.length ? ((b[0] & 1) ? 2 : (b[0] & 2) ? 1 : 0) : 0);
    for (const [kind, b, got] of [['layouts', spec.layouts, def.layouts], ['scripts', spec.scripts, def.scripts], ['valueLists', spec.valueLists, def.valueLists]] as const) {
      assert.ok(LEVEL_RANK[got] <= level(b), `${kind} ${b && [...b]}`);
    }
    if (!custom) {
      const t = p.table('Anything');
      assert.ok(!t.view || view(spec.records), 'view');
      assert.ok(t.create === false || !!((spec.records?.[0] ?? 0) & 1), 'create');
      assert.ok(t.edit === false || can(spec.records, 4), 'edit');
      assert.ok(t.delete === false || can(spec.records, 0x40), 'delete');
    } else {
      assert.deepEqual(def.records, { view: false, edit: false, create: false, delete: false }, 'a table a custom set does not list has no access');
      const seen = new Set<string>();
      for (const t of spec.tables ?? []) {
        const name = schema!.tables.find((x) => x.id === t.id)?.name;
        if (!name) continue;
        seen.add(name);
        const got = p.table(name);
        assert.ok(!got.view || view(t.records));
        assert.ok(got.create === false || !!((t.records?.[0] ?? 0) & 1));
        assert.ok(got.edit === false || can(t.records, 4));
        assert.ok(got.delete === false || can(t.records, 0x40));
        for (const f of schema!.tables.find((x) => x.id === t.id)!.fields) {
          const listed = t.fields?.find(([fid]) => fid === f.id);
          const level = p.field(name, f.name);
          if (t.fields) {
            // The table customises fields: only a field marked exactly read/write, in a table that can be viewed, stays open.
            assert.equal(level === 'modifiable', !!got.view && listed?.[1] === 0x03, `${name}.${f.name} ${listed}`);
            assert.ok(level !== 'viewOnly', 'the inferred view-only byte is never imported as view-only');
          }
          if (!got.view) assert.equal(level, 'none');
        }
      }
      for (const t of schema!.tables) if (!seen.has(t.name)) assert.deepEqual([p.table(t.name).view, p.table(t.name).create], [false, false], `${t.name} not listed`);
    }
    if (!isFullAccess(def)) {
      // From the bytes put in, not from what the reader returned: only a two-byte word is read at all.
      const word = spec.other?.length === 2 ? spec.other[0] * 256 + spec.other[1] : 0;
      assert.ok(p.canPrint === false || !!(word & 0x100), 'printing');
      assert.ok(p.canExport === false || !!(word & 0x200), 'exporting');
      assert.ok(p.canModifyPassword === false || !!(word & 4), 'password');
      assert.equal(p.idleDisconnect, spec.other?.length === 2 ? (word & 2) === 0 : true, 'idle disconnect');
    }
    // Importing again gives the same set, and it survives being saved and loaded.
    assert.deepEqual(fromFmp12(decoded, schema), def);
    assert.deepEqual(validateDefinition(JSON.parse(JSON.stringify(def))), JSON.parse(JSON.stringify(def)));
    checked++;
  }
  assert.equal(checked, 2000);
});

// ---- files in the wild --------------------------------------------------------------------------------------------

const fixtureDir = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const fixtures = existsSync(fixtureDir) ? readdirSync(fixtureDir).filter((f) => f.endsWith('.fmp12')) : [];

test('every sample file reads clean: nothing the stricter reading rejects, and the built-in sets are what they were', { skip: fixtures.length ? false : 'fixtures missing: run npm run fixtures' }, () => {
  for (const f of fixtures) {
    const db = FmpDatabase.open(join(fixtureDir, f));
    for (const s of db.schema.privilegeSets) {
      assert.equal(s.undecoded, undefined, `${f} set ${s.id} ${s.name}: ${s.undecoded}`);
      const def = fromFmp12(s, db.schema);
      if (s.id === 1) assert.deepEqual([def.layouts, def.scripts, def.valueLists, def.records], ['modifiable', 'modifiable', 'modifiable', { view: true, create: true, edit: true, delete: true }], f);
      if (s.id === 2) assert.deepEqual([def.layouts, def.scripts, def.valueLists, def.records.edit], ['viewOnly', 'viewOnly', 'viewOnly', true], f);
      if (s.id === 3) assert.deepEqual([def.records.view, def.records.edit, def.records.create, def.records.delete], [true, false, false, false], f);
    }
    for (const a of db.schema.accounts) {
      assert.ok(a.privilegeSetId === undefined || db.schema.privilegeSets.some((s) => s.id === a.privilegeSetId), `${f} account ${a.name} points at a set the file has`);
    }
  }
});

// ---- the same limits on every way in -----------------------------------------------------------------------------

const charts = join(fixtureDir, 'Charts.fmp12');
const skipLive = existsSync(charts) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;

before(async () => {
  if (skipLive) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-priv-closed-'));
  copyFileSync(charts, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.setPassword('Admin', 'pw');
  store.create('Congress', { Name: 'Visible Person', State: 'zzsecretzz', Party: 'Q' });
  // Three sets as a crafted or unusual file could carry them, each given a REST way in.
  const crafted: SetSpec[] = [
    // Layout byte in a form nobody has seen: no layout access, however the rest reads.
    plain({ id: 20, name: 'OddLayoutByte', records: bytes(0x55, 3), layouts: bytes(0xdf, 0xdf), scripts: bytes(0xdf), valueLists: bytes(0xdf) }),
    // Edit and delete bits with no view bit.
    plain({ id: 21, name: 'EditNoView', records: bytes(0x45, 3), layouts: bytes(0xdf), scripts: bytes(0xdf), valueLists: bytes(0xdf) }),
    // A pair outside 00/01 on view: the "other" bit of the pair is set.
    plain({ id: 22, name: 'AmbiguousView', records: bytes(0x30, 3), layouts: bytes(0xdf), scripts: bytes(0xdf), valueLists: bytes(0xdf) }),
  ];
  const ext = extendedNode({ fmrest: crafted.map((c) => [c.id]), fmapp: crafted.map((c) => [c.id]) });
  for (const s of privilegeSets(setsNode(crafted), ext)) {
    store.savePrivilegeSet(fromFmp12(s, store.schema));
    store.setPassword(s.name, 'pw', s.name);
  }
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function dataApi(account: string, path: string, init: RequestInit = {}): Promise<{ code: string; body: any }> {
  const t = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`), connection: 'close' } }).then((r) => r.json());
  const token = t.response?.token;
  if (!token) return { code: String(t.messages?.[0]?.code), body: t };
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/${path}`, { ...init, headers: { connection: 'close', authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } }).then((x) => x.json());
  return { code: String(r.messages?.[0]?.code), body: r };
}

test('Data API: a layout byte in an unseen form means no layout access', { skip: skipLive }, async () => {
  const set = store.privilegeSet('OddLayoutByte')!;
  assert.equal(set.layouts, 'none');
  const r = await dataApi('OddLayoutByte', 'layouts/Congress/records?_limit=5');
  assert.notEqual(r.code, '0');
  assert.ok(!JSON.stringify(r.body).includes('zzsecretzz'));
  const ok = await dataApi('Admin', 'layouts/Congress/records?_limit=5');
  assert.equal(ok.code, '0', 'the layout is there for a full-access account, so the refusal above is the privilege');
});

test('Data API: edit and delete bits without view neither read, change nor delete a record', { skip: skipLive }, async () => {
  const id = (store.query(`SELECT _fm_record_id AS id FROM Congress WHERE Name = 'Visible Person'`)[0] as { id: number }).id;
  for (const who of ['EditNoView', 'AmbiguousView']) {
    const set = store.privilegeSet(who)!;
    assert.equal(set.records.view, false, who);
    assert.equal(set.records.edit, false, who);
    assert.equal(set.records.delete, false, who);
    const read = await dataApi(who, `layouts/Congress/records/${id}`);
    assert.notEqual(read.code, '0', `${who} read`);
    assert.ok(!JSON.stringify(read.body).includes('zzsecretzz'));
    const write = await dataApi(who, `layouts/Congress/records/${id}`, { method: 'PATCH', body: JSON.stringify({ fieldData: { Party: 'changed' } }) });
    assert.notEqual(write.code, '0', `${who} write`);
    const del = await dataApi(who, `layouts/Congress/records/${id}`, { method: 'DELETE' });
    assert.notEqual(del.code, '0', `${who} delete`);
  }
  assert.equal((store.query(`SELECT Party FROM Congress WHERE _fm_record_id = ${id}`)[0] as { Party: string }).Party, 'Q');
});

// Each request opens its own connection: the server and these requests share one busy process, and a pooled
// connection that sat idle past the server's 5 s limit during a slow MCP answer is the likely cause of an ECONNRESET seen once in CI.
async function bearer(account: string): Promise<string> {
  const t = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`), connection: 'close' } }).then((r) => r.json());
  return `Bearer ${t.response.token}`;
}

async function mcpFind(account: string): Promise<string> {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', connection: 'close', authorization: 'Basic ' + btoa(`${account}:pw`) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'find_records', arguments: { database: 'Charts', layout: 'Congress', limit: 600 } } }),
  }).then((r) => r.text());
}

test('web client and MCP refuse a set whose layout byte was not understood, as the Data API does', { skip: skipLive }, async () => {
  const web = async (who: string) => fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Congress`, { headers: { authorization: await bearer(who), connection: 'close' } }).then((r) => r.status);
  // Controls: the same requests work for a full-access account, so the refusals below are the privilege.
  assert.equal(await web('Admin'), 200, 'web client control');
  const control = await mcpFind('Admin');
  assert.ok(control.includes('Visible Person'), 'MCP control: ' + control.slice(0, 300));
  assert.notEqual(await web('OddLayoutByte'), 200, 'web client');
  assert.ok(!(await mcpFind('OddLayoutByte')).includes('Visible Person'), 'MCP');
  for (const who of ['EditNoView', 'AmbiguousView']) assert.ok(!(await mcpFind(who)).includes('Visible Person'), `MCP ${who}`);
});

// ---- what the report says -----------------------------------------------------------------------------------------

test('the decoded set lists what it did not understand, for the conversion report', () => {
  const s = decodeOne(plain({ records: bytes(0x1a, 3), layouts: bytes(0xdd), other: bytes(1, 2, 3) }));
  assert.ok(s.undecoded!.some((u) => /file-level record access/.test(u)));
  assert.ok(s.undecoded!.some((u) => /^layout access \(stored as dd\)/.test(u)));
  assert.ok(s.undecoded!.some((u) => /other options/.test(u)));
  assert.equal(s.undecoded!.length, 3);
  const none: PrivilegeDefinition = fromFmp12(s);
  assert.deepEqual([none.layouts, none.records.view, none.printing, none.exporting, none.idleDisconnect], ['none', true, false, false, true]);
});

test('the conversion report names every set and account that was not imported as the file has it', { skip: skipLive }, () => {
  const sets = privilegeSets(setsNode([
    plain({ id: 30, name: 'Odd', records: bytes(0x14, 3), layouts: bytes(0xdd) }),
    plain({ id: 31, name: 'Clean' }),
  ]), extendedNode({ fmmcp: [[31]] }));
  const accounts = readAccounts(accountsNode([{ id: 5, name: 'Eve', set: bytes(1, 0, 1) }, { id: 6, name: 'Ann', set: bytes(1, 31) }]));
  store.schema.privilegeSets.push(...sets);
  store.schema.accounts.push(...accounts);
  const report = conversionReport(store, [store.name]);
  const names = report.privileges.notUnderstood.map((u) => u.set).sort();
  assert.deepEqual(names, ['Clean', 'Odd', 'account Eve']);
  const odd = report.privileges.notUnderstood.find((u) => u.set === 'Odd')!;
  assert.ok(odd.what.some((w) => /record access/.test(w)) && odd.what.some((w) => /layout access/.test(w)));
  assert.match(report.summary, /Odd: part of it was not imported as the file has it/);
  assert.match(report.summary, /account Eve: part of it was not imported/);
  assert.ok(!report.privileges.notUnderstood.some((u) => u.set.startsWith('[')), 'the built-in sets read clean');
  // Accounts come through the importer by id: Ann\'s set is Clean (fmmcp dropped), Eve has none.
  store.setPassword('Ann', 'pw');
  store.setPassword('Eve', 'pw');
  assert.equal(store.accountPrivilegeSet('Ann'), 'Clean');
  assert.equal(store.accountPrivilegeSet('Eve'), undefined);
  assert.equal(store.privileges('Ann').has('fmmcp'), false);
  assert.equal(store.privileges('Eve').table('Congress').view, false, 'an account without a set opens nothing');
});

