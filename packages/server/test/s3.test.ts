import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host, S3, STORE_EXT, backupFolder, mirrorDown, mirrorUp, restoreBackup, scheduleOffsite, serve, signV4 } from '../src/index.ts';
import { Store } from '../../store/src/index.ts';

// Off-site backups: the backup folder mirrored to S3-compatible storage.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const KEYS = { accessKey: 'AKIDTEST', secretKey: 'secret/key+test' };

test('requests are signed as AWS documents (Signature Version 4 example)', () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html, "GET Object".
  const h = signV4({
    method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', headers: { range: 'bytes=0-9' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', date: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(h.authorization, 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('a header with a non-breaking space is signed as it is sent, not folded into a plain space', () => {
  const sign = (v: string) => signV4({ method: 'PUT', host: 'h', path: '/b/k', headers: { 'x-amz-meta-a': v }, payloadHash: 'x', accessKey: 'A', secretKey: 'S', region: 'r', date: new Date('2013-05-24T00:00:00Z') }).authorization;
  assert.notEqual(sign('a\u00a0b'), sign('a b'));
  assert.equal(sign('  a   b  '), sign('a b'));
});

/** A small S3: objects in memory, every request's signature checked, listings two keys a page. */
async function fakeS3() {
  const objects = new Map<string, Buffer>();
  const uploads = new Map<string, Map<number, Buffer>>();
  const seen = { multipart: 0, rejected: 0 };
  const server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url!, 'http://x');
    // Check the signature the way S3 does: rebuild it from what arrived.
    const auth = String(req.headers.authorization ?? '');
    const signed = /SignedHeaders=([^,]+)/.exec(auth)?.[1].split(';') ?? [];
    const headers = Object.fromEntries(signed.filter((h) => !['host', 'x-amz-content-sha256', 'x-amz-date'].includes(h)).map((h) => [h, String(req.headers[h])]));
    const expect = signV4({
      method: req.method!, host: String(req.headers.host), path: url.pathname, query: [...url.searchParams.entries()], headers,
      payloadHash: String(req.headers['x-amz-content-sha256']), ...KEYS, region: 'us-east-1',
      date: new Date(String(req.headers['x-amz-date']).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')),
    }).authorization;
    if (auth !== expect) {
      seen.rejected++;
      res.writeHead(403).end('<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match</Message></Error>');
      return;
    }
    const [, bucket, ...rest] = decodeURIComponent(url.pathname).split('/');
    assert.equal(bucket, 'backups');
    const key = rest.join('/');
    const q = url.searchParams;
    if (req.method === 'GET' && !key) {
      const prefix = q.get('prefix') ?? '';
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const from = Number(q.get('continuation-token') ?? 0);
      const page = all.slice(from, from + 2);
      const more = from + 2 < all.length;
      res.end(`<ListBucketResult>${page.map((k) => `<Contents><Key>${k.replace(/&/g, '&amp;')}</Key><Size>${objects.get(k)!.length}</Size></Contents>`).join('')}<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${from + 2}</NextContinuationToken>` : ''}</ListBucketResult>`);
    } else if (req.method === 'POST' && q.has('uploads')) {
      const id = String(uploads.size + 1);
      uploads.set(id, new Map());
      res.end(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    } else if (req.method === 'PUT' && q.has('uploadId')) {
      uploads.get(q.get('uploadId')!)!.set(Number(q.get('partNumber')), body);
      res.writeHead(200, { etag: `"part${q.get('partNumber')}"` }).end();
    } else if (req.method === 'POST' && q.has('uploadId')) {
      const parts = uploads.get(q.get('uploadId')!)!;
      const order = [...body.toString().matchAll(/<PartNumber>(\d+)<\/PartNumber><ETag>"part(\d+)"<\/ETag>/g)].map((m) => Number(m[1]));
      objects.set(key, Buffer.concat(order.map((n) => parts.get(n)!)));
      seen.multipart++;
      res.end('<CompleteMultipartUploadResult/>');
    } else if (req.method === 'PUT') {
      objects.set(key, body);
      res.end();
    } else if (req.method === 'GET') {
      const o = objects.get(key);
      if (!o) res.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>');
      else res.end(o);
    } else if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204).end();
    } else res.writeHead(400).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { endpoint, objects, seen, close: () => server.close() };
}

test('backups are mirrored off-site, pruned there too, and restore from there', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-s3-'));
  const s3 = await fakeS3();
  try {
    copyFileSync(fixture, join(dir, 'Charts.fmp12'));
    const host = new Host(dir);
    host.get('Charts')!.update('Congress', 1, { Name: 'Backed up off-site' });
    host.close();
    const dest = join(dir, 'Backups');
    const first = await backupFolder(dir, dest, 2);
    // Small parts, so the database goes up in several.
    const bucket = new S3({ url: 's3://backups/office one', endpoint: s3.endpoint, ...KEYS, partSize: 64 * 1024 });
    const up = await mirrorUp(dest, bucket);
    assert.ok(up.uploaded >= 2, JSON.stringify(up));
    assert.ok(s3.seen.multipart >= 1);
    const key = `office one/${first.dir.split(/[\\/]/).pop()}/Charts${STORE_EXT}`;
    assert.ok(s3.objects.has(key), [...s3.objects.keys()].join());
    // Nothing changed: nothing goes up again.
    assert.equal((await mirrorUp(dest, bucket)).uploaded, 0);

    // Sets pruned here are removed there.
    await backupFolder(dir, dest, 2);
    const third = await backupFolder(dir, dest, 2);
    const r = await mirrorUp(dest, bucket);
    assert.ok(r.removed >= 1, JSON.stringify(r));
    assert.ok(!s3.objects.has(key));

    // A wrong key is refused with S3's own words.
    const wrong = new S3({ url: 's3://backups/office one', endpoint: s3.endpoint, accessKey: KEYS.accessKey, secretKey: 'nope' });
    await assert.rejects(wrong.list(), /403 SignatureDoesNotMatch/);

    // The machine is lost: bring the backups down and restore.
    rmSync(dest, { recursive: true, force: true });
    rmSync(join(dir, 'Charts' + STORE_EXT));
    assert.ok((await mirrorDown(bucket, dest)) >= 2);
    assert.deepEqual(readdirSync(dest).filter((n) => /^\d/.test(n)).length, 2);
    await restoreBackup(dir, join(dest, third.dir.split(/[\\/]/).pop()!));
    const s = new Store(join(dir, 'Charts' + STORE_EXT), 'Charts');
    try {
      assert.equal(s.get('Congress', 1).fieldData.Name, 'Backed up off-site');
    } finally {
      s.close();
    }
  } finally {
    s3.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the server copies each backup off-site, and the last changes when it stops', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-s3-'));
  const s3 = await fakeS3();
  try {
    copyFileSync(fixture, join(dir, 'Charts.fmp12'));
    const { server, url, offsite } = await serve({
      dir, port: 0, watch: false, log: () => {},
      backups: { every: 86_400_000 }, offsite: { url: 's3://backups/server', endpoint: s3.endpoint, ...KEYS, every: 3_600_000 },
    });
    try {
    const res = await fetch(`${url}/tabularius/admin/v1/backup`, { method: 'POST', headers: { 'x-tabularius-admin': '1' } });
    assert.equal(res.status, 200, await res.clone().text());
    const set = ((await res.json()) as { dir: string }).dir.split(/[\\/]/).pop();
    await offsite!.run();
    assert.ok(s3.objects.has(`server/${set}/Charts${STORE_EXT}`), [...s3.objects.keys()].join());
    assert.equal(offsite!.last?.ok, true);
    const status = (await (await fetch(`${url}/tabularius/admin/v1/status`)).json()) as { backups: { offsite: { last: { ok: boolean } } } };
    assert.equal(status.backups.offsite.last.ok, true);
    } finally {
      server.close();
      await offsite!.stop();
    }
  } finally {
    s3.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an off-site mirror reports linked backup sets in its result and log', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-s3-link-'));
  const target = join(dir, 'target');
  const folder = join(dir, 'Backups');
  const s3 = await fakeS3();
  try {
    mkdirSync(target);
    mkdirSync(folder);
    symlinkSync(target, join(folder, '2026-10-16_120000'));
    const bucket = new S3({ url: 's3://backups/test', endpoint: s3.endpoint, ...KEYS });
    const result = await mirrorUp(folder, bucket);
    assert.deepEqual(result.skipped, ['2026-10-16_120000: skipped, is a link']);

    const logs: string[] = [];
    const schedule = scheduleOffsite(folder, bucket, { every: 60_000, log: (message) => logs.push(message) });
    await schedule.run();
    await schedule.stop();
    assert.match(schedule.last?.message ?? '', /skipped, is a link/);
    assert.ok(logs.some((message) => /skipped, is a link/.test(message)));
  } finally {
    s3.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
