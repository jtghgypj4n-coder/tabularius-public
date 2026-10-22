// Sign-in against an LDAP directory or Active Directory, like FileMaker's
// external server accounts. A person types their directory username and
// password into the ordinary sign-in; the server binds to the directory with
// them. If the bind succeeds, it reads the person's email and groups, and —
// as in FileMaker — the file decides what they may do: an external account
// named their email, or one of their groups, gives its privilege set.
//
// Two shapes, both standard:
//   - a DN template ("uid={user},ou=people,dc=example,dc=com"): bind straight
//     as that DN, then read the bound entry for its email and groups.
//   - search then bind (Active Directory's usual shape): a service account
//     searches for "(sAMAccountName={user})" under a base, reads the entry's
//     DN, email and groups, then rebinds as that DN to check the password.
//
// LDAP is a binary protocol (BER/ASN.1 over TCP); this speaks just the part
// needed — bind, one search, unbind — with no dependencies. ldaps:// uses TLS;
// ldap:// is plain (put it on a trusted network or behind a VPN).

import { randomBytes } from 'node:crypto';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { hostRefusal, socketLookup } from '../../scripts/src/net-guard.ts';

export interface LdapProvider {
  /** Shown when listing how people can sign in. */
  name: string;
  /** ldap://host:389 or ldaps://host:636. */
  url: string;
  /**
   * Bind straight as this DN, substituting {user} for the typed name
   * (RFC 4514 escaped). Use this OR a service account + baseDn, not both.
   */
  bindDnTemplate?: string;
  /** Service account for the initial search (search-then-bind). Omit for an anonymous search. */
  searchDn?: string;
  searchPassword?: string;
  /** Where to search for the person's entry (search-then-bind). */
  baseDn?: string;
  /** The attribute the typed name matches, as an equality filter (default "uid"; Active Directory: "sAMAccountName"). */
  userAttribute?: string;
  /** The entry attribute holding the email address (default "mail"). */
  emailAttribute?: string;
  /** The entry attribute listing groups (default "memberOf"). */
  groupAttribute?: string;
  /** Seconds to wait for the directory (default 10). */
  timeout?: number;
  /** For ldaps://, refuse a certificate that doesn't verify (default true). */
  tlsRejectUnauthorized?: boolean;
}

/** What the directory vouches for: an email (if it has one) and the person's groups. */
export interface DirectoryIdentity {
  email?: string;
  groups: string[];
}

/** Authenticates a username/password against the directory; undefined when the directory rejects them. */
export type DirectoryAuthenticator = (user: string, password: string) => Promise<DirectoryIdentity | undefined>;

export function ldapAuthenticator(provider: LdapProvider): DirectoryAuthenticator {
  return (user, password) => ldapAuthenticate(provider, user, password);
}

export async function ldapAuthenticate(provider: LdapProvider, user: string, password: string): Promise<DirectoryIdentity | undefined> {
  if (!user || !password) return undefined; // an empty password would be an anonymous bind, which proves nothing
  const conn = await LdapConnection.open(provider);
  try {
    const emailAttr = provider.emailAttribute ?? 'mail';
    const groupAttr = provider.groupAttribute ?? 'memberOf';
    if (provider.bindDnTemplate) {
      const dn = provider.bindDnTemplate.replace(/\{user\}/g, () => escapeDn(user));
      if (!(await conn.bind(dn, password))) return undefined;
      const entry = await conn.searchOne(dn, 'base', '(objectClass=*)', [emailAttr, groupAttr]);
      return identity(entry, emailAttr, groupAttr);
    }
    // Search then bind: a service account (or anonymous) finds the entry, then
    // we rebind as it to check the password.
    const base = provider.baseDn;
    if (!base) throw new LdapError('ldap: configure either a bind DN template or a base DN to search');
    if (provider.searchDn ? !(await conn.bind(provider.searchDn, provider.searchPassword ?? '')) : !(await conn.bind('', ''))) {
      throw new LdapError('ldap: the directory refused the search account');
    }
    const filter = `(${provider.userAttribute ?? 'uid'}=${escapeFilter(user)})`;
    const entry = await conn.searchOne(base, 'sub', filter, [emailAttr, groupAttr]);
    if (!entry) {
      // No such user. The same second bind is made against a name nobody has, so the answer takes as many round trips as
      // a wrong password. That closes the round-trip difference only: a directory that checks a real password hash still
      // answers a known user a little slower, which this does not hide.
      await conn.bind(`cn=${randomBytes(9).toString('hex')},${base}`, password).catch(() => false);
      return undefined;
    }
    if (!(await conn.bind(entry.dn, password))) return undefined; // wrong password
    return identity(entry, emailAttr, groupAttr);
  } finally {
    conn.close();
  }
}

function identity(entry: Entry | undefined, emailAttr: string, groupAttr: string): DirectoryIdentity {
  const email = entry?.attributes[emailAttr.toLowerCase()]?.[0];
  const raw = entry?.attributes[groupAttr.toLowerCase()] ?? [];
  // A group arrives as a full DN ("CN=Sales,OU=Groups,DC=example,DC=com"); the
  // common name is what an external account is usually named after, so offer
  // both, the name first.
  const groups: string[] = [];
  for (const g of raw) {
    const cn = /^\s*cn=((?:\\.|[^,\\])+)/i.exec(g)?.[1];
    if (cn && !groups.includes(cn)) groups.push(unescapeDnValue(cn));
    if (!groups.includes(g)) groups.push(g);
  }
  return { email: email || undefined, groups };
}

// --- a minimal LDAP client -------------------------------------------------

interface Entry {
  dn: string;
  /** Lower-cased attribute name -> values. */
  attributes: Record<string, string[]>;
}

const SCOPE = { base: 0, one: 1, sub: 2 } as const;

class LdapConnection {
  private readonly socket: Socket;
  private readonly timeout: number;
  private buffer: Buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly waiting = new Map<number, { entries: Entry[]; resolve: (r: Response) => void; reject: (e: Error) => void }>();
  private fatal?: Error;

  private constructor(socket: Socket, timeout: number) {
    this.socket = socket;
    this.timeout = timeout;
    socket.on('data', (d) => this.onData(d));
    socket.on('error', (e) => this.fail(e));
    socket.on('close', () => this.fail(new LdapError('ldap: the directory closed the connection')));
  }

  static open(provider: LdapProvider): Promise<LdapConnection> {
    let url: URL;
    try {
      url = new URL(provider.url);
    } catch {
      throw new LdapError(`ldap: "${provider.url}" is not a valid LDAP URL`);
    }
    const tls = url.protocol === 'ldaps:';
    if (!tls && url.protocol !== 'ldap:') throw new LdapError(`ldap: "${provider.url}" must start with ldap:// or ldaps://`);
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
    const port = Number(url.port) || (tls ? 636 : 389);
    const timeout = (provider.timeout ?? 10) * 1000;
    // The directory is one an administrator chose, on the network or not; the metadata range is never reached, and a name is checked on the lookup the connection uses.
    const refused = hostRefusal({ private: true }, host);
    if (refused) throw new LdapError(`ldap: ${refused}`);
    const lookup = socketLookup({ private: true });
    return new Promise((resolve, reject) => {
      const socket = tls
        ? tlsConnect({ host, port, servername: host, lookup, rejectUnauthorized: provider.tlsRejectUnauthorized ?? true })
        : netConnect({ host, port, lookup });
      const onError = (e: Error) => { cleanup(); reject(new LdapError(`ldap: can't reach ${host}:${port} (${e.message})`)); };
      const onTimeout = () => { cleanup(); socket.destroy(); reject(new LdapError(`ldap: ${host}:${port} did not answer in time`)); };
      const ready = tls ? 'secureConnect' : 'connect';
      const onReady = () => { socket.setTimeout(0); cleanup(); resolve(new LdapConnection(socket, timeout)); };
      const cleanup = () => { socket.off('error', onError); socket.off('timeout', onTimeout); socket.off(ready, onReady); };
      socket.setTimeout(timeout, onTimeout);
      socket.once('error', onError);
      socket.once(ready, onReady);
    });
  }

  /** A simple bind; resolves true on success, false on invalid credentials, throws on anything else. */
  async bind(dn: string, password: string): Promise<boolean> {
    const req = seq(APP.bindRequest, int(3), octet(dn), octet(password, CTX.simpleAuth));
    const r = await this.request(req);
    if (r.resultCode === 0) return true;
    if (r.resultCode === 49) return false; // invalidCredentials
    throw new LdapError(`ldap: bind failed (${resultName(r.resultCode)}${r.message ? `: ${r.message}` : ''})`);
  }

  /** Searches and returns the first matching entry, if any. */
  async searchOne(base: string, scope: keyof typeof SCOPE, filter: string, attributes: string[]): Promise<Entry | undefined> {
    const req = seq(
      APP.searchRequest,
      octet(base), enumerated(SCOPE[scope]), enumerated(0 /* neverDerefAliases */),
      int(1 /* sizeLimit: one is enough */), int(Math.ceil(this.timeout / 1000)), bool(false /* typesOnly */),
      parseFilter(filter),
      seq(TAG.sequence, ...attributes.map((a) => octet(a))),
    );
    const r = await this.request(req);
    if (r.resultCode !== 0 && r.resultCode !== 4 /* sizeLimitExceeded, expected */) {
      throw new LdapError(`ldap: search failed (${resultName(r.resultCode)}${r.message ? `: ${r.message}` : ''})`);
    }
    return r.entries[0];
  }

  close(): void {
    if (this.socket.destroyed) return;
    try {
      this.socket.write(frame(this.nextId++, Buffer.from([APP.unbindRequest, 0x00])));
    } catch { /* closing anyway */ }
    this.socket.end();
  }

  private request(op: Buffer): Promise<Response> {
    if (this.fatal) return Promise.reject(this.fatal);
    const id = this.nextId++;
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new LdapError('ldap: the directory did not answer in time')); }, this.timeout);
      this.waiting.set(id, {
        entries: [],
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.socket.write(frame(id, op));
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const total = messageLength(this.buffer);
      if (total !== undefined && total > MAX_MESSAGE) {
        this.fail(new LdapError('ldap: the directory sent a message too large to read'));
        return;
      }
      if (total === undefined || this.buffer.length < total) return;
      const message = this.buffer.subarray(0, total);
      this.buffer = this.buffer.subarray(total);
      try {
        this.dispatch(message);
      } catch (e) {
        this.fail(e instanceof Error ? e : new LdapError('ldap: a malformed message'));
        return;
      }
    }
  }

  private dispatch(message: Buffer): void {
    const r = new Reader(message);
    r.expect(TAG.sequence);
    const id = r.int();
    const op = r.peek();
    const w = this.waiting.get(id);
    if (!w) { r.skip(); return; }
    if (op === APP.searchResEntry) {
      w.entries.push(readEntry(r));
    } else if (op === APP.searchResDone || op === APP.bindResponse) {
      this.waiting.delete(id);
      const res = readResult(r);
      w.resolve({ ...res, entries: w.entries });
    } else {
      r.skip(); // referral or extended response we don't use
    }
  }

  private fail(e: Error): void {
    if (this.fatal) return;
    this.fatal = e;
    for (const w of this.waiting.values()) w.reject(e);
    this.waiting.clear();
  }
}

interface Response { resultCode: number; message: string; entries: Entry[]; }

export class LdapError extends Error {}
/** The most one reply may hold; a directory's answer to a search is far below it. */
const MAX_MESSAGE = 16 * 1024 * 1024;

// --- BER encoding ----------------------------------------------------------

const TAG = { bool: 0x01, int: 0x02, octet: 0x04, enumerated: 0x0a, sequence: 0x30, set: 0x31 } as const;
// [APPLICATION n], constructed (0x40 | 0x20 | n), except unbind which is primitive.
const APP = { bindRequest: 0x60, bindResponse: 0x61, unbindRequest: 0x42, searchRequest: 0x63, searchResEntry: 0x64, searchResDone: 0x65 } as const;
// context-specific: simple auth [0] primitive (0x80), present filter [7] primitive (0x87).
const CTX = { simpleAuth: 0x80 } as const;

function lengthBytes(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), lengthBytes(value.length), value]);
}

function int(n: number, tag: number = TAG.int): Buffer {
  const bytes: number[] = [];
  let v = n;
  do { bytes.unshift(v & 0xff); v = Math.floor(v / 256); } while (v > 0);
  if (bytes[0] & 0x80) bytes.unshift(0); // keep it non-negative
  return tlv(tag, Buffer.from(bytes));
}

const enumerated = (n: number) => int(n, TAG.enumerated);
const octet = (s: string, tag: number = TAG.octet) => tlv(tag, Buffer.from(s, 'utf8'));
const bool = (b: boolean) => tlv(TAG.bool, Buffer.from([b ? 0xff : 0x00]));
const seq = (tag: number, ...parts: Buffer[]) => tlv(tag, Buffer.concat(parts));

function frame(id: number, op: Buffer): Buffer {
  return seq(TAG.sequence, int(id), op);
}

/**
 * Builds BER for a small LDAP filter: a bare "(attr=value)" equality, or
 * "(objectClass=*)" as a present test. Just enough for our two searches.
 */
function parseFilter(filter: string): Buffer {
  const m = /^\(([A-Za-z0-9.;-]+)=(.*)\)$/.exec(filter.trim());
  if (!m) throw new LdapError(`ldap: unsupported filter "${filter}"`);
  const [, attr, value] = m;
  if (value === '*') return octet(attr, 0x87); // present [7]
  return seq(0xa3 /* equalityMatch [3] */, octet(attr), octet(unescapeFilterValue(value)));
}

// --- BER decoding ----------------------------------------------------------

/** The full byte length of the LDAP message at the front of `buf`, or undefined if it isn't all here yet. */
function messageLength(buf: Buffer): number | undefined {
  if (buf.length < 2) return undefined;
  let i = 1;
  let len = buf[i++];
  if (len & 0x80) {
    const count = len & 0x7f;
    if (count === 0 || count > 4) return undefined; // indefinite/absurd length: LDAP doesn't use it
    if (buf.length < i + count) return undefined;
    len = 0;
    for (let j = 0; j < count; j++) len = len * 256 + buf[i++];
  }
  return i + len;
}

class Reader {
  private readonly buf: Buffer;
  private pos: number;

  constructor(buf: Buffer, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }

  peek(): number { return this.buf[this.pos]; }

  private readLength(): number {
    let len = this.buf[this.pos++];
    if (len & 0x80) {
      const count = len & 0x7f;
      // A length of more than four bytes is past anything a reply holds, and a length that reaches past the bytes
      // left cannot be read: either would otherwise be a loop of billions or a read of nothing.
      if (count > 4 || this.pos + count > this.buf.length) throw new LdapError('ldap: the reply has a length it cannot hold');
      len = 0;
      for (let j = 0; j < count; j++) len = len * 256 + this.buf[this.pos++];
    }
    if (!(len <= this.buf.length - this.pos)) throw new LdapError('ldap: the reply has a length past its end');
    return len;
  }

  expect(tag: number): number {
    if (this.buf[this.pos] !== tag) throw new LdapError(`ldap: expected tag ${tag.toString(16)}, got ${this.buf[this.pos]?.toString(16)}`);
    this.pos++;
    return this.readLength();
  }

  /** Skips the current TLV. */
  skip(): void {
    this.pos++;
    const len = this.readLength();
    this.pos += len;
  }

  int(): number {
    const len = this.expect(TAG.int);
    if (len > 8) throw new LdapError('ldap: the reply has an integer too long to read');
    let n = 0;
    for (let j = 0; j < len; j++) n = n * 256 + this.buf[this.pos++];
    return n;
  }

  enumerated(): number {
    const len = this.expect(TAG.enumerated);
    if (len > 8) throw new LdapError('ldap: the reply has an integer too long to read');
    let n = 0;
    for (let j = 0; j < len; j++) n = n * 256 + this.buf[this.pos++];
    return n;
  }

  octet(tag: number = TAG.octet): string {
    const len = this.expect(tag);
    const s = this.buf.toString('utf8', this.pos, this.pos + len);
    this.pos += len;
    return s;
  }

  /** Enters a constructed value, returning a reader bounded to its contents. */
  enter(tag: number): Reader {
    const len = this.expect(tag);
    const inner = new Reader(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return inner;
  }

  get done(): boolean { return this.pos >= this.buf.length; }
}

function readResult(r: Reader): { resultCode: number; message: string } {
  r.expect(r.peek()); // the [APPLICATION n] wrapper (bindResponse/searchResDone)
  const resultCode = r.enumerated();
  r.octet(); // matchedDN
  const message = r.octet(); // diagnosticMessage
  return { resultCode, message };
}

function readEntry(r: Reader): Entry {
  const body = r.enter(APP.searchResEntry);
  const dn = body.octet();
  const attributes: Record<string, string[]> = {};
  const attrs = body.enter(TAG.sequence);
  while (!attrs.done) {
    const attr = attrs.enter(TAG.sequence);
    const name = attr.octet().toLowerCase();
    const values: string[] = [];
    const set = attr.enter(TAG.set);
    while (!set.done) values.push(set.octet());
    attributes[name] = values;
  }
  return { dn, attributes };
}

// --- escaping --------------------------------------------------------------

/** RFC 4514: escape a value put into a DN (for the bind DN template). */
function escapeDn(v: string): string {
  return v
    .replace(/([\\",+;<>=])/g, '\\$1')
    .replace(/^ /, '\\ ').replace(/ $/, '\\ ').replace(/^#/, '\\#');
}

function unescapeDnValue(v: string): string {
  return v.replace(/\\([\\",+;<>=# ]|[0-9a-fA-F]{2})/g, (_, c) => (c.length === 2 ? String.fromCharCode(parseInt(c, 16)) : c));
}

/** RFC 4515: escape a value put into a search filter, so a name can't inject filter syntax. */
function escapeFilter(v: string): string {
  return v.replace(/[\\*()\0]/g, (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

function unescapeFilterValue(v: string): string {
  return v.replace(/\\([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function resultName(code: number): string {
  return RESULT_CODES[code] ?? `code ${code}`;
}

const RESULT_CODES: Record<number, string> = {
  0: 'success', 1: 'operationsError', 2: 'protocolError', 4: 'sizeLimitExceeded',
  7: 'authMethodNotSupported', 8: 'strongerAuthRequired', 32: 'noSuchObject',
  48: 'inappropriateAuthentication', 49: 'invalidCredentials', 50: 'insufficientAccessRights',
  51: 'busy', 52: 'unavailable', 53: 'unwillingToPerform',
};
