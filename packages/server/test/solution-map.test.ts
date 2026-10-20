import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { aiSolutionMap, solutionMap } from '../src/solution-map.ts';
import { aiBlocker } from '../src/ai-access.ts';

test('solution map: which files reach into which, and references to unhosted files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sm-'));
  const stores: Store[] = [];
  try {
    const open = (name: string) => {
      createStore(join(dir, `${name}.sqlite`));
      const s = new Store(join(dir, `${name}.sqlite`), name);
      stores.push(s);
      return s;
    };
    const byName = new Map<string, Store>();
    const wire = () => {
      for (const s of stores) byName.set(s.name.toLowerCase(), s);
      for (const s of stores) s.resolveFile = (n) => byName.get(n.toLowerCase());
    };

    // Data holds the shared tables.
    const data = open('Data');
    data.applyDesign([
      { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'text' }] },
      { op: 'createTable', name: 'Orders', fields: [{ name: 'CustId', type: 'text' }] },
    ]);
    const customers = data.schema.tables.find((t) => t.name === 'Customers')!;
    const orders = data.schema.tables.find((t) => t.name === 'Orders')!;

    // UI reaches into Data (an occurrence and a script that opens it) and into
    // Archive, a file that is not hosted.
    const ui = open('UI');
    ui.applyDesign([
      { op: 'createDataSource', name: 'Data', paths: ['file:Data'] },
      { op: 'createDataSource', name: 'Archive', paths: ['file:Archive'] },
      { op: 'createOccurrence', name: 'Customers_ext', file: 'Data', externalTable: customers.id },
      { op: 'createOccurrence', name: 'Archive_ext', file: 'Archive', externalTable: 1 },
      { op: 'createScript', name: 'Sync', text: 'Open File [ Data ]' },
    ]);

    // Reports reaches into Data through an occurrence and a value list that
    // takes its values from a list in Data. (External value lists aren't yet
    // authorable through the writer, so this mirrors how an imported file holds
    // one: a value list whose source is another file's list, named by a data
    // source here.)
    const reports = open('Reports');
    reports.applyDesign([
      { op: 'createDataSource', name: 'Data', paths: ['file:Data'] },
      { op: 'createOccurrence', name: 'Orders_ext', file: 'Data', externalTable: orders.id },
    ]);
    const dsId = reports.schema.dataSources.find((d) => d.name === 'Data')!.id;
    reports.schema.valueLists.push({ id: 1, name: 'Known customers', external: { dataSourceId: dsId, valueListId: 7 } });

    wire();
    const map = solutionMap(stores);

    // Files, sorted, with both directions of dependency.
    assert.deepEqual(map.files.map((f) => f.name), ['Data', 'Reports', 'UI']);
    const node = (n: string) => map.files.find((f) => f.name === n)!;
    assert.deepEqual(node('Data').reaches, []);
    assert.deepEqual(node('Data').referencedBy, ['Reports', 'UI']);
    assert.deepEqual(node('UI').reaches, ['Data']);
    assert.deepEqual(node('UI').unresolved, ['Archive']);
    assert.deepEqual(node('Reports').reaches, ['Data']);
    assert.deepEqual(map.unresolved, ['Archive']);

    // The individual references, with their kind and specifics.
    const from = (n: string) => map.references.filter((r) => r.from === n);
    const uiOcc = from('UI').find((r) => r.via === 'occurrence')!;
    assert.deepEqual([uiOcc.item, uiOcc.file, uiOcc.hosted, uiOcc.detail], ['Customers_ext', 'Data', true, 'base table Customers']);
    const uiArchive = from('UI').find((r) => r.file === 'Archive')!;
    assert.equal(uiArchive.hosted, false);
    assert.ok(from('UI').some((r) => r.via === 'script' && r.item === 'Sync' && r.file === 'Data'));
    assert.ok(from('Reports').some((r) => r.via === 'valueList' && r.item === 'Known customers' && r.file === 'Data' && r.hosted));

    assert.equal(map.references.filter((r) => r.from === 'Data').length, 0);
  } finally {
    for (const s of stores) s.close();
    rmSync(dir, { recursive: true });
  }
});

test('solution map for AI: a file with AI off, and one that uses it, show only as opaque nodes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sm-ai-'));
  const stores: Store[] = [];
  try {
    const byName = new Map<string, Store>();
    const open = (name: string) => {
      createStore(join(dir, `${name}.sqlite`));
      const s = new Store(join(dir, `${name}.sqlite`), name);
      stores.push(s);
      byName.set(name.toLowerCase(), s);
      s.resolveFile = (n) => byName.get(n.toLowerCase());
      return s;
    };

    // Data has AI turned off.
    const data = open('Data');
    data.applyDesign([{ op: 'createTable', name: 'Secrets', fields: [{ name: 'Token', type: 'text' }] }]);
    data.setAiAllowed(false, { account: 'test' });
    const secrets = data.schema.tables.find((t) => t.name === 'Secrets')!;

    // UI uses Data, so it is kept from AI too (its related fields could carry Data's values out).
    const ui = open('UI');
    ui.applyDesign([
      { op: 'createDataSource', name: 'Data', paths: ['file:Data'] },
      { op: 'createOccurrence', name: 'Secrets_ext', file: 'Data', externalTable: secrets.id },
    ]);

    // Catalog is standalone, so AI may read it.
    const catalog = open('Catalog');
    catalog.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] }]);

    // The transitive AI-off rule: Data blocks itself and UI; Catalog is clear.
    assert.equal(aiBlocker(data)?.name, 'Data');
    assert.equal(aiBlocker(ui)?.name, 'Data');
    assert.equal(aiBlocker(catalog), undefined);

    const map = aiSolutionMap(stores);
    const node = (n: string) => map.files.find((f) => f.name === n)!;
    // Data and UI appear only as opaque "AI off" nodes, with none of their names.
    assert.deepEqual(node('Data'), { name: 'Data', aiOff: true });
    assert.deepEqual(node('UI'), { name: 'UI', aiOff: true });
    assert.ok(!('reaches' in node('Data')) && !('reaches' in node('UI')));
    // Catalog is a full node.
    assert.equal((node('Catalog') as { aiOff?: true }).aiOff, undefined);
    // Nothing in the references reveals the closed files or their contents.
    assert.ok(map.references.every((r) => r.from === 'Catalog'));
    const text = JSON.stringify(map.references);
    assert.ok(!text.includes('Secrets') && !text.includes('Secrets_ext'), 'no closed-file names leak');

    // The admin view (solutionMap) still shows everything, AI-off files included.
    const full = solutionMap(stores);
    assert.ok(full.references.some((r) => r.from === 'UI' && r.item === 'Secrets_ext'));
  } finally {
    for (const s of stores) s.close();
    rmSync(dir, { recursive: true });
  }
});
