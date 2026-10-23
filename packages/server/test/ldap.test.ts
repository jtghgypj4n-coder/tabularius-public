// LDAP / Active Directory sign-in. A mock directory speaks just enough of the
// wire protocol (bind, search, unbind) to prove the client's BER encode and
// decode against an independent implementation, both ways it can be set up —
// a bind-DN template, and search-then-bind — and that the Data API hands a
// directory sign-in the privilege set of the matching external account.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server as NetServer, type Socket } from 'node:net';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { ldapAuthenticate, serve, type LdapProvider } from '../src/index.ts';
import { hostRefusal } from '../../scripts/src/net-guard.ts';
import type { Store } from '../../store/src/index.ts';

// --- a tiny, independent BER codec, so a shared bug can't pass both sides ---

const u8 = (...n: number[]) => Buffer.from(n);
function len(n: number): Buffer {
  if (n < 0x80) return u8(n);
  const b: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) b.unshift(v & 0xff);
  return u8(0x80 | b.length, ...b);
}
const tlv = (tag: number, v: Buffer) => Buffer.concat([u8(tag), len(v.length), v]);
function intT(n: number, tag = 0x02): Buffer {
  const b: number[] = [];
  let v = n;
  do { b.unshift(v & 0xff); v = Math.floor(v / 256); } while (v > 0);
  if (b[0] & 0x80) b.unshift(0);
  return tlv(tag, Buffer.from(b));
}
const oct = (s: string, tag = 0x04) => tlv(tag, Buffer.from(s, 'utf8'));
const seqT = (tag: number, ...p: Buffer[]) => tlv(tag, Buffer.concat(p));

class R {
  private b: Buffer;
  private p: number;
  constructor(b: Buffer, p = 0) { this.b = b; this.p = p; }
  len(): number {
    let n = this.b[this.p++];
    if (n & 0x80) { const c = n & 0x7f; n = 0; for (let i = 0; i < c; i++) n = n * 256 + this.b[this.p++]; }
    return n;
  }
  tag(): number { return this.b[this.p]; }
  take(tag: number): R { if (this.b[this.p++] !== tag) throw new Error('tag'); const l = this.len(); const r = new R(this.b.subarray(this.p, this.p + l)); this.p += l; return r; }
  int(): number { this.p++; const l = this.len(); let n = 0; for (let i = 0; i < l; i++) n = n * 256 + this.b[this.p++]; return n; }
  str(): string { this.p++; const l = this.len(); const s = this.b.toString('utf8', this.p, this.p + l); this.p += l; return s; }
  skip(): void { this.p++; const l = this.len(); this.p += l; }
  get done(): boolean { return this.p >= this.b.length; }
}

function frameLen(buf: Buffer): number | undefined {
  if (buf.length < 2) return undefined;
  let i = 1;
  let n = buf[i++];
  if (n & 0x80) { const c = n & 0x7f; if (buf.length < i + c) return undefined; n = 0; for (let j = 0; j < c; j++) n = n * 256 + buf[i++]; }
  return i + n;
}

// --- the mock directory ----------------------------------------------------

interface User { dn: string; pw: string; mail?: string; groups: string[]; match: Record<string, string>; }

const users: User[] = [
  { dn: 'uid=alice,ou=people,dc=ex,dc=com', pw: 'secret', mail: 'alice@ex.com', groups: ['CN=Sales,OU=g,DC=ex,DC=com', 'CN=Staff,OU=g,DC=ex,DC=com'], match: { uid: 'alice' } },
  { dn: 'CN=Bob,OU=people,DC=ex,DC=com', pw: 'bobpw', mail: 'bob@ex.com', groups: ['CN=Admins,OU=g,DC=ex,DC=com'], match: { samaccountname: 'bob' } },
  ...['a$$b', "x$'", 'y$`'].map((name, i) => ({ dn: `uid=${name},ou=people,dc=ex,dc=com`, pw: `dollar-password-${i}`, groups: [], match: { uid: name } })),
  { dn: 'uid=escaped-groups,ou=people,dc=ex,dc=com', pw: 'groups-password', groups: ['CN=Sales\\, EMEA,OU=g,DC=ex,DC=com', 'CN=Plain,OU=g,DC=ex,DC=com'], match: { uid: 'escaped-groups' } },
  { dn: 'uid=trailing-escape,ou=people,dc=ex,dc=com', pw: 'trailing-password', groups: ['CN=Trailing\\'], match: { uid: 'trailing-escape' } },
];
const service = { dn: 'cn=svc,dc=ex,dc=com', pw: 'svcpw' };

function entry(res: User): Buffer {
  const attr = (name: string, vals: string[]) => seqT(0x30, oct(name), seqT(0x31, ...vals.map((v) => oct(v))));
  const attrs: Buffer[] = [];
  if (res.mail) attrs.push(attr('mail', [res.mail]));
  if (res.groups.length) attrs.push(attr('memberOf', res.groups));
  return seqT(0x64, oct(res.dn), seqT(0x30, ...attrs));
}
const result = (tag: number, code: number) => seqT(tag, intT(code, 0x0a), oct(''), oct(''));
const message = (id: number, op: Buffer) => seqT(0x30, intT(id), op);

let binds = 0;

function handle(sock: Socket, msg: Buffer): void {
  const outer = new R(msg).take(0x30); // into the LDAPMessage SEQUENCE
  const id = outer.int();
  const opTag = outer.tag();
  if (opTag === 0x60) { // bindRequest
    binds++;
    const body = outer.take(0x60);
    body.int(); // version
    const dn = body.str();
    const pw = body.str(); // simple auth [0], read as a string
    const ok = (dn === service.dn && pw === service.pw) || users.some((u) => u.dn === dn && u.pw === pw) || (dn === '' && pw === '');
    sock.write(message(id, result(0x61, ok ? 0 : 49)));
  } else if (opTag === 0x63) { // searchRequest
    const body = outer.take(0x63);
    const base = body.str();
    body.int(); // scope (enum)
    body.int(); // deref
    body.int(); // sizeLimit
    body.int(); // timeLimit
    body.skip(); // typesOnly bool
    // filter: either present [7] (objectClass=*) or equalityMatch [3]
    let found: User | undefined;
    const ftag = body.tag();
    if (ftag === 0x87) {
      body.skip(); // present filter: match by base DN
      found = users.find((u) => u.dn.toLowerCase() === base.toLowerCase());
    } else if (ftag === 0xa3) {
      const eq = body.take(0xa3);
      const attr = eq.str().toLowerCase();
      const val = eq.str().toLowerCase();
      found = users.find((u) => (u.match[attr] ?? '').toLowerCase() === val);
    }
    if (found) sock.write(message(id, entry(found)));
    sock.write(message(id, result(0x65, 0)));
  } else if (opTag === 0x42) { // unbindRequest
    sock.end();
  }
}

function mockConnection(sock: Socket): void {
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const total = frameLen(buf);
      if (total === undefined || buf.length < total) break;
      const m = buf.subarray(0, total);
      buf = buf.subarray(total);
      try { handle(sock, m); } catch { sock.destroy(); return; }
    }
  });
  sock.on('error', () => {});
}

let ldapServer: NetServer;
let ldapUrl: string;

const template: () => LdapProvider = () => ({ name: 'Directory', url: ldapUrl, bindDnTemplate: 'uid={user},ou=people,dc=ex,dc=com' });

test('bind-DN template: the right password returns the email and groups, the common name first', async () => {
  const who = await ldapAuthenticate(template(), 'alice', 'secret');
  assert.ok(who);
  assert.equal(who.email, 'alice@ex.com');
  assert.deepEqual(who.groups, ['Sales', 'CN=Sales,OU=g,DC=ex,DC=com', 'Staff', 'CN=Staff,OU=g,DC=ex,DC=com']);
});

test('bind-DN template: dollar patterns in names bind as the typed entry', async () => {
  for (const [i, name] of ['a$$b', "x$'", 'y$`'].entries()) {
    assert.ok(await ldapAuthenticate(template(), name, `dollar-password-${i}`), name);
  }
});

test('group common names preserve escaped commas and tolerate a trailing backslash', async () => {
  const who = await ldapAuthenticate(template(), 'escaped-groups', 'groups-password');
  assert.ok(who);
  assert.deepEqual(who.groups, ['Sales, EMEA', 'CN=Sales\\, EMEA,OU=g,DC=ex,DC=com', 'Plain', 'CN=Plain,OU=g,DC=ex,DC=com']);
  const trailing = await ldapAuthenticate(template(), 'trailing-escape', 'trailing-password');
  assert.ok(trailing);
  assert.ok(trailing.groups.includes('CN=Trailing\\'));
});

test('bind-DN template: a wrong password is rejected', async () => {
  assert.equal(await ldapAuthenticate(template(), 'alice', 'wrong'), undefined);
});

test('search then bind: a service account finds the user, then the password is checked', async () => {
  const provider: LdapProvider = { name: 'AD', url: ldapUrl, searchDn: service.dn, searchPassword: service.pw, baseDn: 'dc=ex,dc=com', userAttribute: 'sAMAccountName' };
  const who = await ldapAuthenticate(provider, 'bob', 'bobpw');
  assert.ok(who);
  assert.equal(who.email, 'bob@ex.com');
  assert.ok(who.groups.includes('Admins'));

  // Wrong password: the user is found but the bind as them fails.
  assert.equal(await ldapAuthenticate(provider, 'bob', 'nope'), undefined);
  // Unknown user: the search finds nothing.
  assert.equal(await ldapAuthenticate(provider, 'nobody', 'x'), undefined);

  // An unknown user costs the directory as many binds as a known one with a wrong password, so timing doesn't tell them apart.
  binds = 0;
  await ldapAuthenticate(provider, 'bob', 'nope');
  const known = binds;
  binds = 0;
  await ldapAuthenticate(provider, 'nobody', 'nope');
  assert.equal(binds, known);
});

test('a filter value cannot inject LDAP syntax', async () => {
  const provider: LdapProvider = { name: 'AD', url: ldapUrl, searchDn: service.dn, searchPassword: service.pw, baseDn: 'dc=ex,dc=com', userAttribute: 'sAMAccountName' };
  // The "*" is escaped to \2a, so it matches literally and finds no one.
  assert.equal(await ldapAuthenticate(provider, '*', 'x'), undefined);
});

test('an unreachable directory fails cleanly', async () => {
  await assert.rejects(ldapAuthenticate({ name: 'x', url: 'ldap://127.0.0.1:1', bindDnTemplate: 'uid={user}' }, 'a', 'b'), /can't reach/);
});

test('IPv6 directory literals use the bare address and retain metadata refusal', async (t) => {
  await assert.rejects(ldapAuthenticate({ ...template(), url: 'ldap://[::1]:1' }, 'a', 'b'), (error: Error) => {
    assert.match(error.message, /can't reach ::1:1/);
    assert.doesNotMatch(error.message, /ENOTFOUND|\[::1\]/);
    return true;
  });
  for (const address of ['fd00:ec2::254', 'fe80::1']) {
    const refusal = hostRefusal({ private: true }, address);
    assert.ok(refusal);
    for (const protocol of ['ldap', 'ldaps']) {
      await assert.rejects(ldapAuthenticate({ ...template(), url: `${protocol}://[${address}]` }, 'a', 'b'), {
        message: `ldap: ${refusal}`,
      });
    }
  }
  await t.test('signs in over IPv6 loopback when available', async (t) => {
    const server = createServer(mockConnection);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '::1', () => { server.off('error', reject); resolve(); });
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EAFNOSUPPORT' && code !== 'EADDRNOTAVAIL') throw error;
      t.skip(`IPv6 loopback unavailable: ${code}`);
      return;
    }
    try {
      const url = `ldap://[::1]:${(server.address() as { port: number }).port}`;
      const who = await ldapAuthenticate({ ...template(), url }, 'alice', 'secret');
      assert.ok(who);
      assert.equal(who.email, 'alice@ex.com');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

// --- the Data API hands a directory sign-in an external account's set -------

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let httpServer: Server;
let base: string;
let store: Store;
let host: Awaited<ReturnType<typeof serve>>['host'];

before(async () => {
  // Start the mock directory first, so its URL is ready for the HTTP server.
  ldapServer = createServer(mockConnection);
  await new Promise<void>((res) => ldapServer.listen(0, '127.0.0.1', res));
  ldapUrl = `ldap://127.0.0.1:${(ldapServer.address() as { port: number }).port}`;

  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-ldap-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, ldap: template() });
  httpServer = s.server;
  base = s.url;
  host = s.host;
  store = s.host.get('Charts')!;
  // An external account named after a directory group, with a real set.
  store.savePrivilegeSet({ name: 'SalesSet', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.setExternalAccount('Sales', 'SalesSet');
});
after(() => {
  httpServer?.close();
  ldapServer?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const login = (user: string, password: string) =>
  fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64') }, body: '{}' })
    .then(async (r) => ({ status: r.status, body: await r.json() as { response?: { token?: string }; messages: { code: string }[] } }));

test('a directory user in a mapped group signs in and gets the set', { skip }, async () => {
  const r = await login('alice', 'secret');
  assert.equal(r.body.messages[0].code, '0');
  assert.ok(r.body.response?.token, 'a session token comes back');
});

test('an existing directory session is rejected when its mapping is deactivated', { skip }, async () => {
  const r = await login('alice', 'secret');
  const token = r.body.response?.token;
  assert.ok(token);
  store.setAccountActive('Sales', false);
  const use = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts`, { headers: { authorization: `Bearer ${token}` } });
  const body = await use.json() as { messages: { code: string }[] };
  assert.equal(body.messages[0].code, '952');
  store.setAccountActive('Sales', true);
});

test('an inactive trusted email blocks directory alias fallback and existing sessions', { skip }, async () => {
  const r = await login('alice', 'secret');
  const token = r.body.response?.token;
  assert.ok(token);
  store.addProvisionedAccount('alice@ex.com', 'Admin');
  store.setAccountActive('alice@ex.com', false);
  const existing = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal((await existing.json() as { messages: { code: string }[] }).messages[0].code, '952');
  const fresh = await login('alice', 'secret');
  assert.equal(fresh.status, 401);
  assert.equal(fresh.body.messages[0].code, '212');
  store.setAccountActive('alice@ex.com', true);
});

test('a directory user in no mapped group is refused', { skip }, async () => {
  // bob authenticates to the directory, but his group (Admins) has no account here.
  const r = await login('bob', 'bobpw');
  assert.equal(r.status, 401);
  assert.equal(r.body.messages[0].code, '212');
});

test('a wrong directory password is refused', { skip }, async () => {
  const r = await login('alice', 'wrong');
  assert.equal(r.status, 401);
  assert.equal(r.body.messages[0].code, '212');
});

test('an account name with a control character never reaches the directory', { skip }, async () => {
  const before = binds;
  const r = await login('alice\nWarning: forged', 'secret');
  assert.equal(r.status, 401);
  assert.match(JSON.stringify(r.body), /Invalid user account and\/or password/i);
  assert.doesNotMatch(JSON.stringify(r.body), /invalid account name/i);
  assert.equal(binds, before, 'no bind or search was sent');
  const { entries } = await host.logs!.read('Access', { type: 'Warning', q: 'invalid account name', limit: 500 });
  assert.ok(entries.some((e) => /could not sign in/.test(e.message)));
  assert.ok(entries.every((e) => !/[\u0000-\u001f\u007f]/.test(e.message)), 'the log line has no control characters');
});

test('failed sign-ins are logged one by one only up to 30 a minute', { skip }, async () => {
  for (let i = 0; i < 40; i++) await login(`nobody${i}`, 'x');
  const { entries } = await host.logs!.read('Access', { type: 'Warning', q: 'could not sign in', limit: 500 });
  // The cap is for the whole minute, earlier tests' failures included.
  assert.equal(entries.length, 30, 'the rest are counted, not written');
  assert.ok(entries.every((e) => !/[\u0000-\u001f\u007f]/.test(e.message)));
});

test('a sign-in with no credentials at all is refused, not an error', { skip }, async () => {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', body: '{}' });
  assert.equal(r.status, 401);
});

test('an unreachable directory is refused without naming the directory', { skip }, async () => {
  await new Promise<void>((res) => { ldapServer.close(() => res()); });
  const r = await login('alice', 'secret');
  assert.equal(r.status, 401);
  assert.equal(r.body.messages[0].code, '212');
  assert.doesNotMatch(JSON.stringify(r.body), /127\.0\.0\.1|ECONN|ldap:/);
});

test('100 failed directory sign-ins write a bounded number of warnings', { skip }, async () => {
  const prefix = `limittest${Date.now()}`;
  for (let i = 0; i < 100; i++) await login(`${prefix}${i}`, 'wrong');
  const { entries } = await host.logs!.read('Access', { type: 'Warning', q: 'the directory could not sign', limit: 500 });
  const own = entries.filter((e) => e.message.includes(prefix));
  const perMinute = new Map<number, number>();
  for (const e of own) {
    const minute = Math.floor(Date.parse(e.at) / 60_000);
    perMinute.set(minute, (perMinute.get(minute) ?? 0) + 1);
  }
  assert.ok(own.length > 0, 'the attempts produced directory warnings');
  for (const [minute, count] of perMinute) assert.ok(count <= 20, `minute ${minute} has ${count} warnings`);
});
