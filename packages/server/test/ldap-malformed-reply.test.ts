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

test('an indefinite length, and one of more than four bytes, are refused as soon as they are read', async () => {
  const indefinite = await against(Buffer.from([0x30, 0x80, 0x02, 0x01, 0x01]));
  assert.match(indefinite.error, /^ldap: the reply has a length LDAP does not use/);
  assert.ok(indefinite.ms < 1500, `took ${indefinite.ms} ms`);
  const wide = await against(Buffer.from([0x30, 0x85, 0x01, 0x00, 0x00, 0x00, 0x00, 0x02, 0x01]));
  assert.match(wide.error, /^ldap: the reply has a length LDAP does not use/);
  assert.ok(wide.ms < 1500, `took ${wide.ms} ms`);
});

// A search asks for one entry (sizeLimit 1), but a directory (or someone on a plain ldap:// link) can answer with as many
// as it likes. Only the first is used, so the rest must not be kept until the search is done.
test('entries after the first are not kept: 60 entries of 4 MiB do not grow the process by a quarter of a gigabyte', async () => {
  const ber = (tag: number, body: Buffer) => {
    const n = body.length;
    const len = n < 0x80 ? Buffer.from([n]) : n < 0x10000 ? Buffer.from([0x82, n >> 8, n & 255]) : Buffer.from([0x84, n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
    return Buffer.concat([Buffer.from([tag]), len, body]);
  };
  const id = (n: number) => ber(0x02, Buffer.from([n]));
  const text = (s: Buffer | string) => ber(0x04, Buffer.from(s));
  const done = (tag: number, n: number) => ber(0x30, Buffer.concat([id(n), ber(tag, Buffer.concat([ber(0x0a, Buffer.from([0])), text(''), text('')]))]));
  const big = ber(0x30, Buffer.concat([id(2), ber(0x64, Buffer.concat([text('uid=x'), ber(0x30, ber(0x30, Buffer.concat([text('mail'), ber(0x31, text('a'.repeat(4 * 1024 * 1024)))])))]))]));
  const srv = createServer((s) => {
    let step = 0;
    s.on('error', () => {});
    s.on('data', () => {
      step++;
      if (step === 1) s.write(done(0x61, 1)); // the bind
      else if (step === 2) {
        for (let i = 0; i < 60; i++) s.write(big);
        s.write(done(0x65, 2));
      }
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = `ldap://127.0.0.1:${(srv.address() as { port: number }).port}`;
  let peak = 0;
  const watch = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 10);
  const before = process.memoryUsage().heapUsed;
  try {
    await ldapAuthenticate({ name: 't', url, baseDn: 'dc=x', timeout: 20 }, 'alice', 'pw').catch(() => undefined);
    peak = Math.max(peak, process.memoryUsage().heapUsed);
  } finally {
    clearInterval(watch);
    srv.close();
  }
  assert.ok(peak - before < 100 * 1024 * 1024, `the heap grew by ${Math.round((peak - before) / 1048576)} MiB`);
});
