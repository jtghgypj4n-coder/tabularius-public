// Container files over HTTP: audio and video can seek (a Range of the middle or the end), a second range is refused
// cleanly, a file that has not changed is not sent again, names with quotes, slashes and Unicode come out as a safe
// header, and a Range never gets anyone a file the link does not allow.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { containerFixture, pattern, type ContainerFixture } from './container-fixture.ts';
import { contentDisposition, parseRange } from '../src/containers.ts';

let f: ContainerFixture;
const SIZE = 3 * 1024 * 1024 + 12_345;
const data = pattern(0, SIZE, 4);
let id: number;
let url: string;

before(async () => {
  f = await containerFixture();
  f.store.setContainer('Contacts', Number(f.contact(1)), 'Photo', 1, { filename: 'clip.mp4', mime: 'video/mp4', data });
  id = f.store.containerId('Contacts', Number(f.contact(1)), 'Photo')!;
  url = f.store.present(id, 'container', 'iso') as string;
});
after(async () => { await f?.close(); });

const get = (headers: Record<string, string> = {}, method = 'GET', at = url) => fetch(at, { method, headers });
const bytes = async (r: Response) => Buffer.from(await r.arrayBuffer());

test('seeking: a range from the middle, the end, an open end, and across the pieces it is stored in', async () => {
  assert.equal(f.store.containerInfo(id)!.chunked, true);
  const cases: [string, number, number][] = [
    ['bytes=0-0', 0, 0],
    ['bytes=1000000-1000099', 1_000_000, 1_000_099],
    [`bytes=${1024 * 1024 - 5}-${1024 * 1024 + 5}`, 1024 * 1024 - 5, 1024 * 1024 + 5],
    [`bytes=${2 * 1024 * 1024 + 7}-`, 2 * 1024 * 1024 + 7, SIZE - 1],
    ['bytes=-500', SIZE - 500, SIZE - 1],
    [`bytes=${SIZE - 1}-${SIZE + 99999}`, SIZE - 1, SIZE - 1],
    [`bytes=0-${SIZE * 2}`, 0, SIZE - 1],
  ];
  for (const [range, from, to] of cases) {
    const r = await get({ range });
    assert.equal(r.status, 206, range);
    assert.equal(r.headers.get('content-range'), `bytes ${from}-${to}/${SIZE}`, range);
    assert.equal(r.headers.get('content-length'), String(to - from + 1), range);
    assert.equal(r.headers.get('accept-ranges'), 'bytes');
    assert.ok((await bytes(r)).equals(data.subarray(from, to + 1)), range);
  }
  const whole = await get();
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-length'), String(SIZE));
  assert.ok((await bytes(whole)).equals(data));
});

test('a range that is not satisfiable is 416 with the size; several at once, or one that is not a range, are ignored and send the whole file', async () => {
  for (const range of [`bytes=${SIZE}-`, `bytes=${SIZE + 5}-${SIZE + 9}`, 'bytes=-0', `bytes=${SIZE}-,${SIZE + 5}-${SIZE + 9}`, 'bytes=-0, -0']) {
    const r = await get({ range });
    assert.equal(r.status, 416, range);
    assert.equal(r.headers.get('content-range'), `bytes */${SIZE}`, range);
    assert.equal((await bytes(r)).length, 0, `no body for ${range}`);
  }
  for (const range of ['bytes=5-2', 'bytes=abc', 'items=0-9', 'bytes=', 'bytes=-', '0-9', 'bytes=0-9,x', 'bytes=0-9,20-29', 'bytes=0-9, 20-29, 40-', 'bytes=-5,0-1', `bytes=${SIZE}-,0-9`]) {
    const r = await get({ range });
    assert.equal(r.status, 200, range);
    assert.equal((await bytes(r)).length, SIZE, range);
  }
  assert.equal(parseRange('bytes=0-1,4-5', 10), undefined, 'several ranges: the whole file is sent');
  assert.equal(parseRange('bytes=10-,20-30', 10), 'unsatisfiable', 'none of them can be satisfied');
});

test('HEAD answers as GET does, with no body', async () => {
  const head = await get({}, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(SIZE));
  assert.equal((await bytes(head)).length, 0);
  const ranged = await get({ range: 'bytes=10-19' }, 'HEAD');
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-length'), '10');
  assert.equal((await bytes(ranged)).length, 0);
});

test('a file that has not changed is not sent again, and a range is only for the version the client holds', async () => {
  const head = await get({}, 'HEAD');
  const etag = head.headers.get('etag')!;
  const modified = head.headers.get('last-modified')!;
  assert.match(etag, /^"\d+-\d+"$/);
  assert.match(modified, /^[A-Z][a-z]{2}, \d\d [A-Z][a-z]{2} \d{4} \d\d:\d\d:\d\d GMT$/);
  assert.ok(Math.abs(Date.parse(modified) - Date.now()) < 60_000);
  const unchanged: Record<string, string>[] = [{ 'if-none-match': etag }, { 'if-none-match': `W/${etag}` }, { 'if-none-match': `"x", ${etag}` }, { 'if-none-match': '*' }, { 'if-modified-since': modified }, { 'if-modified-since': new Date(Date.now() + 86400_000).toUTCString() }];
  for (const h of unchanged) {
    const r = await get(h);
    assert.equal(r.status, 304, JSON.stringify(h));
    assert.equal(r.headers.get('etag'), etag);
    assert.equal((await bytes(r)).length, 0);
  }
  // A tag decides over a date, as RFC 9110 says: a tag that does not match is not rescued by a date that does.
  assert.equal((await get({ 'if-none-match': '"other"', 'if-modified-since': modified })).status, 200);
  assert.equal((await get({ 'if-modified-since': new Date(Date.now() - 86400_000).toUTCString() })).status, 200);
  assert.equal((await get({ 'if-modified-since': 'not a date' })).status, 200);
  // A condition on the version applies to a range as well.
  assert.equal((await get({ range: 'bytes=0-9', 'if-none-match': etag })).status, 304);
  // If-Range: the whole file unless the client's tag or date is this file's.
  for (const [h, status] of [[etag, 206], [modified, 206], ['"other"', 200], [`W/${etag}`, 200], [new Date(Date.now() - 86400_000).toUTCString(), 200]] as const) {
    assert.equal((await get({ range: 'bytes=0-9', 'if-range': h })).status, status, h);
  }
  // If-Match and If-Unmodified-Since are preconditions: failing one is 412, and nothing is sent.
  assert.equal((await get({ 'if-match': etag })).status, 200);
  assert.equal((await get({ 'if-match': '*' })).status, 200);
  assert.equal((await get({ 'if-match': '"other"' })).status, 412);
  assert.equal((await get({ 'if-match': `W/${etag}` })).status, 412);
  assert.equal((await get({ 'if-unmodified-since': new Date(Date.now() - 86400_000).toUTCString() })).status, 412);
  assert.equal((await get({ 'if-unmodified-since': new Date(Date.now() + 86400_000).toUTCString() })).status, 200);
});

test('a file stored before its time was kept has no Last-Modified, and no date can stand in for it', async () => {
  f.store.sql.prepare('UPDATE _fm_containers SET stored = NULL WHERE id = ?').run(id);
  const r = await get({ 'if-modified-since': new Date(Date.now() + 86400_000).toUTCString() });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('last-modified'), null);
  assert.equal((await get({ range: 'bytes=0-9', 'if-range': new Date().toUTCString() })).status, 200);
  assert.equal((await get({ 'if-unmodified-since': 'Mon, 01 Jan 2001 00:00:00 GMT' })).status, 200);
  assert.equal(f.store.containerInfo(id)!.modified, undefined);
});

test('a name with quotes, slashes, Unicode or characters a header treats as syntax downloads, and says what it is called', async () => {
  const names = ['plain.txt', 'say "hi".txt', "it's (1) *.txt", 'a/b\\c.txt', '../../etc/passwd', '日本語 ファイル.txt', 'emoji 😀.txt', 'semi;colon, comma=equals.txt', 'percent 100%.txt', 'tab\tname.txt', 'a'.repeat(300) + '.txt', ''];
  for (const name of names) {
    const header = contentDisposition('attachment', name);
    assert.match(header, /^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''[A-Za-z0-9!#$&+\-.^_`|~%]*$/, JSON.stringify(name));
    const plain = /filename="([^"]*)"/.exec(header)![1];
    assert.ok(!/["\\/]/.test(plain), `no quote or slash in ${JSON.stringify(plain)}`);
    const star = decodeURIComponent(/filename\*=UTF-8''(.*)$/.exec(header)![1]);
    assert.equal(star, name || 'file', 'the real name survives');
  }
  assert.equal(contentDisposition('inline', null), `inline; filename="file"; filename*=UTF-8''file`);
  // And over the wire, for each of them.
  for (const name of ['say "hi".txt', 'a/b\\c.txt', '日本語.txt', "it's (1) *.txt"]) {
    f.store.sql.prepare('UPDATE _fm_containers SET filename = ?, mime = ? WHERE id = ?').run(name, 'text/plain', id);
    const r = await get({ range: 'bytes=0-3' });
    assert.equal(r.status, 206, name);
    assert.equal(r.headers.get('content-disposition'), contentDisposition('inline', name));
  }
  f.store.sql.prepare('UPDATE _fm_containers SET filename = ?, mime = ? WHERE id = ?').run('clip.mp4', 'video/mp4', id);
});

test('a range gets no more than the link allows: a forged, altered or expired link sends nothing', async () => {
  const other = f.store.containerId('Docs', f.doc(1), 'File');
  assert.equal(other, undefined);
  const forged = url.replace(/sig=[^&]*/, 'sig=forged');
  const wrongId = url.replace(`/${id}/`, `/${id + 1}/`);
  const wrongFile = url.replace('/C/', '/D/');
  const past = Math.floor(Date.now() / 1000) - 60;
  const expired = url.replace(/exp=\d+/, `exp=${past}`).replace(/sig=[^&]*/, `sig=${f.host.sign('C', id, '', past)}`);
  const noSig = url.replace(/\?.*$/, '');
  for (const [what, u] of [['forged', forged], ['another id', wrongId], ['another file', wrongFile], ['expired', expired], ['no signature', noSig]] as const) {
    const asks: Record<string, string>[] = [{}, { range: 'bytes=0-99' }, { range: 'bytes=-99' }, { range: 'bytes=0-9,20-29' }, { range: `bytes=${SIZE}-` }, { 'if-none-match': '*' }, { 'if-range': '*', range: 'bytes=0-9' }];
    for (const headers of asks) {
      const r = await get(headers, 'GET', u);
      assert.equal(r.status, 404, `${what} ${JSON.stringify(headers)}`);
      assert.equal(r.headers.get('content-range'), null);
      assert.equal(r.headers.get('etag'), null, 'it does not even say that the file exists');
      assert.equal((await bytes(r)).length === 0 || r.headers.get('content-type') !== 'video/mp4', true);
    }
    assert.equal((await get({}, 'HEAD', u)).status, 404, what);
  }
  // The right link still works, after all that.
  assert.equal((await get({ range: 'bytes=0-9' })).status, 206);
});
