import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { FmpDatabase } from '../../fmp12/src/index.ts';
import { parseRange, serve } from '../src/index.ts';
import { decodePng } from '../src/thumbnails.ts';
import { execFileSync } from 'node:child_process';
import type { Store } from '../../store/src/index.ts';

// DEMO_drawers keeps six JPEGs in RECORD::field_container_01; the first one
// (25 MB) is big enough to need three-byte segment indexes.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'DEMO_drawers.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let drawers: Store;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  copyFileSync(fixture, join(dir, 'Drawers.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  drawers = s.host.get('Drawers')!;
  s.host.get('Drawers')!.setPassword('Admin', 'pw');
  grantRest(s.host.get('Drawers')!);
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

test('reader: container blobs with file names', { skip }, () => {
  const blobs = FmpDatabase.open(fixture).containers('RECORD');
  assert.equal(blobs.size, 6);
  const first = blobs.get(1)!;
  assert.equal(first.mime, 'image/jpeg');
  assert.equal(first.kind, 'image');
  assert.equal(first.data.length, 25887069);
  assert.deepEqual([...first.data.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...first.data.subarray(-2)], [0xff, 0xd9]);
  assert.equal(blobs.get(5)!.filename, 'Steakhouse.jpg');
});

test('Data API: container fields read as download URLs, and accept uploads', { skip }, async () => {
  const api = (path: string, init: RequestInit = {}) =>
    fetch(`${base}/fmi/data/vLatest/databases/Drawers${path}`, init).then((r) => r.json());
  const token = (await api('/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } })).response.token;
  const auth = { authorization: `Bearer ${token}` };

  const rec = (await api('/layouts/RECORD/records?_limit=10', { headers: auth })).response.data
    .find((r: { fieldData: Record<string, string> }) => r.fieldData.field_container_01.includes('Steakhouse'));
  const url: string = rec.fieldData.field_container_01;
  assert.match(url, /^http:\/\/.+\/tabularius\/containers\/Drawers\/\d+\/Steakhouse\.jpg\?sig=/);
  const img = await fetch(url);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await img.arrayBuffer()).byteLength, 496243);
  assert.equal((await fetch(url.replace(/sig=.*/, 'sig=forged'))).status, 404);

  const form = new FormData();
  form.append('upload', new Blob([new TextEncoder().encode('hello')], { type: 'text/plain' }), 'note.txt');
  const up = await api(`/layouts/RECORD/records/${rec.recordId}/containers/field_container_01`, { method: 'POST', headers: auth, body: form });
  assert.equal(up.messages[0].code, '0');
  const after = (await api(`/layouts/RECORD/records/${rec.recordId}`, { headers: auth })).response.data[0];
  const newUrl: string = after.fieldData.field_container_01;
  assert.match(newUrl, /\/note\.txt\?sig=/);
  assert.equal(await (await fetch(newUrl)).text(), 'hello');

  const viaFieldData = await api(`/layouts/RECORD/records/${rec.recordId}`, {
    method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ fieldData: { field_container_01: 'x' } }),
  });
  assert.equal(viaFieldData.messages[0].code, '201');

  // A payload larger than the stream parser's head/tail windows round-trips
  // byte-for-byte, so streaming to disk doesn't corrupt the content.
  const big = new Uint8Array(300_000);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 0xff;
  const bigForm = new FormData();
  bigForm.append('upload', new Blob([big], { type: 'application/octet-stream' }), 'big.bin');
  const bigUp = await api(`/layouts/RECORD/records/${rec.recordId}/containers/field_container_01`, { method: 'POST', headers: auth, body: bigForm });
  assert.equal(bigUp.messages[0].code, '0');
  const bigRec = (await api(`/layouts/RECORD/records/${rec.recordId}`, { headers: auth })).response.data[0];
  const bytes = new Uint8Array(await (await fetch(bigRec.fieldData.field_container_01)).arrayBuffer());
  assert.equal(bytes.length, big.length);
  assert.deepEqual(bytes, big);

  // Beyond FileMaker's Data API: DELETE empties the container.
  const cleared = await api(`/layouts/RECORD/records/${rec.recordId}/containers/field_container_01`, { method: 'DELETE', headers: auth });
  assert.equal(cleared.messages[0].code, '0');
  assert.equal((await api(`/layouts/RECORD/records/${rec.recordId}`, { headers: auth })).response.data[0].fieldData.field_container_01, '');
  // A repetition the field doesn't have is refused (a huge one used to run the server out of memory).
  // Claris defines 111 as "Field repetition is invalid"; the old 102 meant a missing field:
  // https://help.claris.com/en/pro-help/content/error-codes.html
  // DELETE is our extension; the Data API docs describe POST uploads, not a DELETE-specific 102:
  // https://help.claris.com/en/data-api-guide/content/upload-container-data.html
  // This follows the documented meaning, not an observed FileMaker DELETE response.
  const far = await api(`/layouts/RECORD/records/${rec.recordId}/containers/field_container_01/1000000000`, { method: 'DELETE', headers: auth });
  assert.equal(far.messages[0].code, '111');

  // The uploader names the type: HTML called a PDF is sent to be saved, sandboxed, never shown as this site.
  const html = new FormData();
  html.append('upload', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'report.pdf');
  assert.equal((await api(`/layouts/RECORD/records/${rec.recordId}/containers/field_container_01`, { method: 'POST', headers: auth, body: html })).messages[0].code, '0');
  const htmlUrl: string = (await api(`/layouts/RECORD/records/${rec.recordId}`, { headers: auth })).response.data[0].fieldData.field_container_01;
  const served = await fetch(htmlUrl);
  assert.match(served.headers.get('content-disposition')!, /^attachment;/);
  assert.match(served.headers.get('content-security-policy')!, /^sandbox/);
  // A picture still shows in place.
  assert.match(img.headers.get('content-disposition')!, /^inline;/);
  assert.equal(img.headers.get('content-security-policy'), null);
});

test('Range headers', () => {
  assert.deepEqual(parseRange('bytes=0-1', 10), { start: 0, end: 1 });
  assert.deepEqual(parseRange('bytes=4-', 10), { start: 4, end: 9 });
  assert.deepEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange('bytes=-30', 10), { start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=5-100', 10), { start: 5, end: 9 });
  assert.equal(parseRange('bytes=10-', 10), 'unsatisfiable');
  assert.equal(parseRange('bytes=-0', 10), 'unsatisfiable');
  assert.equal(parseRange('bytes=0-1,4-5', 10), undefined);
  assert.equal(parseRange('bytes=10-,20-30', 10), 'unsatisfiable');
  assert.equal(parseRange('bytes=0-1,x', 10), undefined);
  assert.equal(parseRange('items=0-1', 10), undefined);
  assert.equal(parseRange('bytes=5-2', 10), undefined);
  assert.equal(parseRange(undefined, 10), undefined);
});

/** A signed URL for a container, as the Data API gives it. */
function urlOf(id: number): string {
  return drawers.present(id, 'container', 'iso') as string;
}

test('container files: ranges, ETags, and big files kept in pieces', { skip }, async () => {
  const id = Number(drawers.query("SELECT id FROM _fm_containers WHERE filename = 'Steakhouse.jpg'")[0].id);
  const url = urlOf(id);
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '496243');
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  const etag = head.headers.get('etag')!;

  const first = await fetch(url, { headers: { range: 'bytes=0-1' } });
  assert.equal(first.status, 206);
  assert.equal(first.headers.get('content-range'), 'bytes 0-1/496243');
  assert.deepEqual([...new Uint8Array(await first.arrayBuffer())], [0xff, 0xd8]);
  const last = await fetch(url, { headers: { range: 'bytes=-2' } });
  assert.deepEqual([...new Uint8Array(await last.arrayBuffer())], [0xff, 0xd9]);
  assert.equal((await fetch(url, { headers: { range: 'bytes=600000-' } })).status, 416);
  assert.equal((await fetch(url, { headers: { 'if-none-match': etag } })).status, 304);
  // A Range for another version of the file (If-Range) gets the whole file.
  assert.equal((await fetch(url, { headers: { range: 'bytes=0-1', 'if-range': '"other"' } })).status, 200);

  // A file over a megabyte is stored in pieces, and ranges across pieces read right.
  const size = 3 * 1024 * 1024 + 12_345;
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) data[i] = (i * 131 + (i >> 11)) & 0xff;
  const recordId = drawers.find('RECORD', { limit: 1 }).records[0].recordId;
  drawers.setContainer('RECORD', recordId, 'field_container_01', 1, { filename: 'clip.mp4', mime: 'video/mp4', data });
  const bigId = drawers.containerId('RECORD', recordId, 'field_container_01')!;
  assert.equal(drawers.containerInfo(bigId)!.chunked, true);
  assert.equal(Number(drawers.query(`SELECT count(*) AS n FROM _fm_container_chunks WHERE id = ${bigId}`)[0].n), 4);
  assert.ok(Buffer.from(drawers.container(bigId)!.data).equals(data));
  const bigUrl = urlOf(bigId);
  const whole = await fetch(bigUrl);
  assert.equal(whole.headers.get('content-type'), 'video/mp4');
  assert.ok(Buffer.from(await whole.arrayBuffer()).equals(data));
  const from = 1024 * 1024 - 10, to = 2 * 1024 * 1024 + 10;
  const part = await fetch(bigUrl, { headers: { range: `bytes=${from}-${to}` } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-length'), String(to - from + 1));
  assert.ok(Buffer.from(await part.arrayBuffer()).equals(data.subarray(from, to + 1)));
  assert.ok(Buffer.from(drawers.containerRange(bigId, size - 5, size + 100)).equals(data.subarray(size - 5)));
});

test('thumbnails of images, and of PDFs when pdftoppm is installed', { skip }, async () => {
  const id = Number(drawers.query("SELECT id FROM _fm_containers WHERE filename = 'Steakhouse.jpg'")[0].id);
  const res = await fetch(urlOf(id) + '&thumb=128');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const pic = decodePng(new Uint8Array(await res.arrayBuffer()))!;
  assert.equal(Math.max(pic.width, pic.height), 128);
  // Not a flat colour: a real picture came through.
  const greys = new Set<number>();
  for (let i = 0; i < pic.rgba.length; i += 4 * 97) greys.add(pic.rgba[i] >> 4);
  assert.ok(greys.size > 4);
  const again = await fetch(urlOf(id) + '&thumb=128', { headers: { 'if-none-match': res.headers.get('etag')! } });
  assert.equal(again.status, 304);
  // A small JPEG is its own thumbnail: read at an eighth of its size, it would come out smaller than asked.
  const small = Number(drawers.query("SELECT id FROM _fm_containers WHERE filename = 'duff bear.jpg'")[0].id);
  const bear = await fetch(urlOf(small) + '&thumb=256');
  assert.equal(bear.headers.get('content-type'), 'image/jpeg');
  assert.equal((await bear.arrayBuffer()).byteLength, 72200);
  // The URL's signature still decides.
  assert.equal((await fetch(urlOf(id).replace(/sig=[^&]*/, 'sig=forged') + '&thumb=128')).status, 404);

  const recordId = drawers.find('RECORD', { limit: 1 }).records[0].recordId;
  drawers.setContainer('RECORD', recordId, 'field_container_01', 1, { filename: 'note.txt', mime: 'text/plain', data: new TextEncoder().encode('hi') });
  assert.equal((await fetch(urlOf(drawers.containerId('RECORD', recordId, 'field_container_01')!) + '&thumb=64')).status, 404);

  let pdftoppm = true;
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
  } catch {
    pdftoppm = false;
  }
  if (!pdftoppm || process.env.TABULARIUS_THUMBNAILS === 'builtin') return;
  drawers.setContainer('RECORD', recordId, 'field_container_01', 1, { filename: 'page.pdf', mime: 'application/pdf', data: new TextEncoder().encode(PDF) });
  const pdf = await fetch(urlOf(drawers.containerId('RECORD', recordId, 'field_container_01')!) + '&thumb=100');
  assert.equal(pdf.status, 200);
  const page = decodePng(new Uint8Array(await pdf.arrayBuffer()))!;
  assert.equal(Math.max(page.width, page.height), 100);
  assert.ok(page.height > page.width, 'a portrait page');
});

/** A one-page PDF with a black square on it. */
const PDF = (() => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Contents 4 0 R >>',
  ];
  const stream = '0 0 0 rg 50 100 100 100 re f';
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
})();

/** The Data API needs the fmrest extended privilege, which the sample files' [Full Access] lacks. */
function grantRest(store: Store): void {
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
}
