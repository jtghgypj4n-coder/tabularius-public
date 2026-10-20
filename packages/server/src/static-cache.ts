// The files the server sends unchanged until the build does (the admin page, the web app's scripts, styles and pages):
// read once, with their ETag and their compressed forms, and read again only when the file's modification time, size
// or inode says it changed. Without this, every request read the file, hashed it for the ETag before looking at
// If-None-Match, and compressed it again.

import { createHash } from 'node:crypto';
import { stat, readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { chooseEncoding, compressible } from './compression.ts';
import { etagMatches } from './conditional.ts';

const MIN = 1024;
const brotli = promisify(brotliCompress);
const gzipped = promisify(gzip);

/** A file as it is sent: its bytes (after any transform), its ETag, and a compressed form once one is asked for. */
export class Asset {
  readonly body: Buffer;
  readonly etag: string;
  private readonly encoded = new Map<'br' | 'gzip', Promise<Buffer>>();

  constructor(body: Buffer) {
    this.body = body;
    this.etag = `"${createHash('sha1').update(body).digest('base64url')}"`;
  }

  /** The body compressed, made once. */
  encode(how: 'br' | 'gzip'): Promise<Buffer> {
    let made = this.encoded.get(how);
    if (!made) {
      made = how === 'br' ? brotli(this.body, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }) : gzipped(this.body);
      this.encoded.set(how, made);
    }
    return made;
  }
}

const cache = new Map<string, { stamp: string; asset: Asset }>();

/**
 * The file as an Asset: the same one while the file is unchanged. `make` turns the bytes into what is sent (type
 * stripping for a script); it runs again only when the file changed. Throws when the file can't be read.
 */
export async function loadAsset(path: string, make?: (bytes: Buffer) => Buffer | string): Promise<Asset> {
  const st = await stat(path);
  const stamp = `${st.mtimeMs}:${st.size}:${st.ino}`;
  const held = cache.get(path);
  if (held?.stamp === stamp) return held.asset;
  const bytes = await readFile(path);
  const made = make ? make(bytes) : bytes;
  const asset = new Asset(typeof made === 'string' ? Buffer.from(made) : made);
  // A file read while it was being written has a later stamp next time; the stamp taken before the read is the safe one.
  cache.set(path, { stamp, asset });
  return asset;
}

/** Sends an Asset with its ETag: a 304 when the browser already has it, else the bytes, compressed if it accepts that. */
export async function sendAsset(req: IncomingMessage, res: ServerResponse, headers: Record<string, string>, asset: Asset): Promise<void> {
  if (etagMatches(req.headers['if-none-match'], asset.etag)) {
    // A 304 repeats the headers a cache keeps (not the content ones).
    const { 'content-type': _type, 'content-length': _length, ...kept } = headers;
    res.writeHead(304, { ...kept, etag: asset.etag }).end();
    return;
  }
  const how = req.method !== 'HEAD' && asset.body.length >= MIN && compressible(headers['content-type'] ?? '')
    ? chooseEncoding(req.headers['accept-encoding'] as string | undefined)
    : undefined;
  if (!how) {
    res.writeHead(200, { ...headers, etag: asset.etag }).end(asset.body);
    return;
  }
  const body = await asset.encode(how);
  res.writeHead(200, { ...headers, etag: asset.etag, 'content-encoding': how, vary: 'Accept-Encoding' }).end(body);
}
