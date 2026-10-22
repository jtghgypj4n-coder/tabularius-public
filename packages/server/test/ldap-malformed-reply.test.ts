// A directory (or someone on a plain ldap:// link) can send a reply whose lengths do not fit it. The client must
// refuse it at once with an error, not loop over billions of bytes that are not there or wait for them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { ldapAuthenticate } from '../src/ldap.ts';

async function against(reply: Buffer): Promise<{ error: string; ms: number; ticks: number }> {
  const srv = createServer((s) => {
    s.on('data', () => s.write(reply));
    s.on('error', () => {});
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = `ldap://127.0.0.1:${(srv.address() as { port: number }).port}`;
  let ticks = 0;
  const interval = setInterval(() => ticks++, 20);
  const t = performance.now();
  try {
    const error = await ldapAuthenticate({ name: 't', url, bindDnTemplate: 'uid={user},dc=x', timeout: 3 }, 'alice', 'pw').then(() => 'accepted', (e: Error) => e.message);
    return { error, ms: performance.now() - t, ticks };
  } finally {
    clearInterval(interval);
    srv.close();
  }
}

test('an integer whose length is larger than the reply is refused at once', async () => {
  // SEQUENCE { INTEGER of 0x10000000 bytes, [APPLICATION 1] }: the message id claims 256 MiB inside an 10-byte message.
  const r = await against(Buffer.from([0x30, 0x08, 0x02, 0x84, 0x10, 0x00, 0x00, 0x00, 0x61, 0x00]));
  assert.match(r.error, /^ldap: the reply has a length/);
  assert.ok(r.ms < 1500, `took ${r.ms} ms`);
});

test('a four-gigabyte length is refused at once too', async () => {
  const r = await against(Buffer.from([0x30, 0x08, 0x02, 0x84, 0xff, 0xff, 0xff, 0xff, 0x61, 0x00]));
  assert.match(r.error, /^ldap: the reply has a length/);
  assert.ok(r.ms < 1500, `took ${r.ms} ms`);
});

test('an integer too long to read, and a message too large to wait for, are refused', async () => {
  const long = await against(Buffer.from([0x30, 0x0d, 0x02, 0x09, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0x61, 0x00]));
  assert.match(long.error, /^ldap: the reply has an integer too long/);
  const big = await against(Buffer.from([0x30, 0x84, 0x7f, 0xff, 0xff, 0xff, 0x02, 0x01]));
  assert.match(big.error, /too large to read/);
});
