import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEdgeServer } from '../src/edge-limits.ts';
import { StreamSlots } from '../src/stream-slots.ts';
import { listen, normal, RawClient, request, stubCommands } from './edge-test-helpers.ts';

test('SSE total/identity slots release on close, refusal, explicit failure and disconnect during setup', async t => {
  stubCommands(t);
  const slots = new StreamSlots(3, 2);
  let unblock: (() => void) | undefined;
  let reached: (() => void) | undefined;
  let afterDisconnect: boolean | undefined;
  const server = createEdgeServer(async (req, res) => {
    if (req.url === '/') { res.end('ok'); return; }
    if (req.url === '/wait') {
      reached?.();
      await new Promise<void>(resolve => { unblock = resolve; });
      const release = slots.enter('late', res);
      afterDisconnect = !!release;
      release?.();
      return;
    }
    const release = slots.enter(req.url!, res);
    if (!release) { res.writeHead(503).end(); return; }
    if (req.url === '/fail') { release(); release(); res.writeHead(500).end(); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders();
  });
  const port = await listen(t, server);
  const held: RawClient[] = [];
  t.after(() => { for (const c of held) c.socket.destroy(); });
  const open = async (path: string, status: number) => {
    const c = await new RawClient(port).ready(); held.push(c);
    c.send(request(path)); await c.until(text => text.includes('\r\n\r\n'));
    assert.match(c.text, new RegExp(`^HTTP/1.1 ${status} `));
    return c;
  };
  const a = await open('/a', 200);
  await open('/a', 200);
  await open('/a', 503);
  await open('/b', 200);
  await open('/c', 503);
  await normal(port);
  a.socket.destroy(); await a.closed; await normal(port);
  const fail = await open('/fail', 500); fail.socket.destroy();
  const replacement = await open('/c', 200);
  replacement.socket.destroy(); await replacement.closed; await normal(port);
  const arrived = new Promise<void>(resolve => { reached = resolve; });
  const late = await new RawClient(port).ready(); held.push(late); late.send(request('/wait'));
  await arrived;
  late.socket.destroy(); await late.closed; await normal(port);
  unblock!();
  await normal(port);
  assert.equal(afterDisconnect, false, 'an await cannot resurrect a closed subscriber');
  await open('/d', 200);
  await normal(port);
});
