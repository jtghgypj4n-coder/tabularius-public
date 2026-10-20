// A big file goes into a container field in pieces that can be picked up again (container-uploads.ts, and the routes in
// dataapi.ts): an interrupted upload resumes from what arrived, a piece sent from the wrong place is refused, uploads to one
// field don't disturb each other, and the account's rights are checked when it starts and again when it finishes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { containerFixture, pattern, type ContainerFixture } from './container-fixture.ts';
import { ContainerUploadError, ContainerUploads, MAX_CONTAINER_FILE, MAX_CONTAINER_UPLOADS_PER_ACCOUNT } from '../src/container-uploads.ts';

let f: ContainerFixture;
let admin: string;
before(async () => {
  f = await containerFixture();
  admin = await f.login('Admin');
});
after(async () => { await f?.close(); });

interface Answer { status: number; code: string; message: string; response: Record<string, any> }
async function call(auth: string, method: string, path: string, body?: unknown): Promise<Answer> {
  const raw = body instanceof Uint8Array;
  const r = await fetch(`${f.api}${path}`, {
    method, headers: { authorization: auth, ...(body === undefined || raw ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : raw ? Buffer.from(body) : JSON.stringify(body),
  });
  const json = await r.json();
  return { status: r.status, code: json.messages[0].code, message: json.messages[0].message, response: json.response };
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const startPath = (contact: number, field = 'Photo', rep = 1) => `/layouts/Contacts/records/${f.contact(contact)}/container-uploads/${field}/${rep}`;
const start = (auth: string, contact: number, meta: Record<string, unknown>, field = 'Photo') => call(auth, 'POST', startPath(contact, field), meta);
const put = (auth: string, id: string, offset: number | string, bytes: Uint8Array) => call(auth, 'PUT', `/layouts/Contacts/container-uploads/${id}?offset=${offset}`, bytes);
const status = (auth: string, id: string) => call(auth, 'GET', `/layouts/Contacts/container-uploads/${id}`);
const finish = (auth: string, id: string) => call(auth, 'POST', `/layouts/Contacts/container-uploads/${id}/finish`, {});
const cancel = (auth: string, id: string) => call(auth, 'DELETE', `/layouts/Contacts/container-uploads/${id}`);
/** What a field holds now, read back through the store. */
const held = (contact: number, field = 'Photo') => {
  const id = f.store.containerId('Contacts', Number(f.contact(contact)), field);
  return id === undefined ? undefined : { info: f.store.containerInfo(id)!, bytes: Buffer.from(f.store.container(id)!.data) };
};

test('a file goes in piece by piece and comes out byte for byte, kept in pieces of its own', async () => {
  const data = pattern(0, 5 * 1024 * 1024 + 321);
  const s = await start(admin, 1, { filename: 'clip.mp4', mime: 'video/mp4', size: data.length, sha256: sha(data) });
  assert.equal(s.code, '0');
  assert.equal(s.response.received, 0);
  assert.equal(s.response.size, data.length);
  assert.ok(s.response.maxPiece >= 1024 * 1024);
  const id: string = s.response.uploadId;
  const step = 2 * 1024 * 1024;
  for (let at = 0; at < data.length; at += step) {
    const sent = await put(admin, id, at, data.subarray(at, at + step));
    assert.equal(sent.code, '0');
    assert.equal(sent.response.received, Math.min(data.length, at + step));
  }
  assert.equal((await status(admin, id)).response.received, data.length);
  assert.equal(held(1), undefined, 'nothing is in the field until the upload is finished');
  assert.equal((await finish(admin, id)).code, '0');
  const got = held(1)!;
  assert.equal(got.info.filename, 'clip.mp4');
  assert.equal(got.info.mime, 'video/mp4');
  assert.equal(got.info.chunked, true);
  assert.equal(got.info.size, data.length);
  assert.ok(got.info.modified && Math.abs(got.info.modified - Date.now() / 1000) < 60);
  assert.ok(got.bytes.equals(data));
  assert.equal((await status(admin, id)).status, 404, 'a finished upload is forgotten');
  // The audit log names the file and its hash, never its contents.
  const audit = f.store.auditLog({ table: 'Contacts', recordId: Number(f.contact(1)) }).at(-1)!;
  assert.match(JSON.stringify(audit), new RegExp(`clip\\.mp4 \\(${data.length} bytes, sha256 ${sha(data)}\\)`));
});

test('a small file takes the same path and is stored whole', async () => {
  const data = Buffer.from('hello');
  const s = await start(admin, 2, { filename: 'a/b\\note.txt', mime: 'text/plain', size: data.length });
  await put(admin, s.response.uploadId, 0, data);
  assert.equal((await finish(admin, s.response.uploadId)).code, '0');
  const got = held(2)!;
  assert.equal(got.info.filename, 'note.txt', 'a name is only a name');
  assert.equal(got.info.chunked, false);
  assert.equal(got.bytes.toString(), 'hello');
});

test('an interrupted upload resumes from what arrived', async () => {
  const data = pattern(0, 4 * 1024 * 1024 + 99, 5);
  const s = await start(admin, 1, { filename: 'resume.bin', mime: 'application/octet-stream', size: data.length, sha256: sha(data) });
  const id: string = s.response.uploadId;
  assert.equal((await put(admin, id, 0, data.subarray(0, 1024 * 1024))).code, '0');
  // The next piece is cut off part way: the connection drops after half of it has been sent.
  await new Promise<void>((resolve) => {
    const u = new URL(`${f.api}/layouts/Contacts/container-uploads/${id}?offset=${1024 * 1024}`);
    const req = request(u, { method: 'PUT', headers: { authorization: admin, 'content-length': String(1024 * 1024) } });
    req.on('error', () => {});
    req.write(data.subarray(1024 * 1024, 1024 * 1024 + 300_000), () => setTimeout(() => { req.destroy(); resolve(); }, 100));
  });
  // The server says how far it got; whatever the cut left is kept, and sending on from there makes the whole file.
  let at = 0;
  for (let tries = 0; tries < 50; tries++) {
    at = (await status(admin, id)).response.received;
    const again = (await status(admin, id)).response.received;
    if (at === again && at >= 1024 * 1024) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(at >= 1024 * 1024 && at <= 1024 * 1024 + 300_000, `${at} bytes arrived`);
  assert.equal((await put(admin, id, at, data.subarray(at))).code, '0');
  assert.equal((await finish(admin, id)).code, '0');
  assert.ok(held(1)!.bytes.equals(data), 'the file is whole and in order');
});

test('a piece sent from the wrong place is refused and changes nothing', async () => {
  const data = pattern(0, 3000);
  const s = await start(admin, 1, { filename: 'x.bin', size: data.length });
  const id: string = s.response.uploadId;
  assert.equal((await put(admin, id, 0, data.subarray(0, 1000))).code, '0');
  for (const offset of [0, 500, 999, 1001, 2000, 99999]) {
    const r = await put(admin, id, offset, data.subarray(1000, 2000));
    assert.equal(r.status, 409, `offset ${offset}`);
    assert.match(r.message, /Send from byte 1000/);
  }
  assert.equal((await put(admin, id, 'x', data)).status, 400);
  assert.equal((await call(admin, 'PUT', `/layouts/Contacts/container-uploads/${id}`, data)).status, 400, 'the offset is required');
  assert.equal((await status(admin, id)).response.received, 1000);
  // More bytes than the file has are refused before any is kept.
  assert.equal((await put(admin, id, 1000, pattern(0, 2001))).status, 413);
  assert.equal((await status(admin, id)).response.received, 1000);
  // Finishing early says how much is missing.
  const early = await finish(admin, id);
  assert.equal(early.status, 409);
  assert.match(early.message, /Only 1000 of 3000 bytes/);
  assert.equal((await put(admin, id, 1000, data.subarray(1000))).code, '0');
  assert.equal((await finish(admin, id)).code, '0');
  assert.ok(held(1)!.bytes.equals(data));
});

test('what arrives differently from what was described is refused when it finishes, and starts again', async () => {
  const data = pattern(0, 2000);
  const s = await start(admin, 1, { filename: 'bad.bin', size: data.length, sha256: sha(Buffer.from('something else')) });
  await put(admin, s.response.uploadId, 0, data);
  const r = await finish(admin, s.response.uploadId);
  assert.equal(r.status, 422);
  assert.match(r.message, /SHA-256/);
  assert.equal((await status(admin, s.response.uploadId)).status, 404);
  assert.notEqual(held(1)?.info.filename, 'bad.bin');
  for (const bad of [{ size: 0 }, { size: -5 }, { size: 'x' }, { size: 1.5 }, {}, { size: 10, sha256: 'abc' }, { size: 10, filename: 5 }, { size: MAX_CONTAINER_FILE + 1 }]) {
    const r2 = await start(admin, 1, bad);
    assert.ok(r2.status === 400 || r2.status === 413, JSON.stringify(bad));
  }
});

test('stopping an upload forgets it, and a piece still arriving stops too', async () => {
  const s = await start(admin, 1, { filename: 'gone.bin', size: 5000 });
  const id: string = s.response.uploadId;
  await put(admin, id, 0, pattern(0, 1000));
  assert.equal((await cancel(admin, id)).code, '0');
  assert.equal((await status(admin, id)).status, 404);
  assert.equal((await put(admin, id, 1000, pattern(0, 10))).status, 404);
  assert.equal((await finish(admin, id)).status, 404);
  assert.equal((await cancel(admin, id)).status, 404);
});

test('two uploads to one field are separate, and the last to finish is what the field holds', async () => {
  const a = pattern(0, 1_500_000, 1);
  const b = pattern(0, 1_200_000, 2);
  const [sa, sb] = await Promise.all([
    start(admin, 3, { filename: 'a.bin', size: a.length, sha256: sha(a) }),
    start(admin, 3, { filename: 'b.bin', size: b.length, sha256: sha(b) }),
  ]);
  const [ia, ib]: string[] = [sa.response.uploadId, sb.response.uploadId];
  assert.notEqual(ia, ib);
  // Pieces of both, interleaved and at the same time.
  for (let at = 0; at < a.length; at += 500_000) {
    await Promise.all([put(admin, ia, at, a.subarray(at, at + 500_000)), put(admin, ib, at, b.subarray(at, at + 500_000))]);
  }
  assert.equal((await status(admin, ia)).response.received, a.length);
  assert.equal((await status(admin, ib)).response.received, b.length);
  assert.equal((await finish(admin, ia)).code, '0');
  assert.ok(held(3)!.bytes.equals(a));
  assert.equal((await finish(admin, ib)).code, '0');
  assert.ok(held(3)!.bytes.equals(b));
  assert.equal(held(3)!.info.filename, 'b.bin');
});

test('two pieces of one upload at once: one is taken, the other asked to wait', async () => {
  const data = pattern(0, 400_000);
  const s = await start(admin, 1, { filename: 'one.bin', size: data.length });
  const id: string = s.response.uploadId;
  // The first piece is sent slowly, so the second arrives while it is still coming.
  const slow = new Promise<number>((resolve, reject) => {
    const req = request(new URL(`${f.api}/layouts/Contacts/container-uploads/${id}?offset=0`), { method: 'PUT', headers: { authorization: admin, 'content-length': String(data.length) } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode!));
    });
    req.on('error', reject);
    req.write(data.subarray(0, 100_000));
    setTimeout(() => req.end(data.subarray(100_000)), 400);
  });
  await new Promise((r) => setTimeout(r, 150));
  const second = await put(admin, id, 100_000, data.subarray(100_000));
  assert.equal(second.status, 409);
  assert.equal(await slow, 200);
  assert.equal((await finish(admin, id)).code, '0');
  assert.ok(held(1)!.bytes.equals(data));
});

test('one account has only a few uploads going at once', async () => {
  const ids: string[] = [];
  for (let i = 0; i < MAX_CONTAINER_UPLOADS_PER_ACCOUNT; i++) ids.push((await start(admin, 1, { filename: `n${i}`, size: 10 })).response.uploadId);
  const over = await start(admin, 1, { filename: 'one too many', size: 10 });
  assert.equal(over.status, 429);
  // Another account is not held up by it.
  const other = await f.login('Admin2');
  const theirs = await start(other, 1, { filename: 'theirs', size: 10 });
  assert.equal(theirs.code, '0');
  for (const id of ids) await cancel(admin, id);
  await cancel(other, theirs.response.uploadId);
  assert.equal((await start(admin, 1, { filename: 'room again', size: 10 })).code, '0');
});

test('an upload is its account\'s alone', async () => {
  const other = await f.login('Admin2');
  const s = await start(admin, 1, { filename: 'mine.bin', size: 20 });
  const id: string = s.response.uploadId;
  await put(admin, id, 0, pattern(0, 10));
  for (const r of [await status(other, id), await put(other, id, 10, pattern(0, 10)), await finish(other, id), await cancel(other, id)]) assert.equal(r.status, 404);
  // And it belongs to the layout it was started on.
  assert.equal((await call(admin, 'GET', `/layouts/Docs/container-uploads/${id}`)).status, 404);
  assert.equal((await status(admin, id)).response.received, 10);
  await cancel(admin, id);
});

test('whether the account may write the field is settled before a byte is taken in, and again when it finishes', async () => {
  const looker = await f.login('Looker');
  const refused = await start(looker, 1, { filename: 'no.bin', size: 10 });
  assert.equal(refused.status >= 400, true, JSON.stringify(refused));
  assert.notEqual(refused.code, '0');
  // A record or field that is not there.
  assert.notEqual((await start(admin, 1, { size: 10 }, 'Nope')).code, '0');
  assert.notEqual((await call(admin, 'POST', '/layouts/Contacts/records/999999/container-uploads/Photo/1', { size: 10 })).code, '0');
  assert.notEqual((await call(admin, 'POST', `/layouts/Contacts/records/${f.contact(1)}/container-uploads/Photo/7`, { size: 10 })).code, '0');
  assert.notEqual((await call(admin, 'POST', `/layouts/Nope/records/${f.contact(1)}/container-uploads/Photo/1`, { size: 10 })).code, '0');
  // An editor starts one; her rights are taken away before it finishes; it is refused, kept, and goes in once they are back.
  let editor = await f.login('Editor');
  const data = pattern(0, 3000);
  const s = await start(editor, 1, { filename: 'late.bin', size: data.length });
  assert.equal(s.code, '0');
  await put(editor, s.response.uploadId, 0, data);
  const sets = f.store.privilegeSets();
  const editors = sets.find((p) => p.name === 'Editors')!;
  f.store.savePrivilegeSet({ ...editors, tables: { Contacts: { view: true, edit: true, create: true, delete: false, fields: { Photo: 'viewOnly' } } } } as never);
  const late = await finish(editor, s.response.uploadId);
  assert.notEqual(late.code, '0', JSON.stringify(late));
  assert.notEqual(held(1)?.info.filename, 'late.bin');
  f.store.savePrivilegeSet(editors);
  editor = await f.login('Editor'); // each change of the set's authority ended the account's session
  assert.equal((await finish(editor, s.response.uploadId)).code, '0');
  assert.ok(held(1)!.bytes.equals(data));
});

test('a record changed since the upload started is refused when it finishes, as for a single request', async () => {
  const data = pattern(0, 500);
  const modId = f.store.get('Contacts', Number(f.contact(2)), 'iso', undefined, undefined, { fields: [] }).modId;
  const s = await call(admin, 'POST', startPath(2), { filename: 'm.bin', size: data.length, modId: String(modId) });
  await put(admin, s.response.uploadId, 0, data);
  f.store.update('Contacts', Number(f.contact(2)), { Name: 'changed meanwhile' });
  const r = await finish(admin, s.response.uploadId);
  assert.equal(r.code, '306');
  // The record only moves on, so that upload can never be put in: it is gone, and its quota is free again.
  assert.equal((await call(admin, 'GET', `/layouts/Contacts/container-uploads/${s.response.uploadId}`)).status, 404);
  // And one started against a modId that is already stale is refused before a byte is sent.
  const stale = await call(admin, 'POST', startPath(2), { filename: 'm.bin', size: data.length, modId: String(modId) });
  assert.equal(stale.code, '306');
});

test('a file goes into a portal row\'s container field the same way', async () => {
  const data = pattern(0, 1_300_000, 9);
  const q = `?portal=${encodeURIComponent(f.portal())}&portalRecordId=${f.doc(1)}`;
  const s = await call(admin, 'POST', `/layouts/Contacts/records/${f.contact(1)}/container-uploads/Docs::File/1${q}`, { filename: 'doc.pdf', mime: 'application/pdf', size: data.length });
  assert.equal(s.code, '0');
  await put(admin, s.response.uploadId, 0, data);
  assert.equal((await finish(admin, s.response.uploadId)).code, '0');
  const id = f.store.containerId('Docs', f.doc(1), 'File')!;
  assert.equal(f.store.containerInfo(id)!.filename, 'doc.pdf');
  assert.ok(Buffer.from(f.store.container(id)!.data).equals(data));
  // A row that is not the record's own is turned away at the start.
  const wrong = await call(admin, 'POST', `/layouts/Contacts/records/${f.contact(1)}/container-uploads/Docs::File/1?portal=${encodeURIComponent(f.portal())}&portalRecordId=${f.doc(2)}`, { size: 10 });
  assert.notEqual(wrong.code, '0');
});

test('a token that may only read cannot start, send or finish an upload', async () => {
  const token = f.store.createApiToken('Admin', { readOnly: true });
  const auth = `Bearer ${token}`;
  assert.equal((await start(auth, 1, { size: 10 })).status, 403);
  const s = await start(admin, 1, { size: 10 });
  assert.equal((await put(auth, s.response.uploadId, 0, pattern(0, 10))).status, 403);
  assert.equal((await finish(auth, s.response.uploadId)).status, 403);
  await cancel(admin, s.response.uploadId);
});

test('a request with a single multipart body still works, for a file bigger than a piece', async () => {
  const data = pattern(0, 3 * 1024 * 1024 + 7, 3);
  const form = new FormData();
  form.append('upload', new Blob([new Uint8Array(data)], { type: 'image/png' }), 'big photo.png');
  const r = await fetch(`${f.api}/layouts/Contacts/records/${f.contact(2)}/containers/Photo/1`, { method: 'POST', headers: { authorization: admin }, body: form });
  assert.equal((await r.json()).messages[0].code, '0');
  const got = held(2)!;
  assert.equal(got.info.filename, 'big photo.png');
  assert.equal(got.info.chunked, true);
  assert.ok(got.bytes.equals(data));
  assert.equal(got.info.modified !== undefined, true);
});

test('the manager: idle uploads go, the bytes are counted, the folder is emptied', async (t) => {
  let now = 0;
  const m = new ContainerUploads({ now: () => now, idleMs: 1000 });
  t.after(() => m.stop());
  const who = { db: 'C', account: 'A' };
  const target = { layout: 'L', recordId: 1, field: 'F', repetition: 1 };
  const u = m.start(who, target, { size: 10 });
  const w = m.beginPiece(u.id, who, 'L', 0, 4);
  w.append(Buffer.from('abcd'));
  w.end();
  assert.equal(m.get(u.id, who, 'L').received, 4);
  now = 999;
  m.sweep();
  assert.equal(m.count, 1);
  const named = m.start(who, target, { size: 1, filename: 'a\n/../../b' });
  assert.equal(named.filename, 'b', 'a line break does not hide the folders in front of a name');
  m.cancel(named.id, who, 'L');
  // Asking how far it has got does not keep it: only bytes do.
  m.get(u.id, who, 'L');
  now = 1001;
  m.sweep();
  assert.equal(m.count, 0, 'nothing arrived for the idle time');
  assert.throws(() => m.get(u.id, who, 'L'), (e: unknown) => e instanceof ContainerUploadError && e.status === 404);
  // While a piece is arriving the upload is not idle, however long it takes.
  const v = m.start(who, target, { size: 10 });
  const slow = m.beginPiece(v.id, who, 'L', 0, undefined);
  now = 10_000;
  m.sweep();
  assert.equal(m.count, 1);
  slow.end();
  // Cancelling while a piece arrives stops its next chunk.
  const x = m.start(who, target, { size: 10 });
  const live = m.beginPiece(x.id, who, 'L', 0, undefined);
  live.append(Buffer.from('ab'));
  m.cancel(x.id, who, 'L');
  assert.throws(() => live.append(Buffer.from('cd')), /cancelled/);
  live.end();
  assert.throws(() => m.get(x.id, who, 'L'), /No such upload/);
  // Accounts compare without regard to case; another file's never matches.
  assert.equal(m.get(v.id, { db: 'C', account: 'a' }, 'l').id, v.id);
  assert.throws(() => m.get(v.id, { db: 'D', account: 'A' }, 'L'), /No such upload/);
  // All the bytes declared are counted, across accounts.
  const big = MAX_CONTAINER_FILE;
  const taken: string[] = [];
  for (let i = 0; i < 7; i++) taken.push(m.start({ db: 'C', account: `acct${i}` }, target, { size: big }).id);
  assert.throws(() => m.start({ db: 'C', account: 'acct9' }, target, { size: big }), (e: unknown) => e instanceof ContainerUploadError && e.status === 413);
  m.stop();
  assert.equal(m.count, 0);
});
