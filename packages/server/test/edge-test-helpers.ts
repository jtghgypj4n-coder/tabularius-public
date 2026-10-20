import assert from 'node:assert/strict';
import { connect, type Socket } from 'node:net';
import type { Server } from 'node:http';
import type { TestContext } from 'node:test';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** No test starts a command, but keep accidental service/tool calls from escaping the in-process harness. */
export function stubCommands(t: TestContext): void {
  const dir = mkdtempSync(join(tmpdir(), 'edge-command-stubs-'));
  const marker = join(dir, 'called');
  const oldPath = process.env.PATH;
  for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(dir, name), `#!/bin/sh\nprintf called > '${marker}'\nexit 99\n`, { mode: 0o700 });
  }
  process.env.PATH = dir;
  t.after(() => {
    process.env.PATH = oldPath;
    const called = existsSync(marker);
    rmSync(dir, { recursive: true, force: true });
    assert.equal(called, false, 'no stubbed command may run');
  });
}

export async function listen(t: TestContext, server: Server): Promise<number> {
  const sockets = new Set<Socket>();
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}

export class RawClient {
  readonly socket: Socket;
  text = '';
  readonly closed: Promise<void>;
  constructor(port: number, socket?: Socket) {
    this.socket = socket ?? connect(port, '127.0.0.1');
    this.socket.on('error', () => {}); // resets are an expected refusal
    this.socket.on('data', chunk => { this.text += chunk.toString('utf8'); });
    this.closed = new Promise(resolve => this.socket.once('close', () => resolve()));
  }
  async ready(): Promise<this> {
    await new Promise<void>((resolve, reject) => { this.socket.once('connect', resolve); this.socket.once('error', reject); });
    return this;
  }
  send(text: string | Buffer): this { this.socket.write(text); return this; }
  async until(predicate: (text: string) => boolean): Promise<string> {
    if (predicate(this.text)) return this.text;
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.socket.off('data', check); this.socket.off('close', ended); };
      const check = () => { if (predicate(this.text)) { cleanup(); resolve(this.text); } };
      const ended = () => { cleanup(); reject(new Error(`Closed before expected response: ${this.text}`)); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`No response within 3 s: ${this.text}`)); }, 3000);
      this.socket.on('data', check);
      this.socket.once('close', ended);
    });
  }
  async end(): Promise<string> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([this.closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Connection not closed within 3 s')), 3000); })]);
      return this.text;
    } finally { clearTimeout(timer); this.socket.destroy(); }
  }
}
export const request = (path = '/', headers = '', method = 'GET') => `${method} ${path} HTTP/1.1\r\nHost: localhost\r\n${headers}\r\n`;
export function responseBody(text: string): string {
  const split = text.indexOf('\r\n\r\n');
  const body = Buffer.from(text.slice(split + 4));
  if (!/transfer-encoding: chunked/i.test(text.slice(0, split))) return body.toString();
  const chunks: Buffer[] = [];
  for (let at = 0; at < body.length;) {
    const end = body.indexOf('\r\n', at);
    const size = Number.parseInt(body.toString('ascii', at, end), 16);
    if (!size) break;
    chunks.push(body.subarray(end + 2, end + 2 + size));
    at = end + 2 + size + 2;
  }
  return Buffer.concat(chunks).toString();
}
export async function normal(port: number): Promise<void> {
  const c = await new RawClient(port).ready();
  const text = await c.send(request('/', 'Connection: close\r\n')).end();
  assert.match(text, /^HTTP\/1\.1 200 /);
}
