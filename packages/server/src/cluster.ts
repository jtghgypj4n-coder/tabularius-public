// One server, several processes: Node runs JavaScript on one core per
// process, so a busy server uses every core by running a worker process per
// core on the same hosted folder.
//
// The front process takes every connection and passes each request to a
// worker over a Unix socket in a private folder (a named pipe on Windows):
// - requests with a session go to the worker holding that session (tokens
//   start with its number), so a session's globals and variables stay put;
// - signing in goes by account name, so the failed sign-ins that lock an
//   account out are all counted in one place;
// - other credentials (API tokens, accounts signing in to OData) always go to
//   the same worker, by a hash of the credential;
// - the admin console, the Admin API, the change feed and sign-in through an
//   identity provider go to the leader,
//   worker 0, which alone runs schedules, backups, webhooks, the PostgreSQL
//   port and the folder watcher;
// - everything else goes to the worker with the fewest requests in flight.
// The client's address travels in a header only the front process can set
// (workers listen on sockets nothing else can reach), so the admin console's
// and MCP's this-computer-only checks see the real client, not the front.
//
// Workers open the same SQLite files (SQLite lets several processes share
// them). What lives in memory is shared through the front process:
// - record locks are kept in a small SQLite file all workers use;
// - every change is passed on to the other workers, so live updates and the
//   change feed see edits made anywhere;
// - a design change makes the others reload the design;
// - closing, pausing or opening a file happens in every worker, and the one
//   asking waits until all have let go of the file before replacing it;
// - every worker hears the others' sessions each second, so the admin
//   console lists, messages and disconnects all of them;
// - every few seconds, each worker's script and find timings and request
//   counts, so the admin console's profile and the metrics add them all up.
//
// HTTPS: the front process holds the certificate, gets and renews an
// automatic one (and answers the authority's checks on port 80), and tells the
// workers about it: the leader's PostgreSQL port serves TLS with it, and the
// admin console shows when it runs out and any renewal problem.
//
// Encryption at rest: the leader unlocks the stores before the others start,
// and encrypts each one again as it closes it, which it does last (closing a
// file from the admin console closes it in the others first, too). Only the
// leader holds the key's work; the others are given it so they keep results
// in memory as it does, never in plaintext files beside the stores.
//
// Not yet with several workers: point-in-time backups and standbys (they
// follow one process's write-ahead log). The server says so and doesn't
// start.

import { fork, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request, Agent, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createEdgeServer } from './edge-limits.ts';
import { clientAddress, hasTrustedClientAddress, refuseForwarding, setClientAddress, trustedProxyAddresses, useForwardedFor } from './client-address.ts';
import { legacyRequest } from './legacy-request.ts';
import { acmeOrigins, validatePublicUrl, urlHostname } from './public-origin.ts';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SharedRecordLocks, type Change, type Store } from '../../store/src/index.ts';
import { monotonicClock } from '../../store/src/monotonic.ts';
import { AutoTls, type CertificateState } from './acme.ts';
import { claimFolder } from './backup.ts';
import { ENCRYPTED_EXT } from './encrypt.ts';
import { localUrl, openLocalAccess } from './local-admin.ts';
import { redirectPlainHttp } from './plain-redirect.ts';
import { listenError } from './listen-error.ts';
import type { DataApi, RemoteSession } from './dataapi.ts';
import type { Host } from './host.ts';
import type { Live } from './live.ts';
import type { QueueList } from './server-queue.ts';
import type { Metrics, RequestSnapshot } from './metrics.ts';
import type { Profiler, ProfileSnapshot } from './profiler.ts';
import type { ServeOptions } from './index.ts';
import { sendError } from './pages.ts';
import { certificateManaged } from './cert-import.ts';
import type { LogType } from './server-logs.ts';
import { sameSecret } from './secrets.ts';

/** Where this process sits in its cluster. */
export interface ClusterRole {
  id: number;
  leader: boolean;
  workers: number;
  /** The Unix socket this worker listens on. */
  socket: string;
  /** Key signing container URLs, the same in every worker. */
  urlKey: string;
  /** The SQLite file record locks are kept in. */
  locks: string;
  /** The certificate the front process serves with, when it serves https. */
  tls?: ClusterTls;
  /** Started again after it stopped, while the others went on: the files it holds are theirs too. */
  restart?: boolean;
}

/** The front process's certificate, as the workers hear of it. */
export interface ClusterTls {
  cert: string;
  key: string;
  /** For a certificate got automatically (--https name): what the admin console shows. */
  auto?: { domains: string[]; expires: number; problem?: string };
}

/** The most log lines one follower passes to the leader a minute. */
const LOG_NOTES_PER_MINUTE = 120;

type LogNote = Extract<Note, { k: 'log' }>;

/**
 * A follower's errors and warnings, passed to the leader (the only process that mails). A runaway log must not become
 * a flood of messages between processes, so a minute carries at most LOG_NOTES_PER_MINUTE; the leader's digest
 * caps and counts what reaches it anyway.
 */
export function forwardLogs(logs: { onEntry?: (type: LogType, source: string, message: string) => void }, tell: (note: LogNote) => void, from: number, now: () => number = () => monotonicClock.now()): void {
  let sent = 0;
  let since = now();
  logs.onEntry = (type, source, message) => {
    if (type === 'Information') return;
    if (now() - since > 60_000) { since = now(); sent = 0; }
    if (++sent > LOG_NOTES_PER_MINUTE) return;
    tell({ k: 'log', from, type, source, message });
  };
}

/** The leader takes a follower's line into its own notification digest, marked with the worker it came from. */
export function logFromFollower(notifier: { note(type: LogType, source: string, message: string): void }, note: LogNote): void {
  notifier.note(note.type, note.source, `[worker ${note.from}] ${note.message}`);
}

/** Between workers, through the front process. */
type Note =
  | { k: 'change'; change: Change }
  | { k: 'design'; file: string }
  | { k: 'sessions'; from: number; list: RemoteSession[] }
  | { k: 'message'; text: string; token?: string }
  | { k: 'end'; id: string }
  | { k: 'scripts'; from: number; list: QueueList }
  | { k: 'cancel-script'; id: string; by: string }
  | { k: 'stats'; from: number; profile: ProfileSnapshot; requests: RequestSnapshot }
  | { k: 'profile-reset' }
  | { k: 'gone'; from: number }
  | { k: 'tls'; tls: ClusterTls }
  /** A line a follower logged, for the leader's email notifications (only the leader mails). */
  | { k: 'log'; from: number; type: 'Warning' | 'Error'; source: string; message: string };
type Question = { k: 'file'; name: string; action: 'close' | 'pause' | 'open' | 'offline'; detail?: string };

type ToFront =
  | { t: 'ready' }
  | { t: 'log'; text: string }
  | { t: 'tell'; note: Note }
  | { t: 'ask'; rid: number; q: Question }
  | { t: 'cancel'; rid: number }
  | { t: 'answer'; rid: number };
type FromFront =
  | { t: 'start'; role: ClusterRole; opts: Omit<ServeOptions, 'log'>; blankFromNetwork: boolean }
  | { t: 'tell'; note: Note }
  | { t: 'ask'; rid: number; q: Question }
  | { t: 'answer'; rid: number }
  | { t: 'stop' };

/** A worker's side: what serve() hooks up when it runs as part of a cluster. */
export class ClusterLink {
  readonly role: ClusterRole;
  private readonly db: DatabaseSync;
  private readonly send: (m: ToFront) => void;
  private rid = 0;
  private readonly waiting = new Map<number, (error?: Error) => void>();
  private stopped = false;
  /** Changes that came from other workers: not passed on again. */
  private readonly remote = new WeakSet<Change>();
  /** Sessions in the other workers, by worker. */
  private readonly sessions = new Map<number, RemoteSession[]>();
  /** Server-side scripts running and waiting in the other workers, by worker. */
  private readonly scripts = new Map<number, QueueList>();
  /** The other workers' script timings and request counts, by worker (the admin console's profile and metrics). */
  private readonly stats = new Map<number, { profile: ProfileSnapshot; requests: RequestSnapshot }>();
  private profiler?: Profiler;
  private host?: Host;
  private api?: DataApi;
  private live?: Live;
  private timer?: NodeJS.Timeout;
  /** The front process's certificate, kept current as it is renewed. */
  tls?: ClusterTls;

  constructor(role: ClusterRole, send: (m: ToFront) => void) {
    this.role = role;
    this.tls = role.tls;
    this.send = send;
    this.db = new DatabaseSync(role.locks);
    this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL');
  }

  hostOptions(): { urlKey: Buffer; locks: (store: Store) => SharedRecordLocks; follower: boolean } {
    return { urlKey: Buffer.from(this.role.urlKey, 'hex'), locks: (store) => new SharedRecordLocks(this.db, store.name), follower: !this.role.leader };
  }

  /** The front process's automatic certificate, for the admin console and metrics. */
  certificate(): CertificateState | undefined {
    if (!this.tls?.auto) return undefined;
    const link = this;
    return {
      get opts() {
        return { domains: link.tls?.auto?.domains ?? [] };
      },
      get current() {
        const t = link.tls;
        return t?.auto && { cert: t.cert, key: t.key, expires: t.auto.expires };
      },
      get problem() {
        return link.tls?.auto?.problem;
      },
    };
  }

  log(text: string): void {
    this.send({ t: 'log', text });
  }

  /** Hooks a worker's server up to the others. */
  attach(host: Host, api: DataApi, live: Live, measured?: { profiler: Profiler; metrics: Metrics }): void {
    this.host = host;
    this.api = api;
    this.live = live;
    api.tokenPrefix = this.role.id.toString(16).padStart(2, '0');
    host.peers = { sync: (name, action, detail) => this.ask({ k: 'file', name, action, ...(detail !== undefined ? { detail } : {}) }) };
    // Only the leader mails; a follower's errors and warnings go to it to be mailed with its own.
    if (!this.role.leader && host.logs) forwardLogs(host.logs, (note) => this.send({ t: 'tell', note }), this.role.id);
    const join = (store: Store) => {
      store.listeners.add((change) => {
        if (!this.remote.has(change)) this.send({ t: 'tell', note: { k: 'change', change } });
      });
      const designChanged = store.onDesignChange;
      store.onDesignChange = () => {
        designChanged();
        this.send({ t: 'tell', note: { k: 'design', file: store.name } });
      };
    };
    for (const store of host.openStores()) join(store);
    host.onAdd.push(join);
    api.others = () => [...this.sessions.values()].flat();
    api.endElsewhere = (id) => this.send({ t: 'tell', note: { k: 'end', id } });
    live.elsewhere = {
      message: (text, token) => this.send({ t: 'tell', note: { k: 'message', text, token } }),
      streams: (token) => [...this.sessions.values()].flat().filter((s) => !token || sameSecret(s.token, token)).reduce((n, s) => n + s.streams, 0),
    };
    // Everyone's sessions, kept a second fresh in every worker (the admin console, who else is in a file).
    const queue = host.serverScripts;
    queue.elsewhere = {
      lists: () => [...this.scripts.values()],
      cancel: (id, by) => this.send({ t: 'tell', note: { k: 'cancel-script', id, by } }),
    };
    // Every worker's script timings and requests in the profile and metrics, whichever worker answers.
    if (measured) {
      this.profiler = measured.profiler;
      measured.profiler.elsewhere = () => [...this.stats.values()].map((x) => x.profile);
      measured.profiler.onReset = () => this.send({ t: 'tell', note: { k: 'profile-reset' } });
      measured.metrics.elsewhere = () => [...this.stats.values()].map((x) => x.requests);
    }
    let reported = -1;
    let ticks = 0;
    let profiled = -1;
    let profile: ProfileSnapshot | undefined;
    const report = () => {
      // Every few seconds: the admin console's profile and metrics are that fresh. The timings, which can be large,
      // are worked out again only when they changed.
      if (measured && ticks % 5 === 0) {
        if (measured.profiler.version !== profiled || !profile) {
          profiled = measured.profiler.version;
          profile = measured.profiler.snapshot();
        }
        this.send({ t: 'tell', note: { k: 'stats', from: this.role.id, profile, requests: measured.metrics.snapshot() } });
      }
      this.send({ t: 'tell', note: { k: 'sessions', from: this.role.id, list: api.own((token) => live.streamsOf(token)) } });
      // Its server-side scripts when they change (the admin console lists every worker's), and every few seconds
      // anyway, so a worker that has just started or restarted hears of scripts already running.
      if (queue.version !== reported || ++ticks % 5 === 0) {
        reported = queue.version;
        this.send({ t: 'tell', note: { k: 'scripts', from: this.role.id, list: queue.list() } });
      }
    };
    this.timer = setInterval(report, 1000);
    this.timer.unref();
    report();
  }

  private ask(q: Question): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('The cluster link is closed'));
    if (this.waiting.size >= 1024) return Promise.reject(new Error('Too many cluster file operations are waiting'));
    const rid = ++this.rid;
    return new Promise((done, reject) => {
      const finish = (error?: Error) => {
        if (!this.waiting.delete(rid)) return;
        clearTimeout(timer);
        if (error) reject(error); else done();
      };
      const timer = setTimeout(() => {
        finish(new Error('The cluster did not finish the file operation in time'));
        this.send({ t: 'cancel', rid });
      }, 30_000);
      timer.unref();
      this.waiting.set(rid, finish);
      try { this.send({ t: 'ask', rid, q }); } catch (e) { finish(e as Error); }
    });
  }

  /** A message from the front process. */
  receive(m: FromFront): void {
    if (m.t === 'answer') {
      this.waiting.get(m.rid)?.();
      this.waiting.delete(m.rid);
    } else if (m.t === 'ask') {
      void this.answer(m.q).catch((e) => process.stderr.write(`cluster file action failed: ${(e as Error).message}\n`))
        .finally(() => this.send({ t: 'answer', rid: m.rid }));
    } else if (m.t === 'tell') {
      this.hear(m.note);
    }
  }

  private async answer(q: Question): Promise<void> {
    const host = this.host!;
    if (q.action === 'close') {
      await host.waitForCompaction(q.name);
      this.api!.endByDb(q.name);
      host.closeFile(q.name);
    } else if (q.action === 'offline') {
      this.api!.endByDb(q.name);
      host.takeOfflineByName(q.name, q.detail ?? 'damaged pages');
    } else if (q.action === 'pause') {
      await host.waitForCompaction(q.name);
      host.pauseFile(q.name);
    } else if (!host.get(q.name)) {
      if (!host.openFile(q.name)) {
        const file = host.files().find((f) => f.name.toLowerCase() === q.name.toLowerCase());
        const path = file?.path ?? join(host.dir, q.name + '.openhbam.sqlite');
        // Still encrypted (the leader didn't unlock it): not opened, which would make an empty store beside it.
        if (existsSync(path) || !existsSync(path + ENCRYPTED_EXT)) host.add(path);
      }
    }
  }

  private hear(note: Note): void {
    const host = this.host!;
    if (note.k === 'change') {
      const store = host.storeOf(note.change.file);
      if (!store) return;
      const change = { ...note.change, remote: true };
      this.remote.add(change);
      for (const l of store.listeners) {
        try {
          l(change);
        } catch (e) {
          console.error(e);
        }
      }
    } else if (note.k === 'design') {
      for (const s of host.openStores()) s.resetCaches();
    } else if (note.k === 'sessions') {
      this.sessions.set(note.from, note.list);
    } else if (note.k === 'scripts') {
      this.scripts.set(note.from, note.list);
    } else if (note.k === 'cancel-script') {
      host.serverScripts.cancel(note.id, note.by);
    } else if (note.k === 'stats') {
      this.stats.set(note.from, { profile: note.profile, requests: note.requests });
    } else if (note.k === 'profile-reset') {
      this.profiler?.reset(true);
      for (const x of this.stats.values()) x.profile = { scripts: [], finds: [] };
    } else if (note.k === 'gone') {
      this.sessions.delete(note.from);
      this.scripts.delete(note.from);
      this.stats.delete(note.from);
    } else if (note.k === 'message') {
      this.live!.deliver(note.text, note.token);
    } else if (note.k === 'end') {
      this.api!.endById(note.id);
    } else if (note.k === 'tls') {
      this.tls = note.tls;
    } else if (note.k === 'log') {
      if (this.role.leader) logFromFollower(host.notifier, note);
    }
  }

  /**
   * The client's address, and whether it came over https, as the front
   * process saw them: secure cookies, passkeys' origin and the links
   * answers carry follow the client's connection, not the worker's socket.
   */
  peer(req: IncomingMessage): void {
    const from = req.headers['x-tabularius-peer'];
    setClientAddress(req, typeof from === 'string' ? from : 'unknown', req.headers['x-tabularius-forwarded'] === '1');
    Object.defineProperty(req.socket, 'remoteAddress', { value: clientAddress(req), configurable: true });
    Object.defineProperty(req.socket, 'encrypted', { value: req.headers['x-tabularius-tls'] === '1', configurable: true });
  }

  close(): void {
    this.stopped = true;
    for (const finish of this.waiting.values()) finish(new Error('The cluster link is closed'));
    clearInterval(this.timer);
    this.db.close();
  }
}

const LEADER_ONLY = /^\/(?:tabularius\/admin\/|tabularius\/hooks\/|fmi\/admin\/|tabularius\/changes\/|tabularius\/auth\/|oauth\/(?:authorize|register|getoauthurl)(?:$|\/)|fmws\/|admin(?:\/|$))/;

/** Which worker a request goes to; undefined: whichever is least busy. */
export function route(req: IncomingMessage, workers: number): number | undefined {
  const path = (req.url ?? '/').split('?')[0];
  // The leader: the admin console and Admin API, the change feed, every identity-provider sign-in request (start and
  // callback), an AI app's OAuth sign-in page (its process-local identity-provider resume handler lives on the leader,
  // and is lost on restart), an AI app registering itself (its per-address
  // limit is counted in memory, so it holds for the whole server only in one process) and inbound hooks (one process
  // sees every call, so a replayed one is refused and the limits hold).
  if (LEADER_ONLY.test(path)) return 0;
  // A Data API app logging in with what a sign-in through an identity provider gave it: the leader holds those.
  if (req.headers['x-fm-data-oauth-request-id'] !== undefined) return 0;
  const auth = req.headers.authorization ?? '';
  const header = req.headers['x-fm-data-access-token'];
  const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] ?? (typeof header === 'string' ? header : undefined)
    ?? /^\/fmi\/data\/[^/]+\/databases\/[^/]+\/sessions\/([0-9a-f]{48})$/.exec(path)?.[1];
  // A session's token starts with the number of the worker holding it.
  if (token && /^[0-9a-f]{48}$/.test(token)) {
    const id = parseInt(token.slice(0, 2), 16);
    if (id < workers) return id;
  }
  // Signing in: by account name, so failed attempts on an account are all counted in one place
  // (lockout), while different accounts spread over the workers.
  if (req.method === 'POST' && /^\/fmi\/data\/[^/]+\/databases\/[^/]+\/sessions$/.test(path)) {
    const basic = /^Basic\s+(\S+)$/i.exec(auth)?.[1];
    if (!basic) return undefined;
    const account = Buffer.from(basic, 'base64').toString('utf8').split(':')[0].toLowerCase();
    return createHash('sha256').update(account).digest()[0] % workers;
  }
  // Other credentials: always the same worker, so what it keeps for them (script globals) stays.
  if (auth || token) return createHash('sha256').update(auth || token!).digest()[0] % workers;
  return undefined;
}

/** What `--workers` can't be combined with yet. */
export function clusterProblems(opts: ServeOptions): string[] {
  return [
    opts.progressive && 'point-in-time backups (--progressive)',
    opts.replicationToken && 'standby servers (--replication-token)',
  ].filter((p): p is string => !!p);
}

interface Worker {
  id: number;
  child?: ChildProcess;
  /** Questions asked while it was starting: put to it once it is ready. */
  asked: FromFront[];
  /** Started before (this start replaces a worker that stopped). */
  started?: boolean;
  agent: Agent;
  inFlight: number;
  ready: boolean;
  /** Restarts in a row that did not last (or did not start): the back-off doubles with each. */
  restarts?: number;
  /** When it last became ready. */
  readyAt?: number;
}

/** When a worker that stopped is started again: the wait doubles with each restart that did not last, up to `maxMs`. */
export interface RestartTiming {
  /** The wait before the first restart (1 s). */
  firstMs?: number;
  /** The longest wait (30 s). */
  maxMs?: number;
  /** A worker that stayed up this long starts the back-off over (1 min). */
  stableMs?: number;
  /** Called before each start of a worker; one that throws makes that start fail (for tests). */
  beforeStart?: (id: number) => void;
}

/**
 * Hosts a folder with `workers` processes behind one port. Resolves once every
 * worker is serving.
 */
/**
 * Where a worker listens: a Unix socket in the private folder, or on Windows,
 * which has none, a named pipe (only its creator and administrators can write to one).
 */
function socketPath(run: string, id: number): string {
  return process.platform === 'win32' ? `\\\\?\\pipe\\${basename(run)}-w${id}` : join(run, `w${id}.sock`);
}

export async function serveCluster(opts: ServeOptions, workers: number, blankFromNetwork = false, timing: RestartTiming = {}): Promise<{ server: Server; url: string; workers: number; tls?: AutoTls; pids(): (number | undefined)[]; close(): Promise<void> }> {
  validatePublicUrl(opts.publicUrl);
  const trustedProxies = trustedProxyAddresses(opts.trustedProxies);
  const problems = clusterProblems(opts);
  if (problems.length) throw new Error(`several workers can't be used with ${problems.join(', ')} yet`);
  const log = opts.log ?? ((m: string) => console.log(m));
  // An automatic certificate first, as one process does: without one there is nothing to serve https with.
  const auto = opts.acme ? new AutoTls(opts.dir, { ...opts.acme, httpsPort: opts.port ?? 443, log }) : undefined;
  const release = claimFolder(opts.dir);
  if (auto) {
    try {
      await auto.start();
    } catch (e) {
      auto.stop();
      release();
      throw e;
    }
  }
  // Sockets and the shared lock file, where only this user can reach them.
  const run = mkdtempSync(join(tmpdir(), 'tabularius-cluster-'));
  const urlKey = randomBytes(32).toString('hex');
  const pool: Worker[] = Array.from({ length: workers }, (_, id) => ({ id, agent: new Agent({ keepAlive: true }), inFlight: 0, ready: false, asked: [] }));
  let closing = false;
  let next = 0;
  const pending = new Map<number, { from: Worker; rid: number; waiting: Set<number> }>();
  let rid = 0;

  const given = opts.tlsCert && opts.tlsKey ? { cert: readFileSync(opts.tlsCert, 'utf8'), key: readFileSync(opts.tlsKey, 'utf8') } : undefined;
  /** The certificate now, as the workers hear of it; only the leader, whose PostgreSQL port uses it, gets the key. */
  const shared = (leader = true): ClusterTls | undefined => {
    const c = auto?.current;
    const now = c ? { cert: c.cert, key: c.key, auto: { domains: auto.opts.domains, expires: c.expires, problem: auto.problem } } : given;
    return now && (leader ? now : { ...now, key: '' });
  };
  const tls = given ?? (auto?.current && { cert: auto.current.cert, key: auto.current.key });
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    legacyRequest(req);
    const ready = pool.filter((w) => w.ready);
    if (!ready.length) {
      sendError(req, res, 503, { 'retry-after': '1' });
      return;
    }
    // What only the leader does waits for it (restarting after a crash): another worker has none of its state,
    // and with encryption at rest no key, so it would open or close files without unlocking or locking them.
    if (LEADER_ONLY.test((req.url ?? '/').split('?')[0]) && !pool[0].ready) {
      sendError(req, res, 503, { 'retry-after': '2' });
      return;
    }
    const wanted = route(req, workers);
    let w = wanted === undefined ? undefined : pool[wanted];
    if (!w?.ready) {
      // The least busy, taking turns among equals.
      next = (next + 1) % ready.length;
      w = [...ready.slice(next), ...ready.slice(0, next)].reduce((a, b) => (b.inFlight < a.inFlight ? b : a));
    }
    const target = w;
    if (!useForwardedFor(req, opts.proxyHeader, trustedProxies)) {
      refuseForwarding(res, log);
      return;
    }
    // The client's Connection header is about its hop only: forwarded, a "close" makes the worker hang up as soon as it has
    // answered, which can be before the front has finished writing the request, and the answer is lost to a broken pipe.
    const { connection: _connection, 'keep-alive': _keepAlive, 'proxy-connection': _proxyConnection, ...forwarded } = req.headers;
    // Set here whatever the client sent: workers trust these two.
    const headers = { ...forwarded, 'x-tabularius-peer': clientAddress(req), 'x-tabularius-forwarded': hasTrustedClientAddress(req) ? '1' : '0', 'x-tabularius-tls': tls ? '1' : '0' };
    target.inFlight++;
    let done = false;
    const finish = () => {
      if (!done) target.inFlight--;
      done = true;
    };
    const out = request({ socketPath: socketPath(run, target.id), agent: target.agent, method: req.method, path: req.url, headers }, (back) => {
      // Connection budgets belong to each hop. Never forward a worker's keep-alive policy
      // over the front's final Connection: close response (or leak its hop-only headers).
      const hop = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade',
        ...String(back.headers.connection ?? '').toLowerCase().split(',').map(h => h.trim())]);
      const responseHeaders: string[] = [];
      for (let i = 0; i < back.rawHeaders.length; i += 2) {
        if (!hop.has(back.rawHeaders[i].toLowerCase())) responseHeaders.push(back.rawHeaders[i], back.rawHeaders[i + 1]);
      }
      res.writeHead(back.statusCode ?? 502, responseHeaders);
      // Live-update streams: each event goes on at once.
      if (String(back.headers['content-type']).startsWith('text/event-stream')) res.flushHeaders();
      back.pipe(res);
      back.on('end', finish);
      // A worker that cuts the response off (a stalled live stream) must not leave the client hanging on an open socket.
      back.on('close', () => {
        finish();
        if (!back.complete) res.destroy();
      });
    });
    out.on('error', () => {
      finish();
      if (!res.headersSent) res.writeHead(502).end();
      else res.destroy();
    });
    // A client that goes away (a closed tab) ends its request in the worker too.
    res.on('close', () => {
      finish();
      if (!res.writableFinished) out.destroy();
    });
    req.pipe(out);
  };
  const server = createEdgeServer(handler, opts.edgeLimits, tls, { proxyHeader: opts.proxyHeader, trustedProxies });
  if (tls) redirectPlainHttp(server as unknown as import('node:tls').Server, opts.edgeLimits, { proxyHeader: opts.proxyHeader, trustedProxies });
  try {
    await new Promise<void>((ok, fail) => {
      server.once('error', (e) => fail(listenError(e, opts.port ?? 8080, opts.hostname ?? '127.0.0.1')));
      server.listen(opts.port ?? 8080, opts.hostname ?? '127.0.0.1', ok);
    });
  } catch (e) {
    auto?.stop();
    rmSync(run, { recursive: true, force: true });
    release();
    throw e;
  }
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  if (auto && port) auto.httpsPort = port;
  const url = auto
    ? `https://${urlHostname(auto.opts.domains[0])}${port === 443 ? '' : ':' + port}`
    : `${tls ? 'https' : 'http'}://${urlHostname(opts.hostname ?? '127.0.0.1')}:${port}`;
  const closeLocal = openLocalAccess(opts.dir, localUrl(opts.hostname, port!, !!tls));

  // A worker that has just exited can't be written to; it's restarted or the server is closing.
  const post = (w: Worker | undefined, m: FromFront) => {
    if (w?.child?.connected) w.child.send(m, (e) => e && log(`worker ${w.id}: ${e.message}`));
  };
  const broadcast = (from: Worker | undefined, m: FromFront) => {
    if (closing) return;
    for (const w of pool) if (w !== from && w.ready) post(w, m);
  };
  // A renewed certificate: new connections get it at once, and the workers hear of it (and of a failed renewal).
  if (auto) {
    const tell = () => {
      for (const w of pool) if (w.ready) post(w, { t: 'tell', note: { k: 'tls', tls: shared(w.id === 0)! } });
    };
    auto.onRenew = (c) => {
      (server as unknown as import('node:https').Server).setSecureContext({ cert: c.cert, key: c.key });
      tell();
    };
    auto.onProblem = tell;
  }
  const answered = (key: number, by: Worker) => {
    const p = pending.get(key);
    if (!p) return;
    p.waiting.delete(by.id);
    if (p.waiting.size) return;
    pending.delete(key);
    post(p.from, { t: 'answer', rid: p.rid });
  };

  const start = (w: Worker): Promise<void> => new Promise((ok, fail) => {
    try { timing.beforeStart?.(w.id); } catch (e) { fail(e); return; }
    const { log: _log, ...rest } = opts;
    const role: ClusterRole = { id: w.id, leader: w.id === 0, workers, socket: socketPath(run, w.id), urlKey, locks: join(run, 'locks.sqlite'), tls: shared(w.id === 0), restart: !!w.started };
    w.started = true;
    // Only the leader runs what must happen once.
    const workerOpts: Omit<ServeOptions, 'log'> = {
      ...rest, publicUrl: opts.publicUrl ?? url, publicUrlIsDefault: !opts.publicUrl, tlsCert: undefined, tlsKey: undefined, acme: undefined, mcpAllowedOrigins: [...(opts.mcpAllowedOrigins ?? []), ...(opts.acme ? acmeOrigins(opts.acme.domains, opts.port ?? 443) : [])], background: true, certificateManaged: certificateManaged(opts),
      browserOrigins: [...(opts.browserOrigins ?? []), ...(opts.acme ? acmeOrigins(opts.acme.domains, opts.port ?? 443) : [])],
      ...(role.leader ? {} : { backups: undefined, offsite: undefined, sqlPort: undefined, webhooks: false, watch: false }),
    };
    const child = fork(join(import.meta.dirname, 'cluster-worker.ts'), [], { execArgv: ['--no-warnings', ...process.execArgv.filter((a) => a !== '--no-warnings')], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    w.child = child;
    child.on('error', (e) => log(`worker ${w.id}: ${e.message}`));
    let lastLog = '';
    post(w, { t: 'start', role, opts: workerOpts, blankFromNetwork });
    child.on('message', (m: ToFront) => {
      if (m.t === 'ready') {
        w.ready = true;
        w.readyAt = performance.now();
        // A renewal while it was starting reached it neither in its role nor as a note.
        if (auto) post(w, { t: 'tell', note: { k: 'tls', tls: shared(w.id === 0)! } });
        for (const q of w.asked.splice(0)) post(w, q);
        ok();
      } else if (m.t === 'log') {
        lastLog = m.text;
        log(workers > 1 ? `[${w.id}] ${m.text}` : m.text);
      }
      else if (m.t === 'tell') broadcast(w, { t: 'tell', note: m.note });
      else if (m.t === 'cancel') {
        for (const [key, p] of pending) if (p.from === w && p.rid === m.rid) {
          pending.delete(key);
          for (const other of pool) other.asked = other.asked.filter((q) => q.t !== 'ask' || q.rid !== key);
        }
      }
      else if (m.t === 'ask') {
        // Starting workers too: they opened the files before they were ready, so a file closed meanwhile (and with
        // encryption at rest, removed once locked) must wait for them to let go as well.
        const others = pool.filter((o) => o !== w && (o.ready || o.child));
        if (!others.length) {
          post(w, { t: 'answer', rid: m.rid });
          return;
        }
        const key = ++rid;
        pending.set(key, { from: w, rid: m.rid, waiting: new Set(others.map((o) => o.id)) });
        for (const o of others) {
          const q: FromFront = { t: 'ask', rid: key, q: m.q };
          if (o.ready) post(o, q);
          else o.asked.push(q);
        }
      } else if (m.t === 'answer') answered(m.rid, w);
    });
    child.once('exit', (code) => {
      const was = w.ready;
      if (was && performance.now() - (w.readyAt ?? 0) >= (timing.stableMs ?? 60_000)) w.restarts = 0;
      w.ready = false;
      w.child = undefined;
      w.asked = [];
      // Questions waiting on it don't wait forever; its own are dropped.
      for (const [key, p] of pending) {
        if (p.from === w) pending.delete(key);
        else answered(key, w);
      }
      broadcast(undefined, { t: 'tell', note: { k: 'gone', from: w.id } });
      if (closing) return;
      if (!was) {
        fail(new Error(`worker ${w.id} exited (${code}) while starting${lastLog ? `: ${lastLog}` : ''}`));
        return;
      }
      // A worker that dies is replaced; the sessions it held are gone.
      log(`worker ${w.id} stopped (${code}); starting it again`);
      restart(w);
    });
  });

  // Starts a worker that stopped, after a wait that doubles while it keeps stopping or failing to start, so a
  // worker that cannot run does not spin the machine; a start that fails is tried again the same way.
  const restart = (w: Worker) => {
    const wait = Math.min(timing.maxMs ?? 30_000, (timing.firstMs ?? 1000) * 2 ** Math.min(w.restarts ?? 0, 20));
    w.restarts = (w.restarts ?? 0) + 1;
    setTimeout(() => {
      if (closing) return;
      start(w).catch((e) => {
        if (closing) return;
        log(`worker ${w.id} could not start again: ${(e as Error).message}; trying again`);
        restart(w);
      });
    }, wait);
  };

  const close = async () => {
    if (closing) return;
    closing = true;
    server.close();
    server.closeAllConnections();
    const stop = (w: Worker) => new Promise<void>((ok) => {
      if (!w.child) return ok();
      // Encrypted at rest, the leader is never cut off: it may be encrypting large files, and killed midway it
      // would leave them in plaintext. The others get ten seconds.
      const timer = opts.encryptionKey && w.id === 0 ? undefined : setTimeout(() => w.child?.kill('SIGKILL'), 10_000);
      w.child.once('exit', () => {
        clearTimeout(timer);
        ok();
      });
      post(w, { t: 'stop' });
    });
    // Encrypted at rest: the leader encrypts each file as it closes it and removes the plaintext, so the others
    // let go of the files first.
    if (opts.encryptionKey) {
      await Promise.all(pool.slice(1).map(stop));
      await stop(pool[0]);
    } else await Promise.all(pool.map(stop));
    for (const w of pool) w.agent.destroy();
    auto?.stop();
    rmSync(run, { recursive: true, force: true });
    closeLocal();
    release();
  };

  try {
    // The leader first: it converts and upgrades files before the others open them.
    await start(pool[0]);
    // A worker that fails to start (the machine busy while the leader is still settling) is tried once more.
    await Promise.all(pool.slice(1).map((w) => start(w).catch((e) => {
      if (closing) throw e;
      log(`worker ${w.id} could not start (${(e as Error).message}); trying again`);
      return start(w);
    })));
  } catch (e) {
    await close();
    throw e;
  }
  return { server, url, workers, tls: auto, pids: () => pool.map((w) => w.child?.pid), close };
}
