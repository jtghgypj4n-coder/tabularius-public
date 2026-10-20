// Requests made under the old product name (openhbam) keep working: the /openhbam/... paths and the x-openhbam-*
// headers are read as /tabularius/... and x-tabularius-*, and the old admin cookie is still honoured.
import type { IncomingMessage } from 'node:http';

/** Set by the front process of a cluster, never by a client (the old spelling of these is not read). */
const NOT_ALIASED = new Set(['x-openhbam-peer', 'x-openhbam-tls']);

export function legacyRequest(req: IncomingMessage): void {
  const url = req.url ?? '';
  if (url === '/openhbam' || url.startsWith('/openhbam/') || url.startsWith('/openhbam?')) req.url = '/tabularius' + url.slice('/openhbam'.length);
  for (const [name, value] of Object.entries(req.headers)) {
    if (!name.startsWith('x-openhbam-') || NOT_ALIASED.has(name)) continue;
    const next = 'x-tabularius-' + name.slice('x-openhbam-'.length);
    if (req.headers[next] === undefined) req.headers[next] = value;
  }
}
