// Scheduled digests: "every Monday at 8, summarise new and overdue invoices". A dashboard is worked out on a
// schedule, as the account that set the digest up, and the assistant (when the server has one) writes a short
// summary of it in plain English. Each run is kept with the file and shown in the app: on the dashboards page,
// as a notice in the web client when it is new, and in the admin console. Nothing is emailed. A developer with
// [Full Access] can also have each run posted to one of the admin console's webhooks, which sends only on a server
// started with --allow-webhooks, signed like the change webhooks.
//
//   GET    /tabularius/digests/v1/databases/{db}               digests, each with its latest run (runs only for the
//                                                             account that made it, or [Full Access])
//   POST   /tabularius/digests/v1/databases/{db}               {dashboard, name?, days, at, prompt?, webhook?}
//   PUT    /tabularius/digests/v1/databases/{db}/{id}          {name?, days?, at?, prompt?, webhook?, enabled?}
//   DELETE /tabularius/digests/v1/databases/{db}/{id}
//   POST   /tabularius/digests/v1/databases/{db}/{id}/run      runs it now
//   GET    /tabularius/digests/v1/databases/{db}/{id}/runs     its recent runs, newest first
//
// The summary's numbers are the dashboard's, worked out from the data; the assistant reads them and may look
// further with its read-only tools, as the digest's account, offline, with secrets redacted.

import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StoreError, type Privileges, type Store } from '../../store/src/index.ts';
import { ApiError, badPathError, readJson, sessionPrivileges, type DataApi } from './dataapi.ts';
import type { Host } from './host.ts';
import { computeDashboard, Dashboards, mayChange, type Dashboard, type WidgetData } from './dashboards.ts';

export interface Digest {
  id: string;
  name: string;
  /** The dashboard it works out. */
  dashboard: string;
  /** Days of the week it runs, 0 for Sunday to 6 for Saturday. */
  days: number[];
  /** Time of day it runs ("08:00"), the server's local time. */
  at: string;
  /** What to summarise ("new and overdue invoices"); without it, the summary covers the whole dashboard. */
  prompt?: string;
  /** An admin console webhook each run is posted to (sent only with --allow-webhooks). */
  webhook?: string;
  enabled: boolean;
  /** The account it runs as, the one that set it up. */
  account: string;
  created: string;
  updated: string;
}

export interface DigestRun {
  id: string;
  digest: string;
  at: string;
  /** The scheduled time it ran for; none when run by hand. */
  scheduled?: string;
  outcome: 'ok' | 'error';
  /** The assistant's summary. */
  summary?: string;
  /** Why there is no AI summary (the assistant is off, the account has no AI access, the day's limit is used). */
  summaryNote?: string;
  /** The dashboard's numbers, in a few lines, worked out without the assistant. */
  highlights: string[];
  data: WidgetData[];
  webhook?: { sent: boolean; error?: string };
  error?: string;
  ms: number;
}

/** Historical/model prose has no per-record provenance with which to reapply a view rule. */
function withoutRecordData(run: DigestRun): DigestRun {
  return { id: run.id, digest: run.digest, at: run.at, scheduled: run.scheduled,
    outcome: run.outcome, ms: run.ms, data: [], highlights: [],
    summaryNote: 'Saved record data is unavailable with restricted read access. Run the dashboard to see current results.' };
}

/** What writes the summary: the assistant, or nothing when the server has none. */
export interface DigestWriter {
  summarize(store: Store, account: string, privileges: Privileges, ask: string, signal?: AbortSignal): Promise<{ summary?: string; note?: string }>;
}
/** Where runs are posted, when the digest has a webhook. */
export interface DigestPoster {
  readonly allowed: boolean;
  post(id: string, database: string, payload: Record<string, unknown>): Promise<void>;
}

export class DigestError extends Error {}

const RUNS_KEPT = 20;
/** A run missed by more than this (the server was down) is skipped rather than sent late. */
const CATCH_UP_MS = 6 * 3600_000;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "Mondays at 08:00", "every day at 17:30", "weekdays at 09:00". */
export function describeSchedule(d: Pick<Digest, 'days' | 'at'>): string {
  const days = [...new Set(d.days)].sort();
  const when = days.length === 7 ? 'every day' : days.join() === '1,2,3,4,5' ? 'weekdays' : days.join() === '0,6' ? 'weekends'
    : days.map((n) => DAY_NAMES[n] + 's').join(', ').replace(/, ([^,]*)$/, ' and $1');
  return `${when[0].toUpperCase()}${when.slice(1)} at ${d.at}`;
}

/** The latest scheduled time at or before `now`, if one falls in the last week. */
export function lastSlot(d: Pick<Digest, 'days' | 'at'>, now: Date): Date | undefined {
  const [h, m] = d.at.split(':').map(Number);
  for (let back = 0; back <= 7; back++) {
    const t = new Date(now);
    t.setDate(t.getDate() - back);
    t.setHours(h, m, 0, 0);
    if (t <= now && d.days.includes(t.getDay())) return t;
  }
  return undefined;
}

/** The next scheduled time after `now`. */
export function nextSlot(d: Pick<Digest, 'days' | 'at'>, now: Date): Date | undefined {
  const [h, m] = d.at.split(':').map(Number);
  for (let ahead = 0; ahead <= 7; ahead++) {
    const t = new Date(now);
    t.setDate(t.getDate() + ahead);
    t.setHours(h, m, 0, 0);
    if (t > now && d.days.includes(t.getDay())) return t;
  }
  return undefined;
}

/** A dashboard's numbers in a few lines, for the digest and for when there is no assistant. */
export function highlights(data: WidgetData[]): string[] {
  const out: string[] = [];
  const num = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v ?? '–'));
  for (const w of data) {
    if (w.error) out.push(`${w.title}: couldn't be worked out (${w.error})`);
    else if (w.kind === 'number') out.push(`${w.title}: ${num(w.value)}`);
    else if (w.kind === 'table') {
      const rows = w.rows ?? [];
      const first = rows.slice(0, 3).map((r) => r.map(num).join(' · '));
      out.push(`${w.title}: ${rows.length ? `${rows.length} row${rows.length === 1 ? '' : 's'}${w.groupCount && w.groupCount > rows.length ? ` of ${w.groupCount}` : ''}; ${first.join('; ')}${rows.length > 3 ? '; …' : ''}` : 'nothing found'}`);
    } else {
      const cats = w.categories ?? [];
      const values = w.series?.[0]?.values ?? [];
      const top = cats.slice(0, 3).map((c, i) => `${c} ${num(values[i])}`);
      out.push(`${w.title}: ${cats.length ? top.join(', ') + (cats.length > 3 ? ', …' : '') : 'nothing found'}`);
    }
  }
  return out;
}

/** The question the assistant answers for a run: what to summarise, and the numbers it is given. */
export function digestQuestion(d: Pick<Digest, 'name' | 'prompt'>, dashboard: Pick<Dashboard, 'name'>, data: WidgetData[], now: Date): string {
  const numbers = data.map((w) => JSON.stringify({
    title: w.title, find: w.find, grouping: w.grouping, foundCount: w.foundCount, value: w.value, categories: w.categories?.slice(0, 20),
    series: w.series?.map((s) => ({ name: s.name, values: s.values.slice(0, 20) })), columns: w.columns, rows: w.rows?.slice(0, 20), error: w.error,
  })).join('\n');
  return `Write the scheduled digest "${d.name}" for ${now.toDateString()}: ${d.prompt?.trim() || `a summary of the dashboard "${dashboard.name}"`}.\n` +
    `The dashboard "${dashboard.name}" was just worked out from the data; its widgets, one per line:\n${numbers}`;
}

// --- saved digests ---------------------------------------------------------------

interface Row { id: string; spec: string; last_slot: string | null }
interface RunRow { spec: string }

/** A file's digests and their runs, kept in the file so they travel with it. */
export class Digests {
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  private table(): boolean {
    try {
      this.store.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_digests (id TEXT PRIMARY KEY, spec TEXT NOT NULL, last_slot TEXT);
        CREATE TABLE IF NOT EXISTS _fm_digest_runs (id TEXT PRIMARY KEY, digest TEXT NOT NULL, at TEXT NOT NULL, spec TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS _fm_digest_runs_by ON _fm_digest_runs (digest, at)`);
      return true;
    } catch {
      return false; // a read-only copy: no digests
    }
  }

  list(): Digest[] {
    if (!this.table()) return [];
    return (this.store.sql.prepare('SELECT * FROM _fm_digests').all() as unknown as Row[]).map((r) => JSON.parse(r.spec) as Digest)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): Digest | undefined {
    if (!this.table()) return undefined;
    const r = this.store.sql.prepare('SELECT * FROM _fm_digests WHERE id = ?').get(id) as unknown as Row | undefined;
    return r ? JSON.parse(r.spec) as Digest : undefined;
  }

  /** The scheduled time it last ran for (or was set up after), so a time is never run twice. */
  lastSlot(id: string): string | undefined {
    if (!this.table()) return undefined;
    return (this.store.sql.prepare('SELECT last_slot FROM _fm_digests WHERE id = ?').get(id) as { last_slot: string | null } | undefined)?.last_slot ?? undefined;
  }

  markSlot(id: string, slot: string): void {
    this.store.sql.prepare('UPDATE _fm_digests SET last_slot = ? WHERE id = ?').run(slot, id);
  }

  create(input: Omit<Digest, 'id' | 'created' | 'updated'>, now = new Date()): Digest {
    if (!this.table()) throw new DigestError('This file is read-only');
    const at = now.toISOString();
    const d: Digest = { id: randomBytes(6).toString('hex'), ...input, created: at, updated: at };
    // The time just passed doesn't count: the first run is the next one.
    this.store.sql.prepare('INSERT INTO _fm_digests (id, spec, last_slot) VALUES (?, ?, ?)').run(d.id, JSON.stringify(d), lastSlot(d, now)?.toISOString() ?? null);
    return d;
  }

  update(id: string, change: Partial<Omit<Digest, 'id' | 'created' | 'account' | 'dashboard'>>, now = new Date()): Digest {
    const d = this.get(id);
    if (!d) throw new DigestError('No such digest');
    const next: Digest = { ...d, ...change, updated: now.toISOString() };
    for (const k of ['prompt', 'webhook'] as const) if (!next[k]) delete next[k];
    this.store.sql.prepare('UPDATE _fm_digests SET spec = ? WHERE id = ?').run(JSON.stringify(next), id);
    // A new time that has just passed waits for its next turn too.
    if (change.days || change.at) this.markSlot(id, lastSlot(next, now)?.toISOString() ?? '');
    return next;
  }

  delete(id: string): boolean {
    if (!this.table()) return false;
    this.store.sql.prepare('DELETE FROM _fm_digest_runs WHERE digest = ?').run(id);
    return this.store.sql.prepare('DELETE FROM _fm_digests WHERE id = ?').run(id).changes > 0;
  }

  addRun(run: DigestRun): void {
    if (!this.table()) return;
    this.store.sql.prepare('INSERT INTO _fm_digest_runs (id, digest, at, spec) VALUES (?, ?, ?, ?)').run(run.id, run.digest, run.at, JSON.stringify(run));
    this.store.sql.prepare(`DELETE FROM _fm_digest_runs WHERE digest = ? AND id NOT IN
      (SELECT id FROM _fm_digest_runs WHERE digest = ? ORDER BY at DESC, rowid DESC LIMIT ${RUNS_KEPT})`).run(run.digest, run.digest);
  }

  runs(id: string, limit = RUNS_KEPT): DigestRun[] {
    if (!this.table()) return [];
    return (this.store.sql.prepare('SELECT spec FROM _fm_digest_runs WHERE digest = ? ORDER BY at DESC, rowid DESC LIMIT ?').all(id, limit) as unknown as RunRow[])
      .map((r) => JSON.parse(r.spec) as DigestRun);
  }
}

/** A digest as sent, checked: the days, the time, the dashboard and the webhook. */
export function cleanDigest(store: Store, input: Record<string, unknown>, partial: boolean, webhooks?: { id: string; database: string }[]): Partial<Digest> {
  const out: Partial<Digest> = {};
  if (!partial || input.dashboard !== undefined) {
    const d = new Dashboards(store).find(String(input.dashboard ?? ''));
    if (!d) throw new DigestError(`No dashboard "${String(input.dashboard ?? '')}" in ${store.name}`);
    out.dashboard = d.id;
    if (!partial && !input.name) out.name = d.name;
  }
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name || name.length > 100) throw new DigestError('Give the digest a name (up to 100 characters)');
    out.name = name;
  }
  if (!partial || input.days !== undefined) {
    const days = Array.isArray(input.days) ? input.days : [];
    if (!days.length || !days.every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 6)) {
      throw new DigestError('days is a list of days of the week, 0 for Sunday to 6 for Saturday');
    }
    out.days = [...new Set(days as number[])].sort();
  }
  if (!partial || input.at !== undefined) {
    if (typeof input.at !== 'string' || !TIME.test(input.at)) throw new DigestError('at is a time of day, HH:MM');
    out.at = input.at;
  }
  if (input.prompt !== undefined) {
    const prompt = String(input.prompt ?? '').trim();
    if (prompt.length > 2000) throw new DigestError('Keep what to summarise under 2,000 characters');
    out.prompt = prompt;
  }
  if (input.webhook !== undefined) {
    const id = String(input.webhook ?? '');
    if (id && !webhooks?.some((w) => w.id === id && w.database.toLowerCase() === store.name.toLowerCase())) {
      throw new DigestError(`No webhook ${id} for ${store.name} in the admin console`);
    }
    out.webhook = id;
  }
  if (input.enabled !== undefined) out.enabled = input.enabled === true;
  return out;
}

// --- running them ------------------------------------------------------------------

export class DigestRunner {
  private readonly host: Host;
  private readonly log: (m: string) => void;
  writer?: DigestWriter;
  poster?: DigestPoster;
  private timer?: NodeJS.Timeout;
  private readonly running = new Set<string>();

  constructor(host: Host, log: (m: string) => void = () => {}) {
    this.host = host;
    this.log = log;
  }

  /** Checks every minute for digests whose time has come. */
  start(every = 60_000): void {
    this.timer = setInterval(() => void this.tick(), every);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Runs every digest whose time has come since its last run (within the catch-up window). */
  async tick(now = new Date()): Promise<void> {
    for (const name of this.host.names()) {
      const store = this.host.get(name);
      if (!store) continue;
      const digests = new Digests(store);
      for (const d of digests.list()) {
        if (!d.enabled || this.running.has(d.id)) continue;
        const slot = lastSlot(d, now);
        if (!slot) continue;
        const last = digests.lastSlot(d.id);
        if (last && new Date(last) >= slot) continue;
        digests.markSlot(d.id, slot.toISOString());
        if (now.getTime() - slot.getTime() > CATCH_UP_MS) {
          this.log(`digest "${d.name}" in ${store.name}: skipped the run for ${slot.toISOString()}, missed while the server was down`);
          continue;
        }
        await this.run(store, d, slot);
      }
    }
  }

  /** Works the digest's dashboard out, has it summarised, keeps the run and posts it to the webhook. */
  async run(store: Store, d: Digest, scheduled?: Date): Promise<DigestRun> {
    const started = Date.now();
    const run: DigestRun = {
      id: randomBytes(6).toString('hex'), digest: d.id, at: new Date().toISOString(), ...(scheduled ? { scheduled: scheduled.toISOString() } : {}),
      outcome: 'ok', highlights: [], data: [], ms: 0,
    };
    this.running.add(d.id);
    try {
      // Includes related hosted files: a summary can read through the relationship graph. A change of accounts or
      // privileges always voids the run; a record write only does for an account whose view of records can depend on
      // them (an account that reads everything is shown the same records whatever is written meanwhile).
      let writes = true;
      const stamp = () => JSON.stringify(this.host.names().map((name) => {
        const file = this.host.get(name);
        return [name, file?.securityToken(), writes ? file?.writeToken() : undefined];
      }));
      let before = stamp();
      // After the webhook post the payload has gone out, so its record stays: the run says that it was sent.
      const recheck = (posted = false) => {
        if (stamp() === before) return;
        const clean = withoutRecordData(run);
        for (const key of ['summary', 'summaryNote', 'error', ...(posted ? [] : ['webhook'] as const)] as const) delete run[key];
        Object.assign(run, clean, { outcome: 'error', error: posted && run.webhook?.sent
          ? 'Data or access changed while the digest was running, after it was sent to the webhook; run it again.'
          : 'Data or access changed while the digest was running; run it again.' });
      };
      try {
        const account = store.accounts().find((a) => a.name.toLowerCase() === d.account.toLowerCase());
        if (account?.inactive) throw new DigestError(`The account "${d.account}" it runs as is inactive`);
        const privileges = store.privileges(account?.name ?? d.account);
        if (!privileges.name) throw new DigestError(`The account "${d.account}" it runs as is gone`);
        // Nothing has been awaited since the stamp above, so it still describes what these privileges were read from.
        writes = !privileges.readsEverything;
        before = stamp();
        const dashboard = new Dashboards(store).get(d.dashboard);
        if (!dashboard) throw new DigestError('Its dashboard has been deleted');
        run.data = computeDashboard(store, dashboard.widgets, privileges);
        run.highlights = highlights(run.data);
        if (!this.writer) run.summaryNote = 'No AI summary: the assistant is off on this server (start it with --ai)';
        else if (!privileges.has('fmmcp')) run.summaryNote = `No AI summary: the "${privileges.name}" privilege set doesn't have AI access (fmmcp)`;
        else if (!privileges.readsEverything) run.summaryNote = 'No AI summary: restricted read access needs current dashboard results, without cached prose';
        else {
          try {
            store.recordUsage(account?.name ?? d.account, 'mcp');
            const modelData = computeDashboard(store, dashboard.widgets, privileges, new Date(), undefined, true);
            const r = await this.writer.summarize(store, account?.name ?? d.account, privileges, digestQuestion(d, dashboard, modelData, new Date()), AbortSignal.timeout(5 * 60_000));
            if (r.summary) run.summary = r.summary;
            if (r.note) run.summaryNote = r.note;
          } catch (e) {
            run.summaryNote = `No AI summary: ${(e as Error).message}`;
          }
        }
      } catch (e) {
        run.outcome = 'error';
        run.error = e instanceof DigestError || e instanceof StoreError ? e.message : `Couldn't run: ${(e as Error).message}`;
      }
      recheck();
      if (d.webhook) {
        if (!this.poster?.allowed) run.webhook = { sent: false, error: 'Not sent: webhooks are off on this server (start it with --allow-webhooks)' };
        else {
          try {
            await this.poster.post(d.webhook, store.name, {
              digest: { id: d.id, name: d.name, dashboard: d.dashboard, schedule: describeSchedule(d) }, database: store.name,
              run: { at: run.at, scheduled: run.scheduled, outcome: run.outcome, summary: run.summary, highlights: run.highlights, error: run.error },
            });
            run.webhook = { sent: true };
          } catch (e) {
            run.webhook = { sent: false, error: (e as Error).message };
          }
        }
      }
      recheck(true);
      run.ms = Date.now() - started;
      new Digests(store).addRun(run);
      if (run.outcome === 'error') this.log(`digest "${d.name}" in ${store.name}: ${run.error}`);
      return run;
    } finally {
      this.running.delete(d.id);
    }
  }

  /** Every hosted file's digests with their latest run, for the admin console. */
  all(): (Digest & { database: string; schedule: string; next?: string; last?: Omit<DigestRun, 'data'> })[] {
    const now = new Date();
    return this.host.names().flatMap((name) => {
      const store = this.host.get(name);
      if (!store) return [];
      const digests = new Digests(store);
      return digests.list().map((d) => {
        const last = digests.runs(d.id, 1)[0];
        const next = d.enabled ? nextSlot(d, now) : undefined;
        return { ...d, database: store.name, schedule: describeSchedule(d), ...(next ? { next: next.toISOString() } : {}), ...(last ? { last: withoutData(last) } : {}) };
      });
    });
  }
}

const withoutData = ({ data: _d, ...run }: DigestRun): Omit<DigestRun, 'data'> => run;

/** Whether an account may see a digest's runs: they hold what its account sees, so its account, or [Full Access]. */
export const mayRead = (d: Digest, account: string | undefined, privileges: Privileges) =>
  !privileges.ceiling && (privileges.full || (!!account && d.account.toLowerCase() === account.toLowerCase()));

// --- HTTP --------------------------------------------------------------------------

export class DigestApi {
  private readonly host: Host;
  private readonly api: DataApi;
  private readonly runner: DigestRunner;
  /** The admin console's webhooks, to pick one from. */
  webhooks?: () => { id: string; url: string; database: string; enabled: boolean }[];

  constructor(host: Host, api: DataApi, runner: DigestRunner) {
    this.host = host;
    this.api = api;
    this.runner = runner;
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m = /^\/tabularius\/digests\/v1\/databases\/([^/]+)(?:\/([0-9a-f]{12})(?:\/(run|runs))?)?$/.exec(url.pathname);
    if (!m) return false;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      const db = decodeURIComponent(m[1]);
      const session = this.api.authorize(req, db);
      const store = this.host.get(db);
      if (!store) throw new ApiError(802, 'Unable to open file', 404);
      const privileges = sessionPrivileges(store, session);
      // Runs and schedules use the saved account; a scoped token cannot act as that account or read its cached results.
      if (privileges.ceiling) throw new ApiError(9, 'This API token cannot use account-level digests', 403);
      const digests = new Digests(store);
      const runs = (id: string, limit?: number) => digests.runs(id, limit).map((run) => privileges.readsEverything ? run : withoutRecordData(run));
      const boards = new Dashboards(store);
      const hooks = (this.webhooks?.() ?? []).filter((w) => w.database.toLowerCase() === store.name.toLowerCase());
      const now = new Date();
      const shown = (d: Digest) => {
        const board = boards.get(d.dashboard);
        const readable = mayRead(d, session.account, privileges);
        const last = readable ? runs(d.id, 1)[0] : undefined;
        const next = d.enabled ? nextSlot(d, now) : undefined;
        return {
          ...d, ...(privileges.full ? {} : { webhook: undefined }), schedule: describeSchedule(d), dashboardName: board?.name, ...(next ? { next: next.toISOString() } : {}),
          canChange: readable, ...(last ? { last } : {}),
        };
      };
      const [, , id, sub] = m;
      if (!id && req.method === 'GET') {
        // The admin console's webhooks for this file, for [Full Access] to pick one (never their secrets).
        send(200, { digests: digests.list().map(shown), ...(privileges.full ? { webhooks: hooks.map(({ id, url, enabled }) => ({ id, url, enabled })) } : {}) });
      } else if (!id && req.method === 'POST') {
        const body = await readJson(req);
        const clean = cleanDigest(store, body, false, hooks);
        const board = boards.get(clean.dashboard!)!;
        if (!mayChange(board, session.account, privileges)) throw new ApiError(9, 'Only the account that made this dashboard, or one with [Full Access], can send digests of it', 403);
        if (clean.webhook && !privileges.full) throw new ApiError(9, 'Posting digests to a webhook takes [Full Access]', 403);
        const d = digests.create({
          name: clean.name!, dashboard: clean.dashboard!, days: clean.days!, at: clean.at!, ...(clean.prompt ? { prompt: clean.prompt } : {}),
          ...(clean.webhook ? { webhook: clean.webhook } : {}), enabled: clean.enabled ?? true, account: session.account,
        });
        send(201, { digest: shown(d) });
      } else {
        const d = id ? digests.get(id) : undefined;
        if (!d) throw new ApiError(401, 'No such digest', 404);
        if (!mayRead(d, session.account, privileges)) throw new ApiError(9, 'Only the account that set up this digest, or one with [Full Access], can see or change it', 403);
        if (sub === 'runs' && req.method === 'GET') send(200, { runs: runs(d.id) });
        else if (sub === 'run' && req.method === 'POST') send(200, { run: await this.runner.run(store, d) });
        else if (!sub && req.method === 'GET') send(200, { digest: shown(d), runs: runs(d.id) });
        else if (!sub && req.method === 'PUT') {
          const body = await readJson(req);
          const { dashboard: _d, ...change } = cleanDigest(store, body, true, hooks);
          if (change.webhook && !privileges.full) throw new ApiError(9, 'Posting digests to a webhook takes [Full Access]', 403);
          send(200, { digest: shown(digests.update(d.id, change)) });
        } else if (!sub && req.method === 'DELETE') {
          digests.delete(d.id);
          send(200, { deleted: d.id });
        } else throw new ApiError(3, 'Not supported', 405);
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : e instanceof URIError ? badPathError() : e instanceof DigestError ? new ApiError(960, e.message, 400) : e instanceof StoreError ? new ApiError(e.code, e.message, 400) : new ApiError(-1, 'Unknown error');
      if (!(e instanceof URIError) && !(e instanceof ApiError) && !(e instanceof DigestError) && !(e instanceof StoreError)) console.error(e);
      send(err.status, { error: { code: err.code, message: err.message } });
    }
    return true;
  }
}
