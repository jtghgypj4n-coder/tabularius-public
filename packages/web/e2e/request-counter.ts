// A pass-through in front of a hosted server that records what reaches it, for tests and measurements that need the
// real count: Chromium's own events don't say how its cache answered a request.
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Counted { status: number; path: string; bytes: number }
export interface RequestCounter { url: string; seen: Counted[]; close(): void }

export async function countRequests(target: string): Promise<RequestCounter> {
  const seen: Counted[] = [];
  const upstream = new URL(target);
  const server = createServer((req, res) => {
    const forward = request({ host: upstream.hostname, port: upstream.port, method: req.method, path: req.url, headers: req.headers }, (back) => {
      res.writeHead(back.statusCode ?? 502, back.headers);
      let bytes = 0;
      back.on('data', (chunk: Buffer) => { bytes += chunk.length; });
      back.on('end', () => { seen.push({ status: back.statusCode ?? 0, path: req.url ?? '', bytes }); });
      back.pipe(res);
    });
    forward.on('error', () => res.writeHead(502).end());
    req.pipe(forward);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => server.close() };
}
