// Execute FileMaker Data API: a Data API request run against the current
// file, in the script's own privileges, with the Data API's JSON response.
// Requests are JSON objects; the keys are those of the Claris help page for
// the step: action (read, metaData, create, update, delete, duplicate),
// layouts, tables, query, recordId, sort, offset, limit, layout.response,
// offset.<portal>, limit.<portal>, fieldData (with deleteRelated on update),
// portalData, modId and options (entrymode, prohibitmode).
// It never calls a web service, so it is safe offline.

import { PrivilegeError, StoreError, endTransaction, writer, fieldDisplayTypes, fieldMetaData, type FindOptions, type FindRequest, type PortalPaging, type Privileges, type SortSpec, type Store, type Transaction } from '../../store/src/index.ts';

export interface DataApiOutcome {
  /** The response as JSON text, errors included. */
  json: string;
  /** Get ( LastError ): the response's code. */
  code: number;
  message: string;
}

const MESSAGES: Record<number, string> = {
  0: 'OK', 3: 'Command is unavailable', 9: 'Insufficient privileges', 101: 'Record is missing', 102: 'Field is missing',
  105: 'Layout is missing', 106: 'Table is missing', 301: 'Record is in use by another user', 306: 'Record modification ID does not match',
  401: 'No records match the request', 1708: 'Parameter value is invalid', 1710: 'Parameter is missing or invalid',
};

class RequestError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const out = (code: number, message: string, response: Record<string, unknown> = {}): DataApiOutcome => ({
  json: JSON.stringify({ messages: [{ code: String(code), message }], response }),
  code, message,
});

export function executeDataApi(store: Store, request: string, opts: { account?: string; privileges?: Privileges; rethrowExecutionRefusal?: (e: unknown) => void }): DataApiOutcome {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(request);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return out(1708, 'The request is not a JSON object');
  }
  try {
    return out(0, 'OK', respond(store, body, opts));
  } catch (e) {
    opts.rethrowExecutionRefusal?.(e);
    if (e instanceof RequestError || e instanceof StoreError || e instanceof PrivilegeError) {
      return out(e.code, MESSAGES[e.code] ?? e.message);
    }
    throw e;
  }
}

function respond(store: Store, body: Record<string, unknown>, opts: { account?: string; privileges?: Privileges }): Record<string, unknown> {
  const action = String(body.action ?? 'read');
  const layout = body.layouts === undefined ? undefined : String(body.layouts);
  const { privileges, account } = opts;
  const needLayout = () => {
    if (!layout) throw new RequestError(1710, 'The request names no layout');
    return layout;
  };
  const recordId = (): number => {
    const n = Number(body.recordId);
    if (body.recordId === undefined || !Number.isInteger(n) || n < 1) throw new RequestError(1708, 'recordId must be a record ID');
    return n;
  };
  const object = (key: string): Record<string, unknown> => {
    const v = body[key];
    if (v === undefined) return {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new RequestError(1708, `${key} must be an object`);
    return v as Record<string, unknown>;
  };
  const options = object('options');
  const mode = (key: string) => {
    const v = options[key] ?? 'user';
    if (v !== 'user' && v !== 'script') throw new RequestError(1708, `options.${key} must be "user" or "script"`);
    return v;
  };
  // prohibitmode "script" may change fields that prohibit modification during data entry; entrymode "script"
  // skips validation set to "only during data entry" (as the Data API's own create and edit do).
  const skip = mode('entrymode') === 'script';
  const write = { account, privileges, dataEntry: mode('prohibitmode') !== 'script', ...(skip ? { skipEntryValidation: true } : {}) };
  switch (action) {
    case 'read': {
      const name = needLayout();
      if (body.recordId !== undefined && body.query !== undefined) throw new RequestError(1708, 'A request takes recordId or query, not both');
      const response = body['layout.response'] === undefined ? name : String(body['layout.response']);
      const portals: PortalPaging = {};
      for (const [k, v] of Object.entries(body)) {
        const m = /^(offset|limit)\.(.+)$/.exec(k);
        if (m && Number.isFinite(Number(v))) (portals[m[2]] ??= {})[m[1] as 'offset' | 'limit'] = Number(v);
      }
      const info = store.layout(name);
      const dataInfo = (found: number, total: number, returned: number) => ({
        database: store.name, layout: response, table: info.occurrence, totalRecordCount: total, foundCount: found, returnedCount: returned,
      });
      if (body.recordId !== undefined) {
        const r = store.get(response, recordId(), 'us', portals, privileges, { layoutOnly: true });
        const total = store.find(name, { limit: 0, privileges }).totalCount;
        return { dataInfo: dataInfo(1, total, 1), data: [record(r)] };
      }
      const query = body.query;
      if (query !== undefined && (!Array.isArray(query) || !query.every((r) => r && typeof r === 'object'))) throw new RequestError(1708, 'query must be an array of objects');
      const sort = body.sort === undefined ? undefined : sortSpec(body.sort);
      const find: FindOptions = {
        query: query as FindRequest[] | undefined, sort, privileges, portals, layoutOnly: true,
        offset: body.offset === undefined ? 1 : Number(body.offset),
        limit: body.limit === undefined ? 100 : Number(body.limit),
      };
      if (!Number.isInteger(find.offset) || find.offset! < 1 || !Number.isInteger(find.limit) || find.limit! < 0) throw new RequestError(1708, 'offset and limit must be whole numbers');
      const r = store.find(response === name ? name : response, find);
      if (query !== undefined && r.foundCount === 0) throw new RequestError(401, 'No records match the request');
      return { dataInfo: dataInfo(r.foundCount, r.totalCount, r.records.length), data: r.records.map(record) };
    }
    case 'create': return (body.portalData !== undefined ? atomically : <T>(fn: () => T) => fn())(() => {
      const r = store.create(needLayout(), object('fieldData') as Record<string, string>, write);
      const portalData = object('portalData');
      if (Object.keys(portalData).length) store.updatePortals(needLayout(), r.recordId, portalData as Record<string, Record<string, string>[]>, [], write);
      return { recordId: String(r.recordId), modId: String(r.modId) };
    });
    case 'update': return (body.portalData !== undefined || (body.fieldData as Record<string, unknown> | undefined)?.deleteRelated !== undefined ? atomically : <T>(fn: () => T) => fn())(() => {
      const id = recordId();
      const modId = body.modId === undefined ? undefined : Number(body.modId);
      // The record must be one the account can see, and unchanged since modId, before any portal row is touched.
      const current = store.get(needLayout(), id, 'us', undefined, privileges, { fields: [] });
      if (modId !== undefined && current.modId !== modId) throw new RequestError(306, 'Record modification ID does not match');
      const portalData = object('portalData');
      const fieldData = { ...object('fieldData') } as Record<string, string>;
      // deleteRelated ("Portal.recordId", or a list of them) removes portal rows, as in the Data API's PATCH.
      const del: unknown = fieldData.deleteRelated;
      delete fieldData.deleteRelated;
      const deleteRelated = del === undefined ? [] : Array.isArray(del) ? del.map(String) : [String(del)];
      if (Object.keys(portalData).length || deleteRelated.length) store.updatePortals(needLayout(), id, portalData as Record<string, Record<string, string>[]>, deleteRelated, write);
      if (!Object.keys(fieldData).length) return { modId: String(store.get(needLayout(), id, 'us', undefined, privileges).modId) };
      return { modId: String(store.update(needLayout(), id, fieldData, modId, write).modId) };
    });
    case 'delete':
      store.delete(needLayout(), recordId(), { privileges });
      return {};
    case 'duplicate': {
      const r = store.duplicate(needLayout(), recordId(), write);
      return { recordId: String(r.recordId), modId: String(r.modId) };
    }
    case 'metaData': {
      // In the script's privileges, as the Data API's own metadata: a layout or field the account can't see is as if
      // it weren't there, and a masked field's value is its stand-in text, whatever the field's type.
      // The privileges of this file (a script in another file may have called this one).
      const pv = privileges?.in(store);
      if (layout) {
        if (pv && pv.layout(layout).layout === 'none') throw new RequestError(105, `Layout "${layout}" is missing`);
        const info = store.layout(layout);
        const access = (f: string) => privileges ? privileges.in(info.owner).fieldAccess(info.table, f) : 'modifiable';
        const design = info.layoutId !== undefined ? store.design(info.layoutId) : undefined;
        const shownAs = fieldDisplayTypes(design?.objects ?? [], info.occurrence);
        const own = info.owner.schema.tables.find((t) => t.name === info.table);
        return {
          fieldMetaData: info.fields.filter((f) => access(f.name) !== 'none').map((f) => {
            const m = fieldMetaData(f.name, own?.fields.find((x) => x.name === f.name), shownAs.get(f.name.toLowerCase()));
            return access(f.name) === 'masked' ? { ...m, result: 'text' } : m;
          }),
        };
      }
      if (body.tables !== undefined) {
        const want = String(body.tables);
        // A table occurrence whose table the account can't view at all is left out, and so is one whose table is
        // in another file, which this file's privileges can't speak for.
        const tos = store.schema.tableOccurrences.filter((t) => (!want || t.name === want) && (!pv || (t.dataSourceId === undefined && pv.table(tableName(store, t.baseTableId) ?? '').view !== false)));
        if (want && !tos.length) throw new RequestError(106, `No table occurrence "${want}"`);
        return { tables: tos.map((t) => ({ name: t.name })) };
      }
      return { layouts: store.layouts().filter((l) => !pv || pv.layout(l.name).layout !== 'none').map((l) => ({ name: l.name, ...(l.table ? { table: l.table } : {}) })) };
    }
  }
  throw new RequestError(3, `Unknown action "${action}"`);
}

/** Runs fn as one transaction in every file it touches, all or nothing, unless the script already has one open. */
function atomically<T>(fn: () => T): T {
  if (writer.getStore()?.transaction?.open) return fn();
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

function sortSpec(v: unknown): SortSpec[] {
  const list = Array.isArray(v) ? v : [v];
  return list.map((s) => {
    if (!s || typeof s !== 'object' || typeof (s as SortSpec).fieldName !== 'string') throw new RequestError(1708, 'sort needs fieldName');
    const { fieldName, sortOrder } = s as SortSpec;
    return { fieldName, ...(sortOrder !== undefined ? { sortOrder: String(sortOrder) } : {}) };
  });
}

const record = (r: { recordId: number; modId: number; fieldData: unknown; portalData?: unknown }) => ({
  fieldData: r.fieldData, portalData: r.portalData ?? {}, recordId: String(r.recordId), modId: String(r.modId),
});

/** The name of a base table, by id. */
function tableName(store: Store, id: number | undefined): string | undefined {
  return store.schema.tables.find((t) => t.id === id)?.name;
}
