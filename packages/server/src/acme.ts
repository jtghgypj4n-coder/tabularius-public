// HTTPS out of the box: certificates from Let's Encrypt (or any ACME
// certificate authority, RFC 8555), got when the server first starts and
// renewed by itself a month before they run out.
//
//   tabularius serve <folder> --https files.example.com --host 0.0.0.0
//
// The authority checks the server owns the name by fetching a token from it
// over plain HTTP on port 80 (the http-01 challenge), so the name must point
// at this machine and port 80 must reach it. That port also sends everything
// else on to https. Keys and certificates are kept in <folder>/.openhbam-tls.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, X509Certificate, type KeyObject } from 'node:crypto';
import type { Server } from 'node:http';
import { createEdgeServer } from './edge-limits.ts';
import { guardedFetch } from '../../scripts/src/net-guard.ts';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTlsPair, writeTlsPair } from './tls-pair.ts';
import { urlHostname } from './public-origin.ts';

export const LETS_ENCRYPT = 'https://acme-v02.api.letsencrypt.org/directory';
export const LETS_ENCRYPT_STAGING = 'https://acme-staging-v02.api.letsencrypt.org/directory';
const TLS_DIR = '.openhbam-tls';
/** Renew when fewer days than this are left. */
const RENEW_DAYS = 30;

export interface AcmeOptions {
  /** Names the certificate is for; they must point at this machine. */
  domains: string[];
  /** Where the authority sends expiry warnings. */
  email?: string;
  /** The authority's directory URL (default Let's Encrypt). */
  directory?: string;
  /** Port the authority checks on (default 80); everything else there is sent on to https. */
  httpPort?: number;
  /** Where the https server listens, for those redirects (default 443: no port in the address). */
  httpsPort?: number;
  /** Address the port-80 listener binds to (default all). */
  hostname?: string;
  log?: (m: string) => void;
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

// --- DER, just enough for a certificate request ------------------------------

function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const n = body.length;
  const len = n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : n < 0x10000 ? Buffer.from([0x82, n >> 8, n & 0xff]) : Buffer.from([0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), len, body]);
}

function oid(text: string): Buffer {
  const [a, b, ...rest] = text.split('.').map(Number);
  const bytes = [40 * a + b];
  for (const n of rest) {
    const groups = [n & 0x7f];
    for (let v = n >>> 7; v; v >>>= 7) groups.unshift((v & 0x7f) | 0x80);
    bytes.push(...groups);
  }
  return der(0x06, Buffer.from(bytes));
}

const seq = (...p: Buffer[]) => der(0x30, ...p);
const set = (...p: Buffer[]) => der(0x31, ...p);

/** A PKCS#10 certificate request for the names, signed with the certificate's key (DER). */
export function certificateRequest(key: KeyObject, domains: string[]): Buffer {
  const subject = seq(set(seq(oid('2.5.4.3'), der(0x0c, Buffer.from(domains[0])))));
  const san = seq(...domains.map((d) => der(0x82, Buffer.from(d))));
  const extensions = seq(seq(oid('2.5.29.17'), der(0x04, san)));
  const attributes = der(0xa0, seq(oid('1.2.840.113549.1.9.14'), set(extensions)));
  const info = seq(der(0x02, Buffer.from([0])), subject, createPublicKey(key).export({ type: 'spki', format: 'der' }), attributes);
  const signature = sign('sha256', info, key);
  return seq(info, seq(oid('1.2.840.10045.4.3.2')), der(0x03, Buffer.from([0]), signature));
}

// --- the ACME protocol --------------------------------------------------------

interface Directory {
  newNonce: string;
  newAccount: string;
  newOrder: string;
}

class AcmeError extends Error {}

// The certificate authority's address is one an administrator chose (a private CA on the network is normal), but it goes
// through the shared outbound guard like every other request the server makes.
const ACME_NET = { policy: { private: true }, timeoutMs: 60_000, maxBytes: 16 * 1024 * 1024 } as const;

export class AcmeClient {
  private readonly accountKey: KeyObject;
  private readonly directoryUrl: string;
  private directory?: Directory;
  private nonce?: string;
  private kid?: string;
  private readonly jwk: Record<string, string>;

  constructor(accountKey: KeyObject, directoryUrl: string) {
    this.accountKey = accountKey;
    this.directoryUrl = directoryUrl;
    const { crv, kty, x, y } = accountKey.export({ format: 'jwk' }) as Record<string, string>;
    this.jwk = { crv, kty, x, y };
  }

  /** The key authorization for a challenge token: what the server shows at its http-01 address. */
  keyAuthorization(token: string): string {
    // RFC 7638: the key's required members, in order, without spaces.
    const thumbprint = createHash('sha256').update(JSON.stringify({ crv: this.jwk.crv, kty: this.jwk.kty, x: this.jwk.x, y: this.jwk.y })).digest();
    return `${token}.${b64u(thumbprint)}`;
  }

  private async dir(): Promise<Directory> {
    if (!this.directory) {
      const res = await guardedFetch(this.directoryUrl, {}, ACME_NET);
      if (!res.ok) throw new AcmeError(`the certificate authority's directory answered ${res.status}`);
      this.directory = await res.json() as Directory;
    }
    return this.directory;
  }

  private async freshNonce(): Promise<string> {
    if (this.nonce) {
      const n = this.nonce;
      this.nonce = undefined;
      return n;
    }
    const res = await guardedFetch((await this.dir()).newNonce, { method: 'HEAD' }, ACME_NET);
    const n = res.headers.get('replay-nonce');
    if (!n) throw new AcmeError('no nonce from the certificate authority');
    return n;
  }

  /** A signed request (payload undefined: POST-as-GET). Retries once on a stale nonce. */
  async post(url: string, payload: unknown, retry = true): Promise<Response> {
    const header: Record<string, unknown> = { alg: 'ES256', nonce: await this.freshNonce(), url };
    if (this.kid) header.kid = this.kid;
    else header.jwk = this.jwk;
    const protectedB64 = b64u(JSON.stringify(header));
    const payloadB64 = payload === undefined ? '' : b64u(JSON.stringify(payload));
    const signature = sign('sha256', Buffer.from(`${protectedB64}.${payloadB64}`), { key: this.accountKey, dsaEncoding: 'ieee-p1363' });
    const res = await guardedFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/jose+json' },
      body: JSON.stringify({ protected: protectedB64, payload: payloadB64, signature: b64u(signature) }),
    }, ACME_NET);
    this.nonce = res.headers.get('replay-nonce') ?? undefined;
    if (!res.ok) {
      const problem = await res.json().catch(() => ({})) as { type?: string; detail?: string };
      if (retry && problem.type === 'urn:ietf:params:acme:error:badNonce') return this.post(url, payload, false);
      throw new AcmeError(`${problem.detail ?? `the certificate authority answered ${res.status}`}${problem.type ? ` (${problem.type.replace('urn:ietf:params:acme:error:', '')})` : ''}`);
    }
    return res;
  }

  /** Registers the account key (or finds its account), agreeing to the authority's terms. */
  async account(email?: string): Promise<void> {
    if (this.kid) return;
    const res = await this.post((await this.dir()).newAccount, { termsOfServiceAgreed: true, ...(email ? { contact: [`mailto:${email}`] } : {}) });
    const kid = res.headers.get('location');
    if (!kid) throw new AcmeError('the certificate authority gave no account address');
    this.kid = kid;
  }

  private async poll<T extends { status: string }>(url: string, done: (x: T) => boolean, what: string): Promise<T> {
    for (let i = 0; i < 60; i++) {
      const res = await this.post(url, undefined);
      const x = await res.json() as T & { error?: { detail?: string }; challenges?: { error?: { detail?: string } }[] };
      if (done(x)) return x;
      if (x.status === 'invalid') {
        const detail = x.error?.detail ?? x.challenges?.find((c) => c.error)?.error?.detail;
        throw new AcmeError(`${what} failed${detail ? `: ${detail}` : ''}`);
      }
      const wait = Number(res.headers.get('retry-after')) || 1;
      await new Promise((r) => setTimeout(r, Math.min(wait, 10) * 1000));
    }
    throw new AcmeError(`${what} took too long`);
  }

  /**
   * Orders a certificate for the names: proves each with an http-01
   * challenge (`publish` shows a token's key authorization, `unpublish` takes
   * it away), then sends the certificate request. Returns the PEM chain.
   */
  async certificate(domains: string[], certKey: KeyObject, publish: (token: string, value: string) => void, unpublish: (token: string) => void): Promise<string> {
    const orderRes = await this.post((await this.dir()).newOrder, { identifiers: domains.map((value) => ({ type: 'dns', value })) });
    const orderUrl = orderRes.headers.get('location');
    const order = await orderRes.json() as { status: string; authorizations: string[]; finalize: string; certificate?: string };
    if (!orderUrl) throw new AcmeError('the certificate authority gave no order address');
    for (const authUrl of order.authorizations) {
      const auth = await (await this.post(authUrl, undefined)).json() as { status: string; identifier: { value: string }; challenges: { type: string; url: string; token: string }[] };
      if (auth.status === 'valid') continue;
      const challenge = auth.challenges.find((c) => c.type === 'http-01');
      if (!challenge) throw new AcmeError(`no http-01 challenge offered for ${auth.identifier.value}`);
      publish(challenge.token, this.keyAuthorization(challenge.token));
      try {
        await this.post(challenge.url, {});
        await this.poll(authUrl, (a) => a.status === 'valid', `proving ${auth.identifier.value} is this server`);
      } finally {
        unpublish(challenge.token);
      }
    }
    await this.poll<typeof order>(orderUrl, (o) => o.status === 'ready' || o.status === 'valid', 'the order');
    await this.post(order.finalize, { csr: b64u(certificateRequest(certKey, domains)) });
    const done = await this.poll<typeof order>(orderUrl, (o) => o.status === 'valid' && !!o.certificate, 'issuing the certificate');
    return (await this.post(done.certificate!, undefined)).text();
  }
}

// --- keeping a certificate ----------------------------------------------------

export interface Certificate {
  cert: string;
  key: string;
  /** When it runs out (epoch ms). */
  expires: number;
}

/**
 * What the admin console and metrics show of an automatic certificate: an
 * AutoTls, or in a worker of a cluster, what the front process (which holds
 * the AutoTls) last told it.
 */
export interface CertificateState {
  readonly opts: { readonly domains: string[] };
  readonly current?: Certificate;
  readonly problem?: string;
}

function readKey(path: string): KeyObject {
  if (existsSync(path)) return createPrivateKey(readFileSync(path));
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  writeFileSync(path + '.tmp', privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  renameSync(path + '.tmp', path);
  return privateKey;
}

/**
 * Gets, keeps and renews the server's certificate, and runs the port-80
 * listener that answers the authority's checks and sends people on to https.
 */
export class AutoTls implements CertificateState {
  readonly opts: AcmeOptions;
  private readonly dir: string;
  private readonly log: (m: string) => void;
  private readonly tokens = new Map<string, string>();
  private http?: Server;
  private timer?: NodeJS.Timeout;
  private renewing?: Promise<Certificate>;
  current?: Certificate;
  /** Called with each new certificate (the https server swaps it in). */
  onRenew?: (c: Certificate) => void;
  /** Called when a renewal fails (the old certificate stays in use). */
  onProblem?: (problem: string) => void;
  /** The last renewal problem, if it is still unsolved. */
  problem?: string;
  /** Where the https server listens, for redirects (443: none in the address). */
  httpsPort: number;

  constructor(folder: string, opts: AcmeOptions) {
    if (!opts.domains.length) throw new Error('https: give at least one name');
    for (const d of opts.domains) {
      if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(d)) throw new Error(`https: "${d}" is not a host name`);
    }
    this.opts = opts;
    this.httpsPort = opts.httpsPort ?? 443;
    this.dir = join(folder, TLS_DIR);
    this.log = opts.log ?? (() => {});
  }

  private get pairPath(): string {
    return join(this.dir, this.opts.domains[0]);
  }

  /** The certificate on disk, if it covers the names. */
  private stored(): Certificate | undefined {
    const pair = readTlsPair(this.pairPath);
    if (!pair) return undefined;
    const x = new X509Certificate(pair.cert);
    if (Date.parse(x.validFrom) > Date.now()) return undefined;
    if (!this.opts.domains.every((d) => x.checkHost(d))) return undefined;
    return { ...pair, expires: Date.parse(x.validTo) };
  }

  /** Starts the port-80 listener, then gets a certificate unless a good one is kept. */
  async start(): Promise<Certificate> {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    await this.listen();
    const kept = this.stored();
    this.current = kept && kept.expires > Date.now() + 86_400_000 ? kept : await this.renew();
    this.timer = setInterval(() => void this.renewIfDue(), 12 * 3_600_000);
    this.timer.unref();
    return this.current;
  }

  stop(): void {
    clearInterval(this.timer);
    this.http?.close();
    this.http?.closeAllConnections();
  }

  /** Renews when fewer than 30 days are left (as of `now`). */
  async renewIfDue(now = Date.now()): Promise<boolean> {
    if (this.current && this.current.expires - now > RENEW_DAYS * 86_400_000) return false;
    try {
      await this.renew();
      return true;
    } catch (e) {
      // The old certificate keeps working until it runs out; try again next time.
      this.problem = (e as Error).message;
      this.log(`renewing the certificate failed: ${this.problem}`);
      this.onProblem?.(this.problem);
      return false;
    }
  }

  /** Gets a new certificate now. */
  renew(): Promise<Certificate> {
    this.renewing ??= this.order().finally(() => {
      this.renewing = undefined;
    });
    return this.renewing;
  }

  private async order(): Promise<Certificate> {
    const names = this.opts.domains.join(', ');
    this.log(`getting a certificate for ${names} from ${new URL(this.opts.directory ?? LETS_ENCRYPT).host}`);
    const client = new AcmeClient(readKey(join(this.dir, 'account.key')), this.opts.directory ?? LETS_ENCRYPT);
    await client.account(this.opts.email);
    // A new key with each certificate.
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const chain = await client.certificate(this.opts.domains, privateKey, (t, v) => this.tokens.set(t, v), (t) => this.tokens.delete(t));
    const key = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const x = new X509Certificate(chain);
    if (Date.parse(x.validFrom) > Date.now() || Date.parse(x.validTo) <= Date.now()
      || !this.opts.domains.every((d) => x.checkHost(d))) throw new Error('The issued certificate is not valid for the requested names');
    writeTlsPair(this.pairPath, { key, cert: chain });
    this.current = { cert: chain, key, expires: Date.parse(x.validTo) };
    this.problem = undefined;
    this.log(`certificate for ${names} until ${new Date(this.current.expires).toISOString().slice(0, 10)}`);
    this.onRenew?.(this.current);
    return this.current;
  }

  private listen(): Promise<void> {
    this.http = createEdgeServer((req, res) => {
      const httpsPort = this.httpsPort;
      const m = /^\/\.well-known\/acme-challenge\/([A-Za-z0-9_-]+)$/.exec(req.url ?? '');
      if (m) {
        const value = this.tokens.get(m[1]);
        if (value) res.writeHead(200, { 'content-type': 'text/plain' }).end(value);
        else res.writeHead(404).end();
        return;
      }
      // Everything else goes to https, under a name the certificate covers.
      const asked = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
      const host = this.opts.domains.find((d) => d.toLowerCase() === asked) ?? this.opts.domains[0];
      res.writeHead(301, { location: `https://${urlHostname(host)}${httpsPort === 443 ? '' : ':' + httpsPort}${req.url ?? '/'}` }).end();
    });
    return new Promise((resolve, reject) => {
      this.http!.once('error', (e: NodeJS.ErrnoException) => reject(e.code === 'EACCES'
        ? new Error(`https: port ${this.opts.httpPort ?? 80} needs administrator rights (on Linux: sudo setcap cap_net_bind_service=+ep $(which node))`)
        : e));
      this.http!.listen(this.opts.httpPort ?? 80, this.opts.hostname, () => resolve());
    });
  }

  /** Where the port-80 listener ended up (for tests that pick port 0). */
  httpPort(): number | undefined {
    const a = this.http?.address();
    return typeof a === 'object' && a ? a.port : undefined;
  }
}
