// Calculation edge cases that used to throw, build gigantic values or pass the formula check unnoticed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFormula, evaluate, evaluateText, NameTable, text, num, GET_NAMES, type FieldRef } from '../src/index.ts';

const names = new NameTable({ fields: ['Amount', 'Region'], occurrences: [['Orders', ['Total']]] });

test('GetSummary with a break name that has a line break in it is "?", not an exception', () => {
  const seen: FieldRef[] = [];
  const ctx = { names, field: () => num(1), summary: (_f: FieldRef, brk: FieldRef) => { seen.push(brk); return num(7); } };
  assert.equal(evaluateText('GetSummary ( Amount ; "a\rb" )', ctx), '?');
  assert.equal(evaluateText('GetSummary ( Amount ; "a\nb" )', ctx), '?');
  assert.equal(seen.length, 0);
  // A name with a table in front of it still parses into the table and the field.
  assert.equal(evaluateText('GetSummary ( Amount ; "Orders::Total" )', ctx), '7');
  assert.equal(seen[0].occurrence, 'Orders');
  assert.equal(seen[0].field, 'Total');
  assert.equal(evaluateText('GetSummary ( Amount ; "Region" )', ctx), '7');
  assert.equal(seen[1].field, 'Region');
});

test('JSONSetElement with a far array index is "?" quickly, and a near one still pads with null', () => {
  for (const index of ['99999999', '99999999999', '1e30'.replace('e30', '000000000000000000000000000000')]) {
    const started = Date.now();
    assert.match(evaluateText(`JSONSetElement ( "[]" ; "[${index}]" ; 1 ; 2 )`), /^\? Array index/);
    assert.ok(Date.now() - started < 5000, `index ${index} took too long`);
  }
  assert.equal(evaluateText('JSONSetElement ( "[]" ; "[2]" ; 1 ; 2 )'), '[null,null,1]');
  assert.match(evaluateText('JSONSetElement ( "{}" ; "a[1000001]" ; 1 ; 2 )'), /^\? Array index/);
});

test('Get names are checked against the Claris list; every name the engine answers is in it', () => {
  const check = (f: string) => checkFormula(f, { names });
  assert.equal(check('Get ( FoundCount )').ok, true);
  assert.equal(check('Get ( UUID ) & Get ( documentspath )').ok, true);
  const bad = check('Get ( FoundCuont )');
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? '' : bad.message, /Get does not take "FoundCuont"/);
  // The names get.ts answers on its own are all in the list.
  for (const name of ['CurrentDate', 'CurrentTime', 'CurrentTimestamp', 'CurrentHostTimestamp', 'UUID', 'UUIDNumber', 'LastError', 'ApplicationVersion',
    'SystemPlatform', 'Device', 'ScriptParameter', 'TemporaryPath', 'MultiUserState', 'InstalledFMPlugins', 'HostIPAddress', 'WindowStyle', 'EncryptionState']) {
    assert.ok(GET_NAMES.has(name.toLowerCase()), name);
    assert.equal(check(`Get ( ${name} )`).ok, true, name);
    evaluate(`Get ( ${name} )`);
  }
  // A name evaluation answers although the Claris page does not list it still passes.
  assert.equal(check('Get ( PortalRowNumber )').ok, true);
});

test('Base64EncodeRFC wraps as the Claris table says: 1421 at 64, 2045 at 76, 4880 at 76 with a CRC, the rest unwrapped', () => {
  const data = 'x'.repeat(100);
  const flat = Buffer.from(data).toString('base64');
  const lines = (rfc: number) => evaluateText(`Base64EncodeRFC ( ${rfc} ; "${data}" )`).split('\r\n');
  assert.deepEqual(lines(1421).map((l) => l.length), [64, 64, flat.length - 128]);
  assert.deepEqual(lines(2045).map((l) => l.length), [76, flat.length - 76]);
  for (const rfc of [3548, 4648, 1234, 0]) assert.deepEqual(lines(rfc), [flat], String(rfc));
  const armor = lines(4880);
  assert.deepEqual(armor.slice(0, 2).map((l) => l.length), [76, flat.length - 76]);
  assert.match(armor[2], /^=[A-Za-z0-9+/]{4}$/);
  // OpenPGP's CRC-24 of nothing at all is B704CE.
  assert.equal(evaluateText('Base64EncodeRFC ( 4880 ; "" )'), '\r\n=twTO');
  assert.equal(evaluateText('Base64EncodeRFC ( 4648 ; "Black" )'), 'QmxhY2s=');
});
