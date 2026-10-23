// Container files FileMaker stored outside the file: read from the folder
// beside the hosted file, as FileMaker Server (RC_Data_FMS/<file>/) and
// FileMaker Pro (Files/<file>/) keep them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, endTransaction, Store, writer, type Transaction } from '../src/index.ts';

function storeWith(rows: [number, string, string, string][]): { dir: string; store: Store } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-external-'));
  const path = join(dir, 'Invoices.openhbam.sqlite');
  createStore(path);
  new Store(path, 'Invoices').close(); // adds the external column
  const sql = new DatabaseSync(path);
  const add = sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data, external) VALUES (?, ?, ?, 'file', x'', ?)");
  for (const [id, name, mime, external] of rows) add.run(id, name, mime, external);
  sql.close();
  return { dir, store: new Store(path, 'Invoices') };
}

test('externally stored files are read from the folder beside the hosted file', () => {
  const { dir, store } = storeWith([
    [1, 'INV-1.pdf', 'application/pdf', 'Archive/Invoices/Invoice_Doc/INV-1.pdf'],
    [2, 'logo.png', 'image/png', 'Logos/logo.png'],
    [3, 'gone.pdf', 'application/pdf', 'Archive/Invoices/Invoice_Doc/gone.pdf'],
    [4, 'escape.txt', 'text/plain', '../../secret.txt'],
  ]);
  try {
    const pdf = Buffer.from('%PDF-1.4 externally stored');
    mkdirSync(join(dir, 'RC_Data_FMS', 'Invoices', 'Archive', 'Invoices', 'Invoice_Doc'), { recursive: true });
    writeFileSync(join(dir, 'RC_Data_FMS', 'Invoices', 'Archive', 'Invoices', 'Invoice_Doc', 'INV-1.pdf'), pdf);
    // FileMaker Pro's folder works too.
    mkdirSync(join(dir, 'Files', 'Invoices', 'Logos'), { recursive: true });
    writeFileSync(join(dir, 'Files', 'Invoices', 'Logos', 'logo.png'), 'png');
    writeFileSync(join(dir, 'secret.txt'), 'not a container');

    const { version, ...info } = store.containerInfo(1)!;
    assert.match(version, /^[a-f0-9]{32}$/);
    assert.deepEqual(info, {
      id: 1, filename: 'INV-1.pdf', mime: 'application/pdf', size: pdf.length, chunked: true,
      external: { path: 'Archive/Invoices/Invoice_Doc/INV-1.pdf', missing: false },
    });
    assert.deepEqual(Buffer.from(store.container(1)!.data), pdf);
    assert.equal(Buffer.from(store.containerRange(1, 5, 7)).toString(), '1.4');
    assert.equal(Buffer.from(store.container(2)!.data).toString(), 'png');

    // Not copied over: known, but empty.
    assert.equal(store.containerInfo(3)!.external!.missing, true);
    assert.equal(store.container(3)!.data.length, 0);
    assert.equal(store.containerRange(3, 0, 10).length, 0);

    // A path can't leave the container folder.
    assert.equal(store.containerInfo(4)!.external!.missing, true);
    assert.equal(store.container(4)!.data.length, 0);
  } finally {
    store.close();
  }
});

test('per container field: how many files are outside, found and missing, and where they belong', () => {
  const { dir, store } = storeWith([
    [1, 'INV-1.pdf', 'application/pdf', 'Invoices/Invoice_Doc/INV-1.pdf'],
    [2, 'INV-2.pdf', 'application/pdf', 'Invoices/Invoice_Doc/INV-2.pdf'],
    [3, 'logo.png', 'image/png', 'Logos/logo.png'],
  ]);
  try {
    store.applyDesign([{ op: 'createTable', name: 'Invoice', fields: [{ name: 'PDF', type: 'container' }, { name: 'Logo', type: 'container' }, { name: 'Embedded', type: 'container' }] }]);
    const embedded = store.addContainer({ filename: 'x.txt', mime: 'text/plain', data: Buffer.from('in the file') });
    const sql = (store as unknown as { sql: DatabaseSync }).sql;
    const add = sql.prepare('INSERT INTO Invoice (PDF, Logo, Embedded) VALUES (?, ?, ?)');
    add.run(1, 3, embedded);
    add.run(2, null, null);
    add.run(1, null, null); // two records can show one file
    mkdirSync(join(dir, 'RC_Data_FMS', 'Invoices', 'Invoices', 'Invoice_Doc'), { recursive: true });
    writeFileSync(join(dir, 'RC_Data_FMS', 'Invoices', 'Invoices', 'Invoice_Doc', 'INV-1.pdf'), '%PDF');

    assert.equal(store.externalContainerCount(), 3);
    assert.deepEqual(store.externalContainerReport(), [
      { table: 'Invoice', field: 'PDF', files: 3, found: 2, missing: 1, folders: ['Invoices/Invoice_Doc/'], examples: ['Invoices/Invoice_Doc/INV-2.pdf'] },
      { table: 'Invoice', field: 'Logo', files: 1, found: 0, missing: 1, folders: ['Logos/'], examples: ['Logos/logo.png'] },
    ]);
  } finally {
    store.close();
  }
});

test('a file put in a field set to store externally is written to its folder, as FileMaker Server does', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-external-write-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Media');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Doc', type: 'container' }, { name: 'Pic', type: 'container' }, { name: 'Secret', type: 'container' }] },
      { op: 'updateField', table: 'Items', field: 'Doc', options: { externalStorage: { path: '"Items/Docs/"' } } },
      { op: 'updateField', table: 'Items', field: 'Secret', options: { externalStorage: { secure: true } } },
    ] as never);
    const { recordId } = store.create('Items', { Name: 'One' });
    const id = Number(recordId);
    const file = (name: string) => ({ filename: name, mime: 'application/pdf', data: new Uint8Array(Buffer.from(`%PDF ${name}`)) });
    store.setContainer('Items', id, 'Doc', 1, file('a.pdf'));
    const at = join(dir, 'RC_Data_FMS', 'Media', 'Items', 'Docs');
    assert.equal(readFileSync(join(at, 'a.pdf'), 'utf8'), '%PDF a.pdf');
    const cid = store.containerId('Items', id, 'Doc')!;
    assert.deepEqual(store.containerInfo(cid)?.external, { path: 'Items/Docs/a.pdf', missing: false });
    assert.equal(Buffer.from(store.container(cid)!.data).toString(), '%PDF a.pdf');
    // The same name again is numbered, not overwritten.
    store.setContainer('Items', id, 'Doc', 1, file('a.pdf'));
    assert.ok(existsSync(join(at, 'a 2.pdf')));
    // A name can't climb out of the folder.
    store.setContainer('Items', id, 'Doc', 1, file('../../escape.pdf'));
    assert.ok(!existsSync(join(dir, 'RC_Data_FMS', 'escape.pdf')));
    assert.ok(readdirSync(at).some((n) => n.includes('escape.pdf')));
    // Fields stored in the file, and secure storage, keep the file in the database.
    store.setContainer('Items', id, 'Pic', 1, file('p.pdf'));
    store.setContainer('Items', id, 'Secret', 1, file('s.pdf'));
    assert.equal(store.containerInfo(store.containerId('Items', id, 'Pic')!)?.external, undefined);
    assert.equal(store.containerInfo(store.containerId('Items', id, 'Secret')!)?.external, undefined);
    // Emptying the field.
    store.setContainer('Items', id, 'Doc', 1, null);
    assert.equal(store.containerId('Items', id, 'Doc'), undefined);
  } finally {
    store.close();
  }
});

test("a new external file never takes the name of an older record's file, found elsewhere or missing", () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-external-names-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Media');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Doc', type: 'container' }] },
      { op: 'updateField', table: 'Items', field: 'Doc', options: { externalStorage: { path: '"Items/Docs/"' } } },
    ] as never);
    const sql = (store as unknown as { sql: DatabaseSync }).sql;
    // Migrated from FileMaker Pro: one file in its own folder (Files/<file>/), one never copied over.
    sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data, external) VALUES (500, 'a.pdf', 'application/pdf', 'file', x'', 'Items/Docs/a.pdf')").run();
    sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data, external) VALUES (501, 'b.pdf', 'application/pdf', 'file', x'', 'Items/Docs/b.pdf')").run();
    mkdirSync(join(dir, 'Files', 'Media', 'Items', 'Docs'), { recursive: true });
    writeFileSync(join(dir, 'Files', 'Media', 'Items', 'Docs', 'a.pdf'), 'OLD');
    const { recordId } = store.create('Items', { Name: 'New' });
    const id = Number(recordId);
    const file = (name: string) => ({ filename: name, mime: 'application/pdf', data: new Uint8Array(Buffer.from('NEW')) });
    store.setContainer('Items', id, 'Doc', 1, file('a.pdf'));
    assert.equal(store.containerInfo(store.containerId('Items', id, 'Doc')!)?.external?.path, 'Items/Docs/a 2.pdf');
    assert.equal(Buffer.from(store.container(500)!.data).toString(), 'OLD');
    store.setContainer('Items', id, 'Doc', 1, file('b.pdf'));
    assert.equal(store.containerInfo(store.containerId('Items', id, 'Doc')!)?.external?.path, 'Items/Docs/b 2.pdf');
    assert.equal(store.containerInfo(501)?.external?.missing, true);
    // A name too long for the file system is cut, keeping its extension.
    store.setContainer('Items', id, 'Doc', 1, file(`${'x'.repeat(400)}.pdf`));
    const long = store.containerInfo(store.containerId('Items', id, 'Doc')!)!.external!.path;
    assert.ok(long.endsWith('.pdf') && Buffer.byteLength(long.split('/').pop()!) <= 200, long);
    // A repetition the field doesn't have is refused, and the field isn't turned into a repeating one.
    assert.throws(() => store.setContainer('Items', id, 'Doc', 1_000_000_000, null), /no repetition/);
    assert.throws(() => store.setContainer('Items', id, 'Doc', 2, null), /no repetition/);
    assert.ok(!sql.prepare('SELECT Doc FROM Items WHERE _fm_record_id = ?').get(id)!.Doc!.toString().startsWith('['));
  } finally {
    store.close();
  }
});

test('a file written to external storage inside a transaction that rolls back is removed again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-external-rollback-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Media');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Doc', type: 'container' }] },
      { op: 'updateField', table: 'Items', field: 'Doc', options: { externalStorage: { path: '"Items/Docs/"' } } },
    ] as never);
    const id = Number(store.create('Items', { Name: 'One' }).recordId);
    const file = (name: string) => ({ filename: name, mime: 'application/pdf', data: new Uint8Array(Buffer.from(`%PDF ${name}`)) });
    const at = join(dir, 'RC_Data_FMS', 'Media', 'Items', 'Docs');
    const inTransaction = (keep: boolean, name: string) => {
      const tx: Transaction = { files: new Map() };
      writer.run({ transaction: { open: tx } }, () => store.setContainer('Items', id, 'Doc', 1, file(name)));
      assert.ok(existsSync(join(at, name)), 'written while the transaction is open');
      endTransaction(tx, keep);
    };
    inTransaction(false, 'undone.pdf');
    assert.equal(existsSync(join(at, 'undone.pdf')), false);
    assert.equal(store.containerId('Items', id, 'Doc'), undefined);
    inTransaction(true, 'kept.pdf');
    assert.equal(readFileSync(join(at, 'kept.pdf'), 'utf8'), '%PDF kept.pdf');
    // A later rollback takes only its own file, not one kept before.
    inTransaction(false, 'second.pdf');
    assert.ok(existsSync(join(at, 'kept.pdf')));
    assert.equal(existsSync(join(at, 'second.pdf')), false);
    assert.equal(Buffer.from(store.container(store.containerId('Items', id, 'Doc')!)!.data).toString(), '%PDF kept.pdf');
  } finally {
    store.close();
  }
});

test('files kept in the database move out to the field\'s folder and back, and the file shrinks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-external-move-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Media');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Pic', type: 'container' }, { name: 'Secret', type: 'container' }] },
      { op: 'updateField', table: 'Items', field: 'Secret', options: { externalStorage: { secure: true } } },
    ] as never);
    const small = new Uint8Array(Buffer.from('small picture'));
    const big = new Uint8Array(3 * 1024 * 1024 + 17).map((_, i) => (i * 31) % 251);
    const a = Number(store.create('Items', { Name: 'A' }).recordId);
    const b = Number(store.create('Items', { Name: 'B' }).recordId);
    store.setContainer('Items', a, 'Pic', 1, { filename: 'small.png', mime: 'image/png', data: small });
    store.setContainer('Items', b, 'Pic', 1, { filename: 'big.jpg', mime: 'image/jpeg', data: big });

    // Not before the field is set to store outside the file, nor for secure storage.
    assert.throws(() => store.moveContainersOut('Items', 'Pic'), /open external storage/);
    assert.throws(() => store.moveContainersOut('Items', 'Secret'), /open external storage/);
    assert.throws(() => store.moveContainersOut('Items', 'Name'), /not a container/);

    store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: { path: '"Items/Pic/"' } } }] as never);
    assert.deepEqual(store.embeddedContainerCount('Items', 'Pic'), { files: 2, bytes: small.length + big.length });
    (store as unknown as { sql: DatabaseSync }).sql.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const before = statSync(path).size;
    assert.ok(before > 3 * 1024 * 1024);
    const out = store.moveContainersOut('Items', 'Pic');
    assert.equal(out.moved, 2);
    assert.equal(out.bytes, small.length + big.length);
    store.compactFile();
    assert.ok(statSync(path).size < before - 3 * 1024 * 1024, 'the database gave back the space');

    const folder = join(dir, 'RC_Data_FMS', 'Media', 'Items', 'Pic');
    assert.deepEqual(readdirSync(folder).sort(), ['big.jpg', 'small.png']);
    const idA = store.containerId('Items', a, 'Pic')!;
    const idB = store.containerId('Items', b, 'Pic')!;
    assert.deepEqual(store.containerInfo(idA)?.external, { path: 'Items/Pic/small.png', missing: false });
    assert.deepEqual(Buffer.from(store.container(idA)!.data), Buffer.from(small));
    assert.deepEqual(Buffer.from(store.container(idB)!.data), Buffer.from(big));
    assert.deepEqual(store.embeddedContainerCount('Items', 'Pic'), { files: 0, bytes: 0 });
    // Nothing left to move.
    assert.equal(store.moveContainersOut('Items', 'Pic').moved, 0);

    // Undo: back in the database, the copies in the folder removed.
    assert.deepEqual(store.moveContainersIn(out.ids), { moved: 2, bytes: small.length + big.length, missing: 0 });
    assert.equal(store.containerInfo(idA)?.external, undefined);
    assert.deepEqual(Buffer.from(store.container(idA)!.data), Buffer.from(small));
    assert.deepEqual(Buffer.from(store.container(idB)!.data), Buffer.from(big));
    assert.deepEqual(readdirSync(folder), []);
    assert.deepEqual(store.embeddedContainerCount('Items', 'Pic'), { files: 2, bytes: small.length + big.length });
  } finally {
    store.close();
  }
});

test('a move that fails leaves the database and the folder as they were; a missing file is counted, not lost', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-external-move-fail-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Media');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Pic', type: 'container' }] },
      { op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: { path: '"Items/Pic/"' } } },
    ] as never);
    const a = Number(store.create('Items', { Name: 'A' }).recordId);
    const b = Number(store.create('Items', { Name: 'B' }).recordId);
    // Written while the field stored in the file.
    store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: null } }] as never);
    store.setContainer('Items', a, 'Pic', 1, { filename: 'one.png', mime: 'image/png', data: new Uint8Array(Buffer.from('one')) });
    store.setContainer('Items', b, 'Pic', 1, { filename: 'two.png', mime: 'image/png', data: new Uint8Array(Buffer.from('two')) });
    store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: { path: '"Items/Pic/"' } } }] as never);
    // A plain file where the second file's folder would be makes the second write fail after the first one worked.
    mkdirSync(join(dir, 'RC_Data_FMS', 'Media', 'Items'), { recursive: true });
    writeFileSync(join(dir, 'RC_Data_FMS', 'Media', 'Items', 'Pic'), 'in the way');
    assert.throws(() => store.moveContainersOut('Items', 'Pic'));
    assert.deepEqual(store.embeddedContainerCount('Items', 'Pic'), { files: 2, bytes: 6 });
    assert.equal(readFileSync(join(dir, 'RC_Data_FMS', 'Media', 'Items', 'Pic'), 'utf8'), 'in the way');

    rmSync(join(dir, 'RC_Data_FMS', 'Media', 'Items', 'Pic'));
    const out = store.moveContainersOut('Items', 'Pic');
    assert.equal(out.moved, 2);
    // One of the files is lost before the undo: it stays as it is and is counted.
    rmSync(join(dir, 'RC_Data_FMS', 'Media', 'Items', 'Pic', 'one.png'));
    assert.deepEqual(store.moveContainersIn(out.ids), { moved: 1, bytes: 3, missing: 1 });
    assert.equal(store.containerInfo(store.containerId('Items', a, 'Pic')!)?.external?.missing, true);
    assert.equal(Buffer.from(store.container(store.containerId('Items', b, 'Pic')!)!.data).toString(), 'two');
  } finally {
    store.close();
  }
});

test('a file written to external storage inside a refused foreign-key step is removed, in a transaction or not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-external-keystep-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Media');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Doc', type: 'container' }] },
      { op: 'updateField', table: 'Items', field: 'Doc', options: { externalStorage: { path: '"Items/Docs/"' } } },
    ] as never);
    const id = Number(store.create('Items', { Name: 'One' }).recordId);
    const file = (name: string) => ({ filename: name, mime: 'application/pdf', data: new Uint8Array(Buffer.from(`%PDF ${name}`)) });
    const at = join(dir, 'RC_Data_FMS', 'Media', 'Items', 'Docs');
    const step = (store as unknown as { keyStep: <T>(run: () => T) => T }).keyStep.bind(store);
    const refused = (name: string, then?: () => void) => assert.throws(() => step(() => {
      store.setContainer('Items', id, 'Doc', 1, file(name));
      assert.ok(existsSync(join(at, name)), 'written while the step runs');
      then?.();
      throw new Error('refused');
    }), /refused/);

    // On its own, the step is its own write transaction.
    refused('alone.pdf');
    assert.equal(existsSync(join(at, 'alone.pdf')), false);
    assert.equal(store.containerId('Items', id, 'Doc'), undefined);

    // A file that can't be removed neither hides the refusal nor keeps the others from being removed.
    const warn = console.warn;
    const warned: unknown[][] = [];
    console.warn = (...args: unknown[]) => { warned.push(args); };
    try {
      refused('stuck.pdf', () => { (store as unknown as { keyFiles: (() => void)[] }).keyFiles.push(() => { throw new Error('EACCES'); }); });
    } finally { console.warn = warn; }
    assert.equal(existsSync(join(at, 'stuck.pdf')), false);
    assert.equal(warned.length, 1);

    // In a transaction that goes on to commit, only the step's file goes; a file written before it stays, and so does one after.
    const tx: Transaction = { files: new Map() };
    writer.run({ transaction: { open: tx } }, () => {
      store.setContainer('Items', id, 'Doc', 1, file('before.pdf'));
      refused('inside.pdf');
      // Steps inside a step: a refusal of the outer one takes the inner one's file too.
      assert.throws(() => step(() => {
        step(() => { store.setContainer('Items', id, 'Doc', 1, file('nested.pdf')); });
        assert.ok(existsSync(join(at, 'nested.pdf')));
        throw new Error('outer refused');
      }), /outer refused/);
      store.setContainer('Items', id, 'Doc', 1, file('after.pdf'));
    });
    endTransaction(tx, true);
    assert.equal(existsSync(join(at, 'inside.pdf')), false);
    assert.equal(existsSync(join(at, 'nested.pdf')), false);
    assert.ok(existsSync(join(at, 'before.pdf')));
    assert.ok(existsSync(join(at, 'after.pdf')));
    assert.equal(Buffer.from(store.container(store.containerId('Items', id, 'Doc')!)!.data).toString(), '%PDF after.pdf');
  } finally {
    store.close();
  }
});
