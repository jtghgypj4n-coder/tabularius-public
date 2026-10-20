// FileMaker SQL's date and time syntax and functions, a statement at a time, and ? placeholders that need a value.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asText } from '@tabularius/calc';
import { createStore, Store } from '../src/index.ts';
import { fileMakerSqlSyntax, oneStatement, placeholders, SQL_DATE_FUNCTIONS } from '../src/sql-dates.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-sql-dates-'));
  createStore(join(dir, 't.sqlite'));
  store = new Store(join(dir, 't.sqlite'), 'T');
  store.applyDesign([{ op: 'createTable', name: 'E', fields: [{ name: 'Name', type: 'text' }, { name: 'Hired', type: 'date' }, { name: 'At', type: 'time' }, { name: 'Ts', type: 'timestamp' }] }] as never);
  store.create('E', { Name: 'Ann', Hired: '2/3/2024', At: '10:30:00', Ts: '2/3/2024 10:30:00' });
  store.create('E', { Name: 'cy', Hired: '12/25/2023', At: '08:00:00', Ts: '12/25/2023 08:00:00' });
});

after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const rows = (query: string, params: (string | number)[] = []) => {
  const { sql, target } = store.calc.translateSQL(query);
  return target.select(sql, params, 100).rows;
};

test('date, time and timestamp literals in every spelling become the stored text', () => {
  assert.equal(fileMakerSqlSyntax("SELECT 1 WHERE d > {d '2026-1-1'}"), "SELECT 1 WHERE d > '2026-01-01'");
  assert.equal(fileMakerSqlSyntax("SELECT {t '9:05:00'}, {ts '2026-01-01 9:05:00'}"), "SELECT '09:05:00', '2026-01-01T09:05:00'");
  assert.equal(fileMakerSqlSyntax("x = DATE '2026-01-01' AND y = TIMESTAMP '2026-01-01 10:00:00' AND z = TIME '10:00:00'"), "x = '2026-01-01' AND y = '2026-01-01T10:00:00' AND z = '10:00:00'");
  assert.equal(fileMakerSqlSyntax("WHERE note = 'DATE ''x'' {d ''y''}'"), "WHERE note = 'DATE ''x'' {d ''y''}'");
  assert.deepEqual(rows("SELECT Name FROM E WHERE Hired > {d '2024-01-01'}"), [['Ann']]);
  assert.deepEqual(rows("SELECT Name FROM E WHERE Hired < DATE '2024-01-01'"), [['cy']]);
  assert.deepEqual(rows("SELECT Name FROM E WHERE Ts >= TIMESTAMP '2024-02-03 10:30:00'"), [['Ann']]);
  assert.deepEqual(rows("SELECT Name FROM E WHERE At < {t '09:00:00'}"), [['cy']]);
});

test('the date functions read dates, times and timestamps', () => {
  assert.deepEqual(rows('SELECT YEAR(Hired), MONTH(Hired), DAY(Hired), DAYNAME(Hired), MONTHNAME(Hired), DAYOFWEEK(Hired) FROM E ORDER BY Hired DESC'), [[2024, 2, 3, 'Saturday', 'February', 7], [2023, 12, 25, 'Monday', 'December', 2]]);
  assert.deepEqual(rows('SELECT HOUR(At), MINUTE(At), SECOND(At), HOUR(Ts) FROM E WHERE Name = ?', ['Ann']), [[10, 30, 0, 10]]);
  assert.deepEqual(rows('SELECT EXTRACT(YEAR FROM Hired) FROM E WHERE Name = \'cy\''), [[2023]]);
  assert.deepEqual(rows('SELECT Name FROM E WHERE YEAR(Hired) = 2024'), [['Ann']]);
  assert.equal(rows('SELECT CURDATE(), CURTIME(), NOW()')[0].every((v) => typeof v === 'string'), true);
  assert.match(String(rows('SELECT CURDATE()')[0][0]), /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(rows("SELECT CHAR_LENGTH(Name), POSITION('n' IN Name) FROM E ORDER BY Name"), [[3, 2], [2, 0]]);
});

test('NOW and CURTIMESTAMP use one clock reading across a date boundary', () => {
  const actualDate = Date;
  const zone = process.env.TZ;
  let reads = 0;
  const instants = ['2026-12-31T23:59:59Z', '2027-01-01T00:00:01Z'];
  try {
    process.env.TZ = 'UTC';
    globalThis.Date = class extends actualDate {
      constructor() { super(instants[Math.min(reads++, 1)]); }
    } as DateConstructor;
    for (const name of ['NOW', 'CURTIMESTAMP']) {
      reads = 0;
      const value = SQL_DATE_FUNCTIONS[name]();
      assert.equal(value, '2026-12-31T23:59:59');
      assert.equal(reads, 1, name);
    }
  } finally {
    globalThis.Date = actualDate;
    if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone;
  }
});

test('ROWMODID is the modification count column', () => {
  assert.deepEqual(rows('SELECT ROWMODID FROM E ORDER BY ROWID').length, 2);
  assert.equal(fileMakerSqlSyntax('SELECT "ROWMODID" FROM E'), 'SELECT "_fm_mod_id" FROM E');
  assert.equal(fileMakerSqlSyntax("SELECT 'ROWMODID' FROM E"), "SELECT 'ROWMODID' FROM E");
  assert.equal(fileMakerSqlSyntax("SELECT /* it's */ ROWMODID FROM E"), "SELECT /* it's */ _fm_mod_id FROM E");
  assert.equal(fileMakerSqlSyntax("SELECT -- it's\nROWMODID FROM E"), "SELECT -- it's\n_fm_mod_id FROM E");
  assert.equal(fileMakerSqlSyntax("SELECT /* it's */ d + INTERVAL 1 DAY, POSITION('a' IN 'cat')"), "SELECT /* it's */ fm_date_add(d, 1, 'DAY', 1), instr('cat', 'a')");
  assert.equal(fileMakerSqlSyntax("SELECT -- it's\nEXTRACT(YEAR FROM d), CURRENT_DATE"), "SELECT -- it's\nYEAR(d), CURDATE()");
});

test('a query with a second statement is refused, a trailing semicolon is not', () => {
  assert.equal(oneStatement('SELECT 1;'), true);
  assert.equal(oneStatement("SELECT ';' ; "), true);
  assert.equal(oneStatement('SELECT 1; -- note; more'), true);
  assert.equal(oneStatement('SELECT 1; DROP TABLE E'), false);
  assert.throws(() => rows('SELECT 1; DROP TABLE E'), /one statement/);
  assert.deepEqual(rows('SELECT Name FROM E WHERE Name = ?;', ['Ann']), [['Ann']]);
});

test('a ? with no value given is an error, not an empty result', () => {
  assert.equal(placeholders("SELECT '?' FROM E WHERE a = ? AND b = ?"), 2);
  assert.equal(placeholders('SELECT $x FROM E WHERE a = ?2'), 2);
  assert.throws(() => rows('SELECT Name FROM E WHERE Name = ?'), /1 \? placeholder but 0 values were given/);
});

test('string and number functions of the FileMaker dialect', () => {
  const one = (q: string) => Object.values(rows(q)[0])[0];
  assert.equal(one("SELECT LEFT('Mattson', 3) FROM E"), 'Mat');
  assert.equal(one("SELECT RIGHT('Mattson', 4) FROM E"), 'tson');
  assert.equal(one('SELECT SPACE(5) FROM E'), '     ');
  assert.equal(one('SELECT CHR(67) FROM E'), 'C');
  assert.equal(one("SELECT STRVAL(5 * 3) FROM E"), '15');
  assert.equal(one("SELECT STRVAL('Woltman') FROM E"), 'Woltman');
  assert.equal(one("SELECT NUMVAL('123') FROM E"), 123);
  // The Claris page: NUMVAL fails when the string is not a valid number.
  assert.throws(() => one("SELECT NUMVAL('abc') FROM E"), /not a valid number/);
  assert.equal(one("SELECT NUMVAL('') FROM E"), null);
  assert.equal(one('SELECT INT(6.4321) FROM E'), 6);
  assert.equal(one('SELECT DEG(3.141592653589793) FROM E'), 180);
  assert.equal(one('SELECT DEGREES(3.141592653589793) FROM E'), 180);
});

test('date conversions and the local current date and time', () => {
  const one = (q: string) => Object.values(rows(q)[0])[0];
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  assert.equal(one('SELECT CURRENT_DATE FROM E'), today);
  assert.equal(one('SELECT TODAY() FROM E'), today);
  assert.match(String(one('SELECT CURRENT_TIME FROM E')), /^\d\d:\d\d:\d\d$/);
  assert.match(String(one('SELECT CURRENT_TIMESTAMP FROM E')), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
  assert.match(String(one('SELECT CURTIMESTAMP() FROM E')), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
  assert.equal(one("SELECT DATEVAL('2028-01-30') FROM E"), '2028-01-30');
  assert.equal(one("SELECT TIMESTAMPVAL('2028-01-30 14:00:00') FROM E"), '2028-01-30T14:00:00');
  assert.equal(one("SELECT DATEVAL('nope') FROM E"), null);
  assert.equal(one("SELECT TIMEVAL('9:05') FROM E"), '09:05:00');
  assert.equal(one("SELECT TIMEVAL('14:00:30') FROM E"), '14:00:30');
  assert.equal(one("SELECT TIMEVAL('nope') FROM E"), null);
});

test('USER, USERNAME and CURRENT_USER are the signed-in account', () => {
  const as = (query: string, account?: string) => {
    const { sql, target } = store.calc.translateSQL(query, undefined, account);
    return target.select(sql, [], 100).rows;
  };
  for (const word of ['USER', 'USERNAME', 'CURRENT_USER', 'current_user']) {
    assert.deepEqual(as(`SELECT ${word} FROM E LIMIT 1`, "O'Neil"), [["O'Neil"]], word);
  }
  assert.deepEqual(as('SELECT Name FROM E WHERE USER = \'ann\'', 'ann').length, 2);
  assert.deepEqual(as('SELECT Name FROM E WHERE USER = \'ann\'', 'bob'), []);
  assert.deepEqual(as('SELECT USER FROM E LIMIT 1'), [['']]);
  // A name inside a string or a quoted name is not the function.
  assert.deepEqual(as("SELECT 'USER', Name AS \"USER\" FROM E WHERE Name = 'Ann'", 'ann'), [['USER', 'Ann']]);
  // The signed-in account reaches the calculation engine too.
  assert.equal(store.evaluate('E', 'ExecuteSQL ( "SELECT COUNT(*) FROM E WHERE CURRENT_USER = \'\'" ; "" ; "" )').value, '2');
});

test('a field called User is the field, not the account', () => {
  store.applyDesign([{ op: 'createTable', name: 'Log', fields: [{ name: 'User', type: 'text' }] }] as never);
  store.create('Log', { User: 'zed' });
  const { sql, target } = store.calc.translateSQL('SELECT User, USERNAME FROM Log', undefined, 'ann');
  assert.deepEqual(target.select(sql, [], 10).rows, [['zed', 'ann']]);
});

test('INTERVAL moves a date, time or timestamp', () => {
  const one = (q: string, p: (string | number)[] = []) => Object.values(rows(q, p)[0])[0];
  assert.equal(one("SELECT DATEVAL('2028-01-30') - INTERVAL 2 YEAR FROM E"), '2026-01-30');
  assert.equal(one("SELECT DATEVAL('2028-01-30') + INTERVAL 3 MONTH FROM E"), '2028-04-30');
  assert.equal(one("SELECT DATEVAL('2028-01-31') + INTERVAL 1 MONTH FROM E"), '2028-02-29');
  assert.equal(one("SELECT {d '2028-12-31'} + INTERVAL 1 DAY FROM E"), '2029-01-01');
  assert.equal(one("SELECT TIMESTAMPVAL('2028-01-30 23:30:00') + INTERVAL 45 MINUTE FROM E"), '2028-01-31T00:15:00');
  assert.equal(one("SELECT {t '23:30:00'} + INTERVAL 2 HOURS FROM E"), '01:30:00');
  assert.equal(one("SELECT Hired + INTERVAL 1 DAY FROM E WHERE Name = 'Ann'"), '2024-02-04');
  assert.equal(one("SELECT Hired + INTERVAL 1 DAY + INTERVAL 1 YEAR FROM E WHERE Name = 'Ann'"), '2025-02-04');
  assert.equal(one("SELECT Hired - INTERVAL ? DAY FROM E WHERE Name = ?", [3, 'Ann']), '2024-01-31');
  assert.equal(one("SELECT 'INTERVAL 1 DAY' FROM E"), 'INTERVAL 1 DAY');
  assert.throws(() => rows('SELECT INTERVAL 1 DAY FROM E'));
});

test('INTERVAL retains a timestamp in the spring DST gap', () => {
  const previousTZ = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const result = rows("SELECT TIMESTAMPVAL('2026-03-08 01:59:00') + INTERVAL 2 MINUTE FROM E LIMIT 1");
    assert.deepEqual(result, [['2026-03-08T02:01:00']]);
    assert.deepEqual(rows("SELECT TIMESTAMPVAL('2026-11-01 00:59:00') + INTERVAL 2 MINUTE FROM E LIMIT 1"),
      [['2026-11-01T01:01:00']]);
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test('STRVAL of a condition is False or True; of anything else, the value as text', () => {
  const one = (sql: string) => asText(store.calc.executeSQL(sql, [])[0][0]);
  assert.equal(one("SELECT STRVAL(4 = 5) FROM E WHERE Name = 'Ann'"), 'False');
  assert.equal(one("SELECT STRVAL(4 <> 5) FROM E WHERE Name = 'Ann'"), 'True');
  assert.equal(one("SELECT STRVAL(Name = 'Ann') FROM E WHERE Name = 'Ann'"), 'True');
  assert.equal(one("SELECT STRVAL(Name LIKE 'A%' AND 1 > 2) FROM E WHERE Name = 'Ann'"), 'False');
  assert.equal(one("SELECT STRVAL(NOT (1 = 1)) FROM E WHERE Name = 'Ann'"), 'False');
  assert.equal(one("SELECT STRVAL(Name IN ('Ann', 'Bo')) FROM E WHERE Name = 'Ann'"), 'True');
  assert.equal(one("SELECT STRVAL(Name IS NULL) FROM E WHERE Name = 'Ann'"), 'False');
  assert.equal(one("SELECT STRVAL(1 BETWEEN 0 AND 2) FROM E WHERE Name = 'Ann'"), 'True');
  // Nested: the outer sees the text the inner gave.
  assert.equal(one("SELECT STRVAL(STRVAL(1 = 1) = 'True') FROM E WHERE Name = 'Ann'"), 'True');
  // Not a condition at the top level: the value.
  assert.equal(one("SELECT STRVAL(12) FROM E WHERE Name = 'Ann'"), '12');
  assert.equal(one("SELECT STRVAL(CASE WHEN 1 = 1 THEN 7 ELSE 8 END) FROM E WHERE Name = 'Ann'"), '7');
  assert.equal(one("SELECT STRVAL(UPPER(Name)) FROM E WHERE Name = 'Ann'"), 'ANN');
  assert.equal(one("SELECT STRVAL(COALESCE(NULL, 1 = 1)) FROM E WHERE Name = 'Ann'"), '1');
  // The word inside a string or a name is left alone.
  assert.equal(one("SELECT 'STRVAL(1 = 1)' FROM E WHERE Name = 'Ann'"), 'STRVAL(1 = 1)');
  assert.equal(fileMakerSqlSyntax('SELECT STRVAL(a = b), STRVAL(c) FROM t'), 'SELECT STRVAL(fm_strbool(a = b)), STRVAL(c) FROM t');
  // An unterminated call is left for SQLite to report.
  assert.doesNotThrow(() => fileMakerSqlSyntax('SELECT STRVAL(a = b FROM t'));
});

test('a date word straight before a string is found however much space is between, and not inside a longer word', () => {
  assert.equal(fileMakerSqlSyntax(`SELECT DATE${' '.repeat(300)}'2026-01-01'`), "SELECT '2026-01-01'");
  assert.equal(fileMakerSqlSyntax(`SELECT {${' '.repeat(300)}d '2026-01-01' }`), "SELECT '2026-01-01'");
  assert.equal(fileMakerSqlSyntax("SELECT XDATE '2026-01-01'"), "SELECT XDATE '2026-01-01'");
  assert.equal(fileMakerSqlSyntax(`SELECT XDATE${' '.repeat(300)}'2026-01-01'`), `SELECT XDATE${' '.repeat(300)}'2026-01-01'`);
  assert.equal(fileMakerSqlSyntax("SELECT a, 'DATE', DATE '2026-01-02'"), "SELECT a, 'DATE', '2026-01-02'");
});

test('a statement with tens of thousands of strings is rewritten in time that grows with its length', () => {
  const sql = `SELECT ${Array.from({ length: 40_000 }, (_, i) => `'s' AS a${i}`).join(', ')} WHERE x = DATE '2026-01-01'`;
  const began = Date.now();
  assert.ok(fileMakerSqlSyntax(sql).endsWith("WHERE x = '2026-01-01'"));
  // Measured at about half a second; the version that searched all of the text for every string took fourteen.
  assert.ok(Date.now() - began < 6000, 'a statement of many strings took too long');
});
