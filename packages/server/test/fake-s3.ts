// A small S3 for tests (MinIO stands in for a real service; nothing here reaches AWS): objects in memory, every
// request's Signature Version 4 checked the way S3 checks it, and a record of what each request carried.
import { createServer, type IncomingMessage } from 'node:http';
import { signV4 } from '../src/s3.ts';

export interface FakeS3Options {
  bucket: string;
  accessKey: string;
  secretKey: string;
  region?: string;
  sessionToken?: string;
}

export interface FakeS3Request {
  method: string;
  key: string;
  query: string;
  contentType?: string;
}

export async function fakeS3(o: FakeS3Options) {
  const objects = new Map<string, { body: Buffer; type?: string }>();
  const requests: FakeS3Request[] = [];
  const seen = { rejected: 0 };
  const server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url!, 'http://x');
    const auth = String(req.headers.authorization ?? '');
    const signed = /SignedHeaders=([^,]+)/.exec(auth)?.[1].split(';') ?? [];
    const headers = Object.fromEntries(signed.filter((h) => !['host', 'x-amz-content-sha256', 'x-amz-date'].includes(h)).map((h) => [h, String(req.headers[h])]));
    const expect = signV4({
      method: req.method!, host: String(req.headers.host), path: url.pathname, query: [...url.searchParams.entries()], headers,
      payloadHash: String(req.headers['x-amz-content-sha256']), accessKey: o.accessKey, secretKey: o.secretKey, region: o.region ?? 'us-east-1',
      date: new Date(String(req.headers['x-amz-date']).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')),
    }).authorization;
    const bad = auth !== expect || (o.sessionToken !== undefined && req.headers['x-amz-security-token'] !== o.sessionToken);
    if (bad) {
      seen.rejected++;
      // Like S3's own page for this: it spells out the access key ID, what was signed and the signed headers (token included).
      res.writeHead(403).end(`<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match the signature you provided.</Message><AWSAccessKeyId>${o.accessKey}</AWSAccessKeyId><StringToSign>AWS4-HMAC-SHA256</StringToSign><SignatureProvided>${/Signature=(\w+)/.exec(auth)?.[1]}</SignatureProvided><CanonicalRequest>${req.method} ${url.pathname}\nx-amz-security-token:${req.headers['x-amz-security-token'] ?? ''}</CanonicalRequest></Error>`);
      return;
    }
    const [, bucket, ...rest] = decodeURIComponent(url.pathname).split('/');
    if (bucket !== o.bucket) {
      res.writeHead(404).end('<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message></Error>');
      return;
    }
    const key = rest.join('/');
    requests.push({ method: req.method!, key, query: url.search, ...(req.headers['content-type'] ? { contentType: String(req.headers['content-type']) } : {}) });
    if (req.method === 'GET' && !key) {
      const prefix = url.searchParams.get('prefix') ?? '';
      const max = Number(url.searchParams.get('max-keys') ?? 1000);
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const from = Number(url.searchParams.get('continuation-token') ?? 0);
      const page = all.slice(from, from + max);
      const more = from + max < all.length;
      res.end(`<ListBucketResult>${page.map((k) => `<Contents><Key>${k.replace(/&/g, '&amp;')}</Key><Size>${objects.get(k)!.body.length}</Size></Contents>`).join('')}<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${from + max}</NextContinuationToken>` : ''}</ListBucketResult>`);
    } else if (req.method === 'PUT') {
      objects.set(key, { body, type: req.headers['content-type'] });
      res.writeHead(200, { etag: '"e"' }).end();
    } else if (req.method === 'GET') {
      const found = objects.get(key);
      if (!found) res.writeHead(404).end('<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>');
      else res.writeHead(200, found.type ? { 'content-type': found.type } : {}).end(found.body);
    } else if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204).end();
    } else res.writeHead(400).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { endpoint, objects, requests, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}
