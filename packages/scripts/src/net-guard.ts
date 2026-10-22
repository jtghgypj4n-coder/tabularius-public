// The one guarded way out of the server. Everything that opens a connection to an address somebody else chose (a script's
// URL, a webhook, an identity provider, an AI endpoint, a plug-in's request) goes through here, so the rules are written
// once:
//
//   - The address a request is made to is checked after the name is resolved, and the connection is made to the address
//     that was checked (the resolver is the socket's own lookup), so a name that answers differently a second time can't
//     slip past.
//   - Link-local, cloud-metadata, unspecified, multicast and reserved addresses are never reached, whatever the policy.
//   - Loopback, private (RFC 1918, carrier-grade NAT, unique-local) and similar addresses are reached only where the
//     policy allows it: always for a destination an administrator typed in (a webhook, an identity provider, an S3
//     endpoint), and for a destination a script chooses only for the hosts and ranges an administrator listed.
//   - Redirects are followed by hand, each hop checked again; a hop to another origin carries none of the request's
//     headers; a body is cut off at a size and a request at a time.
//   - Addresses are read the way the URL parser reads them: 0x7f.1, 2130706433, 017700000001 and [::ffff:7f00:1] are all
//     127.0.0.1, and are refused (or allowed) as such.
//
// It makes the request with node:http(s) rather than fetch because only the socket's own lookup can be made to check the
// address that is then connected to. The Response it returns is an ordinary one.

import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import { PassThrough, type Readable, Transform, pipeline } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { AsyncLocalStorage } from 'node:async_hooks';

/** A request the guard would not make: the reason is for whoever asked, and holds no secret. */
export class OutboundRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundRefused';
  }
}

/** How a name is resolved before it is connected to: swappable for tests. */
export const NAME_LOOKUP = {
  lookup: ((host, opts) => new Promise((resolve, reject) => dnsLookup(host, { all: opts.all }, (error, addresses) => (error ? reject(error) : resolve(addresses as { address: string; family?: number }[]))))) as (host: string, opts: { all: true }) => Promise<{ address: string; family?: number }[]>,
};

// --- addresses ----------------------------------------------------------------------------------------------

/**
 * `never`: link-local (where clouds keep credentials), metadata services, the unspecified address, multicast and
 * reserved ranges. `own`: loopback and the ranges used inside a network. `public`: everything else.
 */
export type AddressClass = 'never' | 'own' | 'public';

/** The IPv4 address inside an IPv4-mapped IPv6 one, in either spelling (::ffff:1.2.3.4 or ::ffff:102:304). */
export function mappedIPv4(h: string): string | undefined {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (!hex) return undefined;
  const a = parseInt(hex[1], 16);
  const b = parseInt(hex[2], 16);
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}

/** The eight 16-bit groups of an IPv6 address. Scoped addresses are never accepted. */
export function ipv6Groups(address: string): number[] | undefined {
  if (address.includes('%')) return undefined;
  let h = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(h) !== 6) return undefined;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (dotted) h = h.slice(0, dotted.index) + ((+dotted[1] << 8) | +dotted[2]).toString(16) + ':' + ((+dotted[3] << 8) | +dotted[4]).toString(16);
  const [head, tail] = h.split('::');
  const first = head ? head.split(':') : [];
  const last = tail === undefined ? [] : tail ? tail.split(':') : [];
  if (tail === undefined && first.length !== 8) return undefined;
  const fill = tail === undefined ? [] : Array(8 - first.length - last.length).fill('0');
  const groups = [...first, ...fill, ...last].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : undefined;
}

const dottedQuad = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function classifyV4(address: string): AddressClass {
  const [a, b, c] = address.split('.').map(Number);
  if (a === 0) return 'never'; // 0.0.0.0/8: "this network", including the unspecified address
  if (a === 169 && b === 254) return 'never'; // link-local, 169.254.169.254 among it
  if (a === 100 && b === 100 && c === 100 && address === '100.100.100.200') return 'never'; // Alibaba Cloud's metadata service
  if (address === '168.63.129.16') return 'never'; // Azure's wire server
  if (a >= 224) return 'never'; // multicast, reserved and broadcast
  if (a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'own';
  if (a === 100 && b >= 64 && b <= 127) return 'own'; // carrier-grade NAT
  if ((a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19))) return 'own'; // protocol assignments, benchmarking
  return 'public';
}

/** The IPv4 address an IPv6 one carries (mapped, compatible, NAT64 or 6to4), as dotted text. */
function embeddedV4(g: number[]): string | undefined {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeros(5) && g5 === 0xffff) return dottedQuad(g6, g7); // ::ffff:a.b.c.d
  if (zeros(4) && g4 === 0xffff && g5 === 0) return dottedQuad(g6, g7); // ::ffff:0:a.b.c.d, the SIIT translated form
  if (zeros(6) && (g6 !== 0 || g7 > 1)) return dottedQuad(g6, g7); // ::a.b.c.d, the deprecated IPv4-compatible form (not :: or ::1)
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return dottedQuad(g6, g7); // NAT64
  if (g0 === 0x2002) return dottedQuad(g1, g2); // 6to4 carries an IPv4 address after the prefix
  return undefined;
}

/** What kind of address this is. Anything that isn't an address is `never`: it is the caller's job to resolve names first. */
export function classifyAddress(address: string): AddressClass {
  const h = address.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isIP(h) === 4) return classifyV4(h);
  const g = ipv6Groups(h);
  if (!g) return 'never';
  const v4 = embeddedV4(g);
  if (v4) return classifyV4(v4);
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
  if (g.every((x) => x === 0)) return 'never'; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g7 === 1) return 'own'; // ::1
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) { // 64:ff9b:1::/48, local-use NAT64: the IPv4 address sits in bytes 6, 7, 9 and 10 (RFC 6052 skips byte 8)
    const v4 = [g3 >> 8, g3 & 255, g4 & 255, g5 >> 8];
    return v4.some(Boolean) && classifyV4(v4.join('.')) === 'never' ? 'never' : 'own'; // nothing embedded: still this host's own translator
  }
  if (g0 === 0x2001 && g1 === 0) return 'own'; // Teredo
  if ((g0 & 0xffc0) === 0xfe80) return 'never'; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return 'never'; // multicast
  if ((g0 === 0xfd00 && g1 === 0x0ec2) || (g0 === 0xfd20 && g1 === 0x00ce)) return 'never'; // AWS's and Google's IPv6 metadata addresses
  if ((g0 & 0xfe00) === 0xfc00) return 'own'; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfec0) return 'never'; // site-local scope, deprecated
  return 'public';
}

/** Whether an address is this machine's own: 127.0.0.0/8, ::1 and every spelling that carries them. */
export function isLoopbackAddress(address: string): boolean {
  const h = address.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const g = isIP(h) === 6 ? ipv6Groups(h) : undefined;
  const v4 = isIP(h) === 4 ? h : g ? embeddedV4(g) : undefined;
  if (v4) return v4.startsWith('127.');
  return !!g && g.slice(0, 7).every((x) => x === 0) && g[7] === 1;
}

/** Whether a `never` address is the link-local / cloud metadata kind (the others are unspecified, multicast or reserved). */
function linkLocalLike(address: string): boolean {
  const h = address.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const g = isIP(h) === 6 ? ipv6Groups(h) : undefined;
  const v4 = isIP(h) === 4 ? h : g ? embeddedV4(g) : undefined;
  if (v4) {
    const [a, b] = v4.split('.').map(Number);
    return (a === 169 && b === 254) || v4 === '100.100.100.200' || v4 === '168.63.129.16';
  }
  return !!g && ((g[0] & 0xffc0) === 0xfe80 || ((g[0] === 0xfd00 && g[1] === 0x0ec2) || (g[0] === 0xfd20 && g[1] === 0x00ce)));
}

/** The names clouds give their metadata service. */
const METADATA_NAMES = new Set(['metadata', 'instance-data', 'metadata.google.internal', 'metadata.goog', 'instance-data.ec2.internal']);

/** Whether a host (a name or an address) is plainly a cloud metadata or link-local one: what no policy allows. */
export function isInternalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (METADATA_NAMES.has(h)) return true;
  return isIP(h) !== 0 && classifyAddress(h) === 'never';
}

// --- policy -------------------------------------------------------------------------------------------------

/**
 * What a request may reach beyond the public internet. `private: true` reaches the machine's own network (for a
 * destination an administrator typed in); a list reaches only the hosts and ranges on it (for a destination a script
 * chooses). Neither ever reaches a `never` address.
 */
export interface OutboundPolicy {
  private?: boolean | readonly string[];
}

export interface AllowEntry { host?: string; suffix?: string; ip?: string; family?: 4 | 6; prefix?: number; bits?: bigint }

const ipBits = (address: string): { family: 4 | 6; bits: bigint } | undefined => {
  if (isIP(address) === 4) return { family: 4, bits: address.split('.').reduce((n, o) => (n << 8n) | BigInt(o), 0n) };
  const g = ipv6Groups(address);
  return g ? { family: 6, bits: g.reduce((n, x) => (n << 16n) | BigInt(x), 0n) } : undefined;
};

/** The hosts and ranges an administrator listed: "intranet.example", "*.corp.example", "10.1.2.3", "10.0.0.0/8", "fd00::/8". A bad entry throws. */
export function parseAllowList(list: readonly string[]): AllowEntry[] {
  return list.map((raw) => raw.trim()).filter(Boolean).map((entry) => {
    const [written, len, extra] = entry.toLowerCase().split('/');
    if (extra !== undefined) throw new Error(`"${entry}" is not a host name, address or range`);
    const base = written.replace(/^\[|\]$/g, '');
    const parsed = ipBits(base);
    if (parsed) {
      const max = parsed.family === 4 ? 32 : 128;
      if (len !== undefined && !(/^\d{1,3}$/.test(len) && Number(len) <= max)) throw new Error(`"${entry}": the range length is 0 to ${max}`);
      return { family: parsed.family, bits: parsed.bits, prefix: len === undefined ? max : Number(len) };
    }
    if (len !== undefined) throw new Error(`"${entry}" is not a host name, address or range`);
    const name = base.replace(/\.$/, '');
    // A name made only of digits and dots is a mistyped address ("10.1"), which no host name will ever match.
    if (/^[0-9.]+$/.test(name)) throw new Error(`"${entry}" is not a host name, address or range`);
    if (name.startsWith('*.') && /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(name.slice(2))) return { suffix: name.slice(1) };
    if (/^[a-z0-9_]([a-z0-9_.-]*[a-z0-9_])?$/.test(name)) return { host: name };
    throw new Error(`"${entry}" is not a host name, address or range`);
  });
}

function entryMatches(e: AllowEntry, host: string, address: string): boolean {
  if (e.host !== undefined) return host === e.host;
  if (e.suffix !== undefined) return host.endsWith(e.suffix);
  let a = ipBits(address);
  // An IPv4 range also covers the IPv4 address an IPv6 answer carries (::ffff:10.1.2.3).
  if (a?.family === 6 && e.family === 4) {
    const g = ipv6Groups(address.toLowerCase().replace(/^\[|\]$/g, ''));
    const v4 = g && embeddedV4(g);
    if (v4) a = ipBits(v4);
  }
  if (!a || a.family !== e.family) return false;
  const shift = BigInt((e.family === 4 ? 32 : 128) - e.prefix!);
  return a.bits >> shift === e.bits! >> shift;
}

const parsedLists = new WeakMap<readonly string[], AllowEntry[]>();
function allowEntries(list: readonly string[]): AllowEntry[] {
  let parsed = parsedLists.get(list);
  if (!parsed) parsedLists.set(list, (parsed = parseAllowList(list)));
  return parsed;
}

/** Why a request to this address must not be made, or undefined when it may. `host` is the name the address came from. */
export function addressRefusal(policy: OutboundPolicy, host: string, address: string): string | undefined {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (METADATA_NAMES.has(name)) return 'That address leads to the link-local range, where cloud instances keep their credentials';
  const kind = classifyAddress(address);
  if (kind === 'public') return undefined;
  if (kind === 'never') {
    return linkLocalLike(address)
      ? 'That address leads to the link-local range, where cloud instances keep their credentials'
      : 'That address is not an address a request can be sent to (scoped, unspecified, multicast or reserved)';
  }
  const allow = policy.private;
  if (allow === true) return undefined;
  if (Array.isArray(allow) && allowEntries(allow).some((e) => entryMatches(e, name, address))) return undefined;
  return "That address is on this server's own network, which a request from here may not reach unless an administrator allows it";
}

/** The refusal for a host that is written as an address (a name is checked once it is resolved), or undefined. */
export function hostRefusal(policy: OutboundPolicy, hostname: string): string | undefined {
  const h = hostname.replace(/^\[|\]$/g, '');
  if (h.includes('%')) return 'Scoped addresses are not reached';
  if (METADATA_NAMES.has(h.toLowerCase().replace(/\.$/, ''))) return addressRefusal(policy, h, '169.254.169.254');
  return isIP(h) === 0 ? undefined : addressRefusal(policy, h, h);
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address?: string | { address: string; family: number }[], family?: number) => void;
type LookupOptions = { family?: number | string; all?: boolean; hints?: number };

/**
 * A socket `lookup` that resolves the name, refuses it if any address it gives is one the policy won't reach, and hands
 * back only the addresses that were checked. Pass it as the `lookup` of http.request, net.connect or tls.connect.
 */
export function guardedLookup(policy: OutboundPolicy = {}): (hostname: string, options: LookupOptions | LookupCallback, callback?: LookupCallback) => void {
  return (hostname, options, callback) => {
    const done = (typeof options === 'function' ? options : callback)!;
    const opts: LookupOptions = typeof options === 'function' ? {} : options;
    const wanted = Number(opts.family) === 4 || opts.family === 'IPv4' ? 4 : Number(opts.family) === 6 || opts.family === 'IPv6' ? 6 : 0;
    const finish = (list: { address: string; family?: number }[]) => {
      for (const a of list) {
        const why = addressRefusal(policy, hostname, a.address);
        if (why) return done(Object.assign(new OutboundRefused(why), { code: 'EOUTBOUND' }) as NodeJS.ErrnoException);
      }
      const checked = list.map((a) => ({ address: a.address, family: a.family ?? isIP(a.address) })).filter((a) => !wanted || a.family === wanted);
      if (!checked.length) return done(Object.assign(new Error('That host has no usable address'), { code: 'ENOTFOUND' }));
      if (opts.all) return done(null, checked);
      done(null, checked[0].address, checked[0].family);
    };
    if (isIP(hostname) !== 0) return finish([{ address: hostname }]);
    NAME_LOOKUP.lookup(hostname, { all: true }).then(finish, (e) => done(connectionFailure(e)));
  };
}

/** Retain machine-readable failure codes without exposing resolver/socket addresses or TLS certificate names. */
function connectionFailure(error: unknown): NodeJS.ErrnoException {
  const safe: NodeJS.ErrnoException = new Error('The outbound connection could not be made; the error code says why');
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(code)) safe.code = code;
  return safe;
}

/** guardedLookup, typed for the `lookup` option of net.connect, tls.connect and http.request. */
export function socketLookup(policy: OutboundPolicy = {}): LookupFunction {
  return guardedLookup(policy) as unknown as LookupFunction;
}

// --- requests -----------------------------------------------------------------------------------------------

export interface GuardOptions {
  policy?: OutboundPolicy;
  /** Headers and body together, including admission. Script requests are also bounded by TABULARIUS_OUTBOUND_MAX_TIME_MS (default 10 minutes); operator requests may use Infinity. */
  timeoutMs?: number;
  /** The most bytes of response body (after any decompression). Default 2 GiB: callers with their own, smaller cap keep it; Infinity for none. */
  maxBytes?: number;
  /** The most redirects followed. Default 5. */
  maxRedirects?: number;
}

const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_MAX_BYTES = 2 * 1024 ** 3;
const TRANSFER_WINDOW_MS = 15_000;
const MIN_TRANSFER_BYTES_PER_SECOND = 1024;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const NO_BODY = new Set([204, 205, 304]);
/** The headers that may follow a redirect to another origin: none of them carries a credential. */
const SAFE_ACROSS_ORIGINS = new Set(['accept', 'accept-language', 'accept-encoding', 'user-agent', 'range']);

/** Trusted initiating identity at script request sites, retained through signing and connection adapters. Never supplied by script text or inherited by change listeners. */
export const outboundContext = new AsyncLocalStorage<{ file: string; account: string; stop?: AbortSignal }>();

/** One request's lifetime. Explicit links avoid Node 22's quadratic AbortSignal.any bookkeeping on long-lived stops. */
export function outboundDeadline(signals: readonly (AbortSignal | null | undefined)[], timeoutMs = DEFAULT_TIMEOUT_MS): {
  signal: AbortSignal; abort(reason: unknown): void; dispose(): void;
} {
  const controller = new AbortController();
  const configured = Number(process.env.TABULARIUS_OUTBOUND_MAX_TIME_MS);
  const maximum = Number.isFinite(configured) && configured > 0 ? Math.max(1, Math.min(Math.floor(configured), 2 ** 31 - 1)) : 600_000;
  const limit = Math.max(1, Math.min(timeoutMs >= 0 ? timeoutMs : DEFAULT_TIMEOUT_MS, outboundContext.getStore() ? maximum : Infinity));
  const timer = Number.isFinite(limit)
    ? setTimeout(() => controller.abort(new DOMException('The outbound request exceeded its time limit', 'TimeoutError')), limit)
    : undefined;
  timer?.unref();
  const links = new Map<AbortSignal, () => void>();
  for (const source of new Set(signals)) {
    if (!source) continue;
    const abort = () => controller.abort(source.reason);
    if (source.aborted) abort();
    else { source.addEventListener('abort', abort, { once: true }); links.set(source, abort); }
  }
  const dispose = () => {
    clearTimeout(timer);
    for (const [source, abort] of links) source.removeEventListener('abort', abort);
    links.clear();
    controller.signal.removeEventListener('abort', dispose);
  };
  // An unread response still expires at its deadline. Release every source link on abort, even if no
  // reader ever observes the body error; normal consumption/cancellation disposes the lifetime sooner.
  if (controller.signal.aborted) dispose();
  else controller.signal.addEventListener('abort', dispose, { once: true });
  return {
    signal: controller.signal,
    abort: (reason) => controller.abort(reason),
    dispose,
  };
}

type FilePool = { active: number; accounts: Map<string, number>; waiting: Map<string, Set<() => void>> };
const filePools = new Map<string, FilePool>();

/** Eight combined HTTP/HTTPS sockets per file, four per account; FIFO within each account, round-robin between them. */
function reserveOutbound(signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted();
  const identity = outboundContext.getStore();
  if (!identity) return Promise.resolve(() => {}); // Operator webhooks/connections do not share a script tenant's capacity.
  const { file } = identity;
  const account = identity.account.toLowerCase();
  let state = filePools.get(file);
  if (!state) filePools.set(file, state = { active: 0, accounts: new Map(), waiting: new Map() });
  const held = state;
  const prune = () => { if (!held.active && !held.waiting.size) filePools.delete(file); };
  const drain = () => {
    while (held.active < 8) {
      let granted = false;
      for (const [name, queue] of held.waiting) {
        if ((held.accounts.get(name) ?? 0) >= 4) continue;
        const grant = queue.values().next().value!;
        queue.delete(grant);
        held.waiting.delete(name);
        if (queue.size) held.waiting.set(name, queue);
        grant();
        granted = true;
        break;
      }
      if (!granted) break;
    }
    prune();
  };
  return new Promise((resolve, reject) => {
    const abort = () => {
      const queue = held.waiting.get(account);
      queue?.delete(grant);
      if (!queue?.size) held.waiting.delete(account);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
      prune();
    };
    const grant = () => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) { reject(signal.reason); return; }
      held.active++;
      held.accounts.set(account, (held.accounts.get(account) ?? 0) + 1);
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        held.active--;
        const remaining = held.accounts.get(account)! - 1;
        if (remaining) held.accounts.set(account, remaining);
        else held.accounts.delete(account);
        drain();
      });
    };
    const queue = held.waiting.get(account) ?? new Set();
    queue.add(grant);
    held.waiting.set(account, queue);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else drain();
  });
}

class Cap extends Transform {
  private seen = 0;
  private readonly max: number;
  constructor(max: number) {
    super();
    this.max = max;
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, done: (error?: Error | null, data?: Buffer) => void): void {
    this.seen += chunk.length;
    if (this.seen > this.max) return done(new OutboundRefused(`The response is larger than the ${this.max} bytes a request may take in`));
    done(null, chunk);
  }
}

function decoded(res: IncomingMessage): { stream: Readable; encoded: boolean } {
  const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase().trim();
  const through = (t: Transform) => {
    pipeline(res, t, () => {});
    return { stream: t as unknown as Readable, encoded: true };
  };
  if (encoding === 'gzip' || encoding === 'x-gzip') return through(createGunzip());
  if (encoding === 'deflate') return through(createInflate());
  if (encoding === 'br') return through(createBrotliDecompress());
  return { stream: res, encoded: false };
}

/** Cancellation must destroy even an unread stream: returning an iterator before its first next() does not do that. */
function webStream(stream: Readable): ReadableStream<Uint8Array> {
  const iterator = stream[Symbol.asyncIterator]();
  let ended = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await iterator.next();
        if (ended) return;
        if (done) { ended = true; controller.close(); }
        else controller.enqueue(value);
      } catch (error) {
        if (!ended) { ended = true; controller.error(error); }
      }
    },
    async cancel() {
      ended = true;
      stream.destroy();
      await iterator.return?.().catch(() => {});
    },
  }, { highWaterMark: 0 });
}

/** One request to one address, no redirects: the response as it came. */
function once(url: URL, method: string, headers: Headers, body: Buffer | undefined, opts: Required<Pick<GuardOptions, 'maxBytes'>> & {
  policy: OutboundPolicy; signal: AbortSignal; script: boolean; abort(reason: unknown): void;
}): Promise<{ response: Response; settled: Promise<void> }> {
  return new Promise((resolve, reject) => {
    opts.signal.throwIfAborted();
    const why = hostRefusal(opts.policy, url.hostname);
    if (why) return reject(new OutboundRefused(why));
    const send: Record<string, string> = {};
    headers.forEach((v, k) => (send[k] = v));
    if (!('accept-encoding' in send)) send['accept-encoding'] = 'gzip, deflate, br';
    if (!('user-agent' in send)) send['user-agent'] = 'tabularius';
    if (!('accept' in send)) send.accept = '*/*';
    if (body && !('content-length' in send)) send['content-length'] = String(body.length);
    else if (!body && method !== 'GET' && method !== 'HEAD' && !('content-length' in send)) send['content-length'] = '0';
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => { finish = resolve; });
    const options: RequestOptions = { method, headers: send, lookup: socketLookup(opts.policy), agent: false, signal: opts.signal };
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, options, (res) => {
      if (opts.signal.aborted) { res.destroy(); finish(); return reject(opts.signal.reason); }
      const status = res.statusCode ?? 0;
      const out = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        try {
          if (Array.isArray(v)) for (const x of v) out.append(k, x);
          else if (v !== undefined) out.set(k, v);
        } catch {
          // A header the Headers class refuses is dropped, as fetch does.
        }
      }
      const declared = Number(res.headers['content-length']);
      let response: Response;
      // A server can answer with a status no Response can hold (600, say): that is a failed request, never an uncaught error.
      if (status < 200 || status > 599) {
        res.destroy();
        return reject(new TypeError('fetch failed', { cause: new Error(`invalid upstream HTTP status ${status}`) }));
      }
      if (NO_BODY.has(status) || method === 'HEAD') {
        // No body is exposed, so do not drain or decompress an attacker-supplied payload (notably 205).
        // Every request has its own socket: closing it also avoids spending an admission slot on junk.
        res.once('close', finish);
        res.destroy();
        response = new Response(null, { status, statusText: res.statusMessage, headers: out });
      } else {
        const { stream, encoded } = decoded(res);
        if (encoded) {
          out.delete('content-encoding');
          out.delete('content-length');
        } else if (Number.isFinite(declared) && declared > opts.maxBytes) {
          res.destroy();
          finish();
          return reject(new OutboundRefused(`The response is larger than the ${opts.maxBytes} bytes a request may take in`));
        }
        const capped = new PassThrough();
        // pipeline removes its error handlers after buffering a complete response. An unread body can
        // still be destroyed by a later abort; keep that error handled even before its iterator starts.
        // Readers continue to receive the stored stream error through webStream's async iterator.
        capped.on('error', () => {});
        let rateTimer: NodeJS.Timeout | undefined;
        // Operator transfers keep their own limits; event streams can be healthy with sparse events.
        const eventStream = out.get('content-type')?.split(';', 1)[0].trim().toLowerCase() === 'text/event-stream';
        if (opts.script && !eventStream) {
          let received = 0;
          let began = performance.now();
          res.on('data', (chunk: Buffer) => { received += chunk.length; });
          // Count wire bytes in each window, so an early burst cannot fund an indefinitely trickling tail.
          rateTimer = setInterval(() => {
            const now = performance.now();
            if (received * 1000 < MIN_TRANSFER_BYTES_PER_SECOND * (now - began)) {
              opts.abort(new OutboundRefused(`The outbound transfer rate is below ${MIN_TRANSFER_BYTES_PER_SECOND} bytes per second`));
            }
            received = 0;
            began = now;
          }, TRANSFER_WINDOW_MS);
          rateTimer.unref();
          res.once('end', () => clearInterval(rateTimer));
          res.once('close', () => clearInterval(rateTimer));
        }
        const abort = () => capped.destroy(opts.signal.reason as Error);
        const complete = () => {
          clearInterval(rateTimer);
          opts.signal.removeEventListener('abort', abort);
          finish();
        };
        capped.once('end', complete);
        capped.once('close', complete);
        // One pipeline: a reader that gives up, a size over the cap or a dropped connection ends every stage and the socket.
        pipeline(stream, new Cap(opts.maxBytes), capped, () => {});
        opts.signal.addEventListener('abort', abort, { once: true });
        if (opts.signal.aborted) abort();
        response = new Response(webStream(capped), { status, statusText: res.statusMessage, headers: out });
      }
      Object.defineProperty(response, 'url', { value: url.href });
      resolve({ response, settled });
    });
    // 101 emits upgrade instead of response. Without a handler Node closes the socket without
    // settling this promise; even the later deadline then cannot release the admission slot.
    req.once('upgrade', (_res, socket) => {
      socket.destroy();
      finish();
      reject(new OutboundRefused('HTTP protocol upgrades are not supported'));
    });
    req.on('error', (e) => {
      finish();
      if (opts.signal.aborted) return reject(opts.signal.reason);
      const cause = (e as { cause?: unknown }).cause;
      const refused = e instanceof OutboundRefused ? e : cause instanceof OutboundRefused ? cause : undefined;
      if (refused) return reject(refused);
      reject(new TypeError('fetch failed', { cause: connectionFailure(e) }));
    });
    req.end(body);
  });
}

/**
 * What went wrong with a request, in words: the cause's system code (ECONNREFUSED and the like) says it for the program,
 * so a person is told the same thing as a sentence. Unknown fetch failures use generic text; caller errors keep theirs.
 */
export function networkProblem(e: unknown): string {
  const cause = (e as { cause?: unknown } | undefined)?.cause ?? e;
  const code = (cause as { code?: unknown } | undefined)?.code;
  const own = cause instanceof Error ? cause.message : e instanceof Error ? e.message : String(e);
  if (typeof code === 'string') {
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'that address was not found; check the spelling of the host name';
    if (code === 'ECONNREFUSED') return 'the server at that address refused the connection; check that it is running and the port is right';
    if (code === 'ECONNRESET' || code === 'EPIPE') return 'the connection was cut off before an answer arrived; try again';
    if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') return 'the server did not answer in time';
    if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'that address cannot be reached from this server';
    if (/^(CERT_|DEPTH_ZERO|UNABLE_TO_|SELF_SIGNED|ERR_TLS_CERT|ERR_SSL_)/.test(code)) return 'the server\'s certificate was not accepted; check that the address is the one the certificate was issued for';
  }
  if (/^fetch failed$/i.test(own)) return 'the server could not be reached';
  if (own === 'unexpected redirect') return 'the server redirected the request, and this request does not follow redirects';
  if (own === 'too many redirects') return 'the server redirected the request too many times';
  if (e instanceof TypeError && e.message === 'fetch failed') return 'the server could not be reached';
  return own;
}

/** Request.arrayBuffer() does not observe the request's signal while an upload producer is stalled. */
async function requestBody(request: Request, signal: AbortSignal): Promise<Buffer | undefined> {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) abort();
    const chunks: Buffer[] = [];
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) return Buffer.concat(chunks);
      chunks.push(Buffer.from(value));
    }
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

/** Fetch through the guard, with a fresh socket and a sanitized cause/code for connection failures. */
export async function guardedFetch(input: string | URL | Request, init: RequestInit = {}, options: GuardOptions = {}): Promise<Response> {
  const policy = options.policy ?? {};
  // Before Request is made: its own error for an address with a password in it prints the password.
  try {
    const written = new URL(input instanceof Request ? input.url : String(input));
    if (written.username || written.password) throw new OutboundRefused('Put no credentials in the address; send them in a header');
  } catch (e) {
    if (e instanceof OutboundRefused) throw e;
    throw new OutboundRefused('The request address is not a valid URL');
  }
  const source = init.signal !== undefined ? init.signal : input instanceof Request ? input.signal : undefined;
  const identity = outboundContext.getStore();
  const lifetime = outboundDeadline([source, identity?.stop], options.timeoutMs);
  const { signal } = lifetime;
  let release: (() => void) | undefined;
  const dispose = () => { release?.(); lifetime.dispose(); };
  try {
    signal.throwIfAborted();
    // Request must only follow this short-lived signal, never the run's stop signal itself.
    const request = new Request(input, { ...init, signal });
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    let url = new URL(request.url);
    let method = request.method;
    let headers = new Headers(request.headers);
    let body = request.body ? await requestBody(request, signal) : undefined;
    signal.throwIfAborted();
    release = await reserveOutbound(signal);
    signal.throwIfAborted(); // Cancellation may win just after admission, before this continuation.
    for (let hop = 0; ; hop++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new OutboundRefused(`${url.protocol} addresses are not reached (http and https only)`);
      if (url.username || url.password) throw new OutboundRefused('Put no credentials in the address; send them in a header');
      signal.throwIfAborted();
      const { response: res, settled } = await once(url, method, headers, body, { policy, maxBytes, signal, script: !!identity, abort: lifetime.abort });
      const location = res.headers.get('location');
      if (request.redirect === 'manual' || !REDIRECTS.has(res.status) || !location) {
        void settled.then(dispose);
        return res;
      }
      await res.body?.cancel().catch(() => {});
      await settled;
      if (request.redirect === 'error') throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
      if (hop >= (options.maxRedirects ?? 5)) throw new TypeError('fetch failed', { cause: new Error('too many redirects') });
      let next: URL;
      try { next = new URL(location, url); }
      catch { throw new OutboundRefused('The redirect address is not a valid URL'); }
      if (next.origin !== url.origin) {
        const kept = new Headers();
        headers.forEach((v, k) => SAFE_ACROSS_ORIGINS.has(k) && kept.set(k, v));
        headers = kept;
      }
      if (res.status === 303 ? method !== 'GET' && method !== 'HEAD' : (res.status === 301 || res.status === 302) && method === 'POST') {
        method = 'GET';
        body = undefined;
        headers.delete('content-type');
        headers.delete('content-length');
      }
      url = next;
    }
  } catch (error) {
    dispose();
    throw error;
  }
}

/** A fetch that goes through the guard with this policy and these limits: for the places that take a `fetch` to call. */
export function guardedFetcher(options: GuardOptions = {}): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => guardedFetch(input, init, options)) as typeof fetch;
}
