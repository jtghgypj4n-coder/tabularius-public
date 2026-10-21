// Response compression (gzip or brotli, from node:zlib) for the text the server sends: JSON, HTML, JavaScript, CSS.
//
// Left alone: anything that is not text (containers, pictures, zips), streams that must arrive as they are made
// (event streams, newline-delimited JSON), range and cached-validation answers, and the sign-in and token answers.
// A compressed answer that holds a secret next to text the caller chose can be read back by size alone (BREACH), so
// the paths that hand out sessions and tokens are never compressed.
import { createGzip, createBrotliCompress, constants } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Transform } from 'node:stream';

const TEXT = /^(application\/(json|javascript|x-javascript|xml|manifest\+json)|text\/(html|css|plain|csv|xml|javascript)|image\/svg\+xml)\b/i;
/** Whether a content type is text the server compresses. */
export const compressible = (type: string): boolean => TEXT.test(type);
const SECRETS = /\/(sessions?|oauth|auth|tokens?|login|signin|authorize|callback|passkeys?|mcp)(\/|$)/i;
const MIN = 1024;

/** Which encoding the caller accepts, brotli first; undefined when neither (or when q=0 refuses it). */
export function chooseEncoding(accept: string | undefined): 'br' | 'gzip' | undefined {
  if (!accept) return undefined;
  const q = new Map<string, number>();
  for (const part of accept.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    const given = params.map((p) => /^\s*q\s*=\s*([\d.]+)/.exec(p)?.[1]).find((v) => v !== undefined);
    if (name) q.set(name.trim(), given === undefined ? 1 : Number(given));
  }
  const ok = (n: string) => (q.get(n) ?? q.get('*') ?? 0) > 0;
  return ok('br') ? 'br' : ok('gzip') ? 'gzip' : undefined;
}

/** Wraps one response so a text answer is compressed on its way out. Call before anything is written. */
export function compressResponse(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  if (req.method === 'HEAD' || SECRETS.test(pathname)) return;
  const encoding = chooseEncoding(req.headers['accept-encoding'] as string | undefined);
  if (!encoding) return;
  const writeHead = res.writeHead.bind(res) as (...a: unknown[]) => ServerResponse;
  const write = res.write.bind(res) as (...a: unknown[]) => boolean;
  const end = res.end.bind(res) as (...a: unknown[]) => ServerResponse;
  let stream: Transform | undefined;
  let decided = false;
  let responseBackedUp = false;
  let responseClosed = false;
  let pendingOutput = 0;
  type WriteCallback = { call: (error?: Error | null) => void };
  const pendingCallbacks: WriteCallback[] = [];
  const inflightCallbacks = new Set<WriteCallback>();
  const flushCallbacks = (error?: Error) => {
    if (!error && pendingOutput) return;
    const callbacks = error ? [...inflightCallbacks] : pendingCallbacks.splice(0);
    if (error) pendingCallbacks.length = 0;
    for (const cb of callbacks) {
      inflightCallbacks.delete(cb);
      cb.call(error);
    }
  };
  const onDrain = () => {
    responseBackedUp = false;
    stream?.resume();
  };

  const decide = (status: number, given: Record<string, unknown>): Record<string, unknown> => {
    decided = true;
    const all: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(res.getHeaders())) all[k.toLowerCase()] = v;
    for (const [k, v] of Object.entries(given)) all[k.toLowerCase()] = v;
    const type = String(all['content-type'] ?? '');
    const length = all['content-length'] === undefined ? undefined : Number(all['content-length']);
    const skip = status < 200 || status === 204 || status === 205 || status === 206 || status === 304
      || !TEXT.test(type)
      || all['content-encoding'] !== undefined || all['content-range'] !== undefined || all['set-cookie'] !== undefined
      || /no-transform/i.test(String(all['cache-control'] ?? ''))
      || (length !== undefined && length < MIN);
    if (skip) return given;
    const out = { ...given };
    for (const k of Object.keys(out)) if (k.toLowerCase() === 'content-length') delete out[k];
    res.removeHeader('content-length');
    out['content-encoding'] = encoding;
    const vary = String(all['vary'] ?? '');
    if (!/accept-encoding|\*/i.test(vary)) out['vary'] = vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding';
    stream = encoding === 'br'
      ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
      : createGzip();
    res.on('drain', onDrain);
    res.once('close', () => {
      responseClosed = true;
      res.off('drain', onDrain);
      stream?.destroy();
      flushCallbacks(new Error('response closed'));
    });
    stream.on('data', (chunk: Buffer) => {
      pendingOutput++;
      const ready = write(chunk, (error?: Error) => {
        pendingOutput--;
        flushCallbacks(error);
      });
      if (!ready) {
        responseBackedUp = true;
        stream?.pause();
      }
    });
    stream.on('drain', () => { if (!responseBackedUp) res.emit('drain'); });
    stream.on('end', () => { res.off('drain', onDrain); end(); });
    stream.on('error', (error) => { flushCallbacks(error); res.destroy(error); });
    return out;
  };

  res.writeHead = ((status: number, ...args: unknown[]) => {
    const given = args.find((x) => typeof x === 'object' && x !== null);
    if (decided || Array.isArray(given)) {
      decided = true;
      return writeHead(status, ...args);
    }
    const headers = decide(status, (given ?? {}) as Record<string, unknown>);
    return writeHead(status, ...args.filter((x) => typeof x === 'string'), headers);
  }) as typeof res.writeHead;

  const begin = () => { if (!decided) res.writeHead(res.statusCode); };
  res.write = ((chunk: unknown, ...rest: unknown[]) => {
    begin();
    if (!stream) return write(chunk, ...rest);
    const enc = (typeof rest[0] === 'string' ? rest[0] : 'utf8') as BufferEncoding;
    const cb = rest.find((r) => typeof r === 'function') as ((error?: Error | null) => void) | undefined;
    const callback = cb && { call: cb };
    if (callback) inflightCallbacks.add(callback);
    return stream.write(chunk as Buffer | string, enc, (error?: Error | null) => {
      if (callback && inflightCallbacks.has(callback)) {
        if (responseClosed) flushCallbacks(error ?? new Error('response closed'));
        else { pendingCallbacks.push(callback); flushCallbacks(error ?? undefined); }
      }
    }) && !responseBackedUp;
  }) as typeof res.write;
  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if (typeof chunk === 'function') { rest = [chunk]; chunk = undefined; }
    begin();
    if (!stream) return end(chunk, ...rest);
    const enc = typeof rest[0] === 'string' ? (rest[0] as BufferEncoding) : undefined;
    const cb = rest.find((r) => typeof r === 'function') as (() => void) | undefined;
    if (cb) res.once('finish', cb);
    if (chunk !== undefined && chunk !== null && chunk !== '') stream.end(chunk as Buffer | string, (enc ?? 'utf8') as BufferEncoding);
    else stream.end();
    return res;
  }) as typeof res.end;
}
