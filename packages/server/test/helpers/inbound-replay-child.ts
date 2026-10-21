import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Host } from '../../src/host.ts';
import { InboundHooks, hookSignature } from '../../src/inbound-hooks.ts';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { dir, path, secret, stamp, body } = JSON.parse(input);
const host = new Host(dir, () => {});
try {
  const hooks = new InboundHooks(host, true);
  const req = Readable.from([Buffer.from(body)]) as IncomingMessage;
  Object.assign(req, { method: 'POST', socket: { remoteAddress: '127.0.0.1' }, headers: {
    'x-tabularius-timestamp': stamp, 'x-tabularius-signature': hookSignature(secret, stamp, body),
  } });
  let status = 0;
  const res = { writeHead: (n: number) => { status = n; }, end: () => {} } as unknown as ServerResponse;
  await hooks.handle(req, res, new URL(path, 'http://localhost'));
  process.stdout.write(String(status));
} finally {
  await host.close();
}
