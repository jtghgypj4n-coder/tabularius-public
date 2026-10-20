// The optimization report: container files kept inside a converted file (measured on the public Beezwax samples),
// sorts and relationships on fields no index can serve, things nothing uses, and its use through the admin API, MCP
// and the CLI. It changes nothing: the one action it describes (an index) is carried out by an existing request.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, importFmp12, Store } from '../../store/src/index.ts';
import { bytesText, containerUse, optimizationReport } from '../src/optimization.ts';

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const have = (f: string) => existsSync(join(fixtures, f));
const skipFixtures = have('BeezwaxUnifiedSearchActions.fmp12') && have('DEMO_drawers.fmp12') ? false : 'fixtures missing: run npm run fixtures';
const templateDir = mkdtempSync(join(tmpdir(), 'tabularius-opt-templates-'));
const convertedTemplates = new Map<string, string>();
after(() => rmSync(templateDir, { recursive: true, force: true }));

function converted(file: string): { store: Store; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-opt-'));
  const path = join(dir, 'x.openhbam.sqlite');
  let template = convertedTemplates.get(file);
  if (!template) {
    template = join(templateDir, `${convertedTemplates.size}.openhbam.sqlite`);
    importFmp12(join(fixtures, file), template);
    convertedTemplates.set(file, template);
  }
  // Each check receives a private store; conversion of the same public sample happens once per file.
  copyFileSync(template, path);
  const store = new Store(path, file.replace(/\.fmp12$/, ''));
  return { store, done: () => { store.close(); rmSync(dir, { recursive: true }); } };
}

test('container files inside the file are sized by field, and the totals match the database', { skip: skipFixtures }, () => {
  const { store, done } = converted('BeezwaxUnifiedSearchActions.fmp12');
  try {
    const raw = store.sql.prepare('SELECT count(*) AS n, sum(length(data)) AS b FROM _fm_containers').get() as { n: number; b: number };
    const use = containerUse(store);
    assert.equal(use.reduce((n, u) => n + u.files, 0), raw.n);
    assert.equal(use.reduce((n, u) => n + u.bytes, 0), raw.b);
    const asset = use.find((u) => u.table === 'ASSET' && u.field === 'container')!;
    assert.equal(asset.files, 8);
    assert.ok(asset.bytes > 20 * 1024 ** 2 && asset.images === 5, JSON.stringify(asset));

    const r = optimizationReport(store);
    const top = r.findings[0];
    assert.equal(top.id, 'embedded-container:ASSET::container');
    assert.equal(top.impact, 'high');
    assert.equal(top.savesBytes, asset.bytes);
    assert.match(top.what, /8 files totalling 2\d\.\d MB \(81% of the converted file\) are stored in the database itself, 5 pictures/);
    // Embedding vectors are data for semantic search, not files anyone opens: no advice to move them.
    assert.ok(!r.findings.some((f) => /embedding/i.test(f.id) && f.id.startsWith('embedded-container')), r.findings.map((f) => f.id).join());
    // Moving to S3 is described but can't be done until a connection exists.
    const s3 = top.actions!.find((a) => a.id === 'container-to-s3')!;
    assert.equal(s3.available, false);
    assert.match(s3.unavailable!, /S3 connection/);
    assert.match(r.headline, /^BeezwaxUnifiedSearchActions: \d+ suggestions? \(1 high impact\), 2\d\.\d MB of container files stored inside the file \(\d+% of 26\.0 MB\)$/);
    assert.match(r.text, /^# BeezwaxUnifiedSearchActions: ways to make it smaller and faster/);
    assert.match(r.text, /- \*\*Container files inside the file: ASSET::container\*\* \(saves up to 2\d\.\d MB; 8\)/);
  } finally {
    done();
  }
});

test('pictures far bigger than the layouts show them are found, with the saving marked as an estimate', { skip: skipFixtures }, () => {
  const { store, done } = converted('BeezwaxUnifiedSearchActions.fmp12');
  try {
    const f = optimizationReport(store).findings.find((x) => x.id === 'oversized-pictures:ASSET::container')!;
    assert.ok(f, 'found');
    assert.equal(f.estimated, true);
    assert.equal(f.count, 5);
    assert.ok(f.savesBytes! > 4 * 1024 ** 2 && f.savesBytes! < 6.1 * 1024 ** 2, String(f.savesBytes));
    assert.match(f.what, /draws them at most 190 × 190 points, and the largest is 1024 × 1792 pixels/);
    assert.match(optimizationReport(store).text, /\*\*Pictures far bigger than they are shown: ASSET::container\*\* \(saves about \d\.\d MB; 5\)/);
  } finally {
    done();
  }
});

test('one big picture is most of a small file', { skip: skipFixtures }, () => {
  const { store, done } = converted('DEMO_drawers.fmp12');
  try {
    const r = optimizationReport(store);
    assert.equal(r.containers.files, 6);
    assert.equal(r.containers.images, 6);
    assert.equal(r.findings[0].id, 'embedded-container:RECORD::field_container_01');
    assert.equal(r.findings[0].impact, 'high');
    assert.match(r.text, /all of them pictures/);
    assert.ok(r.spaceByTable.length === 0 || r.spaceByTable[0].name === '_fm_containers');
  } finally {
    done();
  }
});

test('a file with no container files and no big tables has little to say', { skip: have('Charts.fmp12') ? false : 'fixtures missing: run npm run fixtures' }, () => {
  const { store, done } = converted('Charts.fmp12');
  try {
    const r = optimizationReport(store);
    assert.equal(r.containers.files, 0);
    assert.ok(!r.findings.some((f) => f.id.startsWith('embedded-container')));
    assert.ok(r.findings.every((f) => f.impact === 'low'), r.findings.map((f) => `${f.impact} ${f.id}`).join());
  } finally {
    done();
  }
});

// --- a made-up file: sorts and matches on fields no index can serve ---------------------------------

let shopTemplate: string | undefined;
function buildShopTemplate(path: string): void {
  createStore(path);
  const s = new Store(path, 'Shop');
  s.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Number', type: 'number' }, { name: 'Status', type: 'text' }, { name: 'Total', type: 'number' }, { name: 'Notes', type: 'text' }, { name: 'Nothing', type: 'text' }] },
    { op: 'createField', table: 'Orders', name: 'Doubled', kind: 'calculation', type: 'number', calculation: 'Total * 2', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'Today', kind: 'calculation', type: 'text', calculation: 'Get ( CurrentDate )', options: { unstored: true } },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'Order', type: 'number' }, { name: 'Label', type: 'text' }] },
    { op: 'createRelationship', left: 'Orders', right: 'Lines', predicates: [{ left: 'Number', right: 'Order' }] },
    { op: 'createScript', name: 'Sort by status', text: 'Sort Records [ Restore; Orders::Status; ascending ; With dialog: Off ]' },
    { op: 'createScript', name: 'Sort by doubled', text: 'Sort Records [ Restore; Orders::Doubled; descending ; With dialog: Off ]' },
    { op: 'createScript', name: 'Sort by today', text: 'Sort Records [ Restore; Orders::Today; ascending ; With dialog: Off ]' },
    { op: 'createScript', name: 'Sort lines', text: 'Sort Records [ Restore; Lines::Label; ascending ; With dialog: Off ]' },
    { op: 'createScript', name: 'Run it all', text: 'Perform Script [ "Sort by status" ]\nPerform Script [ "Sort by doubled" ]\nPerform Script [ "Sort by today" ]\nPerform Script [ "Sort lines" ]' },
    { op: 'createScript', name: 'Forgotten', text: '# nobody calls this' },
    // The layouts made for the tables name every field; these show none, as a file whose layouts were tidied does.
    { op: 'updateLayout', layout: 'Orders', design: { objects: [] } },
    { op: 'updateLayout', layout: 'Lines', design: { objects: [] } },
  ] as never);
  s.close();
  const sql = new DatabaseSync(path);
  sql.exec('BEGIN');
  const ins = sql.prepare('INSERT INTO Orders (Number, Status, Total, Notes) VALUES (?, ?, ?, ?)');
  for (let i = 1; i <= 12_000; i++) ins.run(i, i % 3 ? 'open' : 'closed', i, 'x'.repeat(10));
  const line = sql.prepare('INSERT INTO Lines ("Order", Label) VALUES (?, ?)');
  for (let i = 1; i <= 50; i++) line.run(i, 'a');
  sql.exec('COMMIT');
  sql.close();
}

function made(): { store: Store; done: () => void; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-opt-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  if (!shopTemplate) {
    shopTemplate = join(templateDir, 'Shop.openhbam.sqlite');
    buildShopTemplate(shopTemplate);
  }
  // The 12,000 Orders and 50 Lines are required by the report assertions; copy that seed per test.
  copyFileSync(shopTemplate, path);
  const store = new Store(path, 'Shop');
  return { store, dir, done: () => { store.close(); rmSync(dir, { recursive: true }); } };
}

test('a sort on an unstored calculation or an unindexed field in a big table is found, with the fix where one exists', () => {
  const { store, done } = made();
  try {
    const r = optimizationReport(store);
    const ids = r.findings.map((f) => f.id);

    // Stored but not indexed: an index fixes it, and the report says how to ask for one.
    const status = r.findings.find((f) => f.id === 'unindexed-key:Orders::Status')!;
    assert.equal(status.impact, 'high');
    assert.match(status.what, /12,000 records in Orders; sorting on it reads them all\./);
    assert.deepEqual(status.actions, [{
      id: 'add-index', label: 'Add an index on Orders::Status', available: true,
      request: { method: 'POST', path: '/tabularius/admin/v1/indexes', body: { database: 'Shop', table: 'Orders', field: 'Status' } },
    }]);
    assert.deepEqual(status.where, ['Script "Sort by status", line 1']);

    // An unstored calculation that only reads its own table's fields can be stored; one that reads the clock can't.
    const doubled = r.findings.find((f) => f.id === 'unstored-key:Orders::Doubled')!;
    assert.match(doubled.instead!, /make it a stored calculation/);
    assert.deepEqual(doubled.actions!.map((a) => [a.id, a.undoable]), [['store-calculation', true]], 'an undoable fix, made only when a person asks (see optimization-fix.test.ts)');
    const today = r.findings.find((f) => f.id === 'unstored-key:Orders::Today')!;
    assert.match(today.instead!, /can't simply be stored/);

    // A small table costs nothing worth saying; a relationship key gets its own lookup.
    assert.ok(!ids.includes('unindexed-key:Lines::Label'));
    assert.ok(!ids.includes('unindexed-key:Orders::Number'));

    // Things nothing uses.
    assert.ok(ids.includes('unused-fields'));
    const unused = r.findings.find((f) => f.id === 'unused-fields')!;
    assert.ok(unused.where.some((w) => w.startsWith('Orders::Nothing')), unused.where.join());
    assert.ok(!unused.where.some((w) => /Orders::(Status|Total|Number)/.test(w)));
    const scripts = r.findings.find((f) => f.id === 'unused-scripts')!;
    assert.deepEqual(scripts.where, ['Run it all', 'Forgotten']);

    // Worst first.
    assert.equal(r.findings[0].impact, 'high');
    assert.ok(r.findings.map((f) => ['high', 'medium', 'low'].indexOf(f.impact)).every((n, i, a) => i === 0 || a[i - 1] <= n));
  } finally {
    done();
  }
});

test('adding the suggested index clears the finding, and reading the report changes nothing', () => {
  const { store, done } = made();
  try {
    const before = store.writeToken();
    const first = optimizationReport(store);
    assert.equal(store.writeToken(), before, 'a report leaves the file untouched');
    const f = first.findings.find((x) => x.id === 'unindexed-key:Orders::Status')!;
    const body = f.actions![0].request!.body as { table: string; field: string };
    store.addFieldIndex(body.table, body.field);
    assert.ok(!optimizationReport(store).findings.some((x) => x.id === 'unindexed-key:Orders::Status'));
    store.dropFieldIndex(body.table, body.field);
  } finally {
    done();
  }
});

test('sizes are written the way people read them', () => {
  assert.equal(bytesText(512), '512 bytes');
  assert.equal(bytesText(2048), '2 KB');
  assert.equal(bytesText(26_000_000), '24.8 MB');
  assert.equal(bytesText(3 * 1024 ** 3), '3.0 GB');
});

// --- how people get it: the admin API, MCP, the upload result and the CLI -------------------------------------------

import { copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { serve } from '../src/index.ts';
import { createMcpServer } from '../src/mcp.ts';

const cli = join(import.meta.dirname, '../../cli/src/main.ts');
const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', cli, ...args], { encoding: 'utf8' });

test('the admin console, MCP and the CLI give the same report', { skip: skipFixtures }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-opt-serve-'));
  copyFileSync(join(fixtures, 'DEMO_drawers.fmp12'), join(dir, 'Drawers.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  const mcp = createMcpServer(s.host, { admin: true });
  const client = new Client({ name: 'optimization-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await mcp.close();
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true });
  });

  const api = await fetch(`${s.url}/tabularius/admin/v1/optimization/Drawers`, { headers: { 'x-tabularius-admin': '1' } });
  assert.equal(api.status, 200);
  const report = await api.json() as ReturnType<typeof optimizationReport>;
  assert.equal(report.findings[0].id, 'embedded-container:RECORD::field_container_01');
  assert.equal((await fetch(`${s.url}/tabularius/admin/v1/optimization/Nope`, { headers: { 'x-tabularius-admin': '1' } })).status, 404);
  assert.equal((await fetch(`${s.url}/tabularius/admin/v1/optimization/Drawers`, { method: 'POST', headers: { 'x-tabularius-admin': '1' } })).status, 405);

  const [ct, st] = InMemoryTransport.createLinkedPair();
  await mcp.connect(st);
  await client.connect(ct);
  const text = ((await client.callTool({ name: 'optimization_report', arguments: { database: 'Drawers' } })).content as { text: string }[])[0].text;
  assert.match(text, /^# Drawers: ways to make it smaller and faster/);
  assert.ok(text.includes('Container files inside the file: RECORD::field_container_01'));
  const asJson = JSON.parse(((await client.callTool({ name: 'optimization_report', arguments: { database: 'Drawers', json: true } })).content as { text: string }[])[0].text);
  assert.equal(asJson.findings[0].savesBytes, report.findings[0].savesBytes);
  const missing = await client.callTool({ name: 'optimization_report', arguments: { database: 'Nope' } });
  assert.equal(missing.isError, true);

  // A hosted folder, and a .fmp12 on its own (converted to a scratch copy: nothing is left behind).
  s.host.close();
  const folder = run('optimize', dir, 'Drawers');
  assert.equal(folder.status, 0, folder.stderr);
  assert.match(folder.stdout, /^# Drawers: ways to make it smaller and faster/);
  assert.ok(folder.stdout.includes('Container files inside the file: RECORD::field_container_01'));
});

test('tabularius optimize reads a .fmp12 without hosting it, as text or JSON', { skip: skipFixtures }, () => {
  const text = run('optimize', join(fixtures, 'BeezwaxUnifiedSearchActions.fmp12'));
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^# BeezwaxUnifiedSearchActions: ways to make it smaller and faster/);
  assert.match(text.stdout, /Container files inside the file: ASSET::container\*\* \(saves up to 2\d\.\d MB; 8\)/);
  const json = run('optimize', join(fixtures, 'BeezwaxUnifiedSearchActions.fmp12'), '--json');
  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout) as ReturnType<typeof optimizationReport>;
  assert.equal(report.findings[0].impact, 'high');
  assert.ok(report.containers.files > 400);
});

// --- what the records hold ------------------------------------------------------------------------

test('pictures written into a text field, and fields empty in every record, are found by reading the records', () => {
  const { store, done, dir } = made();
  try {
    store.applyDesign([{ op: 'createTable', name: 'Docs', fields: [{ name: 'Body', type: 'text' }, { name: 'Picture', type: 'text' }, { name: 'Title', type: 'text' }, { name: 'Spare', type: 'text' }] }] as never);
    store.close();
    const sql = new DatabaseSync(join(dir, 'Shop.openhbam.sqlite'));
    sql.exec('BEGIN');
    const ins = sql.prepare('INSERT INTO Docs (Body, Picture, Title) VALUES (?, ?, ?)');
    for (let i = 0; i < 1_200; i++) ins.run('t'.repeat(10), 'data:image/png;base64,' + 'A'.repeat(5_000), `Doc ${i}`);
    sql.exec('COMMIT');
    sql.close();
    const again = new Store(join(dir, 'Shop.openhbam.sqlite'), 'Shop');
    try {
      const r = optimizationReport(again);
      const pic = r.findings.find((f) => f.id === 'big-text:Docs::Picture')!;
      assert.equal(pic.title, 'Pictures and files written into a text field: Docs::Picture');
      assert.equal(pic.impact, 'medium');
      assert.match(pic.what, /1,200 records of Docs fill Docs::Picture with 5\.7 MB in all; the longest value is 5 KB\. 1,200 values start with "data:"/);
      assert.match(pic.instead!, /container files in disguise/);
      assert.equal(pic.savesBytes, 1_200 * (5_000 + 'data:image/png;base64,'.length));
      // Short text is no finding, however many records there are.
      assert.ok(!r.findings.some((f) => f.id === 'big-text:Docs::Body' || f.id === 'big-text:Docs::Title'));

      const empty = r.findings.find((f) => f.id === 'empty-fields:Docs')!;
      assert.deepEqual(empty.where, ['Docs::Spare']);
      // Orders is the made-up shop's table: Nothing was never filled in its 12,000 records.
      assert.deepEqual(r.findings.find((f) => f.id === 'empty-fields:Orders')!.where, ['Orders::Nothing']);
    } finally {
      again.close();
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('a layout over a big table that shows unstored calculations is found, and a small table is left alone', () => {
  const { store, done } = made();
  try {
    assert.ok(!optimizationReport(store).findings.some((f) => f.id.startsWith('slow-layout:')), 'the shop\'s layouts show nothing');
    // A layout that lists every field of Orders (12,000 records), two of them unstored calculations.
    store.applyDesign([
      { op: 'createLayout', name: 'Orders list', occurrence: 'Orders' },
      { op: 'createLayout', name: 'Lines list', occurrence: 'Lines' },
    ] as never);
    const f = optimizationReport(store).findings.find((x) => x.id === 'slow-layout:Orders list')!;
    assert.equal(f.impact, 'medium');
    assert.deepEqual([...f.where].sort(), ['Orders::Doubled', 'Orders::Today']);
    assert.match(f.what, /Orders list shows 2 unstored calculation or summary fields of Orders, which has 12,000 records/);
    assert.ok(!optimizationReport(store).findings.some((x) => x.id === 'slow-layout:Lines list'), 'Lines has 50 records');
    // Storing the calculation that can be stored takes it off the list.
    store.applyDesign([{ op: 'updateField', table: 'Orders', field: 'Doubled', options: { unstored: false } }] as never);
    assert.deepEqual(optimizationReport(store).findings.find((x) => x.id === 'slow-layout:Orders list')!.where, ['Orders::Today']);
  } finally {
    done();
  }
});
