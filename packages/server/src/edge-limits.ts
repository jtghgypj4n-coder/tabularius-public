import { addressBucket } from '../../store/src/client-ip.ts';
// Transport budgets apply independently of authentication. Route readers retain their own body caps.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createTlsServer, type ServerOptions as TlsOptions } from 'node:https';
import type { BlockList, Socket } from 'node:net';
import { performance } from 'node:perf_hooks';
import { closeUnreadBody, continueOnRead } from './request-body.ts';
import { forwardedFor, trustedProxyPeer, type ProxyHeader } from './client-address.ts';

export const EDGE_LIMITS = Object.freeze({
  headerBytes: 16 * 1024,
  headerCount: 100,
  // An 8 KiB decoded JSON query can take 24 KiB after percent encoding, plus the route.
  requestLineBytes: 32 * 1024,
  headersMs: 10_000,
  // Body inactivity, not a total upload deadline: progressing authenticated uploads may take longer.
  bodyMs: 300_000,
  idleMs: 5_000,
  checkMs: 1_000,
  connections: 1024,
  connectionsPerAddress: 64,
  requestsPerSocket: 100,
});
export type EdgeLimits = { [K in keyof typeof EDGE_LIMITS]: number };
export interface EdgeProxyOptions { proxyHeader?: ProxyHeader; trustedProxies?: BlockList }
const admissions = new WeakMap<object, (socket: Socket) => void>();
/** Keep admission in front of the same-port TLS/plain protocol selector. */
export const edgeAdmission = (server: object) => admissions.get(server);

/** Also used by the cluster front, ACME listener and same-port HTTP redirect. Tests inject short deadlines. */
export function createEdgeServer(
  handler: (req: IncomingMessage, res: ServerResponse) => unknown,
  options: Partial<EdgeLimits> = {}, tls?: TlsOptions, proxy: EdgeProxyOptions = {},
): Server {
  const limits = { ...EDGE_LIMITS, ...options };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid HTTP edge limit: ${name}`);
  }
  const addresses = new Map<string, number>();
  const claimAddress = (address: string): (() => void) | undefined => {
    address = addressBucket(address);
    const count = addresses.get(address) ?? 0;
    if (count >= limits.connectionsPerAddress) return;
    addresses.set(address, count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (addresses.get(address) ?? 1) - 1;
      if (remaining) addresses.set(address, remaining);
      else addresses.delete(address);
    };
  };
  const proxied = (socket: Socket) => !!proxy.proxyHeader && trustedProxyPeer(socket, proxy.trustedProxies);
  type Pending = { req: IncomingMessage; res: ServerResponse; last: boolean };
  type Connection = { accepted: number; queue: Pending[]; active?: ServerResponse };
  const connections = new WeakMap<Socket, Connection>();
  const run = (state: Connection, { req, res, last }: Pending) => {
    if (req.socket.destroyed || res.destroyed) return;
    state.active = res;
    closeUnreadBody(req, res);
    // Node's maxRequestsPerSocket emits 503 for already-pipelined surplus requests. Instead finish
    // the last accepted response and close normally; no later operation is dispatched or committed.
    if (last) {
      const writeHead = res.writeHead;
      res.writeHead = function (this: ServerResponse, ...args: Parameters<ServerResponse['writeHead']>) {
        const values: unknown[] = [...args];
        const at = typeof values[1] === 'string' ? 2 : 1;
        const headers = values[at];
        const hop = (name: string) => ['connection', 'keep-alive'].includes(name.toLowerCase());
        if (Array.isArray(headers)) {
          const kept: unknown[] = [];
          for (let i = 0; i < headers.length; i += 2) if (!hop(String(headers[i]))) kept.push(headers[i], headers[i + 1]);
          values[at] = kept;
        } else if (headers && typeof headers === 'object') {
          values[at] = Object.fromEntries(Object.entries(headers).filter(([name]) => !hop(name)));
        }
        // Explicit route headers (including SSE) must not advertise reuse of the final socket.
        this.removeHeader('keep-alive');
        this.setHeader('connection', 'close');
        this.shouldKeepAlive = false;
        return writeHead.apply(this, values as Parameters<ServerResponse['writeHead']>);
      } as ServerResponse['writeHead'];
    }
    const release = () => {
      if (state.active === res) state.active = undefined;
      if (res.shouldKeepAlive && !req.socket.destroyed && !res.destroyed) {
        const next = state.queue.shift();
        if (next) run(state, next);
      } else state.queue.length = 0;
    };
    res.once('finish', release);
    res.once('close', () => { if (!res.writableFinished) state.queue.length = 0; });
    const refuse = (status: number) => res.writeHead(status, { connection: 'close', 'content-length': '0' }).end();
    // Proxy connections can serve different visitors over time. Count their current visitor only
    // while its response is outstanding, and never put all proxy connections in one peer bucket.
    if (proxied(req.socket)) {
      const address = forwardedFor(req, proxy.proxyHeader, proxy.trustedProxies);
      if (address) {
        const free = claimAddress(address);
        if (!free) { refuse(429); return; }
        res.prependOnceListener('finish', free);
        res.once('close', free);
      }
    }
    if (req.rawHeaders.length / 2 > limits.headerCount) { refuse(431); return; }
    const headerBytes = req.rawHeaders.reduce((n, h) => n + Buffer.byteLength(h, 'latin1'), 2) + req.rawHeaders.length * 2;
    if (headerBytes > limits.headerBytes) { refuse(431); return; }
    const lineBytes = Buffer.byteLength(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`, 'latin1');
    if (lineBytes > limits.requestLineBytes) { refuse(414); return; }
    if (req.headers['content-encoding'] && req.headers['content-encoding'].trim().toLowerCase() !== 'identity') { refuse(415); return; }
    if (req.headers.expect?.toLowerCase() === '100-continue') continueOnRead(req, res);
    // Observe wire progress without attaching a data listener (which would consume before auth).
    if (!req.complete) {
      let bytes = req.socket.bytesRead;
      let progress = performance.now();
      const timer = setInterval(() => {
        if (req.complete) { cleanup(); return; }
        if (req.socket.bytesRead !== bytes) { bytes = req.socket.bytesRead; progress = performance.now(); }
        else if (performance.now() - progress >= limits.bodyMs) {
          cleanup();
          if (!res.headersSent) refuse(408);
          else req.socket.destroy();
        }
      }, Math.min(limits.checkMs, limits.bodyMs)).unref();
      const cleanup = () => {
        clearInterval(timer);
        req.off('end', cleanup);
        res.off('finish', cleanup);
        res.off('close', cleanup);
      };
      req.once('end', cleanup);
      res.once('finish', cleanup);
      res.once('close', cleanup);
    }
    const failed = () => {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) { res.destroy(); return; }
      // Discard any unfinished response metadata before producing the bounded error.
      for (const name of res.getHeaderNames()) res.removeHeader(name);
      refuse(500);
    };
    try { Promise.resolve(handler(req, res)).catch(failed); }
    catch { failed(); }
  };
  const dispatch = (req: IncomingMessage, res: ServerResponse) => {
    if (req.socket.destroyed || res.destroyed) return;
    let state = connections.get(req.socket);
    if (!state) {
      state = { accepted: 0, queue: [] };
      connections.set(req.socket, state);
      req.socket.once('close', () => { state!.queue.length = 0; });
    }
    if (state.accepted >= limits.requestsPerSocket) {
      // Do not let an open stream accumulate unlimited surplus HTTP response objects. Earlier
      // accepted bodies have already been framed before this pipelined request can arrive.
      req.socket.pause();
      return;
    }
    const pending = { req, res, last: ++state.accepted === limits.requestsPerSocket };
    // Bound queued application work by the socket's request budget; Node orders the wire responses.
    if (state.active && !state.active.writableFinished) state.queue.push(pending);
    else run(state, pending);
  };
  const httpOptions = {
    maxHeaderSize: limits.headerBytes + limits.requestLineBytes, headersTimeout: limits.headersMs,
    requestTimeout: 0, connectionsCheckingInterval: limits.checkMs,
    keepAliveTimeout: limits.idleMs,
  };
  const server: Server = tls
    ? createTlsServer({ ...tls, ...httpOptions, handshakeTimeout: limits.headersMs }, dispatch)
    : createServer(httpOptions, dispatch);
  server.maxHeadersCount = limits.headerCount + 1;
  // Newer Node versions add a default grace period; keep this public limit exact across supported Node 22s.
  (server as Server & { keepAliveTimeoutBuffer: number }).keepAliveTimeoutBuffer = 0;
  server.on('checkContinue', dispatch);
  server.on('checkExpectation', (req, res) => {
    closeUnreadBody(req, res);
    res.writeHead(417, { connection: 'close', 'content-length': '0' }).end();
  });
  const unsupported = (_req: IncomingMessage, socket: Socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    socket.setTimeout(limits.idleMs, () => socket.destroy());
  };
  server.on('upgrade', unsupported);
  server.on('connect', unsupported);
  server.on('clientError', (error: NodeJS.ErrnoException, socket: Socket) => {
    // A socket destroyed with an application error may carry a numeric code; only a string is a Node parser code.
    const code = typeof error.code === 'string' ? error.code : '';
    const status = code === 'HPE_HEADER_OVERFLOW' ? '431 Request Header Fields Too Large'
      : code === 'ERR_HTTP_REQUEST_TIMEOUT' ? '408 Request Timeout'
      : code.startsWith('HPE_') ? '400 Bad Request' : undefined;
    if (!status || !socket.writable || connections.get(socket)?.active?.headersSent) { socket.destroy(); return; }
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy());
  });
  let total = 0;
  const admit = (socket: Socket) => {
    if (socket.destroyed) return;
    if (total >= limits.connections) { socket.destroy(); return; }
    // Unix sockets are the cluster front's private worker transport, not a client address.
    const address = socket.remoteAddress?.split('%')[0];
    const free = address && !proxied(socket) ? claimAddress(address) : undefined;
    if (address && !proxied(socket) && !free) { socket.destroy(); return; }
    total++;
    socket.once('close', () => { total--; free?.(); });
  };
  admissions.set(server, admit);
  server.prependListener('connection', admit);
  return server;
}
