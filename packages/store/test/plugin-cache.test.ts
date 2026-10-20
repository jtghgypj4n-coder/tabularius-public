import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import { asText, num } from '../../calc/src/index.ts';
import { parseManifest, PluginRegistry, sandboxedCalls } from '../../plugins/src/index.ts';
import { stopJavaScript } from '../src/javascript.ts';
import { FUNCTIONS } from '../../calc/src/functions.ts';

test('non-BE built-ins require an audited stability entry; session, device, clock, random and I/O calls are volatile', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-purity-'));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Seed', type: 'number' }] }]);
  const table = store.schema.tables[0];
  let id = 1000;
  const stable = (calculation: string) => store.calc.stable(table, {
    ...table.fields[0], id: id++, name: `Check${id}`, kind: 'calculation', calculation, options: { unstored: true, global: false, repetitions: 1 },
  });
  const names = [
    'Location', 'LocationValues', 'GetPersistentData', 'ListPersistentDataIDs', 'GetRAGSpaceInfo', 'GetEmbedding',
    'Random', 'CryptEncrypt', 'CryptEncryptBase64', 'GetNthRecord', 'GetSummary', 'Self', 'LookupNext',
    'Evaluate', 'GetField', 'GetFieldName', 'GetBaseTableName', 'Get',
    'GetLayoutObjectAttribute', 'LayoutNames', 'LayoutIDs', 'ScriptNames', 'ScriptIDs', 'WindowNames', 'FieldNames',
    'TableNames', 'TableIDs', 'FieldIDs', 'FieldType', 'FieldStyle', 'FieldRepetitions', 'FieldBounds', 'FieldComment',
    'RelationInfo', 'ValueListItems', 'ValueListNames', 'ValueListIDs', 'DatabaseNames', 'LayoutObjectNames',
    'ScriptStepNames', 'BaseTableNames', 'BaseTableIDs', 'GetTableDDL', 'GetRecordIDsFromFoundSet', 'GetNextSerialValue', 'GetFieldsOnLayout',
    // Text dates with two-digit years use a moving window relative to the current year.
    'GetAsDate', 'GetAsTimestamp', 'Timestamp', 'Day', 'Month', 'Year', 'DayOfWeek', 'DayName', 'MonthName',
    'DayNameJ', 'MonthNameJ', 'DayOfYear', 'WeekOfYear', 'WeekOfYearFiscal',
    // Container values can expose lazy file readers, beyond this file's write token.
    'Base64Encode', 'Base64EncodeRFC', 'HexEncode', 'CryptDigest', 'CryptAuthCode', 'CryptGenerateSignature',
    'CryptVerifySignature', 'CryptDecrypt', 'TextDecode', 'GetTextFromPDF', 'VerifyContainer', 'GetContainerAttribute',
    'GetWidth', 'GetHeight', 'GetThumbnail', 'CosineSimilarity', 'AddEmbeddings', 'SubtractEmbeddings', 'NormalizeEmbedding',
    'GetEmbeddingAsText', 'GetEmbeddingAsFile',
  ];
  for (const name of names) {
    const fn = FUNCTIONS.get(name.toLowerCase());
    assert.ok(fn, name);
    assert.equal(stable(`${name} ( ${Array(fn.min).fill('"x"').join(' ; ')} )`), false, name);
    assert.equal(stable(name), false, `bare ${name}`);
  }
  for (const param of ['FoundCount', 'UUID', 'CurrentTimestamp', 'WindowName', 'FutureSessionValue']) {
    assert.equal(stable(`Get ( ${param} )`), false, param);
  }
  FUNCTIONS.set('futurehost', { min: 0, run: () => num(1) });
  try {
    assert.equal(stable('FutureHost ( )'), false);
    assert.equal(stable('FutureHost'), false);
  } finally { FUNCTIONS.delete('futurehost'); }
  for (const formula of ['Abs ( -1 )', 'Upper ( "x" )', 'Sum ( Seed )', 'JSONGetElement ( "{}" ; "x" )', 'Date ( 1 ; 1 ; 2026 )']) {
    assert.equal(stable(formula), true, formula);
  }
});

test('date coercions cache typed fields and literals but remain volatile for text and unknown arguments', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-date-purity-'));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [
      { name: 'D', type: 'date' }, { name: 'Tm', type: 'time' }, { name: 'Ts', type: 'timestamp' },
      { name: 'N', type: 'number' }, { name: 'Txt', type: 'text' }, { name: 'C', type: 'container' },
    ] },
    { op: 'createField', table: 'T', name: 'TextDate', type: 'date', kind: 'calculation', calculation: '"1/1/57"', options: { unstored: true } },
  ]);
  const table = store.schema.tables[0];
  let id = 1000;
  const stable = (calculation: string) => store.calc.stable(table, {
    ...table.fields[0], id: id++, name: `Check${id}`, kind: 'calculation', calculation, options: { unstored: true, global: false, repetitions: 1 },
  });
  for (const name of ['GetAsDate', 'GetAsTimestamp', 'Timestamp', 'Day', 'Month', 'Year', 'DayOfWeek', 'DayName',
    'MonthName', 'DayNameJ', 'MonthNameJ', 'DayOfYear', 'WeekOfYear', 'WeekOfYearFiscal']) {
    const extra = FUNCTIONS.get(name.toLowerCase())!.min === 2 ? '; 1' : '';
    for (const arg of ['D', 'T::D', 'Tm', 'Ts', 'N', '739905', '-1', 'Date ( 1 ; 1 ; 2026 )']) {
      const formula = `${name} ( ${arg} ${extra} )`;
      assert.equal(stable(formula), true, formula);
    }
    for (const arg of ['Txt', 'T::Txt', '"1/1/57"', 'C', 'TextDate', 'Left ( Txt ; 6 )', 'Unknown']) {
      const formula = `${name} ( ${arg} ${extra} )`;
      assert.equal(stable(formula), false, formula);
    }
  }
  assert.equal(stable('Timestamp ( D ; 0 )'), true);
  assert.equal(stable('Timestamp ( D ; Txt )'), false);
  assert.equal(stable('GetThumbnail ( C ; 10 ; 10 )'), false);
});

test('typed Year summaries reuse results while text year windows move without a write', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 0, 1).getTime() });
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-date-summary-'));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'D', type: 'date' }, { name: 'Txt', type: 'text' }] },
    { op: 'createField', table: 'T', name: 'Y', type: 'number', kind: 'calculation', calculation: 'Year ( D )', options: { unstored: true } },
    { op: 'createField', table: 'T', name: 'TextY', type: 'number', kind: 'calculation', calculation: 'Year ( Txt )', options: { unstored: true } },
    { op: 'createField', table: 'T', name: 'LiteralY', type: 'number', kind: 'calculation', calculation: 'Year ( "1/1/57" )', options: { unstored: true } },
    ...['Y', 'TextY', 'LiteralY'].map((field) => ({ op: 'createField' as const, table: 'T', name: `Total${field}`, kind: 'summary' as const, summary: { type: 'total' as const, field } })),
  ]);
  const id = store.create('T', { D: '1/1/1957', Txt: '1/1/57' }).recordId;
  store.create('T', { D: '1/1/1957', Txt: '1/1/57' });
  const year = t.mock.method(FUNCTIONS.get('year')!, 'run');
  const sum = () => asText(store.calc.executeSQL('SELECT SUM(Y) FROM T', [])[0][0]);
  assert.equal(sum(), '3914');
  const calls = year.mock.callCount();
  assert.equal(sum(), '3914');
  assert.equal(year.mock.callCount(), calls, 'typed aggregate reuses its result');
  const before = store.get('T', id).fieldData;
  assert.equal(Number(before.TotalTextY), 3914);
  assert.equal(Number(before.TotalLiteralY), 3914);
  const stamp = store.dataStamp();
  t.mock.timers.setTime(new Date(2027, 0, 1).getTime());
  const after = store.get('T', id).fieldData;
  assert.equal(Number(after.TotalY), 3914);
  assert.equal(Number(after.TotalTextY), 4114);
  assert.equal(Number(after.TotalLiteralY), 4114);
  assert.equal(store.dataStamp(), stamp);
});

test('ExecuteSQL with a clock function, or a query not written out, is volatile; its results follow the clock', (t) => {
  // Twenty seconds before midnight: the next day comes well within the minute kept results last.
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 0, 1, 23, 59, 40).getTime() });
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sql-clock-'));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'N', type: 'number' }, { name: 'Txt', type: 'text' }] },
    { op: 'createField', table: 'T', name: 'Today', type: 'text', kind: 'calculation', calculation: 'ExecuteSQL ( "SELECT CURRENT_DATE FROM T" ; "" ; "" )', options: { unstored: true } },
  ]);
  const table = store.schema.tables[0];
  let id = 1000;
  const stable = (calculation: string) => store.calc.stable(table, {
    ...table.fields[0], id: id++, name: `Check${id}`, kind: 'calculation', calculation, options: { unstored: true, global: false, repetitions: 1 },
  });
  assert.equal(stable('ExecuteSQL ( "SELECT N FROM T" ; "" ; "" )'), true);
  for (const e of ['CURRENT_DATE', 'current_time', 'Current_Timestamp', 'CURDATE()', 'curtime ( )', 'NOW()', 'CURTIMESTAMP()', 'TODAY()']) {
    for (const fn of ['ExecuteSQL', 'ExecuteSQLe']) {
      const formula = `${fn} ( "SELECT ${e} FROM T" ; "" ; "" )`;
      assert.equal(stable(formula), false, formula);
    }
  }
  for (const formula of ['ExecuteSQL ( Txt ; "" ; "" )', 'ExecuteSQL ( "SELECT N FROM " & "T" ; "" ; "" )', 'ExecuteSQL ( Left ( "SELECT N FROM T" ; 99 ) ; "" ; "" )']) {
    assert.equal(stable(formula), false, formula);
  }
  const rec = store.create('T', { N: '1' }).recordId;
  const direct = () => asText(store.calc.executeSQL('SELECT CURDATE() FROM T', [])[0][0]);
  assert.equal(store.get('T', rec).fieldData.Today, '2026-01-01');
  assert.equal(direct(), '2026-01-01');
  const stamp = store.dataStamp();
  t.mock.timers.setTime(new Date(2026, 0, 2, 0, 0, 0).getTime());
  assert.equal(store.get('T', rec).fieldData.Today, '2026-01-02');
  assert.equal(direct(), '2026-01-02');
  assert.equal(store.dataStamp(), stamp);
});

test('SortValues and UniqueValues are stable only with a literal datatype other than date or timestamp', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sortvalues-purity-'));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Txt', type: 'text' }, { name: 'N', type: 'number' }] }]);
  const table = store.schema.tables[0];
  let id = 1000;
  const stable = (calculation: string) => store.calc.stable(table, {
    ...table.fields[0], id: id++, name: `Check${id}`, kind: 'calculation', calculation, options: { unstored: true, global: false, repetitions: 1 },
  });
  for (const fn of ['SortValues', 'UniqueValues']) {
    for (const datatype of ['', '; 1', '; 2', '; -2', '; 4', '; -4', '; 1 ; "English"']) {
      assert.equal(stable(`${fn} ( Txt ${datatype} )`), true, `${fn} ( Txt ${datatype} )`);
    }
    for (const datatype of ['; 3', '; 5', '; -3', '; -5', '; 3.5', '; N', '; "2"', '; 1 + 2', '; Abs ( 2 )']) {
      assert.equal(stable(`${fn} ( Txt ${datatype} )`), false, `${fn} ( Txt ${datatype} )`);
    }
  }
});

test('a kept result is used for at most a minute, here or shared, though its formula looks stable', (t) => {
  // Year ( N ) is classified stable by N's type, but N holds text that didn't read as a number: its
  // two-digit year moves with the clock. Every kept result is bounded by the same deadline.
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 11, 31, 23, 59, 30).getTime() });
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-keep-cap-'));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'N', type: 'number' }] },
    { op: 'createField', table: 'T', name: 'Y', type: 'number', kind: 'calculation', calculation: 'Year ( N )', options: { unstored: true } },
    { op: 'createField', table: 'T', name: 'TotalY', kind: 'summary', summary: { type: 'total', field: 'Y' } },
  ]);
  const table = store.schema.tables[0];
  assert.equal(store.calc.stable(table, table.fields.find((f) => f.name === 'Y')!), true);
  const id = store.create('T', { N: '1/1/57' }).recordId;
  store.create('T', { N: '1/1/57' });
  store.shareResults();
  const read = () => [Number(store.get('T', id).fieldData.TotalY), asText(store.calc.executeSQL('SELECT SUM(Y) FROM T', [])[0][0]),
    asText(store.calc.executeSQL('SELECT Y FROM T WHERE _fm_record_id = ?', [num(id)])[0][0])];
  assert.deepEqual(read(), [3914, '3914', '1957']);
  const stamp = store.dataStamp();
  // Into 2027, within the minute: still the kept results.
  t.mock.timers.setTime(new Date(2027, 0, 1, 0, 0, 20).getTime());
  assert.deepEqual(read(), [3914, '3914', '1957']);
  // A minute after they were worked out: worked out again, in this process and from the shared results alike.
  t.mock.timers.setTime(new Date(2027, 0, 1, 0, 0, 31).getTime());
  assert.deepEqual(read(), [4114, '4114', '2057']);
  assert.equal(store.dataStamp(), stamp);
});

for (const [name, formula, first, next] of [
  ['Location', 'Length ( Location ( 10 ) )', 3, 5],
  ['LocationValues', 'GetAsNumber ( GetValue ( LocationValues ( 10 ) ; 1 ) )', 1, 222],
  ['GetPersistentData', 'GetPersistentData ( "x" )', 1, 7],
  ['ListPersistentDataIDs', 'ValueCount ( ListPersistentDataIDs ( "x" ) )', 1, 2],
] as const) test(`${name} changes bypass summary, found-set and SQL caches without a database write`, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-session-purity-'));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Seed', type: 'number' }] },
    { op: 'createField', table: 'T', name: 'Reading', type: 'number', kind: 'calculation', calculation: formula, options: { unstored: true } },
    { op: 'createField', table: 'T', name: 'Total', kind: 'summary', summary: { type: 'total', field: 'Reading' } },
  ]);
  let changed = false;
  const context = store.calc.context.bind(store.calc);
  t.mock.method(store.calc, 'context', (...args: Parameters<typeof context>) => ({
    ...context(...args),
    location: () => ({ latitude: changed ? 222 : 1, longitude: 0, horizontalAccuracy: 1, at: 0 }),
    persistentData: () => num(changed ? 7 : 1),
    persistentDataIds: () => changed ? ['a', 'b'] : ['a'],
  }));
  const id = store.create('T', { Seed: '1' }).recordId;
  store.create('T', { Seed: '2' });
  store.shareResults();
  const token = store.dataStamp();
  const published = t.mock.method(store.results!, 'put');
  const read = (expected: number) => {
    assert.equal(Number(store.get('T', id).fieldData.Total), expected * 2);
    assert.equal(Number(store.find('T', { limit: 1 }).records[0].fieldData.Total), expected * 2);
    assert.equal(asText(store.calc.executeSQL('SELECT SUM(Reading) FROM T', [])[0][0]), String(expected * 2));
    assert.equal(asText(store.calc.executeSQL('SELECT Reading FROM T WHERE Seed = ?', [num(1)])[0][0]), String(expected));
  };
  read(first);
  changed = true;
  read(next);
  assert.equal(store.dataStamp(), token);
  assert.equal(published.mock.callCount(), 0);
});

test('session, host, random and I/O compatibility functions are volatile, including future BE functions', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-builtin-purity-'));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Seed', type: 'number' }] }]);
  const table = store.schema.tables[0];
  const names = [
    'BE_VariableGet', 'BE_VariableSet', 'BE_StackPush', 'BE_StackPop', 'BE_StackCount', 'BE_StackDelete',
    ...[...FUNCTIONS.keys()].filter((name) => name.startsWith('be_array')),
    'BE_ClipboardGetText', 'BE_ClipboardFormats', 'BE_ClipboardSetText', 'BE_GetLastError', 'BE_GetLastDDLError',
    'BE_JSON_Error_Description', 'BE_CreateKeyPair', 'BE_EncryptWithKey', 'BE_OpenFile', 'BE_SelectFile', 'BE_SelectFolder',
    'BE_GetMachineName', 'BE_GetSystemDrive', 'BE_TimeCurrentMilliseconds', 'BE_TimeUTCMilliseconds', 'BE_TimeZoneOffset',
    'BE_FileReadText', 'BE_FileSize', 'BE_FileMakerSQL', 'BE_Zip', 'BE_Unzip', 'BE_Unzip_Deprecated',
    'BE_HTTP_GET', 'BE_HTTP_ResponseCode', 'BE_SMTP_Send', 'BE_FTP_Upload', 'BE_ExecuteSystemCommand',
    'BE_ContainerIsCompressed', 'BE_XSLT_Apply', 'BE_XMLParse',
  ];
  let id = 1000;
  const stable = (calculation: string) => store.calc.stable(table, {
    ...table.fields[0], id: id++, name: `Check${id}`, kind: 'calculation', calculation, options: { unstored: true, global: false, repetitions: 1 },
  });
  for (const name of names) {
    const fn = FUNCTIONS.get(name.toLowerCase());
    assert.ok(fn, `${name} must be a registered function`);
    assert.equal(stable(`${name} ( ${Array(fn.min).fill('"x"').join(' ; ')} )`), false, name);
    assert.equal(stable(name), false, `bare ${name}`);
  }
  for (const name of ['Variable.Get', 'Dictionary.GetValue', 'JSON.GetString', 'RegEx.Execute', 'QuickList.GetValue', 'Time.Now', 'Folders.SystemTemporary', 'IsError']) {
    assert.equal(stable(`MBS ( "${name}" ; "x" )`), false, name);
  }
  // Registration alone must not confer stability on newly added compatibility functions.
  FUNCTIONS.set('be_futurehost', FUNCTIONS.get('be_getmachinename')!);
  try { assert.equal(stable('BE_FutureHost ( )'), false); }
  finally { FUNCTIONS.delete('be_futurehost'); }
  for (const formula of ['BE_Version', 'BE_ValuesUnique ( "a¶a" )', 'BE_XOR ( "abc" ; 1 )', 'BE_VectorDotProduct ( "1" ; "2" )']) {
    assert.equal(stable(formula), true, formula);
  }
});

test('file and HTTP changes bypass summary, found-set, SQL and computed-column caches without a database write', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-plugin-cache-'));
  const path = join(dir, 'Shop.sqlite');
  const file = join(dir, 'value.txt');
  createStore(path);
  const store = new Store(path, 'Shop');
  t.after(async () => { store.close(); await stopJavaScript(); rmSync(dir, { recursive: true, force: true }); });
  const parsed = parseManifest({
    id: 'org.example.cache', name: 'Cache', version: '1.0.0', api: '^1.0', publisher: 'Test', main: 'main.js',
    permissions: { files: ['documents:read'], network: ['example.com'] },
    functions: [{ name: 'External_Read', min: 1 }, { name: 'External_HTTP', min: 0 }, { name: 'External_Claimed', min: 1, pure: true }],
  });
  assert.ok(parsed.ok);
  const registry = new PluginRegistry();
  registry.install(parsed.manifest, { ...sandboxedCalls(parsed.manifest, `const functions = {
    External_Read: (p) => Number(tabularius.files.read(p)),
    External_HTTP: () => Number(tabularius.http.request({ url: 'https://example.com/value' }).body),
  };`),
    // Trusted in-process integrations can access their Env directly. A purity claim must still
    // never cache a result when the plug-in has external permissions.
    External_Claimed: (args, env) => num(Number(new TextDecoder().decode(env.ctx.files!.read(asText(args[0]))))),
  });
  registry.enable('Shop', parsed.manifest.id);
  store.plugin = registry.lookup('Shop');
  store.pluginsKey = () => registry.cacheSignature('Shop');
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Seed', type: 'number' }] }]);
  const formulas = [
    ['Size', `BE_FileSize ( "${file}" )`],
    ['Read', `GetAsNumber ( BE_FileReadText ( "${file}" ) )`],
    ['Plugin', `External_Read ( "${file}" )`],
    ['HTTP', 'External_HTTP ( )'],
    ['Claimed', `External_Claimed ( "${file}" )`],
    ['Indirect', 'Read + Plugin'],
  ];
  for (const [name, calculation] of formulas) store.applyDesign([
    { op: 'createField', table: 'T', name, type: 'number', kind: 'calculation', calculation, options: { unstored: true } },
    { op: 'createField', table: 'T', name: `Total${name}`, kind: 'summary', summary: { type: 'total', field: name } },
  ]);
  writeFileSync(file, '7');
  let response = '7';
  const context = store.calc.context.bind(store.calc);
  t.mock.method(store.calc, 'context', (...args: Parameters<typeof context>) => ({
    ...context(...args),
    files: { read: () => readFileSync(file), size: () => statSync(file).size, write: () => false },
    network: { fetch: () => ({ status: 200, body: response, headers: {} }) },
  }));
  const id = store.create('T', { Seed: '1' }).recordId;
  store.create('T', { Seed: '2' });
  store.shareResults();
  const token = store.dataStamp();
  const published = t.mock.method(store.results!, 'put');
  const read = (size: number, value: number) => {
    const whole = store.get('T', id).fieldData;
    const found = store.find('T', { limit: 1 }).records[0].fieldData;
    for (const fields of [whole, found]) {
      assert.equal(Number(fields.TotalSize), size * 2);
      for (const name of ['Read', 'Plugin', 'HTTP', 'Claimed']) assert.equal(Number(fields[`Total${name}`]), value * 2, name);
      assert.equal(Number(fields.TotalIndirect), value * 4);
    }
    const sql = store.calc.executeSQL('SELECT SUM(Size), SUM(Read), SUM(Plugin), SUM(HTTP), SUM(Claimed) FROM T', []);
    assert.deepEqual(sql[0].map((value) => asText(value)), [String(size * 2), ...Array(4).fill(String(value * 2))]);
    // A different query must not reuse stale fm_computed values either.
    assert.equal(asText(store.calc.executeSQL('SELECT Read FROM T WHERE Seed = ?', [num(1)])[0][0]), String(value));
  };
  read(1, 7);
  writeFileSync(file, '123');
  response = '123';
  read(3, 123);
  assert.equal(store.dataStamp(), token);
  assert.equal(published.mock.callCount(), 0, 'external results must not be published for another process');
});

test('manifest purity reaches named and decoded calls, while bare calls and indirect formulas remain volatile by default', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-plugin-purity-'));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const parsed = parseManifest({
    id: 'org.example.purity', name: 'Purity', version: '1.0.0', api: '^1.0', publisher: 'Test', main: 'main.js', owners: ['Test'],
    functions: [{ name: 'Pure_Value', min: 0, pure: true, owner: 'Test', index: 1 }, { name: 'Live_Value', min: 0, owner: 'Test', index: 2 }],
  });
  assert.ok(parsed.ok);
  let calls = 0;
  const registry = new PluginRegistry();
  registry.install(parsed.manifest, { Pure_Value: () => { calls++; return num(5); }, Live_Value: () => num(7) });
  registry.enable('Shop', parsed.manifest.id);
  store.plugin = registry.lookup('Shop');
  store.pluginsKey = () => registry.cacheSignature('Shop');
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Seed', type: 'number' }] }]);
  store.applyDesign([{ op: 'createCustomFunction', name: 'WrappedLive', parameters: [], formula: 'Live_Value ( )' }]);
  const cases: [string, string, boolean][] = [
    ['Pure', 'pUrE_vAlUe ( )', true], ['BarePure', 'Pure_Value', true], ['MarkerPure', '⟨Test:1⟩ ( )', true],
    ['Live', 'Live_Value ( )', false], ['BareLive', 'Live_Value', false], ['MarkerLive', '⟨Test:2⟩ ( )', false],
    ['Indirect', 'Live + 1', false], ['Custom', 'WrappedLive ( )', false], ['BareCustom', 'WrappedLive', false], ['Clock', 'BE_TimeCurrentMilliseconds', false],
    ['File', 'BE_FileSize ( "x" )', false], ['Network', 'BE_HTTP_GET ( "https://example.com" )', false],
    ['Literal', 'Length ( "Live_Value BE_FileSize" )', true],
    ['Local', 'Let ( Live_Value = 1 ; Live_Value )', true],
  ];
  for (const [name, calculation] of cases) store.applyDesign([{ op: 'createField', table: 'T', name, type: 'number', kind: 'calculation', calculation, options: { unstored: true } }]);
  store.applyDesign([{ op: 'createField', table: 'T', name: 'Total', kind: 'summary', summary: { type: 'total', field: 'Pure' } }]);
  const table = store.schema.tables[0];
  for (const [name, , stable] of cases) assert.equal(store.calc.stable(table, table.fields.find((f) => f.name === name)!), stable, name);
  store.create('T', { Seed: '1' });
  store.shareResults();
  assert.equal(asText(store.calc.executeSQL('SELECT SUM(Pure) FROM T', [])[0][0]), '5');
  const before = calls;
  assert.equal(asText(store.calc.executeSQL('SELECT SUM(Pure) FROM T', [])[0][0]), '5');
  assert.equal(calls, before, 'pure calculations still reuse cached results');
  registry.disable('Shop', parsed.manifest.id);
  assert.equal(store.calc.stable(table, table.fields.find((f) => f.name === 'Pure')!), false);
  registry.install(parsed.manifest, { Pure_Value: () => num(9), Live_Value: () => num(7) });
  registry.enable('Shop', parsed.manifest.id);
  assert.equal(asText(store.calc.executeSQL('SELECT SUM(Pure) FROM T', [])[0][0]), '9', 'replacement invalidates local and shared pure results');
});
