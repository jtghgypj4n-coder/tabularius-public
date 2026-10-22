import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, writer } from '../../store/src/index.ts';
import type { ScriptStep } from '../../fmp12/src/index.ts';
import { runScript, ScriptError } from '../src/index.ts';
import { xlsx } from '../src/xlsx.ts';

const step = (stepId: number, name: string, params: ScriptStep['params'] = {}): ScriptStep => ({ stepId, name, enabled: true, params });

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-hosted-data-isolation-'));
  const stores = ['A', 'B'].map((name) => {
    const path = join(dir, `${name}.sqlite`);
    createStore(path);
    const store = new Store(path, name);
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Value' }] }]);
    return store;
  });
  const [a, b] = stores;
  a.resolveFile = (name) => name === 'B' ? b : undefined;
  // A by-name call into another file needs a declared data source; these tests are about what happens once it is reached.
  a.applyDesign([{ op: 'createDataSource', name: 'B', paths: ['file:B'] }]);
  t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true }); });
  return { a, b, dir };
}

test('Local occurrence and layout guards refuse truncation after dynamic script entry with cold or warm caches', async (t) => {
  for (const cached of [false, true]) await t.test(cached ? 'warm occurrence cache' : 'cold occurrence cache', async (t) => {
    const { a, b } = setup(t);
    const { recordId } = b.create('T', { Value: 'Kept row' });
    b.applyDesign([{ op: 'createScript', name: 'Child', steps: [step(182, 'Truncate Table', { tableOccurrence: { id: b.schema.tableOccurrences[0].id, name: 'T' } })] }]);
    if (cached) b.occurrence('T');
    let blocked = false;
    const beforeFile = (file: Store) => {
      if (file === b && blocked) throw new ScriptError(3, 'The local file is isolated');
    };
    const result = await runScript(a, { id: 999, name: 'Caller', steps: [
      step(1, 'Perform Script', { scriptCalculation: '"B::Child"' }),
    ] }, { layout: 'T', beforeFile, profile: {
      run: () => {}, step: () => {}, enter: (file) => { if (file === 'B') blocked = true; },
    } });
    assert.equal(result.error, 3);
    assert.deepEqual(b.findIds('T'), [recordId]);
    assert.equal(b.get('T', recordId).fieldData.Value, 'Kept row');

    // A fresh local layout must be refused before querying its schema too.
    b.applyDesign([{ op: 'createLayout', name: 'Fresh', occurrence: 'T' }]);
    const schema = b.schema;
    const descriptor = Object.getOwnPropertyDescriptor(b, 'schema')!;
    let schemaReads = 0;
    Object.defineProperty(b, 'schema', { configurable: true, get: () => { schemaReads++; return schema; } });
    t.after(() => Object.defineProperty(b, 'schema', descriptor));
    let layoutReads = 0;
    const prepare = b.sql.prepare.bind(b.sql);
    t.mock.method(b.sql, 'prepare', (...args: Parameters<typeof prepare>) => { layoutReads++; return prepare(...args); });
    writer.run({ beforeFile }, () => assert.throws(() => b.layout('Fresh'), (error: unknown) => error instanceof ScriptError && error.code === 3));
    assert.equal(schemaReads, 0);
    assert.equal(layoutReads, 0);
  });
});

test('Configure Persistent Data checks the file before deletion without an instance calculation', async (t) => {
  for (const isolated of [true, false]) await t.test(isolated ? 'refused deletion' : 'allowed deletion', async (t) => {
    const { a } = setup(t);
    const value = { type: 'text', value: 'Kept entry' } as const;
    a.setPersistentData('Entry', '', value);
    let blocked = false;
    const result = await runScript(a, { id: 999, name: 'Delete entry', steps: [
      step(238, 'Configure Persistent Data', { text: 'Entry', deleteEntry: true }),
    ] }, { layout: 'T', beforeFile: (file) => {
      if (file === a && blocked) throw new ScriptError(3, 'The persistent data file is isolated');
    }, profile: { run: () => {}, step: () => {}, enter: () => { blocked = isolated; } } });
    assert.equal(result.error, isolated ? 3 : 0);
    assert.deepEqual(a.persistentData('Entry', ''), isolated ? value : undefined);
  });
});

test('CSV, Excel and XML imports check executing and destination files before reading source bytes', async (t) => {
  const sources = [
    { name: 'input.csv', format: 'COMS', bytes: Buffer.from('Imported value\n') },
    { name: 'input.xlsx', format: 'XLXE', bytes: xlsx([['Imported value']]) },
    { name: 'input.xml', format: 'XML', bytes: Buffer.from('<FMPXMLRESULT><RESULTSET><ROW><COL><DATA>Imported value</DATA></COL></ROW></RESULTSET></FMPXMLRESULT>') },
  ];
  for (const source of sources) for (const target of ['executing', 'destination', 'allowed'] as const) {
    await t.test(`${source.name}: ${target}`, async (t) => {
      const { a, b, dir } = setup(t);
      a.applyDesign([
        { op: 'createOccurrence', name: 'External', file: 'B', externalTable: b.schema.tables[0].id },
      ]);
      const path = join(dir, source.name);
      writeFileSync(path, source.bytes);
      let blocked = false, sourceReads = 0, sourceBytes = 0;
      const readFile = fs.readFileSync;
      const openFile = fs.openSync;
      // The file is read through a guarded descriptor, so a read is matched to its path by the descriptor's open.
      const opened = new Map<number, string>();
      t.mock.method(fs, 'openSync', (...args: Parameters<typeof openFile>) => {
        const fd = openFile(...args);
        if (typeof args[0] === 'string') opened.set(fd, args[0]);
        return fd;
      });
      t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof readFile>) => {
        const bytes = readFile(...args);
        const name = typeof args[0] === 'number' ? opened.get(args[0]) : String(args[0]);
        if (name === path) { sourceReads++; sourceBytes += Buffer.byteLength(bytes); }
        return bytes;
      });
      syncBuiltinESMExports();
      t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
      const result = await runScript(a, { id: 999, name: 'Import', steps: [
        step(35, 'Import Records', { importFormat: source.format, filePaths: [source.name], tableOccurrence: { id: a.schema.tableOccurrences.find((to) => to.name === 'External')!.id, name: 'External' } }),
      ] }, { layout: 'T', documents: dir, beforeFile: (file) => {
        if (blocked && file === (target === 'executing' ? a : b)) throw new ScriptError(3, 'The import file is isolated');
      }, profile: { run: () => {}, step: () => {}, enter: () => { blocked = target !== 'allowed'; } } });
      assert.equal(result.error, target === 'allowed' ? 0 : 3);
      assert.equal(sourceReads, target === 'allowed' ? 1 : 0);
      assert.equal(sourceBytes, target === 'allowed' ? source.bytes.length : 0);
      assert.equal(b.findIds('T').length, target === 'allowed' ? 1 : 0);
      assert.equal(a.findIds('T').length, 0);
    });
  }
});

test('Import Records rechecks its executing file when the current window belongs to another file', async (t) => {
  const { a, b, dir } = setup(t);
  const source = join(dir, 'cross-file.csv');
  writeFileSync(source, 'Value from B\n');
  let isolated = false, importPreflight = false;
  const readFile = fs.readFileSync;
  let sourceReads = 0;
  t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof readFile>) => {
    const data = readFile(...args);
    if (String(args[0]) === source) sourceReads++;
    return data;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  b.applyDesign([{ op: 'createScript', name: 'Child import', steps: [
    step(121, 'Close Window', { calculation: '"B"' }),
    step(35, 'Import Records', { importFormat: 'COMS', filePaths: ['cross-file.csv'], tableOccurrence: { id: a.schema.tableOccurrences[0].id, name: 'T' } }),
  ] }]);
  let schemaReads = 0, readsAtIsolation = 0;
  for (const file of [a, b]) {
    const schema = file.schema;
    const descriptor = Object.getOwnPropertyDescriptor(file, 'schema')!;
    Object.defineProperty(file, 'schema', { configurable: true, get: () => { schemaReads++; return schema; } });
    t.after(() => Object.defineProperty(file, 'schema', descriptor));
  }
  const result = await runScript(a, { id: 999, name: 'Caller', steps: [
    step(1, 'Perform Script', { scriptCalculation: '"B::Child import"' }),
  ] }, { layout: 'T', documents: dir, beforeFile: (file) => {
    if (file === b && isolated) throw new ScriptError(3, 'The executing file is isolated');
    if (file === a && importPreflight) { isolated = true; readsAtIsolation = schemaReads; }
  }, profile: { run: () => {}, step: (_file, script, index) => { if (script === 'Child import' && index === 0) importPreflight = true; }, enter: () => {} } });
  assert.equal(result.error, 3);
  assert.equal(sourceReads, 0);
  assert.equal(schemaReads, readsAtIsolation, 'Import Records performs no schema reads after isolation takes effect');
  assert.deepEqual(a.findIds('T'), []);
});

test('steps after closing an isolated child window check both files before schema inspection', async (t) => {
  for (const [name, action] of [['Beep', step(79, 'Beep')], ['Commit Records', step(75, 'Commit Records/Requests')]] as const) {
    await t.test(name, async (t) => {
      const { a, b } = setup(t);
      let isolated = false, bSchemaReads = 0, readsAtIsolation = 0;
      b.applyDesign([{ op: 'createScript', name: 'Child', steps: [
        step(121, 'Close Window', { calculation: '"B"' }), action,
      ] }]);
      const original = b.schema;
      const descriptor = Object.getOwnPropertyDescriptor(b, 'schema')!;
      Object.defineProperty(b, 'schema', { configurable: true, get: () => { bSchemaReads++; return original; } });
      t.after(() => Object.defineProperty(b, 'schema', descriptor));
      const result = await runScript(a, { id: 999, name: 'Caller', steps: [
        step(1, 'Perform Script', { scriptCalculation: '"B::Child"' }),
      ] }, { layout: 'T', beforeFile: (file) => {
        if (file === b && isolated) throw new ScriptError(3, 'B is isolated');
      }, profile: { run: () => {}, step: (_file, script, index) => {
        if (script === 'Child' && index === 0) { isolated = true; readsAtIsolation = bSchemaReads; }
      }, enter: () => {} } });
      assert.equal(result.error, 3);
      assert.equal(bSchemaReads, readsAtIsolation, 'isolation is checked before the following step inspects schema');
    });
  }
});

test('closing a retained isolated file window checks access before its layout trigger', async (t) => {
  const { a, b } = setup(t);
  b.applyDesign([{ op: 'createScript', name: 'Private trigger', text: 'Beep' }]);
  const triggerScript = b.schema.scripts.find((s) => s.name === 'Private trigger');
  assert.ok(triggerScript);
  b.applyDesign([
    { op: 'updateLayout', layout: 'T', design: { triggers: [{ event: 'OnLayoutExit', script: 'Private trigger', scriptId: triggerScript.id }] } },
    { op: 'createScript', name: 'Open retained', steps: [step(122, 'New Window', { slots: { 128: '"Second"' } })] },
  ]);
  const original = b.schema;
  const descriptor = Object.getOwnPropertyDescriptor(b, 'schema')!;
  let schemaReads = 0, readsAtIsolation = 0, isolated = false;
  Object.defineProperty(b, 'schema', { configurable: true, get: () => { schemaReads++; return original; } });
  t.after(() => Object.defineProperty(b, 'schema', descriptor));
  const result = await runScript(a, { id: 999, name: 'Caller', steps: [
    step(1, 'Perform Script', { scriptCalculation: '"B::Open retained"' }),
    step(121, 'Close Window', { calculation: '"Second"' }),
  ] }, { layout: 'T', beforeFile: (file) => {
    if (file === b && isolated) throw new ScriptError(3, 'B is isolated');
  }, profile: { run: () => {}, step: (_file, script, index) => {
    if (script === 'Caller' && index === 0) { isolated = true; readsAtIsolation = schemaReads; }
  }, enter: () => {} } });
  assert.equal(result.error, 3);
  assert.equal(schemaReads, readsAtIsolation, 'the target window schema is not read after isolation');
  assert.equal(result.actions.some((action) => action.step === 'Beep'), false, 'the private OnLayoutExit trigger does not run');
});

test('Set Error Logging skips schema and file writes when the executing file is isolated', async (t) => {
  const { a, dir } = setup(t);
  let isolated = false, schemaReads = 0, readsAtIsolation = 0;
  const original = a.schema;
  const descriptor = Object.getOwnPropertyDescriptor(a, 'schema')!;
  Object.defineProperty(a, 'schema', { configurable: true, get: () => { schemaReads++; return original; } });
  t.after(() => Object.defineProperty(a, 'schema', descriptor));
  const result = await runScript(a, { id: 999, name: 'Logging', steps: [
    step(200, 'Set Error Logging', { on: true }),
    step(79, 'Beep'),
  ] }, { layout: 'T', documents: dir, beforeFile: (file) => {
    if (file === a && isolated) throw new ScriptError(3, 'A is isolated');
  }, profile: { run: () => {}, step: (_file, _script, index) => { if (index === 0) { isolated = true; readsAtIsolation = schemaReads; } }, enter: () => {} } });
  assert.equal(result.error, 3);
  assert.equal(schemaReads, readsAtIsolation, 'error logging does not inspect the executing file schema after denial');
  assert.equal(fs.existsSync(join(dir, 'ScriptErrors.log')), false, 'denied steps do not append the error log');
});

test('account steps refuse a newly isolated executing file before reading or changing accounts', async (t) => {
  const { a, b } = setup(t);
  b.setPassword('Target', 'pw', '[Full Access]');
  b.applyDesign([{ op: 'createScript', name: 'Child account', steps: [
    step(135, 'Delete Account', { accountName: '"Target"' }),
  ] }]);
  let isolated = false;
  const result = await runScript(a, { id: 999, name: 'Caller', steps: [
    step(1, 'Perform Script', { scriptCalculation: '"B::Child account"' }),
  ] }, { layout: 'T', beforeFile: (file) => {
    if (file === b && isolated) throw new ScriptError(3, 'The executing file is isolated');
  }, profile: { run: () => {}, step: () => {}, enter: (file) => { if (file === 'B') isolated = true; } } });
  // The profile flips isolation at child entry; a subsequent account operation
  // runs with B as its executing file while the caller's window remains in A.
  assert.equal(result.error, 3);
  assert.ok(b.accounts().some((account) => account.name === 'Target'));
});

test('Execute FileMaker Data API refuses isolated executing-file metadata before dispatch', async (t) => {
  const { a, b } = setup(t);
  let isolated = false;
  b.applyDesign([{ op: 'createScript', name: 'Child metadata', steps: [
    step(203, 'Execute FileMaker Data API', { calculation: '"{\\"action\\":\\"layouts\\"}"', variable: '$response' }),
  ] }]);
  const result = await runScript(a, { id: 999, name: 'Caller', steps: [
    step(1, 'Perform Script', { scriptCalculation: '"B::Child metadata"' }),
  ] }, { layout: 'T', beforeFile: (file) => {
    if (file === b && isolated) throw new ScriptError(3, 'The executing file is isolated');
  }, profile: { run: () => {}, step: () => {}, enter: (file) => { if (file === 'B') isolated = true; } } });
  assert.equal(result.error, 3);
});

test('embedding preflight checks the executing file before its schema lookup', async (t) => {
  const { a, b } = setup(t);
  b.applyDesign([{ op: 'createScript', name: 'Child embedding', steps: [
    step(141, 'Set Variable', { variable: '$value', calculation: 'GetEmbedding ( "private text" )' }),
  ] }]);
  const schema = b.schema;
  const descriptor = Object.getOwnPropertyDescriptor(b, 'schema')!;
  let schemaReads = 0, readsAtIsolation = 0, isolated = false;
  Object.defineProperty(b, 'schema', { configurable: true, get: () => { schemaReads++; return schema; } });
  t.after(() => Object.defineProperty(b, 'schema', descriptor));
  const result = await runScript(a, { id: 999, name: 'Caller', steps: [
    step(1, 'Perform Script', { scriptCalculation: '"B::Child embedding"' }),
  ] }, { layout: 'T', beforeFile: (file) => {
    if (file === b && isolated) throw new ScriptError(3, 'The executing file is isolated');
  }, profile: { run: () => {}, step: () => {}, enter: (file) => { if (file === 'B') { isolated = true; readsAtIsolation = schemaReads; } } } });
  assert.equal(result.error, 3);
  assert.equal(schemaReads, readsAtIsolation);
});
