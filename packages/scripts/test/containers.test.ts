import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '@tabularius/fmp12';
import { importFmp12, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

// DEMO_drawers keeps JPEGs in RECORD::field_container_01.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'DEMO_drawers.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let store: Store;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  importFmp12(fixture, join(dir, 'Drawers.sqlite'));
  store = new Store(join(dir, 'Drawers.sqlite'));
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const step = (stepId: number, name: string, params?: StepParams): ScriptStep => ({ stepId, name, enabled: true, params });
const script = (...steps: ScriptStep[]): Script => ({ id: 9999, name: 'test', steps } as Script);
const container = { tableOccurrence: { id: 0, name: 'RECORD' }, field: { id: 0, name: 'field_container_01' } };
const setVar = (variable: string, value: string) => step(141, 'Set Variable', { variable, value });

test('Set Field copies files into container fields and empties them', { skip }, async () => {
  const withImage = store.query(`SELECT _fm_record_id AS id FROM RECORD WHERE field_container_01 IS NOT NULL LIMIT 1`)[0].id;
  const r = await runScript(store, script(
    setVar('$b', 'Base64Encode ( RECORD::field_container_01 )'),
    step(7, 'New Record/Request'),
    step(76, 'Set Field', { field: container, calculation: 'Base64Decode ( $b ; "copy.jpg" )' }),
    setVar('$copied', 'Base64Encode ( RECORD::field_container_01 ) = $b and Length ( $b ) > 1000'),
    setVar('$name', 'RECORD::field_container_01'),
    step(76, 'Set Field', { field: container, calculation: '""' }),
    step(86, 'Set Error Capture', { on: true }),
    step(76, 'Set Field', { field: container, calculation: '"some text"' }),
    setVar('$err', 'Get ( LastError )'),
    step(103, 'Exit Script', { calculation: '$copied & "/" & $name & "/" & IsEmpty ( RECORD::field_container_01 ) & "/" & $err' }),
  ), { layout: 'RECORD', foundSet: [Number(withImage)] });
  assert.equal(r.result, '1/copy.jpg/1/201');
  const copy = store.query(`SELECT count(*) AS n FROM _fm_containers WHERE filename = 'copy.jpg' AND mime = 'image/jpeg'`)[0];
  assert.equal(Number(copy.n), 1);
});

test('Export Field Contents hands the file to the client; Clear empties a field', { skip }, async () => {
  const withImage = Number(store.query(`SELECT _fm_record_id AS id FROM RECORD WHERE field_container_01 IS NOT NULL LIMIT 1`)[0].id);
  const name = { tableOccurrence: { id: 0, name: 'RECORD' }, field: { id: 0, name: 'name' } };
  const r = await runScript(store, script(
    setVar('$path', '"file:exports/photo.jpg"'),
    step(132, 'Export Field Contents', { field: container, filePaths: ['$path'] }),
    step(76, 'Set Field', { field: name, calculation: '"temp"' }),
    step(49, 'Clear', { field: name }),
    step(103, 'Exit Script', { calculation: 'IsEmpty ( RECORD::name )' }),
  ), { layout: 'RECORD', foundSet: [withImage] });
  assert.equal(r.result, '1');
  assert.equal(r.actions.length, 1);
  const a = r.actions[0];
  assert.equal(a.step, 'Export Field Contents');
  assert.equal(a.filename, 'photo.jpg');
  assert.equal(a.mime, 'image/jpeg');
  assert.match(String(a.url), /^container:\d+/);
});

test('Export Field Contents with no field named exports the active field', { skip }, async () => {
  const withImage = Number(store.query(`SELECT _fm_record_id AS id FROM RECORD WHERE field_container_01 IS NOT NULL LIMIT 1`)[0].id);
  const r = await runScript(store, script(
    step(17, 'Go to Field', { field: container }),
    step(132, 'Export Field Contents', { filePaths: ['file:active.jpg'] }),
    step(103, 'Exit Script', { calculation: 'Get ( LastError )' }),
  ), { layout: 'RECORD', foundSet: [withImage] });
  assert.equal(r.result, '0');
  const a = r.actions.find((x) => x.step === 'Export Field Contents')!;
  assert.equal(a.filename, 'active.jpg');
  assert.equal(a.field, 'RECORD::field_container_01');
  // With no field active there is nothing to export.
  const none = await runScript(store, script(step(86, 'Set Error Capture', { on: true }), step(132, 'Export Field Contents', {}),
    step(103, 'Exit Script', { calculation: 'Get ( LastError )' })), { layout: 'RECORD', foundSet: [withImage] });
  assert.equal(none.result, '102');
});

test('Export Field Contents writes into the documents folder when no one is there to download', { skip }, async () => {
  const withImage = Number(store.query(`SELECT _fm_record_id AS id FROM RECORD WHERE field_container_01 IS NOT NULL LIMIT 1`)[0].id);
  const name = { tableOccurrence: { id: 0, name: 'RECORD' }, field: { id: 0, name: 'name' } };
  const docs = mkdtempSync(join(tmpdir(), 'tabularius-efc-'));
  try {
    const r = await runScript(store, script(
      step(86, 'Set Error Capture', { on: true }),
      step(132, 'Export Field Contents', { field: container, filePaths: ['file:/Documents/missing/photo.jpg'] }),
      setVar('$noFolder', 'Get ( LastError )'),
      step(132, 'Export Field Contents', { field: container, filePaths: ['file:/Documents/exports/photo.jpg'], createFolders: true }),
      step(76, 'Set Field', { field: name, calculation: '"hello"' }),
      step(132, 'Export Field Contents', { field: name, filePaths: ['file:name.txt'] }),
      step(103, 'Exit Script', { calculation: '$noFolder & "/" & Get ( LastError )' }),
    ), { layout: 'RECORD', foundSet: [withImage], documents: docs });
    assert.equal(r.result, '100/0', 'a missing folder without Create folders is error 100');
    assert.equal(r.actions.filter((a) => a.step === 'Export Field Contents').length, 0, 'no download is offered');
    const cid = Number(store.query(`SELECT field_container_01 AS c FROM RECORD WHERE _fm_record_id = ${withImage}`)[0].c);
    const want = store.container(cid)?.data;
    assert.ok(want && want.length > 1000);
    assert.deepEqual(new Uint8Array(readFileSync(join(docs, 'exports', 'photo.jpg'))), new Uint8Array(want));
    assert.equal(readFileSync(join(docs, 'name.txt'), 'utf8'), 'hello');
    assert.equal(existsSync(join(docs, 'missing')), false);
    // With downloads the person still gets the file, not the documents folder.
    const d = await runScript(store, script(step(132, 'Export Field Contents', { field: container, filePaths: ['file:dl.jpg'] })),
      { layout: 'RECORD', foundSet: [withImage], documents: docs, downloads: true });
    assert.equal(d.actions.find((a) => a.step === 'Export Field Contents')?.filename, 'dl.jpg');
    assert.equal(existsSync(join(docs, 'dl.jpg')), false);
    const client = await runScript(store, script(step(132, 'Export Field Contents', { field: container, filePaths: ['file:client.jpg'] })),
      { layout: 'RECORD', foundSet: [withImage], documents: docs, clientFieldExports: true });
    const clientExport = client.actions.find((a) => a.step === 'Export Field Contents');
    assert.equal(clientExport?.filename, 'client.jpg');
    assert.ok(clientExport?.base64, 'stored container bytes are returned to the client');
    assert.equal(existsSync(join(docs, 'client.jpg')), false);
  } finally { rmSync(docs, { recursive: true }); }
});

test('Insert File: from the documents folder, or a file a person chooses', { skip }, async () => {
  const docs = join(dir, 'Documents');
  mkdirSync(docs, { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  writeFileSync(join(docs, 'dot.png'), png);
  const id = Number(store.query(`SELECT _fm_record_id AS id FROM RECORD LIMIT 1`)[0].id);
  const probe = (...steps: ScriptStep[]) => script(step(86, 'Set Error Capture', { on: true }), ...steps,
    step(103, 'Exit Script', { calculation: 'Get ( LastError ) & "/" & RECORD::field_container_01 & "/" & Length ( Base64Encode ( RECORD::field_container_01 ) )' }));
  const opts = { layout: 'RECORD', foundSet: [id], documents: docs };
  // Base64Encode breaks lines every 76 characters, as FileMaker's does.
  const b64 = png.toString('base64').length;
  const encoded = b64 + Math.floor((b64 - 1) / 76);

  // A stored path: only its file name, in the documents folder.
  let r = await runScript(store, probe(step(131, 'Insert File', { field: container, filePaths: ['filemac:/Users/someone/Desktop/dot.png'] })), opts);
  assert.equal(r.result, `0/dot.png/${encoded}`);
  assert.match((await runScript(store, probe(step(131, 'Insert File', { field: container, filePaths: ['file:missing.png'] })), opts)).result, /^100\//);

  // No path: a person chooses the file. Nobody can on the server unless the caller supplies one.
  const ask = step(131, 'Insert File', { field: container, title: '"Pick a photo"' });
  assert.match((await runScript(store, probe(ask), opts)).result, /^3\//);
  let asked: unknown;
  r = await runScript(store, probe(ask), { ...opts, insertFile: async (q) => (asked = q, { filename: 'chosen.png', data: png }) });
  assert.equal(r.result, `0/chosen.png/${encoded}`);
  assert.deepEqual(asked, { script: 'test', title: 'Pick a photo', actions: [] });
  assert.match((await runScript(store, probe(ask), { ...opts, insertFile: async () => undefined })).result, /^1\//);

  // Into a variable.
  r = await runScript(store, script(step(131, 'Insert File', { variable: '$f', filePaths: ['dot.png'] }), step(103, 'Exit Script', { calculation: '$f' })), opts);
  assert.equal(r.result, 'dot.png');
});
