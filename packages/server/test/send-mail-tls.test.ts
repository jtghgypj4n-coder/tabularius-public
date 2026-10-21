import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as netServer, type Server as NetServer, type Socket } from 'node:net';
import { createSecureContext, TLSSocket, createServer as tlsServer, type Server as TlsServer } from 'node:tls';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLogin } from '../src/smtp.ts';

// Synthetic test-only certificate, made here with openssl and never trusted outside this test. It covers the loopback IP.
const openssl = spawnSync('openssl', ['version']).status === 0;
const skip = openssl ? false : 'openssl is not installed';
const pems = (() => {
  if (!openssl) return { cert: '', key: '' };
  const work = mkdtempSync(join(tmpdir(), 'tabularius-smtp-tls-'));
  try {
    const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '2',
      '-keyout', join(work, 'key.pem'), '-out', join(work, 'cert.pem'), '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1']);
    assert.equal(made.status, 0, String(made.stderr));
    return { cert: readFileSync(join(work, 'cert.pem'), 'utf8'), key: readFileSync(join(work, 'key.pem'), 'utf8') };
  } finally { rmSync(work, { recursive: true, force: true }); }
})();
const CERT = pems.cert;
const KEY = pems.key;

function conversation(socket: Socket | TLSSocket, greet = true): void {
  let buffer = '';
  if (greet) socket.write('220 synthetic ESMTP\r\n');
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    for (;;) {
      const end = buffer.indexOf('\r\n');
      if (end < 0) return;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (line.startsWith('EHLO')) socket.write('250 AUTH PLAIN\r\n');
      else if (line.startsWith('AUTH PLAIN')) socket.write('235 authenticated\r\n');
      else if (line === 'QUIT') socket.end('221 goodbye\r\n');
      else socket.write('500 unexpected\r\n');
    }
  });
}

const port = (server: NetServer | TlsServer) => (server.address() as { port: number }).port;
const listen = (server: NetServer | TlsServer) => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const close = (server: NetServer | TlsServer) => new Promise<void>((resolve) => server.close(() => resolve()));

test('SMTP implicit TLS and STARTTLS verify a synthetic local certificate and authenticate', { skip }, async () => {
  const implicit = tlsServer({ key: KEY, cert: CERT }, (socket) => conversation(socket));
  await listen(implicit);
  try {
    await checkLogin({ url: `smtps://user%40test.example:pw@127.0.0.1:${port(implicit)}`, ca: CERT, timeoutMs: 2_000 });
    await assert.rejects(checkLogin({ url: `smtps://user%40test.example:pw@127.0.0.1:${port(implicit)}`, timeoutMs: 2_000 }), /certificate|self-signed/i);
  } finally { await close(implicit); }

  const secureContext = createSecureContext({ key: KEY, cert: CERT });
  const starttls = netServer((socket) => {
    socket.write('220 synthetic ESMTP\r\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('EHLO')) socket.write('250-synthetic\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n');
        else if (line === 'STARTTLS') {
          socket.write('220 begin TLS\r\n');
          socket.pause();
          socket.removeAllListeners('data');
          const secured = new TLSSocket(socket, { isServer: true, secureContext });
          secured.on('secure', () => { secured.resume(); conversation(secured); });
          secured.on('error', () => {});
        } else socket.write('500 unexpected\r\n');
      }
    });
  });
  await listen(starttls);
  try {
    await checkLogin({ url: `smtp://user%40test.example:pw@127.0.0.1:${port(starttls)}`, ca: CERT, timeoutMs: 2_000 });
  } finally { await close(starttls); }
});

test('a STARTTLS handshake that never completes fails at the idle timeout', { skip }, async () => {
  const stalled = netServer((socket) => {
    socket.write('220 synthetic ESMTP\r\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('EHLO')) socket.write('250-synthetic\r\n250 STARTTLS\r\n');
        else if (line === 'STARTTLS') socket.write('220 begin TLS\r\n');
      }
    });
  });
  await listen(stalled);
  try {
    const started = Date.now();
    await assert.rejects(checkLogin({ url: `smtp://user%40test.example:pw@127.0.0.1:${port(stalled)}`, ca: CERT, timeoutMs: 300 }), /stopped answering|closed|took too long/);
    assert.ok(Date.now() - started < 5_000, 'fails near the idle timeout, not the 180 s conversation limit');
  } finally { await close(stalled); }
});
