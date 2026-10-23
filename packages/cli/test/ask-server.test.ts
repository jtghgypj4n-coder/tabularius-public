import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Socket } from 'node:net';
import { askServer } from '../src/ask-server.ts';

const folder = mkdtempSync(join(tmpdir(), 'tabularius-ask-server-'));
const sockets = new Set<Socket>();
let server: Server;

before(async () => {
  server = createServer((_req, res) => {
    if (_req.url === '/drop') {
      res.writeHead(200, { 'content-length': 1000 });
      res.write('{"ok":');
      setImmediate(() => res.socket?.destroy());
    } else if (_req.url === '/silent') {
      // Keep the connection open without an answer until the caller's optional timeout.
    } else if (_req.url === '/stall') {
      res.writeHead(200, { 'content-length': 1000 });
      res.write('{"ok":');
    } else {
      res.writeHead(207, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  writeFileSync(join(folder, '.openhbam.local'), JSON.stringify({ pid: process.pid, url, token: ['local', 'access'].join('-') }));
});

after(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(folder, { recursive: true, force: true });
});

async function within<T>(answer: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([answer, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('askServer did not settle within 2 seconds')), 2000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

test('a response cut off after headers rejects promptly', async () => {
  await assert.rejects(within(askServer(folder, 'GET', '/drop')), /closed the connection before it finished answering/);
});

test('a complete JSON response keeps its status and body', async () => {
  assert.deepEqual(await within(askServer(folder, 'GET', '/normal')), { status: 207, body: { ok: true } });
});

test('an optional timeout rejects when the server sends no answer', async () => {
  await assert.rejects(within(askServer(folder, 'GET', '/silent', undefined, { timeoutMs: 50 })), /did not answer within 50 ms/);
});

test('an optional timeout also identifies a stalled answer', async () => {
  await assert.rejects(within(askServer(folder, 'GET', '/stall', undefined, { timeoutMs: 50 })), /did not answer within 50 ms/);
});
