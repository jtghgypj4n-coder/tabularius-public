// An HTTPS port that also answers plain http: requests, sending them on to
// https:// at the same address. Bookmarks made before HTTPS was turned on keep
// working, and nobody types a password into an http page by mistake.
// The first byte tells them apart: a TLS connection starts with a handshake
// record (22).

import { createEdgeServer, edgeAdmission, type EdgeLimits, type EdgeProxyOptions } from './edge-limits.ts';
import type { Server as TlsServer } from 'node:tls';
import type { Socket } from 'node:net';

/**
 * Where a plain-http request goes: the same address over https. The Host header is whatever the client sent, so only a
 * host name (or an IP address) with an optional port is followed; anything else, such as `evil.example#`, `a?b` or
 * `x:y`, is refused rather than echoed into a Location header. (Which names are this server's own is not checked: a
 * server is often reached by an address its certificate doesn't name.)
 */
export function plainRedirectTarget(host: string | undefined, url: string | undefined): string | undefined {
  if (!host || !/^(?:[a-z0-9](?:[a-z0-9._-]{0,251}[a-z0-9])?|\[[0-9a-f:.]{2,45}\])(?::\d{1,5})?$/i.test(host)) return undefined;
  return `https://${host}${url?.startsWith('/') ? url : '/'}`;
}

export function redirectPlainHttp(server: TlsServer, limits?: Partial<EdgeLimits>, proxy?: EdgeProxyOptions): void {
  const admission = edgeAdmission(server);
  const tlsListeners = server.listeners('connection').filter(l => l !== admission) as ((s: Socket) => void)[];
  server.removeAllListeners('connection');
  if (admission) server.on('connection', admission);
  const plain = createEdgeServer((req, res) => {
    const to = plainRedirectTarget(req.headers.host, req.url);
    if (!to) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Use https:// for this server.');
      return;
    }
    res.writeHead(308, { location: to, 'content-type': 'text/plain; charset=utf-8' }).end('This server uses https.');
  }, { ...limits, idleMs: 1000 }, undefined, proxy);
  // This HTTP server receives sockets from the shared listener instead of binding a port itself.
  // Node starts its header/request deadline tracker on 'listening', including for these handed-off sockets.
  plain.emit('listening');
  server.on('close', () => plain.close());
  server.on('connection', (socket: Socket) => {
    if (socket.destroyed) return;
    const timer = setTimeout(() => socket.destroy(), limits?.headersMs ?? 10_000).unref();
    socket.once('close', () => clearTimeout(timer));
    const route = () => {
      const first = socket.read(1) as Buffer | null;
      if (first === null) return socket.once('readable', route);
      clearTimeout(timer);
      socket.unshift(first);
      if (first[0] === 22) for (const l of tlsListeners) l.call(server, socket);
      else plain.emit('connection', socket);
    };
    route();
  });
}
