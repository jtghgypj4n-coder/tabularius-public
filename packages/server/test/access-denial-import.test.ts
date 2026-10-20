import { after, before, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStore, type Store } from '../../store/src/index.ts';
import { type ScriptStep } from '../../fmp12/src/index.ts';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';
import { PiiMasker } from '../src/pii.ts';

const SECRET = 'Amelia ImportVaultsentinel';
const OPEN = { view: true, edit: true, create: true, delete: true };
const step = (stepId: number, name: string, params: ScriptStep['params'] = {}): ScriptStep => ({ stepId, name, enabled: true, params });
const exit = (calculation: string) => step(103, 'Exit Script', { calculation });
const templates = new Map<boolean, string>();

before(async () => {
  for (const alias of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-template-'));
    templates.set(alias, dir);
    for (const name of alias ? ['A', 'B', 'C'] : ['A', 'B']) createStore(join(dir, `${name}.openhbam.sqlite`));
    const host = new Host(dir);
    try {
      const a = host.get('A')!, b = host.get('B')!, owner = alias ? host.get('C')! : b;
      for (const store of new Set([a, b, owner])) store.setAiPolicy(false); // the import isolation under test, not the AI policy
      a.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Value' }, { name: 'Id', type: 'number' }] }]);
      owner.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Value' }, { name: 'Id', type: 'number' }] }]);
      owner.create('T', { Value: SECRET, Id: 1 });
      if (alias) b.applyDesign([
        { op: 'createDataSource', name: 'C', paths: ['file:C'] },
        { op: 'createOccurrence', name: 'External', file: 'C', externalTable: owner.schema.tables[0].id },
      ]);
      for (const store of new Set([a, b, owner])) {
        store.savePrivilegeSet({ name: 'Clerk', records: { ...OPEN }, layouts: 'modifiable', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: ['fmmcp'] });
        store.setPassword('clerk', 'pw', 'Clerk');
      }
      new PiiMasker(owner, 'clerk').token(SECRET, 'PERSON');
    } finally {
      await host.close();
    }
  }
});
after(() => { for (const dir of templates.values()) rmSync(dir, { recursive: true, force: true }); });

async function setup(t: TestContext, alias = false, admin = false) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-isolation-'));
  // Each case gets its own copy; hashing passwords and constructing the same schema only happen once per shape.
  for (const file of readdirSync(templates.get(alias)!)) copyFileSync(join(templates.get(alias)!, file), join(dir, file));
  const host = new Host(dir);
  const a = host.get('A')!, b = host.get('B')!, owner = alias ? host.get('C')! : b;
  const server = createMcpServer(host, admin ? { admin: true } : { account: 'clerk', password: 'pw' });
  const client = new Client({ name: 'import-isolation-test', version: '1.0.0' });
  t.after(async () => { await client.close(); await server.close(); await host.close(); rmSync(dir, { recursive: true }); });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  const run = async (steps: ScriptStep[], prepare?: () => void, layout = 'T') => {
    a.applyDesign([{ op: 'createScript', name: 'Read source', steps }]);
    prepare?.();
    const result = await client.callTool({ name: 'run_script', arguments: { database: 'A', script: 'Read source', layout, trace: true } });
    const content = result.content as { type: string; text: string }[];
    return { result, run: JSON.parse(content[0].text) };
  };
  return { a, b, owner, host, run, dir };
}

function watchReads(t: TestContext, owner: Store) {
  let reads = 0;
  for (const name of ['get', 'findIds', 'select'] as const) {
    const original = owner[name].bind(owner);
    t.mock.method(owner, name, (...args: never[]) => { reads++; return (original as (...args: never[]) => unknown)(...args); });
  }
  const prepare = owner.sql.prepare.bind(owner.sql);
  t.mock.method(owner.sql, 'prepare', (sql: string) => {
    if (/\bFROM\s+(?:"T"|T\b)/i.test(sql)) reads++;
    return prepare(sql);
  });
  return () => reads;
}

for (const alias of [false, true]) for (const isolated of [false, true]) {
  test(`MCP FileMaker import ${alias ? 'through an owning-file alias' : 'directly'} ${isolated ? 'refuses before reading or importing data' : 'imports normally'}`, async (t) => {
    const { a, b, owner, run } = await setup(t, alias);
    const source = b.schema.tableOccurrences.find((to) => to.name === (alias ? 'External' : 'T'))!;
    const valueId = owner.schema.tables[0].fields.find((f) => f.name === 'Value')!.id;
    // An occurrence cache populated before isolation must not bypass the final owner's guard.
    b.occurrence(source.name);
    assert.equal(a.schema.dataSources.length, 0);
    owner.setPiiIsolation(isolated);
    const reads = watchReads(t, owner);
    const result = await run([
      step(35, 'Import Records', { importFormat: 'FMPR', filePaths: ['file:B.fmp12'], importSource: { tableOccurrenceId: source.id, fieldIds: [valueId] } }),
      exit('T::Value'),
    ]);
    assert.equal(result.run.error, isolated ? 3 : 0);
    assert.equal(a.findIds('T').length, isolated ? 0 : 1);
    if (isolated) {
      assert.equal(result.run.result, ''); assert.ok(!JSON.stringify(result.result).includes(SECRET)); assert.equal(reads(), 0);
      assert.equal(a.securityEvents({ kind: 'privilege-denied' }).length, 0);
    } else assert.equal(result.run.result, SECRET);
  });
}

for (const path of ['sql', 'sql-cache', 'related', 'related-cache', 'field-list', 'external-list'] as const) {
  for (const isolated of [false, true]) test(`MCP ${path} ${isolated ? 'checks isolation enabled after script entry' : 'reads an allowed source normally'}`, async (t) => {
    const { a, b, owner, host, run } = await setup(t);
    a.create('T', { Id: 1 });
    a.applyDesign([
      { op: 'createDataSource', name: 'B', paths: ['file:B'] },
      { op: 'createOccurrence', name: 'External', file: 'B', externalTable: b.schema.tables[0].id },
      { op: 'createLayout', name: 'External', occurrence: 'External' },
      { op: 'createRelationship', left: 'T', right: 'External', predicates: [{ left: 'Id', right: b.schema.tables[0].fields.find((f) => f.name === 'Id')!.id }] },
      { op: 'createValueList', name: 'Values', values: [] },
    ]);
    b.applyDesign([{ op: 'createValueList', name: 'Source values', values: [SECRET] }]);
    // Imported files support these definitions; the design editor does not create external field lists yet.
    const lists = () => {
      const list = a.schema.valueLists.find((v) => v.name === 'Values')!;
      delete list.values;
      list.field = { occurrenceId: a.schema.tableOccurrences.find((to) => to.name === 'External')!.id, fieldId: b.schema.tables[0].fields.find((f) => f.name === 'Value')!.id };
      if (path === 'external-list') {
        delete list.field;
        list.external = { dataSourceId: a.schema.dataSources.find((d) => d.name === 'B')!.id, valueListId: b.schema.valueLists[0].id };
      }
    };
    if (path.endsWith('cache')) {
      a.occurrence('External'); a.layout('External');
      if (path === 'sql-cache') assert.equal(a.calc.executeSQL('SELECT Value FROM External', [])[0][0].value, SECRET);
    }
    const options = host.scriptOptions.bind(host);
    t.mock.method(host, 'scriptOptions', () => ({ ...options(), profile: {
      step: () => {}, run: () => {}, enter: (file: string) => { if (file === 'A') owner.setPiiIsolation(isolated); },
    } }));
    const reads = watchReads(t, owner);
    const steps = path.startsWith('sql') ? [exit('ExecuteSQL ( "SELECT Value FROM External" ; "" ; "" )')]
      : path.startsWith('related') ? [step(74, 'Go to Related Record', {
        tableOccurrence: { id: a.schema.tableOccurrences.find((to) => to.name === 'External')!.id, name: 'External' },
        layout: { id: a.schema.layouts.find((l) => l.name === 'External')!.id, name: 'External' },
      }), exit('External::Value')]
      : [exit('ValueListItems ( Get ( FileName ) ; "Values" )')];
    const result = await run(steps, lists);
    assert.equal(a.findIds('T').length, 1);
    if (isolated) { assert.ok(!JSON.stringify(result.result).includes(SECRET)); assert.notEqual(result.run.result, SECRET); assert.equal(reads(), 0); }
    else assert.equal(result.run.result, SECRET);
  });
}

test('Execute SQL remains unavailable and never reads the named file', async (t) => {
  const { owner, run } = await setup(t);
  owner.setPiiIsolation(true);
  const reads = watchReads(t, owner);
  const result = await run([step(117, 'Execute SQL', { calculation: '"SELECT Value FROM B"' }), exit('Get ( LastError )')]);
  assert.equal(result.run.error, 3); assert.equal(reads(), 0); assert.ok(!JSON.stringify(result.result).includes(SECRET));
});

for (const cached of [false, true]) for (const isolated of [false, true]) {
  for (const qualified of [false, true]) test(`MCP retained external layout ${cached ? 'with a cached calculation context' : 'at script entry'} ${qualified ? 'qualified' : 'unqualified'} field ${isolated ? 'refuses after isolation turns on' : 'reads normally'}`, async (t) => {
    const { a, owner, host, run } = await setup(t);
    a.applyDesign([
      { op: 'createDataSource', name: 'B', paths: ['file:B'] },
      { op: 'createOccurrence', name: 'External', file: 'B', externalTable: owner.schema.tables[0].id },
      { op: 'createLayout', name: 'External', occurrence: 'External' },
    ]);
    let reads: (() => number) | undefined;
    const enable = () => { owner.setPiiIsolation(isolated); reads = watchReads(t, owner); };
    const options = host.scriptOptions.bind(host);
    t.mock.method(host, 'scriptOptions', () => ({ ...options(), profile: {
      run: () => {},
      enter: (file: string) => { if (file === 'A' && !cached) enable(); },
      step: (file: string, _script: string, index: number) => { if (file === 'A' && cached && index === 0) enable(); },
    } }));
    const result = await run([
      ...(cached ? [step(141, 'Set Variable', { variable: '$warm', value: '1' })] : []),
      exit(`Substitute ( ${qualified ? 'External::' : ''}Value ; " " ; "_" )`),
    ], undefined, 'External');
    assert.equal(result.run.error, isolated ? 3 : 0);
    if (isolated) {
      assert.equal(result.run.result, '');
      assert.equal(reads!(), 0);
      assert.ok(!JSON.stringify(result.result).includes(SECRET));
      assert.ok(!JSON.stringify(result.result).includes(SECRET.replaceAll(' ', '_')));
    } else assert.equal(result.run.result, SECRET.replaceAll(' ', '_'));
  });
}

for (const sqlCached of [false, true]) for (const isolated of [false, true]) {
  test(`MCP dynamic subscript with its own cached context and ${sqlCached ? 'cached' : 'fresh'} SQL ${isolated ? 'refuses after isolation turns on' : 'reads normally'}`, async (t) => {
    const { a, b, owner, host, run } = await setup(t);
    // A by-name call into another file needs a declared data source; these tests are about what happens once it is reached.
    a.applyDesign([{ op: 'createDataSource', name: 'B', paths: ['file:B'] }]);
    b.applyDesign([{ op: 'createScript', name: 'Child', steps: [
      step(141, 'Set Variable', { variable: '$warm', value: '1' }),
      exit('Substitute ( ExecuteSQL ( "SELECT Value FROM T" ; "" ; "" ) ; " " ; "_" )'),
    ] }]);
    if (sqlCached) assert.equal(b.calc.executeSQL('SELECT Value FROM T', [])[0][0].value, SECRET);
    let reads: (() => number) | undefined;
    const options = host.scriptOptions.bind(host);
    t.mock.method(host, 'scriptOptions', () => ({ ...options(), profile: {
      run: () => {}, step: (file: string, script: string, index: number) => {
        if (file === 'B' && script === 'Child' && index === 0) {
          owner.setPiiIsolation(isolated);
          reads = watchReads(t, owner);
        }
      },
    } }));
    const result = await run([
      step(1, 'Perform Script', { scriptCalculation: '"B::Child"' }),
      exit('Get ( ScriptResult )'),
    ]);
    assert.equal(result.run.error, isolated ? 3 : 0);
    if (isolated) {
      assert.equal(result.run.result, '');
      assert.equal(reads!(), 0);
      assert.ok(!JSON.stringify(result.result).includes(SECRET));
      assert.ok(!JSON.stringify(result.result).includes(SECRET.replaceAll(' ', '_')));
    } else assert.equal(result.run.result, SECRET.replaceAll(' ', '_'));
  });
}

const fileSteps = [
  { id: 37, name: 'Save a Copy as', file: 'out.openhbam.sqlite' },
  { id: 37, name: 'Save a Copy as clone', file: 'clone.openhbam.sqlite', params: { copyKind: 'clone' } },
  { id: 3, name: 'Save a Copy as XML', file: 'out.xml' },
  { id: 144, name: 'Save Records as PDF', file: 'out.pdf' },
  { id: 143, name: 'Save Records as Excel', file: 'out.xlsx' },
  { id: 36, name: 'Export Records', file: 'out.csv', params: { exportFormat: 'COMS' } },
  { id: 225, name: 'Save Records as JSONL', file: 'out.jsonl' },
  { id: 152, name: 'Save Records as Snapshot Link', file: 'out.fmpsl' },
  { id: 245, name: 'Close PDF', file: 'closed.pdf' },
  { id: 132, name: 'Export Field Contents', file: 'field.txt' },
  { id: 131, name: 'Insert File into a variable', file: 'input.txt', params: { variable: '$file' } },
  { id: 190, name: 'Create Data File', file: 'created.txt' },
  { id: 197, name: 'Delete File', file: 'input.txt' },
] satisfies { id: number; name: string; file: string; params?: ScriptStep['params'] }[];

for (const spec of fileSteps) for (const isolated of [false, true]) {
  test(`MCP dynamic ${spec.name} ${isolated ? 'refuses before file access or output' : 'still works without isolation'}`, async (t) => {
    // Raw SQLite copies, like XML design exports, require Full Access. These
    // controls exercise the independent isolation gate with sufficient privileges.
    const { a, b, host, run, dir } = await setup(t, false, spec.id === 3 || spec.id === 37);
    // A by-name call into another file needs a declared data source; these tests are about what happens once it is reached.
    a.applyDesign([{ op: 'createDataSource', name: 'B', paths: ['file:B'] }]);
    const documents = join(dir, 'Documents');
    const input = spec.id === 131 || spec.id === 197;
    if (input) { mkdirSync(documents); writeFileSync(join(documents, 'input.txt'), SECRET); }
    b.applyDesign([{ op: 'createValueList', name: 'Personal metadata', values: [SECRET] }]);
    const field = { tableOccurrence: { id: b.schema.tableOccurrences[0].id, name: 'T' }, field: { id: b.schema.tables[0].fields[0].id, name: 'Value' } };
    const prefix = spec.id === 245 ? [step(243, 'Create PDF'), step(144, 'Save Records as PDF', { toOpenPdf: true })] : [];
    b.applyDesign([{ op: 'createScript', name: 'Child', steps: [...prefix, step(spec.id, spec.name, {
      filePaths: [spec.file], createFolders: true,
      ...((spec.id === 225 || spec.id === 132) ? { field } : {}), ...spec.params,
    })] }]);
    let reads: (() => number) | undefined;
    let backups = 0, designs = 0, uploads = 0;
    const backup = b.backup.bind(b), design = b.designs.bind(b);
    t.mock.method(b, 'backup', async (path: string) => { backups++; await backup(path); });
    const enable = () => {
      b.setPiiIsolation(isolated); reads = watchReads(t, b);
      t.mock.method(b, 'designs', () => { designs++; return design(); });
    };
    const options = host.scriptOptions.bind(host);
    t.mock.method(host, 'scriptOptions', () => ({ ...options(), profile: {
      run: () => {}, enter: (file: string) => { if (file === 'B' && spec.id !== 245) enable(); },
      step: (file: string, _script: string, index: number) => { if (file === 'B' && spec.id === 245 && index === 1) enable(); },
    }, insertFile: async () => { uploads++; return { filename: 'input.txt', data: new TextEncoder().encode(SECRET) }; } }));
    const result = await run([step(1, 'Perform Script', { scriptCalculation: '"B::Child"' }), exit('Get ( ScriptResult )')]);
    assert.equal(result.run.error, isolated ? 3 : 0);
    if (isolated) {
      assert.equal(reads!(), 0); assert.equal(backups, 0); assert.equal(designs, 0); assert.equal(uploads, 0);
      assert.deepEqual(result.run.actions, []);
      assert.ok(!JSON.stringify(result.result).includes(SECRET));
      assert.ok(!JSON.stringify(result.result).includes(Buffer.from(SECRET).toString('base64')));
      if (input) assert.deepEqual(readdirSync(documents), ['input.txt']);
      else assert.equal(existsSync(documents), false);
    } else if (spec.id === 132) assert.equal(result.run.actions[0].step, 'Export Field Contents');
    else if (spec.id === 131) assert.equal(readFileSync(join(documents, 'input.txt'), 'utf8'), SECRET);
    else if (spec.id === 197) assert.equal(existsSync(join(documents, 'input.txt')), false);
    else {
      assert.equal(existsSync(join(documents, spec.file)), true);
      if (spec.id === 3) assert.ok(readFileSync(join(documents, spec.file), 'utf8').includes(SECRET));
    }
  });
}

test('Close PDF rechecks the source after a dynamic subscript returns to another file', async (t) => {
  const { a, b, host, run, dir } = await setup(t);
  // A by-name call into another file needs a declared data source; these tests are about what happens once it is reached.
  a.applyDesign([{ op: 'createDataSource', name: 'B', paths: ['file:B'] }]);
  b.applyDesign([{ op: 'createScript', name: 'Child', steps: [
    step(243, 'Create PDF'), step(144, 'Save Records as PDF', { toOpenPdf: true }),
  ] }]);
  const options = host.scriptOptions.bind(host);
  let reads: (() => number) | undefined;
  t.mock.method(host, 'scriptOptions', () => ({ ...options(), profile: {
    run: () => {}, step: () => {}, leave: (file: string) => {
      if (file === 'B') { b.setPiiIsolation(true); reads = watchReads(t, b); }
    },
  } }));
  const result = await run([
    step(1, 'Perform Script', { scriptCalculation: '"B::Child"' }),
    step(245, 'Close PDF', { filePaths: ['closed.pdf'], createFolders: true }),
  ]);
  assert.equal(result.run.error, 3); assert.equal(reads!(), 0);
  assert.deepEqual(result.run.actions, []); assert.equal(existsSync(join(dir, 'Documents')), false);
});

for (const [id, name] of [[95, 'Recover File'], [96, 'Save a Copy as Add-on Package'], [139, 'Convert File']] as const) {
  test(`${name} remains unavailable and creates no output`, async (t) => {
    const { run, dir } = await setup(t);
    const result = await run([step(id, name, { filePaths: ['out.fmp12'], createFolders: true })]);
    assert.equal(result.run.error, 3); assert.deepEqual(result.run.actions, []);
    assert.equal(existsSync(join(dir, 'Documents')), false);
  });
}

for (const write of [false, true]) for (const isolated of [false, true]) {
  test(`MCP retained data-file handle ${write ? 'write' : 'read'} ${isolated ? 'rechecks its source after a subscript returns' : 'still works without isolation'}`, async (t) => {
    const { a, b, host, run, dir } = await setup(t);
    // A by-name call into another file needs a declared data source; these tests are about what happens once it is reached.
    a.applyDesign([{ op: 'createDataSource', name: 'B', paths: ['file:B'] }]);
    const documents = join(dir, 'Documents');
    mkdirSync(documents); writeFileSync(join(documents, 'input.txt'), SECRET);
    b.applyDesign([{ op: 'createScript', name: 'Child', steps: [
      step(191, 'Open Data File', { filePaths: ['input.txt'], variable: '$id' }), exit('$id'),
    ] }]);
    const options = host.scriptOptions.bind(host);
    t.mock.method(host, 'scriptOptions', () => ({ ...options(), profile: {
      run: () => {}, step: () => {}, leave: (file: string) => { if (file === 'B') b.setPiiIsolation(isolated); },
    } }));
    const result = await run([
      step(1, 'Perform Script', { scriptCalculation: '"B::Child"' }),
      step(141, 'Set Variable', { variable: '$id', value: 'Get ( ScriptResult )' }),
      ...(write ? [step(141, 'Set Variable', { variable: '$write', value: '"changed"' })] : []),
      write ? step(192, 'Write to Data File', { fileId: '$id', variable: '$write', encoding: 'utf-8' })
        : step(193, 'Read from Data File', { fileId: '$id', variable: '$contents', encoding: 'utf-8' }),
      exit(write ? '""' : 'Substitute ( $contents ; " " ; "_" )'),
    ]);
    assert.equal(result.run.error, isolated ? 3 : 0);
    if (isolated) {
      assert.equal(result.run.result, ''); assert.equal(readFileSync(join(documents, 'input.txt'), 'utf8'), SECRET);
      assert.ok(!JSON.stringify(result.result).includes(SECRET.replaceAll(' ', '_')));
    } else if (write) assert.ok(readFileSync(join(documents, 'input.txt'), 'utf8').startsWith('changed'));
    else assert.equal(result.run.result, SECRET.replaceAll(' ', '_'));
  });
}
