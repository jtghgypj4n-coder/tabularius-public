import { clientAddress } from './client-address.ts';
// Standby servers: another machine keeps a live copy of every hosted file, a
// second or so behind, ready to take over if this one fails (standby.ts is
// the other side). It copies each file once, then follows its changes: the
// logs the server takes from each file every second (logs.ts).
//
//   GET /tabularius/replication/v1/files                       hosted files and where each one's changes are up to
//   GET /tabularius/replication/v1/files/{db}/copy             the file as it is now
//   GET /tabularius/replication/v1/files/{db}/changes?run=R&after=N&wait=25
//                                                            changes after number N, waiting up to `wait`
//                                                            seconds for some when there are none yet
//
// Changes are numbered within a run (each server start, per file). The last
// few minutes of them are kept in memory; a standby further behind, or
// following an earlier run, copies the file again.
//
// Access: the replication token given to `tabularius serve --replication-token`
// (Bearer). Without one these routes don't exist.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Store } from '../../store/src/index.ts';
import type { Host } from './host.ts';
import { encodeRecord } from './logs.ts';
import type { LogFollower, LogRecord, LogShipper } from './logs.ts';
import { monotonicClock } from '../../store/src/monotonic.ts';

/** How often changes are taken for standbys (ms). */
export const REPLICATION_EVERY = 1000;
const KEEP_MS = 10 * 60_000;
const KEEP_BYTES = 256 * 1024 * 1024;
const MAX_RESPONSE = 32 * 1024 * 1024;
const MAX_WAIT = 30;
export const MAX_CONCURRENT_COPIES = 2;

interface Followed {
  run: string;
  seq: number;
  recent: (LogRecord & { received: number })[];
  bytes: number;
  waiting: Set<() => void>;
}

export interface StandbyClient {
  from: string;
  file: string;
  /** The last change it asked to follow from, and when. */
  seq: number;
  behind: number;
  /** Seconds since the oldest unacknowledged change was taken; zero when caught up. */
  lagSeconds: number;
  at: number;
}

/**
 * A standby still running the old product name reads the position of a copy or of changes from `x-openhbam-*` headers
 * (and asks for /openhbam/replication/..., which is answered as /tabularius/replication/...). Without them it would copy
 * the file again and again, so a primary upgraded first, as docs/upgrading.md says to do, keeps its old standby following.
 */
const legacyHeaders = (run: string, seq: number, wholeAfter?: number): Record<string, string> => ({
  'x-openhbam-run': run,
  'x-openhbam-seq': String(seq),
  ...(wholeAfter === undefined ? {} : { 'x-openhbam-whole-after': String(wholeAfter) }),
});

const sameToken = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class Replication {
  private readonly host: Host;
  private readonly token: string;
  private readonly files = new Map<Store, Followed>();
  /** Standbys seen lately, by address and file. */
  private readonly clients = new Map<string, { client: Omit<StandbyClient, 'lagSeconds'>; seen: number }>();
  private readonly follower: LogFollower;
  private readonly shipper: LogShipper;

  constructor(host: Host, shipper: LogShipper, token: string) {
    this.host = host;
    this.token = token;
    this.shipper = shipper;
    this.follower = {
      every: REPLICATION_EVERY,
      started: (store) => {
        const old = this.files.get(store);
        this.files.set(store, { run: randomBytes(8).toString('hex'), seq: 0, recent: [], bytes: 0, waiting: new Set() });
        for (const [key, value] of this.clients) if (value.client.file === store.name) this.clients.delete(key);
        for (const wake of old?.waiting ?? []) wake();
      },
      take: (store, data, at) => {
        const f = this.files.get(store);
        if (!f) return true; // followed before this started: started() comes first, so never
        const received = monotonicClock.now();
        f.recent.push({ at, seq: ++f.seq, data, received });
        f.bytes += data.length;
        while (f.recent.length > 1 && (f.bytes > KEEP_BYTES || f.recent[0].received < received - KEEP_MS)) f.bytes -= f.recent.shift()!.data.length;
        for (const wake of f.waiting) wake();
        f.waiting.clear();
        return true;
      },
    };
    shipper.add(this.follower);
  }

  private closing = false;
  private copying = 0;

  /** Answers the standbys waiting for changes, so the server can stop. */
  close(): void {
    this.closing = true;
    for (const f of this.files.values()) for (const wake of f.waiting) wake();
  }

  /** Standbys that asked for changes in the last minute. */
  standbys(): StandbyClient[] {
    const recent = monotonicClock.now() - 60_000;
    const now = Date.now();
    for (const [k, c] of this.clients) if (c.seen < recent) this.clients.delete(k);
    return [...this.clients.values()].map(({ client }) => {
      const followed = this.followed(client.file);
      const behind = followed ? Math.max(0, followed.f.seq - client.seq) : client.behind;
      // If the missing change aged out, use the oldest retained one: this standby is too far behind and will recopy.
      const oldest = followed?.f.recent.find((r) => r.seq === client.seq + 1) ?? followed?.f.recent[0];
      return { ...client, behind, lagSeconds: behind && oldest ? (now - oldest.at) / 1000 : 0 };
    });
  }

  private followed(name: string): { store: Store; f: Followed } | undefined {
    const store = this.host.get(name);
    const f = store && this.files.get(store);
    return store && f ? { store, f } : undefined;
  }

  /** Returns false when the request is not for replication. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith('/tabularius/replication/v1/')) return false;
    const json = (status: number, body: unknown) =>
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(body));
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
    if (!bearer || !sameToken(bearer, this.token)) {
      json(401, { error: 'replication token needed' });
      return true;
    }
    if (req.method !== 'GET') {
      json(405, { error: 'GET only' });
      return true;
    }
    if (url.pathname === '/tabularius/replication/v1/files') {
      // Files hosted since the last round are followed from now.
      for (const name of this.host.names()) this.shipper.follow(this.host.get(name)!);
      json(200, {
        files: this.host.names().flatMap((name) => {
          const x = this.followed(name);
          return x ? [{ name, run: x.f.run, seq: x.f.seq }] : [];
        }),
      });
      return true;
    }
    const m = /^\/tabularius\/replication\/v1\/files\/([^/]+)\/(copy|changes)$/.exec(url.pathname);
    const x = m && this.followed(decodeURIComponent(m[1]));
    if (!m || !x) {
      json(404, { error: 'no such file (or its changes are not followed yet)' });
      return true;
    }
    if (m[2] === 'copy') {
      if (this.copying >= MAX_CONCURRENT_COPIES) {
        res.setHeader('retry-after', '1');
        json(503, { error: 'too many copies in progress; retry later' });
      } else await this.copy(x.store, x.f, res);
    }
    else await this.changes(req, res, url, x.store, x.f);
    return true;
  }

  /**
   * The file as it is now, made with SQLite's online backup so users keep
   * working. The copy may already hold some changes after `seq`; applying
   * those again is harmless, and once it has applied the ones up to
   * `x-tabularius-whole-after` the standby's copy is consistent.
   */
  private async copy(store: Store, f: Followed, res: ServerResponse): Promise<void> {
    if (res.destroyed) return;
    this.copying++;
    const { run } = f;
    const from = f.seq;
    const tmp = join(this.host.dir, `.standby-copy-${randomBytes(6).toString('hex')}.tmp`);
    try {
      await store.backup(tmp);
      if (res.destroyed) return;
      if (this.closing || this.host.get(store.name) !== store || this.files.get(store) !== f) {
        res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          .end(JSON.stringify({ error: 'the primary changed while copying; retry the copy' }));
        return;
      }
      // Changes taken while copying may be in it only in part, and later ones over them. Once those are
      // applied it is as the file was when the last was taken; if more changes were made after that, it
      // is whole once the next one, which holds them, is applied too.
      const pending = existsSync(store.path + '-wal') && statSync(store.path + '-wal').size > 0;
      const whole = f.seq > from && pending ? f.seq + 1 : f.seq;
      res.writeHead(200, {
        'content-type': 'application/vnd.sqlite3',
        'content-length': statSync(tmp).size,
        'cache-control': 'no-store',
        'x-tabularius-run': run,
        'x-tabularius-seq': String(from),
        'x-tabularius-whole-after': String(whole),
        ...legacyHeaders(run, from, whole),
      });
      await pipeline(createReadStream(tmp), res);
    } catch (e) {
      if (!res.destroyed && !res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (e as Error).message }));
      else res.destroy();
    } finally {
      this.copying--;
      rmSync(tmp, { force: true });
    }
  }

  private async changes(req: IncomingMessage, res: ServerResponse, url: URL, store: Store, f: Followed): Promise<void> {
    const run = url.searchParams.get('run');
    const after = Number(url.searchParams.get('after'));
    const wait = Math.min(MAX_WAIT, Math.max(0, Number(url.searchParams.get('wait') ?? 0) || 0));
    const fail = (status: number, error: string): void => void res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify({ error, run: f.run, seq: f.seq }));
    if (run !== f.run) return fail(409, 'the server restarted since: copy the file again');
    if (!Number.isInteger(after) || after < 0 || after > f.seq) return fail(409, `no change ${after} in this run`);
    const address = clientAddress(req);
    const id = req.headers['x-tabularius-standby-id'];
    const from = typeof id === 'string' && /^[a-f0-9]{16}$/.test(id) ? `${address}#${id}` : address;
    this.clients.set(`${from}\0${store.name}`, {
      client: { from, file: store.name, seq: after, behind: f.seq - after, at: Date.now() },
      seen: monotonicClock.now(),
    });
    if (after === f.seq && wait > 0) {
      // Nothing new yet: answer when there is, or when the wait is over.
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          f.waiting.delete(done);
          resolve();
        };
        const timer = setTimeout(done, wait * 1000);
        f.waiting.add(done);
        res.once('close', done);
      });
      const now = this.files.get(store);
      if (res.destroyed) return;
      if (this.closing) return fail(503, 'the server is stopping');
      if (now !== f) return fail(409, 'the file was taken up again: copy it again');
    }
    if (after < f.seq && (!f.recent.length || f.recent[0].seq > after + 1)) return fail(410, 'too far behind: copy the file again');
    const parts: Buffer[] = [];
    let size = 0;
    for (const r of f.recent) {
      if (r.seq <= after) continue;
      if (parts.length && size + r.data.length > MAX_RESPONSE) break;
      const b = encodeRecord(r);
      parts.push(b);
      size += b.length;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'content-length': size, 'x-tabularius-run': f.run, 'x-tabularius-seq': String(f.seq), ...legacyHeaders(f.run, f.seq) });
    res.end(Buffer.concat(parts));
  }
}
