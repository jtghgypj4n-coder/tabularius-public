// A FileMaker Server's records for the tier-2 sync (store/src/sync.ts), as a
// client of its Data API. `dataApiSource` is READ ONLY: it signs in, reads layout
// metadata and records, and signs out. It never creates, edits or deletes a
// record and never runs a script (no script parameters are sent). Only
// `dataApiClient` can write, for the apply step (store/src/sync-apply.ts), which
// the callers below only reach with the file's opt-in and a --write flag.
//
// Each table is read in full, once per run, rather than asking the server for
// records changed since the last pull: the dry run has no last pull to start
// from yet (only the apply leg records one), and a full read also gives the
// set of UUIDs still on the server, so deletions on the FileMaker side are seen.
// Dates and timestamps are asked for in ISO 8601 (`dateformats` 2), the form
// the planner compares and orders.
import { setTimeout as retryDelay } from 'node:timers/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { hostRefusal, socketLookup } from '../../scripts/src/net-guard.ts';
import { createHash, randomBytes } from 'node:crypto';
import { captureOnly } from '../../scripts/src/index.ts';
import { errorMeaning, readLocalRecords, SyncPause, SyncWriteError, type ApplyResult, type PlanItem, type RemoteFile, type RemoteRecord, type RemoteSource, type RemoteWriter, type SyncLocal, type TablePlan, type TableSyncConfig } from '../../store/src/index.ts';
import { sameValue } from '../../store/src/sync.ts';

export class FmsSyncError extends Error {}

export interface DataApiSourceOptions {
  /** Stops in-flight requests and prevents subsequent pages or writes. */
  signal?: AbortSignal;
  /** The server, as `https://host` (or a bare host name, read as https). */
  server: string;
  /** The hosted file's name on that server, without .fmp12. */
  database: string;
  /** A FileMaker account in that file with the fmrest extended privilege. */
  user: string;
  password: string;
  /** Accept the self-signed certificate a new FileMaker Server has. */
  insecure?: boolean;
  /** The tables being planned, for the UUID and timestamp field of each layout. */
  tables: TableSyncConfig[];
  /** Records read per request (default 1000). */
  pageSize?: number;
  /** Maximum response body size for Data API JSON requests (default 32 MiB). */
  maxResponseBytes?: number;
  /** Overall deadline per Data API request, including time spent receiving its body (default 60 seconds). */
  requestTimeoutMs?: number;
}

// The FileMaker Server is one an administrator named (often on the same network), so its own network is allowed; the metadata range is never reached, and a name is checked on the lookup the connection uses.
const FMS_LOOKUP = socketLookup({ private: true });

/** A RemoteSource over the Data API; `close` signs out (always call it). `writableFields` only reads a layout's metadata. */
export interface DataApiSource extends RemoteSource, Pick<RemoteWriter, 'writableFields'> {
  /** Field names exposed by this layout, for a post-run design comparison. */
  layoutFields(layout: string): Promise<string[]>;
  close(): Promise<void>;
}

/** The same session, able to write too: for the apply step only. */
export type DataApiClient = DataApiSource & RemoteWriter;

interface Reply { status: number; body: any; cookie?: string }

const RESPONSE_MAX_BYTES = 32 * 1024 * 1024;
const REQUEST_DEADLINE_MS = 60_000;
const GET_RETRY_DELAYS_MS = [100, 250] as const;

function call(base: URL, method: string, path: string, headers: Record<string, string>, insecure: boolean, body?: unknown, beforeSend?: () => void, maxBytes = RESPONSE_MAX_BYTES, timeoutMs = REQUEST_DEADLINE_MS, signal?: AbortSignal): Promise<Reply> {
  return new Promise((done, fail) => {
    signal?.throwIfAborted();
    const url = new URL(`/fmi/data/vLatest${path}`, base);
    // The socket's lookup is not asked about an address written out (http://169.254.169.254): checked here.
    const refused = hostRefusal({ private: true }, url.hostname);
    if (refused) return fail(new Error(refused));
    const payload = body === undefined ? '' : Buffer.isBuffer(body) ? body : JSON.stringify(body);
    beforeSend?.();
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let size = 0;
    const chunks: Buffer[] = [];
    const finish = (f: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      f();
    };
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method, headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)), ...headers },
      signal, agent: false, lookup: FMS_LOOKUP, ...(insecure ? { rejectUnauthorized: false } : {}),
    }, (res) => {
      const declaredLength = Number(res.headers?.['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        finish(() => fail(new Error(`response from ${url.host} exceeded the ${maxBytes}-byte limit`)));
        res.destroy?.();
        return;
      }
      res.on('data', (c: Buffer) => {
        if (settled) return;
        size += c.length;
        if (size > maxBytes) {
          finish(() => fail(new Error(`response from ${url.host} exceeded the ${maxBytes}-byte limit`)));
          chunks.length = 0;
          res.destroy?.();
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        if (settled) return;
        let parsed: any;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          parsed = undefined;
        }
        // The cookie a record read hands out is what lets the container address it lists be fetched.
        const cookie = (res.headers?.['set-cookie'] ?? []).map((c) => c.split(';')[0]).filter((c) => /^X-FMS-Session-Key=/i.test(c))[0];
        finish(() => done({ status: res.statusCode ?? 0, body: parsed, ...(cookie ? { cookie } : {}) }));
      });
      res.on('error', (e) => finish(() => fail(e)));
    });
    // Injected transports may omit socket helpers; settle even without destroy/error events.
    const abort = (error: Error) => finish(() => {
      fail(error);
      req.destroy?.(error);
    });
    req.on('error', (e) => finish(() => fail(e)));
    if (!settled) deadline = setTimeout(() => abort(new Error(`${url.host} exceeded the ${timeoutMs}ms request deadline`)), timeoutMs);
    req.setTimeout?.(30_000, () => abort(new Error(`${url.host} didn't answer`)));
    try { req.end(payload); }
    catch (e) { finish(() => fail(e)); }
  });
}

/** The most a container file fetched from FileMaker may be, unless told otherwise (50 MiB). */
export const CONTAINER_PULL_MAX_BYTES = 50 * 1024 * 1024;

/** The words of a refusal to fetch a file: what is shown to whoever asked, never the server's own text. */
type Fetched = { file: RemoteFile } | { skipped: string };

/**
 * One GET of a container address: the cookie only, no redirects followed, the body read up to `maxBytes`
 * (a bigger file is dropped as it arrives, not held).
 */
function download(url: URL, cookie: string | undefined, insecure: boolean, maxBytes: number, signal?: AbortSignal): Promise<Fetched> {
  return new Promise((done, fail) => {
    signal?.throwIfAborted();
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const finish = (f: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      f();
    };
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET', headers: { ...(cookie ? { cookie } : {}) }, signal, agent: false, lookup: FMS_LOOKUP, ...(insecure ? { rejectUnauthorized: false } : {}),
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status !== 200) {
        res.resume?.();
        finish(() => done({ skipped: status === 404 ? 'FileMaker no longer has the file' : `FileMaker answered HTTP ${status} for the file` }));
        return;
      }
      const length = Number(res.headers?.['content-length']);
      if (Number.isFinite(length) && length > maxBytes) {
        finish(() => done({ skipped: `the file is ${length} bytes, over the ${maxBytes}-byte limit` }));
        res.destroy?.();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        if (settled) return;
        size += c.length;
        if (size > maxBytes) {
          chunks.length = 0;
          finish(() => done({ skipped: `the file is over the ${maxBytes}-byte limit` }));
          res.destroy?.();
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        if (settled) return;
        const disposition = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(String(res.headers?.['content-disposition'] ?? ''))?.[1];
        const named = disposition ?? url.pathname.split('/').pop() ?? '';
        let filename: string | null = null;
        try {
          filename = decodeURIComponent(named) || null;
        } catch {
          filename = named || null;
        }
        const mime = String(res.headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        finish(() => done({ file: { filename, mime: /^[a-z0-9][\w.+-]*\/[a-z0-9][\w.+-]*$/.test(mime) ? mime : 'application/octet-stream', data: new Uint8Array(Buffer.concat(chunks)) } }));
      });
      res.on('error', (e) => finish(() => fail(e)));
    });
    const abort = (error: Error) => finish(() => {
      fail(error);
      req.destroy?.(error);
    });
    req.on('error', (e) => finish(() => fail(e)));
    if (!settled) deadline = setTimeout(() => abort(new Error(`${url.host} exceeded the 120000ms request deadline`)), 120_000);
    req.setTimeout?.(60_000, () => abort(new Error(`${url.host} didn't answer`)));
    try { req.end(); }
    catch (e) { finish(() => fail(e)); }
  });
}

/** The FileMaker error code of a reply ('0' is OK). */
const codeOf = (r: Reply): string => String(r.body?.messages?.[0]?.code ?? '');

/**
 * A refusal in FileMaker's words for its error code, never the server's own text: a server this talks to may be one an
 * administrator typed in, and its message would be echoed to whoever asked.
 */
function failure(what: string, r: Reply): FmsSyncError {
  const m = r.body?.messages?.[0];
  const code = /^-?\d{1,5}$/.test(String(m?.code)) ? Number(m.code) : undefined;
  return new FmsSyncError(`${what}: ${code === undefined ? `HTTP ${r.status}` : `${errorMeaning(code) ?? 'refused'} (error ${code})`}`);
}

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** A record as the planner sees it: its UUID and timestamp pulled out, every value as text. */
export function remoteRecord(config: TableSyncConfig, rec: { fieldData?: Record<string, unknown>; recordId?: unknown; modId?: unknown }): RemoteRecord {
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec.fieldData ?? {})) fields[k] = text(v);
  const stamp = fields[config.modTimestampField];
  return { uuid: fields[config.uuidField] ?? '', recordId: text(rec.recordId), modId: text(rec.modId), ...(stamp ? { modTimestamp: stamp } : {}), fields };
}

/**
 * A read-only RemoteSource for a FileMaker Server file. It signs in on first
 * use. Before reading a layout it checks, from the layout's field list, that
 * the layout shows the UUID and timestamp fields, and stops with their names if
 * not (sync never adds them itself).
 */
export function dataApiSource(opts: DataApiSourceOptions): DataApiSource {
  const { close, changedSince, allUuids, writableFields, fetchContainer, layoutFields } = connect(opts);
  return { close, changedSince, allUuids, writableFields, fetchContainer, layoutFields };
}

/** A session that can read (like `dataApiSource`) and write; used by `sync-apply --write` and nothing else. */
export function dataApiClient(opts: DataApiSourceOptions): DataApiClient {
  return connect(opts);
}

// FileMaker's error codes for one record: missing, locked, modId changed, and the validation and uniqueness errors.
const RECORD_CODES = new Set(['101', '301', '306', '500', '501', '502', '503', '504', '505', '506', '507', '508', '509', '510', '511']);

function connect(opts: DataApiSourceOptions): DataApiClient {
  const base = new URL(/^https?:\/\//i.test(opts.server) ? opts.server : `https://${opts.server}`);
  // The password goes in the sign-in request, so never in the clear across a network.
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
    throw new FmsSyncError(`${opts.server}: use https (the password would cross the network unencrypted)`);
  }
  const insecure = !!opts.insecure;
  const pageSize = opts.pageSize ?? 1000;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new FmsSyncError('pageSize must be a positive integer');
  const maxResponseBytes = opts.maxResponseBytes ?? RESPONSE_MAX_BYTES;
  const requestTimeoutMs = opts.requestTimeoutMs ?? REQUEST_DEADLINE_MS;
  const db = `/databases/${encodeURIComponent(opts.database)}`;
  const byLayout = new Map(opts.tables.map((t) => [t.remoteLayout, t]));
  const read = new Map<string, Promise<RemoteRecord[]>>();
  const layoutMetadata = new Map<string, Promise<{ name: string; type?: string; global?: boolean; maxRepeat?: number }[]>>();
  let token: Promise<string> | undefined;
  let cookie: string | undefined;
  let password: string | undefined = opts.password;
  // The returned session owns only this short-lived copy; the caller's options are not retained with its password.
  opts = { ...opts, password: '' };
  let closed = false;

  const signIn = (): Promise<string> => token ??= (async () => {
    if (closed || password === undefined) throw new FmsSyncError('the FileMaker session is closed');
    const r = await call(base, 'POST', `${db}/sessions`, { authorization: 'Basic ' + Buffer.from(`${opts.user}:${password}`).toString('base64') }, insecure, {}, undefined, maxResponseBytes, requestTimeoutMs, opts.signal);
    const t = r.body?.response?.token;
    if (codeOf(r) !== '0' || typeof t !== 'string') throw failure(`couldn't sign in to ${opts.database} on ${base.host}`, r);
    return t;
  })();

  /**
   * One request on the session. FileMaker ends a Data API session after 15 idle minutes (a long local pull between the
   * reads and the first write is enough), and answers 952 without doing anything, so the same request is safe to send
   * again on a new session, once. `beforeSend` runs again too, so the caller's last checks cover the repeat.
   */
  const authed = async (method: string, path: string, body?: unknown, beforeSend?: () => void, headers: Record<string, string> = {}): Promise<Reply> => {
    if (closed) throw new FmsSyncError('the FileMaker session is closed');
    const used = token;
    const first = await signIn();
    if (closed) throw new FmsSyncError('the FileMaker session is closed');
    let r = await call(base, method, path, { ...headers, authorization: `Bearer ${first}` }, insecure, body, beforeSend, maxResponseBytes, requestTimeoutMs, opts.signal);
    if (closed) throw new FmsSyncError('the FileMaker session is closed');
    if (codeOf(r) === '952' && used !== undefined) {
      if (token === used) {
        token = undefined;
        cookie = undefined;
      }
      const next = await signIn();
      if (closed) throw new FmsSyncError('the FileMaker session is closed');
      r = await call(base, method, path, { ...headers, authorization: `Bearer ${next}` }, insecure, body, beforeSend, maxResponseBytes, requestTimeoutMs, opts.signal);
      if (closed) throw new FmsSyncError('the FileMaker session is closed');
    }
    return r;
  };

  const get = async (path: string): Promise<Reply> => {
    let last: unknown;
    for (let attempt = 0; attempt <= GET_RETRY_DELAYS_MS.length; attempt++) {
      try {
        const r = await authed('GET', path);
        if (r.status !== 502 && r.status !== 503) return r;
        last = new Error(`FileMaker answered HTTP ${r.status}`);
      } catch (e) {
        if (closed) throw e;
        opts.signal?.throwIfAborted();
        last = e;
      }
      if (attempt < GET_RETRY_DELAYS_MS.length) await retryDelay(GET_RETRY_DELAYS_MS[attempt], undefined, { signal: opts.signal });
    }
    throw last;
  };

  const fieldsOf = (layout: string): Promise<{ name: string; type?: string; global?: boolean; maxRepeat?: number }[]> => {
    if (!byLayout.has(layout)) throw new FmsSyncError(`no table is set up to sync with layout ${layout}`);
    let pending = layoutMetadata.get(layout);
    if (pending) return pending;
    const path = `${db}/layouts/${encodeURIComponent(layout)}`;
    pending = (async () => {
      const meta = await get(path);
      if (codeOf(meta) !== '0') {
        const m = meta.body?.messages?.[0];
        if (String(m?.code) === '105') throw new SyncPause(`FileMaker has no layout ${layout} in ${opts.database}`);
        throw failure(`couldn't read layout ${layout} in ${opts.database}`, meta);
      }
      return (meta.body.response?.fieldMetaData ?? []) as { name: string; type?: string; global?: boolean; maxRepeat?: number }[];
    })();
    layoutMetadata.set(layout, pending);
    return pending;
  };

  const readLayout = async (layout: string): Promise<RemoteRecord[]> => {
    const config = byLayout.get(layout);
    if (!config) throw new FmsSyncError(`no table is set up to sync with layout ${layout}`);
    const path = `${db}/layouts/${encodeURIComponent(layout)}`;
    const shown = new Set((await fieldsOf(layout)).map((f) => f.name));
    const missing = [config.uuidField, config.modTimestampField].filter((f) => !shown.has(f));
    if (missing.length) throw new SyncPause(`layout ${layout} in ${opts.database} doesn't show ${missing.join(' or ')}; add ${missing.length > 1 ? 'them' : 'it'} to the layout`);
    const scan = async (): Promise<RemoteRecord[]> => {
      const out: RemoteRecord[] = [];
      let found: number | undefined;
      let changed = false;
      for (let offset = 1; found === undefined || offset <= found; offset += pageSize) {
        const r = await get(`${path}/records?_offset=${offset}&_limit=${pageSize}&dateformats=2`);
        if (codeOf(r) === '401' && offset === 1) return [];
        if (codeOf(r) !== '0') throw failure(`couldn't read the records on layout ${layout} in ${opts.database}`, r);
        const count = Number(r.body.response?.dataInfo?.foundCount);
        if (!Number.isSafeInteger(count) || count < 0) throw new FmsSyncError(`layout ${layout} in ${opts.database}: the server didn't say how many records there are`);
        found ??= count;
        const data = (r.body.response?.data ?? []) as { fieldData?: Record<string, unknown>; recordId?: unknown; modId?: unknown }[];
        if (r.cookie) cookie = r.cookie;
        for (const rec of data) out.push(remoteRecord(config, rec));
        if (count !== found || data.length !== Math.min(pageSize, found - offset + 1)) { changed = true; break; }
      }
      if (changed || out.length !== found || new Set(out.map((r) => r.recordId)).size !== out.length || new Set(out.map((r) => r.uuid).filter(Boolean)).size !== out.filter((r) => r.uuid).length) {
        throw new SyncPause(`layout ${layout} in ${opts.database} changed while it was read (${out.length} records read, ${found} there); run it again`);
      }
      return out;
    };
    const first = await scan();
    // Offset pagination is not a snapshot. Recheck empty and multi-page layouts, where a page shift can hide a record.
    if (first.length === 0 || first.length > pageSize) {
      const second = await scan();
      const fingerprint = (rows: RemoteRecord[]) => createHash('sha256').update(JSON.stringify(rows.map((r) => [r.recordId, r.modId, r.uuid, r.fields]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))).digest('hex');
      if (fingerprint(first) !== fingerprint(second)) throw new SyncPause(`layout ${layout} in ${opts.database} changed while it was read; run it again`);
    }
    return first;
  };

  const records = (layout: string): Promise<RemoteRecord[]> => {
    opts.signal?.throwIfAborted();
    let p = read.get(layout);
    if (!p) read.set(layout, p = readLayout(layout));
    return p;
  };

  const send = async (method: string, path: string, body?: unknown, beforeSend?: () => void): Promise<Reply> => {
    // The final local check and review consumption share the request's synchronous dispatch.
    return authed(method, path, body, beforeSend);
  };
  const refused = (what: string, r: Reply): SyncWriteError => {
    const m = r.body?.messages?.[0];
    const code = /^-?\d{1,5}$/.test(String(m?.code)) ? Number(m.code) : undefined;
    return new SyncWriteError(`${what}: ${code === undefined ? `HTTP ${r.status}` : `${errorMeaning(code) ?? 'refused'} (error ${code})`}`, String(code ?? r.status), RECORD_CODES.has(String(code)));
  };
  const recordPath = (layout: string, recordId: string): string => {
    if (!byLayout.has(layout)) throw new FmsSyncError(`no table is set up to sync with layout ${layout}`);
    return `${db}/layouts/${encodeURIComponent(layout)}/records${recordId ? `/${encodeURIComponent(recordId)}` : ''}`;
  };
  const writable = new Map<string, Promise<Set<string>>>();

  return {
    layoutFields: async (layout) => (await fieldsOf(layout)).map((f) => f.name).sort(),
    // Every record, whatever `since` says: see the note at the top of this file.
    changedSince: (layout) => records(layout),
    allUuids: async (layout) => new Set((await records(layout)).map((r) => r.uuid).filter((u) => u !== '')),
    // A container file, from the address a record lists. Only this server's own address is fetched (the same scheme,
    // host and port that was signed in to), so a record can't point the fetch, or the session cookie, anywhere else.
    async fetchContainer(layout, address, maxBytes) {
      if (!byLayout.has(layout)) throw new FmsSyncError(`no table is set up to sync with layout ${layout}`);
      let url: URL;
      try {
        url = new URL(address);
      } catch {
        return { skipped: 'the field holds no address to fetch' };
      }
      if (url.protocol !== base.protocol || url.host !== base.host) return { skipped: `the file is at ${url.host || 'another address'}, not on ${base.host}; it wasn't fetched` };
      await signIn();
      if (closed) throw new FmsSyncError('the FileMaker session is closed');
      const got = await download(url, cookie, insecure, maxBytes, opts.signal).catch((e: Error) => {
        throw new SyncWriteError(`couldn't fetch the file from ${base.host}: ${e.message}`, 'container', true);
      });
      return 'file' in got ? got.file : got;
    },
    // Fields a write may set: stored ones, not global, not repeating, not on a related table.
    writableFields: (layout) => {
      let p = writable.get(layout);
      if (!p) {
        writable.set(layout, p = (async () => {
          const meta = await get(`${db}/layouts/${encodeURIComponent(layout)}`);
          if (codeOf(meta) !== '0') throw failure(`couldn't read layout ${layout} in ${opts.database}`, meta);
          const fields = (meta.body.response?.fieldMetaData ?? []) as { name: string; type?: string; global?: boolean; maxRepeat?: number }[];
          return new Set(fields.filter((f) => (f.type === undefined || f.type === 'normal') && !f.global && !((f.maxRepeat ?? 1) > 1) && !f.name.includes('::')).map((f) => f.name));
        })());
      }
      return p;
    },
    async create(layout, fieldData, beforeSend) {
      const r = await send('POST', recordPath(layout, ''), { fieldData }, beforeSend);
      if (codeOf(r) !== '0') throw refused(`couldn't create the record on layout ${layout}`, r);
      return { recordId: text(r.body.response?.recordId), modId: text(r.body.response?.modId) };
    },
    async update(layout, recordId, fieldData, modId, beforeSend) {
      const r = await send('PATCH', recordPath(layout, recordId), { fieldData, modId }, beforeSend);
      if (codeOf(r) !== '0') throw refused(`couldn't update record ${recordId} on layout ${layout}`, r);
      return { modId: text(r.body.response?.modId) };
    },
    async read(layout, recordId) {
      const r = await get(`${recordPath(layout, recordId)}?dateformats=2`);
      if (codeOf(r) === '101') return undefined;
      if (codeOf(r) !== '0') throw refused(`couldn't read record ${recordId} on layout ${layout}`, r);
      const rec = r.body.response?.data?.[0];
      return rec ? remoteRecord(byLayout.get(layout)!, rec) : undefined;
    },
    // A file into a container field (the first repetition), as the Data API takes it: a multipart form with the file as "upload".
    async uploadContainer(layout, recordId, field, file, beforeSend) {
      const boundary = `----tabularius${randomBytes(12).toString('hex')}`;
      const name = (file.filename ?? 'file').replace(/[\r\n"\\]/g, '_').slice(0, 200) || 'file';
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="upload"; filename="${name}"\r\nContent-Type: ${file.mime || 'application/octet-stream'}\r\n\r\n`),
        Buffer.from(file.data),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const r = await authed('POST', `${recordPath(layout, recordId)}/containers/${encodeURIComponent(field)}/1`, body, beforeSend, { 'content-type': `multipart/form-data; boundary=${boundary}` });
      if (codeOf(r) !== '0') throw refused(`couldn't send the file for ${field} to record ${recordId} on layout ${layout}`, r);
      const modId = text(r.body.response?.modId);
      if (modId) return { modId };
      const now = await get(`${recordPath(layout, recordId)}?dateformats=2`);
      return { modId: text(now.body?.response?.data?.[0]?.modId) };
    },
    async delete(layout, recordId, beforeSend) {
      const r = await send('DELETE', recordPath(layout, recordId), undefined, beforeSend);
      if (codeOf(r) !== '0' && codeOf(r) !== '101') throw refused(`couldn't delete record ${recordId} on layout ${layout}`, r);
    },
    async close() {
      if (closed) return;
      closed = true;
      password = undefined;
      read.clear();
      writable.clear();
      layoutMetadata.clear();
      if (!token) return;
      const t = await token.catch(() => undefined);
      token = undefined;
      cookie = undefined;
      if (t) await call(base, 'DELETE', `${db}/sessions/${encodeURIComponent(t)}`, {}, insecure).catch(() => {});
    },
  };
}

const POLICIES = ['flag', 'filemaker-wins', 'tabularius-wins', 'newer-wins'];

/** What `sync-plan --config` reads: the server, its file, and how each table maps to a layout there. */
export interface SyncConfigFile {
  server: string;
  database: string;
  user?: string;
  /** This file may be written to FileMaker Server by `sync-apply --write`. Off unless the file says so. */
  allowWrites?: boolean;
  /** `sync-apply --containers` may move container files with `--pull` (to here) and `--write` (to FileMaker). Off unless the file says so. */
  allowContainers?: boolean;
  tables: TableSyncConfig[];
}

/** A sync configuration read from JSON, checked; a table's layout defaults to its own name. */
export function parseSyncConfig(json: unknown): SyncConfigFile {
  const c = json as Partial<SyncConfigFile> | null;
  if (!c || typeof c !== 'object') throw new FmsSyncError('the sync configuration must be a JSON object');
  if (typeof c.server !== 'string' || !c.server) throw new FmsSyncError('the sync configuration needs "server" (for example "https://fms.example.com")');
  if (typeof c.database !== 'string' || !c.database) throw new FmsSyncError('the sync configuration needs "database" (the file\'s name on that server)');
  if (!Array.isArray(c.tables) || !c.tables.length) throw new FmsSyncError('the sync configuration needs "tables", one entry per table');
  if (c.tables.length > 1000) throw new FmsSyncError('the sync configuration may have at most 1000 tables');
  const tables = c.tables.map((t: Partial<TableSyncConfig>, i) => {
    for (const k of ['localTable', 'uuidField', 'modTimestampField'] as const) {
      if (typeof t?.[k] !== 'string' || !t[k]) throw new FmsSyncError(`tables[${i}] needs "${k}"`);
    }
    if (t.policy !== undefined && !POLICIES.includes(t.policy)) throw new FmsSyncError(`tables[${i}]: "policy" is one of ${POLICIES.join(', ')}`);
    return { localTable: t.localTable!, remoteLayout: t.remoteLayout || t.localTable!, uuidField: t.uuidField!, modTimestampField: t.modTimestampField!, ...(t.policy ? { policy: t.policy } : {}) };
  });
  if (c.allowWrites !== undefined && typeof c.allowWrites !== 'boolean') throw new FmsSyncError('"allowWrites" is true or false');
  if (c.allowContainers !== undefined && typeof c.allowContainers !== 'boolean') throw new FmsSyncError('"allowContainers" is true or false');
  return { server: c.server, database: c.database, ...(typeof c.user === 'string' && c.user ? { user: c.user } : {}), ...(c.allowWrites ? { allowWrites: true } : {}), ...(c.allowContainers ? { allowContainers: true } : {}), tables };
}

const shorten = (v: unknown): string => {
  const s = text(v).replace(/\s+/g, ' ');
  return JSON.stringify(s.length > 60 ? `${s.slice(0, 57)}...` : s);
};

const tally = (items: PlanItem[]): string => {
  const n = (op: string) => items.filter((i) => i.op === op).length;
  return `${n('create')} new, ${n('update')} changed, ${n('delete')} deleted`;
};

/** A dry-run plan for the terminal: per table, what would move each way and what is held for review. */
export function describePlan(plans: TablePlan[], server: string): string[] {
  const out = [`Dry run: nothing was changed here or on ${server}.`];
  for (const p of plans) {
    out.push(`${p.localTable} (layout ${p.remoteLayout}):`);
    if (p.paused) {
      out.push(`  paused: ${p.paused}`);
      continue;
    }
    out.push(`  ${p.pushes.length} to send to FileMaker (${tally(p.pushes)})`);
    out.push(`  ${p.pulls.length} to bring here (${tally(p.pulls)})`);
    out.push(`  ${p.conflicts.length} ${p.conflicts.length === 1 ? 'conflict' : 'conflicts'} held for review`);
    for (const c of p.conflicts.slice(0, 20)) {
      if (c.localRecordId === null) out.push(`    ${c.uuid}: deleted here, changed on FileMaker`);
      else if (c.remoteRecordId === null) out.push(`    ${c.uuid}: changed here, deleted on FileMaker`);
      else out.push(`    ${c.uuid}: ${c.clashes.map((f) => `${f.field} here ${shorten(f.local)}, on FileMaker ${shorten(f.remote)}`).join('; ')}`);
    }
    if (p.conflicts.length > 20) out.push(`    and ${p.conflicts.length - 20} more (--json lists them all)`);
    if (p.unkeyed) out.push(`  ${p.unkeyed.local + p.unkeyed.remote} left out because their UUID field is empty (${p.unkeyed.local} here, ${p.unkeyed.remote} on FileMaker)`);
  }
  return out;
}

/**
 * Whether this file may sync over the network at all, and whether it may be written to FileMaker. Throws, saying why not.
 * A capture-only file never syncs, planning included; writing needs
 * the configuration's `"allowWrites": true` as well as the command's --write.
 */
export function checkSyncAllowed(files: string[], config: SyncConfigFile, opts: { write: boolean; captureOnly?: readonly string[] }): void {
  const held = [...files, config.database].find((f) => captureOnly(f, opts.captureOnly));
  if (held !== undefined) throw new FmsSyncError(`"${held}" is capture-only: it never syncs with a FileMaker Server`);
  if (opts.write && !config.allowWrites) {
    throw new FmsSyncError('this configuration doesn\'t allow writing to FileMaker: add "allowWrites": true to it (writing is off unless the file says so), then run again with --write');
  }
}

export interface SyncVerificationTable {
  table: string;
  layout: string;
  localCount: number;
  remoteCount: number;
  localDesignHash: string;
  remoteDesignHash: string;
  sampled: number;
  localSampleHash: string;
  remoteSampleHash: string;
  sampleDifferences: number;
  differences: string[];
}

/** Independent, fresh read after an apply run. Hashes cover layout field names and up to 16 keyed records per table. */
export async function verifySync(store: SyncLocal, configs: TableSyncConfig[], source: DataApiSource): Promise<SyncVerificationTable[]> {
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const result: SyncVerificationTable[] = [];
  for (const config of configs) {
    const table = store.schema.tables.find((t) => t.name === config.localTable);
    if (!table) throw new FmsSyncError(`local table ${config.localTable} is missing`);
    const localFields = table.fields.map((f) => f.name).sort();
    const remoteFields = await source.layoutFields(config.remoteLayout);
    const locals = readLocalRecords(store, config);
    const remotes = await source.changedSince(config.remoteLayout, null);
    const differences: string[] = [];
    if (locals.length !== remotes.length) differences.push(`count: ${locals.length} here, ${remotes.length} on FileMaker`);
    const localDesignHash = hash(localFields);
    const remoteDesignHash = hash(remoteFields);
    if (localDesignHash !== remoteDesignHash) {
      const onlyHere = localFields.filter((f) => !remoteFields.includes(f));
      const onlyThere = remoteFields.filter((f) => !localFields.includes(f));
      differences.push(`field-list design hash differs (${onlyHere.length} fields only here, ${onlyThere.length} only on FileMaker)`);
    }
    const byLocal = new Map(locals.filter((r) => r.uuid).map((r) => [r.uuid, r]));
    const byRemote = new Map(remotes.filter((r) => r.uuid).map((r) => [r.uuid, r]));
    const localKeyed = locals.filter((r) => r.uuid).length;
    const remoteKeyed = remotes.filter((r) => r.uuid).length;
    if (localKeyed !== locals.length || remoteKeyed !== remotes.length) differences.push(`unkeyed records: ${locals.length - localKeyed} here, ${remotes.length - remoteKeyed} on FileMaker`);
    if (byLocal.size !== localKeyed || byRemote.size !== remoteKeyed) differences.push(`duplicate UUIDs: ${localKeyed - byLocal.size} here, ${remoteKeyed - byRemote.size} on FileMaker`);
    const sample = [...new Set([...byLocal.keys(), ...byRemote.keys()])].sort((a, b) => hash(a).localeCompare(hash(b))).slice(0, 16);
    const comparable = localFields.filter((f) => remoteFields.includes(f) && f !== config.modTimestampField);
    let sampleDifferences = 0;
    const localChecksums: (string | null)[] = [];
    const remoteChecksums: (string | null)[] = [];
    for (const uuid of sample) {
      const local = byLocal.get(uuid);
      const remote = byRemote.get(uuid);
      if (!local || !remote) {
        localChecksums.push(local ? hash(local.fields) : null);
        remoteChecksums.push(remote ? hash(remote.fields) : null);
        sampleDifferences++;
        continue;
      }
      const localValues = comparable.map((field) => {
        const value = local.fields[field];
        const other = remote.fields[field] ?? '';
        const fieldType = table.fields.find((f) => f.name === field)?.type;
        return [field, sameValue(value, other, fieldType) ? other : String(value ?? '')];
      });
      const remoteValues = comparable.map((field) => [field, remote.fields[field] ?? '']);
      const localChecksum = hash(localValues);
      const remoteChecksum = hash(remoteValues);
      localChecksums.push(localChecksum);
      remoteChecksums.push(remoteChecksum);
      if (localChecksum !== remoteChecksum) sampleDifferences++;
    }
    if (sampleDifferences) differences.push(`${sampleDifferences} of ${sample.length} sampled keyed records differ or are missing`);
    result.push({ table: config.localTable, layout: config.remoteLayout, localCount: locals.length, remoteCount: remotes.length,
      localDesignHash, remoteDesignHash, sampled: sample.length, localSampleHash: hash(localChecksums), remoteSampleHash: hash(remoteChecksums), sampleDifferences, differences });
  }
  return result;
}

export function describeSyncVerification(tables: SyncVerificationTable[]): string[] {
  const out = ['Verification: fresh source read; counts are complete, record checksums sample up to 16 UUIDs per table; design hashes compare layout field names.'];
  for (const t of tables) {
    out.push(`${t.table} (layout ${t.layout}): ${t.localCount} here, ${t.remoteCount} on FileMaker; ${t.sampled} sampled; sample SHA-256 ${t.localSampleHash} here, ${t.remoteSampleHash} on FileMaker; field-list design SHA-256 ${t.localDesignHash} here, ${t.remoteDesignHash} on FileMaker`);
    out.push(...(t.differences.length ? t.differences.map((d) => `  DIFFERENCE: ${d}`) : ['  counts, sampled records and field lists match']));
  }
  return out;
}

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** What a sync-apply run did, or in a dry run would do, for the terminal. */
export function describeApply(r: ApplyResult, server: string): string[] {
  const live = r.write || r.pull;
  const out = [!live ? `Dry run: nothing was changed here or on ${server}. Add --write to send to it, --pull to bring its changes here.`
    : `${r.write && r.pull ? `Wrote to ${server} and brought its changes here` : r.write ? `Wrote to ${server}` : `Brought changes from ${server} here`} (run ${r.runId}; each change is in the log).`];
  if (!live && r.containersCompared === false) out.push('Container files here were not compared (a dry run opens the file read-only and cannot read them), so a record changed on both sides that differs only in a file is not listed as a conflict. A run with --pull or --write compares them and holds such records for review.');
  for (const t of r.tables) {
    out.push(`${t.localTable} (layout ${t.layout}):`);
    if (t.skipped) {
      out.push(`  skipped: ${t.skipped}`);
      continue;
    }
    const did = live ? '' : 'would be ';
    if (!live || r.write) out.push(`  ${count(t.created, 'record')} ${did}created, ${count(t.updated, 'record')} ${did}updated, ${count(t.deleted, 'record')} ${did}deleted on FileMaker`);
    if (!live || r.pull) out.push(`  ${count(t.pulled.created, 'record')} ${did}created, ${count(t.pulled.updated, 'record')} ${did}updated, ${count(t.pulled.deleted, 'record')} ${did}deleted here`);
    if (live && r.pull && t.pulled.related) out.push(`  ${count(t.pulled.related, 'other record')} deleted here along with them, by this file's "delete related records" relationships (--keep-related leaves them)`);
    if (t.adopted) out.push(`  ${count(t.adopted, 'record')} already in step (recorded, nothing changed)`);
    if (t.heldDeletes) out.push(`  ${count(t.heldDeletes, 'deletion')} on FileMaker held: add --allow-deletes to send them`);
    if (t.heldPullDeletes) out.push(`  ${count(t.heldPullDeletes, 'deletion')} here held: add --allow-deletes to make them`);
    if (t.pendingPulls) out.push(`  ${count(t.pendingPulls, 'record')} to bring here: add --pull`);
    if (t.pendingPushes) out.push(`  ${count(t.pendingPushes, 'record')} to send to FileMaker: add --write`);
    const c = t.containers;
    if (c.checked || c.pulled || c.cleared || c.unchanged || c.toSend || c.sent || c.skipped.length) {
      out.push(live
        ? `  container files: ${[r.pull ? `${c.pulled} brought here, ${c.cleared} emptied` : '', r.write ? `${c.sent} sent to FileMaker` : '', `${c.unchanged} already the same`].filter(Boolean).join(', ')}`
        : `  container files: up to ${count(c.checked + c.toSend, 'file')} would be fetched, compared or sent (a run with --containers does it, bringing them with --pull and sending them with --write)`);
      for (const k of c.skipped.slice(0, 20)) out.push(`  file left out: ${k.field}${k.uuid ? ` of ${k.uuid}` : ''}: ${k.reason}`);
    }
    if (t.unsentFields.length) out.push(`  never sent (not a stored field on the layout, or a container): ${t.unsentFields.join(', ')}`);
    for (const f of t.failed.slice(0, 20)) out.push(`  FAILED ${f.op} ${f.uuid}: ${f.error}`);
  }
  if (r.interrupted) out.push(`${count(r.interrupted, 'change')} of an earlier run never finished (marked interrupted in the log); this run checked where they stood.`);
  if (r.refused) out.push(`${live ? 'Refused' : 'A run would be refused'}: ${r.refused}`);
  if (r.stopped) out.push(`Stopped: ${r.stopped}`);
  return out;
}
