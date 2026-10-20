import { clientAddress } from './client-address.ts';
// Calendar feeds and import for a layout's date fields (iCalendar, RFC 5545).
//
//   GET  /tabularius/calendar/v1/databases/{db}/layouts/{layout}/calendar.ics
//          ?start={field}[&end={field}][&title={field}][&description={field}][&location={field}]
//          [&query=[{"Field":"criterion"}]][&zone={IANA name | UTC}][&limit={n}]
//     -> text/calendar: one event per record in the found set (all records without `query`), oldest start first.
//   POST /tabularius/calendar/v1/databases/{db}/layouts/{layout}/calendar-import
//          ?start={field}[&end=..][&title=..][&description=..][&location=..][&uid={field}][&zone={IANA name | UTC}]
//     body: an .ics file -> { imported, skipped, notes }
//
// Signed in like the Data API, with a session or API token in the Authorization header. A calendar app cannot send
// a header, so the feed (GET only) also takes ?token=: but only an API token that is read-only AND scoped to this one
// layout, so a feed link that leaks shows that layout and can change nothing. Revoke the token to end the link.
// Record and field privileges apply as in the Data API: records the account cannot view are not in the feed.
// The feed is capped (MAX_EVENTS): a found set over the cap is an error, never a feed that quietly lacks events.

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { endTransaction, StoreError, writer, type FieldData, type FindRequest, type LayoutInfo, type Store, type Transaction } from '../../store/src/index.ts';
import { expiryClock } from '../../store/src/clock.ts';
import { addDays, buildCalendar, parseDate, parseStamp, readCalendar, READ_LIMITS, utcToZoned, zonedToUtc, zoneName, type FeedEvent, type ReadTime, type When } from '../../store/src/calendar.ts';
import { ApiError, badPathError, maxLimit, readBody, sessionPrivileges, type DataApi } from './dataapi.ts';
import type { Host } from './host.ts';
import { MAX_JSON_QUERY_BYTES, parseRequestJson } from './request-json.ts';
import { requestOrigin } from './public-origin.ts';
import { redactPath } from './server-logs.ts';

export const MAX_EVENTS = 5000;

/** The most events a feed holds: the cap, or the operator's Data API limit when that is lower. */
const feedCap = () => (maxLimit() === 0 ? MAX_EVENTS : Math.min(MAX_EVENTS, maxLimit()));
const REFRESH_HOURS = 1;

interface Mapping {
  start: string;
  end?: string;
  title?: string;
  description?: string;
  location?: string;
  uid?: string;
}

const ROLES = ['start', 'end', 'title', 'description', 'location'] as const;

/** One transaction in every file it touches: all of it, or none. */
function atomically<T>(fn: () => T): T {
  const tx: Transaction = { files: new Map() };
  try {
    const r = writer.run({ ...(writer.getStore() ?? {}), transaction: { open: tx } }, fn);
    endTransaction(tx, true);
    return r;
  } catch (e) {
    endTransaction(tx, false);
    throw e;
  }
}

/** The zone the field readings are in: undefined for none (floating times), "UTC", or an IANA name. */
function zoneOf(text: string | null): string | undefined {
  if (text === null || text === '') return undefined;
  const zone = text.toUpperCase() === 'UTC' ? 'UTC' : zoneName(text);
  if (!zone) throw new ApiError(960, 'Parameter is invalid: zone (use UTC or an IANA name such as Europe/London)', 400);
  return zone;
}

/** Which fields play which part, checked against the layout and what the account may see. */
function mappingOf(q: URLSearchParams, info: LayoutInfo, privileges: ReturnType<typeof sessionPrivileges>, extra?: 'uid'): Mapping {
    const out: Partial<Mapping> = {};
    for (const role of [...ROLES, ...(extra === undefined ? [] : ['uid' as const])]) {
      const wanted = q.get(role);
      if (wanted === null || wanted === '') continue;
      const field = info.fields.find((f) => f.name.toLowerCase() === wanted.toLowerCase());
      const invalid = () => new ApiError(960, `Parameter is invalid: ${role}`, 400);
      // A field the layout does not show, or the account may not see, is as if it were not there.
      const access = field && privileges.in(info.owner).fieldAccess(info.table, field.name);
      // A masked field shows only a stand-in, so it cannot place or fill an event: it is as good as hidden for the dates,
      // and for everything an import writes. A feed's title, description and location may show the mask, as the Data API does.
      if (!field || field.name.includes('::') || field.summary || access === 'none'
        || (access === 'masked' && (extra === 'uid' || role === 'start' || role === 'end'))) throw invalid();
      if (field.type === 'container') throw invalid();
      if ((role === 'start' || role === 'end') && field.type !== 'date' && field.type !== 'timestamp') {
        throw new ApiError(960, `Parameter is invalid: ${role} must be a date or timestamp field`, 400);
      }
      out[role] = field.name;
    }
    if (!out.start) throw new ApiError(958, 'Parameter missing (*): start', 400);
    const type = (name: string) => info.fields.find((f) => f.name === name)!.type;
    if (out.end && type(out.end) !== type(out.start)) throw new ApiError(960, 'Parameter is invalid: start and end must be the same kind of field (both dates or both timestamps)', 400);
    return out as Mapping;
  }

/** A feed's `query`: a list of finds, each field names and text criteria. */
function queryOf(raw: string | null): FindRequest[] | undefined {
  if (raw === null || raw === '') return undefined;
  let parsed: unknown;
  try { parsed = parseRequestJson(raw, MAX_JSON_QUERY_BYTES); } catch { throw new ApiError(960, 'Parameter is invalid: query', 400); }
  if (!Array.isArray(parsed) || !parsed.length || parsed.some((r) => r === null || typeof r !== 'object' || Array.isArray(r)
    || Object.values(r as Record<string, unknown>).some((c) => c !== null && typeof c === 'object'))) {
    throw new ApiError(960, 'Parameter is invalid: query (a list of finds, each field names and text criteria)', 400);
  }
  return parsed as FindRequest[];
}


// --- Feeds a person makes and revokes -------------------------------------------------------------------------------
// A feed is a read-only API token scoped to one layout, plus the address that carries the field choices. The token is
// the only thing stored (with a label that marks it a calendar feed): the address is shown once, as an API token is.
// Making and revoking one is a security change, so it needs Full Access, as Manage Security does; the feed itself shows
// only what the account it acts as may see.

const FEED_LABEL = 'Calendar feed';

export interface FeedRequest {
  layout: string;
  start: string;
  end?: string;
  title?: string;
  description?: string;
  location?: string;
  zone?: string;
  /** A find as JSON: [{"Status":"open"}]. */
  query?: string;
  limit?: number;
  label?: string;
  expiresDays?: number;
}

export interface FeedMade {
  id: string;
  /** Path and query of the feed, token included. Shown once. */
  address: string;
  layout: string;
}

export interface FeedSummary {
  id: string;
  label: string;
  account: string;
  layout: string;
  created: string;
  expires?: string;
  lastUsed?: string;
}

/** The calendar feeds in a file: tokens made for one, never the secret. */
export function listFeeds(store: Store): FeedSummary[] {
  return store.apiTokens()
    .filter((t) => t.readOnly && t.layouts?.length === 1 && t.label !== undefined && (t.label === FEED_LABEL || t.label.startsWith(`${FEED_LABEL}: `)))
    .map((t) => ({
      id: t.id, label: t.label === FEED_LABEL ? '' : t.label!.slice(FEED_LABEL.length + 2), account: t.account, layout: t.layouts![0], created: t.created,
      ...(t.expires ? { expires: t.expires } : {}), ...(t.lastUsed ? { lastUsed: t.lastUsed } : {}),
    }));
}

/**
 * A new feed for `account`, checked as a request for the feed itself would be (the layout, the fields and what the
 * account may see of them), so a feed that could never be read is never made.
 */
export function createFeed(store: Store, account: string, privileges: ReturnType<typeof sessionPrivileges>, req: FeedRequest): FeedMade {
  if (typeof req.layout !== 'string' || !req.layout) throw new ApiError(958, 'Parameter missing (*): layout', 400);
  const wanted = req.layout.toLowerCase();
  const layout = store.schema.layouts.find((l) => l.name.toLowerCase() === wanted);
  if (!layout || privileges.layout(layout.name).layout === 'none') throw new ApiError(105, `Layout "${req.layout}" is missing`, 404);
  if (!privileges.has('fmrest')) throw new ApiError(9, `The "${privileges.name}" privilege set needs the fmrest extended privilege (Data API) for a calendar feed to open`, 403);
  const info = store.layout(layout.name);
  const q = new URLSearchParams();
  for (const role of ROLES) {
    const v = req[role];
    if (v !== undefined && v !== '') q.set(role, String(v));
  }
  const map = mappingOf(q, info, privileges);
  for (const role of ROLES) if (map[role]) q.set(role, map[role]!);
  const zone = zoneOf(req.zone ?? null);
  if (zone) q.set('zone', zone);
  if (req.query !== undefined && req.query !== '') {
    queryOf(req.query);
    q.set('query', req.query);
  }
  if (req.limit !== undefined) {
    const most = feedCap();
    if (!Number.isInteger(req.limit) || req.limit < 1 || req.limit > most) throw new ApiError(960, `Parameter is invalid: limit (1 to ${most})`, 400);
    q.set('limit', String(req.limit));
  }
  let expires: Date | undefined;
  if (req.expiresDays !== undefined && req.expiresDays !== null) {
    if (typeof req.expiresDays !== 'number' || !(req.expiresDays > 0) || req.expiresDays > 3650) throw new ApiError(960, 'Parameter is invalid: expiresDays (above 0 and up to 3650)', 400);
    expires = new Date(expiryClock.now() + req.expiresDays * 86_400_000);
  }
  const label = typeof req.label === 'string' && req.label.trim() ? req.label.trim().slice(0, 60) : '';
  let token: string;
  try {
    token = store.createApiToken(account, { label: label ? `${FEED_LABEL}: ${label}` : FEED_LABEL, readOnly: true, layouts: [layout.name], surfaces: ['fmrest'], expires, provenance: 'service' });
  } catch (e) {
    if (e instanceof StoreError) throw new ApiError(e.code, e.message, 400);
    throw e;
  }
  const id = /^ohbt_([0-9a-f]+)\./.exec(token)![1];
  q.set('token', token);
  return { id, layout: layout.name, address: `/tabularius/calendar/v1/databases/${encodeURIComponent(store.name)}/layouts/${encodeURIComponent(layout.name)}/calendar.ics?${q}` };
}

/** Ends a feed's link by revoking its token; false when there is no such feed (another kind of token is never touched). */
export function revokeFeed(store: Store, id: string): boolean {
  return listFeeds(store).some((f) => f.id === id) && store.revokeApiToken(id);
}

export class CalendarFeeds {
  private readonly host: Host;
  private readonly api: DataApi;

  constructor(host: Host, api: DataApi) {
    this.host = host;
    this.api = api;
  }

  /** Returns false when the request is not for the calendar feeds. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const feeds = /^\/tabularius\/calendar\/v1\/databases\/([^/]+)\/feeds(?:\/([0-9a-f]+))?$/.exec(url.pathname);
    if (feeds) return this.manage(req, res, url, feeds[1], feeds[2]);
    const m = /^\/tabularius\/calendar\/v1\/databases\/([^/]+)\/layouts\/([^/]+)\/(calendar\.ics|calendar-import)$/.exec(url.pathname);
    if (!m) return false;
    const started = performance.now();
    let status = 200;
    let code = 0;
    const reply = (s: number, headers: Record<string, string>, body: string | Buffer) => {
      status = s;
      res.writeHead(s, { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers });
      res.end(body);
    };
    let account = '';
    try {
      const db = decodeURIComponent(m[1]);
      const layout = decodeURIComponent(m[2]);
      const feed = m[3] === 'calendar.ics';
      if (feed ? req.method !== 'GET' && req.method !== 'HEAD' : req.method !== 'POST') {
        reply(405, { allow: feed ? 'GET, HEAD' : 'POST', 'content-type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'method not allowed' }));
        return true;
      }
      const sent = !!(req.headers.authorization || req.headers['x-fm-data-access-token']);
      const token = url.searchParams.get('token');
      if (!sent && token !== null && !feed) throw new ApiError(9, 'An import must be signed in with a header: ?token= opens a feed only', 403);
      // The token in the address stands in for the Authorization header, on this one route.
      const viaAddress = !sent && token !== null;
      // Checked before anything signs in with it: a login session or a broader token pasted into an address is refused
      // without being used, so a feed that polls it cannot keep it alive.
      if (viaAddress && token !== '') {
        if (!token!.startsWith('ohbt_')) throw new ApiError(9, 'A feed link must use an API token that is read-only and scoped to this one layout', 403);
        const bound = this.host.get(db)?.apiToken(token!);
        if (bound && !(bound.readOnly && bound.layouts?.length === 1 && bound.layouts[0].toLowerCase() === layout.toLowerCase())) {
          throw new ApiError(9, 'A feed link must use an API token that is read-only and scoped to this one layout', 403);
        }
      }
      const session = this.api.authorize(viaAddress ? ({ headers: { authorization: `Bearer ${token}` }, socket: req.socket } as IncomingMessage) : req, db);
      account = session.account;
      if (viaAddress && !(token!.startsWith('ohbt_') && session.readOnly && session.layoutScope?.length === 1 && session.layoutScope[0].toLowerCase() === layout.toLowerCase())) {
        throw new ApiError(9, 'A feed link must use an API token that is read-only and scoped to this one layout', 403);
      }
      const store = this.host.get(db);
      if (!store) throw new ApiError(802, 'Unable to open file', 404);
      const privileges = sessionPrivileges(store, session);
      const inScope = !session.layoutScope || session.layoutScope.some((l) => l.toLowerCase() === layout.toLowerCase());
      if (!inScope || privileges.layout(layout).layout === 'none') throw new ApiError(105, `Layout "${layout}" is missing`, 404);
      const info = store.layout(layout);
      if (!feed && !privileges.in(info.owner).table(info.table).create) throw new ApiError(9, 'This account may not create records here', 403);
      const map = this.mapping(url.searchParams, info, privileges, feed ? undefined : 'uid');
      const zone = this.zone(url.searchParams.get('zone'));
      if (feed) {
        const { text, skipped, count } = this.feed(store, info, layout, map, zone, url.searchParams, privileges, account);
        reply(200, {
          'content-type': 'text/calendar; charset=utf-8',
          'content-disposition': 'inline; filename="calendar.ics"',
          'x-tabularius-events': String(count),
          'x-tabularius-skipped': String(skipped),
        }, req.method === 'HEAD' ? '' : text);
      } else {
        if (session.readOnly) throw new ApiError(9, 'This API token is read-only', 403);
        const body = await readBody(req, READ_LIMITS.bytes);
        const result = importCalendar(store, info, layout, map, zone, body.toString('utf8'), privileges, account);
        reply(200, { 'content-type': 'application/json; charset=utf-8' }, JSON.stringify(result));
      }
    } catch (e) {
      const err = e instanceof URIError ? badPathError()
        : e instanceof ApiError ? e
        : e instanceof StoreError ? new ApiError(e.code, e.message, e.code === 212 ? 401 : e.code === 105 ? 404 : e.code === 812 || e.code === 301 ? 503 : e.code === 400 || e.code === 508 || e.code === 500 ? 400 : 500, e.denial)
        : new ApiError(-1, 'Unknown error');
      code = err.code;
      if (!(e instanceof ApiError) && !(e instanceof StoreError)) this.host.logs?.write('fmdapi', 'Error', clientAddress(req), `calendar: ${(e as Error).message}`);
      reply(err.status, { 'content-type': 'application/json; charset=utf-8' }, JSON.stringify({ messages: [{ code: String(err.code), message: err.message }] }));
    }
    // The token is cut out whatever way its name was written (tok%65n= is the same parameter).
    const logged = new URLSearchParams(url.search);
    for (const key of [...logged.keys()]) if (key.toLowerCase() === 'token') logged.set(key, '…');
    this.host.logs?.write('fmdapi', code ? (status >= 500 ? 'Error' : 'Warning') : 'Information', clientAddress(req),
      `${req.method} ${redactPath(url.pathname + (logged.size ? `?${logged}` : ''))} ${status} code ${code} ${Math.round(performance.now() - started)} ms${account ? ` account ${account}` : ''}`);
    return true;
  }

  /**
   *   GET    .../databases/{db}/feeds         the calendar feeds: label, layout, account, dates (never an address)
   *   POST   .../databases/{db}/feeds         {layout, start, end?, title?, description?, location?, zone?, query?, limit?, label?, expiresDays?}
   *            -> {id, address, url, layout}: the address is shown this once
   *   DELETE .../databases/{db}/feeds/{id}    ends a feed's link
   * Signed in with a header (not ?token=), as an account with Full Access, as Manage Security needs; a read-only or
   * layout-scoped token cannot make or end a feed.
   */
  private async manage(req: IncomingMessage, res: ServerResponse, url: URL, name: string, id: string | undefined): Promise<boolean> {
    const started = performance.now();
    let status = 200;
    let code = 0;
    let account = '';
    const reply = (s: number, body: unknown) => {
      status = s;
      res.writeHead(s, { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    try {
      const db = decodeURIComponent(name);
      const method = req.method ?? 'GET';
      const allowed = id === undefined ? ['GET', 'POST'] : ['DELETE'];
      if (!allowed.includes(method)) {
        res.setHeader('allow', allowed.join(', '));
        throw new ApiError(9, 'Method not allowed', 405);
      }
      if (!req.headers.authorization && !req.headers['x-fm-data-access-token']) throw new ApiError(952, 'Invalid FileMaker Data API token (*)', 401);
      const session = this.api.authorize(req, db);
      account = session.account;
      const store = this.host.get(db);
      if (!store) throw new ApiError(802, 'Unable to open file', 404);
      const privileges = sessionPrivileges(store, session);
      if (!privileges.full || session.readOnly || session.layoutScope) {
        throw new ApiError(9, `Account "${session.account}" doesn't have full access, which calendar feeds need`, 403);
      }
      // A feed's token is made for the account by name; a person signed in through an identity provider has the set of a
      // mapped group, not an account of that name, so the check above would not be about the account the token acts as.
      if (method === 'POST' && session.via) throw new ApiError(9, 'Calendar feeds are made from a local account; sign in with one, or use `tabularius calendar-feed create --account`', 403);
      if (method === 'GET') {
        reply(200, { feeds: listFeeds(store) });
      } else if (method === 'DELETE') {
        if (!revokeFeed(store, id!)) throw new ApiError(101, 'Record is missing: no such calendar feed', 404);
        reply(200, { revoked: id });
      } else {
        let body: Record<string, unknown>;
        try {
          const parsed = parseRequestJson((await readBody(req, 64 * 1024)).toString('utf8'), 64 * 1024);
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
          body = parsed;
        } catch (e) {
          if (e instanceof ApiError) throw e;
          throw new ApiError(960, 'Send a JSON object: {"layout": "...", "start": "..."}', 400);
        }
        const text = (k: string) => (typeof body[k] === 'string' ? body[k] as string : undefined);
        const made = createFeed(store, session.account, privileges, {
          layout: text('layout') ?? '', start: text('start') ?? '', end: text('end'), title: text('title'), description: text('description'), location: text('location'),
          zone: text('zone'), query: text('query'), label: text('label'),
          ...(typeof body.limit === 'number' ? { limit: body.limit } : {}), ...(typeof body.expiresDays === 'number' ? { expiresDays: body.expiresDays } : {}),
        });
        const o = requestOrigin(req, this.host.publicUrl);
        reply(200, { ...made, url: `${o.proto}://${o.host}${made.address}` });
      }
    } catch (e) {
      const err = e instanceof URIError ? badPathError()
        : e instanceof ApiError ? e
        : e instanceof StoreError ? new ApiError(e.code, e.message, e.code === 212 ? 401 : e.code === 105 ? 404 : 400, e.denial)
        : new ApiError(-1, 'Unknown error');
      code = err.code;
      if (!(e instanceof ApiError) && !(e instanceof StoreError)) this.host.logs?.write('fmdapi', 'Error', clientAddress(req), `calendar feeds: ${(e as Error).message}`);
      reply(err.status, { messages: [{ code: String(err.code), message: err.message }] });
    }
    this.host.logs?.write('fmdapi', code ? (status >= 500 ? 'Error' : 'Warning') : 'Information', clientAddress(req),
      `${req.method} ${redactPath(url.pathname)} ${status} code ${code} ${Math.round(performance.now() - started)} ms${account ? ` account ${account}` : ''}`);
    return true;
  }

  private zone(text: string | null): string | undefined {
    return zoneOf(text);
  }

  private mapping(q: URLSearchParams, info: LayoutInfo, privileges: ReturnType<typeof sessionPrivileges>, extra?: 'uid'): Mapping {
    return mappingOf(q, info, privileges, extra);
  }

  private feed(store: Store, info: LayoutInfo, layout: string, map: Mapping, zone: string | undefined, q: URLSearchParams, privileges: ReturnType<typeof sessionPrivileges>, account: string): { text: string; skipped: number; count: number } {
    const requested = q.get('limit');
    const most = feedCap();
    const cap = requested === null ? most : Number(requested);
    if (!Number.isInteger(cap) || cap < 1 || cap > most) throw new ApiError(960, `Parameter is invalid: limit (1 to ${most})`, 400);
    const query = queryOf(q.get('query'));
    const found = store.find(layout, {
      ...(query ? { query } : {}), sort: [{ fieldName: map.start, sortOrder: 'ascend' }], offset: 1, limit: cap + 1,
      dateFormat: 'iso', dateOrder: store.fileMode === 'native' ? 'ISO' : 'MDY', privileges, layoutOnly: true,
    });
    if (found.foundCount > cap) {
      throw new ApiError(960, `This feed would have ${found.foundCount} events, more than the ${cap} it may hold: narrow it with query${cap < most ? ' or raise limit' : ''}`, 413);
    }
    store.logRead(info.table, found.records.map((r) => r.recordId), { account, privileges });
    const type = info.fields.find((f) => f.name === map.start)!.type;
    const tag = createHash('sha256').update(`${store.name.toLowerCase()}\0${info.table}`).digest('hex').slice(0, 12);
    const when = (v: string | number | undefined): When | undefined => {
      const text = v === undefined ? '' : String(v);
      if (type === 'date') {
        const date = parseDate(text);
        return date ? { date } : undefined;
      }
      const stamp = parseStamp(text);
      if (!stamp) return undefined;
      if (zone === undefined) return { floating: stamp };
      const utc = zone === 'UTC' ? stamp : zonedToUtc(stamp, zone);
      return utc ? { utc } : undefined; // a reading that lands past the calendar's last year is no event
    };
    const events: FeedEvent[] = [];
    let skipped = 0;
    for (const r of found.records) {
      const start = when(r.fieldData[map.start]);
      if (!start) {
        skipped++;
        continue;
      }
      const end = map.end ? when(r.fieldData[map.end]) : undefined;
      const text = (name?: string) => (name === undefined || r.fieldData[name] === undefined ? '' : String(r.fieldData[name]));
      events.push({
        uid: `${r.recordId}.${tag}@tabularius`,
        start, ...(end ? { end } : {}),
        summary: text(map.title).trim() || '(untitled)',
        ...(text(map.description) ? { description: text(map.description) } : {}),
        ...(text(map.location) ? { location: text(map.location) } : {}),
        sequence: r.modId,
      });
    }
    return { text: buildCalendar(events, { name: layout, stamp: new Date(), refreshHours: REFRESH_HOURS }), skipped, count: events.length };
  }
}

/** The events of an .ics file added to a layout as records, all or none. */
export function importCalendar(store: Store, info: LayoutInfo, layout: string, map: Mapping, zone: string | undefined, text: string, privileges: ReturnType<typeof sessionPrivileges>, account: string): { imported: number; skipped: number; notes: string[] } {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new ApiError(960, 'The body is not an iCalendar (.ics) file', 400);
  const { events, notes } = readCalendar(text);
  const type = (name: string) => info.fields.find((f) => f.name === name)!.type;
  const startType = type(map.start);
  const sawUtc = { v: false };
  /** A time from the file as the clock reading (or date) the field holds. */
  const reading = (t: ReadTime, kind: 'date' | 'timestamp', endOfDay = false): string | undefined => {
    let stamp: string;
    if ('date' in t) {
      stamp = `${endOfDay ? addDays(t.date, -1) : t.date}T00:00:00`;
    } else if ('utc' in t) {
      stamp = t.utc;
      if (zone === undefined) sawUtc.v = true;
      else if (zone !== 'UTC') {
        const local = utcToZoned(t.utc, zone);
        if (!local) return undefined;
        stamp = local;
      }
    } else {
      stamp = t.floating;
      const from = t.tzid && zoneName(t.tzid);
      // Written in another zone than the fields use: moved to the zone asked for.
      if (from && zone !== undefined) {
        const utc = zonedToUtc(stamp, from);
        const local = utc && utcToZoned(utc, zone);
        if (!local) return undefined;
        stamp = local;
      }
    }
    return kind === 'date' ? stamp.slice(0, 10) : stamp;
  };
  const rows: FieldData[] = [];
  let skipped = 0;
  for (const e of events) {
    const start = reading(e.start, startType as 'date' | 'timestamp');
    if (!start) {
      skipped++;
      continue;
    }
    const row: FieldData = { [map.start]: start };
    if (map.end && e.end) {
      const allDay = 'date' in e.end && 'date' in e.start;
      let end = reading(e.end, startType as 'date' | 'timestamp', allDay && startType === 'date');
      // An all-day event written into a timestamp field ends at the start of its last day plus the whole day.
      if (allDay && startType === 'timestamp') end = reading(e.end, 'timestamp');
      if (end && end >= start) row[map.end] = end;
      else if (end && allDay) row[map.end] = start;
    }
    if (map.title && e.summary !== undefined) row[map.title] = e.summary;
    if (map.description && e.description !== undefined) row[map.description] = e.description;
    if (map.location && e.location !== undefined) row[map.location] = e.location;
    if (map.uid && e.uid !== undefined) row[map.uid] = e.uid;
    rows.push(row);
  }
  const dateOrder = store.fileMode === 'native' ? 'ISO' : 'MDY';
  const imported = atomically(() => {
    for (const row of rows) store.create(layout, row, { account, privileges, dataEntry: true, dateOrder });
    return rows.length;
  });
  const out = [...notes];
  if (skipped) out.push(`events with no usable start were skipped (${skipped})`);
  if (sawUtc.v) out.push('times written in UTC were stored as their UTC clock reading: add zone= to convert them');
  return { imported, skipped, notes: out };
}

export interface IcsRequest {
  layout: string;
  start: string;
  end?: string;
  title?: string;
  description?: string;
  location?: string;
  uid?: string;
  zone?: string;
}

/** An .ics file imported into a layout, for a caller that has no request (the command line): checked as the route checks it. */
export function importIcs(store: Store, privileges: ReturnType<typeof sessionPrivileges>, account: string, req: IcsRequest, text: string): { imported: number; skipped: number; notes: string[] } {
  const wanted = String(req.layout ?? '').toLowerCase();
  const layout = store.schema.layouts.find((l) => l.name.toLowerCase() === wanted);
  if (!layout || privileges.layout(layout.name).layout === 'none') throw new ApiError(105, `Layout "${req.layout}" is missing`, 404);
  const info = store.layout(layout.name);
  if (!privileges.in(info.owner).table(info.table).create) throw new ApiError(9, 'This account may not create records here', 403);
  const q = new URLSearchParams();
  for (const role of [...ROLES, 'uid'] as const) {
    const v = req[role];
    if (v !== undefined && v !== '') q.set(role, String(v));
  }
  return importCalendar(store, info, layout.name, mappingOf(q, info, privileges, 'uid'), zoneOf(req.zone ?? null), text, privileges, account);
}
