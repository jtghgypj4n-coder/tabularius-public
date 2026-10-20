// Privilege sets decoded from Flicks match FileMaker's own Database Design
// Report for it (fixtures/fmp12/Flicks_ddr.xml); run `npm run fixtures` first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FmpDatabase } from '../src/index.ts';
import { accountInactive, privilegeOther, privilegeSets } from '../src/schema.ts';
import { Node } from '../src/tree.ts';

const dir = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const flicks = join(dir, 'Flicks.fmp12');
const ddr = join(dir, 'Flicks_ddr.xml');
const skip = existsSync(flicks) && existsSync(ddr) ? false : 'fixtures missing: run npm run fixtures';

test('privilege sets: records, layouts, value lists, scripts and extended privileges match the Design Report', { skip }, () => {
  const xml = new TextDecoder('utf-16le').decode(readFileSync(ddr));
  const records: Record<string, { view: boolean; create: boolean; edit: boolean; delete: boolean }> = {
    CreateEditDelete: { view: true, create: true, edit: true, delete: true },
    ViewOnly: { view: true, create: false, edit: false, delete: false },
  };
  const level = (v: string) => ({ Modifiable: 'modifiable', ViewOnly: 'viewOnly', ExecutableOnly: 'viewOnly', NoAccess: 'none' })[v];
  const extended = new Map<string, string[]>();
  for (const e of xml.matchAll(/<ExtendedPrivilege id="\d+" comment="[^"]*" name="([^"]+)">([\s\S]*?)<\/ExtendedPrivilege>/g)) {
    for (const p of e[2].matchAll(/<PrivilegeSet id="(\d+)"/g)) extended.set(p[1], [...(extended.get(p[1]) ?? []), e[1]]);
  }
  const sets = FmpDatabase.open(flicks).schema.privilegeSets;
  let n = 0;
  for (const m of xml.matchAll(/<PrivilegeSet comment="([^"]*)" id="(\d+)"[^>]*name="([^"]+)">([\s\S]*?)<\/PrivilegeSet>/g)) {
    const [whole, comment, id, name, body] = m;
    const got = sets.find((s) => s.id === Number(id))!;
    assert.equal(got.name, name);
    if (Number(id) > 3) assert.equal(got.comment, comment); // built-in sets' comments are FileMaker's, not stored
    assert.deepEqual(got.records, records[/<Records value="(\w+)"/.exec(body)![1]], name);
    assert.equal(got.layouts, level(/<Layouts value="(\w+)"/.exec(body)![1]), name);
    assert.equal(got.valueLists, level(/<ValueLists value="(\w+)"/.exec(body)![1]), name);
    assert.equal(got.scripts, level(/<Scripts value="(\w+)"/.exec(body)![1]), name);
    assert.deepEqual(got.extendedPrivileges, extended.get(id) ?? [], name);
    assert.equal(got.printing, /printing="True"/.test(whole), `${name} printing`);
    assert.equal(got.exporting, /exporting="True"/.test(whole), `${name} exporting`);
    assert.equal(got.allowModifyPassword, /allowModifyPassword="True"/.test(whole), `${name} allowModifyPassword`);
    assert.equal(got.idleDisconnect, /idleDisconnect="True"/.test(whole), `${name} idleDisconnect`);
    n++;
  }
  assert.equal(n, 4);
});

test('accounts: external (identity provider) accounts match the Design Report', { skip }, () => {
  const xml = new TextDecoder('utf-16le').decode(readFileSync(ddr));
  const accounts = FmpDatabase.open(flicks).schema.accounts;
  let n = 0;
  for (const m of xml.matchAll(/<Account id="(\d+)"[^>]*managedBy="(\w+)"[^>]*>/g)) {
    const got = accounts.find((a) => a.id === Number(m[1]))!;
    assert.equal(!!got.external, m[2] === 'External', `account ${m[1]}`);
    n++;
  }
  assert.equal(n, 6);
});

test('accounts: switched on and off as the Design Report says', { skip }, () => {
  const xml = new TextDecoder('utf-16le').decode(readFileSync(ddr));
  const accounts = FmpDatabase.open(flicks).schema.accounts;
  let n = 0;
  for (const m of xml.matchAll(/<Account id="(\d+)"[^>]*status="(\w+)"[^>]*>/g)) {
    const got = accounts.find((a) => a.id === Number(m[1]))!;
    assert.equal(!!got.inactive, m[2] === 'Inactive', `account ${m[1]} ${got.name}`);
    n++;
  }
  assert.equal(n, 6);
  // A guest that is on: PortableCode39-2 is a public sample meant to open without signing in.
  const portable = join(dir, 'PortableCode39-2.fmp12');
  if (existsSync(portable)) assert.equal(FmpDatabase.open(portable).schema.accounts.find((a) => a.id === 1)?.inactive, undefined);
});

// CI-runnable (no fixtures): account key 10, as stored in the files above.
test('account key 10: an account switched off ends its run with 635399', () => {
  const hex = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));
  // Off: Flicks [Guest], tool_admin, tool-full-access (odd nibble count, padded with 0).
  for (const h of ['089000418000635399', '0b9f7ede800555a986353990', '0b9f7ede8005561326353990']) assert.equal(accountInactive(hex(h)), true, h);
  // On: Flicks Admin, lon_c, workgroup; PortableCode39-2 [Guest].
  for (const h of ['089f70c98005551180', '089f7e4a8005734130', '089f7eda8005221790', '059000418000']) assert.equal(accountInactive(hex(h)), false, h);
  // Missing, or a length byte that doesn't fit: left on, as before.
  assert.equal(accountInactive(undefined), false);
  assert.equal(accountInactive(hex('099000418000635399')), false);
});

// CI-runnable (no fixtures): the key-10 "other options" decode, checked against
// every labelled privilege set from both ground-truth sources — the Flicks DDR
// and the nbourre/yada Save as XML export. value is the big-endian key-10 word.
test('privilege key 10: printing, exporting, modify-password and idle-disconnect bits', () => {
  const u16 = (v: number) => Uint8Array.of((v >> 8) & 0xff, v & 0xff);
  // value: [printing, exporting, allowModifyPassword, idleDisconnect]
  const cases: [number, boolean, boolean, boolean, boolean][] = [
    [0x9fff, true, true, true, false], // Flicks [Full Access]
    [0x0304, true, true, true, true], //  Flicks [Data Entry]/[Read-Only]; yada RO_all/RW_all/RW_own
    [0x0001, false, false, false, true], // Flicks workgroup
    [0x6304, true, true, true, true], //  yada gestionnaire/responsable/utilisateur_*
    [0x0104, true, false, true, true], // yada RO_own (print only, modify-password on)
    [0x0102, true, false, false, false], // yada ecranTactile (print only, password locked, stays connected)
  ];
  for (const [v, printing, exporting, modPw, idle] of cases) {
    const got = privilegeOther(u16(v));
    assert.equal(got.printing, printing, `0x${v.toString(16)} printing`);
    assert.equal(got.exporting, exporting, `0x${v.toString(16)} exporting`);
    assert.equal(got.allowModifyPassword, modPw, `0x${v.toString(16)} allowModifyPassword`);
    assert.equal(got.idleDisconnect, idle, `0x${v.toString(16)} idleDisconnect`);
    assert.equal(got.flags, v, `0x${v.toString(16)} flags`);
  }
  // No key 10: restrictive defaults, idle-disconnect on (FileMaker's default), no flags echoed.
  assert.deepEqual(privilegeOther(undefined), {
    printing: false,
    exporting: false,
    allowModifyPassword: false,
    idleDisconnect: true,
  });
});

// CI-runnable (no fixtures): "Custom privileges" per-table record access. The
// structure is modelled on a public FileMaker 26 solution (ahmadnaseer004/
// Sales-Management-System): a set with no file-level record byte (key 2) and a
// child 5 keyed by base-table id, each table carrying its own record byte.
// Record bits reuse the file-level decode: 0x10 view is verified against the
// Flicks DDR; which of 0x01, 0x04 and 0x40 is create, edit or delete is
// inferred, so only the bytes the samples hold (0x55, 0x10, none) are read in
// full. A byte no sample has (0x54 below, view+edit+delete if the inference
// holds) gives view only and is reported.
test('privilege sets: custom per-table record access (child 5)', () => {
  const sets = new Node();

  // A standard set: file-level record byte present (0x55 = all four).
  const whole = new Node();
  whole.kv.set(2, Uint8Array.of(0x55, 0x03));
  sets.children.set(1, whole);

  // A custom set: no key 2; child 5 lists two tables with their own bytes.
  const custom = new Node();
  const perTable = new Node();
  const t130 = new Node();
  t130.kv.set(2, Uint8Array.of(0x54)); // unseen: view only, reported
  // Per-field access (nested child 5, keyed by field id): capability bits
  // 0x01 view, 0x02 edit. 0x03 = ReadWrite, 0x01 = ReadOnly, 0x00 = NoAccess.
  const perField = new Node();
  perField.kv.set(0, Uint8Array.of(0xff)); // key 0 (a formatting entry) -> dropped, not a phantom field 0
  perField.kv.set(1, Uint8Array.of(0x03)); // view + edit
  perField.kv.set(2, Uint8Array.of(0x01)); // view only
  perField.kv.set(3, Uint8Array.of(0x00)); // no access
  perField.kv.set(4, Uint8Array.of(0x02)); // anomalous: edit bit, no view -> collapses to NoAccess
  perField.kv.set(5, Uint8Array.of(0x07)); // spare high bits -> no more than view+edit
  perField.kv.set(6, new Uint8Array(0)); // empty byte array -> access 0 (numeric), NoAccess
  t130.children.set(5, perField);
  const t143 = new Node();
  t143.kv.set(2, Uint8Array.of(0x10)); // view only
  perTable.children.set(130, t130);
  perTable.children.set(143, t143);
  custom.children.set(5, perTable);
  sets.children.set(7, custom);

  const [std, cust] = privilegeSets(sets, undefined);

  assert.equal(std.customRecordAccess, undefined);
  assert.equal(std.tableRecords, undefined);
  assert.deepEqual(std.records, { view: true, create: true, edit: true, delete: true });

  assert.equal(cust.customRecordAccess, true);
  // File-level records is all-false and not meaningful for a custom set.
  assert.deepEqual(cust.records, { view: false, create: false, edit: false, delete: false });
  assert.deepEqual(cust.tableRecords, [
    {
      tableId: 130,
      records: { view: true, create: false, edit: false, delete: false },
      fields: [
        { fieldId: 1, access: 0x03, view: true, edit: true }, // ReadWrite
        { fieldId: 2, access: 0x01, view: true, edit: false }, // ReadOnly
        { fieldId: 3, access: 0x00, view: false, edit: false }, // NoAccess
        { fieldId: 4, access: 0x02, view: false, edit: false }, // edit-without-view collapses to NoAccess
        { fieldId: 5, access: 0x07, view: true, edit: true }, // spare bits never exceed view+edit
        { fieldId: 6, access: 0x00, view: false, edit: false }, // empty entry -> numeric 0, NoAccess
      ],
    },
    { tableId: 143, records: { view: true, create: false, edit: false, delete: false } },
  ]);
  assert.ok(cust.undecoded?.some((u) => /table 130 record access/.test(u)));
  // A table that does not customise fields has no `fields` array.
  assert.equal(cust.tableRecords![1].fields, undefined);
});
