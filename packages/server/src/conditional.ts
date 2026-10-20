// Pages and assets that are the same until the build changes (the web app, the guides, the admin page): sent
// with an ETag, and answered 304 with no body when the browser already has that version. `no-cache` stays, so the
// browser still asks each time, but an unchanged file costs a header, not a download.

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** True when an If-None-Match header names this ETag (or is `*`); weak comparison, as GET and HEAD use. */
export function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  const bare = (t: string) => t.trim().replace(/^W\//, '');
  return (Array.isArray(header) ? header.join(',') : header).split(',').some((t) => t.trim() === '*' || bare(t) === bare(etag));
}

/** Sends `body` with its ETag, or a 304 when the request's If-None-Match already has it. */
export function sendConditional(req: IncomingMessage, res: ServerResponse, headers: Record<string, string>, body: string | Buffer): void {
  const etag = `"${createHash('sha1').update(body).digest('base64url')}"`;
  if (etagMatches(req.headers['if-none-match'], etag)) {
    // A 304 repeats the headers a cache keeps (not the content ones).
    const { 'content-type': _type, 'content-length': _length, ...kept } = headers;
    res.writeHead(304, { ...kept, etag }).end();
    return;
  }
  res.writeHead(200, { ...headers, etag }).end(body);
}
