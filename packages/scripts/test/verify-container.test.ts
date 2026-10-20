// VerifyContainer: 1 unless a container file stored outside the database is missing or has changed there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readContainerBlob, Node, type Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

function setUp() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-verify-'));
  const path = join(dir, 'Invoices.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Invoices');
  store.applyDesign([{ op: 'createTable', name: 'Invoice', fields: [{ name: 'PDF', type: 'container' }, { name: 'Label', type: 'text' }] }]);
  const sql = (store as unknown as { sql: DatabaseSync }).sql;
  // As a converted file has them: the path under the container folder, and the size FileMaker recorded.
  const add = sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data, external, external_size) VALUES (?, ?, 'application/pdf', 'file', x'', ?, ?)");
  add.run(1, 'same.pdf', 'Invoice/PDF/same.pdf', 8);
  add.run(2, 'edited.pdf', 'Invoice/PDF/edited.pdf', 8);
  add.run(3, 'gone.pdf', 'Invoice/PDF/gone.pdf', 8);
  add.run(4, 'old.pdf', 'Invoice/PDF/old.pdf', null); // converted before sizes were kept: only being there counts
  const embedded = store.addContainer({ filename: 'in.txt', mime: 'text/plain', data: Buffer.from('in the file') });
  const folder = join(dir, 'RC_Data_FMS', 'Invoices', 'Invoice', 'PDF');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'same.pdf'), '%PDF-1.4');
  writeFileSync(join(folder, 'edited.pdf'), '%PDF-1.4 edited outside');
  writeFileSync(join(folder, 'old.pdf'), '%PDF');
  const row = sql.prepare('INSERT INTO Invoice (PDF, Label) VALUES (?, ?)');
  for (const [pdf, label] of [[1, 'same'], [2, 'edited'], [3, 'gone'], [4, 'old'], [embedded, 'embedded'], [null, 'empty']] as const) row.run(pdf, label);
  const ids = new Map((sql.prepare('SELECT ROWID AS id, Label FROM Invoice').all() as { id: number; Label: string }[]).map((r) => [r.Label, Number(r.id)]));
  return { dir, store, ids };
}

const expected = { same: '1', edited: '0', gone: '0', old: '1', embedded: '1', empty: '1' };

test('VerifyContainer in a calculation: 0 for an outside file that is missing or a different size', () => {
  const { dir, store, ids } = setUp();
  try {
    for (const [label, want] of Object.entries(expected)) {
      assert.equal(store.evaluate('Invoice', 'VerifyContainer ( PDF )', ids.get(label)).value, want, label);
    }
    assert.equal(store.evaluate('Invoice', 'VerifyContainer ( Label )', ids.get('same')).value, '?', 'not a container');
    // Field calculations take it from the container's info, read once with the file's size.
    assert.deepEqual([1, 2, 3, 4].map((id) => store.containerInfo(id)!.external!.changed), [undefined, true, true, undefined]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('VerifyContainer in a script, and a file Tabularius stores outside keeps its size', async () => {
  const { dir, store, ids } = setUp();
  try {
    const script = (text: string): Script => ({
      id: 9999, name: 'test', steps: parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params })),
    } as Script);
    const verify = script('Exit Script [ Text Result: List ( VerifyContainer ( PDF ) ; Invoice::Label ) ]');
    for (const [label, want] of Object.entries(expected)) {
      const got = await runScript(store, verify, { layout: 'Invoice', foundSet: [...ids.values()], recordId: ids.get(label)! });
      assert.equal(got.result, `${want}\r${label}`, label);
    }
    // A file Tabularius itself stores outside records its size, so editing it there is noticed.
    store.applyDesign([{ op: 'updateField', table: 'Invoice', field: 'PDF', options: { externalStorage: { path: '"Invoice/New/"' } } }] as never);
    const id = ids.get('empty')!;
    store.setContainer('Invoice', id, 'PDF', 1, { filename: 'new.pdf', mime: 'application/pdf', data: new Uint8Array(Buffer.from('%PDF new')) });
    const one = { layout: 'Invoice', foundSet: [id], recordId: id };
    assert.equal((await runScript(store, verify, one)).result, '1\rempty');
    writeFileSync(join(dir, 'RC_Data_FMS', 'Invoices', 'Invoice', 'New', 'new.pdf'), '%PDF new, edited');
    assert.equal((await runScript(store, verify, one)).result, '0\rempty');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the reader keeps the size FileMaker recorded for a file stored outside', () => {
  const node = new Node();
  const kvlong = (tag: string, data: Uint8Array) => node.add({ type: 'kvlong', key: Buffer.from(tag, 'latin1'), data });
  kvlong('REMO', Buffer.concat([Buffer.alloc(8), Buffer.from('Invoices/\0', 'latin1')]));
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(155360n);
  kvlong('pdf ', Buffer.concat([size, Buffer.alloc(16, 0xab), Buffer.from('INV-1.pdf\0', 'latin1')]));
  assert.equal(readContainerBlob(7, node).externalSize, 155360);
});
