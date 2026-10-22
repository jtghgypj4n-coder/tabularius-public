import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveCluster } from '../src/index.ts';
import { RawClient, request, stubCommands } from './edge-test-helpers.ts';

test('64 slow clients on worker zero do not consume a shared Unix-peer address allowance', { timeout: 45000 }, async t => {
  stubCommands(t);
  const dir = mkdtempSync(join(tmpdir(), 'edge-cluster-'));
  const app = await serveCluster({ dir, port: 0, hostname: '127.0.0.1', log: () => {},
    proxyHeader: 'x-forwarded-for', trustedProxies: ['127.0.0.1'], requestLimit: 256, requestQueue: 256,
  }, 2);
  const held: RawClient[] = [];
  t.after(async () => {
    held.forEach(c => c.socket.destroy());
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const port = Number(new URL(app.url).port);
  // Public OAuth registration is pinned to worker 0 and waits for its bounded JSON envelope.
  for (let i = 0; i < 64; i++) {
    const c = await new RawClient(port).ready();
    held.push(c);
    c.send(request('/oauth/register', 'X-Forwarded-For: 192.0.2.1\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n', 'POST') + '{');
  }
  const call = async (address: string) => {
    const c = await new RawClient(port).ready();
    return c.send(request('/oauth/register', `X-Forwarded-For: ${address}\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n`, 'POST') + '{}').end();
  };
  assert.match(await call('192.0.2.1'), /^HTTP\/1.1 429 /, 'the real client is capped at the front');
  assert.match(await call('192.0.2.2'), /^HTTP\/1.1 400 /, 'another client reaches worker 0 and gets normal validation');
  assert.ok(held.every(c => !c.socket.destroyed && c.text === ''), 'all 64 slow bodies are still held');
  held[0].socket.destroy();
  await held[0].closed;
  await call('192.0.2.2');
  // The front learns of the disconnect on its own turn; on a busy machine that is a moment after the client sees it close.
  // The slot has to come back, but not within one particular request.
  const until = Date.now() + 10_000;
  let answer = await call('192.0.2.1');
  while (/^HTTP\/1.1 429 /.test(answer) && Date.now() < until) { await new Promise(r => setTimeout(r, 100)); answer = await call('192.0.2.1'); }
  assert.match(answer, /^HTTP\/1.1 400 /, 'disconnect returns the front slot');
});

test('cluster keep-alive survives both front and worker request budgets without 503 or lost bodies', { timeout: 45000 }, async t => {
  stubCommands(t);
  const dir = mkdtempSync(join(tmpdir(), 'edge-cluster-budget-'));
  const app = await serveCluster({ dir, port: 0, hostname: '127.0.0.1', log: () => {} }, 2);
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  t.after(async () => { agent.destroy(); await app.close(); rmSync(dir, { recursive: true, force: true }); });
  for (let i = 0; i < 205; i++) {
    await new Promise<void>((resolve, reject) => {
      httpRequest(app.url + '/oauth/register', { agent, method: 'POST', headers: {
        'content-type': 'application/json', 'content-length': '2',
      } }, res => {
        let body = '';
        res.on('data', c => { body += c; });
        res.on('end', () => {
          try {
            assert.equal(res.statusCode, 400, `request ${i + 1}: ${body}`);
            assert.equal(JSON.parse(body).error, 'invalid_redirect_uri');
            resolve();
          } catch (e) { reject(e); }
        });
      }).on('error', reject).end('{}');
    });
  }
});

test('a request that says Connection: close still gets the worker\'s answer, never a 502 from a pipe the worker had already closed', { timeout: 45000 }, async t => {
  stubCommands(t);
  const dir = mkdtempSync(join(tmpdir(), 'edge-cluster-close-'));
  const app = await serveCluster({ dir, port: 0, hostname: '127.0.0.1', log: () => {} }, 2);
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const port = Number(new URL(app.url).port);
  // The client's Connection header is about its own hop. Passed on, it made the worker hang up as soon as it had
  // answered, which can be before the front has written the whole request.
  const answers = new Map<string, number>();
  for (let i = 0; i < 400; i++) {
    const c = await new RawClient(port).ready();
    const text = await c.send(request('/oauth/register', 'Content-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n', 'POST') + '{}').end();
    const status = text.split(' ')[1];
    answers.set(status, (answers.get(status) ?? 0) + 1);
  }
  assert.deepEqual([...answers], [['400', 400]]);
});
