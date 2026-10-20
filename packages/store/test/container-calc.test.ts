// Field calculations read a container's file when a function needs its bytes, and only then.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

// A 3 x 2 PNG.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGP4z8DwHwYZGBgAQUAD/fPS4MkAAAAASUVORK5CYII=', 'base64');

test('container functions in a field calculation see the file, not its name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-container-calc-'));
  const path = join(dir, 'Pics.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Pics');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Photo', fields: [{ name: 'Pic', type: 'container' }, { name: 'Width', type: 'number', kind: 'calculation', calculation: 'GetWidth ( Pic )', options: { unstored: true } }] },
    ] as never);
    const id = Number(store.create('Photo', {}).recordId);
    store.setContainer('Photo', id, 'Pic', 1, { filename: 'dot.png', mime: 'image/png', data: new Uint8Array(png) });
    const reads: number[] = [];
    const container = store.container.bind(store);
    store.container = (cid: number) => (reads.push(cid), container(cid));

    // Showing the name reads nothing.
    assert.equal(store.evaluate('Photo', 'GetAsText ( Pic )', id).value, 'dot.png');
    assert.equal(reads.length, 0);

    const t = (f: string) => store.evaluate('Photo', f, id).value;
    assert.equal(t('GetWidth ( Pic ) & "x" & GetHeight ( Pic )'), '3x2');
    assert.equal(t('GetContainerAttribute ( Pic ; "MD5" )'), createHash('md5').update(png).digest('hex').toUpperCase());
    assert.equal(t('GetContainerAttribute ( Pic ; "fileSize" )'), String(png.length));
    assert.equal(t('Substitute ( Base64Encode ( Pic ) ; ¶ ; "" )'), png.toString('base64'));
    assert.equal(t('HexEncode ( CryptDigest ( Pic ; "SHA256" ) )'), createHash('sha256').update(png).digest('hex').toUpperCase());
    // A calculation field over it, as a record shows it.
    assert.equal(t('Width'), '3');
    // Read once per value, however many functions use it.
    const encoded = Number(t('Length ( Base64Encode ( Pic ) )'));
    reads.length = 0;
    assert.equal(t('GetWidth ( Pic ) + GetHeight ( Pic ) + Length ( Base64Encode ( Pic ) )'), String(5 + encoded));
    assert.ok(reads.length <= 3, `read ${reads.length} times`);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('totals and lists over related containers read no files, and a missing outside file has no bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-container-related-'));
  const path = join(dir, 'Orders.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Orders');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Orders', fields: [{ name: 'Id', type: 'number' }] },
      { op: 'createTable', name: 'Lines', fields: [{ name: 'OrderId', type: 'number' }, { name: 'Pic', type: 'container' }] },
      { op: 'createRelationship', left: 'Orders', right: 'Lines', predicates: [{ left: 'Id', op: '=', right: 'OrderId' }] },
    ] as never);
    const order = Number(store.create('Orders', { Id: 1 }).recordId);
    for (let i = 0; i < 5; i++) {
      const line = Number(store.create('Lines', { OrderId: 1 }).recordId);
      store.setContainer('Lines', line, 'Pic', 1, { filename: `p${i}.bin`, mime: 'application/zip', data: new Uint8Array(1024).fill(i) });
    }
    const reads: number[] = [];
    const container = store.container.bind(store);
    store.container = (cid: number) => (reads.push(cid), container(cid));
    assert.equal(store.evaluate('Orders', 'Count ( Lines::Pic ) & "|" & ValueCount ( List ( Lines::Pic ) )', order).value, '5|5');
    assert.equal(reads.length, 0, 'a count and a list of file names read no files');

    // A file stored outside whose file isn't there: no bytes, not an empty file.
    const sql = (store as unknown as { sql: import('node:sqlite').DatabaseSync }).sql;
    sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data, external) VALUES (900, 'gone.pdf', 'application/pdf', 'file', x'', 'Lines/gone.pdf')").run();
    sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data, external) VALUES (901, 'here.pdf', 'application/pdf', 'file', x'', 'Lines/here.pdf')").run();
    mkdirSync(join(dir, 'RC_Data_FMS', 'Orders', 'Lines'), { recursive: true });
    writeFileSync(join(dir, 'RC_Data_FMS', 'Orders', 'Lines', 'here.pdf'), '%PDF');
    const gone = Number(store.create('Lines', { OrderId: 2 }).recordId);
    const here = Number(store.create('Lines', { OrderId: 2 }).recordId);
    sql.prepare('UPDATE Lines SET Pic = ? WHERE ROWID = ?').run(900, gone);
    sql.prepare('UPDATE Lines SET Pic = ? WHERE ROWID = ?').run(901, here);
    assert.equal(store.evaluate('Lines', 'GetContainerAttribute ( Pic ; "MD5" )', gone).value, '');
    assert.equal(store.evaluate('Lines', 'GetContainerAttribute ( Pic ; "fileSize" )', here).value, '4');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a big file's size and an image's dimensions are read from its start, not the whole file", () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-container-head-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Media');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Clip', fields: [{ name: 'File', type: 'container' }] }] as never);
    // A 3 x 2 PNG followed by 3 MB (as if a big image), and 3 MB that isn't an image at all (a video).
    const bigPng = Buffer.concat([png, Buffer.alloc(3 << 20)]);
    const video = Buffer.concat([Buffer.from('\0\0\0\x18ftypmp42'), Buffer.alloc(3 << 20, 7)]);
    const ids = [bigPng, video].map((data, i) => {
      const id = Number(store.create('Clip', {}).recordId);
      store.setContainer('Clip', id, 'File', 1, { filename: i ? 'clip.mp4' : 'big.png', mime: i ? 'video/mp4' : 'image/png', data: new Uint8Array(data) });
      return id;
    });
    const reads: number[] = [];
    const container = store.container.bind(store);
    store.container = (cid: number) => (reads.push(cid), container(cid));
    const t = (f: string, id: number) => store.evaluate('Clip', f, id).value;

    assert.equal(t('GetWidth ( File ) & "x" & GetHeight ( File )', ids[0]), '3x2');
    assert.equal(t('GetContainerAttribute ( File ; "fileSize" )', ids[0]), String(bigPng.length));
    assert.equal(t('GetWidth ( File )', ids[1]), '0');
    assert.equal(t('GetContainerAttribute ( File ; "width" )', ids[1]), '');
    assert.equal(t('GetContainerAttribute ( File ; "fileSize" )', ids[1]), String(video.length));
    assert.equal(reads.length, 0, 'no whole file was read');
    // The checksum still needs every byte.
    assert.equal(t('GetContainerAttribute ( File ; "MD5" )', ids[1]), createHash('md5').update(video).digest('hex').toUpperCase());
    assert.equal(reads.length, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
