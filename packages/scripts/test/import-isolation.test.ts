import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { runScript, ScriptError } from '../src/index.ts';

for (const cached of [false, true]) test(`FileMaker import guards the resolved owner before schema or records (${cached ? 'cached' : 'fresh'} occurrence)`, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-owner-'));
  const stores = ['A', 'B', 'C'].map((name) => {
    createStore(join(dir, `${name}.sqlite`)); return new Store(join(dir, `${name}.sqlite`), name);
  });
  const [a, b, c] = stores;
  t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true }); });
  a.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Value' }] }]);
  c.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Value' }] }]);
  c.create('T', { Value: 'ImportOwnerSchemaVaultsentinel' });
  b.resolveFile = (name) => name === 'C' ? c : undefined;
  b.applyDesign([
    { op: 'createDataSource', name: 'C', paths: ['file:C'] },
    { op: 'createOccurrence', name: 'External', file: 'C', externalTable: c.schema.tables[0].id },
  ]);
  a.resolveFile = (name) => name === 'B' ? b : undefined;
  const source = b.schema.tableOccurrences.find((to) => to.name === 'External')!;
  const field = c.schema.tables[0].fields[0].id;
  if (cached) b.occurrence('External');
  const descriptor = Object.getOwnPropertyDescriptor(c, 'schema')!;
  const schema = c.schema;
  let schemaReads = 0, recordReads = 0;
  Object.defineProperty(c, 'schema', { configurable: true, get: () => { schemaReads++; return schema; } });
  t.after(() => Object.defineProperty(c, 'schema', descriptor));
  const find = c.findIds.bind(c);
  t.mock.method(c, 'findIds', (...args: Parameters<typeof find>) => { recordReads++; return find(...args); });
  const guarded: string[] = [];
  const result = await runScript(a, { id: 999, name: 'Import', steps: [
    { stepId: 35, name: 'Import Records', enabled: true, params: { importFormat: 'FMPR', filePaths: ['file:B.fmp12'], importSource: { tableOccurrenceId: source.id, fieldIds: [field] } } },
    { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'T::Value' } },
  ] }, { layout: 'T', beforeFile: (file) => {
    guarded.push(file.name);
    if (file === c) throw new ScriptError(3, 'The source file is isolated');
  } });
  assert.equal(result.error, 3); assert.equal(result.result, '');
  assert.ok(guarded.includes('B')); assert.ok(guarded.includes('C'));
  assert.equal(schemaReads, 0); assert.equal(recordReads, 0); assert.equal(a.findIds('T').length, 0);
  assert.ok(!JSON.stringify(result).includes('ImportOwnerSchemaVaultsentinel'));
});

for (const path of ['fresh-context', 'cached-context', 'record-step'] as const) {
  test(`Retained external layout guards schema and record reads after access changes (${path})`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-retained-owner-'));
    const stores = ['A', 'B'].map((name) => {
      createStore(join(dir, `${name}.sqlite`)); return new Store(join(dir, `${name}.sqlite`), name);
    });
    const [a, b] = stores;
    t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true }); });
    b.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Value' }] }]);
    b.create('T', { Value: 'RetainedOwnerSchemaVaultsentinel' });
    a.resolveFile = (name) => name === 'B' ? b : undefined;
    a.applyDesign([
      { op: 'createDataSource', name: 'B', paths: ['file:B'] },
      { op: 'createOccurrence', name: 'External', file: 'B', externalTable: b.schema.tables[0].id },
      { op: 'createLayout', name: 'External', occurrence: 'External' },
    ]);
    const descriptor = Object.getOwnPropertyDescriptor(b, 'schema')!;
    const schema = b.schema;
    let blocked = false, schemaReads = 0, recordReads = 0;
    Object.defineProperty(b, 'schema', { configurable: true, get: () => { if (blocked) schemaReads++; return schema; } });
    t.after(() => Object.defineProperty(b, 'schema', descriptor));
    for (const name of ['get', 'findIds'] as const) {
      const original = b[name].bind(b);
      t.mock.method(b, name, (...args: never[]) => { if (blocked) recordReads++; return (original as (...args: never[]) => unknown)(...args); });
    }
    const result = await runScript(a, { id: 999, name: 'Retained owner', steps: [
      ...(path === 'cached-context' ? [{ stepId: 141, name: 'Set Variable', enabled: true, params: { variable: '$warm', value: '1' } }] : []),
      ...(path === 'record-step' ? [{ stepId: 23, name: 'Show All Records', enabled: true }] : [
        { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Substitute ( External::Value ; "Owner" ; "_Owner_" )' } },
      ]),
    ] }, { layout: 'External', beforeFile: (file) => {
      if (file === b && blocked) throw new ScriptError(3, 'The retained owner is isolated');
    }, profile: {
      run: () => {}, enter: () => { if (path !== 'cached-context') blocked = true; },
      step: (_file, _script, index) => { if (path === 'cached-context' && index === 0) blocked = true; },
    } });
    assert.equal(result.error, 3); assert.equal(result.result, '');
    assert.equal(schemaReads, 0); assert.equal(recordReads, 0);
    assert.ok(!JSON.stringify(result).includes('RetainedOwnerSchemaVaultsentinel'));
  });
}

for (const when of ['before', 'during', 'never'] as const) {
  test(`Insert File checks another file's field before upload and again afterward (isolation ${when})`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-insert-owner-'));
    const stores = ['A', 'B'].map((name) => {
      createStore(join(dir, `${name}.sqlite`)); return new Store(join(dir, `${name}.sqlite`), name);
    });
    const [a, b] = stores;
    t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true }); });
    a.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Id', type: 'number' }] }]);
    b.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Id', type: 'number' }, { name: 'Attachment', type: 'container' }] }]);
    a.create('T', { Id: 1 });
    const { recordId } = b.create('T', { Id: 1 });
    a.resolveFile = (name) => name === 'B' ? b : undefined;
    a.applyDesign([
      { op: 'createDataSource', name: 'B', paths: ['file:B'] },
      { op: 'createOccurrence', name: 'External', file: 'B', externalTable: b.schema.tables[0].id },
      { op: 'createRelationship', left: 'T', right: 'External', predicates: [{ left: 'Id', right: b.schema.tables[0].fields[0].id }] },
    ]);
    let blocked = false, uploads = 0;
    const data = new TextEncoder().encode('InsertFileVaultsentinel');
    const result = await runScript(a, { id: 999, name: 'Insert', steps: [
      { stepId: 131, name: 'Insert File', enabled: true, params: { field: {
        tableOccurrence: { id: a.schema.tableOccurrences.find((to) => to.name === 'External')!.id, name: 'External' },
        field: { id: b.schema.tables[0].fields[1].id, name: 'Attachment' },
      } } },
    ] }, { layout: 'T', beforeFile: (file) => {
      if (file === b && blocked) throw new ScriptError(3, 'The target file is isolated');
    }, insertFile: async () => {
      uploads++;
      if (when === 'during') blocked = true;
      return { filename: 'input.txt', data };
    }, profile: { run: () => {}, step: () => {}, enter: () => { blocked = when === 'before'; } } });
    assert.equal(result.error, when === 'never' ? 0 : 3);
    assert.equal(uploads, when === 'before' ? 0 : 1);
    const containerId = b.containerId(b.occurrence('T'), recordId, 'Attachment');
    if (when === 'never') assert.deepEqual(b.container(containerId!)!.data, data);
    else assert.equal(containerId, undefined);
    assert.ok(!JSON.stringify(result).includes('InsertFileVaultsentinel'));
  });
}
