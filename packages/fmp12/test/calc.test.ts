import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeCalc, FmpDatabase, schemaFieldNamer } from '../src/index.ts';

test('field naming resolves generated high ids across many tables and fields', () => {
  const schema = {
    tables: Array.from({ length: 96 }, (_, t) => ({ id: t + 1, fields: Array.from({ length: 96 }, (_, f) => ({ id: f + 1, name: `F${t + 1}_${f + 1}` })) })),
    tableOccurrences: Array.from({ length: 96 }, (_, t) => ({ id: t + 101, name: `TO${t + 1}`, baseTableId: t + 1 })),
  };
  const name = schemaFieldNamer(schema);
  assert.equal(name(196, 96, true), 'TO96::F96_96');
  assert.equal(name(196, 96, false), 'F96_96');
  assert.equal(name(999, 96, true), '<Table Missing>::<Field Missing>');
});

const hex = (s: string) => new Uint8Array(Buffer.from(s.replace(/\s+/g, ''), 'hex'));
const SP = '0c13017a00'; // one space

test('calc tokens: strings, operators, Get and functions', () => {
  // "FOCUS-" & Get ( UUID )
  const r = decodeCalc(hex(`13061c15190f097700 ${SP} 50 ${SP} 9b ${SP} 04 ${SP} 9c65 ${SP} 05`));
  assert.equal(r.text, '"FOCUS-" & Get ( UUID )');
  assert.deepEqual(r.unknown, []);
});

test('calc tokens: numbers', () => {
  const num = (body: string) => decodeCalc(hex('10' + body)).text;
  assert.equal(num('02 0001 0010 00000001 00000000 00000000 0020'), '1');
  assert.equal(num('02 0001 0010 00002710 00000000 00000000 0020'), '10000');
  assert.equal(num('02 0001 0010 00000000 1dcd6500 00000000 0020'), '0.5');
  assert.equal(num('02 0002 0010 00000001 06b06465 00000000 00000000 0020'), '1112223333');
});

test('calc tokens: string lengths count characters, and returns show as ¶', () => {
  // "‡‡LIB[": six characters, eight SCSU bytes
  assert.equal(decodeCalc(hex('13065f7b5f7b16131801 00')).text, '"‡‡LIB["');
  assert.equal(decodeCalc(hex('1303 3b573800')).text, '"a¶b"');
  const long = 'x'.repeat(300);
  const b = Buffer.concat([hex('13812c'), Buffer.from(long).map((c) => c ^ 0x5a), hex('00')]);
  assert.equal(decodeCalc(b).text, `"${long}"`);
});

test('calc tokens: field references, variables, comments, custom functions', () => {
  const field = (to: number | undefined, f: number | undefined, q: boolean) => `${q ? `T${to}::` : ''}F${f}`;
  // TO 129 is d0 0001; field 84
  assert.equal(decodeCalc(hex('16000403d00001020154 0001'), field).text, 'F84');
  assert.equal(decodeCalc(hex('16040403d00001020154 0001'), field).text, 'T129::F84');
  assert.equal(decodeCalc(hex(`0b0324 3c34 0000 ${SP} 1a077e0533343e3f22`)).text, '~fn $_index');
  assert.equal(decodeCalc(hex('0e13097a19353737 3f342e 5700')).text, '// Comment\n');
  assert.equal(decodeCalc(hex('0d1305 7a352f2e7a 00')).text, '/* out */');
  assert.equal(decodeCalc(hex('1b14 03 02800f'), undefined, (id) => `CF${id}`).text, 'CF143');
});

// Flicks ships with FileMaker's own Database Design Report: every calculation
// field and auto-enter formula must decode to exactly the text FileMaker shows.
const dir = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const flicks = join(dir, 'Flicks.fmp12');
const ddr = join(dir, 'Flicks_ddr.xml');
const skip = existsSync(flicks) && existsSync(ddr) ? false : 'fixtures missing: run npm run fixtures';

test('calc: Flicks formulas match the Design Report', { skip }, () => {
  const xml = new TextDecoder('utf-16le').decode(readFileSync(ddr)).replace(/\r\n?/g, '\n');
  const expected = new Map<string, string>();
  for (const t of xml.matchAll(/<BaseTable id="(\d+)"[\s\S]*?<\/BaseTable>/g)) {
    for (const f of t[0].matchAll(/<Field id="(\d+)"[^>]*>([\s\S]*?)<\/Field>/g)) {
      const body = f[2].replace(/<Validation[\s\S]*?<\/Validation>/, '');
      const calc = /<Calculation[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/Calculation>/.exec(body);
      if (calc) expected.set(`${t[1]}/${f[1]}`, calc[1]);
    }
  }
  const schema = FmpDatabase.open(flicks).schema;
  let n = 0;
  for (const t of schema.tables) {
    for (const f of t.fields) {
      const want = expected.get(`${t.id}/${f.id}`);
      if (want === undefined) continue;
      assert.equal(f.calculation, want, `${t.name}::${f.name}`);
      n++;
    }
  }
  assert.ok(n >= 50, `checked ${n} formulas`);
});

// Storage indexing (definition byte 8) against the Design Report, and
// "Do not evaluate if all referenced fields are empty", which the report has
// checked (alwaysEvaluate="False") on every calculation.
test('field options: Flicks indexing matches the Design Report', { skip }, () => {
  const xml = new TextDecoder('utf-16le').decode(readFileSync(ddr));
  const schema = FmpDatabase.open(flicks).schema;
  const counts = new Map<string, number>();
  for (const t of xml.matchAll(/<BaseTable id="\d+"[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/BaseTable>/g)) {
    const table = schema.tables.find((x) => x.name === t[1]);
    const fields = table?.fields ?? [];
    for (const f of t[2].matchAll(/<Field id="(\d+)"[^>]*>([\s\S]*?)<\/Field>/g)) {
      const field = fields.find((x) => x.id === +f[1]);
      const storage = /<Storage ([^>]*)\/>/.exec(f[2])?.[1] ?? '';
      const want = /\bindex="(\w+)"/.exec(storage)?.[1];
      if (!field || !want) continue;
      const o = field.options;
      const got = !o?.index ? 'None' : o.index.value && (o.index.word || field.type !== 'text') ? 'All' : 'Minimal';
      assert.equal(got, want, `${t[1]}::${field.name} index`);
      const auto = /autoIndex="(\w+)"/.exec(storage)?.[1];
      if (auto) assert.equal(!o?.noAutoIndex, auto === 'True', `${t[1]}::${field.name} autoIndex`);
      counts.set(want, (counts.get(want) ?? 0) + 1);
      if (/fieldType="Calculated"/.test(f[0])) assert.ok(!o?.evaluateWhenEmpty, `${t[1]}::${field.name} evaluates when empty`);
    }
  }
  assert.deepEqual(Object.fromEntries(counts), { All: 26, Minimal: 13, None: 104 });
});

test('calc tokens: 360Works Email plug-in functions', () => {
  // External function tokens: owner "3MLR", then the index (46524 EmailVersion, 19972 EmailReadMessageValue).
  const r = decodeCalc(hex(`1d000015 334d4c52 b5bc`));
  assert.equal(r.text, 'EmailVersion');
  assert.deepEqual(r.unknown, []);
  assert.equal(decodeCalc(hex(`1d000015 334d4c52 4e04`)).text, 'EmailReadMessageValue');
});

test('owner-only plug-in ids decode without invented function names', () => {
  const owners = ['PCCC', 'sSSw', 'FMAU', 'SCBE', 'EeID', '24FT', 'FMMB'];
  for (const owner of owners) {
    const r = decodeCalc(hex(`1d000015 ${Buffer.from(owner).toString('hex')} 0011`));
    assert.equal(r.text, `<plugin:${owner}:17>`);
    assert.deepEqual(r.unknown, [`${owner}:17`]);
  }
});

test('calc tokens: functions read off public sample files', () => {
  const one = (b: string) => decodeCalc(hex(b)).text;
  assert.equal(one('33'), 'Sign');
  assert.equal(one('51'), 'Exact');
  assert.equal(one('6f'), 'SerialIncrement');
  assert.equal(one('a6'), 'TextStyleRemove');
  assert.equal(one('f908'), 'HexDecode');
  assert.equal(one('f910'), 'GetRecordIDsFromFoundSet');
  assert.equal(one('fc07'), 'TextDecode');
  assert.equal(one('fc12'), 'GetTableDDL');
  // Design functions: owner "FMDR", index 22 and 23.
  assert.equal(one('1d000015 464d4452 0016'), 'BaseTableIDs');
  assert.equal(one('1d000015 464d4452 0017'), 'BaseTableNames');
});
