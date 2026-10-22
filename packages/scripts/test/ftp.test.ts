// The FTP client behind BE_FTP_Upload, BE_FTP_UploadFile and BE_FTP_Delete, against a small FTP server made here: an upload
// arrives byte for byte, a delete reaches the server, and a server that tries to send the client elsewhere, or a request
// that tries to add commands, gets nowhere.
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createServer, type Socket, type AddressInfo } from 'node:net';
import { ftpTransfer, parseFtpUrl } from '../src/ftp.ts';
import { fakeFtp, type Fake } from './fake-ftp.ts';

const policy = { private: ['127.0.0.1'] };
const put = (f: Fake, path: string, bytes: Uint8Array, extra: { user?: string; password?: string } = {}) =>
  ftpTransfer({ op: 'put', url: `ftp://127.0.0.1:${f.port}${path}`, user: extra.user ?? 'ann', password: extra.password ?? 'pw', bytes }, { policy, timeoutMs: 5000 });

test('an upload arrives byte for byte, in binary mode, at the path in the address', async () => {
  const f = await fakeFtp();
  try {
    const bytes = Uint8Array.from([0, 255, 13, 10, 128, 7, 0x89]);
    const r = await put(f, '/home/ann/in.bin', bytes);
    assert.deepEqual(r, { status: 226 });
    assert.deepEqual([...f.uploads.get('/home/ann/in.bin')!], [...bytes]);
    assert.deepEqual(f.commands.slice(0, 5), ['USER ann', 'PASS pw', 'TYPE I', 'EPSV', 'STOR /home/ann/in.bin']);
  } finally { await f.close(); }
});

test('an empty file uploads, and a server with no EPSV is asked for PASV', async () => {
  const f = await fakeFtp({ epsv: false });
  try {
    assert.deepEqual(await put(f, '/empty.txt', new Uint8Array(0)), { status: 226 });
    assert.equal(f.uploads.get('/empty.txt')!.length, 0);
    assert.ok(f.commands.includes('PASV'));
  } finally { await f.close(); }
});

test('a delete reaches the server with the path as the login folder sees it', async () => {
  const f = await fakeFtp();
  try {
    assert.deepEqual(await ftpTransfer({ op: 'delete', url: `ftp://127.0.0.1:${f.port}/old/file.txt`, user: 'ann', password: 'pw' }, { policy, timeoutMs: 5000 }), { status: 250 });
    assert.ok(f.commands.includes('DELE old/file.txt'));
    const missing = await ftpTransfer({ op: 'delete', url: `ftp://127.0.0.1:${f.port}/nothing.txt`, user: 'ann', password: 'pw' }, { policy, timeoutMs: 5000 });
    assert.equal(missing.status, 0);
    assert.equal(missing.code, 21);
    assert.match(missing.error!, /did not delete the file: 550/);
    assert.doesNotMatch(missing.error!, /no such file/, 'the server\'s own words are not passed on');
  } finally { await f.close(); }
});

test('a refused login, a refused upload and a server that is not there say what happened', async () => {
  const f = await fakeFtp();
  try {
    const login = await put(f, '/a', new Uint8Array(1), { password: 'wrong' });
    assert.equal(login.code, 67);
    assert.match(login.error!, /refused the login: 530/);
    assert.equal(f.commands.some((c) => c.startsWith('STOR')), false);
  } finally { await f.close(); }
  const denied = await fakeFtp({ refuseStor: true });
  try {
    const r = await put(denied, '/a', new Uint8Array(1));
    assert.equal(r.code, 25);
    assert.match(r.error!, /would not take the file: 550/);
  } finally { await denied.close(); }
  const gone = await fakeFtp();
  const port = gone.port;
  await gone.close();
  const none = await ftpTransfer({ op: 'put', url: `ftp://127.0.0.1:${port}/a`, user: 'u', password: 'p', bytes: new Uint8Array(1) }, { policy, timeoutMs: 5000 });
  assert.equal(none.code, 7);
});

test('a server that names another address for the data connection is not followed there', async () => {
  // PASV says 169.254.169.254, the cloud metadata address; the client connects to the address that answered, and EPSV is tried first anyway.
  const f = await fakeFtp({ epsv: false, pasvIp: '169.254.169.254' });
  try {
    assert.deepEqual(await put(f, '/x.txt', new Uint8Array([1, 2, 3])), { status: 226 });
    assert.equal(f.dataConnections, 1, 'the one data connection went to the control address');
    assert.deepEqual([...f.uploads.get('/x.txt')!], [1, 2, 3]);
  } finally { await f.close(); }
});

test('an address the guard refuses is not connected to, and the policy decides what the own network may reach', async () => {
  const f = await fakeFtp();
  try {
    const refused = await ftpTransfer({ op: 'put', url: `ftp://127.0.0.1:${f.port}/x`, user: 'u', password: 'p', bytes: new Uint8Array(1) }, { timeoutMs: 5000 });
    assert.equal(refused.status, 0);
    assert.match(refused.error!, /own network|not an address/);
    assert.deepEqual(f.commands, [], 'nothing was said to a server on the own network');
    const metadata = await ftpTransfer({ op: 'put', url: 'ftp://169.254.169.254/x', user: 'u', password: 'p', bytes: new Uint8Array(1) }, { policy: { private: true }, timeoutMs: 2000 });
    assert.match(metadata.error!, /link-local|cloud instances/);
  } finally { await f.close(); }
});

test('nothing in the request can become another command', async () => {
  const f = await fakeFtp();
  try {
    for (const [url, user, password] of [
      [`ftp://127.0.0.1:${f.port}/a%0d%0aDELE%20x`, 'ann', 'pw'],
      [`ftp://127.0.0.1:${f.port}/a`, 'ann\r\nDELE x', 'pw'],
      [`ftp://127.0.0.1:${f.port}/a`, 'ann', 'pw\nDELE x'],
      [`ftp://ann:pw@127.0.0.1:${f.port}/a`, '', ''],
    ]) {
      const r = await ftpTransfer({ op: 'put', url, user, password, bytes: new Uint8Array(1) }, { policy, timeoutMs: 2000 });
      assert.equal(r.status, 0, url);
      assert.ok(r.error, url);
    }
    assert.deepEqual(f.commands, [], 'no connection was made for any of them');
  } finally { await f.close(); }
});

const openssl = spawnSync('openssl', ['version']).status === 0;

test('ftps: the control and data connections are TLS, the certificate is checked, and the upload arrives', { skip: openssl ? false : 'openssl is not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ftps-'));
  try {
    spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', 'key.pem', '-out', 'cert.pem', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-days', '1'], { cwd: dir });
    const tls = { key: readFileSync(join(dir, 'key.pem'), 'utf8'), cert: readFileSync(join(dir, 'cert.pem'), 'utf8') };
    const f = await fakeFtp({ tls });
    try {
      const url = `ftps://127.0.0.1:${f.port}/secure.bin`;
      const bytes = Uint8Array.from([9, 8, 7, 0, 255]);
      // Trusting the certificate's authority: the upload goes through, and the data connection was protected.
      assert.deepEqual(await ftpTransfer({ op: 'put', url, user: 'ann', password: 'pw', bytes }, { policy, timeoutMs: 5000, ca: tls.cert }), { status: 226 });
      assert.deepEqual([...f.uploads.get('/secure.bin')!], [...bytes]);
      assert.deepEqual(f.commands.slice(0, 4), ['USER ann', 'PASS pw', 'PBSZ 0', 'PROT P']);
      // Without it, a certificate nobody vouches for is refused, and no password is sent.
      const said = () => f.commands.filter((c) => c !== 'QUIT').length;
      const before = said();
      const untrusted = await ftpTransfer({ op: 'put', url, user: 'ann', password: 'pw', bytes }, { policy, timeoutMs: 5000 });
      assert.equal(untrusted.status, 0);
      assert.equal(untrusted.code, 35);
      assert.equal(said(), before, 'nothing was sent over a connection that could not be trusted');
    } finally { await f.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('only ftp and ftps addresses with a file in the path are used', () => {
  assert.deepEqual(parseFtpUrl('ftp://h.example.com/a/b.txt'), { secure: false, host: 'h.example.com', port: 21, path: '/a/b.txt' });
  assert.deepEqual(parseFtpUrl('ftps://h.example.com:2121/a%20b.txt'), { secure: true, host: 'h.example.com', port: 2121, path: '/a b.txt' });
  for (const bad of ['sftp://h.example.com/a', 'http://h.example.com/a', 'ftp://h.example.com/', 'ftp://h.example.com', 'not a url', 'ftp://u:p@h.example.com/a']) assert.equal(typeof parseFtpUrl(bad), 'string', bad);
});

test('a server that sends a huge line, or never answers, ends the call', async () => {
  const f = await fakeFtp({ hugeLine: true });
  try {
    const r = await put(f, '/a', new Uint8Array(1));
    assert.equal(r.status, 0);
    assert.match(r.error!, /too long/);
  } finally { await f.close(); }
  // A server that accepts and says nothing.
  const held: Socket[] = [];
  const quiet = createServer((s) => { held.push(s); s.on('error', () => {}); });
  await new Promise<void>((r) => quiet.listen(0, '127.0.0.1', r));
  try {
    const started = Date.now();
    const r = await ftpTransfer({ op: 'delete', url: `ftp://127.0.0.1:${(quiet.address() as AddressInfo).port}/a`, user: 'u', password: 'p' }, { policy, timeoutMs: 400 });
    assert.equal(r.status, 0);
    assert.ok(Date.now() - started < 3000);
  } finally { held.forEach((s) => s.destroy()); await new Promise<void>((r) => quiet.close(() => r())); }
});

test('a stalled connection or handshake ends at the time limit or the caller\'s stop, not never', async () => {
  const held: Socket[] = [];
  const quiet = createServer((s) => { held.push(s); s.on('error', () => {}); });
  await new Promise<void>((r) => quiet.listen(0, '127.0.0.1', r));
  const port = (quiet.address() as AddressInfo).port;
  try {
    // ftps to a server that accepts and never answers the TLS hello.
    const started = Date.now();
    const slow = await ftpTransfer({ op: 'delete', url: `ftps://127.0.0.1:${port}/a`, user: 'u', password: 'p' }, { policy, timeoutMs: 300 });
    assert.equal(slow.status, 0);
    assert.equal(slow.code, 7);
    assert.match(slow.error!, /too long|stopped/);
    assert.ok(Date.now() - started < 3000, 'the time limit ended it');
    // The caller's stop ends it too.
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 100);
    const again = Date.now();
    const stopped = await ftpTransfer({ op: 'delete', url: `ftps://127.0.0.1:${port}/a`, user: 'u', password: 'p' }, { policy, timeoutMs: 20_000, signal: stop.signal });
    assert.match(stopped.error!, /too long|stopped/);
    assert.ok(Date.now() - again < 3000, 'the stop ended it');
  } finally { held.forEach((s) => s.destroy()); await new Promise<void>((r) => quiet.close(() => r())); }
});

test('a server that floods replies is cut off', async () => {
  const flood = createServer((s) => { s.on('error', () => {}); s.write('220 hi\r\n' + '226 x\r\n'.repeat(5000)); });
  await new Promise<void>((r) => flood.listen(0, '127.0.0.1', r));
  try {
    const r = await ftpTransfer({ op: 'put', url: `ftp://127.0.0.1:${(flood.address() as AddressInfo).port}/a`, user: 'u', password: 'p', bytes: new Uint8Array(1) }, { policy, timeoutMs: 3000 });
    assert.equal(r.status, 0);
    assert.match(r.error!, /far more replies/);
  } finally { await new Promise<void>((r) => flood.close(() => r())); }
});

test('a data port that is a low one, or the control connection\'s own, is not used', async () => {
  for (const reportPort of [() => 80, (_: number, control: number) => control]) {
    const f = await fakeFtp({ reportPort });
    try {
      const r = await put(f, '/a', new Uint8Array(1));
      assert.equal(r.code, 25);
      assert.match(r.error!, /no port/);
      assert.equal(f.commands.some((c) => c.startsWith('STOR')), false);
      assert.equal(f.dataConnections, 0);
    } finally { await f.close(); }
  }
});

test('an allow-list entry that is a host name lets the data connection through too', async () => {
  const f = await fakeFtp();
  try {
    const r = await ftpTransfer({ op: 'put', url: `ftp://localhost:${f.port}/n.txt`, user: 'ann', password: 'pw', bytes: new Uint8Array([9]) }, { policy: { private: ['localhost'] }, timeoutMs: 5000 });
    assert.deepEqual(r, { status: 226 });
    assert.deepEqual([...f.uploads.get('/n.txt')!], [9]);
  } finally { await f.close(); }
});

test('a server that sends endless bytes with no line break is cut off and its connection closed', async () => {
  let closed: () => void;
  const serverSawClose = new Promise<void>((r) => { closed = r; });
  const endless = createServer((s) => {
    s.on('error', () => {});
    s.on('close', () => closed());
    s.write('220 hi\r\n');
    const chunk = 'x'.repeat(256 * 1024);
    const pump = () => { while (!s.destroyed && s.write(chunk)); if (!s.destroyed) s.once('drain', pump); };
    pump();
  });
  await new Promise<void>((r) => endless.listen(0, '127.0.0.1', r));
  try {
    const r = await ftpTransfer({ op: 'delete', url: `ftp://127.0.0.1:${(endless.address() as AddressInfo).port}/a`, user: 'u', password: 'p' }, { policy, timeoutMs: 10_000 });
    assert.equal(r.status, 0);
    assert.match(r.error!, /too long/);
    await Promise.race([serverSawClose, new Promise((_, no) => setTimeout(() => no(new Error('the connection stayed open')), 2000))]);
  } finally { await new Promise<void>((r) => endless.close(() => r())); }
});

test('a flood on the control connection while the file is being sent ends the call at once and closes the connection', async () => {
  const f = await fakeFtp({ floodAfterStor: true });
  try {
    const started = Date.now();
    const r = await ftpTransfer({ op: 'put', url: `ftp://127.0.0.1:${f.port}/big.bin`, user: 'ann', password: 'pw', bytes: new Uint8Array(24 * 1024 * 1024) }, { policy, timeoutMs: 15_000 });
    assert.equal(r.status, 0);
    assert.match(r.error!, /too long/);
    assert.ok(Date.now() - started < 5000, 'the call did not wait for its time limit');
    for (let i = 0; i < 40 && f.controlsClosed === 0; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(f.controlsClosed, 1, 'the control connection was closed');
  } finally { await f.close(); }
});

test('an upload the server does not confirm at the end is a failure, not a success', async () => {
  const f = await fakeFtp({ endReply: '552 out of space' });
  try {
    const r = await put(f, '/a.bin', new Uint8Array([1, 2, 3]));
    assert.equal(r.status, 0);
    assert.equal(r.code, 25);
    assert.match(r.error!, /did not finish: 552/);
  } finally { await f.close(); }
});

test('ftps: a server that starts the data connection\'s TLS only after STOR is answered (vsftpd, ProFTPD) gets the upload', { skip: openssl ? false : 'openssl is not installed' }, async () => {
  const { createServer: tlsServer, TLSSocket } = await import('node:tls');
  const dir = mkdtempSync(join(tmpdir(), 'ftps-late-'));
  const servers: ReturnType<typeof createServer>[] = [];
  try {
    spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', 'key.pem', '-out', 'cert.pem', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-days', '1'], { cwd: dir });
    const tls = { key: readFileSync(join(dir, 'key.pem'), 'utf8'), cert: readFileSync(join(dir, 'cert.pem'), 'utf8') };
    const commands: string[] = [];
    let received: Buffer | undefined;
    const control = tlsServer(tls, (c) => {
      c.on('error', () => {});
      c.setEncoding('utf8');
      const say = (line: string) => c.write(line + '\r\n');
      say('220 ready');
      let accepted: Promise<Socket> | undefined;
      let buffer = '';
      c.on('data', async (chunk: string) => {
        buffer += chunk;
        for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
          const line = buffer.slice(0, i).replace(/\r$/, '');
          buffer = buffer.slice(i + 1);
          commands.push(line);
          const verb = line.split(' ')[0];
          if (verb === 'USER') say('331 password please');
          else if (verb === 'PASS') say('230 welcome');
          else if (verb === 'PBSZ' || verb === 'PROT' || verb === 'TYPE') say('200 ok');
          else if (verb === 'EPSV') {
            // The data port takes plain TCP: TLS starts on it only once the transfer has been started.
            const data = createServer();
            servers.push(data);
            accepted = new Promise((resolve) => data.once('connection', resolve));
            await new Promise<void>((r) => data.listen(0, '127.0.0.1', r));
            say(`229 Entering Extended Passive Mode (|||${(data.address() as AddressInfo).port}|)`);
          } else if (verb === 'STOR') {
            say('150 ok to send');
            const secured = new TLSSocket(await accepted!, { isServer: true, ...tls });
            const parts: Buffer[] = [];
            secured.on('data', (b: Buffer) => parts.push(b));
            secured.on('error', () => {});
            secured.on('end', () => { received = Buffer.concat(parts); say('226 transfer complete'); secured.end(); });
          } else if (verb === 'QUIT') { say('221 bye'); c.end(); } else say('502 not implemented');
        }
      });
    });
    servers.push(control as unknown as ReturnType<typeof createServer>);
    await new Promise<void>((r) => control.listen(0, '127.0.0.1', r));
    const port = (control.address() as AddressInfo).port;
    const result = await ftpTransfer({ op: 'put', url: `ftps://127.0.0.1:${port}/late.bin`, user: 'ann', password: 'pw', bytes: Uint8Array.from([1, 2, 3, 0, 255]) }, { policy, timeoutMs: 5000, ca: tls.cert });
    assert.deepEqual(result, { status: 226 });
    assert.deepEqual([...received!], [1, 2, 3, 0, 255]);
    assert.ok(commands.includes('STOR /late.bin'));
  } finally {
    servers.forEach((s) => s.close());
    rmSync(dir, { recursive: true, force: true });
  }
});
