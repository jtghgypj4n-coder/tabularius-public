import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCalc } from '../src/calc.ts';
import { decodeScsu, decodeTextChars, inspectText } from '../src/scsu.ts';
import { FmpDatabase } from '../src/index.ts';
import { inferDateOrder } from '../src/values.ts';

test('AR-fmp12-reader-04', () => {
  assert.throws(() => decodeCalc(Uint8Array.of(0xf8)), /truncat|incomplete/i);
  assert.throws(() => decodeCalc(Uint8Array.of(0x13, 5, 0x1b)), /truncat|incomplete/i);
  assert.throws(() => decodeCalc(Uint8Array.of(0x13, 1, 0x1b)), /terminat|truncat|incomplete/i);
  assert.throws(() => decodeCalc(Uint8Array.of(0x9c)), /truncat|incomplete/i);
  assert.throws(() => decodeCalc(Uint8Array.of(0x10, 0x02)), /truncat|incomplete/i);
  assert.throws(() => decodeCalc(Uint8Array.of(0x0c)), /truncat|incomplete/i);
  assert.throws(() => decodeCalc(Uint8Array.of(0x1b)), /truncat|incomplete/i);
  assert.throws(() => decodeCalc(Uint8Array.of(0x0b, 1, 0x1b, 0x25, 0x25)), /terminat|truncat|incomplete/i);
  assert.throws(() => decodeScsu(Uint8Array.of(0x41, 0x0e, 0)), /truncat|incomplete/i);
  assert.throws(() => decodeTextChars(Uint8Array.of(0x1b), 5), /truncat|incomplete/i);
});

test('AR-fmp12-reader-09', () => {
  const rows = ['31/12/2026 09:00:00', '05/06/2026 09:00:00'];
  const db = Object.assign(Object.create(FmpDatabase.prototype), {
    schemaCache: { tables: [{ id: 1, name: 'Events', fields: [{ id: 1, name: 'When', type: 'timestamp' }] }] },
    *rawRecords() { for (const [i, value] of rows.entries()) yield { id: i + 1, values: new Map([[1, [value]]]) }; },
  }) as FmpDatabase;
  assert.equal(db.dateOrder, 'DMY');
  assert.deepEqual([...db.records(1)].map((r) => r.fields.When), ['2026-12-31T09:00:00', '2026-06-05T09:00:00']);
});

const fakeDb = (tables: { id: number; rows: string[] }[]) => Object.assign(Object.create(FmpDatabase.prototype), {
  schemaCache: { tables: tables.map((t) => ({ id: t.id, name: `T${t.id}`, fields: [{ id: 1, name: 'When', type: 'date' }] })) },
  *rawRecords(table: number) { for (const [i, value] of tables.find((t) => t.id === table)!.rows.entries()) yield { id: i + 1, values: new Map([[1, [value]]]) }; },
}) as FmpDatabase;

test('a file whose dates all read either way is read month first, not refused', () => {
  assert.equal(inferDateOrder(['03/04/2025', '05/06/2025']), 'MDY');
  assert.equal(inferDateOrder(['05/05/2025']), 'MDY', 'day and month the same settle nothing');
  assert.equal(inferDateOrder([]), 'MDY');
  const db = fakeDb([{ id: 1, rows: ['05/06/2026', '03/04/2026'] }]);
  assert.equal(db.dateOrder, 'MDY');
  assert.deepEqual([...db.records(1)].map((r) => r.fields.When), ['2026-05-06', '2026-03-04']);
});

test('dates that settle opposite orders refuse the file and name both values', () => {
  assert.throws(() => inferDateOrder(['13/04/2025', '04/13/2025']), /conflicting date order.*"13\/04\/2025" reads as DMY.*"04\/13\/2025" reads as MDY/);
  assert.throws(() => inferDateOrder(['2025-04-13', '13/04/2025']), /"2025-04-13" reads as YMD.*"13\/04\/2025" reads as DMY/);
  assert.equal(inferDateOrder(['03/04/2025', '31/12/2025', '05/05/2025']), 'DMY', 'ambiguous dates beside one that settles it follow it');
});

test('evidence in a later table settles the order when the first table is ambiguous', () => {
  const db = fakeDb([{ id: 1, rows: ['03/04/2026', '05/06/2026'] }, { id: 2, rows: ['31/12/2026'] }]);
  assert.equal(db.dateOrder, 'DMY');
  assert.deepEqual([...db.records(1)].map((r) => r.fields.When), ['2026-04-03', '2026-06-05']);
});

test('opposite evidence in two different tables refuses the file; the scan does not stop at the first table that settles an order', () => {
  const db = fakeDb([{ id: 1, rows: ['31/12/2026'] }, { id: 2, rows: ['12/31/2026'] }]);
  assert.throws(() => db.dateOrder, /conflicting date order.*"31\/12\/2026" \(T1::When, record 1\) reads as DMY but "12\/31\/2026" \(T2::When, record 1\) reads as MDY/, 'the message names the table, field and record of both dates');
});

test('a calculation number cut inside its limbs is refused; the two bytes after the limbs are absent in real files and are not required', () => {
  const full = Uint8Array.of(0x10, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);
  assert.equal(decodeCalc(full).text, '7');
  assert.equal(decodeCalc(full.subarray(0, 18)).text, '7');
  for (let n = 1; n < 18; n++) assert.throws(() => decodeCalc(full.subarray(0, n)), /truncat/i, `prefix ${n}`);
});

test('inspection shows text for a well-formed stored string and a note for a stream cut mid-command', () => {
  const xor = (bytes: number[]) => Uint8Array.from(bytes, (b) => b ^ 0x5a);
  assert.deepEqual(inspectText(xor([0x48, 0x69])), { text: 'Hi' });
  // 0x0f (SCU) then a lone byte: a Unicode-mode pair with its second byte missing.
  const cut = inspectText(xor([0x48, 0x0f, 0x00]));
  assert.ok('note' in cut && /truncated SCSU command at byte 2/.test(cut.note), JSON.stringify(cut));
  assert.throws(() => decodeScsu(Uint8Array.from([0x48, 0x0f, 0x00])), /truncated SCSU command/);
});
