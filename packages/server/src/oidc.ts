import { clientAddress } from './client-address.ts';
// Sign-in through an identity provider (OpenID Connect), like FileMaker's
// external accounts with Microsoft Entra ID, Google, Okta, Apple or another
// OAuth provider. More than one can be set up at once, so the sign-in screen
// can offer, say, Google and Microsoft and Apple side by side.
//
//   GET  /tabularius/auth/v1/providers                      the providers set up, for the sign-in screen
//   GET  /tabularius/auth/v1/oidc/start/<slug>?db=Contacts  redirects to that provider
//   GET  /tabularius/auth/v1/oidc/start?db=Contacts         the sole provider (when only one is set up)
//   GET  /tabularius/auth/v1/oidc/callback?code=&state=     the provider sends people back here
//   POST /tabularius/auth/v1/oidc/callback                  same, for providers that reply with form_post (Apple)
//
// Data API apps sign people in the way FileMaker Server lets them (the Data API
// guide's "Log in to a database session using an OAuth identity provider"):
//
//   GET  /fmws/oauthproviderinfo                          the providers set up
//   GET  /oauth/getoauthurl?trackingID=&provider=         X-FMS-Return-URL: where the app wants the person back;
//                                                         answers the provider's URL to open (the body and the
//                                                         X-FMS-Return-URL header) and X-FMS-Request-ID
//   the person signs in, and is sent back to the app's address with ?trackingID=&identifier= (or &error=)
//   POST /fmi/data/vLatest/databases/{db}/sessions        X-FM-Data-OAuth-Request-Id and X-FM-Data-OAuth-Identifier
//
// The identifier is good once, for five minutes, with its request id. Where
// the person is sent back must be this server's own address or an address the
// provider's dataApiReturnUrls lists (this computer too, for an app on the
// person's own machine, only when listed: on a shared machine such as a
// terminal server anyone could listen there): else a link that started the
// sign-in elsewhere would send someone's identifier to whoever made it. The
// person picks the account at the provider, so a browser already signed in
// there can't finish someone else's link unseen.
//
// The provider vouches for an email address (and, if it sends them, groups).
// As in FileMaker, the file decides what they may do: an external account
// named their email, their email's domain (@example.com), or one of their
// groups, gives its privilege set. Then they get a session like any other web
// client login, handed to the web client in the URL fragment (never sent to a
// server or logged).
//
// The ID token is checked here: its signature against the provider's published
// keys, issuer, audience, expiry and nonce. The code exchange uses PKCE.

import { expiryClock } from '../../store/src/clock.ts';
import { AUTH_BODY_LIMIT } from './request-body.ts';
import { createHash, timingSafeEqual, createPrivateKey, createPublicKey, randomBytes, sign as signJwt, verify as verifySignature, type JsonWebKey } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, readBody as readRaw, type DataApi } from './dataapi.ts';
import type { Host } from './host.ts';
import type { Store } from '../../store/src/index.ts';
import { DatabaseSync } from 'node:sqlite';
import { closeSync, constants, mkdirSync, openSync, lstatSync, statSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { guardedFetch } from '../../scripts/src/net-guard.ts';

/** The identity provider is one an administrator chose (a provider on the network is normal); its requests still go through the shared outbound guard, with a time and size limit. */
const IDP_NET = { policy: { private: true }, timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 } as const;

export interface OidcProvider {
  /** Shown on the sign-in button, e.g. "Microsoft". */
  name: string;
  /** Issuer URL; its /.well-known/openid-configuration describes the rest. */
  issuer: string;
  clientId: string;
  /** For providers that require a secret with the code exchange (confidential clients). */
  clientSecret?: string;
  /** ID token claim listing the person's groups (default "groups"). */
  groupsClaim?: string;
  /** Extra scopes beyond "openid email profile". */
  scopes?: string[];
  /**
   * The provider replies to the callback with an HTTP POST (form_post) rather
   * than a redirect. Apple does this whenever email or name scope is asked for.
   */
  formPost?: boolean;
  /**
   * Apple doesn't take a static client secret: it wants a short-lived ES256 JWT
   * signed with the private key from your Apple developer account. Give the key
   * here and one is generated for each code exchange.
   */
  appleSecret?: { teamId: string; keyId: string; privateKey: string };
  /**
   * Match accounts by the email this provider sends even when its ID token
   * doesn't say the address was verified. Only for a provider that hands out
   * addresses it owns (a company's own identity provider); with one where people
   * can type any address, anyone could sign in as anyone. Google and Apple say
   * when an address is verified, and one organisation's Microsoft Entra tenant
   * is trusted already.
   */
  trustEmail?: boolean;
  /**
   * Data API apps (getoauthurl) that may have people sent back to them after
   * signing in: their origins ("https://app.example.com", "http://127.0.0.1:5000")
   * or address prefixes. This server's own address is always allowed.
   */
  dataApiReturnUrls?: string[];
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface Pending {
  provider: string;
  db: string;
  verifier: string;
  nonce: string;
  redirectUri: string;
  expires: number;
  flow: 'web' | 'ai' | 'data';
  resume?: Resume;
  /** Set when a Data API app started it (getoauthurl): where to send the person back, and the request it answers. */
  dataApi?: { trackingId: string; returnUrl: string; requestId: string };
}

/** Who a provider vouched for in a Data API app's sign-in, until the app logs in with the identifier. */
export interface OAuthGrant {
  identifier: string;
  provider: string;
  /** The email, when it can be trusted to match accounts. */
  email?: string;
  /** The email the provider sent, trusted or not (for saying why a sign-in found no account). */
  claimed?: string;
  groups: string[];
  issuer: string;
  sub: string;
  expires: number;
}

/**
 * What an AI app's sign-in (oauth.ts) does with the person the provider vouches for: answers the browser itself (it
 * shows the person what the app asks for and waits for their say-so), or throws SignInError(message) to show why not. `fail` shows that message on the app's sign-in page.
 */
export interface Resume {
  done(res: ServerResponse, who: { store: Store; via: string; email?: string; issuer: string; sub: string; provider: string; from: string }): void;
  fail(res: ServerResponse, message: string): void;
}

/** Each provider's own discovery and signing-key caches. */
interface ProviderState {
  provider: OidcProvider;
  slug: string;
  discovery?: { value: Discovery; at: number };
  keys?: { value: JsonWebKey[]; at: number };
}

const PENDING_MS = 10 * 60 * 1000;
const GRANT_MS = 5 * 60 * 1000;
const MAX_PENDING = 2000;
const OIDC_DIR = '.openhbam-oidc';
const OIDC_DB = 'pending.sqlite';
const b64url = (b: Buffer) => b.toString('base64url');

/** A URL- and path-safe id for a provider, from its name ("Microsoft Entra" → "microsoft-entra"). */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'provider';
}

export class Oidc {
  private readonly host: Host;
  private readonly api: DataApi;
  private readonly publicUrl?: string;
  private readonly states = new Map<string, ProviderState>();
  private readonly db: DatabaseSync;
  /** Resume handlers are process-local because they hold HTTP response callbacks; cluster routing pins these flows to the leader. */
  private readonly resumes = new Map<string, { resume: Resume; expires: number }>();
  private readonly resumePruner: NodeJS.Timeout;
  readonly storageWarning?: string;
  private closed = false;

  constructor(host: Host, api: DataApi, providers: OidcProvider | OidcProvider[], publicUrl?: string) {
    this.host = host;
    this.api = api;
    this.publicUrl = publicUrl?.replace(/\/$/, '');
    this.storageWarning = oidcHostDirectoryWarning(host.dir);
    const storeDir = secureOidcDirectory(host.dir);
    const file = join(storeDir, OIDC_DB);
    const identity = secureOidcFile(file);
    this.db = new DatabaseSync(file);
    try {
      // SQLite does not expose the inode it opened. Persistent replacements are caught here, but a swap-and-restore
      // around open can evade pathname sampling; see ADMIN.md for this residual race.
      assertSameOidcFile(identity, statSync(file));
      this.db.exec('PRAGMA busy_timeout = 100; PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS pending (state TEXT PRIMARY KEY, provider TEXT NOT NULL, database TEXT NOT NULL, verifier TEXT NOT NULL, nonce TEXT NOT NULL, redirect_uri TEXT NOT NULL, expires INTEGER NOT NULL, flow TEXT NOT NULL DEFAULT \'web\', created INTEGER NOT NULL DEFAULT 0)');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const columns = (this.db.prepare('PRAGMA table_info(pending)').all() as { name: string }[]).map((c) => c.name);
        // Old rows have no recorded flow type; fail them closed as AI flows.
        if (!columns.includes('flow')) this.db.exec("ALTER TABLE pending ADD COLUMN flow TEXT NOT NULL DEFAULT 'ai'");
        if (!columns.includes('created')) this.db.exec('ALTER TABLE pending ADD COLUMN created INTEGER NOT NULL DEFAULT 0');
        // A Data API app's sign-in (getoauthurl): where to send the person back, kept with the pending sign-in.
        if (!columns.includes('data_api')) this.db.exec('ALTER TABLE pending ADD COLUMN data_api TEXT');
        // Who the provider vouched for in a Data API app's sign-in, until the app logs in (once, within five minutes).
        this.db.exec('CREATE TABLE IF NOT EXISTS grants (request_id TEXT PRIMARY KEY, identifier TEXT NOT NULL, provider TEXT NOT NULL, email TEXT, claimed TEXT, groups TEXT NOT NULL, sub TEXT NOT NULL, expires INTEGER NOT NULL)');
        const grantColumns = (this.db.prepare('PRAGMA table_info(grants)').all() as { name: string }[]).map((c) => c.name);
        if (!grantColumns.includes('issuer')) this.db.exec("ALTER TABLE grants ADD COLUMN issuer TEXT NOT NULL DEFAULT ''");
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
      secureOidcSidecars(storeDir);
      const initializedAt = expiryClock.now();
      this.pruneResumes(performance.now());
      this.db.prepare('DELETE FROM pending WHERE expires <= ?').run(initializedAt);
      this.db.prepare('DELETE FROM grants WHERE expires <= ?').run(initializedAt);
      this.resumePruner = setInterval(() => {
        if (this.closed) return;
        const now = expiryClock.now();
        this.pruneResumes(performance.now());
        try { this.db.prepare('DELETE FROM pending WHERE expires <= ?').run(now); this.db.prepare('DELETE FROM grants WHERE expires <= ?').run(now); } catch { /* The next request retries pruning. */ }
      }, 60_000);
      this.resumePruner.unref();
      for (const provider of Array.isArray(providers) ? providers : [providers]) {
        let slug = slugify(provider.name);
        for (let i = 2; this.states.has(slug); i++) slug = `${slugify(provider.name)}-${i}`;
        this.states.set(slug, { provider, slug });
      }
    } catch (e) { this.db.close(); throw e; }
  }

  close(): void {
    this.closed = true;
    clearInterval(this.resumePruner);
    this.db.close();
  }

  /** Returns false when the request is not a sign-in path. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname === '/fmws/oauthproviderinfo' && req.method === 'GET') {
      json(res, 200, { data: [...this.states.values()].map((s) => ({ Name: s.provider.name, Slug: s.slug })) });
      return true;
    }
    if (url.pathname === '/oauth/getoauthurl' && req.method === 'GET') {
      try {
        await this.dataApiStart(req, res, url);
      } catch (e) {
        if (!(e instanceof SignInError)) console.error(e);
        json(res, 400, { error: e instanceof SignInError ? e.message : 'Sign-in failed' });
      }
      return true;
    }
    if (!url.pathname.startsWith('/tabularius/auth/v1/')) return false;
    const path = url.pathname.slice('/tabularius/auth/v1/'.length);
    try {
      if (path === 'providers' && req.method === 'GET') {
        json(res, 200, { providers: [...this.states.values()].map((s) => ({ name: s.provider.name, slug: s.slug, start: `/tabularius/auth/v1/oidc/start/${s.slug}` })) });
      } else if ((path === 'oidc/start' || path.startsWith('oidc/start/')) && req.method === 'GET') {
        await this.start(this.pick(path.slice('oidc/start'.length).replace(/^\//, '')), req, res, url);
      } else if (path === 'oidc/callback' && (req.method === 'GET' || req.method === 'POST')) {
        await this.callback(req, res, url);
      } else {
        json(res, 404, { error: 'not found' });
      }
    } catch (e) {
      const message = e instanceof ApiError || e instanceof SignInError ? e.message : isBusy(e) ? 'Sign-in is temporarily unavailable; please try again shortly' : 'Sign-in failed';
      if (!(e instanceof ApiError) && !(e instanceof SignInError)) console.error(e);
      // Back to the web client's sign-in screen, which shows the message.
      res.writeHead(302, { location: `/app/#error=${encodeURIComponent(message)}`, 'cache-control': 'no-store' }).end();
    }
    return true;
  }

  /** The provider state for a slug, or the sole provider when no slug is given. */
  private pick(slug: string): ProviderState {
    if (slug) {
      const s = this.states.get(slug);
      if (!s) throw new SignInError('Unknown sign-in provider');
      return s;
    }
    if (this.states.size !== 1) throw new SignInError('Choose a sign-in provider');
    return this.states.values().next().value!;
  }

  private async start(s: ProviderState, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    await this.redirect(s, url.searchParams.get('db') ?? '', req, res);
  }

  private pruneResumes(now: number): void {
    for (const [state, entry] of this.resumes) if (entry.expires <= now) this.resumes.delete(state);
    while (this.resumes.size > MAX_PENDING) this.resumes.delete(this.resumes.keys().next().value!);
  }

  /**
   * getoauthurl: a Data API app asks for the provider's address to send the
   * person to. The provider is named as on the providers list, or by its slug.
   */
  private async dataApiStart(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const trackingId = url.searchParams.get('trackingID') ?? '';
    if (!trackingId || trackingId.length > 256) throw new SignInError('trackingID is required');
    const asked = (url.searchParams.get('provider') ?? '').toLowerCase();
    const s = [...this.states.values()].find((x) => x.slug === asked || x.provider.name.toLowerCase() === asked) ?? (asked ? undefined : this.pick(''));
    if (!s) throw new SignInError('Unknown sign-in provider');
    const returnUrl = String(req.headers['x-fms-return-url'] ?? '');
    if (!this.returnAllowed(s, returnUrl, this.ownOrigin(req))) throw new SignInError('X-FMS-Return-URL is not an address this server sends people back to (see dataApiReturnUrls)');
    const requestId = b64url(randomBytes(24));
    const auth = await this.authorizeUrl(s, '', req, undefined, { trackingId, returnUrl, requestId });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-fms-request-id': requestId, 'x-fms-return-url': auth }).end(auth);
  }

  /** This server's origin as the request reached it (or as configured). */
  private ownOrigin(req: IncomingMessage): string {
    return new URL(this.publicUrl ?? `${(req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'}://${req.headers.host}`).origin;
  }

  /** Whether people may be sent back to `returnUrl` after a Data API app's sign-in. */
  private returnAllowed(s: ProviderState, returnUrl: string, own: string): boolean {
    let to: URL;
    try {
      to = new URL(returnUrl);
    } catch {
      return false;
    }
    if (to.protocol !== 'https:' && to.protocol !== 'http:') return false;
    if (to.username || to.password) return false;
    // Encoded slashes and dots: an app server that decodes them would route outside a listed path.
    if (/%(?:2f|5c|2e)/i.test(to.pathname)) return false;
    if (to.origin === own) return true;
    return (s.provider.dataApiReturnUrls ?? []).some((allowed) => {
      try {
        const a = new URL(allowed);
        // An origin allows anywhere on it; an address with a path allows that path and below.
        if (a.pathname.length === 1 && !allowed.endsWith('/')) return to.origin === a.origin;
        return to.origin === a.origin && (to.pathname === a.pathname || to.pathname.startsWith(a.pathname.endsWith('/') ? a.pathname : a.pathname + '/'));
      } catch {
        return false;
      }
    });
  }

  /**
   * A Data API app logging in with what getoauthurl and the sign-in gave it:
   * who the provider vouched for, once. Undefined when the pair is unknown,
   * used or too old. The grant lives in the shared sign-in database, so any process serving the folder can take it, once.
   */
  takeGrant(requestId: string, identifier: string): OAuthGrant | undefined {
    let row: { identifier: string; provider: string; email: string | null; claimed: string | null; groups: string; issuer: string; sub: string; expires: number } | undefined;
    try {
      // Used up by any attempt, right or wrong: an identifier can't be guessed at.
      row = this.db.prepare('DELETE FROM grants WHERE request_id = ? RETURNING identifier, provider, email, claimed, groups, issuer, sub, expires').all(requestId)[0] as typeof row;
    } catch {
      return undefined;
    }
    if (!row) return undefined;
    const a = Buffer.from(row.identifier), b = Buffer.from(identifier);
    if (a.length !== b.length || !timingSafeEqual(a, b) || row.expires <= expiryClock.now() || row.expires > expiryClock.now() + GRANT_MS) return undefined;
    let groups: string[];
    try {
      const parsed: unknown = JSON.parse(row.groups);
      if (!Array.isArray(parsed)) return undefined;
      groups = parsed.map(String);
    } catch {
      return undefined;
    }
    return { identifier: row.identifier, provider: row.provider, ...(row.email ? { email: row.email } : {}), ...(row.claimed ? { claimed: row.claimed } : {}), groups, issuer: row.issuer, sub: row.sub, expires: row.expires };
  }

  /** The providers a sign-in page can offer. */
  providers(): { name: string; slug: string }[] {
    return [...this.states.values()].map((s) => ({ name: s.provider.name, slug: s.slug }));
  }

  /** Sends the browser to a provider for an AI app's sign-in; `resume` finishes it when the provider sends the person back. */
  async begin(slug: string, db: string, req: IncomingMessage, res: ServerResponse, resume: Resume): Promise<void> {
    try {
      await this.redirect(this.pick(slug), db, req, res, resume);
    } catch (e) {
      if (!(e instanceof SignInError)) console.error(e);
      resume.fail(res, e instanceof SignInError ? e.message : isBusy(e) ? 'Sign-in is temporarily unavailable; please try again shortly' : 'Sign-in failed');
    }
  }

  private async redirect(s: ProviderState, db: string, req: IncomingMessage, res: ServerResponse, resume?: Resume): Promise<void> {
    // Without a public file list an unknown name goes to the identity provider like a real one, and is refused after the person has signed in there, so the start doesn't confirm which files exist.
    if (!this.host.get(db) && this.host.listFilesPublicly) throw new SignInError(`No hosted database named "${db}"`);
    res.writeHead(302, { location: await this.authorizeUrl(s, db, req, resume), 'cache-control': 'no-store' }).end();
  }

  /** Starts a sign-in: the provider's address to send the person to. */
  private async authorizeUrl(s: ProviderState, db: string, req: IncomingMessage, resume?: Resume, dataApi?: Pending['dataApi']): Promise<string> {
    const d = await this.config(s);
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(32));
    const nonce = b64url(randomBytes(24));
    const base = this.publicUrl ?? `${(req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'}://${req.headers.host}`;
    const redirectUri = `${base}/tabularius/auth/v1/oidc/callback`;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = expiryClock.now();
      this.pruneResumes(performance.now());
      this.db.prepare('DELETE FROM pending WHERE expires <= ?').run(expiryClock.now());
      const count = (this.db.prepare('SELECT COUNT(*) AS n FROM pending').get() as { n: number }).n;
      if (count >= MAX_PENDING) throw new SignInError('Too many sign-ins are in progress; try again in a minute');
      const expires = now + PENDING_MS;
      this.db.prepare('INSERT INTO pending (state,provider,database,verifier,nonce,redirect_uri,expires,flow,created,data_api) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(state, s.slug, db, verifier, nonce, redirectUri, expires, resume ? 'ai' : dataApi ? 'data' : 'web', now, dataApi ? JSON.stringify(dataApi) : null);
      this.db.exec('COMMIT');
      if (resume) this.resumes.set(state, { resume, expires: performance.now() + PENDING_MS });
    } catch (e) {
      this.db.exec('ROLLBACK');
      this.resumes.delete(state);
      throw e;
    }
    try {
      const auth = new URL(d.authorization_endpoint);
      const params: Record<string, string> = {
      response_type: 'code',
      client_id: s.provider.clientId,
      redirect_uri: redirectUri,
      scope: ['openid', 'email', 'profile', ...(s.provider.scopes ?? [])].join(' '),
      state,
      nonce,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      // Apple (and anything using form_post) must be told to POST the result,
      // and only returns the email when name/email scope is asked for.
      ...(s.provider.formPost ? { response_mode: 'form_post' } : {}),
      // For an AI app's or a Data API app's sign-in the person picks the account at the provider, so a browser that is
      // already signed in there can't finish it unseen (an AI app's consent page still follows).
      ...(resume || dataApi ? { prompt: 'select_account' } : {}),
      };
      for (const [k, v] of Object.entries(params)) auth.searchParams.set(k, v);
      return auth.toString();
    } catch (e) {
      this.resumes.delete(state);
      throw e;
    }
  }

  /** Back to the Data API app that started the sign-in, with its tracking id and the identifier or what went wrong. */
  private backToApp(res: ServerResponse, a: NonNullable<Pending['dataApi']>, add: Record<string, string>): void {
    const to = new URL(a.returnUrl);
    to.searchParams.set('trackingID', a.trackingId);
    for (const [k, v] of Object.entries(add)) to.searchParams.set(k, v);
    res.writeHead(302, { location: to.toString(), 'cache-control': 'no-store' }).end();
  }

  private async callback(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    // The result comes in the query string (redirect) or, for form_post, the body.
    const params = req.method === 'POST' ? new URLSearchParams(await readBody(req)) : url.searchParams;
    const state = params.get('state') ?? '';
    const now = expiryClock.now();
    this.pruneResumes(performance.now());
    const row = this.db.prepare('DELETE FROM pending WHERE state = ? AND expires > ? RETURNING provider, database, verifier, nonce, redirect_uri, expires, flow, created, data_api').all(state, now)[0] as { provider: string; database: string; verifier: string; nonce: string; redirect_uri: string; expires: number; flow: 'web' | 'ai' | 'data'; created: number; data_api: string | null } | undefined;
    const resumeEntry = this.resumes.get(state);
    this.resumes.delete(state);
    if (!row) {
      this.db.prepare('DELETE FROM pending WHERE expires <= ?').run(expiryClock.now());
      throw new SignInError('The sign-in took too long or was already used; please try again');
    }
    if (row.expires <= expiryClock.now()) throw new SignInError('The sign-in took too long or was already used; please try again');
    if (row.created > 0 && now < row.created) throw new SignInError('The sign-in expired after a system clock change; please start again');
    if (row.expires > expiryClock.now() + PENDING_MS) throw new SignInError('The sign-in expired after a system clock change; please start again');
    if (row.flow === 'ai' && (!resumeEntry || resumeEntry.expires <= performance.now())) throw new SignInError('This app sign-in expired; please start again');
    const resume = resumeEntry?.resume;
    let dataApi: Pending['dataApi'];
    if (row.flow === 'data') {
      try {
        const parsed = JSON.parse(row.data_api ?? '') as Record<string, unknown>;
        if (typeof parsed.trackingId !== 'string' || typeof parsed.returnUrl !== 'string' || typeof parsed.requestId !== 'string') throw new Error('shape');
        dataApi = { trackingId: parsed.trackingId, returnUrl: parsed.returnUrl, requestId: parsed.requestId };
      } catch {
        throw new SignInError('The sign-in could not be completed; please start again');
      }
      const provider = this.states.get(row.provider);
      // Checked against today's dataApiReturnUrls: an app removed since the sign-in started gets nothing. This
      // server's own address is the one the sign-in started on (its callback address), which in a cluster may be
      // another member's; never this callback's Host, which whoever sends it chooses.
      let own: string;
      try {
        own = new URL(row.redirect_uri).origin;
      } catch {
        throw new SignInError('The sign-in could not be completed; please start again');
      }
      if (!provider || !this.returnAllowed(provider, dataApi.returnUrl, own)) {
        throw new SignInError('This app is no longer allowed to receive sign-in responses; please start again');
      }
    }
    const p: Pending = { provider: row.provider, db: row.database, verifier: row.verifier, nonce: row.nonce, redirectUri: row.redirect_uri, expires: row.expires, flow: row.flow, ...(resume ? { resume } : {}), ...(dataApi ? { dataApi } : {}) };
    // A Data API app's sign-in goes back to the app, whatever happened.
    if (p.dataApi) {
      try {
        await this.finish(p, params, req, res);
      } catch (e) {
        if (!(e instanceof SignInError) && !(e instanceof ApiError)) console.error(e);
        this.backToApp(res, p.dataApi, { error: e instanceof SignInError || e instanceof ApiError ? e.message : 'Sign-in failed' });
      }
      return;
    }
    // An AI app's sign-in shows its trouble on the app's own sign-in page, not the web client's.
    if (!resume) return this.finish(p, params, req, res);
    try {
      await this.finish(p, params, req, res);
    } catch (e) {
      if (!(e instanceof SignInError) && !(e instanceof ApiError)) console.error(e);
      resume.fail(res, e instanceof SignInError || e instanceof ApiError ? e.message : 'Sign-in failed');
    }
  }

  private async finish(p: Pending, params: URLSearchParams, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const s = this.states.get(p.provider);
    if (!s) throw new SignInError('Unknown sign-in provider');
    if (params.get('error')) throw new SignInError(`The identity provider said: ${params.get('error_description') ?? params.get('error')}`);
    const code = params.get('code');
    if (!code) throw new SignInError('The identity provider sent no code');
    const d = await this.config(s);
    const secret = this.clientSecret(s);
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: p.redirectUri, client_id: s.provider.clientId, code_verifier: p.verifier,
      ...(secret ? { client_secret: secret } : {}),
    });
    const r = await guardedFetch(d.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body }, IDP_NET);
    const tokens = await r.json().catch(() => ({})) as { id_token?: string; error?: string };
    if (!r.ok || !tokens.id_token) throw new SignInError(`The identity provider refused the sign-in${tokens.error ? ` (${tokens.error})` : ''}`);
    const claims = await this.verify(s, tokens.id_token, d, p.nonce);

    // Entra omits the groups list on overage. A domain or email mapping must not silently stand in for a group
    // decision made with incomplete claims. Only the claim the provider is configured to read counts.
    const groupsClaimName = s.provider.groupsClaim ?? 'groups';
    const claimNames = claims._claim_names;
    if ((groupsClaimName === 'groups' && (claims.hasgroups === true || claims.hasgroups === 'true')) || (claimNames !== null && typeof claimNames === 'object' && !Array.isArray(claimNames)
      && Object.hasOwn(claimNames, groupsClaimName))) {
      throw new SignInError('The identity provider omitted group membership; ask an administrator to reduce the groups sent in the ID token');
    }

    const claimed = typeof claims.email === 'string' && claims.email_verified !== false && claims.email_verified !== 'false' ? claims.email : undefined;
    // An email matches an account (its own, or its domain's) only when it can be trusted: else anyone able to put
    // someone's address in their profile at a provider would sign in as them. Groups still match either way.
    const email = claimed && emailTrusted(s.provider, claims) ? claimed : undefined;
    const raw = groupClaim(claims, groupsClaimName) ?? undefined;
    if (raw !== undefined && typeof raw !== 'string' && (!Array.isArray(raw) || !raw.every((g) => typeof g === 'string'))) {
      throw new SignInError('The identity provider returned an invalid group claim');
    }
    const groups = Array.isArray(raw) ? raw as string[] : typeof raw === 'string' ? [raw] : [];
    const issuer = typeof claims.iss === 'string' ? claims.iss : '';
    const subClaim = claims.sub;
    const validSub = Object.prototype.toString.call(subClaim) === '[object String]';
    const sub = validSub ? String(subClaim) : '';
    if (!issuer || !sub || !validSub || issuer !== d.issuer) throw new SignInError('The identity provider returned an invalid subject');
    // A Data API app: the file isn't known until it logs in, so who the provider vouched for is kept until then.
    if (p.dataApi) {
      const identifier = b64url(randomBytes(32));
      const now = expiryClock.now();
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.prepare('DELETE FROM grants WHERE expires <= ?').run(expiryClock.now());
        const count = (this.db.prepare('SELECT COUNT(*) AS n FROM grants').get() as { n: number }).n;
        if (count >= MAX_PENDING) throw new SignInError('Too many sign-ins are in progress; try again in a minute');
        this.db.prepare('INSERT OR REPLACE INTO grants (request_id,identifier,provider,email,claimed,groups,issuer,sub,expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(p.dataApi.requestId, identifier, s.provider.name, email ?? null, claimed ?? null, JSON.stringify(groups), issuer, sub, now + GRANT_MS);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
      this.backToApp(res, p.dataApi, { identifier });
      return;
    }
    const store = this.host.get(p.db);
    if (!store) throw new SignInError(this.host.listFilesPublicly ? `No hosted database named "${p.db}"` : `This sign-in has no external account in ${p.db}`);
    // A group without a trusted person identity cannot be safely revoked per person.
    if (!email && claimed) throw new SignInError(`${s.provider.name} didn't say it verified ${claimed}; a group mapping alone cannot establish a revocable person identity.`);
    if (!email) throw new SignInError('This provider sign-in needs a trusted, verified email before it can use an account mapping.');
    const via = store.externalAccount(email, groups);
    if (!via) {
      // Said whether or not an account is named for the address, so it can't be used to probe which ones are.
      throw new SignInError(claimed && !email
        ? `${s.provider.name} didn't say it verified ${claimed}, so it can't be used to sign in by email. An administrator can map one of your groups instead, or mark ${s.provider.name} as trusted for email ("trustEmail") if it only hands out addresses it owns.`
        : `${claimed ?? 'This sign-in'} has no external account in ${store.name}`);
    }
    if (p.resume) {
      p.resume.done(res, { store, via, email, issuer, sub, provider: s.provider.name, from: clientAddress(req) });
      return;
    }
    const token = this.api.open(store, email, 'web', via, clientAddress(req), undefined, undefined, { issuer, sub, person: email, mapping: via });
    res.writeHead(302, { location: `/app/#db=${encodeURIComponent(store.name)}&token=${token}`, 'cache-control': 'no-store' }).end();
  }

  /**
   * The client secret for the code exchange: Apple's short-lived signed JWT when
   * an appleSecret key is configured, else the static clientSecret if any.
   */
  private clientSecret(s: ProviderState): string | undefined {
    const apple = s.provider.appleSecret;
    if (!apple) return s.provider.clientSecret;
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'ES256', kid: apple.keyId, typ: 'JWT' };
    const claims = { iss: apple.teamId, iat: now, exp: now + 300, aud: s.provider.issuer.replace(/\/$/, ''), sub: s.provider.clientId };
    const signed = `${jwtPart(header)}.${jwtPart(claims)}`;
    const sig = signJwt('sha256', Buffer.from(signed), { key: createPrivateKey(apple.privateKey), dsaEncoding: 'ieee-p1363' });
    return `${signed}.${sig.toString('base64url')}`;
  }

  /** Checks an ID token and returns its claims. */
  private async verify(s: ProviderState, idToken: string, d: Discovery, nonce: string): Promise<Record<string, unknown>> {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new SignInError('Malformed ID token');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { alg?: string; kid?: string };
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Record<string, unknown>;
    const alg = ALGORITHMS[header.alg ?? ''];
    if (!alg) throw new SignInError(`ID token signed with an unsupported algorithm (${header.alg})`);
    const key = await this.key(s, header.kid, d);
    const ok = verifySignature(alg.hash, Buffer.from(`${parts[0]}.${parts[1]}`), { key: createPublicKey({ key, format: 'jwk' }), ...alg.options }, Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new SignInError('ID token signature is not valid');
    const now = expiryClock.now() / 1000;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== d.issuer) throw new SignInError('ID token is from another issuer');
    if (!aud.includes(s.provider.clientId)) throw new SignInError('ID token is for another application');
    if (typeof claims.exp !== 'number' || claims.exp < now - 60) throw new SignInError('ID token has expired');
    if (claims.nonce !== nonce) throw new SignInError('ID token does not match this sign-in');
    return claims;
  }

  private async config(s: ProviderState): Promise<Discovery> {
    if (s.discovery && performance.now() - s.discovery.at < 3600_000) return s.discovery.value;
    const r = await guardedFetch(`${s.provider.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, {}, IDP_NET);
    if (!r.ok) throw new SignInError(`Can't reach the identity provider (${r.status})`);
    const value = await r.json() as Discovery;
    s.discovery = { value, at: performance.now() };
    return value;
  }

  /** The provider's signing key; keys are fetched again when an unknown one turns up (rotation). */
  private async key(s: ProviderState, kid: string | undefined, d: Discovery): Promise<JsonWebKey> {
    const find = () => s.keys?.value.find((k) => (kid === undefined || k.kid === kid) && (k.use === undefined || k.use === 'sig'));
    let k = s.keys && performance.now() - s.keys.at < 3600_000 ? find() : undefined;
    if (!k) {
      const r = await guardedFetch(d.jwks_uri, {}, IDP_NET);
      if (!r.ok) throw new SignInError(`Can't fetch the identity provider's keys (${r.status})`);
      s.keys = { value: ((await r.json()) as { keys: JsonWebKey[] }).keys ?? [], at: performance.now() };
      k = find();
    }
    if (!k) throw new SignInError('ID token signed with an unknown key');
    return k;
  }

}

export class SignInError extends Error {}

/** A configured claim can be a top-level name or a dot-separated object path. */
function groupClaim(claims: Record<string, unknown>, name: string): unknown {
  if (Object.hasOwn(claims, name)) return claims[name];
  if (!name.includes('.')) return undefined;
  let value: unknown = claims;
  for (const part of name.split('.')) {
    if (!part || value === null || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function secureOidcFile(file: string): Pick<Stats, 'dev' | 'ino'> {
  try {
    const fd = openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    closeSync(fd);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  const validated = secureExisting(file);
  secureOidcSidecars(join(file, '..'));
  if (!validated) throw new Error(`OIDC storage file disappeared: ${file}`);
  return { dev: validated.dev, ino: validated.ino };
}

export function assertSameOidcFile(expected: Pick<Stats, 'dev' | 'ino'>, actual: Pick<Stats, 'dev' | 'ino'>): void {
  if (expected.dev !== actual.dev || expected.ino !== actual.ino) throw new Error('OIDC database file changed while opening; refusing unsafe storage');
}

export function oidcHostDirectoryWarning(hostDir: string): string | undefined {
  const st = statSync(hostDir);
  const uid = process.getuid?.();
  if ((uid !== undefined && st.uid !== uid) || (st.mode & 0o022) !== 0) return 'The hosted folder is not owned by this service or is group/world-writable; protect it from replacement by other users.';
}

function secureOidcDirectory(hostDir: string): string {
  const dir = join(hostDir, OIDC_DIR);
  try { mkdirSync(dir, { mode: 0o700 }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  const st = lstatSync(dir);
  const uid = process.getuid?.();
  if (!st.isDirectory() || (uid !== undefined && st.uid !== uid) || (st.mode & 0o077) !== 0) throw new Error('OIDC storage directory must be a real directory owned by this service and private (mode 0700)');
  return dir;
}

function secureExisting(file: string): Stats | undefined {
  let st;
  try { st = lstatSync(file); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  const uid = process.getuid?.();
  if (!st.isFile() || (uid !== undefined && st.uid !== uid) || (st.mode & 0o077) !== 0) throw new Error(`Unsafe OIDC storage file: ${file}`);
  return st;
}

function secureOidcSidecars(dir: string): void {
  for (const suffix of ['-wal', '-shm']) secureExisting(join(dir, `${OIDC_DB}${suffix}`));
}

function isBusy(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const error = e as { code?: unknown; errcode?: unknown };
  return String(error.code ?? '').includes('SQLITE_BUSY') || error.errcode === 5;
}

const jwtPart = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

async function readBody(req: IncomingMessage): Promise<string> {
  return (await readRaw(req, AUTH_BODY_LIMIT)).toString('utf8');
}

const ALGORITHMS: Record<string, { hash: string; options: Record<string, unknown> }> = {
  RS256: { hash: 'sha256', options: {} },
  RS384: { hash: 'sha384', options: {} },
  RS512: { hash: 'sha512', options: {} },
  PS256: { hash: 'sha256', options: { padding: 6, saltLength: 32 } },
  ES256: { hash: 'sha256', options: { dsaEncoding: 'ieee-p1363' } },
  ES384: { hash: 'sha384', options: { dsaEncoding: 'ieee-p1363' } },
};

/** Personal Microsoft accounts' tenant: anyone can make one, so it isn't one organisation's directory. */
const MICROSOFT_CONSUMERS = '9188040d-6c67-4c5b-b112-36a304b66dad';

/**
 * Whether an ID token's email can be trusted to match accounts by: the provider
 * says it verified it (the standard email_verified claim, or Microsoft Entra's
 * xms_edov optional claim; some providers send these as strings), the provider
 * is set up as trusted for email (trustEmail), or it is one organisation's
 * Microsoft Entra tenant (an issuer naming the tenant, which the issuer check
 * pins sign-ins to) and the person is one of its own members, whose addresses
 * only its administrators set. A guest's address comes from their invitation or
 * their home directory, so a guest (an idp claim naming another issuer, or acct
 * 1) needs xms_edov like anyone else. Entra doesn't send email_verified at all.
 */
export function emailTrusted(provider: Pick<OidcProvider, 'issuer' | 'trustEmail'>, claims: Record<string, unknown>): boolean {
  const yes = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';
  if (yes(claims.email_verified) || yes(claims.xms_edov) || provider.trustEmail === true) return true;
  if ((claims.idp !== undefined && claims.idp !== claims.iss) || claims.acct === 1 || claims.acct === '1') return false;
  const tenant = /^https:\/\/login\.microsoftonline\.com\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/v2\.0\/?$/i.exec(provider.issuer)?.[1];
  return !!tenant && tenant.toLowerCase() !== MICROSOFT_CONSUMERS;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(body));
}
