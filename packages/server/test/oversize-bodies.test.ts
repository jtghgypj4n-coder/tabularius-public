import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request, type Server } from 'node:http';
import { createStore } from '../../store/src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { serve } from '../src/index.ts';

// A request body that is far too large, or is not what the route reads, on every family of network route that takes
// one: no sign-in is needed to send it, so none may answer 5xx, leave a stack trace in the log, or take the server down.
// (An 11 MB body to the Data API's sign-in used to answer 500; one to the admin console's own calls took the whole
// server down, because the request log read the address of a connection that had been destroyed.)

let dir: string;
let server: Server;
let base: string;
const logged: string[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-big-'));
  createStore(join(dir, 'Shop' + STORE_EXT));
  const s = await serve({ dir, port: 0, log: (m: string) => logged.push(m) });
  server = s.server;
  base = s.url;
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const ADMIN = { 'x-tabularius-admin': '1' };
const MCP = { accept: 'application/json, text/event-stream' };

const routes: { family: string; method: string; path: string; headers?: Record<string, string> }[] = [
  { family: 'Data API sign-in', method: 'POST', path: '/fmi/data/vLatest/databases/Shop/sessions' },
  { family: 'Data API passkey', method: 'POST', path: '/fmi/data/vLatest/databases/Shop/sessions/passkey' },
  { family: 'Data API validate', method: 'POST', path: '/fmi/data/vLatest/databases/Shop/layouts/Anything/_find' },
  { family: 'OData', method: 'POST', path: '/fmi/odata/v4/Shop/Anything' },
  { family: 'OData batch', method: 'POST', path: '/fmi/odata/v4/Shop/$batch' },
  { family: 'Admin console sign-in', method: 'POST', path: '/tabularius/admin/v1/sign-in', headers: ADMIN },
  { family: 'Admin console backup', method: 'POST', path: '/tabularius/admin/v1/backup', headers: ADMIN },
  { family: 'Admin API (FileMaker v2)', method: 'POST', path: '/fmi/admin/api/v2/user/auth' },
  { family: 'OAuth registration', method: 'POST', path: '/oauth/register' },
  { family: 'OAuth token', method: 'POST', path: '/oauth/token' },
  { family: 'MCP', method: 'POST', path: '/mcp', headers: MCP },
  { family: 'Web client', method: 'POST', path: '/tabularius/app/v1/databases/Shop/layouts/Anything/records' },
];

const bodies: { name: string; make: () => string }[] = [
  { name: 'oversize (20 MB)', make: () => '{"x":"' + 'a'.repeat(20 * 1024 * 1024) + '"}' },
  { name: 'not JSON', make: () => '{not json' },
  { name: 'a list', make: () => '[1]' },
  { name: 'null', make: () => 'null' },
];

type Answer = { status: number; headers: Record<string, string | string[] | undefined>; text: string; reset?: boolean };

/**
 * `sendOnce`, again when the socket is reset before any answer arrived: a loaded runner can deliver the server's refusal
 * after the reset, and the client then sees only EPIPE. A reset that repeats is the server closing a connection that
 * will not stop sending (its drain time ran out on a busy machine): reported as `reset`, not as a failure.
 */
async function send(method: string, path: string, headers: Record<string, string>, body: string): Promise<Answer> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await sendOnce(method, path, headers, body);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EPIPE' && code !== 'ECONNRESET') throw e;
      if (attempt >= 3) return { status: 0, headers: {}, text: '', reset: true };
    }
  }
}

/** The answer to a request, read as soon as it arrives (the server may close the connection while the rest of a big body is still being sent). */
function sendOnce(method: string, path: string, headers: Record<string, string>, body: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request(base + path, { method, headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) } }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(parts).toString('utf8') }));
      res.on('error', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(parts).toString('utf8') }));
    });
    let answered = false;
    req.on('response', () => (answered = true));
    // Once the answer is in, a reset of the upload is expected.
    req.on('error', (e) => void (answered || reject(e)));
    // The socket can report the reset after the request itself has settled (EPIPE on some platforms).
    req.on('socket', (socket) => socket.on('error', () => {}));
    req.end(body);
  });
}

for (const r of routes) {
  for (const b of bodies) {
    test(`${r.family}: ${b.name} is answered below 500, in JSON, with no stack trace in the log`, async () => {
      const before = logged.length;
      const form = r.path.startsWith('/oauth/token');
      const reply = await send(r.method, r.path, { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json', ...r.headers }, b.make());
      // A malformed body to a route where the body is optional is read as no body (200); an oversize one is always refused.
      const oversize = b.name.startsWith('oversize');
      if (reply.reset) {
        // Only an upload too big to finish can be cut off; the server must still be up and have logged no fault.
        assert.ok(oversize, `${r.family}: the connection was reset for a small body`);
        assert.doesNotMatch(logged.slice(before).join('\n'), /TypeError|\n\s+at /, 'a stack trace was logged');
        assert.equal((await fetch(`${base}/tabularius/admin/v1/sign-in-info`)).status, 200);
        return;
      }
      assert.ok(reply.status < 500 && (!oversize || reply.status >= 400), `${r.family}: ${reply.status} ${reply.text.slice(0, 200)}`);
      // (Refused before the body is read: 401, 403 or 406. OAuth's own error for a request too large is 400 invalid_request.)
      if (oversize && ![400, 401, 403, 406].includes(reply.status)) assert.equal(reply.status, 413, `${r.family}: ${reply.text.slice(0, 200)}`);
      if (reply.text) assert.doesNotThrow(() => JSON.parse(reply.text), `${r.family}: not JSON: ${reply.text.slice(0, 100)}`);
      assert.doesNotMatch(logged.slice(before).join('\n'), /TypeError|\n\s+at /, 'a stack trace was logged');
      // Still up.
      const alive = await fetch(`${base}/tabularius/admin/v1/sign-in-info`);
      assert.equal(alive.status, 200);
    });
  }
}
