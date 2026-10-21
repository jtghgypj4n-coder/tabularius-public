// Off-site backups: the backup folder mirrored to S3-compatible storage
// (Amazon S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, ...), so a lost
// machine doesn't take its backups with it.
//
//   TABULARIUS_S3_ACCESS_KEY / TABULARIUS_S3_SECRET_KEY (or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
//   tabularius serve <folder> --backup-s3 s3://bucket/prefix [--s3-endpoint https://...] [--s3-region auto]
//
// After each backup, and every few minutes for point-in-time changes, files
// new or changed in the backup folder are uploaded and sets removed locally
// are removed there too. With TABULARIUS_BACKUP_KEY set, what is uploaded is
// already encrypted. Restoring from it downloads the sets first:
//
//   tabularius restore <folder> --at "2026-10-11 14:05" --from s3://bucket/prefix
//
// Requests are signed with AWS Signature Version 4; files over 64 MB go up
// in parts (S3 takes at most 5 GB in one request).

import { readJsonStateSync, updateJsonStateSync } from '../../store/src/durable.ts';
import { createHash, createHmac } from 'node:crypto';
import { closeSync, constants as fsConstants, createWriteStream, existsSync, mkdirSync, openSync, readSync, readdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { safeExistingPath, safeWritePath } from '../../store/src/safe-path.ts';

const PART = 64 * 1024 * 1024;
const EMPTY_HASH = createHash('sha256').update('').digest('hex');

import { guardedFetcher } from '../../scripts/src/net-guard.ts';

// Backup objects are large: no size cap, and hours rather than minutes (the guard's defaults suit small answers).
const S3_FETCH = guardedFetcher({ policy: { private: true }, maxBytes: Infinity, timeoutMs: 6 * 3600_000 });

export interface S3Options {
  /** s3://bucket/prefix */
  url: string;
  accessKey: string;
  secretKey: string;
  /** https://<account>.r2.cloudflarestorage.com, https://s3.us-west-002.backblazeb2.com, ... (default AWS for the region). */
  endpoint?: string;
  /** Default us-east-1 (R2 takes "auto"). */
  region?: string;
  /** Files larger than this go up in parts of this size (default 64 MB; S3's least is 5 MB). */
  partSize?: number;
  /** Temporary credentials' session token (sent as x-amz-security-token). */
  sessionToken?: string;
  /** Swappable for tests; the shared outbound guard otherwise (an endpoint on the machine's own network, MinIO say, is the administrator's choice). */
  fetch?: typeof fetch;
}

/** S3 options from the environment and an s3:// address. */
export function s3FromEnv(url: string, endpoint?: string, region?: string): S3Options {
  const accessKey = process.env.TABULARIUS_S3_ACCESS_KEY ?? process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.TABULARIUS_S3_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKey || !secretKey) throw new Error('S3: set TABULARIUS_S3_ACCESS_KEY and TABULARIUS_S3_SECRET_KEY');
  return {
    url, accessKey, secretKey,
    endpoint: endpoint ?? process.env.TABULARIUS_S3_ENDPOINT,
    region: region ?? process.env.TABULARIUS_S3_REGION ?? process.env.AWS_REGION,
  };
}

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();

/**
 * AWS Signature Version 4 for one request: returns the headers to send.
 * `path` is already encoded; `query` pairs are encoded here.
 */
export function signV4(o: {
  method: string; host: string; path: string; query?: [string, string][]; headers?: Record<string, string>;
  payloadHash: string; accessKey: string; secretKey: string; region: string; service?: string; date?: Date;
}): Record<string, string> {
  const service = o.service ?? 's3';
  const amzDate = (o.date ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(o.headers ?? {})) {
    const lower = name.toLowerCase();
    if (['authorization', 'host', 'x-amz-content-sha256', 'x-amz-date'].includes(lower)) continue;
    headers[lower] = headers[lower] === undefined ? value : headers[lower] + ',' + value;
  }
  Object.assign(headers, { host: o.host, 'x-amz-content-sha256': o.payloadHash, 'x-amz-date': amzDate });
  const names = Object.keys(headers).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, String(v).replace(/^[ \t]+|[ \t]+$/g, '').replace(/[ \t]+/g, ' ')]));
  const query = (o.query ?? []).map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = [o.method, o.path, query, names.map((n) => `${n}:${lower[n]}\n`).join(''), names.join(';'), o.payloadHash].join('\n');
  const scope = `${day}/${o.region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${o.secretKey}`, day), o.region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${o.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

export class S3 {
  private readonly o: S3Options;
  readonly bucket: string;
  readonly prefix: string;
  private readonly base: URL;
  private readonly region: string;

  constructor(o: S3Options) {
    const m = /^s3:\/\/([^/]+)\/?(.*)$/.exec(o.url);
    if (!m) throw new Error(`S3: "${o.url}" is not like s3://bucket/prefix`);
    this.o = o;
    this.bucket = m[1];
    this.prefix = m[2].replace(/\/+$/, '');
    this.region = o.region ?? 'us-east-1';
    // Bucket in the path: works with every S3-compatible service.
    this.base = new URL(o.endpoint ?? `https://s3.${this.region}.amazonaws.com`);
  }

  /** The object key for a path relative to the mirrored folder. */
  key(rel: string): string {
    return (this.prefix ? this.prefix + '/' : '') + rel.split(sep).join('/');
  }

  /** One signed request, answered as it is: no retries, and a refusal is a response, not an error. */
  async raw(method: string, key: string | undefined, opts: { query?: [string, string][]; body?: Uint8Array; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<Response> {
    const path = `${this.base.pathname.replace(/\/$/, '')}/${enc(this.bucket)}${key === undefined ? '' : '/' + key.split('/').map(enc).join('/')}`;
    const payloadHash = opts.body ? createHash('sha256').update(opts.body).digest('hex') : EMPTY_HASH;
    const token: Record<string, string> = this.o.sessionToken ? { 'x-amz-security-token': this.o.sessionToken } : {};
    const headers = signV4({ method, host: this.base.host, path, query: opts.query, headers: { ...opts.headers, ...token }, payloadHash, accessKey: this.o.accessKey, secretKey: this.o.secretKey, region: this.region });
    delete headers.host;
    const qs = (opts.query ?? []).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
    return (this.o.fetch ?? S3_FETCH)(`${this.base.origin}${path}${qs ? '?' + qs : ''}`, { method, headers, body: opts.body ? new Uint8Array(opts.body) : undefined, redirect: 'manual', ...(opts.signal ? { signal: opts.signal } : {}) });
  }

  private async request(method: string, key: string | undefined, opts: { query?: [string, string][]; body?: Buffer; headers?: Record<string, string> } = {}): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await this.raw(method, key, opts);
        if (res.status >= 500 && attempt < 4) throw new Error(`S3 answered ${res.status}`);
        if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
          const text = await res.text();
          const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
          const message = /<Message>([^<]+)<\/Message>/.exec(text)?.[1];
          throw Object.assign(new Error(`S3 ${method} ${key ?? this.bucket}: ${res.status}${code ? ` ${code}` : ''}${message ? `: ${message}` : ''}`), { final: true });
        }
        return res;
      } catch (e) {
        if ((e as { final?: boolean }).final || attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  }

  /** Uploads a file (in parts when large). */
  async put(key: string, file: string): Promise<void> {
    const size = statSync(file).size;
    const part = this.o.partSize ?? PART;
    const fd = openSync(file, 'r');
    try {
      const read = (pos: number, n: number) => {
        const buf = Buffer.alloc(n);
        let got = 0;
        while (got < n) got += readSync(fd, buf, got, n - got, pos + got);
        return buf;
      };
      if (size <= part) {
        await this.request('PUT', key, { body: read(0, size) });
        return;
      }
      const start = await (await this.request('POST', key, { query: [['uploads', '']] })).text();
      const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(start)?.[1];
      if (!uploadId) throw new Error('S3 gave no upload id');
      try {
        const parts: string[] = [];
        for (let n = 1, pos = 0; pos < size; n++, pos += part) {
          const res = await this.request('PUT', key, { query: [['partNumber', String(n)], ['uploadId', uploadId]], body: read(pos, Math.min(part, size - pos)) });
          parts.push(`<Part><PartNumber>${n}</PartNumber><ETag>${res.headers.get('etag')}</ETag></Part>`);
        }
        const done = Buffer.from(`<CompleteMultipartUpload>${parts.join('')}</CompleteMultipartUpload>`);
        const res = await this.request('POST', key, { query: [['uploadId', uploadId]], body: done });
        // S3 can answer 200 with an error inside.
        const text = await res.text();
        if (/<Error>/.test(text)) throw new Error(`S3 could not finish ${key}: ${/<Message>([^<]+)/.exec(text)?.[1] ?? text}`);
      } catch (e) {
        await this.request('DELETE', key, { query: [['uploadId', uploadId]] }).catch(() => {});
        throw e;
      }
    } finally {
      closeSync(fd);
    }
  }

  /** Uploads bytes (a connection's put). One request: S3 takes at most 5 GB this way. */
  async putBytes(key: string, bytes: Uint8Array, contentType?: string): Promise<void> {
    await this.request('PUT', key, { body: Buffer.from(bytes), ...(contentType ? { headers: { 'content-type': contentType } } : {}) });
  }

  /** An object's bytes and type. */
  async getBytes(key: string): Promise<{ bytes: Uint8Array; contentType?: string }> {
    const res = await this.request('GET', key);
    return { bytes: new Uint8Array(await res.arrayBuffer()), ...(res.headers.get('content-type') ? { contentType: res.headers.get('content-type')! } : {}) };
  }

  /** Downloads an object to a file. */
  async get(key: string, file: string): Promise<void> {
    const res = await this.request('GET', key);
    mkdirSync(dirname(file), { recursive: true });
    const partial = file + '.partial';
    const fd = openSync(partial, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | (fsConstants.O_NOFOLLOW ?? 0), 0o666);
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(partial, { fd, autoClose: true }));
    renameSync(file + '.partial', file);
  }

  async delete(key: string): Promise<void> {
    await this.request('DELETE', key);
  }

  /** Every object under a prefix, with its size (or the first `limit` of them). */
  async list(prefix = this.prefix ? this.prefix + '/' : '', limit?: number): Promise<{ key: string; size: number }[]> {
    const out: { key: string; size: number }[] = [];
    let token: string | undefined;
    do {
      const query: [string, string][] = [['list-type', '2'], ['prefix', prefix]];
      if (limit) query.push(['max-keys', String(limit)]);
      if (token) query.push(['continuation-token', token]);
      const xml = await (await this.request('GET', undefined, { query })).text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = /<Key>([^<]*)<\/Key>/.exec(m[1])?.[1];
        const size = Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0);
        if (key !== undefined) out.push({ key: unxml(key), size });
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? unxml(/<NextContinuationToken>([^<]+)</.exec(xml)?.[1] ?? '') || undefined : undefined;
    } while (token && !(limit && out.length >= limit));
    return out;
  }
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// --- mirroring the backup folder ---------------------------------------------

/** What was last uploaded, by path relative to the folder: size and modification time. */
const MIRRORED = '.s3-mirrored.json';

function walk(dir: string, root = dir, skipped: string[] = []): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) {
      const rel = relative(root, p);
      if (!rel.includes(sep) && /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(rel)) skipped.push(`${rel}: skipped, is a link`);
      return [];
    }
    if (e.isDirectory()) return e.name.endsWith('.partial') ? [] : walk(p, root, skipped);
    return e.name.startsWith('.') || e.name.endsWith('.partial') || e.name.endsWith('.tmp') || /\.lock\.db(?:-(?:journal|wal|shm))?$/.test(e.name) ? [] : [relative(root, p)];
  });
}

/**
 * Makes the bucket match the backup folder: uploads files that are new or
 * changed since the last time, removes objects whose files are gone (sets
 * pruned locally). Returns what it did.
 */
export async function mirrorUp(folder: string, s3: S3): Promise<{ uploaded: number; removed: number; bytes: number; skipped: string[] }> {
  const record = join(folder, MIRRORED);
  let done: Record<string, string> = {};
  try {
    done = readJsonStateSync<Record<string, string>>(record);
  } catch {}
  const save = (rel?: string, mark?: string) => {
    done = updateJsonStateSync<Record<string, string>>(record, {}, (current) => {
      if (rel !== undefined && mark !== undefined) current[rel] = mark;
      // Check the current disk, not this mirror's earlier directory snapshot.
      for (const path of Object.keys(current)) if (!safeExistingPath(folder, path)) delete current[path];
      return current;
    });
  };
  let uploaded = 0;
  let bytes = 0;
  const here = new Set<string>();
  const skipped: string[] = [];
  // Oldest first: a set's copies go up before its later logs.
  for (const rel of walk(folder, folder, skipped).sort()) {
    here.add(rel);
    const local = safeExistingPath(folder, rel);
    if (!local || !statSync(local).isFile()) continue;
    const st = statSync(local);
    const mark = `${st.size}:${st.mtimeMs}`;
    if (done[rel] === mark) continue;
    await s3.put(s3.key(rel), local);
    uploaded++;
    bytes += st.size;
    save(rel, mark);
  }
  let removed = 0;
  const local = new Set([...here].map((r) => s3.key(r)));
  const protectedSets = skipped.map((entry) => s3.key(entry.split(':', 1)[0]!) + '/');
  for (const o of await s3.list()) {
    const rel = s3.prefix ? o.key.slice(s3.prefix.length + 1) : o.key;
    // Only what this mirrors: sets (dated folders) under the prefix.
    if (!/^\d{4}-\d{2}-\d{2}_\d{6}\//.test(rel) || local.has(o.key) || protectedSets.some((prefix) => o.key.startsWith(prefix))) continue;
    // A second mirror may have uploaded a file created since our initial walk.
    if (safeExistingPath(folder, rel.split('/').join(sep))) continue;
    await s3.delete(o.key);
    removed++;
  }
  save();
  return { uploaded, removed, bytes, skipped };
}

/** Downloads the sets in the bucket into a folder, skipping files already there at the same size. */
export async function mirrorDown(s3: S3, folder: string): Promise<number> {
  mkdirSync(folder, { recursive: true });
  let n = 0;
  for (const o of await s3.list()) {
    const rel = s3.prefix ? o.key.slice(s3.prefix.length + 1) : o.key;
    if (!/^\d{4}-\d{2}-\d{2}_\d{6}\//.test(rel) || rel.includes('..')) continue;
    const file = safeWritePath(folder, rel);
    if (!file) continue;
    const existing = safeExistingPath(folder, rel);
    if (existing && statSync(existing).size === o.size) continue;
    await s3.get(o.key, file);
    n++;
  }
  return n;
}

export interface OffsiteSchedule {
  /** Mirrors now (after a backup), unless a mirror is already running; then once more after it. */
  run(): Promise<void>;
  last?: { at: number; ok: boolean; message: string };
  stop(): Promise<void>;
}

/** Mirrors the backup folder now and then: every `every` ms, and when asked (after each backup). */
export function scheduleOffsite(folder: string, s3: S3, opts: { every: number; log?: (m: string) => void }): OffsiteSchedule {
  const log = opts.log ?? (() => {});
  let running: Promise<void> | undefined;
  let again = false;
  const once = async () => {
    try {
      const r = await mirrorUp(folder, s3);
      schedule.last = { at: Date.now(), ok: true, message: `${r.uploaded} files up (${r.bytes} bytes), ${r.removed} removed${r.skipped.length ? `; ${r.skipped.join(', ')}` : ''}` };
      if (r.uploaded || r.removed || r.skipped.length) log(`off-site backup: ${schedule.last.message}`);
    } catch (e) {
      schedule.last = { at: Date.now(), ok: false, message: (e as Error).message };
      log(`off-site backup failed: ${(e as Error).message}`);
    }
  };
  const schedule: OffsiteSchedule = {
    run: () => {
      if (running) {
        again = true;
        return running;
      }
      running = (async () => {
        do {
          again = false;
          await once();
        } while (again);
      })().finally(() => {
        running = undefined;
      });
      return running;
    },
    stop: async () => {
      clearInterval(timer);
      await schedule.run();
    },
  };
  const timer = setInterval(() => void schedule.run(), opts.every);
  timer.unref();
  return schedule;
}
